import { MAX_COMPANY_DEBT } from "../../../data";
import { COMPANY_TREASURY_OFFICE_IDS, chairmanHolder, companyShareCount } from "../../selectors";
import type { GameCommand, GameState, LegalCommand, OfficeId, PendingDecision } from "../../types";
import type { OfficeProgress } from "../company-operation.state";
import {
  GOVERNOR_GENERAL_OFFICE_ID,
  coState,
  decisionId,
  officeLabel,
  withCo,
} from "./context";
import type { OperationStep } from "./step";
import { finishOffice } from "./step";

// Chairman (p.18): may advance Debt (+£5 each; three freely, each further advance needs consent from
// players holding a majority of Company shares, Chairman included; never past the end of the track),
// then must allocate the whole Company Balance to other offices' treasuries.

const DEBT_PROCEEDS = 5;
const FREE_DEBT_ADVANCES = 3;

type ChairmanProgress = Extract<OfficeProgress, { office: "chairman" }>;

export type ChairmanPayload =
  | { action: "debt" }
  | { action: "allocate"; officeId: OfficeId; amount: number }
  | { action: "finish" };

function progress(state: GameState): ChairmanProgress {
  const current = coState(state).current;
  return current?.office === "chairman" ? current : { office: "chairman", debtAdvances: 0, consentRefused: false };
}

/** The Director of Trade's treasury is the Governor General's once that office exists (p.26). */
export function chairmanAllocationTargets(state: GameState): OfficeId[] {
  return COMPANY_TREASURY_OFFICE_IDS.map((officeId) =>
    officeId === "director-of-trade" && state.company.governorGeneralInPlay ? GOVERNOR_GENERAL_OFFICE_ID : officeId,
  ).filter((officeId) => state.company.offices[officeId]?.created);
}

function canAdvanceDebt(state: GameState, current: ChairmanProgress): boolean {
  if (state.company.debt >= MAX_COMPANY_DEBT) return false;
  return current.debtAdvances < FREE_DEBT_ADVANCES || !current.consentRefused;
}

export function chairmanDecision(state: GameState): PendingDecision {
  const current = progress(state);
  const balance = state.company.balance;
  const commands: LegalCommand[] = [];

  if (canAdvanceDebt(state, current)) {
    const needsConsent = current.debtAdvances >= FREE_DEBT_ADVANCES;
    commands.push({
      type: "companyOperation.chairman",
      label: needsConsent ? "Ask the Court for another Debt advance (+£5)" : "Advance Company Debt (+£5)",
      description: needsConsent
        ? `Debt advances after the first ${FREE_DEBT_ADVANCES} need consent from players holding a majority of Company shares.`
        : `Debt ${state.company.debt} → ${state.company.debt + 1}; the Company Balance gains £${DEBT_PROCEEDS}.`,
      payload: { action: "debt" } satisfies ChairmanPayload,
    });
  }

  if (balance > 0) {
    for (const officeId of chairmanAllocationTargets(state)) {
      const amounts = [...new Set([1, Math.min(5, balance), balance])].filter((amount) => amount <= balance);
      for (const amount of amounts) {
        commands.push({
          type: "companyOperation.chairman",
          label: amount === balance ? `Give all £${amount} to ${officeLabel(officeId)}` : `Give £${amount} to ${officeLabel(officeId)}`,
          payload: { action: "allocate", officeId, amount } satisfies ChairmanPayload,
        });
      }
    }
  } else {
    commands.unshift({
      type: "companyOperation.chairman",
      label: "Finish as Chairman",
      description: "The whole Company Balance has been allocated.",
      payload: { action: "finish" } satisfies ChairmanPayload,
    });
  }

  return {
    id: decisionId(state, "company-operation-chairman"),
    phase: "companyOperation",
    step: "companyOperation.chairman",
    actor: chairmanHolder(state) ?? "system",
    visibility: "public",
    prompt:
      balance > 0
        ? `Chairman: allocate the Company Balance (£${balance} left) to office treasuries. You may also advance Debt.`
        : "Chairman: advance Company Debt if you wish, then finish.",
    legalCommands: commands,
    canSave: true,
  };
}

export const chairmanStep: OperationStep = (state, command) => {
  const payload = command.payload as ChairmanPayload;
  const current = progress(state);

  if (payload.action === "debt") {
    if (current.debtAdvances >= FREE_DEBT_ADVANCES) {
      return {
        state: withCo(state, { current, interrupt: { kind: "debtConsent" } }),
        summary: `The Chairman asked the Court to approve Debt advance ${current.debtAdvances + 1}.`,
        details: { companyShares: companyShareCount(state) },
      };
    }
    return advanceDebt(state, current);
  }

  if (payload.action === "allocate") {
    const office = state.company.offices[payload.officeId];
    const next: GameState = {
      ...state,
      company: {
        ...state.company,
        balance: state.company.balance - payload.amount,
        offices: { ...state.company.offices, [payload.officeId]: { ...office, treasury: office.treasury + payload.amount } },
      },
    };
    return {
      state: withCo(next, { current }),
      summary: `The Chairman gave £${payload.amount} to ${officeLabel(payload.officeId)}.`,
      details: { officeId: payload.officeId, amount: payload.amount, balanceLeft: next.company.balance },
    };
  }

  return {
    state: finishOffice(state, "chairman"),
    summary: `The Chairman finished (${current.debtAdvances} Debt advance${current.debtAdvances === 1 ? "" : "s"}).`,
    details: { debtAdvances: current.debtAdvances },
  };
};

function advanceDebt(state: GameState, current: ChairmanProgress) {
  const next: GameState = {
    ...state,
    company: {
      ...state.company,
      debt: state.company.debt + 1,
      balance: state.company.balance + DEBT_PROCEEDS,
    },
  };
  return {
    state: withCo(next, { current: { ...current, debtAdvances: current.debtAdvances + 1 }, interrupt: undefined }),
    summary: `The Chairman advanced Company Debt to ${next.company.debt} (+£${DEBT_PROCEEDS}).`,
    details: { debt: next.company.debt, balance: next.company.balance },
  };
}

export type DebtConsentPayload = { accepted: boolean };

export function debtConsentDecision(state: GameState): PendingDecision {
  return {
    id: decisionId(state, "company-operation-debt-consent"),
    phase: "companyOperation",
    step: "companyOperation.debtConsent",
    actor: "system",
    visibility: "public",
    prompt: `Do players holding a majority of the ${companyShareCount(state)} Company shares (the Chairman counts) consent to another Debt advance?`,
    legalCommands: [
      {
        type: "companyOperation.resolveDebtConsent",
        label: "Majority consents",
        payload: { accepted: true } satisfies DebtConsentPayload,
      },
      {
        type: "companyOperation.resolveDebtConsent",
        label: "Majority refuses",
        description: "No further Debt advances this turn.",
        payload: { accepted: false } satisfies DebtConsentPayload,
      },
    ],
    canSave: true,
  };
}

export const debtConsentStep: OperationStep = (state, command: GameCommand) => {
  const payload = command.payload as DebtConsentPayload;
  const current = progress(state);
  if (payload.accepted) {
    const result = advanceDebt(state, current);
    return { ...result, summary: `The Court consented. ${result.summary}` };
  }

  return {
    state: withCo(state, { current: { ...current, consentRefused: true }, interrupt: undefined }),
    summary: "The Court refused another Debt advance.",
  };
};
