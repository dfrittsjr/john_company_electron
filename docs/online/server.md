# Online server

The server side of online play: one Cloudflare Worker serves the static site and `/api/*`, and
each game lives in its own `GameRoom` Durable Object. Design and decisions:
`docs/plans/online-multiplayer.md`. The client/server contract: `src/online/protocol.ts`.

| File | What it is |
| --- | --- |
| `src/worker/index.ts` | Worker entry: routing, same-origin check, Turnstile, body limits, JSON errors; static assets for everything else. |
| `src/worker/game-room.ts` | The `GameRoom` Durable Object: SQLite storage, RPC methods, WebSockets with hibernation. |
| `src/worker/game-room-core.ts` | The room's rules behind a small storage interface; unit-tested in Node (`src/tests/online/`). |
| `src/engine/projection.ts` | `projectForViewer(state, viewer)`: what one seat or a spectator may see. |
| `src/engine/automatic.ts` | Automatic "system" steps and the seat that answers a "system" choice. |
| `src/engine/hidden.ts` | Placeholder ids for hidden information. |
| `wrangler.jsonc`, `tsconfig.worker.json` | Worker config, and type-checking against the Workers runtime. |

## How a game runs

- **The server is authoritative.** The Durable Object holds the full `GameState` and runs the
  engine (`applyCommand`). Clients only ever see projected views.
- **Seats.** Creating or importing a game issues one link per player and one spectator link.
  - Each link carries a random 128-bit token (base64url, 22 characters) in its URL fragment.
  - The server stores only SHA-256 hashes, and compares them without stopping at the first difference.
  - A token works from any browser. There are no accounts.
- **The actor comes from the token.** A command's `actorId` is always the token's seat; anything
  the client sends as `actorId` is ignored.
  - Anytime commands (gifts, deals, promise calls, blackmail) act as that seat, whoever's turn it is.
  - A command for someone else's decision is rejected by the engine (`ACTOR_NOT_ALLOWED`).
  - Spectators can't act (`SPECTATOR_READ_ONLY`).
- **Automatic steps.** After every command, the server applies each "system" decision that has
  exactly one option (skipped vacant offices, phase confirmations). Nobody presses them.
- **A "system" decision with a real choice** goes to a named seat, and the view shows that seat
  as its `actor`. The seat's command reaches the engine as "system". Audit of 2026-10-25 (code
  reading plus 80 random games across all scenarios):

  | Decision | Who answers online |
  | --- | --- |
  | Military Oversight nepotism consent (`companyOperation.militaryOversight`) | The first other family with officers in that Army, clockwise from the Prime Minister. |
  | Dividends with the Chairman's office vacant (`revenue.chooseDividends`) | The Chairman title holder (former Chairman), else the first seat. |
  | Presidency order with both President and Chairman vacant (`companyOperation.presidency`) | The same. |
  | Former Chairman's pick with no former Chairman (`hiring.electChairman`) | The same. |

  The last three follow the engine's own rule that the former Chairman leads while the office is
  vacant. Only Military Oversight showed up in random play; the others come from the
  `?? "system"` fallbacks in the code.
- **Versions.** Every applied command or undo adds one to the game's `version`. Every view
  carries the version, and clients ignore views older than the one they have.

## Hidden information

`projectForViewer(state, viewer)` returns a `GameState` with the same shape. The UI renders it
unchanged, and `src/tests/online/projection-render.test.tsx` checks that every panel renders a
projected view. Placeholders all start with `hidden:` (`isHiddenId`).

