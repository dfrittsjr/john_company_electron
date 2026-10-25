// The Worker entry: /api/* goes to the game's GameRoom Durable Object; everything else is the
// static Astro site (wrangler.jsonc sends only /api/* here). API reference: docs/online/server.md.

import { ONLINE_LIMITS, type ApiError, type ConfigResponse, type ServerErrorCode } from "../online/protocol";
import { base64url, randomBytes, type CoreResult } from "./game-room-core";
import { GameRoom } from "./game-room";

export { GameRoom };

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Game ids are random 128-bit base64url strings, so they can't be guessed or enumerated. */
const GAME_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (error) {
      console.error("API error", error instanceof Error ? (error.stack ?? error.message) : String(error));
      return apiError(500, "INTERNAL", "Something went wrong on the server.");
    }
  },
} satisfies ExportedHandler<Env>;

type Route =
  | { name: "config" }
  | { name: "create" }
  | { name: "import" }
  | { name: "join" | "view" | "commands" | "undo" | "chat" | "export" | "ws"; gameId: string };

const ROUTES: Array<{ method: string; pattern: RegExp; route: (match: RegExpMatchArray) => Route }> = [
  { method: "GET", pattern: /^\/api\/config$/, route: () => ({ name: "config" }) },
  { method: "POST", pattern: /^\/api\/games$/, route: () => ({ name: "create" }) },
  { method: "POST", pattern: /^\/api\/games\/import$/, route: () => ({ name: "import" }) },
  { method: "POST", pattern: /^\/api\/games\/([^/]+)\/join$/, route: (match) => ({ name: "join", gameId: match[1] }) },
  { method: "GET", pattern: /^\/api\/games\/([^/]+)\/view$/, route: (match) => ({ name: "view", gameId: match[1] }) },
  { method: "GET", pattern: /^\/api\/games\/([^/]+)$/, route: (match) => ({ name: "view", gameId: match[1] }) },
  { method: "POST", pattern: /^\/api\/games\/([^/]+)\/commands$/, route: (match) => ({ name: "commands", gameId: match[1] }) },
  { method: "POST", pattern: /^\/api\/games\/([^/]+)\/undo$/, route: (match) => ({ name: "undo", gameId: match[1] }) },
  { method: "POST", pattern: /^\/api\/games\/([^/]+)\/chat$/, route: (match) => ({ name: "chat", gameId: match[1] }) },
  { method: "GET", pattern: /^\/api\/games\/([^/]+)\/export$/, route: (match) => ({ name: "export", gameId: match[1] }) },
  { method: "GET", pattern: /^\/api\/games\/([^/]+)\/ws$/, route: (match) => ({ name: "ws", gameId: match[1] }) },
];

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const originProblem = crossOrigin(request, url);
  if (originProblem) return apiError(403, "BAD_ORIGIN", originProblem);

  const matches = ROUTES.filter((candidate) => candidate.pattern.test(url.pathname));
  if (matches.length === 0) return apiError(404, "NOT_FOUND", `No API route ${url.pathname}.`);
  const entry = matches.find((candidate) => candidate.method === request.method);
  if (!entry) {
    return apiError(405, "METHOD_NOT_ALLOWED", `Use ${matches.map((candidate) => candidate.method).join(" or ")} for ${url.pathname}.`, {
      Allow: matches.map((candidate) => candidate.method).join(", "),
    });
  }
  const route = entry.route(url.pathname.match(entry.pattern) as RegExpMatchArray);

  if (route.name === "config") {
    return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY } satisfies ConfigResponse);
  }

  if (route.name === "create" || route.name === "import") {
    const body = await readJson(request, route.name === "import" ? ONLINE_LIMITS.maxImportBytes : ONLINE_LIMITS.maxRequestBytes);
    if (!body.ok) return body.response;
    const turnstile = await verifyTurnstile(env, request, body.value);
    if (turnstile) return turnstile;
    const gameId = base64url(randomBytes(16));
    const room = roomFor(env, gameId);
    const input = { gameId, origin: url.origin, body: body.value };
    return fromCore(route.name === "create" ? await room.create(input) : await room.importSave(input));
  }

  if (!GAME_ID_PATTERN.test(route.gameId)) return apiError(404, "GAME_NOT_FOUND", "There is no game with this id.");
  const room = roomFor(env, route.gameId);

  switch (route.name) {
    case "join": {
      const body = await readJson(request, ONLINE_LIMITS.maxRequestBytes);
      if (!body.ok) return body.response;
      const turnstile = await verifyTurnstile(env, request, body.value);
      if (turnstile) return turnstile;
      const token = isRecord(body.value) && typeof body.value.token === "string" ? body.value.token : "";
      return fromCore(await room.join(token));
    }
    case "view":
      return fromCore(await room.view(bearer(request)));
    case "commands": {
      const body = await readJson(request, ONLINE_LIMITS.maxRequestBytes);
      if (!body.ok) return body.response;
      return fromCore(await room.command(bearer(request), body.value));
    }
    case "undo": {
      const body = await readJson(request, ONLINE_LIMITS.maxRequestBytes, { optional: true });
      if (!body.ok) return body.response;
      return fromCore(await room.undo(bearer(request)));
    }
    case "chat": {
      const body = await readJson(request, ONLINE_LIMITS.maxRequestBytes);
      if (!body.ok) return body.response;
      return fromCore(await room.chat(bearer(request), body.value));
    }
    case "export": {
      const result = await room.exportSave(bearer(request));
      if (!result.ok) return apiError(result.status, result.error.code, result.error.message);
      return new Response(result.body.text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.body.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    case "ws":
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return apiError(426, "BAD_REQUEST", "This route needs a WebSocket upgrade.", { Upgrade: "websocket" });
      }
      return room.fetch(request);
  }
}

