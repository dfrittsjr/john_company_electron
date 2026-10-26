import {
  CROWN_AI_CARD_COUNT,
  CROWN_PROMISE_CUBE_COUNT,
  crownAiCards,
  crownDifficultySettings,
  crownSetupDistributions,
} from "./crown";
import { companyTracks } from "./company-tracks";
import { componentManifest } from "./components";
import { enterpriseDecks } from "./enterprises";
import { familyActions } from "./family-actions";
import { mapData } from "./map";
import { prizes } from "./board-components";
import { offices } from "./offices";
import { scenarios } from "./scenarios";
import { setupCardDecks } from "./setup-cards";
import { stockExchangeTrack } from "./stock-exchange";
import type {
  CompanyTracksDefinition,
  ComponentManifest,
  CrownStaticData,
  EnterpriseDeckDefinition,
  EnterpriseType,
  FamilyActionDefinition,
  FamilyActionId,
  MapDefinition,
  OfficeDefinition,
  PlayMode,
  PresidencyId,
  RegionId,
  ScenarioDefinition,
  ScenarioId,
  SetupCardDeckDefinition,
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
  "criterion",
  "climateBands",
  "splaySlot",
  "firstArrow",
  "secondArrow",
  "hand",
  "regionPriority",
  "back.presidencies",
  "back.upperArrow",
  "back.lowerArrow",
] as const;

/**
 * The Crown's behaviour (the Crown Handbook) is built, so solo and two-player games can start.
 * Set to false to block the Crown modes again.
 */
export const CROWN_BEHAVIOUR_BUILT = true;

