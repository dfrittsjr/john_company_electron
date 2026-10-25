# Parliament (PA): Parliament Meets and Revenue law and card effects

Owner area per `docs/phase-build-guide.md`: Parliament Meets (rulebook pp.34-36), Revenue (p.27),
and the immediate effects of passed and failed laws.

## Where things live

- `src/engine/phases/parliament.state.ts`: `ParliamentState` (law deck, passed laws, dial,
  Opposition Leader, in-flight `session` and `revenue` progress), its initializer, and
  `initialPowerTrack()`.
- `src/engine/phases/parliament.ts`: stages, decisions, and command handlers.
- `src/engine/phases/parliament/`: `laws.ts` (deck, matching, vote cost), `holdings.ts`
  (taxable items, window icons, surrender), `votes.ts` (card votes), `offices.ts` (vacate, create,
  return to box), `resolution.ts` (policy consequences and law effects), `india-effects.ts`
  (Turmoil, Cascade, Foreign Invasion for dilemmas).
- `src/engine/phases/revenue.ts`: Revenue, including law and blackmail effects.

## Implemented

Setup:

- The law deck is shuffled at setup (`lawDeckForScenario`).
- Starting passed laws: Royal Protection in 1710 and Long 1710.
- The dial starts at the scenario's date (board components data).
- The Power track starts at social 2, Company share 1, shipping 0, manufacturing 0. `company.powerTrack` holds each marker's power value.
- `company.shareValue` is the share magnitude: 1 from the Court, or 2 in 1813.
- The Prime Minister comes from the setup cards (`phases/setup.ts`); before that, it is the first seat.

Parliament Meets (pp.34-36):

