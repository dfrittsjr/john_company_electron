import type { CommandHandler } from "../command-handler";
import { enterpriseDecks, familyActions, lawsById, prizes } from "../../data";
import type { EnterpriseCardDefinition, LawExtraAction } from "../../data";
import { chairmanTitleHolder, playerForbidsHolding } from "../selectors";
import type {
  ActorId,
  ApplyCommandResult,
  EnterpriseInstance,
  FamilyActionId,
  GameCommand,
  GameState,
  LegalCommand,
  PendingDecision,
  PlayerId,
  PlayerState,
  PresidencyId,
  ShareInstance,
  StockExchangeSlot,
  ValidationError,
} from "../types";
import type { FamilyState, FamilyTurnStage, FamilyTurnState } from "./family.state";
import { startHiringPhase } from "./hiring";
import { registerDecisionRefresher } from "./negotiation";
import { createCommandLogEntry } from "./shared";

// The Family phase (rulebook pp.13-14). Starting with the Chairman and going clockwise, each
// family takes one action, possibly twice if their opportunity marker is already on it, then any
// extra action a passed law grants. After everyone has acted, new Company shares are created.

type RealFamilyActionId =
  | "enlist-writer"
  | "enlist-officer"
  | "seek-share"
  | "purchase-shipyard"
  | "purchase-workshop"
  | "purchase-luxury"
  | "no-action";

type EnterpriseType = EnterpriseInstance["type"];

/** Which part of a turn an action is taken in; costs and restrictions differ between them. */
type ActionStage = "main" | "repeat" | "lawExtraAction";

type FamilyActionPayload = {
  action: RealFamilyActionId;
  presidency?: PresidencyId;
  slotId?: string;
  /** Out of family pieces: the prize the piece comes from (p.13). */
  fromPrize?: string;
  /** Seek Share at £1 using another family's Stock Broker, which needs its owner's permission. */
  stockBroker?: "request";
};

type FinishFamilyActionPayload = {
  action: RealFamilyActionId;
};

type ExtraWriterPayload = {
  presidency: PresidencyId;
  fromPrize?: string;
};

type StockBrokerConsentPayload = {
  accepted: boolean;
};

