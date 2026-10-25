import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";

/** State owned by this phase: final scoring breakdown per player (p.9). */
export type FinalScoringState = {};

export function createInitialFinalScoringState(input: SubsystemInitInput): SubsystemInitResult<FinalScoringState> {
  return { state: {}, rng: input.rng };
}
