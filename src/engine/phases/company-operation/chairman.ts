import { MAX_COMPANY_DEBT } from "../../../data";
import { COMPANY_TREASURY_OFFICE_IDS, chairmanHolder, clockwiseFrom, companyShareCount, companySharesByPlayer } from "../../selectors";
import type { GameCommand, GameState, LegalCommand, OfficeId, PendingDecision, PlayerId } from "../../types";
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
import { CROWN_PLAYER_ID, flipAiCard, isCrownGame } from "../../crown/state";
import { registerDecisionRefresher } from "../negotiation";

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

const PRESIDENT_OFFICE_IDS = ["president-bombay", "president-madras", "president-bengal"];

/** Giving away the rest of the Balance would leave these seated Presidents with nothing to Trade with. */
function emptyPresidentsWarning(state: GameState, officeId: OfficeId): string | undefined {
  const empty = PRESIDENT_OFFICE_IDS.filter((id) => {
    const office = state.company.offices[id];
    return id !== officeId && office && !office.vacant && office.holder && office.treasury === 0;
  });
  if (empty.length === 0) return undefined;
  return `Warning: this leaves ${empty.map(officeLabel).join(" and ")} with £0, so ${empty.length === 1 ? "that President" : "those Presidents"} can't Trade.`;
}

/**
 * The amounts the Chairman may give one office. In a Crown game the Crown Handbook's priority lists
 * need every amount (£4 to a Presidency, whatever remains), and a human Chairman may give the £4
 * that earns a promise cube (pp.4-5).
 */
