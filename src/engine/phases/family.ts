import { enterpriseDecks, familyActions } from "../../data";
import type {
  ActorId,
  ApplyCommandResult,
  EnterpriseInstance,
  GameCommand,
  GameState,
  LegalCommand,
  PendingDecision,
  PlayerState,
  PresidencyId,
  ShareInstance,
  StockExchangeSlot,
  ValidationError,
} from "../types";
import { createCommandLogEntry } from "./shared";
import { createNextHiringDecision } from "./hiring";

type RealFamilyActionId =
  | "enlist-writer"
  | "enlist-officer"
  | "seek-share"
  | "purchase-shipyard"
  | "purchase-workshop"
  | "purchase-luxury"
  | "no-action";

type EnterpriseType = EnterpriseInstance["type"];

type FamilyActionPayload = {
  action: RealFamilyActionId;
  presidency?: PresidencyId;
  slotId?: string;
};

type FinishFamilyActionPayload = {
  action: RealFamilyActionId;
};

type FamilyActionApplyResult =
  | { ok: true; state: GameState; effects: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

const PRESIDENCIES: PresidencyId[] = ["Bombay", "Madras", "Bengal"];

const FAMILY_ACTION_LABELS = new Map(familyActions.map((action) => [action.id, action.label]));

export function createFamilyActionCommands(state: GameState, actorId: ActorId): LegalCommand[] {
  if (actorId === "system") return [];

  const actor = state.players[actorId];
  if (!actor || actor.isCrown) return [];

  const commands: LegalCommand[] = [];

  if (actor.familyMembers.supply > 0) {
    for (const presidency of PRESIDENCIES) {
      commands.push({
        type: "family.chooseAction",
        label: `Enlist Writer (${presidency})`,
        description: `Place one family member in the ${presidency} Writers box.`,
        payload: { action: "enlist-writer", presidency } satisfies FamilyActionPayload,
      });
    }

    commands.push({
      type: "family.chooseAction",
      label: "Enlist Officer",
      description: "Place one family member in the Officers-in-Training box.",
      payload: { action: "enlist-officer" } satisfies FamilyActionPayload,
    });

    const stockExchangeSlot = cheapestAffordableStockExchangeSlot(state, actor);
    if (stockExchangeSlot) {
      commands.push({
        type: "family.chooseAction",
        label: `Seek Share (£${stockExchangeSlot.cost})`,
        description: `Place one family member on ${stockExchangeSlot.id}.`,
        payload: {
          action: "seek-share",
          slotId: stockExchangeSlot.id,
        } satisfies FamilyActionPayload,
      });
    }
  }

  for (const type of ["shipyard", "workshop", "luxury"] as const) {
    const action = enterpriseActionForType(type);
    const cost = enterpriseCost(type);
    if (actor.cash >= cost && nextEnterpriseCard(state, type)) {
      commands.push({
        type: "family.chooseAction",
        label: FAMILY_ACTION_LABELS.get(action) ?? familyActionLabel(action),
        description: `Pay £${cost} and take one ${type}.`,
        payload: { action } satisfies FamilyActionPayload,
      });
    }
  }

  if (commands.length === 0) {
    commands.push({
      type: "family.chooseAction",
      label: "No Action",
      description: "No legal Family action is available.",
      payload: { action: "no-action" } satisfies FamilyActionPayload,
    });
  }

  return commands;
}

export function chooseFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseAction") {
    if (state.phase === "family" && state.pendingDecision.step === "family.chooseRepeatAction") {
      return chooseRepeatedFamilyAction(state, command);
    }

    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Family actions can only be chosen during the Family phase.",
          field: "phase",
        },
      ],
    };
  }

  const action = parseFamilyActionPayload(command.payload);
  if (!action) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_PAYLOAD",
          message: "Family action command requires a payload with an action id.",
          field: "payload.action",
        },
      ],
    };
  }

  const actingPlayer = state.players[command.actorId];
  if (!actingPlayer || actingPlayer.isCrown) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_ACTOR",
          message: "Only a human family can choose this starter family action.",
          field: "actorId",
        },
      ],
    };
  }

  if (!isLegalPayloadForCurrentDecision(state, action)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_FAMILY_ACTION",
          message: `Family action '${action.action}' is not legal for this decision.`,
          field: "payload.action",
        },
      ],
    };
  }

  const actionResult = applyFamilyAction(state, actingPlayer, action);
  if (!actionResult.ok) return actionResult;

  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: actionResult.state,
    command,
    now,
    type: "family.action.chosen",
    summary: `${actingPlayer.name} chose ${familyActionLabel(action.action)}.`,
    details: {
      action,
      effects: actionResult.effects,
    },
  });
  const stateAfterAction: GameState = {
    ...actionResult.state,
    updatedAt: now,
    log: [...actionResult.state.log, logEntry],
  };

  const repeatCommands = createRepeatActionCommands(stateAfterAction, actingPlayer.id, action.action);
  if (shouldOfferRepeatAction(state, actingPlayer, action.action) && repeatCommands.length > 0) {
    return {
      ok: true,
      logEntry,
      state: {
        ...stateAfterAction,
        pendingDecision: {
          id: `decision-family-repeat-action-turn-${stateAfterAction.turn}-${actingPlayer.id}-${action.action}`,
          phase: "family",
          step: "family.chooseRepeatAction",
          actor: actingPlayer.id,
          visibility: "private",
          prompt: `Choose whether to repeat ${familyActionLabel(action.action)}.`,
          legalCommands: [
            ...repeatCommands,
            createFinishFamilyActionCommand(action.action),
          ],
          canSave: true,
        },
      },
    };
  }

  return {
    ok: true,
    logEntry,
    state: finishFamilyActionTurn(stateAfterAction, actingPlayer.id, action.action),
  };
}

function chooseRepeatedFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  const action = parseFamilyActionPayload(command.payload);
  if (!action) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_PAYLOAD",
          message: "Repeated Family action command requires a payload with an action id.",
          field: "payload.action",
        },
      ],
    };
  }

  const actingPlayer = state.players[command.actorId];
  if (!actingPlayer || actingPlayer.isCrown) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_ACTOR",
          message: "Only a human family can repeat this Family action.",
          field: "actorId",
        },
      ],
    };
  }

  if (!isLegalPayloadForCurrentDecision(state, action)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_FAMILY_ACTION",
          message: `Repeated Family action '${action.action}' is not legal for this decision.`,
          field: "payload.action",
        },
      ],
    };
  }

  const actionResult = applyFamilyAction(state, actingPlayer, action);
  if (!actionResult.ok) return actionResult;

  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: actionResult.state,
    command,
    now,
    type: "family.action.repeated",
    summary: `${actingPlayer.name} repeated ${familyActionLabel(action.action)}.`,
    details: {
      action,
      effects: actionResult.effects,
    },
  });
  const stateAfterAction: GameState = {
    ...actionResult.state,
    updatedAt: now,
    log: [...actionResult.state.log, logEntry],
  };

  return {
    ok: true,
    logEntry,
    state: finishFamilyActionTurn(stateAfterAction, actingPlayer.id, action.action),
  };
}

