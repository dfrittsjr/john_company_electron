# Developer Notes

How the game is put together, and where to look. Current status and what's left: `status.md`.
Rules coverage and assumptions per phase: `phases/*.md`. Conventions for adding rules:
`phase-build-guide.md`.

## Layout

| Path | What it is |
| --- | --- |
| `src/data/` | Transcribed components: map, tracks, scenarios, setup cards, offices, laws, cards, India events, board pieces. Validated by `validate.ts`. |
| `src/engine/` | The rules: a pure, deterministic engine. `commands.ts` dispatches; each phase lives in `phases/`. |
| `src/save/` | The `.joco` save envelope: serialization, checksums, validation. |
| `src/ui/` | The React game screen (board, decision panel, dashboards, negotiation, laws, log). |
| `src/pages/` | The Astro site: landing, play, how-to-play, credits. |
| `scripts/harness.ts` | Plays the engine from the command line (`npm run harness`), including random and greedy bots. |
| `src/tests/` | Vitest suites for data, engine phases, saves, and fixtures. |

## Engine model

- **Commands, not mutations.** The UI sends `GameCommand`s; `applyCommand` validates and returns a
  new state plus a log entry. React never changes game state directly.
- **Pending decisions.** Every state has one `pendingDecision`: who acts, the prompt, and a finite
  list of legal commands with concrete payloads. The UI shows them as buttons; the dispatcher
  rejects anything that isn't one of them. Anytime commands (transfers, promises, blackmail) skip
  the decision check and then rebuild the pending decision's options.
- **Determinism.** All randomness goes through the seeded RNG in `rng.ts`, stored in the state, so
  a reloaded save never rerolls. Rolls are recorded in the log.
- **Guards.** After every command the dispatcher rejects negative cash or pieces, Debt off the
  track, and any family whose pieces don't total 18.

### One canonical location per piece

Each family piece lives in exactly one place; per-player views come from `src/engine/selectors.ts`.

| Piece | Canonical location |
| --- | --- |
| Officeholders, including the Chairman | `company.offices[officeId].holder` |
| Company shares in the Court | `company.court` (the Chairman's piece is one more share) |
| Stock Exchange pieces | `company.stockExchange[].share` |
| Writers in a Presidency box | `india.presidencies[p].writers[playerId]` |
| Writers on orders | `india.regions[r].orders[].writer` |
| Officers and Commanders | `company.armies[a].officers[playerId]`, `company.armies[a].commander` |
| Supply, pensioners, prizes, officers-in-training | `players[id].familyMembers` |

Office treasuries live on the office (`company.offices[...].treasury`).

## Saves

- A save is UTF-8 JSON with the extension `.joco`: an envelope (`fileType`, `schemaVersion`,
  `rulesetVersion`, `gameId`, `saveId`, `parentSaveId`, turn, phase, active actor, checksums) around
  the full game state and log.
- `GAME_SCHEMA_VERSION` in `src/engine/types.ts` changes when the state shape changes. Older saves
  are refused with a readable message; there is no migration.
- Hidden information uses a trusted-table model: face-down blackmail and the deck orders are in
  the file, and the UI hides them from other players behind a pass-the-device reveal.
- Saving: Chromium browsers get a real "Save as" dialog; others download the file. The default
  name says whose turn is next, e.g. `1710-t2-hiring-for-Yellow.joco`.

## Checks

```bash
npm run typecheck   # astro check + tsc
npx vitest run      # all tests
npm run harness -- new /tmp/g.joco --seed s1 && npm run harness -- random /tmp/g.joco --policy greedy --fund 25
```
