// Firms at the start of Revenue (rulebook pp.41-42), before the Company pays its expenses: each firm
// pays expenses (or is rescued by emergency investments or an emergency merger, or dissolved), then
// its manager may pay dividends, and what remains in the India treasury moves to London.
// The order of firms is ruling 8 of docs/phases/deregulation.md. Notes: docs/phases/deregulation-vr.md.
import { firmCharter } from "../../data";
import {
  allFirms,
  dissolveFirm,
  firmById,
  firmExpenses,
  firmInvestmentSources,
  firmName,
  firmShareTotal,
  firmShips,
  firmStrategy,
  investBlockReason,
  investInFirm,
  mergeFirms,
  weakCompanySharesReason,
  withFirm,
  type FirmInvestmentSource,
} from "../firms";
import type { GameState, LegalCommand, PendingDecision, PlayerId } from "../types";
import type { FirmRevenueProgress } from "./parliament.state";
import { addCash, nextDecisionId, playerName, primeMinisterOrder, type Collector } from "./parliament/common";
import { playerWindowIcons } from "./parliament/holdings";

type Progress = FirmRevenueProgress;

export const FIRM_REVENUE_STEPS = {
  payFrom: "revenue.firmPayFrom",
  rescue: "revenue.firmRescue",
  investAsk: "revenue.firmInvestAsk",
  mergeConsent: "revenue.firmMergeConsent",
  dividends: "revenue.firmDividends",
  waiver: "revenue.firmWaiver",
} as const;

// ---------------------------------------------------------------------------------------------
// State helpers.

function progressOf(state: GameState): Progress | undefined {
  return state.parliament.revenue?.firms;
}

function withProgress(state: GameState, firms: Progress | undefined): GameState {
  const revenue = state.parliament.revenue;
  if (!revenue) return state;
  return { ...state, parliament: { ...state.parliament, revenue: { ...revenue, firms } } };
}

function patch(state: GameState, change: Partial<Progress>): GameState {
  return withProgress(state, { ...progressOf(state)!, ...change });
}

/** Per-firm fields start afresh when the next firm comes up. */
const FRESH: Pick<Progress, "step" | "emergencyCash" | "declined" | "ask" | "merge" | "mergeRefused" | "dividendsPaid" | "cashPaid" | "waivers"> = {
  step: "start",
  emergencyCash: 0,
  declined: [],
  ask: undefined,
  merge: undefined,
  mergeRefused: [],
  dividendsPaid: 0,
  cashPaid: 0,
  waivers: undefined,
};

function shiftQueue(state: GameState): GameState {
  const progress = progressOf(state)!;
  return withProgress(state, { ...progress, ...FRESH, queue: progress.queue.slice(1) });
}

/** Firms in the order they settle: initiative first (lowest first), then the rest; ruling 8. */
export function firmSettlementOrder(state: GameState): string[] {
  const seats = primeMinisterOrder(state);
  const key = (firm: { manager: PlayerId; trade?: { initiative?: number } }) => ({
    initiative: firm.trade?.initiative,
    windows: playerWindowIcons(state, firm.manager),
    seat: seats.indexOf(firm.manager),
  });
  return [...allFirms(state)]
    .sort((left, right) => {
      const a = key(left);
      const b = key(right);
      const aTrades = a.initiative !== undefined;
      const bTrades = b.initiative !== undefined;
      if (aTrades !== bTrades) return aTrades ? -1 : 1;
      if (aTrades && bTrades && a.initiative !== b.initiative) return a.initiative! - b.initiative!;
      if (a.windows !== b.windows) return b.windows - a.windows;
      return a.seat - b.seat;
    })
    .map((firm) => firm.id);
}

/** True when there are firms to settle at the start of Revenue. */
export function hasFirmsToSettle(state: GameState): boolean {
  return allFirms(state).length > 0;
}

export function startFirmRevenue(state: GameState): GameState {
  return withProgress(state, { ...FRESH, queue: firmSettlementOrder(state), paid: [] });
}

