import { FOREIGN_INVASION_MARCH_SHAPE, indiaEventTiles, stormDieFaces, stormSeaZoneRegion } from "../../../data";
import type { ElephantShape, IndiaEventTile } from "../../../data/india-events";
import { shuffle } from "../../rng";
import type { ElephantState, GameState, PendingDecision, PlayerId, RegionId } from "../../types";
import { createFinalScoringDecision } from "../revenue";
import { createSystemDecision } from "../shared";
import type { ActiveTile, TileWorkItem } from "../events-in-india.state";
import { startCompanyAttack, stepAttacks } from "./attacks";
import type { ResolutionContext } from "./context";
import { log, playerName, progress, regionName, roll } from "./context";
import {
  addTowerLevel,
  applyInvasionSuccess,
  capitalOf,
  closeAllOrdersOrCascade,
  closeNorthernmostOrCascade,
  describeElephant,
  highestOpenOrderValue,
  elephantPosition,
  empireStrength,
  findOrder,
  inSameEmpire,
  isDominated,
  legalElephantPositions,
  openOrder,
  region,
  removeRegionFlag,
  removeTowerLevel,
  setTowerLevels,
  topOfStackRegion,
  unrestStrength,
} from "./india";

export const ENVOY_TO_THE_MUGHALS = "envoy-to-the-mughals";

const tilesById = new Map(indiaEventTiles.map((tile) => [tile.id, tile]));

export function eventTile(tileId: string): IndiaEventTile {
  const tile = tilesById.get(tileId);
  if (!tile) throw new Error(`Unknown event tile "${tileId}".`);
  return tile;
}

/** Start the phase (p.28). Region losses are counted per turn for Company Humiliation (p.29). */
export function beginEventsInIndia(ctx: ResolutionContext): void {
  ctx.draft.india.regionsLostThisTurn = 0;
  ctx.draft.eventsInIndia.progress = { turn: ctx.draft.turn, envoyOffered: [], eventsRemaining: 0 };
}

/** Run the phase until a player must decide, or the phase ends. */
export function advance(ctx: ResolutionContext): PendingDecision {
  for (let guard = 0; guard < 5000; guard += 1) {
    const current = progress(ctx);

    if (!current.stormFaceId) {
      const holder = nextEnvoyHolder(ctx.draft);
      if (holder) return envoyDecision(ctx.draft, holder);
      rollStormDie(ctx);
      continue;
    }

    if (current.attacks) {
      const decision = stepAttacks(ctx, current.tile!);
      if (decision) return decision;
      continue;
    }

    if (current.tile) {
      const item = current.tile.work.shift();
      if (item) runWorkItem(ctx, current.tile, item);
      else finishTile(ctx, current.tile);
      continue;
    }

    if (current.eventsRemaining > 0) {
      flipTile(ctx);
      continue;
    }

    return finishPhase(ctx);
  }

  throw new Error("Events in India did not finish resolving.");
}

// --- Envoy to the Mughals (blackmail #7) ----------------------------------------------------

/** Players holding an unplayed Envoy to the Mughals who have not been offered it this phase. */
function nextEnvoyHolder(state: GameState): PlayerId | undefined {
  const offered = state.eventsInIndia.progress?.envoyOffered ?? [];
  return state.seatingOrder.find(
    (playerId) =>
      !offered.includes(playerId) &&
      state.players[playerId]?.blackmailCards.some(
        (card) => card.cardId === ENVOY_TO_THE_MUGHALS && card.facedown !== false,
      ),
  );
}

function envoyDecision(state: GameState, playerId: PlayerId): PendingDecision {
  return {
    id: `decision-events-envoy-${state.turn}-${playerId}-${state.log.length}`,
    phase: "eventsInIndia",
    step: "eventsInIndia.envoyToTheMughals",
    actor: playerId,
    visibility: "private",
    prompt:
      "Before Events in India you may play Envoy to the Mughals: move the Elephant to any legal position and take £ equal to the highest open order in the region with its tail.",
    legalCommands: [
      { type: "eventsInIndia.envoyToTheMughals", label: "Don't play Envoy to the Mughals", payload: { play: false } },
      ...legalElephantPositions(state).map((position) => ({
        type: "eventsInIndia.envoyToTheMughals",
        label: `Play: Elephant ${describeElephant(state, position)} (take £${highestOpenOrderValue(state, position.regionId)})`,
        payload: { play: true, regionId: position.regionId, facing: position.facing ?? null },
      })),
    ],
    canSave: true,
  };
}

