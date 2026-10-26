# The Crown (solo and two-player games)

The Crown is the automated family you play against with one or two players (rulebook pp.43-46).
Its behaviour comes from the Crown Handbook (`printnplay/Rulebooks/John Company Solo Handbook.pdf`),
transcribed verbatim in `src/data/crown-handbook.ts`. The ten AI cards and the Crown board's favours
are in `src/data/crown.ts`. Read the Handbook text in the data file, not the PDF: it is checked.

To print one page of it:

```sh
node -e '
const src=require("fs").readFileSync("src/data/crown-handbook.ts","utf8");
const start="export const crownHandbook: CrownHandbookPage[] = ";
const pages=JSON.parse(src.slice(src.indexOf(start)+start.length, src.indexOf("];\n\n/** Rulebook")+1));
for (const p of pages.filter(p=>p.page==Number(process.argv[1]))) for (const s of p.sections) {
  console.log("## "+s.title+(s.subtitle?" / "+s.subtitle:"")); if (s.text) console.log(s.text);
  for (const f of s.favors||[]) console.log("  FAVOR "+JSON.stringify(f.cost)+(f.mandatory?" [mandatory]":"")+": "+f.text);
  for (const t of s.tables||[]) console.log("  TABLE "+t.columns.join(" / ")+" | "+t.rows.map(r=>r.join(" / ")).join(" || ")); }
' 5
```

## How it works

The Crown is a player (`CROWN_PLAYER_ID = "crown"`, `isCrown: true`) with 36 family pieces. It
holds offices, writers, officers, shares and cash (its family treasury is `players.crown.cash`).

**Phases give the Crown its decisions like anyone else's, with `actor: "crown"`.** They must not skip
the Crown, hand its choices to `"system"`, or decide for it inline. After every accepted command,
`applyCommand` runs `afterCrownCommand` (`src/engine/crown/hook.ts`), which calls
`crownizeDecision` (`src/engine/crown/policy.ts`) on the new pending decision:

1. If the decision is the Crown's, it looks up the **policy** registered for the decision's `step`.
2. The policy returns a `CrownChoice`: the options the Crown takes (a subset of `legalCommands`,
   matched by type and payload) and a short reason ("Bull: Seek Shares first.").
3. `legalCommands` is cut down to those options. `decision.crown` keeps `all` (every legal option),
   the `reason`, and a `chooser` when more than one option is left.
   - One option: the Crown takes it. The UI and harness apply it with `actorId: "crown"`.
   - Several options: "If the Crown faces more than one option, the soloist (or the player holding
     the Button) may make a free choice between them when the rules do not otherwise make a
     distinction" (p.46). The chooser picks; the command is still sent as `"crown"`.
   - No policy for the step, or the policy returns undefined: the chooser picks from everything.
     This is the safe fallback, so the game never stalls; it is also the right rule where the
     Handbook gives the choice to the players (Events in India: "you choose which pieces will be
     exhausted").
4. The reason is stored on the log entry of the Crown's command (`GameLogEntry.crownReason`).

`runCrownSteps` (`src/engine/automatic.ts`) plays the Crown's single-option steps (and single-option
`system` steps) in a row. It stops when a player must act, when someone must choose for the Crown,
or when a favour that would change the Crown's step is on offer (`crownFavorsPausing`), so players
get the chance to buy it before the Crown acts. Once the players let the Crown act, the favours that
were on offer count as passed on (`crownPausingFavorKeys`, keyed by turn, phase and office or
Presidency), so the Crown doesn't stop for the same favour before every step of one office. The UI
also has a per-browser switch, "Wait for me when a favour could change the Crown's move"; with it off
the Crown plays straight through (favours can still be bought whenever play stops).

### Modules (`src/engine/crown/`)

| File | What | Who edits |
|---|---|---|
| `state.ts` | Pure helpers: climate, AI card tie-breaks, cubes, Player Button, favour effects, log | core (small additive helpers allowed; say so in your report) |
| `kit.ts` | Types (`CrownPolicy`, `CrownChoice`, `CrownFavorDefinition`, `CrownCubeDetector`, `CrownArea`) and builders | core |
| `policy.ts`, `favors.ts`, `hook.ts`, `registry.ts`, `commands.ts`, `setup.ts` | The machinery | core |
| `areas/early-phases.ts` | London Season, Family, Firms, Hiring (Handbook pp.2-3) and the Crown board favours | area A |
| `areas/offices.ts` | Chairman, Director of Trade / Governor General, Shipping, Military Affairs (pp.4-9) | area B |
| `areas/presidencies.ts` | Presidency operations, Governors, Commanders, Presidents, China (pp.10-13), Events in India, Revenue (p.14) | area C |
| `areas/parliament.ts` | Vote to Deregulate (p.2), Parliament (pp.14-16), Upkeep and Game End (p.15), negotiation | area D |

