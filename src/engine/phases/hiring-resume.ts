import type { GameState } from "../types";

/**
 * Some offices are hired the moment they are created, outside the Hiring phase: the
 * Superintendent of Trade in China (p.18, p.25) and anything a law creates. The phase that
 * created the office registers how to continue once that hire is resolved, under a stable key
 * that is stored in the save (state.hiring.immediate.resumeKey). The function must return the
 * state with its next pending decision.
 *
 * This module has no imports from phase modules, so any phase can register at load time.
 */
export type HiringResumeHandler = (state: GameState) => GameState;

const handlers = new Map<string, HiringResumeHandler>();

export function registerHiringResume(key: string, handler: HiringResumeHandler): void {
  handlers.set(key, handler);
}

export function hiringResumeHandler(key: string): HiringResumeHandler | undefined {
  return handlers.get(key);
}
