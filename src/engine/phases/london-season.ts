import type { CommandHandler } from "../command-handler";
import { blackmailCards, prestigeCards } from "../../data";
import type { BlackmailCard, CardEffect, PrestigeCard } from "../../data";
import { rollDie, shuffle } from "../rng";
import { chairmanHolder, officeDefinition, playerHasPrestigeCard, playerSpouses, playerWindowIcons, primeMinisterOrder } from "../selectors";
import type {
  ApplyCommandResult,
  CardInstance,
  GameCommand,
  GameState,
  LegalCommand,
  OfficeId,
  PendingDecision,
  PlayerId,
  PlayerState,
  RngRollRecord,
} from "../types";
import { startFamilyPhase } from "./family";
import { okResult, prestigePickTakenBy, promiseGrantFor, removePromiseFromGame, usePromiseGrant } from "./negotiation";
import {
  blackmailOptionsForCard,
  facedownBlackmailInstance,
  registerBlackmailResume,
  registerInFlowBlackmail,
  startBlackmailPlay,
} from "./negotiation-blackmail";
import { finishFinalScoringAfterRetirements } from "./final-scoring";
import {
  advanceRetirements,
  applyRetirementCommand,
  beginRetirements,
  findLegalCommand,
  illegal,
  LETTERS_OF_INTRODUCTION,
  prestigeCardName,
  resolveOfficeAttrition,
  returnPensionersToSupply,
} from "./retirements";
import { createCommandLogEntry, firstHumanActor, noHumanActor, wrongPhase } from "./shared";

// I. The London Season (pp.11-12): Attrition, Retirements, and Prestige Cards.

const DISPLAY_SIZE = 3;
const BECKY_SHARP = "becky-sharp";
const ESTHER_SUMMERSON = "esther-summerson";
const JOSEPH_SEDLEY = "joseph-sedley";

const prestigeById = new Map<string, PrestigeCard>(prestigeCards.map((card) => [card.id, card]));
const blackmailById = new Map<string, BlackmailCard>(blackmailCards.map((card) => [card.id, card]));

type StepResult = { state: GameState; summary: string; details?: unknown; rolls?: RngRollRecord[] };

// --- Setup: blackmail for setup cards, then the London Season Display (setup steps 10-12) ---

function ownedCardIds(state: GameState): Set<string> {
  return new Set(
    Object.values(state.players).flatMap((player) => [
      ...player.prestigeCards.map((card) => card.cardId),
      ...player.blackmailCards.map((card) => card.cardId),
    ]),
  );
}

/** A setup card's "Random Blackmail Card": drawn from the blackmail cards before the display is built. */
export function drawSetupBlackmail(state: GameState, playerId: PlayerId, count: number): GameState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    const owned = ownedCardIds(next);
    const remaining = blackmailCards.filter((card) => !owned.has(card.id));
    if (remaining.length === 0) break;

    let pick = 0;
    let rng = next.rng;
    if (remaining.length > 1) {
      const roll = rollDie(rng, remaining.length, "setup.randomBlackmail");
      rng = roll.rng;
      pick = roll.value - 1;
    }
    const card = remaining[pick];
    const player = next.players[playerId];
    next = {
      ...next,
      rng,
      players: {
        ...next.players,
        [playerId]: {
          ...player,
          blackmailCards: [...player.blackmailCards, { id: `blackmail-${card.id}`, cardId: card.id, facedown: true }],
        },
      },
    };
  }

  return next;
}

/** "Shuffle the prestige cards and blackmail cards together and deal three" (setup step 12). */
export function buildLondonSeasonDisplay(state: GameState): GameState {
  if (state.londonSeason.displayBuilt) return state;

  const owned = ownedCardIds(state);
  const pool = [...prestigeCards.map((card) => card.id), ...blackmailCards.map((card) => card.id)].filter(
    (cardId) => !owned.has(cardId),
  );
  const shuffled = shuffle(state.rng, pool);

  return {
    ...state,
    rng: shuffled.rng,
    londonSeason: {
      ...state.londonSeason,
      deck: shuffled.items.slice(DISPLAY_SIZE),
      display: shuffled.items.slice(0, DISPLAY_SIZE),
      discard: [],
      displayBuilt: true,
    },
  };
}

