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

export type CompanyStandingBand =
  | "expectations-below-10"
  | "expectations-10-to-13"
  | "expectations-14-to-17"
  | "expectations-18-plus";

export type CrownClimateId =
  | "climate-unknown-a"
  | "climate-unknown-b"
  | "climate-unknown-c";

export type CrownDecisionProfileId = string;

export type DataSourceRef =
  | "John-Company-Rules.txt"
  | "board_image-1.png"
  | "game_bits/Cards/John Company Cards (MiniEuro, Fronts).pdf"
  | "rulebook-scenario-1710"
  | "rulebook-scenario-1758"
  | "rulebook-scenario-1813"
  | "rulebook-scenario-long-1710"
  | "crown-handbook"
  | "docs/crown-ai-design.md"
  | "docs/data-entry-checklist.md"
  | "docs/GAME_DESIGN.md";

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

export type CompanyTrackSetup = {
  standingExpectationSpace?: number;
  debt?: number;
  balance?: number;
  expectations?: number;
};

export type ScenarioSetup = {
  companyTracks: CompanyTrackSetup;
  startingRegiments: Partial<Record<PresidencyId, number>>;
  startingCompanyShips: Partial<Record<PresidencyId, number>>;
  notes: string[];
  encodedSections: ScenarioSetupSection[];
  missingSections: ScenarioSetupSection[];
};

export type ScenarioDefinition = {
  id: ScenarioId;
  name: string;
  displayYear: string;
  recommendedPlayerCounts: number[];
  turnLimit?: number;
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
  operationOrder?: number;
  presidency?: PresidencyId;
  region?: RegionId;
  source: DataSourceRef;
  notes: string[];
};

export type BoardPosition = {
  x: number;
  y: number;
};

export type OrderDefinition = {
  id: string;
  region: RegionId;
  value: number;
  connectedOrderIds: string[];
  isHomePortFor?: PresidencyId;
  boardPosition: BoardPosition;
  source: DataSourceRef;
  notes: string[];
};

export type RegionDefinition = {
  id: RegionId;
  label: string;
  presidency: PresidencyId;
  adjacentRegionIds: RegionId[];
  governorOfficeId: string;
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
  governorOfficeIds: string[];
  associatedRegionIds: RegionId[];
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

export type SetupCardDeckId = "1710";

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
  | { type: "trophy"; count: number };

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

export type CrownAiCard = {
  id: CrownAiCardId;
  source: DataSourceRef;
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

export type CrownAiCardPlaceholder = Partial<CrownAiCard> & {
  id: CrownAiCardId;
  source: DataSourceRef;
  placeholderReason: string;
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
  aiCards: CrownAiCardPlaceholder[];
  setupDistributions: CrownSetupDistribution[];
  difficultySettings: CrownDifficultySetting[];
};

export type StaticDataSet = {
  scenarios: ScenarioDefinition[];
  components: ComponentManifest;
  familyActions: FamilyActionDefinition[];
  enterpriseDecks: EnterpriseDeckDefinition[];
  stockExchange: StockExchangeTrackDefinition;
  offices: OfficeDefinition[];
  map: MapDefinition;
  setupCardDecks: SetupCardDeckDefinition[];
  crown: CrownStaticData;
};
