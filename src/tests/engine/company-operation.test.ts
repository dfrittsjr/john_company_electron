import { describe, expect, it } from "vitest";
import { createRngState, playerOffices, rollDie, type GameState } from "../../engine";
import { outcomeForLowestDie, rollCheck } from "../../engine/checks";
import { exhaustActiveLocalAlliances, returnExtraShips } from "../../engine/phases/company-operation";
import { divideLoot } from "../../engine/phases/company-operation/commander";
import {
  withAssociatedRegion,
  withCommander,
  withOffice,
  withOfficers,
  withRegiments,
  withWriters,
} from "../fixtures/builders";
import {
  BLUE,
  OFFICES_BEFORE_PRESIDENCIES,
  act,
  RED,
  YELLOW,
  choose,
  enterOperation,
  operationGame,
  payloads,
  withBlackmail,
  withDice,
  withLaw,
  withOrder,
  withPrestige,
  withRegion,
  withSeating,
  withShips,
  withTreasury,
} from "../fixtures/company-operation";
import { applyCommandOrThrow, expectGameInvariants, expectSaveRoundTripPreservesPendingDecision } from "../fixtures/game";

const BEFORE_MADRAS = [...OFFICES_BEFORE_PRESIDENCIES, "president-bombay"];
const BEFORE_CHINA = [...OFFICES_BEFORE_PRESIDENCIES, "president-bombay", "president-madras", "president-bengal"];

describe("success checks (p.17)", () => {
  it("reads the lowest die: 1-2 success, 3-4 failure, 5-6 catastrophe", () => {
    expect([1, 2, 3, 4, 5, 6].map(outcomeForLowestDie)).toEqual([
      "success",
      "success",
      "failure",
      "failure",
      "catastrophe",
      "catastrophe",
    ]);
  });

  it("treats a check reduced to zero dice as a failure", () => {
    const rng = createRngState("zero-dice");
    expect(rollCheck(rng, 0, "test")).toEqual(expect.objectContaining({ outcome: "failure", values: [], rng }));
  });
});

