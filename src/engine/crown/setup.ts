import { offices, setupCardDecks, type SetupCardDefinition, type SetupCardEffect } from "../../data";
import type { CommandHandler } from "../command-handler";
import { officeLabel } from "../offices";
import { startFamilyPhase } from "../phases/family";
import { buildLondonSeasonDisplay } from "../phases/london-season";
import { applySetupCard } from "../phases/setup";
import { createCommandLogEntry } from "../phases/shared";
import { shuffle } from "../rng";
import type { ApplyCommandResult, CrownSetupDraftState, GameState, PendingDecision, PlayerId } from "../types";
import {
  appendCrownLog,
  climateFromCard,
  climateName,
  CROWN_PLAYER_ID,
  crownDirection,
  faceUpAiCard,
  humanPlayerIds,
} from "./state";

// Setup with the Crown (rulebook pp.43-44). Only the 1710 setup cards are transcribed, so Crown
// games run in 1710 and Long 1710 (which deals the 1710 cards).
//
// Solo: draw 3, keep 1, the Crown takes the other 2; four times (4 cards and 8). Two players: each
// draws 3, keeps 2 and gives the third to the Crown; twice each (4 cards each, 4 for the Crown).
// Random variant: deal 4 to each player and the rest to the Crown. Expert gives the Crown 3 extra
// setup cards; we draw them from the 5-6 player extras.

const SETUP_DECK_ID = "1710";

export function crownStartDecision(firstHuman: PlayerId): PendingDecision {
  return {
    id: "decision-setup-confirm-start",
    phase: "setup",
    step: "setup.confirmCrownStart",
    actor: firstHuman,
    visibility: "public",
    prompt: "How should the setup cards be shared out with the Crown?",
    legalCommands: [
      {
        type: "setup.crownStart",
        label: "Draft the setup cards",
        description: "Draw three at a time and choose which the Crown gets (rulebook pp.43-44).",
        payload: { variant: "draft" },
      },
      {
        type: "setup.crownStart",
        label: "Deal the setup cards at random",
        description: "The variant: four for each player, the rest to the Crown.",
        payload: { variant: "random" },
      },
    ],
    canSave: true,
  };
}

function setupDeck(): SetupCardDefinition[] {
  const deck = setupCardDecks.find((candidate) => candidate.id === SETUP_DECK_ID);
  if (!deck) throw new Error("The 1710 setup cards are not encoded.");
  return deck.cards;
}

