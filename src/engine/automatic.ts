import { applyCommand } from "./commands";
import { crownFavorOffers } from "./crown/favors";
import { CROWN_PLAYER_ID, humanPlayerIds } from "./crown/state";
import { chairmanTitleHolder } from "./selectors";
import type { GameCommand, GameState, LegalCommand, PendingDecision, PlayerId, ValidationError } from "./types";

// Automatic steps for a server-run game (docs/plans/online-multiplayer.md, "No choosing 'system'
// actor"). The hotseat UI shows "system" decisions as a button anyone may press; online, nobody
// should have to, and nobody may pick for the table.

/** Generous: a full turn has a few dozen automatic steps (skipped offices, phase confirmations). */
export const MAX_AUTOMATIC_STEPS = 500;

/** A "system" decision with exactly one option: the server takes it without asking anyone. */
export function isAutomaticDecision(decision: PendingDecision): boolean {
  return decision.actor === "system" && decision.legalCommands.length === 1;
}

/**
 * The player who answers a "system" decision that offers a real choice, or undefined when the
 * pending decision is not one. The engine still receives the command as "system"; this only says
 * which seat may send it online.
 *
 * Audit (2026-10-25, code reading plus 80 random games over every scenario):
 * - Revenue dividends with the Chairman's office vacant (revenue.chooseDividends), Presidency
 *   order with both the President and the Chairman vacant (companyOperation.presidency), and the
 *   former Chairman's pick with no former Chairman (hiring.electChairman): these go to the family
 *   holding the Chairman title (the former Chairman), who leads retirements, Family turns and the
 *   next election while the office is vacant (pp.11-15), else the first seat.
 * Other "system" fallbacks offer one option or none. Any future case lands in the fallback, so the
 * game can never stall on a choice nobody may make.
 */
export function systemDecisionDelegate(state: GameState): PlayerId | undefined {
  const decision = state.pendingDecision;
  if (decision.actor !== "system" || decision.legalCommands.length < 2) return undefined;

  const human = (playerId: PlayerId | undefined): playerId is PlayerId =>
    Boolean(playerId && state.players[playerId] && !state.players[playerId].isCrown);

  const titleHolder = chairmanTitleHolder(state);
  if (human(titleHolder)) return titleHolder;
  return state.seatingOrder.find((playerId) => human(playerId));
}

/**
 * The player who picks for the Crown on its pending decision (`pendingDecision.crown.chooser`: the
 * soloist or Player Button holder, rulebook p.46), or undefined when it is not waiting for one.
 */
export function crownChooserOf(state: GameState): PlayerId | undefined {
  const decision = state.pendingDecision;
  if (!state.crown || decision.actor !== CROWN_PLAYER_ID || decision.legalCommands.length === 0) return undefined;
  const chooser = decision.crown?.chooser;
  return chooser && humanPlayerIds(state).includes(chooser) ? chooser : undefined;
}

/**
 * The Crown has a move ready and nobody has to choose for it: it is only waiting for a favour to
 * be bought or passed on ("Let the Crown act"). Any human seat may press that.
 */
export function crownAwaitsLetGo(state: GameState): boolean {
  const decision = state.pendingDecision;
  return Boolean(state.crown) && decision.actor === CROWN_PLAYER_ID && decision.legalCommands.length > 0 && !crownChooserOf(state);
}

/**
 * Who must act on the pending decision: its actor, the delegate of a multi-option "system"
 * decision, or the chooser of a Crown decision with several options. (A Crown decision that only
 * waits for favours may be answered by any human; see delegatedActorFor.)
 */
export function effectiveDecisionActor(state: GameState): PendingDecision["actor"] {
  return systemDecisionDelegate(state) ?? crownChooserOf(state) ?? state.pendingDecision.actor;
}

/**
 * The actor the engine receives a seat's command as, when the seat answers on someone else's
 * behalf: "system" for the named delegate of a multi-option system decision, "crown" for the
 * Crown's chooser, or for any human while the Crown waits on favours. Undefined: the seat acts as
 * itself (and the engine refuses it if the decision is not its own).
 */
export function delegatedActorFor(state: GameState, playerId: PlayerId): "system" | typeof CROWN_PLAYER_ID | undefined {
  const decision = state.pendingDecision;
  if (decision.actor === "system" && systemDecisionDelegate(state) === playerId) return "system";
  if (decision.actor !== CROWN_PLAYER_ID || !humanPlayerIds(state).includes(playerId)) return undefined;
  return crownChooserOf(state) === playerId || crownAwaitsLetGo(state) ? CROWN_PLAYER_ID : undefined;
}

/** Whether this player may answer the pending decision (online: whether they get its options). */
export function playerMayAnswer(state: GameState, playerId: PlayerId): boolean {
  const actor = state.pendingDecision.actor;
  return actor === playerId || actor === "simultaneous" || delegatedActorFor(state, playerId) !== undefined;
}

/**
 * Remembers the favours on offer before a Crown command as passed on, in the game itself so the
 * server's record survives restarts and undo (the local app keeps its own set).
 */
export function passOnCrownFavors(before: GameState, after: GameState): GameState {
  if (!after.crown) return after;
  const turn = `${after.turn}|`;
  const keys = [...new Set([...(after.crown.passedFavors ?? []), ...crownPausingFavorKeys(before)])].filter((key) => key.startsWith(turn));
  return { ...after, crown: { ...after.crown, passedFavors: keys } };
}

export type AutomaticStepsResult = {
  state: GameState;
  /** The commands applied, in order, with actorId "system" (or "crown" from runCrownSteps). */
  commands: GameCommand[];
  /** Set when an automatic step was rejected; the state is left at that step. */
  errors?: ValidationError[];
};

