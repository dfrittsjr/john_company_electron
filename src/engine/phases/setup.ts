import type { ApplyCommandResult, GameCommand, GameState, PendingDecision } from "../types";
import { createFamilyActionCommands } from "./family";
import { createCommandLogEntry } from "./shared";

export function confirmStart(state: GameState, command: GameCommand): ApplyCommandResult {
  const now = command.clientTimestamp;
  const nextActor = state.seatingOrder.find((playerId) => !state.players[playerId].isCrown);

  if (!nextActor) {
    return {
      ok: false,
      errors: [
        {
          code: "NO_HUMAN_ACTOR",
          message: "Cannot advance setup because there is no human player.",
        },
      ],
    };
  }

  const pendingDecision: PendingDecision = {
    id: "decision-family-choose-action-turn-1",
    phase: "family",
    step: "family.chooseAction",
    actor: nextActor,
    visibility: "private",
    prompt: "Choose a family action.",
    legalCommands: createFamilyActionCommands(state, nextActor),
    canSave: true,
  };
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "setup.confirmed",
    summary: `${state.players[command.actorId]?.name ?? command.actorId} confirmed setup start.`,
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      phase: "family",
      pendingDecision,
      log: [...state.log, logEntry],
    },
  };
}