| Secret | In a view |
| --- | --- |
| RNG seed and internal state | `seed: ""`, `internalState: [0,0,0,0]`. The counter stays. |
| RNG records in the log | No seed; shuffle rolls (`shuffle[...]`) removed. |
| Law deck, London Season deck, other draw piles, the Crown's AI deck | Same length, every entry a placeholder (`hidden:law`, `hidden:london-season-card`, `hidden:card`). |
| Events in India stack | Same length; the top tile is `hidden:event-tile@<region>` (its painted side is public, p.28), the rest `hidden:event-tile`. `topOfStackRegion(view)` still works. |
| Another player's face-down blackmail | `cardId: "hidden:blackmail"`, `id: "hidden:blackmail@<owner>#<n>"`, everywhere the card's ids appear (log details, transfers, deals, interrupts). |
| Face-down blackmail in the London Season Display | `hidden:blackmail`, except for the player choosing from the display (they may look, p.11). |
| `hidden.privateCards` | Only the viewer's own. |
| Firm strategy secrets | Others' unrevealed entries keep only `firmId` and `committedBy`. |
| Crown internals | `hidden.crownDeck`, `hidden.crownBlackmail` and `crown.currentDecisionProfile` removed. |
| Who holds a face-down card | Company Fraud and Scandal candidates, Envoy offers and Hiring Preference offers cut to the viewer; a pending Connection interrupt or Scandal pick is dropped for others. |
| Legal commands | Only for the player who must decide (including interrupted decisions saved in negotiation). Spectators never get any. |
| Decisions that exist only because the actor holds a face-down card | Shown to others with step `hidden:private`, a neutral id and the prompt "Waiting for X to make a private decision." The steps are `CARD_REVEALING_STEPS` in `projection.ts`. |

Clients send another player's blackmail placeholder back unchanged, for example to ask for that
card in a deal. The server maps it to the real card (`resolveHiddenIds`).

## HTTP API

- Every response is JSON except export.
- Errors are `ApiError`: `{ "error": { "code", "message" } }`.
- Authenticated routes take `Authorization: Bearer <token>`.

| Route | Auth | Body → response | Notes |
| --- | --- | --- | --- |
| `GET /api/config` | none | → `ConfigResponse` `{ turnstileSiteKey }` | For rendering the Turnstile widget. |
| `POST /api/games` | Turnstile | `CreateGameRequest` → `CreateGameResponse` | 3-6 players, hotseat rules, random setup. |
| `POST /api/games/import` | Turnstile | `ImportGameRequest` → `ImportGameResponse` | A hotseat `.joco`, verified by `deserializeSave`. |
| `POST /api/games/:id/join` | Turnstile + token in body | `JoinRequest` → `JoinResponse` | Says which seat a link is; records the first join. |
| `GET /api/games/:id/view` (also `GET /api/games/:id`) | Bearer | → `GameView` | Counts against the rate limit. |
| `POST /api/games/:id/commands` | Bearer | `CommandRequest` → `CommandResponse` | See below. |
| `POST /api/games/:id/undo` | Bearer | (empty) → `UndoResponse` | See Undo. |
| `GET /api/games/:id/export` | Bearer | → `.joco` text, `Content-Disposition: attachment` | See Export. |
| `GET /api/games/:id/ws` | hello message | WebSocket upgrade | See below. |

**Commands**
- **Shape:** `{ command: { id, decisionId, type, payload } }`. `id` is the client's own (1-128
  characters).
- **Anytime commands:** `decisionId` may be anything, e.g. `"anytime"`.
- **Retries:** resending a command id the seat already used returns `{ ok: true, view }` without
  applying it again.
- **Engine rejections** come back as HTTP 200 with `{ ok: false, errors, view }`: a stale decision
  (`DECISION_ID_MISMATCH`), the wrong seat (`ACTOR_NOT_ALLOWED`) or an option that wasn't offered.
- **Other failures** are an `ApiError` with a status:
  - 400 `BAD_REQUEST`, 401 `INVALID_TOKEN`, 404 `GAME_NOT_FOUND`;
  - 403 `SPECTATOR_READ_ONLY`, `EXPORT_NOT_ALLOWED`, `BAD_ORIGIN` or `TURNSTILE_FAILED`;
  - 405 `METHOD_NOT_ALLOWED`, 413 `PAYLOAD_TOO_LARGE`, 429 `RATE_LIMITED`;
  - 500 `INTERNAL` or `TURNSTILE_NOT_CONFIGURED`, 502 `TURNSTILE_FAILED` when siteverify can't be reached.

**Same origin.** The API refuses any request whose `Origin` isn't the site's own, or whose
`Sec-Fetch-Site` is cross-site or same-site. Requests without those headers are allowed
(scripts, curl); they still need a token. No CORS headers are sent.

