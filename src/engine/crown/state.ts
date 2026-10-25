import { CROWN_CLIMATES, crownAiCards, type CrownAiCard } from "../../data";
import { shuffle } from "../rng";
import {
  commanderOf,
  companyExpectations,
  companyShareCount,
  PRESIDENCY_IDS,
  presidentOf,
  shipsInSeaZones,
  toEnginePresidency,
} from "../selectors";
import type {
  CrownClimate,
  CrownFavorEffect,
  CrownState,
  GameLogEntry,
  GameState,
  PlayerId,
  PresidencyId,
  RegionId,
} from "../types";

// The Crown, the automated family in solo and two-player games (rulebook pp.43-46, Crown Handbook).
// Pure helpers every phase may use: climate, the AI card tie-breaks, promise cubes and the Player
// Button. Nothing here knows about Crown policies (./policy.ts) or favours (./favors.ts).

export const CROWN_PLAYER_ID = "crown";

export function isCrownGame(state: GameState): boolean {
  return Boolean(state.crown);
}

export function isCrownPlayer(state: GameState, playerId: string | undefined): boolean {
  return Boolean(playerId && state.players[playerId]?.isCrown);
}

/** The human families, in seating order. */
export function humanPlayerIds(state: GameState): PlayerId[] {
  return state.seatingOrder.filter((playerId) => !state.players[playerId]?.isCrown);
}

function crownState(state: GameState): CrownState {
  if (!state.crown) throw new Error("This is not a Crown game.");
  return state.crown;
}

export function crownClimate(state: GameState): CrownClimate {
  return crownState(state).climate;
}

/** The Crown's family treasury. */
export function crownCash(state: GameState): number {
  return state.players[CROWN_PLAYER_ID]?.cash ?? 0;
}

// --- AI cards (rulebook p.45) ---

const AI_CARDS = new Map(crownAiCards.map((card) => [card.id as string, card]));

export function aiCard(cardId: string): CrownAiCard {
  const card = AI_CARDS.get(cardId);
  if (!card) throw new Error(`Unknown AI card "${cardId}".`);
  return card;
}

export function faceUpAiCard(state: GameState): CrownAiCard {
  return aiCard(crownState(state).faceupAiCard);
}

/** The top card of the face-down AI deck, whose back breaks Presidency and direction ties. */
export function topFaceDownAiCard(state: GameState): CrownAiCard {
  const top = crownState(state).aiDeck.drawPile[0];
  if (!top) throw new Error("The AI deck is empty.");
  return aiCard(top);
}

const ARROW_INDEX = { top: 0, middle: 1, bottom: 2 } as const;

/**
 * Presidencies in the order the Crown considers them: the one beside the face-up card's black 1st
 * arrow on the back of the top face-down card, then its white 2nd arrow, then the third (p.45).
 */
export function crownPresidencyOrder(state: GameState): PresidencyId[] {
  const front = faceUpAiCard(state);
  const back = topFaceDownAiCard(state).back.presidencies.map(toEnginePresidency);
  const first = back[ARROW_INDEX[front.firstArrow]];
  const second = back[ARROW_INDEX[front.secondArrow]];
  const third = PRESIDENCY_IDS.find((presidency) => presidency !== first && presidency !== second);
  return [first, second, ...(third ? [third] : [])];
}

/** The direction the face-up card's pointing hand picks out on the top face-down card (p.45). */
export function crownDirection(state: GameState): "clockwise" | "counterclockwise" {
  const back = topFaceDownAiCard(state).back;
  return faceUpAiCard(state).hand === "upper" ? back.upperArrow : back.lowerArrow;
}

const SPLAY_INDEX = { left: 0, middle: 1, right: 2 } as const;

/**
 * Which of a row of cards the Crown takes: the one in the face-up card's shaded slot, else the next
 * available to the right, wrapping round (p.45). `available[i]` says whether slot i can be taken.
 */
export function crownSplayIndex(state: GameState, available: readonly boolean[]): number | undefined {
  const start = Math.min(SPLAY_INDEX[faceUpAiCard(state).splaySlot], Math.max(available.length - 1, 0));
  for (let offset = 0; offset < available.length; offset += 1) {
    const index = (start + offset) % available.length;
    if (available[index]) return index;
  }
  return undefined;
}

