import type { CommandHandler } from "../command-handler";
import { offices, prizes } from "../../data";
import type { OfficeDefinition } from "../../data/types";
import {
  playerForbidsHolding,
  presidentOf,
  regionPresidency,
  toEnginePresidency,
} from "../selectors";
import type {
  ApplyCommandResult,
  ArmyId,
  GameCommand,
  GameState,
  LegalCommand,
  OfficeId,
  PendingDecision,
  PlayerId,
  PresidencyId,
  ShareInstance,
  ValidationError,
} from "../types";
import { createNextCompanyOperationDecision } from "./company-operation";
import { takeFamilyPiece } from "./family";
import { hiringResumeHandler } from "./hiring-resume";
import type { ChairmanElectionState, HireOfficePayload, HireSource, HiringState } from "./hiring.state";
import { appendLog, nepotismConsentGuarantors, registerStateRefresher } from "./negotiation";
import {
  facedownBlackmailInstance,
  registerBlackmailResume,
  registerInFlowBlackmail,
  startBlackmailPlay,
} from "./negotiation-blackmail";
import { createCommandLogEntry, PRIVATE_DECISION_SUMMARY } from "./shared";
import { crownCubes, humanPlayerIds, isCrownPlayer } from "../crown/state";

// Hiring (rulebook pp.14-17). Vacant offices are hired in ascending order of the number on the
// back of each office card. The Chairman is elected by Company-share support; every other office
// is hired by a specific officeholder from a specific candidate pool, subject to Nepotism.

type ChairmanElectionPayload = {
  officeId: "chairman";
  candidateId: PlayerId;
};

type ChairmanSupportPayload = {
  candidateId: PlayerId | null;
};

type EmptyCourtChairmanPayload = {
  fromPrize?: string;
};

type SkipHiringVacancyPayload = {
  officeId: OfficeId;
};

type ResolveNepotismConsentPayload = {
  accepted: boolean;
  hire: HireOfficePayload;
};

type HiringPreferencePayload = {
  officeId: OfficeId;
};

export type { HireOfficePayload } from "./hiring.state";

const PRESIDENCIES: readonly PresidencyId[] = ["Bombay", "Madras", "Bengal"];
const HIRING_PREFERENCE_CARD_ID = "hiring-preference";

// ---------------------------------------------------------------------------------------------
// Phase flow
// ---------------------------------------------------------------------------------------------

/** Begin the Hiring phase after Family (and Firms, once Deregulation exists). */
export function startHiringPhase(state: GameState): GameState {
  return advanceHiring({
    ...state,
    phase: "hiring",
    hiring: {
      skippedThisTurn: [],
      nepotismRefused: [],
      hiringPreferenceOffered: [],
    },
  });
}

function advanceHiring(state: GameState): GameState {
  const officeId = nextVacantOfficeId(state);
  if (!officeId) {
    const next: GameState = { ...state, phase: "companyOperation" };
    return { ...next, pendingDecision: createNextCompanyOperationDecision(next) };
  }

  return presentOfficeHire(state, officeId);
}

/** Continue after an office was hired or skipped: the next vacancy, or the interrupted phase. */
function afterOfficeResolved(state: GameState, officeId: OfficeId): GameState {
  const cleared: GameState = {
    ...state,
    hiring: {
      ...state.hiring,
      nepotism: undefined,
      hiringPreference: state.hiring.hiringPreference?.officeId === officeId ? undefined : state.hiring.hiringPreference,
    },
  };
  const immediate = cleared.hiring.immediate;
  if (!immediate) return advanceHiring(cleared);

  return resumeAfterImmediateHire(cleared);
}

function presentOfficeHire(state: GameState, officeId: OfficeId): GameState {
  if (officeId === "chairman") return presentChairmanElection(state);

  const commands = candidateCommands(state, officeId);
  const hirer = determineOfficeHirer(state, officeId);
  if (!hirer || commands.length === 0) {
    // No dead actions (p.17): nobody has a choice, so leave the office vacant and carry on.
    return autoSkipVacancy(
      state,
      officeId,
      hirer
        ? `No eligible candidate can fill ${officeLabel(officeId)}; it stays vacant this turn.`
        : `The office that hires ${officeLabel(officeId)} is vacant; it stays vacant this turn.`,
    );
  }

  const preferenceHolder = hiringPreferenceHolder(state);
  if (
    preferenceHolder &&
    !state.hiring.hiringPreference &&
    !state.hiring.hiringPreferenceOffered.includes(officeId) &&
    commands.some((command) => (command.payload as HireOfficePayload).candidateId === preferenceHolder)
  ) {
    return withDecision(state, createHiringPreferenceDecision(state, officeId, preferenceHolder));
  }

  return withDecision(state, {
    id: `decision-hiring-hire-${officeId}-turn-${state.turn}${immediateSuffix(state)}`,
    phase: state.phase,
    step: "hiring.hireOffice",
    actor: hirer,
    visibility: "public",
    prompt:
      state.hiring.hiringPreference?.officeId === officeId
        ? `Hiring Preference was played: hire ${state.players[state.hiring.hiringPreference.playerId].name} as ${officeLabel(officeId)}.`
        : `Choose a candidate for ${officeLabel(officeId)}.`,
    legalCommands: commands,
    canSave: true,
  });
}

function withDecision(state: GameState, pendingDecision: PendingDecision): GameState {
  return { ...state, phase: pendingDecision.phase, pendingDecision };
}

/** Leave a vacancy that nobody can fill vacant for the turn, with a log entry, and move on (p.14, p.17). */
function autoSkipVacancy(state: GameState, officeId: OfficeId, reason: string): GameState {
  const skipped: GameState = {
    ...state,
    hiring: { ...state.hiring, skippedThisTurn: [...state.hiring.skippedThisTurn, officeId] },
  };
  const logged = appendLog(skipped, {
    actor: "system",
    type: "hiring.vacancySkipped",
    summary: `${officeLabel(officeId)} remained vacant: ${reason}`,
    details: { officeId, reason, automatic: true },
    timestamp: state.updatedAt,
  });
  return afterOfficeResolved(logged, officeId);
}

function createSkipHiringVacancyDecision(state: GameState, officeId: OfficeId, prompt: string): PendingDecision {
  return {
    id: `decision-hiring-skip-${officeId}-turn-${state.turn}${immediateSuffix(state)}`,
    phase: state.phase,
    step: "hiring.skipVacancy",
    actor: "system",
    visibility: "public",
    prompt,
    legalCommands: [
      {
        type: "hiring.skipVacancy",
        label: `Skip ${officeLabel(officeId)}`,
        description: "Leave this office vacant for the turn and continue.",
        payload: { officeId } satisfies SkipHiringVacancyPayload,
      },
    ],
    canSave: true,
  };
}

