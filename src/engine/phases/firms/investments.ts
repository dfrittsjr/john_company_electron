import { firmCharter } from "../../../data";
import type { CommandHandler } from "../../command-handler";
import {
  allFirms,
  dissolveFirm,
  firmById,
  firmInvestmentSources,
  firmManagedBy,
  firmName,
  firmShareTotal,
  formFirm,
  formFirmBlockReason,
  investBlockReason,
  investInFirm,
  mergeFirms,
  takeOverFirm,
  weakCompanySharesReason,
  withFirm,
  type FirmInvestmentSource,
} from "../../firms";
import { primeMinisterOrder, shipyardOwner } from "../../selectors";
import type { FirmId, GameState, LegalCommand, PendingDecision, PlayerId } from "../../types";
import {
  appendLog,
  okResult,
  registerConsentResolver,
  registerDecisionRefresher,
  registerStateRefresher,
  requestConsent,
} from "../negotiation";
import { CROWN_PLAYER_ID } from "../../crown/state";
import { nameOf, rejectFirms, sameJson, shipFitCost } from "./common";
import type { FirmsPhaseState, MergeDraft } from "./state";
import { startFirmStrategy } from "./strategy";

// Firm Investments (rulebook pp.38-39). Rounds in Prime Minister order (ruling 2): each player takes
// one action or passes, and the step ends once every player has passed since the last action. A
// refused request is a turn used without an action. Every action that needs someone's consent goes
// through the negotiation consent request, so each asked player decides in their own pending
// decision and the game resumes where it left off, even after a save.

const SHIPPING_OFFICE = "manager-of-shipping";

export const INVESTMENTS_STEP = "firms.investments";
/** The Crown's one investment after every player has finished (Crown Handbook p.3). */
export const CROWN_INVESTMENT_STEP = "firms.crownInvestment";
export const MERGE_BUILD_STEP = "firms.mergeBuild";
export const MERGE_PRIMARY_STEP = "firms.mergePrimary";
export const MERGE_RETURN_STEP = "firms.mergeReturn";
const MERGE_STEPS = [MERGE_BUILD_STEP, MERGE_PRIMARY_STEP, MERGE_RETURN_STEP];

/** What a consent request is for. Serializable: it lives in the negotiation interrupt stack. */
export type FirmAction =
  | { kind: "form"; actor: PlayerId; source: FirmInvestmentSource }
  | { kind: "invest"; actor: PlayerId; firmId: FirmId; source: FirmInvestmentSource }
  | { kind: "fitShip"; actor: PlayerId; firmId: FirmId; shipId: string }
  | { kind: "buyBack"; actor: PlayerId; firmId: FirmId; shipId: string }
  | { kind: "takeOver"; actor: PlayerId; firmId: FirmId }
  | { kind: "dissolve"; actor: PlayerId; firmId: FirmId }
  | { kind: "merge"; actor: PlayerId; primaryId: FirmId; secondaryIds: FirmId[]; returned: Record<PlayerId, number> };

// ---------------------------------------------------------------------------------------------
// Phase flow

/** Starts Firm Investments (called by startFirmsPhase). */
export function startFirmInvestments(state: GameState): GameState {
  const order = primeMinisterOrder(state).filter((playerId) => !state.players[playerId]?.isCrown);
  const firmsPhase: FirmsPhaseState = { step: "investments", order, index: -1, passes: 0 };
  return nextInvestmentTurn(logIdlePlayers({ ...state, phase: "firms", firmsPhase }, order));
}

/**
 * Players with nothing to do are skipped without a prompt (below), so say once, at the start, who
 * they are and why, instead of leaving them wondering where their turn went.
 */
function logIdlePlayers(state: GameState, order: PlayerId[]): GameState {
  const idle = order.filter((playerId) => investmentCommands(state, playerId).length <= 1);
  if (idle.length === 0) return state;
  const reasons: string[] = [];
  const weak = weakCompanySharesReason(state);
  if (weak) reasons.push(weak.replace(/\.$/, ""));
  if (idle.some((playerId) => state.company.court.some((share) => share.owner === playerId && share.createdTurn === state.turn))) {
    reasons.push("Company shares created this turn can't be used yet (p.38)");
  }
  reasons.push("forming or investing also needs a Company share or an uninvested workshop");
  const who = idle.map((playerId) => nameOf(state, playerId)).join(", ");
  return appendLog(state, {
    actor: "system",
    type: "firms.idle",
    summary: `Firm Investments: ${who} ${idle.length === 1 ? "has" : "have"} nothing to do this turn and ${idle.length === 1 ? "is" : "are"} skipped (${reasons.join("; ")}).`,
    timestamp: state.updatedAt,
  });
}

