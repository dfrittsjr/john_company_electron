import type { CommandHandler } from "../command-handler";
import { MAX_COMPANY_DEBT, MAX_STANDING_SPACE, expectationsForStanding } from "../../data";
import { rollDice } from "../rng";
import {
  chairmanHolder,
  companyExpectations,
  companyShareCount,
  playerOffices,
  shipsInSeaZones,
} from "../selectors";
import type {
  ApplyCommandResult,
  CardInstance,
  CompanyState,
  GameCommand,
  GameState,
  LegalCommand,
  PendingDecision,
  PlayerId,
} from "../types";
import type { RevenueProgress } from "./parliament.state";
import { newCollector, nextDecisionId, playerName, primeMinisterOrder, updatePlayer, type Collector } from "./parliament/common";
import { discardPassedLaw, isLawPassed } from "./parliament/laws";
import { appendLog, registerDecisionRefresher } from "./negotiation";
import {
  blackmailCardName,
  blackmailOptionsForCard,
  registerBlackmailResume,
  registerInFlowBlackmail,
  startBlackmailPlay,
} from "./negotiation-blackmail";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";

const EMERGENCY_LOAN = 5;

// Revenue (p.27): start-of-Revenue effects, expenses, emergency loans, public embarrassment,
// expectations, dividends, then after-Revenue effects.
export function confirmRevenue(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.confirm") {
    return wrongPhase("Revenue confirmation can only be chosen during Revenue expenses.");
  }

  const collector = newCollector();
  let next = applyCalicoPenalty(state, collector);
  next = withRevenue(next, {
    stage: "companyFraud",
    fraudCandidates: primeMinisterOrder(next).filter((playerId) => companyFraudCard(next, playerId)),
    scandalCandidates: [],
  });
  return complete(state, next, command, collector, "revenue.started");
}

function withRevenue(state: GameState, revenue: RevenueProgress | undefined): GameState {
  return { ...state, parliament: { ...state.parliament, revenue } };
}

function patchRevenue(state: GameState, patch: Partial<RevenueProgress>): GameState {
  return withRevenue(state, { ...state.parliament.revenue!, ...patch });
}

/** Calico Acts: at the start of Revenue lower the Balance by £1 for every £7 (skipped after deregulation). */
function applyCalicoPenalty(state: GameState, collector: Collector): GameState {
  if (!isLawPassed(state, "calico-acts") || state.parliament.deregulated) return state;
  const penalty = Math.floor(state.company.balance / 7);
  if (penalty === 0) return state;
  collector.notes.push(`Calico Acts lowered the Company Balance by £${penalty}.`);
  return { ...state, company: { ...state.company, balance: state.company.balance - penalty } };
}

/** An unplayed (facedown) blackmail card of this kind in the player's area. */
function unplayedBlackmail(state: GameState, playerId: PlayerId, cardId: string): CardInstance | undefined {
  return state.players[playerId]?.blackmailCards.find((card) => card.cardId === cardId && card.facedown !== false);
}

/** Company Fraud needs at least one officeholder to roll for. */
function companyFraudCard(state: GameState, playerId: PlayerId): CardInstance | undefined {
  return playerOffices(state, playerId).length > 0 ? unplayedBlackmail(state, playerId, "company-fraud") : undefined;
}

// ---------------------------------------------------------------------------------------------
// Expenses (p.27).

/**
 * £1 per Debt (£2 under Company Aids Government), per regiment and officer in an Army (not
 * Commanders; regiments are free under Sepoy Recruitment), and per ship in the three sea zones.
 * Ships trading in China count as Eastern ships (p.25).
 */
export function calculateCompanyExpenses(state: GameState) {
  const debt = state.company.debt * (isLawPassed(state, "company-aids-government") ? 2 : 1);
  const regimentsFree = isLawPassed(state, "sepoy-recruitment");
  const armies = Object.values(state.company.armies).reduce((total, army) => {
    const officerCount = Object.values(army.officers).reduce(
      (officerTotal, stack) => officerTotal + stack.ready + stack.exhausted,
      0,
    );
    const regiments = regimentsFree ? 0 : army.regiments.ready + army.regiments.exhausted;
    return total + regiments + officerCount;
  }, 0);
  const ships = shipsInSeaZones(state).length;

  return { debt, armies, ships, total: debt + armies + ships };
}

