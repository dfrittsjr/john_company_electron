// Events in India effects that dilemmas trigger during Parliament (rulebook pp.28-33).
// TODO(EV): replace these with the shared Events in India helpers once they exist, so Turmoil,
// Cascade and Foreign Invasion behave identically wherever they are triggered.
import { stormDieFaces, stormSeaZoneRegion } from "../../../data";
import { rollDie } from "../../rng";
import type { GameState, RegionId, RegionState } from "../../types";
import type { Collector } from "./common";
import { updatePlayer } from "./common";

function updateRegion(state: GameState, regionId: RegionId, update: (region: RegionState) => RegionState): GameState {
  const region = state.india.regions[regionId];
  if (!region) return state;
  return {
    ...state,
    india: { ...state.india, regions: { ...state.india.regions, [regionId]: update(region) } },
  };
}

/** Closes an order. A writer on it goes back to its owner's supply; a filled token is flipped (p.28). */
export function closeOrder(state: GameState, regionId: RegionId, orderId: string): GameState {
  const order = state.india.regions[regionId]?.orders.find((candidate) => candidate.id === orderId);
  if (!order || order.closed) return state;

  const withWriterHome = order.writer
    ? updatePlayer(state, order.writer.playerId, (player) => ({
        ...player,
        familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 },
      }))
    : state;

  return updateRegion(withWriterHome, regionId, (region) => ({
    ...region,
    orders: region.orders.map((candidate) =>
      candidate.id === orderId ? { ...candidate, closed: true, writer: undefined, filledThisTurnBy: [] } : candidate,
    ),
  }));
}

function northernmostOpenOrder(region: RegionState) {
  return region.orders
    .filter((order) => !order.closed)
    .sort((left, right) => left.boardPosition.y - right.boardPosition.y)[0];
}

function regionOfOrder(state: GameState, orderId: string): RegionState | undefined {
  return Object.values(state.india.regions).find((region) => region.orders.some((order) => order.id === orderId));
}

/**
 * Cascade (p.28): close all open orders connected to this region's orders. Where a connected order
 * is already closed, close the northernmost open order in its region instead; if that region is
 * fully closed it cascades too. Each region overflows at most once per event.
 */
export function cascade(state: GameState, regionId: RegionId, cascaded: Set<RegionId>, collector: Collector): GameState {
  if (cascaded.has(regionId)) return state;
  cascaded.add(regionId);
  collector.notes.push(`Cascade from ${state.india.regions[regionId]?.name ?? regionId}.`);

  let next = state;
  const region = next.india.regions[regionId];
  if (!region) return next;

  const connected = region.orders.flatMap((order) => order.connectedOrderIds);
  for (const orderId of connected) {
    const targetRegion = regionOfOrder(next, orderId);
    if (!targetRegion || targetRegion.id === regionId) continue;
    const order = targetRegion.orders.find((candidate) => candidate.id === orderId);
    if (order && !order.closed) {
      next = closeOrder(next, targetRegion.id, orderId);
      continue;
    }

    const fallback = northernmostOpenOrder(next.india.regions[targetRegion.id]);
    if (fallback) {
      next = closeOrder(next, targetRegion.id, fallback.id);
    } else {
      next = cascade(next, targetRegion.id, cascaded, collector);
    }
  }

  return next;
}

/** Turmoil (p.31): close the northernmost open order, or Cascade if every order is closed. */
export function turmoil(state: GameState, regionId: RegionId, collector: Collector): GameState {
  const region = state.india.regions[regionId];
  if (!region) return state;
  const order = northernmostOpenOrder(region);
  if (order) {
    collector.notes.push(`Turmoil closed the £${order.value} order in ${region.name}.`);
    return closeOrder(state, regionId, order.id);
  }

  return cascade(state, regionId, new Set(), collector);
}

/** Close every open order in a region, or Cascade if all are already closed (p.33). */
export function closeAllOrders(state: GameState, regionId: RegionId, collector: Collector): GameState {
  const region = state.india.regions[regionId];
  if (!region) return state;
  const open = region.orders.filter((order) => !order.closed);
  if (open.length === 0) return cascade(state, regionId, new Set(), collector);

  return open.reduce((next, order) => closeOrder(next, regionId, order.id), state);
}

