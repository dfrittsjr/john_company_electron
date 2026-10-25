// The Vote to Deregulate (rulebook p.36): a special session of Parliament at the start of a turn,
// before the London Season. This module holds the rules around the session (when it is offered,
// how much support it starts with, what passing and failing do). The voting itself reuses
// Parliament's own vote steps (../parliament.ts). Notes: docs/phases/deregulation-vr.md.
import { companyShareScoring, companyTracks, lawsById, scenarios } from "../../../data";
import type { GameState, PendingDecision } from "../../types";
import { nextDecisionId, type Collector } from "./common";
import { discardPassedLaw, isLawPassed, lawCard } from "./laws";

export const DEREGULATION_LAW_ID = "deregulation";

function standingIsLined(state: GameState): boolean {
  return companyTracks.standing[state.company.standing]?.lined ?? false;
}
function standingIsStarred(state: GameState): boolean {
  return companyTracks.standing[state.company.standing]?.star ?? false;
}
function debtSpace(state: GameState) {
  return companyTracks.debt.find((space) => space.value === state.company.debt);
}

/** How many of Standing and Debt sit on a lined space: 0, 1 or 2. */
export function linedMarkerCount(state: GameState): number {
  return (standingIsLined(state) ? 1 : 0) + (debtSpace(state)?.lined ? 1 : 0);
}

/** A star on either marker makes the session compulsory (p.36). */
export function deregulationMandatory(state: GameState): boolean {
  return standingIsStarred(state) || Boolean(debtSpace(state)?.star);
}

/**
 * Whether the Prime Minister may (or must) call the session now (ruling 1): the scenario allows
 * Deregulation, the Company has not deregulated, a Prime Minister exists, and Standing and/or Debt
 * is on a lined space. Returns undefined when it is not available.
 */
export function deregulationOffer(state: GameState): { mandatory: boolean } | undefined {
  const scenario = scenarios.find((candidate) => candidate.id === state.scenario);
  if (!scenario?.deregulationAvailable || state.parliament.deregulated) return undefined;
  if (!state.parliament.primeMinister || !state.players[state.parliament.primeMinister]) return undefined;
  if (state.company.failed) return undefined;
  if (linedMarkerCount(state) === 0) return undefined;
  return { mandatory: deregulationMandatory(state) };
}

/** +2 when exactly one marker is on a lined space, +6 when both, plus laws like Writer Privileges (+5). */
export function deregulationStartingSupport(state: GameState): number {
  const base = lawCard(DEREGULATION_LAW_ID).variableStartingSupport;
  const lined = linedMarkerCount(state);
  const fromMarkers = lined >= 2 ? (base?.bothMarkersOnLinedSpaces ?? 6) : lined === 1 ? (base?.oneMarkerOnLinedSpace ?? 2) : 0;
  const fromLaws = state.parliament.passedLaws.reduce((total, passed) => {
    const law = lawsById.get(passed.lawId);
    return (
      total +
      (law?.effects ?? []).reduce(
        (sum, effect) => sum + (effect.type === "deregulationVoteInitialSupportBonus" ? effect.amount : 0),
        0,
      )
    );
  }, 0);
  return fromMarkers + fromLaws;
}

/** The Prime Minister's choice at the start of a turn: call the special session, or (if allowed) not. */
export function deregulationCallDecision(state: GameState, mandatory: boolean): PendingDecision {
  const support = deregulationStartingSupport(state);
  const lined = linedMarkerCount(state);
  const why =
    lined === 2
      ? "Company Standing and Debt are both on lined spaces"
      : standingIsLined(state)
        ? "Company Standing is on a lined space"
        : "Company Debt is on a lined space";
  const call = {
    type: "parliament.deregulationCall",
    label: `Call a special session to vote on Deregulation (starting support ${support >= 0 ? "+" : ""}${support})`,
    description: lawCard(DEREGULATION_LAW_ID).text,
    payload: { call: true },
  };
  return {
    id: nextDecisionId(state, "parliament.deregulationCall"),
    phase: "parliament",
    step: "parliament.deregulationCall",
    actor: state.parliament.primeMinister!,
    visibility: "public",
    prompt: mandatory
      ? `${why}, and a marker is on a starred space: the Prime Minister must call a special session to vote on Deregulation (p.36).`
      : `${why}: the Prime Minister may call a special session to vote on Deregulation (p.36).`,
    legalCommands: mandatory
      ? [call]
      : [call, { type: "parliament.deregulationCall", label: "Don't call the session this turn", payload: { call: false } }],
    canSave: true,
  };
}

/**
 * The vote passed: lower Debt by half (rounding down), Standing to the "S" space, the firm rules
 * come into effect, laws that end with Deregulation are discarded (p.36 and the law cards). The
 * Prime Minister's passed law token and the passed-law entry are added by Parliament's own pass step.
 */
export function enactDeregulation(state: GameState, collector: Collector): GameState {
  const reset = companyTracks.standing.find((space) => space.deregulationReset)!;
  const cleared = Math.floor(state.company.debt / 2);
  let next: GameState = {
    ...state,
    firms: [],
    company: { ...state.company, debt: state.company.debt - cleared, standing: reset.index },
    parliament: { ...state.parliament, deregulated: true },
  };
  collector.notes.push(
    `Deregulation: Company Debt fell by ${cleared} to ${next.company.debt}, Standing moved to "${reset.label}", and players may now form firms.`,
  );
  for (const passed of state.parliament.passedLaws) {
    const law = lawsById.get(passed.lawId);
    if (law?.effects.some((effect) => effect.type === "discardWhenDeregulationOccurs") && isLawPassed(next, passed.lawId)) {
      next = discardPassedLaw(next, passed.lawId);
      collector.notes.push(`${law.name} was discarded.`);
    }
  }
  return next;
}

/** The vote failed: the Company share VP token is placed or flipped, never beyond 3 (p.36). */
export function failDeregulation(state: GameState, collector: Collector): GameState {
  const shareValue = Math.min(companyShareScoring.maxAbsoluteValue, state.company.shareValue + 1);
  collector.notes.push(
    `Deregulation failed. The Prime Minister stays in power and Company shares are now worth +${shareValue}/-${shareValue} VP.`,
  );
  return { ...state, company: { ...state.company, shareValue } };
}
