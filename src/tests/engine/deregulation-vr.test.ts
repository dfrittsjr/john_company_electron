import { describe, expect, it } from "vitest";
import { firmById, type GameState } from "../../engine";
import { firmSettlementOrder } from "../../engine/phases/revenue-firms";
import { expectFamilyPiecesConserved } from "../fixtures/game";
import { withCompanyShares, withWorkshop } from "../fixtures/firms";
import { BLUE, RED, YELLOW, play, reload, revenueGame, turnStartGame } from "../fixtures/deregulation-vr";

// Standing spaces: 1 = "£4" (lined, starred), 2 = "£6" (lined), 4 = "£10" ("S"). Debt 5-7 lined, 8 starred.

const stepOf = (state: GameState) => state.pendingDecision.step;
const types = (state: GameState) => state.pendingDecision.legalCommands.map((command) => command.type);

describe("Vote to Deregulate: when it is offered (p.36)", () => {
  it("the Prime Minister may call it when Standing is on a lined space, or decline", () => {
    const state = turnStartGame({ standing: 2, debt: 0 });
    expect(stepOf(state)).toBe("parliament.deregulationCall");
    expect(state.pendingDecision.actor).toBe(RED);
    expect(state.pendingDecision.legalCommands.map((c) => c.payload)).toEqual([{ call: true }, { call: false }]);
    const declined = play(state, "parliament.deregulationCall", { call: false });
    expect(stepOf(declined)).toBe("londonSeason.confirm");
    expect(declined.phase).toBe("londonSeason");
  });

  it("a lined Debt space alone also allows it", () => {
    const state = turnStartGame({ standing: 4, debt: 5 });
    expect(stepOf(state)).toBe("parliament.deregulationCall");
    expect(state.pendingDecision.legalCommands).toHaveLength(2);
  });

  it("a starred space makes it mandatory: only 'call' is offered", () => {
    expect(turnStartGame({ standing: 1, debt: 0 }).pendingDecision.legalCommands.map((c) => c.payload)).toEqual([{ call: true }]);
    expect(turnStartGame({ standing: 4, debt: 8 }).pendingDecision.legalCommands.map((c) => c.payload)).toEqual([{ call: true }]);
  });

  it("is not offered with no lined marker, with no Prime Minister, when deregulated, or in plain 1710", () => {
    expect(stepOf(turnStartGame({ standing: 4, debt: 4 }))).toBe("londonSeason.confirm");
    expect(stepOf(turnStartGame({ standing: 1, debt: 8, primeMinister: null }))).toBe("londonSeason.confirm");
    const deregulated = turnStartGame({ standing: 1, debt: 0 });
    const done = { ...deregulated, parliament: { ...deregulated.parliament, deregulated: true } };
    expect(done.parliament.deregulated).toBe(true);
    const plain = turnStartGame({ standing: 1, debt: 0 });
    expect(plain.scenario).toBe("long-1710");
  });
});

describe("Vote to Deregulate: support and voting (p.36)", () => {
  it("starts at +2 with one marker on a lined space and +6 with both", () => {
    const one = play(turnStartGame({ standing: 2, debt: 0 }), "parliament.deregulationCall");
    // Nobody can vote, so the vote resolves at once; read the support from the log instead.
    expect(one.log[one.log.length - 1].summary).toMatch(/starting support \+2/);
    const both = play(turnStartGame({ standing: 2, debt: 5 }), "parliament.deregulationCall");
    expect(both.log[both.log.length - 1].summary).toMatch(/starting support \+6/);
  });

  it("adds Writer Privileges' +5 to the initial support", () => {
    const state = play(turnStartGame({ standing: 2, debt: 5, passedLaws: ["writer-privileges"] }), "parliament.deregulationCall");
    expect(state.log[state.log.length - 1].summary).toMatch(/starting support \+11/);
  });

  it("lets the Prime Minister vote against the law, with cash", () => {
    const state = play(turnStartGame({ standing: 2, debt: 0, cash: { [RED]: 5 } }), "parliament.deregulationCall");
    expect(stepOf(state)).toBe("parliament.vote");
    expect(state.pendingDecision.actor).toBe(RED);
    const directions = state.pendingDecision.legalCommands.filter((c) => c.type === "parliament.castVotes").map((c) => (c.payload as { direction: string }).direction);
    expect(directions).toContain("against");
    expect(directions).toContain("for");
    // No coalitions in the special session.
    expect(types(state)).not.toContain("parliament.setVoteCredit");
  });
});