// --- Phase entry ---

export function confirmLondonSeason(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "londonSeason" || state.pendingDecision.step !== "londonSeason.confirm") {
    return wrongPhase("London Season confirmation can only be chosen at the start of the London Season.");
  }

  const now = command.clientTimestamp;
  if (!firstHumanActor(state)) {
    return noHumanActor("Cannot advance London Season because there is no human player.");
  }

  // "This phase is skipped on the game's first turn" (p.11): the scenario's start turn.
  if (state.turn === state.startTurn) {
    return finishCommand(
      state,
      command,
      now,
      "londonSeason.skipped",
      {
        state: startFamilyPhase(state),
        summary: `London Season skipped on the scenario's first turn (turn ${state.turn}).`,
        details: { note: "Rules skip London Season on the game's first turn (p.11)." },
      },
    );
  }

  // The display was built during setup (setup.confirmStart); states that skipped setup have none.
  let next = state;
  const attrition = resolveOfficeAttrition(next, "londonSeason.attrition");
  next = beginRetirements(attrition.state, "londonSeason");
  const advanced = continueLondonSeason(next);

  return finishCommand(state, command, now, "londonSeason.confirmed", {
    state: advanced,
    summary:
      attrition.retiredOffices.length > 0
        ? `London Season retired ${attrition.retiredOffices.length} officeholder(s).`
        : "London Season resolved with no retirements.",
    details: {
      attritionedOffices: attrition.attritionedOffices,
      retiredOffices: attrition.retiredOffices,
    },
    rolls: attrition.rolls,
  });
}

/**
 * Runs the London Season forward to its next decision: retirements, then any pending spouse
 * restriction or Scandal choice, then each Prestige Cards pick, then the end of the season.
 */
function continueLondonSeason(state: GameState): GameState {
  if (state.londonSeason.retirement) {
    const advanced = advanceRetirements(state);
    if (advanced.decision) return { ...advanced.state, pendingDecision: advanced.decision };
    return continueLondonSeason(beginPrestigeCards(advanced.state));
  }

  if (state.londonSeason.restriction) {
    const decision = restrictionDecision(state);
    if (decision) return { ...state, pendingDecision: decision };
    return continueLondonSeason({ ...state, londonSeason: { ...state.londonSeason, restriction: undefined } });
  }

  if (state.londonSeason.scandal) {
    return { ...state, pendingDecision: scandalDecision(state) };
  }

  const prestige = state.londonSeason.prestige;
  if (prestige && prestige.current < prestige.order.length && state.londonSeason.display.length > 0) {
    return { ...state, pendingDecision: prestigeDecision(state, prestige.order[prestige.current]) };
  }

  return startFamilyPhase(finishLondonSeason(state));
}

// --- Prestige Cards (p.12) ---

/**
 * "Beginning with the player who spent the most total cash on retirements this turn, each player
 * who retired at least one pensioner ... must take or discard one card." Ties: most window icons
 * (including this turn's retirements), then Prime Minister order.
 */
function beginPrestigeCards(state: GameState): GameState {
  const progress = state.londonSeason.retirement;
  const pmOrder = primeMinisterOrder(state);
  const order = [...(progress?.retired ?? [])].sort(
    (left, right) =>
      (progress?.spending[right] ?? 0) - (progress?.spending[left] ?? 0) ||
      playerWindowIcons(state, right) - playerWindowIcons(state, left) ||
      pmOrder.indexOf(left) - pmOrder.indexOf(right),
  );

  return {
    ...state,
    londonSeason: { ...state.londonSeason, retirement: undefined, prestige: { order, current: 0 } },
  };
}

function forbidsHolding(state: GameState, playerId: PlayerId, holding: "blackmail" | "workshop" | "shipyard" | "companyShare"): boolean {
  return playerSpouses(state, playerId).some((spouse) =>
    spouse.effects.some((effect) => effect.type === "forbidHolding" && effect.holding === holding),
  );
}