/** Moves to the next player who has something to do; players with nothing pass automatically. */
function nextInvestmentTurn(state: GameState): GameState {
  const fp = state.firmsPhase as FirmsPhaseState;
  // The Crown invests once, after every player has finished, and nobody acts after it (Handbook p.3).
  if (fp.crownActed) return startFirmStrategy(state);
  let index = fp.index;
  let passes = fp.passes;
  const count = fp.order.length;
  while (passes < count) {
    index = (index + 1) % count;
    const playerId = fp.order[index];
    if (investmentCommands(state, playerId).length > 1) {
      const next: GameState = { ...state, phase: "firms", firmsPhase: { ...fp, index, passes, merge: undefined } };
      return { ...next, pendingDecision: investmentsDecision(next, playerId) };
    }
    passes += 1; // "No dead actions": a player with nothing to do but pass is skipped.
  }
  return crownInvestmentTurn({ ...state, firmsPhase: { ...fp, index, passes } });
}

/** "Only once all players have finished investing, the Crown may seek to invest in a firm" (Handbook p.3). */
function crownInvestmentTurn(state: GameState): GameState {
  const fp = state.firmsPhase as FirmsPhaseState;
  const crownId = state.crown ? CROWN_PLAYER_ID : undefined;
  // "No dead actions": the Crown is asked only when it could invest somewhere.
  if (!crownId || fp.crownActed || investmentCommands(state, crownId).length <= 1) return startFirmStrategy(state);
  const next: GameState = { ...state, phase: "firms", firmsPhase: { ...fp, crownActed: true, merge: undefined } };
  return { ...next, pendingDecision: investmentsDecision(next, crownId) };
}

/** After a turn's action (`acted`) or a pass / refusal: record it and move on. */
function finishInvestmentTurn(state: GameState, acted: boolean): GameState {
  const fp = state.firmsPhase as FirmsPhaseState;
  return nextInvestmentTurn({
    ...state,
    firmsPhase: { ...fp, passes: acted ? 0 : fp.passes + 1, merge: undefined },
  });
}

function investmentsDecision(state: GameState, playerId: PlayerId): PendingDecision {
  const crown = Boolean(state.players[playerId]?.isCrown);
  return {
    id: `decision-firms-investments-turn-${state.turn}-${playerId}-${state.log.length}`,
    phase: "firms",
    step: crown ? CROWN_INVESTMENT_STEP : INVESTMENTS_STEP,
    actor: playerId,
    visibility: "public",
    prompt: crown
      ? "Firm Investments: the Crown may invest in a firm, or pass."
      : `Firm Investments: ${nameOf(state, playerId)}, take one action or pass.`,
    legalCommands: investmentCommands(state, playerId),
    canSave: true,
  };
}

for (const step of [INVESTMENTS_STEP, CROWN_INVESTMENT_STEP]) {
  registerDecisionRefresher(step, (state) => {
    const decision = state.pendingDecision;
    return { ...decision, legalCommands: investmentCommands(state, decision.actor as PlayerId) };
  });
}

// ---------------------------------------------------------------------------------------------
// What a player may do

/** One interchangeable Company share and one workshop; the rest would be duplicate buttons. */
function distinctSources(sources: FirmInvestmentSource[]): FirmInvestmentSource[] {
  return [
    sources.find((source) => source.kind === "companyShare"),
    sources.find((source) => source.kind === "workshop"),
  ].filter((source): source is FirmInvestmentSource => source !== undefined);
}

function sourceLabel(source: FirmInvestmentSource): string {
  return source.kind === "companyShare" ? "a Company share" : "a workshop";
}

type ShipOption = { shipId: string; cost: number; owner: PlayerId; fatigued: boolean };

function fittableShips(state: GameState): ShipOption[] {
  return state.company.ships.flatMap((ship) => {
    if (ship.kind !== "player" || ship.location !== "shipyard") return [];
    const owner = shipyardOwner(state, ship.shipyardCardId ?? "");
    return owner ? [{ shipId: ship.id, cost: shipFitCost(state, firmCharter.fitShipCost), owner, fatigued: ship.fatigued }] : [];
  });
}

function buyableShips(state: GameState): ShipOption[] {
  if (!state.company.offices[SHIPPING_OFFICE]) return [];
  return state.company.ships.flatMap((ship) => {
    if (ship.kind !== "player" || ship.location === "shipyard" || ship.location.startsWith("firm:")) return [];
    const owner = shipyardOwner(state, ship.shipyardCardId ?? "");
    if (!owner) return [];
    const cost = ship.fatigued ? firmCharter.buybackFatiguedShipCost : firmCharter.buybackFreshShipCost;
    return [{ shipId: ship.id, cost, owner, fatigued: ship.fatigued }];
  });
}

