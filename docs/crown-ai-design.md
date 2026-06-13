# Crown AI Design

Use this file with `docs/GAME_DESIGN.md` and `docs/rules-and-state-model.md`. The source is `John_Company_2e_Crown_Handbook_for_BGG_(prepress).pdf` plus the `Playing with One or Two` section in `John-Company-Rules.txt`.

The Crown is not a third-party automation layer. In solo and two-player games it is a full rules actor with its own family board, pieces, offices, shares, ships, writers, cash, promise-cube economy, climate, AI deck, and phase-specific decision logic.

## Mode Support

Supported Crown modes:

- `soloCrown`: one human plus the Crown, with the Crown treated like two setup players.
- `twoPlayerCrown`: two humans plus the Crown, with the Crown treated as one setup family in a three-player game.

The normal multiplayer rules still apply unless overridden by the Crown rules. The game setup screen may expose Crown games as optional, but once selected they must be fully rules-enforced and must not rely on a human manually piloting the Crown.

## Crown Setup

Before setup cards are dealt:

- Create a Crown player using the Crown family board.
- Give the Crown 36 family members from two unused player colors. When placing pieces, consume one color before the other.
- Create the 12 Crown promise cubes and split them between Crown and humans:
  - Solo: 6 with the Crown and 6 with the human.
  - Two-player: 4 with the Crown and 4 with each human.
- Seat the Crown last relative to the setup Chairman. If the Crown is Chairman, seat it immediately before the next office-order player.
- Shuffle the 10-card Crown AI deck, reveal the first card, and set the Crown climate from that card.
- In two-player games, initialize the Player Button using the current AI card direction from the player immediately left or right of the Crown.

Setup card handling:

- Solo draft: repeat four times: human draws 3, keeps 1, gives 2 to the Crown. Human ends with 4 setup cards; Crown ends with 8.
- Solo random variant: deal 4 setup cards to the human and 8 to the Crown.
- Two-player draft: repeat twice: each human draws 3, keeps 2, gives 1 to the Crown. Each human and the Crown end with 4 setup cards.
- Expert difficulty: after the normal setup distribution, give the Crown 3 additional setup cards.

Difficulty:

- `easy`: human promise cards can be traded for promise cubes using the Crown family board rules.
- `normal`: promise cards cannot be traded for promise cubes.
- `hard`: normal rules, plus move 4 additional promise cubes to the Crown. In two-player, take 2 from each human.
- `expert`: hard rules, plus the Crown receives 3 extra setup cards.

## Crown AI Cards

Each Crown AI card must be encoded as structured data. Do not encode card behavior as images only.

Required fields:

```ts
type CrownAiCard = {
  id: string;
  climateIcon: CrownClimateId;
  standingClimateMap: Record<CompanyStandingBand, CrownClimateId>;
  splayCardIndex: 0 | 1 | 2;
  direction: "clockwise" | "counterClockwise";
  presidencyPriority: {
    blackArrow: PresidencyId;
    whiteArrow: PresidencyId;
    fallback: PresidencyId;
  };
  regionPriority: RegionId[];
  familyActionPriority: FamilyActionId[];
  voteToDeregulateLimit: number;
  chairmanSeekDebtProfile: CrownDecisionProfileId;
  chairmanAllocationProfile: CrownDecisionProfileId;
  shippingPurchaseProfile: CrownDecisionProfileId;
  governorGeneralDiceMinimum: number;
  governorDiceMinimum: number;
  commanderLocalAllianceProfile: CrownDecisionProfileId;
  commanderDeployDiceMinimums: {
    nonCompanyControlled: number;
    companyControlled: number;
  };
  commanderDeployAgain: boolean;
  presidentTradeDiceMinimum: number;
  chinaTradeDiceMinimum: number;
  revenueDividendReserve: number;
};
```

If a table in the handbook varies by climate icon, store that table as data keyed by `CrownClimateId` or by a named `CrownDecisionProfileId`. The engine should be able to answer "what would the Crown do now?" from state plus data.