export function finishFamilyAction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "family" || state.pendingDecision.step !== "family.chooseRepeatAction") {
    return {
      ok: false,
      errors: [
        {
          code: "WRONG_PHASE",
          message: "Family repeat decisions can only be finished during the Family phase.",
          field: "phase",
        },
      ],
    };
  }

  const payload = parseFinishFamilyActionPayload(command.payload);
  if (!payload) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_PAYLOAD",
          message: "Finish Family action command requires an action id.",
          field: "payload.action",
        },
      ],
    };
  }

  const actingPlayer = state.players[command.actorId];
  if (!actingPlayer || actingPlayer.isCrown) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_ACTOR",
          message: "Only a human family can finish this Family action.",
          field: "actorId",
        },
      ],
    };
  }

  if (!isLegalFinishPayloadForCurrentDecision(state, payload)) {
    return {
      ok: false,
      errors: [
        {
          code: "ILLEGAL_FAMILY_ACTION",
          message: `Cannot finish repeat decision for Family action '${payload.action}'.`,
          field: "payload.action",
        },
      ],
    };
  }

  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "family.action.repeatSkipped",
    summary: `${actingPlayer.name} finished ${familyActionLabel(payload.action)}.`,
    details: {
      action: payload,
      note: "Player declined the optional second Family action.",
    },
  });
  const stateWithLog: GameState = {
    ...state,
    updatedAt: now,
    log: [...state.log, logEntry],
  };

  return {
    ok: true,
    logEntry,
    state: finishFamilyActionTurn(stateWithLog, actingPlayer.id, payload.action),
  };
}

function parseFamilyActionPayload(payload: unknown): FamilyActionPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as {
    action?: unknown;
    presidency?: unknown;
    slotId?: unknown;
  };

  if (!isFamilyActionId(raw.action)) return undefined;

  return {
    action: raw.action,
    presidency: isPresidencyId(raw.presidency) ? raw.presidency : undefined,
    slotId: typeof raw.slotId === "string" ? raw.slotId : undefined,
  };
}

function parseFinishFamilyActionPayload(payload: unknown): FinishFamilyActionPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as {
    action?: unknown;
  };

  if (!isFamilyActionId(raw.action)) return undefined;

  return {
    action: raw.action,
  };
}

function applyFamilyAction(
  state: GameState,
  actor: PlayerState,
  payload: FamilyActionPayload,
): FamilyActionApplyResult {
  switch (payload.action) {
    case "enlist-writer":
      return enlistWriter(state, actor, payload.presidency);
    case "enlist-officer":
      return enlistOfficer(state, actor);
    case "seek-share":
      return seekShare(state, actor, payload.slotId);
    case "purchase-shipyard":
      return purchaseEnterprise(state, actor, "shipyard");
    case "purchase-workshop":
      return purchaseEnterprise(state, actor, "workshop");
    case "purchase-luxury":
      return purchaseEnterprise(state, actor, "luxury");
    case "no-action":
      return {
        ok: true,
        state,
        effects: {
          note: "No legal Family action was available.",
        },
      };
  }
}

function enlistWriter(
  state: GameState,
  actor: PlayerState,
  presidency: PresidencyId | undefined,
): FamilyActionApplyResult {
  if (!presidency) {
    return invalidFamilyAction("Enlist Writer requires a Presidency.", "payload.presidency");
  }

  if (actor.familyMembers.supply <= 0) {
    return invalidFamilyAction("Enlist Writer requires a family member in supply.", "familyMembers.supply");
  }

  const previousPresidencyWriters = state.india.presidencies[presidency].writers[actor.id] ?? 0;

  return {
    ok: true,
    effects: {
      placed: "writer",
      presidency,
    },
    state: {
      ...state,
      players: {
        ...state.players,
        [actor.id]: {
          ...actor,
          familyMembers: {
            ...actor.familyMembers,
            supply: actor.familyMembers.supply - 1,
            writers: {
              ...actor.familyMembers.writers,
              [presidency]: actor.familyMembers.writers[presidency] + 1,
            },
          },
        },
      },
      india: {
        ...state.india,
        presidencies: {
          ...state.india.presidencies,
          [presidency]: {
            ...state.india.presidencies[presidency],
            writers: {
              ...state.india.presidencies[presidency].writers,
              [actor.id]: previousPresidencyWriters + 1,
            },
          },
        },
      },
    },
  };
}

