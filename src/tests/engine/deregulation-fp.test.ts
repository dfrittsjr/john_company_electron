import { describe, expect, test } from "vitest";
import { firmById, projectForViewer, type GameState } from "../../engine";
import { resolveNewCompanyShares } from "../../engine/phases/family";
import { expectFamilyPiecesConserved } from "../fixtures/game";
import {
  BLUE,
  RED,
  YELLOW,
  act,
  choose,
  firmOf,
  firmsGame,
  inFirmsPhase,
  startAt,
  rejection,
  roundTrip,
  types,
  withCompanyShares,
  withFirmState,
  withLaw,
  withShipyardShip,
  withWorkshop,
} from "../fixtures/firms-fp";

const consent = (state: GameState, accept: boolean) =>
  act(state, state.pendingDecision.actor as string, "negotiation.respondToConsent", {
    requestId: (state.pendingDecision.legalCommands[0].payload as { requestId: string }).requestId,
    accept,
  });

const asking = (state: GameState) => ({ step: state.pendingDecision.step, actor: state.pendingDecision.actor });

describe("starting the Firms phase (p.38)", () => {
  test("players with nothing to do are skipped: no dead actions (p.17)", () => {
    const state = inFirmsPhase(firmsGame());
    expect(state.phase).not.toBe("firms");
    expect(state.firmsPhase).toBeUndefined();
  });

  test("the first action in Prime Minister order is offered with a pass", () => {
    const state = inFirmsPhase(withWorkshop(withWorkshop(firmsGame(), BLUE), RED));
    expect(asking(state)).toEqual({ step: "firms.investments", actor: RED });
    expect(types(state)).toEqual(["firms.formFirm", "firms.pass"]);
  });

  test("rounds repeat until everyone has passed since the last action (ruling 2)", () => {
    let state = inFirmsPhase(withWorkshop(withWorkshop(firmsGame(), BLUE), RED));
    state = choose(state, "firms.formFirm");
    expect(asking(state)).toEqual({ step: "firms.investments", actor: BLUE });
    state = choose(state, "firms.pass");
    // Yellow could still take the firm over, so is asked too.
    expect(asking(state)).toEqual({ step: "firms.investments", actor: YELLOW });
    state = choose(state, "firms.pass");
    // Red manages a firm now, so can still dissolve it: Red is asked again.
    expect(asking(state)).toEqual({ step: "firms.investments", actor: RED });
    state = choose(state, "firms.pass");
    expect(state.phase).not.toBe("firms");
  });
});

describe("Forming a firm (p.38)", () => {
  test("a workshop is flipped, one piece becomes the first share, Value 1, £5 in London", () => {
    let state = inFirmsPhase(withWorkshop(firmsGame(), RED));
    const supply = state.players[RED].familyMembers.supply;
    state = choose(state, "firms.formFirm");
    expect(firmOf(state, RED)).toMatchObject({ value: 1, londonTreasury: 5, shares: { [RED]: 1 } });
    expect(state.players[RED].enterprises[0].invested).toBe(true);
    expect(state.players[RED].familyMembers.supply).toBe(supply - 1);
    expectFamilyPiecesConserved(state);
  });

  test("a Company share can be given up instead", () => {
    let state = inFirmsPhase(withCompanyShares(firmsGame(), [RED]));
    expect(state.pendingDecision.legalCommands[0].label).toMatch(/Company share/);
    state = choose(state, "firms.formFirm");
    expect(state.company.court.some((share) => share.owner === RED)).toBe(false);
    expect(firmOf(state, RED).shares).toEqual({ [RED]: 1 });
    expectFamilyPiecesConserved(state);
  });

  test("a manager cannot form a second firm", () => {
    const state = inFirmsPhase(withCompanyShares(withFirmState(firmsGame(), RED, { [RED]: 1 }), [RED]));
    expect(types(state)).not.toContain("firms.formFirm");
  });

  test("weak Company shares (Debt on a lined space) cannot form a firm (p.38)", () => {
    const base = firmsGame();
    const weak = inFirmsPhase(withCompanyShares({ ...base, company: { ...base.company, debt: 5 } }, [RED]));
    expect(weak.phase).not.toBe("firms");
  });

  test("immature Company shares, created this turn, cannot form or invest (p.38)", () => {
    const base = firmsGame();
    const immature = inFirmsPhase(withCompanyShares(base, [RED], base.turn));
    expect(immature.phase).not.toBe("firms");
    const mature = inFirmsPhase(withCompanyShares(base, [RED], base.turn - 1));
    expect(mature.phase).toBe("firms");
  });

  test("trading an immature share does not make it mature (p.38)", () => {
    const base = firmsGame();
    let state = withCompanyShares(base, [RED], base.turn);
    state = act(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "share", shareId: `court-${RED}-1` }] });
    expect(inFirmsPhase(state).phase).not.toBe("firms");
  });

  test("new Company shares record the turn they were created (p.38)", () => {
    const base = firmsGame();
    const pending = { id: "pending", owner: RED };
    const state = resolveNewCompanyShares({
      ...base,
      company: {
        ...base.company,
        debt: 1,
        stockExchange: base.company.stockExchange.map((slot, index) => (index === 0 ? { ...slot, share: pending } : slot)),
      },
    });
    expect(state.company.court).toEqual([expect.objectContaining({ owner: RED, createdTurn: base.turn })]);
  });
});

