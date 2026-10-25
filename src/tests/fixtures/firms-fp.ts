import { expect } from "vitest";
import type { FirmState, GameState, LegalCommand, PlayerId, ShipState } from "../../engine";
import { startFirmsPhase } from "../../engine/phases/firms";
import { applyCommand } from "../../engine";
import { deserializeGameState, serializeSave } from "../../save";
import { RED, deregulatedGame } from "./firms";
import { applyCommandOrThrow, expectGameInvariants } from "./game";

// Builders for the Firms phase tests (rulebook pp.37-40).

export { BLUE, RED, YELLOW, deregulatedGame, withCompanyShares, withWorkshop } from "./firms";

/** A deregulated game on turn 2 (so turn-1 setup shares are mature), Red the Prime Minister. */
export function firmsGame(seed = "firms-fp"): GameState {
  const base = deregulatedGame(seed);
  return { ...base, turn: 2, parliament: { ...base.parliament, primeMinister: RED } };
}

/** Starts the Firms phase from the Family phase's end. */
export function inFirmsPhase(state: GameState): GameState {
  return startFirmsPhase({ ...state, phase: "family" });
}

/** Adds a firm directly: its shares come out of each holder's supply so the 18 pieces still add up. */
export function withFirmState(
  state: GameState,
  manager: PlayerId,
  shares: Record<PlayerId, number>,
  options: { id?: string; value?: number; london?: number; india?: number; dividendCube?: number } = {},
): GameState {
  const firm: FirmState = {
    id: options.id ?? `firm-${manager}`,
    manager,
    londonTreasury: options.london ?? 5,
    indiaTreasury: options.india ?? 0,
    value: options.value ?? 1,
    shares,
    formedTurn: 1,
    ...(options.dividendCube === undefined ? {} : { dividendCube: options.dividendCube }),
  };
  let players = state.players;
  for (const [playerId, count] of Object.entries(shares)) {
    const player = players[playerId];
    players = { ...players, [playerId]: { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count } } };
  }
  return { ...state, players, firms: [...(state.firms ?? []), firm] };
}

/** A player shipyard with its ship; `location` says where the ship is (default: on the shipyard). */
export function withShipyardShip(
  state: GameState,
  owner: PlayerId,
  number: number,
  location: ShipState["location"] = "shipyard",
  fatigued = false,
): GameState {
  const cardId = `shipyard-0${number}`;
  const player = state.players[owner];
  return {
    ...state,
    players: { ...state.players, [owner]: { ...player, enterprises: [...player.enterprises, { id: `yard-${number}`, type: "shipyard", cardId }] } },
    company: {
      ...state.company,
      ships: [...state.company.ships, { id: `ship-${cardId}`, kind: "player", shipyardCardId: cardId, location, fatigued }],
    },
  };
}

export function withLaw(state: GameState, lawId: string): GameState {
  return { ...state, parliament: { ...state.parliament, passedLaws: [...state.parliament.passedLaws, { id: `law-${lawId}`, lawId }] } };
}

export function firmOf(state: GameState, manager: PlayerId): FirmState {
  const firm = state.firms?.find((candidate) => candidate.manager === manager);
  if (!firm) throw new Error(`${manager} manages no firm.`);
  return firm;
}

let counter = 0;

export function act(state: GameState, actorId: PlayerId, type: string, payload: unknown = {}): GameState {
  counter += 1;
  return applyCommandOrThrow(state, { id: `fp-command-${counter}`, actorId, type, payload });
}

/** Applies the pending decision's first legal command of this type (matching `where`, if given). */
export function choose(
  state: GameState,
  type: string,
  where: (command: LegalCommand) => boolean = () => true,
  actorId?: PlayerId,
): GameState {
  const command = state.pendingDecision.legalCommands.find((candidate) => candidate.type === type && where(candidate));
  if (!command) {
    throw new Error(`No ${type} option in ${state.pendingDecision.step}: ${state.pendingDecision.legalCommands.map((c) => c.type).join(", ")}`);
  }
  return act(state, actorId ?? (state.pendingDecision.actor as PlayerId), type, command.payload ?? {});
}

export function types(state: GameState): string[] {
  return state.pendingDecision.legalCommands.map((command) => command.type);
}

export function rejection(state: GameState, actorId: PlayerId, type: string, payload: unknown): string[] {
  counter += 1;
  const result = applyCommand(state, {
    id: `fp-command-${counter}`,
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

/** Save and reload, checking the whole state survives; returns the reloaded state to keep playing. */
export function roundTrip(state: GameState): GameState {
  const loaded = deserializeGameState(serializeSave(state, { saveId: "fp-round-trip", now: "2026-06-13T12:30:00.000Z" }));
  expect(loaded.pendingDecision).toEqual(state.pendingDecision);
  expect(loaded.firmsPhase).toEqual(state.firmsPhase);
  expect(loaded.firms).toEqual(state.firms);
  expect(loaded.negotiation).toEqual(state.negotiation);
  expect(loaded.hidden.firmStrategySecrets).toEqual(state.hidden.firmStrategySecrets);
  expectGameInvariants(loaded);
  return loaded;
}

/** Starts the Firms phase and passes for earlier players until it is `actor`'s turn. */
export function startAt(actor: PlayerId, state: GameState): GameState {
  let current = inFirmsPhase(state);
  while (current.pendingDecision.step === "firms.investments" && current.pendingDecision.actor !== actor) {
    current = act(current, current.pendingDecision.actor as PlayerId, "firms.pass");
  }
  return current;
}
