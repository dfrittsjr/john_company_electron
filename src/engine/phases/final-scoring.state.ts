import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { PlayerId } from "../types";

/** Power sources at Final Scoring (p.9). */
export type PowerBreakdown = {
  /** Enterprises (including prestige enterprises) and Company shares valued by the Power track. */
  powerTrack: number;
  primeMinister: number;
  passedLaws: number;
  /** Printed power on blackmail (face up or down) and prestige cards (e.g. Becky Sharp). */
  cards: number;
  trophies: number;
  total: number;
};

export type FinalScoringEntry = {
  label: string;
  victoryPoints: number;
};

export type FinalScoringPlayerResult = {
  playerId: PlayerId;
  victoryPointsBefore: number;
  power: PowerBreakdown;
  entries: FinalScoringEntry[];
  finalVictoryPoints: number;
  windowIcons: number;
  rank: number;
};

/** State owned by this phase: final scoring breakdown per player (p.9). */
export type FinalScoringState = {
  companySurvived?: boolean;
  /** Company failure card drawn when the Company failed (p.9). */
  failureCardId?: string;
  /**
   * Scored at the start of Final Scoring before the rest (p.37): firm shares, Debtor's Prison and the
   * opening special retirement. Already in the player's VP, so shown but not added again.
   */
  openingEntries?: Record<PlayerId, FinalScoringEntry[]>;
  /** VP each player had before the opening special retirement. */
  victoryPointsBeforeSpecial?: Record<PlayerId, number>;
  /** Discounts and Letters used in the opening special retirement; they last the whole Final Scoring (p.12). */
  specialCarry?: { usedDiscounts: Record<PlayerId, string[]>; lettersOfIntroduction: PlayerId[] };
  /** VP each player had before the final retirement, to report what retirement added. */
  victoryPointsBeforeRetirement?: Record<PlayerId, number>;
  players?: Record<PlayerId, FinalScoringPlayerResult>;
  /** Players from first to last after tie-breakers (window icons, then Prime Minister order). */
  ranking?: PlayerId[];
  complete?: boolean;
};

export function createInitialFinalScoringState(input: SubsystemInitInput): SubsystemInitResult<FinalScoringState> {
  return { state: {}, rng: input.rng };
}
