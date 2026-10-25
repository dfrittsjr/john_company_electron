import { expect } from "vitest";
import type { GameState, LegalCommand, PlayerId, PlayerState } from "../../engine";
import { applyCommandOrThrow } from "./game";

// Builders and helpers for Family and Hiring tests. Like fixtures/builders.ts, every builder that
// places a family member takes it from supply, so each family keeps all 18 pieces somewhere.

function updatePlayer(state: GameState, playerId: PlayerId, update: (player: PlayerState) => PlayerState): GameState {
  return { ...state, players: { ...state.players, [playerId]: update(state.players[playerId]) } };
}

export function withPrestigeCard(state: GameState, playerId: PlayerId, cardId: string): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    prestigeCards: [...player.prestigeCards, { id: `${cardId}-test`, cardId }],
  }));
}

export function withBlackmailCard(state: GameState, playerId: PlayerId, cardId: string): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    blackmailCards: [...player.blackmailCards, { id: `${cardId}-test`, cardId, facedown: true }],
  }));
}

/** Passed laws, oldest first: the last one with an extra action is the one players may use (p.13). */
export function withPassedLaws(state: GameState, lawIds: string[]): GameState {
  return {
    ...state,
    parliament: {
      ...state.parliament,
      passedLaws: lawIds.map((lawId, index) => ({ id: `law-${index}-${lawId}`, lawId })),
    },
  };
}

export function withPiecesOnPrize(state: GameState, playerId: PlayerId, prizeId: string, count: number): GameState {
  return updatePlayer(state, playerId, (player) => {
    // Draw from supply first, then from pieces parked as pensioners (withSupply), never below zero.
    const fromSupply = Math.min(count, player.familyMembers.supply);
    return {
      ...player,
      familyMembers: {
        ...player.familyMembers,
        supply: player.familyMembers.supply - fromSupply,
        pensioners: player.familyMembers.pensioners - (count - fromSupply),
        prizes: { ...player.familyMembers.prizes, [prizeId]: (player.familyMembers.prizes[prizeId] ?? 0) + count },
      },
    };
  });
}

export function withOpportunityMarker(
  state: GameState,
  playerId: PlayerId,
  marker: PlayerState["opportunityMarker"],
): GameState {
  return updatePlayer(state, playerId, (player) => ({ ...player, opportunityMarker: marker }));
}

export function withChairmanMarker(state: GameState, playerId: PlayerId | undefined): GameState {
  return { ...state, company: { ...state.company, chairmanMarker: playerId } };
}

export function withDebt(state: GameState, debt: number): GameState {
  return { ...state, company: { ...state.company, debt } };
}

export function withStockExchangePiece(state: GameState, slotId: string, playerId: PlayerId): GameState {
  const placed: GameState = {
    ...state,
    company: {
      ...state.company,
      stockExchange: state.company.stockExchange.map((slot) =>
        slot.id === slotId ? { ...slot, share: { id: `pending-${slotId}-${playerId}`, owner: playerId } } : slot,
      ),
    },
  };

  return updatePlayer(placed, playerId, (player) => ({
    ...player,
    familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - 1 },
  }));
}

export function withSupply(state: GameState, playerId: PlayerId, supply: number): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    familyMembers: {
      ...player.familyMembers,
      pensioners: player.familyMembers.pensioners + player.familyMembers.supply - supply,
      supply,
    },
  }));
}

/** The legal command whose label contains `text`; fails the test if there is none. */
export function commandLabelled(state: GameState, text: string): LegalCommand {
  const command = state.pendingDecision.legalCommands.find((candidate) => candidate.label.includes(text));
  expect(command, `no legal command labelled "${text}" in ${state.pendingDecision.step}`).toBeDefined();
  return command as LegalCommand;
}

export function labels(state: GameState): string[] {
  return state.pendingDecision.legalCommands.map((command) => command.label);
}

/** Apply the legal command whose label contains `text`, as the pending decision's actor. */
export function choose(state: GameState, text: string, id = `command-${state.log.length}`): GameState {
  const command = commandLabelled(state, text);
  const actor = state.pendingDecision.actor;

  return applyCommandOrThrow(state, {
    id,
    actorId: actor === "simultaneous" ? "player-red" : actor,
    type: command.type,
    payload: command.payload ?? {},
  });
}
