// Browser side of the online protocol (src/online/protocol.ts): typed HTTP helpers and the live
// connection to one game. Nothing here runs the game engine; the server holds the game.

import type {
  ApiError,
  ClientMessage,
  CommandRequest,
  CommandResponse,
  CreateGameRequest,
  CreateGameResponse,
  GameView,
  ImportGameRequest,
  ImportGameResponse,
  JoinRequest,
  JoinResponse,
  ServerMessage,
  UndoResponse,
} from "../../online/protocol";

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type FetchLike = typeof fetch;

/** Tests swap this for the in-memory server; production uses the global fetch. */
let fetchImpl: FetchLike | null = null;
export function setFetchImplementation(next: FetchLike | null): void {
  fetchImpl = next;
}
function doFetch(input: string, init?: RequestInit): Promise<Response> {
  return (fetchImpl ?? fetch)(input, init);
}

/** Tests swap this for a fake socket; production uses the browser's WebSocket. */
let socketFactory: ((url: string) => SocketLike) | null = null;
export function setSocketFactory(next: ((url: string) => SocketLike) | null): void {
  socketFactory = next;
}

export function gamePath(gameId: string, suffix = ""): string {
  return `/api/games/${encodeURIComponent(gameId)}${suffix}`;
}

async function request<T>(path: string, init: RequestInit & { token?: string; json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  let response: Response;
  try {
    response = await doFetch(path, { ...init, headers, body });
  } catch (error) {
    throw new ApiRequestError("network", error instanceof Error ? error.message : "Network error.", 0);
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  // A rejected command still carries the current view, so hand it back instead of throwing.
  if (parsed && typeof parsed === "object" && "ok" in parsed && "view" in parsed) return parsed as T;

  if (!response.ok) {
    const error = (parsed as ApiError | undefined)?.error;
    throw new ApiRequestError(
      error?.code ?? `http-${response.status}`,
      error?.message ?? `The server answered ${response.status}.`,
      response.status,
    );
  }
  return parsed as T;
}

export function createGame(input: CreateGameRequest): Promise<CreateGameResponse> {
  return request("/api/games", { method: "POST", json: input });
}

export function importGame(input: ImportGameRequest): Promise<ImportGameResponse> {
  return request("/api/games/import", { method: "POST", json: input });
}

export function joinGame(gameId: string, input: JoinRequest): Promise<JoinResponse> {
  return request(gamePath(gameId, "/join"), { method: "POST", json: input });
}

export function fetchView(gameId: string, token: string): Promise<GameView> {
  return request(gamePath(gameId, "/view"), { token });
}

export function sendCommand(gameId: string, token: string, command: CommandRequest["command"]): Promise<CommandResponse> {
  const body: CommandRequest = { command };
  return request(gamePath(gameId, "/commands"), { method: "POST", token, json: body });
}

export function sendUndo(gameId: string, token: string): Promise<UndoResponse> {
  return request(gamePath(gameId, "/undo"), { method: "POST", token, json: {} });
}

/** The .joco save text. */
export async function exportGame(gameId: string, token: string): Promise<string> {
  let response: Response;
  try {
    response = await doFetch(gamePath(gameId, "/export"), { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new ApiRequestError("network", error instanceof Error ? error.message : "Network error.", 0);
  }
  const text = await response.text();
  if (!response.ok) {
    let error: ApiError["error"] | undefined;
    try {
      error = (JSON.parse(text) as ApiError).error;
    } catch {
      error = undefined;
    }
    throw new ApiRequestError(error?.code ?? `http-${response.status}`, error?.message ?? "Export is not available.", response.status);
  }
  return text;
}

// ---------------------------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

/** The slice of the WebSocket API the connection needs; tests provide their own. */
export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type ConnectionOptions = {
  gameId: string;
  token: string;
  onView: (view: GameView) => void;
  onStatus?: (status: ConnectionStatus, detail?: { polling: boolean; error?: string }) => void;
  /** A fatal problem (bad token, unknown game): the connection stops. */
  onFatal?: (error: { code: string; message: string }) => void;
  /** Server refused a command sent over the socket. */
  onRejected?: (errors: Array<{ code: string; message: string }>, commandId?: string) => void;
  createSocket?: (url: string) => SocketLike;
  /** Defaults to wss://host/api/games/:id/ws on the page's own origin. */
  url?: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  pingIntervalMs?: number;
  pollIntervalMs?: number;
  /** Failed WebSocket attempts in a row (never opened) before falling back to polling. */
  maxSocketFailures?: number;
};

const OPEN = 1;
const FATAL_CODES = new Set(["unauthorized", "forbidden", "not-found", "bad-token", "invalid-token", "game-not-found"]);

export function defaultSocketUrl(gameId: string): string {
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  const host = typeof location !== "undefined" ? location.host : "localhost";
  return `${secure ? "wss" : "ws"}://${host}${gamePath(gameId, "/ws")}`;
}

export class OnlineConnection {
  private readonly options: Required<Pick<ConnectionOptions, "baseDelayMs" | "maxDelayMs" | "pingIntervalMs" | "pollIntervalMs" | "maxSocketFailures">> & ConnectionOptions;
  private socket: SocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private failuresWithoutOpening = 0;
  private polling = false;
  private lastVersion = -Infinity;
  private status: ConnectionStatus = "connecting";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ConnectionOptions) {
    this.options = {
      baseDelayMs: 500,
      maxDelayMs: 15_000,
      pingIntervalMs: 25_000,
      pollIntervalMs: 5_000,
      maxSocketFailures: 3,
      ...options,
    };
  }

  get currentStatus(): ConnectionStatus {
    return this.status;
  }

  get isPolling(): boolean {
    return this.polling;
  }

  get version(): number {
    return this.lastVersion;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus("connecting");
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  /** Feed a view from any source (HTTP command response, poll). Older versions are ignored. */
  applyView(view: GameView): boolean {
    if (view.gameId !== this.options.gameId || view.version <= this.lastVersion) return false;
    this.lastVersion = view.version;
    this.options.onView(view);
    return true;
  }

  /** Send a message over the socket when it is open. Returns false when it could not be sent. */
  send(message: ClientMessage): boolean {
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /** Reconnect right away (for the "back online" browser event). */
  retryNow(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.failuresWithoutOpening = 0;
    this.attempt = 0;
    if (this.polling) {
      this.polling = false;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.socket) this.openSocket();
  }

  private setStatus(status: ConnectionStatus, error?: string): void {
    this.status = status;
    this.options.onStatus?.(status, { polling: this.polling, error });
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.reconnectTimer = this.pingTimer = this.pollTimer = null;
  }

  private openSocket(): void {
    if (this.stopped) return;
    const url = this.options.url ?? defaultSocketUrl(this.options.gameId);
    let socket: SocketLike;
    try {
      socket = (this.options.createSocket ?? socketFactory ?? ((target) => new WebSocket(target) as unknown as SocketLike))(url);
    } catch {
      this.handleSocketGone(false);
      return;
    }
    this.socket = socket;
    let opened = false;

    socket.onopen = () => {
      opened = true;
      // Browsers can't set headers on a WebSocket, so the token goes in the first message.
      socket.send(JSON.stringify({ type: "hello", token: this.options.token } satisfies ClientMessage));
    };
    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(message);
    };
    const gone = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.handleSocketGone(opened);
    };
    socket.onclose = gone;
    socket.onerror = () => {
      // An error is always followed by close in browsers; make sure we move on if it is not.
      if (!opened) gone();
    };
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "view":
        // First good message after hello: the socket is live.
        this.attempt = 0;
        this.failuresWithoutOpening = 0;
        this.polling = false;
        if (this.status !== "live") this.setStatus("live");
        this.startPings();
        this.applyView(message.view);
        break;
      case "rejected":
        this.options.onRejected?.(message.errors, message.commandId);
        break;
      case "error":
        if (FATAL_CODES.has(message.code)) {
          this.stop();
          this.setStatus("offline", message.message);
          this.options.onFatal?.({ code: message.code, message: message.message });
        }
        break;
      case "pong":
        break;
    }
  }

  private startPings(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, this.options.pingIntervalMs);
  }

  private handleSocketGone(wasOpen: boolean): void {
    if (this.stopped) return;
    if (!wasOpen) this.failuresWithoutOpening += 1;
    else this.failuresWithoutOpening = 0;

    if (this.failuresWithoutOpening >= this.options.maxSocketFailures) {
      this.startPolling();
      return;
    }

    this.setStatus("reconnecting");
    const delay = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * 2 ** this.attempt);
    this.attempt += 1;
    // Jitter keeps a room full of friends from reconnecting in lockstep.
    const jittered = Math.round(delay * (0.75 + Math.random() * 0.25));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, jittered);
  }

  // WebSockets are blocked on some networks; poll GET /view instead, and try the socket again
  // now and then.
  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.setStatus("reconnecting");
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.polling) return;
    try {
      const view = await fetchView(this.options.gameId, this.options.token);
      if (this.stopped || !this.polling) return;
      this.applyView(view);
      if (this.status !== "live") this.setStatus("live");
    } catch (error) {
      if (this.stopped || !this.polling) return;
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        this.stop();
        this.setStatus("offline", error.message);
        this.options.onFatal?.({ code: error.code, message: error.message });
        return;
      }
      this.setStatus("offline", error instanceof Error ? error.message : undefined);
    }
    if (this.stopped || !this.polling) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, this.options.pollIntervalMs);
    // Every few polls, see whether the socket works again.
    this.pollsSinceSocketTry = (this.pollsSinceSocketTry ?? 0) + 1;
    if (this.pollsSinceSocketTry >= 6) {
      this.pollsSinceSocketTry = 0;
      this.failuresWithoutOpening = this.options.maxSocketFailures - 1;
      if (!this.socket) this.openSocket();
    }
  }

  private pollsSinceSocketTry?: number;
}
