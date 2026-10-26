import { CROWN_CLIMATES, localAlliances } from "../../../data";
import { commanderOf, presidentOf } from "../../selectors";
import type { CrownClimate, GameState, OrderState, PresidencyId, RegionId } from "../../types";
import type { CommanderActivity, DeploySelection, PresidencyActivity } from "../../phases/company-operation.state";
import { coState, presidentOfficeId } from "../../phases/company-operation/context";
import { defendingStrength } from "../../phases/company-operation/commander";
import { homePort, homeRegionOf, isOrderAvailable, orderNodes, shipsInPresidencyZone } from "../../phases/company-operation/trade";
import { climateName, crownClimate, crownEffects, CROWN_PLAYER_ID } from "../state";

// What the policies and favours of the Presidency operations area share (Handbook pp.10-13).

export function payloadOf(command: { payload?: unknown }): Record<string, unknown> {
  return (command.payload ?? {}) as Record<string, unknown>;
}

/** The value for the current climate from a bull / stag / lion / bear / peacock row. */
export function byClimate<T>(state: GameState, row: readonly [T, T, T, T, T]): T {
  return row[CROWN_CLIMATES.indexOf(crownClimate(state))];
}

export function label(state: GameState): string {
  return climateName(crownClimate(state));
}

export function climateIs(state: GameState, ...climates: CrownClimate[]): boolean {
  return climates.includes(crownClimate(state));
}

/** The Presidency whose operations are in progress (or about to be chosen, at the Presidency step). */
export function operatingPresidency(state: GameState): PresidencyId | undefined {
  const decision = state.pendingDecision;
  if (decision.step === "companyOperation.presidency") {
    const first = (decision.crown?.all ?? decision.legalCommands)[0];
    return payloadOf(first ?? { type: "", label: "" }).presidency as PresidencyId | undefined;
  }
  const current = coState(state).current;
  return current?.office === "presidency" ? current.presidency : undefined;
}

export function currentActivity(state: GameState): PresidencyActivity | undefined {
  const current = coState(state).current;
  return current?.office === "presidency" ? current.activity : undefined;
}

export function commanderActivity(state: GameState): CommanderActivity | undefined {
  const activity = currentActivity(state);
  return activity?.kind === "commander" ? activity : undefined;
}

export function isCrownPresident(state: GameState, presidency: PresidencyId): boolean {
  return presidentOf(state, presidency) === CROWN_PLAYER_ID;
}

export function isCrownCommander(state: GameState, presidency: PresidencyId): boolean {
  return commanderOf(state, presidency) === CROWN_PLAYER_ID;
}

/** Net change to a required number of dice from favours bought for `scope` ({ scope, delta } options). */
export function diceDelta(state: GameState, favorId: string, scope: string): number {
  return crownEffects(state, favorId)
    .filter((effect) => (effect.option as { scope?: string } | undefined)?.scope === scope)
    .reduce((total, effect) => total + ((effect.option as { delta?: number }).delta ?? 0), 0);
}

export function hasEffect(state: GameState, favorId: string, scope: string): boolean {
  return crownEffects(state, favorId).some((effect) => (effect.option as { scope?: string } | undefined)?.scope === scope);
}

/** "Increase or decrease the required number of dice by 1": the two options of that favour. */
export function diceOptions(scope: string): Array<{ label: string; option: unknown }> {
  return [
    { label: "one more die", option: { scope, delta: 1 } },
    { label: "one fewer die", option: { scope, delta: -1 } },
  ];
}

export function dice(count: number): string {
  return `${count} ${count === 1 ? "die" : "dice"}`;
}

// --- Trade (p.13) ---

/** Required dice to Trade: 2, 3, 4, 5, 6 from Bull to Peacock, adjusted by favours. */
export function tradeRequired(state: GameState, presidency: PresidencyId): number {
  return Math.max(1, byClimate(state, [2, 3, 4, 5, 6]) + diceDelta(state, "presidencies.trade.dice", `trade:${presidency}`));
}

export function presidentTreasury(state: GameState, presidency: PresidencyId): number {
  return state.company.offices[presidentOfficeId(presidency)]?.treasury ?? 0;
}

/** What filling this order earns the Company now (half value if a firm filled it, p.40). */
export function orderValue(order: OrderState): number {
  return order.filledThisTurnBy.length > 0 ? order.deregulationValue : order.value;
}

export type Route = { count: number; value: number };

/**
 * The best way to place writers: as many orders as possible (p.20), and of those the highest
 * total value. `placed` are orders already filled; `limit` is the number of ships.
 */
export function bestRoute(state: GameState, presidency: PresidencyId, allowed: ReadonlySet<RegionId>, limit: number, placed: string[] = []): Route {
  const nodes = orderNodes(state);
  const memo = new Map<string, Route>();
  const frontier = (ids: string[]): string[] => {
    if (ids.length === 0) {
      const port = homePort(state, presidency);
      return port && isOrderAvailable(port) ? [port.id] : [];
    }
    const next = new Set<string>();
    for (const id of ids) {
      for (const nextId of nodes.get(id)!.order.connectedOrderIds) {
        const node = nodes.get(nextId);
        if (!node || ids.includes(nextId) || !allowed.has(node.regionId) || !isOrderAvailable(node.order)) continue;
        next.add(nextId);
      }
    }
    return [...next];
  };
  const go = (ids: string[]): Route => {
    if (ids.length >= limit) return { count: 0, value: 0 };
    const key = [...ids].sort().join(",");
    const cached = memo.get(key);
    if (cached) return cached;
    let best: Route = { count: 0, value: 0 };
    for (const id of frontier(ids)) {
      const rest = go([...ids, id]);
      const candidate = { count: 1 + rest.count, value: orderValue(nodes.get(id)!.order) + rest.value };
      if (candidate.count > best.count || (candidate.count === best.count && candidate.value > best.value)) best = candidate;
    }
    memo.set(key, best);
    return best;
  };
  return go(placed);
}

