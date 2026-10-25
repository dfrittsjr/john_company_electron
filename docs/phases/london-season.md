# London Season, Upkeep, and Final Scoring (LS)

Files: `src/engine/phases/london-season.ts`, `london-season.state.ts`, `retirements.ts`,
`upkeep.ts`, `final-scoring.ts`, `final-scoring.state.ts`; selectors appended to
`src/engine/selectors.ts`; tests in `src/tests/engine/london-season.test.ts`.

## What is implemented

### Setup (setup steps 10-12, p.4-5)
- A setup card's "Random Blackmail Card" draws a random real blackmail card face down.
- After setup cards, prestige and the remaining blackmail are shuffled together and three are
  dealt to the London Season Display (`state.londonSeason`).

### London Season (pp.11-12)
- Skipped on the scenario's first turn.
- Attrition as before (roll + fatigue, +1 Chairman; 3-4 fatigue, 5+ retire).
- Retirements start with the Chairman, or the former Chairman if the office is vacant, then go
  clockwise. Each pensioner is a decision: one choice per prize and per useful combination of
  unused spouse discounts, plus "do not retire".
  - Discounts stack and each is used once per London Season and once per Final Scoring.
  - Lord Highgate limits prizes to the 8 and 12 VP boxes.
  - Letters of Introduction, played when retiring, lends every other player's spouse discounts.
  - A player who can't afford any prize is still asked, because another player may lend them cash
    first (p.8, p.36). The prompt says so, and its only option is not to retire until a loan arrives.
- Prestige Cards step: players who retired pick in order of cash spent, then window icons
  (including this turn's prize pieces), then Prime Minister order. Each takes or discards one
  display card; the choices name face-down blackmail for the acting player only. Becky Sharp may
  take the deck's top card; the option is offered whatever the card is, so it never hints at a
  hidden card. If an Esther Summerson holder draws blackmail that way, it is discarded and the pick
  is spent. If the display empties, remaining players are skipped.
- On taking a card:
  - Spouse VP is added.
  - Lady Glencora removes the opportunity marker.
  - Joseph Sedley moves a sitting Chairman back into the Court and vacates the office.
  - Esther Summerson discards face-up blackmail.
  - Forbidden holdings (Esther: blackmail; John Thorpe: workshops; Violet Effingham: shipyards;
    Sedley: Company shares) become a decision: discard or remove them, or trade them first and
    check again.
  - A Scandal blackmail may be played at once to vacate an eligible office without retirement.
    Every face-down card taken goes through the same keep-or-play step (just "Keep it face down"
    for other cards), so a pause after the pick doesn't tell the table it was a Scandal.
- End of season: discard the rest of the display, refill to three, return pensioners to supply.

### Upkeep and Refresh (p.36)
- Every family member on a prize pays that prize's upkeep. A player who cannot pay everything
  chooses pieces to return to supply (losing that prize's VP) until the rest is affordable, or
  checks again after a loan. Paying is forced once affordable.
- Final turn: Refresh is skipped and the game goes to Final Scoring.
- Refresh: writers return, filled-order markers clear, extra ships return, armies ready.

### Final Scoring (p.9)
- Power: enterprises (including prestige enterprises) and Company shares at their Power track
  value, +2 Prime Minister, +1 per passed law token, printed power on prestige and blackmail cards
  (face up or down), +1 per trophy.
- Power Award by final-turn band; players tied for most each take the lower award and nobody else
  scores; players tied for second get nothing.
- Company shares score the Court value (+1/-1, or the share VP token); a failed Company also scores
  +1 per workshop.
- Survived: every officeholder rolls attrition, then pensioners retire in Chairman order with
  discounts (no prestige cards).
- Failed: a random Company failure card is drawn and applied.
- Ranking breaks ties by window icons, then Prime Minister order. The per-player breakdown is in
  `state.finalScoring.players`.

## Assumptions

- A player may decline to retire a pensioner ("each player may retire", p.11). Unretired pensioners
  return to supply at the end of the season.
- Upkeep forfeits stop as soon as the remaining upkeep is affordable; the player picks which
  pieces to give up.
- The deck is not reshuffled when empty; the display refills as far as it can (p.6 component
  limits). A 1710 or Long 1710 game never runs the 30-card deck dry.
- Scottish Castle counts both as a social enterprise on the Power track and for its printed 3 power.
- A Scandal that vacates the Chairman returns that piece to supply; the card doesn't say the
  Chairman's share survives.
- `company.powerTrack[target]` holds the power value of the box that marker sits in; missing entries
  fall back to the printed starting boxes. `company.shareValue` holds the share VP token's absolute
  value, with 0 meaning the printed Court value applies.
- Window icons are read from holdings by `playerWindowIcons` (luxuries, prestige cards, prize
  pieces). The stored `player.windows` counter is not used by this area.

## Left for other areas

- TODO(NG): offer "Take my card from the London Season Display" promises at the start of the
  guarantor's pick; route Letters of Introduction and Scandal plays through the shared
  blackmail-play path so Man on the Inside can cancel them; remove Lady Newcome's "Vote with my
  enterprises" promise; block promises and negotiation while `isGameOver(state)`.
- TODO(FH): start Family with the Chairman; never turn Joseph Sedley's Stock Exchange pieces into
  shares; `nextEnterpriseCard` picks by owned count, so after a forced discard (John Thorpe,
  Violet Effingham) it can hand out a card someone already owns. It should pick the first card no
  one owns. Mr. Rochester and William Collins restrict family actions.
- TODO(EV): record Governors lost to Region Loss this turn as
  `eventsInIndia.governorsLostToRegionLossThisTurn: Record<PlayerId, number>` for The British
  Despots of India!
- TODO(CO): Refresh should also return Presidency dividers and exhaust local alliances.
- TODO(PA): Parliament should keep `company.powerTrack` as power values per marker, and
  `company.shareValue` as the share VP token value.
