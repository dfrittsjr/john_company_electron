# First Pass Implementation TODO

This document tracks the remaining work for the current first-pass implementation. It is narrower than `docs/implementation-plan.md`: use it when continuing from the existing scaffold in `src/`.

Current state:

- Vite + React + TypeScript + Electron shell exists.
- Board image renders.
- `GameState`, `PendingDecision`, command validation, RNG, save envelope, and starter data validation exist.
- Setup can create a starter game.
- `setup.confirmStart` advances to Family.
- `family.chooseAction` has starter buttons and advances through human players.
- `hiring.pass` has starter buttons and advances through human players.
- Current next stop is `companyOperation.notImplemented`.
- Crown data is intentionally placeholder-level and Crown modes should remain blocked by validation until Crown AI cards/profiles are encoded.

Always run before handing off:

```bash
npm run typecheck
npm test
npm run build
```

## Immediate Goal

Make one hotseat `1710` starter game advance through every phase to final scoring without manual state editing. It does not need full rules yet, but every pending decision must have at least one legal command, a reducer, a log entry, and a test.

## Current Scaffold Stops

Known pending-decision boundaries that still need starter commands:

- `companyOperation.notImplemented`
- Future likely stops after adding Company Operation:
  - `bonuses.notImplemented`
  - `revenue.notImplemented`
  - `eventsInIndia.notImplemented`
  - `parliament.notImplemented`
  - `upkeep.notImplemented`
  - `finalScoring.notImplemented`

Each stop should be replaced with:

- A real `step` name.
- One or more `legalCommands`.
- A reducer branch in `src/engine/commands.ts` or a phase-specific reducer module.
- A log entry.
- Tests in `src/tests/engine/commands.test.ts` or a new phase test file.

## Recommended Order

### 1. Split Command Reducers By Phase

Current file:

- `src/engine/commands.ts`

Recommended next structure:

```text
src/engine/commands.ts
src/engine/phases/setup.ts
src/engine/phases/family.ts
src/engine/phases/hiring.ts
src/engine/phases/company-operation.ts
src/engine/phases/bonuses.ts
src/engine/phases/revenue.ts
src/engine/phases/events-in-india.ts
src/engine/phases/parliament.ts
src/engine/phases/upkeep.ts
src/engine/phases/final-scoring.ts
```

Keep `applyCommand` as the dispatcher and move phase logic out as files grow.

### 2. Add Starter Phase Progression Through A Full Turn

Add minimal pass/confirm commands for each phase:

- `companyOperation.passOffice`
- `bonuses.confirm`
- `revenue.confirm`
- `eventsInIndia.confirm`
- `parliament.confirm`
- `upkeep.confirm`
- `turn.advance` or `finalScoring.start`

Starter behavior:

- Do not fake full rules.
- Log that the starter scaffold skipped or confirmed the phase.
- Advance to the next phase.
- Preserve `turn`, `phase`, `pendingDecision`, and `log` correctly.
- At Upkeep, advance turn or enter final scoring based on `finalTurn`.

Tests to add:

- One test for each phase command.
- One scripted test that starts a 3-player `1710` game and advances through one full turn.
- One scripted test that advances to final scoring using a short fixture or modified final turn.

### 3. Add Real Save/Load UI

Engine/save code exists, but UI buttons are disabled.

Implement:

- Electron preload methods for save/load dialogs.
- Main-process handlers for writing and reading `.joco`.
- Renderer buttons:
  - `Save Game`
  - `Save As`
  - `Load Game`
  - `Copy Save Summary`
- Friendly error display for invalid/corrupt saves.

Files likely touched:

- `main.cjs`
- `src/electron/preload.cjs`
- `src/ui/App.tsx`
- `src/save/*`

Tests:

- Save envelope roundtrip already exists; add UI or adapter tests when Electron IPC wrappers exist.

### 4. Add Scenario Setup Validation To New Game UI

Data validators exist in `src/data/validate.ts` but setup UI currently does not use them.

Implement:

- Before creating a game, call `validateNewGameStaticData`.
- Hotseat starter scenarios may proceed with starter data.
- Crown modes must show validation errors until Crown data is complete.
- Show missing data categories in the setup panel.

Important:

- Do not silently allow Crown modes with placeholder AI cards.
- Do not invent Crown AI behavior.

### 5. Replace Starter Family Actions With Minimal Real Effects

Current:

- Family action choices only record the selected action.

Add first real effects in this order:

- `Enlist Writer`: choose Presidency and place writer.
- `Enlist Officer`: add officer in training.
- `Seek Share`: place family member in the cheapest legal stock exchange slot.
- `Purchase Workshop`: spend cash and add placeholder workshop enterprise only after enterprise data exists.
- `Purchase Shipyard`
- `Purchase Luxury`

Required supporting data:

- Family action definitions.
- Starting cash from setup.
- Stock exchange slot data.
- Enterprise deck starter data.

Tests:

