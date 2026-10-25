import { indiaEventTiles, mapData } from "../../../data";
import type { ElephantShape } from "../../../data/india-events";
import { hiddenEventTileRegion, isHiddenId } from "../../hidden";
import type { ElephantState, GameState, OrderState, RegionId, RegionState } from "../../types";
import type { ResolutionContext } from "./context";
import { log, playerName, regionName } from "./context";

// Region, empire, order and Elephant rules shared by the India events (rulebook pp.6-7, 28-33).

/** Component limits (p.2): 20 tower levels and 3 sets of empire flags. */
export const TOWER_LEVEL_SUPPLY = 20;
export const EMPIRE_FLAG_IDS = ["empire-flag-1", "empire-flag-2", "empire-flag-3"] as const;

/**
 * Neighbours of each region in clockwise order around it, for the Elephant's March rule "use the
 * first clockwise region from that border" (p.30). Derived from board_image-1.png: each region was
 * flood-filled from its fill colour, and its borders were sorted by the angle from the region's
 * centroid to the midpoint of each shared border (clockwise from north). The order is a cycle.
 */
export const CLOCKWISE_NEIGHBOURS: Record<RegionId, RegionId[]> = {
  punjab: ["delhi", "bombay"],
  delhi: ["bengal", "maratha", "bombay", "punjab"],
  bombay: ["delhi", "maratha", "hyderabad", "mysore", "punjab"],
  maratha: ["bengal", "hyderabad", "bombay", "delhi"],
  bengal: ["maratha", "delhi"],
  hyderabad: ["maratha", "madras", "mysore", "bombay"],
  mysore: ["hyderabad", "madras", "bombay"],
  madras: ["hyderabad", "mysore"],
};

export function region(state: GameState, regionId: RegionId): RegionState {
  const found = state.india.regions[regionId];
  if (!found) throw new Error(`Unknown region "${regionId}".`);
  return found;
}

/** A region with a dome and either the starred flag or no flag (p.7). */
export function isSovereign(state: GameState, regionId: RegionId): boolean {
  const target = region(state, regionId);
  return !target.companyControlled && (!target.empireFlag || target.isCapital);
}

/** A region with a dome and a small flag: part of another region's empire (p.7). */
export function isDominated(state: GameState, regionId: RegionId): boolean {
  const target = region(state, regionId);
  return !target.companyControlled && Boolean(target.empireFlag) && !target.isCapital;
}

export function capitalOf(state: GameState, flag: string | undefined): RegionId | undefined {
  if (!flag) return undefined;
  return Object.values(state.india.regions).find((candidate) => candidate.empireFlag === flag && candidate.isCapital)
    ?.id;
}

export function empireRegions(state: GameState, flag: string): RegionId[] {
  return Object.values(state.india.regions)
    .filter((candidate) => candidate.empireFlag === flag)
    .map((candidate) => candidate.id);
}

/** True when `other` carries the empire flag of `actor` (i.e. `actor`'s empire includes it). */
export function inSameEmpire(state: GameState, actor: RegionId, other: RegionId): boolean {
  const flag = region(state, actor).empireFlag;
  return Boolean(flag) && region(state, other).empireFlag === flag;
}

/** A region's strength with its whole empire; Company-controlled regions have strength 0 (p.22). */
export function empireStrength(state: GameState, regionId: RegionId): number {
  const target = region(state, regionId);
  if (target.companyControlled) return 0;
  if (!target.empireFlag) return target.towerLevels;

  return empireRegions(state, target.empireFlag).reduce(
    (total, member) => total + region(state, member).towerLevels,
    0,
  );
}

export function towerLevelsInSupply(state: GameState): number {
  const onMap = Object.values(state.india.regions).reduce((total, candidate) => total + candidate.towerLevels, 0);
  return Math.max(0, TOWER_LEVEL_SUPPLY - onMap);
}

/** Add one tower level if the supply has one (component limits, p.5). */
export function addTowerLevel(ctx: ResolutionContext, regionId: RegionId): boolean {
  if (towerLevelsInSupply(ctx.draft) === 0) return false;
  region(ctx.draft, regionId).towerLevels += 1;
  return true;
}

export function removeTowerLevel(ctx: ResolutionContext, regionId: RegionId): boolean {
  const target = region(ctx.draft, regionId);
  if (target.towerLevels === 0) return false;
  target.towerLevels -= 1;
  return true;
}

/** Set a region's tower to `levels`, limited by the tower levels left in the supply. */
export function setTowerLevels(ctx: ResolutionContext, regionId: RegionId, levels: number): void {
  const target = region(ctx.draft, regionId);
  const available = towerLevelsInSupply(ctx.draft) + target.towerLevels;
  target.towerLevels = Math.min(levels, available);
}

function firstFreeEmpireFlag(state: GameState): string | undefined {
  const used = new Set(Object.values(state.india.regions).map((candidate) => candidate.empireFlag));
  return EMPIRE_FLAG_IDS.find((flag) => !used.has(flag));
}