/** £1 per ship on the charter plus the larger of the share count and the Value (p.41). */
export { firmExpenses };

/**
 * Splitting expenses between the treasuries. Emergency cash (investments made to survive) is spent
 * first and the rest of it is lost (p.41). `fromIndia` ranges over xmin..xmax.
 */
function paymentRange(state: GameState, firmId: string, emergencyCash: number, expenses = firmExpenses(state, firmId)) {
  const firm = firmById(state, firmId)!;
  const ownLondon = firm.londonTreasury - emergencyCash;
  const remaining = expenses - Math.min(emergencyCash, expenses);
  return { ownLondon, remaining, min: Math.max(0, remaining - ownLondon), max: Math.min(firm.indiaTreasury, remaining) };
}

function payExpenses(state: GameState, firmId: string, emergencyCash: number, fromIndia: number, expenses = firmExpenses(state, firmId)): GameState {
  const firm = firmById(state, firmId)!;
  const { ownLondon, remaining } = paymentRange(state, firmId, emergencyCash, expenses);
  const next = withFirm(state, {
    ...firm,
    londonTreasury: ownLondon - (remaining - fromIndia),
    indiaTreasury: firm.indiaTreasury - fromIndia,
  });
  const progress = progressOf(next);
  return progress && !progress.paid.includes(firmId) ? patch(next, { paid: [...progress.paid, firmId] }) : next;
}

function describeFirm(state: GameState, firmId: string): string {
  const firm = firmById(state, firmId);
  return firm ? `${firmName(state, firm)} (${playerName(state, firm.manager)})` : firmId;
}

function money(amount: number): string {
  return `£${amount}`;
}

// ---------------------------------------------------------------------------------------------
// Advancing: automatic work, then the next decision (or nothing, when every firm is settled).

export function advanceFirmRevenue(state: GameState, collector: Collector): { state: GameState; decision?: PendingDecision } {
  let current = state;
  for (let guard = 0; guard < 200; guard += 1) {
    const progress = progressOf(current);
    if (!progress) return { state: current };
    const firmId = progress.queue[0];
    if (!firmId) return { state: withProgress(current, undefined) };
    const firm = firmById(current, firmId);
    if (!firm) {
      current = shiftQueue(current);
      continue;
    }

    switch (progress.step) {
      case "start": {
        if (progress.paid.includes(firmId)) {
          current = patch(current, { step: "dividends" });
          continue;
        }
        const expenses = firmExpenses(current, firmId);
        const range = paymentRange(current, firmId, progress.emergencyCash, expenses);
        if (range.min > range.max) {
          current = patch(current, { step: "rescue" });
          continue;
        }
        if (range.min === range.max) {
          current = payExpenses(current, firmId, progress.emergencyCash, range.min, expenses);
          collector.notes.push(`${describeFirm(current, firmId)} paid ${money(expenses)} in expenses.`);
          current = finishExpenses(current, firmId, collector, expenses);
          continue;
        }
        current = patch(current, { step: "payFrom" });
        continue;
      }
      case "payFrom":
        return { state: current, decision: payFromDecision(current, firmId, progress) };
      case "rescue":
        return { state: current, decision: rescueDecision(current, firmId, progress) };
      case "investAsk":
        return { state: current, decision: investAskDecision(current, firmId, progress) };
      case "mergeConsent": {
        if (!progress.merge || progress.merge.askers.length === 0) {
          current = patch(current, { step: "rescue", merge: undefined });
          continue;
        }
        return { state: current, decision: mergeConsentDecision(current, firmId, progress) };
      }
      case "dividends": {
        if (firmStrategy(current, firmId)?.id === "hobnob") {
          collector.notes.push(`${describeFirm(current, firmId)} hobnobbed: no dividends, and its dividend cube stays where it was.`);
          current = finishFirm(current, firmId, collector);
          continue;
        }
        if (firm.indiaTreasury < 1) {
          current = finishFirm(current, firmId, collector);
          continue;
        }
        return { state: current, decision: dividendDecision(current, firmId, progress) };
      }
      case "waiver": {
        const holders = progress.waivers?.holders ?? [];
        if (holders.length === 0) {
          current = settleWaivedDividend(current, firmId, collector);
          continue;
        }
        return { state: current, decision: waiverDecision(current, firmId, progress) };
      }
    }
  }
  throw new Error("Firm expenses did not reach a decision.");
}