type FamilyActionApplyResult =
  | { ok: true; state: GameState; effects: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

const PRESIDENCIES: PresidencyId[] = ["Bombay", "Madras", "Bengal"];

const TURN_STAGES: FamilyTurnStage[] = [
  "extraWriterAfterMain",
  "repeat",
  "extraWriterAfterRepeat",
  "lawExtraAction",
];

const FAMILY_ACTION_LABELS = new Map<string, string>(familyActions.map((action) => [action.id, action.label]));

const ENTERPRISE_ACTIONS: Record<EnterpriseType, RealFamilyActionId> = {
  shipyard: "purchase-shipyard",
  workshop: "purchase-workshop",
  luxury: "purchase-luxury",
};

/** Spouses whose restrictions remove a family action from the main and repeat choices (p.12). */
const SPOUSE_FORBIDDEN_ACTIONS: Record<string, RealFamilyActionId[]> = {
  "mr-rochester": ["enlist-writer"],
  "william-collins": ["enlist-officer"],
};

/** Spouses who may not own something; these block the action even as a law's extra action. */
const SPOUSE_FORBIDDEN_HOLDINGS: Record<string, RealFamilyActionId[]> = {
  "john-thorpe": ["purchase-workshop"],
  "violet-effingham": ["purchase-shipyard"],
  "joseph-sedley": ["seek-share"],
};

// ---------------------------------------------------------------------------------------------
// Phase flow
// ---------------------------------------------------------------------------------------------

/**
 * Begin the Family phase. Turn order starts with the player holding the Chairman title (the
 * former Chairman while the office is vacant) and proceeds clockwise (p.13).
 */
export function startFamilyPhase(state: GameState): GameState {
  const humans = state.seatingOrder.filter((playerId) => !state.players[playerId].isCrown);
  const first = chairmanTitleHolder(state);
  const startIndex = first && humans.includes(first) ? humans.indexOf(first) : 0;
  const order = [...humans.slice(startIndex), ...humans.slice(0, startIndex)];
  const family: FamilyState = {
    order,
    index: 0,
    extraWriterUsedBy: [],
    stockBrokerRefused: [],
  };

  return beginFamilyTurn({ ...state, phase: "family", family }, 0);
}

function beginFamilyTurn(state: GameState, index: number): GameState {
  const playerId = state.family.order[index];
  if (!playerId) return endFamilyPhase({ ...state, family: { ...state.family, index, turn: undefined } });

  const player = state.players[playerId];
  const turn: FamilyTurnState = {
    playerId,
    markerAtStart: effectiveOpportunityMarker(player),
    resolvedStages: [],
  };
  const next: GameState = { ...state, family: { ...state.family, index, turn } };

  return withDecision(next, createMainActionDecision(next, playerId));
}

function createMainActionDecision(state: GameState, playerId: PlayerId): PendingDecision {
  return {
    id: `decision-family-choose-action-turn-${state.turn}-${playerId}`,
    phase: "family",
    step: "family.chooseAction",
    actor: playerId,
    visibility: "private",
    prompt: "Choose a family action.",
    legalCommands: createFamilyActionCommands(state, playerId),
    canSave: true,
  };
}

/** Offer the next follow-up the acting player is entitled to, or end their turn. */
function continueFamilyTurn(state: GameState): GameState {
  const turn = state.family.turn;
  if (!turn) return state;

  for (const stage of TURN_STAGES) {
    if (turn.resolvedStages.includes(stage)) continue;

    const decision = createStageDecision(state, turn, stage);
    if (decision) return withDecision(state, decision);
  }

  return finishFamilyTurn(state);
}

function createStageDecision(
  state: GameState,
  turn: FamilyTurnState,
  stage: FamilyTurnStage,
): PendingDecision | undefined {
  const playerId = turn.playerId;

  switch (stage) {
    case "extraWriterAfterMain":
      return turn.mainAction === "enlist-writer"
        ? createExtraWriterDecision(state, playerId, stage)
        : undefined;
    case "extraWriterAfterRepeat":
      return turn.repeatAction === "enlist-writer"
        ? createExtraWriterDecision(state, playerId, stage)
        : undefined;
    case "repeat": {
      if (!canRepeatMainAction(turn)) return undefined;
      const commands = createActionOptions(state, playerId, "repeat", turn.mainAction);
      if (commands.length === 0) return undefined;

      return {
        id: `decision-family-repeat-action-turn-${state.turn}-${playerId}-${turn.mainAction}`,
        phase: "family",
        step: "family.chooseRepeatAction",
        actor: playerId,
        visibility: "private",
        prompt: `Your opportunity marker was on ${familyActionLabel(turn.mainAction ?? "")}: take it a second time?`,
        legalCommands: [...commands, createFinishFamilyActionCommand(turn.mainAction as RealFamilyActionId)],
        canSave: true,
      };
    }
    case "lawExtraAction": {
      const extra = currentLawExtraAction(state);
      if (!extra || !lawExtraActionAllowed(turn, extra.action)) return undefined;
      const commands = createActionOptions(state, playerId, "lawExtraAction", extra.action.familyAction);
      if (commands.length === 0) return undefined;

      return {
        id: `decision-family-extra-action-turn-${state.turn}-${playerId}`,
        phase: "family",
        step: "family.chooseExtraAction",
        actor: playerId,
        visibility: "private",
        prompt: `${extra.lawName}: ${extra.action.text}`,
        legalCommands: [
          ...commands,
          {
            type: "family.skipExtraAction",
            label: "Skip the extra action",
            description: `Do not use the ${extra.lawName} extra action this turn.`,
            payload: {},
          },
        ],
        canSave: true,
      };
    }
  }
}

// After an anytime transfer (p.8) the actor's cash or holdings may have changed: rebuild the
// Family options so newly affordable actions appear and unaffordable ones disappear.
registerDecisionRefresher("family.chooseAction", (state) => {
  const actor = state.pendingDecision.actor;
  return actor === "system" || actor === "simultaneous" ? state.pendingDecision : createMainActionDecision(state, actor);
});

for (const [step, stage, keep] of [
  ["family.chooseRepeatAction", "repeat", "family.finishAction"],
  ["family.chooseExtraAction", "lawExtraAction", "family.skipExtraAction"],
] as const) {
  registerDecisionRefresher(step, (state) => {
    const turn = state.family.turn;
    const rebuilt = turn ? createStageDecision(state, turn, stage) : undefined;
    return (
      rebuilt ?? {
        ...state.pendingDecision,
        legalCommands: state.pendingDecision.legalCommands.filter((command) => command.type === keep),
      }
    );
  });
}

function createExtraWriterDecision(
  state: GameState,
  playerId: PlayerId,
  stage: FamilyTurnStage,
): PendingDecision | undefined {
  if (!extraWriterAvailable(state, playerId)) return undefined;

  const commands: LegalCommand[] = [];
  for (const source of pieceSources(state.players[playerId])) {
    for (const presidency of PRESIDENCIES) {
      commands.push({
        type: "family.placeExtraWriter",
        label: `Extra writer (${presidency})${sourceLabel(source)}`,
        description: `Four or more offices are vacant: place one more writer in ${presidency}.`,
        payload: withSource({ presidency }, source) satisfies ExtraWriterPayload,
      });
    }
  }

  return {
    id: `decision-family-extra-writer-turn-${state.turn}-${playerId}-${stage}`,
    phase: "family",
    step: "family.chooseExtraWriter",
    actor: playerId,
    visibility: "private",
    prompt: `${vacantOfficeCount(state)} offices are vacant, so you may place one additional writer this turn.`,
    legalCommands: [
      ...commands,
      {
        type: "family.declineExtraWriter",
        label: "No extra writer",
        description: "Do not place the additional writer now.",
        payload: {},
      },
    ],
    canSave: true,
  };
}

function finishFamilyTurn(state: GameState): GameState {
  const turn = state.family.turn;
  if (!turn) return state;

  const player = state.players[turn.playerId];
  // The marker goes on the action chosen; after No Action it goes to the supply (p.13).
  // Lady Glencora removes it from the game.
  const marker: PlayerState["opportunityMarker"] =
    turn.markerAtStart === "removed"
      ? "removed"
      : turn.mainAction === "no-action" || !turn.mainAction
        ? "supply"
        : turn.mainAction;
  const next: GameState = {
    ...state,
    players: { ...state.players, [player.id]: { ...player, opportunityMarker: marker } },
    family: { ...state.family, turn: undefined },
  };

  return beginFamilyTurn(next, state.family.index + 1);
}

function endFamilyPhase(state: GameState): GameState {
  return startHiringPhase(resolveNewCompanyShares(state));
}

function withDecision(state: GameState, pendingDecision: PendingDecision): GameState {
  const turn = state.family.turn;
  const stage = stageForStep(pendingDecision.step, turn);

  return {
    ...state,
    phase: pendingDecision.phase,
    pendingDecision,
    family: turn && stage ? { ...state.family, turn: { ...turn, currentStage: stage } } : state.family,
  };
}

function stageForStep(step: string, turn: FamilyTurnState | undefined): FamilyTurnStage | undefined {
  if (!turn) return undefined;
  if (step === "family.chooseRepeatAction") return "repeat";
  if (step === "family.chooseExtraAction") return "lawExtraAction";
  if (step === "family.chooseExtraWriter") {
    return turn.resolvedStages.includes("extraWriterAfterMain") ? "extraWriterAfterRepeat" : "extraWriterAfterMain";
  }

  return undefined;
}

function resolveStage(state: GameState, stage: FamilyTurnStage, patch: Partial<FamilyTurnState> = {}): GameState {
  const turn = state.family.turn;
  if (!turn) return state;

  return {
    ...state,
    family: {
      ...state.family,
      turn: { ...turn, ...patch, resolvedStages: [...new Set([...turn.resolvedStages, stage])] },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Legal commands
// ---------------------------------------------------------------------------------------------

/** Main Family action choices for a player (p.13). Offers No Action only when nothing else is legal. */
export function createFamilyActionCommands(state: GameState, actorId: ActorId): LegalCommand[] {
  if (actorId === "system") return [];

  const actor = state.players[actorId];
  if (!actor || actor.isCrown) return [];

  const commands = createActionOptions(state, actorId, "main");
  if (commands.length > 0) return commands;

  return [
    {
      type: "family.chooseAction",
      label: "No Action",
      description: "No legal Family action is available; your opportunity marker goes to your supply.",
      payload: { action: "no-action" } satisfies FamilyActionPayload,
    },
  ];
}

function createActionOptions(
  state: GameState,
  playerId: PlayerId,
  stage: ActionStage,
  onlyAction?: FamilyActionId,
): LegalCommand[] {
  const player = state.players[playerId];
  const commandType = stage === "lawExtraAction" ? "family.chooseExtraAction" : "family.chooseAction";
  const allowed = (action: RealFamilyActionId) =>
    (!onlyAction || onlyAction === action) && !isActionForbidden(player, action, stage);
  const commands: LegalCommand[] = [];
  const sources = pieceSources(player);

  if (allowed("enlist-writer")) {
    for (const source of sources) {
      for (const presidency of PRESIDENCIES) {
        commands.push({
          type: commandType,
          label: `Enlist Writer (${presidency})${sourceLabel(source)}`,
          description: `Place one family member in the ${presidency} Writers box.`,
          payload: withSource({ action: "enlist-writer", presidency }, source) satisfies FamilyActionPayload,
        });
      }
    }
  }

  if (allowed("enlist-officer")) {
    for (const source of sources) {
      commands.push({
        type: commandType,
        label: `Enlist Officer${sourceLabel(source)}`,
        description: "Place one family member in the Officers-in-Training box.",
        payload: withSource({ action: "enlist-officer" }, source) satisfies FamilyActionPayload,
      });
    }
  }

  if (allowed("seek-share")) {
    commands.push(...createSeekShareOptions(state, player, commandType, sources));
  }

  for (const type of ["shipyard", "workshop", "luxury"] as const) {
    const action = ENTERPRISE_ACTIONS[type];
    if (!allowed(action)) continue;

    const card = availableEnterpriseCard(state, type);
    const cost = enterprisePurchaseCost(state, type, stage);
    if (!card || player.cash < cost) continue;

    commands.push({
      type: commandType,
      label: `${FAMILY_ACTION_LABELS.get(action) ?? familyActionLabel(action)} (£${cost})`,
      description: `Pay £${cost} and take one ${type}.`,
      payload: { action } satisfies FamilyActionPayload,
    });
  }

  return commands;
}

function createSeekShareOptions(
  state: GameState,
  player: PlayerState,
  commandType: string,
  sources: Array<string | undefined>,
): LegalCommand[] {
  const commands: LegalCommand[] = [];
  // Joseph Sedley (#15): "You may no longer seek ... Company shares."
  if (playerForbidsHolding(state, player.id, "companyShare")) return commands;
  const ownsStockBroker = ownsPrestigeCard(player, "stock-broker");
  const brokerOwner = prestigeCardOwner(state, "stock-broker");
  const canRequestBroker =
    brokerOwner !== undefined &&
    brokerOwner !== player.id &&
    !state.family.stockBrokerRefused.includes(player.id) &&
    player.cash >= 1;

  for (const source of sources) {
    for (const slot of state.company.stockExchange) {
      if (slot.share) continue;

      // Stock Broker: "When seeking shares, treat every space as if it costs £1."
      const cost = ownsStockBroker ? 1 : slot.cost;
      if (player.cash >= cost) {
        commands.push({
          type: commandType,
          label: `Seek Share (£${cost}, ${slot.id})${sourceLabel(source)}`,
          description: `Place one family member on the £${slot.cost} Stock Exchange space and pay £${cost}.`,
          payload: withSource({ action: "seek-share", slotId: slot.id }, source) satisfies FamilyActionPayload,
        });
      }

      if (canRequestBroker && slot.cost > 1) {
        commands.push({
          type: commandType,
          label: `Seek Share (£1 with ${state.players[brokerOwner].name}'s Stock Broker, ${slot.id})${sourceLabel(source)}`,
          description: `Ask ${state.players[brokerOwner].name} for permission to use their Stock Broker.`,
          payload: withSource(
            { action: "seek-share", slotId: slot.id, stockBroker: "request" },
            source,
          ) satisfies FamilyActionPayload,
        });
      }
    }
  }

  return commands;
}

function isActionForbidden(player: PlayerState, action: RealFamilyActionId, stage: ActionStage): boolean {
  for (const card of player.prestigeCards) {
    // Mr. Rochester and William Collins forbid the family action itself; the extra writer from
    // Tenure Limits and the extra officer from Army Spending are still permitted (card text).
    if (stage !== "lawExtraAction" && SPOUSE_FORBIDDEN_ACTIONS[card.cardId]?.includes(action)) return true;
    if (SPOUSE_FORBIDDEN_HOLDINGS[card.cardId]?.includes(action)) return true;
  }

  return false;
}

/** Where a placed family member comes from: supply, or a prize when the supply is empty (p.13). */
function pieceSources(player: PlayerState): Array<string | undefined> {
  if (player.familyMembers.supply > 0) return [undefined];

  return Object.entries(player.familyMembers.prizes)
    .filter(([, count]) => count > 0)
    .map(([prizeId]) => prizeId);
}

function sourceLabel(source: string | undefined): string {
  return source ? ` (from ${prizeLabel(source)}, -${prizeVictoryPoints(source)} VP)` : "";
}

function withSource<T extends object>(payload: T, source: string | undefined): T & { fromPrize?: string } {
  return source ? { ...payload, fromPrize: source } : payload;
}

// ---------------------------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------------------------

export function chooseFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase === "family" && state.pendingDecision.step === "family.chooseRepeatAction") {
    return chooseRepeatedFamilyAction(state, command);
  }

  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseAction") {
    return familyError("WRONG_PHASE", "Family actions can only be chosen during the Family phase.", "phase");
  }

  const checked = checkActionCommand(state, command, "family.chooseAction");
  if (!checked.ok) return checked.result;
  const { player, payload } = checked;
  const now = command.clientTimestamp;

  if (payload.stockBroker === "request") {
    return requestStockBroker(state, command, player, payload, "main");
  }

  const turn = state.family.turn as FamilyTurnState;
  const applied = applyFamilyAction(state, player, payload, "main");
  if (!applied.ok) return applied;

  const logEntry = createCommandLogEntry({
    state: applied.state,
    command,
    now,
    type: "family.action.chosen",
    summary: `${player.name} chose ${familyActionLabel(payload.action)}.`,
    details: { action: payload, effects: applied.effects },
  });
  const next: GameState = {
    ...applied.state,
    updatedAt: now,
    log: [...applied.state.log, logEntry],
    family: { ...applied.state.family, turn: { ...turn, mainAction: payload.action } },
  };

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

function chooseRepeatedFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  const checked = checkActionCommand(state, command, "family.chooseAction");
  if (!checked.ok) return checked.result;
  const { player, payload } = checked;
  const now = command.clientTimestamp;

  if (payload.stockBroker === "request") {
    return requestStockBroker(state, command, player, payload, "repeat");
  }

  const applied = applyFamilyAction(state, player, payload, "repeat");
  if (!applied.ok) return applied;

  const logEntry = createCommandLogEntry({
    state: applied.state,
    command,
    now,
    type: "family.action.repeated",
    summary: `${player.name} repeated ${familyActionLabel(payload.action)}.`,
    details: { action: payload, effects: applied.effects },
  });
  const next = resolveStage(
    { ...applied.state, updatedAt: now, log: [...applied.state.log, logEntry] },
    "repeat",
    { repeatAction: payload.action },
  );

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

export function finishFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseRepeatAction") {
    return familyError("WRONG_PHASE", "Family repeat decisions can only be finished during the Family phase.", "phase");
  }

  const payload = parseFinishFamilyActionPayload(command.payload);
  if (!payload || !isLegalFinishPayloadForCurrentDecision(state, payload)) {
    return familyError("ILLEGAL_FAMILY_ACTION", "That repeat decision cannot be finished here.", "payload.action");
  }

  const player = state.players[command.actorId];
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "family.action.repeatSkipped",
    summary: `${player.name} finished ${familyActionLabel(payload.action)}.`,
    details: { action: payload, note: "Player declined the optional second Family action." },
  });
  const next = resolveStage({ ...state, updatedAt: now, log: [...state.log, logEntry] }, "repeat");

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

