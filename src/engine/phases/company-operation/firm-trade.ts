import { rollCheck } from "../../checks";
import { allFirms, firmById, firmName, firmShips, firmStrategy, isDeregulated } from "../../firms";
import { chairmanTitleHolder, presidentOf } from "../../selectors";
import type { FirmId, FirmState, GameState, LegalCommand, OrderState, PendingDecision, PlayerId, PresidencyId } from "../../types";
import type { FirmFillState, PendingCheck, TradeActivity } from "../company-operation.state";
import { coState, decisionId, presidentOfficeId, unplayedBlackmailHolder, withCo } from "./context";
import { withActivity } from "./presidency-progress";
import { finishOffice, type OperationStep, type StepResult } from "./step";
import { homePort, orderNodes } from "./trade";

// Trading with firms (rulebook pp.40-41). At the start of a Presidency's operations every firm whose
// strategy belongs to it reveals the strategy and rolls one die per £ of its Trade Bid (the bid is
// already with the bank). With a success it gets an initiative (ships minus successes). Orders are
// filled after the President's successful Trade roll, or, if the President is vacant or doesn't trade,
// after the Commander and Governors have acted. Everyone filling does so in initiative order, lowest
// first. A firm fills up to ships + 1 orders: the home port of its strategy first, each next one
// connected through orders it has filled. An order already filled this turn pays half its listed value
// (rounded down: OrderState.deregulationValue). Income goes to the firm's India treasury, then the
// Value advances one space per £6 of it.

export const FIRM_TRADE_TYPE = "companyOperation.firmTrade";
export const FIRM_FILL_TYPE = "companyOperation.firmFill";

export type FirmTradePayload = { action: "reveal"; firmId: FirmId };
export type FirmFillPayload =
  | { action: "fill"; orderId: string }
  | { action: "stop" }
  | { action: "next"; who: FirmId | "company" };

const PRESIDENCY_OF_PORT = { bombay: "Bombay", madras: "Madras", bengal: "Bengal" } as const;

/** The Presidency a firm's strategy belongs to this turn; none for Hobnob or no strategy. */
export function firmPresidency(state: GameState, firmId: FirmId): PresidencyId | undefined {
  const card = firmStrategy(state, firmId);
  return card?.homePort ? PRESIDENCY_OF_PORT[card.homePort] : undefined;
}

function firmsAt(state: GameState, presidency: PresidencyId): FirmState[] {
  return allFirms(state).filter((firm) => firmPresidency(state, firm.id) === presidency);
}

/** Firms of this Presidency that still have to reveal (p.40: at the start of its operations). */
export function unrevealedFirms(state: GameState, presidency: PresidencyId): FirmState[] {
  if (!isDeregulated(state)) return [];
  return firmsAt(state, presidency).filter((firm) => !state.hidden.firmStrategySecrets[firm.id]?.revealed);
}

/** Firms with an initiative that haven't filled their orders yet. */
export function pendingFillers(state: GameState, presidency: PresidencyId): FirmState[] {
  if (!isDeregulated(state)) return [];
  const filled = coState(state).firmsFilled ?? [];
  return firmsAt(state, presidency).filter(
    (firm) =>
      state.hidden.firmStrategySecrets[firm.id]?.revealed &&
      firm.trade?.initiative !== undefined &&
      !filled.includes(firm.id),
  );
}

/** True while firms still have something to do at this Presidency (so it can't be skipped). */
export function firmsNeedAttention(state: GameState, presidency: PresidencyId): boolean {
  return unrevealedFirms(state, presidency).length > 0 || pendingFillers(state, presidency).length > 0;
}

function successesIn(values: number[]): number {
  return values.filter((value) => value <= 2).length;
}

// ---- reveal and roll ------------------------------------------------------------------------------

export function firmRevealDecision(state: GameState, presidency: PresidencyId): PendingDecision {
  const firm = unrevealedFirms(state, presidency)[0];
  const card = firmStrategy(state, firm.id)!;
  const dice = firm.tradeBid ?? 0;
  return {
    id: decisionId(state, `company-operation-firm-reveal-${firm.id}`),
    phase: "companyOperation",
    step: "companyOperation.firmReveal",
    actor: "system",
    visibility: "public",
    prompt: `${firmName(state, firm)} reveals its strategy (${card.name}) and rolls ${dice} ${dice === 1 ? "die" : "dice"} for its £${dice} Trade Bid (p.40).`,
    legalCommands: [
      {
        type: FIRM_TRADE_TYPE,
        label: `Reveal ${firmName(state, firm)}'s strategy and roll ${dice} ${dice === 1 ? "die" : "dice"}`,
        payload: { action: "reveal", firmId: firm.id } satisfies FirmTradePayload,
      },
    ],
    canSave: true,
  };
}

