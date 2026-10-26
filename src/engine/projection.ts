import { blackmailCards, indiaEventTiles } from "../data";
import { effectiveDecisionActor, playerMayAnswer, systemDecisionDelegate } from "./automatic";
import {
  HIDDEN_BLACKMAIL_CARD_ID,
  HIDDEN_CARD_ID,
  HIDDEN_EVENT_TILE_ID,
  HIDDEN_ID_PREFIX,
  HIDDEN_LAW_ID,
  HIDDEN_LONDON_SEASON_CARD_ID,
  HIDDEN_PLAYER_ID,
  hiddenBlackmailInstanceId,
  hiddenTopEventTileId,
} from "./hidden";
import type { CardInstance, GameLogEntry, GameState, PendingDecision, PlayerId } from "./types";

// What one viewer of an online game may see (docs/plans/online-multiplayer.md, "projectForSeat").
// The server keeps the full state; every view it sends goes through projectForViewer. The result
// is still a GameState, so the same UI renders it, with hidden information replaced by
// placeholders from ./hidden.ts (counts stay right) and secrets dropped where a field is optional.

/** Structurally the same as `Viewer` in src/online/protocol.ts. */
export type ProjectionViewer = { kind: "seat"; playerId: PlayerId } | { kind: "spectator" };

/**
 * Decisions that are only offered because the actor holds a particular face-down blackmail card.
 * Other viewers see that someone is deciding something private, but not who (HIDDEN_PLAYER_ID) or
 * which step it is, so the step id, decision id and prompt don't name the card. That a pause
 * happens at all is unavoidable without asking every player at every such moment.
 */
export const CARD_REVEALING_STEPS: ReadonlySet<string> = new Set([
  "companyOperation.connection",
  "eventsInIndia.envoyToTheMughals",
  "hiring.hiringPreference",
  "londonSeason.resolveScandal",
  "negotiation.blackmailReaction",
  "revenue.companyFraud",
  "revenue.playScandal",
]);

/** The step a card-revealing decision shows to everyone but its actor. */
export const HIDDEN_DECISION_STEP = "hidden:private";

const BLACKMAIL_CARD_IDS = new Set(blackmailCards.map((card) => card.id));
const TILE_REGIONS = new Map(indiaEventTiles.map((tile) => [tile.id, tile.region]));
const HIRING_PREFERENCE = "hiring-preference";
const PRESTIGE_PICK_STEP = "londonSeason.choosePrestigeCard";

function viewerPlayerId(state: GameState, viewer: ProjectionViewer): PlayerId | undefined {
  return viewer.kind === "seat" && state.players[viewer.playerId] ? viewer.playerId : undefined;
}

function isFaceDown(card: CardInstance): boolean {
  return card.facedown !== false;
}

/**
 * A GameState-shaped copy of `state` holding only what `viewer` may see:
 * - no RNG seed or internal state (the counter stays: it only counts rolls everyone saw), and no
 *   seed or shuffle rolls in the log;
 * - draw piles (law deck, London Season deck, Events in India stack, other decks, the Crown's AI
 *   deck) as placeholders, so only their sizes show; the top event tile keeps its region side and
 *   the top AI card its back (both are face up on the table);
 * - other players' face-down blackmail as placeholder ids, wherever those ids appear (log details,
 *   transfers, deals); face-down blackmail in the London Season Display likewise, except for the
 *   player choosing from the display, who may look (p.11); blackmail in the London Season
 *   discards likewise, since it goes there unseen;
 * - only the viewer's own `hidden.privateCards` and no unrevealed firm strategies; during the setup
 *   card draft only the viewer's own hand and picks (`hidden.setupDraft`);
 * - lists that would show who holds a face-down card (Company Fraud and Scandal candidates, Envoy
 *   and Hiring Preference offers) cut down to the viewer;
 * - legal commands only for the player who must decide (spectators get none); decisions offered
 *   because of a face-down card (CARD_REVEALING_STEPS) show others a neutral step and prompt, and
 *   no actor;
 * - log entries for a declined face-down card (those with a publicSummary) show others that text,
 *   and the command's other entries no actor.
 */