function prestigeDecision(state: GameState, playerId: PlayerId): PendingDecision {
  const player = state.players[playerId];
  const display = state.londonSeason.display;
  const noBlackmail = forbidsHolding(state, playerId, "blackmail");
  const legalCommands: LegalCommand[] = [];

  display.forEach((cardId, slot) => {
    const prestige = prestigeById.get(cardId);
    const name = prestige ? `${prestige.name} (${prestige.prestigeType})` : `face-down blackmail: ${prestigeCardName(cardId)}`;
    if (prestige || !noBlackmail) {
      legalCommands.push({
        type: "londonSeason.choosePrestigeCard",
        label: `Take ${name}`,
        payload: { action: "take", slot, cardId },
      });
    }
  });
  display.forEach((cardId, slot) => {
    const name = prestigeById.get(cardId)?.name ?? `face-down blackmail: ${prestigeCardName(cardId)}`;
    legalCommands.push({
      type: "londonSeason.choosePrestigeCard",
      label: `Discard ${name}`,
      payload: { action: "discard", slot, cardId },
    });
  });

  // Becky Sharp: "you may take a card from the top of the deck instead as long as there is at
  // least one card in the display." Offered whatever the top card is, so the option itself never
  // hints at a hidden card; Esther Summerson's restriction applies when the card is drawn.
  if (playerHasPrestigeCard(state, playerId, BECKY_SHARP) && state.londonSeason.deck.length > 0) {
    legalCommands.push({
      type: "londonSeason.choosePrestigeCard",
      label: "Take the top card of the deck (Becky Sharp)",
      payload: { action: "takeTopOfDeck" },
    });
  }

  // A called-in "Take my card from the London Season Display" promise: its holder makes this pick.
  const taker = prestigePickTakenBy(state, playerId) ?? playerId;

  return {
    id: `decision-london-season-prestige-t${state.turn}-${playerId}-${state.log.length + 1}`,
    phase: "londonSeason",
    step: "londonSeason.choosePrestigeCard",
    actor: taker,
    visibility: "private",
    prompt: `${player.name}: take or discard one card from the London Season Display. You may look at face-down blackmail.`,
    legalCommands,
    canSave: true,
  };
}

function choosePrestigeCard(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.pendingDecision.step !== "londonSeason.choosePrestigeCard") {
    return wrongPhase("No Prestige Cards choice is pending.");
  }
  if (!findLegalCommand(state, command)) return illegal("That card choice is not one of the listed choices.");

  const prestige = state.londonSeason.prestige!;
  const guarantor = prestige.order[prestige.current];
  // The pick may belong to a promise holder (see prestigeDecision); they take the card.
  const playerId = state.pendingDecision.actor as PlayerId;
  const grant = playerId !== guarantor ? promiseGrantFor(state, "take-my-card-from-london-season-display", playerId, guarantor) : undefined;
  const payload = command.payload as { action: "take" | "discard" | "takeTopOfDeck"; slot?: number; cardId?: string };
  let next: GameState = {
    ...(grant ? usePromiseGrant(state, grant.id) : state),
    londonSeason: { ...state.londonSeason, prestige: { ...prestige, current: prestige.current + 1 } },
  };
  let summary: string;
  let details: unknown;

  if (payload.action === "discard") {
    const display = [...next.londonSeason.display];
    const [cardId] = display.splice(payload.slot as number, 1);
    next = { ...next, londonSeason: { ...next.londonSeason, display, discard: [...next.londonSeason.discard, cardId] } };
    summary = `${state.players[playerId].name} discarded ${publicCardName(cardId)} from the London Season Display.`;
    details = { playerId, discarded: prestigeById.has(cardId) ? cardId : "blackmail" };
  } else {
    let cardId: string;
    if (payload.action === "takeTopOfDeck") {
      [cardId] = next.londonSeason.deck;
      next = { ...next, londonSeason: { ...next.londonSeason, deck: next.londonSeason.deck.slice(1) } };
      // Esther Summerson (#12): "You may no longer take or own blackmail cards." A blackmail drawn
      // with Becky Sharp can't be kept, so it is discarded and this pick is spent.
      if (!prestigeById.has(cardId) && forbidsHolding(next, playerId, "blackmail")) {
        next = { ...next, londonSeason: { ...next.londonSeason, discard: [...next.londonSeason.discard, cardId] } };
        return finishCommand(state, command, command.clientTimestamp, "londonSeason.prestigeCardChosen", {
          state: continueLondonSeason(next),
          summary: `${state.players[playerId].name} drew a face-down blackmail card from the top of the deck but cannot take blackmail (Esther Summerson), so it is discarded.`,
          details: { playerId, discarded: "blackmail", source: "topOfDeck" },
        });
      }
    } else {
      const display = [...next.londonSeason.display];
      [cardId] = display.splice(payload.slot as number, 1);
      next = { ...next, londonSeason: { ...next.londonSeason, display } };
    }
    next = takeCard(next, playerId, cardId);
    summary = `${state.players[playerId].name} took ${publicCardName(cardId)}${payload.action === "takeTopOfDeck" ? " from the top of the deck" : ""}.`;
    details = { playerId, took: prestigeById.has(cardId) ? cardId : "blackmail" };
  }

  return finishCommand(state, command, command.clientTimestamp, "londonSeason.prestigeCardChosen", {
    state: continueLondonSeason(next),
    summary,
    details,
  });
}

