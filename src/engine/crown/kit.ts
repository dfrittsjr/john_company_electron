import { crownBoardFavors, crownHandbook, type CrownFavor } from "../../data";
import type { GameCommand, GameState, LegalCommand, PendingDecision, PlayerId } from "../types";
import { addCrownEffect, crownClimate, CROWN_PLAYER_ID } from "./state";

// What a Crown area (./areas/*.ts) is made of, and helpers for writing one: policies decide the
// Crown's own decisions (./policy.ts runs them), favours are what players may buy from it, and cube
// detectors award or charge cubes for what players do (./favors.ts runs both). See
// docs/phases/crown.md.

/**
 * What a policy returns: the options the Crown would take (a subset of the decision's
 * legalCommands, matched by type and payload) and why. More than one option is a free choice for
 * the soloist / Button holder.
 */
export type CrownChoice = {
  commands: LegalCommand[];
  /** Short and specific, shown on the Crown's panel and in the log: "Bull: Seek Shares first." */
  reason: string;
  /** The Crown is choosing between the two players this way: the Button passes after (p.44). */
  passButton?: boolean;
};

/**
 * Decides one step for the Crown. `decision.legalCommands` is every option the rules allow.
 * Return undefined when the Handbook says nothing for this situation (the players choose).
 */
export type CrownPolicy = (state: GameState, decision: PendingDecision) => CrownChoice | undefined;

/** One area's contribution to the Crown, composed in ./registry.ts. */
export type CrownArea = {
  /**
   * The Handbook pages this area owns. Every favour printed on them must be one of `favors`,
   * `detectors` or `notDone` (src/tests/engine/crown-core.test.ts checks).
   */
  pages: number[];
  /** True for the area that owns the favours on the Crown's family board. */
  boardFavors?: boolean;
  /** By decision step; a key ending in "*" matches every step with that prefix (exact keys win). */
  policies: Record<string, CrownPolicy>;
  favors: CrownFavorDefinition[];
  detectors: CrownCubeDetector[];
  /** Printed favours this area doesn't offer, and why. */
  notDone: Array<{ printed: CrownFavorSource; why: string }>;
};

/** Where a favour is printed: a Handbook page and the start of its text, or the Crown's board. */
export type CrownFavorSource = { page: number; text: string } | { board: string; take?: boolean };

export type CrownFavorDefinition = {
  /** Stable and readable, e.g. "chairman.seekDebt.extra". */
  id: string;
  printed: CrownFavorSource;
  /** Whether this player may buy it now: its timing window (p.46) and any condition in its text. */
  available: (state: GameState, playerId: PlayerId) => boolean;
  /** Choices inside the favour (which office, which ship). Each is offered separately. */
  options?: (state: GameState, playerId: PlayerId) => Array<{ label: string; option: unknown }>;
  /**
   * Signed cubes: positive the player gains, negative the player pays. Needed for "X" costs;
   * otherwise the printed cost for the current climate is used. Undefined: not available.
   */
  cost?: (state: GameState, playerId: PlayerId, option: unknown) => number | undefined;
  /** The favour's effect, after the cubes have moved. Throw an Error to refuse it. */
  apply: (state: GameState, playerId: PlayerId, option: unknown, now: string) => GameState;
  /**
   * Whether the Crown's automatic play should stop while this is on offer. True (the default) for
   * favours tied to one Crown decision; false for long windows such as the board favours.
   */
  pausesCrown?: boolean;
};

/** A cube exchange a command causes by itself. `cubes`: positive the player gains, negative pays. */
export type CrownCubeDetector = {
  favorId: string;
  printed: CrownFavorSource;
  detect: (
    before: GameState,
    after: GameState,
    command: GameCommand,
  ) => Array<{ playerId: PlayerId; cubes: number; reason: string; partial?: boolean }>;
};