export type EnvoyChoice = { play: false } | { play: true; regionId: RegionId; facing: RegionId | null };

/** Mark this player as having been offered Envoy to the Mughals this phase. */
export function markEnvoyOffered(ctx: ResolutionContext, playerId: PlayerId): void {
  progress(ctx).envoyOffered.push(playerId);
}

// --- Storm die (p.28) -----------------------------------------------------------------------

function rollStormDie(ctx: ResolutionContext): void {
  const current = progress(ctx);
  const face = stormDieFaces[roll(ctx, 6, "eventsInIndia.stormDie") - 1];
  current.stormFaceId = face.id;
  current.eventsRemaining = face.events;
  log(
    ctx,
    "eventsInIndia.stormDieRolled",
    `The storm die shows ${face.label}: ${face.storms.length > 0 ? `storms in ${face.storms.join(", ")}, ` : ""}${face.events} event(s).`,
    { face },
  );

  for (const zone of face.storms) {
    // Only player-owned ships check (not Company or extra ships); China ships count as Eastern (p.25).
    const ships = ctx.draft.company.ships.filter(
      (ship) => ship.kind === "player" && (ship.location === zone || (zone === "east-indian" && ship.location === "china")),
    );
    for (const ship of ships) {
      const value = roll(ctx, 6, `eventsInIndia.storm.${ship.id}`);
      const sinks = value >= 5 || (value >= 3 && ship.fatigued);
      if (sinks) {
        ship.location = "shipyard";
        ship.fatigued = false;
      } else if (value >= 3) {
        ship.fatigued = true;
      }
      log(
        ctx,
        "eventsInIndia.storm",
        `Storm in ${zone}: ${ship.id} rolls ${value} and ${sinks ? "sinks, returning to its shipyard" : value >= 3 ? "is fatigued" : "is unharmed"}.`,
        { shipId: ship.id, roll: value, sunk: sinks },
      );
    }
  }
}

// --- Tiles ----------------------------------------------------------------------------------

/**
 * Assumption (not stated in the rulebook): when the draw stack runs out, the discards are
 * shuffled to form a new draw stack, so there is always a tile on top to show a region.
 */
function refillDrawPileIfEmpty(ctx: ResolutionContext): void {
  const events = ctx.draft.eventsInIndia;
  if (events.drawPile.length > 0 || events.discards.length === 0) return;

  const shuffled = shuffle(ctx.draft.rng, events.discards);
  ctx.draft.rng = shuffled.rng;
  events.drawPile = shuffled.items;
  events.discards = [];
  log(ctx, "eventsInIndia.stackRefilled", "The event draw stack ran out; the discards are shuffled to form a new stack.", {
    shuffleRollCount: shuffled.rolls.length,
  });
}

function flipTile(ctx: ResolutionContext): void {
  const current = progress(ctx);
  refillDrawPileIfEmpty(ctx);
  const tileId = ctx.draft.eventsInIndia.drawPile.shift();
  if (!tileId) throw new Error("The event draw stack is empty.");
  refillDrawPileIfEmpty(ctx);

  const tile = eventTile(tileId);
  const elephant = ctx.draft.india.elephant;
  const centered =
    elephant.regionId && !elephant.facing && ctx.draft.india.regions[elephant.regionId]?.companyControlled
      ? elephant.regionId
      : undefined;
  const active: ActiveTile = {
    tileId,
    locationRegionId: topOfStackRegion(ctx.draft),
    elephantCenteredRegionId: centered,
    work: initialWork(ctx.draft, tile),
    cascaded: [],
    rebelledRegionIds: [],
    foreignInvasionRedirect: false,
    returnedToStack: false,
  };
  current.tile = active;
  current.eventsRemaining -= 1;
  log(
    ctx,
    "eventsInIndia.tileFlipped",
    `Event: ${tile.label} (top of stack: ${regionName(ctx, active.locationRegionId)}; Elephant ${describeElephant(ctx.draft, elephant)}).`,
    { tileId, locationRegionId: active.locationRegionId },
  );
}

