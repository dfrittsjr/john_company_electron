import type {
  ActorId,
  ApplyCommandResult,
  GameCommand,
  GameLogEntry,
  GameState,
  LegalCommand,
  PendingDecision,
} from "../types";

export function createStarterFamilyCommands(state: GameState, actorId: ActorId): LegalCommand[] {
  if (actorId === "system") return [];

  const actor = state.players[actorId];
  if (!actor || actor.isCrown) return [];

  return [
    {
      type: "family.chooseAction",
      label: "Enlist Writer",
      description: "Starter scaffold: records the action choice; writer placement comes later.",
      payload: { action: "enlist-writer" },
    },
    {
      type: "family.chooseAction",
      label: "Enlist Officer",
      description: "Starter scaffold: records the action choice; officer pools come later.",
      payload: { action: "enlist-officer" },
    },
    {
      type: "family.chooseAction",
      label: "Seek Share",
      description: "Starter scaffold: records the action choice; share-market effects come later.",
      payload: { action: "seek-share" },
    },
    {
      type: "family.chooseAction",
      label: "Purchase Workshop",
      description: "Starter scaffold: records the action choice; enterprise decks come later.",
      payload: { action: "purchase-workshop" },
    },
  ];
}

export function createStarterHiringCommands(): LegalCommand[] {
  return [
    {
      type: "hiring.pass",
      label: "Pass Hiring",
      description: "Starter scaffold: records that this family has no hiring action yet.",
      payload: {},
    },
  ];
}

export function confirmStarterPhase(input: {
  state: GameState;
  command: GameCommand;
  logType: string;
  summary: string;
  detailsNote: string;
  nextDecision: PendingDecision;
}): ApplyCommandResult {
  const now = input.command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: input.state,
    command: input.command,
    now,
    type: input.logType,
    summary: input.summary,
    details: {
      note: input.detailsNote,
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...input.state,
      updatedAt: now,
      phase: input.nextDecision.phase,
      pendingDecision: input.nextDecision,
      log: [...input.state.log, logEntry],
    },
  };
}

export function createSystemDecision(input: {
  id: string;
  phase: PendingDecision["phase"];
  step: string;
  prompt: string;
  commandType: string;
  label: string;
  description: string;
}): PendingDecision {
  return {
    id: input.id,
    phase: input.phase,
    step: input.step,
    actor: "system",
    visibility: "public",
    prompt: input.prompt,
    legalCommands: [
      {
        type: input.commandType,
        label: input.label,
        description: input.description,
        payload: {},
      },
    ],
    canSave: true,
  };
}

export function firstHumanActor(state: GameState): ActorId | undefined {
  return state.seatingOrder.find((playerId) => !state.players[playerId].isCrown);
}

export function noHumanActor(message: string): ApplyCommandResult {
  return {
    ok: false,
    errors: [
      {
        code: "NO_HUMAN_ACTOR",
        message,
      },
    ],
  };
}

export function wrongPhase(message: string): ApplyCommandResult {
  return {
    ok: false,
    errors: [
      {
        code: "WRONG_PHASE",
        message,
        field: "phase",
      },
    ],
  };
}

export function createCommandLogEntry(input: {
  state: GameState;
  command: GameCommand;
  now: string;
  type: string;
  summary: string;
  details?: unknown;
  rngRolls?: GameLogEntry["rngRolls"];
}): GameLogEntry {
  return {
    id: `log-${input.state.log.length + 1}`,
    sequence: input.state.log.length + 1,
    timestamp: input.now,
    turn: input.state.turn,
    phase: input.state.phase,
    actor: input.command.actorId,
    type: input.type,
    summary: input.summary,
    details: input.details,
    commandId: input.command.id,
    rngRolls: input.rngRolls,
  };
}
