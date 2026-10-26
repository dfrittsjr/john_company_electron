import type { GameCommand, GameState, PlayerId } from "../types";
import { printedCost, printedFavor, type CrownCubeDetector, type CrownFavorDefinition } from "./kit";
import { crownCubeDetectors, crownFavorDefinitions } from "./registry";
import { appendCrownLog, crownCubes, exchangeCubes, playerCubes } from "./state";

// Favours (rulebook p.46, Crown Handbook, the Crown's family board). Players pay the Crown promise
// cubes to change what it does (red boxes, negative costs), or earn cubes for helping it (blue
// boxes, positive). A favour is only on offer while its phase or step resolves.
//
// Two kinds (defined in ./kit.ts, listed by each area):
// - favours a player buys with the anytime command `crown.favor` (CrownFavorDefinition);
// - cube detectors: cubes a player's own command earns or costs without asking, for the favours that
//   describe something the player does ("+1: Fit a Crown ship", mandatory "-3: If you form a private
//   firm"). The engine runs them after every human command.

export type CrownFavorOffer = {
  favorId: string;
  option?: unknown;
  /** The printed text, plus the option's label. */
  label: string;
  /** Signed: positive the player gains (up to what the Crown has), negative the player pays. */
  cubes: number;
  pausesCrown: boolean;
};

// --- Offers and buying ---

function favorCost(state: GameState, definition: CrownFavorDefinition, playerId: PlayerId, option: unknown): number | undefined {
  if (definition.cost) return definition.cost(state, playerId, option);
  const printed = printedCost(state, definition.printed);
  return printed === "X" ? undefined : printed;
}

/** The favours this player may buy now, each with its cost. Payments they can't afford are left out (p.46). */
export function crownFavorOffers(state: GameState, playerId: PlayerId): CrownFavorOffer[] {
  return favorOffers(state, playerId).filter((offer) => !offer.unaffordable);
}

/**
 * Favours on offer now that this player can't pay for (p.46: "you may never perform a favor you
 * cannot fully pay"), so the UI can show them greyed out instead of not at all.
 */
export function crownFavorsOutOfReach(state: GameState, playerId: PlayerId): CrownFavorOffer[] {
  return favorOffers(state, playerId).filter((offer) => offer.unaffordable);
}

function favorOffers(state: GameState, playerId: PlayerId): Array<CrownFavorOffer & { unaffordable?: boolean }> {
  if (!state.crown || state.players[playerId]?.isCrown || !state.players[playerId]) return [];
  const offers: Array<CrownFavorOffer & { unaffordable?: boolean }> = [];
  for (const definition of crownFavorDefinitions()) {
    let available = false;
    try {
      available = definition.available(state, playerId);
    } catch {
      available = false;
    }
    if (!available) continue;
    // The Crown's family board favours stay on offer from Firms to Revenue; say where they come from.
    const text = `${"board" in definition.printed ? "Crown board: " : ""}${printedFavor(definition.printed).text}`;
    const options = definition.options ? definition.options(state, playerId) : [{ label: "", option: undefined }];
    for (const { label, option } of options) {
      const cubes = favorCost(state, definition, playerId, option);
      if (cubes === undefined) continue;
      offers.push({
        favorId: definition.id,
        ...(option !== undefined ? { option } : {}),
        label: label ? `${text} (${label})` : text,
        cubes,
        pausesCrown: definition.pausesCrown ?? true,
        ...(cubes < 0 && playerCubes(state, playerId) < -cubes ? { unaffordable: true } : {}),
      });
    }
  }
  return offers;
}

/** Buys a favour: moves the cubes, applies it and logs it. Throws if it isn't on offer. */
export function buyCrownFavor(state: GameState, playerId: PlayerId, favorId: string, option: unknown, now: string): GameState {
  const offer = crownFavorOffers(state, playerId).find(
    (candidate) => candidate.favorId === favorId && JSON.stringify(candidate.option ?? null) === JSON.stringify(option ?? null),
  );
  if (!offer) throw new Error("That favour is not available now.");
  const definition = crownFavorDefinitions().find((candidate) => candidate.id === favorId)!;
  const exchanged = exchangeCubes(state, playerId, offer.cubes);
  const applied = definition.apply(exchanged.state, playerId, option, now);
  const name = state.players[playerId]?.name ?? playerId;
  const cubes =
    exchanged.moved > 0
      ? `gained ${exchanged.moved} promise cube${exchanged.moved === 1 ? "" : "s"}`
      : exchanged.moved < 0
        ? `paid ${-exchanged.moved} promise cube${exchanged.moved === -1 ? "" : "s"}`
        : "exchanged no cubes";
  return appendCrownLog(applied, {
    now,
    actor: playerId,
    type: "crown.favor",
    summary: `${name} ${cubes}: ${offer.label}`,
    details: { favorId, option, cubes: exchanged.moved, crownCubes: crownCubes(applied) },
  });
}

/** After a human's command: the cubes it earned or cost under the Handbook's automatic favours. */
export function applyCubeDetectors(before: GameState, after: GameState, command: GameCommand, now: string): GameState {
  if (!after.crown) return after;
  let state = after;
  for (const detector of crownCubeDetectors()) {
    let found: ReturnType<CrownCubeDetector["detect"]> = [];
    try {
      found = detector.detect(before, after, command);
    } catch {
      found = [];
    }
    for (const { playerId, cubes, reason, partial } of found) {
      if (!state.players[playerId] || state.players[playerId].isCrown || cubes === 0) continue;
      const exchanged = exchangeCubes(state, playerId, cubes, { partial: partial ?? true });
      const name = state.players[playerId].name;
      const moved = exchanged.moved;
      state = appendCrownLog(exchanged.state, {
        now,
        actor: playerId,
        type: "crown.favor",
        summary:
          moved === 0
            ? `${name} would ${cubes > 0 ? "gain" : "pay"} ${Math.abs(cubes)} promise cube${Math.abs(cubes) === 1 ? "" : "s"} (${reason}), but ${cubes > 0 ? "the Crown has none left" : "has none"}.`
            : `${name} ${moved > 0 ? "gained" : "paid"} ${Math.abs(moved)} promise cube${Math.abs(moved) === 1 ? "" : "s"}: ${reason}.`,
        details: { favorId: detector.favorId, cubes: moved },
      });
    }
  }
  return state;
}
