import { describe, expect, it } from "vitest";
import { applyCommand, createNewGame, type GameState } from "../../engine";
import { createRngState, rollDie, type RngState } from "../../engine";
import { withCompanyShares, withWorkshop } from "../fixtures/firms";
import { BLUE, RED, YELLOW, revenueGame, type FirmSpec } from "../fixtures/deregulation-vr";
import { applyCommandOrThrow, expectGameInvariants } from "../fixtures/game";

// Random legal play: every listed command must be accepted and pieces conserved.

function picker(seed: string) {
  let rng: RngState = createRngState(seed);
  return (count: number): number => {
    if (count <= 1) return 0;
    const roll = rollDie(rng, count, "fuzz");
    rng = roll.rng;
    return roll.value - 1;
  };
}

describe("firm Revenue under random legal play (pp.41-42)", () => {
  it("always accepts listed commands and settles every firm", () => {
    for (let seed = 0; seed < 150; seed += 1) {
      const pick = picker(`vr-firm-${seed}`);
      const managers = [RED, BLUE, YELLOW];
      const specs: FirmSpec[] = [];
      for (let index = 0; index < 1 + pick(3); index += 1) {
        const manager = managers[index];
        const others = managers.filter((player) => player !== manager);
        specs.push({
          id: `firm-${index}`,
          manager,
          shares: { [manager]: pick(3), [others[pick(2)]]: pick(3) },
          london: pick(8),
          india: pick(14),
          value: 1 + pick(6),
          ships: pick(3),
          strategy: pick(4) === 0 ? "hobnob" : undefined,
          initiative: pick(3) === 0 ? pick(5) - 2 : undefined,
          dividendCube: pick(2) === 0 ? pick(12) : undefined,
        });
      }
      for (const spec of specs) {
        if (Object.values(spec.shares).reduce((a, b) => a + b, 0) === 0) spec.shares = { [spec.manager]: 1 };
        // A merged-away "other" firm key collision is harmless; keep pieces valid.
        spec.shares = Object.fromEntries(Object.entries(spec.shares).filter(([, count]) => count > 0));
      }
      let state: GameState = revenueGame(specs);
      state = withCompanyShares(state, [RED, BLUE, YELLOW].filter(() => pick(2) === 0));
      for (const player of [RED, BLUE, YELLOW]) if (pick(3) === 0) state = withWorkshop(state, player);

      for (let step = 0; step < 300; step += 1) {
        const legal = state.pendingDecision.legalCommands;
        expect(legal.length, `seed ${seed} stuck at ${state.pendingDecision.step}`).toBeGreaterThan(0);
        if (state.phase !== "revenue" || (step > 0 && !state.pendingDecision.step.startsWith("revenue.firm"))) break;
        const choice = legal[pick(legal.length)];
        const actor = state.pendingDecision.actor;
        state = applyCommandOrThrow(state, {
          id: `fuzz-${seed}-${step}`,
          actorId: actor === "simultaneous" ? RED : actor,
          type: choice.type,
          payload: choice.payload ?? {},
        });
        expectGameInvariants(state);
        expect(step, `seed ${seed} did not finish`).toBeLessThan(299);
      }
      expect(state.pendingDecision.step.startsWith("revenue.firm"), `seed ${seed} left in ${state.pendingDecision.step}`).toBe(false);
      expect(state.parliament.revenue?.firmsSettled ?? true).toBe(true);
    }
  });
});

describe("Long 1710 under random legal play reaches and survives the Vote to Deregulate", () => {
  it("plays whole games without a rejected command or a stuck decision", () => {
    let votes = 0;
    let passes = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const pick = picker(`vr-long-${seed}`);
      let state = createNewGame({
        mode: "hotseat",
        scenario: "long-1710",
        seed: `vr-long-${seed}`,
        now: "2026-06-13T12:00:00.000Z",
        setupDistribution: "random",
        players: [
          { id: "player-1", name: "Red", color: "red" },
          { id: "player-2", name: "Blue", color: "blue" },
          { id: "player-3", name: "Yellow", color: "yellow" },
        ],
      });
      for (let step = 0; step < 6000; step += 1) {
        const legal = state.pendingDecision.legalCommands;
        if (legal.length === 0) break;
        if (state.pendingDecision.step === "parliament.deregulationCall") votes += 1;
        const choice = legal[pick(legal.length)];
        const actor = state.pendingDecision.actor;
        const result = applyCommand(state, {
          id: `long-${seed}-${step}`,
          gameId: state.gameId,
          actorId: actor === "simultaneous" ? state.seatingOrder[0] : actor,
          decisionId: state.pendingDecision.id,
          type: choice.type,
          payload: choice.payload ?? {},
          clientTimestamp: "2026-06-13T12:10:00.000Z",
        });
        if (!result.ok) throw new Error(`seed ${seed} step ${step} ${choice.type}: ${result.errors.map((e) => e.message).join(" ")}`);
        state = result.state;
      }
      if (state.parliament.deregulated) passes += 1;
    }
    expect(votes).toBeGreaterThan(0);
    void passes;
  });
});
