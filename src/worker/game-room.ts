// One online game: a SQLite-backed Durable Object wrapping GameRoomCore (game-room-core.ts).
// The Worker (index.ts) calls its RPC methods for HTTP requests and forwards WebSocket upgrades to
// fetch(). WebSockets use the hibernation API, so an idle game costs nothing while players stay
// connected.

import { DurableObject } from "cloudflare:workers";
import { ONLINE_LIMITS, type ChatMessage, type ClientMessage, type ServerMessage, type Viewer } from "../online/protocol";
import type { GameState } from "../engine";
import {
  GameRoomCore,
  type CommandRecord,
  type CoreResult,
  type CreateRequestInput,
  type ImportRequestInput,
  type RoomMeta,
  type RoomStorage,
  type SeatRecord,
  viewerOf,
} from "./game-room-core";

/** Snapshot JSON is split into rows of at most this many characters (SQLite values max 2 MB). */
const SNAPSHOT_CHUNK_CHARS = 500_000;
/** A socket that hasn't said hello by then is closed. */
const HELLO_TIMEOUT_MS = 30_000;

/** Kept on each socket across hibernation (serializeAttachment; at most 16 KB). */
/** `viewer` is who the socket belongs to; `seatId` finds the seat again after hibernation. */
type SocketAttachment = { seatId?: string; viewer?: Viewer; connectedAt: number };

type SeatRow = {
  id: string;
  role: string;
  player_id: string | null;
  name: string | null;
  token_hash: string;
  creator: number;
  joined_at: string | null;
};

