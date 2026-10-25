import type { GameState, PlayerId, PlayerState, RngRollRecord } from "../../types";

/** Things that happened while resolving one command, gathered into its log entry. */
export type Collector = {
  notes: string[];
  rolls: RngRollRecord[];
  /** Structured facts for the log entry's details. */
  details: Record<string, unknown>;
};

export function newCollector(): Collector {
  return { notes: [], rolls: [], details: {} };
}

export function playerName(state: GameState, playerId: PlayerId | undefined): string {
  if (!playerId) return "nobody";
  return state.players[playerId]?.name ?? playerId;
}

export function updatePlayer(
  state: GameState,
  playerId: PlayerId,
  update: (player: PlayerState) => PlayerState,
): GameState {
  const player = state.players[playerId];
  if (!player) return state;

  return { ...state, players: { ...state.players, [playerId]: update(player) } };
}

export function addCash(state: GameState, playerId: PlayerId, amount: number): GameState {
  return updatePlayer(state, playerId, (player) => ({ ...player, cash: player.cash + amount }));
}

/** Seating order starting with the Prime Minister and going clockwise (p.9, p.35). */
export function primeMinisterOrder(state: GameState): PlayerId[] {
  const start = state.parliament.primeMinister
    ? state.seatingOrder.indexOf(state.parliament.primeMinister)
    : 0;
  const offset = start < 0 ? 0 : start;

  return [...state.seatingOrder.slice(offset), ...state.seatingOrder.slice(0, offset)];
}

/** Decision ids only need to be unique; every command adds a log entry. */
export function nextDecisionId(state: GameState, step: string): string {
  return `decision-${step.replace(/\./g, "-")}-turn-${state.turn}-${state.log.length + 1}`;
}