export const firmTradeStep: OperationStep = (state, command) => {
  const { firmId } = command.payload as FirmTradePayload;
  const firm = firmById(state, firmId)!;
  const presidency = firmPresidency(state, firmId)!;
  const secret = state.hidden.firmStrategySecrets[firmId];
  const revealed: GameState = {
    ...state,
    hidden: { ...state.hidden, firmStrategySecrets: { ...state.hidden.firmStrategySecrets, [firmId]: { ...secret, revealed: true } } },
  };
  const dice = firm.tradeBid ?? 0;
  const check = rollCheck(revealed.rng, dice, `companyOperation.firmTrade.${firmId}`);
  const rolled: GameState = { ...revealed, rng: check.rng };
  const pending: PendingCheck = { context: "firmTrade", presidency, firmId, dice, values: check.values, outcome: check.outcome };
  const name = firmName(state, firm);
  const summary = `${name} revealed ${firmStrategy(state, firmId)!.name} and rolled ${dice} ${dice === 1 ? "die" : "dice"} [${check.values.join(", ")}].`;
  const rngRolls = check.roll ? [check.roll] : undefined;

  // Mercantile Connection: "force a President or firm to reroll any Trade roll".
  const holder = unplayedBlackmailHolder(rolled, "mercantile-connection");
  if (holder) {
    return {
      state: withCo(rolled, { interrupt: { kind: "connection", cardId: "mercantile-connection", holder, check: pending } }),
      summary,
      rngRolls,
    };
  }
  const resolved = resolveFirmRoll(rolled, pending as Extract<PendingCheck, { context: "firmTrade" }>);
  return { state: resolved.state, summary: `${summary} ${resolved.note}`, rngRolls };
};

/** Record a firm's roll (after any Connection reroll). */
export function resolveFirmRoll(
  state: GameState,
  check: Extract<PendingCheck, { context: "firmTrade" }>,
): { state: GameState; note: string } {
  const firm = firmById(state, check.firmId)!;
  const secret = state.hidden.firmStrategySecrets[check.firmId];
  const successes = successesIn(check.values);
  const ships = firmShips(state, firm.id).length;
  const initiative = successes > 0 ? ships - successes : undefined;
  const next: GameState = {
    ...state,
    firms: allFirms(state).map((candidate) =>
      candidate.id === firm.id
        ? { ...candidate, trade: { strategy: secret.strategy!, dice: check.dice, successes, ...(initiative === undefined ? {} : { initiative }), income: 0 } }
        : candidate,
    ),
  };
  return {
    state: next,
    note:
      initiative === undefined
        ? `${firmName(state, firm)} failed its roll and will not trade.`
        : `${firmName(state, firm)} has ${successes} ${successes === 1 ? "success" : "successes"} with ${ships} ${ships === 1 ? "ship" : "ships"}: initiative ${initiative}.`,
  };
}

// ---- filling orders -------------------------------------------------------------------------------

type Participant = { id: FirmId | "company"; initiative: number };

function participants(state: GameState, ff: FirmFillState): Participant[] {
  const list: Participant[] = pendingFillers(state, ff.presidency).map((firm) => ({ id: firm.id, initiative: firm.trade!.initiative! }));
  if (ff.company && !ff.company.started) list.push({ id: "company", initiative: ff.company.initiative });
  return list.sort((a, b) => a.initiative - b.initiative);
}

function lowestGroup(state: GameState, ff: FirmFillState): Participant[] {
  const all = participants(state, ff);
  return all.filter((participant) => participant.initiative === all[0]?.initiative);
}

/** Ties: the operating President if the Company fills this round, else the Chairman marker holder (p.40). */
function tieChooser(state: GameState, ff: FirmFillState, group: Participant[]): PlayerId {
  const chosen = ff.company ? presidentOf(state, ff.presidency) : chairmanTitleHolder(state);
  if (chosen) return chosen;
  const firstFirm = group.find((participant) => participant.id !== "company");
  return (firstFirm && firmById(state, firstFirm.id)?.manager) || state.seatingOrder[0];
}