function roomFor(env: Env, gameId: string) {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));
}

/**
 * The API is same-origin only. Browsers send Origin on cross-origin requests and on every POST
 * and WebSocket; Sec-Fetch-Site tells the rest. Requests without either (curl, scripts) carry
 * their token explicitly and are allowed.
 */
function crossOrigin(request: Request, url: URL): string | undefined {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) return `Requests from ${origin} are not allowed.`;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin" && site !== "none") return "Cross-site requests are not allowed.";
  return undefined;
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads at most `maxBytes` of a JSON body, without buffering anything larger. */
async function readJson(request: Request, maxBytes: number, options: { optional?: boolean } = {}): Promise<JsonBody> {
  const tooLarge = () => ({ ok: false as const, response: apiError(413, "PAYLOAD_TOO_LARGE", `The request body may be at most ${maxBytes} bytes.`) });
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > maxBytes) return tooLarge();
  if (!request.body) {
    return options.optional ? { ok: true, value: {} } : { ok: false, response: apiError(400, "BAD_REQUEST", "A JSON body is required.") };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (text.trim() === "" && options.optional) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: apiError(400, "BAD_REQUEST", "The request body is not valid JSON.") };
  }
}

/** Cloudflare Turnstile: the token from the widget must verify with our secret before a game or seat is issued. */
async function verifyTurnstile(env: Env, request: Request, body: unknown): Promise<Response | undefined> {
  if (!env.TURNSTILE_SECRET) {
    return apiError(500, "TURNSTILE_NOT_CONFIGURED", "The server has no Turnstile secret; see docs/online/server.md.");
  }
  const token = isRecord(body) ? body.turnstileToken : undefined;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    return apiError(403, "TURNSTILE_FAILED", "The bot check is missing; reload the page and try again.");
  }
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);

  let outcome: { success?: boolean; "error-codes"?: string[] };
  try {
    const response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    outcome = (await response.json()) as typeof outcome;
  } catch (error) {
    console.error("Turnstile siteverify failed", String(error));
    return apiError(502, "TURNSTILE_FAILED", "The bot check could not be verified; try again.");
  }
  if (outcome.success !== true) {
    const codes = outcome["error-codes"]?.join(", ");
    return apiError(403, "TURNSTILE_FAILED", `The bot check failed${codes ? ` (${codes})` : ""}; reload the page and try again.`);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function apiError(status: number, code: ServerErrorCode | string, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: { code, message } } satisfies ApiError, status, headers);
}

function fromCore<T>(result: CoreResult<T>): Response {
  return result.ok ? json(result.body, result.status) : apiError(result.status, result.error.code, result.error.message);
}
