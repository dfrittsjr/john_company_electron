import { setupCardDecks, type SetupCardDefinition } from "../../data";
import type { CommandHandler } from "../command-handler";
import { describeEffect } from "../crown/setup";
import { shuffle } from "../rng";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  PendingDecision,
  PlayerId,
  SetupDraftState,
} from "../types";
import { applySetupCard, completeSetup } from "./setup";
import { createCommandLogEntry } from "./shared";

// The setup card draft (rulebook p.5): "After setup cards are dealt, each player selects one and
// then passes the remainder to the player to their left. Continue doing this until no cards
// remain." Setup cards are dealt evenly first, with 3 / 6 extra cards added at 5 / 6 players (p.5).
// Players pick one at a time, in seat order, from the hand in front of them; once everyone has
// picked, the hands pass left (the next seat, clockwise). A hand of one card is taken without
// asking. When the hands are empty every pick is applied as in the random deal.

function deckCards(deckId: string): SetupCardDefinition[] {
  const deck = setupCardDecks.find((candidate) => candidate.id === deckId);
  if (!deck) throw new Error(`The ${deckId} setup cards are not encoded.`);
  return deck.cards;
}

/** What a setup card gives, for decision labels. */
export function draftCardLabel(deckId: string, cardId: string): string {
  const card = deckCards(deckId).find((candidate) => candidate.id === cardId);
  if (!card) throw new Error(`Unknown setup card "${cardId}".`);
  return card.effects.map(describeEffect).join(", ");
}

/** Deals the hands and asks the first player to pick. */
export function startSetupDraft(state: GameState, command: GameCommand, deckId: string): ApplyCommandResult {
  const now = command.clientTimestamp;
  const deck = setupCardDecks.find((candidate) => candidate.id === deckId);
  if (!deck) throw new Error(`The ${deckId} setup cards are not encoded.`);
  const order = state.seatingOrder.filter((playerId) => !state.players[playerId].isCrown);
  const extraCount =
    order.length >= 6 ? deck.extraCardsForSixPlayers : order.length === 5 ? deck.extraCardsForFivePlayers : 0;
  const shuffledExtras = shuffle(state.rng, deck.cards.filter((card) => card.extra));
  const removed = shuffledExtras.items.slice(extraCount).map((card) => card.id);
  const shuffledDeal = shuffle(shuffledExtras.rng, [
    ...deck.cards.filter((card) => !card.extra),
    ...shuffledExtras.items.slice(0, extraCount),
  ]);
  const hands: Record<PlayerId, string[]> = Object.fromEntries(order.map((playerId) => [playerId, [] as string[]]));
  shuffledDeal.items.forEach((card, index) => hands[order[index % order.length]].push(card.id));

  const draft: SetupDraftState = {
    deckId,
    hands,
    picks: Object.fromEntries(order.map((playerId) => [playerId, [] as string[]])),
    order,
    queue: order,
    removed,
  };
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "setup.draftStarted",
    summary: `${state.players[command.actorId]?.name ?? command.actorId} began setup: the setup cards are dealt and will be drafted, passing left.`,
  });
  const dealt: GameState = {
    ...state,
    rng: shuffledDeal.rng,
    updatedAt: now,
    log: [...state.log, logEntry],
    hidden: { ...state.hidden, setupDraft: draft },
  };
  const advanced = advanceDraft(dealt, command);
  return advanced.finished ?? { ok: true, logEntry, state: advanced.state };
}

/**
 * Moves the draft on to the next pick: takes forced picks (a hand of one), passes the hands left
 * when a round is done, and finishes setup when no cards remain.
 */
