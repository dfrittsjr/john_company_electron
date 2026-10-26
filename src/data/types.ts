export type ScenarioId = "1710" | "1758" | "1813" | "long-1710";

export type PlayMode = "hotseat" | "soloCrown" | "twoPlayerCrown";

export type PresidencyId = "bombay" | "madras" | "bengal";

export type RegionId =
  | "bengal"
  | "delhi"
  | "bombay"
  | "punjab"
  | "maratha"
  | "madras"
  | "mysore"
  | "hyderabad";

export type FamilyActionId =
  | "enlist-writer"
  | "enlist-officer"
  | "purchase-luxury"
  | "purchase-shipyard"
  | "purchase-workshop"
  | "seek-share";

/** The Crown's five climates (Crown family board, AI cards, Crown Handbook). */
export type CrownClimate = "bull" | "stag" | "lion" | "bear" | "peacock";

export type DataSourceRef =
  | "John-Company-Rules.txt"
  | "board_image-1.png"
  | "printnplay/Cards/John Company Cards (MiniEuro, Fronts).pdf"
  | "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf"
  | "printnplay/Cards/John Company Cards (Bridge, Bridge).pdf"
  | "printnplay/Rulebooks/John Company Rules.pdf"
  | "rulebook-scenario-1710"
  | "rulebook-scenario-1758"
  | "rulebook-scenario-1813"
  | "rulebook-scenario-long-1710"
  | "crown-handbook";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  path: string;
  message: string;
  source?: DataSourceRef;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type ScenarioCompleteness = "starter" | "placeholder" | "complete";

export type ScenarioSetupSection =
  | "companyTracks"
  | "turnAndPolicyDial"
  | "startingRegiments"
  | "startingCompanyShips"
  | "mapSetup"
  | "lawsAndDilemmas"
  | "setupDeck"
  | "deregulation";

export type StandingSpaceDefinition = {
  /** 0 is the leftmost space; reaching it ends the game with Company failure. */
  index: number;
  label: string;
  /** Expectations printed beneath the space; null on the failure space. */
  expectations: number | null;
  companyFails: boolean;
  /** Lined spaces allow (and the starred space forces) the Vote to Deregulate. */
  lined: boolean;
  star: boolean;
  /** The "S" space where Standing is placed when Deregulation passes. */
  deregulationReset: boolean;
};

export type DebtSpaceDefinition = {
  value: number;
  lined: boolean;
  star: boolean;
};

export type CompanyTracksDefinition = {
  source: DataSourceRef;
  standing: StandingSpaceDefinition[];
  debt: DebtSpaceDefinition[];
};

export type CompanyTrackSetup = {
  /** Index into the Standing track (see companyTracks.standing). */
  standingSpace?: number;
  debt?: number;
  /** GBP placed in every Company treasury at setup. */
  officeTreasury?: number;
};

export type ScenarioRegionSetup = {
  towerLevels: number;
  closedOrderIds: string[];
};

export type ScenarioMapSetup = {
  regions: Record<RegionId, ScenarioRegionSetup>;
  empires: Array<{ capital: RegionId; dominated: RegionId[] }>;
  companyControlled: RegionId[];
  /**
   * Company-controlled regions that start associated with a Presidency: the control token sits above
   * that President's box (p.23 "Form Governorship"). Regions here are also in `companyControlled`.
   */
  associatedPresidency?: Partial<Record<RegionId, PresidencyId>>;
  /**
   * Governor offices that exist at setup. With a Governor General in play none are created (p.26).
   */
  governorOffices?: RegionId[];
  /** The Elephant stands in `region`; with `facing` it is on that border, otherwise in the centre. */
  elephant: { region: RegionId; facing?: RegionId };
};

export type ScenarioSetup = {
  companyTracks: CompanyTrackSetup;
  startingRegiments: Partial<Record<PresidencyId, number>>;
  startingCompanyShips: Partial<Record<PresidencyId, number>>;
  /** Law names placed near the board at setup; law cards are not encoded yet. */
  startingPassedLaws?: string[];
  mapSetup?: ScenarioMapSetup;
  /** 1813: the Governor General is in play over the Director of Trade's place (p.26). */
  governorGeneral?: boolean;
  /** 1813: the Superintendent of Trade in China office is open (p.25). */
  chinaOffice?: boolean;
  notes: string[];
  encodedSections: ScenarioSetupSection[];
  missingSections: ScenarioSetupSection[];
};

export type ScenarioDefinition = {
  id: ScenarioId;
  name: string;
  displayYear: string;
  recommendedPlayerCounts: number[];
  /** First game turn, from the date printed on the Turn track. */
  startTurn: number;
  /** Last game turn, from the scenario end marker on the Turn track. */
  finalTurn: number;
  deregulationAvailable: boolean;
  startsDeregulated: boolean;
  completeness: ScenarioCompleteness;
  source: DataSourceRef;
  setup: ScenarioSetup;
};