describe("Vote to Deregulate: passing (p.36)", () => {
  it("halves Debt (rounding down), puts Standing on S, gives a token, deregulates, clears firms, and goes to the London Season", () => {
    const start = turnStartGame({ standing: 2, debt: 5, passedLaws: ["industry-subsidy", "calico-acts"] });
    const before = start.players[RED].passedLawTokens;
    const state = play(start, "parliament.deregulationCall");
    expect(state.company.debt).toBe(3);
    expect(state.company.standing).toBe(4);
    expect(state.parliament.deregulated).toBe(true);
    expect(state.firms).toEqual([]);
    expect(state.players[RED].passedLawTokens).toBe(before + 1);
    expect(state.parliament.passedLaws.some((law) => law.lawId === "deregulation")).toBe(true);
    // Industry Subsidy is discarded when deregulation occurs; Calico Acts stays (its penalty stops).
    expect(state.parliament.passedLaws.some((law) => law.lawId === "industry-subsidy")).toBe(false);
    expect(state.parliament.lawDeck.discardPile).toContain("industry-subsidy");
    expect(state.parliament.passedLaws.some((law) => law.lawId === "calico-acts")).toBe(true);
    expect(state.parliament.session).toBeUndefined();
    expect(state.phase).toBe("londonSeason");
    expect(stepOf(state)).toBe("londonSeason.confirm");
    expect(state.parliament.primeMinister).toBe(RED);
  });

  it("an odd Debt of 1 stays at 1 (floor of half is 0)", () => {
    const state = play(turnStartGame({ standing: 2, debt: 1 }), "parliament.deregulationCall");
    expect(state.company.debt).toBe(1);
    expect(state.parliament.deregulated).toBe(true);
  });
});

describe("Vote to Deregulate: failing (p.36)", () => {
  function failedVote(shareValue = 1): GameState {
    let state = turnStartGame({ standing: 2, debt: 0, cash: { [RED]: 0, [BLUE]: 5 } });
    state = { ...state, company: { ...state.company, shareValue } };
    state = play(state, "parliament.deregulationCall");
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = play(state, "parliament.castVotes", { direction: "against", source: "cash", votes: 3 });
    // Blue may keep voting; finish the round, then resolve.
    while (stepOf(state) === "parliament.vote") state = play(state, "parliament.passVote");
    expect(stepOf(state)).toBe("parliament.continueVoting");
    return play(state, "parliament.continueVoting", { another: false });
  }

  it("places the Company share token, keeps the Prime Minister and the law, and goes on to the London Season", () => {
    const state = failedVote();
    expect(state.company.shareValue).toBe(2);
    expect(state.parliament.deregulated).toBe(false);
    expect(state.parliament.primeMinister).toBe(RED);
    expect(state.parliament.lawDeck.discardPile).not.toContain("deregulation");
    expect(state.parliament.passedLaws.some((law) => law.lawId === "deregulation")).toBe(false);
    expect(state.players[RED].passedLawTokens).toBe(0);
    expect(state.parliament.oppositionLeader).toBeUndefined();
    expect(stepOf(state)).toBe("londonSeason.confirm");
  });

  it("flips the token to +3 and never goes beyond 3", () => {
    expect(failedVote(2).company.shareValue).toBe(3);
    expect(failedVote(3).company.shareValue).toBe(3);
  });

  it("can be voted on again next turn", () => {
    const failed = failedVote();
    const next = { ...failed, turn: failed.turn + 1 };
    // beginTurn is what Upkeep calls for the next turn.
    return import("../../engine/phases/turn-start").then(({ beginTurn }) => {
      expect(stepOf(beginTurn(next))).toBe("parliament.deregulationCall");
    });
  });

  it("survives save and load in the middle of the vote", () => {
    let state = turnStartGame({ standing: 2, debt: 0, cash: { [BLUE]: 5 } });
    state = reload(play(state, "parliament.deregulationCall"));
    expect(stepOf(state)).toBe("parliament.vote");
    state = reload(play(state, "parliament.castVotes", { direction: "against", source: "cash", votes: 3 }));
    expect(stepOf(state)).toBe("parliament.vote");
    while (stepOf(state) === "parliament.vote") state = play(state, "parliament.passVote");
    state = reload(state);
    state = play(state, "parliament.continueVoting", { another: false });
    expect(state.company.shareValue).toBe(2);
  });
});

