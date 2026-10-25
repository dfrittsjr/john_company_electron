import { isShipFitted, shipForShipyard } from "../selectors";
import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

export function confirmBonuses(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "bonuses" || state.pendingDecision.step !== "bonuses.confirm") {
    return wrongPhase("Bonuses confirmation can only be chosen during Bonuses.");
  }

  const now = command.clientTimestamp;
  const incomeByPlayer = calculateBonusIncome(state);
  const players = Object.fromEntries(
    Object.entries(state.players).map(([playerId, player]) => [
      playerId,
      {
        ...player,
        cash: player.cash + (incomeByPlayer[playerId]?.total ?? 0),
      },
    ]),
  );
  const stateAfterBonuses: GameState = {
    ...state,
    players,
  };
  const totalIncome = Object.values(incomeByPlayer).reduce(
    (sum, income) => sum + income.total,
    0,
  );
  const logEntry = createCommandLogEntry({
    state: stateAfterBonuses,
    command,
    now,
    type: "bonuses.confirmed",
    summary: `Bonuses paid £${totalIncome}.`,
    details: {
      incomeByPlayer,
    },
  });
  const nextDecision = createSystemDecision({
    id: `decision-revenue-confirm-turn-${state.turn}`,
    phase: "revenue",
    step: "revenue.confirm",
    prompt: "Confirm starter Revenue.",
    commandType: "revenue.confirm",
    label: "Confirm Revenue",
    description: "Starter scaffold: records that Revenue was confirmed.",
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...stateAfterBonuses,
      updatedAt: now,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
      log: [...stateAfterBonuses.log, logEntry],
    },
  };
}

function calculateBonusIncome(state: GameState): Record<
  string,
  {
    workshops: number;
    fittedShipyards: number;
    total: number;
  }
> {
  const incomeByPlayer: Record<string, { workshops: number; fittedShipyards: number; total: number }> = {};

  for (const player of Object.values(state.players)) {
    if (player.isCrown) continue;

    const workshops = player.enterprises.filter((enterprise) => enterprise.type === "workshop").length;
    // A shipyard pays £1 if its ship has been fitted, i.e. it is no longer on the shipyard (p.13, p.26).
    const fittedShipyards = player.enterprises.filter(
      (enterprise) =>
        enterprise.type === "shipyard" &&
        enterprise.cardId !== undefined &&
        isShipFitted(shipForShipyard(state, enterprise.cardId)),
    ).length;
    const total = workshops + fittedShipyards;
    if (total <= 0) continue;

    incomeByPlayer[player.id] = {
      workshops,
      fittedShipyards,
      total,
    };
  }

  return incomeByPlayer;
}
