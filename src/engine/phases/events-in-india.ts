import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { confirmStarterPhase, createSystemDecision, wrongPhase } from "./shared";

export function confirmEventsInIndia(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (
    state.phase !== "eventsInIndia" ||
    state.pendingDecision.step !== "eventsInIndia.confirm"
  ) {
    return wrongPhase("Events in India confirmation can only be chosen during starter Events.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "eventsInIndia.confirmed",
    summary: "Starter Events in India confirmed.",
    detailsNote:
      "Starter scaffold records the phase; storm die, event tiles, and attacks come later.",
    nextDecision: createSystemDecision({
      id: `decision-parliament-confirm-turn-${state.turn}`,
      phase: "parliament",
      step: "parliament.confirm",
      prompt: "Confirm starter Parliament Meets.",
      commandType: "parliament.confirm",
      label: "Confirm Parliament",
      description: "Starter scaffold: records that Parliament was confirmed.",
    }),
  });
}
