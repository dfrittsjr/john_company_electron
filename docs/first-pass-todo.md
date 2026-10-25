# Status

Current state of the 1710 build. Details live in the phase notes:

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
- **Save format:** schema 3, ruleset `john-company-2e-data-3`. Older saves are refused with a
  readable message.

## Next

- **Board UI:** show the map state (orders, towers, flags, Elephant, writers), offices, armies,
  tracks and the London Season Display, so people can play from the screen rather than the log.
- **Playtesting:** have AI or human playtesters play each phase against the rulebook, and add a
  test that cites the page for every finding.
- **Rules questions:** confirm the assumptions recorded in the phase notes with the group.

## Later (out of scope for 1710)

- Deregulation and firms, the Vote to Deregulate, 1758/1813 setup and maps.
- The Crown (solo and two-player AI).
- Server-held games (Durable Objects) to replace passing files.