describe("Investing (p.38)", () => {
  const game = () => withCompanyShares(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), [RED]);

  test("the manager consents: +£5 in London and a new share for the investor", () => {
    let state = inFirmsPhase(game());
    state = choose(state, "firms.invest");
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: BLUE });
    state = consent(state, true);
    expect(firmOf(state, BLUE)).toMatchObject({ londonTreasury: 10, shares: { [BLUE]: 1, [RED]: 1 } });
    expect(state.company.court).toEqual([]);
    expectFamilyPiecesConserved(state);
    expect(asking(state)).toEqual({ step: "firms.investments", actor: BLUE });
  });

  test("the manager refuses: nothing changes and the turn is used", () => {
    let state = inFirmsPhase(game());
    state = choose(state, "firms.invest");
    state = consent(state, false);
    expect(firmOf(state, BLUE)).toMatchObject({ londonTreasury: 5, shares: { [BLUE]: 1 } });
    expect(state.company.court).toHaveLength(1);
    expect(state.firmsPhase?.passes).toBe(1);
  });

  test("investing in your own firm needs no consent", () => {
    let state = inFirmsPhase(withCompanyShares(withFirmState(firmsGame(), RED, { [RED]: 1 }), [RED]));
    state = choose(state, "firms.invest");
    expect(firmOf(state, RED)).toMatchObject({ londonTreasury: 10, shares: { [RED]: 2 } });
  });

  test("a firm with 10 shares can be invested in but creates no more (p.38)", () => {
    let state = inFirmsPhase(withCompanyShares(withFirmState(firmsGame(), BLUE, { [BLUE]: 5, [YELLOW]: 5 }), [RED]));
    const supply = state.players[RED].familyMembers.supply;
    state = choose(state, "firms.invest");
    state = consent(state, true);
    expect(firmOf(state, BLUE)).toMatchObject({ londonTreasury: 10, shares: { [BLUE]: 5, [YELLOW]: 5 } });
    expect(state.players[RED].familyMembers.supply).toBe(supply + 1);
    expectFamilyPiecesConserved(state);
  });

  test("an invested workshop is flipped and cannot be used again (p.38)", () => {
    let state = inFirmsPhase(withWorkshop(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), RED));
    state = choose(state, "firms.invest");
    state = consent(state, true);
    expect(state.players[RED].enterprises[0].invested).toBe(true);
    expect(firmOf(state, BLUE).shares[RED]).toBe(1);
  });

  test("a pending consent survives save and load, then resumes", () => {
    let state = inFirmsPhase(game());
    state = choose(state, "firms.invest");
    state = roundTrip(state);
    state = consent(state, true);
    expect(firmOf(state, BLUE).shares[RED]).toBe(1);
    expect(roundTrip(state).pendingDecision.step).toBe("firms.investments");
  });
});

