import { expect } from "vitest";
import {
  applyCommand,
  type CardInstance,
  type EnterpriseInstance,
  type GameState,
  type PhaseId,
  type PlayerId,
} from "../../engine";
import { createFamilyActionCommands } from "../../engine/phases/family";
import { deserializeGameState, serializeSave } from "../../save";
import { applyCommandOrThrow, createHotseatGame, expectGameInvariants } from "./game";

// Helpers for Negotiation tests. Players: player-red, player-blue, player-yellow.

export const RED = "player-red";
export const BLUE = "player-blue";
export const YELLOW = "player-yellow";

const PHASE_COMMANDS: Partial<Record<PhaseId, string>> = {
  setup: "setup.confirmStart",
  londonSeason: "londonSeason.confirm",
  hiring: "hiring.skipVacancy",
  companyOperation: "companyOperation.passOffice",
  bonuses: "bonuses.confirm",
  revenue: "revenue.confirm",
  eventsInIndia: "eventsInIndia.confirm",
  parliament: "parliament.confirm",
  upkeep: "upkeep.confirm",
  finalScoring: "finalScoring.confirm",
};

/** A fresh 1710 game with cash, parked in the given phase on a placeholder decision. */
export function negotiationGame(phase: PhaseId = "parliament", cash: Record<PlayerId, number> = {}): GameState {
  const state = atPhase(createHotseatGame({ seed: `negotiation-${phase}` }), phase);
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => [id, { ...player, cash: cash[id] ?? 10 }]),
    ),
  };
}

export function atPhase(state: GameState, phase: PhaseId): GameState {
  if (phase === "family") {
    return {
      ...state,
      phase,
      pendingDecision: {
        id: `decision-family-choose-action-test-${RED}`,
        phase,
        step: "family.chooseAction",
        actor: RED,
        visibility: "private",
        prompt: "Choose a family action.",
        legalCommands: createFamilyActionCommands({ ...state, phase }, RED),
        canSave: true,
      },
    };
  }

  const type = PHASE_COMMANDS[phase];
  if (!type) throw new Error(`No placeholder decision for ${phase}`);
  return {
    ...state,
    phase,
    pendingDecision: {
      id: `decision-${phase}-test`,
      phase,
      step: type,
      actor: "system",
      visibility: "public",
      prompt: `Placeholder ${phase} decision.`,
      legalCommands: [{ type, label: "Continue", payload: {} }],
      canSave: true,
    },
  };
}

let commandCounter = 0;

/** Apply a command (anytime or pending-decision) for a player; throws on rejection. */
export function act(state: GameState, actorId: PlayerId, type: string, payload: unknown): GameState {
  commandCounter += 1;
  return applyCommandOrThrow(state, { id: `negotiation-command-${commandCounter}`, actorId, type, payload });
}

/** Apply a command expecting rejection; returns the error messages. */
export function rejectedMessages(state: GameState, actorId: PlayerId, type: string, payload: unknown): string[] {
  commandCounter += 1;
  const result = applyCommand(state, {
    id: `negotiation-command-${commandCounter}`,
    gameId: state.gameId,
    actorId,
    decisionId: state.pendingDecision.id,
    type,
    payload,
    clientTimestamp: "2026-06-13T12:10:00.000Z",
  });
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors.map((error) => error.message);
}

export function withEnterprise(state: GameState, playerId: PlayerId, enterprise: EnterpriseInstance): GameState {
  const player = state.players[playerId];
  const vp = enterprise.type === "luxury" ? 2 : 0;
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        enterprises: [...player.enterprises, enterprise],
        victoryPoints: player.victoryPoints + vp,
      },
    },
  };
}

export function withPrestige(state: GameState, playerId: PlayerId, cardId: string, instanceId = `${cardId}-${playerId}`): GameState {
  const player = state.players[playerId];
  const card: CardInstance = { id: instanceId, cardId };
  return { ...state, players: { ...state.players, [playerId]: { ...player, prestigeCards: [...player.prestigeCards, card] } } };
}

export function withBlackmail(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  options: { facedown?: boolean; instanceId?: string } = {},
): GameState {
  const player = state.players[playerId];
  const card: CardInstance = { id: options.instanceId ?? `bm-${cardId}`, cardId, facedown: options.facedown ?? true };
  const cards = [...player.blackmailCards, card];
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, blackmailCards: cards } },
    hidden: {
      ...state.hidden,
      privateCards: { ...state.hidden.privateCards, [playerId]: cards.filter((candidate) => candidate.facedown) },
    },
  };
}

/** Move family members from supply onto a prize, adding its VP as a retirement would. */
export function withPrizePieces(state: GameState, playerId: PlayerId, prizeId: string, count: number, vpEach: number): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        victoryPoints: player.victoryPoints + vpEach * count,
        familyMembers: {
          ...player.familyMembers,
          supply: player.familyMembers.supply - count,
          prizes: { ...player.familyMembers.prizes, [prizeId]: (player.familyMembers.prizes[prizeId] ?? 0) + count },
        },
      },
    },
  };
}

export function promiseId(guarantor: PlayerId, type: string): string {
  return `promise-${guarantor}-${type}`;
}

export function holderOf(state: GameState, id: string): PlayerId | undefined {
  return state.negotiation.promiseCards.find((card) => card.id === id)?.holder;
}

/** Save and reload, checking the pending decision and negotiation state survive. */
export function roundTrip(state: GameState): GameState {
  const loaded = deserializeGameState(serializeSave(state, { saveId: "negotiation-round-trip", now: "2026-06-13T12:30:00.000Z" }));
  expect(loaded.pendingDecision).toEqual(state.pendingDecision);
  expect(loaded.negotiation).toEqual(state.negotiation);
  expectGameInvariants(loaded);
  return loaded;
}
