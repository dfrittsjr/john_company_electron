import { MAX_COMPANY_DEBT, offices } from "../../data";
import { COMPANY_TREASURY_OFFICE_IDS, companyShareCount } from "../selectors";
import type { ApplyCommandResult, GameCommand, GameState, OfficeId, PendingDecision } from "../types";
import { confirmStarterPhase, createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

type CompanyOperationPassPayload = {
  officeId: OfficeId;
};

type ChairmanOperationPayload = {
  officeId: "chairman";
  debtTaken: number;
  allocations: Record<OfficeId, number>;
};

type DebtConsentPayload = {
  accepted: boolean;
  operation: ChairmanOperationPayload;
};

// Chairman (p.18): each Debt advance adds £5. Up to three advances are free; each further advance
// needs consent from players holding a majority of Company shares (the Chairman counts as one).
const DEBT_PROCEEDS = 5;
const FREE_DEBT_ADVANCES = 3;

export function resolveChairmanOperation(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "companyOperation" || state.pendingDecision.step !== "companyOperation.resolveChairman") {
    return wrongPhase("Chairman operation can only be resolved during the Chairman Company Operation decision.");
  }

  const payload = parseChairmanPayload(command.payload);
  const validationError = payload ? validateChairmanPayload(state, payload) : "Chairman operation payload is invalid.";
  if (!payload || validationError) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_COMPANY_OPERATION_CHOICE",
          message: validationError || "Chairman operation payload is invalid.",
          field: "payload",
        },
      ],
    };
  }

  if (payload.debtTaken > FREE_DEBT_ADVANCES) {
    const now = command.clientTimestamp;
    const pendingDecision = createDebtConsentDecision(state, payload);
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "companyOperation.debtConsentRequested",
      summary: `The Chairman asked the Court to approve ${payload.debtTaken} Debt advances.`,
      details: { operation: payload, freeAdvances: FREE_DEBT_ADVANCES, companyShares: companyShareCount(state) },
    });

    return {
      ok: true,
      logEntry,
      state: { ...state, updatedAt: now, pendingDecision, log: [...state.log, logEntry] },
    };
  }

  return applyChairmanOperation(state, command, payload);
}

export function resolveChairmanDebtConsent(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "companyOperation" || state.pendingDecision.step !== "companyOperation.debtConsent") {
    return wrongPhase("Debt consent can only be resolved while the Court is voting on extra Debt.");
  }

  const payload = parseDebtConsentPayload(command.payload);
  if (!payload || !isLegalCommandPayload(state, "companyOperation.resolveDebtConsent", payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_COMPANY_OPERATION_CHOICE",
          message: "The requested debt consent response is not legal for this decision.",
          field: "payload",
        },
      ],
    };
  }

  if (payload.accepted) {
    return applyChairmanOperation(state, command, payload.operation, { debtConsent: "accepted" });
  }

  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "companyOperation.debtConsentDenied",
    summary: `The Court refused more than ${FREE_DEBT_ADVANCES} Debt advances.`,
    details: { operation: payload.operation },
  });
  const stateWithLog: GameState = { ...state, updatedAt: now, log: [...state.log, logEntry] };
  const pendingDecision = createChairmanDecision(stateWithLog, { debtConsentDenied: true });

  return { ok: true, logEntry, state: { ...stateWithLog, pendingDecision } };
}

function applyChairmanOperation(
  state: GameState,
  command: GameCommand,
  payload: ChairmanOperationPayload,
  options: { debtConsent?: "accepted" } = {},
): ApplyCommandResult {
  const startingBalance = state.company.balance;
  const debtProceeds = payload.debtTaken * DEBT_PROCEEDS;
  const allocatedTotal = Object.values(payload.allocations).reduce((total, amount) => total + amount, 0);
  const officesAfterAllocation = Object.entries(payload.allocations).reduce(
    (officesById, [officeId, amount]) => ({
      ...officesById,
      [officeId]: {
        ...officesById[officeId],
        treasury: officesById[officeId].treasury + amount,
      },
    }),
    state.company.offices,
  );
  const stateAfterChairman = markOfficeActed(
    {
      ...state,
      company: {
        ...state.company,
        balance: startingBalance + debtProceeds - allocatedTotal,
        debt: state.company.debt + payload.debtTaken,
        offices: officesAfterAllocation,
      },
    },
    "chairman",
  );
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: stateAfterChairman,
    command,
    now,
    type: "companyOperation.chairmanResolved",
    summary: `${state.players[command.actorId]?.name ?? command.actorId} resolved Chairman debt and allocation.`,
    details: {
      debtTaken: payload.debtTaken,
      debtProceeds,
      startingBalance,
      allocatedTotal,
      endingBalance: stateAfterChairman.company.balance,
      allocations: payload.allocations,
      debtConsent: options.debtConsent,
    },
  });
  const stateWithLog: GameState = {
    ...stateAfterChairman,
    updatedAt: now,
    log: [...stateAfterChairman.log, logEntry],
  };
  const pendingDecision = createNextCompanyOperationDecision(stateWithLog);

  return {
    ok: true,
    logEntry,
    state: {
      ...stateWithLog,
      phase: pendingDecision.phase,
      pendingDecision,
    },
  };
}

