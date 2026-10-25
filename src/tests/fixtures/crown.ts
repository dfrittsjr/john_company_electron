import {
  applyCommand,
  createNewGame,
  runCrownSteps,
  type ActorId,
  type CrownDifficulty,
  type GameCommand,
  type GameState,
  type LegalCommand,
} from "../../engine";
import { TEST_NOW } from "./game";

export const SOLO_PLAYERS = [{ id: "player-ann", name: "Ann", color: "red" }] as const;
export const TWO_PLAYERS = [
  { id: "player-ann", name: "Ann", color: "red" },
  { id: "player-ben", name: "Ben", color: "blue" },
] as const;

/** A new Crown game at its first decision (the setup card choice). */
export function newCrownGame(
  options: { players?: 1 | 2; seed?: string; difficulty?: CrownDifficulty; scenario?: "1710" | "long-1710" } = {},
): GameState {
  const players = options.players === 2 ? TWO_PLAYERS : SOLO_PLAYERS;
  return createNewGame({
    mode: options.players === 2 ? "twoPlayerCrown" : "soloCrown",
    scenario: options.scenario ?? "1710",
    seed: options.seed ?? "test-crown-game",
    gameId: "game-test-crown",
    now: TEST_NOW,
    crownDifficulty: options.difficulty ?? "normal",
    players: players.map((player) => ({ ...player })),
  });
}

/** A Crown game with the setup cards dealt at random, at the first Family decision. */
export function startedCrownGame(options: Parameters<typeof newCrownGame>[0] = {}): GameState {
  const state = newCrownGame(options);
  return act(state, state.pendingDecision.legalCommands.find((legal) => (legal.payload as { variant?: string }).variant === "random")!);
}

/** Applies a legal command (or the option at `index`) as the decision's actor; throws if rejected. */
export function act(state: GameState, legal: LegalCommand | number, actorId?: ActorId): GameState {
  const chosen = typeof legal === "number" ? state.pendingDecision.legalCommands[legal] : legal;
  if (!chosen) throw new Error(`No option ${String(legal)} for ${state.pendingDecision.step}.`);
  const actor = state.pendingDecision.actor;
  const command: GameCommand = {
    id: `test-${state.log.length + 1}`,
    gameId: state.gameId,
    actorId: actorId ?? (actor === "simultaneous" ? state.seatingOrder[0] : actor),
    decisionId: state.pendingDecision.id,
    type: chosen.type,
    payload: chosen.payload ?? {},
    clientTimestamp: TEST_NOW,
  };
  const result = applyCommand(state, command);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join(" "));
  return result.state;
}

/** Any command, anytime ones included (`crown.favor`, `crown.giveCubes`). */
export function command(state: GameState, actorId: ActorId, type: string, payload: unknown): GameState {
  const result = applyCommand(state, {
    id: `test-${state.log.length + 1}`,
    gameId: state.gameId,
    actorId,
    decisionId: state.pendingDecision.id,
    type,
    payload,
    clientTimestamp: TEST_NOW,
  });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join(" "));
  return result.state;
}

/** Lets the Crown play on until a player must act (favours ignored unless `stopForFavors`). */
export function crownPlays(state: GameState, options: { stopForFavors?: boolean } = {}): GameState {
  const result = runCrownSteps(state, { now: TEST_NOW, idPrefix: `crown-${state.log.length}`, ignoreFavors: !options.stopForFavors });
  if (result.errors) throw new Error(result.errors.map((error) => error.message).join(" "));
  return result.state;
}

/**
 * Plays on, choosing for everyone with `pick` (default: the first option), until `until` holds or
 * `maxSteps` commands have been applied. Crown decisions use the Crown's own choice.
 */
export function playUntil(
  state: GameState,
  until: (state: GameState) => boolean,
  options: { maxSteps?: number; pick?: (state: GameState) => LegalCommand | undefined } = {},
): GameState {
  let current = state;
  for (let step = 0; step < (options.maxSteps ?? 2000); step += 1) {
    if (until(current)) return current;
    const legal = options.pick?.(current) ?? current.pendingDecision.legalCommands[0];
    if (!legal) throw new Error(`No options at ${current.pendingDecision.step}.`);
    current = act(current, legal);
  }
  if (until(current)) return current;
  throw new Error(`Gave up at ${current.pendingDecision.step} (turn ${current.turn}).`);
}
