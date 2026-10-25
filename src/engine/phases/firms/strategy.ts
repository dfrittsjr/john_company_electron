import { firmStrategyById, firmStrategyCards, type FirmStrategyId } from "../../../data";
import type { CommandHandler } from "../../command-handler";
import { allFirms, firmById, firmManagedBy, firmName, firmShips, withFirm } from "../../firms";
import { primeMinisterOrder } from "../../selectors";
import type { FirmId, GameState, PendingDecision, PlayerId } from "../../types";
import { startHiringPhase } from "../hiring";
import { appendLog, okResult } from "../negotiation";
import { nameOf, rejectFirms, sameJson } from "./common";
import type { FirmsPhaseState } from "./state";

// Firm Strategy (rulebook p.40, ruling 4). Each manager, in Prime Minister order, secretly chooses a
// strategy card and then a bid. The choices wait in hidden.firmStrategySecrets (other seats do not
// see them: src/engine/projection.ts). The decisions and log entries are worded so that they give
// nothing away. After the last manager, every bid is taken from its London treasury and made public.

export const STRATEGY_STEP = "firms.strategy";
export const BID_STEP = "firms.strategyBid";

/** Starts Firm Strategy; goes on to Hiring at once if no firm exists. */
export function startFirmStrategy(state: GameState): GameState {
  const order = primeMinisterOrder(state)
    .filter((playerId) => firmManagedBy(state, playerId))
    .filter((playerId) => !state.players[playerId]?.isCrown);
  const fresh: GameState = {
    ...state,
    phase: "firms",
    // Last turn's choices and this turn's trade records start over.
    hidden: { ...state.hidden, firmStrategySecrets: {} },
    firms: allFirms(state).map((firm) => ({ ...firm, tradeBid: undefined, trade: undefined })),
    firmsPhase: { step: "strategy", order, index: -1, passes: 0 },
  };
  return nextManager(fresh);
}

/** Strategy cards a manager can choose: a sea zone needs at least one firm ship and £1 to bid (p.40). */
export function strategyChoices(state: GameState, firmId: FirmId): FirmStrategyId[] {
  const firm = firmById(state, firmId);
  if (!firm) return [];
  const canTrade = firmShips(state, firmId).length > 0 && firm.londonTreasury >= 1;
  return firmStrategyCards.filter((card) => card.id === "hobnob" || canTrade).map((card) => card.id);
}

function strategyDecision(state: GameState, playerId: PlayerId, firmId: FirmId): PendingDecision {
  return {
    id: `decision-firms-strategy-turn-${state.turn}-${playerId}`,
    phase: "firms",
    step: STRATEGY_STEP,
    actor: playerId,
    visibility: "secretCommit",
    prompt: `Firm Strategy: ${nameOf(state, playerId)}, choose your firm's strategy card in secret.`,
    legalCommands: strategyChoices(state, firmId).map((strategy) => {
      const card = firmStrategyById.get(strategy)!;
      return { type: "firms.chooseStrategy", label: card.name, description: card.text, payload: { firmId, strategy } };
    }),
    canSave: true,
  };
}

// The prompt and ids are the same whether or not the strategy is Hobnob, so a bystander learns nothing.
function bidDecision(state: GameState, playerId: PlayerId, firmId: FirmId): PendingDecision {
  const firm = firmById(state, firmId)!;
  const strategy = state.hidden.firmStrategySecrets[firmId]?.strategy;
  const bids = strategy === "hobnob" ? [0] : Array.from({ length: firm.londonTreasury }, (_, index) => index + 1);
  return {
    id: `decision-firms-bid-turn-${state.turn}-${playerId}`,
    phase: "firms",
    step: BID_STEP,
    actor: playerId,
    visibility: "secretCommit",
    prompt: `Firm Strategy: ${nameOf(state, playerId)}, choose how much cash from the London treasury to spend (in secret).`,
    legalCommands: bids.map((bid) => ({
      type: "firms.chooseBid",
      label: bid === 0 ? "Spend nothing" : `Spend £${bid}`,
      description: bid === 0 ? "A firm with the Hobnob strategy places no cash." : `${bid} ${bid === 1 ? "die" : "dice"} at the firm's Presidency (p.40).`,
      payload: { firmId, bid },
    })),
    canSave: true,
  };
}

function withSecret(state: GameState, firmId: FirmId, playerId: PlayerId, update: { strategy?: FirmStrategyId; bid?: number }): GameState {
  const previous = state.hidden.firmStrategySecrets[firmId] ?? { firmId, committedBy: playerId };
  return {
    ...state,
    hidden: { ...state.hidden, firmStrategySecrets: { ...state.hidden.firmStrategySecrets, [firmId]: { ...previous, committedBy: playerId, ...update } } },
  };
}

