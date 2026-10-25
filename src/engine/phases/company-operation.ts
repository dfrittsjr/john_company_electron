import type { CommandHandler } from "../command-handler";
import type { GameState, PendingDecision } from "../types";
import { chairmanStep, debtConsentStep } from "./company-operation/chairman";
import { chinaStep } from "./company-operation/china";
import { isListedCommand, officeLabel } from "./company-operation/context";
import { decideOperation, type SkipOfficePayload } from "./company-operation/decide";
import { directorStep } from "./company-operation/director-of-trade";
import { governorGeneralStep } from "./company-operation/governor-general";
import { interruptStep } from "./company-operation/interrupts";
import { militaryStep } from "./company-operation/military-affairs";
import {
  commanderCommandStep,
  governorCommandStep,
  presidencyStep,
  tradeCommandStep,
} from "./company-operation/presidency";
import { shippingStep } from "./company-operation/shipping";
import { finishOffice, type OperationStep } from "./company-operation/step";
import { createCommandLogEntry, wrongPhase } from "./shared";

// Company Operation (rulebook pp.17-26): each office acts in red-ribbon order. The office modules in
// ./company-operation/ build decisions and apply commands; this file wires them to the dispatcher.

/** The decision that starts or continues Company Operation; Hiring calls this when it ends. */
export function createNextCompanyOperationDecision(state: GameState): PendingDecision {
  return decideOperation({ ...state, phase: "companyOperation" });
}

const skipOfficeStep: OperationStep = (state, command) => {
  const { officeId } = command.payload as SkipOfficePayload;
  return { state: finishOffice(state, officeId), summary: `${officeLabel(officeId)} was vacant during Company Operation.` };
};

/** Validate, apply, log, and move on to the next decision. */
function operationCommand(step: OperationStep): CommandHandler {
  return (state, command) => {
    if (state.phase !== "companyOperation") {
      return wrongPhase("Company Operation commands can only be chosen during Company Operation.");
    }
    if (!isListedCommand(state, command)) {
      return {
        ok: false,
        errors: [
          {
            code: "ILLEGAL_COMPANY_OPERATION_CHOICE",
            message: "That Company Operation choice is not one of the listed legal commands.",
            field: "payload",
          },
        ],
      };
    }

    const result = step(state, command);
    const now = command.clientTimestamp;
    const logEntry = createCommandLogEntry({
      state: result.state,
      command,
      now,
      type: command.type,
      summary: result.summary,
      details: result.details,
      rngRolls: result.rngRolls,
    });
    const logged: GameState = { ...result.state, updatedAt: now, log: [...result.state.log, logEntry] };
    const pendingDecision = decideOperation(logged);

    return { ok: true, logEntry, state: { ...logged, phase: pendingDecision.phase, pendingDecision } };
  };
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const companyOperationCommandHandlers: Record<string, CommandHandler> = {
  "companyOperation.passOffice": operationCommand(skipOfficeStep),
  "companyOperation.chairman": operationCommand(chairmanStep),
  "companyOperation.resolveDebtConsent": operationCommand(debtConsentStep),
  "companyOperation.directorOfTrade": operationCommand(directorStep),
  "companyOperation.shipping": operationCommand(shippingStep),
  "companyOperation.militaryAffairs": operationCommand(militaryStep),
  "companyOperation.presidency": operationCommand(presidencyStep),
  "companyOperation.trade": operationCommand(tradeCommandStep),
  "companyOperation.commander": operationCommand(commanderCommandStep),
  "companyOperation.governor": operationCommand(governorCommandStep),
  "companyOperation.china": operationCommand(chinaStep),
  "companyOperation.governorGeneral": operationCommand(governorGeneralStep),
  "companyOperation.interrupt": operationCommand(interruptStep),
};
