# Deregulation: Vote and Revenue (VR)

Rulebook p.36 (Vote to Deregulate) and pp.41-42 (firm expenses, dissolution, dividends).
Tests: `src/tests/engine/deregulation-vr.test.ts`, `deregulation-vr-fuzz.test.ts`.

## Vote to Deregulate
- `beginTurn` (`phases/turn-start.ts`) offers `parliament.deregulationCall` to the Prime Minister when the scenario allows Deregulation, the Company is not deregulated, a Prime Minister exists and Standing or Debt is on a lined space. A starred space leaves only "call". Declining goes to the London Season.
- The session reuses Parliament's voting (`session.special = "deregulation"`, `lawId = "deregulation"`): cash and card votes, rounds. Differences: no policy or Tax Collectors, the Prime Minister may vote against, no coalitions, no Opposition Leader marker.
- Support: +2 (one lined marker) or +6 (both) plus `deregulationVoteInitialSupportBonus` laws (Writer Privileges +5). Logic in `parliament/deregulation.ts`.
- Pass: Debt lowered by floor(Debt/2), Standing on "S", token to the Prime Minister, "deregulation" added to passed laws, `deregulated = true`, `firms = []`, laws with `discardWhenDeregulationOccurs` discarded. Calico Acts' penalty already stops via `deregulated`.
- Fail: `company.shareValue` +1 (cap 3); Prime Minister stays; the card is not discarded; offered again next turn.
- Assumptions: turn 1 is not checked (the game starts at Family; starting Standing/Debt are not lined, so nothing is lost); the special session gives no Opposition Leader marker (test: "places the Company share token...").

## Firm Revenue (`phases/revenue-firms.ts`)
Runs after Company Fraud and before the Company's expenses (`RevenueProgress.firms`). Order: ruling 8.
- Expenses: ships + max(shares, Value). If the split between London and India matters the manager chooses (`revenue.firmPayFrom`).
- Cannot pay: manager chooses emergency investment (the investor consents in their own decision; the manager's own investment needs none), emergency merger, or dissolution.
- "Any cash remaining after expenses is paid is lost": assumed to mean the emergency investment cash. It is spent first on expenses; the surplus is lost; the firm's own cash is kept (test: emergency investment).
- Investments use `investInFirm(..., {emergency: true})`: Value -1 each; expenses are recomputed after each one. One Company share and one workshop per player are offered (interchangeable).
- Emergency merger: the firm facing dissolution picks one other firm; the higher Value is primary (tie: the proposer picks). Every shareholder and both managers consent in turn; one refusal cancels. Offered only if combined shares are at most 10 (no excess-share return), the other firm can pay its own expenses, and the merged treasuries cover both bills. The other firm pays its own expenses first (London first, automatic), then the merged firm pays the endangered firm's bill (London first). If the endangered firm is primary it carries on to dividends; otherwise it is removed.
- Dividends: one at a time. "Pay" (full: shares + 1 for the manager), "ask shareholders to forgo shares" (each holder in turn chooses how many shares to forgo; the manager's asking is the consent), or stop. If the forgone choices make it unaffordable nothing is paid. Hobnob firms skip dividends and keep their cube; others set `dividendCube` to the total paid (0 if none). India then moves to London.
- Dissolved firms: `dissolveFirm`.

## For others
- FP/TR: Revenue reads `firm.trade?.initiative` and `hidden.firmStrategySecrets[id].strategy === "hobnob"`.
- Dissolution during Revenue does not return invested workshops (rule: they stay invested).
