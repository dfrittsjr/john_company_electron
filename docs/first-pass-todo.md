# Project TODO

This document tracks the next implementation work from the current scaffold in
`src/`. It is the practical continuation list for this repo. For the full
architecture and long-range scope, use `docs/implementation-plan.md`,
`docs/rules-and-state-model.md`, `docs/gui-design.md`, and
`docs/crown-ai-design.md`.

## Current State

- Vite + React + TypeScript + Electron shell exists.
- Board image renders.
- `GameState`, `PendingDecision`, command validation, RNG, save envelope, and
  starter data validation exist.
- Setup can create a starter hotseat game.
- Setup validation is shown in the new game UI, and Crown modes are correctly
  blocked while Crown AI cards are placeholders.
- Basic Electron save/load dialogs exist for `.joco` saves.
- `Copy Save Summary` exists.
- Starter commands now advance a hotseat `1710` game through:
  - setup
  - Family
  - Hiring
  - Company Operation
  - Bonuses
  - Revenue
  - Events in India
  - Parliament
  - Upkeep
  - London Season
  - Final Scoring
- The current engine is still mostly a phase skeleton. Many commands record
  that a phase happened but do not apply the real rules yet.
- October 2026 corrections (see `docs/rules-and-state-model.md`): the India map, Standing
  and Debt tracks, scenario turns and the 1710 Situation in India were re-transcribed from
  the board and cards; attrition, Revenue, Company failure, Chairman debt, hiring order and
  Governor hiring were corrected; each family piece now has one canonical location (state
  schema 2) with per-player views from `src/engine/selectors.ts`; Bonuses now pay for
  fitted (not unfitted) shipyards.
- Crown data is intentionally placeholder-level and Crown modes must remain
  blocked by validation until Crown AI cards/profiles/favors are encoded.

Always run before handing off code changes:

```bash
npm run typecheck
npm test
npm run build
```

For documentation-only changes, these checks are optional.

## Immediate Goal

Turn the current starter skeleton into a rules-enforced hotseat game for the
`1710` scenario before expanding to Crown, Deregulation, and advanced scenarios.

The recommended order is:

1. Make the engine easier to extend.
2. Encode the data needed by the next rule area.
3. Replace one starter phase with real legal commands and reducers.
4. Add tests and save/load coverage for that phase.
5. Continue to the next phase.

## Ordered Backlog

### 1. Split Command Reducers By Phase

Status: done.

Current dispatcher:

- `src/engine/commands.ts`

Phase modules now exist:

```text
src/engine/commands.ts
src/engine/phases/setup.ts
src/engine/phases/london-season.ts
src/engine/phases/family.ts
src/engine/phases/firms.ts
src/engine/phases/hiring.ts
src/engine/phases/company-operation.ts
src/engine/phases/bonuses.ts
src/engine/phases/revenue.ts
src/engine/phases/events-in-india.ts
src/engine/phases/parliament.ts
src/engine/phases/upkeep.ts
src/engine/phases/final-scoring.ts
```

Keep `applyCommand` as the dispatcher. Continue moving legal-command generation
and reducers into the phase modules as each phase becomes real.

### 2. Add Shared Engine Test Fixtures And Invariants

Status: done for the starter scaffold; expand as new rule areas are implemented.

Added:

- `src/tests/fixtures/game.ts`
- Game builder helpers for common hotseat states.
- Helpers to apply explicit commands and the first legal command.
- Invariant checks after every command:
  - active actor exists, unless actor is `system` or `simultaneous`
  - pending legal commands are known command types
  - log sequence is contiguous
  - pending decision phase matches state phase
  - save/load preserves the exact pending decision

Keep expanding these fixtures as real phase rules add dice, consent prompts,
hidden information, and Crown behavior. Keep the existing full starter-turn
tests until real phase equivalents pass.

### 3. Complete Core Static Data Needed For Hotseat 1710

Status: in progress.

Use `docs/data-entry-checklist.md` as the canonical data checklist, but enter
data in the order needed by gameplay.

First priority:

1. Done: component counts in `src/data/components.ts`.
2. Done: `1710` setup card data in `src/data/setup-cards.ts`.
3. Done: Family action definitions and costs in `src/data/family-actions.ts`.
4. Done: Stock Exchange slots and Company share creation rules in
   `src/data/stock-exchange.ts`.
5. Done: office order and office definitions in `src/data/offices.ts`.
6. Done: Presidency, army, home-region, sea-zone, and associated-region IDs in
   `src/data/map.ts`.
