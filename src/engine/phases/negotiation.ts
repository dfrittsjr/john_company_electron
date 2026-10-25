import {
  prestigeCards,
  prizes,
  promiseCardTypes,
  type CardEffect,
  type PromiseCardId,
} from "../../data";
import type { CommandHandler } from "../command-handler";
import type {
  ActorId,
  ApplyCommandResult,
  CardInstance,
  GameCommand,
  GameLogEntry,
  GameState,
  PendingDecision,
  PlayerId,
  ValidationError,
} from "../types";
import type {
  ConsentRequest,
  InterruptFrame,
  NegotiationState,
  PromiseCall,
  PromiseCardState,
  PromiseGrant,
  TransferItem,
} from "./negotiation.state";

// Negotiation (rulebook p.8): binding immediate transfers, promise cards, consent requests, and
// the interrupt mechanism that pauses a decision while another player answers.

// ---------------------------------------------------------------------------------------------
// Shared plumbing

type LogInput = {
  actor?: ActorId;
  type: string;
  summary: string;
  details?: unknown;
  timestamp: string;
  commandId?: string;
  rngRolls?: GameLogEntry["rngRolls"];
};

export function appendLog(state: GameState, input: LogInput): GameState {
  const entry: GameLogEntry = {
    id: `log-${state.log.length + 1}`,
    sequence: state.log.length + 1,
    timestamp: input.timestamp,
    turn: state.turn,
    phase: state.phase,
    actor: input.actor,
    type: input.type,
    summary: input.summary,
    details: input.details,
    commandId: input.commandId,
    rngRolls: input.rngRolls && input.rngRolls.length > 0 ? input.rngRolls : undefined,
  };

  return { ...state, updatedAt: input.timestamp, log: [...state.log, entry] };
}

export function okResult(state: GameState): ApplyCommandResult {
  return { ok: true, state, logEntry: state.log[state.log.length - 1] };
}

export function rejected(code: string, message: string, field?: string): ApplyCommandResult {
  return { ok: false, errors: [{ code, message, field }] };
}

function errorsResult(errors: ValidationError[]): ApplyCommandResult {
  return { ok: false, errors };
}

export function withNegotiation(state: GameState, update: Partial<NegotiationState>): GameState {
  return { ...state, negotiation: { ...state.negotiation, ...update } };
}

/** Allocate a unique id for a request, call or play. */
export function nextNegotiationId(state: GameState, prefix: string): { id: string; state: GameState } {
  const sequence = state.negotiation.sequence + 1;
  return { id: `${prefix}-${sequence}`, state: withNegotiation(state, { sequence }) };
}

function playerName(state: GameState, playerId: PlayerId): string {
  return state.players[playerId]?.name ?? playerId;
}

/** Once the game is over nobody may negotiate, call in promises or play blackmail (p.8). */
export function gameOverReason(state: GameState): string | undefined {
  return state.phase === "finalScoring"
    ? "The game is over: players may not negotiate, call in promises, or play blackmail (p.8)."
    : undefined;
}

// ---------------------------------------------------------------------------------------------
// Decision refreshers: anytime commands can change cash or holdings under a pending decision.

type DecisionRefresher = (state: GameState) => PendingDecision;

const decisionRefreshers = new Map<string, DecisionRefresher>();

/**
 * Register a function that rebuilds a pending decision's legal commands from current state.
 * Negotiation calls it after every transfer or call-in, so a decision never offers a purchase the
 * actor can no longer afford. Phase owners should register one for each step whose options depend
 * on cash or holdings.
 */
export function registerDecisionRefresher(step: string, refresher: DecisionRefresher): void {
  decisionRefreshers.set(step, refresher);
}

type StateRefresher = (state: GameState) => GameState;

const stateRefreshers = new Map<string, StateRefresher>();

/**
 * Like registerDecisionRefresher, for steps whose decision is rebuilt by re-running the phase's own
 * progress logic, which returns a whole state (e.g. Parliament's voting rounds).
 */
export function registerStateRefresher(step: string, refresher: StateRefresher): void {
  stateRefreshers.set(step, refresher);
}

type CommandDryRun = (state: GameState, command: GameCommand) => ApplyCommandResult;

let commandDryRun: CommandDryRun | undefined;

/** The dispatcher registers how to try a command without keeping the result (commands.ts). */
export function registerCommandDryRun(dryRun: CommandDryRun): void {
  commandDryRun = dryRun;
}

/**
 * Rebuild the pending decision after an anytime command changed cash or holdings. A step's own
 * refresher (if registered) recomputes its options, which can add newly affordable choices; then
 * every remaining option is tried and dropped if it would now be rejected, so a stale option can
 * never be applied. If nothing would survive, the original options are kept.
 */
export function refreshPendingDecision(state: GameState): GameState {
  const step = state.pendingDecision.step;
  const stateRefresher = stateRefreshers.get(step);
  const refresher = decisionRefreshers.get(step);
  const refreshed = stateRefresher
    ? stateRefresher(state)
    : refresher
      ? { ...state, pendingDecision: refresher(state) }
      : state;
  return pruneUnplayableOptions(refreshed);
}

function pruneUnplayableOptions(state: GameState): GameState {
  const decision = state.pendingDecision;
  if (!commandDryRun || decision.actor === "simultaneous" || decision.legalCommands.length === 0) {
    return state;
  }

  const playable = decision.legalCommands.filter((legal, index) => {
    try {
      const result = commandDryRun!(state, {
        id: `dry-run-${index}`,
        gameId: state.gameId,
        actorId: decision.actor,
        decisionId: decision.id,
        type: legal.type,
        payload: legal.payload ?? {},
        clientTimestamp: state.updatedAt,
      });
      return result.ok;
    } catch {
      // A throw means the option cannot be played now (e.g. its card was already used).
      return false;
    }
  });

  return playable.length === 0 || playable.length === decision.legalCommands.length
    ? state
    : { ...state, pendingDecision: { ...decision, legalCommands: playable } };
}

