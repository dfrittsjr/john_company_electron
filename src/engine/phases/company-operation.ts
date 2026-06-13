import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { confirmStarterPhase, createSystemDecision, wrongPhase } from "./shared";

export function passCompanyOperation(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (
    state.phase !== "companyOperation" ||
    state.pendingDecision.step !== "companyOperation.chooseStarterPass"
  ) {
    return wrongPhase("Company Operation pass can only be chosen during starter Company Operation.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "companyOperation.passed",
    summary: "Starter Company Operation confirmed.",
    detailsNote:
      "Starter scaffold records the phase; office order and office actions come later.",
    nextDecision: createSystemDecision({
      id: `decision-bonuses-confirm-turn-${state.turn}`,
      phase: "bonuses",
      step: "bonuses.confirm",
      prompt: "Confirm starter Bonuses.",
      commandType: "bonuses.confirm",
      label: "Confirm Bonuses",
      description: "Starter scaffold: records that Bonuses were confirmed.",
    }),
  });
}
