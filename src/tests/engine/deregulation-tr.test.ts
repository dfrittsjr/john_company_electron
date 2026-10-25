import { describe, expect, it } from "vitest";
import { createRngState, rollDie, type GameState } from "../../engine";
import { createNextCompanyOperationDecision } from "../../engine/phases/company-operation";
import { choose, act, payloads, withBlackmail, withDice, withOrder } from "../fixtures/company-operation";
import { eventsInIndiaState, TWO_EVENTS_WEST_STORM } from "../fixtures/events-in-india";
import { withOffice } from "../fixtures/builders";
import { BLUE, RED, YELLOW, firmTradeGame, withFirms, type FirmSetup } from "../fixtures/deregulation-tr";
import { applyCommandOrThrow, expectGameInvariants, expectSaveRoundTripPreservesPendingDecision } from "../fixtures/game";

const GREEN_FIRM: FirmSetup = { id: "firm-1", manager: BLUE, strategy: "south-indian", bid: 4, ships: 2 };

function firmOf(state: GameState, id = "firm-1") {
  return state.firms!.find((firm) => firm.id === id)!;
}
function orderOf(state: GameState, orderId: string) {
  return Object.values(state.india.regions).flatMap((region) => region.orders).find((order) => order.id === orderId)!;
}
const step = (state: GameState) => state.pendingDecision.step;

describe("Reveal and roll (p.40)", () => {
  it("reveals each firm of the Presidency before the President acts and records the roll", () => {
    const start = firmTradeGame("tr-reveal", "Madras", [GREEN_FIRM, { id: "firm-2", manager: YELLOW, strategy: "west-indian", bid: 2, ships: 1 }], { ships: 4 });
    expect(step(start)).toBe("companyOperation.firmReveal");
    expect(start.pendingDecision.legalCommands).toHaveLength(1);
    expectSaveRoundTripPreservesPendingDecision(start);

    const rolled = choose(start, { action: "reveal" });
    expect(rolled.hidden.firmStrategySecrets["firm-1"].revealed).toBe(true);
    // The West Indian firm waits for Bombay's operations.
    expect(rolled.hidden.firmStrategySecrets["firm-2"].revealed).toBe(false);
    expect(firmOf(rolled).trade).toEqual(expect.objectContaining({ strategy: "south-indian", dice: 4 }));
    const trade = firmOf(rolled).trade!;
    expect(trade.successes).toBe(rolled.log.at(-1)!.rngRolls![0].values.filter((value: number) => value <= 2).length);
    if (trade.successes > 0) expect(trade.initiative).toBe(2 - trade.successes);
    else expect(trade.initiative).toBeUndefined();
    expect(rolled.log.at(-1)!.rngRolls).toHaveLength(1);
    // Only then does the President choose.
    expect(rolled.pendingDecision.actor === RED || step(rolled).startsWith("companyOperation.firmFill")).toBe(true);
  });

  it("a failed roll means the firm does not trade, and the President trades as usual", () => {
    const start = firmTradeGame("tr-fail", "Madras", [GREEN_FIRM], { ships: 4 });
    const failed = withDice(start, (s) => choose(s, { action: "reveal" }), (s) => firmOf(s).trade!.successes === 0);
    expect(firmOf(failed).trade!.initiative).toBeUndefined();
    expect(step(failed)).toBe("companyOperation.presidency");
    expect(failed.pendingDecision.actor).toBe(RED);
    expect(firmOf(failed).trade!.income).toBe(0);
  });
});

/** Green's firm (2 ships, 4 dice, 3 successes) then the President (4 ships, 5 dice, 2 successes). */
function pageExample(firm: Partial<FirmSetup> = {}): { start: GameState; afterRolls: GameState } {
  const start = firmTradeGame("tr-example", "Madras", [{ ...GREEN_FIRM, ...firm }], { ships: 4, treasury: 12 });
  const afterRolls = withDice(
    start,
    (seeded) => {
      let state = choose(seeded, { action: "reveal" });
      if (firmOf(state).trade!.successes !== 3) return state;
      state = choose(state, { action: "trade" });
      state = choose(state, { action: "declare", regionId: "hyderabad" });
      state = choose(state, { action: "declare", regionId: "maratha" });
      // £7: 5 dice after the two regions' penalty.
      return choose(state, { action: "roll", spend: 7 });
    },
    (state) => firmOf(state).trade?.successes === 3 && state.log.at(-1)!.rngRolls?.[0]?.values.filter((v: number) => v <= 2).length === 2 && step(state) === "companyOperation.firmFill",
  );
  return { start, afterRolls };
}

