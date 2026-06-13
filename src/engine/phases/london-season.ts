import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import {
  createCommandLogEntry,
  createStarterFamilyCommands,
  firstHumanActor,
  noHumanActor,
  wrongPhase,
} from "./shared";

export function confirmLondonSeason(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "londonSeason" || state.pendingDecision.step !== "londonSeason.confirm") {
    return wrongPhase("London Season confirmation can only be chosen during starter London Season.");
  }

  const now = command.clientTimestamp;
  const nextActor = firstHumanActor(state);
  if (!nextActor) {
    return noHumanActor("Cannot advance London Season because there is no human player.");
  }

  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "londonSeason.confirmed",
    summary: "Starter London Season confirmed.",
    details: {
      note: "Starter scaffold records the phase; attrition, retirement, and display rules come later.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      phase: "family",
      pendingDecision: {
        id: `decision-family-choose-action-turn-${state.turn}-${nextActor}`,
        phase: "family",
        step: "family.chooseAction",
        actor: nextActor,
        visibility: "private",
        prompt: "Choose a family action.",
        legalCommands: createStarterFamilyCommands(state, nextActor),
        canSave: true,
      },
      log: [...state.log, logEntry],
    },
  };
}