function initialWork(state: GameState, tile: IndiaEventTile): TileWorkItem[] {
  switch (tile.kind) {
    case "crisis":
      return [{ kind: "resolve" }, { kind: "crisisMarch" }];
    case "leader":
      return [{ kind: "resolve" }, { kind: "leaderRedirect" }];
    case "peace":
      return [{ kind: "resolve" }, { kind: "march", shape: tile.marchShape! }];
    case "shuffle":
      // First the Elephant's March, then the shuffle; if the draw stack is empty, march last (p.31).
      return state.eventsInIndia.drawPile.length > 0
        ? [{ kind: "march", shape: tile.marchShape! }, { kind: "shuffleIntoStack" }]
        : [{ kind: "shuffleIntoStack" }, { kind: "march", shape: tile.marchShape! }];
    default:
      return [{ kind: "resolve" }];
  }
}

function finishTile(ctx: ResolutionContext, tile: ActiveTile): void {
  if (!tile.returnedToStack) ctx.draft.eventsInIndia.discards.push(tile.tileId);
  progress(ctx).tile = undefined;
}

function runWorkItem(ctx: ResolutionContext, tile: ActiveTile, item: TileWorkItem): void {
  const definition = eventTile(tile.tileId);
  switch (item.kind) {
    case "resolve":
      resolveTile(ctx, tile, definition);
      return;
    case "march":
      elephantMarch(ctx, item.shape);
      return;
    case "crisisMarch":
      elephantMarch(ctx, definition.marchShape!, tile.imperialCapitalId);
      return;
    case "leaderRedirect":
      // Leader moves the Elephant only if it stood in a Company region that rebelled successfully (p.31).
      if (tile.elephantCenteredRegionId && tile.rebelledRegionIds.includes(tile.elephantCenteredRegionId)) {
        elephantMarch(ctx, definition.marchShape!);
      }
      return;
    case "foreignInvasionTarget":
      foreignInvasionAt(ctx, tile, item.regionId);
      return;
    case "foreignInvasionRedirect":
      if (tile.foreignInvasionRedirect) elephantMarch(ctx, FOREIGN_INVASION_MARCH_SHAPE);
      return;
    case "shuffleIntoStack":
      shuffleIntoStack(ctx, tile);
      return;
  }
}

function resolveTile(ctx: ResolutionContext, tile: ActiveTile, definition: IndiaEventTile): void {
  switch (definition.kind) {
    case "turmoil":
      // Close the northernmost open order in the pictured region, or Cascade (p.31).
      if (tile.locationRegionId) closeNorthernmostOrCascade(ctx, tile.locationRegionId, tile.cascaded);
      return;
    case "windfall":
      windfall(ctx, tile.locationRegionId, definition.windfallPerWriter ?? 1);
      return;
    case "leader":
      leader(ctx, tile, definition.modifier ?? 0);
      return;
    case "peace":
      peace(ctx);
      return;
    case "crisis":
      crisis(ctx, tile, definition.modifier ?? 0);
      return;
    case "foreignInvasion":
      foreignInvasion(ctx, tile);
      return;
    case "shuffle":
      return;
  }
}

/** Windfall (p.31): £1 per writer on an order in the pictured region and adjacent regions. */
function windfall(ctx: ResolutionContext, regionId: RegionId | undefined, perWriter: number): void {
  if (!regionId) return;
  // Writer Graft Reform does not apply: "writers still make money from the Windfall event."
  const regions = [regionId, ...region(ctx.draft, regionId).adjacent];
  const paid: Record<PlayerId, number> = {};
  for (const regionKey of regions) {
    for (const order of region(ctx.draft, regionKey).orders) {
      if (!order.writer) continue;
      paid[order.writer.playerId] = (paid[order.writer.playerId] ?? 0) + perWriter;
    }
  }
  for (const [playerId, amount] of Object.entries(paid)) ctx.draft.players[playerId].cash += amount;

  const parts = Object.entries(paid).map(([playerId, amount]) => `${playerName(ctx, playerId)} £${amount}`);
  log(
    ctx,
    "eventsInIndia.windfall",
    parts.length > 0
      ? `Windfall around ${regionName(ctx, regionId)}: ${parts.join(", ")}.`
      : `Windfall around ${regionName(ctx, regionId)}: no writers are on orders there.`,
    { regions, paid },
  );
}