// ---------------------------------------------------------------------------------------------
// Interrupts: a response owed by another player before the interrupted decision continues.

export function activeInterrupt(state: GameState): InterruptFrame | undefined {
  return state.negotiation.interrupts[state.negotiation.interrupts.length - 1];
}

export function pushInterrupt(
  state: GameState,
  frame: InterruptFrame,
  decision: PendingDecision,
): GameState {
  return {
    ...withNegotiation(state, { interrupts: [...state.negotiation.interrupts, frame] }),
    pendingDecision: decision,
  };
}

/** Remove the top frame and put back (a refreshed copy of) the decision it interrupted. */
export function popInterrupt(state: GameState): GameState {
  const frame = activeInterrupt(state);
  if (!frame) return state;

  return refreshPendingDecision({
    ...withNegotiation(state, { interrupts: state.negotiation.interrupts.slice(0, -1) }),
    pendingDecision: frame.savedDecision,
  });
}

function replaceTopInterrupt(state: GameState, frame: InterruptFrame, decision: PendingDecision): GameState {
  return {
    ...withNegotiation(state, { interrupts: [...state.negotiation.interrupts.slice(0, -1), frame] }),
    pendingDecision: decision,
  };
}

// ---------------------------------------------------------------------------------------------
// Consent requests

/**
 * Called when every asked player has answered. `state.pendingDecision` is already restored to the
 * decision the request interrupted (or `resumeDecision`); return the state with whatever comes
 * next, including a new pending decision if the flow moves on.
 */
export type ConsentResolver = (state: GameState, request: ConsentRequest, accepted: boolean) => GameState;

const consentResolvers = new Map<string, ConsentResolver>();

export function registerConsentResolver(kind: string, resolver: ConsentResolver): void {
  consentResolvers.set(kind, resolver);
}

/**
 * Ask one or more players to consent before something happens, e.g. a President funding local
 * alliances (p.22), nepotism (p.14) or extra Debt (p.18). Players are asked one at a time in
 * `from` order; the first refusal ends the request. The pending decision at the time of the call
 * (or `resumeDecision`) is restored before the resolver runs. With nobody to ask, the resolver
 * runs immediately as accepted.
 *
 *   registerConsentResolver("co.allianceFunds", (state, request, accepted) => ...);
 *   return requestConsent(state, { kind: "co.allianceFunds", requestedBy, from: [president],
 *     prompt: "Fund the Sikhs from the Bombay treasury?", context: { allianceId } });
 */
export function requestConsent(
  state: GameState,
  input: {
    kind: string;
    requestedBy: PlayerId | "system";
    from: PlayerId[];
    prompt: string;
    context: unknown;
    resumeDecision?: PendingDecision;
  },
): GameState {
  const askOrder = [...new Set(input.from)].filter((playerId) => playerId !== input.requestedBy);
  const allocated = nextNegotiationId(state, "consent");
  const request: ConsentRequest = {
    id: allocated.id,
    kind: input.kind,
    requestedBy: input.requestedBy,
    askOrder,
    answers: {},
    prompt: input.prompt,
    context: input.context,
  };
  const resolver = consentResolvers.get(input.kind);
  if (!resolver) throw new Error(`No consent resolver registered for "${input.kind}".`);

  const savedDecision = input.resumeDecision ?? state.pendingDecision;
  if (askOrder.length === 0) {
    return resolver({ ...allocated.state, pendingDecision: savedDecision }, request, true);
  }

  const frame: InterruptFrame = { id: request.id, kind: "consent", request, savedDecision };
  return pushInterrupt(allocated.state, frame, consentDecision(allocated.state, request, askOrder[0]));
}

function consentDecision(state: GameState, request: ConsentRequest, playerId: PlayerId): PendingDecision {
  return {
    id: `decision-negotiation-${request.id}-${playerId}`,
    phase: state.phase,
    step: "negotiation.consent",
    actor: playerId,
    visibility: "public",
    prompt: request.prompt,
    legalCommands: [
      {
        type: "negotiation.respondToConsent",
        label: "Consent",
        payload: { requestId: request.id, accept: true },
      },
      {
        type: "negotiation.respondToConsent",
        label: "Refuse",
        payload: { requestId: request.id, accept: false },
      },
    ],
    canSave: true,
  };
}

export const respondToConsent: CommandHandler = (state, command) => {
  const frame = activeInterrupt(state);
  const payload = command.payload as { requestId?: unknown; accept?: unknown };
  if (
    !frame ||
    frame.kind !== "consent" ||
    state.pendingDecision.step !== "negotiation.consent" ||
    payload.requestId !== frame.request.id ||
    typeof payload.accept !== "boolean"
  ) {
    return rejected("ILLEGAL_CONSENT_RESPONSE", "There is no matching consent request to answer.", "payload");
  }

  const request = frame.request;
  const answeredBy = command.actorId as PlayerId;
  const answered: ConsentRequest = { ...request, answers: { ...request.answers, [answeredBy]: payload.accept } };
  let next = appendLog(state, {
    actor: answeredBy,
    type: payload.accept ? "negotiation.consentGiven" : "negotiation.consentRefused",
    summary: `${playerName(state, answeredBy)} ${payload.accept ? "consented" : "refused"}: ${request.prompt}`,
    details: { requestId: request.id, kind: request.kind },
    timestamp: command.clientTimestamp,
    commandId: command.id,
  });

  const remaining = answered.askOrder.filter((playerId) => answered.answers[playerId] === undefined);
  if (payload.accept && remaining.length > 0) {
    const updated: InterruptFrame = { ...frame, request: answered };
    return okResult(replaceTopInterrupt(next, updated, consentDecision(next, answered, remaining[0])));
  }

  const resolver = consentResolvers.get(request.kind);
  if (!resolver) throw new Error(`No consent resolver registered for "${request.kind}".`);
  next = resolver(popInterrupt(next), answered, payload.accept);
  return { ok: true, state: next, logEntry: next.log[next.log.length - 1] };
};