function immediateSuffix(state: GameState): string {
  return state.hiring.immediate ? `-immediate-${state.log.length}` : "";
}

function isHiringStep(state: GameState, step: string): boolean {
  return (state.phase === "hiring" || Boolean(state.hiring.immediate)) && state.pendingDecision.step === step;
}

// ---------------------------------------------------------------------------------------------
// Offices hired immediately (Superintendent of Trade in China, laws)
// ---------------------------------------------------------------------------------------------

/**
 * Create an office outside the Hiring phase and hire it at once, as when the Director of Trade's
 * Special Envoy or the Envoy to China law opens trade with China ("The office should be hired
 * immediately", p.18; "hired immediately by the Chairman who may promote any writer", p.25).
 *
 * `resumeKey` names a handler registered with registerHiringResume(); it is called with the
 * resulting state once the office is filled or left vacant and must set the next decision.
 * If the office cannot be filled now, it stays in the Vacant Offices box for the next Hiring phase.
 */
export function beginImmediateHire(state: GameState, officeId: OfficeId, resumeKey: string): GameState {
  const existing = state.company.offices[officeId];
  const created: GameState = {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          treasury: existing?.treasury ?? 0,
          fatigue: existing?.fatigue ?? 0,
          created: true,
          vacant: existing?.vacant ?? true,
          actedThisTurn: false,
          holder: existing?.holder,
          familyMemberId: existing?.familyMemberId,
        },
      },
      vacantOffices: existing && !existing.vacant
        ? state.company.vacantOffices
        : [...new Set([...state.company.vacantOffices, officeId])],
      unusedOffices: state.company.unusedOffices.filter((candidate) => candidate !== officeId),
    },
    hiring: {
      ...state.hiring,
      nepotismRefused: state.hiring.nepotismRefused ?? [],
      hiringPreferenceOffered: (state.hiring.hiringPreferenceOffered ?? []).filter((id) => id !== officeId),
      immediate: { officeId, resumeKey, phase: state.phase },
    },
  };

  if (!created.company.offices[officeId].vacant) return resumeAfterImmediateHire(created);

  const commands = candidateCommands(created, officeId);
  if (!determineOfficeHirer(created, officeId) || commands.length === 0) {
    return resumeAfterImmediateHire(created);
  }

  return presentOfficeHire(created, officeId);
}

function resumeAfterImmediateHire(state: GameState): GameState {
  const immediate = state.hiring.immediate;
  if (!immediate) return state;

  const resumed: GameState = {
    ...state,
    phase: immediate.phase,
    hiring: { ...state.hiring, immediate: undefined, nepotism: undefined },
  };
  const handler = hiringResumeHandler(immediate.resumeKey);
  if (!handler) {
    throw new Error(`No hiring resume handler is registered for "${immediate.resumeKey}".`);
  }

  return handler(resumed);
}

// ---------------------------------------------------------------------------------------------
// Chairman election (p.15)
// ---------------------------------------------------------------------------------------------

function presentChairmanElection(state: GameState): GameState {
  const counts = courtShareCounts(state);
  const totalShares = [...counts.values()].reduce((total, count) => total + count, 0);
  const formerChairman = state.company.chairmanMarker;

  if (totalShares === 0) return presentEmptyCourt(state, formerChairman);

  const candidates = orderedFrom(state, formerChairman).filter((playerId) => (counts.get(playerId) ?? 0) > 0);
  const requiredShares = Math.floor(totalShares / 2) + 1;

  if (candidates.length === 1) {
    return withDecision(state, {
      id: `decision-hiring-elect-chairman-turn-${state.turn}`,
      phase: "hiring",
      step: "hiring.electChairman",
      actor: existingPlayerOrSystem(state, formerChairman),
      visibility: "public",
      prompt: `${state.players[candidates[0]].name} holds every Company share and becomes Chairman.`,
      legalCommands: [electChairmanCommand(state, candidates[0], counts, totalShares)],
      canSave: true,
    });
  }

  const election: ChairmanElectionState = state.hiring.election ?? {
    formerChairman,
    totalShares,
    requiredShares,
    candidates,
    supportOrder: candidates,
    nextSupporterIndex: 0,
    support: {},
  };

  return presentNextSupporter({ ...state, hiring: { ...state.hiring, election } });
}

// A favour (Handbook p.3) or deal can move Company shares before anyone has declared support: the
// election is worked out again from the Court as it now stands.
function rebuildChairmanElection(state: GameState): GameState {
  if (state.phase !== "hiring" || (state.hiring.election?.nextSupporterIndex ?? 0) > 0) return state;
  return presentChairmanElection({ ...state, hiring: { ...state.hiring, election: undefined } });
}

for (const step of ["hiring.chairmanSupport", "hiring.electChairman", "hiring.emptyCourtChairman"]) {
  registerStateRefresher(step, rebuildChairmanElection);
}

function presentNextSupporter(state: GameState): GameState {
  const election = state.hiring.election as ChairmanElectionState;
  const supporter = election.supportOrder[election.nextSupporterIndex];
  const counts = courtShareCounts(state);

  if (!supporter) {
    // No candidate reached a majority: the former Chairman picks any shareholder, themselves
    // included, and Nepotism does not apply (p.15).
    return withDecision(state, {
      id: `decision-hiring-former-chairman-picks-turn-${state.turn}`,
      phase: "hiring",
      step: "hiring.electChairman",
      actor: existingPlayerOrSystem(state, election.formerChairman),
      visibility: "public",
      prompt: "No candidate has majority support. The former Chairman chooses the new Chairman.",
      legalCommands: election.candidates.map((candidateId) =>
        electChairmanCommand(state, candidateId, counts, election.totalShares),
      ),
      canSave: true,
    });
  }

  const tally = supportTally(election, counts);
  return withDecision(state, {
    id: `decision-hiring-chairman-support-turn-${state.turn}-${supporter}`,
    phase: "hiring",
    step: "hiring.chairmanSupport",
    actor: supporter,
    visibility: "public",
    prompt:
      `Chairman election: ${election.requiredShares} of ${election.totalShares} Company shares make a majority. ` +
      `Support so far: ${describeTally(state, tally)}. Back a candidate with your ${counts.get(supporter) ?? 0} share(s).`,
    legalCommands: [
      ...election.candidates.map((candidateId) => ({
        type: "hiring.declareChairmanSupport",
        label: candidateId === supporter ? "Support yourself" : `Support ${state.players[candidateId].name}`,
        description: `Add your shares to ${state.players[candidateId].name}'s support.`,
        payload: { candidateId } satisfies ChairmanSupportPayload,
      })),
      {
        type: "hiring.declareChairmanSupport",
        label: "Support no one",
        description: "Withhold your shares from every candidate.",
        payload: { candidateId: null } satisfies ChairmanSupportPayload,
      },
    ],
    canSave: true,
  });
}