describe("Trade (pp.20-21)", () => {
  function madrasTradeState(): GameState {
    let state = operationGame("madras-trade");
    state = withSeating(state, [RED, YELLOW, BLUE]);
    state = withOffice(state, "president-madras", RED, { treasury: 10 });
    state = withWriters(state, RED, "Madras", 1);
    state = withWriters(state, YELLOW, "Madras", 2);
    state = withShips(state, "south-indian", 5);
    // In the example one Mysore order is unavailable, so four orders worth £22 are filled.
    state = withOrder(state, "mysore-north-3", { closed: true });
    state = withOrder(state, "hyderabad-7", { closed: false });
    state = withOrder(state, "madras-south-4", { closed: false });
    return enterOperation(state, BEFORE_MADRAS);
  }

  it("reproduces the Madras example: £22 to the Company, £5 to the President, £2 to Yellow", () => {
    let state = madrasTradeState();
    expect(state.pendingDecision.step).toBe("companyOperation.presidency");
    expect(state.pendingDecision.actor).toBe(RED);

    state = choose(state, { action: "trade" });
    state = choose(state, { action: "declare", regionId: "mysore" });
    state = choose(state, { action: "declare", regionId: "hyderabad" });
    // £6 for six dice, minus two for the two regions outside Madras.
    const rolled = withDice(
      state,
      (seeded) => choose(seeded, { action: "roll", spend: 6 }),
      (result) => result.pendingDecision.step === "companyOperation.trade.place",
    );
    expect(rolled.log.at(-1)?.summary).toContain("4 dice");
    expect(rolled.company.offices["president-madras"].treasury).toBe(4);
    expectSaveRoundTripPreservesPendingDecision(rolled);

    // The first writer must go on the home port.
    expect(payloads(rolled).map((payload) => payload.orderId)).toEqual(["madras-home-5", "madras-home-5"]);
    const balance = rolled.company.balance;
    let placed = choose(rolled, { action: "place", orderId: "madras-home-5", writer: RED });
    placed = choose(placed, { action: "place", orderId: "madras-south-4", writer: YELLOW });
    placed = choose(placed, { action: "place", orderId: "hyderabad-7", writer: YELLOW });
    // Out of writers: a filled-order token.
    expect(payloads(placed)).toContainEqual({ action: "place", orderId: "mysore-south-6", writer: "token" });
    placed = choose(placed, { action: "place", orderId: "mysore-south-6", writer: "token" });

    expect(placed.company.balance - balance).toBe(22);
    expect(placed.players[RED].cash - rolled.players[RED].cash).toBe(5);
    expect(placed.players[YELLOW].cash - rolled.players[YELLOW].cash).toBe(2);
    expect(placed.companyOperation.tradedPresidencies).toEqual(["Madras"]);
    // One Trade: after a success the President may not Trade again this turn.
    expect(payloads(placed)).not.toContainEqual(expect.objectContaining({ action: "trade" }));
    expectGameInvariants(placed);
  });

  it("only lets a Presidency declare regions it could reach and never another President's home region", () => {
    let state = madrasTradeState();
    // Open the Mysore order that leads on to Bombay's home port.
    state = enterOperation(withOrder(state, "mysore-north-3", { closed: false }), BEFORE_MADRAS);
    state = choose(state, { action: "trade" });
    const declarable = (next: GameState) =>
      payloads(next)
        .filter((payload) => payload.action === "declare")
        .map((payload) => payload.regionId)
        .sort();

    expect(declarable(state)).toEqual(["hyderabad", "mysore"]);
    // Bombay is reachable through Mysore but is another President's home region (p.20).
    state = choose(state, { action: "declare", regionId: "mysore" });
    expect(declarable(state)).toEqual(["hyderabad"]);
    // Maratha is reached through Hyderabad, so it can be declared once Hyderabad is.
    state = choose(state, { action: "declare", regionId: "hyderabad" });
    expect(declarable(state)).toEqual(["maratha"]);
  });

  it("sends a catastrophic President back to supply and lets the Chairman order the rest", () => {
    let state = operationGame("madras-catastrophe");
    state = withOffice(state, "chairman", BLUE);
    state = withOffice(state, "president-madras", RED, { treasury: 3 });
    state = withCommander(state, "Madras", YELLOW);
    state = withShips(state, "south-indian", 1);
    state = enterOperation(state, BEFORE_MADRAS);
    state = choose(state, { action: "trade" });

    const result = withDice(
      state,
      (seeded) => choose(seeded, { action: "roll", spend: 1 }),
      (next) => next.company.offices["president-madras"].vacant,
    );
    expect(playerOffices(result, RED)).not.toContain("president-madras");
    expect(result.pendingDecision.actor).toBe(BLUE);
    expect(payloads(result)).not.toContainEqual(expect.objectContaining({ action: "trade" }));
    expect(payloads(result)).toContainEqual(expect.objectContaining({ action: "commander" }));
    expectGameInvariants(result);
  });

  it("offers Mercantile Connection to its holder after a Trade check and rerolls with half the dice", () => {
    let state = madrasTradeState();
    state = withBlackmail(state, BLUE, "mercantile-connection");
    state = enterOperation(state, BEFORE_MADRAS);
    state = choose(state, { action: "trade" });
    state = choose(state, { action: "roll", spend: 4 });

    expect(state.pendingDecision.step).toBe("companyOperation.connection");
    expect(state.pendingDecision.actor).toBe(BLUE);
    expectSaveRoundTripPreservesPendingDecision(state);

    const played = choose(state, { action: "playConnection" });
    expect(played.log.some((entry) => entry.summary.includes("Reroll with 2 dice"))).toBe(true);
    expect(played.players[BLUE].blackmailCards[0].facedown).toBe(false);
    expect(played.companyOperation.interrupt).toBeUndefined();
  });
});