/** Empire Decline (p.7): an empire reduced to its capital returns its flag to the supply. */
export function checkEmpireDecline(ctx: ResolutionContext, flag: string | undefined): void {
  if (!flag) return;
  const members = empireRegions(ctx.draft, flag);
  const capital = capitalOf(ctx.draft, flag);
  if (!capital || members.length > 1) return;

  const target = region(ctx.draft, capital);
  target.empireFlag = undefined;
  target.isCapital = false;
  log(ctx, "eventsInIndia.empireDeclined", `${target.name} no longer has an empire and returns its flag.`);
}

/** Remove a region's flag. A capital's flag takes every flag of its empire with it (Shattered Empire). */
export function removeRegionFlag(ctx: ResolutionContext, regionId: RegionId): void {
  const target = region(ctx.draft, regionId);
  const flag = target.empireFlag;
  if (!flag) return;

  if (target.isCapital) {
    for (const member of empireRegions(ctx.draft, flag)) {
      const memberRegion = region(ctx.draft, member);
      memberRegion.empireFlag = undefined;
      memberRegion.isCapital = false;
    }
    log(ctx, "eventsInIndia.empireShattered", `${target.name}'s empire shatters; its flags return to the supply.`);
    return;
  }

  target.empireFlag = undefined;
  checkEmpireDecline(ctx, flag);
}

/**
 * A successful Invasion (p.32): the defender takes the attacker's flag. A defending capital's
 * empire shatters. An attacker without a flag founds a new empire if a starred flag is left.
 */
export function applyInvasionSuccess(ctx: ResolutionContext, attackerId: RegionId, defenderId: RegionId): void {
  removeRegionFlag(ctx, defenderId);

  const attacker = region(ctx.draft, attackerId);
  if (!attacker.empireFlag) {
    const flag = firstFreeEmpireFlag(ctx.draft);
    if (!flag) {
      log(
        ctx,
        "eventsInIndia.noEmpireFlag",
        `No starred flag is left, so ${attacker.name} cannot form an empire (p.32).`,
      );
      return;
    }
    attacker.empireFlag = flag;
    attacker.isCapital = true;
    log(ctx, "eventsInIndia.empireFounded", `${attacker.name} founds a new empire.`);
  }

  const defender = region(ctx.draft, defenderId);
  defender.empireFlag = attacker.empireFlag;
  defender.isCapital = false;
}

// --- Orders --------------------------------------------------------------------------------

export function findOrder(state: GameState, orderId: string): { order: OrderState; regionId: RegionId } {
  for (const candidate of Object.values(state.india.regions)) {
    const order = candidate.orders.find((entry) => entry.id === orderId);
    if (order) return { order, regionId: candidate.id };
  }
  throw new Error(`Unknown order "${orderId}".`);
}

/**
 * Close an order. Writer Loss (p.28): a writer on it returns to its owner's supply; a filled
 * order token is flipped to its closed side.
 */
export function closeOrder(ctx: ResolutionContext, order: OrderState): void {
  if (order.closed) return;
  order.closed = true;
  order.filledThisTurnBy = [];

  if (order.writer) {
    const owner = ctx.draft.players[order.writer.playerId];
    if (owner) owner.familyMembers.supply += 1;
    log(
      ctx,
      "eventsInIndia.writerLost",
      `${playerName(ctx, order.writer.playerId)}'s writer on the closed £${order.value} order returns to their supply.`,
      { orderId: order.id, playerId: order.writer.playerId },
    );
    order.writer = undefined;
  }
}

export function openOrder(order: OrderState): boolean {
  if (!order.closed) return false;
  order.closed = false;
  return true;
}

/** Northernmost = smallest y on the board image. */
export function northernmostOpenOrder(state: GameState, regionId: RegionId): OrderState | undefined {
  return region(state, regionId)
    .orders.filter((order) => !order.closed)
    .sort((left, right) => left.boardPosition.y - right.boardPosition.y)[0];
}

/** Close the northernmost open order, or Cascade if every order is already closed (pp.28, 31). */
export function closeNorthernmostOrCascade(ctx: ResolutionContext, regionId: RegionId, cascaded: RegionId[]): void {
  const order = northernmostOpenOrder(ctx.draft, regionId);
  if (order) {
    closeOrder(ctx, order);
    log(ctx, "eventsInIndia.orderClosed", `The £${order.value} order in ${regionName(ctx, regionId)} closes.`, {
      orderId: order.id,
    });
    return;
  }

  cascade(ctx, regionId, cascaded);
}

/** Close every open order in a region; if all were already closed, Cascade (pp.29, 32-33). */
export function closeAllOrdersOrCascade(ctx: ResolutionContext, regionId: RegionId, cascaded: RegionId[]): void {
  const open = region(ctx.draft, regionId).orders.filter((order) => !order.closed);
  if (open.length === 0) {
    cascade(ctx, regionId, cascaded);
    return;
  }

  for (const order of open) closeOrder(ctx, order);
  log(ctx, "eventsInIndia.ordersClosed", `Every open order in ${regionName(ctx, regionId)} closes.`, {
    orderIds: open.map((order) => order.id),
  });
}