export function passCompanyOperation(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "companyOperation") {
    return wrongPhase("Company Operation commands can only be chosen during Company Operation.");
  }

  if (state.pendingDecision.step === "companyOperation.chooseStarterPass") {
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

  if (
    state.pendingDecision.step !== "companyOperation.passOffice" &&
    state.pendingDecision.step !== "companyOperation.skipOffice"
  ) {
    return wrongPhase("Company Operation office resolution is not pending.");
  }

  const payload = parsePassPayload(command.payload);
  if (!payload || !isLegalPayload(state, payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_COMPANY_OPERATION_CHOICE",
          message: "The requested Company Operation office action is not legal for this decision.",
          field: "payload.officeId",
        },
      ],
    };
  }

  const now = command.clientTimestamp;
  const isSkip = state.pendingDecision.step === "companyOperation.skipOffice";
  const stateAfterOffice = isSkip
    ? skipOfficeForTurn(state, payload.officeId)
    : markOfficeActed(state, payload.officeId);
  const officeName = officeLabel(payload.officeId);
  const holderId = state.company.offices[payload.officeId]?.holder;
  const holderName = holderId ? state.players[holderId]?.name : undefined;
  const logEntry = createCommandLogEntry({
    state: stateAfterOffice,
    command,
    now,
    type: isSkip ? "companyOperation.officeSkipped" : "companyOperation.officePassed",
    summary: isSkip
      ? `${officeName} was vacant during Company Operation.`
      : `${holderName ?? "Officeholder"} passed ${officeName}.`,
    details: {
      officeId: payload.officeId,
      note: isSkip
        ? "Vacant and uncreated offices are skipped in red-ribbon order."
        : "Temporary office fallback; detailed office actions come later.",
    },
  });
  const stateWithLog: GameState = {
    ...stateAfterOffice,
    updatedAt: now,
    log: [...stateAfterOffice.log, logEntry],
  };
  const pendingDecision = createNextCompanyOperationDecision(stateWithLog);

  return {
    ok: true,
    logEntry,
    state: {
      ...stateWithLog,
      phase: pendingDecision.phase,
      pendingDecision,
    },
  };
}

export function createNextCompanyOperationDecision(state: GameState): PendingDecision {
  const officeId = nextUnresolvedOperationOffice(state);
  if (!officeId) {
    return createSystemDecision({
      id: `decision-bonuses-confirm-turn-${state.turn}`,
      phase: "bonuses",
      step: "bonuses.confirm",
      prompt: "Company Operation is complete. Confirm starter Bonuses.",
      commandType: "bonuses.confirm",
      label: "Confirm Bonuses",
      description: "Starter scaffold: records that Bonuses were confirmed.",
    });
  }

  const office = state.company.offices[officeId];
  if (office?.created && !office.vacant && office.holder) {
    if (officeId === "chairman") {
      return createChairmanDecision(state);
    }

    return {
      id: `decision-company-operation-${officeId}-turn-${state.turn}`,
      phase: "companyOperation",
      step: "companyOperation.passOffice",
      actor: office.holder,
      visibility: "private",
      prompt: `Resolve ${officeLabel(officeId)}.`,
      legalCommands: [
        {
          type: "companyOperation.passOffice",
          label: `Pass ${officeLabel(officeId)}`,
          description: "Temporary fallback until this office's full action is implemented.",
          payload: { officeId } satisfies CompanyOperationPassPayload,
        },
      ],
      canSave: true,
    };
  }

  return {
    id: `decision-company-operation-skip-${officeId}-turn-${state.turn}`,
    phase: "companyOperation",
    step: "companyOperation.skipOffice",
    actor: "system",
    visibility: "public",
    prompt: `${officeLabel(officeId)} is vacant or not in play.`,
    legalCommands: [
      {
        type: "companyOperation.passOffice",
        label: `Skip ${officeLabel(officeId)}`,
        description: "Skip this vacant or uncreated office and continue Company Operation.",
        payload: { officeId } satisfies CompanyOperationPassPayload,
      },
    ],
    canSave: true,
  };
}

