import { SEA_ZONE_BY_PRESIDENCY, regionPresidencyId } from "../../phases/company-operation/context";
import { armyPieceTotals } from "../../phases/company-operation/military-affairs";
import { homePort, isOrderAvailable, orderNodes, shipsInPresidencyZone } from "../../phases/company-operation/trade";
import { PRESIDENCY_IDS, officeHolder } from "../../selectors";
import type { ArmyId, ArmyState, GameState, PlayerId, PresidencyId, ShipState } from "../../types";
import {
  CROWN_PLAYER_ID,
  byCrownPresidencyOrder,
  humanPlayerIds,
  isCrownPresidency,
  isPlayerPresidency,
  writersOf,
} from "../state";

// What the Handbook's office pages measure about a Presidency (pp.4-9): ships, writers, trade routes,
// who commands its Army. Pure reads of the game; the policies in ./offices-plans.ts rank with them.

export type Which = "most" | "fewest";

export function crownPresidencies(state: GameState): PresidencyId[] {
  return PRESIDENCY_IDS.filter((presidency) => isCrownPresidency(state, presidency));
}

export function playerPresidencies(state: GameState): PresidencyId[] {
  return PRESIDENCY_IDS.filter((presidency) => isPlayerPresidency(state, presidency));
}

/** Presidencies in the AI card's tie-break order (black arrow, white arrow, the rest; p.45). */
export function aiOrder<T extends PresidencyId>(state: GameState, presidencies: readonly T[]): T[] {
  return byCrownPresidencyOrder(state, [...presidencies], (presidency) => presidency);
}

/**
 * The Presidencies with the most (or fewest) of something, tied ones in AI card order. "Most" is
 * "comparatively more or equal, with a minimum of 1"; "fewest" includes zero (rulebook p.46).
 */
export function extreme<T extends PresidencyId>(
  state: GameState,
  presidencies: readonly T[],
  value: (presidency: T) => number,
  which: Which,
  options: { allowZero?: boolean } = {},
): T[] {
  if (presidencies.length === 0) return [];
  const values = presidencies.map(value);
  const best = which === "most" ? Math.max(...values) : Math.min(...values);
  if (which === "most" && best < 1 && !options.allowZero) return [];
  return aiOrder(state, presidencies.filter((presidency) => value(presidency) === best));
}

export function ships(state: GameState, presidency: PresidencyId): number {
  return shipsInPresidencyZone(state, presidency);
}

export function seaZoneOf(presidency: PresidencyId) {
  return SEA_ZONE_BY_PRESIDENCY[presidency];
}

export function presidencyOfZone(zone: string): PresidencyId | undefined {
  return PRESIDENCY_IDS.find((presidency) => SEA_ZONE_BY_PRESIDENCY[presidency] === zone);
}

export function hasOpenHomePort(state: GameState, presidency: PresidencyId): boolean {
  const port = homePort(state, presidency);
  return Boolean(port && !port.closed);
}

/**
 * The "trade route" of a Presidency: "the maximum number of orders a President could fill in one go,
 * irrespective of number of ships" (rulebook p.46), counted from its home port over open orders in
 * regions it may trade in.
 */
export function tradeRoute(state: GameState, presidency: PresidencyId): number {
  const nodes = orderNodes(state);
  const start = homePort(state, presidency);
  if (!start || !isOrderAvailable(start)) return 0;
  const seen = new Set([start.id]);
  const queue = [start.id];
  while (queue.length > 0) {
    const node = nodes.get(queue.shift()!)!;
    for (const nextId of node.order.connectedOrderIds) {
      const next = nodes.get(nextId);
      if (!next || seen.has(nextId) || !isOrderAvailable(next.order)) continue;
      const home = state.india.regions[next.regionId]?.homePresidency;
      if (home && home !== presidency) continue; // Home Region Privileges (p.20)
      seen.add(nextId);
      queue.push(nextId);
    }
  }
  return seen.size;
}

export function crownWriters(state: GameState, presidency: PresidencyId): number {
  return writersOf(state, presidency, CROWN_PLAYER_ID);
}

