import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

export function confirmUpkeep(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "upkeep" || state.pendingDecision.step !== "upkeep.confirm") {
    return wrongPhase("Upkeep confirmation can only be chosen during starter Upkeep.");
  }

  const now = command.clientTimestamp;
  const shouldScore = state.turn >= state.finalTurn;
  const nextTurn = shouldScore ? state.turn : state.turn + 1;
  const nextDecision = shouldScore
    ? createSystemDecision({
        id: `decision-final-scoring-confirm-turn-${state.turn}`,
        phase: "finalScoring",
        step: "finalScoring.confirm",
        prompt: "Confirm starter Final Scoring.",
        commandType: "finalScoring.confirm",
        label: "Confirm Final Scoring",
        description: "Starter scaffold: records that Final Scoring was confirmed.",
      })
    : createSystemDecision({
        id: `decision-london-season-confirm-turn-${nextTurn}`,
        phase: "londonSeason",
        step: "londonSeason.confirm",
        prompt: "Confirm starter London Season.",
        commandType: "londonSeason.confirm",
        label: "Confirm London Season",
        description: "Starter scaffold: records that London Season was confirmed.",
      });
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "upkeep.confirmed",
    summary: shouldScore
      ? "Starter Upkeep confirmed. The game is ready for final scoring."
      : `Starter Upkeep confirmed. Advanced to turn ${nextTurn}.`,
    details: {
      note: "Starter scaffold records the phase; upkeep payments, refresh, and cleanup come later.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      turn: nextTurn,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
      log: [...state.log, logEntry],
    },
  };
}