function presentEmptyCourt(state: GameState, formerChairman: PlayerId | undefined): GameState {
  // An empty Court: the former Chairman continues, placing a piece from supply or, failing
  // that, from a prize. If neither is possible, there is no Chairman (p.15).
  const player = formerChairman ? state.players[formerChairman] : undefined;
  const sources =
    // Joseph Sedley (#15): a holder may not own a Company share, so cannot continue as Chairman.
    !player || playerForbidsHolding(state, player.id, "companyShare")
      ? []
      : player.familyMembers.supply > 0
        ? [undefined]
        : Object.entries(player.familyMembers.prizes)
            .filter(([, count]) => count > 0)
            .map(([prizeId]) => prizeId);

  if (!player || sources.length === 0) {
    return autoSkipVacancy(
      state,
      "chairman",
      "The Court is empty and the former Chairman has no family member to place: there is no Chairman.",
    );
  }

  return withDecision(state, {
    id: `decision-hiring-empty-court-chairman-turn-${state.turn}`,
    phase: "hiring",
    step: "hiring.emptyCourtChairman",
    actor: player.id,
    visibility: "public",
    prompt: "The Court is empty, so the former Chairman continues as Chairman.",
    legalCommands: sources.map((fromPrize) => ({
      type: "hiring.emptyCourtChairman",
      label: fromPrize ? `Continue as Chairman (piece from the ${prizeLabel(fromPrize)})` : "Continue as Chairman",
      description: "Place a family member in the Chairman slot.",
      payload: (fromPrize ? { fromPrize } : {}) satisfies EmptyCourtChairmanPayload,
    })),
    canSave: true,
  });
}

function electChairmanCommand(
  state: GameState,
  candidateId: PlayerId,
  counts: Map<PlayerId, number>,
  totalShares: number,
): LegalCommand {
  return {
    type: "hiring.electChairman",
    label: `Elect ${state.players[candidateId].name} Chairman`,
    description: `${state.players[candidateId].name} holds ${counts.get(candidateId) ?? 0} of ${totalShares} Company shares.`,
    payload: { officeId: "chairman", candidateId } satisfies ChairmanElectionPayload,
  };
}

export function declareChairmanSupport(state: GameState, command: GameCommand): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.chairmanSupport") || !state.hiring.election) {
    return hiringError("WRONG_PHASE", "No Chairman election is collecting support.", "phase");
  }

  if (!isLegalPayload(state, "hiring.declareChairmanSupport", command.payload)) {
    return hiringError("ILLEGAL_HIRING_CHOICE", "That support declaration is not legal here.", "payload");
  }

  const { candidateId } = command.payload as ChairmanSupportPayload;
  const election = state.hiring.election;
  const supporter = command.actorId as PlayerId;
  const nextElection: ChairmanElectionState = {
    ...election,
    support: { ...election.support, [supporter]: candidateId },
    nextSupporterIndex: election.nextSupporterIndex + 1,
  };
  const counts = courtShareCounts(state);
  const tally = supportTally(nextElection, counts);
  const winner = candidateId && (tally.get(candidateId) ?? 0) >= election.requiredShares ? candidateId : undefined;
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "hiring.chairmanSupport",
    summary: candidateId
      ? `${state.players[supporter].name} backed ${candidateId === supporter ? "themselves" : state.players[candidateId].name} for Chairman with ${counts.get(supporter) ?? 0} share(s).`
      : `${state.players[supporter].name} backed no candidate for Chairman.`,
    details: { candidateId, tally: Object.fromEntries(tally) },
  });
  const withSupport: GameState = {
    ...state,
    updatedAt: now,
    log: [...state.log, logEntry],
    hiring: { ...state.hiring, election: nextElection },
  };

  if (!winner) return { ok: true, logEntry, state: presentNextSupporter(withSupport) };

  // "As soon as a candidate has the required number of supporting Company shares, the election
  // is over" (p.15).
  return completeChairmanElection(withSupport, winner, command, "majority");
}

export function electChairman(state: GameState, command: GameCommand): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.electChairman")) {
    return hiringError("WRONG_PHASE", "Chairman election can only be resolved during the Hiring phase.", "phase");
  }

  const payload = parseChairmanElectionPayload(command.payload);
  if (!payload) return hiringError("INVALID_PAYLOAD", "Chairman election requires a candidate id.", "payload.candidateId");

  if (!isLegalPayload(state, "hiring.electChairman", payload)) {
    return hiringError(
      "ILLEGAL_HIRING_CHOICE",
      `Player "${payload.candidateId}" is not a legal Chairman candidate for this decision.`,
      "payload.candidateId",
    );
  }

  return completeChairmanElection(state, payload.candidateId, command, "former-chairman-choice");
}

function completeChairmanElection(
  state: GameState,
  candidateId: PlayerId,
  command: GameCommand,
  method: "majority" | "former-chairman-choice",
): ApplyCommandResult {
  const counts = courtShareCounts(state);
  const totalShares = [...counts.values()].reduce((total, count) => total + count, 0);
  const elected = assignChairman(state, candidateId);
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: elected,
    command,
    now,
    type: "hiring.chairmanElected",
    summary: `${state.players[candidateId].name} was elected Chairman.`,
    details: {
      candidateId,
      method,
      candidateShares: counts.get(candidateId) ?? 0,
      totalShares,
    },
  });

  return {
    ok: true,
    logEntry,
    state: afterOfficeResolved(
      {
        ...elected,
        updatedAt: now,
        log: [...elected.log, logEntry],
        hiring: { ...elected.hiring, election: undefined },
      },
      "chairman",
    ),
  };
}

