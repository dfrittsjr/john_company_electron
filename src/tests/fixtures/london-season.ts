import type { EnterpriseInstance, GameState, PhaseId, PlayerId } from "../../engine";

// Builders for London Season, Upkeep and Final Scoring tests. Like fixtures/builders.ts, every
// family piece placed here comes out of supply so the 18-pieces invariant keeps holding.

function updatePlayer(state: GameState, playerId: PlayerId, change: (player: GameState["players"][string]) => GameState["players"][string]): GameState {
  return { ...state, players: { ...state.players, [playerId]: change(state.players[playerId]) } };
}

export function withPensioners(state: GameState, playerId: PlayerId, count: number): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    familyMembers: {
      ...player.familyMembers,
      supply: player.familyMembers.supply - count,
      pensioners: player.familyMembers.pensioners + count,
    },
  }));
}

/** Family members already on a prize. VP is not adjusted unless `victoryPoints` is given. */
export function withPrizePieces(
  state: GameState,
  playerId: PlayerId,
  prizeId: string,
  count: number,
  victoryPoints?: number,
): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    victoryPoints: victoryPoints ?? player.victoryPoints,
    familyMembers: {
      ...player.familyMembers,
      supply: player.familyMembers.supply - count,
      prizes: { ...player.familyMembers.prizes, [prizeId]: (player.familyMembers.prizes[prizeId] ?? 0) + count },
    },
  }));
}

export function withPrestigeCards(state: GameState, playerId: PlayerId, cardIds: string[]): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    prestigeCards: [...player.prestigeCards, ...cardIds.map((cardId) => ({ id: `prestige-${cardId}`, cardId }))],
  }));
}

export function withBlackmail(state: GameState, playerId: PlayerId, cardIds: string[], facedown = true): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    blackmailCards: [...player.blackmailCards, ...cardIds.map((cardId) => ({ id: `blackmail-${cardId}`, cardId, facedown }))],
  }));
}

export function withEnterprises(state: GameState, playerId: PlayerId, enterprises: Array<Pick<EnterpriseInstance, "type" | "cardId">>): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    enterprises: [
      ...player.enterprises,
      ...enterprises.map((enterprise, index) => ({ ...enterprise, id: `${enterprise.type}-test-${playerId}-${player.enterprises.length + index}` })),
    ],
  }));
}

export function withPlayerFields(state: GameState, playerId: PlayerId, fields: Partial<GameState["players"][string]>): GameState {
  return updatePlayer(state, playerId, (player) => ({ ...player, ...fields }));
}

export function withDisplay(state: GameState, display: string[], deck: string[] = []): GameState {
  return { ...state, londonSeason: { ...state.londonSeason, display, deck, discard: [], displayBuilt: true } };
}

/** Puts the game at a phase's opening system confirmation. */
export function atConfirmation(state: GameState, phase: PhaseId, commandType: string, turn = state.turn): GameState {
  return {
    ...state,
    turn,
    phase,
    pendingDecision: {
      id: `decision-test-${commandType}-${turn}`,
      phase,
      step: commandType,
      actor: "system",
      visibility: "public",
      prompt: `Test: ${commandType}`,
      legalCommands: [{ type: commandType, label: commandType, payload: {} }],
      canSave: true,
    },
  };
}

/** The listed choice whose label contains `text`. Throws so a test fails clearly when it is missing. */
export function choiceLabelled(state: GameState, text: string): { type: string; payload: unknown } {
  const legal = state.pendingDecision.legalCommands.find((candidate) => candidate.label.includes(text));
  if (!legal) {
    throw new Error(
      `No choice labelled "${text}". Choices: ${state.pendingDecision.legalCommands.map((candidate) => candidate.label).join(" | ")}`,
    );
  }
  return { type: legal.type, payload: legal.payload ?? {} };
}