function nextUnresolvedOperationOffice(state: GameState): OfficeId | undefined {
  return operationOfficeIds().find((officeId) => !state.company.offices[officeId]?.actedThisTurn);
}

function operationOfficeIds(): OfficeId[] {
  return offices
    .filter((office) => office.operationOrder !== undefined)
    .slice()
    .sort((left, right) => (left.operationOrder ?? 0) - (right.operationOrder ?? 0))
    .map((office) => office.id);
}

function skipOfficeForTurn(state: GameState, officeId: OfficeId): GameState {
  const office = state.company.offices[officeId];

  return {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          treasury: office?.treasury ?? 0,
          fatigue: office?.fatigue ?? 0,
          created: office?.created ?? false,
          vacant: true,
          actedThisTurn: true,
        },
      },
    },
  };
}

function markOfficeActed(state: GameState, officeId: OfficeId): GameState {
  const office = state.company.offices[officeId];
  if (!office) return state;

  return {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          ...office,
          actedThisTurn: true,
        },
      },
    },
  };
}

function officeLabel(officeId: OfficeId): string {
  return offices.find((office) => office.id === officeId)?.label ?? officeId;
}

function parsePassPayload(payload: unknown): CompanyOperationPassPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { officeId?: unknown };
  if (typeof raw.officeId !== "string") return undefined;

  return { officeId: raw.officeId };
}

function parseChairmanPayload(payload: unknown): ChairmanOperationPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as {
    officeId?: unknown;
    debtTaken?: unknown;
    allocations?: unknown;
  };
  if (raw.officeId !== "chairman") return undefined;
  if (typeof raw.debtTaken !== "number" || !Number.isInteger(raw.debtTaken) || raw.debtTaken < 0) {
    return undefined;
  }
  const debtTaken = raw.debtTaken;
  if (!raw.allocations || typeof raw.allocations !== "object" || Array.isArray(raw.allocations)) {
    return undefined;
  }

  const allocations: Record<OfficeId, number> = {};
  for (const [officeId, amount] of Object.entries(raw.allocations)) {
    if (!Number.isInteger(amount) || amount < 0) return undefined;
    if (amount > 0) allocations[officeId] = amount;
  }

  return {
    officeId: "chairman",
    debtTaken,
    allocations,
  };
}

function createChairmanDecision(
  state: GameState,
  options: { debtConsentDenied?: boolean } = {},
): PendingDecision {
  const chairman = state.company.offices.chairman?.holder;
  const targets = treasuryOfficeIds(state);
  const defaultAllocations: Record<OfficeId, number> =
    state.company.balance > 0 && targets[0] ? { [targets[0]]: state.company.balance } : {};

  return {
    id: `decision-company-operation-chairman-turn-${state.turn}${options.debtConsentDenied ? "-after-refusal" : ""}`,
    phase: "companyOperation",
    step: "companyOperation.resolveChairman",
    actor: chairman ?? "system",
    visibility: "private",
    prompt: options.debtConsentDenied
      ? `The Court refused extra Debt. Take up to ${FREE_DEBT_ADVANCES} Debt, then allocate the whole Company Balance.`
      : "Take Company Debt if you wish, then allocate the whole Company Balance to office treasuries.",
    legalCommands: [
      {
        type: "companyOperation.resolveChairman",
        label: "Resolve Chairman",
        description: `Advance Debt (£${DEBT_PROCEEDS} each; more than ${FREE_DEBT_ADVANCES} needs Court consent; Debt cannot pass ${MAX_COMPANY_DEBT}), then allocate all of the Balance to: ${targets.join(", ")}.`,
        payload: {
          officeId: "chairman",
          debtTaken: 0,
          allocations: defaultAllocations,
        } satisfies ChairmanOperationPayload,
        payloadSchema: {
          maxDebtTaken: options.debtConsentDenied
            ? Math.min(FREE_DEBT_ADVANCES, MAX_COMPANY_DEBT - state.company.debt)
            : MAX_COMPANY_DEBT - state.company.debt,
          allocationTargets: targets,
        },
      },
    ],
    canSave: true,
  };
}

