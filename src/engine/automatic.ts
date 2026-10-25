import { applyCommand } from "./commands";
import { chairmanTitleHolder, clockwiseFrom } from "./selectors";
import type { GameCommand, GameState, PendingDecision, PlayerId, ValidationError } from "./types";

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
 * - Military Oversight nepotism (companyOperation.militaryOversight, "do the other families with
 *   officers in that Army consent...?"): goes to the first other family with officers in that
 *   Army, clockwise from the Prime Minister. The rules ask each of those families; the engine
 *   models it as one yes/no, so with two or more such families one answers for all (known gap).
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

  const interrupt = state.companyOperation.interrupt;
  if (decision.step === "companyOperation.militaryOversight" && interrupt?.kind === "militaryOversight" && interrupt.stage === "nepotism") {
    const officers = state.company.armies[interrupt.army]?.officers ?? {};
    const consenting = clockwiseFrom(state, state.parliament.primeMinister).find(
      (playerId) =>
        playerId !== interrupt.candidate &&
        human(playerId) &&
        (officers[playerId]?.ready ?? 0) + (officers[playerId]?.exhausted ?? 0) > 0,
    );
    if (consenting) return consenting;
  }

  const titleHolder = chairmanTitleHolder(state);
  if (human(titleHolder)) return titleHolder;
  return state.seatingOrder.find((playerId) => human(playerId));
}

/** Who must act on the pending decision: its actor, or the delegate of a multi-option "system" decision. */
export function effectiveDecisionActor(state: GameState): PendingDecision["actor"] {
  return systemDecisionDelegate(state) ?? state.pendingDecision.actor;
}

export type AutomaticStepsResult = {
  state: GameState;
  /** The commands applied, in order, all with actorId "system". */
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