describe("Acquiring ships as a firm (p.39)", () => {
  test("a shipyard ship costs £3 from London to the bank, with the shipyard owner's consent", () => {
    let state = startAt(BLUE, withShipyardShip(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), YELLOW, 1));
    expect(asking(state)).toEqual({ step: "firms.investments", actor: BLUE });
    const bank = state.company.balance;
    state = choose(state, "firms.fitShip");
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: YELLOW });
    state = consent(state, true);
    const firm = firmOf(state, BLUE);
    expect(firm.londonTreasury).toBe(2);
    expect(state.company.ships.find((ship) => ship.id === "ship-shipyard-01")?.location).toBe(`firm:${firm.id}`);
    expect(state.company.balance).toBe(bank);
  });

  test("a refusal leaves the ship on its shipyard", () => {
    let state = startAt(BLUE, withShipyardShip(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), YELLOW, 1));
    state = consent(choose(state, "firms.fitShip"), false);
    expect(firmOf(state, BLUE).londonTreasury).toBe(5);
    expect(state.company.ships.find((ship) => ship.id === "ship-shipyard-01")?.location).toBe("shipyard");
  });

  test("Ship Subsidy makes it £2", () => {
    let state = startAt(BLUE, withLaw(withShipyardShip(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), YELLOW, 1), "ship-subsidy"));
    state = consent(choose(state, "firms.fitShip"), true);
    expect(firmOf(state, BLUE).londonTreasury).toBe(3);
  });

  test("your own shipyard needs no consent; too little cash offers nothing", () => {
    let state = startAt(BLUE, withShipyardShip(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), BLUE, 1));
    state = choose(state, "firms.fitShip");
    expect(firmOf(state, BLUE).londonTreasury).toBe(2);

    const poor = startAt(BLUE, withShipyardShip(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }, { london: 2 }), BLUE, 1));
    expect(types(poor)).not.toContain("firms.fitShip");
  });

  test("buying back a player ship: £3 fresh, £2 fatigued, paid to the Manager of Shipping", () => {
    const base = withFirmState(firmsGame(), BLUE, { [BLUE]: 1 });
    let fresh = startAt(BLUE, withShipyardShip(base, YELLOW, 1, "west-indian"));
    const shipping = fresh.company.offices["manager-of-shipping"].treasury;
    fresh = consent(choose(fresh, "firms.buyBackShip"), true);
    expect(firmOf(fresh, BLUE).londonTreasury).toBe(2);
    expect(fresh.company.offices["manager-of-shipping"].treasury).toBe(shipping + 3);
    expect(fresh.company.ships.find((ship) => ship.id === "ship-shipyard-01")?.location).toBe(`firm:${firmOf(fresh, BLUE).id}`);

    let tired = startAt(BLUE, withShipyardShip(base, YELLOW, 1, "west-indian", true));
    tired = consent(choose(tired, "firms.buyBackShip"), true);
    expect(firmOf(tired, BLUE).londonTreasury).toBe(3);
    expect(tired.company.offices["manager-of-shipping"].treasury).toBe(shipping + 2);
  });

  test("a refused buyback changes nothing", () => {
    let state = startAt(BLUE, withShipyardShip(withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }), YELLOW, 1, "west-indian"));
    state = consent(choose(state, "firms.buyBackShip"), false);
    expect(firmOf(state, BLUE).londonTreasury).toBe(5);
  });

  test("firms cannot take Company ships or extra ships (p.39)", () => {
    const base = withFirmState(firmsGame(), BLUE, { [BLUE]: 1 });
    const state = startAt(BLUE, {
      ...base,
      company: {
        ...base.company,
        ships: [
          { id: "c1", kind: "company", location: "west-indian", fatigued: false },
          { id: "e1", kind: "extra", location: "west-indian", fatigued: false },
        ],
      },
    });
    expect(types(state)).not.toContain("firms.buyBackShip");
    expect(types(state)).not.toContain("firms.fitShip");
  });
});

describe("Hostile takeovers (p.39)", () => {
  test("consent from holders of a majority moves the firm, its ships and treasury", () => {
    let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 3 }, { london: 7, india: 2 });
    state = withShipyardShip(state, BLUE, 1, `firm:firm-${BLUE}`);
    state = inFirmsPhase(state);
    expect(asking(state)).toEqual({ step: "firms.investments", actor: RED });
    state = choose(state, "firms.takeOver");
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: YELLOW });
    state = consent(state, true);
    expect(firmOf(state, RED)).toMatchObject({ id: `firm-${BLUE}`, londonTreasury: 7, indiaTreasury: 2, shares: { [BLUE]: 2, [YELLOW]: 3 } });
    expect(state.company.ships.find((ship) => ship.id === "ship-shipyard-01")?.location).toBe(`firm:firm-${BLUE}`);
  });

  test("a refusal leaves the firm with its manager", () => {
    let state = inFirmsPhase(withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 3 }));
    state = consent(choose(state, "firms.takeOver"), false);
    expect(firmOf(state, BLUE).id).toBe(`firm-${BLUE}`);
    expect(state.firms?.every((firm) => firm.manager !== RED)).toBe(true);
  });

  test("your own shares count toward the majority; a majority holder needs no consent", () => {
    let state = inFirmsPhase(withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [RED]: 3 }));
    state = choose(state, "firms.takeOver");
    expect(firmOf(state, RED).shares).toEqual({ [BLUE]: 2, [RED]: 3 });

    // Two of four is not a majority: the next-largest holder must also agree.
    let half = inFirmsPhase(withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [RED]: 2 }));
    half = choose(half, "firms.takeOver");
    expect(asking(half)).toEqual({ step: "negotiation.consent", actor: BLUE });
  });

  test("only a player who manages no firm may take over", () => {
    const state = inFirmsPhase(withFirmState(withFirmState(firmsGame(), RED, { [RED]: 1 }), BLUE, { [BLUE]: 1 }));
    expect(types(state)).not.toContain("firms.takeOver");
  });
});

