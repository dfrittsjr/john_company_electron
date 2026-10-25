import { componentManifest, localAlliances, lootTokens, mapData, offices, stockExchangeTrack } from "../data";
import type { ScenarioDefinition } from "../data/types";
import { createInitialCompanyOperationState } from "./phases/company-operation.state";
import { createInitialEventsInIndiaState } from "./phases/events-in-india.state";
import { createInitialFinalScoringState } from "./phases/final-scoring.state";
import { createInitialLondonSeasonState } from "./phases/london-season.state";
import { createInitialNegotiationState } from "./phases/negotiation.state";
import { createRngState, shuffle } from "./rng";
import { COMPANY_TREASURY_OFFICE_IDS, scenarioDefinition, toEnginePresidency } from "./selectors";
import {
  GAME_SCHEMA_VERSION,
  type ArmyId,
  type CompanyState,
  type CrownState,
  type GameLogEntry,
  type GameMode,
  type GameState,
  type HiddenInfoState,
  type IndiaState,
  type ParliamentState,
  type PendingDecision,
  type PlayerId,
  type PlayerState,
  type PresidencyId,
  type RegionState,
  type ScenarioId,
  type SeaZoneId,
  type ShipState,
} from "./types";

export type NewPlayerInput = {
  id?: PlayerId;
  name: string;
  color: string;
};

export type NewGameOptions = {
  mode: GameMode;
  scenario: ScenarioId;
  players: NewPlayerInput[];
  crownDifficulty?: CrownState["difficulty"];
  setupDistribution?: "starter" | "random";
  seed?: string;
  gameId?: string;
  now?: string;
};

const CROWN_PLAYER_ID = "crown";
const PLAYER_COLORS = ["red", "blue", "yellow", "green", "purple", "black"];
const CROWN_AI_CARD_IDS = [
  "crown-ai-01",
  "crown-ai-02",
  "crown-ai-03",
  "crown-ai-04",
  "crown-ai-05",
  "crown-ai-06",
  "crown-ai-07",
  "crown-ai-08",
  "crown-ai-09",
  "crown-ai-10",
];

export function createNewGame(options: NewGameOptions): GameState {
  validateNewGameOptions(options);

  const scenario = scenarioDefinition(options);
  const createdAt = options.now ?? new Date().toISOString();
  let rng = createRngState(options.seed ?? `${options.scenario}:${options.mode}:${createdAt}`);
  const gameId = options.gameId ?? `game-${slugify(options.scenario)}-${createdAt}`;
  const humanPlayers = options.players.map((player, index) =>
    createPlayer({
      id: player.id ?? `player-${index + 1}`,
      name: player.name,
      color: player.color,
      isCrown: false,
      familySupply: componentManifest.families.familyMembersPerFamily,
    }),
  );

  const players: Record<PlayerId, PlayerState> = Object.fromEntries(
    humanPlayers.map((player) => [player.id, player]),
  );
  const seatingOrder = humanPlayers.map((player) => player.id);
  const hidden: HiddenInfoState = {
    mode: "trustedTable",
    privateCards: {},
    firmStrategySecrets: {},
  };

  let crown: CrownState | undefined;
  if (options.mode !== "hotseat") {
    const crownSetup = createCrownState({
      mode: options.mode,
      difficulty: options.crownDifficulty ?? "normal",
      humanPlayerIds: seatingOrder,
      humanColors: humanPlayers.map((player) => player.color),
      rng,
    });

    rng = crownSetup.rng;
    crown = crownSetup.crown;
    players[CROWN_PLAYER_ID] = createPlayer({
      id: CROWN_PLAYER_ID,
      name: "The Crown",
      color: `${crown.familyPiecePools.primaryColor}/${crown.familyPiecePools.secondaryColor}`,
      isCrown: true,
      familySupply:
        crown.familyPiecePools.primaryRemaining + crown.familyPiecePools.secondaryRemaining,
    });
    seatingOrder.push(CROWN_PLAYER_ID);
    hidden.crownDeck = crown.aiDeck;
  }

  // Each phase owns its slice of state; initializers thread the RNG so shuffles stay deterministic.
  const londonSeason = createInitialLondonSeasonState({ scenario, seatingOrder, rng });
  const companyOperation = createInitialCompanyOperationState({ scenario, seatingOrder, rng: londonSeason.rng });
  const eventsInIndia = createInitialEventsInIndiaState({ scenario, seatingOrder, rng: companyOperation.rng });
  const finalScoring = createInitialFinalScoringState({ scenario, seatingOrder, rng: eventsInIndia.rng });
  const negotiation = createInitialNegotiationState({ scenario, seatingOrder, rng: finalScoring.rng });
  rng = negotiation.rng;

  const pendingDecision = createInitialPendingDecision(
    options.mode,
    seatingOrder,
    options.setupDistribution ?? "random",
  );
  const state: GameState = {
    schemaVersion: GAME_SCHEMA_VERSION,
    gameId,
    createdAt,
    updatedAt: createdAt,
    mode: options.mode,
    scenario: options.scenario,
    turn: scenario.startTurn,
    startTurn: scenario.startTurn,
    finalTurn: scenario.finalTurn,
    phase: "setup",
    pendingDecision,
    players,
    seatingOrder,
    company: createInitialCompanyState(scenario),
    india: createInitialIndiaState(scenario),
    parliament: createInitialParliamentState(seatingOrder[0]),
    londonSeason: londonSeason.state,
    companyOperation: companyOperation.state,
    eventsInIndia: eventsInIndia.state,
    finalScoring: finalScoring.state,
    negotiation: negotiation.state,
    decks: {},
    firms: scenario.startsDeregulated ? [] : undefined,
    crown,
    rng,
    log: [],
    hidden,
  };

  return {
    ...state,
    log: [
      createLogEntry({
        state,
        now: createdAt,
        type: "game.created",
        summary: `${modeLabel(options.mode)} game created for the ${options.scenario} scenario.`,
        details: {
          mode: options.mode,
          scenario: options.scenario,
          playerCount: humanPlayers.length,
          crownDifficulty: crown?.difficulty,
        },
      }),
    ],
  };
}

