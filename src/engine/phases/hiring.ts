import { offices } from "../../data";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  LegalCommand,
  OfficeId,
  PendingDecision,
  PlayerId,
  ShareInstance,
} from "../types";
import { createNextCompanyOperationDecision } from "./company-operation";
import { createCommandLogEntry, createStarterHiringCommands } from "./shared";

type ChairmanElectionPayload = {
  officeId: "chairman";
  candidateId: PlayerId;
};

type SkipHiringVacancyPayload = {
  officeId: OfficeId;
};

type WriterHireOfficePayload = {
  officeId: OfficeId;
  candidateId: PlayerId;
  source: {
    type: "writer";
    presidency: "Bombay" | "Madras" | "Bengal";
  };
};

type PromotionHireOfficePayload = {
  officeId: OfficeId;
  candidateId: PlayerId;
  source: {
    type: "office";
    officeId: OfficeId;
  };
};

type HireOfficePayload = WriterHireOfficePayload | PromotionHireOfficePayload;

const CHAIRMAN_HIRES_WRITER_OFFICES = new Set<OfficeId>([
  "manager-of-shipping",
  "superintendent-of-trade-in-china",
]);

export function createNextHiringDecision(state: GameState): PendingDecision {
  const officeId = nextVacantOfficeId(state);
  if (!officeId) return createCompanyOperationStartDecision(state);

  if (officeId === "chairman") {
    const legalCommands = createChairmanElectionCommands(state);
    if (legalCommands.length > 0) {
      return {
        id: `decision-hiring-elect-chairman-turn-${state.turn}`,
        phase: "hiring",
        step: "hiring.electChairman",
        actor: "system",
        visibility: "public",
        prompt: "Elect the Chairman from the Company-share majority.",
        legalCommands,
        canSave: true,
      };
    }
  }

  const hireCommands = createHireOfficeCommands(state, officeId);
  if (hireCommands.length > 0) {
    return {
      id: `decision-hiring-hire-${officeId}-turn-${state.turn}`,
      phase: "hiring",
      step: "hiring.hireOffice",
      actor: state.company.offices.chairman?.holder ?? "system",
      visibility: "private",
      prompt: `Choose a candidate for ${officeLabel(officeId)}.`,
      legalCommands: hireCommands,
      canSave: true,
    };
  }

  return {
    id: `decision-hiring-skip-${officeId}-turn-${state.turn}`,
    phase: "hiring",
    step: "hiring.skipVacancy",
    actor: "system",
    visibility: "public",
    prompt: `No implemented hirer or eligible candidate is available for ${officeLabel(officeId)}.`,
    legalCommands: [
      {
        type: "hiring.skipVacancy",
        label: `Skip ${officeLabel(officeId)}`,
        description: "Leave this office vacant for the turn and continue Hiring.",
        payload: { officeId } satisfies SkipHiringVacancyPayload,
      },
    ],
    canSave: true,
  };
}

export function passHiring(state: GameState, command: GameCommand): ApplyCommandResult {
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

export function electChairman(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "hiring" || state.pendingDecision.step !== "hiring.electChairman") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Chairman election can only be resolved during the Hiring phase.",
          field: "phase",
        },
      ],
    };
  }

  const payload = parseChairmanElectionPayload(command.payload);
  if (!payload) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_PAYLOAD",
          message: "Chairman election requires a candidate id.",
          field: "payload.candidateId",
        },
      ],
    };
  }

  if (!isLegalPayload(state, "hiring.electChairman", payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_HIRING_CHOICE",
          message: `Player "${payload.candidateId}" is not a legal Chairman candidate for this decision.`,
          field: "payload.candidateId",
        },
      ],
    };
  }

  const candidate = state.players[payload.candidateId];
  const now = command.clientTimestamp;
  const stateAfterElection = assignChairman(state, payload.candidateId);
  const logEntry = createCommandLogEntry({
    state: stateAfterElection,
    command,
    now,
    type: "hiring.chairmanElected",
    summary: `${candidate.name} was elected Chairman.`,
    details: {
      candidateId: payload.candidateId,
      majorityShareCount: shareCountsByPlayer(state).get(payload.candidateId) ?? 0,
      totalShares: totalCompanyShares(state),
    },
  });
  const stateWithLog: GameState = {
    ...stateAfterElection,
    updatedAt: now,
    log: [...stateAfterElection.log, logEntry],
  };

  const pendingDecision = createNextHiringDecision(stateWithLog);

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

