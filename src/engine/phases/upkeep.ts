import { exhaustActiveLocalAlliances, returnExtraShips } from "./company-operation";
import type { CommandHandler } from "../command-handler";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  IndiaState,
  PendingDecision,
  PlayerId,
  PresidencyId,
} from "../types";
import { findLegalCommand, illegal, prizeDefinition } from "./retirements";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

// IX. Upkeep and Refresh (p.36). Every family member on a prize costs that prize's upkeep. A
// player who cannot pay returns pieces to supply, losing each prize's VP, until the rest is
// affordable. Then the board is refreshed, unless this was the final turn.

type Continuation = { state: GameState; ending?: string; details: Record<string, unknown> };

export function confirmUpkeep(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "upkeep" || state.pendingDecision.step !== "upkeep.confirm") {
    return wrongPhase("Upkeep confirmation can only be chosen at the start of Upkeep.");
  }

  const paid: Record<PlayerId, number> = {};
  const queue: PlayerId[] = [];
  let next = state;

  for (const playerId of state.seatingOrder) {
    const owed = prizeUpkeepOwed(next, playerId);
    if (owed === 0) continue;
    if (next.players[playerId].cash >= owed) {
      next = payUpkeep(next, playerId);
      paid[playerId] = owed;
    } else {
      queue.push(playerId);
    }
  }

  next = { ...next, londonSeason: { ...next.londonSeason, upkeep: { queue } } };
  const payments =
    Object.keys(paid).length === 0
      ? undefined
      : `Prize upkeep paid: ${Object.entries(paid).map(([playerId, amount]) => `${state.players[playerId].name} £${amount}`).join(", ")}.`;
  const shortfall =
    queue.length === 0
      ? undefined
      : `${queue.map((playerId) => state.players[playerId].name).join(", ")} cannot pay all prize upkeep.`;
  const continuation = continueUpkeep(next);

  return finish(state, command, continuation, "upkeep.resolved", [payments, shortfall], { paid, cannotPay: queue });
}

function forfeitPrizePiece(state: GameState, command: GameCommand): ApplyCommandResult {
  const queue = state.londonSeason.upkeep?.queue ?? [];
  if (state.pendingDecision.step !== "upkeep.cannotPay" || queue.length === 0) {
    return wrongPhase("No player is choosing pieces to give up.");
  }
  if (!findLegalCommand(state, command)) return illegal("That choice is not one of the listed choices.");

  const playerId = queue[0];
  const player = state.players[playerId];
  const payload = command.payload as { action: "forfeit" | "recheck"; prizeId?: string };
  let next = state;
  let summary = `${player.name} checked their cash for upkeep again.`;

  if (payload.action === "forfeit") {
    // "Return the family member to its supply and lower their owner's victory point marker by
    // that prize's value" (p.36).
    const prize = prizeDefinition(payload.prizeId as string)!;
    next = {
      ...next,
      players: {
        ...next.players,
        [playerId]: {
          ...player,
          victoryPoints: player.victoryPoints - prize.victoryPoints,
          familyMembers: {
            ...player.familyMembers,
            supply: player.familyMembers.supply + 1,
            prizes: { ...player.familyMembers.prizes, [prize.id]: (player.familyMembers.prizes[prize.id] ?? 0) - 1 },
          },
        },
      },
    };
    summary = `${player.name} could not pay upkeep and returned a piece from the £${prize.cost} prize (-${prize.victoryPoints} VP).`;
  }

  if (next.players[playerId].cash >= prizeUpkeepOwed(next, playerId)) {
    const owed = prizeUpkeepOwed(next, playerId);
    next = payUpkeep(next, playerId);
    next = { ...next, londonSeason: { ...next.londonSeason, upkeep: { queue: queue.slice(1) } } };
    summary += ` ${player.name} paid the remaining £${owed} upkeep.`;
  }

  return finish(state, command, continueUpkeep(next), "upkeep.cannotPay", [summary], { playerId, ...payload });
}

