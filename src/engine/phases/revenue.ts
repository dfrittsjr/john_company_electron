import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { confirmStarterPhase, createSystemDecision, wrongPhase } from "./shared";

export function confirmRevenue(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.confirm") {
    return wrongPhase("Revenue confirmation can only be chosen during starter Revenue.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "revenue.confirmed",
    summary: "Starter Revenue confirmed.",
    detailsNote:
      "Starter scaffold records the phase; expenses, dividends, and Company failure come later.",
    nextDecision: createSystemDecision({
      id: `decision-events-in-india-confirm-turn-${state.turn}`,
      phase: "eventsInIndia",
      step: "eventsInIndia.confirm",
      prompt: "Confirm starter Events in India.",
      commandType: "eventsInIndia.confirm",
      label: "Confirm Events in India",
      description: "Starter scaffold: records that Events in India were confirmed.",
    }),
  });
}
