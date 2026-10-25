# Implementation Plan

This plan is ordered for an AI coding agent. Complete each milestone with tests before moving to the next.

## Milestone 1: Project Foundation

- Replace the static mockup with a React + TypeScript game screen. (Superseded: the app now ships as an Astro static site on Cloudflare Worker static assets instead of Electron.)
- Add `src/engine`, `src/data`, `src/save`, and `src/ui` directories.
- Add Vitest.
- Add ESLint/TypeScript checks.
- Render the start menu and load `board_image-1.png` on a board screen.
- Create typed domain IDs and basic `GameState` skeleton.

Done when the app launches, shows the board image, and tests run.

## Milestone 2: Data Layer

- Add JSON schemas or Zod validators for all static data files.
- Enter region/order/presidency adjacency data with board coordinates.
- Enter office definitions and office order.
- Enter prize definitions.
- Enter family action definitions.
- Enter component counts.
- Create placeholder files for decks not yet encoded, with validation that blocks scenarios requiring missing data.
- Add Crown data schemas for AI cards, climate states, promise-cube favors, decision profiles, voting plan, and solo scoring adjustment table.

Done when static data loads and validates at startup.

## Milestone 3: Save/Load

- Implement `.joco` envelope.
- Implement deterministic RNG.
- Implement save export through the browser (save picker where available, otherwise a download).
- Implement load import and validation.
- Implement event log.
- Add round-trip tests.

Done when a new empty game can be saved, loaded, and compared.

## Milestone 4: Scenario Setup

- Encode all scenario setup data from source material.
- Encode setup cards.
- Implement random setup and draft setup.
- Implement Crown setup distributions, difficulty adjustments, promise-cube allocation, AI deck reveal, climate initialization, and two-player Player Button initialization.
- Place initial pieces, offices, cash, cards, regions, tracks, and decks.
- Build setup UI.

Done when each hotseat and Crown scenario initializes to a validated state matching its setup card and mode-specific Crown setup rules.

## Milestone 5: Hotseat Shell

- Implement seating order and active actor.
- Implement hotseat privacy curtain.
- Implement player dashboard.
- Implement phase/action panel from `PendingDecision`.
- Implement negotiation immediate transfers for cash, enterprises, shares, promise cards.
- Implement Crown promise-cube transfer commands, legal favor window rendering, and Player Button transfer for two-player Crown mode.

Done when players can pass control and make simple validated transfers.

## Milestone 6: Family And Hiring

- Implement Family phase actions.
- Implement opportunity marker double-action rule.
- Implement Company share creation from Debt.
- Implement Hiring phase candidate pools.
- Implement Chairman election.
- Implement nepotism consent.
- Implement promotions and fatigue transfer.
- Implement Crown free writer enlistment, Crown family action priority, Crown extra-action handling, Crown Chairman election/support, Crown nepotism consent, and Crown candidate priority.

Done when a game can progress from Family through Hiring with legal state transitions.

## Milestone 7: London Season

- Implement office attrition.
- Implement pensioners.
- Implement prize retirements, upkeep metadata, VP adjustments.
- Encode prestige/blackmail data enough for display and core effects.
- Implement London Season Display.
- Implement Crown retirements, Crown London Season display selection, Crown card handling, Crown special retirement, and London Season Crown favors.

Done when attrition, retirements, and card selection work from save/load mid-phase.

## Milestone 8: Company Operation

- Implement success checks and catastrophic failure.
- Implement Chairman debt/allocation.
- Implement Director of Trade.
- Implement Manager of Shipping.
- Implement Military Affairs.
- Implement President trade and trade path validation.
- Implement Commanders and Deploy.
- Implement Governors and Administer.
- Implement Superintendent of Trade in China.
- Implement Governor General.
- Implement Crown office automation and Crown favors for every Company Operation office.

Done when the full Company Operation phase can be completed with tests for each office.

## Milestone 9: Revenue, Events, Parliament, Upkeep

- Implement Bonuses.
- Implement Revenue and Company failure.
- Encode storm die and India event tiles.
- Implement Events in India, elephant, cascades, region loss.
- Encode law deck and policy track.
- Implement Parliament voting and law effects.
- Implement Upkeep and Refresh.
- Implement Crown Revenue behavior, Royal Privilege/Royal Protection, Crown Crisis defense choices, Crown Parliament voting plan, climate shift, treasury vote bands, policy movement, and Crown upkeep.

Done when a full non-deregulated multiplayer turn can complete.

## Milestone 10: Deregulation And Firms

- Implement Deregulation trigger and scenario start state.
- Implement firm formation, investment, ships, takeovers, mergers.
- Implement simultaneous strategy selection.
- Implement firm trading and initiative.
- Implement firm expenses, dividends, dissolution, emergency investments/mergers.
- Implement firm final scoring.
- Implement Crown firm restrictions, investment behavior, firm consent, Player Button investment/takeover priority, emergency investment refusal/bribe, and firm-dividend promise-cube rewards.

Done when `1813` and deregulated `1758`/`Long 1710` games can complete.

## Milestone 11: Final Scoring

- Implement Company survival scoring.
- Implement Company failure scoring.
- Implement Power Award.
- Implement final retirement/failure card handling.
- Implement tie breakers.
- Implement Crown final retirement behavior and solo Company-failure VP adjustment.
- Add final scoring summary UI.

Done when complete games produce a winner and explain every VP change.

## Milestone 12: Crown AI

- Complete any Crown phase tables not finished in prior milestones.
- Add full Crown action preview UI for automated choices and tie-break provenance.
- Add Crown Handbook contextual reference links.
- Add Crown save/load fixtures that cover hidden AI deck order, blackmail, favor windows, and Player Button state.
- Add end-to-end scripted solo and two-player Crown turn fixtures.

Done when solo and two-player games can complete without manual Crown choices.

## Milestone 13: Polish And Verification

- Implement the final verification scripts described in `docs/test-framework-plan.md`.
- Add contextual rules links.
- Add disabled-action reasons everywhere.
- Add export log.
- Add save branch warnings.
- Add UI smoke tests for all screens.
- Play through at least one complete 1710 game with test fixtures or scripted commands.
- Fix mismatch between rule text and encoded data.

Done when the game is playable end-to-end and recoverable from saves at all major decision points.

## Implementation Guardrails

- Do not implement Crown AI by guessing.
- Do not store gameplay state only in React component state.
- Do not use `Math.random()` for gameplay.
- Do not make board clicks the only way to perform an action.
- Do not allow save/load to skip pending decisions.
- Do not hide missing data by silently substituting dummy cards.
- Keep reducers small and testable.
- Prefer data-driven card effects where possible; use named effect handlers for complex cards.