export function skipHiringVacancy(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "hiring" || state.pendingDecision.step !== "hiring.skipVacancy") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Hiring vacancies can only be skipped during the Hiring phase.",
          field: "phase",
        },
      ],
    };
  }

  const payload = parseSkipHiringVacancyPayload(command.payload);
  if (!payload || !isLegalPayload(state, "hiring.skipVacancy", payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_HIRING_CHOICE",
          message: "The requested Hiring vacancy cannot be skipped for this decision.",
          field: "payload.officeId",
        },
      ],
    };
  }

  const now = command.clientTimestamp;
  const stateAfterSkip = removeOfficeFromHiringQueue(state, payload.officeId);
  const logEntry = createCommandLogEntry({
    state: stateAfterSkip,
    command,
    now,
    type: "hiring.vacancySkipped",
    summary: `${officeLabel(payload.officeId)} remained vacant.`,
    details: {
      officeId: payload.officeId,
      note: "No implemented hirer or eligible candidate was available.",
    },
  });
  const stateWithLog: GameState = {
    ...stateAfterSkip,
    updatedAt: now,
    log: [...stateAfterSkip.log, logEntry],
  };

  const pendingDecision = createNextHiringDecision(stateWithLog);

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

export function hireOffice(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "hiring" || state.pendingDecision.step !== "hiring.hireOffice") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Office hires can only be resolved during the Hiring phase.",
          field: "phase",
        },
      ],
    };
  }

  const payload = parseHireOfficePayload(command.payload);
  if (!payload || !isLegalPayload(state, "hiring.hireOffice", payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_HIRING_CHOICE",
          message: "The requested office hire is not legal for this decision.",
          field: "payload",
        },
      ],
    };
  }

  const candidate = state.players[payload.candidateId];
  const now = command.clientTimestamp;
  const stateAfterHire = moveCandidateToOffice(state, payload);
  const logEntry = createCommandLogEntry({
    state: stateAfterHire,
    command,
    now,
    type: "hiring.officeHired",
    summary: `${candidate.name} filled ${officeLabel(payload.officeId)}.`,
    details: payload,
  });
  const stateWithLog: GameState = {
    ...stateAfterHire,
    updatedAt: now,
    log: [...stateAfterHire.log, logEntry],
  };
  const pendingDecision = createNextHiringDecision(stateWithLog);

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

function createCompanyOperationStartDecision(state: GameState): PendingDecision {
  return createNextCompanyOperationDecision({
    ...state,
    phase: "companyOperation",
  });
}

function nextVacantOfficeId(state: GameState): OfficeId | undefined {
  return state.company.vacantOffices
    .filter((officeId) => state.company.offices[officeId]?.vacant)
    .sort(compareHiringOfficeOrder)[0];
}

function compareHiringOfficeOrder(left: OfficeId, right: OfficeId): number {
  return hiringOfficeOrder(left) - hiringOfficeOrder(right);
}

function hiringOfficeOrder(officeId: OfficeId): number {
  if (officeId === "chairman") return 0;

  const definition = offices.find((office) => office.id === officeId);
  return definition?.operationOrder ?? Number.MAX_SAFE_INTEGER;
}

function officeLabel(officeId: OfficeId): string {
  return offices.find((office) => office.id === officeId)?.label ?? officeId;
}