function cardById(cardId: string): SetupCardDefinition {
  const card = setupDeck().find((candidate) => candidate.id === cardId);
  if (!card) throw new Error(`Unknown setup card "${cardId}".`);
  return card;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const seaName = (zone: string) => zone.split("-").map(capitalize).join(" ");

function describeEffect(effect: SetupCardEffect): string {
  switch (effect.type) {
    case "cash":
      return `£${effect.amount}`;
    case "office":
      return officeLabel(effect.officeId);
    case "companyShare":
      return `${effect.count} Company share${effect.count === 1 ? "" : "s"}`;
    case "primeMinister":
      return "Prime Minister";
    case "randomBlackmail":
      return `${effect.count} blackmail card${effect.count === 1 ? "" : "s"}`;
    case "writer":
      return `${effect.count} writer${effect.count === 1 ? "" : "s"} in ${capitalize(effect.presidency)}`;
    case "commander":
      return `Commander of the ${capitalize(effect.army)} Army`;
    case "officersInTraining":
      return `${effect.count} officer${effect.count === 1 ? "" : "s"}-in-training`;
    case "officer":
      return `${effect.count} officer${effect.count === 1 ? "" : "s"} in the ${capitalize(effect.army)} Army`;
    case "shipyard":
      return `${effect.count} shipyard${effect.count === 1 ? "" : "s"}${effect.ship.status === "placed" ? ` (ship in the ${seaName(effect.ship.seaZone)} Ocean)` : ""}`;
    case "luxury":
      return `${effect.count} luxur${effect.count === 1 ? "y" : "ies"}`;
    case "workshop":
      return `${effect.count} workshop${effect.count === 1 ? "" : "s"}`;
    case "trophy":
      return `${effect.count} troph${effect.count === 1 ? "y" : "ies"}`;
  }
}

export function setupCardLabel(cardId: string): string {
  return cardById(cardId).effects.map(describeEffect).join(", ");
}

const startCommand: CommandHandler = (state, command) => {
  if (!state.crown || state.phase !== "setup") return rejected("WRONG_PHASE", "Setup has already finished.");
  const variant = (command.payload as { variant?: unknown } | undefined)?.variant === "random" ? "random" : "draft";
  const now = command.clientTimestamp;
  const cards = setupDeck();
  const base = shuffle(state.rng, cards.filter((card) => !card.extra).map((card) => card.id));
  let rng = base.rng;
  const humans = humanPlayerIds(state);
  const kept: Record<PlayerId, string[]> = Object.fromEntries([...humans, CROWN_PLAYER_ID].map((id) => [id, []]));
  const removed: string[] = [];

  const extras = shuffle(rng, cards.filter((card) => card.extra).map((card) => card.id));
  rng = extras.rng;
  if (state.crown.difficulty === "expert") kept[CROWN_PLAYER_ID].push(...extras.items.slice(0, 3));
  removed.push(...extras.items.slice(state.crown.difficulty === "expert" ? 3 : 0));

  let next: GameState = { ...state, rng, updatedAt: now };
  const logEntry = createCommandLogEntry({
    state: next,
    command,
    now,
    type: "setup.crownStart",
    summary:
      variant === "draft"
        ? "The setup cards will be drafted with the Crown."
        : "The setup cards were dealt at random with the Crown.",
  });
  next = { ...next, log: [...next.log, logEntry] };

  if (variant === "random") {
    let deck = base.items;
    for (const playerId of humans) {
      kept[playerId].push(...deck.slice(0, 4));
      deck = deck.slice(4);
    }
    kept[CROWN_PLAYER_ID].push(...deck);
    return { ok: true, logEntry, state: finishCrownSetup(next, kept, removed, now) };
  }

  const queue = humans.length === 1 ? [humans[0], humans[0], humans[0], humans[0]] : [humans[0], humans[1], humans[0], humans[1]];
  const [picker, ...rest] = queue;
  const draft: CrownSetupDraftState = {
    deck: base.items.slice(3),
    hand: base.items.slice(0, 3),
    picker,
    queue: rest,
    kept,
  };
  next = { ...next, crown: { ...next.crown!, setupDraft: draft }, decks: { ...next.decks, "setup-1710": { drawPile: [], discardPile: [], removed } } };
  return { ok: true, logEntry, state: { ...next, pendingDecision: draftDecision(next) } };
};

function draftDecision(state: GameState): PendingDecision {
  const draft = state.crown!.setupDraft!;
  const solo = humanPlayerIds(state).length === 1;
  const picks = 4 - draft.queue.length;
  return {
    id: `decision-crown-draft-${picks}`,
    phase: "setup",
    step: "setup.crownDraftPick",
    actor: draft.picker,
    visibility: "private",
    prompt: solo
      ? `Setup cards, round ${picks} of 4: you drew three. Keep one; the Crown takes the other two.`
      : `Setup cards, round ${Math.ceil(picks / 2)} of 2: you drew three. Give one to the Crown and keep the other two.`,
    legalCommands: draft.hand.map((cardId) => ({
      type: "setup.crownDraftPick",
      label: solo ? `Keep: ${setupCardLabel(cardId)}` : `Give the Crown: ${setupCardLabel(cardId)}`,
      payload: { cardId },
    })),
    canSave: true,
  };
}

const draftPickCommand: CommandHandler = (state, command) => {
  const draft = state.crown?.setupDraft;
  if (!draft) return rejected("WRONG_PHASE", "No setup card draft is running.");
  const cardId = (command.payload as { cardId?: unknown } | undefined)?.cardId;
  if (typeof cardId !== "string" || !draft.hand.includes(cardId)) return rejected("INVALID_PAYLOAD", "Choose one of the drawn cards.");
  const now = command.clientTimestamp;
  const solo = humanPlayerIds(state).length === 1;
  const others = draft.hand.filter((id) => id !== cardId);
  const kept = { ...draft.kept };
  const picker = draft.picker;
  kept[picker] = [...kept[picker], ...(solo ? [cardId] : others)];
  kept[CROWN_PLAYER_ID] = [...kept[CROWN_PLAYER_ID], ...(solo ? others : [cardId])];

  const name = state.players[picker].name;
  const crownGets = solo ? others : [cardId];
  const logEntry = createCommandLogEntry({
    state,
    command,
    now,
    type: "setup.crownDraftPick",
    summary: `${name} gave the Crown ${crownGets.map(setupCardLabel).map((label) => `[${label}]`).join(" and ")}.`,
  });
  let next: GameState = { ...state, updatedAt: now, log: [...state.log, logEntry] };

  if (draft.queue.length === 0) {
    const removed = next.decks["setup-1710"]?.removed ?? [];
    next = { ...next, crown: { ...next.crown!, setupDraft: undefined } };
    return { ok: true, logEntry, state: finishCrownSetup(next, kept, removed, now) };
  }
  const [nextPicker, ...queue] = draft.queue;
  next = {
    ...next,
    crown: {
      ...next.crown!,
      setupDraft: { deck: draft.deck.slice(3), hand: draft.deck.slice(0, 3), picker: nextPicker, queue, kept },
    },
  };
  return { ok: true, logEntry, state: { ...next, pendingDecision: draftDecision(next) } };
};

/**
 * Applies everyone's setup cards, seats the Crown (p.43), sets the climate from the face-up AI card
 * and hands out the Player Button (p.44), then play starts with Family (the London Season is skipped
 * on the first turn, p.11).
 */
export function finishCrownSetup(state: GameState, kept: Record<PlayerId, string[]>, removed: string[], now: string): GameState {
  let next = state;
  for (const [playerId, cardIds] of Object.entries(kept)) {
    for (const cardId of cardIds) next = applySetupCard(next, playerId, cardById(cardId));
  }
  next = {
    ...next,
    decks: {
      ...next.decks,
      "setup-1710": { drawPile: [], discardPile: Object.values(kept).flat(), removed },
    },
  };
  next = seatTheCrown(next);

  const card = faceUpAiCard(next);
  const climate = climateFromCard(next, card);
  next = { ...next, crown: { ...next.crown!, climate } };
  const summary = [`The Crown's AI card ${card.number} (${card.criterion}) sets the climate to ${climateName(climate)}.`];
  const humans = humanPlayerIds(next);
  if (humans.length === 2) {
    // The finger points left (clockwise) or right of the Crown.
    const crownSeat = next.seatingOrder.indexOf(CROWN_PLAYER_ID);
    const step = crownDirection(next) === "clockwise" ? 1 : -1;
    const seats = next.seatingOrder.length;
    const holder = next.seatingOrder[(crownSeat + step + seats) % seats];
    next = { ...next, crown: { ...next.crown!, playerButton: { holder } } };
    summary.push(`${next.players[holder].name} takes the Player Button.`);
  }
  next = appendCrownLog(next, {
    now,
    type: "crown.setup",
    summary: summary.join(" "),
    details: { kept, seatingOrder: next.seatingOrder, climate },
  });
  return startFamilyPhase(buildLondonSeasonDisplay(next));
}

/**
 * "The Crown sits last in order in respect to whoever was Chairman during setup, or before whichever
 * player is next in the order of offices if the Crown is themselves the Chairman" (p.43).
 */
function seatTheCrown(state: GameState): GameState {
  const humans = humanPlayerIds(state);
  const ribbon = offices
    .filter((office) => office.operationOrder !== undefined)
    .sort((a, b) => (a.operationOrder ?? 0) - (b.operationOrder ?? 0))
    .map((office) => state.company.offices[office.id]?.holder);
  const leader = ribbon.find((holder) => holder && holder !== CROWN_PLAYER_ID) ?? humans[0];
  const start = humans.indexOf(leader);
  const ordered = start <= 0 ? humans : [...humans.slice(start), ...humans.slice(0, start)];
  return { ...state, seatingOrder: [...ordered, CROWN_PLAYER_ID] };
}

function rejected(code: string, message: string): ApplyCommandResult {
  return { ok: false, errors: [{ code, message }] };
}

export const crownSetupCommandHandlers: Record<string, CommandHandler> = {
  "setup.crownStart": startCommand,
  "setup.crownDraftPick": draftPickCommand,
};
