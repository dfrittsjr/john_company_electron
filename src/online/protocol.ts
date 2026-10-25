// The contract between the online client (src/ui) and the server (src/worker).
// See docs/plans/online-multiplayer.md. Both sides import these types; change them in one place.

import type { GameCommand, GameState, PlayerId } from "../engine";
import type { ScenarioId } from "../data/types";

/** Who is looking at a game. Seat and spectator links carry a secret token in the URL fragment. */
export type Viewer = { kind: "seat"; playerId: PlayerId } | { kind: "spectator" };

/**
 * Online URLs. The token lives in the fragment so it never reaches server logs or Referer headers.
 *   seat:      /online/?game=<gameId>#seat=<token>
 *   spectator: /online/?game=<gameId>#watch=<token>
 */
export const ONLINE_PAGE_PATH = "/online/";

// ---------------------------------------------------------------------------------------------
// HTTP: every response is JSON. Authenticated routes take `Authorization: Bearer <token>`.

/**
 * Scenarios the app can play today, with the text the new-game screens show. 1758 and 1813 need
 * their own setups and stay unavailable. Both the hotseat screen, the online form and the server
 * read this list.
 */
export const PLAYABLE_SCENARIOS: ReadonlyArray<{ id: ScenarioId; name: string; description: string }> = [
  { id: "1710", name: "1710", description: "Early Company start with the broadest room for expansion. Five turns." },
  {
    id: "long-1710",
    name: "Long 1710",
    description: "As 1710, with Deregulation (the Vote to Deregulate, firms) and up to 8 turns. Takes about twice as long.",
  },
];

/** POST /api/games: create a game. Requires a Cloudflare Turnstile token. */
export type CreateGameRequest = {
  scenario: ScenarioId;
  players: Array<{ name: string; color?: string }>;
  turnstileToken: string;
  /** Added: which player is the creator's own seat (may export mid-game). Default 0, the first. */
  creatorIndex?: number;
};

export type SeatLink = {
  playerId: PlayerId;
  name: string;
  url: string;
  /** Added: true on the creator's seat. */
  creator?: boolean;
};

export type CreateGameResponse = {
  gameId: string;
  /** One private link per player. Whoever creates the game hands these out. */
  seats: SeatLink[];
  spectatorUrl: string;
};

/** POST /api/games/import: start an online game from a .joco save's text. Requires Turnstile. */
export type ImportGameRequest = {
  saveText: string;
  turnstileToken: string;
  /** Added: the creator's own seat. Default: the first player in seating order. */
  creatorPlayerId?: PlayerId;
};
export type ImportGameResponse = CreateGameResponse;

/** POST /api/games/:id/join: exchange a link token (checked with Turnstile) for the viewer's role. */
export type JoinRequest = { token: string; turnstileToken: string };
export type JoinResponse = { gameId: string; viewer: Viewer; playerName?: string };

/**
 * What a viewer is allowed to see (GET /api/games/:id/view, and every WebSocket "view" message).
 * `state` has hidden information removed for this viewer by the engine's projection:
 * no RNG seed or internal state, no deck orders, no other players' face-down blackmail identities,
 * no unrevealed secret choices. Its pendingDecision lists legal commands only when this viewer is
 * the one who must decide.
 */
export type GameView = {
  gameId: string;
  viewer: Viewer;
  /** Increases by one with every applied command or undo; clients ignore older views. */
  version: number;
  state: GameState;
  /** Whether this viewer may undo right now, and why not. */
  undo: { available: boolean; reason?: string };
  /** Added: whether this viewer may download a .joco now (GET /api/games/:id/export), and why not. */
  export?: { available: boolean; reason?: string };
  /** Added: the newest table-talk messages (at most ONLINE_LIMITS.chatHistory), oldest first. */
  chat?: ChatMessage[];
};

/** Table talk for negotiation. Seats may post; spectators read. Stored with the game. */
export type ChatMessage = {
  /** Increases by one per message in a game. */
  id: number;
  at: string;
  playerId: PlayerId;
  name: string;
  text: string;
};

/** POST /api/games/:id/chat */
export type ChatRequest = { text: string };
export type ChatResponse = { message: ChatMessage };

/** POST /api/games/:id/commands */
export type CommandRequest = {
  /** The server fills in gameId, actorId (from the token) and clientTimestamp. */
  command: Pick<GameCommand, "id" | "decisionId" | "type" | "payload">;
};

export type CommandResponse =
  | { ok: true; view: GameView }
  | { ok: false; errors: Array<{ code: string; message: string }>; view: GameView };

/** POST /api/games/:id/undo */
export type UndoResponse = CommandResponse;

/** GET /api/games/:id/export returns a .joco file (text/plain). Only after the game ends, or for the creator's seat. */

/** Error body for any non-2xx response. */
export type ApiError = { error: { code: string; message: string } };

