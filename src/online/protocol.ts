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

/** POST /api/games: create a game. Requires a Cloudflare Turnstile token. */
export type CreateGameRequest = {
  scenario: ScenarioId;
  players: Array<{ name: string; color?: string }>;
  turnstileToken: string;
};

export type SeatLink = { playerId: PlayerId; name: string; url: string };

export type CreateGameResponse = {
  gameId: string;
  /** One private link per player. Whoever creates the game hands these out. */
  seats: SeatLink[];
  spectatorUrl: string;
};

/** POST /api/games/import: start an online game from a .joco save's text. Requires Turnstile. */
export type ImportGameRequest = { saveText: string; turnstileToken: string };
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
};

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
  | { type: "ping" };

export type ServerMessage =
  | { type: "view"; view: GameView }
  | { type: "rejected"; commandId?: string; errors: Array<{ code: string; message: string }> }
  | { type: "error"; code: string; message: string }
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