// ---------------------------------------------------------------------------------------------
// Golden rule (p.8): "something transferred cannot activate twice".

/** Record that an asset (enterprise, share, card) has produced its effect in the current phase. */
export function markActivated(state: GameState, assetIds: string[]): GameState {
  const current = state.negotiation.activations.filter((event) => event.turn === state.turn);
  return withNegotiation(state, {
    activations: [...current, ...assetIds.map((assetId) => ({ turn: state.turn, phase: state.phase, assetId }))],
  });
}

/** True if the asset already produced its effect this phase, whoever owned it then. */
export function isActivatedThisPhase(state: GameState, assetId: string): boolean {
  return state.negotiation.activations.some(
    (event) => event.turn === state.turn && event.phase === state.phase && event.assetId === assetId,
  );
}

/** True if the asset changed hands this turn, optionally only when given away by `from`. */
export function wasTransferredThisTurn(state: GameState, assetId: string, from?: PlayerId): boolean {
  return state.negotiation.transfers.some(
    (event) => event.turn === state.turn && event.assetId === assetId && (from === undefined || event.from === from),
  );
}

// ---------------------------------------------------------------------------------------------
// Transfers

/** Things p.8 says cannot be transferred, keyed by the name a caller might use. */
export const NON_TRANSFERABLE: Record<string, string> = {
  office: "Officeholders cannot be transferred (p.8).",
  writer: "Writers cannot be transferred (p.8).",
  officer: "Officers cannot be transferred (p.8).",
  officerInTraining: "Officers cannot be transferred (p.8).",
  commander: "Officers cannot be transferred (p.8).",
  prize: "Pieces on prizes cannot be transferred (p.8).",
  spouse: "Spouses cannot be transferred (p.8, p.12).",
  passedLaw: "Passed laws cannot be transferred (p.8).",
  playedBlackmail: "Played blackmail cards cannot be transferred (p.8, p.12).",
  primeMinister: "The Prime Minister dial cannot be transferred (p.8).",
  trophy: "Trophies cannot be transferred (p.8).",
  chairmanShare: "The Chairman cannot be transferred (p.8).",
};

const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));

function spouseEffects(state: GameState, playerId: PlayerId): CardEffect[] {
  return state.players[playerId].prestigeCards.flatMap(
    (card) => prestigeById.get(card.cardId)?.effects ?? [],
  );
}

/** A spouse can forbid holding blackmail, workshops, shipyards or Company shares (p.12). */
function forbiddenHolding(state: GameState, playerId: PlayerId, holding: string): string | undefined {
  const effect = spouseEffects(state, playerId).find(
    (candidate) => candidate.type === "forbidHolding" && candidate.holding === holding,
  );
  if (!effect) return undefined;
  const spouse = state.players[playerId].prestigeCards
    .map((card) => prestigeById.get(card.cardId))
    .find((card) => card?.effects.includes(effect));
  return `${playerName(state, playerId)} cannot hold ${holding === "companyShare" ? "Company shares" : `${holding}s`} because of ${spouse?.name ?? "their spouse"}.`;
}

function pendingCallPromiseIds(state: GameState): Set<string> {
  return new Set(
    state.negotiation.interrupts.flatMap((frame) =>
      frame.kind === "promiseChoice" ? frame.calls.map((call) => call.promiseId) : [],
    ),
  );
}

function assetIdOf(item: TransferItem): string | undefined {
  switch (item.kind) {
    case "enterprise":
      return item.enterpriseId;
    case "prestige":
    case "blackmail":
      return item.cardInstanceId;
    case "share":
      return item.shareId;
    case "promise":
      return item.promiseId;
    default:
      return undefined;
  }
}

