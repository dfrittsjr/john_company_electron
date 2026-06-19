import { offices } from "../../data";
import type { OfficeDefinition, PresidencyId as DataPresidencyId } from "../../data/types";
import type {
  ApplyCommandResult,
  ArmyId,
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

type MilitaryHireOfficePayload = {
  officeId: OfficeId;
  candidateId: PlayerId;
  source:
    | {
        type: "commander";
        army: ArmyId;
      }
    | {
        type: "officer";
        army: ArmyId;
        readiness: "ready" | "exhausted";
      }
    | {
        type: "officersInTraining";
      };
};

type RegionalWriterHireOfficePayload = {
  officeId: OfficeId;
  candidateId: PlayerId;
  source: {
    type: "regionalWriter";
    regionId: string;
    orderId: string;
    presidency: EnginePresidencyId;
  };
};

type HireOfficePayload =
  | WriterHireOfficePayload
  | PromotionHireOfficePayload
  | MilitaryHireOfficePayload
  | RegionalWriterHireOfficePayload;

type ResolveNepotismConsentPayload = {
  accepted: boolean;
  hire: HireOfficePayload;
};

type EnginePresidencyId = WriterHireOfficePayload["source"]["presidency"];

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
        prompt:
          hasPureShareMajority(state)
            ? "Elect the Chairman from the Company-share majority."
            : "Elect the Chairman from table-negotiated Company-share support.",
        legalCommands,
        canSave: true,
      };
    }

    return createSkipHiringVacancyDecision(
      state,
      officeId,
      "The Court is empty and no Company shares can support a Chairman.",
    );
  }

  const hireCommands = createHireOfficeCommands(state, officeId);
  if (hireCommands.length > 0) {
    const hirer = determineOfficeHirer(state, officeId);
    return {
      id: `decision-hiring-hire-${officeId}-turn-${state.turn}`,
      phase: "hiring",
      step: "hiring.hireOffice",
      actor: hirer ?? "system",
      visibility: "private",
      prompt: `Choose a candidate for ${officeLabel(officeId)}.`,
      legalCommands: hireCommands,
      canSave: true,
    };
  }

  return createSkipHiringVacancyDecision(
    state,
    officeId,
    `No implemented hirer or eligible candidate is available for ${officeLabel(officeId)}.`,
  );
}

function createSkipHiringVacancyDecision(
  state: GameState,
  officeId: OfficeId,
  prompt: string,
): PendingDecision {
  return {
    id: `decision-hiring-skip-${officeId}-turn-${state.turn}`,
    phase: "hiring",
    step: "hiring.skipVacancy",
    actor: "system",
    visibility: "public",
    prompt,
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
  if (requiresNepotismConsent(state, payload)) {
    const pendingDecision = createNepotismConsentDecision(state, payload);
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "hiring.nepotismConsentRequested",
      summary: `${candidate.name} was proposed for ${officeLabel(payload.officeId)} by their own family.`,
      details: payload,
    });

    return {
      ok: true,
      logEntry,
      state: {
        ...state,
        updatedAt: now,
        pendingDecision,
        log: [...state.log, logEntry],
      },
    };
  }

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