describe("Mergers (p.39)", () => {
  const twoFirms = (aValue: number, bValue: number, aShares: Record<string, number> = { [BLUE]: 2, [YELLOW]: 1 }, bShares: Record<string, number> = { [YELLOW]: 3, [RED]: 1 }) => {
    let state = withFirmState(firmsGame(), BLUE, aShares, { value: aValue, london: 4, id: "firm-a" });
    state = withFirmState(state, YELLOW, bShares, { value: bValue, london: 6, id: "firm-b" });
    return state;
  };
  const toBuild = (state: GameState) => {
    // Red holds a share only; Blue (a manager) goes after Red's pass.
    let s = inFirmsPhase(state);
    if (s.pendingDecision.actor === RED) s = choose(s, "firms.pass");
    expect(s.pendingDecision.actor).toBe(BLUE);
    return choose(choose(s, "firms.startMerge"), "firms.mergeAdd");
  };

  test("the highest-Value firm is primary; every shareholder consents; treasuries and shares combine", () => {
    let state = toBuild(twoFirms(3, 5));
    expect(asking(state)).toEqual({ step: "firms.mergeBuild", actor: BLUE });
    state = choose(state, "firms.mergeProceed");
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: YELLOW });
    state = consent(state, true);
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: RED });
    state = consent(state, true);
    expect(state.firms).toHaveLength(1);
    expect(firmOf(state, YELLOW)).toMatchObject({ id: "firm-b", value: 5, londonTreasury: 10, shares: { [BLUE]: 2, [YELLOW]: 4, [RED]: 1 } });
    expectFamilyPiecesConserved(state);
  });

  test("one refusal stops the merger", () => {
    let state = choose(toBuild(twoFirms(3, 5)), "firms.mergeProceed");
    state = consent(consent(state, true), false);
    expect(state.firms).toHaveLength(2);
  });

  test("a tie in Value lets the proposer pick the primary firm", () => {
    let state = choose(toBuild(twoFirms(4, 4)), "firms.mergeProceed");
    expect(asking(state)).toEqual({ step: "firms.mergePrimary", actor: BLUE });
    state = roundTrip(state);
    state = choose(state, "firms.mergeChoosePrimary", (command) => (command.payload as { firmId: string }).firmId === "firm-a");
    state = consent(consent(state, true), true);
    expect(firmOf(state, BLUE)).toMatchObject({ id: "firm-a", value: 4 });
    expect(state.firms).toHaveLength(1);
  });

  test("shares over 10 are returned to their owners' supply, with their consent (p.39)", () => {
    const supplyBefore = (state: GameState) => state.players[BLUE].familyMembers.supply;
    let state = toBuild(twoFirms(3, 5, { [BLUE]: 6 }, { [YELLOW]: 6 }));
    const before = supplyBefore(state);
    state = choose(state, "firms.mergeProceed");
    expect(asking(state)).toEqual({ step: "firms.mergeReturn", actor: BLUE });
    state = roundTrip(choose(state, "firms.mergeReturnShare", (command) => (command.payload as { playerId: string }).playerId === BLUE));
    expect(asking(state).step).toBe("firms.mergeReturn");
    state = choose(state, "firms.mergeReturnShare", (command) => (command.payload as { playerId: string }).playerId === BLUE);
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: YELLOW });
    state = consent(state, true);
    expect(firmOf(state, YELLOW).shares).toEqual({ [BLUE]: 4, [YELLOW]: 6 });
    expect(supplyBefore(state)).toBe(before + 2);
    expectFamilyPiecesConserved(state);
  });

  test("a merger can be called off without using the turn; three firms can merge at once", () => {
    let state = toBuild(twoFirms(3, 5));
    state = choose(state, "firms.mergeCancel");
    expect(asking(state)).toEqual({ step: "firms.investments", actor: BLUE });

    let three = withFirmState(twoFirms(3, 5), RED, { [RED]: 1 }, { value: 2, id: "firm-c", london: 1 });
    three = inFirmsPhase(three);
    three = choose(choose(choose(three, "firms.startMerge"), "firms.mergeAdd"), "firms.mergeAdd");
    expect(types(three)).toContain("firms.mergeProceed");
    expect(types(three)).not.toContain("firms.mergeAdd");
  });
});

