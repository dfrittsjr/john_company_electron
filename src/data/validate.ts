import {
  CROWN_AI_CARD_COUNT,
  CROWN_PROMISE_CUBE_COUNT,
  crownAiCards,
  crownDifficultySettings,
  crownSetupDistributions,
} from "./crown";
import { scenarios } from "./scenarios";
import type {
  CrownStaticData,
  PlayMode,
  ScenarioDefinition,
  ScenarioId,
  StaticDataSet,
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
