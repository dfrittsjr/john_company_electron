# Status

Current state of the build: 1710, 1758, 1813 and Long 1710 with Deregulation. Details live in the phase notes:

- `docs/phase-build-guide.md`: scope, decision design, rulings, ownership.
- `docs/phases/*.md`: each phase's rules coverage and assumptions. Their "for other areas" lists
  were resolved during integration; see `docs/phases/integration.md`.

## Done

- **Site:** Astro site on Cloudflare Worker static assets; browser save/load of `.joco` files.
- **Data:** map, tracks, scenarios, laws, cards, India event tiles, storm die and board components,
  checked against the print-and-play kit.
- **Every phase of the 1710 turn:** London Season, Family, Hiring, Company Operation, Bonuses,
  Revenue, Events in India, Parliament, Upkeep and Refresh, Final Scoring.
- **Negotiation:** transfers, promise cards, consent requests, and blackmail with Man on the Inside.
- **Integration:** the dispatcher's option guard and resource guard, and decision refreshers after
  anytime commands (see `docs/phases/integration.md`).
- **Harness:** `npm run harness` plays the engine headlessly, including random and greedy policies.
- **Board UI:** board overlay, decision panel, dashboards, Laws tab, handoff banner, final scoring.
- **Playtests:** three focused AI playtests against the rulebook, and three-player and six-player
  games through the web UI; every confirmed finding fixed with a test.
- **Online multiplayer:** a Worker plus one Durable Object per game. It covers seat and spectator
  links, per-viewer views that keep secrets on the server (including who is deciding about a
  face-down card), live WebSocket updates, server-side undo, table-talk chat, `.joco` import and
  export, and Turnstile on create and join. See `online/server.md`.
- **Six-player playtest:** a full game through the web UI reached turn 5 with the Company alive.
- **Deregulation and Long 1710 (pp.36-42):** the Vote to Deregulate, the Firms phase (forming,
  investing, ships, takeovers, mergers, dissolution, secret strategies), firm trading in initiative
  order with half-value refills, firm expenses and dividends with emergency rescues, storms on firm
  ships, special retirements, and firm shares and Debtor's Prison in Final Scoring. Long 1710 runs
  to turn 8 and can be started in hotseat and online. See `phases/deregulation.md`.
- **Undo and rules reference:** step-back undo that refuses dice, draws and reveals; the rulebook
  text in a searchable panel and on `/rules`.
- **Save format:** schema 3, ruleset `john-company-2e-data-3`. Deregulation only added optional
  fields, so 1710 saves from before it still load. Older schemas are refused with a readable message.

## Next

- **Human playtest:** play a full 1710 game with the group and fix what comes up.
- **Rules questions:** confirm the assumptions recorded in the phase notes with the group.
- **Online polish:** a fork warning for file mode, and the remaining gaps in `online/server.md`.
- **Plans:** `plans/remaining-game.md` (the draft variant, the Crown online) and
  `plans/online-multiplayer.md` (Cloudflare Worker and Durable Objects).

## Later

- The Crown (solo and two-player AI).