export function validateTransfer(
  state: GameState,
  from: PlayerId,
  to: PlayerId,
  items: TransferItem[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const fail = (message: string) => errors.push({ code: "ILLEGAL_TRANSFER", message, field: "payload.items" });
  const giver = state.players[from];
  const receiver = state.players[to];

  if (!giver || !receiver) {
    fail("Transfers must be between two players in the game.");
    return errors;
  }
  if (from === to) fail("A player cannot transfer to themselves.");
  if (!Array.isArray(items) || items.length === 0) fail("Name at least one thing to transfer.");
  if (errors.length > 0) return errors;

  const seen = new Set<string>();
  let cash = 0;
  let sharesNeeded = 0;
  const prizesUsed: Record<string, number> = {};
  const lockedPromises = pendingCallPromiseIds(state);

  for (const item of items) {
    const kind = (item as { kind?: unknown }).kind;
    if (typeof kind !== "string") {
      fail("Every transfer item needs a kind.");
      continue;
    }
    if (NON_TRANSFERABLE[kind]) {
      fail(NON_TRANSFERABLE[kind]);
      continue;
    }

    const assetId = assetIdOf(item);
    if (assetId !== undefined) {
      if (seen.has(assetId)) fail(`"${assetId}" is listed twice.`);
      seen.add(assetId);
    }

    switch (item.kind) {
      case "cash":
        if (!Number.isInteger(item.amount) || item.amount <= 0) fail("Cash transfers must be a whole positive amount.");
        else cash += item.amount;
        break;
      case "enterprise": {
        const enterprise = giver.enterprises.find((candidate) => candidate.id === item.enterpriseId);
        if (!enterprise) {
          fail(`${giver.name} does not own enterprise "${item.enterpriseId}".`);
          break;
        }
        const blocked = forbiddenHolding(state, to, enterprise.type);
        if (blocked) fail(blocked);
        break;
      }
      case "prestige": {
        const instance = giver.prestigeCards.find((card) => card.id === item.cardInstanceId);
        const card = instance ? prestigeById.get(instance.cardId) : undefined;
        if (!instance || !card) fail(`${giver.name} does not hold prestige card "${item.cardInstanceId}".`);
        else if (!card.transferable) fail(NON_TRANSFERABLE.spouse);
        break;
      }
      case "blackmail": {
        const instance = giver.blackmailCards.find((card) => card.id === item.cardInstanceId);
        if (!instance) fail(`${giver.name} does not hold blackmail card "${item.cardInstanceId}".`);
        else if (!instance.facedown) fail(NON_TRANSFERABLE.playedBlackmail);
        else {
          const blocked = forbiddenHolding(state, to, "blackmail");
          if (blocked) fail(blocked);
        }
        break;
      }
      case "share": {
        const share = state.company.court.find((candidate) => candidate.id === item.shareId);
        if (!share || share.owner !== from) {
          fail(
            state.company.offices.chairman?.holder === from && !share
              ? NON_TRANSFERABLE.chairmanShare
              : `${giver.name} does not own Company share "${item.shareId}" in the Court.`,
          );
          break;
        }
        const blocked = forbiddenHolding(state, to, "companyShare");
        if (blocked) fail(blocked);
        if (item.fromPrizeId !== undefined) {
          prizesUsed[item.fromPrizeId] = (prizesUsed[item.fromPrizeId] ?? 0) + 1;
        } else {
          sharesNeeded += 1;
        }
        break;
      }
      case "promise": {
        const promise = state.negotiation.promiseCards.find((card) => card.id === item.promiseId);
        if (!promise || promise.holder !== from || promise.removedFromGame) {
          fail(`${giver.name} does not hold promise card "${item.promiseId}".`);
        } else if (lockedPromises.has(promise.id)) {
          fail("That promise card has been called in and is waiting for its guarantor.");
        }
        break;
      }
      default:
        fail(`"${kind}" cannot be transferred.`);
    }
  }

  if (cash > giver.cash) fail(`${giver.name} has only £${giver.cash}.`);

  // Receiving a share replaces the piece with one of the receiver's own family members (p.8);
  // with none in supply they must take one from a prize (p.13).
  if (sharesNeeded > receiver.familyMembers.supply) {
    fail(
      `${receiver.name} has no family member in supply for a Company share; name a prize to take one from (fromPrizeId).`,
    );
  }
  for (const [prizeId, count] of Object.entries(prizesUsed)) {
    if (!prizes.some((prize) => prize.id === prizeId)) fail(`Unknown prize "${prizeId}".`);
    else if ((receiver.familyMembers.prizes[prizeId] ?? 0) < count) {
      fail(`${receiver.name} has no family member on ${prizeId} to take.`);
    } else if (receiver.familyMembers.supply > 0) {
      fail(`${receiver.name} still has family members in supply; a piece may only come from a prize when supply is empty (p.13).`);
    }
  }

  return errors;
}

const ENTERPRISE_VICTORY_POINTS: Record<string, number> = { luxury: 2 };
const ENTERPRISE_WINDOWS: Record<string, number> = { luxury: 1 };

function setPrivateBlackmail(state: GameState, playerId: PlayerId, cards: CardInstance[]): GameState {
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...state.players[playerId], blackmailCards: cards } },
    hidden: {
      ...state.hidden,
      privateCards: { ...state.hidden.privateCards, [playerId]: cards.filter((card) => card.facedown) },
    },
  };
}

/** Move blackmail cards between play areas, keeping the owner-only identity list in step. */
export function moveBlackmailCard(
  state: GameState,
  from: PlayerId,
  to: PlayerId,
  cardInstanceId: string,
  facedown: boolean,
): GameState {
  const card = state.players[from].blackmailCards.find((candidate) => candidate.id === cardInstanceId);
  if (!card) throw new Error(`${from} does not hold blackmail card ${cardInstanceId}.`);
  const removed = setPrivateBlackmail(
    state,
    from,
    state.players[from].blackmailCards.filter((candidate) => candidate.id !== cardInstanceId),
  );
  return setPrivateBlackmail(removed, to, [...removed.players[to].blackmailCards, { ...card, facedown }]);
}

export function applyTransfer(state: GameState, from: PlayerId, to: PlayerId, items: TransferItem[]): GameState {
  let next = state;
  const update = (playerId: PlayerId, change: (player: GameState["players"][string]) => GameState["players"][string]) => {
    next = { ...next, players: { ...next.players, [playerId]: change(next.players[playerId]) } };
  };

  for (const item of items) {
    switch (item.kind) {
      case "cash":
        update(from, (player) => ({ ...player, cash: player.cash - item.amount }));
        update(to, (player) => ({ ...player, cash: player.cash + item.amount }));
        break;
      case "enterprise": {
        const enterprise = next.players[from].enterprises.find((candidate) => candidate.id === item.enterpriseId)!;
        const vp = ENTERPRISE_VICTORY_POINTS[enterprise.type] ?? 0;
        const windows = ENTERPRISE_WINDOWS[enterprise.type] ?? 0;
        update(from, (player) => ({
          ...player,
          enterprises: player.enterprises.filter((candidate) => candidate.id !== enterprise.id),
          victoryPoints: player.victoryPoints - vp,
          windows: player.windows - windows,
        }));
        update(to, (player) => ({
          ...player,
          enterprises: [...player.enterprises, enterprise],
          victoryPoints: player.victoryPoints + vp,
          windows: player.windows + windows,
        }));
        break;
      }
      case "prestige": {
        const instance = next.players[from].prestigeCards.find((card) => card.id === item.cardInstanceId)!;
        const card = prestigeById.get(instance.cardId);
        const vp = card?.victoryPoints ?? 0;
        const windows = card?.windowTaxIcons ?? 0;
        update(from, (player) => ({
          ...player,
          prestigeCards: player.prestigeCards.filter((candidate) => candidate.id !== instance.id),
          victoryPoints: player.victoryPoints - vp,
          windows: player.windows - windows,
        }));
        update(to, (player) => ({
          ...player,
          prestigeCards: [...player.prestigeCards, instance],
          victoryPoints: player.victoryPoints + vp,
          windows: player.windows + windows,
        }));
        break;
      }
      case "blackmail":
        next = moveBlackmailCard(next, from, to, item.cardInstanceId, true);
        break;
      case "share": {
        next = {
          ...next,
          company: {
            ...next.company,
            court: next.company.court.map((share) => (share.id === item.shareId ? { ...share, owner: to } : share)),
          },
        };
        update(from, (player) => ({
          ...player,
          familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 },
        }));
        if (item.fromPrizeId === undefined) {
          update(to, (player) => ({
            ...player,
            familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - 1 },
          }));
        } else {
          const prizeId = item.fromPrizeId;
          const prizeVp = prizes.find((prize) => prize.id === prizeId)?.victoryPoints ?? 0;
          update(to, (player) => ({
            ...player,
            victoryPoints: player.victoryPoints - prizeVp,
            familyMembers: {
              ...player.familyMembers,
              prizes: { ...player.familyMembers.prizes, [prizeId]: (player.familyMembers.prizes[prizeId] ?? 0) - 1 },
            },
          }));
        }
        break;
      }
      case "promise":
        next = withNegotiation(next, {
          promiseCards: next.negotiation.promiseCards.map((card) =>
            card.id === item.promiseId ? { ...card, holder: to } : card,
          ),
        });
        break;
    }
  }

  const movedAssets = items.map(assetIdOf).filter((assetId): assetId is string => assetId !== undefined);
  return withNegotiation(next, {
    transfers: [
      ...next.negotiation.transfers.filter((event) => event.turn === next.turn),
      ...movedAssets.map((assetId) => ({ turn: next.turn, phase: next.phase, assetId, from })),
    ],
  });
}