/** Blackmail identities stay hidden in public log text. */
function publicCardName(cardId: string): string {
  return prestigeById.get(cardId)?.name ?? "a face-down blackmail card";
}

/** Adds a taken card to the player's area and applies its on-take effects (p.12, card text). */
function takeCard(state: GameState, playerId: PlayerId, cardId: string): GameState {
  const player = state.players[playerId];
  const prestige = prestigeById.get(cardId);

  if (!prestige) {
    const instance: CardInstance = { id: `blackmail-${cardId}`, cardId, facedown: true };
    const next = updatePlayer(state, playerId, { blackmailCards: [...player.blackmailCards, instance] });
    // Scandal blackmails may be played "when taken from the display".
    if (blackmailById.get(cardId)?.timing === "whenTakenOrAnytimeAfterRevenuePhase") {
      return { ...next, londonSeason: { ...next.londonSeason, scandal: { playerId, cardInstanceId: instance.id, cardId } } };
    }
    return next;
  }

  let next = updatePlayer(state, playerId, {
    prestigeCards: [...player.prestigeCards, { id: `prestige-${cardId}`, cardId }],
    victoryPoints: player.victoryPoints + prestige.victoryPoints,
  });

  if (prestige.prestigeType !== "spouse") return next;

  for (const effect of prestige.effects) next = applySpouseEffect(next, playerId, prestige, effect);
  if (cardId === JOSEPH_SEDLEY) next = sedleyLeavesChairman(next, playerId);
  if (cardId === ESTHER_SUMMERSON) next = discardFaceUpBlackmail(next, playerId);
  // Lady Newcome: "Your 'Vote with my enterprises' promise is removed from the game."
  if (cardId === "lady-newcome") next = removePromiseFromGame(next, playerId, "vote-with-my-enterprises");

  if (restrictedHoldings(next, playerId).length > 0) {
    next = { ...next, londonSeason: { ...next.londonSeason, restriction: { playerId, spouseCardId: cardId } } };
  }

  return next;
}

function applySpouseEffect(state: GameState, playerId: PlayerId, _spouse: PrestigeCard, effect: CardEffect): GameState {
  if (effect.type === "removeOpportunityMarker") {
    return updatePlayer(state, playerId, { opportunityMarker: "removed" });
  }
  return state;
}

/** Joseph Sedley: "If you are Chairman, move your family member back into the Court as a share and vacate the office." */
function sedleyLeavesChairman(state: GameState, playerId: PlayerId): GameState {
  // "Any shares you have must be traded or removed": pieces waiting on the Stock Exchange return
  // to supply (Court shares are handled by the restriction step).
  const waiting = state.company.stockExchange.filter((slot) => slot.share?.owner === playerId);
  if (waiting.length > 0) {
    const owner = state.players[playerId];
    state = {
      ...updatePlayer(state, playerId, {
        familyMembers: { ...owner.familyMembers, supply: owner.familyMembers.supply + waiting.length },
      }),
      company: {
        ...state.company,
        stockExchange: state.company.stockExchange.map((slot) =>
          slot.share?.owner === playerId ? { id: slot.id, cost: slot.cost } : slot,
        ),
      },
    };
  }
  if (chairmanHolder(state) !== playerId) return state;

  const office = state.company.offices.chairman;
  return {
    ...state,
    company: {
      ...state.company,
      court: [...state.company.court, { id: `company-share-sedley-${state.turn}-${playerId}`, owner: playerId }],
      offices: { ...state.company.offices, chairman: { ...office, holder: undefined, vacant: true, fatigue: 0 } },
      vacantOffices: [...new Set([...state.company.vacantOffices, "chairman"])],
    },
  };
}

