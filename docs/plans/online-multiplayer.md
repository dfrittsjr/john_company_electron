# Plan: online multiplayer on Cloudflare Workers

**Goal.** Play from a shared link instead of passing `.joco` files.
- Everyone sees the same game live, the server enforces the rules, and nobody can peek at hidden
  information.
- Stay on Cloudflare's free tier, and keep file passing as a fallback.

## Architecture

```
browser (React UI, same as today)
   │  HTTPS + WebSocket
   ▼
Cloudflare Worker  (one Worker: static site + /api/*)
   │  routes each game's requests to its own Durable Object
   ▼
GameRoom Durable Object  (one per game)
   - runs the existing engine (src/engine) on the authoritative state
   - stores state, command log and seats in its SQLite storage
   - pushes updates to connected players over WebSockets
```

- **One Worker** keeps serving the Astro site. A Worker script (`main` in `wrangler.jsonc`) handles
  `/api/*`, and the assets config sends those paths to the script. The current wrangler option is
  `assets.run_worker_first` with route patterns; check the docs at implementation time.
- **One Durable Object per game.**
  - It processes one request at a time, which removes races between players.
  - It keeps its own SQLite storage. The free plan supports SQLite-backed Durable Objects.
  - It can hold WebSockets with the hibernation API, so a game sitting idle for days costs nothing.
- **The engine runs inside the Durable Object, not the front Worker.**
  - Free Worker requests get only a few milliseconds of CPU, which `applyCommand` with its option
    checks can exceed.
  - Durable Object requests allow far more (30 seconds by default).
  - The engine is plain TypeScript with no browser dependencies, so it bundles into the Worker
    as is.
- **No separate database.** Games are addressed by unguessable ids. A games list ("my games") can
  live in the browser's localStorage, or later in a small directory Durable Object.

## Identity and seats

**Recommended: invite links with seat tokens, and no accounts.**
- **Creating a game** returns a host link plus one private link per seat ("Join as Ann").
- **Seat tokens:** each link carries a random 128-bit token. The browser stores it in localStorage;
  the server stores only a SHA-256 hash.
- **Who acts:** the server takes the acting player from the token and never trusts the client's
  `actorId`.
- **Spectators:** an optional read-only link shows the public view.
- **Optional:** put Cloudflare Access (email one-time code, free up to 50 users) in front of the whole
  site, so only your friends can open it. Seats can later be tied to Access emails.

## API

| Method and path | Purpose |
|---|---|
| `POST /api/games` | Create a game (scenario, player names); returns the game id and seat links |
| `GET /api/games/:id` | The caller's view of the game (see Hidden information) |
| `POST /api/games/:id/commands` | Apply a command; the body includes the decision id it answers |
| `GET /api/games/:id/ws` | WebSocket: the server pushes each new view and log entries; the client may send commands |
| `GET /api/games/:id/export` | Download a `.joco` save (backup, or continue offline) |
| `POST /api/games/import` | Start an online game from an existing `.joco` save |
| `POST /api/games/:id/chat` | Table talk for negotiation, stored with the game (optional) |

## Engine changes

- **Seat authorisation:** a command is accepted only from the seat the decision names. Anytime
  commands are accepted from any seat, acting as itself.
- **No choosing "system" actor:** the server resolves single-option automatic steps itself. Audit
  for any automatic step that offers a real choice, and give it a named player (usually the
  Chairman).
- **`projectForSeat(state, seat)`**, the view a player is allowed to see. It removes:
  - the random generator's seed and internal state (today a save file holds them, so a determined
    player could predict dice);
  - the order of the law deck, the London Season deck and the event tiles (the top tile's back,
    which shows a region, stays public);
  - other players' face-down blackmail identities;
  - secret firm strategies until they're revealed;
  - the Crown's internals.

  Legal commands are included only for the viewer's own pending decision.
- **Simultaneous decisions** (firm strategy) become truly simultaneous: each manager submits
  privately and the server reveals them all at once. No pass-the-device step needed.
