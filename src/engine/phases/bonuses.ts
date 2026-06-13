import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { confirmStarterPhase, createSystemDecision, wrongPhase } from "./shared";

export function confirmBonuses(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "bonuses" || state.pendingDecision.step !== "bonuses.confirm") {
    return wrongPhase("Bonuses confirmation can only be chosen during starter Bonuses.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "bonuses.confirmed",
    summary: "Starter Bonuses confirmed.",
    detailsNote: "Starter scaffold records the phase; workshop and shipyard income comes later.",
    nextDecision: createSystemDecision({
      id: `decision-revenue-confirm-turn-${state.turn}`,
      phase: "revenue",
      step: "revenue.confirm",
      prompt: "Confirm starter Revenue.",
      commandType: "revenue.confirm",
      label: "Confirm Revenue",
      description: "Starter scaffold: records that Revenue was confirmed.",
    }),
  });
}