function shipName(state: GameState, shipId: string): string {
  const ship = state.company.ships.find((candidate) => candidate.id === shipId);
  const owner = ship ? shipyardOwner(state, ship.shipyardCardId ?? "") : undefined;
  return `the ${ship?.shipyardCardId ?? "player"} ship${owner ? ` (${nameOf(state, owner)})` : ""}`;
}

/** Every legal command for this player's turn, the pass last. At least the pass. */
export function investmentCommands(state: GameState, playerId: PlayerId): LegalCommand[] {
  const commands: LegalCommand[] = [];
  const mine = firmManagedBy(state, playerId);
  const sources = distinctSources(firmInvestmentSources(state, playerId));
  // "The Crown never creates a private firm" (Handbook p.3): it only invests, once, after the players.
  const isCrown = Boolean(state.players[playerId]?.isCrown);

  if (!mine && !isCrown) {
    for (const source of sources) {
      if (formFirmBlockReason(state, playerId, source)) continue;
      commands.push({
        type: "firms.formFirm",
        label: `Form a firm with ${sourceLabel(source)}`,
        description: "Gives up the Company share or flips the workshop; £5 from the bank goes to the firm's London treasury (p.38).",
        payload: { source },
      });
    }
  }

  for (const firm of allFirms(state)) {
    for (const source of sources) {
      if (investBlockReason(state, firm.id, playerId, source)) continue;
      const own = firm.manager === playerId;
      commands.push({
        type: "firms.invest",
        label: `Invest in ${firmName(state, firm)} with ${sourceLabel(source)}`,
        description: `${source.kind === "companyShare" ? "You give up the Company share (it returns to your supply)" : "You flip the workshop to its invested side"}; £5 from the bank goes to the London treasury and you gain a firm share${own ? "" : `, with ${nameOf(state, firm.manager)}'s consent`} (p.38).`,
        payload: { firmId: firm.id, source },
      });
    }
  }

  if (isCrown) {
    // Only investing (above) and passing.
  } else if (mine) {
    for (const ship of fittableShips(state)) {
      if (mine.londonTreasury < ship.cost) continue;
      commands.push({
        type: "firms.fitShip",
        label: `Fit ${shipName(state, ship.shipId)} to ${firmName(state, mine)} for £${ship.cost}`,
        description: ship.owner === playerId ? "Your own shipyard." : `Needs ${nameOf(state, ship.owner)}'s consent (p.39).`,
        payload: { shipId: ship.shipId },
      });
    }
    for (const ship of buyableShips(state)) {
      if (mine.londonTreasury < ship.cost) continue;
      commands.push({
        type: "firms.buyBackShip",
        label: `Buy back ${shipName(state, ship.shipId)} for £${ship.cost}${ship.fatigued ? " (fatigued)" : ""}`,
        description: `The money goes to the Manager of Shipping's treasury${ship.owner === playerId ? "" : `; needs ${nameOf(state, ship.owner)}'s consent`} (p.39).`,
        payload: { shipId: ship.shipId },
      });
    }
    if (allFirms(state).length > 1) {
      commands.push({
        type: "firms.startMerge",
        label: "Propose a merger",
        description: "Choose the firms to merge; every shareholder must consent (p.39).",
        payload: {},
      });
    }
    commands.push({
      type: "firms.dissolve",
      label: `Dissolve ${firmName(state, mine)}`,
      description: "Every shareholder must consent; all shares go to Debtor's Prison (p.37, p.41).",
      payload: {},
    });
  } else {
    for (const firm of allFirms(state)) {
      commands.push({
        type: "firms.takeOver",
        label: `Hostile takeover of ${firmName(state, firm)}`,
        description: `Shareholders holding a majority of its shares must consent (p.39).`,
        payload: { firmId: firm.id },
      });
    }
  }

  commands.push({ type: "firms.pass", label: "Pass", description: "Take no action now.", payload: {} });
  return commands;
}

// ---------------------------------------------------------------------------------------------
// Consent plumbing

function seatIndex(state: GameState, playerId: PlayerId): number {
  return state.seatingOrder.indexOf(playerId);
}

/** Holders other than `except`, most shares first, then in seating order. */
function holdersByShares(state: GameState, shares: Record<PlayerId, number>, except: PlayerId[] = []): PlayerId[] {
  return Object.entries(shares)
    .filter(([playerId, count]) => count > 0 && !except.includes(playerId))
    .sort(([a, x], [b, y]) => y - x || seatIndex(state, a) - seatIndex(state, b))
    .map(([playerId]) => playerId);
}