describe("Trading with Firms (pp.40-41)", () => {
  it("reproduces the example: the firm fills £16 and advances Value 2; the President refills at half value and adds Maratha", () => {
    const { afterRolls } = pageExample();
    expect(firmOf(afterRolls).trade).toEqual(expect.objectContaining({ successes: 3, initiative: -1 }));
    // Initiative -1 goes before the President's 2: the manager chooses first, starting at the home port.
    expect(afterRolls.pendingDecision.actor).toBe(BLUE);
    expect(payloads(afterRolls).filter((p) => p.action === "fill")).toEqual([{ action: "fill", orderId: "madras-home-5" }]);
    expectSaveRoundTripPreservesPendingDecision(afterRolls);

    let state = choose(afterRolls, { action: "fill", orderId: "madras-home-5" });
    expect(payloads(state)).toContainEqual({ action: "stop" });
    // Path rule: only orders connected to a filled order.
    expect(payloads(state).filter((p) => p.action === "fill").map((p) => p.orderId).sort()).toEqual(["hyderabad-7", "madras-south-4"]);
    expectSaveRoundTripPreservesPendingDecision(state);
    state = choose(state, { action: "fill", orderId: "madras-south-4" });
    state = choose(state, { action: "fill", orderId: "hyderabad-7" });

    // Two ships plus one: three orders, then the firm is done.
    expect(firmOf(state).trade!.income).toBe(16);
    expect(firmOf(state).indiaTreasury).toBe(16);
    expect(firmOf(state).value).toBe(3);
    expect(orderOf(state, "hyderabad-7").filledThisTurnBy).toEqual(["firm-1"]);

    // Now the President places writers: initiative 2 (4 ships - 2 successes).
    expect(step(state)).toBe("companyOperation.trade.place");
    const balance = state.company.balance;
    const cash = state.players[RED].cash;
    state = choose(state, { action: "place", orderId: "madras-home-5", writer: RED });
    state = choose(state, { action: "place", orderId: "madras-south-4", writer: YELLOW });
    state = choose(state, { action: "place", orderId: "hyderabad-7", writer: YELLOW });
    state = choose(state, { action: "place", orderId: "maratha-east-2", writer: YELLOW });
    // Half of 5, 4 and 7 (2 + 2 + 3) plus the full £2 of the order nobody had filled: £9.
    expect(state.company.balance - balance).toBe(9);
    // The President takes £1 per order (4) and £1 for his own writer.
    expect(state.players[RED].cash - cash).toBe(4 + 1);
    expect(orderOf(state, "madras-home-5").filledThisTurnBy).toEqual(["firm-1", "company"]);
    expect(state.companyOperation.firmFill).toBeUndefined();
    expectGameInvariants(state);
  });

  it("lets a firm stop early, and income below £6 does not move the Value", () => {
    const { afterRolls } = pageExample();
    let state = choose(afterRolls, { action: "fill", orderId: "madras-home-5" });
    state = choose(state, { action: "stop" });
    expect(firmOf(state).trade!.income).toBe(5);
    expect(firmOf(state).value).toBe(1);
    expect(step(state)).toBe("companyOperation.trade.place");
  });
});

const successes = (state: GameState, rollIndex = 0) =>
  state.log.at(-1)!.rngRolls?.[rollIndex]?.values.filter((value: number) => value <= 2).length;