An area module exports a `CrownArea`: `pages` it owns, `policies` by step (a key ending in `*`
matches a prefix), `favors`, `detectors` and `notDone`. Areas may import `kit.ts`, `state.ts`, the
data and any engine or phase module. **Phase modules may import only `crown/state.ts`** (and types
from `kit.ts`): importing an area, `policy.ts` or `registry.ts` from a phase makes an import cycle.
If a phase needs a Crown rule inline, put it in a helper file under `crown/areas/` that imports no
phase module, or in `state.ts`.

If an area needs memory across steps, add optional fields to `CrownState` in
`src/engine/types.ts`, in that area's marked section, or to its phase's own state.

### The AI cards (rulebook p.45; `state.ts`)

- `crownPresidencyOrder(state)`: Presidencies in the order the Crown tries them (black 1st arrow,
  white 2nd arrow on the back of the top face-down card, then the third). Use for every "break ties
  with the AI card" or "if the Crown must choose between the Presidencies". `byCrownPresidencyOrder`
  sorts any list by it.
- `crownDirection(state)`: clockwise or counterclockwise (the pointing hand).
  `seatsInCrownDirection(state, from)` lists seats in that direction.
- `crownSplayIndex(state, available)`: which of a row of three cards (London Season Display, law
  draws).
- `crownRegionOrder(state)` / `byCrownRegionOrder`: the region strip.
- `crownPickPlayer(state, candidates)`: when the Crown chooses between the two players it picks
  the Button holder, and the Button passes (return `passButton: true` in the `CrownChoice`; the
  hook passes it once the Crown's command is applied).

### Climate

`crown.climate` is one of `bull, stag, lion, bear, peacock` (left to right). Setup sets it from
the face-up card. `flipAiCard(state, now)` turns up the next card and sets the climate from its chart
(the Chairman's step, Handbook pp.4-5). `shiftClimate(state, ±n)` is the Parliament climate shift
(p.15). `climateFromCard` and `criterionValue` read the chart.

### Promise cubes and favours (rulebook p.46)

There are 12 cubes, split between the Crown and the players (`crown.promiseCubes`). Red favours
(negative cost) are paid to the Crown; blue ones (positive) are gained from it, up to what it has.
`exchangeCubes(state, playerId, signedCount, { partial })` moves them. In two-player games cubes
change hands with the anytime command `crown.giveCubes`.

Players buy favours with the anytime command `crown.favor { favorId, option? }`. A favour is a
`CrownFavorDefinition`:

- `printed`: `{ page, text }`, the Handbook page and the start of the favour's text (unique on that
  page), or `{ board, take? }` for the Crown board. Its printed cost, per climate when it varies, is
  read from the data; `"—"` means not available in that climate. Give `cost` for "X" costs.
- `available(state, playerId)`: its timing. "Favors are only available during the resolution of the
  indicated phase or step" (p.46). Check the phase, the step, who holds the office, and any condition
  in the text.
- `options`: for favours with a choice in them (which office, which order). Each option is offered
  separately.
- `apply`: the effect. Most favours are one of:
  - **choose for the Crown** ("Make a hiring decision for the Crown", "Target a specific order",
    "Choose a valid region"): `chooseForCrownFavor({ id, printed, steps, choices? })`. The buyer
    then picks the Crown's option on this decision from `choices` (default: every legal option).
  - **change a number** ("Increase or decrease the required number of dice by 1", "pays out 1 less
    dividend", "must leave £2 unspent"): `effectFavor({ ... options })`; the policy reads
    `crownEffects(state, favorId)` and adjusts. Effects last until the phase ends; clear them
    sooner with `clearCrownEffects` when they apply to one action.
  - anything else: write `apply` directly.
- `pausesCrown` (default true): false for long windows such as the board favours, which shouldn't
  stop every Crown step.

**Cube detectors** cover favours that describe something the player does: "+1: Fit a Crown ship",
"+X: Place X Crown writers when filling orders", the mandatory "-3: If you form a private firm".
A `CrownCubeDetector` compares the state before and after each human command and returns the cubes
earned (positive) or owed (negative, paid with what the player has when `partial`). Gains are
automatic: nobody refuses free cubes.

**Mandatory favours** (darker boxes) always apply when their condition holds ("This always applies,
even if you have no choice"). Make them detectors.

**Consent from the Crown.** "If any card requires permission or consent from the Crown, they will not
give it" (p.2), unless the Handbook says otherwise (the Crown "always give[s] consent for dissolution
and merging of firms"; Crown Presidents always consent to Crown Commanders' Local Alliances). Where a
favour buys the Crown's consent ("-2: Consent for Nepotism"), the consent decision is the Crown's:
its policy refuses, and the favour is a `chooseForCrownFavor` whose `choices` are the consenting
options.

Every favour printed on an area's pages must be in its `favors`, `detectors` or `notDone` (with the
reason): `src/tests/engine/crown-core.test.ts` checks this.

### Interpretations (where the Handbook doesn't define a term)

- **Crown Presidency**: one whose President is the Crown (`isCrownPresidency`). **Player
  Presidency**: one whose President is a human family. **Crown Superintendent**: the Crown holds
  Superintendent of Trade in China.
- **Crown writers in a Presidency**: in its Writers box plus on its orders (`writersOf`).
- **"Most"** means more than or equal to everyone else, with at least one; **"fewest"** means less
  than or equal, zero included (p.46).
- **"Longest" / "shortest" trade route**: the most orders a President could fill in one go,
  irrespective of ships (p.46).
- The Crown's free choices go to the soloist or Button holder (p.46): return several commands.
- The Crown doesn't negotiate: it makes no deals, accepts none, and gives no consent unless the
  Handbook says so. Its blackmail cards stay face down (p.2).
- "If You Are Chairman: -1 [mandatory] You must always perform this favor if able." The favour has
  no other text. We read it as: a human Chairman pays the Crown 1 cube (if they have one) each time
  they act as Chairman.

### Setup (`crown/setup.ts`, done)

Crown games run in any scenario ("Set up a game in any scenario", p.43), with that scenario's setup
cards (Long 1710 deals the 1710 cards; `setupDeckIdForScenario`). The 1813 Private Firm card says "OR £3
if dealt to the Crown": the Crown gets £3 and no firm exists, matching the Handbook (p.3, Firms Phase:
"The Crown never creates a private firm"), so no Crown-managed firm ever exists. Draft or random
deal (pp.43-44), Expert's three extra cards (drawn from the 5-6 player extras), Hard's extra cubes,
the Crown seated last relative to the Chairman, the climate from the face-up card, and the Player
Button to the side the finger points. The London Season is skipped on the first turn, as usual.

## Areas

Each area: make the Crown act in its phases (find where phases skip `isCrown` players or send their
decisions to `system`); write the policies; cover every favour on its pages; test.

### A. London Season, Family, Firms, Hiring (Handbook pp.2-3, the Crown board)

London Season: retirements (highest VP prize spending no more than half, rounded up, of the
remaining treasury; the £2 space only if it entitles them to a card; Hard/Expert final retirement
spends as much as possible), special retirements under Deregulation, prestige picks by the splay
slot, the Crown ignores Spouse text effects, keeps blackmail face down, uses enterprise cards, never
does what a card says it "may", never consents. Family: free writer enlistment, the climate's action
chart left to right (two actions solo, one in 2P), the extra action rule, Seek Shares on the
cheapest space (rightmost £3), the writer enlistment priorities. Firms: the Crown never forms a
firm, always consents to dissolving and merging, the investing chart (only after all players, only
with a majority of Company shares, never to take a firm majority; 2P by the Player Button). Hiring:
Chairman election (majority, or equality as former Chairman, elects itself), the Crown always hires
its own family, DoT/GG selection by direction from Chairman, candidate priority (writers, officers,
Governors; AI card for ties). The board favours (give or take shipyards, workshops, luxuries,
prestige enterprises, £3; Easy: remove a promise card), available from the start of Firms to the
end of Revenue.

### B. Offices (Handbook pp.4-9)

Chairman: Set Climate (a human Chairman flips a new AI card after acting; the Crown flips before it
acts; nothing may happen between the flip and the new climate), Seek Debt (per-climate table), the
Crown's allocation priorities with "give as much as possible" and the remainder to Shipping; the
human Chairman's favours and the mandatory -1. Director of Trade: Special Envoy with exactly £3 on
the northernmost closed order in the first priority region not Company-controlled, repeated while
£3+ remains; the two transfers from the per-climate priority list with the AI card tie-breaks and
the ship order (Company, non-fatigued, Crown, player); not undoing a transfer. Governor General:
Govern while the required dice can be rolled, the success result by climate, the human GG's +1
favours. Manager of Shipping: fit Crown ships then player ships (Button), buy Company ships by
climate, lease extra ships with what's left, placement by climate. Military Affairs: two transfers
by priority, assigning officers (players' first, then the Crown's, the per-climate list with the
tie-break steps), Commanders (the Crown's own officer), the mandatory "+1 assign the Crown as
Commander". Also the Bonuses phase if the Crown is skipped there.

### C. Presidencies, Events in India, Revenue (Handbook pp.10-14)

Crown President: Governors act first in order of formation, then the Commander, then Trade (and
the favour to change that order); Trade with the required dice by climate and up to £3 more;
filling orders (highest value route; home region, then nearest, then southernmost; Crown writers
first, then players' by the Button in 2P). Governors: Administer while the required dice can be
rolled, the result by climate. Commanders: Local Alliance purchase by climate (Crown Presidents
always consent to Crown Commanders), deploy targets by climate, exhausting Local Alliances, then
Crown officers, player officers, regiments to match the required dice, deploy again by climate.
Superintendent of Trade in China: required dice. Events in India: a Crown Commander defending a
Crisis lets the player (Button holder) choose the pieces. Revenue: a Crown Chairman's dividends
(leave £X by climate), Royal Protection discarded when there are emergency loans, emergency
investments in firms, the firm dividend favour.

### D. Parliament, Upkeep, Game End, negotiation (Handbook pp.2, 14-16)

Vote to Deregulate (p.2: never initiates unless it must, votes last and against, spends up to £X
once if it moves the marker to failing). Parliament Meets: the Crown votes first, by the Voting Plan
(p.16; "most" includes ties), with all its enterprise votes plus the treasury bonus votes. Climate
shift (p.15): after the law is chosen and before voting, roll 6 dice against Company Standing,
whoever is PM. A Crown PM draws laws by the shaded slot, stops on a Dilemma, may vote against its own
law, may be PM and Opposition Leader; policy marker movement by net entity counts (ties by the AI
card arrows; the Power swap rule); the law-specific choices in the Voting Plan (Board of Control,
Impeachment, War Against France, Military Oversight, Old Ideas Made New). Royal Privilege: the Crown
pays taxes and family expenses from the Company treasury when it can't, taking emergency loans.
Upkeep: family expenses and the solo favour. Game End: solo Power Award first place only, and the
soloist's failure adjustment table. Negotiation: the Crown makes and accepts no deals, gives no
consent, and players can't give it items through deals (the board favours are the way to trade
with it).

## Testing

- Tests go in `src/tests/engine/crown-<area>.test.ts`. `src/tests/fixtures/crown.ts` has
  `newCrownGame`, `startedCrownGame` (random setup, at the first Family decision), `act`, `command`
  (anytime commands), `crownPlays` and `playUntil`. Build situations by editing a started game's
  state, then check the Crown's `pendingDecision.legalCommands` and `crown.reason`, and that each
  favour is offered (`crownFavorOffers`) and does what it says.
- Harness games against the Crown: one or two `--players` make a Crown game.

  ```sh
  npm run harness -- new /tmp/x.joco --players Ann --seed a1          # solo
  npm run harness -- new /tmp/y.joco --players Ann,Ben --seed b1      # two players
  npm run harness -- random /tmp/x.joco --steps 5000 --policy greedy --anytime 10 --seed r1
  npm run harness -- show /tmp/x.joco        # Crown line, reason, chooser, favour offers
  npm run harness -- favor /tmp/x.joco 0 --actor player-1
  npm run harness -- log /tmp/x.joco --last 300
  ```

  `--anytime N` also buys random favours. Games must reach Final Scoring with no rejected listed
  move and no broken invariant (cubes always total 12).