function isFillableBy(order: OrderState, firmId: FirmId): boolean {
  return !order.closed && !order.filledThisTurnBy.includes(firmId);
}

/**
 * Orders this firm may fill next: the strategy's home port first (nothing at all if it is closed;
 * see the notes), then orders connected to ones it has filled, up to ships + 1 orders (p.40).
 */
export function firmFillCandidates(state: GameState, firmId: FirmId, orderIds: string[]): string[] {
  const presidency = firmPresidency(state, firmId);
  if (!presidency || orderIds.length >= firmShips(state, firmId).length + 1) return [];
  if (orderIds.length === 0) {
    const port = homePort(state, presidency);
    return port && isFillableBy(port, firmId) ? [port.id] : [];
  }
  const nodes = orderNodes(state);
  const result = new Set<string>();
  for (const id of orderIds) {
    for (const nextId of nodes.get(id)!.order.connectedOrderIds) {
      const next = nodes.get(nextId);
      if (next && !orderIds.includes(nextId) && isFillableBy(next.order, firmId)) result.add(nextId);
    }
  }
  return [...result];
}

/** What filling this order pays now: half value if anyone filled it this turn (p.40). */
export function fillValue(order: OrderState): number {
  return order.filledThisTurnBy.length > 0 ? order.deregulationValue : order.value;
}

export function firmFillDecision(state: GameState, ff: FirmFillState): PendingDecision {
  const nodes = orderNodes(state);
  if (ff.current) {
    const firm = firmById(state, ff.current.firmId)!;
    const ships = firmShips(state, firm.id).length;
    const commands: LegalCommand[] = firmFillCandidates(state, firm.id, ff.current.orderIds).map((orderId) => {
      const { order, regionId } = nodes.get(orderId)!;
      const value = fillValue(order);
      return {
        type: FIRM_FILL_TYPE,
        label: `Fill ${orderId} in ${state.india.regions[regionId].name} (£${value}${value < order.value ? ", half value" : ""})`,
        payload: { action: "fill", orderId } satisfies FirmFillPayload,
      };
    });
    commands.push({
      type: FIRM_FILL_TYPE,
      label: ff.current.orderIds.length === 0 ? "Fill no orders" : "Stop filling orders",
      payload: { action: "stop" } satisfies FirmFillPayload,
    });
    return {
      id: decisionId(state, `company-operation-firm-fill-${firm.id}`),
      phase: "companyOperation",
      step: "companyOperation.firmFill",
      actor: firm.manager,
      visibility: "public",
      prompt: `${firmName(state, firm)} fills orders (${ff.current.orderIds.length} of up to ${ships + 1} so far; £${firm.trade?.income ?? 0} earned).`,
      legalCommands: commands,
      canSave: true,
    };
  }

  const group = lowestGroup(state, ff);
  return {
    id: decisionId(state, "company-operation-firm-order"),
    phase: "companyOperation",
    step: "companyOperation.firmFillOrder",
    actor: tieChooser(state, ff, group),
    visibility: "public",
    prompt: `Tied on initiative ${group[0].initiative}: choose who fills orders next (p.40).`,
    legalCommands: group.map((participant) => ({
      type: FIRM_FILL_TYPE,
      label:
        participant.id === "company"
          ? `The Company (President of ${ff.presidency})`
          : firmName(state, firmById(state, participant.id)!),
      payload: { action: "next", who: participant.id } satisfies FirmFillPayload,
    })),
    canSave: true,
  };
}

/** Begin filling at this Presidency: the Company joins with its Trade, or the firms fill alone. */
export function startFirmFill(
  state: GameState,
  presidency: PresidencyId,
  company: { initiative: number; activity: TradeActivity } | undefined,
  finishesOffice: boolean,
): { state: GameState; notes: string[] } {
  const ff: FirmFillState = {
    presidency,
    ...(company ? { company: { ...company, started: false } } : {}),
    finishesOffice,
  };
  return advance(withCo(state, { firmFill: ff }));
}

/** Called when the Company's placement ends: carry on with the remaining firms. */
export function resumeFirmFill(state: GameState): { state: GameState; notes: string[] } {
  return coState(state).firmFill ? advance(state) : { state, notes: [] };
}

