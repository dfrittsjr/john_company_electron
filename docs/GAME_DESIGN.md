# John Company Second Edition Digital Implementation Design

This document is the entry point for an AI coding agent building a complete local desktop version of `John Company: Second Edition` from this project. It assumes hotseat play on one PC, asynchronous save-file handoff, and solo/two-player play through the Crown system.

## Source Material In This Project

- `John-Company-Rules.pdf`: official rules PDF.
- `John-Company-Rules.txt`: extracted rule text used for implementation research.
- `John_Company_2e_Crown_Handbook_for_BGG_(prepress).pdf`: Crown Handbook for solo and two-player Crown AI behavior.
- `John Company Game Board.pdf`: board source PDF.
- `board_image-1.png`: board image, `4902 x 2481`, suitable as the rendered board background.
- `index.html`: prior Gemini pass. Treat as a visual sketch only; it references missing `styles.css` and `js/app.js` and is not a working implementation.
- `package.json`: minimal Electron package.

## Product Goal

Build a desktop GUI game that lets players complete an entire game of John Company Second Edition without the physical board.

Required play forms:

- Hotseat multiplayer for 3-6 human players.
- Solo and two-player modes against the Crown AI.
- Local save/load at any point.
- Asynchronous play by exporting a save file, sending it to another player, loading it on their machine, making decisions, saving, and passing it onward.

## Implementation Stance

The game should be rules-enforced, not just a freeform board simulator. Players should be presented only legal actions whenever possible. Complex negotiation is still player-driven, but asset transfers, promises, vote commitments, and consent checks must be recorded in game state.

Do not hard-code one-off UI behavior. Implement the game as deterministic state transitions over a serializable game state. The renderer should dispatch commands to the game engine. The game engine should validate commands, apply reducers, append log entries, and return the next pending decision.

## Recommended Stack

Use the existing Electron intent, but rebuild the application around a maintainable TypeScript stack.

- Runtime: Electron desktop app.
- Renderer: React + TypeScript + Vite.
- Board rendering: SVG or Canvas overlay over `board_image-1.png` using the image's native `4902 x 2481` coordinate space.
- State engine: TypeScript pure reducers plus a thin store such as Zustand or Redux Toolkit.
- Persistence: JSON save files with extension `.joco`.
- Tests: Vitest for engine reducers and rule fixtures.
- Styling: CSS modules or a small utility system; preserve a readable period-inspired style without sacrificing clarity.

## High-Level Architecture

Use these top-level modules:

- `src/engine`: pure game logic, rules validation, command reducers, phase sequencing, dice/RNG, scoring.
- `src/data`: structured JSON/TS data for cards, offices, scenarios, regions, board coordinates, policies, Crown AI data.
- `src/save`: save schema, migrations, import/export, validation, optional hidden-info protection.
- `src/ui`: React screens, board components, action panels, modals, hotseat privacy curtain.
- `src/electron`: file dialogs, native menu, app shell, safe preload APIs.
- `src/tests`: rule tests and scenario fixtures.

Renderer code must not mutate game state directly. All state changes go through engine commands.

## Core Game Loop

Every game state has exactly one active phase and one or more pending decisions. A pending decision describes who must act, what choices are legal, and whether the decision can be skipped.

Game turns follow this order:

1. Optional special Deregulation vote at the start of a turn in eligible scenarios.
2. London Season.
3. Family.
4. Firms, only after Deregulation is in effect.
5. Hiring.
6. Company Operation.
7. Bonuses.
8. Revenue.
9. Events in India.
10. Parliament Meets.
11. Upkeep and Refresh.
12. Advance turn or final scoring.

The engine must support pausing and saving in the middle of any decision, including a dice roll result awaiting allocation, a negotiation transfer, a multi-step office action, or simultaneous secret firm strategy selection.

## Important Rules Areas

The implementation must cover these systems:

- Setup for `1710`, `1758`, `1813`, and `Long 1710` scenarios.
- Player family pieces, cash, enterprises, shares, promises, prizes, pensioners, offices, writers, officers, commanders, ships, trophies, passed laws, spouses, blackmail.
- Company health: Standing, Balance, Debt, Expectations, share value, Court of Directors.
- Region state for all eight regions: strength/tower, dome, empire flag/capital/dominated status, Company control, governorship, orders, loot/control token, unrest, export icons, adjacency.
- Presidency state for Bombay, Madras, Bengal: president, army, commander, treasury, writers, sea zone, governors, associated regions.
- Negotiation: binding immediate transfers and non-binding promises.
- London Season: attrition, retirements, prestige/blackmail display, spouse restrictions, discounts.
- Family actions: enlist writer, enlist officer, purchase luxury, purchase shipyard, purchase workshop, seek share, extra actions from laws.
- Hiring: office order, candidate pools, nepotism consent, promotions, vacancies.
- Company Operation: Chairman, Director of Trade, Manager of Shipping, Military Affairs, Presidency operations, Commanders, Governors, Superintendent of Trade in China, Governor General.
- Trade path validation for orders, filled-order tokens, home ports, closed orders, writers, dividers, and firm/company overlap.
- Deploy, loot distribution, trophies, governorship creation, region conquest, elephant redirect.
- Governor administer dice pools, taxation, unrest, ship construction, regiment commissioning.
- Revenue: expenses, emergency loans, public embarrassment, expectations, dividends, public enthusiasm.
- Events in India: storm die, storms, event tiles, cascade, elephant march, turmoil, windfall, shuffle, leader, peace, crisis, foreign invasion, attacks against Company, region loss.
- Parliament: law draw/selection, policy dial, taxes, bonuses, power marker swaps, voting rounds, opposition leader, law pass/fail, deregulation vote.
- Upkeep and refresh: prize upkeep, writer return, filled-order cleanup, extra ship cleanup, army refresh, local alliance exhaustion, turn advance.
- Deregulation: firms, investments, firm strategy, firm trade, initiative, firm expenses, dividends, dissolution, emergency investment/merger, hostile takeover, mergers, final scoring.
- Final scoring and tie breakers.
- Crown solo/two-player behavior, including setup, difficulty, AI cards, climate, promise cubes, Player Button, favors, office automation, Crown Parliament voting, Crown Revenue, and solo final scoring adjustments.

## Crown AI Requirement

The Crown Handbook PDF is present in this project. Solo and two-player support is therefore a first-class implementation target, not a placeholder.

Implementation requirement:

- Create a data-driven Crown module with structured Crown AI cards, climate, tie breakers, promise cubes, Player Button, favors, and phase decision handlers.
- Encode the Crown Handbook's phase tables as data keyed by climate/card/profile, with named effect handlers for complex consequences.
- Support Crown setup for `soloCrown` and `twoPlayerCrown`, including 36 Crown family pieces, difficulty adjustments, setup-card distribution, AI deck initialization, and promise-cube allocation.
- In each normal phase, route decisions through either human rules plus Crown favor windows or automated Crown office behavior.
- Expose the Crown as optional setup state for 1-2 player games; disable those modes only when required Crown data validation fails.
- Temporary manual-Crown debug mode may exist for development, but it must not be advertised as full solo/two-player play.

See `docs/crown-ai-design.md` for the concrete Crown state, setup, phase, UI, and test requirements.

## Save And Async Requirement

Save files are first-class gameplay artifacts. A save must contain everything needed to resume on a different machine:

- Full game state.
- Structured data version.
- RNG seed and current RNG state.
- Ordered event log.
- Current pending decision.
- Active player/actor.
- Hidden information metadata.
- Optional player names and local UI preferences.

See `docs/save-and-async.md` for the concrete save contract.

## GUI Requirement

The GUI must make the complete game playable without manual state editing.

Required screens:

- Start menu: new game, load game, rules/reference, settings.
- New game setup: scenario, player count, player names/colors, Crown difficulty, setup card draft/random mode.
- Main board: zoomable/pannable board image with interactive overlays.
- Player dashboard: active family, cash, pieces, promises, enterprises, prizes, offices, votes, power.
- Phase/action panel: current phase explanation, legal actions, costs, dice preview, confirmation.
- Negotiation modal: immediate transfers, promise cards, consent prompts, deal log.
- Hotseat privacy screen: hides private info between active players.
- Rules reference: searchable local rules text, plus contextual rule links from actions.
- Save/load/export log dialogs.
- Final scoring screen.

See `docs/gui-design.md` for detailed UI behavior.

## Data Encoding Requirement

The largest implementation task is data entry and validation. Add all game content as structured data, not as code branches.

Data sets required:

- Scenarios and setup card effects.
- Family colors/names and component counts.
- Regions, orders, adjacency, home ports, export icons, loot values, initial map states.
- Office cards, order numbers, office actions, hiring pools.
- Prize boxes with cost, upkeep, VP, window icons.
- Enterprise decks: shipyards, workshops, luxuries.
- Prestige and blackmail cards, including special powers and restrictions.
- Law deck, dilemma data, starting support, policy icons, immediate/pass/fail effects.
- Policy track spaces and power track spaces.
- India event tiles and storm die faces.
- Crown AI cards and Crown Handbook behavior.
- Crown family board data, Crown decision profiles, Crown favor definitions, Crown voting plan, solo scoring adjustment table, and difficulty settings.

Prefer `src/data/*.json` for static data and TypeScript validators to load it.

## Definition Of Done

The implementation is complete when:

- A game can be started in every supported scenario.
- A 3-6 player hotseat game can reach final scoring with all phases enforced.
- Solo and two-player modes fully execute Crown behavior from encoded Crown data.
- A save made during any phase can be loaded on another machine and continued.
- Board state, player assets, pending decisions, and log are faithfully restored from saves.
- At least one reducer test exists for each major phase.
- Scenario setup fixtures match the source setup cards.
- Final scoring fixtures cover Company survival and Company failure.
- No required gameplay action needs manual JSON editing.