/** Leader (p.31): a sovereign region gains a tower; otherwise a Rebellion with the modifier. */
function leader(ctx: ResolutionContext, tile: ActiveTile, modifier: number): void {
  const regionId = tile.locationRegionId;
  if (!regionId) return;
  const target = region(ctx.draft, regionId);

  if (target.companyControlled) {
    startCompanyAttack(ctx, {
      regionId,
      primary: true,
      crisisKind: "rebellion",
      strength: modifier + unrestStrength(ctx.draft, target.unrest),
    });
    return;
  }

  if (isDominated(ctx.draft, regionId)) {
    rebellion(ctx, regionId, modifier);
    return;
  }

  const added = addTowerLevel(ctx, regionId);
  log(
    ctx,
    "eventsInIndia.leader",
    added
      ? `A leader strengthens ${target.name}: its tower rises to ${target.towerLevels}.`
      : `A leader would strengthen ${target.name}, but no tower levels are left in the supply.`,
  );
}

/** Peace (p.31). */
function peace(ctx: ResolutionContext): void {
  const elephant = ctx.draft.india.elephant;
  if (!elephant.regionId) return;
  const here = region(ctx.draft, elephant.regionId);

  if (!elephant.facing) {
    // Fully within a region: open all its orders and remove its unrest. A Company region gets no
    // tower ("instead", tile text); any other region touching the Elephant gains one.
    if (!here.companyControlled) addTowerLevel(ctx, here.id);
    const opened = here.orders.filter((order) => openOrder(order)).map((order) => order.id);
    here.unrest = 0;
    log(ctx, "eventsInIndia.peace", `Peace in ${here.name}: its orders open and its unrest is cleared.`, { opened });
    return;
  }

  const there = region(ctx.draft, elephant.facing);
  const opened: string[] = [];
  for (const order of here.orders) {
    for (const connectedId of order.connectedOrderIds) {
      const connected = findOrder(ctx.draft, connectedId);
      if (connected.regionId !== there.id) continue;
      if (openOrder(order)) opened.push(order.id);
      if (openOrder(connected.order)) opened.push(connected.order.id);
    }
  }
  const strengthened = [here, there].filter((candidate) => !candidate.companyControlled && addTowerLevel(ctx, candidate.id));
  log(
    ctx,
    "eventsInIndia.peace",
    `Peace between ${here.name} and ${there.name}: ${opened.length} order(s) open` +
      (strengthened.length > 0 ? `; ${strengthened.map((candidate) => candidate.name).join(" and ")} gain a tower level.` : "."),
    { opened, strengthened: strengthened.map((candidate) => candidate.id) },
  );
}

/** Crisis (pp.32-33): the Elephant's tail attacks; its head (or its sovereign) defends. */
function crisis(ctx: ResolutionContext, tile: ActiveTile, modifier: number): void {
  const elephant = ctx.draft.india.elephant;
  const attackerId = elephant.regionId;
  if (!attackerId) return;
  const attacker = region(ctx.draft, attackerId);

  if (attacker.companyControlled) {
    startCompanyAttack(ctx, {
      regionId: attackerId,
      primary: true,
      crisisKind: "rebellion",
      strength: modifier + unrestStrength(ctx.draft, attacker.unrest),
    });
    return;
  }

  if (isDominated(ctx.draft, attackerId)) {
    rebellion(ctx, attackerId, modifier);
    return;
  }

  const defenderId = elephant.facing;
  if (!defenderId) {
    // Assumption: a sovereign region with the Elephant in its centre has no one to attack.
    log(ctx, "eventsInIndia.crisisNoTarget", `${attacker.name} is sovereign and faces no region: the Crisis has no effect.`);
    return;
  }

  const defender = region(ctx.draft, defenderId);
  if (defender.companyControlled) {
    startCompanyAttack(ctx, {
      regionId: defenderId,
      primary: true,
      crisisKind: "invasion",
      attackerRegionId: attackerId,
      strength: empireStrength(ctx.draft, attackerId) + modifier + unrestStrength(ctx.draft, defender.unrest),
    });
    return;
  }

  if (inSameEmpire(ctx.draft, attackerId, defenderId)) {
    log(ctx, "eventsInIndia.crisisNoTarget", `${defender.name} is already part of ${attacker.name}'s empire: no effect.`);
    return;
  }

  invasion(ctx, tile, attackerId, defenderId, modifier);
}

