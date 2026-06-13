import {
  CROWN_AI_CARD_COUNT,
  CROWN_PROMISE_CUBE_COUNT,
  crownAiCards,
  crownDifficultySettings,
  crownSetupDistributions,
} from "./crown";
import { componentManifest } from "./components";
import { familyActions } from "./family-actions";
import { offices } from "./offices";
import { scenarios } from "./scenarios";
import { stockExchangeTrack } from "./stock-exchange";
import type {
  ComponentManifest,
  CrownStaticData,
  FamilyActionDefinition,
  FamilyActionId,
  OfficeDefinition,
  PlayMode,
  ScenarioDefinition,
  ScenarioId,
  StaticDataSet,
  StockExchangeTrackDefinition,
  ValidationIssue,
  ValidationResult,
} from "./types";

export const requiredScenarioIds: ScenarioId[] = [
  "1710",
  "1758",
  "1813",
  "long-1710",
];

export const requiredCrownAiCardFieldPaths = [
  "climateIcon",
  "standingClimateMap",
  "splayCardIndex",
  "direction",
  "presidencyPriority.blackArrow",
  "presidencyPriority.whiteArrow",
  "presidencyPriority.fallback",
  "regionPriority",
  "familyActionPriority",
  "voteToDeregulateLimit",
  "chairmanSeekDebtProfile",
  "chairmanAllocationProfile",
  "shippingPurchaseProfile",
  "governorGeneralDiceMinimum",
  "governorDiceMinimum",
  "commanderLocalAllianceProfile",
  "commanderDeployDiceMinimums.nonCompanyControlled",
  "commanderDeployDiceMinimums.companyControlled",
  "commanderDeployAgain",
  "presidentTradeDiceMinimum",
  "chinaTradeDiceMinimum",
  "revenueDividendReserve",
] as const;

export const staticData: StaticDataSet = {
  scenarios,
  components: componentManifest,
  familyActions,
  stockExchange: stockExchangeTrack,
  offices,
  crown: {
    aiCards: crownAiCards,
    setupDistributions: crownSetupDistributions,
    difficultySettings: crownDifficultySettings,
  },
};

type ScenarioValidationOptions = {
  requireComplete?: boolean;
};

type GameModeValidationInput = {
  scenarioId: ScenarioId;
  mode: PlayMode;
  humanPlayerCount: number;
  data?: StaticDataSet;
};

const resultFromIssues = (issues: ValidationIssue[]): ValidationResult => ({
  valid: !issues.some((issue) => issue.severity === "error"),
  issues,
});

const hasValue = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null && value !== "";
};