function calculateEmergencyLoans(balance: number, expenses: number): number {
  const shortfall = expenses - balance;
  if (shortfall <= 0) return 0;

  return Math.ceil(shortfall / EMERGENCY_LOAN);
}

/**
 * Pays expenses. Loans are taken until expenses are met; Debt stops at the end of the track but
 * loans continue, and any surplus is lost ("Finally, set the Company Balance to zero"). With Royal
 * Protection discarded, no loans are taken and the rest of the expenses are cancelled.
 */
function resolveExpenses(state: GameState, royalProtection: boolean, collector: Collector): GameState {
  const expenses = calculateCompanyExpenses(state);
  const startingBalance = state.company.balance;
  const emergencyLoans = royalProtection ? 0 : calculateEmergencyLoans(startingBalance, expenses.total);
  const endingBalance = emergencyLoans > 0 || royalProtection ? 0 : startingBalance - expenses.total;
  const debtAfterLoans = Math.min(MAX_COMPANY_DEBT, state.company.debt + emergencyLoans);
  const embarrassmentStandingLoss = emergencyLoans === 0 ? 0 : emergencyLoans <= 2 ? 1 : 2;

  let company: CompanyState = { ...state.company, balance: endingBalance, debt: debtAfterLoans };
  company = lowerStanding(company, embarrassmentStandingLoss);
  const expectations = expectationsForStanding(company.standing);
  const expectationsStandingLoss = !company.failed && expectations !== null && endingBalance < expectations ? 1 : 0;
  company = lowerStanding(company, expectationsStandingLoss);

  Object.assign(collector.details, {
    expenses,
    emergencyLoans,
    royalProtectionUsed: royalProtection,
    startingBalance,
    endingBalance,
    debtAfterLoans,
    publicEmbarrassmentStandingLoss: embarrassmentStandingLoss,
    expectations,
    expectationsStandingLoss,
    startingStanding: state.company.standing,
    standingAfterExpenses: company.standing,
    failed: company.failed,
  });

  collector.notes.push(
    expenses.total === 0
      ? "Revenue resolved with no Company expenses."
      : royalProtection
        ? `Royal Protection was discarded: the Company paid £${Math.min(startingBalance, expenses.total)} and the remaining expenses were cancelled.`
        : `Revenue paid £${expenses.total} in Company expenses${emergencyLoans > 0 ? ` with ${emergencyLoans} emergency loan${emergencyLoans === 1 ? "" : "s"}` : ""}.`,
  );
  if (embarrassmentStandingLoss > 0) collector.notes.push(`Public embarrassment lowered Standing by ${embarrassmentStandingLoss}.`);
  if (expectationsStandingLoss > 0) collector.notes.push("The Balance fell short of Expectations, lowering Standing by 1.");
  if (company.failed) collector.notes.push("The Company failed during Revenue.");

  return { ...state, company };
}

// ---------------------------------------------------------------------------------------------
// Progress through Revenue's choices.

function progressRevenue(state: GameState, collector: Collector): { state: GameState; decision: PendingDecision } {
  let current = state;

  for (let guard = 0; guard < 50; guard += 1) {
    const progress = current.parliament.revenue;
    if (!progress) return { state: current, decision: createEventsInIndiaDecision(current) };

    switch (progress.stage) {
      case "companyFraud": {
        const [candidate, ...rest] = progress.fraudCandidates;
        if (candidate) {
          const card = companyFraudCard(current, candidate);
          if (card) return { state: current, decision: companyFraudDecision(current, candidate, card) };
          current = patchRevenue(current, { fraudCandidates: rest });
          continue;
        }

        const expenses = calculateCompanyExpenses(current);
        const needsLoans = calculateEmergencyLoans(current.company.balance, expenses.total) > 0;
        const chairman = chairmanHolder(current);
        if (needsLoans && chairman && isLawPassed(current, "royal-protection")) {
          current = patchRevenue(current, { stage: "royalProtection" });
          return { state: current, decision: royalProtectionDecision(current, chairman) };
        }
        current = patchRevenue(resolveExpenses(current, false, collector), { stage: "dividends" });
        continue;
      }
      case "royalProtection":
        return { state: current, decision: royalProtectionDecision(current, chairmanHolder(current)!) };
      case "dividends":
        if (current.company.failed) {
          current = withRevenue(current, undefined);
          return { state: current, decision: createFinalScoringDecision(current) };
        }
        return { state: current, decision: createDividendDecision(current) };
      case "scandal": {
        const [candidate, ...rest] = progress.scandalCandidates;
        if (!candidate) {
          current = withRevenue(current, undefined);
          continue;
        }
        const options = scandalCommands(current, candidate);
        if (options.length > 0) return { state: current, decision: scandalDecision(current, candidate, options) };
        current = patchRevenue(current, { scandalCandidates: rest });
        continue;
      }
    }
  }

  throw new Error("Revenue did not reach a decision.");
}

