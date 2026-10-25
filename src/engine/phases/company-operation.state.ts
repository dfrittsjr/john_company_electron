import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";

/** State owned by this phase: progress through the red-ribbon offices and in-flight office actions (pp.17-26). */
export type CompanyOperationState = {};

export function createInitialCompanyOperationState(input: SubsystemInitInput): SubsystemInitResult<CompanyOperationState> {
  return { state: {}, rng: input.rng };
}