function continueUpkeep(state: GameState): Continuation {
  const queue = state.londonSeason.upkeep?.queue ?? [];
  if (queue.length > 0) return { state: { ...state, pendingDecision: cannotPayDecision(state, queue[0]) }, details: {} };

  const cleared: GameState = { ...state, londonSeason: { ...state.londonSeason, upkeep: undefined } };
  // "If it is the final turn of the game, skip this step and proceed to Final Scoring" (p.36).
  if (state.turn >= state.finalTurn) {
    return {
      state: {
        ...cleared,
        pendingDecision: createSystemDecision({
          id: `decision-final-scoring-confirm-turn-${state.turn}`,
          phase: "finalScoring",
          step: "finalScoring.confirm",
          prompt: "The final turn is over. Begin Final Scoring.",
          commandType: "finalScoring.confirm",
          label: "Begin Final Scoring",
          description: "Power Award, Company shares and workshops, then the final retirement or a failure card (p.9).",
        }),
      },
      ending: "Upkeep resolved. The game is ready for final scoring.",
      details: {},
    };
  }

  const refreshed = refreshBoard(cleared);
  const nextTurn = state.turn + 1;
  return {
    state: {
      ...refreshed.state,
      turn: nextTurn,
      pendingDecision: createSystemDecision({
        id: `decision-london-season-confirm-turn-${nextTurn}`,
        phase: "londonSeason",
        step: "londonSeason.confirm",
        prompt: "Begin the London Season: attrition, retirements, and prestige cards.",
        commandType: "londonSeason.confirm",
        label: "Begin London Season",
        description: "Roll attrition for every office card, then retire pensioners (p.11).",
      }),
    },
    ending: `Upkeep resolved. Advanced to turn ${nextTurn}.`,
    details: refreshed.details,
  };
}

function cannotPayDecision(state: GameState, playerId: PlayerId): PendingDecision {
  const player = state.players[playerId];
  const owed = prizeUpkeepOwed(state, playerId);
  const legalCommands: PendingDecision["legalCommands"] = Object.entries(player.familyMembers.prizes)
    .filter(([prizeId, count]) => count > 0 && (prizeDefinition(prizeId)?.upkeep ?? 0) > 0)
    .map(([prizeId]) => {
      const prize = prizeDefinition(prizeId)!;
      return {
        type: "upkeep.forfeitPrizePiece",
        label: `Return a piece from the £${prize.cost} prize (saves £${prize.upkeep}, -${prize.victoryPoints} VP)`,
        payload: { action: "forfeit", prizeId },
      };
    });
  legalCommands.push({
    type: "upkeep.forfeitPrizePiece",
    label: "Check again after a loan from another player",
    payload: { action: "recheck" },
  });

  return {
    id: `decision-upkeep-cannot-pay-t${state.turn}-${playerId}-${state.log.length + 1}`,
    phase: "upkeep",
    step: "upkeep.cannotPay",
    actor: playerId,
    visibility: "public",
    prompt: `${player.name} owes £${owed} prize upkeep but has £${player.cash}. Return pieces from prizes until the rest is affordable, or borrow from another player.`,
    legalCommands,
    canSave: true,
  };
}

/** Upkeep owed for every family member on a prize (p.36). */
export function prizeUpkeepOwed(state: GameState, playerId: PlayerId): number {
  return Object.entries(state.players[playerId].familyMembers.prizes).reduce(
    (total, [prizeId, count]) => total + count * (prizeDefinition(prizeId)?.upkeep ?? 0),
    0,
  );
}

function payUpkeep(state: GameState, playerId: PlayerId): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, cash: player.cash - prizeUpkeepOwed(state, playerId) } },
  };
}

// --- Refresh (p.36) ---

function refreshBoard(state: GameState): { state: GameState; details: Record<string, unknown> } {
  // "Return all extra ships to the supply." "Any active local alliances are exhausted."
  // Presidency dividers need no state: each writer on an order records its Presidency.
  const extraShips = state.company.ships.filter((ship) => ship.kind === "extra").map((ship) => ship.id);
  const refreshed = exhaustActiveLocalAlliances(returnExtraShips(state));
  const orders = cleanFilledOrders(refreshed);
  const armies = refreshArmies(orders.state);

  return {
    state: armies.state,
    details: { ...orders.details, ...armies.details, returnedExtraShips: extraShips },
  };
}

