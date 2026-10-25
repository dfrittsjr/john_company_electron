import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";

/** State owned by this phase: London Season display, deck and retirement spending (rulebook pp.11-12). */
export type LondonSeasonState = {};

export function createInitialLondonSeasonState(input: SubsystemInitInput): SubsystemInitResult<LondonSeasonState> {
  return { state: {}, rng: input.rng };
}