export function describeTransferItems(state: GameState, from: PlayerId, items: TransferItem[]): string {
  return items
    .map((item) => {
      switch (item.kind) {
        case "cash":
          return `£${item.amount}`;
        case "enterprise": {
          const enterprise = state.players[from].enterprises.find((candidate) => candidate.id === item.enterpriseId);
          return enterprise ? `a ${enterprise.type}` : "an enterprise";
        }
        case "prestige": {
          const instance = state.players[from].prestigeCards.find((card) => card.id === item.cardInstanceId);
          return prestigeById.get(instance?.cardId ?? "")?.name ?? "a prestige card";
        }
        case "blackmail":
          return "a face-down blackmail card";
        case "share":
          return "a Company share";
        case "promise": {
          const promise = state.negotiation.promiseCards.find((card) => card.id === item.promiseId);
          const type = promiseCardTypes.find((candidate) => candidate.id === promise?.type);
          return promise ? `${playerName(state, promise.guarantor)}'s "${type?.text ?? promise.type}" promise` : "a promise";
        }
        default:
          return "something";
      }
    })
    .join(", ");
}

function parseItems(value: unknown): TransferItem[] | undefined {
  return Array.isArray(value) ? (value as TransferItem[]) : undefined;
}

/** A one-sided transfer: the acting player gives things to another player. */
export const giveCommand: CommandHandler = (state, command) => {
  const over = gameOverReason(state);
  if (over) return rejected("GAME_OVER", over);

  const payload = command.payload as { to?: unknown; items?: unknown };
  const from = command.actorId as PlayerId;
  const to = typeof payload.to === "string" ? payload.to : "";
  const items = parseItems(payload.items) ?? [];
  const errors = validateTransfer(state, from, to, items);
  if (errors.length > 0) return errorsResult(errors);

  const summary = `${playerName(state, from)} gave ${describeTransferItems(state, from, items)} to ${playerName(state, to)}.`;
  const next = appendLog(applyTransfer(state, from, to, items), {
    actor: from,
    type: "negotiation.transfer",
    summary,
    details: { from, to, items },
    timestamp: command.clientTimestamp,
    commandId: command.id,
  });
  return okResult(refreshPendingDecision(next));
};

type TradeContext = { from: PlayerId; to: PlayerId; give: TransferItem[]; receive: TransferItem[] };

/** A two-sided deal: binding once the other player consents (p.8). */
export const proposeTradeCommand: CommandHandler = (state, command) => {
  const over = gameOverReason(state);
  if (over) return rejected("GAME_OVER", over);
  if (state.negotiation.interrupts.length > 0) {
    return rejected("RESPONSE_PENDING", "Another player's response is pending; resolve it before proposing a deal.");
  }

  const payload = command.payload as { to?: unknown; give?: unknown; receive?: unknown };
  const from = command.actorId as PlayerId;
  const to = typeof payload.to === "string" ? payload.to : "";
  const give = parseItems(payload.give) ?? [];
  const receive = parseItems(payload.receive) ?? [];
  if (give.length === 0 && receive.length === 0) {
    return rejected("ILLEGAL_TRANSFER", "A deal must move something.", "payload");
  }
  const errors = [
    ...(give.length > 0 ? validateTransfer(state, from, to, give) : []),
    ...(receive.length > 0 ? validateTransfer(state, to, from, receive) : []),
  ];
  if (errors.length > 0) return errorsResult(errors);

  const offer =
    `${playerName(state, from)} offers ${give.length > 0 ? describeTransferItems(state, from, give) : "nothing"}` +
    ` for ${receive.length > 0 ? describeTransferItems(state, to, receive) : "nothing"}.`;
  const logged = appendLog(state, {
    actor: from,
    type: "negotiation.tradeProposed",
    summary: offer,
    details: { from, to, give, receive },
    timestamp: command.clientTimestamp,
    commandId: command.id,
  });
  return okResult(
    requestConsent(logged, {
      kind: "negotiation.trade",
      requestedBy: from,
      from: [to],
      prompt: `${offer} Accept the deal?`,
      context: { from, to, give, receive } satisfies TradeContext,
    }),
  );
};