export function placeExtraWriter(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseExtraWriter") {
    return familyError("WRONG_PHASE", "The extra writer can only be placed when it is offered.", "phase");
  }

  if (!isLegalPayload(state, "family.placeExtraWriter", command.payload)) {
    return familyError("ILLEGAL_FAMILY_ACTION", "That extra writer placement is not legal here.", "payload");
  }

  const payload = command.payload as ExtraWriterPayload;
  const player = state.players[command.actorId];
  const turn = state.family.turn as FamilyTurnState;
  const placed = enlistWriter(state, player, payload.presidency, payload.fromPrize);
  if (!placed.ok) return placed;

  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: placed.state,
    command,
    now,
    type: "family.extraWriter",
    summary: `${player.name} placed an extra writer in ${payload.presidency} (four or more vacant offices).`,
    details: { ...payload, vacantOffices: vacantOfficeCount(state) },
  });
  const next = resolveStage(
    {
      ...placed.state,
      updatedAt: now,
      log: [...placed.state.log, logEntry],
      family: { ...placed.state.family, extraWriterUsedBy: [...placed.state.family.extraWriterUsedBy, player.id] },
    },
    turn.currentStage ?? "extraWriterAfterMain",
  );

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

export function declineExtraWriter(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseExtraWriter") {
    return familyError("WRONG_PHASE", "There is no extra writer to decline.", "phase");
  }

  const player = state.players[command.actorId];
  const turn = state.family.turn as FamilyTurnState;
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "family.extraWriterDeclined",
    summary: `${player.name} did not place an extra writer.`,
  });
  const next = resolveStage(
    { ...state, updatedAt: now, log: [...state.log, logEntry] },
    turn.currentStage ?? "extraWriterAfterMain",
  );

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