const getPath = (record: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => {
    if (current === undefined || current === null || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, record);

const duplicateIds = <T extends { id: string }>(records: T[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const record of records) {
    if (seen.has(record.id)) {
      duplicates.add(record.id);
    }
    seen.add(record.id);
  }

  return [...duplicates];
};

export const validateScenarioData = (
  scenarioData: ScenarioDefinition[] = scenarios,
  options: ScenarioValidationOptions = {},
): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const byId = new Map(scenarioData.map((scenario) => [scenario.id, scenario]));

  for (const id of requiredScenarioIds) {
    if (!byId.has(id)) {
      issues.push({
        severity: "error",
        code: "scenario.missing",
        path: `scenarios.${id}`,
        message: `Required scenario '${id}' is missing from static data.`,
        source: "docs/GAME_DESIGN.md",
      });
    }
  }

  for (const id of duplicateIds(scenarioData)) {
    issues.push({
      severity: "error",
      code: "scenario.duplicate-id",
      path: `scenarios.${id}`,
      message: `Scenario id '${id}' is defined more than once.`,
      source: "docs/GAME_DESIGN.md",
    });
  }

  for (const scenario of scenarioData) {
    const basePath = `scenarios.${scenario.id}`;

    for (const field of ["name", "displayYear", "source"] as const) {
      if (!hasValue(scenario[field])) {
        issues.push({
          severity: "error",
          code: "scenario.required-field",
          path: `${basePath}.${field}`,
          message: `Scenario '${scenario.id}' is missing required field '${field}'.`,
          source: "docs/GAME_DESIGN.md",
        });
      }
    }

    if (!hasValue(scenario.recommendedPlayerCounts)) {
      issues.push({
        severity: "error",
        code: "scenario.player-counts-missing",
        path: `${basePath}.recommendedPlayerCounts`,
        message: `Scenario '${scenario.id}' must list supported human player counts.`,
        source: "docs/GAME_DESIGN.md",
      });
    }

    if (!scenario.setup || !Array.isArray(scenario.setup.missingSections)) {
      issues.push({
        severity: "error",
        code: "scenario.setup-metadata-missing",
        path: `${basePath}.setup.missingSections`,
        message: `Scenario '${scenario.id}' must track missing setup sections for data entry.`,
        source: "docs/data-entry-checklist.md",
      });
      continue;
    }

    if (options.requireComplete && scenario.setup.missingSections.length > 0) {
      for (const section of scenario.setup.missingSections) {
        issues.push({
          severity: "error",
          code: "scenario.setup-section-missing",
          path: `${basePath}.setup.${section}`,
          message: `Scenario '${scenario.id}' is not complete: setup section '${section}' has not been encoded.`,
          source: scenario.source,
        });
      }
    }
  }

  return resultFromIssues(issues);
};

export const validateComponentData = (
  components: ComponentManifest = staticData.components,
): ValidationResult => {
  const issues: ValidationIssue[] = [];

  if (components.families.count !== 6) {
    issues.push({
      severity: "error",
      code: "components.family-count",
      path: "components.families.count",
      message: `Expected 6 player families; found ${components.families.count}.`,
      source: components.source,
    });
  }

  if (components.families.familyMembersPerFamily !== 18) {
    issues.push({
      severity: "error",
      code: "components.family-members",
      path: "components.families.familyMembersPerFamily",
      message: `Each family must have 18 family members; found ${components.families.familyMembersPerFamily}.`,
      source: components.source,
    });
  }

  if (components.families.promiseCardsPerFamily !== 5) {
    issues.push({
      severity: "error",
      code: "components.promise-cards",
      path: "components.families.promiseCardsPerFamily",
      message: `Each family must have 5 promise cards; found ${components.families.promiseCardsPerFamily}.`,
      source: components.source,
    });
  }

  const expectedEnterpriseTotal = 58;
  const actualEnterpriseTotal =
    components.enterprises.shipyards +
    components.enterprises.workshops +
    components.enterprises.luxuries;
  if (actualEnterpriseTotal !== expectedEnterpriseTotal) {
    issues.push({
      severity: "error",
      code: "components.enterprise-total",
      path: "components.enterprises",
      message: `Enterprise cards must total ${expectedEnterpriseTotal}; found ${actualEnterpriseTotal}.`,
      source: components.source,
    });
  }

  const moneyValues = new Set(components.money.denominations.map((row) => row.value));
  for (const value of [1, 2, 5, 10]) {
    if (!moneyValues.has(value)) {
      issues.push({
        severity: "error",
        code: "components.money-denomination-missing",
        path: `components.money.denominations.${value}`,
        message: `Money denomination GBP ${value} is missing.`,
        source: components.source,
      });
    }
  }

  if (components.crown.promiseCubes !== CROWN_PROMISE_CUBE_COUNT) {
    issues.push({
      severity: "error",
      code: "components.crown-promise-cubes",
      path: "components.crown.promiseCubes",
      message: `Crown promise cubes must total ${CROWN_PROMISE_CUBE_COUNT}; found ${components.crown.promiseCubes}.`,
      source: components.source,
    });
  }

  return resultFromIssues(issues);
};

export const validateFamilyActionData = (
  actions: FamilyActionDefinition[] = staticData.familyActions,
): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const requiredActionIds: FamilyActionId[] = [
    "enlist-writer",
    "enlist-officer",
    "purchase-luxury",
    "purchase-shipyard",
    "purchase-workshop",
    "seek-share",
  ];
  const actionById = new Map(actions.map((action) => [action.id, action]));

  for (const id of requiredActionIds) {
    if (!actionById.has(id)) {
      issues.push({
        severity: "error",
        code: "family-action.missing",
        path: `familyActions.${id}`,
        message: `Family action '${id}' is missing.`,
        source: "John-Company-Rules.txt",
      });
    }
  }

  for (const id of duplicateIds(actions)) {
    issues.push({
      severity: "error",
      code: "family-action.duplicate-id",
      path: `familyActions.${id}`,
      message: `Family action '${id}' is defined more than once.`,
      source: "John-Company-Rules.txt",
    });
  }

  for (const action of actions) {
    if (!hasValue(action.label)) {
      issues.push({
        severity: "error",
        code: "family-action.label-missing",
        path: `familyActions.${action.id}.label`,
        message: `Family action '${action.id}' is missing a label.`,
        source: action.source,
      });
    }

    if (action.cost.type === "fixed" && action.cost.amount < 0) {
      issues.push({
        severity: "error",
        code: "family-action.invalid-cost",
        path: `familyActions.${action.id}.cost.amount`,
        message: `Family action '${action.id}' has an invalid fixed cost.`,
        source: action.source,
      });
    }
  }

  return resultFromIssues(issues);
};