registerConsentResolver("negotiation.trade", (state, request, accepted) => {
  const { from, to, give, receive } = request.context as TradeContext;
  const timestamp = state.updatedAt;
  if (!accepted) {
    return appendLog(state, {
      actor: to,
      type: "negotiation.tradeRefused",
      summary: `${playerName(state, to)} refused the deal.`,
      timestamp,
    });
  }

  const errors = [
    ...(give.length > 0 ? validateTransfer(state, from, to, give) : []),
    ...(receive.length > 0 ? validateTransfer(state, to, from, receive) : []),
  ];
  if (errors.length > 0) {
    return appendLog(state, {
      actor: to,
      type: "negotiation.tradeFailed",
      summary: `The deal could not be completed: ${errors.map((error) => error.message).join(" ")}`,
      timestamp,
    });
  }

  const summary = `Deal done: ${playerName(state, from)} gave ${give.length > 0 ? describeTransferItems(state, from, give) : "nothing"}; ${playerName(state, to)} gave ${receive.length > 0 ? describeTransferItems(state, to, receive) : "nothing"}.`;
  let next = give.length > 0 ? applyTransfer(state, from, to, give) : state;
  next = receive.length > 0 ? applyTransfer(next, to, from, receive) : next;
  return refreshPendingDecision(
    appendLog(next, { actor: to, type: "negotiation.tradeCompleted", summary, details: request.context, timestamp }),
  );
});

// ---------------------------------------------------------------------------------------------
// Promise cards (p.8 and the card backs)

const promiseTypeById = new Map(promiseCardTypes.map((type) => [type.id, type]));

export function promiseCardText(type: PromiseCardId): string {
  return promiseTypeById.get(type)?.text ?? type;
}

export function promiseCardsHeldBy(state: GameState, playerId: PlayerId): PromiseCardState[] {
  return state.negotiation.promiseCards.filter((card) => card.holder === playerId && !card.removedFromGame);
}

/** Lady Newcome (p.12): remove a family's promise card from the game, whoever holds it. */
export function removePromiseFromGame(state: GameState, guarantor: PlayerId, type: PromiseCardId): GameState {
  return withNegotiation(state, {
    promiseCards: state.negotiation.promiseCards.map((card) =>
      card.guarantor === guarantor && card.type === type ? { ...card, removedFromGame: true, holder: guarantor } : card,
    ),
  });
}

/**
 * Company Operation records each officeholder bonus it pays (payOfficeholderBonus), so "Take my
 * officeholder's bonus" can claim it. Loot shares are not recorded (card back).
 */
export function recordOfficeholderBonus(
  state: GameState,
  input: { officeId: string; playerId: PlayerId; amount: number },
): GameState {
  if (input.amount <= 0) return state;
  return withNegotiation(state, {
    officeholderBonuses: [
      ...state.negotiation.officeholderBonuses.filter((record) => record.turn === state.turn),
      { turn: state.turn, officeId: input.officeId, playerId: input.playerId, amount: input.amount, taken: false },
    ],
  });
}

/** A Governor removed by catastrophic failure forfeits this turn's bonus to promise holders (card back). */
export function voidOfficeholderBonuses(state: GameState, officeId: string): GameState {
  return withNegotiation(state, {
    officeholderBonuses: state.negotiation.officeholderBonuses.map((record) =>
      record.turn === state.turn && record.officeId === officeId ? { ...record, taken: true } : record,
    ),
  });
}

function claimableBonuses(state: GameState, guarantor: PlayerId): Array<{ officeId: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const record of state.negotiation.officeholderBonuses) {
    // A recorded bonus has been paid, so its office has acted (card back: "after an office has acted").
    if (record.turn !== state.turn || record.taken || record.playerId !== guarantor) continue;
    totals.set(record.officeId, (totals.get(record.officeId) ?? 0) + record.amount);
  }
  return [...totals].map(([officeId, amount]) => ({ officeId, amount }));
}

function activeGrants(state: GameState, type: PromiseCardId): PromiseGrant[] {
  return state.negotiation.promiseGrants.filter(
    (grant) => grant.type === type && grant.turn === state.turn && grant.phase === state.phase && !grant.used,
  );
}

/**
 * Guarantors whose nepotism consent the hirer holds through a called-in promise this Hiring phase.
 * Not usable for Commanders or the Chairman election (card back).
 * Hiring treats these players as consenting (nepotismConsentNeededFrom).
 */
export function nepotismConsentGuarantors(state: GameState, hirer: PlayerId): PlayerId[] {
  return activeGrants(state, "my-consent-for-nepotism")
    .filter((grant) => grant.holder === hirer)
    .map((grant) => grant.guarantor);
}

/**
 * Families whose enterprises `voter` may vote with this Parliament (called-in promise), including
 * against the law even if the guarantor is Prime Minister (card back).
 * Parliament adds these enterprises to the voter's cards (availableVoteCards) for this phase.
 */
export function enterpriseVoteGuarantors(state: GameState, voter: PlayerId): PlayerId[] {
  return activeGrants(state, "vote-with-my-enterprises")
    .filter((grant) => grant.holder === voter)
    .map((grant) => grant.guarantor);
}

/**
 * The player who takes `guarantor`'s London Season Display pick this season, if a promise was called in.
 * The London Season gives this player the guarantor's pick (prestigeDecision) and uses the grant.
 */
export function prestigePickTakenBy(state: GameState, guarantor: PlayerId): PlayerId | undefined {
  return activeGrants(state, "take-my-card-from-london-season-display").find((grant) => grant.guarantor === guarantor)
    ?.holder;
}

export function promiseGrantFor(state: GameState, type: PromiseCardId, holder: PlayerId, guarantor: PlayerId): PromiseGrant | undefined {
  return activeGrants(state, type).find((grant) => grant.holder === holder && grant.guarantor === guarantor);
}

export function usePromiseGrant(state: GameState, grantId: string): GameState {
  return withNegotiation(state, {
    promiseGrants: state.negotiation.promiseGrants.map((grant) => (grant.id === grantId ? { ...grant, used: true } : grant)),
  });
}

const GRANT_PHASE: Partial<Record<PromiseCardId, GameState["phase"]>> = {
  "take-my-officeholders-bonus": "companyOperation",
  "vote-with-my-enterprises": "parliament",
  "my-consent-for-nepotism": "hiring",
  "take-my-card-from-london-season-display": "londonSeason",
};