export function chooseExtraAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseExtraAction") {
    return familyError("WRONG_PHASE", "No law extra action is being offered.", "phase");
  }

  const checked = checkActionCommand(state, command, "family.chooseExtraAction");
  if (!checked.ok) return checked.result;
  const { player, payload } = checked;

  if (payload.stockBroker === "request") {
    return requestStockBroker(state, command, player, payload, "lawExtraAction");
  }

  const applied = applyFamilyAction(state, player, payload, "lawExtraAction");
  if (!applied.ok) return applied;

  const extra = currentLawExtraAction(state);
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: applied.state,
    command,
    now,
    type: "family.extraAction",
    summary: `${player.name} used the ${extra?.lawName ?? "law"} extra action: ${familyActionLabel(payload.action)}.`,
    details: { action: payload, lawId: extra?.lawId, effects: applied.effects },
  });
  const next = resolveStage(
    { ...applied.state, updatedAt: now, log: [...applied.state.log, logEntry] },
    "lawExtraAction",
  );

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

export function skipExtraAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseExtraAction") {
    return familyError("WRONG_PHASE", "No law extra action is being offered.", "phase");
  }

  const player = state.players[command.actorId];
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "family.extraActionSkipped",
    summary: `${player.name} skipped the law's extra action.`,
  });
  const next = resolveStage({ ...state, updatedAt: now, log: [...state.log, logEntry] }, "lawExtraAction");

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

