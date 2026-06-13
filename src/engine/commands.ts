import type {
  ActorId,
  ApplyCommandResult,
  GameCommand,
  GameLogEntry,
  GameState,
  LegalCommand,
  PendingDecision,
  ValidationError,
} from "./types";

const KNOWN_COMMAND_TYPES = new Set([
  "setup.confirmStart",
  "family.chooseAction",
  "hiring.pass",
]);

export function applyCommand(state: GameState, command: GameCommand): ApplyCommandResult {
  const validationErrors = validateCommandEnvelope(state, command, {
    skipLegalCommandCheck: true,
  });
  if (validationErrors.length > 0) {
    return { ok: false, errors: validationErrors };
  }

  if (!KNOWN_COMMAND_TYPES.has(command.type)) {
    return {
      ok: false,
      errors: [
        {
          code: "UNKNOWN_COMMAND",
          message: `Unknown command type "${command.type}".`,
          field: "type",
        },
      ],
    };
  }

  const legalCommandErrors = validateLegalCommandForDecision(state, command);
  if (legalCommandErrors.length > 0) {
    return { ok: false, errors: legalCommandErrors };
  }

  switch (command.type) {
    case "setup.confirmStart":
      return confirmStart(state, command);
    case "family.chooseAction":
      return chooseFamilyAction(state, command);
    case "hiring.pass":
      return passHiring(state, command);
    default:
      return {
        ok: false,
        errors: [
          {
            code: "UNKNOWN_COMMAND",
            message: `Unknown command type "${command.type}".`,
            field: "type",
          },
        ],
      };
  }
}

export function validateCommandEnvelope(
  state: GameState,
  command: GameCommand,
  options: { skipLegalCommandCheck?: boolean } = {},
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (command.gameId !== state.gameId) {
    errors.push({
      code: "GAME_ID_MISMATCH",
      message: "Command gameId does not match the loaded game.",
      field: "gameId",
    });
  }

  if (command.decisionId !== state.pendingDecision.id) {
    errors.push({
      code: "DECISION_ID_MISMATCH",
      message: "Command decisionId does not match the current pending decision.",
      field: "decisionId",
    });
  }

  if (!canActorAct(state.pendingDecision, command.actorId)) {
    errors.push({
      code: "ACTOR_NOT_ALLOWED",
      message: `Actor "${command.actorId}" cannot act on decision "${state.pendingDecision.id}".`,
      field: "actorId",
    });
  }

  if (!options.skipLegalCommandCheck) {
    errors.push(...validateLegalCommandForDecision(state, command));
  }

  return errors;
}

function validateLegalCommandForDecision(
  state: GameState,
  command: GameCommand,
): ValidationError[] {
  if (state.pendingDecision.legalCommands.some((legal) => legal.type === command.type)) {
    return [];
  }

  return [
    {
      code: "ILLEGAL_COMMAND_FOR_DECISION",
      message: `Command "${command.type}" is not legal for decision "${state.pendingDecision.id}".`,
      field: "type",
    },
  ];
}

function confirmStart(state: GameState, command: GameCommand): ApplyCommandResult {
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
    legalCommands: createStarterFamilyCommands(state, nextActor),
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

function chooseFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
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

function passHiring(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "hiring" || state.pendingDecision.step !== "hiring.chooseStarterPass") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Hiring pass can only be chosen during the starter Hiring step.",
          field: "phase",
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
          message: "Only a human family can pass this starter Hiring decision.",
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
    type: "hiring.passed",
    summary: `${actingPlayer.name} passed starter Hiring.`,
    details: {
      note: "Starter scaffold records the pass; full office hiring rules come later.",
    },
  });
  const pendingDecision: PendingDecision = nextActor
    ? {
        id: `decision-hiring-pass-turn-${state.turn}-${nextActor}`,
        phase: "hiring",
        step: "hiring.chooseStarterPass",
        actor: nextActor,
        visibility: "private",
        prompt: "Hiring is not fully implemented yet. Record a starter hiring pass.",
        legalCommands: createStarterHiringCommands(),
        canSave: true,
      }
    : {
        id: `decision-company-operation-start-turn-${state.turn}`,
        phase: "companyOperation",
        step: "companyOperation.notImplemented",
        actor: "system",
        visibility: "public",
        prompt:
          "All human families have passed starter Hiring. Company Operation reducers are the next implementation step.",
        legalCommands: [],
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
      log: [...state.log, logEntry],
    },
  };
}

function createStarterFamilyCommands(state: GameState, actorId: ActorId): LegalCommand[] {
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

function createStarterHiringCommands(): LegalCommand[] {
  return [
    {
      type: "hiring.pass",
      label: "Pass Hiring",
      description: "Starter scaffold: records that this family has no hiring action yet.",
      payload: {},
    },
  ];
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

function canActorAct(decision: PendingDecision, actorId: ActorId): boolean {
  return (
    decision.actor === "simultaneous" ||
    decision.actor === actorId ||
    (decision.actor === "system" && actorId === "system")
  );
}

function createCommandLogEntry(input: {
  state: GameState;
  command: GameCommand;
  now: string;
  type: string;
  summary: string;
  details?: unknown;
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
  };
}