export type ComponentManifest = {
  families: {
    count: number;
    familyMembersPerFamily: number;
    victoryPointMarkersPerFamily: number;
    promiseCardsPerFamily: number;
    opportunityMarkersPerFamily: number;
    firmCubesPerFamily: number;
    firmStrategyCardsPerFamily: number;
  };
  money: {
    bankUnlimited: boolean;
    denominations: Array<{
      value: number;
      count: number;
    }>;
  };
  enterprises: {
    shipyards: number;
    workshops: number;
    luxuries: number;
  };
  offices: {
    officeCards: number;
  };
  crown: {
    aiCards: number;
    promiseCubes: number;
  };
  source: DataSourceRef;
};

export type FamilyActionDefinition = {
  id: FamilyActionId;
  label: string;
  source: DataSourceRef;
  cost:
    | {
        type: "none";
      }
    | {
        type: "fixed";
        amount: number;
      }
    | {
        type: "stockExchangeSlot";
      };
  placesFamilyMember: boolean;
  enterpriseType?: "shipyard" | "workshop" | "luxury";
  victoryPoints?: number;
  parliamentVotes?: number;
  bonusIncome?: number;
  notes: string[];
};

export type EnterpriseType = "shipyard" | "workshop" | "luxury";

export type EnterpriseCardDefinition = {
  id: string;
  type: EnterpriseType;
  label: string;
  source: DataSourceRef;
  cost: number;
  parliamentVotes: number;
  bonusIncome: number;
  victoryPoints: number;
  failureVictoryPoints: number;
  windowTaxIcons: number;
  shipTokenName?: string;
  notes: string[];
};

export type EnterpriseDeckDefinition = {
  type: EnterpriseType;
  source: DataSourceRef;
  cards: EnterpriseCardDefinition[];
};

export type StockExchangeSlotDefinition = {
  id: string;
  cost: number;
  rightwardOrder: number;
  boardPosition: {
    x: number;
    y: number;
  };
  source: DataSourceRef;
};

export type StockExchangeTrackDefinition = {
  id: string;
  source: DataSourceRef;
  slots: StockExchangeSlotDefinition[];
  shareCreation: {
    debtReductionPerCreatedShare: number;
    createdFrom: "rightmost";
    slideRemainingPieces: "rightwardPreservingOrder";
    source: DataSourceRef;
  };
};

export type OfficeCategory =
  | "chairman"
  | "company"
  | "presidency"
  | "governor"
  | "china"
  | "governorGeneral";

export type OfficeDefinition = {
  id: string;
  label: string;
  category: OfficeCategory;
  /** Red-ribbon Company Operation order. */
  operationOrder?: number;
  /** Hiring order: the number printed on the back of the office card (p.14). */
  hiringOrder: number;
  /** The President's Presidency. Governors have no fixed Presidency; see `region`. */
  presidency?: PresidencyId;
  region?: RegionId;
  hiring?: {
    hirer:
      | "chairman"
      | {
          type: "office";
          officeId: string;
        }
      /** The President of the Presidency the Governor's region is associated with. */
      | "regionPresident";
    candidatePool:
      | {
          type: "writers";
          presidencies: "any" | PresidencyId[];
        }
      | {
          type: "special";
          rule:
            | "director-of-trade-promotion-then-writers"
            | "military-affairs"
            | "president"
            | "governor";
        };
    excludeHirerUntilNepotismConsent: boolean;
  };
  source: DataSourceRef;
  notes: string[];
};

export type BorderShape = "circle" | "triangle" | "square";

export type BoardPosition = {
  x: number;
  y: number;
};

export type OrderDefinition = {
  id: string;
  region: RegionId;
  value: number;
  /** Small number printed beside the order; the rulebook says it is used in Deregulation. */
  deregulationValue: number;
  connectedOrderIds: string[];
  isHomePortFor?: PresidencyId;
  boardPosition: BoardPosition;
  source: DataSourceRef;
  notes: string[];
};

export type RegionDefinition = {
  id: RegionId;
  label: string;
  /** Set only for the three Presidency home regions. Other regions are associated dynamically. */
  homePresidency?: PresidencyId;
  adjacentRegionIds: RegionId[];
  governorOfficeId: string;
  /** Crate icons printed in the region, used by Trade in China. */
  exportIcons: number;
  /** Which neighbour the Elephant faces from this region for each event-tile shape (rulebook p.30). */
  borderShapes: Record<BorderShape, RegionId>;
  boardPosition: BoardPosition;
  orders: OrderDefinition[];
  source: DataSourceRef;
  notes: string[];
};

export type PresidencyDefinition = {
  id: PresidencyId;
  label: string;
  army: PresidencyId;
  homeRegion: RegionId;
  seaZone: "west-indian" | "south-indian" | "east-indian";
  presidentOfficeId: string;
  source: DataSourceRef;
  notes: string[];
};

export type MapDefinition = {
  source: DataSourceRef;
  boardSize: {
    width: number;
    height: number;
  };
  presidencies: PresidencyDefinition[];
  regions: RegionDefinition[];
};

export type SetupCardDeckId = "1710" | "1758" | "1813";