describe("Initiative order and ties (p.40)", () => {
  function tiedState(): GameState {
    const start = firmTradeGame("tr-tie", "Madras", [{ ...GREEN_FIRM, bid: 3 }], { ships: 2, treasury: 8 });
    return withDice(
      start,
      (seeded) => {
        const state = choose(seeded, { action: "reveal" });
        if (firmOf(state).trade!.successes !== 2) return state;
        return choose(choose(state, { action: "trade" }), { action: "roll", spend: 3 });
      },
      (state) => firmOf(state).trade?.successes === 2 && successes(state) === 2 && step(state) === "companyOperation.firmFillOrder",
    );
  }

  it("lets the operating President decide a tie between a firm and the Company", () => {
    const tied = tiedState();
    expect(tied.pendingDecision.actor).toBe(RED);
    expect(payloads(tied).map((payload) => payload.who).sort()).toEqual(["company", "firm-1"]);
    expectSaveRoundTripPreservesPendingDecision(tied);

    // The Company first: it fills the home port at full value, then the firm refills it at half.
    const company = choose(tied, { action: "next", who: "company" });
    expect(step(company)).toBe("companyOperation.trade.place");
    const placed = choose(company, { action: "place", orderId: "madras-home-5", writer: RED });
    const afterCompany = choose(placed, { action: "place", orderId: "madras-south-4", writer: YELLOW });
    expect(step(afterCompany)).toBe("companyOperation.firmFill");
    const refilled = choose(afterCompany, { action: "fill", orderId: "madras-home-5" });
    expect(firmOf(refilled).trade!.income).toBe(2);
    expect(orderOf(refilled, "madras-home-5").filledThisTurnBy).toEqual(["company", "firm-1"]);
  });

  it("lets the firm go first when the President chooses it", () => {
    const firmFirst = choose(tiedState(), { action: "next", who: "firm-1" });
    expect(firmFirst.pendingDecision.actor).toBe(BLUE);
    expect(step(firmFirst)).toBe("companyOperation.firmFill");
  });

  it("President acts first when his initiative is lower: full value, then the firm refills at half", () => {
    const start = firmTradeGame("tr-company-first", "Madras", [{ ...GREEN_FIRM, ships: 4, bid: 1 }], { ships: 2, treasury: 8 });
    const afterRolls = withDice(
      start,
      (seeded) => {
        const state = choose(seeded, { action: "reveal" });
        if (firmOf(state).trade!.successes !== 1) return state;
        return choose(choose(state, { action: "trade" }), { action: "roll", spend: 2 });
      },
      (state) => firmOf(state).trade?.successes === 1 && step(state) === "companyOperation.trade.place",
    );
    // Firm: 4 ships - 1 = 3. President: 2 ships minus at least one success.
    const balance = afterRolls.company.balance;
    let state = choose(afterRolls, { action: "place", orderId: "madras-home-5", writer: RED });
    state = choose(state, { action: "place", orderId: "madras-south-4", writer: YELLOW });
    expect(state.company.balance - balance).toBe(9);
    expect(step(state)).toBe("companyOperation.firmFill");
    state = choose(state, { action: "fill", orderId: "madras-home-5" });
    state = choose(state, { action: "fill", orderId: "madras-south-4" });
    expect(firmOf(state).trade!.income).toBe(4);
    state = choose(state, { action: "fill", orderId: "hyderabad-7" });
    // The Hyderabad order nobody had filled pays its full £7.
    expect(firmOf(state).trade!.income).toBe(11);
    // Four ships allow five orders, so the firm may go on; stopping applies the Value advance.
    state = choose(state, { action: "stop" });
    expect(firmOf(state).value).toBe(2);
  });
});

describe("Vacant President or no Trade (p.40)", () => {
  it("fills after the Commander and Governors have had their chance, ties decided by the Chairman marker", () => {
    const start = firmTradeGame(
      "tr-vacant",
      "Bombay",
      [
        { id: "firm-1", manager: BLUE, strategy: "west-indian", bid: 2, ships: 2 },
        { id: "firm-2", manager: YELLOW, strategy: "west-indian", bid: 2, ships: 2 },
      ],
      { president: null },
    );
    // Both firms reveal even though the President is vacant.
    expect(step(start)).toBe("companyOperation.firmReveal");
    const revealed = withDice(
      withOffice(start, "chairman", RED),
      (seeded) => choose(choose(seeded, { action: "reveal" }), { action: "reveal" }),
      (state) => firmOf(state).trade?.successes === 1 && firmOf(state, "firm-2").trade?.successes === 1,
    );
    expect(firmOf(revealed).trade!.initiative).toBe(1);
    expect(step(revealed)).toBe("companyOperation.presidency");
    const chairman = RED;
    expect(revealed.pendingDecision.actor).toBe(chairman);
    expect(payloads(revealed)).toEqual([{ action: "end", presidency: "Bombay" }]);

    const filling = choose(revealed, { action: "end" });
    expect(step(filling)).toBe("companyOperation.firmFillOrder");
    expect(filling.pendingDecision.actor).toBe(chairman);
    expectSaveRoundTripPreservesPendingDecision(filling);
    let state = choose(filling, { action: "next", who: "firm-2" });
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = choose(state, { action: "fill", orderId: "bombay-home-4" });
    state = choose(state, { action: "stop" });
    // The remaining firm is no longer tied.
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, { action: "fill", orderId: "bombay-home-4" });
    expect(firmOf(state).trade!.income).toBe(orderOf(state, "bombay-home-4").deregulationValue);
    state = choose(state, { action: "stop" });
    expect(state.companyOperation.actedOffices).toContain("president-bombay");
  });

  it("a President who does not Trade ends, and then the firms fill", () => {
    const start = firmTradeGame("tr-no-trade", "Madras", [GREEN_FIRM], { ships: 4 });
    const revealed = withDice(start, (s) => choose(s, { action: "reveal" }), (s) => (firmOf(s).trade?.successes ?? 0) > 0);
    expect(step(revealed)).toBe("companyOperation.presidency");
    const filling = choose(revealed, { action: "end" });
    expect(step(filling)).toBe("companyOperation.firmFill");
    expect(filling.pendingDecision.actor).toBe(BLUE);
    const done = choose(filling, { action: "stop" });
    expect(done.companyOperation.actedOffices).toContain("president-madras");
  });
});

