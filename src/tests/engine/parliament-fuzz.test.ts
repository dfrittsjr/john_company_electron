import { describe, expect, it } from "vitest";
import { lawDeckForScenario } from "../../data";
import { applyCommand, createRngState, familyPieceTotal, rollDie, shuffle, type GameState, type RngState } from "../../engine";
import { withCourtShares, withOffice, withOfficers, withRegiments } from "../fixtures/builders";
import { parliamentState, withBlackmail, withEnterprises, withPrestigeCards, withPrize } from "../fixtures/parliament";

// Random legal play through Parliament Meets from varied starting positions: every listed command
// must be accepted, pieces must be conserved, and the session must end in Upkeep or Final Scoring.

function pick(rng: RngState, count: number): { rng: RngState; index: number } {
  if (count <= 1) return { rng, index: 0 };
  const roll = rollDie(rng, count, "fuzz");
  return { rng: roll.rng, index: roll.value - 1 };
}

function randomSetup(seed: number): { state: GameState; rng: RngState } {
  let rng = createRngState(`parliament-fuzz-${seed}`);
  const roll = (sides: number) => {
    const result = pick(rng, sides);
    rng = result.rng;
    return result.index;
  };
  const deck = shuffle(rng, lawDeckForScenario("1710"));
  rng = deck.rng;
  const players = ["player-red", "player-blue", "player-yellow"];

  let state = parliamentState({
    drawPile: deck.items.slice(0, 1 + roll(8)),
    discardPile: deck.items.slice(10, 10 + roll(4)),
    dial: roll(14),
    primeMinister: players[roll(3)],
    passedLaws: ["royal-protection", ...(roll(3) === 0 ? ["masses-demand-franchise"] : []), ...(roll(4) === 0 ? ["window-tax-repeal"] : [])],
    cash: Object.fromEntries(players.map((playerId) => [playerId, roll(9)])),
  });
  state = { ...state, parliament: { ...state.parliament, oppositionLeader: roll(2) === 0 ? players[roll(3)] : undefined } };

  const workshops = ["workshop-01", "workshop-02", "workshop-03"];
  const shipyards = ["shipyard-01", "shipyard-02"];
  for (const playerId of players) {
    if (roll(2) === 0) state = withEnterprises(state, playerId, [{ type: "workshop", cardId: workshops.shift()! }]);
    if (roll(2) === 0) state = withEnterprises(state, playerId, [{ type: "luxury", cardId: `luxury-0${players.indexOf(playerId) + 1}` }]);
    if (roll(3) === 0 && shipyards.length > 0) state = withEnterprises(state, playerId, [{ type: "shipyard", cardId: shipyards.shift()! }]);
    if (roll(3) === 0) state = withPrize(state, playerId, ["prize-4", "prize-8", "prize-14"][roll(3)], 1, 4);
  }
  const prestige = ["tax-collectors", "labour-newspaper", "social-magazine", "rotten-borough-1", "foundry", "lady-newcome", "scottish-castle"];
  for (const cardId of prestige) {
    if (roll(3) === 0) state = withPrestigeCards(state, players[roll(3)], [cardId]);
  }
  if (roll(2) === 0) state = withBlackmail(state, players[roll(3)], "scandal-in-india");
  for (const officeId of ["chairman", "director-of-trade", "manager-of-shipping", "president-madras"]) {
    if (roll(2) === 0) state = withOffice(state, officeId, players[roll(3)]);
  }
  if (roll(2) === 0) state = withCourtShares(state, [{ id: "fuzz-share-1", owner: players[roll(3)] }]);
  state = withRegiments(state, {
    Bombay: { ready: roll(3), exhausted: 0 },
    Madras: { ready: roll(3), exhausted: 0 },
    Bengal: { ready: roll(2), exhausted: 0 },
  });
  if (roll(2) === 0) state = withOfficers(state, players[roll(3)], "Bengal", { ready: 1, exhausted: 0 });
  state = {
    ...state,
    company: {
      ...state.company,
      ships: [
        { id: "fuzz-company-ship", kind: "company", location: "west-indian", fatigued: false },
        { id: "fuzz-extra-ship", kind: "extra", location: "south-indian", fatigued: false },
      ],
    },
  };
  return { state, rng };
}

describe("Parliament under random legal play", () => {
  it("always accepts listed commands, conserves pieces, and ends in Upkeep or Final Scoring", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      let { state, rng } = randomSetup(seed);
      for (let step = 0; state.phase === "parliament"; step += 1) {
        expect(step, `seed ${seed} did not finish`).toBeLessThan(400);
        const legal = state.pendingDecision.legalCommands;
        expect(legal.length, `seed ${seed} stuck at ${state.pendingDecision.step}`).toBeGreaterThan(0);
        const choice = pick(rng, legal.length);
        rng = choice.rng;
        const command = legal[choice.index];
        const actor = state.pendingDecision.actor;
        const result = applyCommand(state, {
          id: `fuzz-${seed}-${step}`,
          gameId: state.gameId,
          actorId: actor === "simultaneous" ? state.seatingOrder[0] : actor,
          decisionId: state.pendingDecision.id,
          type: command.type,
          payload: command.payload ?? {},
          clientTimestamp: "2026-10-24T00:00:00.000Z",
        });
        if (!result.ok) throw new Error(`seed ${seed}: ${command.type} rejected: ${JSON.stringify(result.errors)}`);
        state = result.state;

        for (const playerId of state.seatingOrder) {
          expect(familyPieceTotal(state, playerId), `seed ${seed} pieces`).toBe(18);
          expect(state.players[playerId].cash, `seed ${seed} cash`).toBeGreaterThanOrEqual(0);
        }
        expect(state.company.balance).toBeGreaterThanOrEqual(0);
      }

      expect(["upkeep", "finalScoring"]).toContain(state.phase);
      expect(state.parliament.session).toBeUndefined();
    }
  });
});