// Stock Broker: "Other players may use this power with your permission." The owner answers here.
// A single owner's yes/no, so it keeps its own decision rather than Negotiation's consent queue.
export function resolveStockBrokerConsent(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.stockBrokerConsent") {
    return familyError("WRONG_PHASE", "No Stock Broker permission is being requested.", "phase");
  }

  if (!isLegalPayload(state, "family.resolveStockBrokerConsent", command.payload)) {
    return familyError("ILLEGAL_FAMILY_ACTION", "That answer is not legal here.", "payload");
  }

  const turn = state.family.turn as FamilyTurnState;
  const request = turn.stockBrokerRequest;
  if (!request) return familyError("NO_REQUEST", "No Stock Broker permission is being requested.", "family");

  const { accepted } = command.payload as StockBrokerConsentPayload;
  const requester = state.players[turn.playerId];
  const owner = state.players[request.owner];
  const now = command.clientTimestamp;
  const clearedTurn: FamilyTurnState = { ...turn, stockBrokerRequest: undefined };

  if (!accepted) {
    const logEntry = createCommandLogEntry({
      state,
      command,
      now,
      type: "family.stockBrokerRefused",
      summary: `${owner.name} refused ${requester.name} the use of their Stock Broker.`,
    });
    const refused: GameState = {
      ...state,
      updatedAt: now,
      log: [...state.log, logEntry],
      family: {
        ...state.family,
        turn: clearedTurn,
        stockBrokerRefused: [...state.family.stockBrokerRefused, requester.id],
      },
    };
    const decision =
      request.stage === "main"
        ? createMainActionDecision(refused, requester.id)
        : createStageDecision(refused, clearedTurn, request.stage);

    return {
      ok: true,
      logEntry,
      state: decision ? withDecision(refused, decision) : continueFamilyTurn(refused),
    };
  }

  const payload: FamilyActionPayload = { action: "seek-share", slotId: request.slotId, fromPrize: request.fromPrize };
  const applied = seekShare(state, requester, payload, 1);
  if (!applied.ok) return applied;

  const logEntry = createCommandLogEntry({
    state: applied.state,
    command,
    now,
    type: "family.stockBrokerUsed",
    summary: `${owner.name} let ${requester.name} use their Stock Broker: Seek Share for £1.`,
    details: { slotId: request.slotId, stage: request.stage },
  });
  let next: GameState = {
    ...applied.state,
    updatedAt: now,
    log: [...applied.state.log, logEntry],
    family: { ...applied.state.family, turn: clearedTurn },
  };

  if (request.stage === "main") {
    next = { ...next, family: { ...next.family, turn: { ...clearedTurn, mainAction: "seek-share" } } };
  } else if (request.stage === "repeat") {
    next = resolveStage(next, "repeat", { repeatAction: "seek-share" });
  } else {
    next = resolveStage(next, "lawExtraAction");
  }

  return { ok: true, logEntry, state: continueFamilyTurn(next) };
}

function requestStockBroker(
  state: GameState,
  command: GameCommand,
  player: PlayerState,
  payload: FamilyActionPayload,
  stage: "main" | "repeat" | "lawExtraAction",
): ApplyCommandResult {
  const owner = prestigeCardOwner(state, "stock-broker");
  if (!owner || !payload.slotId) {
    return familyError("ILLEGAL_FAMILY_ACTION", "No Stock Broker is available to ask about.", "payload");
  }

  const turn = state.family.turn as FamilyTurnState;
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "family.stockBrokerRequested",
    summary: `${player.name} asked ${state.players[owner].name} to use their Stock Broker.`,
    details: payload,
  });
  const next: GameState = {
    ...state,
    updatedAt: now,
    log: [...state.log, logEntry],
    family: {
      ...state.family,
      turn: { ...turn, stockBrokerRequest: { slotId: payload.slotId, owner, stage, fromPrize: payload.fromPrize } },
    },
  };

  return {
    ok: true,
    logEntry,
    state: withDecision(next, {
      id: `decision-family-stock-broker-turn-${state.turn}-${player.id}-${state.log.length}`,
      phase: "family",
      step: "family.stockBrokerConsent",
      actor: owner,
      visibility: "public",
      prompt: `${player.name} asks to seek a share for £1 using your Stock Broker.`,
      legalCommands: [
        {
          type: "family.resolveStockBrokerConsent",
          label: "Allow",
          description: `${player.name} pays £1 for the share.`,
          payload: { accepted: true } satisfies StockBrokerConsentPayload,
        },
        {
          type: "family.resolveStockBrokerConsent",
          label: "Refuse",
          description: `${player.name} chooses again without the Stock Broker.`,
          payload: { accepted: false } satisfies StockBrokerConsentPayload,
        },
      ],
      canSave: true,
    }),
  };
}