/** Regions a Presidency may trade in: never another President's home region (p.20). */
export function tradeableRegions(state: GameState, presidency: PresidencyId): RegionId[] {
  return Object.values(state.india.regions)
    .filter((region) => !region.homePresidency || region.homePresidency === presidency)
    .map((region) => region.id);
}

export type TradePlan = { regions: RegionId[]; route: Route; penalty: number };

/**
 * The regions to declare for the highest value route the funds allow: "will trade in fewer regions
 * if that is the only way to reach the required minimum number of dice" (p.13). `declared` must stay
 * in the plan. Ties go to fewer regions (fewer dice lost).
 */
export function planTrade(state: GameState, presidency: PresidencyId, declared: RegionId[], treasury: number): TradePlan | undefined {
  const required = tradeRequired(state, presidency);
  const ships = shipsInPresidencyZone(state, presidency);
  const optional = tradeableRegions(state, presidency).filter((regionId) => !declared.includes(regionId));
  let best: TradePlan | undefined;
  for (let mask = 0; mask < 1 << optional.length; mask += 1) {
    const regions = [...declared, ...optional.filter((_, index) => mask & (1 << index))];
    const penalty = regions.length - 1;
    if (treasury < penalty + required) continue;
    const route = bestRoute(state, presidency, new Set(regions), ships);
    if (route.count === 0) continue;
    if (
      !best ||
      route.value > best.route.value ||
      (route.value === best.route.value && regions.length < best.regions.length) ||
      (route.value === best.route.value && regions.length === best.regions.length && route.count > best.route.count)
    ) {
      best = { regions, route, penalty };
    }
  }
  return best;
}

/** Region distances from a Presidency's home region over the map (0 for the home region). */
export function regionDistances(state: GameState, presidency: PresidencyId): Map<RegionId, number> {
  const start = homeRegionOf(state, presidency);
  const distances = new Map<RegionId, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of state.india.regions[id].adjacent) {
      if (distances.has(next)) continue;
      distances.set(next, distances.get(id)! + 1);
      queue.push(next);
    }
  }
  return distances;
}

// --- Commanders (pp.11-12) ---

export type Unit =
  | { kind: "alliance"; allianceId: string; value: number }
  | { kind: "officer"; playerId: string; value: 1 }
  | { kind: "regiment"; value: 1 };

export const EMPTY_SELECTION: DeploySelection = { officers: {}, regiments: 0, alliances: [] };

export function allianceStrength(allianceId: string): number {
  return localAlliances.find((alliance) => alliance.id === allianceId)?.strength ?? 0;
}

/** Pieces of the Army that are ready and not yet picked for this Deploy, one unit per piece. */
export function readyUnits(state: GameState, presidency: PresidencyId, selection: DeploySelection = EMPTY_SELECTION): Unit[] {
  const army = state.company.armies[presidency];
  const units: Unit[] = [];
  for (const [allianceId, status] of Object.entries(army.localAlliances ?? {})) {
    if (status === "ready" && !selection.alliances.includes(allianceId)) units.push({ kind: "alliance", allianceId, value: allianceStrength(allianceId) });
  }
  for (const [playerId, stack] of Object.entries(army.officers)) {
    for (let index = 0; index < stack.ready - (selection.officers[playerId] ?? 0); index += 1) units.push({ kind: "officer", playerId, value: 1 });
  }
  for (let index = 0; index < army.regiments.ready - selection.regiments; index += 1) units.push({ kind: "regiment", value: 1 });
  return units;
}

/** Army strength: the dice its ready officers, regiments and Local Alliances would give. */
export function armyStrength(state: GameState, presidency: PresidencyId): number {
  return readyUnits(state, presidency).reduce((total, unit) => total + unit.value, 0);
}

/** Whether some subset of the values adds up to exactly `target`. */
export function canMake(target: number, values: number[]): boolean {
  if (target < 0) return false;
  let reachable = new Set<number>([0]);
  for (const value of values) {
    const next = new Set(reachable);
    for (const sum of reachable) if (sum + value <= target) next.add(sum + value);
    reachable = next;
    if (reachable.has(target)) return true;
  }
  return reachable.has(target);
}

/** Dice the Crown Commander needs to roll in a region (p.12): 6 down to 2 outside the Company, 2 up to 6 inside. */
export function deployRequired(state: GameState, presidency: PresidencyId, regionId: RegionId): number {
  const company = state.india.regions[regionId].companyControlled;
  const base = byClimate(state, company ? [2, 3, 4, 5, 6] : [6, 5, 4, 3, 2]);
  return Math.max(1, base + diceDelta(state, "presidencies.commander.dice", `commander:${presidency}`));
}

/** Pieces worth exactly the dice needed (the required roll plus the region's strength) can be found. */
export function deployFeasible(state: GameState, presidency: PresidencyId, regionId: RegionId): boolean {
  const need = deployRequired(state, presidency, regionId) + defendingStrength(state, regionId);
  return canMake(need, readyUnits(state, presidency).map((unit) => unit.value));
}

/** Deploys the Crown Commander takes: one, and "again" on Bear and Peacock, as the favours change it (p.12). */
export function deploysAllowed(state: GameState, presidency: PresidencyId): number {
  const scope = `commander:${presidency}`;
  if (hasEffect(state, "presidencies.commander.notAgain", scope)) return 1;
  if (hasEffect(state, "presidencies.commander.again", scope)) return 2;
  return climateIs(state, "bear", "peacock") ? 2 : 1;
}