/** Esther Summerson: "Faceup blackmail cards must be discarded." */
function discardFaceUpBlackmail(state: GameState, playerId: PlayerId): GameState {
  const player = state.players[playerId];
  const faceUp = player.blackmailCards.filter((card) => card.facedown === false);
  if (faceUp.length === 0) return state;

  return {
    ...updatePlayer(state, playerId, { blackmailCards: player.blackmailCards.filter((card) => card.facedown !== false) }),
    londonSeason: { ...state.londonSeason, discard: [...state.londonSeason.discard, ...faceUp.map((card) => card.cardId)] },
  };
}

// --- Spouse restrictions: forbidden holdings must be traded or discarded at once (p.12) ---

type RestrictedHolding = { kind: "blackmail" | "workshop" | "shipyard" | "companyShare"; id: string; label: string };

function restrictedHoldings(state: GameState, playerId: PlayerId): RestrictedHolding[] {
  const player = state.players[playerId];
  const holdings: RestrictedHolding[] = [];

  if (forbidsHolding(state, playerId, "blackmail")) {
    for (const card of player.blackmailCards) {
      holdings.push({ kind: "blackmail", id: card.id, label: `face-down blackmail: ${prestigeCardName(card.cardId)}` });
    }
  }
  for (const type of ["workshop", "shipyard"] as const) {
    if (!forbidsHolding(state, playerId, type)) continue;
    for (const enterprise of player.enterprises.filter((candidate) => candidate.type === type)) {
      holdings.push({ kind: type, id: enterprise.id, label: `${type} ${enterprise.cardId ?? enterprise.id}` });
    }
  }
  if (forbidsHolding(state, playerId, "companyShare")) {
    for (const share of state.company.court.filter((candidate) => candidate.owner === playerId)) {
      holdings.push({ kind: "companyShare", id: share.id, label: "Company share in the Court" });
    }
  }

  return holdings;
}

function restrictionDecision(state: GameState): PendingDecision | undefined {
  const restriction = state.londonSeason.restriction!;
  const holdings = restrictedHoldings(state, restriction.playerId);
  if (holdings.length === 0) return undefined;

  const spouse = prestigeById.get(restriction.spouseCardId);
  const player = state.players[restriction.playerId];
  const legalCommands: LegalCommand[] = holdings.map((holding) => ({
    type: "londonSeason.resolveRestriction",
    label:
      holding.kind === "companyShare"
        ? "Remove a Company share (the piece returns to supply)"
        : `Discard ${holding.label}`,
    payload: { action: "discard", kind: holding.kind, id: holding.id },
  }));
  legalCommands.push({
    type: "londonSeason.resolveRestriction",
    label: `Check again after trading (${holdings.length} forbidden holding(s) left)`,
    description: "Trade forbidden holdings to other players first if you can, then check again.",
    payload: { action: "recheck" },
  });

  return {
    id: `decision-london-season-restriction-t${state.turn}-${restriction.playerId}-${state.log.length + 1}`,
    phase: "londonSeason",
    step: "londonSeason.resolveRestriction",
    actor: restriction.playerId,
    // Choices can name face-down blackmail, which only its owner may see.
    visibility: "private",
    prompt: `${player.name}: ${spouse?.name ?? "your spouse"} forbids these holdings. Trade them now or discard them.`,
    legalCommands,
    canSave: true,
  };
}