function complete(
  before: GameState,
  after: GameState,
  command: GameCommand,
  collector: Collector,
  logType: string,
): ApplyCommandResult {
  const progressed = progressRevenue(after, collector);
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: before,
    command,
    now,
    type: logType,
    summary: collector.notes.join(" ") || "Revenue continued.",
    details: {
      ...collector.details,
      balance: progressed.state.company.balance,
      debt: progressed.state.company.debt,
      standing: progressed.state.company.standing,
      failed: progressed.state.company.failed,
    },
    rngRolls: collector.rolls.length > 0 ? collector.rolls : undefined,
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...progressed.state,
      updatedAt: now,
      phase: progressed.decision.phase,
      pendingDecision: progressed.decision,
      log: [...before.log, logEntry],
    },
  };
}

function createEventsInIndiaDecision(state: GameState): PendingDecision {
  return createSystemDecision({
    id: `decision-events-in-india-confirm-turn-${state.turn}`,
    phase: "eventsInIndia",
    step: "eventsInIndia.confirm",
    prompt: "Confirm starter Events in India.",
    commandType: "eventsInIndia.confirm",
    label: "Confirm Events in India",
    description: "Starter scaffold: records that Events in India were confirmed.",
  });
}

// ---------------------------------------------------------------------------------------------
// Company Fraud (blackmail #2): "Play at the start of the Revenue phase."

function companyFraudDecision(state: GameState, playerId: PlayerId, card: CardInstance): PendingDecision {
  const officeholders = playerOffices(state, playerId).length;
  return {
    id: nextDecisionId(state, "revenue.companyFraud"),
    phase: "revenue",
    step: "revenue.companyFraud",
    actor: playerId,
    visibility: "private",
    prompt: "Play Company Fraud? Roll a die per officeholder; lower the Company Balance by twice the highest roll and take that much.",
    legalCommands: [
      {
        type: "revenue.companyFraud",
        label: `Play Company Fraud (${officeholders} ${officeholders === 1 ? "die" : "dice"})`,
        payload: { play: true, cardInstanceId: card.id },
      },
      { type: "revenue.companyFraud", label: "Keep the card", payload: { play: false } },
    ],
    canSave: true,
  };
}

const companyFraud: CommandHandler = (state, command) => {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.companyFraud") {
    return wrongPhase("Company Fraud can only be played at the start of Revenue.");
  }
  const payload = command.payload as { play?: boolean; cardInstanceId?: string };
  const playerId = state.pendingDecision.actor as PlayerId;
  const card = companyFraudCard(state, playerId);
  if (!card || (payload.play && payload.cardInstanceId !== card.id)) {
    return illegal("That Company Fraud card cannot be played.");
  }

  const collector = newCollector();
  const next = patchRevenue(state, { fraudCandidates: state.parliament.revenue!.fraudCandidates.slice(1) });
  if (payload.play) {
    // Played through the shared blackmail path so Man on the Inside may cancel it (p.12); the
    // effect is applied in the resume below.
    const played = startBlackmailPlay(
      { ...next, updatedAt: command.clientTimestamp },
      { playerId, cardInstanceId: card.id, params: {}, resumeKey: COMPANY_FRAUD_RESUME, timestamp: command.clientTimestamp },
    );
    return { ok: true, state: played, logEntry: played.log[played.log.length - 1] };
  }
  collector.notes.push(`${playerName(state, playerId)} kept their blackmail card.`);
  return complete(state, next, command, collector, "revenue.companyFraud");
};

// ---------------------------------------------------------------------------------------------
// Royal Protection (law #50): the Chairman may discard it to avoid emergency loans.