describe("Dissolving a firm (p.37)", () => {
  test("every shareholder must consent; the shares go to Debtor's Prison", () => {
    let state = startAt(BLUE, withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 1 }));
    state = choose(state, "firms.dissolve");
    expect(asking(state)).toEqual({ step: "negotiation.consent", actor: YELLOW });
    state = consent(state, true);
    expect(state.firms).toEqual([]);
    expect(state.players[BLUE].familyMembers.debtorPrison).toBe(2);
    expect(state.players[YELLOW].familyMembers.debtorPrison).toBe(1);
    expectFamilyPiecesConserved(state);
  });

  test("a refusal keeps the firm", () => {
    let state = startAt(BLUE, withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 1 }));
    state = consent(choose(state, "firms.dissolve"), false);
    expect(state.firms).toHaveLength(1);
  });

  test("a sole shareholder dissolves without anyone to ask", () => {
    let state = startAt(BLUE, withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }));
    state = choose(state, "firms.dissolve");
    expect(state.firms).toEqual([]);
  });
});

describe("Firm shares can be traded (p.38)", () => {
  test("a gift moves firm shares and is checked against holdings", () => {
    let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 1 });
    state = act(state, BLUE, "negotiation.give", { to: RED, items: [{ kind: "firmShare", firmId: `firm-${BLUE}`, count: 2 }] });
    expect(firmOf(state, BLUE).shares).toEqual({ [YELLOW]: 1, [RED]: 2 });
    expect(rejection(state, BLUE, "negotiation.give", { to: RED, items: [{ kind: "firmShare", firmId: `firm-${BLUE}`, count: 1 }] })[0]).toMatch(/does not hold/);
    expectFamilyPiecesConserved(state);
  });

  test("a trade of a firm share for cash needs the other player's consent", () => {
    let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 1 });
    state = { ...state, players: { ...state.players, [RED]: { ...state.players[RED], cash: 5 } } };
    state = act(state, RED, "negotiation.proposeTrade", {
      to: YELLOW,
      give: [{ kind: "cash", amount: 3 }],
      receive: [{ kind: "firmShare", firmId: `firm-${BLUE}`, count: 1 }],
    });
    state = consent(state, true);
    expect(firmOf(state, BLUE).shares).toEqual({ [BLUE]: 2, [RED]: 1 });
    expect(state.players[YELLOW].cash - 0).toBeGreaterThanOrEqual(3);
  });

  test("shares traded beforehand count in a merger or takeover consent", () => {
    let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 2, [YELLOW]: 3 });
    state = act(state, YELLOW, "negotiation.give", { to: RED, items: [{ kind: "firmShare", firmId: `firm-${BLUE}`, count: 3 }] });
    state = inFirmsPhase(state);
    state = choose(state, "firms.takeOver");
    expect(firmOf(state, RED).manager).toBe(RED);
  });
});

