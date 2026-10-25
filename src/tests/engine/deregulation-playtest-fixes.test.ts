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

describe("Connections are offered only when the reroll could matter (p.17, blackmail #8 and #9)", () => {
  test("not for a failed roll whose reroll would have no dice, nor for the roller's own success", async () => {
    const { connectionCouldMatter } = await import("../../engine/phases/company-operation/context");
    expect(connectionCouldMatter({ dice: 1, outcome: "failure" }, RED, BLUE)).toBe(false);
    expect(connectionCouldMatter({ dice: 1, outcome: "success" }, RED, BLUE)).toBe(true);
    expect(connectionCouldMatter({ dice: 1, outcome: "catastrophe" }, RED, BLUE)).toBe(true);
    expect(connectionCouldMatter({ dice: 4, outcome: "failure" }, RED, BLUE)).toBe(true);
    expect(connectionCouldMatter({ dice: 4, outcome: "success" }, RED, RED)).toBe(false);
    expect(connectionCouldMatter({ dice: 4, outcome: "failure" }, RED, RED)).toBe(true);
  });
});

describe("Company Operation warnings from the end-of-game playtest", () => {
  test("the Director of Trade sees closed home ports, home ports come first after a success, and stopping warns (p.18, p.20)", async () => {
    const { operationGame, enterOperation, choose: coChoose, withDice, RED: CO_RED, BLUE: CO_BLUE } = await import("../fixtures/company-operation");
    const { withOffice } = await import("../fixtures/builders");
    let state = operationGame("envoy-warnings");
    state = withOffice(state, "chairman", CO_RED);
    state = withOffice(state, "director-of-trade", CO_BLUE, { treasury: 4 });
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
    state = enterOperation(state, ["chairman"]);
    expect(state.pendingDecision.prompt).toMatch(/Closed home ports: Bombay\./);
    const stop = state.pendingDecision.legalCommands.find((command) => (command.payload as { action: string }).action === "stopEnvoys")!;
    expect(stop.description).toMatch(/^Warning: the home port of Bombay is still closed/);

    const succeeded = withDice(
      state,
      (seeded) => coChoose(seeded, { action: "envoy", spend: 4 }),
      (next) => next.pendingDecision.step === "companyOperation.directorOfTrade.envoyEffect",
    );
    const labels = succeeded.pendingDecision.legalCommands.map((command) => command.label);
    expect(labels[0]).toMatch(/^Reopen Bombay's home port \(the £\d+ order in Bombay\)/);
    expect(labels[labels.length - 1]).toBe("Open trade with China");
  });

  test("giving the whole Balance away warns when a seated President would be left with nothing", async () => {
    const { operationGame, enterOperation, RED: CO_RED, BLUE: CO_BLUE } = await import("../fixtures/company-operation");
    const { withOffice } = await import("../fixtures/builders");
    let state = operationGame("chairman-warning");
    state = withOffice(state, "chairman", CO_RED);
    state = withOffice(state, "president-madras", CO_BLUE, { treasury: 0 });
    state = withOffice(state, "manager-of-shipping", CO_BLUE, { treasury: 0 });
    state = { ...state, company: { ...state.company, balance: 6 } };
    state = enterOperation(state);
    const giveAll = state.pendingDecision.legalCommands.find((command) => command.label === "Give all £6 to Manager of Shipping")!;
    expect(giveAll.description).toMatch(/^Warning: this leaves Presidency of Madras with £0/);
    const toMadras = state.pendingDecision.legalCommands.find((command) => command.label === "Give all £6 to Presidency of Madras")!;
    expect(toMadras.description).toBeUndefined();
  });
});