type RefreshedArmy = { armyId: string; regimentsReadied: number; officersReadiedByPlayer: Record<PlayerId, number> };

/** "Any exhausted officers and regiments become active." */
function refreshArmies(state: GameState): { state: GameState; details: { refreshedArmies: RefreshedArmy[] } } {
  const refreshedArmies: RefreshedArmy[] = [];
  const armies: GameState["company"]["armies"] = { ...state.company.armies };

  for (const army of Object.values(state.company.armies)) {
    const officersReadiedByPlayer: Record<PlayerId, number> = {};
    for (const [playerId, stack] of Object.entries(army.officers)) {
      if (stack.exhausted > 0) officersReadiedByPlayer[playerId] = stack.exhausted;
    }
    if (army.regiments.exhausted > 0 || Object.keys(officersReadiedByPlayer).length > 0) {
      refreshedArmies.push({ armyId: army.id, regimentsReadied: army.regiments.exhausted, officersReadiedByPlayer });
    }

    armies[army.id] = {
      ...army,
      officers: Object.fromEntries(
        Object.entries(army.officers).map(([playerId, stack]) => [playerId, { ready: stack.ready + stack.exhausted, exhausted: 0 }]),
      ),
      regiments: { ready: army.regiments.ready + army.regiments.exhausted, exhausted: 0 },
    };
  }

  return { state: { ...state, company: { ...state.company, armies } }, details: { refreshedArmies } };
}

type ReturnedWriter = { playerId: PlayerId; presidency: PresidencyId; orderId: string };

/** "Return writers to their associated Presidency. Return filled order tokens ... to the supply." */
function cleanFilledOrders(state: GameState): {
  state: GameState;
  details: { returnedWriters: ReturnedWriter[]; cleanedOrderIds: string[] };
} {
  let india: IndiaState = state.india;
  const returnedWriters: ReturnedWriter[] = [];
  const cleanedOrderIds: string[] = [];

  const regions = Object.fromEntries(
    Object.entries(state.india.regions).map(([regionId, region]) => {
      const orders = region.orders.map((order) => {
        if (order.filledThisTurnBy.length > 0 || order.writer) cleanedOrderIds.push(order.id);
        if (!order.writer) return order.filledThisTurnBy.length > 0 ? { ...order, filledThisTurnBy: [] } : order;

        const { playerId, presidency } = order.writer;
        const box = india.presidencies[presidency];
        india = {
          ...india,
          presidencies: {
            ...india.presidencies,
            [presidency]: { ...box, writers: { ...box.writers, [playerId]: (box.writers[playerId] ?? 0) + 1 } },
          },
        };
        returnedWriters.push({ playerId, presidency, orderId: order.id });
        return { ...order, writer: undefined, filledThisTurnBy: [] };
      });
      return [regionId, { ...region, orders }];
    }),
  );

  return { state: { ...state, india: { ...india, regions } }, details: { returnedWriters, cleanedOrderIds } };
}

function finish(
  before: GameState,
  command: GameCommand,
  after: Continuation,
  type: string,
  summaryParts: Array<string | undefined>,
  details: Record<string, unknown>,
): ApplyCommandResult {
  const summary = [...summaryParts, after.ending].filter(Boolean).join(" ") || "Upkeep continues.";
  const logEntry = createCommandLogEntry({
    state: before,
    command,
    now: command.clientTimestamp,
    type,
    summary,
    details: { ...details, ...after.details },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...after.state,
      updatedAt: command.clientTimestamp,
      phase: after.state.pendingDecision.phase,
      log: [...before.log, logEntry],
    },
  };
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const upkeepCommandHandlers: Record<string, CommandHandler> = {
  "upkeep.confirm": confirmUpkeep,
  "upkeep.forfeitPrizePiece": forfeitPrizePiece,
};
