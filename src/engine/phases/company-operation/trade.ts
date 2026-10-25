import { rollCheck } from "../../checks";
import { presidentOf } from "../../selectors";
import type {
  GameState,
  LegalCommand,
  OrderState,
  PendingDecision,
  PlayerId,
  PresidencyId,
  RegionId,
} from "../../types";
import type { PendingCheck, TradeActivity } from "../company-operation.state";
import {
  SEA_ZONE_BY_PRESIDENCY,
  SEA_ZONE_LABEL,
  addToCompanyBalance,
  changeOfficeTreasury,
  coState,
  decisionId,
  isLawInEffect,
  payOfficeholderBonus,
  payPlayer,
  playerName,
  presidentOfficeId,
  unplayedBlackmailHolder,
  vacateAfterCatastrophe,
  withCo,
} from "./context";
import { presidencyProgress, withActivity } from "./presidency-progress";
import type { StepResult } from "./step";

// Trade (pp.20-21). Declare regions (home region required; penalty one die per other region), make a
// check with £1 per die, and on success place one writer per ship in the Presidency's sea zone: the
// home port first, then each next order adjacent to one already filled, as many as possible, only in
// declared regions and never in another President's home region. Out of writers: filled-order tokens.
// The Company Balance gains each filled order's value; the President takes £1 per order and each
// writer's family £1 per writer. One successful Trade per Presidency per turn.

export type TradePayload =
  | { action: "declare"; regionId: RegionId }
  | { action: "roll"; spend: number }
  | { action: "cancel" }
  | { action: "place"; orderId: string; writer: PlayerId | "token" };

type OrderNode = { order: OrderState; regionId: RegionId };

function orderNodes(state: GameState): Map<string, OrderNode> {
  const nodes = new Map<string, OrderNode>();
  for (const region of Object.values(state.india.regions)) {
    for (const order of region.orders) nodes.set(order.id, { order, regionId: region.id });
  }
  return nodes;
}

/** An order a writer may be placed on: open and empty (no writer, no filled token this turn). */
export function isOrderAvailable(order: OrderState): boolean {
  return !order.closed && !order.writer && order.filledThisTurnBy.length === 0;
}

/** Home Region Privileges (p.20): never fill orders in another President's home region. */
function regionTradeable(state: GameState, presidency: PresidencyId, regionId: RegionId): boolean {
  const home = state.india.regions[regionId]?.homePresidency;
  return !home || home === presidency;
}

export function homeRegionOf(state: GameState, presidency: PresidencyId): RegionId {
  return Object.values(state.india.regions).find((region) => region.homePresidency === presidency)!.id;
}

function homePort(state: GameState, presidency: PresidencyId): OrderState | undefined {
  return state.india.regions[homeRegionOf(state, presidency)]?.orders.find(
    (order) => order.isHomePortFor === presidency,
  );
}

export function shipsInPresidencyZone(state: GameState, presidency: PresidencyId): number {
  const zone = SEA_ZONE_BY_PRESIDENCY[presidency];
  return state.company.ships.filter((ship) => ship.location === zone).length;
}

/** Number of placements (counting the home port) needed to reach each order using allowed regions. */
function reachDistances(state: GameState, presidency: PresidencyId, allowed: Set<RegionId>): Map<string, number> {
  const nodes = orderNodes(state);
  const start = homePort(state, presidency);
  const distances = new Map<string, number>();
  if (!start || !isOrderAvailable(start)) return distances;

  distances.set(start.id, 1);
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nextId of nodes.get(id)!.order.connectedOrderIds) {
      const next = nodes.get(nextId);
      if (!next || distances.has(nextId) || !allowed.has(next.regionId) || !isOrderAvailable(next.order)) continue;
      distances.set(nextId, distances.get(id)! + 1);
      queue.push(nextId);
    }
  }
  return distances;
}

/** Regions that could be added to the declaration: reachable within the ships available (p.20 step 1). */
function declarableRegions(state: GameState, presidency: PresidencyId, declared: RegionId[]): RegionId[] {
  const ships = shipsInPresidencyZone(state, presidency);
  return Object.keys(state.india.regions).filter((regionId) => {
    if (declared.includes(regionId) || !regionTradeable(state, presidency, regionId)) return false;
    const distances = reachDistances(state, presidency, new Set([...declared, regionId]));
    const nodes = orderNodes(state);
    return [...distances.entries()].some(
      ([orderId, distance]) => distance <= ships && nodes.get(orderId)!.regionId === regionId,
    );
  });
}

