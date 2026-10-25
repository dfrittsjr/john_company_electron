# Deregulation: firm trading and storms (TR), rulebook pp.38, 40-42

Code: `src/engine/phases/company-operation/firm-trade.ts` (new), with small changes in `trade.ts`,
`presidency.ts`, `interrupts.ts`, `company-operation.state.ts`, `bonuses.ts` and the storm code in
`events-in-india/resolve.ts`. Tests: `src/tests/engine/deregulation-tr.test.ts`, fixtures in
`src/tests/fixtures/deregulation-tr.ts` (they write firm state and strategy secrets directly).
Without Deregulation nothing changes: every firm helper returns "no firms" and the Company's order
check only differs when a firm has filled an order.

## Flow

1. **Reveal and roll.** `presidencyDecision` first offers one system step per unrevealed firm of the
   Presidency (`companyOperation.firmTrade`, payload `{action: "reveal", firmId}`): it sets
   `revealed: true`, rolls `tradeBid` dice (the bid is already with the bank), and records
   `firm.trade` (`successes` = dice showing 1 or 2; `initiative` = ships minus successes when there
   is a success). A Presidency with a vacant President and nobody else to act is not skipped while
   firms still have something to do.
2. **Mercantile Connection** is offered after each firm roll (`PendingCheck` context `firmTrade`) and
   rerolls with half the dice like for a President.
3. **Filling.** State: `companyOperation.firmFill` (the round) and `firmsFilled` (done firms).
   - President's Trade succeeds: the firms with an initiative and the Company (initiative = ships in
     the zone minus the Trade roll's successes) fill in initiative order, lowest first.
   - Otherwise (President vacant, never traded, failed or cancelled): choosing "End" for the
     Presidency starts the round with the firms only; the office finishes when it is over.
   - Ties: a decision (`companyOperation.firmFill`, `{action: "next", who}`) for the operating
     President if the Company takes part, else the Chairman marker holder (`chairmanTitleHolder`).
   - A firm's turn is step by step: `{action: "fill", orderId}` / `{action: "stop"}`. The home port
     of its strategy first, then orders connected to ones it filled, up to ships + 1, each order once.
   - Each fill marks `order.filledThisTurnBy` with the firm id and adds the order's value to
     `firm.indiaTreasury` and `firm.trade.income`. An order anyone filled this turn pays
     `deregulationValue` (printed half value). When the firm is done the Value advances
     `floor(income / 6)` spaces, at most 10.
   - The Company may refill orders firms filled (half value). `isOrderAvailable` now only checks that
     the Company has not filled it. `TradeActivity.placedValues` records what each order paid.
4. **Storms.** Ships at `firm:<id>` check in the zone of the firm's strategy (hidden secret, read
   directly); Hobnob or no strategy: safe. Firm ships check whatever their `kind` is.
5. **Bonuses.** Invested workshops no longer count.

## Assumptions (each has a test)

1. **Closed home port**: the strategy may be chosen (p.40) but "orders must be filled starting with
   the home port", so the firm fills nothing. It still counts as having filled; nothing is paid.
   Test: "Closed home port".
2. **Firms may stop early**: p.40 says "up to the number of ships plus one"; unlike the Company's
   "as many as possible", the manager chooses "stop" at any point (also "Fill no orders"). Test: "lets
   a firm stop early".
3. **Home Region Privileges** (p.20) is worded for Presidents, so firms may fill orders in any home
   region. Not separately tested.
4. **Firm fill with a failed or no Trade happens when the Presidency ends** (the "End" command, which is
   offered once the Commander and Governors have had their chance). A vacant President's "End" decision
   belongs to the Chairman office holder (existing `presidencyChooser`). Test: "Vacant President or no Trade".
5. **The Company's own refills**: the Company never refills an order it filled itself. Firms may refill
   Company-filled orders (half value). Test: "Initiative order and ties".
6. **Connection** is offered after every firm roll, as for Presidents, to the holder of an unplayed
   Mercantile Connection (the manager may hold it). Test: "Mercantile Connection against a firm roll".
7. **Storms hit firm ships even if their `kind` is "company"** (a bought-back ship). They fatigue and
   sink like player ships (ruling 7 only exempts trading).
8. **Hobnob firms are never revealed** in Company Operation (they belong to no Presidency). Whoever
   needs the strategy public (Revenue ordering) reads the secret.

## For other areas

- Refresh (SC) must clear `firm.trade`, `firm.tradeBid` and `revealed` on the strategy secrets; Company
  Operation's `firmsFilled` is turn-keyed and needs no cleaning. Pending firms are those with a
  revealed secret and `trade.initiative` set.
- Revenue (VR) orders expenses by `firm.trade.initiative`.
