// The rules of one online game room, separate from Cloudflare's Durable Object plumbing
// (game-room.ts) so they can be tested in Node with in-memory storage. Everything that changes
// state runs synchronously after the last `await` (token hashing), so two requests can never
// interleave between reading and writing the game.

import {
  applyCommand,
  createNewGame,
  createRngState,
  identifiableFaceDownCards,
  isAnytimeCommandType,
  projectForViewer,
  resolveHiddenIds,
  runAutomaticSteps,
  systemDecisionDelegate,
  undoBlockReason,
  type GameCommand,
  type GameState,
  type PlayerId,
} from "../engine";
import { scenarios } from "../data";
import type { ScenarioId } from "../data/types";
import {
  ONLINE_LIMITS,
  ONLINE_PAGE_PATH,
  type CommandRequest,
  type CommandResponse,
  type CreateGameResponse,
  type GameView,
  type ImportGameResponse,
  type JoinResponse,
  type SeatLink,
  type ServerErrorCode,
  type Viewer,
} from "../online/protocol";
import { deserializeSave, SaveValidationError, serializeSave } from "../save";

// ---------------------------------------------------------------------------------------------
// Storage

export type SeatRecord = {
  /** "seat:<playerId>" or "spectator". */
  id: string;
  role: "seat" | "spectator";
  playerId?: PlayerId;
  name?: string;
  /** SHA-256 of the link token, hex. The token itself is never stored. */
  tokenHash: string;
  creator: boolean;
  joinedAt?: string;
};

/** One undoable step: a seat's command (with the automatic steps after it). */
export type HistoryEntry = {
  seatId: string;
  commandId: string;
  /** Snapshot to return to. */
  beforeVersion: number;
  /** The version this command produced; undo needs it to still be the current one. */
  afterVersion: number;
};

export type RoomMeta = {
  gameId: string;
  createdAt: string;
  source: "created" | "imported";
  /** Current version; its snapshot is the authoritative state. */
  version: number;
  /** Newest last, at most ONLINE_LIMITS.undoDepth entries. */
  history: HistoryEntry[];
  /** Recently applied `${seatId} ${commandId}`, so a retried command is not applied twice. */
  recentCommands: string[];
};

/** Append-only audit trail of everything that changed the game. */
export type CommandRecord = {
  version: number;
  seatId: string | null;
  kind: "create" | "import" | "command" | "automatic" | "undo";
  commandId?: string;
  type?: string;
  actorId?: string;
  payload?: unknown;
  at: string;
};

/** What a room needs from its storage. Both implementations are synchronous. */
export interface RoomStorage {
  readMeta(): RoomMeta | null;
  writeMeta(meta: RoomMeta): void;
  readSeats(): SeatRecord[];
  writeSeat(seat: SeatRecord): void;
  readSnapshot(version: number): GameState | null;
  writeSnapshot(version: number, state: GameState): void;
  /** Delete every snapshot whose version is not listed. */
  pruneSnapshots(keep: number[]): void;
  appendCommands(records: CommandRecord[]): void;
  /** Runs `fn` atomically: all of its writes happen, or none. */
  transaction<T>(fn: () => T): T;
}

/** In-memory storage for tests and local tools. Snapshots are kept as JSON, as on the server. */
export class MemoryRoomStorage implements RoomStorage {
  meta: RoomMeta | null = null;
  seats = new Map<string, SeatRecord>();
  snapshots = new Map<number, string>();
  commands: CommandRecord[] = [];