export function canTrade(state: GameState, presidency: PresidencyId): boolean {
  return tradeUnavailableReason(state, presidency) === undefined;
}

/** Why the President can't Trade right now, for the prompt; undefined when Trade is legal. */
export function tradeUnavailableReason(state: GameState, presidency: PresidencyId): string | undefined {
  if (!presidentOf(state, presidency)) return "the President is vacant";
  if ((coState(state).tradedPresidencies ?? []).includes(presidency)) return "this Presidency has already traded this turn (p.20)";
  const port = homePort(state, presidency);
  if (!port || !isOrderAvailable(port)) return "its home port is closed or filled";
  if (shipsInPresidencyZone(state, presidency) === 0) {
    return `there are no ships in the ${SEA_ZONE_LABEL[SEA_ZONE_BY_PRESIDENCY[presidency]]} sea zone (the Manager of Shipping places them)`;
  }
  const treasury = state.company.offices[presidentOfficeId(presidency)]?.treasury ?? 0;
  if (treasury < 1) return "the President's treasury is empty";
  return undefined;
}

export function startTrade(state: GameState, presidency: PresidencyId): GameState {
  const activity: TradeActivity = {
    kind: "trade",
    stage: "declare",
    declared: [homeRegionOf(state, presidency)],
    ships: 0,
    placedOrderIds: [],
  };
  return withActivity(state, presidency, activity);
}

// ---- placement: "as many writers as possible" ---------------------------------------------------

/** Orders that may be filled next: the home port first, then orders adjacent to a filled one. */
function frontier(state: GameState, presidency: PresidencyId, activity: TradeActivity, placed: string[]): string[] {
  const nodes = orderNodes(state);
  const allowed = new Set(activity.declared);
  if (placed.length === 0) {
    const port = homePort(state, presidency);
    return port && isOrderAvailable(port) ? [port.id] : [];
  }
  const result = new Set<string>();
  for (const id of placed) {
    for (const nextId of nodes.get(id)!.order.connectedOrderIds) {
      const next = nodes.get(nextId);
      if (!next || placed.includes(nextId) || !allowed.has(next.regionId) || !isOrderAvailable(next.order)) continue;
      result.add(nextId);
    }
  }
  return [...result];
}