export type PromiseCallOption = {
  promiseId: string;
  label: string;
  option: Record<string, unknown>;
};

/** Concrete ways `holder` may call in each promise they hold right now; used by the UI and harness. */
export function promiseCallOptions(state: GameState, holder: PlayerId): PromiseCallOption[] {
  if (gameOverReason(state)) return [];
  const locked = pendingCallPromiseIds(state);
  const options: PromiseCallOption[] = [];

  for (const card of promiseCardsHeldBy(state, holder)) {
    if (card.guarantor === holder || locked.has(card.id)) continue;
    const guarantor = playerName(state, card.guarantor);
    const requiredPhase = GRANT_PHASE[card.type];
    if (requiredPhase && state.phase !== requiredPhase) continue;

    switch (card.type) {
      case "take-up-to-2-from-me":
        if (state.players[card.guarantor].cash <= 0) break;
        for (const amount of [1, 2]) {
          options.push({ promiseId: card.id, label: `Take £${amount} from ${guarantor}`, option: { amount } });
        }
        break;
      case "take-my-officeholders-bonus":
        for (const bonus of claimableBonuses(state, card.guarantor)) {
          options.push({
            promiseId: card.id,
            label: `Take ${guarantor}'s £${bonus.amount} bonus from ${bonus.officeId}`,
            option: { officeId: bonus.officeId },
          });
        }
        break;
      default:
        if (!promiseGrantFor(state, card.type, holder, card.guarantor)) {
          options.push({ promiseId: card.id, label: `Call in ${guarantor}'s "${promiseCardText(card.type)}"`, option: {} });
        }
    }
  }

  return options;
}

function callAmount(state: GameState, card: PromiseCardState, option: Record<string, unknown>): number | undefined {
  if (card.type === "take-up-to-2-from-me") {
    return option.amount === 1 || option.amount === 2 ? option.amount : undefined;
  }
  if (card.type === "take-my-officeholders-bonus") {
    return claimableBonuses(state, card.guarantor).find((bonus) => bonus.officeId === option.officeId)?.amount;
  }
  return 0;
}

/** Return a used promise card to its guarantor (assumption: called-in cards go home, p.8). */
function returnPromise(state: GameState, promiseId: string): GameState {
  return withNegotiation(state, {
    promiseCards: state.negotiation.promiseCards.map((card) =>
      card.id === promiseId ? { ...card, holder: card.guarantor } : card,
    ),
  });
}

function payCall(state: GameState, call: PromiseCall, timestamp: string): GameState {
  const card = state.negotiation.promiseCards.find((candidate) => candidate.id === call.promiseId)!;
  const paid = Math.min(call.amount, state.players[card.guarantor].cash);
  let next = applyTransfer(state, card.guarantor, call.holder, paid > 0 ? [{ kind: "cash", amount: paid }] : []);
  if (call.officeId) {
    next = withNegotiation(next, {
      officeholderBonuses: next.negotiation.officeholderBonuses.map((record) =>
        record.turn === next.turn && record.officeId === call.officeId && record.playerId === card.guarantor
          ? { ...record, taken: true }
          : record,
      ),
    });
  }
  next = returnPromise(next, card.id);
  return appendLog(next, {
    actor: card.guarantor,
    type: "negotiation.promiseFulfilled",
    summary: `${playerName(next, card.guarantor)} paid ${playerName(next, call.holder)} £${paid} for "${promiseCardText(card.type)}".`,
    details: { call, paid },
    timestamp,
  });
}

function promiseChoiceDecision(state: GameState, guarantor: PlayerId, calls: PromiseCall[]): PendingDecision {
  return {
    id: `decision-negotiation-promises-${guarantor}-${state.negotiation.sequence}`,
    phase: state.phase,
    step: "negotiation.choosePromise",
    actor: guarantor,
    visibility: "public",
    prompt: `${playerName(state, guarantor)} cannot fulfil every promise called in (£${state.players[guarantor].cash} available). Choose which to fulfil.`,
    legalCommands: [
      ...calls.map((call) => ({
        type: "negotiation.fulfilPromise",
        label: `Pay ${playerName(state, call.holder)} up to £${call.amount}`,
        payload: { callId: call.id },
      })),
      { type: "negotiation.finishPromises", label: "Fulfil no more", payload: {} },
    ],
    canSave: true,
  };
}

/**
 * Call in one or more promise cards at once. Promises that only grant a right take effect at once.
 * Cash promises are paid immediately when the guarantor can cover them all; otherwise the guarantor
 * chooses which to fulfil, and calls made meanwhile against the same guarantor join that choice (p.8).
 */
