import type { CommandHandler } from "../command-handler";
import { MAX_COMPANY_DEBT, MAX_STANDING_SPACE, expectationsForStanding } from "../../data";
import {
  chairmanHolder,
  companyExpectations,
  companyShareCount,
  shipsInSeaZones,
} from "../selectors";
import type { ApplyCommandResult, CompanyState, GameCommand, GameState, PendingDecision } from "../types";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

const EMERGENCY_LOAN = 5;

// Revenue (p.27): expenses, emergency loans, public embarrassment, expectations, then dividends.
export function confirmRevenue(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.confirm") {
    return wrongPhase("Revenue confirmation can only be chosen during Revenue expenses.");
  }

  const now = command.clientTimestamp;
  const expenses = calculateCompanyExpenses(state);
  const startingBalance = state.company.balance;
  const emergencyLoans = calculateEmergencyLoans(startingBalance, expenses.total);
  // Loans are taken until expenses are met; Debt stops at the end of the track but loans
  // continue. Any surplus from the last loan is lost: "Finally, set the Company Balance to zero."
  const endingBalance = emergencyLoans > 0 ? 0 : startingBalance - expenses.total;
  const debtAfterLoans = Math.min(MAX_COMPANY_DEBT, state.company.debt + emergencyLoans);
  const embarrassmentStandingLoss = emergencyLoans === 0 ? 0 : emergencyLoans <= 2 ? 1 : 2;

  let company: CompanyState = {
    ...state.company,
    balance: endingBalance,
    debt: debtAfterLoans,
  };
  company = lowerStanding(company, embarrassmentStandingLoss);

  const expectations = expectationsForStanding(company.standing);
  const expectationsStandingLoss =
    !company.failed && expectations !== null && endingBalance < expectations ? 1 : 0;
  company = lowerStanding(company, expectationsStandingLoss);

  const stateAfterExpenses: GameState = { ...state, company };
  const nextDecision = company.failed
    ? createFinalScoringDecision(stateAfterExpenses)
    : createDividendDecision(stateAfterExpenses);
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "revenue.expensesResolved",
    summary: company.failed
      ? "The Company failed during Revenue."
      : expenses.total === 0
        ? "Revenue resolved with no Company expenses."
        : `Revenue paid £${expenses.total} in Company expenses.`,
    details: {
      expenses,
      emergencyLoans,
      startingBalance,
      endingBalance,
      debtAfterLoans,
      publicEmbarrassmentStandingLoss: embarrassmentStandingLoss,
      expectations,
      expectationsStandingLoss,
      startingStanding: state.company.standing,
      standingAfterExpenses: company.standing,
      failed: company.failed,
    },
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...stateAfterExpenses,
      updatedAt: now,
      phase: nextDecision.phase,
      pendingDecision: nextDecision,
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
          message: "Choose a whole, non-negative number of dividends (each pays £1 per Company share).",
          field: "payload.amountPerShare",
        },
      ],
    };
  }
  const amountPerShare = rawAmountPerShare as number;

  const shareCount = companyShareCount(state);
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
  const expectations = companyExpectations(state);
  // Public Enthusiasm: advance Standing if more cash was paid in dividends than Expectations.
  const standingGain = expectations !== null && totalDividends > expectations ? 1 : 0;
  const endingStanding = Math.min(MAX_STANDING_SPACE, state.company.standing + standingGain);
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
      expectations,
      standingGain,
      endingStanding,
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
      },
      log: [...state.log, logEntry],
    },
  };
}

/** Move Standing left; reaching the leftmost space fails the Company immediately (p.9, p.27). */
export function lowerStanding(company: CompanyState, spaces: number): CompanyState {
  if (spaces <= 0 || company.failed) return company;

  const standing = Math.max(0, company.standing - spaces);
  return { ...company, standing, failed: standing === 0 };
}

export function createFinalScoringDecision(state: GameState): PendingDecision {
  return createSystemDecision({
    id: `decision-final-scoring-confirm-turn-${state.turn}`,
    phase: "finalScoring",
    step: "finalScoring.confirm",
    prompt: state.company.failed
      ? "The Company has failed. Confirm Final Scoring."
      : "Confirm starter Final Scoring.",
    commandType: "finalScoring.confirm",
    label: "Confirm Final Scoring",
    description: "Starter scaffold: records that Final Scoring was confirmed.",
  });
}

// Expenses: £1 per Debt, per regiment and officer in an Army (not Commanders), and per ship in
// the three sea zones. Ships trading in China count as Eastern ships (p.25).
function calculateCompanyExpenses(state: GameState) {
  const debt = state.company.debt;
  const armies = Object.values(state.company.armies).reduce((total, army) => {
    const officerCount = Object.values(army.officers).reduce(
      (officerTotal, stack) => officerTotal + stack.ready + stack.exhausted,
      0,
    );

    return total + army.regiments.ready + army.regiments.exhausted + officerCount;
  }, 0);
  const ships = shipsInSeaZones(state).length;

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

  return Math.ceil(shortfall / EMERGENCY_LOAN);
}

function createDividendDecision(state: GameState): PendingDecision {
  const shareCount = companyShareCount(state);
  const maxAmountPerShare = shareCount === 0 ? 0 : Math.floor(state.company.balance / shareCount);
  const legalCommands = Array.from({ length: maxAmountPerShare + 1 }, (_, amountPerShare) => ({
    type: "revenue.chooseDividends",
    label:
      amountPerShare === 0
        ? "Pay No Dividends"
        : `Pay ${amountPerShare} Dividend${amountPerShare === 1 ? "" : "s"} (£${amountPerShare * shareCount})`,
    description:
      amountPerShare === 0
        ? "Advance without paying Company-share dividends."
        : `Each dividend costs £${shareCount} (one per Company share, Chairman included).`,
    payload: { amountPerShare },
  }));
  const chairman = chairmanHolder(state);

  return {
    id: `decision-revenue-dividends-turn-${state.turn}`,
    phase: "revenue",
    step: "revenue.chooseDividends",
    actor: chairman ?? "system",
    visibility: "public",
    prompt: chairman
      ? "Chairman may pay dividends to Company shares."
      : "No Chairman is in office; choose Revenue dividends.",
    legalCommands,
    canSave: true,
  };
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

  const chairman = chairmanHolder(state);
  if (chairman) incomeByPlayer[chairman] = (incomeByPlayer[chairman] ?? 0) + amountPerShare;

  return incomeByPlayer;
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const revenueCommandHandlers: Record<string, CommandHandler> = {
  "revenue.confirm": confirmRevenue,
  "revenue.chooseDividends": chooseRevenueDividends,
};
