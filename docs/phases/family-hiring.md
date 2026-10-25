# Family and Hiring (FH)

Files: `src/engine/phases/family.ts`, `family.state.ts`, `hiring.ts`, `hiring.state.ts`,
`hiring-resume.ts`. Tests: `src/tests/engine/family-hiring.test.ts` (fixtures in
`src/tests/fixtures/family-hiring.ts`) plus the updated hiring tests in `commands.test.ts`.

## Family (pp.13-14)

- `startFamilyPhase(state)` fixes the turn order: clockwise from the player with the Chairman title,
  i.e. the Chairman, or the former Chairman (the `company.chairmanMarker` holder) while the office is
  vacant. Setup and the London Season both hand over through it.
- A turn is a main action, then optional follow-ups in this order, each its own decision:
  1. the extra writer for four or more vacant offices (once per turn, after an Enlist Writer);
  2. the opportunity-marker repeat;
  3. the extra writer again if it was not used and the repeat was Enlist Writer;
  4. the most recently passed law's extra action (`state.parliament.passedLaws`, last one with an
     `extraAction`). It does not use or move the opportunity marker.
- Vacant offices for the 4+ rule are the offices in the Vacant Offices box
  (`company.vacantOffices` that are actually vacant).
- Seek Share offers every empty Stock Exchange space at its printed price.
- Out of family pieces: when the supply is empty, piece-placing actions are offered once per prize
  holding a family member; taking one lowers VP by that prize's printed VP. `takeFamilyPiece` is
  exported for other areas.
- No Action is offered only when nothing else is legal; the marker then goes to the supply.
- Spouses: Mr. Rochester and William Collins block those actions as main/repeat actions but not as
  law extra actions (card text). John Thorpe, Violet Effingham and Joseph Sedley block the purchase
  or share in every form. Lady Glencora's holder never repeats and keeps the marker "removed".
- Stock Broker: its owner pays £1 for any space. Another family may ask to use it: the owner gets an
  Allow/Refuse decision; a refusal returns the asker to the same choice without the Broker option.
- Foundry pays its owner £1 for every workshop bought by anyone in Family.
- Industry Subsidy: workshops cost £3 unless the opportunity marker started on the workshop space;
  never for the Calico Acts extra workshop.
- Enterprise supply: a card is available if nobody owns it; a returned shipyard is not available
  while its ship is fitted (p.12, p.34).
- New Company shares (p.14): one Stock Exchange piece enters the Court per Debt, rightmost first;
  remaining pieces always slide rightward, Debt or not (codex skipped the slide with no Debt).

## Hiring (pp.14-17)

- Vacant offices stay in `company.vacantOffices` (the Vacant Offices box) until filled. An office
  skipped for want of a hirer or candidate is recorded in `hiring.skippedThisTurn` and is hired again
  next turn (codex removed it from the box for good).
- Chairman election (p.15): shareholders declare support one at a time, clockwise from the former
  Chairman, backing one candidate with all their shares or no one. The first candidate to reach the
  majority wins. If nobody does, the former Chairman (system if none) picks any shareholder. A sole
  shareholder is elected through a one-option decision. The winner moves a Court share into the
  Chairman slot and takes the Chairman marker.
- Empty Court: the former Chairman continues, placing a piece from supply, or from a prize if the
  supply is empty. With no former Chairman or no piece, the office is skipped: no Chairman.
- Nepotism (p.14): a self-hire asks each other player who has a candidate for that office, in
  clockwise order from the hirer. Any refusal sends the hirer back to choose among the others.
  If no other player is in the pool, no consent is needed. It never applies to the election.
- Hiring Preference: before the hirer chooses, the card's holder is asked (once per office) if they
  are in the candidate pool. Playing it turns the card faceup and limits the hirer to the holder's
  pieces; Nepotism is ignored if the hirer is the holder.
- The Governor General hires Presidents once in play. `installGovernorGeneral(state)` performs the
  office changes of p.26.
- `beginImmediateHire(state, officeId, resumeKey)` creates an office outside Hiring and hires it at
  once; the creating phase registers `resumeKey` with `registerHiringResume`. If nobody can be hired,
  the office stays in the Vacant Offices box and play resumes immediately.

## Assumptions

- Chairman support is declared once per shareholder, in clockwise order from the former Chairman;
  the table negotiates outside the app before each player declares.
- A refused self-hire cannot be proposed again for that office in the same Hiring phase.
- A refused Stock Broker request is not offered again to that family this Family phase.
- The extra writer may be taken after the repeat if it was declined after the main action.
- Industry Subsidy discounts the main workshop purchase whenever the opportunity marker did not start
  on the workshop space, including a marker in supply or removed.

## For other areas

- TODO(NG): "My consent for nepotism" promise when collecting consent; Man on the Inside when
  Hiring Preference is played; swap the Stock Broker permission for the shared consent helper.
- TODO(LS): the London Season must keep handing over with `startFamilyPhase`. The Chairman marker
  (`company.chairmanMarker`) stays with the former Chairman when the office is vacated, so the
  London Season can start retirements with `chairmanTitleHolder(state)`. If `player.windows`
  counts prize window icons, lower it in `takeFamilyPiece` when a piece leaves a prize.
- TODO(PA): call `installGovernorGeneral` when the Governor General law passes, and
  `beginImmediateHire(state, "superintendent-of-trade-in-china", key)` for Envoy to China.
- TODO(CO): call `beginImmediateHire` when the Special Envoy opens China. Offices vacated by
  catastrophic failure must be added to `company.vacantOffices`.
- TODO(EV): offices vacated by Region Loss must be added to `company.vacantOffices`.
