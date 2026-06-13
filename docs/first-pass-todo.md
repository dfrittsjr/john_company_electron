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

Use `docs/data-entry-checklist.md` as the canonical data checklist, but enter
data in the order needed by gameplay.

First priority:

1. Component counts.
2. `1710` scenario setup card data.
3. Family action definitions and costs.
4. Stock exchange slots and Company share data.
5. Office order and office definitions.
6. Presidency/army/region IDs needed by Family and Hiring.
7. Board regions, order graph, and adjacency.
8. Enterprise placeholder decks only when real purchase effects need them.

Do not mark advanced scenarios complete until their setup cards, scenario tracks,
map setup, laws, and Deregulation state are encoded.

### 4. Replace Starter Family Actions With Real Effects

Current behavior:

- `family.chooseAction` records the selected action and moves to the next
  player.

Implement:

- Legal action filtering by cash, pieces, and scenario state.
- `Enlist Writer`: choose Presidency and place writer.
- `Enlist Officer`: add officer in training.
- `Seek Share`: place a family member in the cheapest legal stock exchange slot.
- `Purchase Workshop`: spend cash and draw/place a workshop enterprise once
  enterprise data exists.
- `Purchase Shipyard`.
- `Purchase Luxury`.
- Opportunity marker double-action rule.
- Extra family action from the most recent applicable law once laws exist.
- No-action only when the player truly cannot act.
- Out-of-family-pieces rule once prizes exist.
- Share creation from Company Debt after all players act.

Tests:

- Legal and illegal action availability.
- Cash and piece source/destination.
- Opportunity marker behavior.
- Share creation from debt.
- Save/load during each Family decision type.

### 5. Replace Starter Hiring Pass With Office Hiring

Current behavior:

- `hiring.pass` records each player passing.

Implement:

- Office vacancy order.
- Hirer determination from office data.
- Candidate pool generation.
- Chairman election by Company-share majority.
- Hire command.
- Skip only if no hirer or no eligible candidate exists.
- Nepotism consent prompt.
- Promotion and fatigue transfer.

Tests:

- Chairman election.
- Candidate pool includes legal candidates and rejects illegal ones.
- Nepotism consent accepted and denied.
- Hiring advances through office order.
- Save/load during a hire and a consent prompt.

### 6. Implement London Season

Current behavior:

- Starter London Season is a system confirmation.

Implement:

- Skip on first turn where rules require it.
- Office attrition.
- Retirement rolls, including Chairman stress modifier.
- Pensioner retirement to prize boxes by paying costs and gaining VP.
- London Season Display order based on retirement spending.
- Prestige/blackmail card selection and discard.
- Display refill.
- Return remaining pensioners to family supplies.

Tests:

- Attrition and retirement roll behavior.
- Prize payment and VP award.
- Card display selection.
- Save/load after rolls and before card selection.

### 7. Add Minimal Company Operation Office Loop

Current behavior:

- One system command confirms Company Operation.

Implement first:

- Red-ribbon office order.
- Skip vacant/uncreated offices with log entries.
- Human officeholder pending decision.
- `companyOperation.passOffice` only as a temporary fallback per office.
- End of office loop advances to Bonuses.

Then replace office pass behavior in this order:

1. Chairman debt and allocation.
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

- Starter Bonuses is a system confirmation.

Implement:

- `GBP 1` for each workshop.
- `GBP 1` for each shipyard with a fitted ship.
- Correct income ownership and log entries.

Tests:

- Workshop income.
- Fitted and unfitted shipyard income.
- Save/load at phase start.

### 9. Implement Revenue

Current behavior:

- Starter Revenue is a system confirmation.

Implement:

- Company expenses for Debt, armies, and ships.
- Emergency loans.
- Public embarrassment.
- Expectations check.
- Chairman dividend decision.
- Standing increase from dividends over Expectations.
- Company failure trigger.

Tests:

- Expenses and emergency loans.
- Public embarrassment and Standing movement.
- Dividends and share payouts.
- Company failure.
- Save/load after expenses and before dividends.

### 10. Implement Events In India

Current behavior:

- Starter Events in India is a system confirmation.

Implement:

- Storm die.
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

- Deterministic storm/event draws from RNG.
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

- Starter Upkeep advances turn or enters starter Final Scoring.

Implement:

- Prize upkeep payments.
- Prize removal and VP loss if unpaid.
- Writer return from filled orders.
- Filled order token and divider cleanup.
- Extra ship return.
- Army refresh.
- Local alliance exhaustion.
- Turn advance and final-scoring trigger.

Tests:

- Paid and unpaid prize upkeep.
- Writer and order cleanup.
- Army refresh.
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
