# Company Operation (rulebook pp.17-26) and Bonuses (p.27)

Code: `src/engine/phases/company-operation.ts` wires the commands; the offices live in
`src/engine/phases/company-operation/`. Success checks are in `src/engine/checks.ts`.
Tests: `src/tests/engine/company-operation.test.ts` (fixtures in `src/tests/fixtures/company-operation.ts`).

## How it works

- Every step is a pending decision with concrete legal commands. `decide.ts` builds the decision from
  `state.companyOperation` (an interrupt, the office in progress, or the next red-ribbon office), and each
  command is checked against the listed commands before it is applied.
- `state.companyOperation` is keyed to the turn. Anything left from an earlier turn is ignored, so the
  phase starts fresh each turn without other phases resetting it. This also fixes the old
  `actedThisTurn` flag, which was never reset and made offices skip their second turn.
- Vacant offices get an explicit system "skip" decision. Offices not in play (China before it opens, the
  Governor General before its law passes) are passed over silently.
- With the Governor General in play it acts in the Director of Trade's slot, using its own treasury.

## Implemented

| Office / rule | Page | Notes |
|---|---|---|
| Success checks | 17 | Lowest die; 0 dice = failure; catastrophe vacates the office and returns its fatigue. |
| Chairman | 18 | Debt +£5 per advance; 3 free, each further one needs a majority-consent decision; cap 8. Allocate the whole Balance (+£1 / +£5 / all per office), then finish. |
| Director of Trade | 18 | Special Envoy (repeatable, £1 per die): open China or a closed order outside Company regions. Then up to 2 writer/ship transfers. |
| Manager of Shipping | 19 | Lease £2, fit £3 (Ship Subsidy £2), buy a Company ship £5 only with no ships on shipyards. Ship supply limit 14. |
| Military Affairs | 19 | Up to 2 transfers, assign every officer-in-training, Commander appointments. Reproduces the p.19 example. |
| Presidency operations | 20 | President (or the Chairman if vacant) orders Trade, Commander, Governors; End only after every position had its chance. |
| Trade | 20-21 | Step-by-step declaration, dice penalty, retries, One Trade, home port first, Home Region Privileges, "as many as possible", filled-order tokens. Reproduces the £22 Madras example. |
| Commanders | 21-23 | Local alliances (President consent), Deploy targets, exhausting pieces, empire strength, loss checks, loot (minimum and round-robin), trophies, tower/dome/flag removal, Impose Order, Form Governorship, Elephant redirect, catastrophe. Reproduces the Hyderabad example (£15: 6/3/2, bank 4). |
| Governors | 24 | Dice pools from the card fronts (Bombay 3, Madras 4, Bengal 4, Punjab 3, Delhi 4, Maratha 3, Hyderabad 3, Mysore 3), the £1/£2 bonus, two-step ship building, regiments, Tax and its unrest. Reproduces the p.24 example. |
| Superintendent of Trade in China | 25 | Once per turn; £4 per export icon (£5 with Envoy to China). Reproduces the £16 example. |
| Governor General | 26 | £3 per Company region, then Govern (6s add unrest everywhere; one success per turn; one choice per Company region; Tax unrest in a different region each time). |
| Bonuses | 27 | Workshops and fitted shipyards; Inclosure Acts adds £1 per family member on a prize. |

Cards and laws handled here: Mercantile Connection, Diplomatic Connection (reactions offered only to the
holder of the unplayed card), Shipbuilders, Foundry (regiments), Board of Control, Military Oversight,
Trade Regulations, Writer Privileges, Writer Graft Reform, Treasure Reform, Zamindar Taxes, Ship Subsidy,
Envoy to China (trade value), Inclosure Acts.

## Assumptions

1. **Manager of Shipping** stops as soon as the treasury is £2 or less ("until it has at most £2
   remaining"); there is no optional extra spending after that.
2. **Chairman**: Debt advances may be taken between allocations (p.18 allows this). After the Court
   refuses an advance, no further advance is offered that turn.
3. **Trade declaration** is incremental: a region can be added only if an open order in it can be
   reached from the home port within the available ships using regions already declared. A region
   reached through another region (Maratha through Hyderabad from Madras) needs that region first.
4. A failed Trade ends that attempt; trying again starts a new declaration.
5. **Writer choice**: the President chooses whose writer from the Presidency's box goes on each order.
6. **Presidency dividers** are not tracked separately: each placed writer records its Presidency, which
   is all the Refresh step needs.
7. **Connections**: Mercantile/Diplomatic Connection is offered after every Trade/Deploy check to
   whoever holds it unplayed, including the acting player.
8. **Commander appointment**: a family's total pieces are its officers plus the Commander piece.
   Appointments with no change or a single candidate resolve automatically. Transfers move ready pieces
   first and land ready (top half).
9. **Governor bonus**: "If the previous roll was not a success" counts only this Governor's rolls this
   turn, so the first roll pays £1.
10. **Deploy loss checks** happen after every check, whatever the result; on a catastrophe the losses
    come first, then the trophies and the Commander.
11. **Loot** uses the target region's own towers (£4 each) plus its loot token if face up, as in both
    rulebook examples; a Company region yields only the loot minimum.
12. **China hire** (p.18, p.25): handled here until a shared Hiring helper exists. The Chairman picks
    any writer. Choosing their own needs one table-wide consent decision; on refusal they must pick
    another family.
13. **Board of Control** is offered after each office finishes: red-ribbon offices, Presidents at the
    end of their Presidency, and Governors. Commanders are not offices.
14. **Military Oversight**: candidates are families with officers in that Army; Nepotism is one
    table-wide consent decision.

## Left for other areas

- **TODO(FH)**: hire Governor offices created by Deploy (they are added to Vacant Offices); the
  Governor General hires Presidents (p.26); replace the local China hire with a shared Hiring helper.
- **TODO(NG)**: "Take my officeholder's bonus" promise (all bonuses go through `payOfficeholderBonus`
  in `company-operation/context.ts`); Man on the Inside cancelling a Connection.
- **TODO(LS)**: in Refresh, call `exhaustActiveLocalAlliances` and `returnExtraShips` (exported from
  `phases/company-operation.ts`).
- **TODO(PA)**: the Governor General law should set `company.governorGeneralInPlay`, move the Director
  of Trade's treasury and fatigue to the `governor-general` office, retire Governors, and clear
  `partialCompanyShip`. Envoy to China can create the office with `openChinaOffice` from
  `company-operation/director-of-trade.ts`. Army Spending can add regiments with `addRegiment`
  (pays Foundry).
- **TODO(EV)**: local alliances bought this turn and unused are `"ready"` in `army.localAlliances`
  (usable once for defence); Region Loss should clear `partialCompanyShip` and Governor offices.
- Out of scope: firms (firm Trade, initiative, half-value orders) and the Crown.
