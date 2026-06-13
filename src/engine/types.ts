export const GAME_SCHEMA_VERSION = 1;

export type GameMode = "hotseat" | "soloCrown" | "twoPlayerCrown";
export type ScenarioId = "1710" | "1758" | "1813" | "Long 1710" | "long-1710";

export type PhaseId =
  | "setup"
  | "londonSeason"
  | "family"
  | "firms"
  | "hiring"
  | "companyOperation"
  | "bonuses"
  | "revenue"
  | "eventsInIndia"
  | "parliament"
  | "upkeep"
  | "finalScoring";

export type PlayerId = string;
export type ActorId = PlayerId | "system";
export type PrizeId = string;
export type PresidencyId = "Bombay" | "Madras" | "Bengal";
export type ArmyId = PresidencyId;
export type OfficeId = string;
export type FirmId = string;
export type FamilyActionId = string;
export type CardInstanceId = string;
export type CrownAiCardId = string;
export type CrownClimateId = string;
export type CrownDecisionProfileId = string;
export type CrownFavorWindowId = string;
export type CrownFavorTiming = string;
export type CrownConditionId = string;
export type CrownEffectId = string;
export type PolicySpaceId = string;
export type LawInstanceId = string;
export type PowerTargetId = string;
export type RegionId = string;
export type EventTileId = string;
export type EmpireFlagId = string;

export type LegalCommand = {
  type: string;
  label: string;
  description?: string;
  payload?: unknown;
  payloadSchema?: unknown;
};

export type PendingDecision = {
  id: string;
  phase: PhaseId;
  step: string;
  actor: ActorId | "simultaneous";
  visibility: "public" | "private" | "secretCommit";
  prompt: string;
  legalCommands: LegalCommand[];
  canSave: true;
  canUndoBeforeConfirm?: boolean;
};

export type GameCommand = {
  id: string;
  gameId: string;
  actorId: ActorId;
  decisionId: string;
  type: string;
  payload: unknown;
  clientTimestamp: string;
};

export type RngState = {
  algorithm: "xoshiro128ss";
  seed: string;
  counter: number;
  internalState: [number, number, number, number];
};

export type RngRollRecord = {
  algorithm: RngState["algorithm"];
  seed: string;
  startCounter: number;
  endCounter: number;
  label: string;
  values: number[];
};

export type GameLogEntry = {
  id: string;
  sequence: number;
  timestamp: string;
  turn: number;
  phase: PhaseId;
  actor?: ActorId;
  type: string;
  summary: string;
  details?: unknown;
  commandId?: string;
  rngRolls?: RngRollRecord[];
};

export type PieceStack = {
  ready: number;
  exhausted: number;
};

export type EnterpriseInstance = {
  id: string;
  type: "shipyard" | "workshop" | "luxury";
  cardId?: string;
};

export type CardInstance = {
  id: CardInstanceId;
  cardId: string;
  facedown?: boolean;
};

export type PromiseCardInstance = {
  id: string;
  owner: PlayerId;
  guarantor: PlayerId;
};

export type PlayerState = {
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

export type DeckState<CardId extends string = string> = {
  drawPile: CardId[];
  discardPile: CardId[];
  removed: CardId[];
};

export type OfficeState = {
  id: OfficeId;
  holder?: PlayerId;
  familyMemberId?: string;
  treasury: number;
  fatigue: number;
  vacant: boolean;
  created: boolean;
  actedThisTurn: boolean;
};

export type ShareInstance = {
  id: string;
  owner?: PlayerId;
};

export type StockExchangeSlot = {
  id: string;
  cost: number;
  share?: ShareInstance;
};

export type ShipState = {
  id: string;
  owner: "company" | PlayerId | FirmId;
  location: string;
  exhausted: boolean;
};

export type ArmyState = {
  id: ArmyId;
  officers: Record<PlayerId, PieceStack>;
  regiments: PieceStack;
  commander?: PlayerId;
};

export type ChinaOfficeState = {
  holder?: PlayerId;
  treasury: number;
};

export type CompanyState = {
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

export type OrderState = {
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

export type RegionState = {
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

export type PresidencyState = {
  id: PresidencyId;
  president?: PlayerId;
  army: ArmyId;
  commander?: PlayerId;
  treasury: number;
  writers: Record<PlayerId, number>;
  seaZone: string;
  governors: OfficeId[];
  associatedRegions: RegionId[];
};

export type ElephantState = {
  regionId?: RegionId;
};

export type IndiaState = {
  regions: Record<RegionId, RegionState>;
  presidencies: Record<PresidencyId, PresidencyState>;
  elephant: ElephantState;
  eventDiscards: EventTileId[];
  regionsLostThisTurn: number;
};

export type LawInstance = {
  id: LawInstanceId;
  lawId: string;
};

export type ParliamentState = {
  primeMinister?: PlayerId;
  policyDialPosition: PolicySpaceId;
  selectedLaw?: LawInstance;
  voteMarker: number;
  currentVotingRound: number;
  oppositionLeader?: PlayerId;
  votesByPlayer: Record<PlayerId, { for: number; against: number }>;
  passedLaws: LawInstance[];
  deregulated: boolean;
};

export type FirmState = {
  id: FirmId;
  owner: PlayerId;
  treasury: number;
  shares: Record<PlayerId, number>;
};

export type CrownPromiseState = {
  crownSupply: number;
  byHumanPlayer: Record<PlayerId, number>;
  totalCubes: 12;
};

export type PlayerButtonState = {
  holder: PlayerId;
  nextTransferReason?: string;
};

export type CrownFavorWindow = {
  id: CrownFavorWindowId;
  timing: CrownFavorTiming;
  actor?: PlayerId;
  mandatory: boolean;
  favorIds: string[];
};

export type CrownState = {
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

export type FirmStrategySecret = {
  firmId: FirmId;
  committedBy: PlayerId;
  commitmentHash?: string;
  revealedStrategy?: string;
  salt?: string;
};

export type HiddenInfoState = {
  mode: "trustedTable" | "encryptedSecrets";
  privateCards: Record<PlayerId, CardInstance[]>;
  firmStrategySecrets: Record<FirmId, FirmStrategySecret>;
  crownDeck?: DeckState;
  crownBlackmail?: CardInstance[];
};

export type GameState = {
  schemaVersion: number;
  gameId: string;
  createdAt: string;
  updatedAt: string;
  mode: GameMode;
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
  decks: Record<string, DeckState>;
  firms?: FirmState[];
  crown?: CrownState;
  rng: RngState;
  log: GameLogEntry[];
  hidden: HiddenInfoState;
};

export type ValidationError = {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
};

export type ApplyCommandResult =
  | {
      ok: true;
      state: GameState;
      logEntry: GameLogEntry;
    }
  | {
      ok: false;
      errors: ValidationError[];
    };