export function sameCommand(left: LegalCommand, right: LegalCommand): boolean {
  return left.type === right.type && JSON.stringify(sortKeys(left.payload ?? {})) === JSON.stringify(sortKeys(right.payload ?? {}));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

// --- Helpers for writing policies ---

/** The options of the given command type (and matching `where`, if given). */
export function optionsOfType(
  decision: PendingDecision,
  type: string,
  where?: (payload: Record<string, unknown>, command: LegalCommand) => boolean,
): LegalCommand[] {
  return decision.legalCommands.filter(
    (command) => command.type === type && (!where || where((command.payload ?? {}) as Record<string, unknown>, command)),
  );
}

/**
 * A Handbook priority list: the options matching the first rule that matches any, with that rule's
 * reason. Rules are tried top to bottom ("skip any that cannot be performed").
 */
export function firstMatching(
  decision: PendingDecision,
  rules: Array<{ reason: string; match: (command: LegalCommand) => boolean }>,
): CrownChoice | undefined {
  for (const rule of rules) {
    const commands = decision.legalCommands.filter(rule.match);
    if (commands.length > 0) return { commands, reason: rule.reason };
  }
  return undefined;
}

/** One option, with a reason. */
export function choose(command: LegalCommand | undefined, reason: string): CrownChoice | undefined {
  return command ? { commands: [command], reason } : undefined;
}

// --- Printed costs ---

const handbookFavors: Array<{ page: number; favor: CrownFavor }> = crownHandbook.flatMap((page) =>
  page.sections.flatMap((section) => (section.favors ?? []).map((favor) => ({ page: page.page, favor }))),
);

export function printedFavor(source: CrownFavorSource): { text: string; cost: string } {
  if ("board" in source) {
    const favor = crownBoardFavors.find((candidate) => candidate.text.startsWith(source.board));
    if (!favor) throw new Error(`No board favour starts "${source.board}".`);
    return { text: favor.text, cost: source.take ? favor.take ?? "—" : favor.gain };
  }
  const matches = handbookFavors.filter(({ page, favor }) => page === source.page && favor.text.startsWith(source.text));
  if (matches.length !== 1) throw new Error(`${matches.length} Handbook favours on p.${source.page} start "${source.text}".`);
  const { favor } = matches[0];
  return { text: favor.text, cost: typeof favor.cost === "string" ? favor.cost : JSON.stringify(favor.cost) };
}

/** The printed cost now: a signed number, "X" (the definition must compute it), or undefined ("—"). */
export function printedCost(state: GameState, source: CrownFavorSource): number | "X" | undefined {
  let cost: string;
  if ("board" in source) {
    cost = printedFavor(source).cost;
  } else {
    const { favor } = handbookFavors.find(({ page, favor }) => page === source.page && favor.text.startsWith(source.text))!;
    cost = typeof favor.cost === "string" ? favor.cost : favor.cost[crownClimate(state)];
  }
  const text = cost.trim();
  if (text === "—" || text === "") return undefined;
  if (/X$/.test(text)) return "X";
  const value = Number(text.replace("+", ""));
  return Number.isNaN(value) ? undefined : value;
}

// --- Building blocks for area favour lists ---

/** True while the pending decision is the Crown's and its step is one of `steps` (a trailing "*" matches a prefix). */
export function crownDecidingStep(state: GameState, steps: string[]): boolean {
  const decision = state.pendingDecision;
  return decision.actor === CROWN_PLAYER_ID && steps.some((step) => matchesStep(decision.step, step));
}

export function matchesStep(step: string, pattern: string): boolean {
  return pattern.endsWith("*") ? step.startsWith(pattern.slice(0, -1)) : step === pattern;
}

/**
 * "Make a hiring decision for the Crown" and the like: the buyer then picks the Crown's option on
 * this decision from `choices` (default: everything the rules allow).
 */
export function chooseForCrownFavor(input: {
  id: string;
  printed: CrownFavorSource;
  steps: string[];
  /** Extra condition beyond the step. */
  when?: (state: GameState, playerId: PlayerId) => boolean;
  /** The options the buyer may pick from; default every legal option. Empty: not available. */
  choices?: (state: GameState, decision: PendingDecision) => LegalCommand[];
}): CrownFavorDefinition {
  const choicesFor = (state: GameState) => {
    const decision = state.pendingDecision;
    const all = decision.crown?.all ?? decision.legalCommands;
    return input.choices ? input.choices(state, { ...decision, legalCommands: all }) : all;
  };
  return {
    id: input.id,
    printed: input.printed,
    available: (state, playerId) =>
      crownDecidingStep(state, input.steps) &&
      !state.crown!.favorEffects.some((effect) => effect.decisionId === state.pendingDecision.id && effect.choices) &&
      choicesFor(state).length > 1 &&
      (input.when?.(state, playerId) ?? true),
    apply: (state, playerId) =>
      addCrownEffect(state, {
        favorId: input.id,
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        choices: choicesFor(state),
      }),
  };
}

/** A favour whose only effect is a note the Crown's policies read (crownEffects(state, id)). */
export function effectFavor(input: {
  id: string;
  printed: CrownFavorSource;
  available: CrownFavorDefinition["available"];
  options?: CrownFavorDefinition["options"];
  cost?: CrownFavorDefinition["cost"];
  pausesCrown?: boolean;
}): CrownFavorDefinition {
  return {
    ...input,
    apply: (state, playerId, option) =>
      addCrownEffect(state, {
        favorId: input.id,
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        ...(option !== undefined ? { option } : {}),
      }),
  };
}