function royalProtectionDecision(state: GameState, chairman: PlayerId): PendingDecision {
  const expenses = calculateCompanyExpenses(state);
  const loans = calculateEmergencyLoans(state.company.balance, expenses.total);
  return {
    id: nextDecisionId(state, "revenue.royalProtection"),
    phase: "revenue",
    step: "revenue.royalProtection",
    actor: chairman,
    visibility: "public",
    prompt: `Expenses are £${expenses.total} against a Balance of £${state.company.balance}: the Company needs ${loans} emergency loan${loans === 1 ? "" : "s"}. Discard Royal Protection to avoid them?`,
    legalCommands: [
      {
        type: "revenue.royalProtection",
        label: "Discard Royal Protection: no loans, cancel the remaining expenses",
        description:
          "The Balance pays what it can of the expenses first. The rest of the expenses are cancelled, with no emergency loans. Expectations are still checked afterwards, so Standing can still fall if the Balance misses them.",
        payload: { discard: true },
      },
      { type: "revenue.royalProtection", label: "Keep Royal Protection and take the loans", payload: { discard: false } },
    ],
    canSave: true,
  };
}

const royalProtection: CommandHandler = (state, command) => {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.royalProtection") {
    return wrongPhase("Royal Protection can only be used when the Company would take emergency loans.");
  }
  const payload = command.payload as { discard?: unknown };
  if (typeof payload.discard !== "boolean") return illegal("Choose whether to discard Royal Protection.");

  const collector = newCollector();
  let next = state;
  if (payload.discard) next = discardPassedLaw(next, "royal-protection");
  next = patchRevenue(resolveExpenses(next, payload.discard, collector), { stage: "dividends" });
  return complete(state, next, command, collector, "revenue.expensesResolved");
};

// ---------------------------------------------------------------------------------------------
// Dividends (p.27).

export function chooseRevenueDividends(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.chooseDividends") {
    return wrongPhase("Revenue dividends can only be chosen during Revenue dividends.");
  }

  const payload = command.payload as { amountPerShare?: unknown };
  const rawAmountPerShare = payload.amountPerShare;
  if (typeof rawAmountPerShare !== "number" || !Number.isInteger(rawAmountPerShare) || rawAmountPerShare < 0) {
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
          details: { amountPerShare, shareCount, totalDividends, balance: state.company.balance },
        },
      ],
    };
  }

  const collector = newCollector();
  const dividendIncomeByPlayer = calculateDividendIncomeByPlayer(state, amountPerShare);
  const expectations = companyExpectations(state);
  // Public Enthusiasm: advance Standing if more cash was paid in dividends than Expectations.
  const standingGain = expectations !== null && totalDividends > expectations ? 1 : 0;
  const endingStanding = Math.min(MAX_STANDING_SPACE, state.company.standing + standingGain);
  collector.notes.push(totalDividends === 0 ? "Revenue paid no dividends." : `Revenue paid £${totalDividends} in dividends.`);
  Object.assign(collector.details, {
    amountPerShare,
    shareCount,
    totalDividends,
    dividendIncomeByPlayer,
    expectations,
    standingGain,
    endingStanding,
  });
  if (standingGain > 0) collector.notes.push("Public Enthusiasm raised Standing by 1.");

  const paid: GameState = {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        { ...player, cash: player.cash + (dividendIncomeByPlayer[playerId] ?? 0) },
      ]),
    ),
    company: {
      ...state.company,
      balance: state.company.balance - totalDividends,
      standing: endingStanding,
    },
  };
  const next = patchRevenue(paid, {
    stage: "scandal",
    scandalCandidates: primeMinisterOrder(paid).filter((playerId) => scandalCommands(paid, playerId).length > 0),
  });
  return complete(state, next, command, collector, "revenue.dividendsResolved");
}

// ---------------------------------------------------------------------------------------------
// The Scandal blackmails (#4, #5): "anytime after the Revenue phase" (and when taken, see LS).

const SCANDAL_CARD_IDS = ["scandal-on-leadenhall-street", "scandal-in-india"];

function scandalCommands(state: GameState, playerId: PlayerId): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const cardId of SCANDAL_CARD_IDS) {
    const card = unplayedBlackmail(state, playerId, cardId);
    if (!card) continue;
    for (const option of blackmailOptionsForCard(state, playerId, cardId)) {
      commands.push({
        type: "revenue.playScandal",
        label: `Play ${blackmailCardName(cardId)}: ${option.label}`,
        payload: { cardInstanceId: card.id, params: option.params },
      });
    }
  }
  return commands;
}