export const validateStockExchangeData = (
  stockExchange: StockExchangeTrackDefinition = staticData.stockExchange,
): ValidationResult => {
  const issues: ValidationIssue[] = [];

  if (stockExchange.slots.length !== 5) {
    issues.push({
      severity: "error",
      code: "stock-exchange.slot-count",
      path: "stockExchange.slots",
      message: `Starter Stock Exchange track must have 5 spaces; found ${stockExchange.slots.length}.`,
      source: stockExchange.source,
    });
  }

  for (const id of duplicateIds(stockExchange.slots)) {
    issues.push({
      severity: "error",
      code: "stock-exchange.duplicate-slot",
      path: `stockExchange.slots.${id}`,
      message: `Stock Exchange slot '${id}' is defined more than once.`,
      source: stockExchange.source,
    });
  }

  const orders = stockExchange.slots.map((slot) => slot.rightwardOrder).sort((a, b) => a - b);
  if (orders.join(",") !== "1,2,3,4,5") {
    issues.push({
      severity: "error",
      code: "stock-exchange.rightward-order",
      path: "stockExchange.slots.rightwardOrder",
      message: "Stock Exchange rightward order must be contiguous from 1 to 5.",
      source: stockExchange.source,
    });
  }

  for (const slot of stockExchange.slots) {
    if (slot.cost <= 0) {
      issues.push({
        severity: "error",
        code: "stock-exchange.invalid-cost",
        path: `stockExchange.slots.${slot.id}.cost`,
        message: `Stock Exchange slot '${slot.id}' must have a positive cost.`,
        source: slot.source,
      });
    }

    if (
      slot.boardPosition.x < 0 ||
      slot.boardPosition.x > 4902 ||
      slot.boardPosition.y < 0 ||
      slot.boardPosition.y > 2481
    ) {
      issues.push({
        severity: "error",
        code: "stock-exchange.board-position-out-of-bounds",
        path: `stockExchange.slots.${slot.id}.boardPosition`,
        message: `Stock Exchange slot '${slot.id}' board position is outside the 4902 x 2481 board image.`,
        source: slot.source,
      });
    }
  }

  if (stockExchange.shareCreation.debtReductionPerCreatedShare !== 1) {
    issues.push({
      severity: "error",
      code: "stock-exchange.share-debt-reduction",
      path: "stockExchange.shareCreation.debtReductionPerCreatedShare",
      message: "Each created Company share must reduce Company Debt by 1.",
      source: stockExchange.shareCreation.source,
    });
  }

  return resultFromIssues(issues);
};