function createDebtConsentDecision(state: GameState, operation: ChairmanOperationPayload): PendingDecision {
  return {
    id: `decision-company-operation-debt-consent-turn-${state.turn}`,
    phase: "companyOperation",
    step: "companyOperation.debtConsent",
    actor: "system",
    visibility: "public",
    prompt: `Do players holding a majority of the ${companyShareCount(state)} Company shares consent to ${operation.debtTaken} Debt advances?`,
    legalCommands: [
      {
        type: "companyOperation.resolveDebtConsent",
        label: "Majority consents",
        description: `Advance Debt ${operation.debtTaken} times and apply the Chairman's allocation.`,
        payload: { accepted: true, operation } satisfies DebtConsentPayload,
      },
      {
        type: "companyOperation.resolveDebtConsent",
        label: "Majority refuses",
        description: `The Chairman chooses again with at most ${FREE_DEBT_ADVANCES} Debt advances.`,
        payload: { accepted: false, operation } satisfies DebtConsentPayload,
      },
    ],
    canSave: true,
  };
}

/** The Director of Trade's treasury is used by the Governor General once that office exists (p.26). */
function treasuryOfficeIds(state: GameState): OfficeId[] {
  return COMPANY_TREASURY_OFFICE_IDS.map((officeId) =>
    officeId === "director-of-trade" && state.company.governorGeneralInPlay ? "governor-general" : officeId,
  ).filter((officeId) => state.company.offices[officeId]?.created);
}

function parseDebtConsentPayload(payload: unknown): DebtConsentPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { accepted?: unknown; operation?: unknown };
  const operation = parseChairmanPayload(raw.operation);
  if (typeof raw.accepted !== "boolean" || !operation) return undefined;

  return { accepted: raw.accepted, operation };
}

function isLegalCommandPayload(state: GameState, type: string, payload: unknown): boolean {
  return state.pendingDecision.legalCommands.some(
    (command) => command.type === type && JSON.stringify(command.payload ?? {}) === JSON.stringify(payload),
  );
}

function validateChairmanPayload(
  state: GameState,
  payload: ChairmanOperationPayload,
): string | undefined {
  if (!state.pendingDecision.legalCommands.some((command) => command.type === "companyOperation.resolveChairman")) {
    return "Chairman operation is not legal for this decision.";
  }

  if (state.company.debt + payload.debtTaken > MAX_COMPANY_DEBT) {
    return `The Chairman may not advance Debt beyond the end of the track (${MAX_COMPANY_DEBT}).`;
  }

  const schema = state.pendingDecision.legalCommands.find(
    (command) => command.type === "companyOperation.resolveChairman",
  )?.payloadSchema as { maxDebtTaken?: number } | undefined;
  if (schema?.maxDebtTaken !== undefined && payload.debtTaken > schema.maxDebtTaken) {
    return `The Court refused extra Debt; take at most ${schema.maxDebtTaken} advances.`;
  }

  const availableBalance = state.company.balance + payload.debtTaken * DEBT_PROCEEDS;
  const allocatedTotal = Object.values(payload.allocations).reduce((total, amount) => total + amount, 0);
  if (allocatedTotal !== availableBalance) {
    return `The Chairman must allocate the whole Company Balance (£${availableBalance}); allocated £${allocatedTotal}.`;
  }

  const targets = treasuryOfficeIds(state);
  for (const officeId of Object.keys(payload.allocations)) {
    if (!targets.includes(officeId)) {
      return `"${officeId}" does not have a Company treasury the Chairman can fund.`;
    }
  }

  return undefined;
}

function isLegalPayload(state: GameState, payload: CompanyOperationPassPayload): boolean {
  return state.pendingDecision.legalCommands.some(
    (command) =>
      command.type === "companyOperation.passOffice" &&
      JSON.stringify(command.payload ?? {}) === JSON.stringify(payload),
  );
}