export const staticData: StaticDataSet = {
  scenarios,
  components: componentManifest,
  familyActions,
  enterpriseDecks,
  stockExchange: stockExchangeTrack,
  companyTracks,
  offices,
  map: mapData,
  setupCardDecks,
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
  map: MapDefinition = staticData.map,
  tracks: CompanyTracksDefinition = staticData.companyTracks,
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
        source: "printnplay/Rulebooks/John Company Rules.pdf",
      });
    }
  }

  for (const id of duplicateIds(scenarioData)) {
    issues.push({
      severity: "error",
      code: "scenario.duplicate-id",
      path: `scenarios.${id}`,
      message: `Scenario id '${id}' is defined more than once.`,
      source: "printnplay/Rulebooks/John Company Rules.pdf",
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
          source: "printnplay/Rulebooks/John Company Rules.pdf",
        });
      }
    }

    if (!hasValue(scenario.recommendedPlayerCounts)) {
      issues.push({
        severity: "error",
        code: "scenario.player-counts-missing",
        path: `${basePath}.recommendedPlayerCounts`,
        message: `Scenario '${scenario.id}' must list supported human player counts.`,
        source: "printnplay/Rulebooks/John Company Rules.pdf",
      });
    }

    if (
      !Number.isInteger(scenario.startTurn) ||
      !Number.isInteger(scenario.finalTurn) ||
      scenario.startTurn < 1 ||
      scenario.finalTurn < scenario.startTurn ||
      scenario.finalTurn > TURN_TRACK_LENGTH
    ) {
      issues.push({
        severity: "error",
        code: "scenario.invalid-turns",
        path: `${basePath}.startTurn`,
        message: `Scenario '${scenario.id}' must start on turn 1-${TURN_TRACK_LENGTH} and end on or after its start turn.`,
        source: scenario.source,
      });
    }

    if (scenario.setup) {
      issues.push(...validateScenarioSetupReferences(scenario, map, tracks));
    }

    if (!scenario.setup || !Array.isArray(scenario.setup.missingSections)) {
      issues.push({
        severity: "error",
        code: "scenario.setup-metadata-missing",
        path: `${basePath}.setup.missingSections`,
        message: `Scenario '${scenario.id}' must track missing setup sections for data entry.`,
        source: "printnplay/Rulebooks/John Company Rules.pdf",
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

const TURN_TRACK_LENGTH = 8;

const validateScenarioSetupReferences = (
  scenario: ScenarioDefinition,
  map: MapDefinition,
  tracks: CompanyTracksDefinition,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const basePath = `scenarios.${scenario.id}.setup`;
  const { standingSpace, debt } = scenario.setup.companyTracks;

  if (
    standingSpace !== undefined &&
    (!tracks.standing[standingSpace] || tracks.standing[standingSpace].companyFails)
  ) {
    issues.push({
      severity: "error",
      code: "scenario.invalid-standing-space",
      path: `${basePath}.companyTracks.standingSpace`,
      message: `Scenario '${scenario.id}' must start Standing on a non-failure space of the Standing track.`,
      source: scenario.source,
    });
  }

  if (debt !== undefined && !tracks.debt.some((space) => space.value === debt)) {
    issues.push({
      severity: "error",
      code: "scenario.invalid-debt",
      path: `${basePath}.companyTracks.debt`,
      message: `Scenario '${scenario.id}' starts Debt off the Debt track.`,
      source: scenario.source,
    });
  }

  const mapSetup = scenario.setup.mapSetup;
  if (!mapSetup) {
    return issues;
  }

  const regionById = new Map(map.regions.map((region) => [region.id, region]));
  for (const region of map.regions) {
    const regionSetup = mapSetup.regions[region.id];
    if (!regionSetup) {
      issues.push({
        severity: "error",
        code: "scenario.map-region-missing",
        path: `${basePath}.mapSetup.regions.${region.id}`,
        message: `Scenario '${scenario.id}' map setup is missing region '${region.id}'.`,
        source: scenario.source,
      });
      continue;
    }

    for (const orderId of regionSetup.closedOrderIds) {
      if (!region.orders.some((order) => order.id === orderId)) {
        issues.push({
          severity: "error",
          code: "scenario.map-closed-order-missing",
          path: `${basePath}.mapSetup.regions.${region.id}.closedOrderIds`,
          message: `Scenario '${scenario.id}' closes order '${orderId}', which is not in region '${region.id}'.`,
          source: scenario.source,
        });
      }
    }
  }

  const dominatedRegions = new Set<string>();
  for (const empire of mapSetup.empires) {
    for (const regionId of [empire.capital, ...empire.dominated]) {
      if (!regionById.has(regionId) || dominatedRegions.has(regionId)) {
        issues.push({
          severity: "error",
          code: "scenario.map-empire-invalid",
          path: `${basePath}.mapSetup.empires`,
          message: `Scenario '${scenario.id}' empire region '${regionId}' is missing or used twice.`,
          source: scenario.source,
        });
      }
      dominatedRegions.add(regionId);
    }
  }

  const elephantRegion = regionById.get(mapSetup.elephant.region);
  if (
    !elephantRegion ||
    (mapSetup.elephant.facing !== undefined &&
      !elephantRegion.adjacentRegionIds.includes(mapSetup.elephant.facing))
  ) {
    issues.push({
      severity: "error",
      code: "scenario.map-elephant-invalid",
      path: `${basePath}.mapSetup.elephant`,
      message: `Scenario '${scenario.id}' Elephant must stand in a region and face an adjacent region.`,
      source: scenario.source,
    });
  }

  return issues;
};

export const validateCompanyTracksData = (
  tracks: CompanyTracksDefinition = staticData.companyTracks,
): ValidationResult => {
  const issues: ValidationIssue[] = [];

  tracks.standing.forEach((space, index) => {
    if (space.index !== index || space.companyFails !== (index === 0)) {
      issues.push({
        severity: "error",
        code: "companyTracks.standing-invalid-space",
        path: `companyTracks.standing.${index}`,
        message: "Standing spaces must be in order, with only the leftmost space failing the Company.",
        source: tracks.source,
      });
    }
  });

  if (tracks.standing.filter((space) => space.deregulationReset).length !== 1) {
    issues.push({
      severity: "error",
      code: "companyTracks.standing-reset-space",
      path: "companyTracks.standing",
      message: "Exactly one Standing space must be marked 'S' for Deregulation.",
      source: tracks.source,
    });
  }

  tracks.debt.forEach((space, index) => {
    if (space.value !== index) {
      issues.push({
        severity: "error",
        code: "companyTracks.debt-invalid-space",
        path: `companyTracks.debt.${index}`,
        message: "Debt spaces must count up from 0 in order.",
        source: tracks.source,
      });
    }
  });

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

    if (office.category === "governor" && (!office.region || office.presidency)) {
      issues.push({
        severity: "error",
        code: "office.governor-region-missing",
        path: `offices.${office.id}`,
        message: `Governor office '${office.id}' must identify its region and no fixed Presidency (regions are associated by conquest).`,
        source: office.source,
      });
    }

    if (!Number.isInteger(office.hiringOrder) || office.hiringOrder < 1 || office.hiringOrder > 16) {
      issues.push({
        severity: "error",
        code: "office.hiring-order",
        path: `offices.${office.id}.hiringOrder`,
        message: `Office '${office.id}' must have the hiring number printed on its card back (1-16).`,
        source: office.source,
      });
    }
  }

  const hiringOrders = officeData
    .filter((office) => office.id !== "governor-general")
    .map((office) => office.hiringOrder)
    .sort((a, b) => a - b);
  if (hiringOrders.join(",") !== Array.from({ length: 16 }, (_, index) => index + 1).join(",")) {
    issues.push({
      severity: "error",
      code: "office.hiring-order-sequence",
      path: "offices.hiringOrder",
      message: "Office hiring numbers must run 1-16 (the Governor General shares 2 with the Director of Trade).",
      source: "printnplay/Cards/John Company Cards (Bridge, Bridge).pdf",
    });
  }

  return resultFromIssues(issues);
};

export const validateMapData = (map: MapDefinition = staticData.map): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const requiredPresidencyIds: PresidencyId[] = ["bombay", "madras", "bengal"];
  const requiredRegionIds: RegionId[] = [
    "bengal",
    "delhi",
    "bombay",
    "punjab",
    "maratha",
    "madras",
    "mysore",
    "hyderabad",
  ];
  const presidencyById = new Map(map.presidencies.map((presidency) => [presidency.id, presidency]));
  const regionById = new Map(map.regions.map((region) => [region.id, region]));
  const orders = map.regions.flatMap((region) => region.orders);
  const orderById = new Map(orders.map((row) => [row.id, row]));

  for (const id of requiredPresidencyIds) {
    if (!presidencyById.has(id)) {
      issues.push({
        severity: "error",
        code: "map.presidency-missing",
        path: `map.presidencies.${id}`,
        message: `Presidency '${id}' is missing.`,
        source: map.source,
      });
    }
  }

  for (const id of duplicateIds(map.presidencies)) {
    issues.push({
      severity: "error",
      code: "map.presidency-duplicate-id",
      path: `map.presidencies.${id}`,
      message: `Presidency '${id}' is defined more than once.`,
      source: map.source,
    });
  }

  for (const id of requiredRegionIds) {
    if (!regionById.has(id)) {
      issues.push({
        severity: "error",
        code: "map.region-missing",
        path: `map.regions.${id}`,
        message: `Region '${id}' is missing.`,
        source: map.source,
      });
    }
  }

  for (const id of duplicateIds(map.regions)) {
    issues.push({
      severity: "error",
      code: "map.region-duplicate-id",
      path: `map.regions.${id}`,
      message: `Region '${id}' is defined more than once.`,
      source: map.source,
    });
  }

  for (const id of duplicateIds(orders)) {
    issues.push({
      severity: "error",
      code: "map.order-duplicate-id",
      path: `map.orders.${id}`,
      message: `Order '${id}' is defined more than once.`,
      source: map.source,
    });
  }

  for (const presidency of map.presidencies) {
    if (!regionById.has(presidency.homeRegion)) {
      issues.push({
        severity: "error",
        code: "map.presidency-home-region-missing",
        path: `map.presidencies.${presidency.id}.homeRegion`,
        message: `Presidency '${presidency.id}' references missing home region '${presidency.homeRegion}'.`,
        source: presidency.source,
      });
    }

    if (regionById.get(presidency.homeRegion)?.homePresidency !== presidency.id) {
      issues.push({
        severity: "error",
        code: "map.presidency-home-region-mismatch",
        path: `map.presidencies.${presidency.id}.homeRegion`,
        message: `Home region '${presidency.homeRegion}' must name Presidency '${presidency.id}' as its homePresidency.`,
        source: presidency.source,
      });
    }
  }

  for (const region of map.regions) {
    if (region.homePresidency && !presidencyById.has(region.homePresidency)) {
      issues.push({
        severity: "error",
        code: "map.region-presidency-missing",
        path: `map.regions.${region.id}.homePresidency`,
        message: `Region '${region.id}' references missing Presidency '${region.homePresidency}'.`,
        source: region.source,
      });
    }

    for (const [shape, facing] of Object.entries(region.borderShapes)) {
      if (!region.adjacentRegionIds.includes(facing)) {
        issues.push({
          severity: "error",
          code: "map.region-border-shape-not-adjacent",
          path: `map.regions.${region.id}.borderShapes.${shape}`,
          message: `Region '${region.id}' ${shape} border must face an adjacent region, not '${facing}'.`,
          source: region.source,
        });
      }
    }

    if (!Number.isInteger(region.exportIcons) || region.exportIcons < 0) {
      issues.push({
        severity: "error",
        code: "map.region-invalid-export-icons",
        path: `map.regions.${region.id}.exportIcons`,
        message: `Region '${region.id}' must have a non-negative whole number of export icons.`,
        source: region.source,
      });
    }

    if (region.orders.length === 0) {
      issues.push({
        severity: "error",
        code: "map.region-orders-missing",
        path: `map.regions.${region.id}.orders`,
        message: `Region '${region.id}' must include at least one order.`,
        source: region.source,
      });
    }

    for (const adjacentRegionId of region.adjacentRegionIds) {
      const adjacent = regionById.get(adjacentRegionId);
      if (!adjacent) {
        issues.push({
          severity: "error",
          code: "map.region-adjacent-missing",
          path: `map.regions.${region.id}.adjacentRegionIds`,
          message: `Region '${region.id}' references missing adjacent region '${adjacentRegionId}'.`,
          source: region.source,
        });
      } else if (!adjacent.adjacentRegionIds.includes(region.id)) {
        issues.push({
          severity: "error",
          code: "map.region-adjacency-asymmetric",
          path: `map.regions.${region.id}.adjacentRegionIds`,
          message: `Region adjacency '${region.id}' -> '${adjacentRegionId}' is not symmetric.`,
          source: region.source,
        });
      }
    }

    if (
      region.boardPosition.x < 0 ||
      region.boardPosition.x > map.boardSize.width ||
      region.boardPosition.y < 0 ||
      region.boardPosition.y > map.boardSize.height
    ) {
      issues.push({
        severity: "error",
        code: "map.region-position-out-of-bounds",
        path: `map.regions.${region.id}.boardPosition`,
        message: `Region '${region.id}' board position is outside the board image.`,
        source: region.source,
      });
    }

    for (const order of region.orders) {
      if (order.region !== region.id) {
        issues.push({
          severity: "error",
          code: "map.order-region-mismatch",
          path: `map.orders.${order.id}.region`,
          message: `Order '${order.id}' does not match its containing region '${region.id}'.`,
          source: order.source,
        });
      }

      if (order.deregulationValue <= 0 || order.deregulationValue > order.value) {
        issues.push({
          severity: "error",
          code: "map.order-invalid-deregulation-value",
          path: `map.orders.${order.id}.deregulationValue`,
          message: `Order '${order.id}' must have a positive deregulation value no larger than its value.`,
          source: order.source,
        });
      }

      if (order.value <= 0) {
        issues.push({
          severity: "error",
          code: "map.order-invalid-value",
          path: `map.orders.${order.id}.value`,
          message: `Order '${order.id}' must have a positive value.`,
          source: order.source,
        });
      }

      if (
        order.boardPosition.x < 0 ||
        order.boardPosition.x > map.boardSize.width ||
        order.boardPosition.y < 0 ||
        order.boardPosition.y > map.boardSize.height
      ) {
        issues.push({
          severity: "error",
          code: "map.order-position-out-of-bounds",
          path: `map.orders.${order.id}.boardPosition`,
          message: `Order '${order.id}' board position is outside the board image.`,
          source: order.source,
        });
      }
    }
  }

  for (const order of orders) {
    for (const connectedOrderId of order.connectedOrderIds) {
      const connected = orderById.get(connectedOrderId);
      if (!connected) {
        issues.push({
          severity: "error",
          code: "map.order-connection-missing",
          path: `map.orders.${order.id}.connectedOrderIds`,
          message: `Order '${order.id}' references missing connected order '${connectedOrderId}'.`,
          source: order.source,
        });
      } else if (!connected.connectedOrderIds.includes(order.id)) {
        issues.push({
          severity: "error",
          code: "map.order-connection-asymmetric",
          path: `map.orders.${order.id}.connectedOrderIds`,
          message: `Order connection '${order.id}' -> '${connectedOrderId}' is not symmetric.`,
          source: order.source,
        });
      }
    }
  }

  for (const id of requiredPresidencyIds) {
    const homePortCount = orders.filter((order) => order.isHomePortFor === id).length;
    if (homePortCount !== 1) {
      issues.push({
        severity: "error",
        code: "map.presidency-home-port-count",
        path: `map.orders.homePort.${id}`,
        message: `Presidency '${id}' must have exactly one home port order; found ${homePortCount}.`,
        source: map.source,
      });
    }
  }

  return resultFromIssues(issues);
};

export const validateEnterpriseData = (
  decks: EnterpriseDeckDefinition[] = staticData.enterpriseDecks,
  components: ComponentManifest = staticData.components,
): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const expectedCounts: Record<EnterpriseType, number> = {
    shipyard: components.enterprises.shipyards,
    workshop: components.enterprises.workshops,
    luxury: components.enterprises.luxuries,
  };
  const expectedCosts: Record<EnterpriseType, number> = {
    shipyard: 2,
    workshop: 5,
    luxury: 4,
  };
  const deckByType = new Map(decks.map((deck) => [deck.type, deck]));
  const cards = decks.flatMap((deck) => deck.cards);

  for (const type of ["shipyard", "workshop", "luxury"] as const) {
    const deck = deckByType.get(type);
    if (!deck) {
      issues.push({
        severity: "error",
        code: "enterprise.deck-missing",
        path: `enterpriseDecks.${type}`,
        message: `Enterprise deck '${type}' is missing.`,
        source: "John-Company-Rules.txt",
      });
      continue;
    }

    if (deck.cards.length !== expectedCounts[type]) {
      issues.push({
        severity: "error",
        code: "enterprise.deck-count",
        path: `enterpriseDecks.${type}.cards`,
        message: `Enterprise deck '${type}' must contain ${expectedCounts[type]} cards; found ${deck.cards.length}.`,
        source: deck.source,
      });
    }
  }

  for (const id of duplicateIds(cards)) {
    issues.push({
      severity: "error",
      code: "enterprise.duplicate-card-id",
      path: `enterpriseDecks.cards.${id}`,
      message: `Enterprise card '${id}' is defined more than once.`,
      source: "John-Company-Rules.txt",
    });
  }

  for (const deck of decks) {
    for (const card of deck.cards) {
      if (card.type !== deck.type) {
        issues.push({
          severity: "error",
          code: "enterprise.deck-card-type-mismatch",
          path: `enterpriseDecks.${deck.type}.cards.${card.id}.type`,
          message: `Enterprise card '${card.id}' does not match its deck type '${deck.type}'.`,
          source: card.source,
        });
      }

      if (card.cost !== expectedCosts[card.type]) {
        issues.push({
          severity: "error",
          code: "enterprise.card-cost",
          path: `enterpriseDecks.${deck.type}.cards.${card.id}.cost`,
          message: `Enterprise card '${card.id}' has cost ${card.cost}; expected ${expectedCosts[card.type]}.`,
          source: card.source,
        });
      }

      if (!hasValue(card.label)) {
        issues.push({
          severity: "error",
          code: "enterprise.card-label-missing",
          path: `enterpriseDecks.${deck.type}.cards.${card.id}.label`,
          message: `Enterprise card '${card.id}' is missing a label.`,
          source: card.source,
        });
      }

      if (card.type === "shipyard" && !hasValue(card.shipTokenName)) {
        issues.push({
          severity: "error",
          code: "enterprise.shipyard-token-missing",
          path: `enterpriseDecks.shipyard.cards.${card.id}.shipTokenName`,
          message: `Shipyard '${card.id}' must identify its matching ship token.`,
          source: card.source,
        });
      }
    }
  }

  return resultFromIssues(issues);
};

