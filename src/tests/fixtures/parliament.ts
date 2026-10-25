import type { EnterpriseInstance, GameState, LegalCommand, PlayerId } from "../../engine";
import { withCash } from "./builders";
import { applyCommandOrThrow, createHotseatGame } from "./game";

/** A quick way through a vote: decline extras, stop voting, resolve; otherwise take the first option. */
function preferredCommand(legalCommands: LegalCommand[]): LegalCommand {
  const prefer = (predicate: (command: LegalCommand) => boolean) => legalCommands.find(predicate);
  return (
    prefer((command) => command.type === "parliament.passVote") ??
    prefer((command) => command.type === "parliament.continueVoting" && (command.payload as { another: boolean }).another === false) ??
    prefer((command) => command.type === "parliament.taxCollectors" && (command.payload as { propose: boolean }).propose === false) ??
    prefer((command) => command.type === "parliament.selectLaw") ??
    legalCommands[0]
  );
}

/** Plays Parliament Meets through to the next phase, checking invariants after every command. */
export function resolveParliament(state: GameState, commandPrefix = "command-parliament"): GameState {
  let current = state;
  for (let index = 0; current.phase === "parliament"; index += 1) {
    if (index > 500) throw new Error("Parliament did not finish.");
    const legal = preferredCommand(current.pendingDecision.legalCommands);
    const actor = current.pendingDecision.actor;
    current = applyCommandOrThrow(current, {
      id: `${commandPrefix}-${index}`,
      actorId: actor === "simultaneous" ? current.seatingOrder[0] : actor,
      type: legal.type,
      payload: legal.payload ?? {},
    });
  }
  return current;
}

/** A game at the start of Parliament Meets with a stacked law deck (top card first). */
export function parliamentState(options: {
  drawPile: string[];
  discardPile?: string[];
  dial?: number;
  primeMinister?: PlayerId;
  passedLaws?: string[];
  cash?: Record<PlayerId, number>;
}): GameState {
  const base = createHotseatGame({ seed: "parliament-test", gameId: "game-parliament-test" });
  const state = withCash(base, {
    "player-red": 0,
    "player-blue": 0,
    "player-yellow": 0,
    ...options.cash,
  });

  return {
    ...state,
    phase: "parliament",
    parliament: {
      ...state.parliament,
      primeMinister: options.primeMinister ?? "player-red",
      policyDialPosition: options.dial ?? 0,
      lawDeck: { drawPile: options.drawPile, discardPile: options.discardPile ?? [] },
      passedLaws: (options.passedLaws ?? []).map((lawId) => ({ id: `law-${lawId}`, lawId })),
    },
    pendingDecision: {
      id: "decision-parliament-test",
      phase: "parliament",
      step: "parliament.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Parliament meets.",
      legalCommands: [{ type: "parliament.confirm", label: "Parliament meets", payload: {} }],
      canSave: true,
    },
  };
}

export function withEnterprises(
  state: GameState,
  playerId: PlayerId,
  enterprises: Array<{ type: EnterpriseInstance["type"]; cardId: string }>,
): GameState {
  const player = state.players[playerId];
  const added = enterprises.map((enterprise, index) => ({
    id: `test-${enterprise.type}-${playerId}-${player.enterprises.length + index + 1}`,
    ...enterprise,
  }));
  const luxuries = enterprises.filter((enterprise) => enterprise.type === "luxury").length;
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        victoryPoints: player.victoryPoints + 2 * luxuries,
        enterprises: [...player.enterprises, ...added],
      },
    },
  };
}

export function withPrestigeCards(state: GameState, playerId: PlayerId, cardIds: string[]): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        prestigeCards: [
          ...player.prestigeCards,
          ...cardIds.map((cardId, index) => ({ id: `test-prestige-${playerId}-${index + 1}`, cardId })),
        ],
      },
    },
  };
}

export function withBlackmail(state: GameState, playerId: PlayerId, cardId: string): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        blackmailCards: [
          ...player.blackmailCards,
          { id: `test-blackmail-${cardId}-${playerId}`, cardId, facedown: true },
        ],
      },
    },
  };
}

/** Moves family pieces from supply onto a prize (and adds that prize's victory points). */
export function withPrize(state: GameState, playerId: PlayerId, prizeId: string, count: number, victoryPoints: number): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        victoryPoints: player.victoryPoints + victoryPoints * count,
        familyMembers: {
          ...player.familyMembers,
          supply: player.familyMembers.supply - count,
          prizes: { ...player.familyMembers.prizes, [prizeId]: (player.familyMembers.prizes[prizeId] ?? 0) + count },
        },
      },
    },
  };
}

let commandCounter = 0;

/** Applies the legal command of this type whose payload matches (or the first of the type). */
export function choose(
  state: GameState,
  type: string,
  matches: (payload: Record<string, unknown>) => boolean = () => true,
): GameState {
  const legal = state.pendingDecision.legalCommands.find(
    (command) => command.type === type && matches((command.payload ?? {}) as Record<string, unknown>),
  );
  if (!legal) {
    throw new Error(
      `No legal ${type} matched at ${state.pendingDecision.step}: ${JSON.stringify(state.pendingDecision.legalCommands.map((command) => [command.type, command.payload]))}`,
    );
  }
  const actor = state.pendingDecision.actor;
  commandCounter += 1;
  return applyCommandOrThrow(state, {
    id: `command-test-${commandCounter}`,
    actorId: actor === "simultaneous" ? state.seatingOrder[0] : actor,
    type: legal.type,
    payload: legal.payload ?? {},
  });
}

export function hasCommand(state: GameState, type: string, matches: (payload: Record<string, unknown>) => boolean = () => true): boolean {
  return state.pendingDecision.legalCommands.some(
    (command) => command.type === type && matches((command.payload ?? {}) as Record<string, unknown>),
  );
}
