import { blackmailCards, offices, powerTrack, type PowerTargetId } from "../../data";
import type { CommandHandler } from "../command-handler";
import { powerMarkerPositions, withPowerMarkerPositions } from "../selectors";
import type { GameState, OfficeId, PendingDecision, PhaseId, PlayerId, RegionId } from "../types";
import {
  activeInterrupt,
  appendLog,
  gameOverReason,
  moveBlackmailCard,
  nextNegotiationId,
  okResult,
  popInterrupt,
  pushInterrupt,
  refreshPendingDecision,
  rejected,
} from "./negotiation";
import type { BlackmailPlay, InterruptFrame } from "./negotiation.state";

// Blackmail cards (p.12): one-time effects. Playing a card turns it face up in its owner's play
// area, where it can no longer be transferred but still counts for power at the end (p.9).
// Man on the Inside may cancel any blackmail as it is played.

export type BlackmailOption = {
  label: string;
  params: Record<string, unknown>;
};

export type BlackmailHandler = {
  /**
   * Why this card cannot be played right now as an anytime command, or undefined if it can.
   * Cards played inside another area's flow (after a Trade check, during hiring, ...) return a
   * reason here and are started by that area through startBlackmailPlay.
   */
  anytimeUnavailableReason(state: GameState, playerId: PlayerId): string | undefined;
  /** Every concrete way to play the card now. An empty list means it would have no effect. */
  options(state: GameState, playerId: PlayerId): BlackmailOption[];
  resolve(state: GameState, playerId: PlayerId, params: Record<string, unknown>): { state: GameState; summary: string };
};

const blackmailHandlers = new Map<string, BlackmailHandler>();

/** Register the effect for a blackmail card's effectHandler id (see src/data/cards.ts). */
export function registerBlackmailHandler(effectHandler: string, handler: BlackmailHandler): void {
  blackmailHandlers.set(effectHandler, handler);
}

/** What happens after an in-flow play resolves or is cancelled; the owning area registers it. */
export type BlackmailResume = (state: GameState, play: BlackmailPlay, outcome: "resolved" | "canceled") => GameState;

const blackmailResumes = new Map<string, BlackmailResume>();

export function registerBlackmailResume(key: string, resume: BlackmailResume): void {
  blackmailResumes.set(key, resume);
}

const cardById = new Map(blackmailCards.map((card) => [card.id, card]));

function playerName(state: GameState, playerId: PlayerId): string {
  return state.players[playerId]?.name ?? playerId;
}

export function blackmailCardName(cardId: string): string {
  return cardById.get(cardId)?.name ?? "Unknown blackmail";
}

function handlerFor(cardId: string): BlackmailHandler | undefined {
  const card = cardById.get(cardId);
  return card ? blackmailHandlers.get(card.effectHandler) : undefined;
}

export type BlackmailPlayChoice = {
  cardInstanceId: string;
  cardId: string;
  name: string;
  /** Set when the card cannot be played as an anytime command now. */
  unavailableReason?: string;
  options: BlackmailOption[];
};

/** The owner's face-down blackmail cards and how each can be played now; for the UI and harness. */
export function blackmailPlayChoices(state: GameState, playerId: PlayerId): BlackmailPlayChoice[] {
  const over = gameOverReason(state);
  return state.players[playerId].blackmailCards
    .filter((card) => card.facedown)
    .map((card) => {
      const handler = handlerFor(card.cardId);
      const reason =
        over ??
        (activeInterrupt(state) ? "Another player's response is pending." : undefined) ??
        (handler
          ? handler.anytimeUnavailableReason(state, playerId)
          : `${blackmailCardName(card.cardId)} is played during another step of the game.`);
      const options = reason || !handler ? [] : handler.options(state, playerId);
      return {
        cardInstanceId: card.id,
        cardId: card.cardId,
        name: blackmailCardName(card.cardId),
        unavailableReason: reason ?? (options.length === 0 ? "It would have no effect now." : undefined),
        options,
      };
    });
}

function holderOfFacedown(state: GameState, cardId: string): { playerId: PlayerId; cardInstanceId: string } | undefined {
  for (const playerId of state.seatingOrder) {
    const card = state.players[playerId]?.blackmailCards.find((candidate) => candidate.facedown && candidate.cardId === cardId);
    if (card) return { playerId, cardInstanceId: card.id };
  }
  return undefined;
}

