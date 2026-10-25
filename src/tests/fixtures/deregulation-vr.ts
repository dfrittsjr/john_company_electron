import type { FirmState, GameState, PlayerId } from "../../engine";
import { beginTurn } from "../../engine/phases/turn-start";
import { createSystemDecision } from "../../engine/phases/shared";
import { deserializeGameState, serializeSave } from "../../save";
import { applyCommandOrThrow, createHotseatGame } from "./game";
import { withCash } from "./builders";
import { BLUE, RED, YELLOW, deregulatedGame } from "./firms";

// Builders for the Vote to Deregulate and firm Revenue tests (rulebook pp.36, 41-42).

export { BLUE, RED, YELLOW };

/** Long 1710 at the start of a later turn, before the London Season, with the Prime Minister set. */
export function turnStartGame(options: {
  standing: number;
  debt: number;
  passedLaws?: string[];
  cash?: Record<PlayerId, number>;
  primeMinister?: PlayerId | null;
  shareValue?: number;
}): GameState {
  const base = createHotseatGame({ seed: "vr-turn-start", gameId: "game-vr-turn-start" });
  const state: GameState = {
    ...withCash(base, { [RED]: 0, [BLUE]: 0, [YELLOW]: 0, ...options.cash }),
    scenario: "long-1710",
    finalTurn: 8,
    turn: 3,
    company: { ...base.company, standing: options.standing, debt: options.debt, shareValue: options.shareValue ?? 1 },
    parliament: {
      ...base.parliament,
      primeMinister: options.primeMinister === null ? undefined : (options.primeMinister ?? RED),
      passedLaws: (options.passedLaws ?? []).map((lawId) => ({ id: `law-${lawId}`, lawId })),
    },
  };
  return beginTurn(state);
}

export type FirmSpec = {
  id: string;
  manager: PlayerId;
  shares: Record<PlayerId, number>;
  london?: number;
  india?: number;
  value?: number;
  ships?: number;
  strategy?: "hobnob" | "west-indian" | "south-indian" | "east-indian";
  initiative?: number;
  dividendCube?: number;
};

/** Revenue's first decision with these firms in play (shares are pieces taken from supply). */
export function revenueGame(specs: FirmSpec[], options: { cash?: Record<PlayerId, number> } = {}): GameState {
  let state = withCash(deregulatedGame("vr-revenue"), { [RED]: 0, [BLUE]: 0, [YELLOW]: 0, ...options.cash });
  const firms: FirmState[] = [];
  const secrets: GameState["hidden"]["firmStrategySecrets"] = {};
  const ships: GameState["company"]["ships"] = [...state.company.ships];
  for (const spec of specs) {
    for (const [playerId, count] of Object.entries(spec.shares)) {
      const player = state.players[playerId];
      state = {
        ...state,
        players: { ...state.players, [playerId]: { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count } } },
      };
    }
    firms.push({
      id: spec.id,
      manager: spec.manager,
      londonTreasury: spec.london ?? 0,
      indiaTreasury: spec.india ?? 0,
      value: spec.value ?? 1,
      shares: spec.shares,
      formedTurn: 1,
      ...(spec.dividendCube === undefined ? {} : { dividendCube: spec.dividendCube }),
      ...(spec.initiative === undefined
        ? {}
        : { trade: { strategy: "west-indian" as const, dice: 1, successes: 1, initiative: spec.initiative, income: 0 } }),
    });
    if (spec.strategy) secrets[spec.id] = { firmId: spec.id, committedBy: spec.manager, strategy: spec.strategy, bid: 0, revealed: true };
    for (let index = 0; index < (spec.ships ?? 0); index += 1) {
      ships.push({ id: `ship-${spec.id}-${index}`, kind: "player", shipyardCardId: `yard-${spec.id}-${index}`, location: `firm:${spec.id}`, fatigued: false });
    }
  }
  return {
    ...state,
    phase: "revenue",
    firms,
    hidden: { ...state.hidden, firmStrategySecrets: secrets },
    company: { ...state.company, ships },
    pendingDecision: createSystemDecision({
      id: "decision-revenue-confirm-test",
      phase: "revenue",
      step: "revenue.confirm",
      prompt: "Revenue",
      commandType: "revenue.confirm",
      label: "Start Revenue",
      description: "",
    }),
  };
}

let counter = 0;

/** Applies the first legal command of this type (and, if given, matching this payload subset). */
export function play(state: GameState, type: string, match: Record<string, unknown> = {}): GameState {
  const legal = state.pendingDecision.legalCommands.find(
    (command) =>
      command.type === type &&
      Object.entries(match).every(([key, value]) => JSON.stringify((command.payload as Record<string, unknown>)?.[key]) === JSON.stringify(value)),
  );
  if (!legal) {
    throw new Error(
      `No legal ${type} ${JSON.stringify(match)} in ${state.pendingDecision.step}: ${state.pendingDecision.legalCommands.map((c) => `${c.type} ${JSON.stringify(c.payload)}`).join(" | ")}`,
    );
  }
  counter += 1;
  return applyCommandOrThrow(state, { id: `command-vr-${counter}`, type, payload: legal.payload ?? {} });
}

/** Save and load the game, as passing a save file would. */
export function reload(state: GameState): GameState {
  return deserializeGameState(serializeSave(state, { saveId: `save-${state.log.length}`, now: "2026-06-13T12:30:00.000Z" }));
}