/** Regions in the order of the face-up card's region strip, left to right (p.45). */
export function crownRegionOrder(state: GameState): RegionId[] {
  return [...faceUpAiCard(state).regionPriority];
}

/** Sorts by the Crown's Presidency order: a tie-break for any list keyed by Presidency. */
export function byCrownPresidencyOrder<T>(state: GameState, items: T[], presidencyOf: (item: T) => PresidencyId): T[] {
  const order = crownPresidencyOrder(state);
  return [...items].sort((a, b) => order.indexOf(presidencyOf(a)) - order.indexOf(presidencyOf(b)));
}

/** Sorts by the Crown's region strip; regions not on it go last. */
export function byCrownRegionOrder<T>(state: GameState, items: T[], regionOf: (item: T) => RegionId): T[] {
  const order = crownRegionOrder(state);
  const rank = (item: T) => {
    const index = order.indexOf(regionOf(item));
    return index === -1 ? order.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/**
 * Seating order starting after `from` in the Crown's direction (clockwise follows seatingOrder).
 * `from` itself comes last. Used for "the first eligible officeholder clockwise or counterclockwise".
 */
export function seatsInCrownDirection(state: GameState, from: PlayerId): PlayerId[] {
  const seats = crownDirection(state) === "clockwise" ? state.seatingOrder : [...state.seatingOrder].reverse();
  const index = seats.indexOf(from);
  if (index === -1) return [...seats];
  return [...seats.slice(index + 1), ...seats.slice(0, index + 1)];
}

// --- Whose Presidency (the Handbook's "Crown Presidency" / "player Presidency") ---

/** A Presidency whose President is the Crown. */
export function isCrownPresidency(state: GameState, presidency: PresidencyId): boolean {
  return presidentOf(state, presidency) === CROWN_PLAYER_ID;
}

/** A Presidency whose President is a human family. */
export function isPlayerPresidency(state: GameState, presidency: PresidencyId): boolean {
  const president = presidentOf(state, presidency);
  return Boolean(president && president !== CROWN_PLAYER_ID);
}

/** Crown writers belonging to a Presidency: in its Writers box and on its orders. */
export function writersOf(state: GameState, presidency: PresidencyId, playerId: PlayerId): number {
  const inBox = state.india.presidencies[presidency]?.writers[playerId] ?? 0;
  let onOrders = 0;
  for (const region of Object.values(state.india.regions)) {
    for (const order of region.orders) {
      if (order.writer?.playerId === playerId && order.writer.presidency === presidency) onOrders += 1;
    }
  }
  return inBox + onOrders;
}

// --- Climate (rulebook p.44-45, Handbook p.15) ---

/** The number an AI card's criterion reads off the game (its chart then sets the climate). */
export function criterionValue(state: GameState, criterion: string): number {
  switch (criterion) {
    case "Company Expectations":
      return companyExpectations(state) ?? 0;
    case "Presidencies with Control of a Region":
      return PRESIDENCY_IDS.filter((presidency) =>
        Object.values(state.india.regions).some(
          (region) => region.companyControlled && region.associatedPresidency === presidency,
        ),
      ).length;
    case "Company Debt":
      return state.company.debt;
    case "Seas with ≥2 Ships": {
      const ships = shipsInSeaZones(state).filter((ship) => ship.location !== "china");
      return new Set(
        ships.map((ship) => ship.location).filter((zone) => ships.filter((ship) => ship.location === zone).length >= 2),
      ).size;
    }
    case "Total Company Shares":
      return companyShareCount(state);
    case "Crown Treasury":
      return crownCash(state);
    case "Presidencies with ≥2 Crown Writers":
      return PRESIDENCY_IDS.filter((presidency) => writersOf(state, presidency, CROWN_PLAYER_ID) >= 2).length;
    case "Crown Commanders":
      return PRESIDENCY_IDS.filter((army) => commanderOf(state, army) === CROWN_PLAYER_ID).length;
    case "Fitted Ships":
      return state.company.ships.filter((ship) => ship.location !== "shipyard" && !ship.location.startsWith("firm:")).length;
    default:
      throw new Error(`Unknown AI card criterion "${criterion}".`);
  }
}

/** "£4 or £6" -> [4,4],[6,6]; "£8+" -> [8,∞); "0-1" -> [0,1]; "2" -> [2,2]. */
function parseBand(range: string): Array<[number, number]> {
  return range.split(" or ").map((part) => {
    const text = part.replace(/£/g, "").trim();
    if (text.endsWith("+")) return [Number(text.slice(0, -1)), Infinity];
    const [low, high] = text.split("-").map(Number);
    return [low, high ?? low];
  });
}

/** The climate an AI card's chart gives for the game as it stands. Values off the chart take the nearest band. */
export function climateFromCard(state: GameState, card: CrownAiCard): CrownClimate {
  const deregulated = Boolean(state.parliament.deregulated);
  // Card 6 has a band that replaces another under Deregulation.
  const bands = card.climateBands.filter((band) =>
    deregulated
      ? band.deregulated || !card.climateBands.some((other) => other.deregulated && other.range === band.range)
      : !band.deregulated,
  );
  const value = criterionValue(state, card.criterion);
  const ranges = bands.map((band) => ({ band, spans: parseBand(band.range) }));
  const hit = ranges.find(({ spans }) => spans.some(([low, high]) => value >= low && value <= high));
  if (hit) return hit.band.climate;
  const below = ranges.filter(({ spans }) => spans.some(([low]) => low <= value));
  return (below.length > 0 ? below[below.length - 1] : ranges[0]).band.climate;
}

/**
 * The Chairman's "Set Climate" (Handbook pp.4-5): the face-up card goes to the discards, the top
 * face-down card is turned up and its chart sets the climate. An emptied deck is reshuffled from the
 * discards straight away, since its top card always breaks ties.
 */
export function flipAiCard(state: GameState, now: string): GameState {
  const crown = crownState(state);
  const [next, ...rest] = crown.aiDeck.drawPile;
  if (!next) throw new Error("The AI deck is empty.");
  let rng = state.rng;
  let drawPile = rest;
  let discardPile = [...crown.aiDeck.discardPile, crown.faceupAiCard];
  if (drawPile.length === 0) {
    const shuffled = shuffle(rng, discardPile);
    rng = shuffled.rng;
    drawPile = shuffled.items;
    discardPile = [];
  }
  const flipped: GameState = {
    ...state,
    rng,
    crown: { ...crown, faceupAiCard: next, aiDeck: { ...crown.aiDeck, drawPile, discardPile } },
  };
  const climate = climateFromCard(flipped, aiCard(next));
  const card = aiCard(next);
  return appendCrownLog(
    { ...flipped, crown: { ...flipped.crown!, climate } },
    {
      now,
      type: "crown.aiCardFlipped",
      summary: `The Crown turned up AI card ${card.number} (${card.criterion}): the climate is now ${climateName(climate)}.`,
      details: { cardId: next, climate, value: criterionValue(flipped, card.criterion) },
    },
  );
}

/** Moves the climate marker `steps` spaces right (positive) or left, stopping at the ends (Handbook p.15). */
export function shiftClimate(state: GameState, steps: number): GameState {
  const crown = crownState(state);
  const index = CROWN_CLIMATES.indexOf(crown.climate);
  const next = CROWN_CLIMATES[Math.max(0, Math.min(CROWN_CLIMATES.length - 1, index + steps))];
  return next === crown.climate ? state : { ...state, crown: { ...crown, climate: next } };
}

export function climateName(climate: CrownClimate): string {
  return climate.charAt(0).toUpperCase() + climate.slice(1);
}

// --- Promise cubes (rulebook p.46) ---

export function playerCubes(state: GameState, playerId: PlayerId): number {
  return state.crown?.promiseCubes.byHumanPlayer[playerId] ?? 0;
}

export function crownCubes(state: GameState): number {
  return state.crown?.promiseCubes.crownSupply ?? 0;
}

/**
 * Moves cubes between a player and the Crown: positive `count` gives the player cubes from the
 * Crown (a blue favour), negative takes them (a red favour). A gain is limited to what the Crown
 * has (p.46); a payment must be affordable unless `partial` (a mandatory favour paid with what the
 * player has). Returns how many actually moved, signed like `count`.
 */
export function exchangeCubes(
  state: GameState,
  playerId: PlayerId,
  count: number,
  options: { partial?: boolean } = {},
): { state: GameState; moved: number } {
  const crown = crownState(state);
  const held = playerCubes(state, playerId);
  let moved = count;
  if (count > 0) moved = Math.min(count, crown.promiseCubes.crownSupply);
  if (count < 0 && held < -count) {
    if (!options.partial) throw new Error(`${state.players[playerId]?.name ?? playerId} has only ${held} promise cubes.`);
    moved = -held;
  }
  if (moved === 0) return { state, moved };
  return {
    moved,
    state: {
      ...state,
      crown: {
        ...crown,
        promiseCubes: {
          crownSupply: crown.promiseCubes.crownSupply - moved,
          byHumanPlayer: { ...crown.promiseCubes.byHumanPlayer, [playerId]: held + moved },
        },
      },
    },
  };
}

/** Two players may trade cubes at any time (p.44). */
export function giveCubes(state: GameState, from: PlayerId, to: PlayerId, count: number): GameState {
  const crown = crownState(state);
  const held = playerCubes(state, from);
  if (count <= 0 || held < count) throw new Error(`${state.players[from]?.name ?? from} has only ${held} promise cubes.`);
  const byHumanPlayer = { ...crown.promiseCubes.byHumanPlayer };
  byHumanPlayer[from] = held - count;
  byHumanPlayer[to] = (byHumanPlayer[to] ?? 0) + count;
  return { ...state, crown: { ...crown, promiseCubes: { ...crown.promiseCubes, byHumanPlayer } } };
}

// --- The Player Button and free choices (pp.44, 46) ---

/**
 * Who chooses for the Crown when the Handbook leaves it several options: the soloist, or in a
 * two-player game the Player Button holder (p.46).
 */
export function crownChooser(state: GameState): PlayerId {
  return state.crown?.playerButton?.holder ?? humanPlayerIds(state)[0];
}

export function passPlayerButton(state: GameState): GameState {
  const crown = crownState(state);
  if (!crown.playerButton) return state;
  const other = humanPlayerIds(state).find((playerId) => playerId !== crown.playerButton!.holder);
  return other ? { ...state, crown: { ...crown, playerButton: { holder: other } } } : state;
}

/**
 * The player the Crown picks when it must decide between players: the Button holder if they are a
 * candidate in a two-player game (the Button then passes, p.44), else the first candidate.
 */
export function crownPickPlayer(
  state: GameState,
  candidates: PlayerId[],
): { playerId: PlayerId | undefined; passButton: boolean } {
  const humans = candidates.filter((playerId) => !isCrownPlayer(state, playerId));
  const holder = state.crown?.playerButton?.holder;
  if (humans.length > 1 && holder && humans.includes(holder)) return { playerId: holder, passButton: true };
  return { playerId: humans[0], passButton: false };
}

// --- Favour effects (read by Crown policies) ---

export function crownEffects(state: GameState, favorId?: string): CrownFavorEffect[] {
  const effects = state.crown?.favorEffects ?? [];
  return favorId ? effects.filter((effect) => effect.favorId === favorId) : effects;
}

export function addCrownEffect(state: GameState, effect: CrownFavorEffect): GameState {
  const crown = crownState(state);
  return { ...state, crown: { ...crown, favorEffects: [...crown.favorEffects, effect] } };
}

export function clearCrownEffects(state: GameState, remove: (effect: CrownFavorEffect) => boolean): GameState {
  const crown = state.crown;
  if (!crown || !crown.favorEffects.some(remove)) return state;
  return { ...state, crown: { ...crown, favorEffects: crown.favorEffects.filter((effect) => !remove(effect)) } };
}

// --- Log ---

export function appendCrownLog(
  state: GameState,
  input: { now: string; type: string; summary: string; details?: unknown; actor?: GameLogEntry["actor"] },
): GameState {
  const entry: GameLogEntry = {
    id: `log-${state.log.length + 1}`,
    sequence: state.log.length + 1,
    timestamp: input.now,
    turn: state.turn,
    phase: state.phase,
    actor: input.actor ?? CROWN_PLAYER_ID,
    type: input.type,
    summary: input.summary,
    details: input.details,
  };
  return { ...state, log: [...state.log, entry] };
}
