// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HIDDEN_BLACKMAIL_CARD_ID,
  isAutomaticDecision,
  projectForViewer,
  type GameState,
  type LegalCommand,
  type PlayerId,
  undoBlockReason,
} from "../../engine";
import type { CommandResponse, CreateGameResponse, GameView } from "../../online/protocol";
import { deserializeSave, serializeSave } from "../../save";
import { GameRoomCore, MemoryRoomStorage, sha256Hex, type CoreResult, type RoomOptions } from "../../worker/game-room-core";
import { BLUE, negotiationGame, RED, withBlackmail } from "../fixtures/negotiation";

const ORIGIN = "https://jc.example";
const PLAYERS = [{ name: "Ann" }, { name: "Ben", color: "blue" }, { name: "Cat" }];

class Clock {
  time = Date.parse("2026-10-25T12:00:00.000Z");
  now = () => new Date(this.time);
  advance(seconds: number) {
    this.time += seconds * 1000;
  }
}

/** Deterministic "random" bytes so tests are repeatable. */
function counterRandom() {
  let counter = 0;
  return (length: number) => Uint8Array.from({ length }, () => (counter += 37) % 256);
}

function body<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.status} ${result.error.code}: ${result.error.message}`);
  return result.body;
}

function tokenOf(url: string): string {
  return url.split("#")[1].split("=")[1];
}

type Table = {
  core: GameRoomCore;
  storage: MemoryRoomStorage;
  clock: Clock;
  created: CreateGameResponse;
  tokens: Record<PlayerId, string>;
  watch: string;
};

async function newTable(options: { body?: unknown; limits?: RoomOptions["limits"] } = {}): Promise<Table> {
  const storage = new MemoryRoomStorage();
  const clock = new Clock();
  const core = new GameRoomCore(storage, { now: clock.now, random: counterRandom(), limits: options.limits });
  const created = body(await core.create({ gameId: "game-abc", origin: ORIGIN, body: options.body ?? { scenario: "1710", players: PLAYERS } }));
  return {
    core,
    storage,
    clock,
    created,
    tokens: Object.fromEntries(created.seats.map((seat) => [seat.playerId, tokenOf(seat.url)])),
    watch: tokenOf(created.spectatorUrl),
  };
}

async function views(table: Table): Promise<Record<PlayerId, GameView>> {
  const entries = await Promise.all(Object.entries(table.tokens).map(async ([playerId, token]) => [playerId, body(await table.core.view(token))] as const));
  return Object.fromEntries(entries);
}

/** The seat whose view offers legal commands: the one who must act. Exactly one, always. */
async function actingSeat(table: Table): Promise<{ playerId: PlayerId; view: GameView }> {
  const all = await views(table);
  const acting = Object.entries(all).filter(([, view]) => view.state.pendingDecision.legalCommands.length > 0);
  expect(acting).toHaveLength(1);
  return { playerId: acting[0][0], view: acting[0][1] };
}

let commandCounter = 0;
async function send(table: Table, playerId: PlayerId, view: GameView, legal: LegalCommand): Promise<CommandResponse> {
  commandCounter += 1;
  return body(
    await table.core.command(table.tokens[playerId], {
      command: { id: `cmd-${commandCounter}`, decisionId: view.state.pendingDecision.id, type: legal.type, payload: legal.payload ?? {} },
    }),
  );
}

/** Plays the first legal option for whoever must act, `moves` times, the way a client would. */
async function play(table: Table, moves: number, until?: (before: GameState, after: GameState) => boolean) {
  for (let move = 0; move < moves; move += 1) {
    const { playerId, view } = await actingSeat(table);
    const before = currentState(table);
    table.clock.advance(5);
    const response = await send(table, playerId, view, view.state.pendingDecision.legalCommands[0]);
    expect(response.ok, JSON.stringify(response.ok ? "" : response.errors)).toBe(true);
    if (until?.(before, currentState(table))) return { playerId, before };
  }
  return undefined;
}

function currentState(table: Table): GameState {
  const meta = table.storage.meta!;
  return JSON.parse(table.storage.snapshots.get(meta.version)!) as GameState;
}

describe("creating a game", () => {
  it("issues 128-bit seat and spectator tokens and stores only their hashes", async () => {
    const table = await newTable();
    expect(table.created.gameId).toBe("game-abc");
    expect(table.created.seats.map((seat) => seat.name)).toEqual(["Ann", "Ben", "Cat"]);
    expect(table.created.seats[0].creator).toBe(true);
    expect(table.created.seats[1].creator).toBeUndefined();
    expect(table.created.seats[0].url).toMatch(/^https:\/\/jc\.example\/online\/\?game=game-abc#seat=[A-Za-z0-9_-]{22}$/);
    expect(table.created.spectatorUrl).toMatch(/#watch=[A-Za-z0-9_-]{22}$/);

    const tokens = [...Object.values(table.tokens), table.watch];
    expect(new Set(tokens).size).toBe(4);
    const stored = JSON.stringify([...table.storage.seats.values()]);
    for (const token of tokens) {
      expect(stored).not.toContain(token);
      expect(stored).toContain(await sha256Hex(token));
    }
    expect(JSON.stringify(table.storage.commands)).not.toContain(tokens[0]);
  });

  it("starts the game with a fresh random seed and the first decision ready", async () => {
    const table = await newTable();
    const state = currentState(table);
    expect(state.mode).toBe("hotseat");
    expect(state.rng.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(isAutomaticDecision(state.pendingDecision)).toBe(false);
    expect(Object.keys(state.players)).toEqual(["player-1", "player-2", "player-3"]);
    expect(state.players["player-2"].color).toBe("blue");
  });

  it("refuses bad requests and a second create", async () => {
    const core = new GameRoomCore(new MemoryRoomStorage());
    const attempt = (requestBody: unknown) => core.create({ gameId: "g", origin: ORIGIN, body: requestBody });
    for (const bad of [
      { scenario: "1710", players: [] },
      { scenario: "1710", players: [...PLAYERS, ...PLAYERS.map((player) => ({ ...player, name: `${player.name}2` })), { name: "Dee" }, { name: "Eve" }] },
      { scenario: "1999", players: PLAYERS },
      { scenario: "1710", players: [{ name: "Ann" }, { name: "ann" }, { name: "Cat" }] },
      { scenario: "1710", players: [{ name: "" }, { name: "Ben" }, { name: "Cat" }] },
      { scenario: "1710", players: [{ name: "Ann", color: "url(x)" }, { name: "Ben" }, { name: "Cat" }] },
      { scenario: "1710", players: PLAYERS, creatorIndex: 5 },
      "nonsense",
    ]) {
      const result = await attempt(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
    expect((await attempt({ scenario: "1710", players: PLAYERS })).ok).toBe(true);
    const again = await attempt({ scenario: "1710", players: PLAYERS });
    expect(again.ok ? 200 : again.status).toBe(409);
  });
});

describe("joining and viewing", () => {
  it("knows each link's role and rejects unknown tokens", async () => {
    const table = await newTable();
    expect(body(await table.core.join(table.tokens["player-2"]))).toEqual({ gameId: "game-abc", viewer: { kind: "seat", playerId: "player-2" }, playerName: "Ben" });
    expect(body(await table.core.join(table.watch))).toEqual({ gameId: "game-abc", viewer: { kind: "spectator" } });
    expect(table.storage.seats.get("seat:player-2")?.joinedAt).toBeDefined();

    for (const bad of ["", "short", "A".repeat(22), 42, undefined, table.tokens["player-1"] + "x"]) {
      const result = await table.core.view(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_TOKEN");
    }
    const missing = await new GameRoomCore(new MemoryRoomStorage()).view(table.watch);
    expect(missing.ok ? 200 : missing.status).toBe(404);
  });

  it("projects the state for each viewer", async () => {
    const table = await newTable();
    const state = currentState(table);
    for (const [playerId, view] of Object.entries(await views(table))) {
      expect(view.viewer).toEqual({ kind: "seat", playerId });
      expect(view.version).toBe(1);
      expect(view.state).toEqual(projectForViewer(state, { kind: "seat", playerId }));
      expect(view.state.rng.seed).toBe("");
    }
    const spectator = body(await table.core.view(table.watch));
    expect(spectator.viewer).toEqual({ kind: "spectator" });
    expect(spectator.state.pendingDecision.legalCommands).toEqual([]);
    expect(spectator.undo.available).toBe(false);
  });
});

describe("commands", () => {
  it("takes the actor from the token, never from the client", async () => {
    const table = await newTable();
    const { playerId, view } = await actingSeat(table);
    const other = Object.keys(table.tokens).find((id) => id !== playerId)!;
    const legal = view.state.pendingDecision.legalCommands[0];

    // Another seat replays the actor's command, even claiming to be the actor: rejected.
    const forged = body(
      await table.core.command(table.tokens[other], {
        command: { id: "forged", decisionId: view.state.pendingDecision.id, type: legal.type, payload: legal.payload, actorId: playerId },
      }),
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.errors.map((error) => error.code)).toContain("ACTOR_NOT_ALLOWED");
    expect(table.storage.meta?.version).toBe(1);

    // A spectator can't act at all.
    const spectator = await table.core.command(table.watch, { command: { id: "watcher", decisionId: view.state.pendingDecision.id, type: legal.type, payload: legal.payload } });
    expect(spectator.ok ? 200 : spectator.status).toBe(403);

    const response = await send(table, playerId, view, legal);
    expect(response.ok).toBe(true);
    expect(response.view.version).toBe(2);
    expect(table.storage.commands.at(-1)?.actorId ?? table.storage.commands.find((record) => record.kind === "command")?.actorId).toBeDefined();
    expect(table.storage.commands.find((record) => record.kind === "command")).toMatchObject({ seatId: `seat:${playerId}`, actorId: playerId });
  });

  it("rejects stale and malformed commands without changing the game", async () => {
    const table = await newTable();
    const { playerId, view } = await actingSeat(table);
    const legal = view.state.pendingDecision.legalCommands[0];
    const stale = body(await table.core.command(table.tokens[playerId], { command: { id: "stale", decisionId: "decision-old", type: legal.type, payload: legal.payload } }));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.errors[0].code).toBe("DECISION_ID_MISMATCH");

    const malformed = await table.core.command(table.tokens[playerId], { command: { decisionId: 3 } });
    expect(malformed.ok ? 200 : malformed.status).toBe(400);
    const huge = await table.core.command(table.tokens[playerId], { command: { id: "huge", decisionId: "x", type: legal.type, payload: { blob: "x".repeat(40_000) } } });
    expect(huge.ok ? 200 : huge.status).toBe(413);
    expect(table.storage.meta?.version).toBe(1);
  });

  it("applies a retried command only once", async () => {
    const table = await newTable();
    const { playerId, view } = await actingSeat(table);
    const legal = view.state.pendingDecision.legalCommands[0];
    const command = { id: "retry-me", decisionId: view.state.pendingDecision.id, type: legal.type, payload: legal.payload };
    expect(body(await table.core.command(table.tokens[playerId], { command })).ok).toBe(true);
    const again = body(await table.core.command(table.tokens[playerId], { command }));
    expect(again.ok).toBe(true);
    expect(again.view.version).toBe(2);
  });

  it("serialises two commands arriving at once", async () => {
    const table = await newTable();
    const { playerId, view } = await actingSeat(table);
    const legal = view.state.pendingDecision.legalCommands[0];
    const make = (id: string) => table.core.command(table.tokens[playerId], { command: { id, decisionId: view.state.pendingDecision.id, type: legal.type, payload: legal.payload } });
    const [first, second] = (await Promise.all([make("twin-1"), make("twin-2")])).map(body);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(table.storage.meta?.version).toBe(2);
  });

  it("lets any seat act at any time with negotiation commands, as itself", async () => {
    const table = await newTable();
    await play(table, 1);
    const { playerId } = await actingSeat(table);
    const giver = Object.keys(table.tokens).find((id) => id !== playerId)!;
    const cash = currentState(table).players[giver].cash;
    expect(cash).toBeGreaterThan(0);

    const response = body(
      await table.core.command(table.tokens[giver], {
        command: { id: "gift", decisionId: "anytime", type: "negotiation.give", payload: { to: playerId, items: [{ kind: "cash", amount: 1 }] } },
      }),
    );
    expect(response.ok).toBe(true);
    expect(currentState(table).players[giver].cash).toBe(cash - 1);
    expect(currentState(table).log.at(-1)).toMatchObject({ type: "negotiation.transfer", actor: giver });
  });

  it("plays automatic steps itself, so nobody is ever asked to press them", async () => {
    const table = await newTable();
    for (let move = 0; move < 300 && !table.storage.commands.some((record) => record.kind === "automatic"); move += 1) {
      await play(table, 1);
      expect(isAutomaticDecision(currentState(table).pendingDecision)).toBe(false);
    }
    expect(table.storage.commands.some((record) => record.kind === "automatic")).toBe(true);
  });

  it("rate-limits each seat", async () => {
    const table = await newTable({ limits: { rateBurst: 5, ratePerSecond: 1 } });
    const token = table.tokens["player-1"];
    const results = [];
    for (let index = 0; index < 7; index += 1) results.push(await table.core.view(token));
    expect(results.slice(0, 5).every((result) => result.ok)).toBe(true);
    expect(results[5].ok ? 200 : results[5].status).toBe(429);
    // Other seats have their own bucket, and time refills it.
    expect((await table.core.view(table.tokens["player-2"])).ok).toBe(true);
    table.clock.advance(3);
    expect((await table.core.view(token)).ok).toBe(true);
  });
});

describe("undo", () => {
  it("takes back your own latest command, until someone else acts", async () => {
    const table = await newTable();
    // Find a move that undo allows (no dice, draws or reveals).
    let playerId = "";
    let before = currentState(table);
    for (let move = 0; move < 50; move += 1) {
      const acting = await actingSeat(table);
      before = currentState(table);
      await send(table, acting.playerId, acting.view, acting.view.state.pendingDecision.legalCommands[0]);
      if (undoBlockReason(before, currentState(table)) === undefined) {
        playerId = acting.playerId;
        break;
      }
    }
    expect(playerId).not.toBe("");
    const versionAfterMove = table.storage.meta!.version;

    const mine = body(await table.core.view(table.tokens[playerId]));
    expect(mine.undo).toEqual({ available: true });
    const others = Object.keys(table.tokens).filter((id) => id !== playerId);
    for (const other of others) expect(body(await table.core.view(table.tokens[other])).undo.available).toBe(false);
    const refused = body(await table.core.undo(table.tokens[others[0]]));
    expect(refused.ok).toBe(false);

    const undone = body(await table.core.undo(table.tokens[playerId]));
    expect(undone.ok).toBe(true);
    expect(undone.view.version).toBe(versionAfterMove + 1);
    const restored = currentState(table);
    expect({ ...restored, rng: undefined }).toEqual({ ...before, rng: undefined });
    expect(restored.rng.counter).toBe(before.rng.counter);
  });

  it("is refused after another seat has acted", async () => {
    const table = await newTable();
    const first = await actingSeat(table);
    await send(table, first.playerId, first.view, first.view.state.pendingDecision.legalCommands[0]);
    const second = await actingSeat(table);
    const other = second.playerId === first.playerId ? Object.keys(table.tokens).find((id) => id !== first.playerId)! : second.playerId;
    if (second.playerId === first.playerId) {
      // Make another seat act with an anytime gift instead.
      body(await table.core.command(table.tokens[other], { command: { id: "gift", decisionId: "anytime", type: "negotiation.give", payload: { to: first.playerId, items: [{ kind: "cash", amount: 1 }] } } }));
    } else {
      await send(table, second.playerId, second.view, second.view.state.pendingDecision.legalCommands[0]);
    }
    const view = body(await table.core.view(table.tokens[first.playerId]));
    expect(view.undo.available).toBe(false);
    expect(view.undo.reason).toMatch(/another player/i);
    expect(body(await table.core.undo(table.tokens[first.playerId])).ok).toBe(false);
  });

  it("is refused after dice were rolled", async () => {
    const table = await newTable();
    const rolled = await play(table, 400, (before, after) => after.rng.counter !== before.rng.counter);
    expect(rolled).toBeDefined();
    const view = body(await table.core.view(table.tokens[rolled!.playerId]));
    expect(view.undo.available).toBe(false);
    expect(view.undo.reason).toMatch(/dice|shuffled|drawn/i);
    const response = body(await table.core.undo(table.tokens[rolled!.playerId]));
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.errors[0].code).toBe("UNDO_UNAVAILABLE");
  });

  it("is refused once someone could identify a face-down card they couldn't before", async () => {
    const start = withBlackmail(negotiationGame("family"), RED, "company-fraud", { instanceId: "blackmail-company-fraud" });
    const core = new GameRoomCore(new MemoryRoomStorage());
    const imported = body(await core.importSave({ gameId: "g", origin: ORIGIN, body: { saveText: serializeSave(start, { saveId: "u" }) } }));
    const red = tokenOf(imported.seats.find((seat) => seat.playerId === RED)!.url);
    const give = (id: string, items: unknown[]) =>
      core.command(red, { command: { id, decisionId: "anytime", type: "negotiation.give", payload: { to: BLUE, items } } });

    expect(body(await give("cash", [{ kind: "cash", amount: 1 }])).ok).toBe(true);
    expect(body(await core.view(red)).undo).toEqual({ available: true });
    expect(body(await core.undo(red)).ok).toBe(true);
    // The undone command's id may be used again.
    expect(body(await give("cash", [{ kind: "cash", amount: 1 }])).view.version).toBe(4);

    expect(body(await give("card", [{ kind: "blackmail", cardInstanceId: "blackmail-company-fraud" }])).ok).toBe(true);
    const view = body(await core.view(red));
    expect(view.undo.available).toBe(false);
    expect(view.undo.reason).toMatch(/face-down card/);
  });

  it("keeps only a short history of snapshots", async () => {
    const table = await newTable({ limits: { undoDepth: 3 } });
    await play(table, 12);
    expect(table.storage.snapshots.size).toBeLessThanOrEqual(4);
    expect(table.storage.meta?.history.length).toBeLessThanOrEqual(3);
    expect(table.storage.commands.filter((record) => record.kind === "command")).toHaveLength(12);
  });
});

describe("export and import", () => {
  it("lets only the creator export mid-game, and reseeds the live game afterwards", async () => {
    const table = await newTable();
    await play(table, 3);
    const refused = await table.core.exportSave(table.tokens["player-2"]);
    expect(refused.ok ? 200 : refused.status).toBe(403);
    expect(body(await table.core.view(table.tokens["player-2"])).export?.available).toBe(false);
    expect(body(await table.core.view(table.tokens["player-1"])).export?.available).toBe(true);
    const spectator = await table.core.exportSave(table.watch);
    expect(spectator.ok ? 200 : spectator.status).toBe(403);

    const before = currentState(table);
    const exported = body(await table.core.exportSave(table.tokens["player-1"]));
    expect(exported.filename).toMatch(/^1710-t\d+-[a-zA-Z]+\.joco$/);
    const saved = deserializeSave(exported.text).state;
    expect(saved).toEqual(before);
    const after = currentState(table);
    expect(after.rng.seed).not.toBe(before.rng.seed);
    expect(after.rng.counter).toBe(before.rng.counter);
    expect({ ...after, rng: undefined }).toEqual({ ...before, rng: undefined });
  });

  it("imports a .joco as a new online game with new links", async () => {
    const source = await newTable();
    await play(source, 5);
    const text = body(await source.core.exportSave(source.tokens["player-1"])).text;
    const original = deserializeSave(text).state;

    const storage = new MemoryRoomStorage();
    const core = new GameRoomCore(storage);
    const imported = body(await core.importSave({ gameId: "game-imported", origin: ORIGIN, body: { saveText: text, creatorPlayerId: "player-2" } }));
    expect(imported.gameId).toBe("game-imported");
    expect(imported.seats.map((seat) => seat.name)).toEqual(["Ann", "Ben", "Cat"]);
    expect(imported.seats.find((seat) => seat.creator)?.playerId).toBe("player-2");
    for (const seat of imported.seats) expect(Object.values(source.tokens)).not.toContain(tokenOf(seat.url));

    const state = JSON.parse(storage.snapshots.get(1)!) as GameState;
    expect({ ...state, rng: undefined }).toEqual({ ...original, rng: undefined });
    expect(state.rng.seed).not.toBe(original.rng.seed);

    // The imported game plays on.
    const view = body(await core.view(tokenOf(imported.seats[0].url)));
    expect(view.gameId).toBe("game-imported");
  });

  it("refuses broken, tampered, Crown and oversized saves", async () => {
    const core = new GameRoomCore(new MemoryRoomStorage(), { limits: { maxImportBytes: 200_000 } });
    const attempt = (saveText: unknown) => core.importSave({ gameId: "g", origin: ORIGIN, body: { saveText } });
    const good = serializeSave(negotiationGame("family"), { saveId: "s", now: "2026-10-25T12:00:00.000Z" });
    const tampered = good.replace('"cash":10', '"cash":99');
    expect(tampered).not.toBe(good);
    const { createNewGame } = await import("../../engine");
    const crown = serializeSave(createNewGame({ mode: "soloCrown", scenario: "1710", players: [{ name: "Solo", color: "red" }], seed: "x", now: "2026-10-25T12:00:00.000Z" }), { saveId: "c" });
    for (const [label, saveText, code] of [
      ["not json", "{", "INVALID_SAVE"],
      ["tampered", tampered, "INVALID_SAVE"],
      ["crown", crown, "INVALID_SAVE"],
      ["huge", "x".repeat(200_001), "PAYLOAD_TOO_LARGE"],
      ["missing", undefined, "BAD_REQUEST"],
    ] as const) {
      const result = await attempt(saveText);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.error.code, label).toBe(code);
    }
    expect((await attempt(good)).ok).toBe(true);
  });

  it("lets everyone export once the game is over", async () => {
    const base = negotiationGame("finalScoring");
    const ended: GameState = {
      ...base,
      finalScoring: { ...base.finalScoring, complete: true },
      pendingDecision: { ...base.pendingDecision, actor: "system", step: "finalScoring.complete", legalCommands: [] },
    };
    const core = new GameRoomCore(new MemoryRoomStorage());
    const imported = body(await core.importSave({ gameId: "g", origin: ORIGIN, body: { saveText: serializeSave(ended, { saveId: "e" }) } }));
    const watch = tokenOf(imported.spectatorUrl);
    for (const token of [...imported.seats.map((seat) => tokenOf(seat.url)), watch]) {
      expect(body(await core.exportSave(token)).filename).toMatch(/-final\.joco$/);
    }
  });
});

describe("table talk", () => {
  it("stores seats' messages, sends them with every view, and keeps spectators read-only", async () => {
    const table = await newTable({ limits: { chatHistory: 3 } });
    const [ann, ben] = table.created.seats.map((seat) => table.tokens[seat.playerId]);
    const first = body(await table.core.chat(ann, { text: "  Ben, back me for Chairman?\u0007  " }));
    expect(first.message).toMatchObject({ id: 1, name: "Ann", text: "Ben, back me for Chairman?" });
    body(await table.core.chat(ben, { text: "Only for £2." }));

    for (const token of [ann, ben, table.watch]) {
      expect(body(await table.core.view(token)).chat?.map((message) => message.text)).toEqual(["Ben, back me for Chairman?", "Only for £2."]);
    }
    const versionBefore = table.core.version();
    expect(versionBefore).toBe(body(await table.core.view(ann)).version);

    const spectator = await table.core.chat(table.watch, { text: "hi" });
    expect(spectator.ok ? 200 : spectator.status).toBe(403);
    for (const text of ["", "   ", 42, "x".repeat(501)]) expect((await table.core.chat(ann, { text })).ok).toBe(false);
    expect((await table.core.chat("not-a-token", { text: "hi" })).ok).toBe(false);

    // Only the newest messages ride along with views; the game itself never changes.
    body(await table.core.chat(ann, { text: "Deal." }));
    body(await table.core.chat(ben, { text: "Deal." }));
    expect(body(await table.core.view(ben)).chat?.map((message) => message.id)).toEqual([2, 3, 4]);
    expect(table.core.version()).toBe(versionBefore);

    // A restarted object reads them back from storage.
    const restarted = new GameRoomCore(table.storage, { now: table.clock.now, limits: { chatHistory: 3 } });
    expect(body(await restarted.view(ann)).chat?.map((message) => message.id)).toEqual([2, 3, 4]);
  });
});

describe("system decisions with a real choice", () => {
  it("are answered by the named seat on the system's behalf", async () => {
    const base = negotiationGame("revenue");
    const state: GameState = {
      ...base,
      company: { ...base.company, balance: 20, chairmanMarker: "player-blue" },
      parliament: { ...base.parliament, revenue: { stage: "dividends", fraudCandidates: [], scandalCandidates: [] } },
      pendingDecision: {
        id: "decision-revenue-dividends-turn-1",
        phase: "revenue",
        step: "revenue.chooseDividends",
        actor: "system",
        visibility: "public",
        prompt: "No Chairman is in office; choose Revenue dividends.",
        legalCommands: [
          { type: "revenue.chooseDividends", label: "Pay No Dividends", payload: { amountPerShare: 0 } },
          { type: "revenue.chooseDividends", label: "Pay 1 Dividend", payload: { amountPerShare: 1 } },
        ],
        canSave: true,
      },
    };
    const core = new GameRoomCore(new MemoryRoomStorage());
    const imported = body(await core.importSave({ gameId: "g", origin: ORIGIN, body: { saveText: serializeSave(state, { saveId: "d" }) } }));
    const token = (playerId: PlayerId) => tokenOf(imported.seats.find((seat) => seat.playerId === playerId)!.url);

    const blueView = body(await core.view(token("player-blue")));
    expect(blueView.state.pendingDecision.actor).toBe("player-blue");
    expect(blueView.state.pendingDecision.legalCommands).toHaveLength(2);
    expect(body(await core.view(token(RED))).state.pendingDecision.legalCommands).toEqual([]);

    const command = { id: "d1", decisionId: state.pendingDecision.id, type: "revenue.chooseDividends", payload: { amountPerShare: 0 } };
    const red = body(await core.command(token(RED), { command }));
    expect(red.ok).toBe(false);
    const blue = body(await core.command(token("player-blue"), { command }));
    expect(blue.ok, JSON.stringify(blue)).toBe(true);
  });

  it("never show another seat's face-down blackmail through the core", async () => {
    const table = await newTable();
    await play(table, 20);
    const state = currentState(table);
    const all = await views(table);
    for (const [playerId, view] of Object.entries(all)) {
      for (const [ownerId, player] of Object.entries(state.players)) {
        if (ownerId === playerId) continue;
        for (const card of player.blackmailCards.filter((candidate) => candidate.facedown !== false)) {
          expect(JSON.stringify(view)).not.toContain(card.cardId);
          expect(view.state.players[ownerId].blackmailCards.some((candidate) => candidate.cardId === HIDDEN_BLACKMAIL_CARD_ID)).toBe(true);
        }
      }
    }
  });
});