/** The scenarios that deal setup cards; Long 1710 deals the 1710 deck (p.4). */
const requiredSetupDeckIds = ["1710", "1758", "1813"] as const;

export const validateSetupCardData = (
  decks: SetupCardDeckDefinition[] = staticData.setupCardDecks,
): ValidationResult => {
  const issues: ValidationIssue[] = [];

  for (const deckId of requiredSetupDeckIds) {
    const deck = decks.find((candidate) => candidate.id === deckId);
    if (!deck) {
      issues.push({
        severity: "error",
        code: "setup-card.deck-missing",
        path: `setupCardDecks.${deckId}`,
        message: `${deckId} setup card deck is missing.`,
        source: "printnplay/Cards/John Company Cards (MiniEuro, Fronts).pdf",
      });
      continue;
    }
    issues.push(...validateSetupCardDeck(deck));
  }

  return resultFromIssues(issues);
};

const validateSetupCardDeck = (deck: SetupCardDeckDefinition): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const deckPath = `setupCardDecks.${deck.id}`;
  const baseCards = deck.cards.filter((card) => !card.extra);
  const extraCards = deck.cards.filter((card) => card.extra);

  if (baseCards.length !== deck.baseCardsForThreeOrFourPlayers) {
    issues.push({
      severity: "error",
      code: "setup-card.base-count",
      path: `${deckPath}.cards`,
      message: `${deck.id} setup deck must have ${deck.baseCardsForThreeOrFourPlayers} base cards; found ${baseCards.length}.`,
      source: deck.source,
    });
  }

  if (extraCards.length !== deck.extraCardsForSixPlayers) {
    issues.push({
      severity: "error",
      code: "setup-card.extra-count",
      path: `${deckPath}.cards`,
      message: `${deck.id} setup deck must have ${deck.extraCardsForSixPlayers} extra cards; found ${extraCards.length}.`,
      source: deck.source,
    });
  }

  if (deck.extraCardsForFivePlayers !== 3 || deck.extraCardsForSixPlayers !== 6) {
    issues.push({
      severity: "error",
      code: "setup-card.extra-distribution",
      path: deckPath,
      message: `${deck.id} setup deck must add 3 extra cards for 5 players and 6 extra cards for 6 players.`,
      source: "John-Company-Rules.txt",
    });
  }

  const seenIds = new Set<string>();
  for (const card of deck.cards) {
    if (seenIds.has(card.id)) {
      issues.push({
        severity: "error",
        code: "setup-card.duplicate-id",
        path: `${deckPath}.cards.${card.id}`,
        message: `Setup card '${card.id}' is defined more than once.`,
        source: card.source,
      });
    }
    seenIds.add(card.id);

    if (card.deckId !== deck.id || card.scenario !== deck.scenario) {
      issues.push({
        severity: "error",
        code: "setup-card.deck-mismatch",
        path: `${deckPath}.cards.${card.id}`,
        message: `Setup card '${card.id}' does not match its containing deck.`,
        source: card.source,
      });
    }

    if (card.effects.length === 0) {
      issues.push({
        severity: "error",
        code: "setup-card.effects-missing",
        path: `${deckPath}.cards.${card.id}.effects`,
        message: `Setup card '${card.id}' has no encoded effects.`,
        source: card.source,
      });
    }

    for (const effect of card.effects) {
      if ("count" in effect && effect.count <= 0) {
        issues.push({
          severity: "error",
          code: "setup-card.invalid-count",
          path: `${deckPath}.cards.${card.id}.effects`,
          message: `Setup card '${card.id}' has a non-positive effect count.`,
          source: card.source,
        });
      }

      if (effect.type === "cash" && effect.amount <= 0) {
        issues.push({
          severity: "error",
          code: "setup-card.invalid-cash",
          path: `${deckPath}.cards.${card.id}.effects.cash`,
          message: `Setup card '${card.id}' has a non-positive cash amount.`,
          source: card.source,
        });
      }

      if (effect.type === "prize" && !prizes.some((prize) => prize.id === effect.prizeId)) {
        issues.push({
          severity: "error",
          code: "setup-card.unknown-prize",
          path: `${deckPath}.cards.${card.id}.effects.prize`,
          message: `Setup card '${card.id}' names unknown prize '${effect.prizeId}'.`,
          source: card.source,
        });
      }

      if (effect.type === "office" && !offices.some((office) => office.id === effect.officeId)) {
        issues.push({
          severity: "error",
          code: "setup-card.unknown-office",
          path: `${deckPath}.cards.${card.id}.effects.office`,
          message: `Setup card '${card.id}' names unknown office '${effect.officeId}'.`,
          source: card.source,
        });
      }
    }
  }

  return issues;
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
      source: "printnplay/Rulebooks/John Company Rules.pdf",
    });
  }

  for (const id of duplicateIds(crownData.aiCards)) {
    issues.push({
      severity: "error",
      code: "crown.ai-card-duplicate-id",
      path: `crown.aiCards.${id}`,
      message: `Crown AI card id '${id}' is defined more than once.`,
      source: "printnplay/Rulebooks/John Company Rules.pdf",
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
        source: "printnplay/Rulebooks/John Company Rules.pdf",
      });
    }

    for (const fieldPath of requiredCrownAiCardFieldPaths) {
      if (!hasValue(getPath(card, fieldPath))) {
        issues.push({
          severity: "error",
          code: "crown.ai-card-field-missing",
          path: `${basePath}.${fieldPath}`,
          message: `Crown AI card '${card.id}' is missing required field '${fieldPath}'.`,
          source: "printnplay/Rulebooks/John Company Rules.pdf",
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
        source: "printnplay/Rulebooks/John Company Rules.pdf",
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
        source: "printnplay/Rulebooks/John Company Rules.pdf",
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
    validateEnterpriseData(data.enterpriseDecks, data.components),
    validateStockExchangeData(data.stockExchange),
    validateCompanyTracksData(data.companyTracks),
    validateOfficeData(data.offices),
    validateMapData(data.map),
    validateSetupCardData(data.setupCardDecks),
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
      source: "printnplay/Rulebooks/John Company Rules.pdf",
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
      source: "printnplay/Rulebooks/John Company Rules.pdf",
    });
  }

  if (mode === "twoPlayerCrown" && humanPlayerCount !== 2) {
    issues.push({
      severity: "error",
      code: "new-game.two-player-crown-player-count",
      path: "newGame.humanPlayerCount",
      message: "Two-player Crown mode requires exactly two human players.",
      source: "printnplay/Rulebooks/John Company Rules.pdf",
    });
  }

  if (mode !== "hotseat" && !CROWN_BEHAVIOUR_BUILT) {
    issues.push({
      severity: "error",
      code: "new-game.crown-not-built",
      path: "newGame.mode",
      message: `Crown mode '${mode}' is blocked: the Crown's behaviour is not built yet.`,
      source: "crown-handbook",
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