7. Done: starter board regions, order graph, home ports, and adjacency in
   `src/data/map.ts`.
8. Done: enterprise decks in `src/data/enterprises.ts`.

Map data notes:

- Region/order coordinates are starter transcriptions from `board_image-1.png`.
- The order graph has stable IDs and symmetric connections for rules work, but
  exact overlay positions can still be refined during UI board interaction work.
- The map data is now validated before new-game setup.

Enterprise data notes:

- Shipyards are encoded as 22 named cards with matching ship token names.
- Workshops and luxuries are encoded as numbered functional decks because their
  rule effects are uniform.
- The enterprise decks are now validated against the component manifest.

Current setup wiring:

- New games initialize family supply from the component manifest.
- New games initialize the Stock Exchange track from static data.
- New game validation now checks component counts, Family action data, Stock
  Exchange data, office data, map data, enterprise data, and setup-card data
  before allowing setup.

Setup card notes:

- The `1710` deck is encoded as 12 base cards plus 6 extra cards.
- For 5-player setup, add 3 extra cards.
- For 6-player setup, add all 6 extra cards.
- Done for current slice: random hotseat `1710` setup-card dealing and
  application on `setup.confirmStart`.
- Done: Setup UI now defaults to and starts implemented random setup; draft is
  shown as unavailable until draft dealing/selection is implemented.
- Done: 3-4 player setup deals the 12 base cards, 5-player setup adds 3 random
  extra cards, and 6-player setup adds all 6 extra cards.
- Done: setup-card effects currently update starting cash, offices, Company
  shares, Prime Minister, writers, commanders, officers in training, shipyards,
  placed ships, luxuries, workshops, trophies, and placeholder blackmail cards.
- Draft setup, Crown setup-card distribution, and advanced-scenario setup remain
  TODO.
- Current assumption: until the blackmail deck is encoded, setup
  `randomBlackmail` effects create facedown placeholder cards in player and
  hidden private-card state.

Do not mark advanced scenarios complete until their setup cards, scenario tracks,
map setup, laws, and Deregulation state are encoded.

### 4. Replace Starter Family Actions With Real Effects

Status: in progress.

Current behavior:

- `family.chooseAction` validates the selected action against the current
  decision's legal payloads, applies immediate Family action effects, and moves
  to the next player.
- Legal commands are filtered by cash, available family members, empty Stock
  Exchange slots, and enterprise deck availability.
- `Enlist Writer` places a family member in the chosen Presidency Writers box.
- `Enlist Officer` places a family member in Officers-in-Training.
- `Seek Share` places a family member on the cheapest affordable empty Stock
  Exchange slot and spends the printed cost.
- End-of-Family share creation converts rightmost Stock Exchange pieces into
  Company shares while Company Debt remains, reduces Debt, and slides remaining
  Stock Exchange pieces rightward.
- `Purchase Workshop`, `Purchase Shipyard`, and `Purchase Luxury` spend cash and
  take the next enterprise card. Shipyards create their matching ship token;
  luxuries award 2 VP and one window icon.
- If a player's opportunity marker is already on their chosen main action at
  the start of their Family decision, the engine offers a private
  `family.chooseRepeatAction` decision. The repeat legal commands are
  regenerated after the first action, so resources, Stock Exchange slots, and
  enterprise supply are rechecked. The player may decline with
  `family.finishAction`.
- The opportunity marker is moved only after the player's main/repeat decision
  is finished. `No Action` does not repeat and places the marker in supply.
- `No Action` is only generated when no other legal Family action is available.

Implement:

- Done: Opportunity marker double-action rule for main Family actions.
- Family order: start with the player holding the Chairman title and go clockwise (p.13);
  the engine currently starts with the first seat.
- Seek Share: the player may choose any empty Stock Exchange space (p.14); the engine only
  offers the cheapest affordable one.
- Enlist Writer: with four or more vacant offices, one additional writer once this turn
  (p.13).
- Extra family action from the most recent applicable law once laws exist.
- Out-of-family-pieces rule once prizes exist.
- Save/load coverage during future Family decision types as laws, prizes, and
  consent prompts are added.

Tests:

- Done: legal and illegal action availability.
- Done: cash and piece source/destination.
- Done: writer, officer, share, shipyard, workshop, and luxury effects.
- Done: share creation from debt.
- Done: opportunity marker behavior, including repeat, decline, No Action, and
  last-player Stock Exchange share resolution.