function resolveRestriction(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.pendingDecision.step !== "londonSeason.resolveRestriction" || !state.londonSeason.restriction) {
    return wrongPhase("No spouse restriction is pending.");
  }
  if (!findLegalCommand(state, command)) return illegal("That choice is not one of the listed choices.");

  const { playerId } = state.londonSeason.restriction;
  const payload = command.payload as { action: "discard" | "recheck"; kind?: RestrictedHolding["kind"]; id?: string };
  let next = state;
  let summary = `${state.players[playerId].name} checked their forbidden holdings again.`;

  if (payload.action === "discard") {
    const player = state.players[playerId];
    switch (payload.kind) {
      case "blackmail": {
        const card = player.blackmailCards.find((candidate) => candidate.id === payload.id);
        next = updatePlayer(next, playerId, { blackmailCards: player.blackmailCards.filter((candidate) => candidate.id !== payload.id) });
        next = { ...next, londonSeason: { ...next.londonSeason, discard: [...next.londonSeason.discard, card?.cardId ?? ""] } };
        summary = `${player.name} discarded a face-down blackmail card.`;
        break;
      }
      case "workshop":
      case "shipyard":
        // The card returns to the supply. A fitted ship stays where it is (Violet Effingham, p.12).
        next = updatePlayer(next, playerId, { enterprises: player.enterprises.filter((enterprise) => enterprise.id !== payload.id) });
        summary = `${player.name} discarded a ${payload.kind}.`;
        break;
      case "companyShare":
        next = {
          ...updatePlayer(next, playerId, {
            familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 },
          }),
          company: { ...next.company, court: next.company.court.filter((share) => share.id !== payload.id) },
        };
        summary = `${player.name} removed a Company share; the piece returned to supply.`;
        break;
    }
  }

  return finishCommand(state, command, command.clientTimestamp, "londonSeason.restrictionResolved", {
    state: continueLondonSeason(next),
    summary,
    details: { playerId, ...payload },
  });
}

// --- Scandal blackmail played when taken ---

function scandalDecision(state: GameState): PendingDecision {
  const scandal = state.londonSeason.scandal!;
  const name = blackmailById.get(scandal.cardId)?.name ?? scandal.cardId;
  const legalCommands: LegalCommand[] = blackmailOptionsForCard(state, scandal.playerId, scandal.cardId).map((option) => ({
    type: "londonSeason.resolveScandal",
    label: `Play ${name}: ${option.label}`,
    payload: { action: "play", params: option.params },
  }));
  legalCommands.push({
    type: "londonSeason.resolveScandal",
    label: `Keep ${name} face down`,
    payload: { action: "keep" },
  });

  return {
    id: `decision-london-season-scandal-t${state.turn}-${scandal.playerId}-${state.log.length + 1}`,
    phase: "londonSeason",
    step: "londonSeason.resolveScandal",
    actor: scandal.playerId,
    visibility: "private",
    prompt: `${state.players[scandal.playerId].name}: play ${name} now, or keep it for later?`,
    legalCommands,
    canSave: true,
  };
}

function resolveScandal(state: GameState, command: GameCommand): ApplyCommandResult {
  const scandal = state.londonSeason.scandal;
  if (state.pendingDecision.step !== "londonSeason.resolveScandal" || !scandal) {
    return wrongPhase("No Scandal choice is pending.");
  }
  if (!findLegalCommand(state, command)) return illegal("That choice is not one of the listed choices.");

  const payload = command.payload as { action: "play" | "keep"; params?: Record<string, unknown> };
  const next: GameState = { ...state, londonSeason: { ...state.londonSeason, scandal: undefined } };

  if (payload.action === "play") {
    // Played through the shared blackmail path, so Man on the Inside may cancel it (p.12).
    return okResult(
      startBlackmailPlay(
        { ...next, updatedAt: command.clientTimestamp },
        {
          playerId: scandal.playerId,
          cardInstanceId: scandal.cardInstanceId,
          params: payload.params ?? {},
          resumeKey: SCANDAL_RESUME,
          timestamp: command.clientTimestamp,
        },
      ),
    );
  }

  return finishCommand(state, command, command.clientTimestamp, "londonSeason.scandalResolved", {
    state: continueLondonSeason(next),
    summary: `${state.players[scandal.playerId].name} kept a blackmail card.`,
    details: { playerId: scandal.playerId, ...payload },
  });
}

const SCANDAL_RESUME = "londonSeason.scandal";
registerBlackmailResume(SCANDAL_RESUME, (state) => continueLondonSeason(state));

