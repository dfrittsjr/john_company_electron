import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  PendingDecision,
  ValidationError,
} from "./types";
import { confirmBonuses } from "./phases/bonuses";
import { passCompanyOperation, resolveChairmanOperation } from "./phases/company-operation";
import {
  confirmEventsInIndia,
  resolveRolledEventsInIndia,
} from "./phases/events-in-india";
import { chooseFamilyAction, finishFamilyAction } from "./phases/family";
import { confirmFinalScoring } from "./phases/final-scoring";
import {
  electChairman,
  hireOffice,
  passHiring,
  resolveNepotismConsent,
  skipHiringVacancy,
} from "./phases/hiring";
import { confirmLondonSeason } from "./phases/london-season";
import { confirmParliament } from "./phases/parliament";
import { chooseRevenueDividends, confirmRevenue } from "./phases/revenue";
import { confirmStart } from "./phases/setup";
import { confirmUpkeep } from "./phases/upkeep";

type CommandHandler = (state: GameState, command: GameCommand) => ApplyCommandResult;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  "setup.confirmStart": confirmStart,
  "londonSeason.confirm": confirmLondonSeason,
  "family.chooseAction": chooseFamilyAction,
  "family.finishAction": finishFamilyAction,
  "hiring.pass": passHiring,
  "hiring.electChairman": electChairman,
  "hiring.hireOffice": hireOffice,
  "hiring.resolveNepotismConsent": resolveNepotismConsent,
  "hiring.skipVacancy": skipHiringVacancy,
  "companyOperation.passOffice": passCompanyOperation,
  "companyOperation.resolveChairman": resolveChairmanOperation,
  "bonuses.confirm": confirmBonuses,
  "revenue.confirm": confirmRevenue,
  "revenue.chooseDividends": chooseRevenueDividends,
  "eventsInIndia.confirm": confirmEventsInIndia,
  "eventsInIndia.resolveRolledEvents": resolveRolledEventsInIndia,
  "parliament.confirm": confirmParliament,
  "upkeep.confirm": confirmUpkeep,
  "finalScoring.confirm": confirmFinalScoring,
};

const KNOWN_COMMAND_TYPES = new Set(Object.keys(COMMAND_HANDLERS));

export function applyCommand(state: GameState, command: GameCommand): ApplyCommandResult {
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