// ---------------------------------------------------------------------------------------------
// WebSocket: GET /api/games/:id/ws. Browsers can't set headers on WebSockets, so the first client
// message must be "hello" with the token; the server answers with a view or an error and closes.

export type ClientMessage =
  | { type: "hello"; token: string }
  | { type: "command"; command: CommandRequest["command"] }
  | { type: "undo" }
  | { type: "chat"; text: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "view"; view: GameView }
  | { type: "rejected"; commandId?: string; errors: Array<{ code: string; message: string }> }
  | { type: "error"; code: string; message: string }
  /** A new table-talk message, sent to every connected viewer. */
  | { type: "chat"; message: ChatMessage }
  | { type: "pong" };

/** Browser-side record of games this browser has joined, for the "games waiting for you" list. */
export type StoredSeat = {
  gameId: string;
  token: string;
  viewer: Viewer;
  playerName?: string;
  scenario?: string;
  joinedAt: string;
};

export const STORED_SEATS_KEY = "john-company.online-seats";

// ---------------------------------------------------------------------------------------------
// Additions by the server (src/worker). See docs/online/server.md for the full API.

/**
 * GET /api/config (no auth): what the client needs before calling the API, e.g. the Cloudflare
 * Turnstile site key to render the widget with.
 */
export type ConfigResponse = { turnstileSiteKey: string };

/** Size and rate limits the server enforces. */
export const ONLINE_LIMITS = {
  /** Largest JSON body for commands, undo and join, and largest WebSocket message, in bytes. */
  maxRequestBytes: 32 * 1024,
  /** Largest create or import body (the import's .joco text included), in bytes. */
  maxImportBytes: 8 * 1024 * 1024,
  /** Players per online game (hotseat rules only; Crown modes are file-only for now). */
  minPlayers: 3,
  maxPlayers: 6,
  maxNameLength: 40,
  /** Per-seat token bucket: this many requests in a burst, refilled at `ratePerSecond`. */
  rateBurst: 60,
  ratePerSecond: 2,
  /** How many of a seat's latest commands the server can still undo, one at a time. */
  undoDepth: 20,
  /** Longest table-talk message, in characters, and how many recent messages each view carries. */
  maxChatLength: 500,
  chatHistory: 100,
} as const;

/**
 * Error codes in ApiError, "error" messages and "rejected" messages. Engine rejections (a stale
 * decision, an illegal option, ACTOR_NOT_ALLOWED for the wrong seat) pass through with the
 * engine's own codes.
 */
export type ServerErrorCode =
  | "BAD_REQUEST"
  | "BAD_ORIGIN"
  | "EXPORT_NOT_ALLOWED"
  | "GAME_EXISTS"
  | "GAME_NOT_FOUND"
  | "HELLO_REQUIRED"
  | "INVALID_SAVE"
  | "INVALID_TOKEN"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SPECTATOR_READ_ONLY"
  | "TURNSTILE_FAILED"
  | "TURNSTILE_NOT_CONFIGURED"
  | "UNDO_UNAVAILABLE"
  | "INTERNAL";

/**
 * Hidden information in a GameView's state is replaced by placeholder ids (src/engine/hidden.ts),
 * all starting with "hidden:":
 * - draw piles keep their length but every entry is a placeholder (HIDDEN_LAW_ID, ...); the top
 *   event tile is "hidden:event-tile@<regionId>", and topOfStackRegion(state) still reads it;
 * - another player's face-down blackmail card has cardId HIDDEN_BLACKMAIL_CARD_ID and an instance
 *   id from hiddenBlackmailInstanceId(owner, index). Send that id back as is (for example to ask
 *   for the card in a deal); the server maps it to the real card;
 * - face-down blackmail in the London Season Display is HIDDEN_BLACKMAIL_CARD_ID for everyone but
 *   the player choosing from it; blackmail in the London Season discards is too;
 * - a decision offered only because its actor holds a face-down card shows everyone else step
 *   HIDDEN_DECISION_STEP, actor HIDDEN_PLAYER_ID and a neutral prompt;
 * - a log entry for a declined face-down card shows everyone else a neutral summary and no actor.
 * A multi-option "system" decision is shown with `actor` set to the seat that answers it.
 */
export {
  HIDDEN_BLACKMAIL_CARD_ID,
  HIDDEN_CARD_ID,
  HIDDEN_EVENT_TILE_ID,
  HIDDEN_ID_PREFIX,
  HIDDEN_LAW_ID,
  HIDDEN_LONDON_SEASON_CARD_ID,
  HIDDEN_PLAYER_ID,
  hiddenBlackmailInstanceId,
  hiddenEventTileRegion,
  isHiddenId,
} from "../engine/hidden";
export { HIDDEN_DECISION_STEP } from "../engine/projection";