- Done: save/load coverage for normal and repeated Family action
  decisions.

### 5. Replace Starter Hiring Pass With Office Hiring

Current behavior:

- Normal Family completion now enters a real Hiring vacancy resolver instead of
  the starter player-by-player pass loop.
- If there are no queued vacancies, Hiring advances directly to starter Company
  Operation.
- Vacancies are resolved in encoded office order; unresolved non-Chairman
  offices expose a system skip that leaves the office vacant for the turn.
- Chairman can be elected when one human player already controls a pure majority
  of current Company shares. The elected share is moved from the Court to the
  Chairman slot, remains a Company share, and the Chairman office is filled.
- When the Chairman office is filled, `Manager of Shipping` and
  `Superintendent of Trade in China` can be filled from non-Chairman writers.
  The writer is removed from both the player's writer count and the Presidency
  Writers box, then placed in the office.
- `Director of Trade` can be filled by promoting a non-Chairman, non-Governor
  officeholder. The previous office becomes a new queued vacancy and its fatigue
  moves to Director of Trade.
- `Military Affairs` can be filled by the Chairman from military pieces in
  priority order: Commanders, then officers, then officers in training.
  The hired piece is removed from its army or training box and placed in the
  office.
- Presidents can be filled by the Director of Trade from matching Presidency
  writers or Governors associated with that Presidency. Matching writers are
  removed from their Presidency box; promoted Governors vacate their previous
  office and move fatigue to the President office.
- `Governor General`, when in play as a vacancy, can be filled by the Chairman
  using the same promotion-then-writer fallback as Director of Trade.
- Governors are hired by the President of the Presidency their region is associated with
  (association comes from conquest), from writers in that Presidency's box and officers in
  its Army. Hiring order follows the card-back numbers (`hiringOrder`).

Implement:

- Done: replace the starter pass loop with a real vacancy resolver.
- Done: Office vacancy order for the currently encoded office queue.
- Done: Hirer determination and candidate pool generation for
  Chairman-hired writer offices (`Manager of Shipping` and
  `Superintendent of Trade in China`) when the Chairman office is filled,
  excluding self-hires until nepotism consent exists.
- Done: Director of Trade promotion from current non-Chairman,
  non-Governor officeholders, including vacating the previous office and moving
  fatigue.
- Done: Director of Trade fallback to any writer when no eligible
  non-Chairman, non-Governor officeholder can be promoted. Current assumption:
  use the same no-nepotism behavior as other Chairman-hired offices until an
  explicit consent prompt exists.
- Done for Chairman-hired operating offices currently supported by state:
  Hirer determination from office data.
- Done for Chairman-hired writer offices and `Military Affairs`: Candidate pool
  generation from office data.
- Done: President hirer and candidate pool generation. Presidents are hired by
  the Director of Trade from writers in that Presidency or Governors associated
  with that Presidency.