describe("Closed home port (p.40 assumption)", () => {
  it("a firm may choose its zone anyway but fills nothing when the port is closed", () => {
    const start = withOrder(firmTradeGame("tr-closed", "Madras", [GREEN_FIRM], { ships: 4 }), "madras-home-5", { closed: true });
    const revealed = withDice(start, (s) => choose(s, { action: "reveal" }), (s) => (firmOf(s).trade?.successes ?? 0) > 0);
    // The President can't Trade either; ending lets the firm "fill", which finds no orders.
    expect(payloads(revealed).some((payload) => payload.action === "trade")).toBe(false);
    const done = choose(revealed, { action: "end" });
    expect(firmOf(done).trade!.income).toBe(0);
    expect(firmOf(done).value).toBe(1);
    expect(done.companyOperation.actedOffices).toContain("president-madras");
  });
});

describe("Value (p.41)", () => {
  it("stops at 10", () => {
    const { afterRolls } = pageExample({ value: 9 });
    let state = choose(afterRolls, { action: "fill", orderId: "madras-home-5" });
    state = choose(state, { action: "fill", orderId: "madras-south-4" });
    state = choose(state, { action: "fill", orderId: "hyderabad-7" });
    expect(firmOf(state).trade!.income).toBe(16);
    expect(firmOf(state).value).toBe(10);
  });
});

describe("Mercantile Connection against a firm roll (p.40, card #8)", () => {
  it("offers the card after a firm's roll and rerolls with half the dice", () => {
    let start = firmTradeGame("tr-connection", "Madras", [GREEN_FIRM], { ships: 4 });
    start = withBlackmail(start, YELLOW, "mercantile-connection");
    const asked = choose(start, { action: "reveal" });
    expect(step(asked)).toBe("companyOperation.connection");
    expect(asked.pendingDecision.actor).toBe(YELLOW);
    expect(asked.pendingDecision.prompt).toContain("firm Trade");
    expect(firmOf(asked).trade).toBeUndefined();
    expectSaveRoundTripPreservesPendingDecision(asked);

    const played = choose(asked, { action: "playConnection" });
    expect(played.players[YELLOW].blackmailCards[0].facedown).toBe(false);
    expect(firmOf(played).trade!.dice).toBe(2);
    expect(played.log.some((entry) => entry.summary.includes("Reroll with 2 dice"))).toBe(true);

    const declined = choose(asked, { action: "declineConnection" });
    expect(firmOf(declined).trade!.dice).toBe(4);
  });
});

describe("Invested workshops (p.38)", () => {
  it("give no Bonuses income", () => {
    let state = firmTradeGame("tr-bonus", "Madras", []);
    state = {
      ...state,
      players: {
        ...state.players,
        [RED]: {
          ...state.players[RED],
          enterprises: [
            { id: "w1", type: "workshop" },
            { id: "w2", type: "workshop", invested: true },
          ],
        },
      },
    };
    state = { ...state, phase: "companyOperation", companyOperation: { turn: state.turn, actedOffices: Object.keys(state.company.offices) } };
    const decision = createNextCompanyOperationDecision(state);
    state = { ...state, phase: decision.phase, pendingDecision: decision };
    expect(step(state)).toBe("bonuses.confirm");
    const cash = state.players[RED].cash;
    const paid = act(state, "bonuses.confirm", {});
    expect(paid.players[RED].cash - cash).toBe(1);
  });
});