describe("Commanders and Deploy (pp.21-23)", () => {
  function deployState(): GameState {
    let state = operationGame("hyderabad-deploy");
    state = withSeating(state, [RED, YELLOW, BLUE]);
    state = withCommander(state, "Madras", RED);
    state = withOfficers(state, RED, "Madras", { ready: 1 });
    state = withOfficers(state, YELLOW, "Madras", { ready: 1 });
    state = withOfficers(state, BLUE, "Madras", { ready: 1 });
    state = withRegiments(state, { Madras: { ready: 2, exhausted: 0 } });
    // Madras is Company-controlled with a closed order; Mysore belongs to an empire based in Bombay.
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withOrder(state, "madras-south-4", { closed: true });
    state = withRegion(state, "bombay", { towerLevels: 2, empireFlag: "empire-flag-2", isCapital: true });
    state = withRegion(state, "mysore", { towerLevels: 1, empireFlag: "empire-flag-2", isCapital: false });
    state = withRegion(state, "hyderabad", { towerLevels: 2 });
    return enterOperation(state, BEFORE_MADRAS);
  }

  it("offers Madras, Hyderabad, and Mysore as targets", () => {
    let state = deployState();
    state = choose(state, { action: "commander" });
    state = choose(state, { action: "beginDeploys" });
    const targets = payloads(state)
      .filter((payload) => payload.action === "target")
      .map((payload) => payload.regionId)
      .sort();
    expect(targets).toEqual(["hyderabad", "madras", "mysore"]);
  });

  it("reproduces the Hyderabad example: £15 loot split 6/3/2 with £4 to the bank", () => {
    let state = deployState();
    state = choose(state, { action: "commander" });
    state = choose(state, { action: "beginDeploys" });
    state = choose(state, { action: "target", regionId: "hyderabad" });
    for (const playerId of [RED, YELLOW, BLUE]) state = choose(state, { action: "exhaustOfficer", playerId });
    state = choose(state, { action: "exhaustRegiment" });
    state = choose(state, { action: "exhaustRegiment" });
    expectSaveRoundTripPreservesPendingDecision(state);

    const cashBefore = { red: state.players[RED].cash, yellow: state.players[YELLOW].cash, blue: state.players[BLUE].cash };
    const result = withDice(
      state,
      (seeded) => choose(seeded, { action: "roll" }),
      (next) => next.india.regions.hyderabad.companyControlled && next.log.at(-1)!.summary.includes("No officers lost"),
    );
    // Five dice minus Hyderabad's strength of 2.
    expect(result.log.at(-1)?.summary).toContain("3 dice");
    expect(result.players[RED].cash - cashBefore.red).toBe(6);
    expect(result.players[YELLOW].cash - cashBefore.yellow).toBe(3);
    expect(result.players[BLUE].cash - cashBefore.blue).toBe(2);
    expect(result.log.at(-1)?.details).toEqual(expect.objectContaining({ loot: 15, bank: 4, trophies: 2 }));
    expect(result.players[RED].trophies).toBe(2);

    const hyderabad = result.india.regions.hyderabad;
    expect(hyderabad).toEqual(
      expect.objectContaining({
        towerLevels: 0,
        hasDome: false,
        companyControlled: true,
        associatedPresidency: "Madras",
        lootToken: expect.objectContaining({ face: "control", available: false }),
      }),
    );
    expect(result.company.offices["governor-hyderabad"]).toEqual(expect.objectContaining({ created: true, vacant: true }));
    expect(result.company.vacantOffices).toContain("governor-hyderabad");
    expect(result.company.armies.Madras.officers[RED]).toEqual({ ready: 0, exhausted: 1 });
    expect(result.company.armies.Madras.regiments).toEqual({ ready: 0, exhausted: 2 });
    expectGameInvariants(result);
  });

  it("divides loot round-robin from the Commander (p.23)", () => {
    const state = withSeating(operationGame("loot"), [RED, YELLOW, BLUE]);
    expect(divideLoot(state, RED, 15, { [RED]: 1, [YELLOW]: 1, [BLUE]: 1 }, 2)).toEqual({
      payouts: { [RED]: 6, [YELLOW]: 3, [BLUE]: 2 },
      bank: 4,
    });
  });

  it("costs a catastrophic Commander half the trophies, rounded up, and the Commander piece", () => {
    let state = deployState();
    state = { ...state, players: { ...state.players, [RED]: { ...state.players[RED], trophies: 3 } } };
    state = enterOperation(state, BEFORE_MADRAS);
    state = choose(state, { action: "commander" });
    state = choose(state, { action: "beginDeploys" });
    state = choose(state, { action: "target", regionId: "madras" });
    state = choose(state, { action: "exhaustRegiment" });

    const result = withDice(
      state,
      (seeded) => choose(seeded, { action: "roll" }),
      (next) => next.company.armies.Madras.commander === undefined,
    );
    expect(result.players[RED].trophies).toBe(1);
    expectGameInvariants(result);
  });
});