function reactionDecision(state: GameState, play: BlackmailPlay, reactor: PlayerId): PendingDecision {
  return {
    id: `decision-negotiation-${play.id}-reaction`,
    phase: state.phase,
    step: "negotiation.blackmailReaction",
    actor: reactor,
    // The actor holds a face-down card; only they should see the choice spelled out.
    visibility: "private",
    prompt: `${playerName(state, play.playerId)} played ${blackmailCardName(play.cardId)}. Respond to the blackmail play.`,
    legalCommands: [
      {
        type: "negotiation.respondToBlackmail",
        label: `Cancel it with ${blackmailCardName("man-on-the-inside")}`,
        payload: { playId: play.id, cancel: true },
      },
      {
        type: "negotiation.respondToBlackmail",
        label: "Let it resolve",
        payload: { playId: play.id, cancel: false },
      },
    ],
    canSave: true,
  };
}

function resolvePlay(state: GameState, play: BlackmailPlay): GameState {
  const handler = handlerFor(play.cardId);
  if (!handler) throw new Error(`No blackmail handler for ${play.cardId}.`);
  const result = handler.resolve(state, play.playerId, play.params);
  const logged = appendLog(result.state, {
    actor: play.playerId,
    type: "negotiation.blackmailResolved",
    summary: result.summary,
    details: { play },
    timestamp: state.updatedAt,
  });
  const resume = play.resumeKey ? blackmailResumes.get(play.resumeKey) : undefined;
  return resume ? resume(logged, play, "resolved") : refreshPendingDecision(logged);
}

/**
 * Play a face-down blackmail card: turn it face up, give the Man on the Inside holder a chance to
 * cancel it, then resolve its effect. Areas that offer a blackmail inside their own flow (after a
 * Trade check, when a card is taken from the display, ...) call this with a `resumeKey` and register
 * a BlackmailResume to continue afterwards. The caller adds its own log entry for the decision.
 */
export function startBlackmailPlay(
  state: GameState,
  input: { playerId: PlayerId; cardInstanceId: string; params: Record<string, unknown>; resumeKey?: string; timestamp: string },
): GameState {
  const card = state.players[input.playerId].blackmailCards.find((candidate) => candidate.id === input.cardInstanceId);
  if (!card || !card.facedown) throw new Error(`${input.playerId} has no face-down blackmail ${input.cardInstanceId}.`);

  const allocated = nextNegotiationId(state, "blackmail");
  const play: BlackmailPlay = {
    id: allocated.id,
    playerId: input.playerId,
    cardInstanceId: card.id,
    cardId: card.cardId,
    params: input.params,
    resumeKey: input.resumeKey,
  };
  let next = moveBlackmailCard(allocated.state, input.playerId, input.playerId, card.id, false);
  next = appendLog(next, {
    actor: input.playerId,
    type: "negotiation.blackmailPlayed",
    summary: `${playerName(next, input.playerId)} played ${blackmailCardName(card.cardId)}.`,
    details: { play },
    timestamp: input.timestamp,
  });

  // Man on the Inside cannot cancel Letters of Introduction during Final Scoring (card text).
  const reactor = holderOfFacedown(next, "man-on-the-inside");
  const exempt = card.cardId === "letters-of-introduction" && next.phase === "finalScoring";
  if (reactor && reactor.playerId !== input.playerId && card.cardId !== "man-on-the-inside" && !exempt) {
    const frame: InterruptFrame = {
      id: play.id,
      kind: "blackmailReaction",
      play,
      reactor: reactor.playerId,
      savedDecision: next.pendingDecision,
    };
    return pushInterrupt(next, frame, reactionDecision(next, play, reactor.playerId));
  }

  return resolvePlay(next, play);
}

export const playBlackmailCommand: CommandHandler = (state, command) => {
  const playerId = command.actorId as PlayerId;
  const payload = command.payload as { cardInstanceId?: unknown; params?: unknown };
  const choice = blackmailPlayChoices(state, playerId).find((candidate) => candidate.cardInstanceId === payload.cardInstanceId);
  if (!choice) return rejected("ILLEGAL_BLACKMAIL", "You hold no such face-down blackmail card.", "payload.cardInstanceId");
  if (choice.unavailableReason) return rejected("ILLEGAL_BLACKMAIL", choice.unavailableReason, "payload.cardInstanceId");

  const params = (payload.params ?? {}) as Record<string, unknown>;
  if (!choice.options.some((option) => JSON.stringify(option.params) === JSON.stringify(params))) {
    return rejected("ILLEGAL_BLACKMAIL", `That is not a legal way to play ${choice.name} now.`, "payload.params");
  }

  return okResult(
    startBlackmailPlay(state, { playerId, cardInstanceId: choice.cardInstanceId, params, timestamp: command.clientTimestamp }),
  );
};

