import type { GameState } from "../types";
import { createSystemDecision } from "./shared";

// The start of a turn, after Upkeep and Refresh, before the London Season (p.11).
// With Deregulation available (1758, Long 1710), the Vote to Deregulate comes first when Standing or
// Debt is on a lined space (p.36). Parliament owns that session: see docs/phases/deregulation.md.

/** The state at the start of `state.turn` (already advanced), with its first decision. */
export function beginTurn(state: GameState): GameState {
  return { ...state, pendingDecision: londonSeasonStartDecision(state) };
}

/** "Begin the London Season" for the current turn. */
export function londonSeasonStartDecision(state: GameState) {
  return createSystemDecision({
    id: `decision-london-season-confirm-turn-${state.turn}`,
    phase: "londonSeason",
    step: "londonSeason.confirm",
    prompt: "Begin the London Season: attrition, retirements, and prestige cards.",
    commandType: "londonSeason.confirm",
    label: "Begin London Season",
    description: "Roll attrition for every office card, then retire pensioners (p.11).",
  });
}
