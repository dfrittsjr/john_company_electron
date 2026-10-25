import type { GameState, PresidencyId } from "../../types";
import type { OfficeProgress, PresidencyActivity } from "../company-operation.state";
import { coState, withCo } from "./context";

export type PresidencyProgress = Extract<OfficeProgress, { office: "presidency" }>;

export function presidencyProgress(state: GameState, presidency: PresidencyId): PresidencyProgress {
  const current = coState(state).current;
  return current?.office === "presidency" && current.presidency === presidency
    ? current
    : { office: "presidency", presidency, commanderDone: false, governorsDone: [] };
}

export function withActivity(
  state: GameState,
  presidency: PresidencyId,
  activity: PresidencyActivity | undefined,
): GameState {
  return withCo(state, { current: { ...presidencyProgress(state, presidency), activity } });
}

export function withPresidencyProgress(state: GameState, progress: PresidencyProgress): GameState {
  return withCo(state, { current: progress });
}
