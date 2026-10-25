import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  PendingDecision,
  ValidationError,
} from "./types";
import { MAX_COMPANY_DEBT } from "../data";
import type { CommandHandler } from "./command-handler";
import { familyPieceTotal } from "./selectors";
import { anytimeCommandHandlers } from "./phases/anytime";
import { bonusesCommandHandlers } from "./phases/bonuses";
import { companyOperationCommandHandlers } from "./phases/company-operation";
import { eventsInIndiaCommandHandlers } from "./phases/events-in-india";
import { familyCommandHandlers } from "./phases/family";
import { finalScoringCommandHandlers } from "./phases/final-scoring";
import { firmsCommandHandlers } from "./phases/firms";
import { hiringCommandHandlers } from "./phases/hiring";
import { londonSeasonCommandHandlers } from "./phases/london-season";
import { negotiationCommandHandlers, registerCommandDryRun } from "./phases/negotiation";
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
  ...firmsCommandHandlers,
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
    return errors.length > 0 ? { ok: false, errors } : guardResult(anytimeHandler(state, command));
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

  const resolved = withDefaultPayload(state, command);
  const legalCommandErrors = validateLegalCommandForDecision(state, resolved);
  if (legalCommandErrors.length > 0) {
    return { ok: false, errors: legalCommandErrors };
  }

  return guardResult(handler(state, resolved));
}

/** An empty payload picks the only offered option of that type, with that option's payload. */
function withDefaultPayload(state: GameState, command: GameCommand): GameCommand {
  if (!isEmptyPayload(command.payload)) return command;

  const sameType = state.pendingDecision.legalCommands.filter((legal) => legal.type === command.type);
  return sameType.length === 1 ? { ...command, payload: sameType[0].payload ?? {} } : command;
}

function isEmptyPayload(payload: unknown): boolean {
  return (
    payload === undefined ||
    payload === null ||
    (typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload as object).length === 0)
  );
}

/**
 * Last line of defence, checked after every command: nobody spends cash or pieces they don't have.
 * Players can never owe the bank (p.8, "cash always has a location"), the Company takes emergency
 * loans instead (p.27), office treasuries only spend what they hold, and each family's pieces are
 * always somewhere (18 per family, 36 for the Crown; p.2, p.43). A stale or buggy option is
 * rejected rather than corrupting the game.
 */
function guardResult(result: ApplyCommandResult): ApplyCommandResult {
  if (!result.ok) return result;

  const problems = resourceProblems(result.state);
  return problems.length === 0
    ? result
    : {
        ok: false,
        errors: problems.map((message) => ({ code: "INSUFFICIENT_RESOURCES", message })),
      };
}

export function resourceProblems(state: GameState): string[] {
  const problems: string[] = [];
  for (const player of Object.values(state.players)) {
    if (player.cash < 0) problems.push(`${player.name} would have £${player.cash}.`);
    const members = player.familyMembers;
    const counts: Array<[string, number]> = [
      ["family members in supply", members.supply],
      ["pensioners", members.pensioners],
      ["officers-in-training", members.officersInTraining],
      ...Object.entries(members.prizes).map(([prizeId, count]) => [`pieces on ${prizeId}`, count] as [string, number]),
    ];
    for (const [label, count] of counts) {
      if (count < 0) problems.push(`${player.name} would have ${count} ${label}.`);
    }
    const expected = player.isCrown ? 36 : 18;
    const total = familyPieceTotal(state, player.id);
    if (total !== expected) problems.push(`${player.name}'s family pieces would total ${total}, not ${expected}.`);
  }
  if (state.company.balance < 0) problems.push(`The Company Balance would be £${state.company.balance}.`);
  if (state.company.debt < 0 || state.company.debt > MAX_COMPANY_DEBT) {
    problems.push(`Company Debt would be ${state.company.debt}, off the Debt track.`);
  }
  for (const office of Object.values(state.company.offices)) {
    if (office.treasury < 0) problems.push(`The ${office.id} treasury would be £${office.treasury}.`);
  }
  return problems;
}

// Negotiation prunes stale options after anytime commands by trying each one (see
// refreshPendingDecision); it receives the handler lookup this way to avoid an import cycle.
registerCommandDryRun((state, command) => {
  const handler = COMMAND_HANDLERS[command.type];
  return handler ? guardResult(handler(state, command)) : unknownCommand(command.type);
});

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

/**
 * A command must be one of the pending decision's listed options, payload included: the engine
 * offers every choice as a complete command (docs/phase-build-guide.md), so anything else is either
 * stale or forged.
 */
function validateLegalCommandForDecision(
  state: GameState,
  command: GameCommand,
): ValidationError[] {
  const sameType = state.pendingDecision.legalCommands.filter((legal) => legal.type === command.type);
  if (sameType.length === 0) {
    return [
      {
        code: "ILLEGAL_COMMAND_FOR_DECISION",
        message: `Command "${command.type}" is not legal for decision "${state.pendingDecision.id}".`,
        field: "type",
      },
    ];
  }

  if (sameType.some((legal) => payloadsEqual(legal.payload, command.payload))) {
    return [];
  }

  return [
    {
      code: "ILLEGAL_PAYLOAD_FOR_DECISION",
      message: `That "${command.type}" choice is not one of the options offered for decision "${state.pendingDecision.id}".`,
      field: "payload",
    },
  ];
}

function payloadsEqual(legal: unknown, submitted: unknown): boolean {
  return deepEqual(legal ?? {}, submitted ?? {});
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set(
    [...Object.keys(leftRecord), ...Object.keys(rightRecord)].filter(
      (key) => leftRecord[key] !== undefined || rightRecord[key] !== undefined,
    ),
  );
  for (const key of keys) {
    if (!deepEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
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
