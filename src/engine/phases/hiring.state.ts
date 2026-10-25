import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { ArmyId, OfficeId, PhaseId, PlayerId, PresidencyId } from "../types";

/** Where a hired family member comes from. */
export type HireSource =
  | { type: "writer"; presidency: PresidencyId }
  | { type: "office"; officeId: OfficeId }
  | { type: "commander"; army: ArmyId }
  | { type: "officer"; army: ArmyId; readiness: "ready" | "exhausted" }
  | { type: "officersInTraining" };

export type HireOfficePayload = {
  officeId: OfficeId;
  candidateId: PlayerId;
  source: HireSource;
};

/** Chairman election by Company-share support (p.15). */
export type ChairmanElectionState = {
  /** Holder of the Chairman marker, who declares the majority and breaks deadlocks. */
  formerChairman?: PlayerId;
  totalShares: number;
  requiredShares: number;
  /** Players with at least one Company share in the Court. */
  candidates: PlayerId[];
  /** Shareholders, clockwise from the former Chairman, in the order they declare support. */
  supportOrder: PlayerId[];
  nextSupporterIndex: number;
  /** Shareholder -> candidate they back with all of their shares (null: no support). */
  support: Record<PlayerId, PlayerId | null>;
};

/** Collecting consent from each other player in the candidate pool for a self-hire (p.14). */
export type NepotismConsentState = {
  hire: HireOfficePayload;
  hirer: PlayerId;
  pending: PlayerId[];
  consented: PlayerId[];
};

/** State owned by the Hiring phase (rulebook pp.14-17). */
export type HiringState = {
  /** Offices skipped this phase for want of a hirer or candidates. They stay vacant (p.14). */
  skippedThisTurn: OfficeId[];
  /** Self-hires refused by another player this turn: the hirer must choose someone else. */
  nepotismRefused: Array<{ officeId: OfficeId; hirer: PlayerId }>;
  /** Offices for which the Hiring Preference holder has already been asked this turn. */
  hiringPreferenceOffered: OfficeId[];
  /** Hiring Preference played for this office: the hirer must choose this player. */
  hiringPreference?: { officeId: OfficeId; playerId: PlayerId };
  /** Hiring Preference was played for this office and waits for Man on the Inside to answer. */
  pendingPreferenceOffice?: OfficeId;
  election?: ChairmanElectionState;
  nepotism?: NepotismConsentState;
  /** An office created outside the Hiring phase and hired at once (p.18, p.25). */
  immediate?: { officeId: OfficeId; resumeKey: string; phase: PhaseId };
};

export function createInitialHiringState(input: SubsystemInitInput): SubsystemInitResult<HiringState> {
  return {
    state: { skippedThisTurn: [], nepotismRefused: [], hiringPreferenceOffered: [] },
    rng: input.rng,
  };
}