export function projectForViewer(state: GameState, viewer: ProjectionViewer): GameState {
  const me = viewerPlayerId(state, viewer);
  const view = structuredClone(state) as GameState;
  const actor = effectiveDecisionActor(state);
  const iMayAct = me !== undefined && (actor === me || actor === "simultaneous" || playerMayAnswer(state, me));

  // Randomness: nobody may predict dice or reconstruct a shuffle.
  view.rng = { algorithm: view.rng.algorithm, seed: "", counter: view.rng.counter, internalState: [0, 0, 0, 0] };
  view.log = hidePrivateLogEntries(view.log.map(scrubLogEntry), me);

  hideDrawPiles(view, me);
  hidePrivateRecords(view, me);
  hideHolderHints(view, me);

  // Decisions: options only for whoever must decide.
  const delegate = systemDecisionDelegate(state);
  view.pendingDecision = projectDecision(view, view.pendingDecision, iMayAct, me);
  if (delegate) view.pendingDecision.actor = delegate;
  for (const frame of view.negotiation.interrupts) {
    frame.savedDecision = projectDecision(view, frame.savedDecision, frame.savedDecision.actor === me, me);
  }

  // Face-down identities, last: every remaining mention of a hidden card becomes its placeholder.
  // (Choosing for the Crown doesn't let you look at the display: the Crown picks by its splay slot.)
  const choosingFromDisplay = iMayAct && state.pendingDecision.actor !== "crown" && state.pendingDecision.step === PRESTIGE_PICK_STEP;
  const secrets = secretIdMap(state, me, choosingFromDisplay);
  for (const player of Object.values(view.players)) {
    player.blackmailCards = player.blackmailCards.map((card) => ({
      ...card,
      id: secrets.get(card.id) ?? card.id,
      cardId: secrets.has(card.id) ? HIDDEN_BLACKMAIL_CARD_ID : card.cardId,
    }));
  }
  return replaceSecretStrings(view, secrets) as GameState;
}

function scrubLogEntry(entry: GameLogEntry): GameLogEntry {
  if (!entry.rngRolls) return entry;
  const rolls = entry.rngRolls
    .filter((roll) => !roll.label.startsWith("shuffle"))
    .map((roll) => ({ ...roll, seed: "" }));
  return { ...entry, rngRolls: rolls.length > 0 ? rolls : undefined };
}

function hidePrivateLogEntries(log: GameLogEntry[], me: PlayerId | undefined): GameLogEntry[] {
  const hiddenFromMe = (entry: GameLogEntry) => entry.publicSummary !== undefined && entry.actor !== me;
  const privateCommands = new Set(log.filter((entry) => hiddenFromMe(entry) && entry.commandId).map((entry) => entry.commandId));
  return log.map((entry) => {
    const { publicSummary, ...rest } = entry;
    if (publicSummary !== undefined && entry.actor !== me) {
      return { ...rest, actor: undefined, summary: publicSummary, details: undefined };
    }
    if (entry.commandId && privateCommands.has(entry.commandId)) return { ...rest, actor: undefined };
    return rest;
  });
}

function placeholders(count: number, id: string): string[] {
  return Array.from({ length: count }, () => id);
}

function hideDrawPiles(view: GameState, me: PlayerId | undefined): void {
  view.parliament.lawDeck.drawPile = placeholders(view.parliament.lawDeck.drawPile.length, HIDDEN_LAW_ID);
  view.londonSeason.deck = placeholders(view.londonSeason.deck.length, HIDDEN_LONDON_SEASON_CARD_ID);

  const stack = view.eventsInIndia.drawPile;
  view.eventsInIndia.drawPile = stack.map((tileId, index) =>
    index === 0 ? hiddenTopEventTileId(TILE_REGIONS.get(tileId)) : HIDDEN_EVENT_TILE_ID,
  );

  for (const deck of Object.values(view.decks)) deck.drawPile = placeholders(deck.drawPile.length, HIDDEN_CARD_ID);
  if (view.crown) {
    // The top card's back is face up on the table (it breaks ties, p.45); the rest are hidden.
    const [top, ...rest] = view.crown.aiDeck.drawPile;
    view.crown.aiDeck.drawPile = top ? [top, ...placeholders(rest.length, HIDDEN_CARD_ID)] : [];
    // The setup-card draft (p.43): the undrawn cards, what the picker has drawn, and what the other
    // human has kept so far.
    const draft = view.crown.setupDraft;
    if (draft) {
      draft.deck = placeholders(draft.deck.length, HIDDEN_CARD_ID);
      if (draft.picker !== me) draft.hand = placeholders(draft.hand.length, HIDDEN_CARD_ID);
      for (const [owner, cards] of Object.entries(draft.kept)) {
        if (owner !== me && !view.players[owner]?.isCrown) draft.kept[owner] = placeholders(cards.length, HIDDEN_CARD_ID);
      }
    }
  }
  // Setup cards set aside unseen.
  for (const [deckId, deck] of Object.entries(view.decks)) {
    if (deckId.startsWith("setup-")) deck.removed = placeholders(deck.removed.length, HIDDEN_CARD_ID);
  }
}

