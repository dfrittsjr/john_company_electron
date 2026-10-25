import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";

/** State owned by this phase: event tile draw stack, discards, storm die result and in-flight event resolution (pp.28-33). */
export type EventsInIndiaState = {};

export function createInitialEventsInIndiaState(input: SubsystemInitInput): SubsystemInitResult<EventsInIndiaState> {
  return { state: {}, rng: input.rng };
}
