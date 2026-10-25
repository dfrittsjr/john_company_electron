import type { CommandHandler } from "../command-handler";
import type { GameState } from "../types";
import { investmentCommandHandlers, startFirmInvestments } from "./firms/investments";
import { strategyCommandHandlers } from "./firms/strategy";

// The Firms phase (rulebook pp.38-40), between Family and Hiring once the game is deregulated:
// Firm Investments (firms/investments.ts), then Firm Strategy (firms/strategy.ts), then Hiring.
// See docs/phases/deregulation.md and docs/phases/deregulation-fp.md.

/** Called at the end of the Family phase when deregulated (family.ts). */
export function startFirmsPhase(state: GameState): GameState {
  return startFirmInvestments(state);
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const firmsCommandHandlers: Record<string, CommandHandler> = {
  ...investmentCommandHandlers,
  ...strategyCommandHandlers,
};