function hidePrivateRecords(view: GameState, me: PlayerId | undefined): void {
  const hidden = view.hidden;
  hidden.privateCards = me && hidden.privateCards[me] ? { [me]: hidden.privateCards[me] } : {};
  // The setup card draft (p.5): only your own hand and picks; everyone else's show as placeholders.
  const draft = hidden.setupDraft;
  if (draft) {
    const cut = (cards: Record<PlayerId, string[]>) =>
      Object.fromEntries(Object.entries(cards).map(([id, list]) => [id, id === me ? list : placeholders(list.length, HIDDEN_CARD_ID)]));
    draft.hands = cut(draft.hands);
    draft.picks = cut(draft.picks);
    draft.removed = placeholders(draft.removed.length, HIDDEN_CARD_ID);
  }
  hidden.firmStrategySecrets = Object.fromEntries(
    Object.entries(hidden.firmStrategySecrets).map(([firmId, secret]) => [
      firmId,
      secret.committedBy === me
        ? secret
        : secret.revealed
          ? { firmId: secret.firmId, committedBy: secret.committedBy, strategy: secret.strategy, revealed: true }
          : { firmId: secret.firmId, committedBy: secret.committedBy },
    ]),
  );
}

/** State that would show who holds a face-down card of a given kind. */
function hideHolderHints(view: GameState, me: PlayerId | undefined): void {
  const onlyMe = (players: PlayerId[]) => players.filter((playerId) => playerId === me);

  const revenue = view.parliament.revenue;
  if (revenue) {
    revenue.fraudCandidates = onlyMe(revenue.fraudCandidates);
    revenue.scandalCandidates = onlyMe(revenue.scandalCandidates);
  }
  const progress = view.eventsInIndia.progress;
  if (progress) progress.envoyOffered = onlyMe(progress.envoyOffered);

  const scandal = view.londonSeason.scandal;
  if (scandal && scandal.playerId !== me) delete view.londonSeason.scandal;

  const interrupt = view.companyOperation.interrupt;
  if (interrupt?.kind === "connection" && interrupt.holder !== me) delete view.companyOperation.interrupt;

  const holdsHiringPreference =
    me !== undefined &&
    view.players[me].blackmailCards.some((card) => card.cardId === HIRING_PREFERENCE && isFaceDown(card));
  if (!holdsHiringPreference) view.hiring.hiringPreferenceOffered = [];
}

function projectDecision(
  view: GameState,
  decision: PendingDecision,
  mayAct: boolean,
  me: PlayerId | undefined,
): PendingDecision {
  if (mayAct) return decision;
  const projected: PendingDecision = { ...decision, legalCommands: [] };
  if (!CARD_REVEALING_STEPS.has(decision.step) || decision.actor === me) return projected;

  return {
    ...projected,
    crown: undefined,
    id: `${HIDDEN_ID_PREFIX}decision@${view.log.length}`,
    step: HIDDEN_DECISION_STEP,
    actor: HIDDEN_PLAYER_ID,
    visibility: "private",
    prompt: "A player is making a private decision.",
  };
}

/**
 * Real id -> placeholder for everything this viewer may not identify: other players' face-down
 * blackmail (instance ids and card ids), and face-down blackmail in the London Season Display
 * unless the viewer is choosing from it.
 */
