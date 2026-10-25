# Deregulation: scoring and seasons (SC)

Files: `phases/retirements.ts`, `london-season.ts`/`.state.ts`, `final-scoring.ts`/`.state.ts`,
`upkeep.ts`. Tests: `src/tests/engine/deregulation-sc.test.ts`.

## Rules covered
- **Special retirement, London Season (p.37).** After a player's pensioners (or at once if they have none) they get one more
  retirement decision with a piece from supply. Money spent (after spouse discounts) may not exceed the highest
  `dividendCube` of a firm they hold shares in; never placed or 0 = disreputable. Offered only if a prize is within the cap
  and supply has a piece; cash isn't checked (loans are allowed, as for pensioners). Same command types
  (`retirement.retirePensioner` / `retirement.stop`) and step as pensioner retirement, so existing UI works; the prompt, the
  stop label ("Do not take a special retirement") and decision id (`-special-`) tell them apart. Spending and `retired` count
  toward the Prestige Cards order.
- **Final Scoring (pp.37, 41).** On `finalScoring.confirm`: draw the failure card (if failed), score firms (share count x
  `firmShareVictoryPoints(value)` summed over firms, minus 1 per Debtor's Prison piece, floored once per player), then
  the opening special retirement (context `finalSpecial`, no Display cards), then the rest (Power Award etc., attrition and
  pensioner retirement if the Company survived). Firm and special-retirement entries are listed first in the player's result
  and are already in their VP.
- **Industry's Greed Condemned** skips firm shares and Debtor's Prison; workshops were already skipped.
- **Invested workshops (p.38)** earn no +1 VP when the Company fails.
- **Refresh.** Clears each firm's `trade`, `tradeBid` and `hidden.firmStrategySecrets`. Filled-order tokens with firm ids
  were already cleared.
- **Long 1710.** Nothing hardcoded to turn 5 remains: `finalTurn` comes from the scenario, Power Award bands cover 7-8, setup
  maps the scenario to the 1710 setup.

## Assumptions (tests in `deregulation-sc.test.ts`)
- Fractions are summed over all of a player's firm shares and prison pieces, then rounded down once (test "sums fractions
  across firms"). The Company-share and other Final Scoring points are whole numbers already.
- Discounts (and Letters of Introduction) used in the opening Final Scoring special retirement stay used for the later
  pensioner retirement: "once per Final Scoring" (test "sharing one discount").
- Final Scoring's special retirement happens before the Power Award is computed; prizes don't change Power, only window-icon
  tiebreaks, which are read at the end.
- Invested workshops still count as manufacturing enterprises for Power in Final Scoring (p.38 only removes the failure VP
  and the bonus). Not tested; change `playerPower` if the table rules otherwise.
- A shareholder with a share in a dissolved firm no longer holds firm shares (their pieces are in Debtor's Prison), so only
  living firms give a cap.

## For other areas
- `TODO(VR)`: set `dividendCube` when dividends are paid (0 when nothing was paid, p.42).
- No changes to shared helpers or `GAME_SCHEMA_VERSION`. New optional fields: `RetirementProgress.special/specialUsed`,
  `RetirementContext` "finalSpecial", `FinalScoringState.openingEntries/victoryPointsBeforeSpecial/specialCarry`.
- The UI should show Final Scoring's `openingEntries` through `finalScoring.players[*].entries` (already merged).
