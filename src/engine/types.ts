import type { CompanyOperationState } from "./phases/company-operation.state";
import type { EventsInIndiaState } from "./phases/events-in-india.state";
import type { FinalScoringState } from "./phases/final-scoring.state";
import type { LondonSeasonState } from "./phases/london-season.state";
import type { NegotiationState } from "./phases/negotiation.state";

import type { ScenarioId as DataScenarioId } from "../data/types";

// Version 2: one canonical location per family piece, scenario-driven setup, Standing as a track index.
export const GAME_SCHEMA_VERSION = 2;

export type GameMode = "hotseat" | "soloCrown" | "twoPlayerCrown";
export type ScenarioId = DataScenarioId;

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

/**
 * Family pieces stored on the player are those whose only location is a per-family box.
 * Pieces in shared locations (offices, Court, Stock Exchange, Writers boxes, orders, Armies,
 * firm shares) live in those locations only; use src/engine/selectors.ts for per-player views.
 */
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
    officersInTraining: number;
    debtorPrison: number;
  };
  opportunityMarker: FamilyActionId | "supply" | "removed";
  enterprises: EnterpriseInstance[];
  prestigeCards: CardInstance[];
  /** Face-down cards are unplayed and transferable; face-up cards have been played (p.12). */
  blackmailCards: CardInstance[];
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
  /** The family whose piece sits on this office. The Chairman's piece also counts as a Company share. */
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

export type SeaZoneId = "west-indian" | "south-indian" | "east-indian";

/**
 * Ship locations: "shipyard" (unfitted, player ships only), a sea zone, "china",
 * or `firm:<firmId>`. A player ship's owner is whoever owns the shipyard card it belongs to.
 */
export type ShipState = {
  id: string;
  kind: "player" | "company" | "extra";
  shipyardCardId?: string;
  location: "shipyard" | SeaZoneId | "china" | `firm:${string}`;
  fatigued: boolean;
};

export type ArmyState = {
  id: ArmyId;
  officers: Record<PlayerId, PieceStack>;
  regiments: PieceStack;
  commander?: PlayerId;
};

export type CompanyState = {
  /** Index into companyTracks.standing; 0 is the failure space. Expectations derive from it. */
  standing: number;
  debt: number;
  balance: number;
  shareValue: number;
  failed: boolean;
  powerTrack: Record<PowerTargetId, number>;
  offices: Record<OfficeId, OfficeState>;
  vacantOffices: OfficeId[];
  unusedOffices: OfficeId[];
  /** Company shares in the Court box. The Chairman's piece is an additional share. */
  court: ShareInstance[];
  stockExchange: StockExchangeSlot[];
  ships: ShipState[];
  armies: Record<ArmyId, ArmyState>;
  governorGeneralInPlay: boolean;
};

export type OrderState = {
  id: string;
  value: number;
  deregulationValue: number;
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
  /** Fixed for the three Presidency home regions only. */
  homePresidency?: PresidencyId;
  adjacent: RegionId[];
  orders: OrderState[];
  towerLevels: number;
  hasDome: boolean;
  /** Empire flag on this region's dome; the capital carries the starred flag. */
  empireFlag?: EmpireFlagId;
  isCapital: boolean;
  companyControlled: boolean;
  /** Set when a Presidency's Army conquers the region (p.23); cleared on Region Loss (p.29). */
  associatedPresidency?: PresidencyId;
  governorOffice: OfficeId;
  unrest: number;
  lootToken: {
    available: boolean;
    /** Printed loot modifier; null until the punchboard tokens are transcribed. */
    value: number | null;
    face: "loot" | "control";
  };
  exportIcons: number;
  partialCompanyShip: boolean;
};

/** Presidents, Commanders, treasuries and Governors live in company.offices / company.armies. */
export type PresidencyState = {
  id: PresidencyId;
  army: ArmyId;
  /** The Presidency's Writers box. */
  writers: Record<PlayerId, number>;
  seaZone: SeaZoneId;
};

export type ElephantState = {
  regionId?: RegionId;
  /** The region the Elephant faces across a border; omitted when it stands in the region's centre. */
  facing?: RegionId;
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
  /** Firm shares are family pieces; this is their only location. */
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
  startTurn: number;
  finalTurn: number;
  phase: PhaseId;
  pendingDecision: PendingDecision;
  players: Record<PlayerId, PlayerState>;
  seatingOrder: PlayerId[];
  company: CompanyState;
  india: IndiaState;
  parliament: ParliamentState;
  londonSeason: LondonSeasonState;
  companyOperation: CompanyOperationState;
  eventsInIndia: EventsInIndiaState;
  finalScoring: FinalScoringState;
  negotiation: NegotiationState;
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