function secretIdMap(state: GameState, me: PlayerId | undefined, choosingFromDisplay: boolean): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const [ownerId, player] of Object.entries(state.players)) {
    if (ownerId === me) continue;
    player.blackmailCards.filter(isFaceDown).forEach((card, index) => {
      secrets.set(card.id, hiddenBlackmailInstanceId(ownerId, index));
      secrets.set(card.cardId, HIDDEN_BLACKMAIL_CARD_ID);
    });
  }
  if (!choosingFromDisplay) {
    for (const cardId of state.londonSeason.display) {
      if (BLACKMAIL_CARD_IDS.has(cardId)) secrets.set(cardId, HIDDEN_BLACKMAIL_CARD_ID);
    }
  }
  // Blackmail goes to the London Season discards unseen (the engine logs it as "a face-down
  // blackmail card"), so its identity stays hidden there too, with its instance id.
  for (const cardId of state.londonSeason.discard) {
    if (!BLACKMAIL_CARD_IDS.has(cardId)) continue;
    secrets.set(cardId, HIDDEN_BLACKMAIL_CARD_ID);
    secrets.set(`blackmail-${cardId}`, HIDDEN_BLACKMAIL_CARD_ID);
  }
  return secrets;
}

/**
 * Face-down blackmail cards this viewer can identify: their own, plus the display's while they
 * choose from it. Online undo uses it: a move after which someone could identify a card they
 * couldn't before (a gift, a peek at the display) can't be taken back.
 */
export function identifiableFaceDownCards(state: GameState, viewer: ProjectionViewer): Set<string> {
  const me = viewerPlayerId(state, viewer);
  const known = new Set<string>();
  if (!me) return known;
  for (const card of state.players[me].blackmailCards.filter(isFaceDown)) known.add(card.cardId);
  const actor = effectiveDecisionActor(state);
  if ((actor === me || actor === "simultaneous") && state.pendingDecision.actor !== "crown" && state.pendingDecision.step === PRESTIGE_PICK_STEP) {
    for (const cardId of state.londonSeason.display) if (BLACKMAIL_CARD_IDS.has(cardId)) known.add(cardId);
  }
  return known;
}

/** Instance ids ("blackmail-<cardId>") are distinctive enough to replace inside longer strings too. */
function replaceSecretStrings(value: unknown, secrets: Map<string, string>): unknown {
  if (secrets.size === 0) return value;
  const instanceIds = [...secrets.keys()].filter((id) => id.startsWith("blackmail-"));

  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      const exact = secrets.get(node);
      if (exact !== undefined) return exact;
      if (!node.includes("blackmail-")) return node;
      return instanceIds.reduce((text, id) => text.split(id).join(secrets.get(id) as string), node);
    }
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = visit(record[key]);
      return record;
    }
    return node;
  };
  return visit(value);
}

/**
 * The reverse of the blackmail placeholders, for commands a viewer sends back: another player's
 * "hidden:blackmail@player-2#1" in a payload (asking for that card in a deal) becomes the real
 * instance id. Anything else is returned unchanged.
 */
export function resolveHiddenIds(state: GameState, viewer: ProjectionViewer, payload: unknown): unknown {
  const me = viewerPlayerId(state, viewer);
  const real = new Map<string, string>();
  for (const [ownerId, player] of Object.entries(state.players)) {
    if (ownerId === me) continue;
    player.blackmailCards.filter(isFaceDown).forEach((card, index) => {
      real.set(hiddenBlackmailInstanceId(ownerId, index), card.id);
    });
  }
  if (real.size === 0) return payload;

  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return real.get(node) ?? node;
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, item]) => [key, visit(item)]));
    }
    return node;
  };
  return visit(payload);
}

/**
 * The payload to apply for an option a viewer picked from their projected decision. Options of the
 * Crown's decisions can mention cards the viewer may not identify (a face-down blackmail card the
 * Crown takes from the London Season Display, p.45); the viewer sends the placeholder back, and
 * this finds the real option at the same place in the list. Falls back to resolveHiddenIds.
 */
export function resolveDecisionOption(state: GameState, viewer: ProjectionViewer, type: string, payload: unknown): unknown {
  const shown = projectForViewer(state, viewer).pendingDecision.legalCommands;
  const wanted = JSON.stringify(payload ?? {});
  const index = shown.findIndex((legal) => legal.type === type && JSON.stringify(legal.payload ?? {}) === wanted);
  const real = index >= 0 ? state.pendingDecision.legalCommands[index] : undefined;
  return real ? (real.payload ?? {}) : resolveHiddenIds(state, viewer, payload);
}
