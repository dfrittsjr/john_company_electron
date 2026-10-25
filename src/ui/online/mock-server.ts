// An in-memory implementation of src/online/protocol.ts for tests. It runs the real engine, so
// commands, undo rules and decisions behave like the real server's, but it is not shipped: nothing
// outside *.test.* files imports it.
//
// The view projection is deliberately crude: it hides legal commands from non-deciders and
// replaces hidden cards with placeholder ids, so UI tests exercise "unknown card id" paths.

import {
  applyCommand,
  createNewGame,
  undoBlockReason,
  type GameCommand,
  type GameState,
  type PlayerId,
} from "../../engine";
import { deserializeGameState, serializeSave } from "../../save";
import type {
  ApiError,
  ClientMessage,
  CommandRequest,
  CommandResponse,
  CreateGameRequest,
  CreateGameResponse,
  GameView,
  ImportGameRequest,
  ServerMessage,
  Viewer,
} from "../../online/protocol";
import type { SocketLike } from "./api";

export const PLACEHOLDER_CARD = "hidden-card";

type Seat = { playerId: PlayerId; name: string; token: string };
type HistoryEntry = { actor: PlayerId; before: GameState; commandId: string };

type MockGame = {
  id: string;
  state: GameState;
  version: number;
  seats: Seat[];
  spectatorToken: string;
  history: HistoryEntry[];
  /** The first seat may always export; others only once the game is over. */
  creatorToken: string;
};

let counter = 0;
function nextToken(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function apiError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return json(body, status);
}

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  gameId: string;
  viewer: Viewer | null = null;
  token: string | null = null;

  constructor(
    private readonly server: MockServer,
    url: string,
  ) {
    this.gameId = decodeURIComponent(url.match(/\/api\/games\/([^/]+)\/ws/)?.[1] ?? "");
    setTimeout(() => {
      if (this.readyState !== 0) return;
      if (this.server.socketsFail) {
        this.onerror?.({});
        this.readyState = 3;
        this.onclose?.({});
        return;
      }
      this.readyState = 1;
      this.server.sockets.add(this);
      this.onopen?.({});
    }, 0);
  }

  send(data: string): void {
    const message = JSON.parse(data) as ClientMessage;
    setTimeout(() => this.server.handleSocketMessage(this, message), 0);
  }

  /** Server to client. */
  push(message: ServerMessage): void {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(): void {
    this.drop(false);
  }

  /** Simulates the connection breaking. */
  drop(notify = true): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.server.sockets.delete(this);
    if (notify) this.onclose?.({});
  }
}

export class MockServer {
  games = new Map<string, MockGame>();
  sockets = new Set<FakeSocket>();
  /** While true, new WebSocket connections fail (to test the polling fallback). */
  socketsFail = false;
  /** While true, every fetch fails with a network error. */
  offline = false;
  /** Every HTTP request, for assertions. */
  requests: Array<{ method: string; path: string }> = [];
  /** When true, a view older than the current one is sent on the next socket hello. */
  private staleViews = new Map<string, GameView>();

  // --- setup -------------------------------------------------------------------------------

