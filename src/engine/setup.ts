import { createRngState, shuffle } from "./rng";
import {
  GAME_SCHEMA_VERSION,
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
  type ScenarioId,
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

  const createdAt = options.now ?? new Date().toISOString();
  let rng = createRngState(options.seed ?? `${options.scenario}:${options.mode}:${createdAt}`);
  const gameId = options.gameId ?? `game-${slugify(options.scenario)}-${createdAt}`;
  const humanPlayers = options.players.map((player, index) =>
    createPlayer({
      id: player.id ?? `player-${index + 1}`,
      name: player.name,
      color: player.color,
      isCrown: false,
      familySupply: 18,
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

  const pendingDecision = createInitialPendingDecision(options.mode, seatingOrder);
  const state: GameState = {
    schemaVersion: GAME_SCHEMA_VERSION,
    gameId,
    createdAt,
    updatedAt: createdAt,
    mode: options.mode,
    scenario: options.scenario,
    turn: 1,
    finalTurn: finalTurnForScenario(options.scenario),
    phase: "setup",
    pendingDecision,
    players,
    seatingOrder,
    company: createInitialCompanyState(),
    india: createInitialIndiaState(),
    parliament: createInitialParliamentState(seatingOrder[0]),
    decks: {},
    firms: options.scenario === "1813" ? [] : undefined,
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

function createInitialPendingDecision(mode: GameMode, seatingOrder: PlayerId[]): PendingDecision {
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
      courtShares: 0,
      chairmanShare: false,
      stockExchange: [],
      writers: emptyPresidencyRecord(0),
      officersInTraining: 0,
      officers: {
        Bombay: { ready: 0, exhausted: 0 },
        Madras: { ready: 0, exhausted: 0 },
        Bengal: { ready: 0, exhausted: 0 },
      },
      commanders: {
        Bombay: false,
        Madras: false,
        Bengal: false,
      },
      offices: [],
      firmShares: {},
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

function createInitialCompanyState(): CompanyState {
  return {
    standing: 0,
    debt: 0,
    balance: 0,
    expectations: 0,
    shareValue: 0,
    failed: false,
    powerTrack: {},
    offices: {},
    vacantOffices: [],
    unusedOffices: [],
    court: [],
    stockExchange: [],
    ships: [],
    extraShips: [],
    armies: {
      Bombay: { id: "Bombay", officers: {}, regiments: { ready: 0, exhausted: 0 } },
      Madras: { id: "Madras", officers: {}, regiments: { ready: 0, exhausted: 0 } },
      Bengal: { id: "Bengal", officers: {}, regiments: { ready: 0, exhausted: 0 } },
    },
    governorGeneralInPlay: false,
  };
}

function createInitialIndiaState(): IndiaState {
  return {
    regions: {},
    presidencies: {
      Bombay: createPresidency("Bombay"),
      Madras: createPresidency("Madras"),
      Bengal: createPresidency("Bengal"),
    },
    elephant: {},
    eventDiscards: [],
    regionsLostThisTurn: 0,
  };
}

function createPresidency(id: PresidencyId) {
  return {
    id,
    army: id,
    treasury: 0,
    writers: {},
    seaZone: `${id.toLowerCase()}-sea-zone`,
    governors: [],
    associatedRegions: [],
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

function emptyPresidencyRecord(value: number): Record<PresidencyId, number> {
  return {
    Bombay: value,
    Madras: value,
    Bengal: value,
  };
}

function finalTurnForScenario(scenario: ScenarioId): number {
  switch (scenario) {
    case "1758":
      return 4;
    case "1813":
      return 3;
    case "Long 1710":
    case "long-1710":
      return 6;
    case "1710":
    default:
      return 5;
  }
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