function createChairmanElectionCommands(state: GameState): LegalCommand[] {
  const totalShares = totalCompanyShares(state);
  if (totalShares <= 0) return [];

  const requiredShares = Math.floor(totalShares / 2) + 1;
  const counts = shareCountsByPlayer(state);
  return [...counts.entries()]
    .filter(([playerId, shareCount]) => shareCount >= requiredShares && !state.players[playerId]?.isCrown)
    .map(([candidateId, shareCount]) => ({
      type: "hiring.electChairman",
      label: `Elect ${state.players[candidateId].name} Chairman`,
      description: `${state.players[candidateId].name} controls ${shareCount} of ${totalShares} Company shares.`,
      payload: {
        officeId: "chairman",
        candidateId,
      } satisfies ChairmanElectionPayload,
    }));
}

function createHireOfficeCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  if (officeId === "director-of-trade") {
    return createDirectorOfTradeHireCommands(state);
  }

  if (!CHAIRMAN_HIRES_WRITER_OFFICES.has(officeId)) return [];

  const chairmanId = state.company.offices.chairman?.holder;
  if (!chairmanId || state.company.offices.chairman.vacant) return [];

  return createWriterHireCommands(state, officeId, chairmanId);
}

function createWriterHireCommands(
  state: GameState,
  officeId: OfficeId,
  excludedPlayerId?: PlayerId,
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const player of Object.values(state.players)) {
    if (player.isCrown || player.id === excludedPlayerId) continue;

    for (const presidency of ["Bombay", "Madras", "Bengal"] as const) {
      const writerCount = player.familyMembers.writers[presidency] ?? 0;
      if (writerCount <= 0) continue;

      commands.push({
        type: "hiring.hireOffice",
        label: `Hire ${player.name} ${presidency} writer`,
        description: `Move one ${player.name} writer from ${presidency} to ${officeLabel(officeId)}.`,
        payload: {
          officeId,
          candidateId: player.id,
          source: {
            type: "writer",
            presidency,
          },
        } satisfies HireOfficePayload,
      });
    }
  }

  return commands;
}

function createDirectorOfTradeHireCommands(state: GameState): LegalCommand[] {
  const chairmanId = state.company.offices.chairman?.holder;
  if (!chairmanId || state.company.offices.chairman.vacant) return [];

  const promotionCommands: LegalCommand[] = [];
  for (const office of Object.values(state.company.offices)) {
    if (
      office.vacant ||
      !office.holder ||
      office.id === "chairman" ||
      office.id === "director-of-trade" ||
      office.holder === chairmanId ||
      isGovernorOffice(office.id)
    ) {
      continue;
    }

    const candidate = state.players[office.holder];
    if (!candidate || candidate.isCrown) continue;

    promotionCommands.push({
      type: "hiring.hireOffice",
      label: `Promote ${candidate.name} from ${officeLabel(office.id)}`,
      description: `Move ${candidate.name}'s officeholder from ${officeLabel(office.id)} to Director of Trade.`,
      payload: {
        officeId: "director-of-trade",
        candidateId: candidate.id,
        source: {
          type: "office",
          officeId: office.id,
        },
      } satisfies HireOfficePayload,
    });
  }

  if (promotionCommands.length > 0) return promotionCommands;

  return createWriterHireCommands(state, "director-of-trade", chairmanId);
}

function isGovernorOffice(officeId: OfficeId): boolean {
  return offices.find((office) => office.id === officeId)?.category === "governor";
}

function totalCompanyShares(state: GameState): number {
  return state.company.court.length + Object.values(state.players).filter((player) => player.familyMembers.chairmanShare).length;
}

function shareCountsByPlayer(state: GameState): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const share of state.company.court) {
    if (!share.owner) continue;
    counts.set(share.owner, (counts.get(share.owner) ?? 0) + 1);
  }

  for (const player of Object.values(state.players)) {
    if (player.familyMembers.chairmanShare) {
      counts.set(player.id, (counts.get(player.id) ?? 0) + 1);
    }
  }

  return counts;
}

