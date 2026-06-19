import type { ApplyCommandResult, GameCommand, GameState } from "../types";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

export function confirmRevenue(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.confirm") {
    return wrongPhase("Revenue confirmation can only be chosen during Revenue expenses.");
  }

  const now = command.clientTimestamp;
  const expenses = calculateCompanyExpenses(state);
  const emergencyLoans = calculateEmergencyLoans(state.company.balance, expenses.total);
  const availableBalance = state.company.balance + emergencyLoans * 5;
  const endingBalance = availableBalance - expenses.total;
  const embarrassmentStandingLoss = emergencyLoans;
  const expectationsStandingLoss = endingBalance < state.company.expectations ? 1 : 0;
  const standingAfterExpenses =
    state.company.standing - embarrassmentStandingLoss - expectationsStandingLoss;
  const companyAfterExpenses = {
    ...state.company,
    balance: endingBalance,
    debt: state.company.debt + emergencyLoans,
    standing: standingAfterExpenses,
  };
  const nextDecision = createDividendDecision({
    ...state,
    company: companyAfterExpenses,
  });
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "revenue.expensesResolved",
    summary:
      expenses.total === 0
        ? "Revenue resolved with no Company expenses."
        : `Revenue paid £${expenses.total} in Company expenses.`,
    details: {
      expenses,
      emergencyLoans,
      startingBalance: state.company.balance,
      endingBalance,
      publicEmbarrassmentStandingLoss: embarrassmentStandingLoss,
      expectationsStandingLoss,
      startingStanding: state.company.standing,
      standingAfterExpenses,
      assumption:
        "Each Debt, army piece, and ship in a Presidency sea zone costs £1; each emergency loan adds £5 Balance and 1 Debt. Public embarrassment lowers Standing by one per emergency loan; Expectations lower Standing by one if ending Balance is below Expectations.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
      company: companyAfterExpenses,
      log: [...state.log, logEntry],
    },
  };
}

export function chooseRevenueDividends(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.chooseDividends") {
    return wrongPhase("Revenue dividends can only be chosen during Revenue dividends.");
  }

  const payload = command.payload as { amountPerShare?: unknown };
  const rawAmountPerShare = payload.amountPerShare;
  if (
    typeof rawAmountPerShare !== "number" ||
    !Number.isInteger(rawAmountPerShare) ||
    rawAmountPerShare < 0
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_REVENUE_DIVIDEND",
          message: "Dividend amount must be a whole non-negative GBP amount per Company share.",
          field: "payload.amountPerShare",
        },
      ],
    };
  }
  const amountPerShare = rawAmountPerShare as number;

  const shareCount = countCompanyShares(state);
  const totalDividends = amountPerShare * shareCount;
  if (totalDividends > state.company.balance) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_REVENUE_DIVIDEND",
          message: "Dividend amount exceeds the Company Balance.",
          field: "payload.amountPerShare",
          details: {
            amountPerShare,
            shareCount,
            totalDividends,
            balance: state.company.balance,
          },
        },
      ],
    };
  }

  const now = command.clientTimestamp;
  const dividendIncomeByPlayer = calculateDividendIncomeByPlayer(state, amountPerShare);
  const standingGain = totalDividends > state.company.expectations ? 1 : 0;
  const endingStanding = state.company.standing + standingGain;
  const failed = endingStanding < 0;
  const nextDecision = createSystemDecision({
    id: `decision-events-in-india-confirm-turn-${state.turn}`,
    phase: "eventsInIndia",
    step: "eventsInIndia.confirm",
    prompt: "Confirm starter Events in India.",
    commandType: "eventsInIndia.confirm",
    label: "Confirm Events in India",
    description: "Starter scaffold: records that Events in India were confirmed.",
  });
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "revenue.dividendsResolved",
    summary:
      totalDividends === 0
        ? "Revenue paid no dividends."
        : `Revenue paid £${totalDividends} in dividends.`,
    details: {
      amountPerShare,
      shareCount,
      totalDividends,
      dividendIncomeByPlayer,
      expectations: state.company.expectations,
      standingGain,
      endingStanding,
      failed,
      assumption:
        "Dividends are paid as a whole-GBP amount per current Company share; dividends greater than Expectations raise Standing by one.",
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...state,
      updatedAt: now,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
      players: Object.fromEntries(
        Object.entries(state.players).map(([playerId, player]) => [
          playerId,
          {
            ...player,
            cash: player.cash + (dividendIncomeByPlayer[playerId] ?? 0),
          },
        ]),
      ),
      company: {
        ...state.company,
        balance: state.company.balance - totalDividends,
        standing: endingStanding,
        failed,
      },
      log: [...state.log, logEntry],
    },
  };
}

function calculateCompanyExpenses(state: GameState) {
  const debt = state.company.debt;
  const armies = Object.values(state.company.armies).reduce((total, army) => {
    const officerCount = Object.values(army.officers).reduce(
      (officerTotal, stack) => officerTotal + stack.ready + stack.exhausted,
      0,
    );

    return total + army.regiments.ready + army.regiments.exhausted + officerCount;
  }, 0);
  const seaZones = new Set(Object.values(state.india.presidencies).map((presidency) => presidency.seaZone));
  const ships = state.company.ships.filter((ship) => seaZones.has(ship.location)).length;

  return {
    debt,
    armies,
    ships,
    total: debt + armies + ships,
  };
}

function calculateEmergencyLoans(balance: number, expenses: number): number {
  const shortfall = expenses - balance;
  if (shortfall <= 0) return 0;

  return Math.ceil(shortfall / 5);
}

function createDividendDecision(state: GameState) {
  const shareCount = countCompanyShares(state);
  const maxAmountPerShare = shareCount === 0 ? 0 : Math.floor(state.company.balance / shareCount);
  const legalCommands = Array.from({ length: maxAmountPerShare + 1 }, (_, amountPerShare) => ({
    type: "revenue.chooseDividends",
    label: amountPerShare === 0 ? "Pay No Dividends" : `Pay £${amountPerShare} Per Share`,
    description:
      amountPerShare === 0
        ? "Advance without paying Company-share dividends."
        : `Pay £${amountPerShare} to each current Company share.`,
    payload: { amountPerShare },
  }));
  const chairman = state.company.offices.chairman?.holder;

  return {
    id: `decision-revenue-dividends-turn-${state.turn}`,
    phase: "revenue" as const,
    step: "revenue.chooseDividends",
    actor: chairman ?? "system",
    visibility: "public" as const,
    prompt: chairman
      ? "Chairman may pay dividends to Company shares."
      : "No Chairman is in office; choose Revenue dividends.",
    legalCommands,
    canSave: true as const,
  };
}

function countCompanyShares(state: GameState): number {
  return state.company.court.filter((share) => share.owner).length + countChairmanShares(state);
}

function countChairmanShares(state: GameState): number {
  return Object.values(state.players).filter((player) => player.familyMembers.chairmanShare).length;
}

function calculateDividendIncomeByPlayer(
  state: GameState,
  amountPerShare: number,
): Record<string, number> {
  const incomeByPlayer: Record<string, number> = {};

  for (const share of state.company.court) {
    if (!share.owner) continue;
    incomeByPlayer[share.owner] = (incomeByPlayer[share.owner] ?? 0) + amountPerShare;
  }

  for (const player of Object.values(state.players)) {
    if (!player.familyMembers.chairmanShare) continue;
    incomeByPlayer[player.id] = (incomeByPlayer[player.id] ?? 0) + amountPerShare;
  }

  return incomeByPlayer;
}