export function playerWriters(state: GameState, presidency: PresidencyId): number {
  return humanPlayerIds(state).reduce((total, playerId) => total + writersOf(state, presidency, playerId), 0);
}

export function allWriters(state: GameState, presidency: PresidencyId): number {
  return crownWriters(state, presidency) + playerWriters(state, presidency);
}

/** The Crown is Governor of a region answering to this Presidency. */
export function crownIsGovernor(state: GameState, presidency: PresidencyId): boolean {
  return Object.values(state.india.regions).some(
    (region) =>
      region.companyControlled &&
      regionPresidencyId(state, region.id) === presidency &&
      officeHolder(state, region.governorOffice) === CROWN_PLAYER_ID,
  );
}

export function crownIsCommander(state: GameState, army: ArmyId): boolean {
  return state.company.armies[army]?.commander === CROWN_PLAYER_ID;
}

export function playerIsCommander(state: GameState, army: ArmyId): boolean {
  const commander = state.company.armies[army]?.commander;
  return Boolean(commander && commander !== CROWN_PLAYER_ID);
}

export function officerCount(army: ArmyState, playerId: PlayerId): number {
  const stack = army.officers[playerId];
  return stack ? stack.ready + stack.exhausted : 0;
}

/** Pieces in an Army box by family: officers plus the Commander piece (p.19). */
export function armyTotals(army: ArmyState, extra?: PlayerId): Map<PlayerId, number> {
  const totals = armyPieceTotals(army);
  if (extra) totals.set(extra, (totals.get(extra) ?? 0) + 1);
  return totals;
}

/** "Majority": strictly more pieces than every other family (an equality is not a majority). */
export function hasMajority(totals: Map<PlayerId, number>, playerId: PlayerId): boolean {
  const mine = totals.get(playerId) ?? 0;
  if (mine < 1) return false;
  return [...totals.entries()].every(([other, count]) => other === playerId || count < mine);
}

/** Who holds a majority of pieces, if anyone. */
export function majorityHolder(totals: Map<PlayerId, number>): PlayerId | undefined {
  return [...totals.keys()].find((playerId) => hasMajority(totals, playerId));
}

export function crownHasArmyMajority(state: GameState, army: ArmyId): boolean {
  return hasMajority(armyTotals(state.company.armies[army]), CROWN_PLAYER_ID);
}

/** Majority counting officers only (the Peacock allocation list). */
export function crownHasOfficerMajority(state: GameState, army: ArmyId): boolean {
  const officers = state.company.armies[army].officers;
  const totals = new Map(Object.keys(officers).map((playerId) => [playerId, officerCount(state.company.armies[army], playerId)]));
  return hasMajority(totals, CROWN_PLAYER_ID);
}

// --- Ships ---

/** A player-kind ship whose shipyard the Crown owns. */
export function isCrownShip(state: GameState, ship: ShipState): boolean {
  return ship.kind === "player" && ownerOfShip(state, ship) === CROWN_PLAYER_ID;
}

export function ownerOfShip(state: GameState, ship: ShipState): PlayerId | undefined {
  if (ship.kind !== "player" || !ship.shipyardCardId) return undefined;
  return Object.values(state.players).find((player) =>
    player.enterprises.some((enterprise) => enterprise.type === "shipyard" && enterprise.cardId === ship.shipyardCardId),
  )?.id;
}

/**
 * Which of several ships to move: "Company ships, then non-fatigued ships, then Crown ships, then
 * player ships" (p.6), each step applied only if it leaves at least one ship.
 */
export function preferredShips(state: GameState, candidates: ShipState[]): ShipState[] {
  let set = candidates;
  const steps: Array<(ship: ShipState) => boolean> = [
    (ship) => ship.kind !== "player",
    (ship) => !ship.fatigued,
    (ship) => isCrownShip(state, ship),
    (ship) => ship.kind === "player",
  ];
  for (const step of steps) {
    const hit = set.filter(step);
    if (hit.length > 0) set = hit;
  }
  return set;
}
