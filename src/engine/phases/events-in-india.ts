import type { CommandHandler } from "../command-handler";
import type { ApplyCommandResult, GameCommand, GameState, PlayerId } from "../types";
import { applyDefenceChoice, chooseNextRebellion, type DefenceChoice } from "./events-in-india/attacks";
import { createContext, log, playerName, type ResolutionContext } from "./events-in-india/context";
import { ENVOY_TO_THE_MUGHALS, NESTED_TILE_PREFIX, advance, beginEventsInIndia, markEnvoyOffered, type EnvoyChoice } from "./events-in-india/resolve";
import type { TileWorkItem } from "./events-in-india.state";
import { facedownBlackmailInstance, registerBlackmailResume, startBlackmailPlay } from "./negotiation-blackmail";
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
  const playerId = command.actorId as PlayerId;
  const choice = command.payload as EnvoyChoice;
  markEnvoyOffered(ctx, playerId);
  if (!choice.play) {
    log(ctx, "eventsInIndia.envoyDeclined", `${playerName(ctx, playerId)} does not play Envoy to the Mughals.`);
    return finish(ctx);
  }

  // Played through the shared blackmail path (its handler moves the Elephant and pays), so Man on
  // the Inside may cancel it (p.12); the phase continues in the resume below.
  const cardInstanceId = facedownBlackmailInstance(ctx.draft, playerId, ENVOY_TO_THE_MUGHALS)!;
  const played = startBlackmailPlay(
    { ...ctx.draft, updatedAt: command.clientTimestamp },
    {
      playerId,
      cardInstanceId,
      params: choice.facing ? { regionId: choice.regionId, facing: choice.facing } : { regionId: choice.regionId },
      resumeKey: ENVOY_RESUME,
      timestamp: command.clientTimestamp,
    },
  );
  return { ok: true, state: played, logEntry: played.log[played.log.length - 1] };
}

const ENVOY_RESUME = "eventsInIndia.envoyToTheMughals";

registerBlackmailResume(ENVOY_RESUME, (state) => {
  const ctx = createContext(state, {
    id: `resume-${state.log.length}`,
    gameId: state.gameId,
    actorId: "system",
    decisionId: state.pendingDecision.id,
    type: ENVOY_RESUME,
    payload: {},
    clientTimestamp: state.updatedAt,
  });
  const pendingDecision = advance(ctx);
  return { ...ctx.draft, updatedAt: ctx.now, pendingDecision };
});

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
  const state: GameState = { ...ctx.draft, updatedAt: ctx.now, pendingDecision };

  if (ctx.nestedResume) {
    const resume = nestedResumes.get(ctx.nestedResume);
    if (!resume) throw new Error(`No nested India resume registered for "${ctx.nestedResume}".`);
    return { ok: true, logEntry, state: resume(state) };
  }
  return { ok: true, logEntry, state };
}

// --- Nested resolutions: India effects started by another phase (law effects) ----------------

const nestedResumes = new Map<string, (state: GameState) => GameState>();

/** How the starting phase continues once a nested resolution that waited for players is done. */
export function registerNestedIndiaResume(key: string, resume: (state: GameState) => GameState): void {
  nestedResumes.set(key, resume);
}

/**
 * Resolve India effects outside Events in India with this phase's own rules (Turmoil and Cascade,
 * unrest, Foreign Invasion and attacks against the Company with their defence decisions), e.g. for
 * Relief Demanded for Indian Famine! and War Against France! (law cards). The phase switches to
 * Events in India while players decide. If nothing needed a decision, the returned state is back in
 * the starting phase with its pending decision untouched and no resume is called; otherwise it waits,
 * and the resume registered under `resumeKey` runs when the effects finish.
 */
export function startNestedIndiaResolution(state: GameState, label: string, work: TileWorkItem[], resumeKey: string): GameState {
  const ctx = createContext(state, {
    id: `nested-${state.log.length}`,
    gameId: state.gameId,
    actorId: "system",
    decisionId: state.pendingDecision.id,
    type: "eventsInIndia.nested",
    payload: {},
    clientTimestamp: state.updatedAt,
  });
  ctx.draft.eventsInIndia.progress = {
    turn: state.turn,
    envoyOffered: [...state.seatingOrder],
    stormFaceId: "nested",
    eventsRemaining: 0,
    tile: {
      tileId: `${NESTED_TILE_PREFIX}${label}`,
      work: [...work],
      cascaded: [],
      rebelledRegionIds: [],
      foreignInvasionRedirect: false,
      returnedToStack: false,
    },
    nested: { resumeKey, returnPhase: state.phase },
  };
  ctx.draft.phase = "eventsInIndia";
  const pendingDecision = advance(ctx);
  return { ...ctx.draft, updatedAt: ctx.now, pendingDecision };
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