function assignChairman(state: GameState, candidateId: PlayerId): GameState {
  const candidateShare = state.company.court.find((share) => share.owner === candidateId);
  const court = candidateShare
    ? removeShare(state.company.court, candidateShare.id)
    : state.company.court;
  const players = Object.fromEntries(
    Object.entries(state.players).map(([playerId, player]) => [
      playerId,
      {
        ...player,
        familyMembers: {
          ...player.familyMembers,
          courtShares:
            playerId === candidateId && candidateShare
              ? Math.max(0, player.familyMembers.courtShares - 1)
              : player.familyMembers.courtShares,
          chairmanShare: playerId === candidateId,
          offices:
            playerId === candidateId
              ? [...new Set([...player.familyMembers.offices, "chairman"])]
              : player.familyMembers.offices.filter((officeId) => officeId !== "chairman"),
        },
      },
    ]),
  );

  return {
    ...state,
    players,
    company: {
      ...state.company,
      court,
      offices: {
        ...state.company.offices,
        chairman: {
          id: "chairman",
          treasury: state.company.offices.chairman?.treasury ?? 0,
          fatigue: state.company.offices.chairman?.fatigue ?? 0,
          created: true,
          vacant: false,
          actedThisTurn: false,
          holder: candidateId,
          familyMemberId: candidateShare?.id ?? `chairman-share-${state.turn}-${candidateId}`,
        },
      },
      vacantOffices: state.company.vacantOffices.filter((officeId) => officeId !== "chairman"),
    },
  };
}

function removeShare(shares: ShareInstance[], shareId: string): ShareInstance[] {
  let removed = false;
  return shares.filter((share) => {
    if (!removed && share.id === shareId) {
      removed = true;
      return false;
    }

    return true;
  });
}

function removeOfficeFromHiringQueue(state: GameState, officeId: OfficeId): GameState {
  return {
    ...state,
    company: {
      ...state.company,
      vacantOffices: state.company.vacantOffices.filter((candidate) => candidate !== officeId),
    },
  };
}

function moveCandidateToOffice(state: GameState, payload: HireOfficePayload): GameState {
  if (isPromotionHirePayload(payload)) {
    return promoteOfficeholderToOffice(state, payload);
  }

  return moveWriterToOffice(state, payload);
}

function isPromotionHirePayload(payload: HireOfficePayload): payload is PromotionHireOfficePayload {
  return payload.source.type === "office";
}

function moveWriterToOffice(
  state: GameState,
  payload: WriterHireOfficePayload,
): GameState {
  const candidate = state.players[payload.candidateId];
  const presidency = payload.source.presidency;
  const currentPlayerWriterCount = candidate.familyMembers.writers[presidency] ?? 0;
  const currentPresidencyWriterCount = state.india.presidencies[presidency].writers[payload.candidateId] ?? 0;

  return {
    ...state,
    players: {
      ...state.players,
      [payload.candidateId]: {
        ...candidate,
        familyMembers: {
          ...candidate.familyMembers,
          writers: {
            ...candidate.familyMembers.writers,
            [presidency]: Math.max(0, currentPlayerWriterCount - 1),
          },
          offices: [...new Set([...candidate.familyMembers.offices, payload.officeId])],
        },
      },
    },
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [payload.officeId]: {
          id: payload.officeId,
          treasury: state.company.offices[payload.officeId]?.treasury ?? 0,
          fatigue: state.company.offices[payload.officeId]?.fatigue ?? 0,
          created: true,
          vacant: false,
          actedThisTurn: false,
          holder: payload.candidateId,
          familyMemberId: `writer-${presidency}-${state.turn}-${payload.candidateId}-${payload.officeId}`,
        },
      },
      vacantOffices: state.company.vacantOffices.filter((officeId) => officeId !== payload.officeId),
    },
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        [presidency]: {
          ...state.india.presidencies[presidency],
          writers: {
            ...state.india.presidencies[presidency].writers,
            [payload.candidateId]: Math.max(0, currentPresidencyWriterCount - 1),
          },
        },
      },
    },
  };
}

