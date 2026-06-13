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
  "londonSeason.confirm",
  "family.chooseAction",
  "hiring.pass",
  "companyOperation.passOffice",
  "bonuses.confirm",
  "revenue.confirm",
  "eventsInIndia.confirm",
  "parliament.confirm",
  "upkeep.confirm",
  "finalScoring.confirm",
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
    case "londonSeason.confirm":
      return confirmLondonSeason(state, command);
    case "family.chooseAction":
      return chooseFamilyAction(state, command);
    case "hiring.pass":
      return passHiring(state, command);
    case "companyOperation.passOffice":
      return passCompanyOperation(state, command);
    case "bonuses.confirm":
      return confirmBonuses(state, command);
    case "revenue.confirm":
      return confirmRevenue(state, command);
    case "eventsInIndia.confirm":
      return confirmEventsInIndia(state, command);
    case "parliament.confirm":
      return confirmParliament(state, command);
    case "upkeep.confirm":
      return confirmUpkeep(state, command);
    case "finalScoring.confirm":
      return confirmFinalScoring(state, command);
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
        step: "companyOperation.chooseStarterPass",
        actor: "system",
        visibility: "public",
        prompt:
          "All human families have passed starter Hiring. Confirm starter Company Operation.",
        legalCommands: [
          {
            type: "companyOperation.passOffice",
            label: "Confirm Company Operation",
            description: "Starter scaffold: records that Company Operation was skipped.",
            payload: {},
          },
        ],
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

function confirmLondonSeason(state: GameState, command: GameCommand): ApplyCommandResult {
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

function passCompanyOperation(state: GameState, command: GameCommand): ApplyCommandResult {
  if (
    state.phase !== "companyOperation" ||
    state.pendingDecision.step !== "companyOperation.chooseStarterPass"
  ) {
    return wrongPhase("Company Operation pass can only be chosen during starter Company Operation.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "companyOperation.passed",
    summary: "Starter Company Operation confirmed.",
    detailsNote:
      "Starter scaffold records the phase; office order and office actions come later.",
    nextDecision: createSystemDecision({
      id: `decision-bonuses-confirm-turn-${state.turn}`,
      phase: "bonuses",
      step: "bonuses.confirm",
      prompt: "Confirm starter Bonuses.",
      commandType: "bonuses.confirm",
      label: "Confirm Bonuses",
      description: "Starter scaffold: records that Bonuses were confirmed.",
    }),
  });
}

function confirmBonuses(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "bonuses" || state.pendingDecision.step !== "bonuses.confirm") {
    return wrongPhase("Bonuses confirmation can only be chosen during starter Bonuses.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "bonuses.confirmed",
    summary: "Starter Bonuses confirmed.",
    detailsNote: "Starter scaffold records the phase; workshop and shipyard income comes later.",
    nextDecision: createSystemDecision({
      id: `decision-revenue-confirm-turn-${state.turn}`,
      phase: "revenue",
      step: "revenue.confirm",
      prompt: "Confirm starter Revenue.",
      commandType: "revenue.confirm",
      label: "Confirm Revenue",
      description: "Starter scaffold: records that Revenue was confirmed.",
    }),
  });
}

function confirmRevenue(state: GameState, command: GameCommand): ApplyCommandResult {
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

function confirmEventsInIndia(state: GameState, command: GameCommand): ApplyCommandResult {
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

function confirmParliament(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "parliament" || state.pendingDecision.step !== "parliament.confirm") {
    return wrongPhase("Parliament confirmation can only be chosen during starter Parliament.");
  }

  return confirmStarterPhase({
    state,
    command,
    logType: "parliament.confirmed",
    summary: "Starter Parliament confirmed.",
    detailsNote:
      "Starter scaffold records the phase; law selection, policy, and voting come later.",
    nextDecision: createSystemDecision({
      id: `decision-upkeep-confirm-turn-${state.turn}`,
      phase: "upkeep",
      step: "upkeep.confirm",
      prompt: "Confirm starter Upkeep and Refresh.",
      commandType: "upkeep.confirm",
      label: "Confirm Upkeep",
      description: "Starter scaffold: records that Upkeep was confirmed.",
    }),
  });
}

function confirmUpkeep(state: GameState, command: GameCommand): ApplyCommandResult {
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

function confirmFinalScoring(state: GameState, command: GameCommand): ApplyCommandResult {
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

function confirmStarterPhase(input: {
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

function createSystemDecision(input: {
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

function firstHumanActor(state: GameState): ActorId | undefined {
  return state.seatingOrder.find((playerId) => !state.players[playerId].isCrown);
}

function noHumanActor(message: string): ApplyCommandResult {
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

function wrongPhase(message: string): ApplyCommandResult {
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
