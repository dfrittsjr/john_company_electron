import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { createCommandLogEntry, wrongPhase } from "./shared";

export function confirmFinalScoring(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "finalScoring" || state.pendingDecision.step !== "finalScoring.confirm") {
    return wrongPhase("Final Scoring confirmation can only be chosen during starter Final Scoring.");
  }

  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "finalScoring.confirmed",
    summary: "Starter Final Scoring confirmed.",
    details: {
      note: "Starter scaffold records the phase; VP calculation and tie breakers come later.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      pendingDecision: {
        id: `decision-final-scoring-complete-turn-${state.turn}`,
        phase: "finalScoring",
        step: "finalScoring.complete",
        actor: "system",
        visibility: "public",
        prompt: "Starter final scoring is complete.",
        legalCommands: [],
        canSave: true,
      },
      log: [...state.log, logEntry],
    },
  };
}