- **Consent requests** (nepotism, Debt, coalitions, deals) become notifications to the player asked.
- **Undo online:** allowed for your own most recent command, only if `undoBlockReason` passes and no
  other player has acted since. The server keeps a short history.

## Client changes

- **Online mode beside file mode.** Keep the file mode (hotseat, Save & pass) exactly as it is; the
  same board, panels, undo and rules reference serve both.
- **New pages:**
  - "Start online game": scenario and names; it shows the seat links to copy.
  - `/g/<id>`: the game, with the seat token read from the link and then stored.
- **Live play:**
  - A "Waiting for Ben: hire the Manager of Shipping" banner replaces Save & pass.
  - Updates arrive over the WebSocket, with automatic reconnect and backoff, and a read-only view
    while offline.
- **Optional:** a chat panel next to Deals & Cards.

## Notifications

Async play needs a nudge when it's your turn:
- **Discord webhook** (recommended, since your group already uses Discord). The host pastes a
  channel webhook URL when creating the game. The server posts "Ann, your turn: hire the Manager of
  Shipping → link" whenever the acting player changes.
- **Browser notifications** while the tab is open.
- **Email later**, if wanted, through a mail provider.

## Storage and free-tier fit

- **Tables in the game's SQLite storage:** `meta`, `seats` (hashed tokens), `commands`
  (append-only), `snapshots` (state after each command, or every N commands), and `chat`.
- **Size:** a full game is a few hundred commands, and each state is about 100-300 KB of JSON. Free
  accounts get 5 GB of Durable Object storage, and each object can hold 10 GB.
- **Free daily quotas:** 100,000 Worker requests, 100,000 Durable Object requests, and 5 million row
  reads / 100,000 row writes per day. A game of friends uses a tiny fraction.

## Security

- **Tokens:** compared in constant time, never logged, and only their hashes stored.
- **Limits:** a per-seat rate limit (a small token bucket in the game's Durable Object) and a payload
  size cap. The engine already rejects any command that isn't one of the offered options.
- **Origins:** same-origin API only.
- **Licence:** the site stays free and non-commercial, with the credits page (CC BY-NC-SA terms).

## Testing

- **Server tests:** `@cloudflare/vitest-pool-workers` runs tests inside the Workers runtime. Cover:
  - create, join, act and reconnect;
  - views never containing secrets;
  - rejecting another seat's command;
  - two commands arriving at once;
  - export and import round trips.
- **Browser tests:** a Playwright test with one browser context per seat plays a scripted game over
  WebSockets, as in the playtest helper we already have.
- **Multi-agent playtest:** reuse the playtest setup, pointing it at the online mode instead of save
  files.

## Milestones

| # | Milestone | Result | Size |
|---|---|---|---|
| M1 | Worker script and GameRoom skeleton: create, join, fetch view (polling) | An online game exists and can be viewed | M |
| M2 | Commands, seat authorisation, `projectForSeat` | Playable online by refreshing; secrets stay on the server | M |
| M3 | WebSockets with hibernation, live updates, reconnect | Live play | M |
| M4 | Lobby pages, seat links, waiting banner, Discord notifications | Friends can start and follow games easily | M |
| M5 | Import/export `.joco`, online undo, chat | Move existing games online; safety nets | S-M |
| M6 | Rate limits, tests, docs, deploy | Ready for your group | S |

M1-M3 can run in parallel with the Deregulation work, since they touch different code. The firm
strategy step (secret choices) is easiest to finish once M2's views exist.

## Decisions for you

1. **Identity:** seat links (recommended) or Cloudflare Access emails?
2. **Privacy:** put Cloudflare Access in front of the site, or rely on unguessable links?
3. **Notifications:** a Discord webhook per game?
4. **Spectators:** allow a read-only link?
5. **File mode:** keep Save & pass alongside online play (recommended, as an offline fallback)?
