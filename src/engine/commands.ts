import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  PendingDecision,
  ValidationError,
} from "./types";
import type { CommandHandler } from "./command-handler";
import { anytimeCommandHandlers } from "./phases/anytime";
import { bonusesCommandHandlers } from "./phases/bonuses";
import { companyOperationCommandHandlers } from "./phases/company-operation";
import { eventsInIndiaCommandHandlers } from "./phases/events-in-india";
import { familyCommandHandlers } from "./phases/family";
import { finalScoringCommandHandlers } from "./phases/final-scoring";
import { hiringCommandHandlers } from "./phases/hiring";
import { londonSeasonCommandHandlers } from "./phases/london-season";
import { negotiationCommandHandlers } from "./phases/negotiation";
import { blackmailCommandHandlers } from "./phases/negotiation-blackmail";
import { parliamentCommandHandlers } from "./phases/parliament";
import { revenueCommandHandlers } from "./phases/revenue";
import { setupCommandHandlers } from "./phases/setup";
import { upkeepCommandHandlers } from "./phases/upkeep";

// Each phase module owns its own command map, so phases can be built independently.
const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  ...setupCommandHandlers,
  ...londonSeasonCommandHandlers,
  ...familyCommandHandlers,
  ...hiringCommandHandlers,
  ...companyOperationCommandHandlers,
  ...bonusesCommandHandlers,
  ...revenueCommandHandlers,
  ...eventsInIndiaCommandHandlers,
  ...parliamentCommandHandlers,
  ...upkeepCommandHandlers,
  ...finalScoringCommandHandlers,
  ...negotiationCommandHandlers,
  ...blackmailCommandHandlers,
};

const KNOWN_COMMAND_TYPES = new Set([
  ...Object.keys(COMMAND_HANDLERS),
  ...Object.keys(anytimeCommandHandlers),
]);

export function isKnownCommandType(commandType: string): boolean {
  return KNOWN_COMMAND_TYPES.has(commandType);
}

export function isAnytimeCommandType(commandType: string): boolean {
  return commandType in anytimeCommandHandlers;
}

export function applyCommand(state: GameState, command: GameCommand): ApplyCommandResult {
  const anytimeHandler = anytimeCommandHandlers[command.type];
  if (anytimeHandler) {
    const errors = validateAnytimeCommand(state, command);
    return errors.length > 0 ? { ok: false, errors } : anytimeHandler(state, command);
  }

  const validationErrors = validateCommandEnvelope(state, command, {
    skipLegalCommandCheck: true,
  });
  if (validationErrors.length > 0) {
    return { ok: false, errors: validationErrors };
  }

  const handler = COMMAND_HANDLERS[command.type];
  if (!KNOWN_COMMAND_TYPES.has(command.type) || !handler) {
    return unknownCommand(command.type);
  }

  const legalCommandErrors = validateLegalCommandForDecision(state, command);
  if (legalCommandErrors.length > 0) {
    return { ok: false, errors: legalCommandErrors };
  }

  return handler(state, command);
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

function canActorAct(decision: PendingDecision, actorId: GameCommand["actorId"]): boolean {
  return (
    decision.actor === "simultaneous" ||
    decision.actor === actorId ||
    (decision.actor === "system" && actorId === "system")
  );
}

function validateAnytimeCommand(state: GameState, command: GameCommand): ValidationError[] {
  const errors: ValidationError[] = [];

  if (command.gameId !== state.gameId) {
    errors.push({
      code: "GAME_ID_MISMATCH",
      message: "Command gameId does not match the loaded game.",
      field: "gameId",
    });
  }

  if (!state.players[command.actorId]) {
    errors.push({
      code: "ACTOR_NOT_ALLOWED",
      message: `Only a player can take "${command.type}".`,
      field: "actorId",
    });
  }

  return errors;
}

function unknownCommand(commandType: string): ApplyCommandResult {
  return {
    ok: false,
    errors: [
      {
        code: "UNKNOWN_COMMAND",
        message: `Unknown command type "${commandType}".`,
        field: "type",
      },
    ],
  };
}