function validateNewGameOptions(options: NewGameOptions): void {
  if (options.mode === "hotseat" && (options.players.length < 3 || options.players.length > 6)) {
    throw new Error("Hotseat games require 3-6 human players.");
  }

  if (options.mode === "soloCrown" && options.players.length !== 1) {
    throw new Error("Solo Crown games require exactly one human player.");
  }

  if (options.mode === "twoPlayerCrown" && options.players.length !== 2) {
    throw new Error("Two-player Crown games require exactly two human players.");
  }

  const ids = options.players.map((player, index) => player.id ?? `player-${index + 1}`);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Player IDs must be unique.");
  }

  if (ids.includes(CROWN_PLAYER_ID)) {
    throw new Error(`The player ID "${CROWN_PLAYER_ID}" is reserved for Crown games.`);
  }
}

function createInitialPendingDecision(
  mode: GameMode,
  seatingOrder: PlayerId[],
  setupDistribution: "starter" | "random",
): PendingDecision {
  const firstHuman = seatingOrder.find((playerId) => playerId !== CROWN_PLAYER_ID);

  if (!firstHuman) {
    throw new Error("At least one human player is required.");
  }

  return {
    id: "decision-setup-confirm-start",
    phase: "setup",
    step: mode === "hotseat" ? "setup.confirmHotseatStart" : "setup.confirmCrownStart",
    actor: firstHuman,
    visibility: "public",
    prompt:
      mode === "hotseat"
        ? "Confirm the table is ready to begin setup."
        : "Confirm the Crown setup scaffold is ready to begin setup.",
    legalCommands: [
      {
        type: "setup.confirmStart",
        label: "Begin setup",
        payload: { setupDistribution },
      },
    ],
    canSave: true,
  };
}

function createCrownState(input: {
  mode: Exclude<GameMode, "hotseat">;
  difficulty: CrownState["difficulty"];
  humanPlayerIds: PlayerId[];
  humanColors: string[];
  rng: ReturnType<typeof createRngState>;
}): { crown: CrownState; rng: ReturnType<typeof createRngState> } {
  const colors = chooseCrownColors(input.humanColors);
  const shuffled = shuffle(input.rng, CROWN_AI_CARD_IDS);
  const faceupAiCard = shuffled.items[0] ?? "crown-ai-01";
  const drawPile = shuffled.items.slice(1);
  const baseCubes = input.mode === "soloCrown" ? 6 : 4;
  const byHumanPlayer: Record<PlayerId, number> = {};
  for (const playerId of input.humanPlayerIds) {
    byHumanPlayer[playerId] = baseCubes;
  }
  let crownSupply = baseCubes;

  if (input.difficulty === "hard" || input.difficulty === "expert") {
    const cubesToMove = input.mode === "soloCrown" ? 4 : 2;
    for (const playerId of input.humanPlayerIds) {
      const currentCubes = byHumanPlayer[playerId] ?? 0;
      const moved = Math.min(currentCubes, cubesToMove);
      byHumanPlayer[playerId] = currentCubes - moved;
      crownSupply += moved;
    }
  }

  const crown: CrownState = {
    difficulty: input.difficulty,
    climate: "climate-unknown-a",
    aiDeck: {
      drawPile,
      discardPile: [],
      removed: [],
    },
    faceupAiCard,
    promiseCubes: {
      crownSupply,
      byHumanPlayer,
      totalCubes: 12,
    },
    playerButton:
      input.mode === "twoPlayerCrown"
        ? {
            holder: input.humanPlayerIds[0],
            nextTransferReason: "initial Crown setup",
          }
        : undefined,
    familyPiecePools: {
      primaryColor: colors[0],
      secondaryColor: colors[1],
      primaryRemaining: 18,
      secondaryRemaining: 18,
    },
    familyTreasury: 0,
    pendingFavorWindows: [],
  };

  return { crown, rng: shuffled.rng };
}