function scandalDecision(state: GameState, playerId: PlayerId, options: LegalCommand[]): PendingDecision {
  return {
    id: nextDecisionId(state, "revenue.playScandal"),
    phase: "revenue",
    step: "revenue.playScandal",
    actor: playerId,
    visibility: "private",
    prompt: "Revenue is over: you may play a Scandal blackmail card to force an officeholder out without retirement.",
    legalCommands: [...options, { type: "revenue.playScandal", label: "Don't play a Scandal now", payload: {} }],
    canSave: true,
  };
}

// A restored Scandal offer must drop a card that was already played (cancelled by Man on the Inside).
registerDecisionRefresher("revenue.playScandal", (state) => {
  const decision = state.pendingDecision;
  if (decision.actor === "system" || decision.actor === "simultaneous") return decision;
  return scandalDecision(state, decision.actor, scandalCommands(state, decision.actor));
});

const playScandal: CommandHandler = (state, command) => {
  if (state.phase !== "revenue" || state.pendingDecision.step !== "revenue.playScandal") {
    return wrongPhase("Scandal cards are offered at the end of Revenue.");
  }
  const playerId = state.pendingDecision.actor as PlayerId;
  const payload = command.payload as { cardInstanceId?: string; params?: Record<string, unknown> };
  const collector = newCollector();
  const progress = state.parliament.revenue!;

  if (!payload.cardInstanceId) {
    collector.notes.push(`${playerName(state, playerId)} played no Scandal.`);
    return complete(state, patchRevenue(state, { scandalCandidates: progress.scandalCandidates.slice(1) }), command, collector, "revenue.scandal");
  }

  // Played through the shared blackmail path so Man on the Inside may cancel it (p.12). The same
  // player stays first in line: they may still hold the other Scandal card.
  return {
    ok: true,
    ...(() => {
      const next = startBlackmailPlay(
        { ...state, updatedAt: command.clientTimestamp },
        {
          playerId,
          cardInstanceId: payload.cardInstanceId,
          params: payload.params ?? {},
          resumeKey: SCANDAL_RESUME,
          timestamp: command.clientTimestamp,
        },
      );
      return { state: next, logEntry: next.log[next.log.length - 1] };
    })(),
  };
};

/** Continue Revenue after an in-flow blackmail play resolves or is cancelled. */
function continueRevenue(state: GameState): GameState {
  const progressed = progressRevenue(state, newCollector());
  return { ...progressed.state, phase: progressed.decision.phase, pendingDecision: progressed.decision };
}

const COMPANY_FRAUD_RESUME = "revenue.companyFraud";
registerInFlowBlackmail("blackmail.company-fraud", "at the start of the Revenue phase");

// Company Fraud: roll a die per officeholder, lower the Company Balance by twice the highest roll,
// and take that much. Cancelled by Man on the Inside, it does nothing.
registerBlackmailResume(COMPANY_FRAUD_RESUME, (state, play, outcome) => {
  if (outcome !== "resolved") return continueRevenue(state);
  const playerId = play.playerId;
  const dice = rollDice(state.rng, Math.max(1, playerOffices(state, playerId).length), 6, "revenue.companyFraud");
  const amount = 2 * Math.max(...dice.values);
  let next = updatePlayer({ ...state, rng: dice.rng }, playerId, (player) => ({ ...player, cash: player.cash + amount }));
  next = { ...next, company: { ...next.company, balance: Math.max(0, next.company.balance - amount) } };
  next = appendLog(next, {
    actor: playerId,
    type: "revenue.companyFraud",
    summary: `${playerName(state, playerId)} played Company Fraud, rolled ${dice.values.join(", ")} and took £${amount}; the Company Balance is now £${next.company.balance}.`,
    rngRolls: [dice.roll],
    timestamp: state.updatedAt,
  });
  return continueRevenue(next);
});

const SCANDAL_RESUME = "revenue.scandal";
registerBlackmailResume(SCANDAL_RESUME, (state) => continueRevenue(state));

function illegal(message: string): ApplyCommandResult {
  return { ok: false, errors: [{ code: "ILLEGAL_REVENUE_COMMAND", message, field: "payload" }] };
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

function calculateDividendIncomeByPlayer(state: GameState, amountPerShare: number): Record<string, number> {
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
  "revenue.companyFraud": companyFraud,
  "revenue.royalProtection": royalProtection,
  "revenue.chooseDividends": chooseRevenueDividends,
  "revenue.playScandal": playScandal,
};