export function emptyCourtChairman(state: GameState, command: GameCommand): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.emptyCourtChairman")) {
    return hiringError("WRONG_PHASE", "The empty-Court Chairman is not being placed now.", "phase");
  }

  if (!isLegalPayload(state, "hiring.emptyCourtChairman", command.payload)) {
    return hiringError("ILLEGAL_HIRING_CHOICE", "That piece cannot become the Chairman.", "payload");
  }

  const { fromPrize } = command.payload as EmptyCourtChairmanPayload;
  const playerId = command.actorId as PlayerId;
  const taken = takeFamilyPiece(state, playerId, fromPrize);
  if (!taken.ok) return { ok: false, errors: taken.errors };

  const placed: GameState = {
    ...taken.state,
    company: {
      ...placeOfficeholder(taken.state, "chairman", playerId, { familyMemberId: `chairman-${state.turn}-${playerId}` }),
      chairmanMarker: playerId,
    },
  };
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: placed,
    command,
    now,
    type: "hiring.chairmanContinues",
    summary: `The Court is empty, so ${state.players[playerId].name} continues as Chairman.`,
    details: { fromPrize },
  });

  return {
    ok: true,
    logEntry,
    state: afterOfficeResolved({ ...placed, updatedAt: now, log: [...placed.log, logEntry] }, "chairman"),
  };
}

/** Company shares in the Court by player; the Chairman's slot is empty during an election. */
function courtShareCounts(state: GameState): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const share of state.company.court) {
    if (!share.owner) continue;
    counts.set(share.owner, (counts.get(share.owner) ?? 0) + 1);
  }

  return counts;
}

function supportTally(election: ChairmanElectionState, counts: Map<PlayerId, number>): Map<PlayerId, number> {
  const tally = new Map<PlayerId, number>();
  for (const [supporter, candidateId] of Object.entries(election.support)) {
    if (!candidateId) continue;
    tally.set(candidateId, (tally.get(candidateId) ?? 0) + (counts.get(supporter) ?? 0));
  }

  return tally;
}

function describeTally(state: GameState, tally: Map<PlayerId, number>): string {
  if (tally.size === 0) return "none";

  return [...tally.entries()].map(([playerId, shares]) => `${state.players[playerId].name} ${shares}`).join(", ");
}

/** Families in clockwise seating order (the Crown included), starting with `first` when it is one of them. */
function orderedFrom(state: GameState, first: PlayerId | undefined): PlayerId[] {
  const seats = state.seatingOrder;
  const start = first ? seats.indexOf(first) : -1;
  return start <= 0 ? [...seats] : [...seats.slice(start), ...seats.slice(0, start)];
}

// The Crown elects and hires like any family (Crown Handbook p.3), so it is a valid actor here.
function existingPlayerOrSystem(state: GameState, playerId: PlayerId | undefined): PlayerId | "system" {
  return playerId && state.players[playerId] ? playerId : "system";
}

// The new Chairman moves one of their Court shares to the Chairman slot; it still counts as a
// Company share (p.15). They also take the Chairman marker.
function assignChairman(state: GameState, candidateId: PlayerId): GameState {
  const candidateShare = state.company.court.find((share) => share.owner === candidateId);
  const court = candidateShare ? removeShare(state.company.court, candidateShare.id) : state.company.court;
  const company = placeOfficeholder({ ...state, company: { ...state.company, court } }, "chairman", candidateId, {
    familyMemberId: candidateShare?.id ?? `chairman-share-${state.turn}-${candidateId}`,
  });

  return { ...state, company: { ...company, chairmanMarker: candidateId } };
}

// ---------------------------------------------------------------------------------------------
// Office hires, Nepotism, Hiring Preference
// ---------------------------------------------------------------------------------------------

export function hireOffice(state: GameState, command: GameCommand): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.hireOffice")) {
    return hiringError("WRONG_PHASE", "Office hires can only be resolved during the Hiring phase.", "phase");
  }

  const payload = parseHireOfficePayload(command.payload);
  if (!payload || !isLegalPayload(state, "hiring.hireOffice", payload)) {
    return hiringError("ILLEGAL_HIRING_CHOICE", "The requested office hire is not legal for this decision.", "payload");
  }

  const hirer = command.actorId as PlayerId;
  const candidate = state.players[payload.candidateId];
  const now = command.clientTimestamp;
  const consentFrom = nepotismConsentNeededFrom(state, payload, hirer);

  if (consentFrom.length > 0) {
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "hiring.nepotismConsentRequested",
      summary: `${candidate.name} proposed their own family member for ${officeLabel(payload.officeId)}; ${consentFrom
        .map((playerId) => state.players[playerId].name)
        .join(", ")} must consent.`,
      details: { hire: payload, consentFrom },
    });
    const requested: GameState = {
      ...state,
      updatedAt: now,
      log: [...state.log, logEntry],
      hiring: { ...state.hiring, nepotism: { hire: payload, hirer, pending: consentFrom, consented: [] } },
    };

    return { ok: true, logEntry, state: withDecision(requested, createNepotismConsentDecision(requested)) };
  }

  return completeHire(state, payload, command, "hiring.officeHired", `${candidate.name} filled ${officeLabel(payload.officeId)}.`);
}

function completeHire(
  state: GameState,
  payload: HireOfficePayload,
  command: GameCommand,
  logType: string,
  summary: string,
): ApplyCommandResult {
  const hired = moveCandidateToOffice(state, payload);
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({ state: hired, command, now, type: logType, summary, details: payload });

  return {
    ok: true,
    logEntry,
    state: afterOfficeResolved({ ...hired, updatedAt: now, log: [...hired.log, logEntry] }, payload.officeId),
  };
}

/**
 * Nepotism (p.14): hiring your own family member needs the consent of every other player in that
 * office's candidate pool. It does not apply when Hiring Preference was played for the hirer.
 * A called-in "My consent for nepotism" promise counts as that guarantor's consent.
 */
function nepotismConsentNeededFrom(state: GameState, payload: HireOfficePayload, hirer: PlayerId): PlayerId[] {
  if (payload.candidateId !== hirer) return [];

  const preference = state.hiring.hiringPreference;
  if (preference?.officeId === payload.officeId && preference.playerId === hirer) return [];

  const pool = new Set(
    createHireOfficeCommands(state, payload.officeId).map((command) => (command.payload as HireOfficePayload).candidateId),
  );
  pool.delete(hirer);
  // A called-in "My consent for nepotism" promise counts as that guarantor's consent (card back).
  for (const guarantor of nepotismConsentGuarantors(state, hirer)) pool.delete(guarantor);

  return orderedFrom(state, hirer).filter((playerId) => pool.has(playerId));
}