/** Invasion between two Indian regions (p.32). Defender wins ties. */
function invasion(ctx: ResolutionContext, tile: ActiveTile, attackerId: RegionId, defenderId: RegionId, modifier: number): void {
  const attack = empireStrength(ctx.draft, attackerId) + modifier;
  const defence = empireStrength(ctx.draft, defenderId);
  const summary = `${regionName(ctx, attackerId)} invades ${regionName(ctx, defenderId)}: ${attack} against ${defence}`;

  if (attack > defence) {
    log(ctx, "eventsInIndia.invasion", `${summary}. The Invasion succeeds.`, { attackerId, defenderId, attack, defence });
    applyInvasionSuccess(ctx, attackerId, defenderId);
    tile.imperialCapitalId = attackerId;
    return;
  }

  const lowered = removeTowerLevel(ctx, attackerId);
  log(
    ctx,
    "eventsInIndia.invasion",
    `${summary}. The Invasion fails${lowered ? ` and ${regionName(ctx, attackerId)} loses a tower level` : ""}.`,
    { attackerId, defenderId, attack, defence },
  );
}

/** Rebellion of a dominated region against the region that dominates it (p.32). */
function rebellion(ctx: ResolutionContext, rebelId: RegionId, modifier: number): void {
  const tile = progress(ctx).tile!;
  const rebel = region(ctx.draft, rebelId);
  const capitalId = capitalOf(ctx.draft, rebel.empireFlag);
  if (!capitalId) return;

  const attack = rebel.towerLevels + modifier;
  const defence = region(ctx.draft, capitalId).towerLevels;
  const summary = `${rebel.name} rebels against ${regionName(ctx, capitalId)}: ${attack} against ${defence}`;

  if (attack > defence) {
    log(ctx, "eventsInIndia.rebellion", `${summary}. The Rebellion succeeds and ${rebel.name} is sovereign.`, {
      rebelId,
      capitalId,
      attack,
      defence,
    });
    removeRegionFlag(ctx, rebelId);
    closeAllOrdersOrCascade(ctx, rebelId, tile.cascaded);
    return;
  }

  const lowered = removeTowerLevel(ctx, capitalId);
  log(
    ctx,
    "eventsInIndia.rebellion",
    `${summary}. The Rebellion fails${lowered ? ` and ${regionName(ctx, capitalId)} loses a tower level` : ""}.`,
    { rebelId, capitalId, attack, defence },
  );
}

/** Foreign Invasion (p.33): roll the storm die to find the targets. */
function foreignInvasion(ctx: ResolutionContext, tile: ActiveTile): void {
  const face = stormDieFaces[roll(ctx, 6, "eventsInIndia.foreignInvasion.stormDie") - 1];
  const targets =
    face.storms.length > 0
      ? face.storms.map((zone) => stormSeaZoneRegion[zone] as RegionId)
      : tile.locationRegionId
        ? [tile.locationRegionId]
        : [];
  log(
    ctx,
    "eventsInIndia.foreignInvasion",
    `Foreign Invasion: the storm die shows ${face.label}, so invaders land in ${targets.map((regionId) => regionName(ctx, regionId)).join(", ")}.`,
    { face, targets },
  );
  tile.work.unshift(
    ...targets.map((regionId) => ({ kind: "foreignInvasionTarget" as const, regionId })),
    { kind: "foreignInvasionRedirect" },
  );
}

