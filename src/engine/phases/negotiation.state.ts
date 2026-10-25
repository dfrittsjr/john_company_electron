import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";

/** State owned by this phase: promise cards, transfers and consent requests between players (p.8). */
export type NegotiationState = {};

export function createInitialNegotiationState(input: SubsystemInitInput): SubsystemInitResult<NegotiationState> {
  return { state: {}, rng: input.rng };
}