/** The fewest holders (largest first) who, with the taker's own shares, make a majority (p.39). */
function takeoverConsenters(state: GameState, firmId: FirmId, actor: PlayerId): PlayerId[] {
  const firm = firmById(state, firmId);
  if (!firm) return [];
  const needed = Math.floor(firmShareTotal(firm) / 2) + 1;
  let sum = firm.shares[actor] ?? 0;
  const chosen: PlayerId[] = [];
  for (const holder of holdersByShares(state, firm.shares, [actor])) {
    if (sum >= needed) break;
    chosen.push(holder);
    sum += firm.shares[holder];
  }
  return chosen;
}

function mergeConsenters(state: GameState, firmIds: FirmId[], actor: PlayerId): PlayerId[] {
  const firms = firmIds.map((id) => firmById(state, id)).filter((firm) => firm !== undefined);
  const managers = firms.map((firm) => firm!.manager);
  const holders = [...new Set(firms.flatMap((firm) => Object.keys(firm!.shares)))];
  return [...new Set([...managers, ...holders.sort((a, b) => seatIndex(state, a) - seatIndex(state, b))])].filter(
    (playerId) => playerId !== actor,
  );
}

function request(state: GameState, action: FirmAction, from: PlayerId[], prompt: string): GameState {
  return requestConsent(state, {
    kind: "firms.action",
    requestedBy: action.actor,
    from,
    prompt,
    context: action,
    // Always resume at the proposer's turn (also after a merger step), then the resolver moves on.
    resumeDecision: investmentsDecision(state, action.actor),
  });
}

type Performed = { state: GameState } | { error: string };

function fail(error: string): Performed {
  return { error };
}