function createNepotismConsentDecision(state: GameState): PendingDecision {
  const nepotism = state.hiring.nepotism;
  if (!nepotism) throw new Error("No nepotism consent is being collected.");

  const consenter = nepotism.pending[0];
  const candidate = state.players[nepotism.hire.candidateId];
  const office = officeLabel(nepotism.hire.officeId);

  // Solo, Crown hiring its own family: "You must give consent for nepotism to the Crown when
  // required if they have 2 or more promises" (Crown Handbook p.3; cube favour +2).
  const mustConsent =
    isCrownPlayer(state, nepotism.hirer) && humanPlayerIds(state).length === 1 && crownCubes(state) >= 2 && !isCrownPlayer(state, consenter);

  return {
    id: `decision-hiring-nepotism-${nepotism.hire.officeId}-turn-${state.turn}-${consenter}${immediateSuffix(state)}`,
    phase: state.phase,
    step: "hiring.nepotismConsent",
    actor: consenter,
    visibility: "public",
    prompt: `${candidate.name} wants to hire their own family member as ${office}. Do you consent?`,
    legalCommands: [
      {
        type: "hiring.resolveNepotismConsent",
        label: "Consent",
        description: `Allow ${candidate.name} to fill ${office} with their own family member.`,
        payload: { accepted: true, hire: nepotism.hire } satisfies ResolveNepotismConsentPayload,
      },
      ...(mustConsent
        ? []
        : [
            {
              type: "hiring.resolveNepotismConsent",
              label: "Refuse",
              description: `${candidate.name} must hire someone else as ${office}.`,
              payload: { accepted: false, hire: nepotism.hire } satisfies ResolveNepotismConsentPayload,
            },
          ]),
    ],
    canSave: true,
  };
}

export function resolveNepotismConsent(state: GameState, command: GameCommand): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.nepotismConsent") || !state.hiring.nepotism) {
    return hiringError("WRONG_PHASE", "No nepotism consent is being requested.", "phase");
  }

  const payload = parseResolveNepotismConsentPayload(command.payload);
  if (!payload || !isLegalPayload(state, "hiring.resolveNepotismConsent", payload)) {
    return hiringError("ILLEGAL_HIRING_CHOICE", "The requested nepotism consent response is not legal for this decision.", "payload");
  }

  const nepotism = state.hiring.nepotism;
  const consenter = command.actorId as PlayerId;
  const candidate = state.players[nepotism.hire.candidateId];
  const now = command.clientTimestamp;

  if (!payload.accepted) {
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "hiring.nepotismConsentDenied",
      summary: `${state.players[consenter].name} refused consent; ${candidate.name} must hire someone else as ${officeLabel(nepotism.hire.officeId)}.`,
      details: nepotism.hire,
    });
    // Assumption: a refused self-hire cannot be proposed again for this office this turn, so the
    // hirer chooses among the other candidates (negotiate before proposing).
    const refused: GameState = {
      ...state,
      updatedAt: now,
      log: [...state.log, logEntry],
      hiring: {
        ...state.hiring,
        nepotism: undefined,
        nepotismRefused: [...state.hiring.nepotismRefused, { officeId: nepotism.hire.officeId, hirer: nepotism.hirer }],
      },
    };

    return { ok: true, logEntry, state: presentOfficeHire(refused, nepotism.hire.officeId) };
  }

  const remaining = nepotism.pending.slice(1);
  if (remaining.length > 0) {
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "hiring.nepotismConsentGiven",
      summary: `${state.players[consenter].name} consented to ${candidate.name}'s self-hire as ${officeLabel(nepotism.hire.officeId)}.`,
      details: nepotism.hire,
    });
    const next: GameState = {
      ...state,
      updatedAt: now,
      log: [...state.log, logEntry],
      hiring: { ...state.hiring, nepotism: { ...nepotism, pending: remaining, consented: [...nepotism.consented, consenter] } },
    };

    return { ok: true, logEntry, state: withDecision(next, createNepotismConsentDecision(next)) };
  }

  return completeHire(
    state,
    nepotism.hire,
    command,
    "hiring.nepotismConsentAccepted",
    `Nepotism consent given; ${candidate.name} filled ${officeLabel(nepotism.hire.officeId)}.`,
  );
}

/** The player holding an unplayed Hiring Preference blackmail card, if any. */
function hiringPreferenceHolder(state: GameState): PlayerId | undefined {
  // Crown blackmail cards stay face down (Crown Handbook p.2).
  return Object.values(state.players).find((player) =>
    !player.isCrown && player.blackmailCards.some((card) => card.cardId === HIRING_PREFERENCE_CARD_ID && card.facedown !== false),
  )?.id;
}

function createHiringPreferenceDecision(state: GameState, officeId: OfficeId, holder: PlayerId): PendingDecision {
  return {
    id: `decision-hiring-preference-${officeId}-turn-${state.turn}${immediateSuffix(state)}`,
    phase: state.phase,
    step: "hiring.hiringPreference",
    actor: holder,
    visibility: "private",
    prompt: `You are a candidate for ${officeLabel(officeId)}. Play Hiring Preference to force the hirer to choose you?`,
    legalCommands: [
      {
        type: "hiring.playHiringPreference",
        label: "Play Hiring Preference",
        description: "The hiring player must choose you; this ignores the Nepotism rule.",
        payload: { officeId } satisfies HiringPreferencePayload,
      },
      {
        type: "hiring.passHiringPreference",
        label: "Keep it facedown",
        description: `Let ${officeLabel(officeId)} be hired normally.`,
        payload: { officeId } satisfies HiringPreferencePayload,
      },
    ],
    canSave: true,
  };
}

// Hiring Preference (blackmail #6): "Play during hiring if you are a candidate. The hiring player
// must choose you. You may use this to ignore the Nepotism rule."
// It is played through Negotiation's blackmail path, so Man on the Inside may cancel it.
export function playHiringPreference(state: GameState, command: GameCommand): ApplyCommandResult {
  return resolveHiringPreference(state, command, true);
}

export function passHiringPreference(state: GameState, command: GameCommand): ApplyCommandResult {
  return resolveHiringPreference(state, command, false);
}