function finishExpenses(state: GameState, firmId: string, collector: Collector, expenses: number): GameState {
  const emergency = progressOf(state)!.emergencyCash;
  if (emergency > expenses) {
    collector.notes.push(`${money(emergency - expenses)} of the emergency investments was left over and is lost.`);
  }
  return patch(state, { step: "dividends", emergencyCash: 0 });
}

/** After dividends: record the cube (unless Hobnob) and move India's remainder to London (p.42). */
function finishFirm(state: GameState, firmId: string, collector: Collector): GameState {
  const progress = progressOf(state)!;
  const firm = firmById(state, firmId)!;
  const hobnob = firmStrategy(state, firmId)?.id === "hobnob";
  const moved = firm.indiaTreasury;
  const next = withFirm(state, {
    ...firm,
    londonTreasury: firm.londonTreasury + moved,
    indiaTreasury: 0,
    dividendCube: hobnob ? firm.dividendCube : progress.cashPaid,
  });
  collector.notes.push(
    `${describeFirm(next, firmId)} ${hobnob ? "kept its dividend cube" : `put its dividend cube on ${progress.cashPaid}`}${moved > 0 ? ` and moved ${money(moved)} from India to London` : ""}.`,
  );
  return shiftQueue(next);
}

// ---------------------------------------------------------------------------------------------
// Decisions.

function payFromDecision(state: GameState, firmId: string, progress: Progress): PendingDecision {
  const firm = firmById(state, firmId)!;
  const expenses = firmExpenses(state, firmId);
  const range = paymentRange(state, firmId, progress.emergencyCash, expenses);
  const legalCommands: LegalCommand[] = [];
  for (let fromIndia = range.min; fromIndia <= range.max; fromIndia += 1) {
    const fromLondon = range.remaining - fromIndia;
    legalCommands.push({
      type: "revenue.firmPayFrom",
      label: `Pay ${money(fromIndia)} from India and ${money(fromLondon)} from London`,
      payload: { fromIndia },
    });
  }
  return {
    id: nextDecisionId(state, FIRM_REVENUE_STEPS.payFrom),
    phase: "revenue",
    step: FIRM_REVENUE_STEPS.payFrom,
    actor: firm.manager,
    visibility: "public",
    prompt: `${describeFirm(state, firmId)} owes ${money(expenses)} in expenses (${firmShips(state, firmId).length} ships plus ${Math.max(firmShareTotal(firm), firm.value)} for shares or Value). Which treasuries pay?`,
    legalCommands,
    canSave: true,
  };
}

type RescueOption = { investor: PlayerId; source: FirmInvestmentSource };

/** One Company share and one workshop per player is enough: pieces of a kind are interchangeable. */
function investmentOptions(state: GameState, firmId: string, progress: Progress): RescueOption[] {
  const options: RescueOption[] = [];
  for (const investor of primeMinisterOrder(state)) {
    for (const kind of ["companyShare", "workshop"] as const) {
      if (progress.declined.includes(`${investor}:${kind}`)) continue;
      const source = firmInvestmentSources(state, investor).find((candidate) => candidate.kind === kind);
      if (source && !investBlockReason(state, firmId, investor, source)) options.push({ investor, source });
    }
  }
  return options;
}

type MergeOption = { other: string; primary: string };