function chooseCrownColors(humanColors: string[]): [string, string] {
  const normalizedHumanColors = new Set(humanColors.map((color) => color.toLowerCase()));
  const available = PLAYER_COLORS.filter((color) => !normalizedHumanColors.has(color));

  return [available[0] ?? "white", available[1] ?? "black"];
}

function createPlayer(input: {
  id: PlayerId;
  name: string;
  color: string;
  isCrown: boolean;
  familySupply: number;
}): PlayerState {
  return {
    id: input.id,
    name: input.name,
    color: input.color,
    isCrown: input.isCrown,
    cash: 0,
    victoryPoints: 0,
    familyMembers: {
      supply: input.familySupply,
      pensioners: 0,
      prizes: {},
      officersInTraining: 0,
      debtorPrison: 0,
    },
    opportunityMarker: "supply",
    enterprises: [],
    prestigeCards: [],
    blackmailCards: [],
    promiseCardsOwned: [],
    promiseCardsGuaranteedToOthers: [],
    trophies: 0,
    passedLawTokens: 0,
    windows: 0,
  };
}

const SEA_ZONE_BY_PRESIDENCY: Record<PresidencyId, SeaZoneId> = {
  Bombay: "west-indian",
  Madras: "south-indian",
  Bengal: "east-indian",
};

// Offices whose cards start in play; the Superintendent of Trade in China, Governor General
// and Governors start in the unused-office stack (p.4, p.16, p.24-26).
const STARTING_OFFICE_IDS = [
  "chairman",
  "director-of-trade",
  "manager-of-shipping",
  "military-affairs",
  "president-bombay",
  "president-madras",
  "president-bengal",
];

function createInitialCompanyState(scenario: ScenarioDefinition): CompanyState {
  const tracks = scenario.setup.companyTracks;
  const treasury = tracks.officeTreasury ?? 0;
  const regiments = (presidency: PresidencyId) =>
    scenario.setup.startingRegiments[presidency.toLowerCase() as keyof typeof scenario.setup.startingRegiments] ?? 0;
  const ships: ShipState[] = [];
  for (const presidency of ["Bombay", "Madras", "Bengal"] as const) {
    const count =
      scenario.setup.startingCompanyShips[
        presidency.toLowerCase() as keyof typeof scenario.setup.startingCompanyShips
      ] ?? 0;
    for (let index = 0; index < count; index += 1) {
      ships.push({
        id: `company-ship-setup-${presidency.toLowerCase()}-${index + 1}`,
        kind: "company",
        location: SEA_ZONE_BY_PRESIDENCY[presidency],
        fatigued: false,
      });
    }
  }

  return {
    standing: tracks.standingSpace ?? 4,
    debt: tracks.debt ?? 0,
    balance: 0,
    shareValue: 0,
    failed: false,
    powerTrack: {},
    offices: Object.fromEntries(
      STARTING_OFFICE_IDS.map((officeId) => [
        officeId,
        {
          id: officeId,
          treasury: COMPANY_TREASURY_OFFICE_IDS.includes(officeId) ? treasury : 0,
          fatigue: 0,
          vacant: true,
          created: true,
          actedThisTurn: false,
        },
      ]),
    ),
    vacantOffices: [...STARTING_OFFICE_IDS],
    unusedOffices: offices
      .map((office) => office.id)
      .filter((officeId) => !STARTING_OFFICE_IDS.includes(officeId)),
    court: [],
    stockExchange: stockExchangeTrack.slots
      .slice()
      .sort((a, b) => a.rightwardOrder - b.rightwardOrder)
      .map((slot) => ({
        id: slot.id,
        cost: slot.cost,
      })),
    ships,
    armies: {
      Bombay: createArmy("Bombay", regiments("Bombay")),
      Madras: createArmy("Madras", regiments("Madras")),
      Bengal: createArmy("Bengal", regiments("Bengal")),
    },
    governorGeneralInPlay: false,
  };
}