describe("Governors (p.24)", () => {
  it("reproduces the Administer example: £4 bonus over three successes, two unrest, a half-built ship", () => {
    let state = operationGame("administer");
    state = withOffice(state, "president-madras", RED, { treasury: 0 });
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withOffice(state, "governor-madras", YELLOW);
    state = enterOperation(state, BEFORE_MADRAS);
    state = choose(state, { action: "governor", officeId: "governor-madras" });
    expect(state.pendingDecision.legalCommands[0].label).toContain("4 dice");

    // success, success, failure, success: the example's four rolls.
    const yellowBefore = state.players[YELLOW].cash;
    const result = withDice(
      state,
      (seeded) => {
        let next = seeded;
        const steps: Array<Record<string, unknown>> = [
          { action: "administer" },
          { action: "tax", to: "president" },
          { action: "administer" },
          { action: "tax", to: "president" },
          { action: "administer" },
          { action: "administer" },
          { action: "buildShip" },
        ];
        for (const step of steps) {
          if (!payloads(next).some((payload) => Object.entries(step).every(([key, value]) => payload[key] === value))) {
            return next;
          }
          next = choose(next, step);
        }
        return next;
      },
      (next) =>
        next.india.regions.madras.partialCompanyShip &&
        next.company.offices["president-madras"].treasury === 4 &&
        next.india.regions.madras.unrest === 2,
    );

    expect(result.players[YELLOW].cash - yellowBefore).toBe(4);
    expect(result.companyOperation.current).toEqual(expect.objectContaining({ governorsDone: ["governor-madras"] }));
    expectGameInvariants(result);
  });
});

describe("Superintendent of Trade in China (p.25)", () => {
  it("reproduces the example: £16 to the Company Balance and £4 to the Superintendent", () => {
    let state = operationGame("china");
    state = withOffice(state, "superintendent-of-trade-in-china", BLUE);
    state = withShips(state, "china", 3);
    for (const regionId of ["bengal", "delhi", "hyderabad"]) state = withAssociatedRegion(state, regionId, "Bengal");
    state = enterOperation(state, BEFORE_CHINA);
    expect(state.pendingDecision.legalCommands[0].label).toContain("3 dice, 4 export icons");

    const balance = state.company.balance;
    const blue = state.players[BLUE].cash;
    const result = withDice(
      state,
      (seeded) => choose(seeded, { action: "trade" }),
      (next) => next.company.balance > balance,
    );
    expect(result.company.balance - balance).toBe(16);
    expect(result.players[BLUE].cash - blue).toBe(4);
    expect(result.phase).toBe("bonuses");
  });
});