describe("Firms and storms (p.42)", () => {
  it("firm ships count in their strategy's zone; Hobnob ships and other zones are safe", () => {
    let state = eventsInIndiaState({
      drawPile: ["turmoil-bombay", "turmoil-delhi", "windfall-madras"],
      // West storm; the fresh West firm ship rolls 3 (fatigued), the fatigued one rolls 4 (sinks).
      rolls: [TWO_EVENTS_WEST_STORM, 3, 4],
    });
    state = withFirms(state, [
      { id: "firm-1", manager: BLUE, strategy: "west-indian", bid: 1, ships: 2 },
      { id: "firm-2", manager: YELLOW, strategy: "south-indian", bid: 1, ships: 1 },
      { id: "firm-3", manager: RED, strategy: "hobnob", bid: 0, ships: 1 },
    ]);
    state = {
      ...state,
      company: {
        ...state.company,
        ships: state.company.ships.map((ship) => (ship.id === "firm-ship-firm-1-2" ? { ...ship, fatigued: true } : ship)),
      },
    };
    const legal = state.pendingDecision.legalCommands[0];
    const after = applyCommandOrThrow(state, { id: "command-storm", type: legal.type, payload: legal.payload });
    const ships = Object.fromEntries(after.company.ships.map((ship) => [ship.id, ship]));
    expect(ships["firm-ship-firm-1-1"]).toEqual(expect.objectContaining({ location: "firm:firm-1", fatigued: true }));
    expect(ships["firm-ship-firm-1-2"]).toEqual(expect.objectContaining({ location: "shipyard", fatigued: false }));
    expect(ships["firm-ship-firm-2-1"]).toEqual(expect.objectContaining({ location: "firm:firm-2", fatigued: false }));
    expect(ships["firm-ship-firm-3-1"]).toEqual(expect.objectContaining({ location: "firm:firm-3", fatigued: false }));
    expect(after.log.filter((entry) => entry.type === "eventsInIndia.storm")).toHaveLength(2);
  });
});

describe("Random legal play through firm trading", () => {
  function busyFirms(seed: number): GameState {
    const pick = (index: number) => [RED, YELLOW, BLUE][(seed + index) % 3];
    let state = firmTradeGame(
      `tr-fuzz-${seed}`,
      "Bombay",
      [
        { id: "firm-1", manager: pick(0), strategy: "west-indian", bid: 1 + (seed % 3), ships: 1 + (seed % 3) },
        { id: "firm-2", manager: pick(1), strategy: "south-indian", bid: 2 + (seed % 2), ships: 2 },
        { id: "firm-3", manager: pick(2), strategy: seed % 2 ? "east-indian" : "west-indian", bid: 3, ships: 1 + (seed % 2), value: 1 + (seed % 10) },
      ],
      { president: seed % 5 === 0 ? null : RED, ships: 2, fromStart: true },
    );
    state = withOffice(state, "chairman", BLUE);
    state = withOffice(state, "president-madras", seed % 4 === 0 ? undefined : YELLOW, { treasury: 6 });
    state = withOffice(state, "president-bengal", BLUE, { treasury: 6 });
    if (seed % 3 === 0) state = withBlackmail(state, YELLOW, "mercantile-connection");
    return { ...state, pendingDecision: createNextCompanyOperationDecision(state) };
  }

  it("always reaches Bonuses with accepted commands and sane firms", () => {
    let filledSomewhere = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      let state = busyFirms(seed);
      let rng = createRngState(`tr-fuzz-choices-${seed}`);
      let steps = 0;
      while (state.phase === "companyOperation") {
        steps += 1;
        expect(steps).toBeLessThan(1500);
        const legal = state.pendingDecision.legalCommands;
        expect(legal.length).toBeGreaterThan(0);
        let index = 0;
        if (legal.length > 1) {
          const roll = rollDie(rng, legal.length, "random");
          rng = roll.rng;
          index = roll.value - 1;
        }
        state = act(state, legal[index].type, legal[index].payload);
        expectGameInvariants(state);
        for (const firm of state.firms!) {
          expect(firm.value).toBeGreaterThanOrEqual(1);
          expect(firm.value).toBeLessThanOrEqual(10);
          expect(firm.indiaTreasury).toBeGreaterThanOrEqual(0);
        }
      }
      expect(state.phase).toBe("bonuses");
      // Every firm that revealed and succeeded has filled by now.
      for (const firm of state.firms!) {
        if (firm.trade?.initiative !== undefined) expect(state.companyOperation.firmsFilled).toContain(firm.id);
        if (firm.trade && firm.trade.income > 0) filledSomewhere += 1;
      }
    }
    // The random play really did trade through the firms.
    expect(filledSomewhere).toBeGreaterThan(10);
  });
});