function maxPlacements(
  state: GameState,
  presidency: PresidencyId,
  activity: TradeActivity,
  placed: string[],
  remaining: number,
  memo = new Map<string, number>(),
): number {
  if (remaining <= 0) return 0;
  const key = `${[...placed].sort().join(",")}|${remaining}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best = 0;
  for (const orderId of frontier(state, presidency, activity, placed)) {
    best = Math.max(best, 1 + maxPlacements(state, presidency, activity, [...placed, orderId], remaining - 1, memo));
    if (best === remaining) break;
  }
  memo.set(key, best);
  return best;
}

/** Next orders that still allow the maximum number of placements. */
export function placementCandidates(state: GameState, presidency: PresidencyId, activity: TradeActivity): string[] {
  const remaining = activity.ships - activity.placedOrderIds.length;
  if (remaining <= 0) return [];
  const memo = new Map<string, number>();
  const best = maxPlacements(state, presidency, activity, activity.placedOrderIds, remaining, memo);
  if (best === 0) return [];
  return frontier(state, presidency, activity, activity.placedOrderIds).filter(
    (orderId) =>
      1 + maxPlacements(state, presidency, activity, [...activity.placedOrderIds, orderId], remaining - 1, memo) === best,
  );
}

// ---- decisions ------------------------------------------------------------------------------------

export function tradeDecision(state: GameState, presidency: PresidencyId, activity: TradeActivity): PendingDecision {
  const president = presidentOf(state, presidency) ?? "system";
  const treasury = state.company.offices[presidentOfficeId(presidency)]?.treasury ?? 0;
  const commands: LegalCommand[] = [];
  let prompt: string;

  if (activity.stage === "declare") {
    const penalty = activity.declared.length - 1;
    prompt = `Trade from ${presidency}: declared ${activity.declared.join(", ")} (−${penalty} ${penalty === 1 ? "die" : "dice"}). Add regions or roll (treasury £${treasury}).`;
    for (let spend = penalty + 1; spend <= treasury; spend += 1) {
      commands.push({
        type: "companyOperation.trade",
        label: `Spend £${spend} and roll ${spend - penalty} ${spend - penalty === 1 ? "die" : "dice"}`,
        payload: { action: "roll", spend } satisfies TradePayload,
      });
    }
    for (const regionId of declarableRegions(state, presidency, activity.declared)) {
      if (treasury < activity.declared.length + 1) continue;
      commands.push({
        type: "companyOperation.trade",
        label: `Also declare ${state.india.regions[regionId].name} (one more die of penalty)`,
        payload: { action: "declare", regionId } satisfies TradePayload,
      });
    }
    commands.push({
      type: "companyOperation.trade",
      label: "Cancel this Trade",
      payload: { action: "cancel" } satisfies TradePayload,
    });
  } else {
    const box = state.india.presidencies[presidency].writers;
    const writersInBox = Object.entries(box).filter(([, count]) => count > 0).map(([playerId]) => playerId);
    const remaining = activity.ships - activity.placedOrderIds.length;
    prompt = `Trade succeeded: fill the next order (${remaining} ship${remaining === 1 ? "" : "s"} left; placed ${activity.placedOrderIds.length}).`;
    for (const orderId of placementCandidates(state, presidency, activity)) {
      if (writersInBox.length === 0) {
        commands.push({
          type: "companyOperation.trade",
          label: `Fill ${orderId} with a filled-order token (no writers left)`,
          payload: { action: "place", orderId, writer: "token" } satisfies TradePayload,
        });
        continue;
      }
      for (const playerId of writersInBox) {
        commands.push({
          type: "companyOperation.trade",
          label: `Place a ${playerName(state, playerId)} writer on ${orderId}`,
          payload: { action: "place", orderId, writer: playerId } satisfies TradePayload,
        });
      }
    }
  }

  return {
    id: decisionId(state, `company-operation-trade-${presidency.toLowerCase()}`),
    phase: "companyOperation",
    step: `companyOperation.trade.${activity.stage}`,
    actor: president,
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

// ---- steps ----------------------------------------------------------------------------------------

export function tradeStep(state: GameState, presidency: PresidencyId, activity: TradeActivity, payload: TradePayload): StepResult {
  switch (payload.action) {
    case "declare":
      return {
        state: withActivity(state, presidency, { ...activity, declared: [...activity.declared, payload.regionId] }),
        summary: `The President of ${presidency} declared ${state.india.regions[payload.regionId].name} for Trade.`,
      };
    case "cancel":
      return {
        state: withActivity(state, presidency, undefined),
        summary: `The President of ${presidency} cancelled the Trade.`,
      };
    case "roll": {
      const penalty = activity.declared.length - 1;
      const dice = payload.spend - penalty;
      const paid = changeOfficeTreasury(state, presidentOfficeId(presidency), -payload.spend);
      const check = rollCheck(paid.rng, dice, `companyOperation.trade.${presidency}`);
      const rolled: GameState = { ...paid, rng: check.rng };
      const pending: PendingCheck = {
        context: "trade",
        presidency,
        dice,
        values: check.values,
        outcome: check.outcome,
      };
      const summary = `The President of ${presidency} spent £${payload.spend} to Trade in ${activity.declared.join(", ")}: ${dice} ${dice === 1 ? "die" : "dice"} [${check.values.join(", ")}], ${check.outcome}.`;
      const rngRolls = check.roll ? [check.roll] : undefined;

      // Mercantile Connection (blackmail #8) may force a reroll after any Trade check.
      const holder = unplayedBlackmailHolder(rolled, "mercantile-connection");
      if (holder) {
        return {
          state: withCo(rolled, { interrupt: { kind: "connection", cardId: "mercantile-connection", holder, check: pending } }),
          summary,
          details: { spend: payload.spend, dice, values: check.values, outcome: check.outcome },
          rngRolls,
        };
      }
      const resolved = resolveTradeCheck(rolled, pending);
      return { state: resolved.state, summary: `${summary} ${resolved.note}`.trim(), rngRolls };
    }
    case "place":
      return placeOrder(state, presidency, activity, payload.orderId, payload.writer);
  }
}

/** Apply a Trade check's result (after any Mercantile Connection reroll). */
export function resolveTradeCheck(
  state: GameState,
  check: Extract<PendingCheck, { context: "trade" }>,
): { state: GameState; note: string } {
  const presidency = check.presidency;
  const progress = presidencyProgress(state, presidency);
  const activity = progress.activity;

  if (check.outcome === "success" && activity?.kind === "trade") {
    const placing: TradeActivity = {
      ...activity,
      stage: "place",
      ships: shipsInPresidencyZone(state, presidency),
      placedOrderIds: [],
    };
    return { state: withActivity(state, presidency, placing), note: "Place writers on orders." };
  }
  if (check.outcome === "catastrophe") {
    const president = presidentOf(state, presidency);
    return {
      state: withActivity(vacateAfterCatastrophe(state, presidentOfficeId(presidency)), presidency, undefined),
      note: `${playerName(state, president)}'s President of ${presidency} returns to supply; the Chairman orders the rest of this Presidency.`,
    };
  }
  return {
    state: withActivity(state, presidency, undefined),
    note: "The President may try again while the treasury allows.",
  };
}

