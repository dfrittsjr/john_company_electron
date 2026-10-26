import type { CompanyOperationState } from "./phases/company-operation.state";
import type { EventsInIndiaState } from "./phases/events-in-india.state";
import type { FamilyState } from "./phases/family.state";
import type { FinalScoringState } from "./phases/final-scoring.state";
import type { HiringState } from "./phases/hiring.state";
import type { FirmsPhaseState } from "./phases/firms/state";
import type { LondonSeasonState } from "./phases/london-season.state";
import type { NegotiationState } from "./phases/negotiation.state";
import type { ParliamentState } from "./phases/parliament.state";

import type { CrownClimate, CrownDifficulty, ScenarioId as DataScenarioId } from "../data/types";
import type { FirmStrategyId } from "../data/firms";

// Version 2: one canonical location per family piece, scenario-driven setup, Standing as a track index.
export const GAME_SCHEMA_VERSION = 3;

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
export type { CrownClimate, CrownDifficulty };
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
  /** Set on the Crown's own decisions (src/engine/crown/policy.ts). */
  crown?: CrownDecisionInfo;
};

/**
 * How the Crown is deciding (Crown Handbook). `legalCommands` is cut down to what the Crown would
 * do; `all` keeps every option the rules allow, for favours that change the Crown's mind.
 */
export type CrownDecisionInfo = {
  all: LegalCommand[];
  /** Why the Crown chose these options ("Bull: Seek Shares first."), shown and logged. */
  reason: string;
  /**
   * The soloist or Player Button holder, who picks for the Crown among `legalCommands` when the
   * Handbook leaves several options (rulebook p.46) or after a favour lets them choose.
   */
  chooser?: PlayerId;
  /** The Crown is choosing between the two players: the Button passes once it has acted (p.44). */
  passButton?: boolean;
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
  /**
   * Set when `summary` would show who holds a face-down card ("Ann kept their blackmail card.").
   * Only `actor` should read `summary`; online views give everyone else this text, with no actor
   * (src/engine/projection.ts).
   */
  publicSummary?: string;
  /** For the Crown's commands: why the Crown did it (CrownDecisionInfo.reason). */
  crownReason?: string;
};

export type PieceStack = {
  ready: number;
  exhausted: number;
};

export type EnterpriseInstance = {
  id: string;
  type: "shipyard" | "workshop" | "luxury";
  cardId?: string;
  /**
   * A workshop flipped to its invested side to form or invest in a firm (p.38). It stays invested
   * for the rest of the game, gives no bonus, and isn't scored if the Company fails.
   */
  invested?: boolean;
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
  /** The turn this Company share was created. "Immature" shares can't form or invest in a firm that turn (p.38). */
  createdTurn?: number;
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
  /**
   * Local alliances in this Army box (p.21), by alliance id. "ready" (top half) once a Commander
   * buys it this turn; "exhausted" (bottom half) when unbought or used. Refresh exhausts ready ones.
   */
  localAlliances?: Record<string, "ready" | "exhausted">;
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
  /**
   * The family holding the Chairman marker. It stays with the former Chairman while the office
   * is vacant, who then leads retirements and Family turns and runs the next election (pp.11-15).
   */
  chairmanMarker?: PlayerId;
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
  regionsLostThisTurn: number;
};

export type LawInstance = {
  id: LawInstanceId;
  lawId: string;
};

/** Parliament (and Revenue) state is owned by phases/parliament.state.ts. */
export type { ParliamentState } from "./phases/parliament.state";

/**
 * A firm (Deregulation, rulebook pp.37-42). It sits on its manager's family board, flipped to the
 * firm charter side. Its ships are company.ships entries located at `firm:<id>`.
 */
export type FirmState = {
  /** Stable for the firm's life ("firm-1", ...). A hostile takeover changes the manager, not the id. */
  id: FirmId;
  /** Whose family board holds the charter. The firm's name comes from that board (firmName()). */
  manager: PlayerId;
  /** Investments land here; pays expenses and fits ships (p.37). */
  londonTreasury: number;
  /** Trade revenue lands here; pays dividends and expenses, then the rest moves to London (p.37, p.42). */
  indiaTreasury: number;
  /** The Value track space, 1-10 (charter). Starts at 1. */
  value: number;
  /**
   * £ paid out in the last dividends: the dividend cube on the Company Balance track (p.42).
   * Undefined until first placed; such a firm, or one at 0, can't fund a special retirement (p.37).
   */
  dividendCube?: number;
  /** Firm shares are family pieces; this is their only location. At most 10 in total. */
  shares: Record<PlayerId, number>;
  formedTurn: number;
  /** £ on the charter's Trade Bid box this turn. Set (and taken from London) once every manager has chosen (p.40). */
  tradeBid?: number;
  /** This turn's trading at its Presidency (p.40). Cleared in Refresh. */
  trade?: FirmTradeRecord;
};

