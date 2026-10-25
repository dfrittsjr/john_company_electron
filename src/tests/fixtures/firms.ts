import type { EnterpriseInstance, GameState, PlayerId } from "../../engine";
import { withCourtShares } from "./builders";
import { createHotseatGame } from "./game";

// Builders for Deregulation and firm tests (rulebook pp.36-42).

export const RED = "player-red";
export const BLUE = "player-blue";
export const YELLOW = "player-yellow";

/** A 1710 hotseat game that has passed the Vote to Deregulate: Standing on "S" (£10), Debt 0. */
export function deregulatedGame(seed = "firms"): GameState {
  const state = createHotseatGame({ seed, gameId: `game-${seed}` });
  return {
    ...state,
    scenario: "long-1710",
    finalTurn: 8,
    parliament: { ...state.parliament, deregulated: true },
    company: { ...state.company, standing: 4, debt: 0 },
    firms: [],
  };
}

/** Gives a player an uninvested workshop. */
export function withWorkshop(state: GameState, playerId: PlayerId, id = `workshop-${playerId}`): GameState {
  const player = state.players[playerId];
  const workshop: EnterpriseInstance = { id, type: "workshop" };
  return { ...state, players: { ...state.players, [playerId]: { ...player, enterprises: [...player.enterprises, workshop] } } };
}

/** Puts Company shares in the Court for these owners (ids court-<owner>-<n>), pieces from supply. */
export function withCompanyShares(state: GameState, owners: PlayerId[], createdTurn?: number): GameState {
  return withCourtShares(state, [
    ...state.company.court,
    ...owners.map((owner, index) => ({ id: `court-${owner}-${index + 1}`, owner, ...(createdTurn === undefined ? {} : { createdTurn }) })),
  ]);
}