function createArmy(id: ArmyId, regiments: number) {
  // Local alliances start unbought in the Army box where they are printed (setup step 3).
  const alliances = localAlliances.filter((alliance) => toEnginePresidency(alliance.army) === id);
  return {
    id,
    officers: {},
    regiments: { ready: regiments, exhausted: 0 },
    localAlliances: Object.fromEntries(alliances.map((alliance) => [alliance.id, "exhausted" as const])),
  };
}

function createInitialIndiaState(scenario: ScenarioDefinition): IndiaState {
  const mapSetup = scenario.setup.mapSetup;
  const empireFlagByRegion = new Map<string, { flag: string; capital: boolean }>();
  mapSetup?.empires.forEach((empire, index) => {
    const flag = `empire-flag-${index + 1}`;
    empireFlagByRegion.set(empire.capital, { flag, capital: true });
    for (const regionId of empire.dominated) empireFlagByRegion.set(regionId, { flag, capital: false });
  });

  const regions: Record<string, RegionState> = Object.fromEntries(
    mapData.regions.map((region) => {
      const regionSetup = mapSetup?.regions[region.id];
      const closed = new Set(regionSetup?.closedOrderIds ?? []);
      const companyControlled = mapSetup?.companyControlled.includes(region.id) ?? false;
      const empire = empireFlagByRegion.get(region.id);

      return [
        region.id,
        {
          id: region.id,
          name: region.label,
          homePresidency: region.homePresidency ? toEnginePresidency(region.homePresidency) : undefined,
          adjacent: [...region.adjacentRegionIds],
          orders: region.orders.map((order) => ({
            id: order.id,
            value: order.value,
            deregulationValue: order.deregulationValue,
            isHomePortFor: order.isHomePortFor ? toEnginePresidency(order.isHomePortFor) : undefined,
            closed: closed.has(order.id),
            filledThisTurnBy: [],
            connectedOrderIds: [...order.connectedOrderIds],
            boardPosition: order.boardPosition,
          })),
          towerLevels: regionSetup?.towerLevels ?? 0,
          hasDome: !companyControlled,
          empireFlag: empire?.flag,
          isCapital: empire?.capital ?? false,
          companyControlled,
          // Association comes only from conquest (p.23). Scenarios that start with Company
          // control (1758 Bengal, 1813) will set it when their map setup is transcribed.
          associatedPresidency: undefined,
          governorOffice: region.governorOfficeId,
          unrest: 0,
          lootToken: {
            available: true,
            value: lootTokens.find((token) => token.region === region.id)?.lootValue ?? null,
            face: "loot",
          },
          exportIcons: region.exportIcons,
          partialCompanyShip: false,
        } satisfies RegionState,
      ];
    }),
  );

  return {
    regions,
    presidencies: {
      Bombay: createPresidency("Bombay"),
      Madras: createPresidency("Madras"),
      Bengal: createPresidency("Bengal"),
    },
    elephant: mapSetup ? { regionId: mapSetup.elephant.region, facing: mapSetup.elephant.facing } : {},
    eventDiscards: [],
    regionsLostThisTurn: 0,
  };
}

function createPresidency(id: PresidencyId) {
  return {
    id,
    army: id,
    writers: {},
    seaZone: SEA_ZONE_BY_PRESIDENCY[id],
  };
}

function createInitialParliamentState(firstPlayer: PlayerId): ParliamentState {
  return {
    primeMinister: firstPlayer,
    policyDialPosition: "initial",
    voteMarker: 0,
    currentVotingRound: 0,
    votesByPlayer: {},
    passedLaws: [],
    deregulated: false,
  };
}

function createLogEntry(input: {
  state: GameState;
  now: string;
  type: string;
  summary: string;
  details?: unknown;
}): GameLogEntry {
  return {
    id: `log-${input.state.log.length + 1}`,
    sequence: input.state.log.length + 1,
    timestamp: input.now,
    turn: input.state.turn,
    phase: input.state.phase,
    type: input.type,
    summary: input.summary,
    details: input.details,
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function modeLabel(mode: GameMode): string {
  switch (mode) {
    case "soloCrown":
      return "Solo Crown";
    case "twoPlayerCrown":
      return "Two-player Crown";
    case "hotseat":
    default:
      return "Hotseat";
  }
}