function mergeOptions(state: GameState, firmId: string, progress: Progress): MergeOption[] {
  const firm = firmById(state, firmId)!;
  const own = firm.londonTreasury + firm.indiaTreasury;
  const options: MergeOption[] = [];
  for (const other of allFirms(state)) {
    if (other.id === firmId || progress.mergeRefused.includes(other.id)) continue;
    if (firmShareTotal(firm) + firmShareTotal(other) > firmCharter.maxShares) continue;
    const otherOwes = progress.paid.includes(other.id) ? 0 : firmExpenses(state, other.id);
    const otherCash = other.londonTreasury + other.indiaTreasury;
    // The other firm pays its own expenses first, then the merged firm pays what this firm owes.
    if (otherCash < otherOwes || own + otherCash < otherOwes + firmExpenses(state, firmId)) continue;
    // The highest Value is the primary firm; a tie is the players' pick (p.39).
    if (firm.value >= other.value) options.push({ other: other.id, primary: firmId });
    if (other.value >= firm.value) options.push({ other: other.id, primary: other.id });
  }
  return options;
}

function rescueDecision(state: GameState, firmId: string, progress: Progress): PendingDecision {
  const firm = firmById(state, firmId)!;
  const expenses = firmExpenses(state, firmId);
  const cash = firm.londonTreasury + firm.indiaTreasury;
  const legalCommands: LegalCommand[] = [];
  const investments = investmentOptions(state, firmId, progress);
  const merges = mergeOptions(state, firmId, progress);

  for (const option of investments) {
    const what = option.source.kind === "companyShare" ? "a Company share" : "a workshop";
    const shares = firmShareTotal(firm) < firmCharter.maxShares;
    legalCommands.push({
      type: "revenue.firmInvest",
      label: `${option.investor === firm.manager ? "Invest" : "Ask"} ${playerName(state, option.investor)}${option.investor === firm.manager ? "" : " to invest"} ${what} (+${money(firmCharter.investmentCash)}, Value -1${shares ? ", a new share" : ""})`,
      payload: { investor: option.investor, source: option.source },
    });
  }
  for (const option of merges) {
    const into = option.primary === firmId ? "the other firm merges into this one" : "this firm merges into the other";
    legalCommands.push({
      type: "revenue.firmMerge",
      label: `Merge with ${describeFirm(state, option.other)}: ${into} (every shareholder must consent)`,
      payload: option,
    });
  }
  legalCommands.push({
    type: "revenue.firmDissolve",
    label: `Dissolve ${describeFirm(state, firmId)}: every share goes to Debtor's Prison`,
    payload: {},
  });

  return {
    id: nextDecisionId(state, FIRM_REVENUE_STEPS.rescue),
    phase: "revenue",
    step: FIRM_REVENUE_STEPS.rescue,
    actor: firm.manager,
    visibility: "public",
    prompt:
      `${describeFirm(state, firmId)} owes ${money(expenses)} but holds ${money(cash)}${progress.emergencyCash > 0 ? ` (including ${money(progress.emergencyCash)} of emergency investments)` : ""}. ` +
      rescueChoices(state, investments.length > 0, merges.length > 0),
    legalCommands,
    canSave: true,
  };
}

