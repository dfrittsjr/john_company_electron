import { offices } from "../../data";
import type { ApplyCommandResult, GameCommand, GameState, OfficeId, PendingDecision } from "../types";
import { confirmStarterPhase, createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

type CompanyOperationPassPayload = {
  officeId: OfficeId;
};

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

function isLegalPayload(state: GameState, payload: CompanyOperationPassPayload): boolean {
  return state.pendingDecision.legalCommands.some(
    (command) =>
      command.type === "companyOperation.passOffice" &&
      JSON.stringify(command.payload ?? {}) === JSON.stringify(payload),
  );
}