function placeOrder(
  state: GameState,
  presidency: PresidencyId,
  activity: TradeActivity,
  orderId: string,
  writer: PlayerId | "token",
): StepResult {
  let next: GameState = {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([regionId, region]) => [
          regionId,
          {
            ...region,
            orders: region.orders.map((order) =>
              order.id === orderId
                ? {
                    ...order,
                    filledThisTurnBy: [...order.filledThisTurnBy, "company"],
                    writer: writer === "token" ? undefined : { playerId: writer, presidency },
                  }
                : order,
            ),
          },
        ]),
      ),
    },
  };
  if (writer !== "token") {
    const box = next.india.presidencies[presidency];
    next = {
      ...next,
      india: {
        ...next.india,
        presidencies: {
          ...next.india.presidencies,
          [presidency]: { ...box, writers: { ...box.writers, [writer]: (box.writers[writer] ?? 0) - 1 } },
        },
      },
    };
  }

  const placing: TradeActivity = { ...activity, placedOrderIds: [...activity.placedOrderIds, orderId] };
  const summary =
    writer === "token"
      ? `Filled ${orderId} with a filled-order token.`
      : `Placed a ${playerName(state, writer)} writer on ${orderId}.`;
  next = withActivity(next, presidency, placing);

  if (placementCandidates(next, presidency, placing).length > 0) return { state: next, summary };

  const finished = finishTrade(next, presidency, placing);
  return { state: finished.state, summary: `${summary} ${finished.summary}`, details: finished.details };
}

function finishTrade(state: GameState, presidency: PresidencyId, activity: TradeActivity) {
  const nodes = orderNodes(state);
  const filled = activity.placedOrderIds.map((orderId) => nodes.get(orderId)!.order);
  const revenue = filled.reduce((total, order) => total + order.value, 0);
  let next = addToCompanyBalance(state, revenue);

  const bonus = payOfficeholderBonus(next, presidentOfficeId(presidency), filled.length);
  next = bonus.state;

  // Writer bonuses: £1 per writer placed (Writer Privileges: +£1; Writer Graft Reform: to the Balance).
  const perWriter = isLawInEffect(next, "writer-privileges") ? 2 : 1;
  const writersByPlayer = new Map<PlayerId, number>();
  for (const order of filled) {
    if (order.writer) writersByPlayer.set(order.writer.playerId, (writersByPlayer.get(order.writer.playerId) ?? 0) + 1);
  }
  const writerBonuses: Record<PlayerId, number> = {};
  for (const [playerId, count] of writersByPlayer) {
    writerBonuses[playerId] = count * perWriter;
    next = isLawInEffect(next, "writer-graft-reform")
      ? addToCompanyBalance(next, count * perWriter)
      : payPlayer(next, playerId, count * perWriter);
  }

  const co = coState(next);
  next = withCo(withActivity(next, presidency, undefined), {
    tradedPresidencies: [...(co.tradedPresidencies ?? []), presidency],
  });

  return {
    state: next,
    summary: `Trade complete: ${filled.length} order${filled.length === 1 ? "" : "s"} worth £${revenue} to the Company Balance; President's bonus £${filled.length}.`,
    details: { orders: activity.placedOrderIds, revenue, presidentBonus: filled.length, bonusRecipient: bonus.recipient, writerBonuses },
  };
}
