# Deregulation: Firms phase (FP)

Rulebook pp.37-40. Code: `src/engine/phases/firms.ts`, `phases/firms/{investments,strategy,state,common}.ts`.
Tests: `src/tests/engine/deregulation-fp.test.ts`, fixtures `src/tests/fixtures/firms-fp.ts`.

## Flow

`startFirmsPhase` -> Firm Investments (rounds) -> Firm Strategy -> `startHiringPhase`.
Round state is `state.firmsPhase` (`order`, `index`, `passes`, `merge` draft). New optional field on `GameState`.

Investments commands: `firms.formFirm {source}`, `firms.invest {firmId, source}`, `firms.fitShip {shipId}`,
`firms.buyBackShip {shipId}`, `firms.takeOver {firmId}`, `firms.startMerge`, `firms.dissolve`, `firms.pass`.
Merger steps: `firms.mergeAdd {firmId}`, `firms.mergeProceed`, `firms.mergeChoosePrimary {firmId}`,
`firms.mergeReturnShare {playerId}`, `firms.mergeCancel`. Strategy: `firms.chooseStrategy {firmId, strategy}`,
then `firms.chooseBid {firmId, bid}`.

Consents use negotiation's `requestConsent` (kind `firms.action`), so each asked player has their own
`negotiation.consent` decision, the proposer's turn is restored afterwards, and it all survives save/load.
Actions that need no consent run through the same path with nobody to ask.

## Assumptions (each has a test in deregulation-fp.test.ts)

- A player with only "pass" available is skipped without a prompt (no dead actions). A manager can always
  dissolve, and a non-manager can always try a takeover while a firm exists, so they are asked every round.
- A refused (or failed) request uses the turn but is not an "action": it counts toward the all-passed end.
  This guarantees the step terminates.
- Source choices are deduplicated: one Company share and one workshop are offered, not every copy.
- Takeover: the taker's own shares count; consent is asked of the fewest largest other holders who make a
  majority (more than half of the shares). One refusal ends it. Shares traded during the request are re-checked.
- Merger: the proposer (a manager of one involved firm) builds the list, picks the primary on a Value tie,
  and picks which owners' excess shares are returned, one at a time. Consent is asked of all shareholders and
  managers of all involved firms. Anyone holding shares at the time of execution who was not asked fails it.
- Dissolution sends all shares, the manager's included, to Debtor's Prison (shared helper).
- Fitted or bought-back ships become unfatigued firm ships.
- Buyback is offered only if the `manager-of-shipping` office exists in the Company state.
- Firm shares trade as a `firmShare {firmId, count}` transfer item. Like Company shares, the pieces swap:
  the giver's come back to supply, the receiver needs that many in supply (no prize option).
- Strategy: bid and card are two steps for everyone, including Hobnob (single bid of 0), so the step ids
  and prompts give nothing away. A manager with no firm ship or an empty London treasury is set to Hobnob
  without a prompt. Logs say only that a strategy was chosen; bids are logged when the last manager has chosen.
- Starting Firm Strategy clears last turn's `firmStrategySecrets`, and `trade` / `tradeBid` on all firms.
- Immature shares: `createdTurn` is set in `resolveNewCompanyShares` (family.ts) and for the Joseph Sedley
  share in london-season.ts. Initial Court shares from setup are mature.
- Ship Subsidy fit cost is £2 (`ship-subsidy` in `passedLaws`).

## For other areas

- UI: render `firms.*` decisions; `firmShare` in the Deals panel; a `negotiation.consent` can now come from the
  Firms phase. `state.firmsPhase` is only present during the phase.
- SC/TR: `firm.trade` and `tradeBid` are cleared at the start of Firm Strategy as a safety; Refresh should still clear them.
- Integrator: `node_modules` in this worktree is a real install (the shared one was lost).