function checkActionCommand(
  state: GameState,
  command: GameCommand,
  commandType: string,
):
  | { ok: true; player: PlayerState; payload: FamilyActionPayload }
  | { ok: false; result: ApplyCommandResult } {
  const payload = parseFamilyActionPayload(command.payload);
  if (!payload) {
    return {
      ok: false,
      result: familyError("INVALID_PAYLOAD", "Family action command requires a payload with an action id.", "payload.action"),
    };
  }

  const player = state.players[command.actorId];
  if (!player || player.isCrown || state.family.turn?.playerId !== player.id) {
    return {
      ok: false,
      result: familyError("INVALID_ACTOR", "Only the family taking its turn can choose this action.", "actorId"),
    };
  }

  if (!isLegalPayload(state, commandType, payload)) {
    return {
      ok: false,
      result: familyError(
        "ILLEGAL_FAMILY_ACTION",
        `Family action '${payload.action}' is not legal for this decision.`,
        "payload.action",
      ),
    };
  }

  return { ok: true, player, payload };
}

// ---------------------------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------------------------

function applyFamilyAction(
  state: GameState,
  actor: PlayerState,
  payload: FamilyActionPayload,
  stage: ActionStage,
): FamilyActionApplyResult {
  switch (payload.action) {
    case "enlist-writer":
      return enlistWriter(state, actor, payload.presidency, payload.fromPrize);
    case "enlist-officer":
      return enlistOfficer(state, actor, payload.fromPrize);
    case "seek-share":
      return seekShare(state, actor, payload);
    case "purchase-shipyard":
      return purchaseEnterprise(state, actor, "shipyard", stage);
    case "purchase-workshop":
      return purchaseEnterprise(state, actor, "workshop", stage);
    case "purchase-luxury":
      return purchaseEnterprise(state, actor, "luxury", stage);
    case "no-action":
      return { ok: true, state, effects: { note: "No legal Family action was available." } };
  }
}

/**
 * Take a family member to place: from supply, or, if the supply is empty, from a prize, lowering
 * victory points by that prize's printed value (p.13).
 * Window icons are counted from holdings (playerWindowIcons), so there is nothing else to adjust.
 */
export function takeFamilyPiece(
  state: GameState,
  playerId: PlayerId,
  fromPrize: string | undefined,
): { ok: true; state: GameState } | { ok: false; errors: ValidationError[] } {
  const player = state.players[playerId];

  if (!fromPrize) {
    if (player.familyMembers.supply <= 0) {
      return invalidFamilyAction("No family member is left in supply.", "familyMembers.supply");
    }

    return {
      ok: true,
      state: updatePlayer(state, playerId, {
        ...player,
        familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - 1 },
      }),
    };
  }

  const onPrize = player.familyMembers.prizes[fromPrize] ?? 0;
  if (player.familyMembers.supply > 0 || onPrize <= 0) {
    return invalidFamilyAction("A piece may come from a prize only when the supply is empty.", "payload.fromPrize");
  }

  return {
    ok: true,
    state: updatePlayer(state, playerId, {
      ...player,
      victoryPoints: player.victoryPoints - prizeVictoryPoints(fromPrize),
      familyMembers: {
        ...player.familyMembers,
        prizes: { ...player.familyMembers.prizes, [fromPrize]: onPrize - 1 },
      },
    }),
  };
}

function enlistWriter(
  state: GameState,
  actor: PlayerState,
  presidency: PresidencyId | undefined,
  fromPrize?: string,
): FamilyActionApplyResult {
  if (!presidency) return invalidFamilyAction("Enlist Writer requires a Presidency.", "payload.presidency");

  const taken = takeFamilyPiece(state, actor.id, fromPrize);
  if (!taken.ok) return taken;

  const box = taken.state.india.presidencies[presidency];

  return {
    ok: true,
    effects: { placed: "writer", presidency, fromPrize },
    state: {
      ...taken.state,
      india: {
        ...taken.state.india,
        presidencies: {
          ...taken.state.india.presidencies,
          [presidency]: { ...box, writers: { ...box.writers, [actor.id]: (box.writers[actor.id] ?? 0) + 1 } },
        },
      },
    },
  };
}

function enlistOfficer(state: GameState, actor: PlayerState, fromPrize?: string): FamilyActionApplyResult {
  const taken = takeFamilyPiece(state, actor.id, fromPrize);
  if (!taken.ok) return taken;

  const player = taken.state.players[actor.id];

  return {
    ok: true,
    effects: { placed: "officer-in-training", fromPrize },
    state: updatePlayer(taken.state, actor.id, {
      ...player,
      familyMembers: { ...player.familyMembers, officersInTraining: player.familyMembers.officersInTraining + 1 },
    }),
  };
}

function seekShare(
  state: GameState,
  actor: PlayerState,
  payload: FamilyActionPayload,
  costOverride?: number,
): FamilyActionApplyResult {
  const slot = state.company.stockExchange.find((candidate) => candidate.id === payload.slotId);
  if (!slot || slot.share) {
    return invalidFamilyAction("Seek Share requires an empty Stock Exchange space.", "payload.slotId");
  }

  const cost = costOverride ?? (ownsPrestigeCard(actor, "stock-broker") ? 1 : slot.cost);
  if (actor.cash < cost) return invalidFamilyAction("Seek Share requires enough cash for that space.", "cash");

  const taken = takeFamilyPiece(state, actor.id, payload.fromPrize);
  if (!taken.ok) return taken;

  const player = taken.state.players[actor.id];
  const pendingShare: ShareInstance = {
    id: `pending-share-${state.turn}-${slot.id}-${actor.id}`,
    owner: actor.id,
  };

  return {
    ok: true,
    effects: { placed: "stock-exchange-family-member", slotId: slot.id, cost, fromPrize: payload.fromPrize },
    state: {
      ...updatePlayer(taken.state, actor.id, { ...player, cash: player.cash - cost }),
      company: {
        ...taken.state.company,
        stockExchange: taken.state.company.stockExchange.map((candidate) =>
          candidate.id === slot.id ? { ...candidate, share: pendingShare } : candidate,
        ),
      },
    },
  };
}

