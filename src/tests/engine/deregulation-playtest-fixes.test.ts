import { describe, expect, test } from "vitest";
import type { GameState } from "../../engine";
import { BLUE, RED, YELLOW, choose, firmsGame, startAt, withFirmState, withShipyardShip } from "../fixtures/firms-fp";
import { play, revenueGame } from "../fixtures/deregulation-vr";

// Findings from the first Long 1710 playtest (2026-10-25): prompts that let players walk into a
// dead end without knowing it.

function strategyGame(): GameState {
  let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }, { london: 5 });
  state = withFirmState(state, YELLOW, { [YELLOW]: 1 }, { london: 4 });
  state = withShipyardShip(state, BLUE, 1, `firm:firm-${BLUE}`);
  return withShipyardShip(state, YELLOW, 2, `firm:firm-${YELLOW}`);
}

const toStrategy = (state: GameState) => choose(choose(startAt(BLUE, state), "firms.pass"), "firms.pass");

describe("Firm Strategy warnings", () => {
  test("a sea zone whose home port is closed says the firm could fill nothing", () => {
    let state = strategyGame();
    const bombay = Object.values(state.india.regions).find((region) => region.homePresidency === "Bombay")!;
    state = {
      ...state,
      india: {
        ...state.india,
        regions: {
          ...state.india.regions,
          [bombay.id]: { ...bombay, orders: bombay.orders.map((order) => (order.isHomePortFor === "Bombay" ? { ...order, closed: true } : order)) },
        },
      },
    };
    state = toStrategy(state);
    const west = state.pendingDecision.legalCommands.find((command) => (command.payload as { strategy: string }).strategy === "west-indian")!;
    expect(west.label).toBe("West Indian Ocean (home port closed)");
    expect(west.description).toMatch(/^Warning: the home port of Bombay is closed/);
    const south = state.pendingDecision.legalCommands.find((command) => (command.payload as { strategy: string }).strategy === "south-indian")!;
    expect(south.label).toBe("South Indian Ocean");
  });

  test("a bid that leaves less than the coming expenses is marked as a warning (p.41)", () => {
    let state = toStrategy(strategyGame());
    state = choose(state, "firms.chooseStrategy", (command) => (command.payload as { strategy: string }).strategy === "west-indian");
    // £5 in London; expenses are 1 ship + max(1 share, Value 1) = £2.
    const notes = Object.fromEntries(state.pendingDecision.legalCommands.map((command) => [(command.payload as { bid: number }).bid, command.description]));
    expect(notes[3]).toMatch(/Leaves £2\. At Revenue it owes £2/);
    expect(notes[4]).toMatch(/^Warning: leaves £1, less than the £2 it owes at Revenue/);
  });
});

describe("Firm rescue prompt (p.41)", () => {
  test("says why no emergency investment or merger is on offer", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1, [BLUE]: 1 }, india: 1, value: 3, ships: 1 }]);
    state = play(state, "revenue.confirm");
    expect(state.pendingDecision.prompt).toMatch(/Dissolve it \(p\.41\)\. No emergency investment is possible: .*No merger is possible/);
  });
});