**Turnstile.** Create, import and join check the body's `turnstileToken` with Cloudflare's
siteverify endpoint, using the `TURNSTILE_SECRET` secret and the caller's IP. The site key comes
from the `TURNSTILE_SITE_KEY` variable (`GET /api/config`). The server doesn't check the token's
hostname.

## WebSocket

`GET /api/games/:id/ws`. Browsers can't set headers on a WebSocket, so the first message
authenticates.

| Client sends | Server answers |
| --- | --- |
| `{"type":"hello","token":"…"}` (first message) | `{"type":"view",…}`. A bad token gets `{"type":"error","code":"INVALID_TOKEN"}` and the socket closes (1008). |
| `{"type":"command","command":{…}}` | On success, every connected socket gets its own `view`. On failure, the sender gets `{"type":"rejected","commandId",errors}`, then a fresh `view` if the engine refused it. |
| `{"type":"undo"}` | Same as a command. |
| `{"type":"ping"}` | `{"type":"pong"}`, answered by the runtime without waking the object (send exactly this text). |

- **Pushes:** after any change through HTTP or the socket, every authenticated socket gets its own
  projected view.
- **Before hello:** any other message gets `HELLO_REQUIRED` and the socket closes.
- **Hello timeout:** a socket that hasn't said hello within about 30 seconds is closed.
- **Hibernation:** sockets use the Durable Object hibernation API. The viewer's seat id is kept in
  the socket's serialized attachment, so an idle game costs nothing while players stay connected.
- **Deploys:** a deploy disconnects every socket. Clients should reconnect with backoff and say
  hello again.

## Undo

A seat may undo when all of these hold:
- the game's most recent change is that seat's own command (with the automatic steps after it);
- `undoBlockReason(before, after)` allows it: no dice, shuffle, draw, blackmail reveal or game end;
- no seat can identify a face-down card it couldn't before (`identifiableFaceDownCards`): for
  example after giving someone a face-down blackmail card, or when the next decision lets a player
  look at the London Season Display's face-down blackmail. This rule is online only.

Undo restores the state from before the command and takes back that command's automatic steps.
Repeating undo walks back through the seat's own earlier commands, as long as nobody else acted
in between. The server keeps the last 20 commands' snapshots.

`GameView.undo` says whether the viewer may undo now and, if not, why.

## Export and import

- **Export** is allowed for any viewer once Final Scoring is complete, and for the creator's seat
  at any time. The creator is the first player unless `creatorIndex` or `creatorPlayerId` says
  otherwise. `GameView.export` says which applies.
  - A mid-game export contains everything (deck orders, every blackmail card, the seed). Only the
    creator, who started the game, can make one.
  - Afterwards the live game gets a fresh random seed (same roll count), so the file can't predict
    later dice. Undo keeps the live generator for the same reason.
- **Import** starts a new online game from a hotseat `.joco`:
  - checksums are verified, Crown saves are refused, and the file needs 3-6 players;
  - new links are issued and the game gets a fresh seed;
  - the save's own `state.gameId` is kept; the online game id is separate.

## Limits

`ONLINE_LIMITS` in `src/online/protocol.ts`:

| Limit | Value |
| --- | --- |
| Command, undo and join bodies, and WebSocket messages | 32 KB |
| Create and import bodies (the `.joco` text included) | 8 MB |
| Players | 3-6 (hotseat only; Crown modes stay file-only) |
| Player name | 1-40 characters, no control characters, unique |
| Rate limit | Per seat: 60-request burst, refilled at 2 per second. Covers views, commands, undo and export, but not WebSocket pushes or pings. Kept in memory, so it resets when the object restarts. |
| Undo depth | 20 commands |
| Hello timeout | 30 seconds (checked by an alarm, so up to about a minute) |

## Storage

Each game's SQLite database (`ctx.storage.sql`) has four tables:

| Table | What it holds |
| --- | --- |
| `meta` | One JSON row: game id, version, undo history, recent command ids. |
| `seats` | Seat id, role, player id and name, token hash, creator flag, first join time. |
| `snapshots` | Game state JSON per version, split into 500,000-character chunks (SQLite values max 2 MB). |
| `commands` | Append-only audit trail: every command, automatic step, undo, create and import. |

- **Snapshots** are kept for the current version and for the versions undo can still return to;
  older ones are deleted.