- Legal/illegal action availability based on cash and pieces.
- Component source and destination.
- Opportunity marker update.
- Out-of-family-pieces behavior later, once prizes exist.

### 6. Replace Starter Hiring Pass With Minimal Office Hiring

Current:

- `hiring.pass` records each player passing.

Add:

- Office data and office order.
- Candidate pool generation.
- Vacant office decision.
- Hire command.
- Skip/pass only when no eligible candidate or no office data exists.

First supported hiring flow:

- Chairman election by Company shares.
- One office vacancy with eligible writer/officer.
- Fatigue transfer placeholder.

Tests:

- Candidate pool includes legal candidates.
- Illegal candidates rejected.
- Hiring advances through office order.
- Chairman election support works once shares exist.

### 7. Add Minimal Company Operation Office Loop

Replace `companyOperation.notImplemented`.

First starter version:

- Iterate through offices in red-ribbon order.
- If no office data/holder, skip with log.
- If human officeholder, show one starter command:
  - `companyOperation.passOffice`
- After all offices, advance to Bonuses.

Then add real office reducers in this order:

- Chairman debt/allocation.
- Director of Trade open order/China placeholder.
- Manager of Shipping fit/place ship placeholder.
- Military Affairs transfer/assign placeholder.
- President trade placeholder.
- Commander deploy placeholder.
- Governor administer placeholder.

Tests:

- Office loop skips vacant offices.
- Human officeholder receives pending decision.
- Pass advances to next office.
- End of office loop advances to Bonuses.

### 8. Add Board Overlay Data

Current UI shows three rough overlay labels only.

Implement:

- Board coordinate data under `src/data/board.ts` or JSON.
- Regions.
- Orders.
- Offices.
- Company tracks.
- Presidencies.
- Click handlers that select an entity and show an inspect panel.

First pass can use rough coordinates, but every coordinate must be inside the `4902 x 2481` image bounds and validated by tests.

### 9. Add Hotseat Privacy Curtain

Current UI exposes all state continuously.

Implement:

- Between private pending decisions, show pass-device curtain.
- Hide private cards/secret info.
- Require active player reveal click.

Tests:

- Private decision starts hidden.
- Correct player reveal displays command panel.
- Non-active private info not rendered.

### 10. Add Negotiation Scaffold

Implement before deep phase rules because many future rules need consent/transfers.

Starter support:

- Transfer family cash.
- Transfer promise cards.
- Transfer Company shares except Chairman share.
- Record negotiation note.
- Atomic command application.

Later:

- Enterprises.
- Firm shares.
- Facedown blackmail.
- Consent prompts.

### 11. Improve Tests And Fixtures

Current tests:

- Data validation.
- RNG.
- Command scaffolds.
- Save roundtrip.

Add:

- `src/tests/fixtures/`
- Builder helpers for common games.
- One full starter-turn scripted test.
- Save/load during each current pending decision type.
- Invariant checks after every command:
  - active actor exists.
  - pending legal commands are known command types.
  - log sequence is contiguous.
  - Crown promise cubes total 12 in Crown games.

### 12. Add Linting

`package.json` has no ESLint script yet, while docs require it.

Add:

- ESLint config.
- `npm run lint`.
- Include lint in `npm run verify`.

Keep this scoped; do not add formatting churn across docs/PDF assets.

## Data Entry TODO

Use `docs/data-entry-checklist.md` as the canonical list. First-pass priority:

1. Component counts.
2. Scenario starting tracks and setup cards.
3. Office order and office definitions.
4. Family actions.
5. Board regions and adjacency.
6. Stock exchange slots.
7. Enterprise placeholder decks.
8. Crown AI cards only after card data can be transcribed accurately.

## Crown TODO

Crown mode currently initializes some state in `createNewGame`, but `src/data/validate.ts` correctly blocks Crown modes because AI cards are placeholders.

Do not remove that block until:

- All 10 Crown AI cards are encoded.
- Crown climate/profile tables are encoded.
- Crown favor definitions are encoded.
- Crown voting plan is encoded.
- Crown setup tests pass for solo and two-player.
- At least one Crown automated phase test passes for each major phase.

## UI TODO

Current UI is intentionally simple.

Next improvements:

- Show validation errors on setup.
- Disable Start when selected mode is not supported by current data.
- Make pending command buttons visually distinct by type.
- Add selected entity inspect panel for board clicks.
- Add log details expansion.
- Add save/load controls.
- Keep all actions available from panels/lists, not only board clicks.

## Handoff Notes

When adding a phase:

1. Add command type to dispatcher.
2. Add legal command generator.
3. Add reducer.
4. Add phase transition.
5. Add log entry.
6. Add tests for success and illegal command rejection.
7. Run `npm run typecheck`, `npm test`, and `npm run build`.

When replacing starter behavior with real rules:

- Keep the old starter test until the real equivalent passes.
- Update log summaries to describe actual rule effects.
- Avoid placeholder cash/piece movement.
- Do not bypass validation to make the UI proceed.
