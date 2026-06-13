import { expect } from "vitest";
import { applyCommand, createNewGame, type ActorId, type GameCommand, type GameState } from "../../engine";
import { deserializeGameState, serializeSave } from "../../save";

export const TEST_NOW = "2026-06-13T12:00:00.000Z";

export const HOTSEAT_PLAYERS = [
  { id: "player-red", name: "Red", color: "red" },
  { id: "player-blue", name: "Blue", color: "blue" },
  { id: "player-yellow", name: "Yellow", color: "yellow" },
] as const;

const KNOWN_COMMAND_TYPES = new Set([
  "setup.confirmStart",
  "londonSeason.confirm",
  "family.chooseAction",
  "hiring.pass",
  "companyOperation.passOffice",
  "bonuses.confirm",
  "revenue.confirm",
  "eventsInIndia.confirm",
  "parliament.confirm",
  "upkeep.confirm",
  "finalScoring.confirm",
]);

export function createHotseatGame(
  options: {
    seed?: string;
    gameId?: string;
    now?: string;
    finalTurn?: number;
  } = {},
): GameState {
  const state = createNewGame({
    mode: "hotseat",
    scenario: "1710",
    seed: options.seed ?? "test-hotseat-game",
    gameId: options.gameId ?? "game-test-hotseat",
    now: options.now ?? TEST_NOW,
    players: HOTSEAT_PLAYERS.map((player) => ({ ...player })),
  });

  return options.finalTurn === undefined ? state : { ...state, finalTurn: options.finalTurn };
}

export function applyFirstLegalCommand(
  state: GameState,
  options: {
    commandId: string;
    actorId?: ActorId;
    clientTimestamp?: string;
    assertInvariants?: boolean;
  },
): GameState {
  const legalCommand = state.pendingDecision.legalCommands[0];
  expect(legalCommand).toBeDefined();

  return applyCommandOrThrow(state, {
    id: options.commandId,
    actorId: options.actorId ?? inferActorId(state),
    type: legalCommand.type,
    payload: legalCommand.payload ?? {},
    clientTimestamp: options.clientTimestamp ?? "2026-06-13T12:10:00.000Z",
    assertInvariants: options.assertInvariants ?? true,
  });
}

export function applyCommandOrThrow(
  state: GameState,
  input: {
    id: string;
    actorId?: ActorId;
    type: string;
    payload: unknown;
    clientTimestamp?: string;
    assertInvariants?: boolean;
  },
): GameState {
  const command: GameCommand = {
    id: input.id,
    gameId: state.gameId,
    actorId: input.actorId ?? inferActorId(state),
    decisionId: state.pendingDecision.id,
    type: input.type,
    payload: input.payload,
    clientTimestamp: input.clientTimestamp ?? "2026-06-13T12:10:00.000Z",
  };
  const result = applyCommand(state, command);

  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join(" "));
  }

  if (input.assertInvariants ?? true) {
    expectGameInvariants(result.state);
  }

  return result.state;
}

export function advanceThroughStarterFamily(): GameState {
  let state = createHotseatGame({
    seed: "advance-through-family",
    gameId: "game-advance-through-family",
  });

  state = applyCommandOrThrow(state, {
    id: "command-setup",
    actorId: "player-red",
    type: "setup.confirmStart",
    payload: {},
    clientTimestamp: "2026-06-13T12:01:00.000Z",
  });

  for (const actorId of ["player-red", "player-blue", "player-yellow"] as const) {
    state = applyFirstLegalCommand(state, {
      commandId: `command-family-${actorId}`,
      actorId,
      clientTimestamp: "2026-06-13T12:02:00.000Z",
    });
  }

  return state;
}

export function advanceThroughStarterHiring(): GameState {
  let state = advanceThroughStarterFamily();

  for (const actorId of ["player-red", "player-blue", "player-yellow"] as const) {
    state = applyFirstLegalCommand(state, {
      commandId: `command-hiring-${actorId}`,
      actorId,
    });
  }

  return state;
}

export function expectGameInvariants(state: GameState): void {
  expect(state.pendingDecision.phase).toBe(state.phase);

  if (state.pendingDecision.actor !== "system" && state.pendingDecision.actor !== "simultaneous") {
    expect(state.players[state.pendingDecision.actor]).toBeDefined();
  }

  for (const legalCommand of state.pendingDecision.legalCommands) {
    expect(KNOWN_COMMAND_TYPES.has(legalCommand.type)).toBe(true);
  }

  state.log.forEach((entry, index) => {
    expect(entry.sequence).toBe(index + 1);
  });
}

export function expectSaveRoundTripPreservesPendingDecision(state: GameState): void {
  const serialized = serializeSave(state, {
    saveId: `save-${state.pendingDecision.id}`,
    now: "2026-06-13T12:30:00.000Z",
  });
  const loadedState = deserializeGameState(serialized);

  expect(loadedState.pendingDecision).toEqual(state.pendingDecision);
  expect(loadedState.phase).toBe(state.phase);
  expect(loadedState.turn).toBe(state.turn);
  expect(loadedState.log).toEqual(state.log);
}

function inferActorId(state: GameState): ActorId {
  if (state.pendingDecision.actor === "simultaneous") {
    return state.seatingOrder[0];
  }

  return state.pendingDecision.actor;
}
