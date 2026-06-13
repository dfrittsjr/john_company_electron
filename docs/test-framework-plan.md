# Test Framework And Final Evaluation Plan

Use this plan to evaluate the completed John Company digital implementation against the design documents and source rules. The goal is not just "tests pass"; the final product must prove that it enforces the game, preserves state, and supports full hotseat, async, solo, and two-player Crown play.

## Evaluation Principles

- Source-traceable: every rule test should reference a rulebook section, Crown Handbook section, card id, scenario id, or board/source component.
- Deterministic: all shuffles, dice, Crown AI draws, law draws, event draws, and failure cards use seeded RNG in tests.
- State-first: engine tests inspect `GameState`, pending decisions, logs, and save envelopes directly.
- UI-as-client: UI tests interact through user-visible controls and assert that commands sent to the engine are legal.
- Regression-ready: every bug found during playtest gets a focused reducer or fixture test before it is marked fixed.
- No manual JSON repair: final evaluation fails if any supported game path requires editing save files or state by hand.

## Tooling Baseline

Recommended tools:

- Unit and reducer tests: Vitest.
- Static validation: TypeScript, ESLint, data schema validation with Zod or JSON Schema.
- Property and invariant tests: `fast-check` or equivalent.
- UI and Electron smoke tests: Playwright.
- Visual board checks: Playwright screenshots plus image-diff thresholds for critical screens.
- Coverage: V8 coverage through Vitest.

Required npm scripts once implemented:

```json
{
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "test:data": "vitest run src/tests/data",
  "test:rules": "vitest run src/tests/rules",
  "test:save": "vitest run src/tests/save",
  "test:crown": "vitest run src/tests/crown",
  "verify": "npm run typecheck && npm run lint && npm run test:data && npm run test:rules && npm run test:save && npm run test:crown && npm run test:e2e"
}
```

## Test Taxonomy

### Data Validation Tests

Purpose: prove all static content is encoded and internally consistent.

Must validate:

- Scenario setup data for `1710`, `1758`, `1813`, and `Long 1710`.
- Setup cards and setup distributions.
- Regions, adjacency, orders, home ports, export icons, loot/control tokens, and board coordinates.
- Offices, office order, office actions, hiring pools, and created/vacant states.
- Enterprise, prestige, blackmail, law, dilemma, India event, storm die, and prize data.
- Crown family board, AI cards, climate states, decision profiles, favor definitions, voting plan, and solo scoring adjustment table.

Required checks:

- Every referenced id exists.
- Component counts never exceed physical limits unless a rule explicitly permits it.
- Every data record has a `source` field.
- Board overlay coordinates are inside the `4902 x 2481` board image bounds.
- Crown AI cards contain all tie-break and profile fields required by `docs/crown-ai-design.md`.
- Missing data blocks affected scenarios or modes with explicit validation errors.

### Reducer And Rule Tests

Purpose: prove the engine accepts legal commands, rejects illegal commands, and produces the correct next state.

Required pattern:

```ts
test("rule name or behavior", () => {
  const state = fixture("fixture-id");
  const result = applyCommand(state, command);
  expect(result.state).toMatchRuleSnapshot("expected-state-id");
  expect(result.state.pendingDecision).toEqualExpectedDecision(...);
  expect(result.state.log).toContainRuleLog(...);
});
```

Every reducer test should assert:

- State changes.
- Component movement source and destination.
- Cash flow source and destination.
- Pending decision after the command.
- Event log entry.
- RNG rolls consumed, if any.
- Illegal alternatives and disabled-action reasons for the same decision.

Major reducer suites:

- Setup.
- Negotiation and promises.
- London Season.
- Family.
- Firms and Deregulation.
- Hiring.
- Company Operation by office.
- Bonuses.
- Revenue.
- Events in India.
- Parliament.
- Upkeep and Refresh.
- Final Scoring.
- Crown AI by phase.

### Invariant Tests

Purpose: catch impossible states after arbitrary legal command sequences.

Run invariant checks after every reducer test and during scripted playthroughs.

Core invariants:

- Each physical family piece is in exactly one location.
- Cash totals obey bank/unlimited-bank rules and player/company treasury changes are explained by logs.
- Company Debt, Balance, Standing, Expectations, share value, vote marker, and policy/power tracks remain within legal bounds.
- Offices cannot be simultaneously vacant and held.
- Pieces cannot appear in offices, armies, orders, prizes, and supplies at the same time.
- Filled order tokens are removed during upkeep.
- Hidden information remains hidden in UI-facing projections.
- Pending decisions always reference a valid actor and legal command set.
- Save/load round trips preserve state, log, RNG state, hidden metadata, and pending decision.
- Crown promise cubes always total 12.
- In two-player Crown mode, the Player Button always has exactly one human holder.

Property tests should generate legal command sequences for narrow subsystems first, then expand to full-turn scripted command generation.

### Save And Async Tests

Purpose: prove a game can stop and resume anywhere, including async handoff.

Required fixtures:

- Save before and after every phase transition.
- Save during each major pending decision type.
- Save after dice rolled but before follow-up allocation.
- Save during negotiation.
- Save during consent prompts.
- Save during Parliament voting rounds.
- Save during simultaneous firm strategy selection.
- Save during Crown favor windows and automated Crown decisions.

Assertions:

- Loaded save resumes the exact same pending decision.
- RNG state continues without rerolling prior results.
- Hidden info projections remain correct after load.
- Checksums detect corrupted state.
- Unknown or incompatible schema versions fail with readable errors.
- Async branch warnings appear when loading older saves from the same `gameId`.

### Crown AI Tests

Purpose: prove solo and two-player modes execute the Crown without manual choices.

Required suites:

- Crown setup: solo draft, solo random, two-player draft, easy/normal/hard/expert difficulty.
- AI-card tie breakers: Presidency arrows, direction, splay position, region priority, climate mapping.
- Promise-cube economy: cost, reward, mandatory favors, insufficient Crown cube rewards, two-player cube trading.
- Player Button: initial holder, contested decisions, automatic pass, negotiation transfer.
- Crown Family: free writer enlistment, action priorities, extra actions, share/writer placement.
- Crown Hiring: Chairman election, bribes, nepotism, candidate priorities.
- Crown Company Operation: Chairman, Director of Trade, Governor General, Shipping, Military Affairs, Presidents, Commanders, Governors, China.
- Crown Revenue: dividends, Royal Protection, Royal Privilege, firm emergency investment, firm dividends.
- Crown Parliament: climate shift, treasury vote bands, voting plan, Crown as Prime Minister, Crown as Opposition Leader, policy movement.
- Crown final scoring: hard/expert final retirement and solo Company-failure VP adjustment.

Every Crown automated decision test should record:

- Current AI card.
- Current climate.
- Applicable decision profile or favor table row.
- Tie-break source.
- Resulting command or generated state transition.

### UI And Interaction Tests

Purpose: prove the renderer exposes legal gameplay without manual state editing.

Required Playwright flows:

- Start menu opens.
- New game setup validates required fields and missing data.
- Each scenario can start.
- Board image renders and overlays are nonblank.
- Pan, zoom, layer toggles, and inspect panels work.
- Action panel lists legal commands and disabled reasons.
- Negotiation modal performs atomic transfers.
- Hotseat privacy curtain hides private data between players.
- Rules reference search and contextual links work.
- Save, Save As, Load, Export Log, and Copy Save Summary work.
- Final scoring screen explains each VP source.
- Crown setup, Crown favor drawer, Crown action preview, Player Button, and hidden Crown data all behave correctly in Crown modes.

Visual checks:

- Board and overlays fit desktop and narrow-window layouts.
- Text does not overlap or overflow in action panels, dashboards, modals, and final scoring.
- Important board markers are visible at default zoom.
- Hidden information is not visible in screenshots for the wrong active player.

### Accessibility And Usability Tests

Required checks:

- All board-click actions have list/dropdown alternatives.
- Keyboard navigation reaches every primary control.
- Focus state is visible.
- Color is not the only indicator for player ownership, action availability, or danger.
- Disabled actions include readable reasons.
- Dice results and random draws are logged textually.
- Save/load and active pending decision are always reachable.

### Performance And Reliability Tests

Required thresholds for final evaluation:

- New game setup completes in under 2 seconds on a typical development laptop.
- Save and load of a late-game save completes in under 2 seconds.
- Board pan/zoom remains responsive with all overlays enabled.
- Full validation of static data completes in under 1 second in test mode.
- A scripted full game can run headlessly without memory growth that suggests retained stale states.

## Fixture Strategy

Use fixtures instead of ad hoc test setup.

Recommended structure:

```text
src/tests/fixtures/
  setup/
  phases/
  saves/
  crown/
  full-games/
```

Fixture metadata:

```ts
type RuleFixture = {
  id: string;
  description: string;
  sourceRefs: string[];
  state: GameState;
  expected?: unknown;
};
```

Fixture rules:

- Keep fixtures small for reducer tests.
- Use full save envelopes for save/load tests.
- Store seed and RNG state explicitly.
- Prefer readable fixture builders for common setup, then serialize golden saves for regression.
- Snapshot only stable rule-relevant output; do not snapshot entire UI DOM trees.

## Source Traceability Matrix

Maintain a machine-readable matrix that maps source material to tests.

Example:

```json
{
  "rule.london-season.retirement": {
    "sources": ["John-Company-Rules.txt:London Season"],
    "tests": ["london-season.retire-pensioner", "london-season.display-order"]
  },
  "crown.family.free-writer": {
    "sources": ["Crown Handbook p2 Free Writer Enlistment"],
    "tests": ["crown.family.free-writer-four-vacancies"]
  }
}
```

Final evaluation should fail if any required source area in the design documents has no mapped test or an explicit documented exception.

## Coverage Targets

Coverage is not the only quality gate, but it prevents untested reducers from landing.

Minimum final thresholds:

- `src/engine`: 90% line coverage, 85% branch coverage.
- `src/save`: 90% line coverage, 90% branch coverage.
- `src/data`: 100% schema-load coverage for data files.
- Crown decision handlers: 90% branch coverage across climate/profile branches.
- UI smoke tests: every required screen and modal has at least one test.

Known acceptable gaps:

- Pure styling code may be below engine thresholds.
- Electron native dialog behavior can be covered through adapter mocks plus one smoke test.

## Full-Game Evaluation

Final product evaluation must include scripted and human playthroughs.

Scripted playthroughs:

- `1710`, 3-player hotseat, Company survives.
- `1710`, 3-player hotseat, Company fails.
- `1758`, deregulation path.
- `1813`, firms from start.
- `Long 1710`, late-game scoring.
- Solo Crown game through final scoring.
- Two-player Crown game through at least one full turn after Deregulation and one final scoring path.

Human exploratory playthroughs:

- One complete 3-6 player hotseat game.
- One async handoff test where at least three separate saves are passed between machines or clean local profiles.
- One solo Crown game using normal difficulty.
- One two-player Crown game using Player Button, promise cubes, and Crown favors.

Every playthrough should produce:

- Save files at key points.
- Exported log.
- Bug list with reproduction save id.
- Final scoring summary.

## Release Gates

The implementation is ready for final evaluation only when:

- `npm run verify` passes.
- Static data validation passes with no missing required data.
- Every supported scenario starts and reaches a valid first pending decision.
- Every major phase has reducer tests and at least one save/load mid-phase fixture.
- Crown modes pass setup, phase automation, save/load, and final scoring tests.
- UI smoke tests cover every required screen.
- Traceability matrix has no required unmapped source areas.

The final product passes evaluation only when:

- All release gates pass.
- Scripted full-game tests pass.
- Manual playthroughs complete without state editing.
- Any known defects are documented and do not block rules enforcement, save/load, hidden information, Crown automation, or final scoring.

## Bug Triage During Evaluation

Severity levels:

- `blocker`: corrupts saves, permits illegal irreversible state, blocks completing a supported game, reveals hidden information, or breaks Crown automation.
- `major`: enforces a rule incorrectly, loses log/RNG determinism, or makes a common legal action inaccessible through UI.
- `minor`: presentation issue, unclear text, missing disabled reason, or nonblocking usability problem.
- `trivial`: typo or cosmetic issue with no gameplay impact.

Rules:

- No blockers can remain.
- Major bugs require either a fix or a documented explicit deferral before release.
- Every fixed blocker or major bug gets a regression test.
- Evaluation saves that reproduce bugs should be retained under `src/tests/fixtures/regressions`.
