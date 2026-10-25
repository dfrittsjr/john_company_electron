# Events in India (EV)

Rulebook pp.28-33. Code: `src/engine/phases/events-in-india.ts` (commands),
`events-in-india.state.ts` (state slice), and `events-in-india/` (`resolve.ts` tiles and the driver,
`attacks.ts` attacks on the Company and Region Loss, `india.ts` regions, empires, orders and the
Elephant, `context.ts` the per-command draft and logging). Tests: `src/tests/engine/events-in-india.test.ts`
and `events-in-india.fuzz.test.ts`.

## How the phase runs

`eventsInIndia.confirm` (system, entered from Revenue) starts the phase. The driver then resolves
everything automatically and stops only for these player decisions:

| Step | Actor | Choice |
|---|---|---|
| `eventsInIndia.envoyToTheMughals` | each holder of an unplayed Envoy to the Mughals, once, before the storm die | Don't play, or one of every legal Elephant position |
| `eventsInIndia.chooseAttack` | the acting Commander of a Presidency with 2+ Rebellions to face | which region next |
| `eventsInIndia.defend` | the acting Commander, when the Army has a real choice of pieces | a regiment, one officer of a named player, or "the rest automatically" |

In-progress resolution (current tile, its remaining work items, the attack sequence) lives in
`state.eventsInIndia.progress`, so every decision saves and loads mid-phase. The phase ends in
`parliament.confirm`, or in Final Scoring if the Company failed during it.

## Rules implemented

- Draw stack shuffled at setup (setup step 2, p.4); discards kept in the slice.
- Storm die with the six real faces (Wood Manifest p.4). Storms hit player ships only; China ships
  count as Eastern. 3-4 fatigues (or sinks a fatigued ship), 5-6 sinks; sunk ships return to their
  shipyard unfatigued. The face sets the number of event tiles.
- The region on top of the draw stack (after flipping) locates Turmoil, Windfall, Leader, and Foreign
  Invasion without storms, and is the Elephant's March destination.
- Turmoil, Writer Loss, Cascade (once per region per tile), Windfall (pays even under Writer Graft
  Reform), Shuffle (march first, then the tile into the stack and the shuffled discards on top; march
  last if the stack was empty), Leader (tower, Rebellion, or attack on the Company, plus its Elephant
  Redirect), Peace (border and fully-within cases, the Company "instead" case).
- Crisis: Invasion or Rebellion by the Elephant's tail; empire strengths; defender wins ties; Shattered
  Empire; New Empire limited to 3 starred flags; Empire Decline; a failed Invasion or Rebellion lowers
  the attacker's or capital's tower; Imperial Ambitions.
- Foreign Invasion: its own storm die roll picks the linked home regions (or the pictured region); a
  d6 strength; halved tower on success; circle redirect.
- Elephant's March and placement (p.30), including the clockwise skip and Fully-Formed Empires.
- Attacks against the Company (p.32): primary Crisis first, then a Rebellion in every other Company
  region with unrest, Presidencies Bombay → Madras → Bengal, Commander chooses order within one. Unrest
  adds strength (doubled under Sepoy Recruitment, per the guide's ruling). Vacant Commander: Military
  Affairs, then the Chairman, act and gain no trophies.
- Region Loss (p.29): all five steps, Governor General variant, Company failure mid-phase.
- Envoy to the Mughals (blackmail #7) before the storm die, offered only to holders.
- Component limits: 20 tower levels, 3 empire flags.

## Board data derived here

Clockwise neighbour order (`CLOCKWISE_NEIGHBOURS` in `events-in-india/india.ts`), derived from
`board_image-1.png` by flood-filling each region from its fill colour and sorting the midpoints of its
shared borders by angle from the region's centroid, clockwise from north:

| Region | Clockwise |
|---|---|
| Punjab | Delhi, Bombay |
| Delhi | Bengal, Maratha, Bombay, Punjab |
| Bombay | Delhi, Maratha, Hyderabad, Mysore, Punjab |
| Maratha | Bengal, Hyderabad, Bombay, Delhi |
| Bengal | Maratha, Delhi |
| Hyderabad | Maratha, Madras, Mysore, Bombay |
| Mysore | Hyderabad, Madras, Bombay |
| Madras | Hyderabad, Mysore |

## Assumptions (each has a test)

1. **Empty draw stack.** The rulebook doesn't say what happens when the stack runs out (4 events a turn
   can exhaust 20 tiles). The discards are shuffled into a new stack, so a tile is always on top.
2. **Cascade order.** Connections are processed in data order, and a region that must overflow does so
   immediately. "That region" in "close the northernmost open order in that region" is the connected
   order's region.
3. **"Northernmost"** is the smallest `boardPosition.y`.
4. **Strength 0 or less against the Company** (e.g. Crisis −1, no unrest): the Army exhausts nothing,
   the attack fails, unrest clears and the Commander takes a trophy, as written on p.32.
5. **Sovereign region with the Elephant in its centre** (possible after a Region Loss that the Elephant
   doesn't march from): a Crisis there has no target and does nothing; the Elephant still marches.
6. **Foreign Invasion redirect** fires when the Elephant was fully within a Company region that the
   invasion targeted, whatever the result ("that was invaded").
7. **Piece choice in defence**: officers and regiments are interchangeable for the rules in this phase,
   so the decision is only offered when the Army has more than one kind of piece and more than the
   attack needs, with an "exhaust the rest automatically" fast path (regiments, then officers in
   seating order).
8. **A dominated region's Elephant** faces its capital even when the two don't share a border.
9. **Envoy to the Mughals** "legal position" means any position the Elephant's March placement rules
   can produce for some region and shape.

## TODOs for other areas

- `TODO(CO)`: count purchased local alliances in defence (`readyPieces` in `attacks.ts`); each counts
  its printed strength and cannot be split.
- `TODO(PA)`: `finishPhase` in `resolve.ts` still creates the placeholder `parliament.confirm` decision.
- `TODO(NG)`: offer Envoy to the Mughals anytime earlier in the turn (call `playEnvoyToTheMughals`), and
  let Man on the Inside cancel it.
- `LS`: "The British Despots of India!" can use `governorsLostToRegionLossOnTurn(state, finalTurn)`
  from `phases/events-in-india.ts`.
- Integrator: `IndiaState.eventDiscards` is unused (discards live in `state.eventsInIndia.discards`) and
  can be removed. The setup shuffle now consumes the RNG during `createNewGame`; two tests that assumed
  a fresh RNG after setup were made independent of it.