describe("Military Affairs (p.19)", () => {
  it("reproduces the Assigning Commanders example", () => {
    let state = operationGame("military-affairs");
    state = withOffice(state, "military-affairs", BLUE);
    // Bombay: Yellow commands with an officer; Blue has one officer. No change.
    state = withCommander(state, "Bombay", YELLOW);
    state = withOfficers(state, YELLOW, "Bombay", { ready: 1 });
    state = withOfficers(state, BLUE, "Bombay", { ready: 1 });
    // Madras: no Commander; Blue and Yellow tie.
    state = withOfficers(state, BLUE, "Madras", { ready: 1 });
    state = withOfficers(state, YELLOW, "Madras", { ready: 1 });
    // Bengal: Red's Commander no longer has the most pieces.
    state = withCommander(state, "Bengal", RED);
    state = withOfficers(state, BLUE, "Bengal", { ready: 2 });
    state = enterOperation(state, ["chairman", "director-of-trade", "manager-of-shipping"]);

    state = choose(state, { action: "endTransfers" });
    expect(state.pendingDecision.step).toBe("companyOperation.militaryAffairs.commanders");
    expect(payloads(state)).toEqual([
      { action: "appointCommander", army: "Madras", playerId: BLUE },
      { action: "appointCommander", army: "Madras", playerId: YELLOW },
    ]);
    state = choose(state, { action: "appointCommander", army: "Madras", playerId: BLUE });

    expect(state.company.armies.Bombay.commander).toBe(YELLOW);
    expect(state.company.armies.Madras.commander).toBe(BLUE);
    expect(state.company.armies.Bengal.commander).toBe(BLUE);
    expect(state.company.armies.Bengal.officers[RED]).toEqual({ ready: 1, exhausted: 0 });
    expect(state.companyOperation.actedOffices).toContain("military-affairs");
    expectGameInvariants(state);
  });
});

describe("Manager of Shipping (p.19)", () => {
  it("spends down to £2, fits shipyard ships before buying Company ships, and pays Shipbuilders", () => {
    let state = operationGame("shipping");
    state = withOffice(state, "manager-of-shipping", BLUE, { treasury: 10 });
    state = {
      ...state,
      company: {
        ...state.company,
        ships: [{ id: "ship-yard", kind: "player", shipyardCardId: "shipyard-04", location: "shipyard", fatigued: false }],
      },
    };
    state = withPrestige(state, YELLOW, "shipbuilders");
    state = enterOperation(state, ["chairman", "director-of-trade"]);

    expect(payloads(state)).not.toContainEqual(expect.objectContaining({ action: "buy" }));
    state = choose(state, { action: "fit", shipId: "ship-yard", to: "west-indian" });
    expect(state.company.offices["manager-of-shipping"].treasury).toBe(7);
    state = choose(state, { action: "lease", to: "south-indian" });
    // No ships remain on shipyards, so a Company ship may now be bought.
    state = choose(state, { action: "buy", to: "east-indian" });

    expect(state.company.offices["manager-of-shipping"].treasury).toBe(0);
    expect(state.companyOperation.actedOffices).toContain("manager-of-shipping");
    expect(state.company.ships.map((ship) => [ship.kind, ship.location])).toEqual([
      ["player", "west-indian"],
      ["extra", "south-indian"],
      ["company", "east-indian"],
    ]);
    expect(state.players[YELLOW].cash).toBe(2);
  });
});