export function addUnrestToCompanyRegions(state: GameState, collector: Collector): GameState {
  const controlled = Object.values(state.india.regions).filter((region) => region.companyControlled);
  if (controlled.length > 0) {
    collector.notes.push(`Added 1 unrest to ${controlled.map((region) => region.name).join(", ")}.`);
  }
  return controlled.reduce(
    (next, region) => updateRegion(next, region.id, (current) => ({ ...current, unrest: current.unrest + 1 })),
    state,
  );
}

/** Defending strength: the region's tower plus every other region in its empire (p.32). */
function defendingStrength(state: GameState, region: RegionState): number {
  if (!region.empireFlag) return region.towerLevels;
  return Object.values(state.india.regions)
    .filter((candidate) => candidate.empireFlag === region.empireFlag)
    .reduce((total, candidate) => total + candidate.towerLevels, 0);
}

/**
 * Foreign Invasion against a region not controlled by the Company (p.33): an Invasion with strength
 * equal to the roll. Attacks on Company-controlled regions are queued for the Events in India
 * defence flow (TODO(EV)).
 */
export function foreignInvasion(state: GameState, regionId: RegionId, collector: Collector): GameState {
  const strengthRoll = rollDie(state.rng, 6, `parliament.foreignInvasion.${regionId}`);
  collector.rolls.push(strengthRoll.roll);
  let next: GameState = { ...state, rng: strengthRoll.rng };
  const region = next.india.regions[regionId];
  if (!region) return next;
  const strength = strengthRoll.value;

  if (region.companyControlled) {
    collector.notes.push(
      `Foreign Invasion of strength ${strength} attacks the Company in ${region.name}; it awaits the Events in India defence.`,
    );
    return {
      ...next,
      parliament: {
        ...next.parliament,
        pendingCompanyAttacks: [...next.parliament.pendingCompanyAttacks, { regionId, strength }],
      },
    };
  }

  const defence = defendingStrength(next, region);
  if (strength <= defence) {
    collector.notes.push(`Foreign Invasion of ${region.name} failed (${strength} against ${defence}).`);
    return next;
  }

  collector.notes.push(`Foreign Invasion of ${region.name} succeeded (${strength} against ${defence}).`);
  next = closeAllOrders(next, regionId, collector);
  const flag = next.india.regions[regionId].empireFlag;
  const wasCapital = next.india.regions[regionId].isCapital;
  next = {
    ...next,
    india: {
      ...next.india,
      regions: Object.fromEntries(
        Object.entries(next.india.regions).map(([id, candidate]) => {
          const loseFlag = id === regionId || (wasCapital && flag !== undefined && candidate.empireFlag === flag);
          const updated = loseFlag ? { ...candidate, empireFlag: undefined, isCapital: false } : candidate;
          return [id, id === regionId ? { ...updated, hasDome: true, towerLevels: Math.floor(strength / 2) } : updated];
        }),
      ),
    },
  };

  // Empire Decline (p.7): an empire reduced to its capital alone loses its flag.
  const remaining = flag ? Object.values(next.india.regions).filter((candidate) => candidate.empireFlag === flag) : [];
  if (remaining.length === 1) {
    next = updateRegion(next, remaining[0].id, (capital) => ({ ...capital, empireFlag: undefined, isCapital: false }));
  }
  return next;
}

/** War Against France! failed: roll the storm die and invade each home region linked to a storm (p.33). */
export function warAgainstFranceInvasions(state: GameState, collector: Collector): GameState {
  const faceRoll = rollDie(state.rng, stormDieFaces.length, "parliament.warAgainstFrance.stormDie");
  collector.rolls.push(faceRoll.roll);
  const face = stormDieFaces[faceRoll.value - 1];
  collector.notes.push(`The storm die showed ${face.label}.`);
  let next: GameState = { ...state, rng: faceRoll.rng };

  if (face.storms.length === 0) {
    collector.notes.push("No storm was shown, so no invasion occurs.");
    return next;
  }

  for (const seaZone of face.storms) {
    next = foreignInvasion(next, stormSeaZoneRegion[seaZone], collector);
  }
  return next;
}