export function resolveNepotismConsent(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "hiring" || state.pendingDecision.step !== "hiring.nepotismConsent") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Nepotism consent can only be resolved during the Hiring phase.",
          field: "phase",
        },
      ],
    };
  }

  const payload = parseResolveNepotismConsentPayload(command.payload);
  if (!payload || !isLegalPayload(state, "hiring.resolveNepotismConsent", payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_HIRING_CHOICE",
          message: "The requested nepotism consent response is not legal for this decision.",
          field: "payload",
        },
      ],
    };
  }

  const now = command.clientTimestamp;
  const candidate = state.players[payload.hire.candidateId];
  if (payload.accepted) {
    const stateAfterHire = moveCandidateToOffice(state, payload.hire);
    const logEntry = createCommandLogEntry({
      state: stateAfterHire,
      command,
      now,
      type: "hiring.nepotismConsentAccepted",
      summary: `Nepotism consent accepted; ${candidate.name} filled ${officeLabel(payload.hire.officeId)}.`,
      details: payload.hire,
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

  const stateAfterDenial = removeOfficeFromHiringQueue(state, payload.hire.officeId);
  const logEntry = createCommandLogEntry({
    state: stateAfterDenial,
    command,
    now,
    type: "hiring.nepotismConsentDenied",
    summary: `Nepotism consent denied; ${officeLabel(payload.hire.officeId)} remained vacant.`,
    details: payload.hire,
  });
  const stateWithLog: GameState = {
    ...stateAfterDenial,
    updatedAt: now,
    log: [...stateAfterDenial.log, logEntry],
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

function createNepotismConsentDecision(
  state: GameState,
  hire: HireOfficePayload,
): PendingDecision {
  const candidate = state.players[hire.candidateId];
  const office = officeLabel(hire.officeId);

  return {
    id: `decision-hiring-nepotism-${hire.officeId}-turn-${state.turn}`,
    phase: "hiring",
    step: "hiring.nepotismConsent",
    actor: "system",
    visibility: "public",
    prompt: `Resolve nepotism consent for ${candidate.name} to fill ${office}.`,
    legalCommands: [
      {
        type: "hiring.resolveNepotismConsent",
        label: "Accept Nepotism",
        description: `Allow ${candidate.name} to fill ${office}.`,
        payload: {
          accepted: true,
          hire,
        } satisfies ResolveNepotismConsentPayload,
      },
      {
        type: "hiring.resolveNepotismConsent",
        label: "Deny Nepotism",
        description: `Leave ${office} vacant for this turn.`,
        payload: {
          accepted: false,
          hire,
        } satisfies ResolveNepotismConsentPayload,
      },
    ],
    canSave: true,
  };
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
  return officeDefinition(officeId)?.label ?? officeId;
}

function createChairmanElectionCommands(state: GameState): LegalCommand[] {
  const totalShares = totalCompanyShares(state);
  if (totalShares <= 0) return [];

  const requiredShares = Math.floor(totalShares / 2) + 1;
  const counts = shareCountsByPlayer(state);
  const majorityCommands = [...counts.entries()]
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
  if (majorityCommands.length > 0) return majorityCommands;

  return [...counts.entries()]
    .filter(([playerId]) => !state.players[playerId]?.isCrown)
    .map(([candidateId, shareCount]) => ({
      type: "hiring.electChairman",
      label: `Elect ${state.players[candidateId].name} Chairman`,
      description: `${state.players[candidateId].name} has ${shareCount} of ${totalShares} Company shares; use this after table-negotiated majority support.`,
      payload: {
        officeId: "chairman",
        candidateId,
      } satisfies ChairmanElectionPayload,
    }));
}

function hasPureShareMajority(state: GameState): boolean {
  const totalShares = totalCompanyShares(state);
  if (totalShares <= 0) return false;

  const requiredShares = Math.floor(totalShares / 2) + 1;
  return [...shareCountsByPlayer(state).entries()].some(
    ([playerId, shareCount]) => shareCount >= requiredShares && !state.players[playerId]?.isCrown,
  );
}

function createHireOfficeCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const definition = officeDefinition(officeId);
  if (definition?.hiring?.candidatePool.type === "special") {
    if (definition.hiring.candidatePool.rule !== "director-of-trade-promotion-then-writers") {
      if (definition.hiring.candidatePool.rule === "military-affairs") {
        return createMilitaryAffairsHireCommands(state);
      }

      if (definition.hiring.candidatePool.rule === "president") {
        return createPresidentHireCommands(state, officeId);
      }

      if (definition.hiring.candidatePool.rule === "governor") {
        return createGovernorHireCommands(state, officeId);
      }

      return [];
    }

    return createPromotionThenWriterHireCommands(state, officeId);
  }

  if (definition?.hiring?.candidatePool.type !== "writers") return [];

  const hirer = determineOfficeHirer(state, officeId);
  if (!hirer) return [];

  return createWriterHireCommands(
    state,
    officeId,
    undefined,
    enginePresidenciesForCandidatePool(definition),
  );
}

function createWriterHireCommands(
  state: GameState,
  officeId: OfficeId,
  excludedPlayerId?: PlayerId,
  eligiblePresidencies: readonly EnginePresidencyId[] = ["Bombay", "Madras", "Bengal"],
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const player of Object.values(state.players)) {
    if (player.isCrown || player.id === excludedPlayerId) continue;

    for (const presidency of eligiblePresidencies) {
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

function createPromotionThenWriterHireCommands(
  state: GameState,
  targetOfficeId: OfficeId,
): LegalCommand[] {
  const chairmanId = determineOfficeHirer(state, targetOfficeId);
  if (!chairmanId) return [];

  const promotionCommands: LegalCommand[] = [];
  for (const office of Object.values(state.company.offices)) {
    if (
      office.vacant ||
      !office.holder ||
      office.id === "chairman" ||
      office.id === targetOfficeId ||
      isGovernorOffice(office.id)
    ) {
      continue;
    }

    const candidate = state.players[office.holder];
    if (!candidate || candidate.isCrown) continue;

    promotionCommands.push({
      type: "hiring.hireOffice",
      label: `Promote ${candidate.name} from ${officeLabel(office.id)}`,
      description: `Move ${candidate.name}'s officeholder from ${officeLabel(office.id)} to ${officeLabel(targetOfficeId)}.`,
      payload: {
        officeId: targetOfficeId,
        candidateId: candidate.id,
        source: {
          type: "office",
          officeId: office.id,
        },
      } satisfies HireOfficePayload,
    });
  }

  if (promotionCommands.length > 0) return promotionCommands;

  return createWriterHireCommands(state, targetOfficeId);
}

function createMilitaryAffairsHireCommands(state: GameState): LegalCommand[] {
  const hirer = determineOfficeHirer(state, "military-affairs");
  if (!hirer) return [];

  const commanderCommands = createCommanderHireCommands(state, "military-affairs", hirer);
  if (commanderCommands.length > 0) return commanderCommands;

  const officerCommands = createOfficerHireCommands(state, "military-affairs", hirer);
  if (officerCommands.length > 0) return officerCommands;

  return createOfficersInTrainingHireCommands(state, "military-affairs", hirer);
}

function createPresidentHireCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const definition = officeDefinition(officeId);
  if (definition?.category !== "presidency" || !definition.presidency) return [];

  const hirer = determineOfficeHirer(state, officeId);
  if (!hirer) return [];

  const presidency = toEnginePresidencyId(definition.presidency);

  return [
    ...createWriterHireCommands(state, officeId, undefined, [presidency]),
    ...createGovernorPromotionCommands(state, officeId, definition.presidency),
  ];
}

function createGovernorHireCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const definition = officeDefinition(officeId);
  if (definition?.category !== "governor" || !definition.presidency || !definition.region) {
    return [];
  }

  const hirer = determineOfficeHirer(state, officeId);
  if (!hirer) return [];

  const regionalWriterCommands = createRegionalWriterHireCommands(
    state,
    officeId,
    definition.region,
  );
  if (regionalWriterCommands.length > 0) return regionalWriterCommands;

  return createOfficerHireCommands(
    state,
    officeId,
    undefined,
    [toEnginePresidencyId(definition.presidency)],
  );
}

function createRegionalWriterHireCommands(
  state: GameState,
  officeId: OfficeId,
  regionId: string,
  excludedPlayerId?: PlayerId,
): LegalCommand[] {
  const region = state.india.regions[regionId];
  if (!region) return [];

  const commands: LegalCommand[] = [];
  for (const order of region.orders) {
    if (!order.writer || order.writer.playerId === excludedPlayerId) continue;

    const player = state.players[order.writer.playerId];
    if (!player || player.isCrown) continue;

    commands.push({
      type: "hiring.hireOffice",
      label: `Hire ${player.name} writer from ${region.name}`,
      description: `Move ${player.name}'s writer from ${region.name} order ${order.id} to ${officeLabel(officeId)}.`,
      payload: {
        officeId,
        candidateId: player.id,
        source: {
          type: "regionalWriter",
          regionId,
          orderId: order.id,
          presidency: order.writer.presidency,
        },
      } satisfies HireOfficePayload,
    });
  }

  return commands;
}

function createGovernorPromotionCommands(
  state: GameState,
  officeId: OfficeId,
  dataPresidency: DataPresidencyId,
  excludedPlayerId?: PlayerId,
): LegalCommand[] {
  return Object.values(state.company.offices)
    .filter((office) => {
      if (office.vacant || !office.holder || office.holder === excludedPlayerId) return false;
      const definition = officeDefinition(office.id);
      return definition?.category === "governor" && definition.presidency === dataPresidency;
    })
    .map((office) => {
      const candidate = state.players[office.holder as PlayerId];
      return {
        type: "hiring.hireOffice",
        label: `Promote ${candidate.name} from ${officeLabel(office.id)}`,
        description: `Move ${candidate.name}'s Governor from ${officeLabel(office.id)} to ${officeLabel(officeId)}.`,
        payload: {
          officeId,
          candidateId: candidate.id,
          source: {
            type: "office",
            officeId: office.id,
          },
        } satisfies HireOfficePayload,
      };
    });
}

function createCommanderHireCommands(
  state: GameState,
  officeId: OfficeId,
  excludedPlayerId?: PlayerId,
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const army of ["Bombay", "Madras", "Bengal"] as const) {
    const commanderId = state.company.armies[army].commander;
    if (!commanderId || commanderId === excludedPlayerId) continue;

    const player = state.players[commanderId];
    if (!player || player.isCrown) continue;

    commands.push({
      type: "hiring.hireOffice",
      label: `Hire ${player.name} ${army} Commander`,
      description: `Move ${player.name}'s ${army} Commander to ${officeLabel(officeId)}.`,
      payload: {
        officeId,
        candidateId: player.id,
        source: {
          type: "commander",
          army,
        },
      } satisfies HireOfficePayload,
    });
  }

  return commands;
}

function createOfficerHireCommands(
  state: GameState,
  officeId: OfficeId,
  excludedPlayerId?: PlayerId,
  eligibleArmies: readonly ArmyId[] = ["Bombay", "Madras", "Bengal"],
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const player of Object.values(state.players)) {
    if (player.isCrown || player.id === excludedPlayerId) continue;

    for (const army of eligibleArmies) {
      for (const readiness of ["ready", "exhausted"] as const) {
        const officerCount = player.familyMembers.officers[army]?.[readiness] ?? 0;
        const armyCount = state.company.armies[army].officers[player.id]?.[readiness] ?? 0;
        if (officerCount <= 0 || armyCount <= 0) continue;

        commands.push({
          type: "hiring.hireOffice",
          label: `Hire ${player.name} ${readiness} ${army} officer`,
          description: `Move one ${player.name} ${readiness} officer from the ${army} Army to ${officeLabel(officeId)}.`,
          payload: {
            officeId,
            candidateId: player.id,
            source: {
              type: "officer",
              army,
              readiness,
            },
          } satisfies HireOfficePayload,
        });
      }
    }
  }

  return commands;
}

function createOfficersInTrainingHireCommands(
  state: GameState,
  officeId: OfficeId,
  excludedPlayerId?: PlayerId,
): LegalCommand[] {
  return Object.values(state.players)
    .filter(
      (player) =>
        !player.isCrown &&
        player.id !== excludedPlayerId &&
        player.familyMembers.officersInTraining > 0,
    )
    .map((player) => ({
      type: "hiring.hireOffice",
      label: `Hire ${player.name} officer in training`,
      description: `Move one ${player.name} officer in training to ${officeLabel(officeId)}.`,
      payload: {
        officeId,
        candidateId: player.id,
        source: {
          type: "officersInTraining",
        },
      } satisfies HireOfficePayload,
    }));
}

function isGovernorOffice(officeId: OfficeId): boolean {
  return officeDefinition(officeId)?.category === "governor";
}

function determineOfficeHirer(state: GameState, officeId: OfficeId): PlayerId | undefined {
  const definition = officeDefinition(officeId);
  const hirer = definition?.hiring?.hirer;
  if (!hirer) return undefined;

  if (hirer !== "chairman") {
    const hirerOffice = state.company.offices[hirer.officeId];
    if (!hirerOffice || hirerOffice.vacant || !hirerOffice.holder) return undefined;

    return hirerOffice.holder;
  }

  const chairmanOffice = state.company.offices.chairman;
  if (!chairmanOffice || chairmanOffice.vacant || !chairmanOffice.holder) return undefined;

  return chairmanOffice.holder;
}

function requiresNepotismConsent(state: GameState, payload: HireOfficePayload): boolean {
  const definition = officeDefinition(payload.officeId);
  if (!definition?.hiring?.excludeHirerUntilNepotismConsent) return false;

  return determineOfficeHirer(state, payload.officeId) === payload.candidateId;
}

function officeDefinition(officeId: OfficeId): OfficeDefinition | undefined {
  return offices.find((office) => office.id === officeId);
}

function enginePresidenciesForCandidatePool(
  definition: OfficeDefinition,
): readonly EnginePresidencyId[] {
  const candidatePool = definition.hiring?.candidatePool;
  if (!candidatePool || candidatePool.type !== "writers" || candidatePool.presidencies === "any") {
    return ["Bombay", "Madras", "Bengal"];
  }

  return candidatePool.presidencies.map(toEnginePresidencyId);
}

function toEnginePresidencyId(presidency: DataPresidencyId): EnginePresidencyId {
  if (presidency === "bombay") return "Bombay";
  if (presidency === "madras") return "Madras";
  return "Bengal";
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

  if (isMilitaryHirePayload(payload)) {
    return moveMilitaryCandidateToOffice(state, payload);
  }

  if (isRegionalWriterHirePayload(payload)) {
    return moveRegionalWriterToOffice(state, payload);
  }

  return moveWriterToOffice(state, payload);
}

function isPromotionHirePayload(payload: HireOfficePayload): payload is PromotionHireOfficePayload {
  return payload.source.type === "office";
}

function isMilitaryHirePayload(payload: HireOfficePayload): payload is MilitaryHireOfficePayload {
  return (
    payload.source.type === "commander" ||
    payload.source.type === "officer" ||
    payload.source.type === "officersInTraining"
  );
}

function isRegionalWriterHirePayload(
  payload: HireOfficePayload,
): payload is RegionalWriterHireOfficePayload {
  return payload.source.type === "regionalWriter";
}

function moveWriterToOffice(
  state: GameState,
  payload: WriterHireOfficePayload,
): GameState {
  const candidate = state.players[payload.candidateId];
  const presidency = payload.source.presidency;
  const currentPlayerWriterCount = candidate.familyMembers.writers[presidency] ?? 0;
  const currentPresidencyWriterCount = state.india.presidencies[presidency].writers[payload.candidateId] ?? 0;

  const nextState: GameState = {
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

  return applyOfficeAssignmentSideEffects(nextState, {
    officeId: payload.officeId,
    holder: payload.candidateId,
  });
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

  const nextState: GameState = {
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

  return applyOfficeAssignmentSideEffects(
    clearOfficeAssignmentSideEffects(nextState, payload.source.officeId),
    {
      officeId: payload.officeId,
      holder: payload.candidateId,
    },
  );
}

function applyOfficeAssignmentSideEffects(
  state: GameState,
  assignment: { officeId: OfficeId; holder: PlayerId },
): GameState {
  const definition = officeDefinition(assignment.officeId);
  if (definition?.category === "presidency" && definition.presidency) {
    const presidency = toEnginePresidencyId(definition.presidency);
    return {
      ...state,
      india: {
        ...state.india,
        presidencies: {
          ...state.india.presidencies,
          [presidency]: {
            ...state.india.presidencies[presidency],
            president: assignment.holder,
          },
        },
      },
    };
  }

  if (definition?.category === "china") {
    return {
      ...state,
      company: {
        ...state.company,
        chinaOffice: {
          treasury: state.company.chinaOffice?.treasury ?? 0,
          holder: assignment.holder,
        },
      },
    };
  }

  return state;
}

function clearOfficeAssignmentSideEffects(state: GameState, officeId: OfficeId): GameState {
  const definition = officeDefinition(officeId);
  if (definition?.category === "presidency" && definition.presidency) {
    const presidency = toEnginePresidencyId(definition.presidency);
    return {
      ...state,
      india: {
        ...state.india,
        presidencies: {
          ...state.india.presidencies,
          [presidency]: {
            ...state.india.presidencies[presidency],
            president: undefined,
          },
        },
      },
    };
  }

  if (definition?.category === "china") {
    return {
      ...state,
      company: {
        ...state.company,
        chinaOffice: state.company.chinaOffice
          ? {
              ...state.company.chinaOffice,
              holder: undefined,
            }
          : undefined,
      },
    };
  }

  return state;
}

function moveMilitaryCandidateToOffice(
  state: GameState,
  payload: MilitaryHireOfficePayload,
): GameState {
  const candidate = state.players[payload.candidateId];
  const playerAfterSourceMove = moveMilitaryCandidateFromPlayer(candidate, payload);
  const companyAfterSourceMove = moveMilitaryCandidateFromCompany(state, payload);
  const nextState: GameState = {
    ...state,
    players: {
      ...state.players,
      [payload.candidateId]: {
        ...playerAfterSourceMove,
        familyMembers: {
          ...playerAfterSourceMove.familyMembers,
          offices: [...new Set([...playerAfterSourceMove.familyMembers.offices, payload.officeId])],
        },
      },
    },
    company: {
      ...companyAfterSourceMove,
      offices: {
        ...companyAfterSourceMove.offices,
        [payload.officeId]: {
          id: payload.officeId,
          treasury: state.company.offices[payload.officeId]?.treasury ?? 0,
          fatigue: state.company.offices[payload.officeId]?.fatigue ?? 0,
          created: true,
          vacant: false,
          actedThisTurn: false,
          holder: payload.candidateId,
          familyMemberId: militaryFamilyMemberId(state, payload),
        },
      },
      vacantOffices: companyAfterSourceMove.vacantOffices.filter((officeId) => officeId !== payload.officeId),
    },
  };

  return applyOfficeAssignmentSideEffects(nextState, {
    officeId: payload.officeId,
    holder: payload.candidateId,
  });
}

function moveMilitaryCandidateFromPlayer(
  player: GameState["players"][PlayerId],
  payload: MilitaryHireOfficePayload,
): GameState["players"][PlayerId] {
  if (payload.source.type === "officersInTraining") {
    return {
      ...player,
      familyMembers: {
        ...player.familyMembers,
        officersInTraining: Math.max(0, player.familyMembers.officersInTraining - 1),
      },
    };
  }

  if (payload.source.type === "commander") {
    return {
      ...player,
      familyMembers: {
        ...player.familyMembers,
        commanders: {
          ...player.familyMembers.commanders,
          [payload.source.army]: false,
        },
      },
    };
  }

  const currentStack = player.familyMembers.officers[payload.source.army] ?? {
    ready: 0,
    exhausted: 0,
  };

  return {
    ...player,
    familyMembers: {
      ...player.familyMembers,
      officers: {
        ...player.familyMembers.officers,
        [payload.source.army]: {
          ...currentStack,
          [payload.source.readiness]: Math.max(0, currentStack[payload.source.readiness] - 1),
        },
      },
    },
  };
}

function moveMilitaryCandidateFromCompany(
  state: GameState,
  payload: MilitaryHireOfficePayload,
): GameState["company"] {
  if (payload.source.type === "officersInTraining") {
    return state.company;
  }

  const army = state.company.armies[payload.source.army];
  if (payload.source.type === "commander") {
    return {
      ...state.company,
      armies: {
        ...state.company.armies,
        [payload.source.army]: {
          ...army,
          commander: undefined,
        },
      },
    };
  }

  const currentStack = army.officers[payload.candidateId] ?? {
    ready: 0,
    exhausted: 0,
  };

  return {
    ...state.company,
    armies: {
      ...state.company.armies,
      [payload.source.army]: {
        ...army,
        officers: {
          ...army.officers,
          [payload.candidateId]: {
            ...currentStack,
            [payload.source.readiness]: Math.max(
              0,
              currentStack[payload.source.readiness] - 1,
            ),
          },
        },
      },
    },
  };
}

function militaryFamilyMemberId(state: GameState, payload: MilitaryHireOfficePayload): string {
  if (payload.source.type === "officersInTraining") {
    return `officer-in-training-${state.turn}-${payload.candidateId}-${payload.officeId}`;
  }

  if (payload.source.type === "commander") {
    return `commander-${payload.source.army}-${state.turn}-${payload.candidateId}-${payload.officeId}`;
  }

  return `officer-${payload.source.army}-${payload.source.readiness}-${state.turn}-${payload.candidateId}-${payload.officeId}`;
}

function moveRegionalWriterToOffice(
  state: GameState,
  payload: RegionalWriterHireOfficePayload,
): GameState {
  const candidate = state.players[payload.candidateId];
  const region = state.india.regions[payload.source.regionId];
  const nextState: GameState = {
    ...state,
    players: {
      ...state.players,
      [payload.candidateId]: {
        ...candidate,
        familyMembers: {
          ...candidate.familyMembers,
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
          familyMemberId: `regional-writer-${payload.source.regionId}-${payload.source.orderId}-${state.turn}-${payload.candidateId}-${payload.officeId}`,
        },
      },
      vacantOffices: state.company.vacantOffices.filter((officeId) => officeId !== payload.officeId),
    },
    india: {
      ...state.india,
      regions: {
        ...state.india.regions,
        [payload.source.regionId]: {
          ...region,
          orders: region.orders.map((order) =>
            order.id === payload.source.orderId
              ? {
                  ...order,
                  writer: undefined,
                }
              : order,
          ),
        },
      },
    },
  };

  return applyOfficeAssignmentSideEffects(nextState, {
    officeId: payload.officeId,
    holder: payload.candidateId,
  });
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
      army?: unknown;
      readiness?: unknown;
      regionId?: unknown;
      orderId?: unknown;
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

  if (raw.source.type === "commander" && isArmyId(raw.source.army)) {
    return {
      officeId: raw.officeId,
      candidateId: raw.candidateId,
      source: {
        type: "commander",
        army: raw.source.army,
      },
    };
  }

  if (
    raw.source.type === "officer" &&
    isArmyId(raw.source.army) &&
    isReadiness(raw.source.readiness)
  ) {
    return {
      officeId: raw.officeId,
      candidateId: raw.candidateId,
      source: {
        type: "officer",
        army: raw.source.army,
        readiness: raw.source.readiness,
      },
    };
  }

  if (raw.source.type === "officersInTraining") {
    return {
      officeId: raw.officeId,
      candidateId: raw.candidateId,
      source: {
        type: "officersInTraining",
      },
    };
  }

  if (
    raw.source.type === "regionalWriter" &&
    typeof raw.source.regionId === "string" &&
    typeof raw.source.orderId === "string" &&
    isPresidencyId(raw.source.presidency)
  ) {
    return {
      officeId: raw.officeId,
      candidateId: raw.candidateId,
      source: {
        type: "regionalWriter",
        regionId: raw.source.regionId,
        orderId: raw.source.orderId,
        presidency: raw.source.presidency,
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

function parseResolveNepotismConsentPayload(
  payload: unknown,
): ResolveNepotismConsentPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { accepted?: unknown; hire?: unknown };
  if (typeof raw.accepted !== "boolean") return undefined;

  const hire = parseHireOfficePayload(raw.hire);
  if (!hire) return undefined;

  return {
    accepted: raw.accepted,
    hire,
  };
}

function isPresidencyId(value: unknown): value is "Bombay" | "Madras" | "Bengal" {
  return value === "Bombay" || value === "Madras" || value === "Bengal";
}

function isArmyId(value: unknown): value is ArmyId {
  return isPresidencyId(value);
}

function isReadiness(value: unknown): value is "ready" | "exhausted" {
  return value === "ready" || value === "exhausted";
}

function isLegalPayload(state: GameState, type: string, payload: unknown): boolean {
  return state.pendingDecision.legalCommands.some((command) => {
    if (command.type !== type) return false;

    return JSON.stringify(command.payload ?? {}) === JSON.stringify(payload);
  });
}
