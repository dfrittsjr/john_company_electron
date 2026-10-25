import { createRngState, rollDie, type GameState, type RegionState, type RngState } from "../../engine";
import { createHotseatGame } from "./game";

// Builders for Events in India tests. Storm die values map to faces in data order (p.28 template):
// 1-2 → four events, no storms; 3 → East storm, two events; 4 → all storms, one event;
// 5 → South storm, three events; 6 → West storm, two events.
export const ONE_EVENT_ALL_STORMS = 4;
export const TWO_EVENTS_WEST_STORM = 6;

/**
 * A fresh RNG whose next d6 rolls are exactly `rolls` (null matches anything). Every roll in this
 * phase is a d6 except shuffles, so tests choose dice outcomes by searching seeds.
 */
export function rngWithRolls(rolls: Array<number | null>): RngState {
  for (let index = 0; index < 200_000; index += 1) {
    let rng = createRngState(`events-${index}`);
    let matches = true;
    for (const wanted of rolls) {
      const result = rollDie(rng, 6);
      rng = result.rng;
      if (wanted !== null && result.value !== wanted) {
        matches = false;
        break;
      }
    }
    if (matches) return createRngState(`events-${index}`);
  }
  throw new Error(`No seed produces rolls ${rolls.join(",")}.`);
}

/** A 1710 game (no setup cards) entering Events in India with a chosen draw stack and dice. */
export function eventsInIndiaState(options: {
  drawPile: string[];
  rolls?: Array<number | null>;
  seed?: string;
}): GameState {
  const state = createHotseatGame({ seed: options.seed ?? "events-in-india", gameId: "game-events-in-india" });

  return {
    ...state,
    phase: "eventsInIndia",
    rng: rngWithRolls(options.rolls ?? [ONE_EVENT_ALL_STORMS]),
    eventsInIndia: { ...state.eventsInIndia, drawPile: options.drawPile, discards: [] },
    pendingDecision: {
      id: "decision-events-in-india-test",
      phase: "eventsInIndia",
      step: "eventsInIndia.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Events in India.",
      legalCommands: [{ type: "eventsInIndia.confirm", label: "Resolve Events in India", payload: {} }],
      canSave: true,
    },
  };
}

export function withRegion(state: GameState, regionId: string, changes: Partial<RegionState>): GameState {
  return {
    ...state,
    india: {
      ...state.india,
      regions: { ...state.india.regions, [regionId]: { ...state.india.regions[regionId], ...changes } },
    },
  };
}

export function withOrdersClosed(state: GameState, closed: Record<string, boolean>): GameState {
  return {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([regionId, region]) => [
          regionId,
          {
            ...region,
            orders: region.orders.map((order) =>
              order.id in closed ? { ...order, closed: closed[order.id] } : order,
            ),
          },
        ]),
      ),
    },
  };
}

export function withElephant(state: GameState, regionId: string, facing?: string): GameState {
  return { ...state, india: { ...state.india, elephant: { regionId, facing } } };
}

/** Remove every empire flag, leaving all regions sovereign. */
export function withoutEmpires(state: GameState): GameState {
  return {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([regionId, region]) => [
          regionId,
          { ...region, empireFlag: undefined, isCapital: false },
        ]),
      ),
    },
  };
}