export const validateOfficeData = (
  officeData: OfficeDefinition[] = staticData.offices,
): ValidationResult => {
  const issues: ValidationIssue[] = [];

  if (officeData.length !== 17) {
    issues.push({
      severity: "error",
      code: "office.count",
      path: "offices",
      message: `Office data must contain 17 office cards; found ${officeData.length}.`,
      source: "John-Company-Rules.txt",
    });
  }

  for (const id of duplicateIds(officeData)) {
    issues.push({
      severity: "error",
      code: "office.duplicate-id",
      path: `offices.${id}`,
      message: `Office '${id}' is defined more than once.`,
      source: "John-Company-Rules.txt",
    });
  }

  const operationOffices = officeData
    .filter((office) => office.operationOrder !== undefined)
    .sort((a, b) => (a.operationOrder ?? 0) - (b.operationOrder ?? 0));
  const operationOrders = operationOffices.map((office) => office.operationOrder);
  if (operationOrders.join(",") !== "1,2,3,4,5,6,7,8") {
    issues.push({
      severity: "error",
      code: "office.operation-order",
      path: "offices.operationOrder",
      message: "Red-ribbon Company Operation offices must be ordered 1 through 8.",
      source: "board_image-1.png",
    });
  }

  for (const office of officeData) {
    if (!hasValue(office.label)) {
      issues.push({
        severity: "error",
        code: "office.label-missing",
        path: `offices.${office.id}.label`,
        message: `Office '${office.id}' is missing a label.`,
        source: office.source,
      });
    }

    if (office.category === "presidency" && !office.presidency) {
      issues.push({
        severity: "error",
        code: "office.presidency-missing",
        path: `offices.${office.id}.presidency`,
        message: `Presidency office '${office.id}' must identify its Presidency.`,
        source: office.source,
      });
    }

    if (office.category === "governor" && (!office.presidency || !office.region)) {
      issues.push({
        severity: "error",
        code: "office.governor-region-missing",
        path: `offices.${office.id}`,
        message: `Governor office '${office.id}' must identify its Presidency and region.`,
        source: office.source,
      });
    }
  }

  return resultFromIssues(issues);
};

export const validateCrownData = (
  crownData: CrownStaticData = staticData.crown,
): ValidationResult => {
  const issues: ValidationIssue[] = [];

  if (crownData.aiCards.length !== CROWN_AI_CARD_COUNT) {
    issues.push({
      severity: "error",
      code: "crown.ai-card-count",
      path: "crown.aiCards",
      message: `Crown AI deck must contain exactly ${CROWN_AI_CARD_COUNT} cards; found ${crownData.aiCards.length}.`,
      source: "docs/crown-ai-design.md",
    });
  }

  for (const id of duplicateIds(crownData.aiCards)) {
    issues.push({
      severity: "error",
      code: "crown.ai-card-duplicate-id",
      path: `crown.aiCards.${id}`,
      message: `Crown AI card id '${id}' is defined more than once.`,
      source: "docs/crown-ai-design.md",
    });
  }

  for (const card of crownData.aiCards) {
    const basePath = `crown.aiCards.${card.id}`;

    if (!hasValue(card.source)) {
      issues.push({
        severity: "error",
        code: "crown.ai-card-source-missing",
        path: `${basePath}.source`,
        message: `Crown AI card '${card.id}' must include a source reference.`,
        source: "docs/crown-ai-design.md",
      });
    }

    for (const fieldPath of requiredCrownAiCardFieldPaths) {
      if (!hasValue(getPath(card, fieldPath))) {
        issues.push({
          severity: "error",
          code: "crown.ai-card-field-missing",
          path: `${basePath}.${fieldPath}`,
          message: `Crown AI card '${card.id}' is missing required field '${fieldPath}'.`,
          source: "docs/crown-ai-design.md",
        });
      }
    }
  }

  const setupModes = new Set(crownData.setupDistributions.map((row) => row.mode));
  for (const mode of ["soloCrown", "twoPlayerCrown"] as const) {
    if (!setupModes.has(mode)) {
      issues.push({
        severity: "error",
        code: "crown.setup-distribution-missing",
        path: `crown.setupDistributions.${mode}`,
        message: `Crown setup distribution for '${mode}' is missing.`,
        source: "docs/crown-ai-design.md",
      });
    }
  }

  for (const row of crownData.setupDistributions) {
    const totalCubes =
      row.promiseCubesWithCrown +
      row.promiseCubesPerHuman * (row.mode === "soloCrown" ? 1 : 2);

    if (totalCubes !== CROWN_PROMISE_CUBE_COUNT) {
      issues.push({
        severity: "error",
        code: "crown.promise-cube-total",
        path: `crown.setupDistributions.${row.mode}.${row.variant}`,
        message: `Crown promise cubes must total ${CROWN_PROMISE_CUBE_COUNT} for '${row.mode}' '${row.variant}'; found ${totalCubes}.`,
        source: row.source,
      });
    }
  }

  for (const difficulty of ["easy", "normal", "hard", "expert"] as const) {
    if (!crownData.difficultySettings.some((row) => row.id === difficulty)) {
      issues.push({
        severity: "error",
        code: "crown.difficulty-missing",
        path: `crown.difficultySettings.${difficulty}`,
        message: `Crown difficulty '${difficulty}' is missing.`,
        source: "docs/crown-ai-design.md",
      });
    }
  }

  return resultFromIssues(issues);
};