function purchaseEnterprise(
  state: GameState,
  actor: PlayerState,
  type: EnterpriseType,
  stage: ActionStage,
): FamilyActionApplyResult {
  const card = availableEnterpriseCard(state, type);
  if (!card) return invalidFamilyAction(`No ${type} is available to purchase.`, "enterpriseDecks");

  const cost = enterprisePurchaseCost(state, type, stage);
  if (actor.cash < cost) return invalidFamilyAction(`Purchase ${type} requires £${cost}.`, "cash");

  const instance: EnterpriseInstance = {
    id: `${card.id}-t${state.turn}-${actor.id}`,
    type,
    cardId: card.id,
  };
  let next = updatePlayer(state, actor.id, {
    ...actor,
    cash: actor.cash - cost,
    victoryPoints: actor.victoryPoints + card.victoryPoints,
    windows: actor.windows + card.windowTaxIcons,
    enterprises: [...actor.enterprises, instance],
  });
  const effects: Record<string, unknown> = { purchased: type, cardId: card.id, cost };

  if (type === "shipyard" && !next.company.ships.some((ship) => ship.shipyardCardId === card.id)) {
    // The matching ship starts on its shipyard, unfitted (p.13).
    next = {
      ...next,
      company: {
        ...next.company,
        ships: [
          ...next.company.ships,
          { id: `ship-${card.id}`, kind: "player", shipyardCardId: card.id, location: "shipyard", fatigued: false },
        ],
      },
    };
  }

  if (type === "workshop") {
    // Foundry: "Each time any player purchases a workshop ..., you take £1 from the bank."
    const foundryOwner = prestigeCardOwner(next, "foundry");
    if (foundryOwner) {
      const owner = next.players[foundryOwner];
      next = updatePlayer(next, foundryOwner, { ...owner, cash: owner.cash + 1 });
      effects.foundryPaid = foundryOwner;
    }
  }

  return { ok: true, effects, state: next };
}

/**
 * The next enterprise card in the supply. Cards owned by a player are out of the supply, and a
 * returned shipyard cannot be bought while its fitted ship is still in play (pp.12, 34).
 */
export function availableEnterpriseCard(state: GameState, type: EnterpriseType): EnterpriseCardDefinition | undefined {
  const deck = enterpriseDecks.find((candidate) => candidate.type === type);
  if (!deck) return undefined;

  const owned = new Set(
    Object.values(state.players).flatMap((player) => player.enterprises.map((enterprise) => enterprise.cardId)),
  );

  return deck.cards.find((card) => {
    if (owned.has(card.id)) return false;
    if (type !== "shipyard") return true;

    const ship = state.company.ships.find((candidate) => candidate.shipyardCardId === card.id);
    return !ship || ship.location === "shipyard";
  });
}

function enterprisePurchaseCost(state: GameState, type: EnterpriseType, stage: ActionStage): number {
  const printed = enterpriseDecks.find((deck) => deck.type === type)?.cards[0]?.cost ?? 0;
  if (type !== "workshop" || stage === "lawExtraAction" || !isLawPassed(state, "industry-subsidy")) {
    return printed;
  }

  // Industry Subsidy: £3 if your opportunity token is not on the workshop space; not for a
  // Calico Acts workshop. A family without a token always benefits.
  const marker = state.family.turn?.markerAtStart;
  const discount = lawsById.get("industry-subsidy")?.effects.find((effect) => effect.type === "workshopPurchaseCost");
  const subsidised = discount && "amount" in discount ? discount.amount : printed;

  return marker === "purchase-workshop" ? printed : subsidised;
}

// ---------------------------------------------------------------------------------------------
// New Company shares (p.14)
// ---------------------------------------------------------------------------------------------

/**
 * For each Company Debt, the rightmost Stock Exchange family member enters the Court and Debt
 * drops by one. Then any remaining pieces slide rightward as far as possible, keeping their order.
 */
export function resolveNewCompanyShares(state: GameState): GameState {
  let debt = state.company.debt;
  let court = state.company.court;
  const converted = new Set<string>();
  // Joseph Sedley (#15): "You may no longer seek or own Company shares." A forbidden holder's
  // piece never becomes a Court share; it returns to supply.
  const forbidden = state.company.stockExchange.filter(
    (slot) => slot.share?.owner && playerForbidsHolding(state, slot.share.owner, "companyShare"),
  );
  let players = state.players;
  for (const slot of forbidden) {
    const owner = players[slot.share!.owner as string];
    players = { ...players, [owner.id]: { ...owner, familyMembers: { ...owner.familyMembers, supply: owner.familyMembers.supply + 1 } } };
  }
  const forbiddenSlots = new Set(forbidden.map((slot) => slot.id));

  for (const slot of [...state.company.stockExchange].reverse()) {
    if (debt <= 0) break;
    if (!slot.share?.owner || forbiddenSlots.has(slot.id)) continue;

    converted.add(slot.id);
    debt -= 1;
    court = [...court, { id: `company-share-${state.turn}-${slot.id}-${slot.share.owner}`, owner: slot.share.owner }];
  }

  const remaining = state.company.stockExchange
    .filter((slot) => slot.share?.owner && !converted.has(slot.id) && !forbiddenSlots.has(slot.id))
    .map((slot) => slot.share as ShareInstance);
  const stockExchange: StockExchangeSlot[] = state.company.stockExchange.map((slot) => ({ id: slot.id, cost: slot.cost }));
  const firstTarget = stockExchange.length - remaining.length;
  remaining.forEach((share, index) => {
    stockExchange[firstTarget + index] = { ...stockExchange[firstTarget + index], share };
  });

  return { ...state, players, company: { ...state.company, debt, court, stockExchange } };
}

// ---------------------------------------------------------------------------------------------
// Rules helpers
// ---------------------------------------------------------------------------------------------

function effectiveOpportunityMarker(player: PlayerState): PlayerState["opportunityMarker"] {
  // Lady Glencora removes the opportunity marker from the game.
  return ownsPrestigeCard(player, "lady-glencora") ? "removed" : player.opportunityMarker;
}

