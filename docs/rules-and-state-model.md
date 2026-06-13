# Rules And State Model

This file gives the implementation-facing model for the game engine. Use it with `docs/GAME_DESIGN.md`.

## Engine Principles

- The engine owns all rules and validation.
- UI sends commands, never state mutations.
- Reducers are deterministic and serializable.
- Every reducer appends a game log entry describing what changed.
- Every nontrivial step returns the next `PendingDecision`.
- Dice rolls use a seeded RNG stored in the save file.
- The state model should represent physical components directly where possible.

## Command Shape

```ts
type GameCommand = {
  id: string;
  gameId: string;
  actorId: ActorId;
  decisionId: string;
  type: string;
  payload: unknown;
  clientTimestamp: string;
};
```

Reducers should reject commands when:

- `decisionId` does not match the current pending decision.
- `actorId` is not allowed to act.
- The requested action is illegal.
- Required consent has not been collected.
- The command attempts to spend or move components from the wrong location.

## Pending Decision Shape

```ts
type PendingDecision = {
  id: string;
  phase: PhaseId;
  step: string;
  actor: ActorId | "simultaneous" | "system";
  visibility: "public" | "private" | "secretCommit";
  prompt: string;
  legalCommands: LegalCommand[];
  canSave: true;
  canUndoBeforeConfirm?: boolean;
};
```

Examples:

- `family.chooseAction` for a specific player.
- `hiring.chooseCandidate` for the officeholder performing a hire.
- `companyOperation.chairmanAllocateBalance` for the Chairman.
- `deploy.chooseExhaustedPieces` for a Commander.
- `parliament.castVotes` for a player in a voting round.
- `firms.chooseSecretStrategy` for simultaneous firm managers.

## Core State Shape

```ts
type GameState = {
  schemaVersion: number;
  gameId: string;
  createdAt: string;
  updatedAt: string;
  mode: "hotseat" | "soloCrown" | "twoPlayerCrown";
  scenario: ScenarioId;
  turn: number;
  finalTurn: number;
  phase: PhaseId;
  pendingDecision: PendingDecision;
  players: Record<PlayerId, PlayerState>;
  seatingOrder: PlayerId[];
  company: CompanyState;
  india: IndiaState;
  parliament: ParliamentState;
  decks: DeckState;
  firms?: FirmState[];
  crown?: CrownState;
  rng: RngState;
  log: GameLogEntry[];
  hidden: HiddenInfoState;
};
```

## Crown State

`soloCrown` and `twoPlayerCrown` games must include `crown`. The Crown is represented as a player with `isCrown: true`, but Crown-specific state lives in `CrownState` so the engine can automate decisions without special UI mutation.