describe("Firm expenses and dividends (pp.41-42)", () => {
  it("p.42 example: £2 ships + £5 Value paid from India, three £4 dividends, cube on 12, the rest to London", () => {
    // Green (RED here) manages a firm with 1 share; Pink (BLUE) and Blue (YELLOW) hold 1 each.
    let state = revenueGame([
      { id: "walsh", manager: RED, shares: { [RED]: 1, [BLUE]: 1, [YELLOW]: 1 }, india: 20, value: 5, ships: 2, strategy: "south-indian" },
    ]);
    const cash = { red: state.players[RED].cash, blue: state.players[BLUE].cash, yellow: state.players[YELLOW].cash };
    state = play(state, "revenue.confirm");
    // Expenses are paid automatically (London is empty): 7 from India, leaving 13.
    expect(stepOf(state)).toBe("revenue.firmDividends");
    expect(firmById(state, "walsh")).toMatchObject({ indiaTreasury: 13, londonTreasury: 0 });
    for (let index = 0; index < 3; index += 1) state = play(state, "revenue.firmDividend", { action: "pay" });
    expect(state.players[RED].cash - cash.red).toBe(6);
    expect(state.players[BLUE].cash - cash.blue).toBe(3);
    expect(state.players[YELLOW].cash - cash.yellow).toBe(3);
    expect(firmById(state, "walsh")!.indiaTreasury).toBe(1);
    state = play(state, "revenue.firmDividend", { action: "stop" });
    expect(firmById(state, "walsh")).toMatchObject({ dividendCube: 12, indiaTreasury: 0, londonTreasury: 1 });
    // Then the Company goes on with its own Revenue.
    expect(stepOf(state)).not.toMatch(/firm/);
    expectFamilyPiecesConserved(state);
  });

  it("p.42 optional dividends: Blue 2 shares + manager, Yellow 2, £8 paid as two £4 dividends", () => {
    // Manager is Blue (BLUE); Yellow holds 2. Value 1 and 4 shares: expenses £4 from London.
    let state = revenueGame([{ id: "hastings", manager: BLUE, shares: { [BLUE]: 2, [YELLOW]: 2 }, london: 4, india: 8, value: 1 }]);
    const cash = { blue: state.players[BLUE].cash, yellow: state.players[YELLOW].cash };
    state = play(state, "revenue.confirm");
    // London 4 and India 8 both hold money, so the manager chooses how to pay: pay it all from London.
    expect(stepOf(state)).toBe("revenue.firmPayFrom");
    expect(state.pendingDecision.legalCommands.length).toBe(5);
    state = play(state, "revenue.firmPayFrom", { fromIndia: 0 });
    expect(firmById(state, "hastings")).toMatchObject({ londonTreasury: 0, indiaTreasury: 8 });
    // A full dividend is £5 (2 + 2 + manager 1), so only one fits whole. Ask for waivers instead.
    for (let round = 0; round < 2; round += 1) {
      state = play(state, "revenue.firmDividend", { action: "waive" });
      expect(stepOf(state)).toBe("revenue.firmWaiver");
      expect(state.pendingDecision.actor).toBe(BLUE);
      state = play(state, "revenue.firmWaive", { forgone: 1 });
      expect(state.pendingDecision.actor).toBe(YELLOW);
      state = play(state, "revenue.firmWaive", { forgone: 0 });
    }
    expect(state.players[BLUE].cash - cash.blue).toBe(4);
    expect(state.players[YELLOW].cash - cash.yellow).toBe(4);
    expect(firmById(state, "hastings")).toMatchObject({ dividendCube: 8, indiaTreasury: 0 });
    expect(stepOf(state)).not.toMatch(/firm/);
  });

  it("pays no dividends: the cube goes to 0", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1 }, india: 5, value: 1, dividendCube: 9 }]);
    state = play(state, "revenue.confirm");
    // Expenses £1 paid from India (London empty); £4 left.
    state = play(state, "revenue.firmDividend", { action: "stop" });
    expect(firmById(state, "f")).toMatchObject({ dividendCube: 0, londonTreasury: 4, indiaTreasury: 0 });
  });

  it("a Hobnob firm pays expenses but keeps its dividend cube and pays no dividends", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1 }, london: 3, india: 5, value: 1, dividendCube: 9, strategy: "hobnob" }]);
    state = play(state, "revenue.confirm");
    state = play(state, "revenue.firmPayFrom", { fromIndia: 0 });
    expect(firmById(state, "f")).toMatchObject({ dividendCube: 9, londonTreasury: 7, indiaTreasury: 0 });
    expect(stepOf(state)).not.toMatch(/firm/);
  });

  it("settles firms in ruling-8 order: initiative lowest first, then the others by windows and seat", () => {
    const state = revenueGame([
      { id: "late", manager: YELLOW, shares: { [YELLOW]: 1 } },
      { id: "second", manager: BLUE, shares: { [BLUE]: 1 }, initiative: 2 },
      { id: "first", manager: RED, shares: { [RED]: 1 }, initiative: -1 },
      { id: "plain", manager: RED, shares: { [RED]: 1 } },
    ]);
    expect(firmSettlementOrder(state)).toEqual(["first", "second", "plain", "late"]);
  });

  it("firms settle before the Company pays expenses", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1 }, london: 5 }]);
    state = { ...state, company: { ...state.company, balance: 9, debt: 0 } };
    state = play(state, "revenue.confirm");
    expect(stepOf(state)).not.toMatch(/firm/);
    expect(firmById(state, "f")).toMatchObject({ londonTreasury: 4, dividendCube: 0 });
  });
});