- Done: Governor hirer and candidate pool generation per the card backs ("Consider
  writers and officers in this Presidency"), with the hirer taken from the region's
  conquest association.
- Done: Governor General hiring. When in play as a vacancy, Governor General is
  hired by the Chairman like Director of Trade.
- Done for deterministic majority: Chairman election by Company-share majority.
  First slice assumes
  a player who already controls a pure majority of Company shares can be elected
  directly; negotiated share support and former-Chairman fallback remain TODO.
- Done for current slice: contested Chairman election support. The engine exposes
  all human Company shareholders as public system candidates when no player has
  a pure majority. Assumption: this records table-negotiated support in one
  deterministic command until formal share-support commitments are encoded.
- Done: Empty Court Chairman handling. The engine exposes an explicit public skip
  for an empty Court/no-share state rather than silently falling through.
- TODO: formal negotiated support commitments and former-Chairman fallback when
  no candidate reaches majority.
- Done for Chairman, Chairman-hired writer offices, Director of Trade, Military
  Affairs, Presidents, Governor General, and Governors: Hire command.
- Done for current slice: Skip only if no hirer or no eligible candidate exists.
- Done for current slice: Nepotism consent prompt. The engine pauses on a public
  table-consent decision when a hirer selects their own family member for an
  office marked as requiring nepotism consent. Assumption: accepted consent
  completes the selected hire; denied consent leaves that vacancy unfilled for
  the turn until fuller negotiation/consent collection exists.
- Done for Director of Trade: Promotion and fatigue transfer.

Tests:

- Done for deterministic majority: Chairman election.
- Done for Chairman-hired writer offices, Military Affairs, Presidents,
  Governor General, and Governors: Candidate pool includes legal candidates and
  rejects illegal ones.
- Done for Director of Trade writer fallback: legal fallback candidate and
  current self-hire exclusion.
- Done: Nepotism consent accepted and denied, including save/load coverage for
  the consent pending decision.
- Done for current queue: Hiring advances through office order.
- Done for Chairman election, Chairman-hired writer office, Director of Trade,
  Military Affairs, and nepotism consent pending decisions. TODO for later
  multi-actor consent prompts: save/load during each fuller consent collection
  step.

### 6. Implement London Season

Current behavior:

- London Season is a system confirmation.
- On turn 1, London Season logs an explicit skip and advances to Family.

Implement:

- Done: Skip on the scenario's first turn (`turn === startTurn`; 1758 starts on turn 3).
- Done: Office attrition (p.11): roll + existing fatigue (+1 Chairman); 1-2 nothing,
  3-4 add a fatigue, 5+ retire. Codex previously added a fatigue to every office before
  rolling, which retired fresh officeholders half the time instead of a third.
- Pensioner retirement to prize boxes by paying costs and gaining VP.
- London Season Display order based on retirement spending.
- Prestige/blackmail card selection and discard.
- Display refill.
- Done for now: return remaining pensioners to family supplies (all of them, until prize
  retirements exist).

Data dependency:

- Prize boxes, prestige cards, blackmail cards, and London Season Display slots
  are not yet encoded. Implement these from `docs/data-entry-checklist.md`
  before replacing the remaining London Season card/prize skeleton.

Tests:

- Done for current slice: Attrition and retirement roll behavior.
- Prize payment and VP award.
- Card display selection.
- Save/load after rolls and before card selection.

### 7. Add Minimal Company Operation Office Loop

Current behavior:

- One system command confirms Company Operation.
- Chairman now has a real Company Operation command instead of the temporary
  pass fallback. The Chairman may take Company Debt and allocate available
  Company Balance to created non-Chairman office treasuries.

Implement first:

- Done: Red-ribbon office order.
- Done: Skip vacant/uncreated offices with log entries.
- Done: Human officeholder pending decision.
- Done: `companyOperation.passOffice` only as a temporary fallback per
  office.
- Done: End of office loop advances to Bonuses.

Current assumptions:

- Until Upkeep refresh is implemented, skipped vacant/uncreated offices are
  marked `actedThisTurn` to track Company Operation loop progress.
- Chairman (p.18): three free Debt advances, more need a Company-share majority consent
  decision, never past Debt 8, and the whole Balance must be allocated to the five
  Company treasuries.

Then replace office pass behavior in this order:

1. Done for current slice: Chairman debt and allocation.
2. Director of Trade special envoy, open order/China, transfers.
3. Manager of Shipping leases, fitting, Company ships, placement.
4. Military Affairs transfers, officers-in-training, commanders.
5. Presidency operation order.
6. President trade.
7. Commander local alliances and deploy.
8. Governor administer.
9. Superintendent of Trade in China.
10. Governor General.

Tests:

- Office loop skips vacant offices.
- Human officeholder receives pending decision.
- Each office reducer validates funds, pieces, dice, and consent.
- Save/load during each office action.

### 8. Implement Bonuses

Current behavior:

- Bonuses confirmation now pays implemented enterprise income and advances to
  starter Revenue.

Implement:

- Done: `GBP 1` for each workshop.
- Done: `GBP 1` for each shipyard with a fitted ship.
- Done: Correct income ownership and log entries.

Fixed: a shipyard pays when its ship is fitted, i.e. not on the shipyard. Codex had this
inverted.

Tests:

- Done: Workshop income.
- Done: Fitted and unfitted shipyard income.
- Done: Save/load at phase start.

### 9. Implement Revenue

Current behavior:

- Revenue resolves Company expenses and emergency loans, then pauses for a
  Chairman dividend decision before advancing to Events in India.

Implement:

- Done: Company expenses for Debt, armies, and ships (sea zones plus China).
- Done: Emergency loans (Debt capped at 8, Balance set to zero afterwards).
- Done: Public embarrassment (-1 for 1-2 loans, -2 for 3+), Expectations from the Standing
  track, dividends with Public Enthusiasm, and immediate Company failure at the leftmost
  Standing space, going straight to Final Scoring.

Tests:

- Done: Expenses and emergency loans.
- Done for current slice: Public embarrassment and Standing movement.
- Done for current slice: Dividends and share payouts.
- Done for current slice: Company failure.
- Done: Save/load after expenses and before dividends.

### 10. Implement Events In India

Current behavior:

- Events in India rolls a seeded temporary storm die, records the result in the
  pending decision, and requires a follow-up system command before Parliament.

Implement:

- Done for current slice: Seeded temporary storm die roll and saveable
  post-roll checkpoint.
- Storm checks for player and firm ships.
- Event tile draw count.
- Turmoil.
- Windfall.
- Shuffle.
- Leader.
- Peace.
- Crisis.
- Foreign Invasion.
- Cascades.
- Elephant March.
- Attacks against Company.
- Region loss and escalating Standing penalties.

Tests:

- Done for current slice: Deterministic storm die roll from RNG.
- Crisis strength and defense.
- Region loss cleanup.
- Elephant placement/facing.
- Save/load after random results and before follow-up choices.

### 11. Implement Parliament Meets

Current behavior:

- Starter Parliament is a system confirmation.

Implement:

- Prime Minister law draw up to three, stopping on dilemmas.
- Law selection.
- Policy dial movement to matching icon.
- Starting support.
- Voting rounds until PM stops or a round has no votes.
- Enterprise/card/cash vote spending.
- Opposition and Opposition Leader.
- Law pass/fail effects.
- Prime Minister transfer on failed law where rules require it.
- Special Deregulation vote when eligible.

Tests:

- Law draw and dilemma stop.
- Policy movement.
- Vote spending and pass/fail.
- Opposition Leader.
- Deregulation vote.
- Save/load during voting rounds.

### 12. Implement Upkeep And Refresh

Current behavior:

- Upkeep advances turn or enters starter Final Scoring.
- Upkeep returns writers from orders, clears order writers, and clears
  `filledThisTurnBy` markers.

Implement:

- Prize upkeep payments.
- Prize removal and VP loss if unpaid.
- Done: Writer return from filled orders.
- Done for current order state: Filled order token cleanup.
- TODO: Divider cleanup once divider state is encoded.
- Extra ship return.
- Done: Army refresh.
- Local alliance exhaustion.
- Turn advance and final-scoring trigger.

Current assumptions:

- Until order divider state is encoded separately, filled-order cleanup resets
  each order's `filledThisTurnBy` list and removes any order writer.
- Writer return uses the Presidency recorded on `order.writer` (the Presidency whose
  President placed it), which is the box the writer came from.
- Army refresh updates `company.armies[*]`, the only place officers and regiments are
  stored; per-player officer views come from `playerOfficers` in `src/engine/selectors.ts`.

Tests:

- Paid and unpaid prize upkeep.
- Done for current order state: Writer and order cleanup.
- Done: Army refresh.
- Final-turn transition.
- Save/load before and after cleanup.

### 13. Implement Final Scoring

Current behavior:

- Starter Final Scoring logs completion without calculating VP.

Implement:

- Firm scoring if deregulated.
- Power Award.
- Court/share scoring when Company survived.
- Court/share penalties and workshop scoring when Company failed.
- Final retirement if Company survived.
- Company failure card handling if Company failed.
- Tie breakers: window icons, then Prime Minister order.
- Final scoring summary UI.

Tests:

- Company survival scoring fixture.
- Company failure scoring fixture.
- Tie breakers.
- Final scoring summary contents.

### 14. Add Board Overlay Data And Inspect UI

Current UI shows three rough overlay labels.

Implement:

- Board coordinate data under `src/data/board.ts` or structured JSON.
- Regions.
- Orders.
- Offices.
- Company tracks.
- Presidencies.
- Deck/discard/display areas.
- Click handlers that select an entity and show an inspect panel.
- Pan, zoom, and layer toggles.

Every coordinate must be inside the `4902 x 2481` board image bounds and
validated by tests.

Actions must also remain available from panels/lists, not only board clicks.

### 15. Add Hotseat Privacy Curtain

Current UI exposes all state continuously.

Implement:

- Between private pending decisions, show pass-device curtain.
- Hide private cards and secret info.
- Require active player reveal click.
- Preserve public summary while hidden.

Tests:

- Private decision starts hidden.
- Correct player reveal displays command panel.
- Non-active private info is not rendered.

### 16. Add Negotiation And Consent Scaffold

Implement before deep consent-heavy rules are completed.

Starter support:

- Transfer family cash.
- Transfer promise cards.
- Transfer Company shares except Chairman share.
- Record negotiation note.
- Atomic command application.

Later support:

- Enterprises.
- Firm shares.
- Facedown blackmail.
- Consent prompts for nepotism, investments, dissolutions, mergers, ship fitting,
  local alliances, hostile takeovers, and Crown favors.

### 17. Complete Save And Async Features

Current state:

- Save Game, Load Game, and Copy Save Summary exist.

Add:

- `Save As` branch behavior.
- Parent save ID tracking in UI.
- Async branch warnings when loading older/forked saves for the same `gameId`.
- `Export Log` as markdown or text.
- Friendly corrupt-save and incompatible-version errors.
- Save/load coverage during every pending decision type.

### 18. Add Rules Reference

Current state:

- Rules Reference button is disabled.

Implement:

- Search over `John-Company-Rules.txt`.
- Curated section index:
  - Setup
  - Negotiation
  - Sequence of Play
  - London Season
  - Family
  - Hiring
  - Company Operation
  - Revenue
  - Events in India
  - Parliament
  - Upkeep
  - Deregulation
  - Final Scoring
  - Crown Handbook
- Contextual rule links from action panels.

### 19. Add Linting And Verification Scripts

`package.json` has `verify`, but no lint command.

Add:

- ESLint config.
- `npm run lint`.
- Include lint in `npm run verify`.

Keep this scoped; do not format unrelated docs/PDF assets.

## Deregulation And Firms

Implement after non-deregulated `1710` hotseat play is stable.

Rules needed:

- Deregulation trigger and scenario start state.
- Firm formation.
- Firm investment with Company shares/workshops.
- Firm shares and ownership.
- Ship acquisition and fitting.
- Hostile takeovers.
- Mergers.
- Secret firm strategy selection.
- Firm trading and initiative.
- Firm expenses, dividends, dissolution, emergency investment, and emergency
  merger.
- Firm final scoring.

Tests:

- Firm creation and investment.
- Secret strategy save/load.
- Trade initiative.
- Duplicate order half value.
- Expenses/dividends/dissolution.
- Firm final scoring.

## Crown TODO

Crown mode currently initializes some state in `createNewGame`, but
`src/data/validate.ts` correctly blocks Crown modes because AI cards are
placeholders.

Do not remove that block until:

- All 10 Crown AI cards are encoded.
- Crown family board data is encoded.
- Crown climate/profile tables are encoded.
- Crown favor definitions are encoded.
- Crown voting plan is encoded.
- Crown setup distributions are complete.
- Crown difficulty adjustments are complete.
- Crown solo final scoring adjustment table is encoded.
- Crown setup tests pass for solo and two-player.
- At least one Crown automated phase test passes for each major phase.

Rules needed:

- Crown setup, promise cubes, AI deck reveal, climate, and Player Button.
- Crown AI card tie breakers.
- Promise-cube closed economy.
- Legal and mandatory Crown favors.
- Crown Family action priority.
- Crown Hiring behavior and Chairman support/bribes.
- Crown office automation for every Company Operation office.
- Crown Revenue behavior, Royal Privilege, and Royal Protection.
- Crown Crisis defense choices.
- Crown Parliament voting plan, treasury vote bands, climate shift, and policy
  movement.
- Crown Upkeep.
- Crown final retirement and solo scoring adjustments.

## UI TODO

Current UI is intentionally simple.

Next improvements:

- Keep setup validation visible and specific.
- Make pending command buttons visually distinct by type.
- Show disabled-action reasons.
- Add selected entity inspect panel for board clicks.
- Add log details expansion.
- Add Save As and Export Log controls.
- Add pass-device privacy curtain.
- Add negotiation modal.
- Add rules reference.
- Keep all actions available from panels/lists, not only board clicks.

## Handoff Notes

When adding a phase or replacing starter behavior:

1. Add or update static data first.
2. Add command type to the dispatcher.
3. Add legal command generator.
4. Add reducer.
5. Add phase transition.
6. Add log entry.
7. Add tests for success, illegal command rejection, and save/load.
8. Run `npm run typecheck`, `npm test`, and `npm run build`.

When replacing starter behavior with real rules:

- Keep the old starter test until the real equivalent passes.
- Update log summaries to describe actual rule effects.
- Avoid placeholder cash/piece movement.
- Do not bypass validation to make the UI proceed.
- Do not implement Crown AI by guessing.