function promoteOfficeholderToOffice(
  state: GameState,
  payload: PromotionHireOfficePayload,
): GameState {
  const candidate = state.players[payload.candidateId];
  const sourceOffice = state.company.offices[payload.source.officeId];
  const movedFatigue = sourceOffice?.fatigue ?? 0;
  const familyMemberId =
    sourceOffice?.familyMemberId ??
    `officeholder-${payload.source.officeId}-${state.turn}-${payload.candidateId}`;
  const nextVacantOffices = [
    ...state.company.vacantOffices.filter((officeId) => officeId !== payload.officeId),
    payload.source.officeId,
  ].filter((officeId, index, officeIds) => officeIds.indexOf(officeId) === index);

  return {
    ...state,
    players: {
      ...state.players,
      [payload.candidateId]: {
        ...candidate,
        familyMembers: {
          ...candidate.familyMembers,
          offices: [
            ...new Set(
              candidate.familyMembers.offices
                .filter((officeId) => officeId !== payload.source.officeId)
                .concat(payload.officeId),
            ),
          ],
        },
      },
    },
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [payload.source.officeId]: {
          id: payload.source.officeId,
          treasury: sourceOffice?.treasury ?? 0,
          fatigue: 0,
          created: sourceOffice?.created ?? true,
          vacant: true,
          actedThisTurn: false,
        },
        [payload.officeId]: {
          id: payload.officeId,
          treasury: state.company.offices[payload.officeId]?.treasury ?? 0,
          fatigue: movedFatigue,
          created: true,
          vacant: false,
          actedThisTurn: false,
          holder: payload.candidateId,
          familyMemberId,
        },
      },
      vacantOffices: nextVacantOffices,
    },
  };
}

function parseChairmanElectionPayload(payload: unknown): ChairmanElectionPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { officeId?: unknown; candidateId?: unknown };
  if (raw.officeId !== "chairman" || typeof raw.candidateId !== "string") return undefined;

  return {
    officeId: "chairman",
    candidateId: raw.candidateId,
  };
}

function parseSkipHiringVacancyPayload(payload: unknown): SkipHiringVacancyPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { officeId?: unknown };
  if (typeof raw.officeId !== "string") return undefined;

  return {
    officeId: raw.officeId,
  };
}

function parseHireOfficePayload(payload: unknown): HireOfficePayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as {
    officeId?: unknown;
    candidateId?: unknown;
    source?: {
      type?: unknown;
      presidency?: unknown;
      officeId?: unknown;
    };
  };
  if (typeof raw.officeId !== "string" || typeof raw.candidateId !== "string") return undefined;
  if (!raw.source) return undefined;

  if (raw.source.type === "office" && typeof raw.source.officeId === "string") {
    return {
      officeId: raw.officeId,
      candidateId: raw.candidateId,
      source: {
        type: "office",
        officeId: raw.source.officeId,
      },
    };
  }

  if (raw.source.type !== "writer" || !isPresidencyId(raw.source.presidency)) return undefined;

  return {
    officeId: raw.officeId,
    candidateId: raw.candidateId,
    source: {
      type: "writer",
      presidency: raw.source.presidency,
    },
  };
}

function isPresidencyId(value: unknown): value is "Bombay" | "Madras" | "Bengal" {
  return value === "Bombay" || value === "Madras" || value === "Bengal";
}

function isLegalPayload(state: GameState, type: string, payload: unknown): boolean {
  return state.pendingDecision.legalCommands.some((command) => {
    if (command.type !== type) return false;

    return JSON.stringify(command.payload ?? {}) === JSON.stringify(payload);
  });
}