```ts
type CrownState = {
  difficulty: "easy" | "normal" | "hard" | "expert";
  climate: CrownClimateId;
  aiDeck: DeckState<CrownAiCardId>;
  faceupAiCard: CrownAiCardId;
  promiseCubes: {
    crownSupply: number;
    byHumanPlayer: Record<PlayerId, number>;
    totalCubes: 12;
  };
  playerButton?: {
    holder: PlayerId;
  };
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

Crown AI cards must be structured data containing at least climate, standing-to-climate mapping, Presidency arrows, direction, splay-card position, region priority, family-action priority, and climate/profile references for Crown phase tables.

Crown reducers must support:

- AI-card reveal and climate set/shift.
- Presidency, region, direction, splay, and player tie breakers.
- Promise-cube payment/reward as a closed economy.
- Two-player Player Button decisions and automatic pass.
- Legal Crown favor windows, including mandatory favor prompts.
- Automated Crown choices for every phase listed in `docs/crown-ai-design.md`.

## Player State

```ts
type PlayerState = {
  id: PlayerId;
  name: string;
  color: string;
  isCrown: boolean;
  cash: number;
  victoryPoints: number;
  familyMembers: {
    supply: number;
    pensioners: number;
    prizes: Record<PrizeId, number>;
    courtShares: number;
    chairmanShare: boolean;
    stockExchange: string[];
    writers: Record<PresidencyId, number>;
    officersInTraining: number;
    officers: Record<ArmyId, PieceStack>;
    commanders: Record<ArmyId, boolean>;
    offices: OfficeId[];
    firmShares: Record<FirmId, number>;
    debtorPrison: number;
  };
  opportunityMarker: FamilyActionId | "supply" | "removed";
  enterprises: EnterpriseInstance[];
  prestigeCards: CardInstance[];
  blackmailCards: CardInstance[];
  promiseCardsOwned: PromiseCardInstance[];
  promiseCardsGuaranteedToOthers: PromiseCardInstance[];
  trophies: number;
  passedLawTokens: number;
  windows: number;
};
```

## Company State

```ts
type CompanyState = {
  standing: number;
  debt: number;
  balance: number;
  expectations: number;
  shareValue: number;
  failed: boolean;
  powerTrack: Record<PowerTargetId, number>;
  offices: Record<OfficeId, OfficeState>;
  vacantOffices: OfficeId[];
  unusedOffices: OfficeId[];
  court: ShareInstance[];
  stockExchange: StockExchangeSlot[];
  ships: ShipState[];
  extraShips: ShipState[];
  armies: Record<ArmyId, ArmyState>;
  chinaOffice?: ChinaOfficeState;
  governorGeneralInPlay: boolean;
};
```

Office state:

```ts
type OfficeState = {
  id: OfficeId;
  holder?: PlayerId;
  familyMemberId?: string;
  treasury: number;
  fatigue: number;
  vacant: boolean;
  created: boolean;
  actedThisTurn: boolean;
};
```

## India State

```ts
type IndiaState = {
  regions: Record<RegionId, RegionState>;
  presidencies: Record<PresidencyId, PresidencyState>;
  elephant: ElephantState;
  eventDiscards: EventTileId[];
  regionsLostThisTurn: number;
};
```

Region state:

```ts
type RegionState = {
  id: RegionId;
  name: string;
  presidency: PresidencyId;
  adjacent: RegionId[];
  orders: OrderState[];
  towerLevels: number;
  hasDome: boolean;
  empireFlag?: EmpireFlagId;
  isCapital: boolean;
  companyControlled: boolean;
  associatedPresidency?: PresidencyId;
  governorOffice?: OfficeId;
  unrest: number;
  lootToken: {
    available: boolean;
    value: number;
    face: "loot" | "control";
  };
  exportIcons: number;
  partialCompanyShip: boolean;
};
```

Order state:

```ts
type OrderState = {
  id: string;
  value: number;
  isHomePortFor?: PresidencyId;
  closed: boolean;
  filledThisTurnBy: ("company" | FirmId)[];
  writer?: {
    playerId: PlayerId;
    presidency: PresidencyId;
  };
  connectedOrderIds: string[];
  boardPosition: { x: number; y: number };
};
```

## Parliament State

```ts
type ParliamentState = {
  primeMinister: PlayerId;
  policyDialPosition: PolicySpaceId;
  selectedLaw?: LawInstance;
  voteMarker: number;
  currentVotingRound: number;
  oppositionLeader?: PlayerId;
  votesByPlayer: Record<PlayerId, { for: number; against: number }>;
  passedLaws: LawInstance[];
  deregulated: boolean;
};
```

## Phase Requirements

### Setup

Implement scenario setup as data-driven effects:

- Board defaults.
- Scenario marker values for Standing, Debt, Balance, turn, policy dial.
- Starting regiments, local alliances, treasuries, ships, event deck setup, laws, power markers.
- Region setup from scenario card.
- Setup card distribution or draft.
- Initial offices, shares, cash, enterprises, writers, officers, commanders.

The source card data is not fully encoded in `John-Company-Rules.txt`; it must be manually entered from the provided physical/PDF material before setup automation is complete.

For Crown modes, also implement Crown setup as data-driven effects:

- Crown family board, 36 family members from two unused colors, and primary-color-first placement.
- Promise-cube allocation by mode and difficulty.
- Solo and two-player setup-card draft/random distributions.
- Hard and expert difficulty modifications.
- AI deck shuffle, first reveal, initial climate, and two-player Player Button initialization.

### London Season

Skip on the first turn. Then resolve:

- Attrition for each office card held by each player.
- Retirement of officeholders on `5+`, with Chairman `+1` stress modifier.
- Pensioners may retire to prize boxes by paying cost and gaining VP.
- Track cash spent on retirements to determine London Season Display order.
- Each eligible player takes or discards one prestige/blackmail card.
- Refill display to three cards.
- Return remaining pensioners to supplies.

For Crown games, add Crown retirement behavior, Crown London Season card selection from the AI-card splay position, Crown spouse/blackmail/enterprise handling, special retirement under Deregulation, and Crown favor windows.

### Family

Starting with the Chairman and proceeding clockwise:

- Choose one family action.
- If the opportunity marker was already on that action, allow the action twice.
- Apply extra action from the most recent applicable law.
- Support no-action only when player truly cannot act.
- Enforce out-of-family-pieces rule by taking from a prize and lowering VP.
- After all players act, create Company shares from Stock Exchange according to Company Debt, then slide remaining pieces rightward.

For Crown games, insert free Crown writer enlistment, Crown action-priority resolution, solo/two-player Crown action count, extra-action handling from laws, Crown share placement, and Crown writer placement priorities.

### Firms

Only present after Deregulation:

- Firm investments in no fixed order.
- Form firm, invest with Company shares/workshops, acquire ships, hostile takeover, merger.
- Secret firm strategy selection and trade bid.
- Support async secret decisions by storing either hidden strategy data or commitment hashes depending on hidden-info mode.
- For Crown games, the Crown never forms a firm, always consents to dissolution/merger, may invest after humans finish investing if its Company-share majority and climate/profile allow it, never invests if that would give it firm-share majority, and uses Player Button priority for two-player investment/takeover ties.

### Hiring

Resolve vacant offices in ascending office-card order:

- Determine hirer and candidate pool from office data.
- Request consent for nepotism when required.
- Promote candidates and move fatigue from previous office.
- Skip if no hirer or no eligible candidates.
- Elect Chairman by majority Company share support.
- For Crown games, enforce Crown Chairman election behavior, Crown support bribes, Crown nepotism consent favors, Crown self-hiring priority, Crown Director of Trade/Governor General selection, and Crown candidate priority.

### Company Operation

Follow the red ribbon office order:

- Chairman: take debt, then allocate Company Balance to office treasuries.
- Director of Trade: Special Envoy checks, open China or open order, then up to two writer/ship transfers.
- Manager of Shipping: spend until treasury has at most `GBP 2` remaining on leases, fitted ships, or Company ships.
- Military Affairs: two army transfers, assign officers-in-training, appoint commanders.
- Presidencies: President decides order for President trade, Commander, Governors. Vacant President lets Chairman order Commander/Governors only.
- Commander: buy local alliances with President consent/funds, deploy any number of times.
- Governor: administer with diminishing dice pool.
- Superintendent of Trade in China: trade once if eligible.
- Governor General, if in play: replace Director of Trade behavior and Governors.
- For Crown games, each office must branch between human office action with Crown favors and automated Crown office action. Crown automation covers Chairman debt/allocation, Director of Trade special envoy/transfers, Manager of Shipping fitting/buying/leasing/placement, Military Affairs transfers/officer assignment/Commander assignment, Presidency operation order, Governors, Commanders, Presidents, Superintendent of Trade in China, and Governor General.

### Bonuses

Each player gains `GBP 1` for each workshop and each shipyard whose ship is fitted.

### Revenue

If deregulated, firms resolve expenses/dividends before Company expenses.

Company revenue sequence:

- Pay expenses for Debt, army pieces except Commanders, and ships in sea zones.
- Take emergency loans as needed.
- Adjust Standing for public embarrassment.
- Check Expectations and lower Standing if Balance is too low.
- Chairman may pay dividends to Company shares.
- Advance Standing if dividends exceed Expectations.
- Trigger Company failure if Standing reaches the leftmost space.
- For Crown games, apply Crown Chairman dividend reserve behavior, Royal Protection discard behavior, Royal Privilege for unaffordable Crown taxes/expenses, Crown firm emergency investment refusal unless bribed, and Crown firm dividend promise-cube rewards.

### Events In India

Resolve:

- Storm die.
- Storm checks on applicable player/firm ships.
- Number of event tiles shown by storm die.
- Event tile behavior: Turmoil, Windfall, Shuffle, Leader, Peace, Crisis, Foreign Invasion.
- Cascades.
- Elephant March.
- Attacks against Company and region loss.
- For Crown games, if the Crown Commander defends a Crisis, use soloist choice or two-player Player Button choice for exhausted pieces when the handbook gives that choice to humans.

### Parliament Meets

Resolve:

- Prime Minister draws up to three laws, stopping on dilemmas.
- Select law and rotate policy dial to a matching icon.
- Apply starting support.
- Voting rounds until Prime Minister stops or a round has no votes.
- Track opposition and Opposition Leader.
- Resolve pass/fail, policy consequence, law effect, PM transfer on failure.
- Resolve special Deregulation vote where applicable.
- For Crown games, Crown votes first using the Crown voting plan, adds treasury-band votes, performs climate shift after law selection, can vote against its own law while Prime Minister, can hold Prime Minister and Opposition Leader, and chooses policy movement by comparing affected Crown and player entities.

### Upkeep And Refresh

- Pay upkeep for each family member on prizes or remove them and lose VP.
- Return writers to associated Presidencies.
- Remove filled order tokens and dividers.
- Return extra ships.
- Ready exhausted officers/regiments.
- Exhaust active local alliances.
- Advance turn or final score.
- For Crown games, Crown pays family expenses and uses Royal Privilege if it cannot pay. Apply any solo Crown promise-cube reward for human writers in Crown Presidencies that do not return from filled orders.

### Final Scoring

Resolve:

- Firm scoring if deregulated.
- Power Award from power track, PM/laws, cards, trophies.
- Court/share scoring or penalties depending on Company survival.
- Workshops if Company failed.
- Final retirement if Company survived, or Company failure card if failed.
- Tie breakers: most window icons, then Prime Minister order.
- For Crown games, apply hard/expert Crown final-retirement spending. In solo games, only award first-place Power Award VP and apply the handbook's scenario/turn VP adjustment to the human player if the Company failed.

## Reducer Test Fixtures

Create focused fixtures for:

- Share creation from debt.
- Chairman election by majority support.
- Nepotism consent accepted and denied.
- Trade path with closed order blocking.
- Deploy success, loot, governorship creation.
- Region loss and Standing penalty escalation.
- Emergency loans and public embarrassment.
- Parliament pass/fail and opposition leader transfer.
- Firm trade initiative and half-value duplicate orders.
- Crown setup, promise cubes, AI-card tie breakers, Player Button pass, family action priority, Crown Chairman automation, Crown office automation, Crown Parliament voting plan, and solo final scoring adjustment.
- Save/load round trip in the middle of a pending decision.
