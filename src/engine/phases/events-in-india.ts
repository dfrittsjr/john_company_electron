import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { rollDie } from "../rng";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

export function confirmEventsInIndia(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (
    state.phase !== "eventsInIndia" ||
    state.pendingDecision.step !== "eventsInIndia.confirm"
  ) {
    return wrongPhase("Events in India confirmation can only roll during Events in India.");
  }

  const now = command.clientTimestamp;
  const stormRoll = rollDie(state.rng, 6, "eventsInIndia.stormDie");
  const stormResult = mapTemporaryStormDie(stormRoll.value);
  const nextDecision = {
    id: `decision-events-in-india-resolve-turn-${state.turn}`,
    phase: "eventsInIndia" as const,
    step: "eventsInIndia.resolveRolledEvents",
    actor: "system" as const,
    visibility: "public" as const,
    prompt: "Resolve Events in India storm die result.",
    legalCommands: [
      {
        type: "eventsInIndia.resolveRolledEvents",
        label: "Resolve Events in India",
        description:
          "Temporary scaffold: records the storm die result and advances to Parliament.",
        payload: stormResult,
      },
    ],
    canSave: true as const,
  };
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "eventsInIndia.stormDieRolled",
    summary: `Events in India rolled storm die ${stormRoll.value}.`,
    details: {
      ...stormResult,
      assumption:
        "Temporary storm die mapping until storm die faces and event tiles are encoded: 1-2 show one event tile, 3-4 show two, 5-6 show three and mark storms active.",
    },
    rngRolls: [stormRoll.roll],
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      pendingDecision: nextDecision,
      rng: stormRoll.rng,
      log: [...state.log, logEntry],
    },
  };
}

export function resolveRolledEventsInIndia(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (
    state.phase !== "eventsInIndia" ||
    state.pendingDecision.step !== "eventsInIndia.resolveRolledEvents"
  ) {
    return wrongPhase("Rolled Events in India can only resolve after the storm die.");
  }

  const stormResult = state.pendingDecision.legalCommands.find(
    (legalCommand) => legalCommand.type === "eventsInIndia.resolveRolledEvents",
  )?.payload;
  const nextDecision = createSystemDecision({
    id: `decision-parliament-confirm-turn-${state.turn}`,
    phase: "parliament",
    step: "parliament.confirm",
    prompt: "Confirm starter Parliament Meets.",
    commandType: "parliament.confirm",
    label: "Confirm Parliament",
    description: "Starter scaffold: records that Parliament was confirmed.",
  });
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "eventsInIndia.resolved",
    summary: "Events in India resolved.",
    details: {
      stormResult,
      note: "Event tile effects, cascades, elephant movement, attacks, and region loss remain TODO.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
      log: [...state.log, logEntry],
    },
  };
}

function mapTemporaryStormDie(roll: number) {
  return {
    stormDieRoll: roll,
    eventTileCount: roll <= 2 ? 1 : roll <= 4 ? 2 : 3,
    stormsActive: roll >= 5,
  };
}
