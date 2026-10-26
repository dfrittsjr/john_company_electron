# Scenarios: 1758 "Company Under Siege" and 1813 "Post Monopoly" (rulebook pp.4-5)

**Status: built**, for 3-6 players (hotseat, online) and against the Crown. Sources: the scenario cards
(Bridge Fronts p.9), "Situation in India" (Bridge Backs p.9) and the setup cards (MiniEuro Fronts pp.29-31).
Two independent transcriptions agreed except for two points (1758 Bengal control; the printed Commander of
Bengal on 1813's President of Madras card, kept as printed).

## Where things live

- `src/data/setup-cards.ts`: the two 18-card decks (ids `1758-...`, `1813-...`, with sheet positions).
- `src/data/scenarios.ts`: `mapSetup` (towers, closed orders, empires, Elephant, Company-controlled
  regions with their Presidency association, Governor offices), `governorGeneral`, `chinaOffice`.
- `src/engine/setup.ts`: `withScenarioOffices` (Governor General, Governor of Bengal, China office), the
  Company-controlled regions' control tokens.
- `src/engine/phases/setup.ts`: `setupDeckIdForScenario` (Long 1710 deals the 1710 cards), the random deal
  for any deck, and the setup effects. `src/engine/crown/setup.ts` deals the same decks to the Crown.
- Tests: `src/tests/engine/scenarios-1758-1813.test.ts`.

## Interpretations (each also recorded on its effect in `src/data/types.ts`)

- **Prize 2** (1813 Chairman and President of Bombay cards): the diamond with a 2 is the victory-point
  diamond printed on a prize box. The 4-pound prize shows a diamond 2; the 2-pound box prints none. So the
  card places a family member from supply on the 2 VP prize ("prize-4") without paying, scoring 2 VP; its
  £1 upkeep applies as usual.
- **Trophy / Two Trophies** (1758 Commanders, 1813 Military Affairs): the existing `trophy` effect, trophy
  tokens for the family (+1 power each in votes).
- **Governor of Bengal** (1758): the plain `office` effect. The office is created at setup because Bengal
  starts Company-controlled; see `plans/remaining-game.md` section 3.
- **Private Firm** (1813): "1 share, 8 pounds in treasury, or 3 pounds if dealt to the Crown". A
  `privateFirm` effect: the holder manages a firm with one of their pieces on its Shares box and 8 pounds in
  its London treasury, at Value 1. The Crown never creates a firm (Handbook p.3), so for the Crown the
  card gives 3 pounds and no firm exists. There is no Crown-managed firm for the Crown's firm code to handle;
  the Crown can still invest in players' firms as the Handbook says.
- **1 Company Ship under the Superintendent of Trade in China** (1813): the China office's treasury holds
  only ships (p.25), so a Company ship goes on its overlay (location `china`).
- **Governor General** (1813): `installGovernorGeneral` runs at setup over the Director of Trade's place;
  the card "GOVERNOR GENERAL" fills it. No Governors exist (p.26), unlike 1758.
- **Player count:** 1813 is recommended for 5-6 players but allowed with 3-6.

## Not done

- Nothing known. Both scenarios ran full bot games (3 to 6 players, solo and two-player Crown) to Final Scoring.