function advanceDraft(
  state: GameState,
  command: GameCommand,
): { state: GameState; finished?: ApplyCommandResult } {
  const start = state.hidden.setupDraft!;
  let hands = { ...start.hands };
  const picks = { ...start.picks };
  let queue = start.queue;
  for (;;) {
    queue = queue.filter((playerId) => hands[playerId].length > 0);
    if (queue.length === 0) {
      if (start.order.every((playerId) => hands[playerId].length === 0)) break;
      // Pass left: each hand goes to the next seat.
      const passed: Record<PlayerId, string[]> = {};
      start.order.forEach((playerId, index) => {
        passed[start.order[(index + 1) % start.order.length]] = hands[playerId];
      });
      hands = passed;
      queue = start.order.filter((playerId) => hands[playerId].length > 0);
    }
    const picker = queue[0];
    if (hands[picker].length > 1) break;
    // The last card in a hand is taken without asking.
    picks[picker] = [...picks[picker], hands[picker][0]];
    hands = { ...hands, [picker]: [] };
    queue = queue.slice(1);
  }
  const draft: SetupDraftState = { ...start, hands, picks, queue };

  if (start.order.every((playerId) => hands[playerId].length === 0)) {
    return { state, finished: finishDraft(state, draft, command) };
  }
  const next: GameState = { ...state, hidden: { ...state.hidden, setupDraft: draft } };
  return { state: { ...next, pendingDecision: draftDecision(next) } };
}

function draftDecision(state: GameState): PendingDecision {
  const draft = state.hidden.setupDraft!;
  const picker = draft.queue[0];
  const made = Object.values(draft.picks).reduce((sum, cards) => sum + cards.length, 0);
  const left = draft.order[(draft.order.indexOf(picker) + 1) % draft.order.length];
  const hand = draft.hands[picker];
  return {
    id: `decision-setup-draft-${made}`,
    phase: "setup",
    step: "setup.draftPick",
    actor: picker,
    visibility: "private",
    prompt: `Setup cards: choose one of the ${hand.length} in front of you. The rest pass left to ${state.players[left].name}.`,
    legalCommands: hand.map((cardId) => ({
      type: "setup.draftPick",
      label: draftCardLabel(draft.deckId, cardId),
      payload: { cardId },
    })),
    canSave: true,
  };
}

function finishDraft(state: GameState, draft: SetupDraftState, command: GameCommand): ApplyCommandResult {
  let next: GameState = state;
  const setupCardDistribution: Record<PlayerId, string[]> = {};
  for (const playerId of draft.order) {
    setupCardDistribution[playerId] = draft.picks[playerId];
    for (const cardId of draft.picks[playerId]) {
      const card = deckCards(draft.deckId).find((candidate) => candidate.id === cardId);
      if (card) next = applySetupCard(next, playerId, card);
    }
  }
  const { setupDraft: _finished, ...hidden } = next.hidden;
  next = {
    ...next,
    hidden,
    decks: {
      ...next.decks,
      [`setup-${draft.deckId}`]: {
        drawPile: [],
        discardPile: draft.order.flatMap((playerId) => draft.picks[playerId]),
        removed: draft.removed,
      },
    },
  };
  return completeSetup(next, command, "The setup cards are drafted and applied.", {
    setupCardDistribution,
    removedSetupCards: draft.removed,
  });
}

const draftPickCommand: CommandHandler = (state, command) => {
  const draft = state.hidden.setupDraft;
  if (!draft || state.phase !== "setup") return rejected("WRONG_PHASE", "No setup card draft is running.");
  const picker = draft.queue[0];
  const cardId = (command.payload as { cardId?: unknown } | undefined)?.cardId;
  if (command.actorId !== picker) return rejected("NOT_YOUR_TURN", "It is not your turn to pick a setup card.");
  if (typeof cardId !== "string" || !draft.hands[picker].includes(cardId)) {
    return rejected("INVALID_PAYLOAD", "Choose one of the cards in front of you.");
  }
  const now = command.clientTimestamp;
  // The log says who picked, never what (the picks stay private until the draft ends).
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "setup.draftPick",
    summary: `${state.players[picker].name} took a setup card.`,
  });
  const picked: GameState = {
    ...state,
    updatedAt: now,
    log: [...state.log, logEntry],
    hidden: {
      ...state.hidden,
      setupDraft: {
        ...draft,
        hands: { ...draft.hands, [picker]: draft.hands[picker].filter((id) => id !== cardId) },
        picks: { ...draft.picks, [picker]: [...draft.picks[picker], cardId] },
        queue: draft.queue.slice(1),
      },
    },
  };
  const advanced = advanceDraft(picked, command);
  return advanced.finished ?? { ok: true, logEntry, state: advanced.state };
};

function rejected(code: string, message: string): ApplyCommandResult {
  return { ok: false, errors: [{ code, message }] };
}

export const setupDraftCommandHandlers: Record<string, CommandHandler> = {
  "setup.draftPick": draftPickCommand,
};