- The Prime Minister reveals laws one at a time, up to three, and must stop at a dilemma. The rest are discarded.
- Old Ideas Made New! brings back a discarded law, then reshuffles the discards, the cards drawn and itself.
- The policy arm rotates either way to the first matching space; the current space doesn't count.
- Starting support is set from the law.
- Public Demands Impeachment!: the Prime Minister picks an officeholder before the vote.
- Tax Collectors (prestige #22) may add a window tax before voting, with the Prime Minister's consent. As the winning Opposition Leader, the owner may add one to the policy they move.
- Voting rounds start with the Prime Minister and go clockwise. The Prime Minister may call another round; a round with no votes resolves.
- Players with nothing to vote with are skipped.
- Votes come from cash (£1, or £2 after Masses Demand Franchise!) and from cards rotated once per vote:
  - shipyards 1, workshops 2;
  - Rotten Boroughs 3, or 1 after Masses;
  - Labour Newspaper and Social Magazine 4 on matching policies;
  - Lady Newcome removes enterprise votes.
- The Prime Minister's Honor applies. Once a player votes against, they may not vote for. Coalitions credit votes against to a partner.
- The Opposition Leader marker goes to the unique leader in credited votes against; a tie leaves it where it is.
- Pass: the law joins the passed laws, the Prime Minister takes a passed law token, then the policy consequence, then the law's immediate effects.
- Fail: dilemma "if failed" effects; the Opposition Leader takes the dial, moves the policy one space and it is resolved.
- Policy consequences:
  - Tax: £1 per target, including the Chairman's share; a player who can't pay chooses which targets return to supply.
  - Window tax on prizes and enterprises: pay each item's window icons or lose that item.
  - Bonus.
  - Power swaps, including the Prime Minister's choice of pair when the target is already on top.
- Window Tax Repeal suppresses window taxes, except the one Tax Collectors adds.
- Legislated Company Failure: the vote finishes, then Final Scoring.
- Law effects:
  - Calico Acts (£2 per manufacturing enterprise)
  - Envoy to China (creates the office)
  - Army Spending (+2 regiments per Army; the Foundry is paid £1 each)
  - Debt Restructure
  - Governor General (p.26 structural change)
  - Writer Privileges and Writer Graft Reform (each discards the other)
  - Company Aids Government (share value +1, max 3)
  - Public Demands Impeachment!
  - Relief Demanded for Indian Famine! (policy twice; on failure Turmoil in each home region plus unrest)
  - War Against France! (Prime Minister returns 3 ships and 3 officers/regiments; on failure a storm-die Foreign Invasion)
  - Masses Demand Franchise!
  - Old Ideas Made New!

Revenue (p.27):

- Calico Acts penalty at the start (£1 per £7).
- Company Fraud offered to holders at the start.
- Expenses: Sepoy Recruitment frees regiments; Company Aids Government makes Debt £2 each.
- Royal Protection: the Chairman may discard it to avoid emergency loans and cancel the rest of the expenses.
- Loans, embarrassment, expectations, dividends, Public Enthusiasm.
- After dividends, the Scandal blackmails are offered to holders with a legal target.

## Assumptions

- A Tax law icon matches both TAX and TAX & WINDOW TAX spaces.
- The law deck reshuffles its discards if it runs out.
- Old Ideas Made New! with no discards: the replacement law is drawn first, then Old Ideas is shuffled back. The replacement doesn't count toward the three draws.
- The Opposition Leader marker persists between votes until it is used. If a law fails and nobody ever took it, the Prime Minister stays and moves the policy. If an earlier holder still has it and nobody voted against, that holder becomes Prime Minister (literal reading of pp.35-36).
- A coalition pledge is made once per vote, and the partner joins the opposition.
- Cash votes are offered in batches of 1, 2, 5, 10 and "all"; batches can be repeated within a turn.
- A family member lost to window tax costs the prize's victory points, as with unpaid upkeep.
- Relief Demanded for Indian Famine! applies a Tax Collectors window tax only once.
- Calico Acts' Revenue penalty is applied before Company Fraud is offered.
- Company Fraud pays twice the highest roll from the bank; the Company Balance drops by the same amount, but not below 0.
- Scandal blackmail ("anytime after Revenue") is offered once, right after dividends. The effect is exported for other timings.

## Hooks for other areas

- `grantEnterpriseVotes(state, guarantor, beneficiary)` (`phases/parliament.ts`): for NG's "Vote with my enterprises" promise. Valid after a law is proposed and before any votes.
- `refreshParliamentDecision(state)`: for NG after an anytime transfer changes cash mid-Parliament.
- `isLawPassed(state, lawId)`: for any area reading ongoing law effects.
- `playerWindowIcons(state, playerId)`: window icons from prizes, enterprises and prestige cards (for LS tie breaks).
- `vacateOffice(state, officeId, "supply" | "pensioners")` and `vacateOfficeWithoutRetirement(state, officeId)` (`phases/revenue.ts`): for the Scandal cards' "when taken" timing (LS) and anytime play (NG).
- `calculateCompanyExpenses(state)`, `lowerStanding(company, spaces)`, `createFinalScoringDecision(state)` (`phases/revenue.ts`).

## TODO for other areas

- `TODO(FH)`:
  - The Superintendent of Trade in China is hired immediately by the Chairman when Envoy to China creates it (p.25).
  - The Governor General is hired like the Director of Trade and hires Presidents (p.26).
  - `nextEnterpriseCard` picks by count, so a card returned by tax could be dealt twice. It should pick the first card no one owns, and must not re-deal a shipyard whose ship is still in play (p.34).
- `TODO(EV)`: replace `phases/parliament/india-effects.ts` (Turmoil, Cascade, Foreign Invasion) with the shared Events in India helpers. Resolve `parliament.pendingCompanyAttacks`: War Against France! invasions of Company-controlled regions.
- `TODO(LS)`:
  - Returned prestige enterprises should go to the London Season discards.
  - Prestige and prize window icons are not added to `player.windows` here; use `playerWindowIcons` for tie breaks.
  - Final Scoring reads `company.powerTrack` (power values), `player.passedLawTokens` and `company.shareValue`.
- `TODO(NG)`:
  - Offer Man on the Inside when a blackmail card is played (Company Fraud, Scandal).
  - Lady Newcome: enterprises she transfers can't vote that turn.
  - Remove her "Vote with my enterprises" promise.
- `TODO(CO)`: ongoing law effects are read with `isLawPassed`: Board of Control, Military Oversight, Ship Subsidy, Trade Regulations, Zamindar Taxes, Treasure Reform, Writer Privileges, Writer Graft Reform, Envoy to China (£5 per export icon), Inclosure Acts (Bonuses).
- Out of scope: the Vote to Deregulate (p.36) would be a special session at the start of a turn, before the London Season.