  private register(state: GameState, names: Array<{ id: PlayerId; name: string }>): CreateGameResponse {
    counter += 1;
    const id = `g${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const seats: Seat[] = names.map((player) => ({ playerId: player.id, name: player.name, token: nextToken("seat") }));
    const game: MockGame = {
      id,
      state: { ...state, gameId: id },
      version: 1,
      seats,
      spectatorToken: nextToken("watch"),
      history: [],
      creatorToken: seats[0].token,
    };
    this.games.set(id, game);
    return {
      gameId: id,
      seats: seats.map((seat) => ({
        playerId: seat.playerId,
        name: seat.name,
        url: `/online/?game=${id}#seat=${seat.token}`,
      })),
      spectatorUrl: `/online/?game=${id}#watch=${game.spectatorToken}`,
    };
  }

  /** Test shortcut: create a game from an existing state. */
  createFromState(state: GameState): CreateGameResponse {
    return this.register(
      state,
      state.seatingOrder.map((playerId) => ({ id: playerId, name: state.players[playerId].name })),
    );
  }

  tokenFor(created: CreateGameResponse, playerIndexOrSpectator: number | "spectator"): string {
    const url = playerIndexOrSpectator === "spectator" ? created.spectatorUrl : created.seats[playerIndexOrSpectator].url;
    return url.split("#")[1].split("=")[1];
  }

  // --- views -------------------------------------------------------------------------------

  private viewerFor(game: MockGame, token: string | null): Viewer | null {
    if (!token) return null;
    const seat = game.seats.find((candidate) => candidate.token === token);
    if (seat) return { kind: "seat", playerId: seat.playerId };
    if (token === game.spectatorToken) return { kind: "spectator" };
    return null;
  }

  viewFor(game: MockGame, viewer: Viewer): GameView {
    const state = structuredClone(game.state);
    const placeholders = (cards: string[]) => cards.map(() => PLACEHOLDER_CARD);
    state.parliament.lawDeck.drawPile = placeholders(state.parliament.lawDeck.drawPile);
    state.londonSeason.deck = placeholders(state.londonSeason.deck);
    state.eventsInIndia.drawPile = placeholders(state.eventsInIndia.drawPile);
    for (const player of Object.values(state.players)) {
      if (viewer.kind === "seat" && viewer.playerId === player.id) continue;
      for (const card of player.blackmailCards) if (card.facedown) card.cardId = PLACEHOLDER_CARD;
    }
    const decider = state.pendingDecision.actor;
    const mine = viewer.kind === "seat" && (decider === viewer.playerId || decider === "simultaneous");
    if (!mine) state.pendingDecision.legalCommands = [];

    return { gameId: game.id, viewer, version: game.version, state, undo: this.undoFor(game, viewer) };
  }

  private undoFor(game: MockGame, viewer: Viewer): GameView["undo"] {
    if (viewer.kind !== "seat") return { available: false, reason: "Spectators can't undo." };
    const last = game.history.at(-1);
    if (!last) return { available: false, reason: "Nothing to undo." };
    if (last.actor !== viewer.playerId) return { available: false, reason: "Another player acted since." };
    const reason = undoBlockReason(last.before, game.state);
    return reason ? { available: false, reason } : { available: true };
  }

  private broadcast(game: MockGame): void {
    for (const socket of this.sockets) {
      if (socket.gameId === game.id && socket.viewer) socket.push({ type: "view", view: this.viewFor(game, socket.viewer) });
    }
  }

  // --- test controls -----------------------------------------------------------------------

  /** Another player acts: apply a command as a seat and push to everyone. */
  actAs(gameId: string, token: string, type: string, payload: unknown = {}): CommandResponse {
    const game = this.games.get(gameId);
    if (!game) throw new Error("no such game");
    return this.applyFor(game, token, { id: `mock-${Date.now()}-${Math.random()}`, decisionId: game.state.pendingDecision.id, type, payload });
  }

  /** The next socket hello gets this older view first, as after a bad reconnect. */
  replayStaleViewOnNextHello(gameId: string, view: GameView): void {
    this.staleViews.set(gameId, view);
  }

  dropAllSockets(): void {
    for (const socket of [...this.sockets]) socket.drop(true);
  }

  game(gameId: string): MockGame {
    const game = this.games.get(gameId);
    if (!game) throw new Error("no such game");
    return game;
  }

  // --- protocol ----------------------------------------------------------------------------

  private applyFor(game: MockGame, token: string, request: CommandRequest["command"]): CommandResponse {
    const viewer = this.viewerFor(game, token);
    if (!viewer || viewer.kind !== "seat") {
      throw new HttpError(403, "forbidden", "Only seated players can act.");
    }
    const command: GameCommand = {
      ...request,
      gameId: game.id,
      actorId: viewer.playerId,
      clientTimestamp: new Date().toISOString(),
    };
    const before = game.state;
    const result = applyCommand(before, command);
    if (!result.ok) {
      return { ok: false, errors: result.errors.map((error) => ({ code: error.code, message: error.message })), view: this.viewFor(game, viewer) };
    }
    game.history.push({ actor: viewer.playerId, before, commandId: command.id });
    game.state = result.state;
    game.version += 1;
    this.broadcast(game);
    return { ok: true, view: this.viewFor(game, viewer) };
  }

  handleSocketMessage(socket: FakeSocket, message: ClientMessage): void {
    const game = this.games.get(socket.gameId);
    if (!game) {
      socket.push({ type: "error", code: "not-found", message: "No such game." });
      return;
    }
    if (message.type === "hello") {
      const viewer = this.viewerFor(game, message.token);
      if (!viewer) {
        socket.push({ type: "error", code: "unauthorized", message: "That link is not valid for this game." });
        return;
      }
      socket.viewer = viewer;
      socket.token = message.token;
      const stale = this.staleViews.get(game.id);
      if (stale) {
        this.staleViews.delete(game.id);
        socket.push({ type: "view", view: stale });
      }
      socket.push({ type: "view", view: this.viewFor(game, viewer) });
    } else if (message.type === "ping") {
      socket.push({ type: "pong" });
    } else if (message.type === "command" && socket.token) {
      try {
        const response = this.applyFor(game, socket.token, message.command);
        if (!response.ok) socket.push({ type: "rejected", commandId: message.command.id, errors: response.errors });
      } catch (error) {
        if (error instanceof HttpError) socket.push({ type: "error", code: error.code, message: error.message });
      }
    }
  }

  createSocket = (url: string): SocketLike => new FakeSocket(this, url);

  /** Drop-in for fetch. */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "http://mock.local");
    const method = init?.method ?? "GET";
    this.requests.push({ method, path: url.pathname });
    if (this.offline) throw new TypeError("Failed to fetch");
    try {
      return await this.route(url.pathname, method, init);
    } catch (error) {
      if (error instanceof HttpError) return apiError(error.status, error.code, error.message);
      throw error;
    }
  };

  private async route(path: string, method: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    const bearer = headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;

    if (method === "POST" && path === "/api/games") {
      const request = body as CreateGameRequest;
      this.checkTurnstile(request.turnstileToken);
      if (request.players.length < 3 || request.players.length > 6) throw new HttpError(400, "bad-request", "Games need 3 to 6 players.");
      const players = request.players.map((player, index) => ({ id: `player-${index + 1}`, name: player.name, color: player.color ?? "#888888" }));
      const state = createNewGame({
        mode: "hotseat",
        scenario: request.scenario,
        players,
        setupDistribution: "random",
        seed: `mock:${players.map((player) => player.name).join("|")}`,
      });
      return json(this.register(state, players));
    }

    if (method === "POST" && path === "/api/games/import") {
      const request = body as ImportGameRequest;
      this.checkTurnstile(request.turnstileToken);
      let state: GameState;
      try {
        state = deserializeGameState(request.saveText);
      } catch (error) {
        throw new HttpError(400, "bad-save", error instanceof Error ? error.message : "Not a valid save.");
      }
      return json(this.createFromState(state));
    }

    const match = path.match(/^\/api\/games\/([^/]+)\/(view|commands|undo|export|join)$/);
    if (!match) throw new HttpError(404, "not-found", "No such route.");
    const game = this.games.get(decodeURIComponent(match[1]));
    if (!game) throw new HttpError(404, "not-found", "No such game.");
    const route = match[2];

    if (route === "join" && method === "POST") {
      const viewer = this.viewerFor(game, body.token);
      if (!viewer) throw new HttpError(403, "forbidden", "That link is not valid.");
      return json({ gameId: game.id, viewer, playerName: viewer.kind === "seat" ? game.state.players[viewer.playerId].name : undefined });
    }

    const viewer = this.viewerFor(game, bearer);
    if (!viewer) throw new HttpError(401, "unauthorized", "That link is not valid for this game.");

    if (route === "view" && method === "GET") return json(this.viewFor(game, viewer));
    if (route === "commands" && method === "POST") {
      return json(this.applyFor(game, bearer ?? "", (body as CommandRequest).command));
    }
    if (route === "undo" && method === "POST") {
      const undo = this.undoFor(game, viewer);
      if (viewer.kind !== "seat" || !undo.available) {
        return json({ ok: false, errors: [{ code: "undo-blocked", message: undo.reason ?? "Can't undo." }], view: this.viewFor(game, viewer) });
      }
      const last = game.history.pop() as HistoryEntry;
      game.state = last.before;
      game.version += 1;
      this.broadcast(game);
      return json({ ok: true, view: this.viewFor(game, viewer) });
    }
    if (route === "export" && method === "GET") {
      if (bearer !== game.creatorToken && !game.state.finalScoring.complete) {
        throw new HttpError(403, "forbidden", "Only the host can export before the game ends.");
      }
      return new Response(serializeSave(game.state, { saveId: `save-${game.version}`, now: new Date().toISOString() }), { status: 200 });
    }
    throw new HttpError(405, "method-not-allowed", "Method not allowed.");
  }

  private checkTurnstile(token: string | undefined): void {
    if (!token) throw new HttpError(400, "turnstile", "The bot check did not pass.");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