/** The next manager who has a choice; managers who can only Hobnob are set to it without a prompt. */
function nextManager(state: GameState): GameState {
  const fp = state.firmsPhase as FirmsPhaseState;
  let current = state;
  for (let index = fp.index + 1; index < fp.order.length; index += 1) {
    const playerId = fp.order[index];
    const firm = firmManagedBy(current, playerId);
    if (!firm) continue;
    const next: GameState = { ...current, firmsPhase: { ...fp, index } };
    if (strategyChoices(next, firm.id).length > 1) return { ...next, pendingDecision: strategyDecision(next, playerId, firm.id) };
    current = appendLog(withSecret(next, firm.id, playerId, { strategy: "hobnob", bid: 0 }), {
      actor: playerId,
      type: "firms.strategyChosen",
      summary: `${nameOf(state, playerId)} chose a strategy for ${firmName(state, firm)}.`,
      timestamp: state.updatedAt,
    });
    current = { ...current, firmsPhase: { ...fp, index } };
  }
  return finishStrategy(current);
}

/** Every manager has chosen: bids are paid out of London and become public (p.40), then Hiring. */
function finishStrategy(state: GameState): GameState {
  let next = state;
  const bids: string[] = [];
  for (const firm of allFirms(state)) {
    const bid = state.hidden.firmStrategySecrets[firm.id]?.bid ?? 0;
    next = withFirm(next, { ...firmById(next, firm.id)!, tradeBid: bid, londonTreasury: firm.londonTreasury - bid });
    bids.push(`${firmName(state, firm)} £${bid}`);
  }
  next = { ...next, firmsPhase: undefined };
  if (bids.length > 0) {
    next = appendLog(next, {
      actor: "system",
      type: "firms.bidsRevealed",
      summary: `Every firm manager has chosen. Trade bids: ${bids.join(", ")}.`,
      details: { bids: Object.fromEntries(allFirms(next).map((firm) => [firm.id, firm.tradeBid])) },
      timestamp: state.updatedAt,
    });
  }
  return startHiringPhase(next);
}

function currentChoice(state: GameState, actor: PlayerId, step: string): { firmId: FirmId } | string {
  const fp = state.firmsPhase;
  if (!fp || fp.step !== "strategy" || state.pendingDecision.step !== step) return "No firm strategy is being asked for.";
  if (fp.order[fp.index] !== actor) return "It is not your turn to choose.";
  const firm = firmManagedBy(state, actor);
  return firm ? { firmId: firm.id } : "You manage no firm.";
}

const chooseStrategy: CommandHandler = (state, command) => {
  const actor = command.actorId as PlayerId;
  const current = currentChoice(state, actor, STRATEGY_STEP);
  if (typeof current === "string") return rejectFirms("WRONG_STEP", current, "phase");
  if (!state.pendingDecision.legalCommands.some((legal) => legal.type === command.type && sameJson(legal.payload, command.payload))) {
    return rejectFirms("ILLEGAL_FIRM_STRATEGY", "That strategy is not available.", "payload");
  }
  const { strategy } = command.payload as { strategy: FirmStrategyId };
  const stamped: GameState = { ...state, updatedAt: command.clientTimestamp };
  const stored = withSecret(stamped, current.firmId, actor, { strategy });
  const next: GameState = { ...stored, pendingDecision: bidDecision(stored, actor, current.firmId) };
  // Nothing about the card goes in the log or the decision text (p.40: secret).
  return okResult(
    appendLog(next, {
      actor,
      type: "firms.strategyCardChosen",
      summary: `${nameOf(state, actor)} chose a strategy card.`,
      timestamp: command.clientTimestamp,
      commandId: command.id,
    }),
  );
};

const chooseBid: CommandHandler = (state, command) => {
  const actor = command.actorId as PlayerId;
  const current = currentChoice(state, actor, BID_STEP);
  if (typeof current === "string") return rejectFirms("WRONG_STEP", current, "phase");
  if (!state.pendingDecision.legalCommands.some((legal) => legal.type === command.type && sameJson(legal.payload, command.payload))) {
    return rejectFirms("ILLEGAL_FIRM_BID", "That bid is not available.", "payload");
  }
  const { bid } = command.payload as { bid: number };
  const stamped: GameState = { ...state, updatedAt: command.clientTimestamp };
  const stored = appendLog(withSecret(stamped, current.firmId, actor, { bid }), {
    actor,
    type: "firms.strategyChosen",
    summary: `${nameOf(state, actor)} chose a strategy and a bid for ${firmName(state, firmById(state, current.firmId)!)}.`,
    timestamp: command.clientTimestamp,
    commandId: command.id,
  });
  return okResult(nextManager(stored));
};

export const strategyCommandHandlers: Record<string, CommandHandler> = {
  "firms.chooseStrategy": chooseStrategy,
  "firms.chooseBid": chooseBid,
};
