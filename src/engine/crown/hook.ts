import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { applyCubeDetectors } from "./favors";
import { crownizeDecision } from "./policy";
import { clearCrownEffects, CROWN_PLAYER_ID, passPlayerButton } from "./state";

/**
 * Runs after every accepted command in a Crown game (src/engine/commands.ts):
 * - the Crown's own command: its reason goes on the log entry, a "choose for the Crown" favour on
 *   that decision is used up, and the Player Button passes if the Crown chose between the players;
 * - anyone else's: cubes their command earned or cost under the automatic favours;
 * - then the Crown decides the next decision if it is the Crown's.
 */
export function afterCrownCommand(before: GameState, result: ApplyCommandResult, command: GameCommand): ApplyCommandResult {
  if (!result.ok || !before.crown || !result.state.crown) return result;
  let state = result.state;
  const decision = before.pendingDecision;

  if (command.actorId === CROWN_PLAYER_ID && decision.actor === CROWN_PLAYER_ID && decision.crown) {
    const reason = decision.crown.reason;
    if (reason) {
      state = {
        ...state,
        log: state.log.map((entry) => (entry.id === result.logEntry.id && entry.commandId === command.id ? { ...entry, crownReason: reason } : entry)),
      };
    }
    state = clearCrownEffects(state, (effect) => effect.decisionId === decision.id && Boolean(effect.choices));
    if (decision.crown.passButton) state = passPlayerButton(state);
  } else if (command.actorId !== CROWN_PLAYER_ID) {
    state = applyCubeDetectors(before, state, command, command.clientTimestamp);
  }

  state = crownizeDecision(state);
  const logEntry = state.log.find((entry) => entry.id === result.logEntry.id) ?? result.logEntry;
  return { ...result, state, logEntry };
}