function enlistOfficer(
  state: GameState,
  actor: PlayerState,
): FamilyActionApplyResult {
  if (actor.familyMembers.supply <= 0) {
    return invalidFamilyAction("Enlist Officer requires a family member in supply.", "familyMembers.supply");
  }

  return {
    ok: true,
    effects: {
      placed: "officer-in-training",
    },
    state: {
      ...state,
      players: {
        ...state.players,
        [actor.id]: {
          ...actor,
          familyMembers: {
            ...actor.familyMembers,
            supply: actor.familyMembers.supply - 1,
            officersInTraining: actor.familyMembers.officersInTraining + 1,
          },
        },
      },
    },
  };
}

function seekShare(
  state: GameState,
  actor: PlayerState,
  slotId: string | undefined,
): FamilyActionApplyResult {
  if (!slotId) {
    return invalidFamilyAction("Seek Share requires a Stock Exchange slot.", "payload.slotId");
  }

  if (actor.familyMembers.supply <= 0) {
    return invalidFamilyAction("Seek Share requires a family member in supply.", "familyMembers.supply");
  }

  const slot = state.company.stockExchange.find((candidate) => candidate.id === slotId);
  if (!slot || slot.share) {
    return invalidFamilyAction("Seek Share requires an empty Stock Exchange slot.", "payload.slotId");
  }

  if (actor.cash < slot.cost) {
    return invalidFamilyAction("Seek Share requires enough cash for the selected slot.", "cash");
  }

  const pendingShare: ShareInstance = {
    id: `pending-share-${state.turn}-${slot.id}-${actor.id}`,
    owner: actor.id,
  };

  return {
    ok: true,
    effects: {
      placed: "stock-exchange-family-member",
      slotId,
      cost: slot.cost,
    },
    state: {
      ...state,
      players: {
        ...state.players,
        [actor.id]: {
          ...actor,
          cash: actor.cash - slot.cost,
          familyMembers: {
            ...actor.familyMembers,
            supply: actor.familyMembers.supply - 1,
            stockExchange: [...actor.familyMembers.stockExchange, slot.id],
          },
        },
      },
      company: {
        ...state.company,
        stockExchange: state.company.stockExchange.map((candidate) =>
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
): FamilyActionApplyResult {
  const card = nextEnterpriseCard(state, type);
  if (!card) {
    return invalidFamilyAction(`No ${type} enterprise cards remain.`, "enterpriseDecks");
  }

  const cost = enterpriseCost(type);
  if (actor.cash < cost) {
    return invalidFamilyAction(`Purchase ${type} requires £${cost}.`, "cash");
  }

  const instance: EnterpriseInstance = {
    id: `${type}-${state.turn}-${actor.id}-${actor.enterprises.filter((enterprise) => enterprise.type === type).length + 1}`,
    type,
    cardId: card.id,
  };
  const nextActor: PlayerState = {
    ...actor,
    cash: actor.cash - cost,
    victoryPoints: actor.victoryPoints + card.victoryPoints,
    windows: actor.windows + card.windowTaxIcons,
    enterprises: [...actor.enterprises, instance],
  };

  return {
    ok: true,
    effects: {
      purchased: type,
      cardId: card.id,
      cost,
    },
    state: {
      ...state,
      players: {
        ...state.players,
        [actor.id]: nextActor,
      },
      company:
        type === "shipyard"
          ? {
              ...state.company,
              ships: [
                ...state.company.ships,
                {
                  id: `ship-${card.id}`,
                  owner: actor.id,
                  location: `shipyard:${instance.id}`,
                  exhausted: false,
                },
              ],
            }
          : state.company,
    },
  };
}

function resolveStockExchangeSharesAtFamilyEnd(state: GameState, shouldResolve: boolean): GameState {
  if (!shouldResolve || state.company.debt <= 0) return state;

  const occupiedSlots = state.company.stockExchange
    .map((slot) => ({ slot }))
    .filter(({ slot }) => Boolean(slot.share?.owner))
    .reverse();

  if (occupiedSlots.length === 0) return state;

  let debt = state.company.debt;
  let players = state.players;
  let court = state.company.court;
  const convertedSlotIds = new Set<string>();

  for (const { slot } of occupiedSlots) {
    if (debt <= 0 || !slot.share?.owner) break;

    const owner = slot.share.owner;
    const player = players[owner];
    if (!player) continue;

    convertedSlotIds.add(slot.id);
    debt -= 1;
    const companyShare: ShareInstance = {
      id: `company-share-${state.turn}-${slot.id}-${owner}`,
      owner,
    };
    court = [...court, companyShare];
    players = {
      ...players,
      [owner]: {
        ...player,
        familyMembers: {
          ...player.familyMembers,
          stockExchange: player.familyMembers.stockExchange.filter((id) => id !== slot.id),
          courtShares: player.familyMembers.courtShares + 1,
        },
      },
    };
  }

  const stateAfterConversion: GameState = {
    ...state,
    players,
    company: {
      ...state.company,
      debt,
      court,
      stockExchange: state.company.stockExchange.map((slot) =>
        convertedSlotIds.has(slot.id) ? { id: slot.id, cost: slot.cost } : slot,
      ),
    },
  };

  return slideStockExchangePiecesRightward(stateAfterConversion);
}

function slideStockExchangePiecesRightward(state: GameState): GameState {
  const remainingShares = state.company.stockExchange
    .map((slot) => slot.share)
    .filter((share): share is ShareInstance => Boolean(share?.owner));

  if (remainingShares.length === 0) return state;

  const targetSlots = state.company.stockExchange.slice(-remainingShares.length);
  const slotMoves = new Map<string, string>();
  const stockExchange: StockExchangeSlot[] = state.company.stockExchange.map((slot) => ({
    id: slot.id,
    cost: slot.cost,
  }));

  targetSlots.forEach((slot, index) => {
    const share = remainingShares[index];
    const targetIndex = stockExchange.findIndex((candidate) => candidate.id === slot.id);
    const originalSlot = state.company.stockExchange.find((candidate) => candidate.share?.id === share.id);
    if (targetIndex >= 0 && originalSlot) {
      stockExchange[targetIndex] = {
        ...stockExchange[targetIndex],
        share,
      };
      slotMoves.set(originalSlot.id, slot.id);
    }
  });

  let players = state.players;
  for (const [playerId, player] of Object.entries(state.players)) {
    const nextStockExchange = player.familyMembers.stockExchange.map((slotId) => slotMoves.get(slotId) ?? slotId);
    if (nextStockExchange.some((slotId, index) => slotId !== player.familyMembers.stockExchange[index])) {
      players = {
        ...players,
        [playerId]: {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            stockExchange: nextStockExchange,
          },
        },
      };
    }
  }

  return {
    ...state,
    players,
    company: {
      ...state.company,
      stockExchange,
    },
  };
}

function cheapestAffordableStockExchangeSlot(
  state: GameState,
  actor: PlayerState,
): StockExchangeSlot | undefined {
  return state.company.stockExchange.find((slot) => !slot.share && actor.cash >= slot.cost);
}

function nextEnterpriseCard(state: GameState, type: EnterpriseType) {
  const deck = enterpriseDecks.find((candidate) => candidate.type === type);
  if (!deck) return undefined;

  const ownedCount = Object.values(state.players).reduce(
    (count, player) => count + player.enterprises.filter((enterprise) => enterprise.type === type).length,
    0,
  );

  return deck.cards[ownedCount];
}

function enterpriseCost(type: EnterpriseType): number {
  switch (type) {
    case "workshop":
      return 5;
    case "luxury":
      return 4;
    case "shipyard":
      return 2;
  }
}

function enterpriseActionForType(type: EnterpriseType): Extract<RealFamilyActionId, "purchase-shipyard" | "purchase-workshop" | "purchase-luxury"> {
  switch (type) {
    case "shipyard":
      return "purchase-shipyard";
    case "workshop":
      return "purchase-workshop";
    case "luxury":
      return "purchase-luxury";
  }
}

function isLegalPayloadForCurrentDecision(state: GameState, payload: FamilyActionPayload): boolean {
  return state.pendingDecision.legalCommands.some((command) =>
    command.type === "family.chooseAction" && payloadMatches(command.payload, payload),
  );
}

function isLegalFinishPayloadForCurrentDecision(state: GameState, payload: FinishFamilyActionPayload): boolean {
  return state.pendingDecision.legalCommands.some((command) => {
    if (command.type !== "family.finishAction") return false;
    if (!command.payload || typeof command.payload !== "object") return false;

    const legal = command.payload as FinishFamilyActionPayload;
    return legal.action === payload.action;
  });
}

function shouldOfferRepeatAction(
  stateAtDecisionStart: GameState,
  actor: PlayerState,
  action: RealFamilyActionId,
): boolean {
  return (
    stateAtDecisionStart.pendingDecision.step === "family.chooseAction" &&
    action !== "no-action" &&
    actor.opportunityMarker === action
  );
}

function createRepeatActionCommands(
  state: GameState,
  actorId: ActorId,
  action: RealFamilyActionId,
): LegalCommand[] {
  return createFamilyActionCommands(state, actorId).filter((command) => {
    const payload = command.payload as FamilyActionPayload | undefined;
    return command.type === "family.chooseAction" && payload?.action === action;
  });
}

function createFinishFamilyActionCommand(action: RealFamilyActionId): LegalCommand {
  return {
    type: "family.finishAction",
    label: "Finish Family Action",
    description: "Decline the optional second use of this Family action.",
    payload: { action } satisfies FinishFamilyActionPayload,
  };
}

function finishFamilyActionTurn(
  state: GameState,
  actorId: ActorId,
  action: RealFamilyActionId,
): GameState {
  if (actorId === "system") return state;

  const humanOrder = state.seatingOrder.filter((playerId) => !state.players[playerId].isCrown);
  const actorIndex = humanOrder.indexOf(actorId);
  const nextActor = humanOrder[actorIndex + 1];
  const actor = state.players[actorId];
  const stateWithOpportunityMarker: GameState = {
    ...state,
    players: {
      ...state.players,
      [actorId]: {
        ...actor,
        opportunityMarker: action === "no-action" ? "supply" : action,
      },
    },
  };
  const stateAfterFamilyEnd = resolveStockExchangeSharesAtFamilyEnd(stateWithOpportunityMarker, !nextActor);
  const pendingDecision: PendingDecision = nextActor
    ? {
        id: `decision-family-choose-action-turn-${stateAfterFamilyEnd.turn}-${nextActor}`,
        phase: "family",
        step: "family.chooseAction",
        actor: nextActor,
        visibility: "private",
        prompt: "Choose a family action.",
        legalCommands: createFamilyActionCommands(stateAfterFamilyEnd, nextActor),
        canSave: true,
      }
    : createNextHiringDecision(stateAfterFamilyEnd);

  return {
    ...stateAfterFamilyEnd,
    phase: pendingDecision.phase,
    pendingDecision,
  };
}

function payloadMatches(legalPayload: unknown, payload: FamilyActionPayload): boolean {
  if (!legalPayload || typeof legalPayload !== "object") return false;

  const legal = legalPayload as FamilyActionPayload;
  return (
    legal.action === payload.action &&
    legal.presidency === payload.presidency &&
    legal.slotId === payload.slotId
  );
}

function invalidFamilyAction(message: string, field: string): FamilyActionApplyResult {
  return {
    ok: false,
    errors: [
      {
        code: "INVALID_FAMILY_ACTION",
        message,
        field,
      },
    ],
  };
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
