# Data Entry Checklist

Full automation depends on structured game data. Use this checklist to track what has been encoded from the rulebook, board, cards, and Crown Handbook.

## Board Geometry

- Board image dimensions: `4902 x 2481`.
- Region polygon or hit-area coordinates for Bengal, Delhi, Bombay, Punjab, Maratha, Madras, Mysore, Hyderabad.
- Order coordinates and connection graph.
- Home port order markers.
- Prize box coordinates.
- Court and Stock Exchange coordinates.
- Company track coordinates: Standing, Balance, Debt, Turn, Votes, Power.
- Office ribbon coordinates.
- Presidency, army, sea zone, China office coordinates.
- Policy dial coordinates.
- London Season Display coordinates.

## Static Components

- Six families, 18 family members each.
- Five promise cards per family.
- Opportunity marker per family.
- Firm cubes and firm strategy cards per family.
- Tower levels, domes, flags.
- Event tiles.
- Control/loot tokens.
- Elephant.
- Fatigue/unrest cubes.
- Crown promise cubes.
- Ships: player-owned, extra, Company.
- Regiments and local alliances.
- Dividers, Chairman marker, Opposition Leader marker, trophies, passed law tokens, dice.

## Scenarios

- `1710` scenario card.
- `1758` scenario card.
- `1813` scenario card.
- `Long 1710` scenario card.
- Scenario-specific Standing, Debt, Balance, turn marker, policy dial, starting regiments, starting ships, treasuries, laws, map setup.

## Setup Cards

- 18 setup cards per scenario set.
- Extra cards for 5-player setup.
- Extra cards for 6-player setup.
- Card effects: offices, cash, workshop, shipyard, luxury, share, writer, officer-in-training, officer, commander.

## Offices

- Chairman.
- Director of Trade.
- Manager of Shipping.
- Military Affairs.
- President of Bombay.
- President of Madras.
- President of Bengal.
- Governors for all applicable regions.
- Superintendent of Trade in China.
- Governor General.
- Office order numbers.
- Office action text and effect handlers.
- Hiring pool data.

## Enterprises

- 22 shipyards.
- 20 workshops.
- 16 luxuries.
- Costs, income, vote icons, window icons, type, power target.

## London Season Cards

- 20 prestige cards.
- 10 blackmail cards.
- Spouse restrictions and discounts.
- Enterprise subtypes on prestige cards.
- Blackmail one-time effects.
- Power/vote/window icons.

## Laws And Parliament

- Law deck.
- Dilemmas.
- Starting support values.
- Policy icons.
- Immediate effects.
- Passed effects.
- Failed effects.
- Policy track spaces.
- Power track spaces.
- Deregulation special vote data.

## India Events

- 20 event tile identities.
- Tile backs/region indicators.
- Crisis modifiers.
- Storm die faces and event counts.
- Turmoil behavior.
- Windfall behavior.
- Shuffle behavior.
- Leader behavior.
- Peace behavior.
- Crisis behavior.
- Foreign Invasion behavior.

## Crown

- Crown family board.
- 10 Crown AI cards.
- Crown AI card fields: climate icon, standing-to-climate map, shaded splay position, direction, black/white Presidency arrows, region priority, and all climate/profile references.
- Crown climate states/icons.
- Crown family action priority table by climate.
- Crown decision profiles for Vote to Deregulate, Chairman debt/allocation, Director of Trade, Governor General, Manager of Shipping, Military Affairs, Governors, Commanders, Presidents, Superintendent of Trade in China, Revenue, and Parliament.
- Crown Handbook favor definitions by phase/step, including cost/reward, mandatory status, repeatability, condition, and effect handler.
- Crown setup distributions for solo draft, solo random, two-player draft, and expert extra setup cards.
- Crown difficulty adjustments for easy, normal, hard, and expert.
- Promise cube actions.
- Favor actions.
- Player button tie-break behavior.
- Difficulty adjustments.
- Crown voting plan for every law, including climate-icon rows and conditional rows.
- Crown Parliament policy-movement comparison rules.
- Crown treasury vote bands.
- Crown Royal Privilege and Royal Protection behavior.
- Crown solo final scoring adjustment table by scenario and turn.

## Validation Strategy

For each data file:

- Add schema validation.
- Add a source reference field such as `source: "scenario-card-1710"`.
- Add tests that load every data file.
- Add tests that every referenced ID exists.
- Add tests that component counts do not exceed physical limits unless the rules allow proxies.
