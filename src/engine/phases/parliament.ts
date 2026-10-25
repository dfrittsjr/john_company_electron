import type { CommandHandler } from "../command-handler";
import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { confirmStarterPhase, createSystemDecision, wrongPhase } from "./shared";

export function confirmParliament(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "parliament" || state.pendingDecision.step !== "parliament.confirm") {
    return wrongPhase("Parliament confirmation can only be chosen during starter Parliament.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "parliament.confirmed",
    summary: "Starter Parliament confirmed.",
    detailsNote:
      "Starter scaffold records the phase; law selection, policy, and voting come later.",
    nextDecision: createSystemDecision({
      id: `decision-upkeep-confirm-turn-${state.turn}`,
      phase: "upkeep",
      step: "upkeep.confirm",
      prompt: "Confirm starter Upkeep and Refresh.",
      commandType: "upkeep.confirm",
      label: "Confirm Upkeep",
      description: "Starter scaffold: records that Upkeep was confirmed.",
    }),
  });
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const parliamentCommandHandlers: Record<string, CommandHandler> = {
  "parliament.confirm": confirmParliament,
};
