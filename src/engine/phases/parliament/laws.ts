import { lawsById, policyDial } from "../../../data";
import type { LawCard, LawPolicyIcon, PolicySpace } from "../../../data";
import { shuffle } from "../../rng";
import type { GameState } from "../../types";
import { lawInstance } from "../parliament.state";
import type { Collector } from "./common";

export function lawCard(lawId: string): LawCard {
  const law = lawsById.get(lawId);
  if (!law) throw new Error(`Unknown law "${lawId}".`);
  return law;
}

/** True while the law sits among the passed laws near the board. */
export function isLawPassed(state: GameState, lawId: string): boolean {
  return state.parliament.passedLaws.some((law) => law.lawId === lawId);
}

export function addPassedLaw(state: GameState, lawId: string): GameState {
  if (isLawPassed(state, lawId)) return state;
  return {
    ...state,
    parliament: { ...state.parliament, passedLaws: [...state.parliament.passedLaws, lawInstance(lawId)] },
  };
}

export function discardLaws(state: GameState, lawIds: string[]): GameState {
  if (lawIds.length === 0) return state;
  const deck = state.parliament.lawDeck;
  return {
    ...state,
    parliament: {
      ...state.parliament,
      lawDeck: { ...deck, discardPile: [...deck.discardPile, ...lawIds] },
    },
  };
}

/** Removes a passed law (e.g. Royal Protection used, Writer Privileges replaced) to the discards. */
export function discardPassedLaw(state: GameState, lawId: string): GameState {
  if (!isLawPassed(state, lawId)) return state;
  const withoutLaw: GameState = {
    ...state,
    parliament: {
      ...state.parliament,
      passedLaws: state.parliament.passedLaws.filter((law) => law.lawId !== lawId),
    },
  };
  return discardLaws(withoutLaw, [lawId]);
}

/**
 * Reveals the top law. If the draw pile is empty the discards are shuffled to form a new pile;
 * the rules never say, but the deck must not run dry in a long game (assumption).
 */
export function drawLawCard(state: GameState, collector: Collector): { state: GameState; lawId?: string } {
  let deck = state.parliament.lawDeck;
  let rng = state.rng;

  if (deck.drawPile.length === 0 && deck.discardPile.length > 0) {
    const reshuffled = shuffle(rng, deck.discardPile);
    rng = reshuffled.rng;
    collector.rolls.push(...reshuffled.rolls.slice(0, 1));
    collector.notes.push("The law deck ran out; the discards were shuffled into a new deck.");
    deck = { drawPile: reshuffled.items, discardPile: [] };
  }

  const [lawId, ...rest] = deck.drawPile;
  if (!lawId) return { state };

  return {
    lawId,
    state: {
      ...state,
      rng,
      parliament: { ...state.parliament, lawDeck: { ...deck, drawPile: rest } },
    },
  };
}

/**
 * A law's banner names a consequence (tax, bonus, power) or a target. A Tax banner matches both
 * TAX and TAX & WINDOW TAX spaces (assumption: the window tax is part of a tax space).
 */
export function policySpaceMatches(space: PolicySpace, icon: LawPolicyIcon): boolean {
  if (icon.kind === "target") return space.target === icon.target;
  if (icon.consequence === "tax") return space.consequence === "tax" || space.consequence === "taxAndWindowTax";
  return space.consequence === icon.consequence;
}

/** First matching space rotating each way from the arm (the current space does not count; p.34). */
export function policyRotationOptions(
  position: number,
  icon: LawPolicyIcon,
): Array<{ direction: "clockwise" | "counterclockwise"; space: number }> {
  const count = policyDial.spaces.length;
  const options: Array<{ direction: "clockwise" | "counterclockwise"; space: number }> = [];

  for (const [direction, step] of [
    ["clockwise", 1],
    ["counterclockwise", -1],
  ] as const) {
    for (let distance = 1; distance <= count; distance += 1) {
      const space = (((position + step * distance) % count) + count) % count;
      if (policySpaceMatches(policyDial.spaces[space], icon)) {
        options.push({ direction, space });
        break;
      }
    }
  }

  return options;
}

export function adjacentPolicySpaces(position: number): Array<{ direction: "clockwise" | "counterclockwise"; space: number }> {
  const count = policyDial.spaces.length;
  return [
    { direction: "clockwise", space: (position + 1) % count },
    { direction: "counterclockwise", space: (position - 1 + count) % count },
  ];
}

const CONSEQUENCE_LABEL: Record<PolicySpace["consequence"], string> = {
  tax: "Tax",
  taxAndWindowTax: "Tax & Window Tax",
  bonus: "Bonus",
  power: "Power",
};

const TARGET_LABEL: Record<PolicySpace["target"], string> = {
  social: "social enterprises",
  companyShare: "Company shares",
  shipping: "shipping enterprises",
  manufacturing: "manufacturing enterprises",
};

export function describePolicySpace(index: number): string {
  const space = policyDial.spaces[index];
  return `${CONSEQUENCE_LABEL[space.consequence]}: ${TARGET_LABEL[space.target]}`;
}

/** Votes cost £2 each once Masses Demand Franchise! has passed. */
export function voteCost(state: GameState): number {
  return isLawPassed(state, "masses-demand-franchise") ? 2 : 1;
}