/** RoomStorage on the Durable Object's SQLite database: tables meta, seats, snapshots, commands, chat. */
export class SqlRoomStorage implements RoomStorage {
  constructor(
    private readonly sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS seats (
        id TEXT PRIMARY KEY, role TEXT NOT NULL, player_id TEXT, name TEXT,
        token_hash TEXT NOT NULL UNIQUE, creator INTEGER NOT NULL DEFAULT 0, joined_at TEXT)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshots (
        version INTEGER NOT NULL, chunk INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (version, chunk))`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS commands (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, seat_id TEXT, kind TEXT NOT NULL,
        command_id TEXT, type TEXT, actor_id TEXT, payload TEXT, created_at TEXT NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, player_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL)`,
    );
  }

  readMeta(): RoomMeta | null {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'room'`).toArray()[0];
    return row ? (JSON.parse(row.value) as RoomMeta) : null;
  }

  writeMeta(meta: RoomMeta): void {
    this.sql.exec(
      `INSERT INTO meta (key, value) VALUES ('room', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(meta),
    );
  }

  readSeats(): SeatRecord[] {
    return this.sql.exec<SeatRow>(`SELECT * FROM seats ORDER BY rowid`).toArray().map((row) => ({
      id: row.id,
      role: row.role === "seat" ? "seat" : "spectator",
      ...(row.player_id ? { playerId: row.player_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      tokenHash: row.token_hash,
      creator: row.creator === 1,
      ...(row.joined_at ? { joinedAt: row.joined_at } : {}),
    }));
  }

  writeSeat(seat: SeatRecord): void {
    this.sql.exec(
      `INSERT INTO seats (id, role, player_id, name, token_hash, creator, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET role = excluded.role, player_id = excluded.player_id, name = excluded.name,
         token_hash = excluded.token_hash, creator = excluded.creator, joined_at = excluded.joined_at`,
      seat.id,
      seat.role,
      seat.playerId ?? null,
      seat.name ?? null,
      seat.tokenHash,
      seat.creator ? 1 : 0,
      seat.joinedAt ?? null,
    );
  }

  readSnapshot(version: number): GameState | null {
    const rows = this.sql.exec<{ data: string }>(`SELECT data FROM snapshots WHERE version = ? ORDER BY chunk`, version).toArray();
    return rows.length === 0 ? null : (JSON.parse(rows.map((row) => row.data).join("")) as GameState);
  }

  writeSnapshot(version: number, state: GameState): void {
    const json = JSON.stringify(state);
    this.sql.exec(`DELETE FROM snapshots WHERE version = ?`, version);
    for (let chunk = 0; chunk * SNAPSHOT_CHUNK_CHARS < json.length; chunk += 1) {
      const data = json.slice(chunk * SNAPSHOT_CHUNK_CHARS, (chunk + 1) * SNAPSHOT_CHUNK_CHARS);
      this.sql.exec(`INSERT INTO snapshots (version, chunk, data) VALUES (?, ?, ?)`, version, chunk, data);
    }
  }

  pruneSnapshots(keep: number[]): void {
    const versions = [...new Set(keep)];
    if (versions.length === 0) {
      this.sql.exec(`DELETE FROM snapshots`);
      return;
    }
    this.sql.exec(`DELETE FROM snapshots WHERE version NOT IN (${versions.map(() => "?").join(", ")})`, ...versions);
  }

  appendCommands(records: CommandRecord[]): void {
    for (const record of records) {
      this.sql.exec(
        `INSERT INTO commands (version, seat_id, kind, command_id, type, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        record.version,
        record.seatId,
        record.kind,
        record.commandId ?? null,
        record.type ?? null,
        record.actorId ?? null,
        record.payload === undefined ? null : JSON.stringify(record.payload),
        record.at,
      );
    }
  }

  readChat(limit: number): ChatMessage[] {
    return this.sql
      .exec<{ id: number; created_at: string; player_id: string; name: string; text: string }>(
        `SELECT id, created_at, player_id, name, text FROM chat ORDER BY id DESC LIMIT ?`,
        limit,
      )
      .toArray()
      .reverse()
      .map((row) => ({ id: row.id, at: row.created_at, playerId: row.player_id, name: row.name, text: row.text }));
  }

  appendChat(message: Omit<ChatMessage, "id">): ChatMessage {
    const row = this.sql
      .exec<{ id: number }>(
        `INSERT INTO chat (created_at, player_id, name, text) VALUES (?, ?, ?, ?) RETURNING id`,
        message.at,
        message.playerId,
        message.name,
        message.text,
      )
      .one();
    return { id: row.id, ...message };
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
}

export class GameRoom extends DurableObject<Env> {
  private readonly core: GameRoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new GameRoomCore(new SqlRoomStorage(ctx.storage.sql, ctx.storage));
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(`{"type":"ping"}`, `{"type":"pong"}`));
  }

  // --- RPC, called by the Worker ---------------------------------------------------------------

  async create(input: CreateRequestInput) {
    return this.core.create(input);
  }

  async importSave(input: ImportRequestInput) {
    return this.core.importSave(input);
  }

  async join(token: string) {
    return this.core.join(token);
  }

  async view(token: string) {
    return this.core.view(token);
  }

  async command(token: string, body: unknown) {
    return this.afterChange(await this.core.command(token, body));
  }

  async undo(token: string) {
    return this.afterChange(await this.core.undo(token));
  }

  async exportSave(token: string) {
    return this.core.exportSave(token);
  }

  async chat(token: string, body: unknown) {
    const result = await this.core.chat(token, body);
    if (result.ok) this.broadcastChat(result.body.message);
    return result;
  }

  private afterChange<T>(result: CoreResult<T>): CoreResult<T> {
    if (result.ok && result.changed) this.broadcast();
    return result;
  }

  // --- WebSockets --------------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: { code: "BAD_REQUEST", message: "Expected a WebSocket upgrade." } }, { status: 426 });
    }
    if (!this.core.exists()) {
      return Response.json({ error: { code: "GAME_NOT_FOUND", message: "There is no game with this id." } }, { status: 404 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() } satisfies SocketAttachment);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + HELLO_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (new TextEncoder().encode(text).length > ONLINE_LIMITS.maxRequestBytes) {
      return send(ws, { type: "error", code: "PAYLOAD_TOO_LARGE", message: `Messages may be at most ${ONLINE_LIMITS.maxRequestBytes} bytes.` });
    }
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(text) as ClientMessage;
    } catch {
      return send(ws, { type: "error", code: "BAD_REQUEST", message: "Messages must be JSON." });
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return send(ws, { type: "error", code: "BAD_REQUEST", message: "Unknown message." });
    }

    const attachment = (ws.deserializeAttachment() ?? { connectedAt: 0 }) as SocketAttachment;
    const seat = attachment.seatId ? this.core.seat(attachment.seatId) : undefined;
    if (!seat) {
      if (parsed.type !== "hello") {
        send(ws, { type: "error", code: "HELLO_REQUIRED", message: 'The first message must be {"type":"hello","token":...}.' });
        return ws.close(1008, "hello required");
      }
      const authenticated = await this.core.authenticate(parsed.token);
      if (!authenticated) {
        send(ws, { type: "error", code: "INVALID_TOKEN", message: "This link is not valid for this game." });
        return ws.close(1008, "invalid token");
      }
      ws.serializeAttachment({ seatId: authenticated.id, viewer: viewerOf(authenticated), connectedAt: attachment.connectedAt } satisfies SocketAttachment);
      return send(ws, { type: "view", view: this.core.viewFor(authenticated) });
    }

    switch (parsed.type) {
      case "hello":
        return send(ws, { type: "view", view: this.core.viewFor(seat) });
      case "ping":
        return send(ws, { type: "pong" });
      case "command":
      case "undo": {
        const commandId = parsed.type === "command" && typeof parsed.command?.id === "string" ? parsed.command.id : undefined;
        const result = parsed.type === "command" ? this.core.commandAs(seat, parsed.command) : this.core.undoAs(seat);
        if (!result.ok) return send(ws, { type: "rejected", ...(commandId ? { commandId } : {}), errors: [result.error] });
        if (!result.body.ok) {
          send(ws, { type: "rejected", ...(commandId ? { commandId } : {}), errors: result.body.errors });
          return send(ws, { type: "view", view: result.body.view });
        }
        if (result.changed) return this.broadcast();
        return send(ws, { type: "view", view: result.body.view });
      }
      case "chat": {
        const result = this.core.chatAs(seat, parsed.text);
        if (!result.ok) return send(ws, { type: "rejected", errors: [result.error] });
        return this.broadcastChat(result.body.message);
      }
      default:
        return send(ws, { type: "error", code: "BAD_REQUEST", message: "Unknown message type." });
    }
  }

  async webSocketClose(): Promise<void> {
    // The runtime answers the close frame itself (compatibility date 2026-04-07 and later).
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.warn("WebSocket error", String(error));
  }

  /** Closes sockets that never said hello. */
  async alarm(): Promise<void> {
    const cutoff = Date.now() - HELLO_TIMEOUT_MS;
    let waiting = false;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.seatId) continue;
      if ((attachment?.connectedAt ?? 0) <= cutoff) {
        try {
          send(ws, { type: "error", code: "HELLO_REQUIRED", message: "No hello received in time." });
          ws.close(1008, "hello timeout");
        } catch {
          // Already closed.
        }
      } else {
        waiting = true;
      }
    }
    if (waiting) await this.ctx.storage.setAlarm(Date.now() + HELLO_TIMEOUT_MS);
  }

  /** Sends a new table-talk message to every viewer that has said hello. Everyone sees the same text. */
  private broadcastChat(message: ChatMessage): void {
    const text = JSON.stringify({ type: "chat", message } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.seatId) sendText(ws, text);
    }
  }

  /** Sends every connected viewer its own projected view of the current state. */
  private broadcast(): void {
    const messages = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      const seat = attachment?.seatId ? this.core.seat(attachment.seatId) : undefined;
      if (!seat) continue;
      let message = messages.get(seat.id);
      if (!message) {
        message = JSON.stringify({ type: "view", view: this.core.viewFor(seat) } satisfies ServerMessage);
        messages.set(seat.id, message);
      }
      try {
        ws.send(message);
      } catch {
        // The socket closed meanwhile; the runtime drops it.
      }
    }
  }
}

function sendText(ws: WebSocket, text: string): void {
  try {
    ws.send(text);
  } catch {
    // The socket closed meanwhile; the runtime drops it.
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Closed.
  }
}
