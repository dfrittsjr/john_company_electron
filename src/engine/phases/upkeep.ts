import type { CommandHandler } from "../command-handler";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  IndiaState,
  PlayerId,
  PresidencyId,
} from "../types";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

export function confirmUpkeep(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "upkeep" || state.pendingDecision.step !== "upkeep.confirm") {
    return wrongPhase("Upkeep confirmation can only be chosen during starter Upkeep.");
  }

  const now = command.clientTimestamp;
  const cleanup = cleanFilledOrders(state);
  const refresh = refreshArmies(cleanup.state);
  const stateAfterUpkeep = refresh.state;
  const shouldScore = state.turn >= state.finalTurn;
  const nextTurn = shouldScore ? state.turn : state.turn + 1;
  const nextDecision = shouldScore
    ? createSystemDecision({
        id: `decision-final-scoring-confirm-turn-${state.turn}`,
        phase: "finalScoring",
        step: "finalScoring.confirm",
        prompt: "Confirm starter Final Scoring.",
        commandType: "finalScoring.confirm",
        label: "Confirm Final Scoring",
        description: "Starter scaffold: records that Final Scoring was confirmed.",
      })
    : createSystemDecision({
        id: `decision-london-season-confirm-turn-${nextTurn}`,
        phase: "londonSeason",
        step: "londonSeason.confirm",
        prompt: "Confirm starter London Season.",
        commandType: "londonSeason.confirm",
        label: "Confirm London Season",
        description: "Starter scaffold: records that London Season was confirmed.",
      });
  const logEntry = createCommandLogEntry({
    state: stateAfterUpkeep,
    command,
    now,
    type: "upkeep.resolved",
    summary: shouldScore
      ? "Upkeep resolved. The game is ready for final scoring."
      : `Upkeep resolved. Advanced to turn ${nextTurn}.`,
    details: {
      ...cleanup.details,
      ...refresh.details,
      note: "Prize upkeep, extra ships, and local alliances are still TODO.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...stateAfterUpkeep,
      updatedAt: now,
      turn: nextTurn,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
      log: [...stateAfterUpkeep.log, logEntry],
    },
  };
}

function refreshArmies(state: GameState): {
  state: GameState;
  details: {
    refreshedArmies: Array<{
      armyId: string;
      regimentsReadied: number;
      officersReadiedByPlayer: Record<PlayerId, number>;
    }>;
  };
} {
  const refreshedArmies: Array<{
    armyId: string;
    regimentsReadied: number;
    officersReadiedByPlayer: Record<PlayerId, number>;
  }> = [];
  const armies: GameState["company"]["armies"] = { ...state.company.armies };
  for (const [armyId, army] of Object.entries(state.company.armies)) {
    const officersReadiedByPlayer: Record<PlayerId, number> = {};
    const officers: typeof army.officers = {};
    for (const [playerId, stack] of Object.entries(army.officers)) {
      if (stack.exhausted > 0) {
        officersReadiedByPlayer[playerId] = stack.exhausted;
      }

      officers[playerId] = {
        ready: stack.ready + stack.exhausted,
        exhausted: 0,
      };
    }
    const regimentsReadied = army.regiments.exhausted;

    if (regimentsReadied > 0 || Object.keys(officersReadiedByPlayer).length > 0) {
      refreshedArmies.push({
        armyId,
        regimentsReadied,
        officersReadiedByPlayer,
      });
    }

    armies[army.id] = {
      ...army,
      officers,
      regiments: {
        ready: army.regiments.ready + army.regiments.exhausted,
        exhausted: 0,
      },
    };
  }

  return {
    state: {
      ...state,
      company: {
        ...state.company,
        armies,
      },
    },
    details: {
      refreshedArmies,
    },
  };
}

function cleanFilledOrders(state: GameState): {
  state: GameState;
  details: {
    returnedWriters: Array<{ playerId: PlayerId; presidency: PresidencyId; orderId: string }>;
    cleanedOrderIds: string[];
  };
} {
  let india: IndiaState = state.india;
  const returnedWriters: Array<{ playerId: PlayerId; presidency: PresidencyId; orderId: string }> = [];
  const cleanedOrderIds: string[] = [];

  const regions = Object.fromEntries(
    Object.entries(state.india.regions).map(([regionId, region]) => {
      let regionChanged = false;
      const orders = region.orders.map((order) => {
        const shouldCleanFilledMarkers = order.filledThisTurnBy.length > 0;
        if (shouldCleanFilledMarkers) {
          cleanedOrderIds.push(order.id);
          regionChanged = true;
        }

        if (!order.writer) {
          return shouldCleanFilledMarkers ? { ...order, filledThisTurnBy: [] } : order;
        }

        regionChanged = true;
        const writer = order.writer;
        const presidency = india.presidencies[writer.presidency];
        india = {
          ...india,
          presidencies: {
            ...india.presidencies,
            [writer.presidency]: {
              ...presidency,
              writers: {
                ...presidency.writers,
                [writer.playerId]: (presidency.writers[writer.playerId] ?? 0) + 1,
              },
            },
          },
        };
        returnedWriters.push({
          playerId: writer.playerId,
          presidency: writer.presidency,
          orderId: order.id,
        });

        return {
          ...order,
          writer: undefined,
          filledThisTurnBy: [],
        };
      });

      return [
        regionId,
        !regionChanged
          ? region
          : {
              ...region,
              orders,
            },
      ];
    }),
  );

  return {
    state: {
      ...state,
      india: {
        ...india,
        regions,
      },
    },
    details: {
      returnedWriters,
      cleanedOrderIds,
    },
  };
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const upkeepCommandHandlers: Record<string, CommandHandler> = {
  "upkeep.confirm": confirmUpkeep,
};