function resolveHiringPreference(state: GameState, command: GameCommand, play: boolean): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.hiringPreference")) {
    return hiringError("WRONG_PHASE", "Hiring Preference is not being offered now.", "phase");
  }

  const type = play ? "hiring.playHiringPreference" : "hiring.passHiringPreference";
  if (!isLegalPayload(state, type, command.payload)) {
    return hiringError("ILLEGAL_HIRING_CHOICE", "That Hiring Preference answer is not legal here.", "payload");
  }

  const { officeId } = command.payload as HiringPreferencePayload;
  const playerId = command.actorId as PlayerId;
  const player = state.players[playerId];
  const now = command.clientTimestamp;
  const offered: HiringState = {
    ...state.hiring,
    hiringPreferenceOffered: [...state.hiring.hiringPreferenceOffered, officeId],
  };

  if (!play) {
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "hiring.hiringPreferencePassed",
      summary: `${player.name} did not play a blackmail card for ${officeLabel(officeId)}.`,
      publicSummary: PRIVATE_DECISION_SUMMARY,
    });
    const next: GameState = { ...state, updatedAt: now, log: [...state.log, logEntry], hiring: offered };

    return { ok: true, logEntry, state: presentOfficeHire(next, officeId) };
  }

  const cardInstanceId = facedownBlackmailInstance(state, playerId, HIRING_PREFERENCE_CARD_ID);
  if (!cardInstanceId) return hiringError("ILLEGAL_HIRING_CHOICE", "You hold no face-down Hiring Preference.", "payload");

  // Played through the shared blackmail path so Man on the Inside may cancel it (p.12).
  const playing: GameState = { ...state, updatedAt: now, hiring: { ...offered, pendingPreferenceOffice: officeId } };
  const next = startBlackmailPlay(playing, {
    playerId,
    cardInstanceId,
    params: { officeId },
    resumeKey: HIRING_PREFERENCE_RESUME,
    timestamp: now,
  });
  return { ok: true, logEntry: next.log[next.log.length - 1], state: next };
}

const HIRING_PREFERENCE_RESUME = "hiring.hiringPreference";
registerInFlowBlackmail("blackmail.force-hire-self", "while an office you are a candidate for is being hired");

// Hiring Preference: its holder must be hired for the office, ignoring Nepotism. If Man on the
// Inside cancels it, the office is hired normally.
registerBlackmailResume(HIRING_PREFERENCE_RESUME, (state, play, outcome) => {
  const officeId = state.hiring.pendingPreferenceOffice ?? (play.params.officeId as OfficeId);
  const hiring: HiringState = {
    ...state.hiring,
    pendingPreferenceOffice: undefined,
    hiringPreference: outcome === "resolved" ? { officeId, playerId: play.playerId } : state.hiring.hiringPreference,
  };
  return presentOfficeHire({ ...state, hiring }, officeId);
});

export function skipHiringVacancy(state: GameState, command: GameCommand): ApplyCommandResult {
  if (!isHiringStep(state, "hiring.skipVacancy")) {
    return hiringError("WRONG_PHASE", "Hiring vacancies can only be skipped during the Hiring phase.", "phase");
  }

  const payload = parseSkipHiringVacancyPayload(command.payload);
  if (!payload || !isLegalPayload(state, "hiring.skipVacancy", payload)) {
    return hiringError("ILLEGAL_HIRING_CHOICE", "The requested Hiring vacancy cannot be skipped for this decision.", "payload.officeId");
  }

  // The office stays in the Vacant Offices box and is hired again next turn (p.14).
  const skipped: GameState = {
    ...state,
    hiring: { ...state.hiring, skippedThisTurn: [...state.hiring.skippedThisTurn, payload.officeId] },
  };
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: skipped,
    command,
    now,
    type: "hiring.vacancySkipped",
    summary: `${officeLabel(payload.officeId)} remained vacant.`,
    details: { officeId: payload.officeId, reason: state.pendingDecision.prompt },
  });

  return {
    ok: true,
    logEntry,
    state: afterOfficeResolved({ ...skipped, updatedAt: now, log: [...skipped.log, logEntry] }, payload.officeId),
  };
}

// ---------------------------------------------------------------------------------------------
// Governor General (p.26)
// ---------------------------------------------------------------------------------------------

export { installGovernorGeneral } from "../offices";

// ---------------------------------------------------------------------------------------------
// Candidate pools (card backs and pp.16-17)
// ---------------------------------------------------------------------------------------------

function nextVacantOfficeId(state: GameState): OfficeId | undefined {
  return state.company.vacantOffices
    .filter((officeId) => state.company.offices[officeId]?.vacant && !state.hiring.skippedThisTurn.includes(officeId))
    .sort((left, right) => hiringOfficeOrder(left) - hiringOfficeOrder(right))[0];
}

// Offices are hired in ascending order of the number on the back of each card (p.14).
function hiringOfficeOrder(officeId: OfficeId): number {
  return officeDefinition(officeId)?.hiringOrder ?? Number.MAX_SAFE_INTEGER;
}

function officeLabel(officeId: OfficeId): string {
  return officeDefinition(officeId)?.label ?? officeId;
}

/** Candidates the hirer may choose now, after Hiring Preference and refused self-hires. */
function candidateCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const hirer = determineOfficeHirer(state, officeId);
  const preference = state.hiring.hiringPreference;
  const refused = state.hiring.nepotismRefused.some((entry) => entry.officeId === officeId && entry.hirer === hirer);

  return createHireOfficeCommands(state, officeId).filter((command) => {
    const candidateId = (command.payload as HireOfficePayload).candidateId;
    if (preference?.officeId === officeId) return candidateId === preference.playerId;
    return !(refused && candidateId === hirer);
  });
}

function createHireOfficeCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const definition = officeDefinition(officeId);
  const pool = definition?.hiring?.candidatePool;
  if (!definition || !pool || !determineOfficeHirer(state, officeId)) return [];

  if (pool.type === "writers") {
    return createWriterHireCommands(state, officeId, enginePresidenciesForCandidatePool(definition));
  }

  switch (pool.rule) {
    case "director-of-trade-promotion-then-writers":
      return createPromotionThenWriterHireCommands(state, officeId);
    case "military-affairs":
      return createMilitaryAffairsHireCommands(state);
    case "president":
      return createPresidentHireCommands(state, officeId);
    case "governor":
      return createGovernorHireCommands(state, officeId);
  }
}

function createWriterHireCommands(
  state: GameState,
  officeId: OfficeId,
  eligiblePresidencies: readonly PresidencyId[] = PRESIDENCIES,
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const player of Object.values(state.players)) {
    for (const presidency of eligiblePresidencies) {
      if ((state.india.presidencies[presidency].writers[player.id] ?? 0) <= 0) continue;

      commands.push(
        hireCommand(state, officeId, player.id, { type: "writer", presidency }, `Hire ${player.name} ${presidency} writer`),
      );
    }
  }

  return commands;
}

/**
 * Director of Trade and Governor General: "Consider any office except Governors or the
 * Chairman. If none, writers." (card backs; p.16).
 */
function createPromotionThenWriterHireCommands(state: GameState, targetOfficeId: OfficeId): LegalCommand[] {
  const promotions: LegalCommand[] = [];
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
    if (!candidate) continue;

    promotions.push(
      hireCommand(
        state,
        targetOfficeId,
        candidate.id,
        { type: "office", officeId: office.id },
        `Promote ${candidate.name} from ${officeLabel(office.id)}`,
      ),
    );
  }

  return promotions.length > 0 ? promotions : createWriterHireCommands(state, targetOfficeId);
}

