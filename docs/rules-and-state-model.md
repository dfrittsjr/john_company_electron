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
  schemaVersion: number; // 2: canonical piece locations (see below)
  gameId: string;
  createdAt: string;
  updatedAt: string;
  mode: "hotseat" | "soloCrown" | "twoPlayerCrown";
  scenario: "1710" | "1758" | "1813" | "long-1710";
  turn: number;
  startTurn: number; // from the scenario's date on the Turn track
  finalTurn: number; // from the scenario's end marker on the Turn track
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

### One canonical location per piece

Every family piece lives in exactly one place in state. Per-player views (a family's
writers, officers, offices, Court shares, Stock Exchange pieces) are computed by the
selectors in `src/engine/selectors.ts`, never stored on the player:

| Piece | Canonical location |
| --- | --- |
| Officeholders, including the Chairman | `company.offices[officeId].holder` |
| Company shares in the Court | `company.court` (the Chairman's piece is one more share) |
| Stock Exchange pieces | `company.stockExchange[].share` |
| Writers in a Presidency box | `india.presidencies[p].writers[playerId]` |
| Writers on orders | `india.regions[r].orders[].writer` |
| Officers | `company.armies[a].officers[playerId]` |
| Commanders | `company.armies[a].commander` |
| Firm shares | `firms[].shares[playerId]` |
| Supply, pensioners, prizes, officers-in-training, Debtor's Prison | `players[id].familyMembers` |

Presidents, Presidency treasuries and Governors are not duplicated on `PresidencyState`;
treasuries live on the office (`company.offices[...].treasury`). The test fixtures assert
after every command that each family's pieces total 18 (36 for the Crown).

Saves made with schema version 1 are refused with a readable error; there is no migration.

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
    officersInTraining: number;
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
  standing: number; // index into companyTracks.standing; 0 = Company failure
  debt: number; // 0-8
  balance: number;
  shareValue: number;
  failed: boolean;
  powerTrack: Record<PowerTargetId, number>;
  offices: Record<OfficeId, OfficeState>;
  vacantOffices: OfficeId[]; // the Hiring queue
  unusedOffices: OfficeId[]; // China, Governor General and Governors until created
  court: ShareInstance[];
  stockExchange: StockExchangeSlot[];
  ships: ShipState[]; // player, Company and extra ships
  armies: Record<ArmyId, ArmyState>;
  governorGeneralInPlay: boolean;
};
```

Expectations are not stored: they are printed under each Standing space
(`companyTracks.standing[standing].expectations`, read with `companyExpectations(state)`).

Ships carry `kind` ("player" | "company" | "extra") and a `location` of "shipyard"
(unfitted), a sea zone ("west-indian" | "south-indian" | "east-indian"), "china", or
`firm:<id>`. A player ship belongs to whoever owns its shipyard card (`shipyardCardId`).

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
  presidencies: Record<PresidencyId, PresidencyState>; // { id, army, writers, seaZone }
  elephant: { regionId?: RegionId; facing?: RegionId };
  eventDiscards: EventTileId[];
  regionsLostThisTurn: number;
};
```

Region state:

```ts
type RegionState = {
  id: RegionId;
  name: string;
  homePresidency?: PresidencyId; // Bombay, Madras and Bengal only
  adjacent: RegionId[];
  orders: OrderState[];
  towerLevels: number;
  hasDome: boolean;
  empireFlag?: EmpireFlagId;
  isCapital: boolean;
  companyControlled: boolean;
  associatedPresidency?: PresidencyId; // set on conquest (p.23), cleared on Region Loss (p.29)
  governorOffice: OfficeId;
  unrest: number;
  lootToken: { available: boolean; value: number | null; face: "loot" | "control" };
  exportIcons: number;
  partialCompanyShip: boolean;
};
```

Regions have no fixed Presidency. A region becomes associated with a Presidency when that
Presidency's Army conquers it, and loses the association on Region Loss. The home regions
only fix which home port a President trades from and which Commander may target them.

Order state:

```ts
type OrderState = {
  id: string;
  value: number;
  deregulationValue: number; // the small number printed beside the order
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

Current setup implementation:

- `turn`/`startTurn`/`finalTurn` come from the scenario (Turn track: 1710 turns 1-5,
  1758 turns 3-7, 1813 turns 5-8, Long 1710 turns 1-8).
- Standing, Debt, regiments, Company ships and "£X in every Company treasury" come from the
  scenario card. The Company treasuries are the coin boxes on the red ribbon: Director of
  Trade (shared with the Governor General), Manager of Shipping and the three Presidencies.
  Military Affairs' box is the Officers-in-Training box and the Chairman has none.
- India comes from `mapData` plus the scenario's Situation in India card: tower levels,
  domes, empire flags (capital + dominated), closed orders and the Elephant. Only 1710 /
  Long 1710 have their Situation in India transcribed.
- All seven starting offices begin vacant (in the Hiring queue); setup cards fill them.
  China, the Governor General and the Governors start in `unusedOffices`.
- Random setup deals the 1710 deck for 1710 and Long 1710 (3-4 players: 12 base cards; 5:
  +3 random extras; 6: +6). Setup shipyards place their ship in the named sea zone or on the
  shipyard if unfitted.
- Until the blackmail deck is encoded, setup `randomBlackmail` effects create facedown
  placeholder blackmail cards in both player state and hidden private card state.
- TODO: loot token values (printed on the punchboard tokens) are `null`; draft setup, Crown
  setup-card distribution, and the 1758/1813 setup cards and Situation in India cards.

For Crown modes, also implement Crown setup as data-driven effects:

- Crown family board, 36 family members from two unused colors, and primary-color-first placement.
- Promise-cube allocation by mode and difficulty.
- Solo and two-player setup-card draft/random distributions.
- Hard and expert difficulty modifications.
- AI deck shuffle, first reveal, initial climate, and two-player Player Button initialization.

### London Season

The London Season is skipped on the scenario's first turn (`turn === startTurn`), not
always on turn 1. On later turns, resolve:

- Attrition (p.11): roll one die per office card, adding the office's existing fatigue and
  +1 for the Chairman. 1-2 nothing; 3-4 add one fatigue; 5+ the officeholder retires to the
  Pensioners box, the office goes to the Vacant Offices box and its fatigue returns to
  supply. Fatigue is never added before the roll. A retiring Chairman takes the Chairman
  slot's Company share with them.
- Pensioners may retire to prize boxes by paying cost and gaining VP. TODO.
- Track cash spent on retirements to determine London Season Display order. TODO.
- Each eligible player takes or discards one prestige/blackmail card. TODO.
- Refill display to three cards. TODO.
- Return remaining pensioners to supplies. Implemented; because retirements are not built
  yet, every pensioner returns to supply at the end of the phase.

For Crown games, add Crown retirement behavior, Crown London Season card selection from the AI-card splay position, Crown spouse/blackmail/enterprise handling, special retirement under Deregulation, and Crown favor windows.

### Family

Starting with the Chairman and proceeding clockwise:

- Choose one family action.
- If the opportunity marker was already on that action, allow the action twice.
  The implemented hotseat flow represents the optional second action as
  `family.chooseRepeatAction`; the marker is moved only after the player either
  takes or declines the repeat.
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

Resolve vacant offices in ascending order of the number printed on the back of each office
card (`OfficeDefinition.hiringOrder`): Chairman 1, Director of Trade 2 (Governor General
also 2), Manager of Shipping 3, Military Affairs 4, Presidents of Bombay 5 / Madras 6 /
Bengal 7, Superintendent of Trade in China 8, Governors of Bombay 9 / Madras 10 / Bengal 11
/ Punjab 12 / Delhi 13 / Maratha 14 / Hyderabad 15 / Mysore 16. This is separate from the
red-ribbon Company Operation order.

Hirers and candidate pools follow the card backs:

- Chairman: elected by Company-share majority (the Chairman's piece counts as a share). A
  player with a pure majority is offered directly; otherwise every shareholder is offered
  as a table-negotiated candidate. Former-Chairman fallback and the empty-Court rule
  (former Chairman places a piece from supply) remain TODO; an empty Court is skipped.
- Director of Trade / Governor General (Chairman hires): any officeholder except Governors
  and the Chairman (a promotion); if none, any writer.
- Manager of Shipping and Superintendent of Trade in China (Chairman hires): any writer.
- Military Affairs (Chairman hires): Commanders, else officers, else officers-in-training.
- Presidents (Director of Trade hires): writers in that Presidency's box and Governors of
  regions associated with that Presidency.
- Governors: hired by the President of the Presidency the region is associated with
  (home-region Governors by their own President). Candidates are writers in that
  Presidency's Writers box and officers in that Presidency's Army. Writers sitting on
  orders are never candidates: they return to their box during Refresh, before Hiring.
- Promotions move the old office card to the vacant stack and carry its fatigue.
- Nepotism (p.14): selecting your own family member pauses on a public consent decision;
  accepted consent completes the hire, denial leaves the vacancy unfilled for the turn.
- Offices with no hirer or no candidates are skipped explicitly.
- For Crown games, enforce Crown Chairman election behavior, Crown support bribes, Crown nepotism consent favors, Crown self-hiring priority, Crown Director of Trade/Governor General selection, and Crown candidate priority.

### Company Operation

Follow the red ribbon office order:

- Current implementation resolves the red-ribbon office loop, skipping vacant
  or uncreated offices with system log entries, giving occupied non-Chairman
  offices a private `companyOperation.passOffice` fallback decision, and
  advancing to Bonuses after the final red-ribbon office.
- Chairman (p.18), implemented: each Debt advance adds £5; up to three advances are free,
  more pause on a `companyOperation.debtConsent` decision (players holding a majority of
  Company shares, Chairman included). Refusal returns the Chairman to a decision capped at
  three. Debt never passes 8. The Chairman must then allocate the whole Balance to the
  Company treasuries (Director of Trade or Governor General, Manager of Shipping, the three
  Presidents). Assumption: like nepotism, consent is one public table decision rather than
  a per-player vote.
- Temporary assumption: skipped vacant/uncreated offices are marked
  `actedThisTurn` to track loop progress until Upkeep refresh resets office
  action flags.

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

Each player gains `£1` for each workshop and each shipyard whose ship is fitted, meaning the
ship is no longer on its shipyard (in a sea zone, China, or on a firm).

### Revenue

If deregulated, firms resolve expenses/dividends before Company expenses (TODO).

Company revenue sequence (p.27), implemented:

- Expenses: `£1` per Debt, per regiment and officer in an Army (not Commanders), and per
  ship in the three sea zones. Ships trading in China count as Eastern (p.25).
- Emergency loans: `+£5` Balance and `+1` Debt each until expenses are met; Debt stops at 8
  but loans continue; loan Debt adds no expense this turn; afterwards the Balance is set to
  zero.
- Public embarrassment: `-1` Standing for 1-2 loans, `-2` for 3 or more.
- Expectations: `-1` Standing if the Balance is below the Expectations printed under the
  current Standing space.
- Dividends: the Chairman pays any number of dividends; each costs `£1` per Company share,
  the Chairman's piece included. Public Enthusiasm: `+1` Standing if more cash was paid
  than Expectations.
- Company failure happens the moment Standing reaches the leftmost space (index 0), from any
  source; the game goes straight to Final Scoring.
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

Current Events in India implementation assumptions:

- `eventsInIndia.confirm` rolls one seeded temporary d6 labeled
  `eventsInIndia.stormDie`, records the result in the log, and preserves it in a
  saveable `eventsInIndia.resolveRolledEvents` pending decision.
- Temporary storm mapping until storm die faces and event tiles are encoded:
  `1-2` show one event tile, `3-4` show two event tiles, and `5-6` show three
  event tiles with storms active.
- Resolving the follow-up command does not consume RNG.
- Storm ship checks, event tile effects, cascades, elephant movement, attacks,
  and region loss remain TODO.

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
