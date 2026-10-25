import { createRngState, type GameState, type OfficeId, type PlayerId, type RegionState, type ShipState } from "../../engine";
import { createNextCompanyOperationDecision } from "../../engine/phases/company-operation";
import { applyCommandOrThrow, createHotseatGame } from "./game";

// Builders for Company Operation tests (rulebook pp.17-26).

export const RED = "player-red";
export const BLUE = "player-blue";
export const YELLOW = "player-yellow";

export const OFFICES_BEFORE_PRESIDENCIES: OfficeId[] = [
  "chairman",
  "director-of-trade",
  "manager-of-shipping",
  "military-affairs",
];

export function operationGame(seed: string): GameState {
  const state = createHotseatGame({ seed, gameId: `game-${seed}` });
  return { ...state, company: { ...state.company, vacantOffices: [] } };
}

/** Enter Company Operation as if the listed offices had already acted this turn. */
export function enterOperation(state: GameState, acted: OfficeId[] = []): GameState {
  const ready: GameState = {
    ...state,
    phase: "companyOperation",
    companyOperation: { turn: state.turn, actedOffices: acted },
  };
  return { ...ready, pendingDecision: createNextCompanyOperationDecision(ready) };
}

export function act(state: GameState, type: string, payload: unknown, actorId?: string): GameState {
  return applyCommandOrThrow(state, {
    id: `command-co-${state.log.length + 1}`,
    actorId: actorId ?? (state.pendingDecision.actor === "simultaneous" ? undefined : state.pendingDecision.actor),
    type,
    payload,
  });
}

/** Apply the listed legal command whose payload matches (by subset). */
export function choose(state: GameState, match: Record<string, unknown>): GameState {
  const legal = state.pendingDecision.legalCommands.find((command) =>
    Object.entries(match).every(([key, value]) => (command.payload as Record<string, unknown>)?.[key] === value),
  );
  if (!legal) {
    throw new Error(
      `No legal command matches ${JSON.stringify(match)} in ${state.pendingDecision.step}: ${state.pendingDecision.legalCommands
        .map((command) => JSON.stringify(command.payload))
        .join(" | ")}`,
    );
  }
  return act(state, legal.type, legal.payload);
}

export function payloads(state: GameState): Array<Record<string, unknown>> {
  return state.pendingDecision.legalCommands.map((command) => command.payload as Record<string, unknown>);
}

/** Try RNG seeds in a fixed order until `run` produces a state `accept` likes (deterministic dice). */
export function withDice(state: GameState, run: (state: GameState) => GameState, accept: (state: GameState) => boolean): GameState {
  for (let index = 0; index < 5000; index += 1) {
    const seeded: GameState = { ...state, rng: createRngState(`co-dice-${index}`) };
    const result = run(seeded);
    if (accept(result)) return result;
  }
  throw new Error("No seed produced the wanted dice.");
}

export function withTreasury(state: GameState, officeId: OfficeId, treasury: number): GameState {
  const office = state.company.offices[officeId];
  return {
    ...state,
    company: { ...state.company, offices: { ...state.company.offices, [officeId]: { ...office, treasury } } },
  };
}

export function withShips(state: GameState, location: ShipState["location"], count: number, kind: ShipState["kind"] = "company"): GameState {
  const ships: ShipState[] = Array.from({ length: count }, (_, index) => ({
    id: `test-${kind}-${location}-${index + 1}`,
    kind,
    location,
    fatigued: false,
  }));
  return { ...state, company: { ...state.company, ships: [...state.company.ships, ...ships] } };
}

export function withRegion(state: GameState, regionId: string, patch: Partial<RegionState>): GameState {
  return {
    ...state,
    india: { ...state.india, regions: { ...state.india.regions, [regionId]: { ...state.india.regions[regionId], ...patch } } },
  };
}

export function withOrder(state: GameState, orderId: string, patch: { closed?: boolean }): GameState {
  return {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([regionId, region]) => [
          regionId,
          { ...region, orders: region.orders.map((order) => (order.id === orderId ? { ...order, ...patch } : order)) },
        ]),
      ),
    },
  };
}

export function withLaw(state: GameState, lawId: string): GameState {
  return {
    ...state,
    parliament: { ...state.parliament, passedLaws: [...state.parliament.passedLaws, { id: `law-${lawId}`, lawId }] },
  };
}

export function withBlackmail(state: GameState, playerId: PlayerId, cardId: string): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, blackmailCards: [...player.blackmailCards, { id: `card-${cardId}`, cardId, facedown: true }] },
    },
  };
}

export function withPrestige(state: GameState, playerId: PlayerId, cardId: string): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, prestigeCards: [...player.prestigeCards, { id: `card-${cardId}`, cardId }] },
    },
  };
}

export function withSeating(state: GameState, seatingOrder: PlayerId[]): GameState {
  return { ...state, seatingOrder };
}