AI-card tie breakers:

- Presidency choices use the facedown deck top card's black arrow, then white arrow, then the remaining Presidency.
- Direction choices use the faceup card direction.
- Three-card splay choices use the faceup card shaded position, then advance right and wrap.
- Region choices use the faceup card region-priority list from left to right.
- If no rule or card breaks a tie, the soloist chooses; in two-player the Player Button holder chooses and then passes the button.

## Promise Cubes And Favors

Promise cubes are a closed economy between humans and the Crown. A favor can either cost cubes paid to the Crown or award cubes taken from the Crown.

State requirements:

```ts
type CrownPromiseState = {
  crownSupply: number;
  byHumanPlayer: Record<PlayerId, number>;
  totalCubes: 12;
};

type CrownFavorDefinition = {
  id: string;
  timing: CrownFavorTiming;
  cost?: number | "X";
  reward?: number | "X";
  mandatory: boolean;
  repeatable: boolean;
  condition: CrownConditionId;
  effect: CrownEffectId;
};
```

Rules:

- Favors are only legal during their listed phase or step.
- A human may perform a favor only if they can fully pay its cost.
- A human may perform a reward favor even when the Crown has fewer cubes than the reward would normally provide; the player receives only available cubes.
- Mandatory favors must be inserted as pending decisions whenever their condition is met.
- In two-player games, promise cubes are tradable between humans during negotiation.
- In two-player games, if both humans want the same Crown favor or the Crown must choose between them, the Player Button holder wins the tie and then passes the button.
- The UI must show whether a favor is a payment, reward, or mandatory favor, and must show the resulting promise-cube movement before confirmation.

## Player Button

The two-player Crown mode requires a first-class Player Button state.

```ts
type PlayerButtonState = {
  holder: PlayerId;
  nextTransferReason?: string;
};
```

Use it when:

- The Crown must decide between the two humans.
- Both humans contest the right to perform the same favor or Crown interaction.
- Handbook text gives two-player player priority for investments, hostile takeovers, writing orders, crisis defense, or equivalent choices.

After resolving one such decision, immediately pass the button to the other human. The holder may also transfer it voluntarily as part of negotiation.

## Crown State

```ts
type CrownState = {
  difficulty: "easy" | "normal" | "hard" | "expert";
  climate: CrownClimateId;
  aiDeck: DeckState<CrownAiCardId>;
  faceupAiCard: CrownAiCardId;
  promiseCubes: CrownPromiseState;
  playerButton?: PlayerButtonState;
  familyPiecePools: {
    primaryColor: string;
    secondaryColor: string;
    primaryRemaining: number;
    secondaryRemaining: number;
  };
  familyTreasury: number;
  pendingFavorWindows: CrownFavorWindow[];
  currentDecisionProfile?: CrownDecisionProfileId;
};
```

Crown hidden information:

- The facedown AI deck order is hidden from humans in normal UI.
- Crown blackmail cards remain facedown and cannot be peeked at by humans.
- The save file may contain this information in `trustedTable` mode, but the UI must not reveal it.

## Phase Behavior

Every phase handler should expose two paths:

- `humanOfficeWithCrownFavors`: the human acts normally, with any relevant Crown favors available or mandatory.
- `crownOfficeAutomation`: the Crown performs the office/phase according to the current AI card, climate, Crown state, and handbook table data.

The following behavior must be encoded from the handbook as data plus named effect handlers.

### Vote To Deregulate

- The Crown does not initiate the special vote unless required.
- The Crown votes last, votes against, and may spend once to move the vote marker to a failing position according to current climate.

### London Season