export const respondToBlackmailCommand: CommandHandler = (state, command) => {
  const frame = activeInterrupt(state);
  const payload = command.payload as { playId?: unknown; cancel?: unknown };
  if (frame?.kind !== "blackmailReaction" || payload.playId !== frame.play.id || typeof payload.cancel !== "boolean") {
    return rejected("ILLEGAL_BLACKMAIL_RESPONSE", "No matching blackmail play is waiting for a response.", "payload");
  }

  const { play, reactor } = frame;
  let next = popInterrupt(state);
  next = { ...next, updatedAt: command.clientTimestamp };

  if (!payload.cancel) return okResult(resolvePlay(next, play));

  // Man on the Inside is played face up; the cancelled card goes face up into the reactor's area.
  const man = holderOfFacedown(next, "man-on-the-inside");
  if (!man || man.playerId !== reactor) {
    return rejected("ILLEGAL_BLACKMAIL_RESPONSE", "Man on the Inside is no longer available.");
  }
  next = moveBlackmailCard(next, reactor, reactor, man.cardInstanceId, false);
  next = moveBlackmailCard(next, play.playerId, reactor, play.cardInstanceId, false);
  next = appendLog(next, {
    actor: reactor,
    type: "negotiation.blackmailCanceled",
    summary: `${playerName(next, reactor)} played Man on the Inside, cancelled ${blackmailCardName(play.cardId)}, and took it face up.`,
    details: { play },
    timestamp: command.clientTimestamp,
    commandId: command.id,
  });
  const resume = play.resumeKey ? blackmailResumes.get(play.resumeKey) : undefined;
  return okResult(resume ? resume(next, play, "canceled") : refreshPendingDecision(next));
};

// ---------------------------------------------------------------------------------------------
// Effects owned by Negotiation: the cards played "anytime".

const officeCategory = new Map(offices.map((office) => [office.id, office.category]));

/**
 * Scandal cards (p.12): the officeholder goes back to its family's supply without retiring (no
 * pensioner, so no prize). Fatigue returns to the supply and the office waits in the Vacant Offices
 * box for the next Hiring phase. A vacated Chairman's piece is also a Company share, which is lost.
 * TODO(LS): offer the Scandal cards "when taken from the display" via startBlackmailPlay.
 */
export function vacateOfficeWithoutRetirement(state: GameState, officeId: OfficeId): GameState {
  const office = state.company.offices[officeId];
  if (!office || office.vacant || !office.holder) return state;
  const holder = state.players[office.holder];

  return {
    ...state,
    players: {
      ...state.players,
      [holder.id]: { ...holder, familyMembers: { ...holder.familyMembers, supply: holder.familyMembers.supply + 1 } },
    },
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: { ...office, holder: undefined, familyMemberId: undefined, vacant: true, fatigue: 0 },
      },
      vacantOffices: state.company.vacantOffices.includes(officeId)
        ? state.company.vacantOffices
        : [...state.company.vacantOffices, officeId],
    },
  };
}

const AFTER_REVENUE: PhaseId[] = ["eventsInIndia", "parliament", "upkeep"];

function scandalHandler(categories: string[]): BlackmailHandler {
  return {
    anytimeUnavailableReason: (state) =>
      AFTER_REVENUE.includes(state.phase)
        ? undefined
        : "Play this when you take it from the display or after the Revenue phase.",
    options: (state) =>
      Object.values(state.company.offices)
        .filter((office) => !office.vacant && office.holder && categories.includes(officeCategory.get(office.id) ?? ""))
        .map((office) => ({
          label: `Vacate ${office.id} (${playerName(state, office.holder!)})`,
          params: { officeId: office.id },
        })),
    resolve: (state, playerId, params) => {
      const officeId = String(params.officeId);
      const holder = state.company.offices[officeId]?.holder;
      return {
        state: vacateOfficeWithoutRetirement(state, officeId),
        summary: `${playerName(state, playerId)}'s scandal forced ${holder ? playerName(state, holder) : "the holder"} out of ${officeId} without retirement.`,
      };
    },
  };
}

registerBlackmailHandler("blackmail.vacate-office-without-retirement.company", scandalHandler(["chairman", "company", "china"]));
registerBlackmailHandler("blackmail.vacate-office-without-retirement.india", scandalHandler(["presidency", "governor", "governorGeneral"]));