/** Military Affairs: "Consider Commanders. If none, officers. If none, officers-in-training." */
function createMilitaryAffairsHireCommands(state: GameState): LegalCommand[] {
  const commanders = createCommanderHireCommands(state, "military-affairs");
  if (commanders.length > 0) return commanders;

  const officers = createOfficerHireCommands(state, "military-affairs");
  if (officers.length > 0) return officers;

  return createOfficersInTrainingHireCommands(state, "military-affairs");
}

/** Presidents: "Consider writers and Governors associated with this Presidency." */
function createPresidentHireCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const definition = officeDefinition(officeId);
  if (definition?.category !== "presidency" || !definition.presidency) return [];

  const presidency = toEnginePresidency(definition.presidency);

  return [
    ...createWriterHireCommands(state, officeId, [presidency]),
    ...createGovernorPromotionCommands(state, officeId, presidency),
  ];
}

// Governors: chosen by the President the region is associated with; "Consider writers and
// officers in this Presidency" (card back). Writers on orders have already returned to their
// Presidency box during Refresh, so they are never candidates here.
function createGovernorHireCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const definition = officeDefinition(officeId);
  if (definition?.category !== "governor" || !definition.region) return [];

  const presidency = regionPresidency(state, definition.region);
  if (!presidency) return [];

  return [
    ...createWriterHireCommands(state, officeId, [presidency]),
    ...createOfficerHireCommands(state, officeId, [presidency]),
  ];
}

function createGovernorPromotionCommands(state: GameState, officeId: OfficeId, presidency: PresidencyId): LegalCommand[] {
  return Object.values(state.company.offices)
    .filter((office) => {
      if (office.vacant || !office.holder) return false;
      const definition = officeDefinition(office.id);
      return (
        definition?.category === "governor" &&
        definition.region !== undefined &&
        regionPresidency(state, definition.region) === presidency
      );
    })
    .map((office) => {
      const candidate = state.players[office.holder as PlayerId];
      return hireCommand(
        state,
        officeId,
        candidate.id,
        { type: "office", officeId: office.id },
        `Promote ${candidate.name} from ${officeLabel(office.id)}`,
      );
    });
}

function createCommanderHireCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const army of PRESIDENCIES) {
    const commanderId = state.company.armies[army].commander;
    const player = commanderId ? state.players[commanderId] : undefined;
    if (!player) continue;

    commands.push(hireCommand(state, officeId, player.id, { type: "commander", army }, `Hire ${player.name} ${army} Commander`));
  }

  return commands;
}

function createOfficerHireCommands(
  state: GameState,
  officeId: OfficeId,
  eligibleArmies: readonly ArmyId[] = PRESIDENCIES,
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const player of Object.values(state.players)) {
    for (const army of eligibleArmies) {
      for (const readiness of ["ready", "exhausted"] as const) {
        if ((state.company.armies[army].officers[player.id]?.[readiness] ?? 0) <= 0) continue;

        commands.push(
          hireCommand(
            state,
            officeId,
            player.id,
            { type: "officer", army, readiness },
            `Hire ${player.name} ${readiness} ${army} officer`,
          ),
        );
      }
    }
  }

  return commands;
}

function createOfficersInTrainingHireCommands(state: GameState, officeId: OfficeId): LegalCommand[] {
  return Object.values(state.players)
    .filter((player) => player.familyMembers.officersInTraining > 0)
    .map((player) =>
      hireCommand(state, officeId, player.id, { type: "officersInTraining" }, `Hire ${player.name} officer in training`),
    );
}

function hireCommand(
  state: GameState,
  officeId: OfficeId,
  candidateId: PlayerId,
  source: HireSource,
  label: string,
): LegalCommand {
  return {
    type: "hiring.hireOffice",
    label,
    description: `${label} as ${officeLabel(officeId)}.`,
    payload: { officeId, candidateId, source } satisfies HireOfficePayload,
  };
}

function isGovernorOffice(officeId: OfficeId): boolean {
  return officeDefinition(officeId)?.category === "governor";
}

function determineOfficeHirer(state: GameState, officeId: OfficeId): PlayerId | undefined {
  const definition = officeDefinition(officeId);
  const hirer = definition?.hiring?.hirer;
  if (!hirer) return undefined;

  if (hirer === "chairman") return holderOf(state, "chairman");

  if (hirer === "regionPresident") {
    const presidency = definition.region ? regionPresidency(state, definition.region) : undefined;
    return presidency ? presidentOf(state, presidency) : undefined;
  }

  // "The Governor General hires Presidents" once that office is in play (p.26).
  if (hirer.officeId === "director-of-trade" && state.company.governorGeneralInPlay) {
    return holderOf(state, "governor-general");
  }

  return holderOf(state, hirer.officeId);
}

function holderOf(state: GameState, officeId: OfficeId): PlayerId | undefined {
  const office = state.company.offices[officeId];
  return office && !office.vacant ? office.holder : undefined;
}

function officeDefinition(officeId: OfficeId): OfficeDefinition | undefined {
  return offices.find((office) => office.id === officeId);
}

function enginePresidenciesForCandidatePool(definition: OfficeDefinition): readonly PresidencyId[] {
  const pool = definition.hiring?.candidatePool;
  if (!pool || pool.type !== "writers" || pool.presidencies === "any") return PRESIDENCIES;

  return pool.presidencies.map(toEnginePresidency);
}

function prizeLabel(prizeId: string): string {
  const prize = prizes.find((candidate) => candidate.id === prizeId);
  return prize ? `£${prize.cost} prize` : prizeId;
}

// ---------------------------------------------------------------------------------------------
// Moving pieces
// ---------------------------------------------------------------------------------------------

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

function moveCandidateToOffice(state: GameState, payload: HireOfficePayload): GameState {
  switch (payload.source.type) {
    case "office":
      return promoteOfficeholderToOffice(state, payload, payload.source.officeId);
    case "writer":
      return moveWriterToOffice(state, payload, payload.source.presidency);
    default:
      return moveMilitaryCandidateToOffice(state, payload);
  }
}

function moveWriterToOffice(state: GameState, payload: HireOfficePayload, presidency: PresidencyId): GameState {
  const box = state.india.presidencies[presidency];
  const writers = box.writers[payload.candidateId] ?? 0;

  return {
    ...state,
    company: placeOfficeholder(state, payload.officeId, payload.candidateId, {
      familyMemberId: `writer-${presidency}-${state.turn}-${payload.candidateId}-${payload.officeId}`,
    }),
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        [presidency]: { ...box, writers: { ...box.writers, [payload.candidateId]: Math.max(0, writers - 1) } },
      },
    },
  };
}