describe("Director of Trade (p.18)", () => {
  it("opens trade with China and has the Chairman hire a writer immediately", () => {
    let state = operationGame("special-envoy");
    state = withOffice(state, "chairman", RED);
    state = withOffice(state, "director-of-trade", BLUE, { treasury: 4 });
    state = withWriters(state, YELLOW, "Bengal", 1);
    state = enterOperation(state, ["chairman"]);

    const succeeded = withDice(
      state,
      (seeded) => choose(seeded, { action: "envoy", spend: 4 }),
      (next) => next.pendingDecision.step === "companyOperation.directorOfTrade.envoyEffect",
    );
    // Only orders outside Company-controlled regions may be opened.
    expect(payloads(succeeded)).toContainEqual({ action: "openChina" });
    const opened = choose(succeeded, { action: "openChina" });
    // Hired through the shared immediate-hire flow (p.25), with per-player Nepotism consent.
    expect(opened.pendingDecision.step).toBe("hiring.hireOffice");
    expect(opened.pendingDecision.actor).toBe(RED);
    const hire = opened.pendingDecision.legalCommands.find(
      (command) => (command.payload as { candidateId?: string }).candidateId === YELLOW,
    )!;
    const hired = applyCommandOrThrow(opened, { id: "hire-china", actorId: RED, type: hire.type, payload: hire.payload });
    expect(hired.company.offices["superintendent-of-trade-in-china"]).toEqual(
      expect.objectContaining({ holder: YELLOW, created: true, vacant: false }),
    );
    expect(hired.pendingDecision.step).toBe("companyOperation.directorOfTrade.envoy");
    expectGameInvariants(hired);
  });

  it("allows at most two transfers", () => {
    let state = operationGame("transfers");
    state = withOffice(state, "director-of-trade", BLUE, { treasury: 0 });
    state = withWriters(state, RED, "Bombay", 3);
    state = enterOperation(state, ["chairman"]);
    state = choose(state, { action: "stopEnvoys" });
    state = choose(state, { action: "moveWriter", playerId: RED, from: "Bombay", to: "Madras" });
    state = choose(state, { action: "moveWriter", playerId: RED, from: "Bombay", to: "Bengal" });

    expect(payloads(state)).toEqual([{ action: "finish" }]);
    expect(state.india.presidencies.Bombay.writers[RED]).toBe(1);
  });
});

describe("Governor General (p.26)", () => {
  it("collects £3 per Company region, governs once, and chooses an effect per region", () => {
    let state = operationGame("governor-general");
    state = { ...state, company: { ...state.company, governorGeneralInPlay: true } };
    state = withOffice(state, "governor-general", BLUE, { treasury: 3 });
    state = withAssociatedRegion(state, "bengal", "Bengal");
    state = withAssociatedRegion(state, "delhi", "Bengal");
    state = enterOperation(state, ["chairman"]);

    expect(state.pendingDecision.step).toBe("companyOperation.governorGeneral.begin");
    state = choose(state, { action: "collect" });
    expect(state.company.balance).toBe(6);

    const blue = state.players[BLUE].cash;
    const governed = withDice(
      state,
      (seeded) => choose(seeded, { action: "govern", spend: 3 }),
      (next) =>
        next.pendingDecision.step === "companyOperation.governorGeneral.choices" &&
        Object.values(next.india.regions).every((region) => region.unrest === 0),
    );
    expect(governed.players[BLUE].cash - blue).toBe(2);

    let next = choose(governed, { action: "tax", to: "balance" });
    next = choose(next, { action: "taxUnrest", regionId: "bengal" });
    next = choose(next, { action: "regiment", army: "Bombay" });

    expect(next.company.balance).toBe(8);
    expect(next.india.regions.bengal.unrest).toBe(1);
    // One Govern per turn: only Finish remains.
    expect(payloads(next)).toEqual([{ action: "finish" }]);
  });
});

describe("Presidency order and vacancies (p.20)", () => {
  it("lets the Chairman order a vacant President's Commander, with no Trade", () => {
    let state = operationGame("vacant-president");
    state = withOffice(state, "chairman", BLUE);
    state = withCommander(state, "Bombay", YELLOW);
    state = withShips(state, "west-indian", 2);
    state = enterOperation(state, OFFICES_BEFORE_PRESIDENCIES);

    expect(state.pendingDecision.step).toBe("companyOperation.presidency");
    expect(state.pendingDecision.actor).toBe(BLUE);
    expect(payloads(state)).toEqual([{ action: "commander", presidency: "Bombay" }]);
  });

  it("skips a Presidency with nobody to act", () => {
    const state = enterOperation(operationGame("empty-presidency"), OFFICES_BEFORE_PRESIDENCIES);
    expect(state.pendingDecision.step).toBe("companyOperation.skipOffice");
    expect(payloads(state)).toEqual([{ officeId: "president-bombay" }]);
  });

  it("starts fresh each turn: offices that acted last turn act again", () => {
    let state = operationGame("next-turn");
    state = withOffice(state, "chairman", RED);
    const lastTurn: GameState = {
      ...state,
      phase: "companyOperation",
      companyOperation: { turn: 1, actedOffices: ["chairman", "director-of-trade"] },
    };
    const nextTurn = enterOperation({ ...lastTurn, turn: 2 });
    expect(nextTurn.pendingDecision.step).toBe("companyOperation.chairman");
  });
});