export const callInPromisesCommand: CommandHandler = (state, command) => {
  const over = gameOverReason(state);
  if (over) return rejected("GAME_OVER", over);

  const holder = command.actorId as PlayerId;
  const payload = command.payload as { calls?: unknown };
  const requested = Array.isArray(payload.calls)
    ? (payload.calls as Array<{ promiseId?: unknown; option?: unknown }>)
    : [];
  if (requested.length === 0) return rejected("ILLEGAL_PROMISE_CALL", "Name at least one promise to call in.", "payload.calls");

  const legal = promiseCallOptions(state, holder);
  let next = state;
  const cashCalls: Array<{ call: PromiseCall; guarantor: PlayerId }> = [];
  const seen = new Set<string>();

  for (const request of requested) {
    const option = (request.option ?? {}) as Record<string, unknown>;
    const card = state.negotiation.promiseCards.find((candidate) => candidate.id === request.promiseId);
    const isLegal = legal.some(
      (candidate) => candidate.promiseId === request.promiseId && JSON.stringify(candidate.option) === JSON.stringify(option),
    );
    if (!card || !isLegal || seen.has(card.id)) {
      return rejected("ILLEGAL_PROMISE_CALL", `Promise "${String(request.promiseId)}" cannot be called in like that now.`, "payload.calls");
    }
    seen.add(card.id);

    const amount = callAmount(state, card, option) ?? 0;
    if (card.type === "take-up-to-2-from-me" || card.type === "take-my-officeholders-bonus") {
      const allocated = nextNegotiationId(next, "call");
      next = allocated.state;
      cashCalls.push({
        guarantor: card.guarantor,
        call: {
          id: allocated.id,
          promiseId: card.id,
          holder,
          amount,
          officeId: typeof option.officeId === "string" ? option.officeId : undefined,
        },
      });
      continue;
    }

    const allocated = nextNegotiationId(next, "grant");
    next = returnPromise(
      withNegotiation(allocated.state, {
        promiseGrants: [
          ...allocated.state.negotiation.promiseGrants.filter((grant) => grant.turn === allocated.state.turn),
          { id: allocated.id, type: card.type, holder, guarantor: card.guarantor, turn: next.turn, phase: next.phase, used: false },
        ],
      }),
      card.id,
    );
    next = appendLog(next, {
      actor: holder,
      type: "negotiation.promiseCalledIn",
      summary: `${playerName(next, holder)} called in ${playerName(next, card.guarantor)}'s "${promiseCardText(card.type)}".`,
      details: { promiseId: card.id },
      timestamp: command.clientTimestamp,
      commandId: command.id,
    });
  }

  const byGuarantor = new Map<PlayerId, PromiseCall[]>();
  for (const { guarantor, call } of cashCalls) {
    byGuarantor.set(guarantor, [...(byGuarantor.get(guarantor) ?? []), call]);
  }

  for (const [guarantor, calls] of byGuarantor) {
    next = appendLog(next, {
      actor: holder,
      type: "negotiation.promiseCalledIn",
      summary: `${playerName(next, holder)} called in ${calls.length} of ${playerName(next, guarantor)}'s promises for cash.`,
      details: { calls },
      timestamp: command.clientTimestamp,
      commandId: command.id,
    });

    const frame = activeInterrupt(next);
    if (frame?.kind === "promiseChoice" && frame.guarantor === guarantor) {
      const merged: InterruptFrame = { ...frame, calls: [...frame.calls, ...calls] };
      next = replaceTopInterrupt(next, merged, promiseChoiceDecision(next, guarantor, merged.calls));
      continue;
    }

    const owed = calls.reduce((total, call) => total + call.amount, 0);
    if (calls.length === 1 || owed <= next.players[guarantor].cash) {
      for (const call of calls) next = payCall(next, call, command.clientTimestamp);
      continue;
    }

    if (next.negotiation.interrupts.length > 0) {
      return rejected("RESPONSE_PENDING", "Another player's response is pending; resolve it before calling in these promises.");
    }
    const choice: InterruptFrame = { id: `choice-${guarantor}-${next.negotiation.sequence}`, kind: "promiseChoice", guarantor, calls, savedDecision: next.pendingDecision };
    next = pushInterrupt(next, choice, promiseChoiceDecision(next, guarantor, calls));
  }

  return okResult(activeInterrupt(next) ? next : refreshPendingDecision(next));
};

function finishPromiseChoice(state: GameState, timestamp: string): GameState {
  const frame = activeInterrupt(state);
  if (frame?.kind !== "promiseChoice") return state;
  const unpaid = frame.calls.length;
  const next = popInterrupt(state);
  return unpaid > 0
    ? appendLog(next, {
        actor: frame.guarantor,
        type: "negotiation.promisesUnfulfilled",
        summary: `${playerName(next, frame.guarantor)} could not fulfil ${unpaid} promise${unpaid === 1 ? "" : "s"}; the card${unpaid === 1 ? " stays" : "s stay"} with ${unpaid === 1 ? "its holder" : "their holders"}.`,
        timestamp,
      })
    : next;
}

export const fulfilPromiseCommand: CommandHandler = (state, command) => {
  const frame = activeInterrupt(state);
  const callId = (command.payload as { callId?: unknown }).callId;
  const call = frame?.kind === "promiseChoice" ? frame.calls.find((candidate) => candidate.id === callId) : undefined;
  if (!frame || frame.kind !== "promiseChoice" || !call) {
    return rejected("ILLEGAL_PROMISE_CHOICE", "That promise is not waiting to be fulfilled.", "payload.callId");
  }

  let next = payCall(state, call, command.clientTimestamp);
  const remaining = frame.calls.filter((candidate) => candidate.id !== call.id);
  const updated: InterruptFrame = { ...frame, calls: remaining };
  next = replaceTopInterrupt(next, updated, promiseChoiceDecision(next, frame.guarantor, remaining));
  if (remaining.length === 0 || next.players[frame.guarantor].cash === 0) {
    next = finishPromiseChoice(next, command.clientTimestamp);
  }
  return okResult(next);
};

export const finishPromisesCommand: CommandHandler = (state, command) => {
  const frame = activeInterrupt(state);
  if (frame?.kind !== "promiseChoice") return rejected("ILLEGAL_PROMISE_CHOICE", "No promise choice is pending.");
  const next = finishPromiseChoice(state, command.clientTimestamp);
  return { ok: true, state: next, logEntry: next.log[next.log.length - 1] };
};

// ---------------------------------------------------------------------------------------------
// Command maps

/** Anytime commands: spread into phases/anytime.ts. */
export const negotiationAnytimeCommandHandlers: Record<string, CommandHandler> = {
  "negotiation.give": giveCommand,
  "negotiation.proposeTrade": proposeTradeCommand,
  "negotiation.callInPromises": callInPromisesCommand,
};

/** Responses owed through a pending decision; composed by the dispatcher in ../commands.ts. */
export const negotiationCommandHandlers: Record<string, CommandHandler> = {
  "negotiation.respondToConsent": respondToConsent,
  "negotiation.fulfilPromise": fulfilPromiseCommand,
  "negotiation.finishPromises": finishPromisesCommand,
};
