import { rollDie } from "../../rng";
import type { GameCommand, GameLogEntry, GameState, RngRollRecord } from "../../types";
import type { EventsInIndiaProgress } from "../events-in-india.state";

/**
 * Resolution context for one command. Events in India works on a deep copy of the game state
 * (`draft`) and mutates it in place, which keeps the many small rule steps readable. The copy is
 * returned as the next state, so callers never see a partially updated state.
 */
export type ResolutionContext = {
  draft: GameState;
  command: GameCommand;
  now: string;
  pendingRolls: RngRollRecord[];
  lastEntry?: GameLogEntry;
};

export function createContext(state: GameState, command: GameCommand): ResolutionContext {
  return {
    // The game state is plain JSON (it is saved as JSON), so this is a faithful deep copy.
    draft: JSON.parse(JSON.stringify(state)) as GameState,
    command,
    now: command.clientTimestamp,
    pendingRolls: [],
  };
}

export function progress(ctx: ResolutionContext): EventsInIndiaProgress {
  const current = ctx.draft.eventsInIndia.progress;
  if (!current) throw new Error("Events in India is not in progress.");
  return current;
}

/** Roll one die through the game RNG; the roll is attached to the next log entry. */
export function roll(ctx: ResolutionContext, sides: number, label: string): number {
  const result = rollDie(ctx.draft.rng, sides, label);
  ctx.draft.rng = result.rng;
  ctx.pendingRolls.push(result.roll);
  return result.value;
}

export function log(ctx: ResolutionContext, type: string, summary: string, details?: unknown): GameLogEntry {
  const entry: GameLogEntry = {
    id: `log-${ctx.draft.log.length + 1}`,
    sequence: ctx.draft.log.length + 1,
    timestamp: ctx.now,
    turn: ctx.draft.turn,
    phase: ctx.draft.phase,
    actor: ctx.command.actorId,
    type,
    summary,
    details,
    commandId: ctx.command.id,
    rngRolls: ctx.pendingRolls.length > 0 ? ctx.pendingRolls : undefined,
  };
  ctx.pendingRolls = [];
  ctx.draft.log.push(entry);
  ctx.lastEntry = entry;
  return entry;
}

export function playerName(ctx: ResolutionContext, playerId: string | undefined): string {
  if (!playerId) return "nobody";
  return ctx.draft.players[playerId]?.name ?? playerId;
}

export function regionName(ctx: ResolutionContext, regionId: string | undefined): string {
  if (!regionId) return "nowhere";
  return ctx.draft.india.regions[regionId]?.name ?? regionId;
}