describe("laws and cards during Company Operation", () => {
  it("Board of Control lets the Prime Minister remove an officeholder once per turn", () => {
    let state = operationGame("board-of-control");
    state = withLaw(state, "board-of-control");
    state = { ...state, parliament: { ...state.parliament, primeMinister: YELLOW } };
    state = withOffice(state, "manager-of-shipping", BLUE, { treasury: 0 });
    state = withOffice(state, "military-affairs", RED);
    state = enterOperation(state, ["chairman", "director-of-trade"]);

    state = choose(state, { action: "finish" });
    expect(state.pendingDecision.step).toBe("companyOperation.boardOfControl");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = choose(state, { action: "boardOfControl", remove: true });
    expect(state.company.offices["manager-of-shipping"].vacant).toBe(true);
    expectGameInvariants(state);

    // Military Affairs finishes next; the law was already used this turn.
    state = choose(state, { action: "endTransfers" });
    expect(state.pendingDecision.step).not.toBe("companyOperation.boardOfControl");
  });

  it("Trade Regulations sends the President's bonus to the Company Balance", () => {
    let state = operationGame("trade-regulations");
    state = withLaw(state, "trade-regulations");
    state = withOffice(state, "president-bengal", RED, { treasury: 2 });
    state = withShips(state, "east-indian", 1);
    state = enterOperation(state, [...OFFICES_BEFORE_PRESIDENCIES, "president-bombay", "president-madras"]);
    state = choose(state, { action: "trade" });
    const rolled = withDice(
      state,
      (seeded) => choose(seeded, { action: "roll", spend: 2 }),
      (next) => next.pendingDecision.step === "companyOperation.trade.place",
    );
    const red = rolled.players[RED].cash;
    const balance = rolled.company.balance;
    const traded = choose(rolled, { action: "place", orderId: "bengal-home-6", writer: "token" });

    expect(traded.company.balance - balance).toBe(7);
    expect(traded.players[RED].cash).toBe(red);
  });
});

describe("Bonuses (p.27)", () => {
  it("Inclosure Acts pays £1 per family member on a prize", () => {
    let state = withLaw(operationGame("inclosure"), "inclosure-acts");
    const red = state.players[RED];
    state = {
      ...state,
      phase: "bonuses",
      players: {
        ...state.players,
        [RED]: {
          ...red,
          familyMembers: { ...red.familyMembers, supply: red.familyMembers.supply - 2, prizes: { "prize-4": 2 } },
        },
      },
      pendingDecision: {
        id: "decision-bonuses-test",
        phase: "bonuses",
        step: "bonuses.confirm",
        actor: "system",
        visibility: "public",
        prompt: "Collect Bonuses.",
        legalCommands: [{ type: "bonuses.confirm", label: "Collect Bonuses", payload: {} }],
        canSave: true,
      },
    };

    const result = act(state, "bonuses.confirm", {}, "system");
    expect(result.players[RED].cash - state.players[RED].cash).toBe(2);
  });
});

describe("Refresh helpers for Upkeep (p.36)", () => {
  it("exhausts bought local alliances and returns extra ships", () => {
    let state = operationGame("refresh");
    state = withShips(state, "west-indian", 2, "extra");
    state = withShips(state, "west-indian", 1, "company");
    const army = state.company.armies.Bombay;
    state = {
      ...state,
      company: {
        ...state.company,
        armies: { ...state.company.armies, Bombay: { ...army, localAlliances: { ...army.localAlliances, "alliance-sikhs": "ready" } } },
      },
    };

    const refreshed = returnExtraShips(exhaustActiveLocalAlliances(state));
    expect(refreshed.company.armies.Bombay.localAlliances).toEqual({
      "alliance-rajput-prince": "exhausted",
      "alliance-sikhs": "exhausted",
    });
    expect(refreshed.company.ships.map((ship) => ship.kind)).toEqual(["company"]);
  });
});