export const validateNewGameStaticData = ({
  scenarioId,
  mode,
  humanPlayerCount,
  data = staticData,
}: GameModeValidationInput): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const scenario = data.scenarios.find((candidate) => candidate.id === scenarioId);

  for (const validation of [
    validateComponentData(data.components),
    validateFamilyActionData(data.familyActions),
    validateStockExchangeData(data.stockExchange),
    validateOfficeData(data.offices),
  ]) {
    for (const issue of validation.issues) {
      if (issue.severity === "error") {
        issues.push({
          ...issue,
          code: `new-game.${issue.code}`,
          message: `New game is blocked: ${issue.message}`,
        });
      }
    }
  }

  if (!scenario) {
    issues.push({
      severity: "error",
      code: "new-game.scenario-missing",
      path: `scenarios.${scenarioId}`,
      message: `Cannot start '${scenarioId}': scenario data is missing.`,
      source: "docs/GAME_DESIGN.md",
    });
  } else if (
    mode === "hotseat" &&
    !scenario.recommendedPlayerCounts.includes(humanPlayerCount)
  ) {
    issues.push({
      severity: "error",
      code: "new-game.player-count-unsupported",
      path: `scenarios.${scenarioId}.recommendedPlayerCounts`,
      message: `Scenario '${scenarioId}' does not support ${humanPlayerCount} human players in mode '${mode}'.`,
      source: scenario.source,
    });
  }

  if (mode === "soloCrown" && humanPlayerCount !== 1) {
    issues.push({
      severity: "error",
      code: "new-game.solo-crown-player-count",
      path: "newGame.humanPlayerCount",
      message: "Solo Crown mode requires exactly one human player.",
      source: "docs/crown-ai-design.md",
    });
  }

  if (mode === "twoPlayerCrown" && humanPlayerCount !== 2) {
    issues.push({
      severity: "error",
      code: "new-game.two-player-crown-player-count",
      path: "newGame.humanPlayerCount",
      message: "Two-player Crown mode requires exactly two human players.",
      source: "docs/crown-ai-design.md",
    });
  }

  if (mode !== "hotseat") {
    const crownValidation = validateCrownData(data.crown);
    for (const issue of crownValidation.issues) {
      if (issue.severity === "error") {
        issues.push({
          ...issue,
          code: `new-game.${issue.code}`,
          message: `Crown mode '${mode}' is blocked: ${issue.message}`,
        });
      }
    }
  }

  return resultFromIssues(issues);
};