- At phase start and after Crown retirements, humans may pay cubes to take Crown family treasury cash where allowed.
- The Crown retires pensioners one at a time to the highest VP prize it can afford while spending no more than half of remaining family treasury, rounded up.
- The Crown only uses the low-value retirement space when it grants a London Season card.
- In hard/expert final retirement, the Crown spends as much as possible.
- During Deregulation, the Crown takes the highest VP special retirement it can afford.
- The Crown chooses London Season display cards using the AI-card splay position.
- Spouse text effects are ignored for Crown, but discounts and VP count.
- Crown enterprise prestige cards are faceup and active; Crown blackmail is facedown.
- If card text says the Crown may do something, it does not.
- If card text requires Crown consent, the Crown does not give it unless a Crown favor/rule explicitly overrides that.

### Family

- If there are at least four vacant offices, the Crown takes free writer enlistments before normal actions, including a vacancy-priority writer placement.
- Solo Crown takes two family actions per turn; two-player Crown takes one.
- Family action choice follows the current climate's action-priority row from left to right, skipping unaffordable or illegal actions.
- If the most recent law grants an extra action and that action is one the Crown would take, it is taken as an extra action. After normal actions, the Crown attempts the most recent extra action if it has not already used it.
- Seeking shares uses the cheapest available space, choosing the rightmost cheapest `GBP 3` space when relevant.
- Writer enlistment priorities are: vacant Presidencies with no Crown writers, Crown Presidencies with the fewest Crown writers, Presidencies with the fewest Crown writers, then AI-card Presidency priority.

### Firms

- The Crown never creates a private firm.
- The Crown always consents to firm dissolution and mergers.
- Humans forming firms, fitting Crown ships, or buying back Crown-owned ships can trigger handbook favors.
- After all humans finish investing, the Crown may invest if it has a majority of Company shares and the current climate permits investment.
- Crown firm investment uses Company shares first unless weak, then workshops, but never if it would give the Crown a majority of that firm.
- In two-player, Crown investment initiation follows the Player Button and passes it after each investment.
- During Revenue emergency investment, the Crown does not invest unless a favor specifically makes it invest.
- Crown firm-share dividends can generate promise-cube rewards for humans according to Crown share count.

### Hiring

- After the new Company shares step, humans may use the listed favor to give the Crown cash if it has a Company-share majority.
- Crown shares can be taken or given through listed favors.
- If the Crown has a Company-share majority, or equality while former Chairman, it elects itself Chairman.
- Humans may bribe Crown support for Chairman according to the handbook, including the larger deregulated cost.
- When a human is hiring, Crown consent for nepotism and Crown-over-non-Crown hire priorities are Crown favors.
- When the Crown is hiring, it hires its own family if able.
- Solo Crown may require human nepotism consent when it has at least two promise cubes.
- Two-player candidate consent involving both humans is resolved by unanimous consent and Player Button priority.
- Crown Director of Trade/Governor General selection scans the Company Operation ribbon from Chairman in the AI-card direction and picks the first eligible officeholder.
- Crown candidate priority is writers, then officers, then Governors, with AI-card tie breakers.

### Chairman

If a human is Chairman:

- Mandatory Crown favor for the human Chairman must be enforced when able.
- Crown share consent for extra debt advances follows the climate cost table.
- Allocating Company Balance to Crown offices can award promise cubes according to climate and amount.
- After the human Chairman acts, flip a new AI card and set climate from the Crown family board.

If the Crown is Chairman:

- Flip a new AI card and set climate before the Crown acts.
- Seek Debt based on the current decision profile: open home ports, sea zones below ship thresholds, Crown Commander/army-piece majority, or no debt, plus any player-requested adjustments.
- Allocate Company Balance in the profile priority order, funding partial steps with as much as possible when a full step is impossible.
- Allocate any remainder to Manager of Shipping.

### Director Of Trade And Governor General

If a human is Director of Trade:

- Opening orders in home regions of Crown Presidencies with Crown writers and leaving no Presidency with a large ship/writer lead can award cubes.

If the Crown is Director of Trade:

- Special Envoy opens orders with exactly `GBP 3` per action, targeting the northernmost closed order in the AI-priority region not controlled by the Company.
- Humans may spend cubes to change spend amount, skip envoy actions, target an order, or open China.
- Crown performs two writer/ship transfers using the current transfer-priority profile and AI arrows.
- Transfer source and target ties use AI arrows. Ship selection priority is Company ships, non-fatigued ships, Crown ships, then player ships.

