import { offices } from "../../../data";
import { officeHolder } from "../../selectors";
import type { GameState, OfficeId, PendingDecision } from "../../types";
import { createSystemDecision } from "../shared";
import { chairmanDecision, debtConsentDecision } from "./chairman";
import { chinaDecision } from "./china";
import {
  CHINA_OFFICE_ID,
  GOVERNOR_GENERAL_OFFICE_ID,
  coState,
  decisionId,
  officeLabel,
  presidencyForPresidentOffice,
} from "./context";
import { directorDecision } from "./director-of-trade";
import { governorGeneralDecision } from "./governor-general";
import { interruptDecision } from "./interrupts";
import { militaryDecision } from "./military-affairs";
import { presidencyDecision, presidencyHasNothingToDo } from "./presidency";
import { shippingDecision } from "./shipping";

/** Red-ribbon order (p.17). With a Governor General in play it acts in the Director of Trade's slot. */
export function operationOffices(state: GameState): OfficeId[] {
  return offices
    .filter((office) => office.operationOrder !== undefined)
    .slice()
    .sort((left, right) => (left.operationOrder ?? 0) - (right.operationOrder ?? 0))
    .map((office) =>
      office.id === "director-of-trade" && state.company.governorGeneralInPlay ? GOVERNOR_GENERAL_OFFICE_ID : office.id,
    );
}

/** The next red-ribbon office to act. Offices not in play (China unopened, etc.) are passed over. */
export function nextOperationOffice(state: GameState): OfficeId | undefined {
  const acted = coState(state).actedOffices ?? [];
  return operationOffices(state).find(
    (officeId) => !acted.includes(officeId) && state.company.offices[officeId]?.created,
  );
}

/** Build the pending decision for wherever Company Operation currently stands. */
export function decideOperation(state: GameState): PendingDecision {
  const co = coState(state);
  if (co.interrupt) {
    return co.interrupt.kind === "debtConsent" ? debtConsentDecision(state) : interruptDecision(state, co.interrupt);
  }

  const current = co.current;
  if (current) {
    switch (current.office) {
      case "chairman":
        return chairmanDecision(state);
      case "director-of-trade":
        return directorDecision(state);
      case "military-affairs":
        return militaryDecision(state);
      case "presidency":
        return presidencyDecision(state, current.presidency);
      case "governor-general":
        return governorGeneralDecision(state);
    }
  }

  const officeId = nextOperationOffice(state);
  if (!officeId) return bonusesDecision(state);

  const presidency = presidencyForPresidentOffice(officeId);
  if (presidency) {
    return presidencyHasNothingToDo(state, presidency) ? skipDecision(state, officeId) : presidencyDecision(state, presidency);
  }
  if (!officeHolder(state, officeId)) return skipDecision(state, officeId);

  switch (officeId) {
    case "chairman":
      return chairmanDecision(state);
    case "director-of-trade":
      return directorDecision(state);
    case "manager-of-shipping":
      return shippingDecision(state);
    case "military-affairs":
      return militaryDecision(state);
    case CHINA_OFFICE_ID:
      return chinaDecision(state);
    case GOVERNOR_GENERAL_OFFICE_ID:
      return governorGeneralDecision(state);
    default:
      return skipDecision(state, officeId);
  }
}

export type SkipOfficePayload = { officeId: OfficeId };

function skipDecision(state: GameState, officeId: OfficeId): PendingDecision {
  return {
    id: decisionId(state, `company-operation-skip-${officeId}`),
    phase: "companyOperation",
    step: "companyOperation.skipOffice",
    actor: "system",
    visibility: "public",
    prompt: `${officeLabel(officeId)} is vacant and takes no actions (p.17).`,
    legalCommands: [
      {
        type: "companyOperation.passOffice",
        label: `Skip ${officeLabel(officeId)}`,
        description: "Vacant offices are skipped in red-ribbon order.",
        payload: { officeId } satisfies SkipOfficePayload,
      },
    ],
    canSave: true,
  };
}

function bonusesDecision(state: GameState): PendingDecision {
  return createSystemDecision({
    id: `decision-bonuses-confirm-turn-${state.turn}`,
    phase: "bonuses",
    step: "bonuses.confirm",
    prompt: "Company Operation is complete. Collect Bonuses.",
    commandType: "bonuses.confirm",
    label: "Collect Bonuses",
    description: "Every family takes £1 per workshop and per shipyard whose ship is fitted (p.27).",
  });
}