describe("random legal play through Company Operation", () => {
  function busyBoard(seed: number): GameState {
    let state = operationGame(`fuzz-${seed}`);
    const players = [RED, BLUE, YELLOW];
    const pick = (offset: number) => players[(seed + offset) % 3];
    state = withOffice(state, "chairman", pick(0));
    state = withOffice(state, "manager-of-shipping", pick(2), { treasury: 4 + (seed % 7) });
    state = withOffice(state, "military-affairs", pick(0));
    state = withOffice(state, "president-bombay", pick(1), { treasury: seed % 9 });
    state = withOffice(state, "president-madras", pick(2), { treasury: 3 + (seed % 5) });
    state = withOffice(state, "president-bengal", pick(0), { treasury: 6 });
    if (seed % 4 === 0) {
      state = { ...state, company: { ...state.company, governorGeneralInPlay: true } };
      state = withOffice(state, "governor-general", pick(1), { treasury: 5 });
      state = withAssociatedRegion(state, "bengal", "Bengal");
      state = withAssociatedRegion(state, "delhi", "Bengal");
    } else {
      state = withOffice(state, "director-of-trade", pick(1), { treasury: 4 });
      state = withAssociatedRegion(state, "madras", "Madras");
      state = withOffice(state, "governor-madras", pick(1));
    }
    for (const playerId of players) {
      for (const presidency of ["Bombay", "Madras", "Bengal"] as const) {
        state = withWriters(state, playerId, presidency, 1);
        state = withOfficers(state, playerId, presidency, { ready: 1 });
      }
    }
    state = withCommander(state, "Bombay", pick(0));
    state = withCommander(state, "Madras", pick(1));
    state = withRegiments(state, {
      Bombay: { ready: 2, exhausted: 0 },
      Madras: { ready: 1, exhausted: 0 },
      Bengal: { ready: 3, exhausted: 0 },
    });
    state = withShips(state, "west-indian", 2);
    state = withShips(state, "south-indian", 3);
    state = withShips(state, "east-indian", 1);
    state = { ...state, company: { ...state.company, balance: 7 + seed } };
    state = { ...state, parliament: { ...state.parliament, primeMinister: pick(2) } };
    const laws = ["board-of-control", "military-oversight", "zamindar-taxes", "writer-privileges", "ship-subsidy", "treasure-reform"];
    state = withLaw(state, laws[seed % laws.length]);
    if (seed % 3 === 0) state = withBlackmail(state, pick(1), "mercantile-connection");
    if (seed % 3 === 1) state = withBlackmail(state, pick(2), "diplomatic-connection");
    return enterOperation(state);
  }

  it("always reaches Bonuses with every listed command accepted and pieces conserved", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      let state = busyBoard(seed);
      let rng = createRngState(`fuzz-choices-${seed}`);
      let steps = 0;
      while (state.phase === "companyOperation") {
        steps += 1;
        expect(steps).toBeLessThan(1500);
        const legal = state.pendingDecision.legalCommands;
        expect(legal.length).toBeGreaterThan(0);
        let index = 0;
        if (legal.length > 1) {
          const roll = rollDie(rng, legal.length, "fuzz");
          rng = roll.rng;
          index = roll.value - 1;
        }
        state = act(state, legal[index].type, legal[index].payload);
        expectGameInvariants(state);
        expect(state.company.balance).toBeGreaterThanOrEqual(0);
        for (const office of Object.values(state.company.offices)) expect(office.treasury).toBeGreaterThanOrEqual(0);
      }
      expect(state.phase).toBe("bonuses");
    }
  });
});