/**
 * Cascade (p.28): close the open orders connected to this region's orders. Where a connected
 * order is already closed, close the northernmost open order in that order's region instead; if
 * that region has no open order, it Cascades too (immediately). Each region overflows once per tile.
 */
export function cascade(ctx: ResolutionContext, regionId: RegionId, cascaded: RegionId[]): void {
  if (cascaded.includes(regionId)) return;
  cascaded.push(regionId);
  log(ctx, "eventsInIndia.cascade", `Every order in ${regionName(ctx, regionId)} is closed: Cascade.`);

  for (const order of region(ctx.draft, regionId).orders) {
    for (const connectedId of order.connectedOrderIds) {
      const connected = findOrder(ctx.draft, connectedId);
      if (connected.regionId === regionId) continue;

      if (!connected.order.closed) {
        closeOrder(ctx, connected.order);
        log(
          ctx,
          "eventsInIndia.orderClosed",
          `The Cascade closes the £${connected.order.value} order in ${regionName(ctx, connected.regionId)}.`,
          { orderId: connected.order.id },
        );
        continue;
      }

      closeNorthernmostOrCascade(ctx, connected.regionId, cascaded);
    }
  }
}

// --- The Elephant ----------------------------------------------------------------------------

export function borderShapeNeighbour(regionId: RegionId, shape: ElephantShape): RegionId {
  const definition = mapData.regions.find((candidate) => candidate.id === regionId);
  if (!definition) throw new Error(`Unknown region "${regionId}".`);
  return definition.borderShapes[shape];
}

/**
 * Where the Elephant stands in a region (p.30): fully within a Company-controlled region; facing
 * the sovereign of a dominated region; otherwise on the border with the tile's shape, skipping
 * clockwise past regions the acting region already dominates. If it dominates every neighbour,
 * the Elephant stands across the shape border pointing back at the capital (Fully-Formed Empires).
 */
export function elephantPosition(state: GameState, regionId: RegionId, shape: ElephantShape): ElephantState {
  const target = region(state, regionId);
  if (target.companyControlled) return { regionId };

  if (isDominated(state, regionId)) {
    return { regionId, facing: capitalOf(state, target.empireFlag) };
  }

  const shapeNeighbour = borderShapeNeighbour(regionId, shape);
  const cycle = CLOCKWISE_NEIGHBOURS[regionId] ?? target.adjacent;
  const start = Math.max(0, cycle.indexOf(shapeNeighbour));
  for (let offset = 0; offset < cycle.length; offset += 1) {
    const candidate = cycle[(start + offset) % cycle.length];
    if (!inSameEmpire(state, regionId, candidate)) return { regionId, facing: candidate };
  }

  return { regionId: shapeNeighbour, facing: regionId };
}

/** Every position the Elephant's March could produce, for Envoy to the Mughals ("any legal position"). */
export function legalElephantPositions(state: GameState): ElephantState[] {
  const positions = new Map<string, ElephantState>();
  for (const regionId of Object.keys(state.india.regions)) {
    for (const shape of ["circle", "triangle", "square"] as const) {
      const position = elephantPosition(state, regionId, shape);
      positions.set(`${position.regionId}>${position.facing ?? ""}`, position);
    }
  }
  return [...positions.values()];
}

/** The highest open order in a region (Envoy to the Mughals pays this). */
export function highestOpenOrderValue(state: GameState, regionId: RegionId | undefined): number {
  if (!regionId) return 0;
  return Math.max(0, ...state.india.regions[regionId].orders.filter((order) => !order.closed).map((order) => order.value));
}

export function describeElephant(state: GameState, elephant: ElephantState): string {
  if (!elephant.regionId) return "off the map";
  const name = state.india.regions[elephant.regionId]?.name ?? elephant.regionId;
  if (!elephant.facing) return `fully within ${name}`;
  return `in ${name} facing ${state.india.regions[elephant.facing]?.name ?? elephant.facing}`;
}

/**
 * The region whose tile is on top of the draw stack. Also works on a projected view, where the
 * top tile is a placeholder that keeps only its region side (see ../../hidden.ts).
 */
export function topOfStackRegion(state: GameState): RegionId | undefined {
  const tileId = state.eventsInIndia.drawPile[0];
  if (!tileId) return undefined;
  return isHiddenId(tileId) ? hiddenEventTileRegion(tileId) : tileRegion(tileId);
}

const tileRegions = new Map(indiaEventTiles.map((tile) => [tile.id, tile.region as RegionId]));

export function tileRegion(tileId: string): RegionId {
  const regionId = tileRegions.get(tileId);
  if (!regionId) throw new Error(`Unknown event tile "${tileId}".`);
  return regionId;
}

/** Sepoy Recruitment ruling (docs/phase-build-guide.md): each unrest counts 2 while it is in effect. */
export function unrestStrength(state: GameState, unrest: number): number {
  const sepoy = state.parliament.passedLaws.some((law) => law.lawId === "sepoy-recruitment");
  return unrest * (sepoy ? 2 : 1);
}
