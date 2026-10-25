import type { ScenarioDefinition } from "../data/types";
import type { PlayerId, RngState } from "./types";

/** Input every phase-state initializer receives from createNewGame. */
export type SubsystemInitInput = {
  scenario: ScenarioDefinition;
  seatingOrder: PlayerId[];
  rng: RngState;
};

/** Initializers return their state plus the advanced RNG, so shuffles stay deterministic. */
export type SubsystemInitResult<T> = {
  state: T;
  rng: RngState;
};
