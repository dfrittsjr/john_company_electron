import type { CommandHandler } from "../command-handler";
import type { ApplyCommandResult, GameCommand, GameState, PlayerId } from "../types";
import { applyDefenceChoice, chooseNextRebellion, type DefenceChoice } from "./events-in-india/attacks";
import { createContext, log, playerName, type ResolutionContext } from "./events-in-india/context";
import { advance, beginEventsInIndia, resolveEnvoyChoice, type EnvoyChoice } from "./events-in-india/resolve";
import type { GovernorLossRecord } from "./events-in-india.state";
import { wrongPhase } from "./shared";

// VII. Events in India (rulebook pp.28-33). The phase runs automatically, pausing only for player
// choices: Envoy to the Mughals before the storm die, the order of Rebellions within a
// Presidency, and which pieces an Army exhausts in defence.

export function confirmEventsInIndia(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "eventsInIndia" || state.pendingDecision.step !== "eventsInIndia.confirm") {
    return wrongPhase("Events in India can only begin from its confirmation.");
  }

  const ctx = createContext(state, command);
  beginEventsInIndia(ctx);
  log(ctx, "eventsInIndia.started", `Events in India begins (turn ${state.turn}).`);
  return finish(ctx);
}

export function chooseEnvoyToTheMughals(state: GameState, command: GameCommand): ApplyCommandResult {
  const invalid = validateChoice(state, command, "eventsInIndia.envoyToTheMughals");
  if (invalid) return invalid;

  const ctx = createContext(state, command);
  const choice = command.payload as EnvoyChoice;
  if (!choice.play) log(ctx, "eventsInIndia.envoyDeclined", `${playerName(ctx, command.actorId)} does not play Envoy to the Mughals.`);
  resolveEnvoyChoice(ctx, command.actorId as PlayerId, choice);
  return finish(ctx);
}

export function chooseCompanyAttack(state: GameState, command: GameCommand): ApplyCommandResult {
  const invalid = validateChoice(state, command, "eventsInIndia.chooseAttack");
  if (invalid) return invalid;

  const ctx = createContext(state, command);
  chooseNextRebellion(ctx, (command.payload as { regionId: string }).regionId);
  return finish(ctx);
}

export function defendCompanyRegion(state: GameState, command: GameCommand): ApplyCommandResult {
  const invalid = validateChoice(state, command, "eventsInIndia.defend");
  if (invalid) return invalid;

  const ctx = createContext(state, command);
  applyDefenceChoice(ctx, command.payload as DefenceChoice);
  log(ctx, "eventsInIndia.pieceExhausted", describeDefenceChoice(ctx, command.payload as DefenceChoice));
  return finish(ctx);
}

function describeDefenceChoice(ctx: ResolutionContext, choice: DefenceChoice): string {
  const actor = playerName(ctx, ctx.command.actorId);
  if (choice.piece === "regiment") return `${actor} exhausts a regiment.`;
  if (choice.piece === "officer") return `${actor} exhausts one of ${playerName(ctx, choice.playerId)}'s officers.`;
  return `${actor} exhausts the remaining pieces automatically.`;
}

function finish(ctx: ResolutionContext): ApplyCommandResult {
  const pendingDecision = advance(ctx);
  const logEntry = ctx.lastEntry ?? log(ctx, "eventsInIndia.continued", "Events in India continues.");

  return {
    ok: true,
    logEntry,
    state: { ...ctx.draft, updatedAt: ctx.now, pendingDecision },
  };
}

/** The dispatcher checks the command type; the payload must also be one of the offered choices. */
function validateChoice(state: GameState, command: GameCommand, step: string): ApplyCommandResult | undefined {
  if (state.phase !== "eventsInIndia" || state.pendingDecision.step !== step) {
    return wrongPhase(`"${command.type}" is not the current Events in India decision.`);
  }

  const wanted = stableStringify(command.payload ?? {});
  if (state.pendingDecision.legalCommands.some((legal) => stableStringify(legal.payload ?? {}) === wanted)) {
    return undefined;
  }

  return {
    ok: false,
    errors: [
      {
        code: "ILLEGAL_EVENTS_IN_INDIA_CHOICE",
        message: `That choice is not one of the options offered for "${step}".`,
        field: "payload",
      },
    ],
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Governors removed by Region Loss on a given turn, for "The British Despots of India!" (failure
 * card #82): "Anyone who had a Governor that was removed in Region Loss on the final turn should
 * lower their score by 2VP for each."
 */
export function governorsLostToRegionLossOnTurn(state: GameState, turn: number): GovernorLossRecord[] {
  return state.eventsInIndia.governorsLostToRegionLoss.filter((record) => record.turn === turn);
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const eventsInIndiaCommandHandlers: Record<string, CommandHandler> = {
  "eventsInIndia.confirm": confirmEventsInIndia,
  "eventsInIndia.envoyToTheMughals": chooseEnvoyToTheMughals,
  "eventsInIndia.chooseAttack": chooseCompanyAttack,
  "eventsInIndia.defend": defendCompanyRegion,
};