/** What the manager can still do, and why an emergency investment or merger isn't on offer. */
function rescueChoices(state: GameState, canInvest: boolean, canMerge: boolean): string {
  const choices = [canInvest ? "take an emergency investment" : undefined, canMerge ? "merge with another firm" : undefined, "dissolve it"].filter(Boolean);
  const text = `${choices.length > 1 ? `${choices.slice(0, -1).join(", ")} or ${choices[choices.length - 1]}` : choices[0]}`;
  const notes: string[] = [];
  if (!canInvest) {
    const weak = weakCompanySharesReason(state);
    notes.push(
      weak
        ? `No emergency investment is possible: ${weak.replace(/\.$/, "")} and no one has an uninvested workshop.`
        : "No emergency investment is possible: no one has a Company share or an uninvested workshop to invest, or everyone asked declined.",
    );
  }
  if (!canMerge) notes.push("No merger is possible: no other firm could cover both firms' expenses (or every merger was refused).");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} (p.41).${notes.length ? ` ${notes.join(" ")}` : ""}`;
}

function investAskDecision(state: GameState, firmId: string, progress: Progress): PendingDecision {
  const ask = progress.ask!;
  const what = ask.source.kind === "companyShare" ? "a Company share from the Court" : "a workshop";
  return {
    id: nextDecisionId(state, FIRM_REVENUE_STEPS.investAsk),
    phase: "revenue",
    step: FIRM_REVENUE_STEPS.investAsk,
    actor: ask.investor,
    visibility: "public",
    prompt: `${playerName(state, firmById(state, firmId)!.manager)} asks you to make an emergency investment in ${describeFirm(state, firmId)} with ${what}. The firm gets ${money(firmCharter.investmentCash)} and its Value falls by 1.`,
    legalCommands: [
      { type: "revenue.firmInvestAnswer", label: `Invest ${what}`, payload: { accept: true } },
      { type: "revenue.firmInvestAnswer", label: "Decline", payload: { accept: false } },
    ],
    canSave: true,
  };
}

function mergeConsentDecision(state: GameState, firmId: string, progress: Progress): PendingDecision {
  const merge = progress.merge!;
  return {
    id: nextDecisionId(state, FIRM_REVENUE_STEPS.mergeConsent),
    phase: "revenue",
    step: FIRM_REVENUE_STEPS.mergeConsent,
    actor: merge.askers[0],
    visibility: "public",
    prompt: `Emergency merger: ${describeFirm(state, firmId)} would merge with ${describeFirm(state, merge.other)}; the primary firm is ${describeFirm(state, merge.primary)}. Do you consent as a shareholder or manager?`,
    legalCommands: [
      { type: "revenue.firmMergeAnswer", label: "Consent to the merger", payload: { accept: true } },
      { type: "revenue.firmMergeAnswer", label: "Refuse", payload: { accept: false } },
    ],
    canSave: true,
  };
}

function holdersOf(state: GameState, firmId: string): Array<[PlayerId, number]> {
  const firm = firmById(state, firmId)!;
  return primeMinisterOrder(state)
    .map((playerId): [PlayerId, number] => [playerId, firm.shares[playerId] ?? 0])
    .filter(([, count]) => count > 0);
}

function dividendDecision(state: GameState, firmId: string, progress: Progress): PendingDecision {
  const firm = firmById(state, firmId)!;
  const full = firmShareTotal(firm) + firmCharter.managerDividendShares;
  const legalCommands: LegalCommand[] = [];
  if (firm.indiaTreasury >= full) {
    legalCommands.push({
      type: "revenue.firmDividend",
      label: `Pay a dividend of ${money(full)} (${money(firmShareTotal(firm))} for shares, ${money(firmCharter.managerDividendShares)} for the manager)`,
      payload: { action: "pay" },
    });
  }
  if (firmShareTotal(firm) > 0) {
    legalCommands.push({
      type: "revenue.firmDividend",
      label: "Pay a dividend, asking shareholders whether they forgo some of their shares (optional dividends)",
      payload: { action: "waive" },
    });
  }
  legalCommands.push({
    type: "revenue.firmDividend",
    label: progress.dividendsPaid > 0 ? `Stop paying dividends (${progress.dividendsPaid} paid, ${money(progress.cashPaid)})` : "Pay no dividends",
    payload: { action: "stop" },
  });
  return {
    id: nextDecisionId(state, FIRM_REVENUE_STEPS.dividends),
    phase: "revenue",
    step: FIRM_REVENUE_STEPS.dividends,
    actor: firm.manager,
    visibility: "public",
    prompt: `${describeFirm(state, firmId)} holds ${money(firm.indiaTreasury)} in India. A full dividend costs ${money(full)}. ${progress.dividendsPaid} paid so far (${money(progress.cashPaid)}).`,
    legalCommands,
    canSave: true,
  };
}

function waiverDecision(state: GameState, firmId: string, progress: Progress): PendingDecision {
  const firm = firmById(state, firmId)!;
  const waivers = progress.waivers!;
  const holder = waivers.holders[0];
  const shares = firm.shares[holder] ?? 0;
  const unwaivedSoFar = Object.entries(waivers.forgone).reduce((total, [playerId, forgone]) => total + (firm.shares[playerId] ?? 0) - forgone, 0);
  // Stay within the India treasury even if everyone after this holder forgoes all their shares.
  const afterThisHolder = (forgone: number) => unwaivedSoFar + (shares - forgone) + firmCharter.managerDividendShares;
  const legalCommands: LegalCommand[] = [];
  for (let forgone = 0; forgone <= shares; forgone += 1) {
    if (afterThisHolder(forgone) > firm.indiaTreasury) continue;
    legalCommands.push({
      type: "revenue.firmWaive",
      label: forgone === 0 ? "Take payment on all my shares" : `Forgo payment on ${forgone} of my ${shares} share${shares === 1 ? "" : "s"} for this dividend`,
      payload: { forgone },
    });
  }
  return {
    id: nextDecisionId(state, FIRM_REVENUE_STEPS.waiver),
    phase: "revenue",
    step: FIRM_REVENUE_STEPS.waiver,
    actor: holder,
    visibility: "public",
    prompt: `${describeFirm(state, firmId)} proposes a dividend with some shares unpaid (the manager has consented). ${playerName(state, holder)}, you hold ${shares} share${shares === 1 ? "" : "s"}: forgo none, some or all of them for this dividend?`,
    legalCommands,
    canSave: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Dividends.

function payDividend(state: GameState, firmId: string, forgone: Record<PlayerId, number>, collector: Collector): GameState {
  const firm = firmById(state, firmId)!;
  const progress = progressOf(state)!;
  let next = state;
  let total = 0;
  const lines: string[] = [];
  const income: Record<PlayerId, number> = {};
  for (const [playerId, count] of Object.entries(firm.shares)) {
    const paid = count - (forgone[playerId] ?? 0);
    if (paid > 0) income[playerId] = (income[playerId] ?? 0) + paid;
  }
  income[firm.manager] = (income[firm.manager] ?? 0) + firmCharter.managerDividendShares;
  for (const [playerId, amount] of Object.entries(income)) {
    next = addCash(next, playerId, amount);
    total += amount;
    lines.push(`${playerName(state, playerId)} ${money(amount)}`);
  }
  next = withFirm(next, { ...firm, indiaTreasury: firm.indiaTreasury - total });
  next = patch(next, { dividendsPaid: progress.dividendsPaid + 1, cashPaid: progress.cashPaid + total, waivers: undefined, step: "dividends" });
  collector.notes.push(`${describeFirm(state, firmId)} paid a dividend of ${money(total)}: ${lines.join(", ")}.`);
  return next;
}

function settleWaivedDividend(state: GameState, firmId: string, collector: Collector): GameState {
  const progress = progressOf(state)!;
  const firm = firmById(state, firmId)!;
  const forgone = progress.waivers?.forgone ?? {};
  const cost =
    Object.entries(firm.shares).reduce((total, [playerId, count]) => total + count - (forgone[playerId] ?? 0), 0) + firmCharter.managerDividendShares;
  if (cost > firm.indiaTreasury) {
    collector.notes.push(`${describeFirm(state, firmId)} could not afford that dividend (${money(cost)}), so none was paid.`);
    return patch(state, { waivers: undefined, step: "dividends" });
  }
  return payDividend(state, firmId, forgone, collector);
}

// ---------------------------------------------------------------------------------------------
// Command applications. The dispatcher has already matched each command to a legal option.

type Apply = (state: GameState, payload: any, collector: Collector) => GameState;

function headFirm(state: GameState) {
  const progress = progressOf(state)!;
  return { progress, firmId: progress.queue[0] };
}

export const FIRM_REVENUE_COMMAND_STEPS: Record<string, string> = {
  "revenue.firmPayFrom": FIRM_REVENUE_STEPS.payFrom,
  "revenue.firmInvest": FIRM_REVENUE_STEPS.rescue,
  "revenue.firmMerge": FIRM_REVENUE_STEPS.rescue,
  "revenue.firmDissolve": FIRM_REVENUE_STEPS.rescue,
  "revenue.firmInvestAnswer": FIRM_REVENUE_STEPS.investAsk,
  "revenue.firmMergeAnswer": FIRM_REVENUE_STEPS.mergeConsent,
  "revenue.firmDividend": FIRM_REVENUE_STEPS.dividends,
  "revenue.firmWaive": FIRM_REVENUE_STEPS.waiver,
};

function emergencyInvest(state: GameState, firmId: string, investor: PlayerId, source: FirmInvestmentSource, collector: Collector): GameState {
  const progress = progressOf(state)!;
  const invested = investInFirm(state, firmId, investor, source, { emergency: true });
  collector.notes.push(
    `${playerName(state, investor)} made an emergency investment in ${describeFirm(state, firmId)} with ${source.kind === "companyShare" ? "a Company share" : "a workshop"}: ${money(firmCharter.investmentCash)} for the London treasury, Value lowered by 1${invested.createdShare ? ", and a new share" : ""}.`,
  );
  // Back to the start: expenses are recomputed (the new share and lower Value change them).
  return patch(invested.state, { step: "start", emergencyCash: progress.emergencyCash + firmCharter.investmentCash, ask: undefined });
}

function performMerge(state: GameState, firmId: string, merge: { other: string; primary: string }, collector: Collector): GameState {
  let next = state;
  const progress = progressOf(state)!;
  const secondary = merge.primary === firmId ? merge.other : firmId;
  const ownExpenses = firmExpenses(next, firmId);
  const names = `${describeFirm(next, firmId)} and ${describeFirm(next, merge.other)}`;

  // The other firm first pays its own expenses, if it hasn't (p.41); London first, so India cash stays for dividends.
  if (!progress.paid.includes(merge.other)) {
    const range = paymentRange(next, merge.other, 0);
    next = payExpenses(next, merge.other, 0, range.min);
    collector.notes.push(`${describeFirm(next, merge.other)} paid its own expenses first.`);
  }
  next = mergeFirms(next, merge.primary, [secondary]);
  // Then the merged firm pays what the endangered firm owed. Emergency cash goes first, the rest is lost.
  const range = paymentRange(next, merge.primary, progress.emergencyCash, ownExpenses);
  next = payExpenses(next, merge.primary, progress.emergencyCash, range.min, ownExpenses);
  collector.notes.push(`${names} merged into ${describeFirm(next, merge.primary)}, which paid ${money(ownExpenses)} in expenses for the endangered firm.`);

  const after = progressOf(next)!;
  const queue = after.queue.filter((id) => id !== secondary);
  return withProgress(next, { ...after, ...FRESH, queue, paid: [...new Set([...after.paid, merge.primary])], step: merge.primary === firmId ? "dividends" : "start" });
}

export const firmRevenueActions: Record<string, Apply> = {
  "revenue.firmPayFrom": (state, { fromIndia }: { fromIndia: number }, collector) => {
    const { progress, firmId } = headFirm(state);
    const expenses = firmExpenses(state, firmId);
    const paid = payExpenses(state, firmId, progress.emergencyCash, fromIndia, expenses);
    collector.notes.push(`${describeFirm(state, firmId)} paid ${money(expenses)} in expenses (${money(fromIndia)} from India).`);
    return finishExpenses(paid, firmId, collector, expenses);
  },
  "revenue.firmInvest": (state, { investor, source }: RescueOption, collector) => {
    const { progress, firmId } = headFirm(state);
    const firm = firmById(state, firmId)!;
    if (investor === firm.manager) return emergencyInvest(state, firmId, investor, source, collector);
    collector.notes.push(`${playerName(state, firm.manager)} asked ${playerName(state, investor)} for an emergency investment in ${describeFirm(state, firmId)}.`);
    return patch(state, { step: "investAsk", ask: { investor, source } as Progress["ask"] });
  },
  "revenue.firmInvestAnswer": (state, { accept }: { accept: boolean }, collector) => {
    const { progress, firmId } = headFirm(state);
    const ask = progress.ask!;
    if (accept && !investBlockReason(state, firmId, ask.investor, ask.source)) {
      return emergencyInvest(state, firmId, ask.investor, ask.source, collector);
    }
    collector.notes.push(`${playerName(state, ask.investor)} declined to invest in ${describeFirm(state, firmId)}.`);
    return patch(state, { step: "rescue", ask: undefined, declined: [...progress.declined, `${ask.investor}:${ask.source.kind}`] });
  },
  "revenue.firmMerge": (state, merge: { other: string; primary: string }, collector) => {
    const { firmId } = headFirm(state);
    const first = firmById(state, firmId)!;
    const second = firmById(state, merge.other)!;
    const involved = new Set<PlayerId>([...Object.keys(first.shares), ...Object.keys(second.shares), second.manager]);
    involved.delete(first.manager);
    const askers = primeMinisterOrder(state).filter((playerId) => involved.has(playerId));
    collector.notes.push(`${playerName(state, first.manager)} proposed an emergency merger of ${describeFirm(state, firmId)} with ${describeFirm(state, merge.other)}.`);
    if (askers.length === 0) return performMerge(state, firmId, merge, collector);
    return patch(state, { step: "mergeConsent", merge: { ...merge, askers } });
  },
  "revenue.firmMergeAnswer": (state, { accept }: { accept: boolean }, collector) => {
    const { progress, firmId } = headFirm(state);
    const merge = progress.merge!;
    if (!accept) {
      collector.notes.push(`${playerName(state, merge.askers[0])} refused the merger.`);
      return patch(state, { step: "rescue", merge: undefined, mergeRefused: [...progress.mergeRefused, merge.other] });
    }
    const askers = merge.askers.slice(1);
    if (askers.length === 0) return performMerge(state, firmId, merge, collector);
    return patch(state, { merge: { ...merge, askers } });
  },
  "revenue.firmDissolve": (state, _payload, collector) => {
    const { progress, firmId } = headFirm(state);
    const label = describeFirm(state, firmId);
    const dissolved = dissolveFirm(state, firmId);
    collector.notes.push(`${label} could not pay its expenses and was dissolved: its shares went to Debtor's Prison.`);
    return withProgress(dissolved, { ...FRESH, queue: progress.queue.slice(1), paid: progress.paid });
  },
  "revenue.firmDividend": (state, { action }: { action: "pay" | "waive" | "stop" }, collector) => {
    const { firmId } = headFirm(state);
    if (action === "pay") return payDividend(state, firmId, {}, collector);
    if (action === "stop") return finishFirm(state, firmId, collector);
    return patch(state, { step: "waiver", waivers: { holders: holdersOf(state, firmId).map(([playerId]) => playerId), forgone: {} } });
  },
  "revenue.firmWaive": (state, { forgone }: { forgone: number }, collector) => {
    const { progress } = headFirm(state);
    const waivers = progress.waivers!;
    const [holder, ...rest] = waivers.holders;
    if (forgone > 0) collector.notes.push(`${playerName(state, holder)} forwent payment on ${forgone} share${forgone === 1 ? "" : "s"}.`);
    return patch(state, { waivers: { holders: rest, forgone: { ...waivers.forgone, [holder]: forgone } } });
  },
};