function foreignInvasionAt(ctx: ResolutionContext, tile: ActiveTile, regionId: RegionId): void {
  const strength = roll(ctx, 6, `eventsInIndia.foreignInvasion.${regionId}`);
  const target = region(ctx.draft, regionId);

  if (target.companyControlled) {
    // Assumption: "a Company-controlled region that was invaded" means targeted, whatever the result.
    if (tile.elephantCenteredRegionId === regionId) tile.foreignInvasionRedirect = true;
    startCompanyAttack(ctx, {
      regionId,
      primary: true,
      crisisKind: "foreignInvasion",
      foreignRoll: strength,
      strength: strength + unrestStrength(ctx.draft, target.unrest),
    });
    return;
  }

  const defence = empireStrength(ctx.draft, regionId);
  if (strength <= defence) {
    log(ctx, "eventsInIndia.foreignInvasion", `Foreign invaders (strength ${strength}) are repelled by ${target.name} (${defence}).`, {
      regionId,
      strength,
      defence,
    });
    return;
  }

  log(ctx, "eventsInIndia.foreignInvasion", `Foreign invaders (strength ${strength}) overrun ${target.name} (${defence}).`, {
    regionId,
    strength,
    defence,
  });
  closeAllOrdersOrCascade(ctx, regionId, tile.cascaded);
  removeRegionFlag(ctx, regionId);
  setTowerLevels(ctx, regionId, Math.floor(strength / 2));
  log(ctx, "eventsInIndia.towerSet", `${target.name}'s strength becomes ${target.towerLevels}.`);
}

/** Shuffle (p.31): this tile into the draw stack, then the shuffled discards on top. */
function shuffleIntoStack(ctx: ResolutionContext, tile: ActiveTile): void {
  const events = ctx.draft.eventsInIndia;
  const withTile = shuffle(ctx.draft.rng, [...events.drawPile, tile.tileId]);
  const discards = shuffle(withTile.rng, events.discards);
  ctx.draft.rng = discards.rng;
  events.drawPile = [...discards.items, ...withTile.items];
  events.discards = [];
  tile.returnedToStack = true;
  log(ctx, "eventsInIndia.shuffle", "Shuffle: the tile goes back into the stack and the shuffled discards go on top.");
}

/** Elephant's March (p.30): Imperial Ambitions, otherwise the region on top of the draw stack. */
function elephantMarch(ctx: ResolutionContext, shape: ElephantShape, imperialCapitalId?: RegionId): void {
  const destination = imperialCapitalId ?? topOfStackRegion(ctx.draft);
  if (!destination) return;

  ctx.draft.india.elephant = elephantPosition(ctx.draft, destination, shape);
  log(
    ctx,
    "eventsInIndia.elephantMarch",
    `The Elephant marches${imperialCapitalId ? " (Imperial Ambitions)" : ""} and stands ${describeElephant(ctx.draft, ctx.draft.india.elephant)}.`,
    { elephant: ctx.draft.india.elephant, shape },
  );
}

function finishPhase(ctx: ResolutionContext): PendingDecision {
  ctx.draft.eventsInIndia.progress = undefined;

  // A Company that failed during Region Loss finishes the phase, then goes to Final Scoring (p.29).
  const next = ctx.draft.company.failed
    ? createFinalScoringDecision(ctx.draft)
    : // TODO(PA): replace with the real Parliament Meets entry decision.
      createSystemDecision({
        id: `decision-parliament-confirm-turn-${ctx.draft.turn}`,
        phase: "parliament",
        step: "parliament.confirm",
        prompt: "Confirm starter Parliament Meets.",
        commandType: "parliament.confirm",
        label: "Confirm Parliament",
        description: "Starter scaffold: records that Parliament was confirmed.",
      });
  log(
    ctx,
    "eventsInIndia.resolved",
    ctx.draft.company.failed ? "Events in India resolved. The Company has failed." : "Events in India resolved.",
  );
  ctx.draft.phase = next.phase;
  return next;
}