- **Size:** a game uses a few MB (the current state plus up to 20 undo snapshots of 30-300 KB each), well inside the free plan's 5 GB.
- **Writes:** each change is one transaction (`transactionSync`).
- **Concurrency:** a room's state changes run synchronously after the last `await` (token
  hashing), so two commands arriving together are applied one after the other. The second one
  normally fails with `DECISION_ID_MISMATCH`.

## Local development

```bash
cp .dev.vars.example .dev.vars     # TURNSTILE_SECRET = Cloudflare's always-pass test secret
npx astro build                    # the Worker serves ./dist
npx wrangler dev --port 8800       # http://localhost:8800, API at /api/*
```

- **Test keys:** `wrangler.jsonc` sets `TURNSTILE_SITE_KEY` to Cloudflare's always-pass test site
  key, `1x00000000000000000000AA`. With the always-pass test secret
  (`1x0000000000000000000000000000000AA`), any token verifies, including the widget's dummy token
  `XXXX.DUMMY.TOKEN.XXXX`. Verification still calls Cloudflare, so local dev needs network access.
- **Local data:** state persists in `.wrangler/state` (or wherever `--persist-to` points).
- **Types:** after changing `wrangler.jsonc`, regenerate the Worker types with `npm run cf:types`.
- **Checks:** `npm run typecheck` covers the browser build and the Worker (`tsconfig.worker.json`);
  `npx vitest run` covers projection, automatic steps and the room core.

Try it by hand:

```bash
curl -s localhost:8800/api/games -H 'Content-Type: application/json' \
  -d '{"scenario":"1710","players":[{"name":"Ann"},{"name":"Ben"},{"name":"Cat"}],"turnstileToken":"x"}'
curl -s localhost:8800/api/games/<gameId>/view -H 'Authorization: Bearer <token from a seat url>'
```

## Deploy

1. **Turnstile:** in the Cloudflare dashboard, create a widget in Managed or Non-interactive mode
   for the site's hostname (the `workers.dev` address works).
   - Put its site key in `wrangler.jsonc` under `vars.TURNSTILE_SITE_KEY`. Site keys are public.
   - Set the secret:

     ```bash
     npx wrangler secret put TURNSTILE_SECRET
     ```

   Without the secret, create, import and join fail with `TURNSTILE_NOT_CONFIGURED`.
2. **Deploy:** `npm run deploy` runs `astro build && wrangler deploy`.
3. **Migrations:** the first deploy applies migration `v1`, which creates the SQLite-backed
   `GameRoom` class. The free plan only allows SQLite-backed classes.
   - Never edit or remove an applied migration.
   - To rename or delete a class, add a new tag (`v2`, ...) with `renamed_classes` or `deleted_classes`.
   - A table change inside the room goes in `SqlRoomStorage` (`CREATE TABLE IF NOT EXISTS` /
     `ALTER TABLE`). It needs no Wrangler migration.
4. **After the deploy:** deploying disconnects open WebSockets. Games themselves survive deploys.
   A change to `GAME_SCHEMA_VERSION` doesn't migrate stored games: existing rooms would hold states
   the new engine refuses to load.

## Known gaps

- **Who is asked leaks a card.** The engine offers some steps only to the holder of a particular
  face-down blackmail card: Company Fraud, Scandal, Envoy to the Mughals, Hiring Preference, Man
  on the Inside, and the Connections.
  - The projection hides the step, prompt and option list, but the pending decision's `actor` (and
    the time it takes) still shows who is deciding.
  - A few log lines do the same, e.g. "Ann kept their blackmail card." after Company Fraud.
  - Fixing this needs an engine change, such as offering every player the step.
- **Military Oversight nepotism** asks one yes/no question for all the other families with
  officers in the Army. Online, the first such family answers for all of them; the rules ask each.
- **Simultaneous decisions** (`actor: "simultaneous"`) would show their options to every seat. The
  engine has none yet; secret firm strategies will need per-seat options.
- **Chat** (`POST /api/games/:id/chat` in the plan) isn't built.
- **The rate limiter** is in memory and resets when the object restarts. Create and import are
  limited only by Turnstile.
- **Views send the whole state,** log included, on every change: tens of KB early on, a few
  hundred KB late in a long game. Log deltas would cut this if it matters.