function placeOfficeholder(
  state: GameState,
  officeId: OfficeId,
  holder: PlayerId,
  options: { familyMemberId: string; fatigue?: number },
): GameState["company"] {
  return {
    ...state.company,
    offices: {
      ...state.company.offices,
      [officeId]: {
        id: officeId,
        treasury: state.company.offices[officeId]?.treasury ?? 0,
        fatigue: options.fatigue ?? state.company.offices[officeId]?.fatigue ?? 0,
        created: true,
        vacant: false,
        actedThisTurn: false,
        holder,
        familyMemberId: options.familyMemberId,
      },
    },
    vacantOffices: state.company.vacantOffices.filter((candidate) => candidate !== officeId),
  };
}

// Promotions: the old office card goes to the Vacant Offices box, to be hired in its own order,
// and its fatigue moves with the officeholder (p.14).
function promoteOfficeholderToOffice(state: GameState, payload: HireOfficePayload, sourceOfficeId: OfficeId): GameState {
  const sourceOffice = state.company.offices[sourceOfficeId];
  const company = placeOfficeholder(state, payload.officeId, payload.candidateId, {
    familyMemberId: sourceOffice?.familyMemberId ?? `officeholder-${sourceOfficeId}-${state.turn}-${payload.candidateId}`,
    fatigue: sourceOffice?.fatigue ?? 0,
  });

  return {
    ...state,
    company: {
      ...company,
      offices: {
        ...company.offices,
        [sourceOfficeId]: {
          id: sourceOfficeId,
          treasury: sourceOffice?.treasury ?? 0,
          fatigue: 0,
          created: sourceOffice?.created ?? true,
          vacant: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: [...new Set([...company.vacantOffices, sourceOfficeId])],
    },
  };
}

function moveMilitaryCandidateToOffice(state: GameState, payload: HireOfficePayload): GameState {
  const removed = removeMilitaryCandidate(state, payload);

  return {
    ...removed,
    company: placeOfficeholder(removed, payload.officeId, payload.candidateId, {
      familyMemberId: `${payload.source.type}-${state.turn}-${payload.candidateId}-${payload.officeId}`,
    }),
  };
}

function removeMilitaryCandidate(state: GameState, payload: HireOfficePayload): GameState {
  const source = payload.source;
  if (source.type === "officersInTraining") {
    const player = state.players[payload.candidateId];
    return {
      ...state,
      players: {
        ...state.players,
        [payload.candidateId]: {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            officersInTraining: Math.max(0, player.familyMembers.officersInTraining - 1),
          },
        },
      },
    };
  }

  if (source.type !== "commander" && source.type !== "officer") return state;

  const army = state.company.armies[source.army];
  if (source.type === "commander") {
    return {
      ...state,
      company: { ...state.company, armies: { ...state.company.armies, [source.army]: { ...army, commander: undefined } } },
    };
  }

  const stack = army.officers[payload.candidateId] ?? { ready: 0, exhausted: 0 };

  return {
    ...state,
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [source.army]: {
          ...army,
          officers: {
            ...army.officers,
            [payload.candidateId]: { ...stack, [source.readiness]: Math.max(0, stack[source.readiness] - 1) },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------------------------

function parseChairmanElectionPayload(payload: unknown): ChairmanElectionPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { officeId?: unknown; candidateId?: unknown };
  if (raw.officeId !== "chairman" || typeof raw.candidateId !== "string") return undefined;

  return { officeId: "chairman", candidateId: raw.candidateId };
}

function parseSkipHiringVacancyPayload(payload: unknown): SkipHiringVacancyPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { officeId?: unknown };

  return typeof raw.officeId === "string" ? { officeId: raw.officeId } : undefined;
}

function parseHireOfficePayload(payload: unknown): HireOfficePayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as {
    officeId?: unknown;
    candidateId?: unknown;
    source?: { type?: unknown; presidency?: unknown; officeId?: unknown; army?: unknown; readiness?: unknown };
  };
  if (typeof raw.officeId !== "string" || typeof raw.candidateId !== "string" || !raw.source) return undefined;

  const base = { officeId: raw.officeId, candidateId: raw.candidateId };
  const source = raw.source;

  if (source.type === "office" && typeof source.officeId === "string") {
    return { ...base, source: { type: "office", officeId: source.officeId } };
  }
  if (source.type === "commander" && isPresidencyId(source.army)) {
    return { ...base, source: { type: "commander", army: source.army } };
  }
  if (source.type === "officer" && isPresidencyId(source.army) && isReadiness(source.readiness)) {
    return { ...base, source: { type: "officer", army: source.army, readiness: source.readiness } };
  }
  if (source.type === "officersInTraining") {
    return { ...base, source: { type: "officersInTraining" } };
  }
  if (source.type === "writer" && isPresidencyId(source.presidency)) {
    return { ...base, source: { type: "writer", presidency: source.presidency } };
  }

  return undefined;
}

function parseResolveNepotismConsentPayload(payload: unknown): ResolveNepotismConsentPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { accepted?: unknown; hire?: unknown };
  if (typeof raw.accepted !== "boolean") return undefined;

  const hire = parseHireOfficePayload(raw.hire);
  return hire ? { accepted: raw.accepted, hire } : undefined;
}

function isPresidencyId(value: unknown): value is PresidencyId {
  return value === "Bombay" || value === "Madras" || value === "Bengal";
}

function isReadiness(value: unknown): value is "ready" | "exhausted" {
  return value === "ready" || value === "exhausted";
}

function isLegalPayload(state: GameState, type: string, payload: unknown): boolean {
  const wanted = canonicalJson(payload ?? {});
  return state.pendingDecision.legalCommands.some(
    (command) => command.type === type && canonicalJson(command.payload ?? {}) === wanted,
  );
}

function canonicalJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;

  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hiringError(code: string, message: string, field: string): ApplyCommandResult {
  const errors: ValidationError[] = [{ code, message, field }];
  return { ok: false, errors };
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const hiringCommandHandlers: Record<string, CommandHandler> = {
  "hiring.electChairman": electChairman,
  "hiring.declareChairmanSupport": declareChairmanSupport,
  "hiring.emptyCourtChairman": emptyCourtChairman,
  "hiring.hireOffice": hireOffice,
  "hiring.resolveNepotismConsent": resolveNepotismConsent,
  "hiring.playHiringPreference": playHiringPreference,
  "hiring.passHiringPreference": passHiringPreference,
  "hiring.skipVacancy": skipHiringVacancy,
};