/**
 * Applies every single-option "system" step in a row, stopping at the first decision a player
 * must make (or the end of the game). Command ids are `${idPrefix}-1`, `${idPrefix}-2`, ...
 */
export function runAutomaticSteps(
  state: GameState,
  options: { now: string; idPrefix: string; maxSteps?: number },
): AutomaticStepsResult {
  const maxSteps = options.maxSteps ?? MAX_AUTOMATIC_STEPS;
  const commands: GameCommand[] = [];
  let current = state;

  while (isAutomaticDecision(current.pendingDecision)) {
    if (commands.length >= maxSteps) {
      return {
        state: current,
        commands,
        errors: [{ code: "AUTOMATIC_STEP_LIMIT", message: `Stopped after ${maxSteps} automatic steps.` }],
      };
    }
    const decision = current.pendingDecision;
    const legal = decision.legalCommands[0];
    const command: GameCommand = {
      id: `${options.idPrefix}-${commands.length + 1}`,
      gameId: current.gameId,
      actorId: "system",
      decisionId: decision.id,
      type: legal.type,
      payload: legal.payload ?? {},
      clientTimestamp: options.now,
    };
    const result = applyCommand(current, command);
    if (!result.ok) return { state: current, commands, errors: result.errors };
    commands.push(command);
    current = result.state;
  }

  return { state: current, commands };
}

// --- The Crown (src/engine/crown) ---

/**
 * Where the Crown is acting, for remembering which favours the players have already passed on: the
 * turn, the phase, and the office (or Presidency) in Company Operation, else the step.
 */
export function crownPauseContext(state: GameState): string {
  const current = state.phase === "companyOperation" ? state.companyOperation.current : undefined;
  const where = current
    ? current.office === "presidency"
      ? `presidency:${current.presidency}`
      : current.office
    : state.pendingDecision.step;
  return `${state.turn}|${state.phase}|${where}`;
}

/**
 * Favours some player could buy right now that would change the Crown's pending step, keyed by
 * where the Crown is acting and the favour (see crownPauseContext).
 */
export function crownPausingFavorKeys(state: GameState): string[] {
  const context = crownPauseContext(state);
  const keys = humanPlayerIds(state).flatMap((playerId) =>
    crownFavorOffers(state, playerId)
      .filter((offer) => offer.pausesCrown)
      .map((offer) => `${context}|${offer.favorId}`),
  );
  return [...new Set(keys)];
}

/**
 * Whether the Crown should wait for the players: some favour is on offer that would change its
 * pending step and that they haven't already passed on here (`seen`, from crownPausingFavorKeys).
 * Without this, the Crown would stop before every step of an office while the same favour stays on
 * offer (e.g. "request £3 for an office" before each of the Chairman's allocations).
 */
export function crownFavorsPausing(state: GameState, seen?: ReadonlySet<string>): boolean {
  return crownPausingFavorKeys(state).some((key) => !seen?.has(key));
}

/**
 * The Crown's next command when it can act without anyone: its decision has one option, nobody has
 * to choose for it, and (unless `ignoreFavors`) no favour the players haven't passed on would change it.
 */
export function crownAutoCommand(
  state: GameState,
  options: { ignoreFavors?: boolean; seenFavors?: ReadonlySet<string> } = {},
): LegalCommand | undefined {
  const decision = state.pendingDecision;
  if (!state.crown || decision.actor !== CROWN_PLAYER_ID || decision.legalCommands.length !== 1) return undefined;
  if (decision.crown?.chooser) return undefined;
  if (!options.ignoreFavors && crownFavorsPausing(state, options.seenFavors)) return undefined;
  return decision.legalCommands[0];
}

/**
 * Plays the Crown's steps (and single-option "system" steps in between) until a player must act,
 * someone must choose for the Crown, or a favour they haven't passed on is on offer. Command ids
 * are `${idPrefix}-1`, ...
 */
export function runCrownSteps(
  state: GameState,
  options: {
    now: string;
    idPrefix: string;
    maxSteps?: number;
    includeSystem?: boolean;
    ignoreFavors?: boolean;
    /** Favours the players have passed on (crownPausingFavorKeys): the Crown doesn't wait for them again. */
    seenFavors?: ReadonlySet<string>;
  },
): AutomaticStepsResult {
  const maxSteps = options.maxSteps ?? MAX_AUTOMATIC_STEPS;
  const includeSystem = options.includeSystem ?? true;
  const commands: GameCommand[] = [];
  let current = state;

  for (;;) {
    const decision = current.pendingDecision;
    const passed = current.crown?.passedFavors;
    const seenFavors = passed?.length ? new Set([...(options.seenFavors ?? []), ...passed]) : options.seenFavors;
    const legal =
      crownAutoCommand(current, { ignoreFavors: options.ignoreFavors, seenFavors }) ??
      (includeSystem && isAutomaticDecision(decision) ? decision.legalCommands[0] : undefined);
    if (!legal) break;
    if (commands.length >= maxSteps) {
      return {
        state: current,
        commands,
        errors: [{ code: "AUTOMATIC_STEP_LIMIT", message: `Stopped after ${maxSteps} automatic steps.` }],
      };
    }
    const command: GameCommand = {
      id: `${options.idPrefix}-${commands.length + 1}`,
      gameId: current.gameId,
      actorId: decision.actor === CROWN_PLAYER_ID ? CROWN_PLAYER_ID : "system",
      decisionId: decision.id,
      type: legal.type,
      payload: legal.payload ?? {},
      clientTimestamp: options.now,
    };
    const result = applyCommand(current, command);
    if (!result.ok) return { state: current, commands, errors: result.errors };
    commands.push(command);
    current = result.state;
  }

  return { state: current, commands };
}
