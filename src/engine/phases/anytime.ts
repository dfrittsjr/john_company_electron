import type { CommandHandler } from "../command-handler";

/**
 * Commands a player may take at any time, outside the pending decision: transfers between
 * players, calling in promise cards, and blackmail played "anytime" (rulebook p.8).
 * The dispatcher checks the game id and that the actor is a player, but not the decision id.
 * A handler must regenerate the pending decision's legal commands if its change affects them.
 */
export const anytimeCommandHandlers: Record<string, CommandHandler> = {};
