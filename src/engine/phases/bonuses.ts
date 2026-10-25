import type { CommandHandler } from "../command-handler";
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

type BonusIncome = { workshops: number; fittedShipyards: number; prizeFamilyMembers?: number; total: number };

function calculateBonusIncome(state: GameState): Record<string, BonusIncome> {
  const incomeByPlayer: Record<string, BonusIncome> = {};
  // Inclosure Acts (law #36): each family member on a prize earns £1 during Bonuses.
  const inclosureActs = state.parliament.passedLaws.some((law) => law.lawId === "inclosure-acts");

  for (const player of Object.values(state.players)) {
    const workshops = player.enterprises.filter((enterprise) => enterprise.type === "workshop" && !enterprise.invested).length;
    // A shipyard pays £1 if its ship has been fitted, i.e. it is no longer on the shipyard (p.13, p.26).
    const fittedShipyards = player.enterprises.filter(
      (enterprise) =>
        enterprise.type === "shipyard" &&
        enterprise.cardId !== undefined &&
        isShipFitted(shipForShipyard(state, enterprise.cardId)),
    ).length;
    const prizeFamilyMembers = inclosureActs
      ? Object.values(player.familyMembers.prizes).reduce((sum, count) => sum + count, 0)
      : 0;
    const total = workshops + fittedShipyards + prizeFamilyMembers;
    if (total <= 0) continue;

    incomeByPlayer[player.id] = inclosureActs
      ? { workshops, fittedShipyards, prizeFamilyMembers, total }
      : { workshops, fittedShipyards, total };
  }

  return incomeByPlayer;
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const bonusesCommandHandlers: Record<string, CommandHandler> = {
  "bonuses.confirm": confirmBonuses,
};