/** Re-checks and carries out an action once its consent is in. Shares may have moved meanwhile. */
function perform(state: GameState, action: FirmAction, askedOf: PlayerId[]): Performed {
  const actor = action.actor;
  const player = nameOf(state, actor);
  try {
    switch (action.kind) {
      case "form": {
        const { state: formed, firmId } = formFirm(state, actor, action.source);
        const firm = firmById(formed, firmId)!;
        return {
          state: appendLog(formed, {
            actor,
            type: "firms.formed",
            summary: `${player} formed ${firmName(formed, firm)} with ${sourceLabel(action.source)}.`,
            details: { firmId, source: action.source },
            timestamp: state.updatedAt,
          }),
        };
      }
      case "invest": {
        const firm = firmById(state, action.firmId);
        if (!firm) return fail("That firm no longer exists.");
        const { state: invested, createdShare } = investInFirm(state, action.firmId, actor, action.source);
        return {
          state: appendLog(invested, {
            actor,
            type: "firms.invested",
            summary: `${player} invested in ${firmName(state, firm)} with ${sourceLabel(action.source)}${createdShare ? " and took a share" : " (the firm already has 10 shares)"}.`,
            details: { firmId: action.firmId, source: action.source, createdShare },
            timestamp: state.updatedAt,
          }),
        };
      }
      case "fitShip": {
        const firm = firmById(state, action.firmId);
        const ship = fittableShips(state).find((candidate) => candidate.shipId === action.shipId);
        if (!firm || firm.manager !== actor) return fail("The firm is no longer yours.");
        if (!ship) return fail("That ship is no longer on its shipyard.");
        if (firm.londonTreasury < ship.cost) return fail("The firm can't afford the ship.");
        const fitted: GameState = {
          ...withFirm(state, { ...firm, londonTreasury: firm.londonTreasury - ship.cost }),
          company: {
            ...state.company,
            ships: state.company.ships.map((candidate) =>
              candidate.id === ship.shipId ? { ...candidate, location: `firm:${firm.id}` as const, fatigued: false } : candidate,
            ),
          },
        };
        return {
          state: appendLog(fitted, {
            actor,
            type: "firms.shipFitted",
            summary: `${player} fitted ${shipName(state, ship.shipId)} to ${firmName(state, firm)} for £${ship.cost}.`,
            details: { firmId: firm.id, shipId: ship.shipId, cost: ship.cost },
            timestamp: state.updatedAt,
          }),
        };
      }
      case "buyBack": {
        const firm = firmById(state, action.firmId);
        const ship = buyableShips(state).find((candidate) => candidate.shipId === action.shipId);
        if (!firm || firm.manager !== actor) return fail("The firm is no longer yours.");
        if (!ship) return fail("That ship is no longer in the Company.");
        if (firm.londonTreasury < ship.cost) return fail("The firm can't afford the ship.");
        const office = state.company.offices[SHIPPING_OFFICE];
        const bought: GameState = {
          ...withFirm(state, { ...firm, londonTreasury: firm.londonTreasury - ship.cost }),
          company: {
            ...state.company,
            offices: { ...state.company.offices, [SHIPPING_OFFICE]: { ...office, treasury: office.treasury + ship.cost } },
            ships: state.company.ships.map((candidate) =>
              candidate.id === ship.shipId ? { ...candidate, location: `firm:${firm.id}` as const, fatigued: false } : candidate,
            ),
          },
        };
        return {
          state: appendLog(bought, {
            actor,
            type: "firms.shipBoughtBack",
            summary: `${player} bought back ${shipName(state, ship.shipId)} for ${firmName(state, firm)} for £${ship.cost}, paid to the Manager of Shipping.`,
            details: { firmId: firm.id, shipId: ship.shipId, cost: ship.cost },
            timestamp: state.updatedAt,
          }),
        };
      }
      case "takeOver": {
        const firm = firmById(state, action.firmId);
        if (!firm) return fail("That firm no longer exists.");
        if (firmManagedBy(state, actor)) return fail("You already manage a firm.");
        const agreed = (firm.shares[actor] ?? 0) + askedOf.reduce((total, holder) => total + (firm.shares[holder] ?? 0), 0);
        if (agreed < Math.floor(firmShareTotal(firm) / 2) + 1) return fail("The consenting players no longer hold a majority of the shares.");
        const taken = takeOverFirm(state, action.firmId, actor);
        return {
          state: appendLog(taken, {
            actor,
            type: "firms.takenOver",
            summary: `${player} took over ${firmName(state, firm)} from ${nameOf(state, firm.manager)}; the firm now sits on ${player}'s board as ${firmName(taken, firmById(taken, firm.id)!)}.`,
            details: { firmId: firm.id, previousManager: firm.manager },
            timestamp: state.updatedAt,
          }),
        };
      }
      case "dissolve": {
        const firm = firmById(state, action.firmId);
        if (!firm || firm.manager !== actor) return fail("The firm is no longer yours.");
        const unasked = Object.keys(firm.shares).filter((holder) => holder !== actor && !askedOf.includes(holder));
        if (unasked.length > 0) return fail("A new shareholder has not been asked.");
        return {
          state: appendLog(dissolveFirm(state, firm.id), {
            actor,
            type: "firms.dissolved",
            summary: `${player} dissolved ${firmName(state, firm)} with every shareholder's consent; its shares go to Debtor's Prison.`,
            details: { firmId: firm.id, shares: firm.shares },
            timestamp: state.updatedAt,
          }),
        };
      }
      case "merge": {
        const involved = [action.primaryId, ...action.secondaryIds];
        const firms = involved.map((id) => firmById(state, id));
        if (firms.some((firm) => !firm)) return fail("A firm in the merger no longer exists.");
        const unasked = mergeConsenters(state, involved, actor).filter((holder) => !askedOf.includes(holder));
        if (unasked.length > 0) return fail("A new shareholder has not been asked.");
        const names = involved.map((id) => firmName(state, firmById(state, id)!));
        return {
          state: appendLog(mergeFirms(state, action.primaryId, action.secondaryIds, action.returned), {
            actor,
            type: "firms.merged",
            summary: `${names.join(", ")} merged into ${names[0]} (the primary firm).`,
            details: { primaryId: action.primaryId, secondaryIds: action.secondaryIds, returned: action.returned },
            timestamp: state.updatedAt,
          }),
        };
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That can't be done now.");
  }
}

registerConsentResolver("firms.action", (state, requestRecord, accepted) => {
  const action = requestRecord.context as FirmAction;
  if (!accepted) {
    return finishInvestmentTurn(
      appendLog(state, {
        actor: action.actor,
        type: "firms.refused",
        summary: `${nameOf(state, action.actor)}'s request was refused; that uses their turn.`,
        timestamp: state.updatedAt,
      }),
      false,
    );
  }
  const result = perform(state, action, requestRecord.askOrder);
  if ("error" in result) {
    return finishInvestmentTurn(
      appendLog(state, {
        actor: action.actor,
        type: "firms.failed",
        summary: `${nameOf(state, action.actor)}'s ${action.kind} could not be completed: ${result.error}`,
        timestamp: state.updatedAt,
      }),
      false,
    );
  }
  return finishInvestmentTurn(result.state, true);
});

// ---------------------------------------------------------------------------------------------
// Commands

function guard(state: GameState, actorId: PlayerId): string | undefined {
  if (
    !state.firmsPhase ||
    state.firmsPhase.step !== "investments" ||
    ![INVESTMENTS_STEP, CROWN_INVESTMENT_STEP].includes(state.pendingDecision.step)
  ) {
    return "No Firm Investments action is being asked for.";
  }
  if (state.pendingDecision.actor !== actorId) return "It is not your turn in Firm Investments.";
  return undefined;
}

function investmentHandler(type: string): CommandHandler {
  return (state, command) => {
    const actor = command.actorId as PlayerId;
    const problem = guard(state, actor);
    if (problem) return rejectFirms("WRONG_STEP", problem, "phase");
    const legal = investmentCommands(state, actor).find(
      (candidate) => candidate.type === type && sameJson(candidate.payload, command.payload),
    );
    if (!legal) return rejectFirms("ILLEGAL_FIRM_ACTION", "That firm action is not legal now.", "payload");

    const now = command.clientTimestamp;
    const base: GameState = { ...state, updatedAt: now };
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const player = nameOf(state, actor);
    const mine = firmManagedBy(state, actor);

    switch (type) {
      case "firms.pass":
        return okResult(
          finishInvestmentTurn(
            appendLog(base, { actor, type: "firms.passed", summary: `${player} passed in Firm Investments.`, timestamp: now, commandId: command.id }),
            false,
          ),
        );
      case "firms.formFirm": {
        const action: FirmAction = { kind: "form", actor, source: payload.source as FirmInvestmentSource };
        return okResult(request(base, action, [], ""));
      }
      case "firms.invest": {
        const firm = firmById(state, payload.firmId as string)!;
        const action: FirmAction = { kind: "invest", actor, firmId: firm.id, source: payload.source as FirmInvestmentSource };
        return okResult(
          request(base, action, [firm.manager], `${player} asks to invest in ${firmName(state, firm)} with ${sourceLabel(action.source)}. Do you consent?`),
        );
      }
      case "firms.fitShip": {
        const shipId = payload.shipId as string;
        const owner = fittableShips(state).find((ship) => ship.shipId === shipId)!.owner;
        const action: FirmAction = { kind: "fitShip", actor, firmId: mine!.id, shipId };
        return okResult(
          request(base, action, [owner], `${player} asks to fit ${shipName(state, shipId)} to ${firmName(state, mine!)}. Do you consent?`),
        );
      }
      case "firms.buyBackShip": {
        const shipId = payload.shipId as string;
        const owner = buyableShips(state).find((ship) => ship.shipId === shipId)!.owner;
        const action: FirmAction = { kind: "buyBack", actor, firmId: mine!.id, shipId };
        return okResult(
          request(base, action, [owner], `${player} asks to buy back ${shipName(state, shipId)} for ${firmName(state, mine!)}. Do you consent?`),
        );
      }
      case "firms.takeOver": {
        const firm = firmById(state, payload.firmId as string)!;
        const action: FirmAction = { kind: "takeOver", actor, firmId: firm.id };
        return okResult(
          request(base, action, takeoverConsenters(state, firm.id, actor), `${player} proposes a hostile takeover of ${firmName(state, firm)}. Do you consent?`),
        );
      }
      case "firms.dissolve": {
        const action: FirmAction = { kind: "dissolve", actor, firmId: mine!.id };
        return okResult(
          request(base, action, holdersByShares(state, mine!.shares, [actor]), `${player} proposes to dissolve ${firmName(state, mine!)}; all its shares go to Debtor's Prison. Do you consent?`),
        );
      }
      case "firms.startMerge": {
        const draft: MergeDraft = { initiator: actor, firmIds: [mine!.id], returned: {} };
        const started = appendLog(
          { ...base, firmsPhase: { ...state.firmsPhase!, merge: draft } },
          { actor, type: "firms.mergeStarted", summary: `${player} begins to negotiate a merger.`, timestamp: now, commandId: command.id },
        );
        return okResult({ ...started, pendingDecision: mergeBuildDecision(started) });
      }
    }
    return rejectFirms("UNKNOWN_FIRM_ACTION", `Unknown firm action ${type}.`, "type");
  };
}

// ---------------------------------------------------------------------------------------------
// Mergers (p.39): choose the firms, the primary firm if tied, the excess shares to return, then
// one consent request to every shareholder of every involved firm.

function draftOf(state: GameState): MergeDraft | undefined {
  return state.firmsPhase?.merge;
}

function mergeDecisionBase(state: GameState, draft: MergeDraft, step: string, prompt: string, legalCommands: LegalCommand[]): PendingDecision {
  return {
    id: `decision-${step.replace(".", "-")}-turn-${state.turn}-${draft.initiator}-${draft.firmIds.length}-${state.log.length}`,
    phase: "firms",
    step,
    actor: draft.initiator,
    visibility: "public",
    prompt,
    legalCommands,
    canSave: true,
  };
}

const cancelMerge: LegalCommand = {
  type: "firms.mergeCancel",
  label: "Call off the merger",
  description: "Return to Firm Investments without using your turn.",
  payload: {},
};

function mergeBuildDecision(state: GameState): PendingDecision {
  const draft = draftOf(state) as MergeDraft;
  const names = draft.firmIds.map((id) => firmName(state, firmById(state, id)!)).join(", ");
  const commands: LegalCommand[] = allFirms(state)
    .filter((firm) => !draft.firmIds.includes(firm.id))
    .map((firm) => ({
      type: "firms.mergeAdd",
      label: `Add ${firmName(state, firm)} (Value ${firm.value}, ${firmShareTotal(firm)} shares)`,
      payload: { firmId: firm.id },
    }));
  if (draft.firmIds.length >= 2) {
    commands.push({
      type: "firms.mergeProceed",
      label: "Ask the shareholders to consent",
      description: "Every shareholder of every involved firm must agree (p.39).",
      payload: {},
    });
  }
  commands.push(cancelMerge);
  return mergeDecisionBase(state, draft, MERGE_BUILD_STEP, `Merger: ${names}. Add another firm, or ask for consent.`, commands);
}

function mergedShares(state: GameState, draft: MergeDraft): Record<PlayerId, number> {
  const totals: Record<PlayerId, number> = {};
  for (const id of draft.firmIds) {
    for (const [playerId, count] of Object.entries(firmById(state, id)?.shares ?? {})) totals[playerId] = (totals[playerId] ?? 0) + count;
  }
  return totals;
}

/** Works out the next merger step from the draft, and asks for consent when it is complete. */
function advanceMerge(state: GameState): GameState {
  const draft = draftOf(state);
  const fp = state.firmsPhase;
  if (!draft || !fp) return state;
  const firms = draft.firmIds.map((id) => firmById(state, id));
  if (firms.some((firm) => !firm)) return abandonMerge(state, "A firm in the merger no longer exists.");

  const topValue = Math.max(...firms.map((firm) => firm!.value));
  const tied = firms.filter((firm) => firm!.value === topValue).map((firm) => firm!.id);
  let primaryId = draft.primaryId && draft.firmIds.includes(draft.primaryId) ? draft.primaryId : undefined;
  if (primaryId && !tied.includes(primaryId)) primaryId = undefined;
  if (!primaryId && tied.length === 1) primaryId = tied[0];
  if (!primaryId) {
    const next: GameState = { ...state, firmsPhase: { ...fp, merge: { ...draft, primaryId: undefined } } };
    return {
      ...next,
      pendingDecision: mergeDecisionBase(
        next,
        draft,
        MERGE_PRIMARY_STEP,
        "These firms tie for the highest Value. Which is the primary firm?",
        tied.map((id) => ({ type: "firms.mergeChoosePrimary", label: `${firmName(state, firmById(state, id)!)} is primary`, payload: { firmId: id } })),
      ),
    };
  }

  const totals = mergedShares(state, draft);
  const returned = Object.fromEntries(
    Object.entries(draft.returned)
      .map(([playerId, count]) => [playerId, Math.min(count, totals[playerId] ?? 0)] as const)
      .filter(([, count]) => count > 0),
  );
  const kept = Object.entries(totals).reduce((total, [playerId, count]) => total + count - (returned[playerId] ?? 0), 0);
  const withDraft: GameState = { ...state, firmsPhase: { ...fp, merge: { ...draft, primaryId, returned } } };

  if (kept > firmCharter.maxShares) {
    const holders = holdersByShares(withDraft, Object.fromEntries(Object.entries(totals).map(([playerId, count]) => [playerId, count - (returned[playerId] ?? 0)])));
    return {
      ...withDraft,
      pendingDecision: mergeDecisionBase(
        withDraft,
        { ...draft, returned },
        MERGE_RETURN_STEP,
        `The merged firm would hold ${kept} shares; at most ${firmCharter.maxShares} are allowed. Choose a share to return to its owner's supply (they consent as part of the merger).`,
        [
          ...holders.map((playerId) => ({
            type: "firms.mergeReturnShare",
            label: `Return one of ${nameOf(state, playerId)}'s shares`,
            payload: { playerId },
          })),
          cancelMerge,
        ],
      ),
    };
  }

  const secondaryIds = draft.firmIds.filter((id) => id !== primaryId);
  const action: FirmAction = { kind: "merge", actor: draft.initiator, primaryId, secondaryIds, returned };
  const names = draft.firmIds.map((id) => firmName(state, firmById(state, id)!)).join(", ");
  return request(
    withDraft,
    action,
    mergeConsenters(state, draft.firmIds, draft.initiator),
    `${nameOf(state, draft.initiator)} proposes merging ${names} into ${firmName(state, firmById(state, primaryId)!)}${Object.keys(returned).length > 0 ? `, returning excess shares to their owners' supply` : ""}. Do you consent?`,
  );
}

function abandonMerge(state: GameState, reason: string): GameState {
  const draft = draftOf(state);
  const fp = state.firmsPhase as FirmsPhaseState;
  const cleared: GameState = appendLog(
    { ...state, firmsPhase: { ...fp, merge: undefined } },
    { actor: draft?.initiator, type: "firms.mergeCalledOff", summary: `The merger was called off. ${reason}`, timestamp: state.updatedAt },
  );
  return { ...cleared, pendingDecision: investmentsDecision(cleared, draft?.initiator ?? (state.pendingDecision.actor as PlayerId)) };
}

// Only the firm list can go stale under anytime trades; the later steps are re-checked when applied.
registerStateRefresher(MERGE_BUILD_STEP, (state) =>
  draftOf(state) ? { ...state, pendingDecision: { ...mergeBuildDecision(state), id: state.pendingDecision.id } } : state,
);

function mergeHandler(type: string): CommandHandler {
  return (state, command) => {
    const draft = draftOf(state);
    if (!draft || !MERGE_STEPS.includes(state.pendingDecision.step)) {
      return rejectFirms("WRONG_STEP", "No merger is being put together.", "phase");
    }
    if (command.actorId !== draft.initiator) return rejectFirms("ACTOR_NOT_ALLOWED", "Only the merger's proposer decides this.", "actorId");
    const legal = state.pendingDecision.legalCommands.find(
      (candidate) => candidate.type === type && sameJson(candidate.payload, command.payload),
    );
    if (!legal) return rejectFirms("ILLEGAL_FIRM_ACTION", "That merger choice is not legal now.", "payload");

    const now = command.clientTimestamp;
    const base: GameState = { ...state, updatedAt: now };
    const fp = base.firmsPhase as FirmsPhaseState;
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const log = (next: GameState, summary: string, logType: string) =>
      appendLog(next, { actor: draft.initiator, type: logType, summary, timestamp: now, commandId: command.id });

    switch (type) {
      case "firms.mergeAdd": {
        const next = log(
          { ...base, firmsPhase: { ...fp, merge: { ...draft, firmIds: [...draft.firmIds, payload.firmId as string], primaryId: undefined, returned: {} } } },
          `${nameOf(state, draft.initiator)} added ${firmName(state, firmById(state, payload.firmId as string)!)} to the merger.`,
          "firms.mergeAdded",
        );
        return okResult({ ...next, pendingDecision: mergeBuildDecision(next) });
      }
      case "firms.mergeProceed":
        return okResult(advanceMerge(log(base, `${nameOf(state, draft.initiator)} finished choosing the firms to merge.`, "firms.mergeChosen")));
      case "firms.mergeChoosePrimary": {
        const next = log(
          { ...base, firmsPhase: { ...fp, merge: { ...draft, primaryId: payload.firmId as string } } },
          `${firmName(state, firmById(state, payload.firmId as string)!)} is the primary firm of the merger.`,
          "firms.mergePrimaryChosen",
        );
        return okResult(advanceMerge(next));
      }
      case "firms.mergeReturnShare": {
        const playerId = payload.playerId as string;
        const next = log(
          { ...base, firmsPhase: { ...fp, merge: { ...draft, returned: { ...draft.returned, [playerId]: (draft.returned[playerId] ?? 0) + 1 } } } },
          `One of ${nameOf(state, playerId)}'s shares will be returned to their supply in the merger.`,
          "firms.mergeShareReturned",
        );
        return okResult(advanceMerge(next));
      }
      case "firms.mergeCancel": {
        const cleared = log({ ...base, firmsPhase: { ...fp, merge: undefined } }, `${nameOf(state, draft.initiator)} called off the merger.`, "firms.mergeCalledOff");
        return okResult({ ...cleared, pendingDecision: investmentsDecision(cleared, draft.initiator) });
      }
    }
    return rejectFirms("UNKNOWN_FIRM_ACTION", `Unknown merger choice ${type}.`, "type");
  };
}

export const investmentCommandHandlers: Record<string, CommandHandler> = {
  ...Object.fromEntries(
    ["firms.pass", "firms.formFirm", "firms.invest", "firms.fitShip", "firms.buyBackShip", "firms.takeOver", "firms.dissolve", "firms.startMerge"].map(
      (type) => [type, investmentHandler(type)],
    ),
  ),
  ...Object.fromEntries(
    ["firms.mergeAdd", "firms.mergeProceed", "firms.mergeChoosePrimary", "firms.mergeReturnShare", "firms.mergeCancel"].map((type) => [
      type,
      mergeHandler(type),
    ]),
  ),
};