describe("Firms that cannot pay (p.41)", () => {
  it("dissolves the firm when nothing rescues it: shares to Debtor's Prison, ships to their shipyards", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1, [BLUE]: 1 }, india: 1, value: 3, ships: 1 }]);
    state = play(state, "revenue.confirm");
    expect(stepOf(state)).toBe("revenue.firmRescue");
    expect(types(state)).toEqual(["revenue.firmDissolve"]);
    state = play(state, "revenue.firmDissolve");
    expect(state.firms).toEqual([]);
    expect(state.players[RED].familyMembers.debtorPrison).toBe(1);
    expect(state.players[BLUE].familyMembers.debtorPrison).toBe(1);
    expect(state.company.ships.find((ship) => ship.id === "ship-f-0")?.location).toBe("shipyard");
    expect(stepOf(state)).not.toMatch(/firm/);
    expectFamilyPiecesConserved(state);
  });

  it("an emergency investment (with the investor's consent) pays the bill, lowers Value, and the surplus is lost", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1 }, india: 1, value: 3 }]);
    state = withCompanyShares(state, [YELLOW]);
    state = play(state, "revenue.confirm");
    expect(stepOf(state)).toBe("revenue.firmRescue");
    // Weak shares can't invest; here Standing is "S" and Debt 0, so Yellow's share is usable.
    const ask = state.pendingDecision.legalCommands.find((command) => command.type === "revenue.firmInvest")!;
    expect((ask.payload as { investor: string }).investor).toBe(YELLOW);
    state = play(state, "revenue.firmInvest", { investor: YELLOW });
    expect(stepOf(state)).toBe("revenue.firmInvestAsk");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = reload(state);
    state = play(state, "revenue.firmInvestAnswer", { accept: true });
    // Value 3 -> 2, shares 2: expenses £2, paid from the £5 of emergency cash; the other £3 is lost.
    const firm = firmById(state, "f")!;
    expect(firm.value).toBe(2);
    expect(firm.shares).toEqual({ [RED]: 1, [YELLOW]: 1 });
    expect(state.company.court.some((share) => share.owner === YELLOW)).toBe(false);
    // Still Dividends for the firm: India holds £1; stop. Then India moves to London (the lost £3 is gone).
    expect(stepOf(state)).toBe("revenue.firmDividends");
    expect(firm.londonTreasury).toBe(0);
    state = play(state, "revenue.firmDividend", { action: "stop" });
    expect(firmById(state, "f")).toMatchObject({ londonTreasury: 1, indiaTreasury: 0 });
    expectFamilyPiecesConserved(state);
  });

  it("an investor may decline, and is not asked again; a workshop works too; the manager may invest alone", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1 }, value: 4 }]);
    state = withWorkshop(withCompanyShares(state, [YELLOW]), RED);
    state = play(state, "revenue.confirm");
    state = play(state, "revenue.firmInvest", { investor: YELLOW });
    state = play(state, "revenue.firmInvestAnswer", { accept: false });
    expect(stepOf(state)).toBe("revenue.firmRescue");
    const investors = state.pendingDecision.legalCommands.filter((c) => c.type === "revenue.firmInvest").map((c) => (c.payload as { investor: string }).investor);
    expect(investors).toEqual([RED]);
    // The manager invests their own workshop: no consent step. Value 4 -> 3, shares 2, expenses 3, cash 5.
    state = play(state, "revenue.firmInvest", { investor: RED });
    expect(firmById(state, "f")).toMatchObject({ value: 3 });
    expect(state.players[RED].enterprises[0].invested).toBe(true);
    expect(stepOf(state)).not.toBe("revenue.firmRescue");
  });

  it("weak Company shares (Debt on a lined space) can't be used for emergency investments", () => {
    let state = revenueGame([{ id: "f", manager: RED, shares: { [RED]: 1 }, value: 4 }]);
    state = withCompanyShares({ ...state, company: { ...state.company, debt: 5 } }, [YELLOW]);
    state = play(state, "revenue.confirm");
    expect(types(state)).toEqual(["revenue.firmDissolve"]);
  });

  it("an emergency merger: the higher-Value firm is primary, the other pays its own expenses first, then the endangered firm's", () => {
    let state = revenueGame([
      { id: "weak", manager: RED, shares: { [RED]: 1 }, value: 2 },
      { id: "strong", manager: BLUE, shares: { [BLUE]: 1 }, value: 3, london: 10 },
    ]);
    state = play(state, "revenue.confirm");
    expect(stepOf(state)).toBe("revenue.firmRescue");
    expect(state.pendingDecision.actor).toBe(RED);
    state = play(state, "revenue.firmMerge", { other: "strong", primary: "strong" });
    expect(stepOf(state)).toBe("revenue.firmMergeConsent");
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = reload(state);
    state = play(state, "revenue.firmMergeAnswer", { accept: true });
    expect(state.firms).toHaveLength(1);
    const merged = firmById(state, "strong")!;
    // Strong paid £3, then the merged firm paid weak's £2: 10 - 3 - 2 = 5.
    expect(merged).toMatchObject({ manager: BLUE, value: 3, londonTreasury: 5, shares: { [BLUE]: 1, [RED]: 1 } });
    expect(stepOf(state)).not.toMatch(/firm/);
    expect(merged.dividendCube).toBe(0);
    expectFamilyPiecesConserved(state);
  });

  it("a refused merger returns to the rescue; and a tie in Value lets the proposer choose the primary", () => {
    let state = revenueGame([
      { id: "a", manager: RED, shares: { [RED]: 1 }, value: 2 },
      { id: "b", manager: BLUE, shares: { [BLUE]: 1 }, value: 2, london: 10 },
    ]);
    state = play(state, "revenue.confirm");
    const merges = state.pendingDecision.legalCommands.filter((command) => command.type === "revenue.firmMerge");
    expect(merges.map((command) => (command.payload as { primary: string }).primary).sort()).toEqual(["a", "b"]);
    state = play(state, "revenue.firmMerge", { other: "b", primary: "a" });
    state = play(state, "revenue.firmMergeAnswer", { accept: false });
    expect(stepOf(state)).toBe("revenue.firmRescue");
    expect(types(state)).toEqual(["revenue.firmDissolve"]);
  });

  it("the endangered firm may be the primary: it keeps its place and goes on to dividends", () => {
    let state = revenueGame([
      { id: "a", manager: RED, shares: { [RED]: 1 }, value: 3, india: 1 },
      { id: "b", manager: BLUE, shares: { [BLUE]: 1 }, value: 1, london: 10 },
    ]);
    state = play(state, "revenue.confirm");
    state = play(state, "revenue.firmMerge", { other: "b", primary: "a" });
    state = play(state, "revenue.firmMergeAnswer", { accept: true });
    expect(state.firms).toHaveLength(1);
    // b paid £1 (10 -> 9), then the merged firm paid a's £3: London 6. a is now at dividends with £1 in India.
    expect(firmById(state, "a")).toMatchObject({ londonTreasury: 6, manager: RED });
    expect(stepOf(state)).toBe("revenue.firmDividends");
  });
});
