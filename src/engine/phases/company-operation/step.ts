import { officeHolder } from "../../selectors";
import type { GameCommand, GameState, OfficeId, RngRollRecord } from "../../types";
import { coState, isLawInEffect, primeMinister, withCo } from "./context";

/** One Company Operation command's effect; the dispatcher adds the log entry and next decision. */
export type StepResult = {
  state: GameState;
  summary: string;
  details?: unknown;
  rngRolls?: RngRollRecord[];
  /** Leads the summary for the actor only (a declined face-down card); see createCommandLogEntry. */
  privateNote?: string;
};

export type OperationStep = (state: GameState, command: GameCommand) => StepResult;

/** Mark a red-ribbon office as finished and offer any law that triggers when an office finishes. */
export function finishOffice(state: GameState, officeId: OfficeId): GameState {
  const co = coState(state);
  const next = withCo(state, {
    actedOffices: [...new Set([...(co.actedOffices ?? []), officeId])],
    current: undefined,
    interrupt: undefined,
  });

  if (officeId === "military-affairs" && isLawInEffect(next, "military-oversight") && primeMinister(next)) {
    return withCo(next, { interrupt: { kind: "militaryOversight", stage: "demote" } });
  }

  return withBoardOfControlOffer(next, officeId);
}

/**
 * Board of Control (law #34): once per turn, after any office except the Chairman has finished
 * acting, the Prime Minister may remove its officeholder.
 */
export function withBoardOfControlOffer(state: GameState, officeId: OfficeId): GameState {
  const co = coState(state);
  if (
    officeId === "chairman" ||
    co.boardOfControlUsed ||
    !isLawInEffect(state, "board-of-control") ||
    !primeMinister(state) ||
    !officeHolder(state, officeId) ||
    // Assumption: removing your own officeholder is never worth a prompt after every office.
    officeHolder(state, officeId) === primeMinister(state)
  ) {
    return state;
  }

  return withCo(state, { interrupt: { kind: "boardOfControl", officeId } });
}
