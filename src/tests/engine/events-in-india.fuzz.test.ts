import { describe, expect, it } from "vitest";
import { createRngState, rollDie, type GameState, type RngState } from "../../engine";
import { serializeSave, deserializeGameState } from "../../save";
import {
  withAssociatedRegion,
  withCommander,
  withOffice,
  withOfficers,
  withRegiments,
  withWriterOnOrder,
} from "../fixtures/builders";
import { withRegion } from "../fixtures/events-in-india";
import { applyCommandOrThrow, createHotseatGame } from "../fixtures/game";

// Random legal play through many Events in India phases on busy boards: every offered command must
// be accepted, the 18-pieces invariant must hold after each command (checked by applyCommandOrThrow),
// saves must round-trip mid-phase, and every phase must end in Parliament or Final Scoring.

const PLAYERS = ["player-red", "player-blue", "player-yellow"];

function pick(rng: RngState, size: number): { rng: RngState; index: number } {
  if (size <= 1) return { rng, index: 0 };
  const roll = rollDie(rng, size, "fuzz");
  return { rng: roll.rng, index: roll.value - 1 };
}

function busyBoard(seed: string, variant: number): GameState {
  let state = createHotseatGame({ seed, gameId: `game-${seed}` });
  const company = [
    ["bombay", "Bombay"],
    ["punjab", "Bombay"],
    ["madras", "Madras"],
    ["mysore", "Madras"],
    ["bengal", "Bengal"],
  ] as const;
  for (const [index, [regionId, presidency]] of company.entries()) {
    if ((variant >> index) & 1) {
      state = withAssociatedRegion(state, regionId, presidency);
      state = withRegion(state, regionId, { unrest: (variant + index) % 3 });
    }
  }
  for (const [index, army] of (["Bombay", "Madras", "Bengal"] as const).entries()) {
    state = withRegiments(state, { [army]: { ready: (variant + index) % 3, exhausted: 0 } });
    state = withOfficers(state, PLAYERS[index], army, { ready: 1 + (variant % 2) });
    state = withOfficers(state, PLAYERS[(index + 1) % 3], army, { ready: variant % 3 });
    if ((variant + index) % 2 === 0) state = withCommander(state, army, PLAYERS[(index + 2) % 3]);
  }
  if (variant % 3 === 0) state = withOffice(state, "military-affairs", "player-blue", { inHiringQueue: false });
  if (variant % 4 === 1 && state.india.regions.bengal.companyControlled) {
    state = withOffice(state, "governor-bengal", "player-yellow", { inHiringQueue: false });
  }
  state = withWriterOnOrder(state, "delhi-north-5", "player-red", "Bengal");
  state = withWriterOnOrder(state, "maratha-north-4", "player-blue", "Bombay");
  state = {
    ...state,
    company: {
      ...state.company,
      ships: [
        { id: "ship-a", kind: "player", shipyardCardId: "shipyard-01", location: "west-indian", fatigued: false },
        { id: "ship-b", kind: "player", shipyardCardId: "shipyard-02", location: "china", fatigued: true },
        { id: "ship-c", kind: "player", shipyardCardId: "shipyard-03", location: "south-indian", fatigued: false },
      ],
    },
  };
  const envoy = { id: `envoy-${variant}`, cardId: "envoy-to-the-mughals", facedown: true };
  const holder = PLAYERS[variant % 3];
  state = {
    ...state,
    players: { ...state.players, [holder]: { ...state.players[holder], blackmailCards: [envoy] } },
    hidden: { ...state.hidden, privateCards: { ...state.hidden.privateCards, [holder]: [envoy] } },
  };
  // Keep the draw stack short so refills and Shuffle interplay are exercised.
  const pile = state.eventsInIndia.drawPile;
  return {
    ...state,
    eventsInIndia: { ...state.eventsInIndia, drawPile: pile.slice(0, 3 + (variant % 5)), discards: pile.slice(3 + (variant % 5)) },
  };
}

function enterPhase(state: GameState, turn: number): GameState {
  return {
    ...state,
    turn,
    phase: "eventsInIndia",
    pendingDecision: {
      id: `decision-fuzz-${turn}-${state.log.length}`,
      phase: "eventsInIndia",
      step: "eventsInIndia.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Events in India.",
      legalCommands: [{ type: "eventsInIndia.confirm", label: "Resolve", payload: {} }],
      canSave: true,
    },
  };
}

describe("Events in India random play", () => {
  it("never rejects an offered command, breaks an invariant, or gets stuck", () => {
    let phases = 0;
    let decisions = 0;
    for (let variant = 0; variant < 64; variant += 1) {
      let state = busyBoard(`fuzz-${variant}`, variant);
      let chooser = createRngState(`chooser-${variant}`);

      for (let turn = 1; turn <= 4 && !state.company.failed; turn += 1) {
        state = enterPhase(state, turn);
        let steps = 0;
        while (state.phase === "eventsInIndia") {
          steps += 1;
          expect(steps).toBeLessThan(200);
          const legal = state.pendingDecision.legalCommands;
          expect(legal.length).toBeGreaterThan(0);
          const choice = pick(chooser, legal.length);
          chooser = choice.rng;
          const command = legal[choice.index];
          if (state.pendingDecision.actor !== "system") decisions += 1;

          state = applyCommandOrThrow(state, {
            id: `fuzz-${variant}-${turn}-${steps}`,
            actorId: state.pendingDecision.actor === "simultaneous" ? "player-red" : state.pendingDecision.actor,
            type: command.type,
            payload: command.payload ?? {},
          });

          if (steps % 3 === 0) {
            const reloaded = deserializeGameState(serializeSave(state, { saveId: `fuzz-${steps}` }));
            expect(reloaded).toEqual(state);
          }
        }

        phases += 1;
        expect(["parliament", "finalScoring"]).toContain(state.phase);
        expect(state.eventsInIndia.progress).toBeUndefined();
        expect(state.eventsInIndia.drawPile.length + state.eventsInIndia.discards.length).toBe(20);
        const towers = Object.values(state.india.regions).reduce((total, region) => total + region.towerLevels, 0);
        expect(towers).toBeLessThanOrEqual(20);
        const capitals = Object.values(state.india.regions).filter((region) => region.isCapital);
        expect(capitals.length).toBeLessThanOrEqual(3);
        for (const capital of capitals) {
          // An empire has a capital and at least one dominated region (p.7).
          expect(Object.values(state.india.regions).filter((region) => region.empireFlag === capital.empireFlag).length)
            .toBeGreaterThan(1);
        }
        for (const region of Object.values(state.india.regions)) {
          expect(region.companyControlled ? !region.hasDome : region.hasDome).toBe(true);
          if (!region.companyControlled) expect(region.unrest).toBe(0);
        }
      }
    }

    expect(phases).toBeGreaterThan(100);
    expect(decisions).toBeGreaterThan(20);
  });
});