If the Crown is Governor General:

- Govern only while the available dice meet the current profile minimum.
- Successful Govern result defaults to the current climate result among tax, build Company ship, or commission regiment, unless a human pays to choose a different result.

### Manager Of Shipping

If a human is Manager of Shipping:

- Fitting Crown ships and placing ships in Crown Presidencies or China can award cubes.

If the Crown is Manager of Shipping:

- Fit as many Crown ships as possible, then player ships, using the Player Button for human ties.
- Buy Company ships according to current climate profile, with humans able to adjust through favors.
- Spend remaining Shipping treasury on extra ships unless a favor makes the Crown leave `GBP 2` unspent.
- Place all fitted, bought, or leased ships using the climate placement profile.
- A human can pay to place one Crown-fitted ship in a valid sea zone or China.

### Military Affairs

If a human is Military Affairs:

- Assigning the Crown as Commander when able can award cubes and is mandatory where indicated by the handbook.

If the Crown is Military Affairs:

- Attempt two officer/regiment transfers from the current priority profile, skipping impossible transfers and transfers that undo this turn's prior transfer.
- Transfer piece priority is regiments, then Crown officers, then player officers.
- Assign officers-in-training one at a time, separately for player and Crown officers, using the handbook priorities and AI arrows.
- When assigning Commanders, choose a Crown officer over a player officer when both are eligible.

### Presidency Operations

If the Crown is President:

- Governors act first in order of formation, then Commander, then Trade.
- A human may pay to make one operation-order change.

### Governors

If a human is Governor:

- Adding tax funds to Crown Presidencies, moving Company ships to Crown sea zones, or commissioning regiments in Crown armies can award cubes, with once-per-turn limits where specified.

If the Crown is Governor:

- Repeat Administer while the available dice meet the current profile minimum, decreasing dice after each roll.
- A human may adjust the dice minimum or stop all Crown Administer actions.
- Successful Administer result defaults to the current climate result among tax, build Company ship, or commission regiment, unless a human pays to choose a different result.
- Crown tax adds funds to the Crown Presidency first, then any remainder to Company Balance.

### Commanders

If a human is Commander:

- Crown Presidents give or withhold local-alliance consent according to the local-alliance favor table.
- Successful Deploy actions using Crown officers or in Crown-associated Company regions with Crown writers can award cubes as listed.

If the Crown is Commander:

- Crown Presidents always consent to Crown Commander local-alliance purchases.
- Local-alliance purchase behavior follows the current climate profile, with human favors able to force additional, more expensive, less expensive, or no purchases.
- Deploy target selection follows the current profile: home regions with closed orders, Company-controlled associated regions with closed orders, non-Company home regions, adjacent non-Company regions, and other Company-controlled closed-order targets as listed.
- A human may pay to choose a valid target region.
- Crown exhausts local alliances first, then Crown officers, then player officers, then regiments to match the required dice count exactly where possible.
- A human may adjust required dice or swap exhausted pieces before the roll according to the handbook.
- Repeat Deploy according to the current climate profile, with human favors able to force or prevent another Deploy attempt.

### Presidents

If a human is President:

- Placing Crown writers when filling orders can award cubes and may be mandatory where listed.

If the Crown is President:

- Spend enough treasury to reach the current trade dice minimum.
- Prefer the highest-value trade route; trade fewer regions if needed to reach the minimum dice.
- Spend up to `GBP 3` extra on Trade if treasury remains.
- Fill orders by highest route value, then home region, then closest to home, then most southerly among equidistant orders.
- Place Crown writers first, then player writers. Humans may spend cubes to place their own writer instead of another. In two-player games, use the Player Button for human writer priority.

### Superintendent Of Trade In China

If the Crown is Superintendent:

- Roll as many dice as possible for a valid Trade in China action if the available dice meet the current climate minimum.
- Humans may adjust the minimum through the listed favor.