export type FirmTradeRecord = {
  /** The strategy card, revealed at its Presidency's start. */
  strategy: FirmStrategyId;
  dice: number;
  successes: number;
  /** Ships minus successes, when at least one success let the firm trade. May be negative (p.40). */
  initiative?: number;
  /** £ added to the India treasury by this turn's trade. */
  income: number;
};

/** The 12 Crown promise cubes (rulebook p.43, p.46): a closed economy between the Crown and the players. */
export type CrownPromiseState = {
  crownSupply: number;
  byHumanPlayer: Record<PlayerId, number>;
};

/** Two-player games: whoever the Crown favours when it must choose between the players (p.44). */
export type PlayerButtonState = {
  holder: PlayerId;
};

/**
 * A favour bought earlier whose effect a later Crown decision reads (e.g. "one more die required").
 * Dropped when the phase ends unless the area that set it clears it sooner.
 */
export type CrownFavorEffect = {
  favorId: string;
  by: PlayerId;
  turn: number;
  phase: PhaseId;
  /** The decision it was bought during. */
  decisionId: string;
  /** The favour's chosen option, if it had any. */
  option?: unknown;
  /**
   * "Choose for the Crown" favours: the commands (from CrownDecisionInfo.all) the buyer may pick
   * from on decision `decisionId`.
   */
  choices?: LegalCommand[];
};

/** Crown setup card draft (rulebook pp.43-44), while it runs. */
export type CrownSetupDraftState = {
  /** Undrawn setup cards, top first. */
  deck: string[];
  /** The cards the picker has drawn and must choose from. */
  hand: string[];
  picker: PlayerId;
  /** Picks still to make, in order. */
  queue: PlayerId[];
  kept: Record<PlayerId, string[]>;
};

export type CrownState = {
  difficulty: CrownDifficulty;
  climate: CrownClimate;
  /**
   * The face-down AI deck, top first. The back of its top card is visible to everyone and breaks
   * ties (p.45); the order below it is hidden.
   */
  aiDeck: DeckState<CrownAiCardId>;
  faceupAiCard: CrownAiCardId;
  promiseCubes: CrownPromiseState;
  playerButton?: PlayerButtonState;
  /** The Crown has two families' pieces (36); the UI shows the first colour (p.43). */
  colors: [string, string];
  favorEffects: CrownFavorEffect[];
  setupDraft?: CrownSetupDraftState;
  /**
   * Online games: the favours the players have passed on this turn (crownPausingFavorKeys), so the
   * server's Crown does not wait for them again. Local games keep their own set in the browser.
   */
  passedFavors?: string[];
  // Per-area Crown memory (src/engine/crown/areas/*). Each area adds its own optional fields here.
  // --- early phases (London Season, Family, Firms, Hiring) ---
  // --- offices (Chairman, Director of Trade / Governor General, Shipping, Military Affairs) ---
  // --- presidencies (Presidency operations, Events in India, Revenue) ---
  // --- parliament (Parliament, Upkeep, Final Scoring, negotiation) ---
};

/**
 * One manager's Firm Strategy choice this turn (p.40). Online, only its manager sees `strategy` and
 * `bid` until every manager has chosen; the bid then becomes FirmState.tradeBid, and the strategy
 * stays secret until `revealed` at its Presidency's start (src/engine/projection.ts).
 */
export type FirmStrategySecret = {
  firmId: FirmId;
  committedBy: PlayerId;
  strategy?: FirmStrategyId;
  /** £ from the London treasury; 0 for Hobnob. */
  bid?: number;
  revealed?: boolean;
};

/**
 * The setup card draft for 3-6 player games (rulebook p.5), while it runs: each player picks one
 * card from the hand in front of them, then the hands pass left. Private until the draft ends.
 */
export type SetupDraftState = {
  /** The setup deck being drafted (a key of `setupCardDecks`). */
  deckId: string;
  /** The hand in front of each player, still to pick from. */
  hands: Record<PlayerId, string[]>;
  /** What each player has picked so far, in order. */
  picks: Record<PlayerId, string[]>;
  /** The players drafting, in seat order; hands pass to the next one (left, clockwise). */
  order: PlayerId[];
  /** Players who have not yet picked from the hand in front of them this round, in order. */
  queue: PlayerId[];
  /** Extra cards left out of the draft (p.5). */
  removed: string[];
};

export type HiddenInfoState = {
  mode: "trustedTable" | "encryptedSecrets";
  privateCards: Record<PlayerId, CardInstance[]>;
  /** Optional: only while a setup card draft runs. */
  setupDraft?: SetupDraftState;
  firmStrategySecrets: Record<FirmId, FirmStrategySecret>;
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
  family: FamilyState;
  hiring: HiringState;
  decks: Record<string, DeckState>;
  firms?: FirmState[];
  /** Round and merger bookkeeping while the Firms phase runs (phases/firms/state.ts). */
  firmsPhase?: FirmsPhaseState;
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