  readMeta() {
    return this.meta ? structuredClone(this.meta) : null;
  }
  writeMeta(meta: RoomMeta) {
    this.meta = structuredClone(meta);
  }
  readSeats() {
    return [...this.seats.values()].map((seat) => ({ ...seat }));
  }
  writeSeat(seat: SeatRecord) {
    this.seats.set(seat.id, { ...seat });
  }
  readSnapshot(version: number) {
    const json = this.snapshots.get(version);
    return json === undefined ? null : (JSON.parse(json) as GameState);
  }
  writeSnapshot(version: number, state: GameState) {
    this.snapshots.set(version, JSON.stringify(state));
  }
  pruneSnapshots(keep: number[]) {
    for (const version of [...this.snapshots.keys()]) if (!keep.includes(version)) this.snapshots.delete(version);
  }
  appendCommands(records: CommandRecord[]) {
    this.commands.push(...structuredClone(records));
  }
  transaction<T>(fn: () => T): T {
    const saved = {
      meta: this.meta,
      seats: new Map(this.seats),
      snapshots: new Map(this.snapshots),
      commands: [...this.commands],
    };
    try {
      return fn();
    } catch (error) {
      Object.assign(this, saved);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Results

export type CoreError = { code: ServerErrorCode | string; message: string };

export type CoreResult<T> =
  | { ok: true; status: number; body: T; changed?: boolean }
  | { ok: false; status: number; error: CoreError };

function fail(status: number, code: ServerErrorCode, message: string): { ok: false; status: number; error: CoreError } {
  return { ok: false, status, error: { code, message } };
}

function ok<T>(body: T, changed = false): { ok: true; status: number; body: T; changed?: boolean } {
  return changed ? { ok: true, status: 200, body, changed } : { ok: true, status: 200, body };
}

export type ExportedSave = { filename: string; text: string };

// ---------------------------------------------------------------------------------------------
// Tokens

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** A random 128-bit token, base64url (22 characters). */
export function newToken(random: (length: number) => Uint8Array = randomBytes): string {
  return base64url(random(16));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares two hex digests without stopping at the first difference. */
export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function viewerOf(seat: SeatRecord): Viewer {
  return seat.role === "seat" && seat.playerId ? { kind: "seat", playerId: seat.playerId } : { kind: "spectator" };
}

// ---------------------------------------------------------------------------------------------
// Input checks

const SCENARIO_IDS = new Set<string>(scenarios.map((scenario) => scenario.id));
const NAMED_COLORS = new Set(["red", "blue", "yellow", "green", "purple", "black", "white", "pink", "orange", "brown", "grey", "gray", "teal"]);
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** The family palette the hotseat setup uses (src/ui/view-model.ts FAMILY_PALETTE). */
const DEFAULT_COLORS = ["#2563a8", "#c9971a", "#c2417d", "#2e7d4f", "#7a4fa0", "#3b3b3b"];

type CreateInput = { scenario: ScenarioId; players: Array<{ name: string; color: string }>; creatorIndex: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreate(body: unknown): CreateInput | string {
  if (!isRecord(body)) return "The request must be a JSON object.";
  if (typeof body.scenario !== "string" || !SCENARIO_IDS.has(body.scenario)) {
    return `Unknown scenario. Choose one of: ${[...SCENARIO_IDS].join(", ")}.`;
  }
  const players = body.players;
  if (!Array.isArray(players) || players.length < ONLINE_LIMITS.minPlayers || players.length > ONLINE_LIMITS.maxPlayers) {
    return `An online game needs ${ONLINE_LIMITS.minPlayers}-${ONLINE_LIMITS.maxPlayers} players.`;
  }
  const parsed: CreateInput["players"] = [];
  for (const [index, player] of players.entries()) {
    if (!isRecord(player) || typeof player.name !== "string") return `Player ${index + 1} needs a name.`;
    const name = player.name.trim().replace(/\s+/g, " ");
    if (name.length === 0 || name.length > ONLINE_LIMITS.maxNameLength) {
      return `Player ${index + 1}'s name must be 1-${ONLINE_LIMITS.maxNameLength} characters.`;
    }
    if (/[\u0000-\u001f\u007f]/.test(name)) return `Player ${index + 1}'s name has control characters.`;
    if (parsed.some((other) => other.name.toLowerCase() === name.toLowerCase())) return `Two players are called "${name}".`;
    let color = DEFAULT_COLORS[index];
    if (player.color !== undefined) {
      if (typeof player.color !== "string" || !(HEX_COLOR.test(player.color) || NAMED_COLORS.has(player.color.toLowerCase()))) {
        return `Player ${index + 1}'s colour must be a #hex colour or a colour name.`;
      }
      color = player.color;
    }
    parsed.push({ name, color });
  }
  const creatorIndex = body.creatorIndex ?? 0;
  if (typeof creatorIndex !== "number" || !Number.isInteger(creatorIndex) || creatorIndex < 0 || creatorIndex >= parsed.length) {
    return "creatorIndex must be the index of one of the players.";
  }
  return { scenario: body.scenario as ScenarioId, players: parsed, creatorIndex };
}

type CommandInput = CommandRequest["command"];

function parseCommand(value: unknown): CommandInput | string {
  if (!isRecord(value)) return "The command must be a JSON object.";
  const { id, decisionId, type, payload } = value;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return "command.id must be a string of 1-128 characters.";
  if (typeof decisionId !== "string" || decisionId.length > 512) return "command.decisionId must be a string.";
  if (typeof type !== "string" || type.length === 0 || type.length > 128) return "command.type must be a string.";
  return { id, decisionId, type, payload: payload ?? {} };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

// ---------------------------------------------------------------------------------------------
// The room

export type RoomLimits = { [Key in keyof typeof ONLINE_LIMITS]: number };

export type RoomOptions = {
  now?: () => Date;
  random?: (length: number) => Uint8Array;
  limits?: Partial<RoomLimits>;
};

export type CreateRequestInput = { gameId: string; origin: string; body: unknown };
export type ImportRequestInput = { gameId: string; origin: string; body: unknown };

type Bucket = { tokens: number; at: number };

export class GameRoomCore {
  private readonly now: () => Date;
  private readonly random: (length: number) => Uint8Array;
  private readonly limits: RoomLimits;
  private cache?: { version: number; state: GameState };
  private beforeCache?: { version: number; state: GameState };
  private seatCache?: SeatRecord[];
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly storage: RoomStorage,
    options: RoomOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? randomBytes;
    this.limits = { ...ONLINE_LIMITS, ...options.limits };
  }

  // --- creating a room -------------------------------------------------------------------------

  async create(input: CreateRequestInput): Promise<CoreResult<CreateGameResponse>> {
    if (this.storage.readMeta()) return fail(409, "GAME_EXISTS", "This game already exists.");
    const parsed = parseCreate(input.body);
    if (typeof parsed === "string") return fail(400, "BAD_REQUEST", parsed);

    const at = this.timestamp();
    let state = createNewGame({
      mode: "hotseat",
      scenario: parsed.scenario,
      gameId: input.gameId,
      seed: this.newSeed(),
      now: at,
      setupDistribution: "random",
      players: parsed.players.map((player, index) => ({ id: `player-${index + 1}`, name: player.name, color: player.color })),
    });
    const automatic = runAutomaticSteps(state, { now: at, idPrefix: "setup-auto" });
    state = automatic.state;

    const creatorId = state.seatingOrder[parsed.creatorIndex];
    const { seats, tokens } = await this.issueSeats(state, creatorId);
    if (this.storage.readMeta()) return fail(409, "GAME_EXISTS", "This game already exists.");

    this.storeNewRoom(input.gameId, "created", state, seats, [
      { version: 1, seatId: null, kind: "create", at, payload: { scenario: parsed.scenario, players: parsed.players.length } },
      ...automatic.commands.map((command) => automaticRecord(1, command, at)),
    ]);
    return ok(this.links(input.gameId, input.origin, seats, tokens), true);
  }

  async importSave(input: ImportRequestInput): Promise<CoreResult<ImportGameResponse>> {
    if (this.storage.readMeta()) return fail(409, "GAME_EXISTS", "This game already exists.");
    const body = input.body;
    if (!isRecord(body) || typeof body.saveText !== "string") return fail(400, "BAD_REQUEST", "saveText must be the .joco file's text.");
    if (new TextEncoder().encode(body.saveText).length > this.limits.maxImportBytes) {
      return fail(413, "PAYLOAD_TOO_LARGE", `A save may be at most ${this.limits.maxImportBytes} bytes.`);
    }

    let state: GameState;
    try {
      state = deserializeSave(body.saveText).state;
    } catch (error) {
      const message = error instanceof SaveValidationError ? error.message : "The file is not a John Company save.";
      return fail(400, "INVALID_SAVE", message);
    }
    if (state.mode !== "hotseat") return fail(400, "INVALID_SAVE", "Only hotseat games (3-6 players, no Crown) can be played online.");
    const humans = state.seatingOrder.filter((playerId) => state.players[playerId] && !state.players[playerId].isCrown);
    if (humans.length < this.limits.minPlayers || humans.length > this.limits.maxPlayers) {
      return fail(400, "INVALID_SAVE", `An online game needs ${this.limits.minPlayers}-${this.limits.maxPlayers} players.`);
    }
    const creatorId = body.creatorPlayerId ?? humans[0];
    if (typeof creatorId !== "string" || !humans.includes(creatorId)) {
      return fail(400, "BAD_REQUEST", "creatorPlayerId must be one of the save's players.");
    }

    // Whoever had the file knows its random seed; a fresh one keeps future dice unpredictable.
    const at = this.timestamp();
    state = this.reseeded(state);
    const automatic = runAutomaticSteps(state, { now: at, idPrefix: "import-auto" });
    state = automatic.state;

    const { seats, tokens } = await this.issueSeats(state, creatorId);
    if (this.storage.readMeta()) return fail(409, "GAME_EXISTS", "This game already exists.");

    this.storeNewRoom(input.gameId, "imported", state, seats, [
      { version: 1, seatId: null, kind: "import", at, payload: { fileGameId: state.gameId, turn: state.turn, phase: state.phase } },
      ...automatic.commands.map((command) => automaticRecord(1, command, at)),
    ]);
    return ok(this.links(input.gameId, input.origin, seats, tokens), true);
  }

  private async issueSeats(state: GameState, creatorId: PlayerId) {
    const tokens = new Map<string, string>();
    const seats: SeatRecord[] = [];
    for (const playerId of state.seatingOrder) {
      const player = state.players[playerId];
      if (!player || player.isCrown) continue;
      const token = newToken(this.random);
      const id = `seat:${playerId}`;
      tokens.set(id, token);
      seats.push({ id, role: "seat", playerId, name: player.name, tokenHash: await sha256Hex(token), creator: playerId === creatorId });
    }
    const watchToken = newToken(this.random);
    tokens.set("spectator", watchToken);
    seats.push({ id: "spectator", role: "spectator", tokenHash: await sha256Hex(watchToken), creator: false });
    return { seats, tokens };
  }

  private storeNewRoom(gameId: string, source: RoomMeta["source"], state: GameState, seats: SeatRecord[], records: CommandRecord[]) {
    const meta: RoomMeta = { gameId, createdAt: this.timestamp(), source, version: 1, history: [], recentCommands: [] };
    this.storage.transaction(() => {
      for (const seat of seats) this.storage.writeSeat(seat);
      this.storage.writeSnapshot(1, state);
      this.storage.appendCommands(records);
      this.storage.writeMeta(meta);
    });
    this.cache = { version: 1, state };
    this.seatCache = seats;
  }

  private links(gameId: string, origin: string, seats: SeatRecord[], tokens: Map<string, string>): CreateGameResponse {
    const base = `${origin}${ONLINE_PAGE_PATH}?game=${encodeURIComponent(gameId)}`;
    const seatLinks: SeatLink[] = seats
      .filter((seat) => seat.role === "seat")
      .map((seat) => ({
        playerId: seat.playerId as PlayerId,
        name: seat.name ?? "",
        url: `${base}#seat=${tokens.get(seat.id)}`,
        ...(seat.creator ? { creator: true } : {}),
      }));
    return { gameId, seats: seatLinks, spectatorUrl: `${base}#watch=${tokens.get("spectator")}` };
  }

  // --- who is asking -----------------------------------------------------------------------------

  exists(): boolean {
    return this.storage.readMeta() !== null;
  }

  /** The seat a link token belongs to, or undefined. Checks every seat in constant time. */
  async authenticate(token: unknown): Promise<SeatRecord | undefined> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return undefined;
    const hash = await sha256Hex(token);
    let match: SeatRecord | undefined;
    for (const seat of this.seats()) {
      if (constantTimeEqual(seat.tokenHash, hash)) match = seat;
    }
    return match;
  }

  seat(seatId: string): SeatRecord | undefined {
    return this.seats().find((seat) => seat.id === seatId);
  }

  private seats(): SeatRecord[] {
    this.seatCache ??= this.storage.readSeats();
    return this.seatCache;
  }

  private async withSeat<T>(token: unknown, run: (seat: SeatRecord) => CoreResult<T>): Promise<CoreResult<T>> {
    if (!this.exists()) return fail(404, "GAME_NOT_FOUND", "There is no game with this id.");
    const seat = await this.authenticate(token);
    if (!seat) return fail(401, "INVALID_TOKEN", "This link is not valid for this game.");
    return run(seat);
  }

  async join(token: unknown): Promise<CoreResult<JoinResponse>> {
    return this.withSeat(token, (seat) => {
      if (!seat.joinedAt) {
        const joined = { ...seat, joinedAt: this.timestamp() };
        this.storage.writeSeat(joined);
        this.seatCache = this.seats().map((candidate) => (candidate.id === seat.id ? joined : candidate));
      }
      const meta = this.meta();
      return ok({ gameId: meta.gameId, viewer: viewerOf(seat), ...(seat.name ? { playerName: seat.name } : {}) });
    });
  }

  // --- views ---------------------------------------------------------------------------------------

  async view(token: unknown): Promise<CoreResult<GameView>> {
    return this.withSeat(token, (seat) => {
      const limited = this.rateLimited(seat);
      return limited ?? ok(this.viewFor(seat));
    });
  }

  viewFor(seat: SeatRecord): GameView {
    const meta = this.meta();
    const state = this.current(meta);
    const viewer = viewerOf(seat);
    return {
      gameId: meta.gameId,
      viewer,
      version: meta.version,
      state: projectForViewer(state, viewer),
      undo: this.undoStatus(seat, meta, state),
      export: this.exportStatus(seat, state),
    };
  }

  /** The current version, for clients and the Durable Object's broadcasts. */
  version(): number {
    return this.meta().version;
  }

  // --- commands --------------------------------------------------------------------------------------

  async command(token: unknown, body: unknown): Promise<CoreResult<CommandResponse>> {
    return this.withSeat(token, (seat) => this.commandAs(seat, isRecord(body) ? body.command : undefined));
  }

  /** Applies a command from an authenticated seat. The actor always comes from the seat. */
  commandAs(seat: SeatRecord, input: unknown): CoreResult<CommandResponse> {
    if (seat.role !== "seat" || !seat.playerId) return fail(403, "SPECTATOR_READ_ONLY", "Spectators can watch but not act.");
    const limited = this.rateLimited(seat);
    if (limited) return limited;
    if (jsonBytes(input) > this.limits.maxRequestBytes) {
      return fail(413, "PAYLOAD_TOO_LARGE", `A command may be at most ${this.limits.maxRequestBytes} bytes.`);
    }
    const parsed = parseCommand(input);
    if (typeof parsed === "string") return fail(400, "BAD_REQUEST", parsed);

    const meta = this.meta();
    const state = this.current(meta);
    if (meta.recentCommands.includes(`${seat.id} ${parsed.id}`)) return ok({ ok: true, view: this.viewFor(seat) });

    const playerId = seat.playerId;
    const viewer: Viewer = { kind: "seat", playerId };
    const anytime = isAnytimeCommandType(parsed.type);
    // A multi-option "system" decision is answered by its named seat on the system's behalf.
    const actorId = !anytime && state.pendingDecision.actor === "system" && systemDecisionDelegate(state) === playerId ? "system" : playerId;
    const at = this.timestamp();
    const command: GameCommand = {
      id: parsed.id,
      gameId: state.gameId,
      actorId,
      decisionId: parsed.decisionId,
      type: parsed.type,
      payload: resolveHiddenIds(state, viewer, parsed.payload),
      clientTimestamp: at,
    };

    const result = applyCommand(state, command);
    if (!result.ok) {
      return ok({
        ok: false,
        errors: result.errors.map((error) => ({ code: error.code, message: error.message })),
        view: this.viewFor(seat),
      });
    }

    const automatic = runAutomaticSteps(result.state, { now: at, idPrefix: `${parsed.id}:auto` });
    const version = meta.version + 1;
    const history = [...meta.history, { seatId: seat.id, commandId: parsed.id, beforeVersion: meta.version, afterVersion: version }].slice(
      -this.limits.undoDepth,
    );
    this.commit(meta, automatic.state, { history, recent: `${seat.id} ${parsed.id}` }, [
      { version, seatId: seat.id, kind: "command", commandId: command.id, type: command.type, actorId: command.actorId, payload: command.payload, at },
      ...automatic.commands.map((step) => automaticRecord(version, step, at)),
    ]);
    if (automatic.errors) console.error("Automatic step rejected", JSON.stringify(automatic.errors));
    return ok({ ok: true, view: this.viewFor(seat) }, true);
  }

  // --- undo ------------------------------------------------------------------------------------------

  async undo(token: unknown): Promise<CoreResult<CommandResponse>> {
    return this.withSeat(token, (seat) => this.undoAs(seat));
  }

  /** Takes back the seat's own latest command, if nobody else has acted since and it was fair. */
  undoAs(seat: SeatRecord): CoreResult<CommandResponse> {
    if (seat.role !== "seat") return fail(403, "SPECTATOR_READ_ONLY", "Spectators can watch but not act.");
    const limited = this.rateLimited(seat);
    if (limited) return limited;

    const meta = this.meta();
    const state = this.current(meta);
    const status = this.undoStatus(seat, meta, state);
    const entry = meta.history.at(-1);
    const before = entry ? this.snapshot(entry.beforeVersion) : null;
    if (!status.available || !entry || !before) {
      return ok({
        ok: false,
        errors: [{ code: "UNDO_UNAVAILABLE", message: status.reason ?? "Nothing to undo." }],
        view: this.viewFor(seat),
      });
    }

    // undoBlockReason guarantees no dice since `before`; keep the live generator, which may have
    // been reseeded since (after an export), so the old seed never comes back.
    const restored: GameState = { ...before, rng: state.rng };
    const version = meta.version + 1;
    const at = this.timestamp();
    const recent = meta.recentCommands.filter((key) => key !== `${seat.id} ${entry.commandId}`);
    this.commit({ ...meta, recentCommands: recent }, restored, { history: meta.history.slice(0, -1) }, [
      { version, seatId: seat.id, kind: "undo", commandId: entry.commandId, at },
    ]);
    return ok({ ok: true, view: this.viewFor(seat) }, true);
  }

  private undoStatus(seat: SeatRecord, meta: RoomMeta, state: GameState): GameView["undo"] {
    if (seat.role !== "seat") return { available: false, reason: "Spectators can't undo." };
    const entry = meta.history.at(-1);
    if (!entry) return { available: false, reason: "There is nothing to undo." };
    if (entry.seatId !== seat.id) {
      const mine = meta.history.some((candidate) => candidate.seatId === seat.id);
      return { available: false, reason: mine ? "Another player has acted since your last move." : "You have nothing to undo." };
    }
    if (entry.afterVersion !== meta.version) return { available: false, reason: "The game has changed since your last move." };
    const before = this.snapshot(entry.beforeVersion);
    if (!before) return { available: false, reason: "That move is too far back to undo." };
    const blocked = undoBlockReason(before, state) ?? this.newlySeenCard(before, state);
    return blocked ? { available: false, reason: blocked } : { available: true };
  }

  /** Online only: nobody may take back a move after which a seat could identify a new face-down card. */
  private newlySeenCard(before: GameState, after: GameState): string | undefined {
    for (const seat of this.seats()) {
      if (seat.role !== "seat") continue;
      const viewer = viewerOf(seat);
      const known = identifiableFaceDownCards(before, viewer);
      if ([...identifiableFaceDownCards(after, viewer)].some((cardId) => !known.has(cardId))) {
        return "Someone has seen a face-down card since.";
      }
    }
    return undefined;
  }

  // --- export ----------------------------------------------------------------------------------------

  async exportSave(token: unknown): Promise<CoreResult<ExportedSave>> {
    return this.withSeat(token, (seat) => this.exportAs(seat));
  }

  exportAs(seat: SeatRecord): CoreResult<ExportedSave> {
    const limited = this.rateLimited(seat);
    if (limited) return limited;
    const meta = this.meta();
    const state = this.current(meta);
    const status = this.exportStatus(seat, state);
    if (!status.available) return fail(403, "EXPORT_NOT_ALLOWED", status.reason ?? "You may not download this game yet.");

    const at = this.timestamp();
    const text = serializeSave(state, { saveId: `online-${meta.gameId}-v${meta.version}`, parentSaveId: null, now: at });
    const ended = state.finalScoring.complete === true;
    if (!ended) {
      // The file holds the random seed. Reseed the live game so the file can't predict its dice.
      const reseeded = this.reseeded(state);
      this.storage.writeSnapshot(meta.version, reseeded);
      this.cache = { version: meta.version, state: reseeded };
    }
    const filename = `${state.scenario}-t${state.turn}-${state.phase}${ended ? "-final" : ""}.joco`;
    return ok({ filename, text });
  }

  private exportStatus(seat: SeatRecord, state: GameState): NonNullable<GameView["export"]> {
    if (state.finalScoring.complete === true) return { available: true };
    if (seat.creator) return { available: true };
    return { available: false, reason: "Only the game's creator can download it before the game ends." };
  }

  // --- internals -------------------------------------------------------------------------------------

  private meta(): RoomMeta {
    const meta = this.storage.readMeta();
    if (!meta) throw new Error("The game room has no game.");
    return meta;
  }

  private current(meta: RoomMeta): GameState {
    if (this.cache?.version === meta.version) return this.cache.state;
    const state = this.storage.readSnapshot(meta.version);
    if (!state) throw new Error(`Snapshot ${meta.version} is missing.`);
    this.cache = { version: meta.version, state };
    return state;
  }

  private snapshot(version: number): GameState | null {
    if (this.cache?.version === version) return this.cache.state;
    if (this.beforeCache?.version === version) return this.beforeCache.state;
    const state = this.storage.readSnapshot(version);
    if (state) this.beforeCache = { version, state };
    return state;
  }

  /** Stores a new current state as the next version, with its history and audit records. */
  private commit(meta: RoomMeta, state: GameState, change: { history: HistoryEntry[]; recent?: string }, records: CommandRecord[]) {
    const version = meta.version + 1;
    const recentCommands = change.recent ? [...meta.recentCommands, change.recent].slice(-50) : meta.recentCommands;
    const next: RoomMeta = { ...meta, version, history: change.history, recentCommands };
    const keep = [version, ...change.history.map((entry) => entry.beforeVersion)];
    this.storage.transaction(() => {
      this.storage.writeSnapshot(version, state);
      this.storage.appendCommands(records);
      this.storage.writeMeta(next);
      this.storage.pruneSnapshots(keep);
    });
    this.cache = { version, state };
  }

  private rateLimited(seat: SeatRecord): { ok: false; status: number; error: CoreError } | undefined {
    const now = this.now().getTime();
    const bucket = this.buckets.get(seat.id) ?? { tokens: this.limits.rateBurst, at: now };
    const tokens = Math.min(this.limits.rateBurst, bucket.tokens + ((now - bucket.at) / 1000) * this.limits.ratePerSecond);
    if (tokens < 1) {
      this.buckets.set(seat.id, { tokens, at: now });
      return fail(429, "RATE_LIMITED", "Too many requests from this seat; wait a moment.");
    }
    this.buckets.set(seat.id, { tokens: tokens - 1, at: now });
    return undefined;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private newSeed(): string {
    return [...this.random(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** The same game with a fresh, unpredictable random generator (same roll count). */
  private reseeded(state: GameState): GameState {
    return { ...state, rng: { ...createRngState(this.newSeed()), counter: state.rng.counter } };
  }
}

function automaticRecord(version: number, command: GameCommand, at: string): CommandRecord {
  return { version, seatId: null, kind: "automatic", commandId: command.id, type: command.type, actorId: "system", payload: command.payload, at };
}
