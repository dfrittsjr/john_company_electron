import type { ApplyCommandResult, GameCommand, GameState, PendingDecision } from "../types";
import {
  createCommandLogEntry,
  createStarterFamilyCommands,
  createStarterHiringCommands,
} from "./shared";

export function chooseFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseAction") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Family actions can only be chosen during the Family phase.",
          field: "phase",
        },
      ],
    };
  }

  const action = parseFamilyActionPayload(command.payload);
  if (!action) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_PAYLOAD",
          message: "Family action command requires a payload with an action id.",
          field: "payload.action",
        },
      ],
    };
  }

  const actingPlayer = state.players[command.actorId];
  if (!actingPlayer || actingPlayer.isCrown) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_ACTOR",
          message: "Only a human family can choose this starter family action.",
          field: "actorId",
        },
      ],
    };
  }

  const humanOrder = state.seatingOrder.filter((playerId) => !state.players[playerId].isCrown);
  const actorIndex = humanOrder.indexOf(command.actorId);
  const nextActor = humanOrder[actorIndex + 1];
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "family.action.chosen",
    summary: `${actingPlayer.name} chose ${familyActionLabel(action)}.`,
    details: {
      action,
      note: "Starter scaffold records the choice but does not yet apply full Family phase effects.",
    },
  });
  const pendingDecision: PendingDecision = nextActor
    ? {
        id: `decision-family-choose-action-turn-${state.turn}-${nextActor}`,
        phase: "family",
        step: "family.chooseAction",
        actor: nextActor,
        visibility: "private",
        prompt: "Choose a family action.",
        legalCommands: createStarterFamilyCommands(state, nextActor),
        canSave: true,
      }
    : {
        id: `decision-hiring-pass-turn-${state.turn}-${humanOrder[0]}`,
        phase: "hiring",
        step: "hiring.chooseStarterPass",
        actor: humanOrder[0],
        visibility: "private",
        prompt: "Hiring is not fully implemented yet. Record a starter hiring pass.",
        legalCommands: createStarterHiringCommands(),
        canSave: true,
      };

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      phase: pendingDecision.phase,
      pendingDecision,
      players: {
        ...state.players,
        [actingPlayer.id]: {
          ...actingPlayer,
          opportunityMarker: action,
        },
      },
      log: [...state.log, logEntry],
    },
  };
}

function parseFamilyActionPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const action = (payload as { action?: unknown }).action;

  return typeof action === "string" && action.length > 0 ? action : undefined;
}

function familyActionLabel(action: string): string {
  return action
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
