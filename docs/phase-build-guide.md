# Phase Build Guide

Conventions for building the remaining phases of John Company (2nd edition) in this engine.
Several agents build phases in parallel on separate branches, so the ownership rules below matter.

## Scope

The target is the **1710 scenario for 3-6 human players**, playable start to finish by passing a save
file. Out of scope for now: Deregulation and firms (and therefore the Firms phase and the Vote to
Deregulate), 1758/1813 setup, and the Crown (solo/two-player AI).

## Sources of truth

1. The rulebook (`printnplay/Rulebooks/John Company Rules.pdf`; text extraction in the scratchpad).
2. The printed components, already transcribed in `src/data/` (map, tracks, scenarios, laws, cards,
   India events, board components). Treat data values as verified. If you find a transcription error,
   fix it in a separate commit that says what source you checked.
3. Project policy (not a rulebook rule): where a card's text conflicts with the rulebook, follow the
   card, and record every conflict in your phase notes.

Never guess a rule. When the rules are genuinely ambiguous, pick the most literal reading, record it
in your phase notes as an assumption, and add a test that names it.

## Rulings already made

- **Sepoy Recruitment**: "each unrest is worth +1 strength" adds to the base +1 per unrest (p.32), so
  each unrest counts 2 in attacks against the Company while the law is in effect.
- **Shipbuilders** (prestige #21): pays when the Manager of Shipping leases an extra ship or buys a
  Company ship.
- **Military Rebuked!** (failure card): officers-in-training are not officers; they do not count.
- **"My turn"** on the London Season Display promise card means the guarantor's turn in the
  Prestige Cards step.

## How a decision must look

- Every step is a `PendingDecision` with a finite list of `legalCommands`, each with a **complete,
  concrete payload**. The UI renders them as buttons and the AI playtesters pick them by index, so a
  command must never need extra input.
- Break big choices into steps instead of enumerating combinations: "add a region / done", "exhaust
  one more piece / stop", "place the next writer on order X".
- Numeric choices (cash for dice, votes) are offered as one command per allowed value.
- The actor is the player who decides under the rules. A decision for another player mid-action
  (consent, a blackmail reaction, Commander defence) is its own pending decision for that player;
  the game state must say how to resume.
- Only offer optional reactions (blackmail, promise cards) to players who actually hold an unplayed
  card that applies right now. Never stall the game asking everyone.
- All randomness goes through `src/engine/rng.ts`, and every roll is recorded in the log entry's
  `rngRolls`. Save after a roll must never reroll.
- "No dead actions" (p.17): don't offer actions that can have no effect.

## Ownership

Effects belong to the agent that owns the phase in which they trigger, including card, law, and
promise-card effects. Each area writes its notes in `docs/phases/<area>.md`, not in the shared TODO.

| Area | Files you own | Also owns effects triggering in |
|---|---|---|
| Company Operation (CO) | `phases/company-operation*.ts` (+ new files under `phases/company-operation/`), `phases/bonuses.ts` | Company Operation, Bonuses |
| Events in India (EV) | `phases/events-in-india*.ts` (+ `phases/events-in-india/`) | Events in India, Region Loss |
| Parliament (PA) | `phases/parliament*.ts`, `phases/revenue.ts`, `ParliamentState` in `types.ts` | Parliament, Revenue; law pass/fail and immediate effects |
| London Season and scoring (LS) | `phases/london-season*.ts`, `phases/upkeep.ts`, `phases/final-scoring*.ts` | London Season, Upkeep, Final Scoring |
| Negotiation, Family, and Hiring (NG) | `phases/negotiation.state.ts`, `phases/anytime.ts`, `phases/family.ts`, `phases/hiring.ts`, `src/ui/**` | Family, Hiring, anything played "anytime" |

Ongoing law effects follow the same rule: Military Oversight is CO's, Sepoy Recruitment's unrest
part is EV's and its expense part is PA's, and extra family actions from laws are NG's.

If you need something from another area (a hook, a helper, a state field), do the smallest local
version you can, mark it `// TODO(<area>):` with what the owner should do, and list it in your final
report. Don't rewrite another area's files.

Shared files (`types.ts`, `selectors.ts`, `setup.ts`, `commands.ts`, `tests/fixtures/*`): append-only
edits, kept small. Register commands in your phase module's exported command map; anytime commands go
in your own exported map that `phases/anytime.ts` spreads in. Don't bump `GAME_SCHEMA_VERSION`; the
integrator does that once at merge.

## Tests

- Put tests in your own file: `src/tests/engine/<area>.test.ts`. Put helpers in
  `src/tests/fixtures/<area>.ts`. Use `fixtures/builders.ts` so the 18-pieces-per-family invariant holds.
- Each rule test names its rulebook page or card. Prefer the rulebook's worked examples as fixtures:
  Trading (p.20-21), Deploy and Dividing Loot (p.22-23), Administering (p.24), Trading in China (p.25),
  Region Loss (p.29), Peace (p.31), Mysore Invades (p.32-33), Selecting a Law (p.34-35),
  London Display (p.12), Chairman Election (p.15), General Hiring (p.16).
- Cover save/load in the middle of each new multi-step decision.
- Run `npx tsc --noEmit` and `npx vitest run` before you finish.

## Harness

`npm run harness -- help` lists commands. It plays the engine without the UI and stores real `.joco`
saves, so you can check a phase end to end:

```bash
npm run harness -- new /tmp/g.joco --seed s1
npm run harness -- play /tmp/g.joco 0          # apply legal command 0
npm run harness -- random /tmp/g.joco --steps 2000   # random legal play; stops on errors or broken invariants
npm run harness -- state /tmp/g.joco india.regions.delhi
```

Random play must never hit a rejected legal command, a broken invariant, or a stuck decision.