function canRepeatMainAction(turn: FamilyTurnState): boolean {
  return (
    turn.mainAction !== undefined &&
    turn.mainAction !== "no-action" &&
    turn.markerAtStart !== "removed" &&
    turn.markerAtStart === turn.mainAction
  );
}

/** Offices in the Vacant Offices box. */
export function vacantOfficeCount(state: GameState): number {
  return state.company.vacantOffices.filter((officeId) => state.company.offices[officeId]?.vacant).length;
}

/** With four or more vacant offices, one additional writer once this turn (p.13). */
function extraWriterAvailable(state: GameState, playerId: PlayerId): boolean {
  return (
    vacantOfficeCount(state) >= 4 &&
    !state.family.extraWriterUsedBy.includes(playerId) &&
    pieceSources(state.players[playerId]).length > 0
  );
}

/** Only the most recently passed extra action can be used (p.13). */
function currentLawExtraAction(
  state: GameState,
): { lawId: string; lawName: string; action: LawExtraAction } | undefined {
  for (const passed of [...state.parliament.passedLaws].reverse()) {
    const law = lawsById.get(passed.lawId);
    if (law?.extraAction) return { lawId: law.id, lawName: law.name, action: law.extraAction };
  }

  return undefined;
}

function lawExtraActionAllowed(turn: FamilyTurnState, extra: LawExtraAction): boolean {
  // Tenure Limits: "After taking any family action(s) other than enlist writer ..."
  if (extra.restriction === "notAfterEnlistWriter") {
    return turn.mainAction !== "enlist-writer" && turn.repeatAction !== "enlist-writer";
  }

  return true;
}

function isLawPassed(state: GameState, lawId: string): boolean {
  return state.parliament.passedLaws.some((law) => law.lawId === lawId);
}

function ownsPrestigeCard(player: PlayerState, cardId: string): boolean {
  return player.prestigeCards.some((card) => card.cardId === cardId);
}

function prestigeCardOwner(state: GameState, cardId: string): PlayerId | undefined {
  return Object.values(state.players).find((player) => ownsPrestigeCard(player, cardId))?.id;
}

function prizeVictoryPoints(prizeId: string): number {
  return prizes.find((prize) => prize.id === prizeId)?.victoryPoints ?? 0;
}

function prizeLabel(prizeId: string): string {
  const prize = prizes.find((candidate) => candidate.id === prizeId);
  return prize ? `£${prize.cost} prize` : prizeId;
}

function updatePlayer(state: GameState, playerId: PlayerId, player: PlayerState): GameState {
  return { ...state, players: { ...state.players, [playerId]: player } };
}

// ---------------------------------------------------------------------------------------------
// Payload parsing and validation
// ---------------------------------------------------------------------------------------------

function parseFamilyActionPayload(payload: unknown): FamilyActionPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as Record<string, unknown>;
  if (!isFamilyActionId(raw.action)) return undefined;

  const parsed: FamilyActionPayload = { action: raw.action };
  if (isPresidencyId(raw.presidency)) parsed.presidency = raw.presidency;
  if (typeof raw.slotId === "string") parsed.slotId = raw.slotId;
  if (typeof raw.fromPrize === "string") parsed.fromPrize = raw.fromPrize;
  if (raw.stockBroker === "request") parsed.stockBroker = "request";

  return parsed;
}

function parseFinishFamilyActionPayload(payload: unknown): FinishFamilyActionPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { action?: unknown };

  return isFamilyActionId(raw.action) ? { action: raw.action } : undefined;
}

function isLegalPayload(state: GameState, commandType: string, payload: unknown): boolean {
  const wanted = canonicalJson(payload ?? {});
  return state.pendingDecision.legalCommands.some(
    (command) => command.type === commandType && canonicalJson(command.payload ?? {}) === wanted,
  );
}

function canonicalJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;

  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function isLegalFinishPayloadForCurrentDecision(state: GameState, payload: FinishFamilyActionPayload): boolean {
  return state.pendingDecision.legalCommands.some(
    (command) =>
      command.type === "family.finishAction" &&
      (command.payload as FinishFamilyActionPayload | undefined)?.action === payload.action,
  );
}

function createFinishFamilyActionCommand(action: RealFamilyActionId): LegalCommand {
  return {
    type: "family.finishAction",
    label: "Finish Family Action",
    description: "Decline the optional second use of this Family action.",
    payload: { action } satisfies FinishFamilyActionPayload,
  };
}

function invalidFamilyAction(message: string, field: string): { ok: false; errors: ValidationError[] } {
  return { ok: false, errors: [{ code: "INVALID_FAMILY_ACTION", message, field }] };
}

function familyError(code: string, message: string, field: string): ApplyCommandResult {
  return { ok: false, errors: [{ code, message, field }] };
}

function isFamilyActionId(value: unknown): value is RealFamilyActionId {
  return (
    value === "enlist-writer" ||
    value === "enlist-officer" ||
    value === "seek-share" ||
    value === "purchase-shipyard" ||
    value === "purchase-workshop" ||
    value === "purchase-luxury" ||
    value === "no-action"
  );
}

function isPresidencyId(value: unknown): value is PresidencyId {
  return value === "Bombay" || value === "Madras" || value === "Bengal";
}

function familyActionLabel(action: string): string {
  if (action === "no-action") return "No Action";

  return action
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const familyCommandHandlers: Record<string, CommandHandler> = {
  "family.chooseAction": chooseFamilyAction,
  "family.finishAction": finishFamilyAction,
  "family.placeExtraWriter": placeExtraWriter,
  "family.declineExtraWriter": declineExtraWriter,
  "family.chooseExtraAction": chooseExtraAction,
  "family.skipExtraAction": skipExtraAction,
  "family.resolveStockBrokerConsent": resolveStockBrokerConsent,
};
