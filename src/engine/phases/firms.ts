import type { CommandHandler } from "../command-handler";
import type { GameState } from "../types";
import { startHiringPhase } from "./hiring";

// The Firms phase (rulebook pp.38-40), between Family and Hiring once the game is deregulated:
// Firm Investments, then Firm Strategy. See docs/phases/deregulation.md.

/** Called at the end of the Family phase when deregulated (family.ts). */
export function startFirmsPhase(state: GameState): GameState {
  return startHiringPhase(state);
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const firmsCommandHandlers: Record<string, CommandHandler> = {};