/** Move through the automatic parts of the round until a decision is needed or the round ends. */
function advance(start: GameState): { state: GameState; notes: string[] } {
  let state = start;
  const notes: string[] = [];
  for (;;) {
    const ff = coState(state).firmFill;
    if (!ff) return { state, notes };

    if (ff.current) {
      if (firmFillCandidates(state, ff.current.firmId, ff.current.orderIds).length > 0) return { state, notes };
      const done = completeFirm(state, ff);
      state = done.state;
      notes.push(done.note);
      continue;
    }

    const group = lowestGroup(state, ff);
    if (group.length === 0) {
      const cleared = withCo(state, { firmFill: undefined });
      state = ff.finishesOffice ? finishOffice(cleared, presidentOfficeId(ff.presidency)) : cleared;
      return { state, notes };
    }
    if (group.length > 1) return { state, notes };
    const picked = startParticipant(state, ff, group[0].id);
    state = picked;
    if (group[0].id === "company") return { state, notes };
  }
}

function startParticipant(state: GameState, ff: FirmFillState, who: FirmId | "company"): GameState {
  if (who === "company") {
    const company = ff.company!;
    const started = withCo(state, { firmFill: { ...ff, company: { ...company, started: true } } });
    return withActivity(started, ff.presidency, company.activity);
  }
  return withCo(state, { firmFill: { ...ff, current: { firmId: who, orderIds: [] } } });
}

/** The firm is finished: advance its Value one space per £6 of income this turn (p.41, max 10). */
function completeFirm(state: GameState, ff: FirmFillState): { state: GameState; note: string } {
  const firmId = ff.current!.firmId;
  const firm = firmById(state, firmId)!;
  const income = firm.trade?.income ?? 0;
  const steps = Math.floor(income / 6);
  const value = Math.min(10, firm.value + steps);
  const next: GameState = {
    ...state,
    firms: allFirms(state).map((candidate) => (candidate.id === firmId ? { ...candidate, value } : candidate)),
  };
  const filledCount = ff.current!.orderIds.length;
  return {
    state: withCo(next, { firmsFilled: [...(coState(state).firmsFilled ?? []), firmId], firmFill: { ...ff, current: undefined } }),
    note: `${firmName(state, firm)} filled ${filledCount} order${filledCount === 1 ? "" : "s"} for £${income}${value > firm.value ? ` and advanced to Value ${value}` : ""}.`,
  };
}

export const firmFillStep: OperationStep = (state, command): StepResult => {
  const payload = command.payload as FirmFillPayload;
  const ff = coState(state).firmFill!;

  if (payload.action === "next") {
    const started = startParticipant(state, ff, payload.who);
    const result = advance(started);
    return {
      state: result.state,
      summary: [
        `${payload.who === "company" ? "The Company" : firmName(state, firmById(state, payload.who)!)} fills orders next.`,
        ...result.notes,
      ].join(" "),
    };
  }

  const current = ff.current!;
  const firm = firmById(state, current.firmId)!;
  if (payload.action === "stop") {
    const done = completeFirm(state, ff);
    const result = advance(done.state);
    return { state: result.state, summary: [done.note, ...result.notes].join(" ") };
  }

  const { order } = orderNodes(state).get(payload.orderId)!;
  const value = fillValue(order);
  const marked: GameState = {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([regionId, region]) => [
          regionId,
          {
            ...region,
            orders: region.orders.map((candidate) =>
              candidate.id === payload.orderId
                ? { ...candidate, filledThisTurnBy: [...candidate.filledThisTurnBy, firm.id] }
                : candidate,
            ),
          },
        ]),
      ),
    },
    firms: allFirms(state).map((candidate) =>
      candidate.id === firm.id && candidate.trade
        ? {
            ...candidate,
            indiaTreasury: candidate.indiaTreasury + value,
            trade: { ...candidate.trade, income: candidate.trade.income + value },
          }
        : candidate,
    ),
  };
  const progressed = withCo(marked, { firmFill: { ...ff, current: { ...current, orderIds: [...current.orderIds, payload.orderId] } } });
  const result = advance(progressed);
  return {
    state: result.state,
    summary: [
      `${firmName(state, firm)} filled ${payload.orderId} for £${value}${value < order.value ? " (half value)" : ""}.`,
      ...result.notes,
    ].join(" "),
    details: { firmId: firm.id, orderId: payload.orderId, value },
  };
};