// The Prime Minister's Ear: swap two adjacent power markers. The vines link the top box to the
// middle box and the middle box to each bottom box (board, p.34).
const ADJACENT_POWER_BOXES = powerTrack.positions.flatMap((position) =>
  position.nextHigher ? [[position.nextHigher, position.id] as const] : [],
);

registerBlackmailHandler("blackmail.swap-adjacent-power-markers", {
  anytimeUnavailableReason: (state) =>
    state.phase === "londonSeason" ? undefined : "Play this on a turn before the Family phase.",
  options: (state) => {
    const positions = powerMarkerPositions(state);
    const markerAt = (box: string) =>
      (Object.keys(positions) as PowerTargetId[]).find((target) => positions[target] === box);
    return ADJACENT_POWER_BOXES.flatMap(([upper, lower]) => {
      const a = markerAt(upper);
      const b = markerAt(lower);
      return a && b ? [{ label: `Swap ${a} and ${b}`, params: { markers: [a, b] } }] : [];
    });
  },
  resolve: (state, playerId, params) => {
    const [a, b] = params.markers as [PowerTargetId, PowerTargetId];
    const positions = powerMarkerPositions(state);
    const swapped = { ...positions, [a]: positions[b], [b]: positions[a] };
    return {
      state: withPowerMarkerPositions(state, swapped),
      summary: `${playerName(state, playerId)} swapped the ${a} and ${b} power markers.`,
    };
  },
});

// Envoy to the Mughals: move the Elephant to any legal position, then take £ equal to the highest
// open order in the region with the Elephant's tail.
const BEFORE_EVENTS: PhaseId[] = ["londonSeason", "family", "hiring", "companyOperation", "bonuses", "revenue"];

/**
 * Positions the Elephant may stand in, following the Elephant's March placement (p.30):
 * Company-controlled regions hold it in the centre, dominated regions face their capital, and
 * sovereign regions face a neighbour they do not already dominate.
 * TODO(EV): replace with the Events in India placement helper once it exists.
 */
export function legalElephantPositions(state: GameState): Array<{ regionId: RegionId; facing?: RegionId }> {
  const regions = Object.values(state.india.regions);
  return regions.flatMap((region) => {
    if (region.companyControlled) return [{ regionId: region.id }];
    if (region.empireFlag && !region.isCapital) {
      const capital = regions.find((candidate) => candidate.isCapital && candidate.empireFlag === region.empireFlag);
      return capital && region.adjacent.includes(capital.id) ? [{ regionId: region.id, facing: capital.id }] : [{ regionId: region.id }];
    }
    const targets = region.adjacent.filter((neighbour) => {
      const other = state.india.regions[neighbour];
      return !(region.empireFlag && other?.empireFlag === region.empireFlag);
    });
    return targets.length > 0 ? targets.map((facing) => ({ regionId: region.id, facing })) : [{ regionId: region.id }];
  });
}

function highestOpenOrder(state: GameState, regionId: RegionId): number {
  return Math.max(0, ...state.india.regions[regionId].orders.filter((order) => !order.closed).map((order) => order.value));
}

registerBlackmailHandler("blackmail.move-elephant-and-take-order-value", {
  anytimeUnavailableReason: (state) =>
    BEFORE_EVENTS.includes(state.phase) ? undefined : "Play this on a turn before the Events in India phase.",
  options: (state) =>
    legalElephantPositions(state).map((position) => ({
      label: position.facing
        ? `Elephant in ${position.regionId} facing ${position.facing} (take £${highestOpenOrder(state, position.regionId)})`
        : `Elephant in the centre of ${position.regionId} (take £${highestOpenOrder(state, position.regionId)})`,
      params: position.facing ? { regionId: position.regionId, facing: position.facing } : { regionId: position.regionId },
    })),
  resolve: (state, playerId, params) => {
    const regionId = String(params.regionId);
    const facing = typeof params.facing === "string" ? params.facing : undefined;
    const amount = highestOpenOrder(state, regionId);
    const player = state.players[playerId];
    return {
      state: {
        ...state,
        india: { ...state.india, elephant: { regionId, facing } },
        players: { ...state.players, [playerId]: { ...player, cash: player.cash + amount } },
      },
      summary: `${playerName(state, playerId)} moved the Elephant to ${regionId}${facing ? ` facing ${facing}` : ""} and took £${amount}.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Command maps

export const blackmailAnytimeCommandHandlers: Record<string, CommandHandler> = {
  "negotiation.playBlackmail": playBlackmailCommand,
};

export const blackmailCommandHandlers: Record<string, CommandHandler> = {
  "negotiation.respondToBlackmail": respondToBlackmailCommand,
};