// --- End of season ---

/** Discard the rest of the display, refill it to three, and return pensioners to supply (p.12). */
function finishLondonSeason(state: GameState): GameState {
  const season = state.londonSeason;
  const deck = [...season.deck];
  const display = deck.splice(0, DISPLAY_SIZE);

  return returnPensionersToSupply({
    ...state,
    londonSeason: {
      ...season,
      deck,
      display,
      discard: [...season.discard, ...season.display],
      retirement: undefined,
      prestige: undefined,
      restriction: undefined,
      scandal: undefined,
    },
  });
}

// --- Retirement commands (London Season and Final Scoring) ---

/** After any retirement choice: the next retirement decision, or the end of the step. */
function continueRetirements(state: GameState): GameState {
  if (state.londonSeason.retirement?.context === "finalScoring") {
    const advanced = advanceRetirements(state);
    return advanced.decision
      ? { ...advanced.state, pendingDecision: advanced.decision }
      : finishFinalScoringAfterRetirements(advanced.state);
  }
  return continueLondonSeason(state);
}

const LETTERS_RESUME = "retirement.lettersOfIntroduction";
registerInFlowBlackmail("blackmail.borrow-all-spouse-discounts", "while retiring a pensioner");

// Letters of Introduction lets its player use every other player's spouse discounts this step;
// cancelled by Man on the Inside, it does nothing (p.12).
registerBlackmailResume(LETTERS_RESUME, (state, play, outcome) => {
  const progress = state.londonSeason.retirement;
  const next =
    outcome === "resolved" && progress
      ? {
          ...state,
          londonSeason: {
            ...state.londonSeason,
            retirement: { ...progress, lettersOfIntroduction: [...progress.lettersOfIntroduction, play.playerId] },
          },
        }
      : state;
  return continueRetirements(next);
});

function retirementCommand(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.pendingDecision.step !== "retirement.retirePensioner") {
    return wrongPhase("No retirement decision is pending.");
  }

  if (command.type === "retirement.playLettersOfIntroduction") {
    const playerId = state.pendingDecision.actor as PlayerId;
    const cardInstanceId = facedownBlackmailInstance(state, playerId, LETTERS_OF_INTRODUCTION);
    if (!cardInstanceId) return illegal("You hold no face-down Letters of Introduction.");
    return okResult(
      startBlackmailPlay(
        { ...state, updatedAt: command.clientTimestamp },
        { playerId, cardInstanceId, params: {}, resumeKey: LETTERS_RESUME, timestamp: command.clientTimestamp },
      ),
    );
  }

  const applied = applyRetirementCommand(state, command);
  if (!applied.ok) return applied;
  const next = continueRetirements(applied.state);

  return finishCommand(state, command, command.clientTimestamp, "retirement.resolved", {
    state: next,
    summary: applied.summary,
    details: applied.details,
  });
}

// --- Helpers ---

function updatePlayer(state: GameState, playerId: PlayerId, changes: Partial<PlayerState>): GameState {
  return { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], ...changes } } };
}

function finishCommand(
  before: GameState,
  command: GameCommand,
  now: string,
  type: string,
  result: StepResult,
): ApplyCommandResult {
  const logEntry = createCommandLogEntry({
    // The entry belongs to the phase and turn the command was taken in.
    state: { ...result.state, phase: before.phase, turn: before.turn },
    command,
    now,
    type,
    summary: result.summary,
    details: result.details,
    rngRolls: result.rolls && result.rolls.length > 0 ? result.rolls : undefined,
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...result.state,
      updatedAt: now,
      phase: result.state.pendingDecision.phase,
      log: [...before.log, ...result.state.log.slice(before.log.length), logEntry],
    },
  };
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const londonSeasonCommandHandlers: Record<string, CommandHandler> = {
  "londonSeason.confirm": confirmLondonSeason,
  "londonSeason.choosePrestigeCard": choosePrestigeCard,
  "londonSeason.resolveRestriction": resolveRestriction,
  "londonSeason.resolveScandal": resolveScandal,
  "retirement.retirePensioner": retirementCommand,
  "retirement.playLettersOfIntroduction": retirementCommand,
  "retirement.stop": retirementCommand,
};
