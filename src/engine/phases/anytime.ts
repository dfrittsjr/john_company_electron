import type { CommandHandler } from "../command-handler";
import { negotiationAnytimeCommandHandlers } from "./negotiation";
import { blackmailAnytimeCommandHandlers } from "./negotiation-blackmail";
import { crownAnytimeCommandHandlers } from "../crown/commands";

/**
 * Commands a player may take at any time, outside the pending decision: transfers between
 * players, calling in promise cards, blackmail played "anytime" (rulebook p.8), and in Crown games
 * favours and promise cubes (p.46; a favour checks its own timing).
 * The dispatcher checks the game id and that the actor is a player, but not the decision id.
 * A handler must regenerate the pending decision's legal commands if its change affects them.
 */
export const anytimeCommandHandlers: Record<string, CommandHandler> = {
  ...negotiationAnytimeCommandHandlers,
  ...blackmailAnytimeCommandHandlers,
  // Favours bought from the Crown and promise cubes changing hands (rulebook pp.44, 46).
  ...crownAnytimeCommandHandlers,
};