### Revenue

If the Crown is Chairman:

- Pay at least one dividend if possible.
- Pay additional dividends only while leaving the Company Balance reserve indicated by the current climate.
- Humans may pay to adjust dividend count by one where the handbook allows.

Other Crown Revenue rules:

- If emergency loans exist, the Crown discards Royal Protection if available.
- For firm emergency investment, the Crown refuses unless a human pays the listed investment favor.
- Crown firm-share dividend rewards are based on Crown firm shares and require Crown dividends at least equal to every other non-manager shareholder.

### Events In India

- If the Crown is Commander and must defend a Crisis, the soloist chooses exhausted pieces. In two-player, the Player Button holder chooses and then passes the button.

### Parliament Meets

- The Crown always votes first in normal Parliament.
- Crown vote direction follows the Crown voting plan.
- Crown uses all enterprise votes and gains extra votes from family treasury bands.
- If a human is Prime Minister, after law selection and before voting, perform the climate shift roll against Company Standing and move climate left/right according to successes and failures.
- If the Crown is Prime Minister, perform the climate shift, draw laws according to the AI-card splay position, stop on dilemmas, and allow Crown to vote against its own selected law.
- Crown may hold both Prime Minister and Opposition Leader.
- Crown policy movement compares candidate spaces by counting affected player entities against Crown entities, reversing the sign for taxes, and choosing the highest Crown total. Ties use AI direction.
- If Crown chooses a Power policy whose marker is already highest, swap the two bottom Power markers.
- Humans may pay to choose the alternative policy movement when allowed.

Crown voting plan data:

- Encode every law with a `for`, `against`, or conditional rule keyed by law id and climate when the handbook uses climate icons.
- Encode special Prime Minister consequences, such as office removal, commander demotion, impeachment target, War Against France target ordering, and random law choice.
- Treat "most" as including ties where the Crown has at least one matching entity.

### Upkeep And Refresh

- Crown pays family expenses.
- If the Crown cannot afford family expenses or taxes, use Royal Privilege: take needed cash from Company treasury and emergency loans if necessary. This can cause Company failure.
- If the Crown is Chairman and Royal Protection is available, it discards Royal Protection when required by the handbook.
- Solo Crown can award a cube when a human has writers in a Crown Presidency but does not return at least one writer from a filled order there.

### Final Scoring

- In solo games only, award only first-place VP for the Power Award.
- If the Company failed in solo, adjust only the human player's VP according to the scenario/turn table from the handbook.
- Hard/expert final retirement uses the Crown's maximum pensioner spending rule.

## UI Requirements

The Crown UI must make the AI legible without exposing hidden deck order.

Required UI elements:

- Crown family board panel: family treasury, promise cubes, difficulty, climate, faceup AI-card summary, Crown pieces remaining by color.
- Crown action preview: the next automated Crown choice, the data row/profile used, and tie-break source.
- Favor drawer: legal Crown favors for the current phase, with cube cost/reward, repeatability, and mandatory status.
- Player Button indicator and transfer control in two-player Crown mode.
- Crown hidden-info protection for AI deck order and blackmail.
- Setup card draft flow for solo and two-player Crown setup.
- Crown voting plan explanation during Parliament.
- Manual debug override may exist behind a developer flag, but it must not be presented as normal Crown play.

## Tests

Add focused tests for:

- Solo and two-player Crown setup distributions, difficulty adjustments, and promise-cube counts.
- AI-card tie breakers for Presidency, region, splay position, and direction.
- Player Button choice and automatic pass.
- Promise-cube closed economy, including insufficient Crown cube rewards.
- Family action priority and free writer enlistment.
- Crown Chairman debt/allocation profiles.
- Crown office automation for Director of Trade, Shipping, Military Affairs, Governors, Commanders, Presidents, and China.
- Crown Parliament voting plan, treasury vote bands, climate shift, and policy choice.
- Crown hidden information in save/load.
- Solo final scoring adjustments.