export type SetupCardEffect =
  | { type: "cash"; amount: number }
  | { type: "office"; officeId: string }
  | { type: "companyShare"; count: number }
  | { type: "primeMinister" }
  | { type: "randomBlackmail"; count: number }
  | { type: "writer"; presidency: PresidencyId; count: number }
  | { type: "commander"; army: PresidencyId }
  | { type: "officersInTraining"; count: number }
  | { type: "officer"; army: PresidencyId; count: number }
  | {
      type: "shipyard";
      count: number;
      ship:
        | { status: "unfitted" }
        | { status: "placed"; seaZone: "west-indian" | "south-indian" | "east-indian" };
    }
  | { type: "luxury"; count: number }
  | { type: "workshop"; count: number }
  | { type: "trophy"; count: number }
  /**
   * 1813 "(diamond) 2 Prize" (Chairman p.30 r4 c1, President of Bombay p.31 r1 c1): a family member
   * placed on a prize without paying for it. The diamond with a 2 is the victory-point diamond the
   * board prints on a prize box (the £4 box shows a diamond 2; the £2 box prints none), so it is the
   * 2 VP prize ("prize-4"), not the £2 box. The piece comes from the family's supply, the family
   * scores the prize's VP, and the prize's upkeep applies as for any piece on it (rulebook p.12
   * Retirement, Upkeep and Refresh).
   */
  | { type: "prize"; prizeId: string }
  /**
   * 1813 "PRIVATE FIRM (1 share, £8 in treasury) OR £3 if dealt to the Crown" (p.31 r2 c1): the holder
   * manages a firm with `shares` of their pieces on its Shares box and `treasury` pounds in its London
   * treasury, at Value 1 like any firm (rulebook p.38; the scenario starts deregulated, so firms
   * exist). Dealt to the Crown it gives `crownCash` pounds instead: "the Crown never creates a
   * private firm" (Handbook p.3, Firms Phase), so no Crown-managed firm ever exists.
   */
  | { type: "privateFirm"; shares: number; treasury: number; crownCash: number }
  /**
   * 1813 "S. OF TRADE IN CHINA / 1 Company Ship" (p.31 r2 c4): the office's treasury holds only ships
   * (rulebook p.25), so the Company ship goes onto the Superintendent's overlay, location "china".
   */
  | { type: "companyShip"; count: number; location: "china" };

export type SetupCardDefinition = {
  id: string;
  deckId: SetupCardDeckId;
  scenario: ScenarioId;
  extra: boolean;
  source: DataSourceRef;
  sheetPage: number;
  sheetPosition: {
    row: number;
    column: number;
  };
  effects: SetupCardEffect[];
  notes?: string[];
};

export type SetupCardDeckDefinition = {
  id: SetupCardDeckId;
  scenario: ScenarioId;
  source: DataSourceRef;
  baseCardsForThreeOrFourPlayers: number;
  extraCardsForFivePlayers: number;
  extraCardsForSixPlayers: number;
  cards: SetupCardDefinition[];
};

export type CrownAiCardId = `crown-ai-${string}`;

/** One AI card (rulebook p.45); field meanings are documented on `crownAiCards` in ./crown.ts. */
export type CrownAiCard = {
  id: CrownAiCardId;
  number: number;
  source: { front: string; back: string };
  criterion: string;
  climateBands: Array<{ range: string; climate: CrownClimate; deregulated?: boolean }>;
  splaySlot: "left" | "middle" | "right";
  firstArrow: "top" | "middle" | "bottom";
  secondArrow: "top" | "middle" | "bottom";
  hand: "upper" | "lower";
  regionPriority: RegionId[];
  back: {
    /** Top to bottom. */
    presidencies: [PresidencyId, PresidencyId, PresidencyId];
    /** The arrow between the top and middle Presidency, and between the middle and bottom one. */
    upperArrow: "clockwise" | "counterclockwise";
    lowerArrow: "clockwise" | "counterclockwise";
  };
};

export type CrownDifficulty = "easy" | "normal" | "hard" | "expert";

export type CrownSetupDistribution = {
  mode: Extract<PlayMode, "soloCrown" | "twoPlayerCrown">;
  variant: "draft" | "random";
  humanSetupCards: number;
  crownSetupCards: number;
  promiseCubesWithCrown: number;
  promiseCubesPerHuman: number;
  source: DataSourceRef;
};

export type CrownDifficultySetting = {
  id: CrownDifficulty;
  source: DataSourceRef;
  promiseCardCubeTradesAllowed: boolean;
  additionalCrownPromiseCubes: number;
  extraSetupCards: number;
};

export type CrownStaticData = {
  aiCards: CrownAiCard[];
  setupDistributions: CrownSetupDistribution[];
  difficultySettings: CrownDifficultySetting[];
};

export type StaticDataSet = {
  scenarios: ScenarioDefinition[];
  components: ComponentManifest;
  familyActions: FamilyActionDefinition[];
  enterpriseDecks: EnterpriseDeckDefinition[];
  stockExchange: StockExchangeTrackDefinition;
  companyTracks: CompanyTracksDefinition;
  offices: OfficeDefinition[];
  map: MapDefinition;
  setupCardDecks: SetupCardDeckDefinition[];
  crown: CrownStaticData;
};