function allocationAmounts(state: GameState, balance: number): number[] {
  if (isCrownGame(state) && chairmanHolder(state) === CROWN_PLAYER_ID) {
    return Array.from({ length: balance }, (_, index) => index + 1);
  }
  const amounts = [1, 2, 3, 5, 10, balance, ...(isCrownGame(state) ? [4] : [])];
  return [...new Set(amounts)].filter((amount) => amount <= balance).sort((a, b) => a - b);
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
      const amounts = allocationAmounts(state, balance);
      for (const amount of amounts) {
        commands.push({
          type: "companyOperation.chairman",
          label: amount === balance ? `Give all £${amount} to ${officeLabel(officeId)}` : `Give £${amount} to ${officeLabel(officeId)}`,
          description: amount === balance ? emptyPresidentsWarning(state, officeId) : undefined,
          payload: { action: "allocate", officeId, amount } satisfies ChairmanPayload,
        });
      }
    }
  } else {
    commands.unshift({
      type: "companyOperation.chairman",
      label: "Finish as Chairman",
      description:
        isCrownGame(state) && chairmanHolder(state) !== CROWN_PLAYER_ID
          ? "The whole Company Balance has been allocated. You pay the Crown 1 promise cube, if you have one, and a new AI card sets its climate (Crown Handbook p.4)."
          : "The whole Company Balance has been allocated.",
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
      const tally = consentTally(state);
      if (tally.consenting >= tally.majority) {
        const result = advanceDebt(state, current);
        return { ...result, summary: `The Chairman's own shares are a majority of the ${tally.total} Company shares. ${result.summary}` };
      }
      if (tally.pending.length === 0) {
        return {
          state: withCo(state, { current: { ...current, consentRefused: true } }),
          summary: "No other shareholder can make a majority: no further Debt advances this turn.",
        };
      }
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
    const allocated = isCrownGame(state)
      ? { ...current, allocated: { ...current.allocated, [payload.officeId]: (current.allocated?.[payload.officeId] ?? 0) + payload.amount } }
      : current;
    return {
      state: withCo(next, { current: allocated }),
      summary: `The Chairman gave £${payload.amount} to ${officeLabel(payload.officeId)}.`,
      details: { officeId: payload.officeId, amount: payload.amount, balanceLeft: next.company.balance },
    };
  }

  // Handbook p.4: a human Chairman, "after you have finished acting, flip a new AI card and set the
  // climate". It happens in this command, so nothing can change before the new climate is known.
  // (A Crown Chairman flips before it acts: beginCompanyOperation.)
  const finished = finishOffice(state, "chairman");
  const flip = isCrownGame(state) && chairmanHolder(state) !== CROWN_PLAYER_ID;
  return {
    state: flip ? flipAiCard(finished, command.clientTimestamp) : finished,
    summary: `The Chairman finished (${current.debtAdvances} Debt advance${current.debtAdvances === 1 ? "" : "s"}).`,
    details: { debtAdvances: current.debtAdvances },
  };
};

// A favour can take money out of the Company Balance under the Crown Chairman's decision (p.5).
registerDecisionRefresher("companyOperation.chairman", (state) => ({
  ...chairmanDecision(state),
  id: state.pendingDecision.id,
}));

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

type ConsentTally = { pending: PlayerId[]; consenting: number; refusing: number; total: number; majority: number };

/**
 * Chairman Debt (p.18): "the consent of players who control a majority of Company shares". The
 * Chairman's own shares count as consent; the other shareholders are asked in turn from the
 * Chairman's left (Family/Hiring order for nepotism), until a majority has consented or can no
 * longer be reached.
 */
function consentTally(state: GameState): ConsentTally {
  const interrupt = coState(state).interrupt;
  const open = interrupt?.kind === "debtConsent" ? interrupt : { kind: "debtConsent" as const };
  const chairman = chairmanHolder(state);
  const counts = companySharesByPlayer(state);
  const total = companyShareCount(state);
  const order = clockwiseFrom(state, chairman).filter((playerId) => playerId !== chairman && (counts.get(playerId) ?? 0) > 0);
  return {
    pending: open.pending ?? order,
    consenting: open.consenting ?? (chairman ? (counts.get(chairman) ?? 0) : 0),
    refusing: open.refusing ?? 0,
    total,
    majority: Math.floor(total / 2) + 1,
  };
}

export function debtConsentDecision(state: GameState): PendingDecision {
  const tally = consentTally(state);
  const asked = tally.pending[0];
  const shares = asked ? (companySharesByPlayer(state).get(asked) ?? 0) : 0;
  const askedName = asked ? (state.players[asked]?.name ?? asked) : "system";
  return {
    id: decisionId(state, `company-operation-debt-consent-${asked ?? "none"}`),
    phase: "companyOperation",
    step: "companyOperation.debtConsent",
    actor: asked ?? "system",
    visibility: "public",
    prompt: `${askedName}: do you consent to another Company Debt advance? You hold ${shares} of ${tally.total} Company shares; a majority (${tally.majority}) must consent, with ${tally.consenting} consenting so far (the Chairman's own count).`,
    legalCommands: [
      {
        type: "companyOperation.resolveDebtConsent",
        label: "Consent to the Debt advance",
        payload: { accepted: true } satisfies DebtConsentPayload,
      },
      {
        type: "companyOperation.resolveDebtConsent",
        label: "Refuse",
        description: "A refusal may end the request if a majority is no longer possible.",
        payload: { accepted: false } satisfies DebtConsentPayload,
      },
    ],
    canSave: true,
  };
}

export const debtConsentStep: OperationStep = (state, command: GameCommand) => {
  const payload = command.payload as DebtConsentPayload;
  const current = progress(state);
  const tally = consentTally(state);
  const asked = tally.pending[0];
  const shares = asked ? (companySharesByPlayer(state).get(asked) ?? 0) : 0;
  const consenting = tally.consenting + (payload.accepted ? shares : 0);
  const refusing = tally.refusing + (payload.accepted ? 0 : shares);
  const remaining = tally.pending.slice(1);
  const askedName = asked ? (state.players[asked]?.name ?? asked) : "The Court";
  const answer = `${askedName} ${payload.accepted ? "consented to" : "refused"} the Debt advance (${shares} share${shares === 1 ? "" : "s"}).`;

  if (consenting >= tally.majority) {
    const result = advanceDebt(state, current);
    return { ...result, summary: `${answer} A majority of Company shares consented. ${result.summary}` };
  }
  if (tally.total - refusing < tally.majority || remaining.length === 0) {
    return {
      state: withCo(state, { current: { ...current, consentRefused: true }, interrupt: undefined }),
      summary: `${answer} A majority of Company shares cannot consent: no further Debt advances this turn.`,
    };
  }
  return {
    state: withCo(state, { current, interrupt: { kind: "debtConsent", pending: remaining, consenting, refusing } }),
    summary: answer,
  };
};