describe("Firm Strategy (p.40)", () => {
  const strategyGame = () => {
    let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }, { london: 5 });
    state = withFirmState(state, YELLOW, { [YELLOW]: 1 }, { london: 4 });
    state = withShipyardShip(state, BLUE, 1, `firm:firm-${BLUE}`);
    state = withShipyardShip(state, YELLOW, 2, `firm:firm-${YELLOW}`);
    return state;
  };
  const toStrategy = (state: GameState) => choose(choose(startAt(BLUE, state), "firms.pass"), "firms.pass");

  test("managers choose in Prime Minister order; a sea zone needs a ship and a bid of 1 to the London treasury", () => {
    let state = toStrategy(strategyGame());
    expect(asking(state)).toEqual({ step: "firms.strategy", actor: BLUE });
    expect(state.pendingDecision.legalCommands.map((c) => (c.payload as { strategy: string }).strategy).sort()).toEqual([
      "east-indian",
      "hobnob",
      "south-indian",
      "west-indian",
    ]);
    state = choose(state, "firms.chooseStrategy", (c) => (c.payload as { strategy: string }).strategy === "west-indian");
    expect(asking(state)).toEqual({ step: "firms.strategyBid", actor: BLUE });
    expect(state.pendingDecision.legalCommands.map((c) => (c.payload as { bid: number }).bid)).toEqual([1, 2, 3, 4, 5]);
  });

  test("Hobnob takes no cash", () => {
    let state = toStrategy(strategyGame());
    state = choose(state, "firms.chooseStrategy", (c) => (c.payload as { strategy: string }).strategy === "hobnob");
    expect(state.pendingDecision.legalCommands.map((c) => (c.payload as { bid: number }).bid)).toEqual([0]);
  });

  test("a firm with no ship, or no cash, can only Hobnob and is not asked", () => {
    let state = withFirmState(firmsGame(), BLUE, { [BLUE]: 1 });
    state = toStrategy(state).phase === "firms" ? state : state;
    let started = startAt(BLUE, state);
    while (started.phase === "firms") started = choose(started, "firms.pass");
    expect(started.phase).not.toBe("firms");
    expect(started.hidden.firmStrategySecrets[`firm-${BLUE}`]).toMatchObject({ strategy: "hobnob", bid: 0 });
    expect(firmOf(started, BLUE).tradeBid).toBe(0);
  });

  test("after the last manager every bid is public and taken from London (ruling 4)", () => {
    let state = toStrategy(strategyGame());
    state = choose(state, "firms.chooseStrategy", (c) => (c.payload as { strategy: string }).strategy === "west-indian");
    state = choose(state, "firms.chooseBid", (c) => (c.payload as { bid: number }).bid === 2);
    expect(firmOf(state, BLUE).tradeBid).toBeUndefined();
    expect(asking(state)).toEqual({ step: "firms.strategy", actor: YELLOW });
    state = choose(state, "firms.chooseStrategy", (c) => (c.payload as { strategy: string }).strategy === "east-indian");
    state = roundTrip(state);
    state = choose(state, "firms.chooseBid", (c) => (c.payload as { bid: number }).bid === 4);
    expect(firmOf(state, BLUE)).toMatchObject({ tradeBid: 2, londonTreasury: 3 });
    expect(firmOf(state, YELLOW)).toMatchObject({ tradeBid: 4, londonTreasury: 0 });
    expect(state.phase).not.toBe("firms");
    expect(state.hidden.firmStrategySecrets[`firm-${BLUE}`].strategy).toBe("west-indian");
  });

  test("another seat sees neither the strategy nor the bid before every manager has chosen", () => {
    let state = toStrategy(strategyGame());
    state = choose(state, "firms.chooseStrategy", (c) => (c.payload as { strategy: string }).strategy === "west-indian");
    const beforeBid = JSON.stringify(projectForViewer(state, { kind: "seat", playerId: YELLOW }));
    state = choose(state, "firms.chooseBid", (c) => (c.payload as { bid: number }).bid === 2);

    for (const view of [
      projectForViewer(state, { kind: "seat", playerId: YELLOW }),
      projectForViewer(state, { kind: "seat", playerId: RED }),
      projectForViewer(state, { kind: "spectator" }),
    ]) {
      expect(view.hidden.firmStrategySecrets[`firm-${BLUE}`]).toEqual({ firmId: `firm-${BLUE}`, committedBy: BLUE });
      if (view.pendingDecision.actor !== YELLOW) expect(view.pendingDecision.legalCommands).toEqual([]);
      expect(JSON.stringify(view)).not.toContain("west-indian\",\"bid");
      expect(view.log.map((entry) => entry.summary).join("\n")).not.toMatch(/west|£2/i);
    }
    expect(beforeBid).not.toContain('"strategy":"west-indian"');
    const own = projectForViewer(state, { kind: "seat", playerId: BLUE });
    expect(own.hidden.firmStrategySecrets[`firm-${BLUE}`]).toMatchObject({ strategy: "west-indian", bid: 2 });
  });
});

describe("Takeover after strategy choices do not matter; dissolved firms leave no secrets", () => {
  test("firmById reports undefined once dissolved", () => {
    let state = startAt(BLUE, withFirmState(firmsGame(), BLUE, { [BLUE]: 1 }));
    state = choose(state, "firms.dissolve");
    expect(firmById(state, `firm-${BLUE}`)).toBeUndefined();
  });
});
