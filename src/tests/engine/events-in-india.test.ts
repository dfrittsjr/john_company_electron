import { describe, expect, it } from "vitest";
import { indiaEventTiles } from "../../data";
import { applyCommand, createNewGame, type GameState } from "../../engine";
import { governorsLostToRegionLossOnTurn } from "../../engine/phases/events-in-india";
import { elephantPosition } from "../../engine/phases/events-in-india/india";
import {
  withAssociatedRegion,
  withCommander,
  withOffice,
  withOfficers,
  withRegiments,
  withWriterOnOrder,
} from "../fixtures/builders";
import {
  eventsInIndiaState,
  ONE_EVENT_ALL_STORMS,
  TWO_EVENTS_WEST_STORM,
  withElephant,
  withOrdersClosed,
  withoutEmpires,
  withRegion,
} from "../fixtures/events-in-india";
import { applyCommandOrThrow, createHotseatGame, expectSaveRoundTripPreservesPendingDecision } from "../fixtures/game";

const RED = "player-red";
const BLUE = "player-blue";
const YELLOW = "player-yellow";

function resolve(state: GameState): GameState {
  return choose(state, 0);
}

function choose(state: GameState, index: number): GameState {
  const legal = state.pendingDecision.legalCommands[index];
  if (!legal) throw new Error(`No legal command ${index} in ${state.pendingDecision.step}.`);
  return applyCommandOrThrow(state, {
    id: `command-${state.log.length}`,
    actorId: state.pendingDecision.actor === "simultaneous" ? RED : state.pendingDecision.actor,
    type: legal.type,
    payload: legal.payload ?? {},
  });
}

function chooseByPayload(state: GameState, payload: unknown): GameState {
  const index = state.pendingDecision.legalCommands.findIndex(
    (legal) => JSON.stringify(legal.payload) === JSON.stringify(payload),
  );
  if (index < 0) throw new Error(`Payload ${JSON.stringify(payload)} is not offered.`);
  return choose(state, index);
}

function order(state: GameState, orderId: string) {
  for (const region of Object.values(state.india.regions)) {
    const found = region.orders.find((candidate) => candidate.id === orderId);
    if (found) return found;
  }
  throw new Error(orderId);
}

function withTrophies(state: GameState, playerId: string, trophies: number): GameState {
  return { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], trophies } } };
}

function logTypes(state: GameState): string[] {
  return state.log.map((entry) => entry.type);
}

describe("event draw stack (setup step 2, p.4)", () => {
  it("shuffles all 20 event tiles into the draw stack at setup", () => {
    const state = createHotseatGame({ seed: "stack-a" });
    const other = createHotseatGame({ seed: "stack-b" });

    expect([...state.eventsInIndia.drawPile].sort()).toEqual(indiaEventTiles.map((tile) => tile.id).sort());
    expect(state.eventsInIndia.discards).toEqual([]);
    expect(state.eventsInIndia.drawPile).not.toEqual(other.eventsInIndia.drawPile);
  });

  it("shuffles the discards into a new stack when the draw stack runs out (assumption)", () => {
    const others = indiaEventTiles.map((tile) => tile.id).filter((id) => id !== "turmoil-bombay");
    let state = eventsInIndiaState({ drawPile: ["turmoil-bombay"] });
    state = { ...state, eventsInIndia: { ...state.eventsInIndia, discards: others } };

    state = resolve(state);

    expect(state.eventsInIndia.discards).toEqual(["turmoil-bombay"]);
    expect([...state.eventsInIndia.drawPile].sort()).toEqual([...others].sort());
    expect(logTypes(state)).toContain("eventsInIndia.stackRefilled");
  });
});

describe("storm die and storms (p.28)", () => {
  it("uses the real die faces and storms only player ships in the stormed zone", () => {
    let state = eventsInIndiaState({
      drawPile: ["turmoil-bombay", "turmoil-delhi", "windfall-madras"],
      // West storm with two events; the fresh ship rolls 3, the fatigued ship rolls 4.
      rolls: [TWO_EVENTS_WEST_STORM, 3, 4],
    });
    state = {
      ...state,
      company: {
        ...state.company,
        ships: [
          { id: "ship-atlas", kind: "player", shipyardCardId: "shipyard-01", location: "west-indian", fatigued: false },
          { id: "ship-eliza", kind: "player", shipyardCardId: "shipyard-05", location: "west-indian", fatigued: true },
          { id: "company-ship-1", kind: "company", location: "west-indian", fatigued: false },
          { id: "ship-ganges", kind: "player", shipyardCardId: "shipyard-07", location: "east-indian", fatigued: false },
        ],
      },
    };

    state = resolve(state);

    const ships = Object.fromEntries(state.company.ships.map((ship) => [ship.id, ship]));
    expect(ships["ship-atlas"]).toEqual(expect.objectContaining({ location: "west-indian", fatigued: true }));
    // 3-4 on a fatigued ship sinks it: back to its shipyard, unfatigued.
    expect(ships["ship-eliza"]).toEqual(expect.objectContaining({ location: "shipyard", fatigued: false }));
    expect(ships["company-ship-1"].fatigued).toBe(false);
    expect(ships["ship-ganges"].fatigued).toBe(false);
    // Two events were resolved.
    expect(state.eventsInIndia.discards).toEqual(["turmoil-bombay", "turmoil-delhi"]);
    expect(state.phase).toBe("parliament");
    expect(state.log.find((entry) => entry.type === "eventsInIndia.stormDieRolled")?.rngRolls).toHaveLength(1);
  });
});

describe("Turmoil, Cascade, and Windfall (pp.28, 31)", () => {
  it("closes the northernmost open order in the pictured region and returns its writer", () => {
    let state = eventsInIndiaState({ drawPile: ["turmoil-delhi", "turmoil-bombay"] });
    state = withWriterOnOrder(state, "bombay-north-3", RED, "Bombay");
    const supply = state.players[RED].familyMembers.supply;

    state = resolve(state);

    expect(order(state, "bombay-north-3")).toEqual(expect.objectContaining({ closed: true, writer: undefined }));
    expect(order(state, "bombay-home-4").closed).toBe(false);
    expect(state.players[RED].familyMembers.supply).toBe(supply + 1);
  });

  it("cascades into connected orders when every order in the region is closed", () => {
    // 1710: Punjab's only order is closed.
    const state = resolve(eventsInIndiaState({ drawPile: ["turmoil-delhi", "turmoil-punjab"] }));

    expect(order(state, "delhi-north-5").closed).toBe(true);
    expect(order(state, "bombay-north-3").closed).toBe(true);
    expect(logTypes(state)).toContain("eventsInIndia.cascade");
  });

  it("closes the northernmost open order in a connected region whose order is already closed, cascading again if none is open", () => {
    let state = eventsInIndiaState({ drawPile: ["turmoil-delhi", "turmoil-punjab"] });
    // Every Delhi order closed, so Punjab's Cascade overflows into Delhi as well.
    state = withOrdersClosed(state, { "delhi-north-5": true });

    state = resolve(state);

    // Delhi's Cascade closes Bombay north and Maratha north; Punjab's connection to Bombay north is
    // then closed, so the northernmost open Bombay order (the home port) closes instead.
    expect(order(state, "bombay-north-3").closed).toBe(true);
    expect(order(state, "maratha-north-4").closed).toBe(true);
    expect(order(state, "bombay-home-4").closed).toBe(true);
    expect(state.log.filter((entry) => entry.type === "eventsInIndia.cascade")).toHaveLength(2);
  });

  it("pays £1 per writer on orders in the pictured region and its neighbours", () => {
    let state = eventsInIndiaState({ drawPile: ["windfall-hyderabad", "turmoil-bombay"] });
    state = withWriterOnOrder(state, "bombay-north-3", RED, "Bombay");
    state = withWriterOnOrder(state, "delhi-north-5", BLUE, "Bengal");
    state = withWriterOnOrder(state, "madras-home-5", YELLOW, "Madras");
    const cash = Object.fromEntries(Object.values(state.players).map((player) => [player.id, player.cash]));

    state = resolve(state);

    expect(state.players[RED].cash).toBe(cash[RED] + 1);
    expect(state.players[BLUE].cash).toBe(cash[BLUE] + 1);
    expect(state.players[YELLOW].cash).toBe(cash[YELLOW]);
  });
});

describe("Leader (p.31)", () => {
  it("adds a tower level to a sovereign pictured region", () => {
    const state = resolve(eventsInIndiaState({ drawPile: ["leader-hyderabad", "crisis-mysore"] }));

    expect(state.india.regions.mysore.towerLevels).toBe(2);
  });

  it("resolves a Rebellion with the Leader modifier in a dominated region", () => {
    // 1710: Maratha (2) is dominated by Delhi (1). 2 + 2 > 1.
    const state = resolve(eventsInIndiaState({ drawPile: ["leader-bengal", "turmoil-maratha"] }));

    expect(state.india.regions.maratha.empireFlag).toBeUndefined();
    expect(order(state, "maratha-north-4").closed).toBe(true);
    expect(order(state, "maratha-east-2").closed).toBe(true);
    // Delhi still dominates Punjab, so it keeps its empire.
    expect(state.india.regions.delhi.isCapital).toBe(true);
  });

  it("lowers the capital's tower when the Rebellion fails", () => {
    let state = eventsInIndiaState({ drawPile: ["leader-bombay", "turmoil-punjab"] });
    state = withRegion(state, "delhi", { towerLevels: 5 });

    state = resolve(state);

    expect(state.india.regions.punjab.empireFlag).toBe(state.india.regions.delhi.empireFlag);
    expect(state.india.regions.delhi.towerLevels).toBe(4);
  });

  it("marches the Elephant when it stood in a Company region that rebelled successfully", () => {
    let state = eventsInIndiaState({ drawPile: ["leader-hyderabad", "turmoil-bombay", "peace-mysore"] });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withElephant(state, "bombay");

    state = resolve(state);

    // Strength 4 against one regiment: Bombay is lost, and the Elephant marches with the triangle.
    expect(state.india.regions.bombay.companyControlled).toBe(false);
    expect(state.india.elephant).toEqual({ regionId: "bombay", facing: "punjab" });
  });
});

describe("Peace (p.31)", () => {
  it("reproduces the Peace example: opens orders across the border and strengthens Mysore", () => {
    let state = eventsInIndiaState({ drawPile: ["peace-madras", "crisis-mysore"] });
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withRegion(state, "madras", { unrest: 1 });
    state = withRegion(state, "mysore", { towerLevels: 2 });
    state = withOrdersClosed(state, { "madras-home-5": true, "madras-south-4": true });
    state = withElephant(state, "mysore", "madras");

    state = resolve(state);

    expect(order(state, "madras-south-4").closed).toBe(false);
    expect(order(state, "madras-home-5").closed).toBe(true);
    expect(state.india.regions.madras.unrest).toBe(1);
    expect(state.india.regions.mysore.towerLevels).toBe(3);
    expect(state.india.regions.madras.towerLevels).toBe(0);
    // "The Elephant Marches to Mysore and will point to Hyderabad across the border marked with the triangle."
    expect(state.india.elephant).toEqual({ regionId: "mysore", facing: "hyderabad" });
  });

  it("clears unrest and opens every order instead when the Elephant is fully within a Company region", () => {
    let state = eventsInIndiaState({ drawPile: ["peace-madras", "crisis-mysore"] });
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withRegion(state, "madras", { unrest: 2 });
    state = withOrdersClosed(state, { "madras-home-5": true, "madras-south-4": true });
    state = withElephant(state, "madras");

    state = resolve(state);

    expect(state.india.regions.madras.unrest).toBe(0);
    expect(order(state, "madras-home-5").closed).toBe(false);
    expect(order(state, "madras-south-4").closed).toBe(false);
    expect(state.india.regions.madras.towerLevels).toBe(0);
  });
});

describe("Crisis and the Elephant's March (pp.30, 32-33)", () => {
  it("reproduces Mysore Invades: a new empire, the shattered empire, and Imperial Ambitions", () => {
    let state = eventsInIndiaState({ drawPile: ["crisis-bombay", "leader-hyderabad"] });
    state = withRegion(state, "hyderabad", { towerLevels: 1, empireFlag: "empire-flag-2", isCapital: true });
    state = withRegion(state, "madras", { towerLevels: 1, empireFlag: "empire-flag-2", isCapital: false });
    state = withRegion(state, "mysore", { towerLevels: 2 });
    state = withElephant(state, "mysore", "hyderabad");

    state = resolve(state);

    const { mysore, hyderabad, madras } = state.india.regions;
    expect(mysore.isCapital).toBe(true);
    expect(hyderabad.empireFlag).toBe(mysore.empireFlag);
    expect(hyderabad.isCapital).toBe(false);
    expect(madras.empireFlag).toBeUndefined();
    // "The Elephant will move to Mysore's square border next."
    expect(state.india.elephant).toEqual({ regionId: "mysore", facing: "madras" });
  });

  it("reproduces the Elephant's March example: Mysore on top, circle into Bombay", () => {
    // 1710: the Elephant has Maratha rebelling against Delhi; Crisis +3 succeeds (2 + 3 > 1).
    const state = resolve(eventsInIndiaState({ drawPile: ["crisis-maratha", "peace-mysore"] }));

    expect(state.india.regions.maratha.empireFlag).toBeUndefined();
    expect(state.india.elephant).toEqual({ regionId: "mysore", facing: "bombay" });
  });

  it("removes a tower from the attacker when an Invasion fails (defender wins ties)", () => {
    let state = eventsInIndiaState({ drawPile: ["crisis-delhi", "peace-mysore"] });
    state = withoutEmpires(state);
    state = withRegion(state, "bombay", { towerLevels: 2 });
    state = withRegion(state, "maratha", { towerLevels: 2 });
    state = withElephant(state, "bombay", "maratha");

    state = resolve(state);

    expect(state.india.regions.bombay.towerLevels).toBe(1);
    expect(state.india.regions.maratha.empireFlag).toBeUndefined();
  });

  it("has no effect when a sovereign region with the Elephant in its centre has no target (assumption)", () => {
    let state = eventsInIndiaState({ drawPile: ["crisis-delhi", "peace-mysore"] });
    state = withElephant(state, "bombay");

    state = resolve(state);

    expect(logTypes(state)).toContain("eventsInIndia.crisisNoTarget");
    // Crisis +0 prints a triangle; Mysore's triangle border faces Hyderabad.
    expect(state.india.elephant).toEqual({ regionId: "mysore", facing: "hyderabad" });
  });
});

describe("Elephant placement (p.30)", () => {
  const base = createHotseatGame({ seed: "placement" });

  it("skips clockwise past regions the acting region already dominates", () => {
    // 1710: Delhi dominates Punjab and Maratha. Clockwise around Delhi: Bengal, Maratha, Bombay, Punjab.
    // Square faces Punjab → wraps to Bengal; circle faces Maratha → next is Bombay; triangle is Bengal.
    expect(elephantPosition(base, "delhi", "square")).toEqual({ regionId: "delhi", facing: "bengal" });
    expect(elephantPosition(base, "delhi", "circle")).toEqual({ regionId: "delhi", facing: "bombay" });
    expect(elephantPosition(base, "delhi", "triangle")).toEqual({ regionId: "delhi", facing: "bengal" });
  });

  it("faces a dominated region's sovereign, and stands fully within a Company region", () => {
    expect(elephantPosition(base, "punjab", "circle")).toEqual({ regionId: "punjab", facing: "delhi" });
    const company = withAssociatedRegion(base, "bombay", "Bombay");
    expect(elephantPosition(company, "bombay", "circle")).toEqual({ regionId: "bombay" });
  });

  it("faces a dominated region's capital even when they share no border (assumption)", () => {
    let state = withoutEmpires(base);
    state = withRegion(state, "bengal", { empireFlag: "empire-flag-1", isCapital: true });
    state = withRegion(state, "mysore", { empireFlag: "empire-flag-1" });

    expect(elephantPosition(state, "mysore", "circle")).toEqual({ regionId: "mysore", facing: "bengal" });
  });

  it("points back at the capital when its empire covers every neighbour (Fully-Formed Empires)", () => {
    let state = withoutEmpires(base);
    state = withRegion(state, "bengal", { empireFlag: "empire-flag-1", isCapital: true });
    state = withRegion(state, "delhi", { empireFlag: "empire-flag-1" });
    state = withRegion(state, "maratha", { empireFlag: "empire-flag-1" });

    // Bengal's circle border is Maratha's.
    expect(elephantPosition(state, "bengal", "circle")).toEqual({ regionId: "maratha", facing: "bengal" });
  });
});

describe("attacks against the Company and Region Loss (pp.29, 32)", () => {
  function regionLossExample(): GameState {
    let state = eventsInIndiaState({
      drawPile: ["crisis-maratha", "peace-mysore"],
      // One event, then Officer Rout: Red (Pink in the example) rolls 1, Yellow rolls 6.
      rolls: [ONE_EVENT_ALL_STORMS, 1, 6],
    });
    state = withRegion(state, "maratha", { empireFlag: undefined, isCapital: false, towerLevels: 2 });
    state = withAssociatedRegion(state, "bengal", "Bengal");
    state = withRegion(state, "bengal", { unrest: 3 });
    state = withCommander(state, "Bengal", RED);
    state = withTrophies(state, RED, 3);
    state = withOfficers(state, RED, "Bengal", { ready: 1 });
    state = withOfficers(state, YELLOW, "Bengal", { ready: 1 });
    state = withRegiments(state, { Bengal: { ready: 2, exhausted: 0 } });
    state = withOffice(state, "governor-bengal", YELLOW, { inHiringQueue: false });
    return withElephant(state, "maratha", "bengal");
  }

  it("reproduces the Region Loss example", () => {
    const before = regionLossExample();
    const redSupply = before.players[RED].familyMembers.supply;
    const yellowSupply = before.players[YELLOW].familyMembers.supply;

    const state = resolve(before);
    const bengal = state.india.regions.bengal;

    // Strength 8 (3 tile + 2 Maratha + 3 unrest) against 4 pieces: the region is lost.
    expect(state.log.find((entry) => entry.type === "eventsInIndia.companyAttacked")?.details).toEqual(
      expect.objectContaining({ attack: expect.objectContaining({ strength: 8 }) }),
    );
    // 1. Tarnish: 3 trophies, lose 2; the Commander returns to supply.
    expect(state.players[RED].trophies).toBe(1);
    expect(state.company.armies.Bengal.commander).toBeUndefined();
    // 2. Officer Rout: Yellow rolled a 6.
    expect(state.company.armies.Bengal.officers[YELLOW]).toEqual({ ready: 0, exhausted: 0 });
    expect(state.company.armies.Bengal.officers[RED]).toEqual({ ready: 0, exhausted: 1 });
    // 3. Governor Elimination.
    expect(state.company.offices["governor-bengal"]).toBeUndefined();
    expect(state.company.unusedOffices).toContain("governor-bengal");
    expect(state.players[RED].familyMembers.supply).toBe(redSupply + 1);
    expect(state.players[YELLOW].familyMembers.supply).toBe(yellowSupply + 2);
    expect(governorsLostToRegionLossOnTurn(state, state.turn)).toEqual([
      { turn: state.turn, regionId: "bengal", officeId: "governor-bengal", holder: YELLOW },
    ]);
    // 4. Restore Local Authority: dome with one level, orders closed, control token back.
    expect(bengal).toEqual(
      expect.objectContaining({ companyControlled: false, hasDome: true, towerLevels: 1, unrest: 0 }),
    );
    expect(bengal.associatedPresidency).toBeUndefined();
    expect(bengal.lootToken).toEqual(expect.objectContaining({ available: false, face: "control" }));
    expect(bengal.orders.every((entry) => entry.closed)).toBe(true);
    // A new empire is born with Maratha as capital.
    expect(state.india.regions.maratha.isCapital).toBe(true);
    expect(bengal.empireFlag).toBe(state.india.regions.maratha.empireFlag);
    // 5. Company Humiliation: first region lost this turn.
    expect(state.company.standing).toBe(before.company.standing - 1);
    expect(state.india.regionsLostThisTurn).toBe(1);
    // Imperial Ambitions: the Elephant goes to Maratha, circle border into Bombay.
    expect(state.india.elephant).toEqual({ regionId: "maratha", facing: "bombay" });
    expect(state.phase).toBe("parliament");
  });

  it("lets the Commander choose pieces, saves mid-defence, and rewards a successful defence", () => {
    let state = eventsInIndiaState({ drawPile: ["crisis-bombay", "peace-mysore"] });
    state = withRegion(state, "maratha", { empireFlag: undefined, isCapital: false, towerLevels: 2 });
    state = withAssociatedRegion(state, "bengal", "Bengal");
    state = withRegion(state, "bengal", { unrest: 1 });
    state = withCommander(state, "Bengal", RED);
    state = withOfficers(state, RED, "Bengal", { ready: 1 });
    state = withOfficers(state, BLUE, "Bengal", { ready: 1 });
    state = withRegiments(state, { Bengal: { ready: 3, exhausted: 0 } });
    state = withElephant(state, "maratha", "bengal");

    state = resolve(state);

    // Strength 2 + 1 + 1 = 4 against 5 available pieces of three kinds: Red chooses.
    expect(state.pendingDecision.step).toBe("eventsInIndia.defend");
    expect(state.pendingDecision.actor).toBe(RED);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = chooseByPayload(state, { piece: "officer", playerId: BLUE });
    state = chooseByPayload(state, { piece: "regiment" });
    state = chooseByPayload(state, { piece: "auto" });

    expect(state.company.armies.Bengal.officers[BLUE]).toEqual({ ready: 0, exhausted: 1 });
    expect(state.company.armies.Bengal.regiments).toEqual({ ready: 0, exhausted: 3 });
    expect(state.company.armies.Bengal.officers[RED]).toEqual({ ready: 1, exhausted: 0 });
    expect(state.india.regions.bengal.unrest).toBe(0);
    expect(state.players[RED].trophies).toBe(1);
    // The failed Invasion lowers Maratha's tower.
    expect(state.india.regions.maratha.towerLevels).toBe(1);
    expect(state.india.regions.bengal.companyControlled).toBe(true);
  });

  it("counts a local alliance bought this turn at its full strength in defence (p.21)", () => {
    let state = eventsInIndiaState({ drawPile: ["crisis-bombay", "peace-mysore"] });
    state = withRegion(state, "maratha", { empireFlag: undefined, isCapital: false, towerLevels: 2 });
    state = withAssociatedRegion(state, "bengal", "Bengal");
    state = withRegion(state, "bengal", { unrest: 1 });
    state = withCommander(state, "Bengal", RED);
    state = withOfficers(state, BLUE, "Bengal", { ready: 1 });
    state = withRegiments(state, { Bengal: { ready: 2, exhausted: 0 } });
    const bengal = state.company.armies.Bengal;
    state = { ...state, company: { ...state.company, armies: { ...state.company.armies, Bengal: { ...bengal, localAlliances: { ...bengal.localAlliances, "alliance-jagat-seths": "ready" } } } } };
    state = withElephant(state, "maratha", "bengal");

    state = resolve(state);
    expect(state.pendingDecision.step).toBe("eventsInIndia.defend");
    state = chooseByPayload(state, { piece: "alliance", allianceId: "alliance-jagat-seths" });
    state = chooseByPayload(state, { piece: "auto" });

    // Strength 4: the alliance counts 2, then two regiments; Blue's officer is not needed.
    expect(state.company.armies.Bengal.localAlliances?.["alliance-jagat-seths"]).toBe("exhausted");
    expect(state.company.armies.Bengal.regiments).toEqual({ ready: 0, exhausted: 2 });
    expect(state.company.armies.Bengal.officers[BLUE]).toEqual({ ready: 1, exhausted: 0 });
    expect(state.india.regions.bengal.companyControlled).toBe(true);
    expect(state.players[RED].trophies).toBe(1);
  });

  it("rejects a choice that was not offered", () => {
    let state = eventsInIndiaState({ drawPile: ["crisis-bombay", "peace-mysore"] });
    state = withRegion(state, "maratha", { empireFlag: undefined, isCapital: false, towerLevels: 2 });
    state = withAssociatedRegion(state, "bengal", "Bengal");
    state = withCommander(state, "Bengal", RED);
    state = withOfficers(state, RED, "Bengal", { ready: 2 });
    state = withRegiments(state, { Bengal: { ready: 3, exhausted: 0 } });
    state = withElephant(state, "maratha", "bengal");
    state = resolve(state);

    const result = applyCommand(state, {
      id: "command-bad",
      gameId: state.gameId,
      actorId: RED,
      decisionId: state.pendingDecision.id,
      type: "eventsInIndia.defend",
      payload: { piece: "officer", playerId: YELLOW },
      clientTimestamp: "2026-06-13T12:00:00.000Z",
    });

    expect(result.ok).toBe(false);
  });

  it("then resolves a Rebellion in every other region with unrest, Commanders choosing the order", () => {
    // Primary: Leader +2 in Company-held Madras (no unrest, no Army): Madras is lost.
    let state = eventsInIndiaState({ drawPile: ["leader-bengal", "windfall-madras", "peace-mysore"], rolls: [ONE_EVENT_ALL_STORMS] });
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withRegiments(state, { Madras: { ready: 0, exhausted: 0 }, Bombay: { ready: 1, exhausted: 0 } });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withAssociatedRegion(state, "punjab", "Bombay");
    state = withRegion(state, "bombay", { unrest: 1 });
    state = withRegion(state, "punjab", { unrest: 2 });
    state = withCommander(state, "Bombay", RED);
    state = withOfficers(state, RED, "Bombay", { ready: 1 });
    state = withOfficers(state, BLUE, "Bombay", { ready: 1 });

    state = resolve(state);

    expect(state.india.regions.madras.companyControlled).toBe(false);
    expect(state.pendingDecision.step).toBe("eventsInIndia.chooseAttack");
    expect(state.pendingDecision.actor).toBe(RED);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = chooseByPayload(state, { regionId: "punjab" });
    // Punjab: strength 2 against 3 pieces of three kinds.
    expect(state.pendingDecision.step).toBe("eventsInIndia.defend");
    state = chooseByPayload(state, { piece: "auto" });

    // Bombay: strength 1 against the one piece left, exhausted automatically.
    expect(state.india.regions.punjab.unrest).toBe(0);
    expect(state.india.regions.bombay.unrest).toBe(0);
    expect(state.india.regions.bombay.companyControlled).toBe(true);
    expect(state.players[RED].trophies).toBe(2);
    expect(state.phase).toBe("parliament");
  });

  it("treats an attack of strength 0 or less as failed: unrest clears and the Commander takes a trophy (assumption)", () => {
    // Crisis −1 with the Elephant fully within Company-held Bombay and no unrest: strength −1.
    let state = eventsInIndiaState({ drawPile: ["crisis-punjab", "peace-mysore"] });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withCommander(state, "Bombay", RED);
    state = withRegiments(state, { Bombay: { ready: 2, exhausted: 0 } });
    state = withElephant(state, "bombay");

    state = resolve(state);

    expect(state.india.regions.bombay.companyControlled).toBe(true);
    expect(state.company.armies.Bombay.regiments).toEqual({ ready: 2, exhausted: 0 });
    expect(state.players[RED].trophies).toBe(1);
  });

  it("lets Military Affairs defend for a vacant Commander without gaining trophies", () => {
    let state = eventsInIndiaState({ drawPile: ["leader-bengal", "turmoil-bombay", "peace-mysore"] });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withRegiments(state, { Bombay: { ready: 2, exhausted: 0 } });
    state = withOfficers(state, BLUE, "Bombay", { ready: 1 });
    state = withOffice(state, "military-affairs", YELLOW, { inHiringQueue: false });

    state = resolve(state);

    expect(state.pendingDecision.step).toBe("eventsInIndia.defend");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = chooseByPayload(state, { piece: "auto" });

    expect(state.india.regions.bombay.companyControlled).toBe(true);
    expect(Object.values(state.players).map((player) => player.trophies)).toEqual([0, 0, 0]);
  });

  it("doubles unrest under Sepoy Recruitment (ruling in docs/phase-build-guide.md)", () => {
    let state = eventsInIndiaState({ drawPile: ["leader-bengal", "turmoil-bombay", "peace-mysore"] });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withRegion(state, "bombay", { unrest: 1 });
    state = withRegiments(state, { Bombay: { ready: 3, exhausted: 0 } });
    state = {
      ...state,
      parliament: { ...state.parliament, passedLaws: [{ id: "law-sepoy", lawId: "sepoy-recruitment" }] },
    };

    state = resolve(state);

    // Leader +2 plus one unrest counted twice: 4 against 3 regiments.
    expect(state.log.find((entry) => entry.type === "eventsInIndia.companyAttacked")?.details).toEqual(
      expect.objectContaining({ attack: expect.objectContaining({ strength: 4 }) }),
    );
    expect(state.india.regions.bombay.companyControlled).toBe(false);
  });

  it("lowers Standing 1, then 2, for the first and second region lost in a turn", () => {
    let state = eventsInIndiaState({ drawPile: ["leader-bengal", "turmoil-bombay", "peace-mysore"] });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withAssociatedRegion(state, "punjab", "Bombay");
    state = withRegion(state, "punjab", { unrest: 1 });
    state = withRegiments(state, { Bombay: { ready: 0, exhausted: 0 } });
    const standing = state.company.standing;

    state = resolve(state);

    expect(state.india.regionsLostThisTurn).toBe(2);
    expect(state.company.standing).toBe(standing - 3);
  });

  it("finishes the phase after the Company fails, then goes to Final Scoring (p.29)", () => {
    let state = eventsInIndiaState({
      drawPile: ["leader-bengal", "turmoil-bombay", "turmoil-delhi", "peace-mysore"],
      rolls: [TWO_EVENTS_WEST_STORM],
    });
    state = withAssociatedRegion(state, "bombay", "Bombay");
    state = withRegiments(state, { Bombay: { ready: 0, exhausted: 0 } });
    state = { ...state, company: { ...state.company, standing: 1 } };

    state = resolve(state);

    expect(state.company.failed).toBe(true);
    // The second event still resolves.
    expect(state.eventsInIndia.discards).toEqual(["leader-bengal", "turmoil-bombay"]);
    expect(state.phase).toBe("finalScoring");
    expect(state.pendingDecision.step).toBe("finalScoring.confirm");
  });

  it("skips Governor Elimination while the Governor General is in play (p.26)", () => {
    let state = regionLossExample();
    state = { ...state, company: { ...state.company, governorGeneralInPlay: true } };

    state = resolve(state);

    expect(state.company.offices["governor-bengal"]).toBeDefined();
    expect(state.eventsInIndia.governorsLostToRegionLoss).toEqual([]);
  });
});

describe("Foreign Invasion (p.33)", () => {
  it("invades the region linked to the stormed sea zone and halves the invader's strength", () => {
    // One event; Foreign Invasion's storm die shows the West storm (Bombay); strength 6 beats Bombay's 1.
    const state = resolve(
      eventsInIndiaState({ drawPile: ["foreign-invasion-maratha", "peace-mysore"], rolls: [ONE_EVENT_ALL_STORMS, 6, 6] }),
    );

    expect(state.india.regions.bombay.towerLevels).toBe(3);
    expect(state.india.regions.bombay.orders.every((entry) => entry.closed)).toBe(true);
  });

  it("attacks the Company and redirects the Elephant standing in the invaded region", () => {
    let state = eventsInIndiaState({
      drawPile: ["foreign-invasion-maratha", "peace-mysore"],
      // South storm (Madras); strength 4 against no Army.
      rolls: [ONE_EVENT_ALL_STORMS, 5, 4],
    });
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withRegiments(state, { Madras: { ready: 0, exhausted: 0 } });
    state = withElephant(state, "madras");

    state = resolve(state);

    expect(state.india.regions.madras.companyControlled).toBe(false);
    expect(state.india.regions.madras.towerLevels).toBe(2);
    // Redirect with the circle: Mysore on top, its circle border faces Bombay.
    expect(state.india.elephant).toEqual({ regionId: "mysore", facing: "bombay" });
  });
});

describe("Shuffle (p.31)", () => {
  it("marches the Elephant, shuffles the tile back in, and puts the shuffled discards on top", () => {
    let state = eventsInIndiaState({ drawPile: ["shuffle-madras", "peace-mysore", "turmoil-delhi", "turmoil-punjab"] });
    state = { ...state, eventsInIndia: { ...state.eventsInIndia, discards: ["crisis-delhi", "crisis-punjab"] } };

    state = resolve(state);

    expect(state.india.elephant).toEqual({ regionId: "mysore", facing: "bombay" });
    expect(state.eventsInIndia.discards).toEqual([]);
    expect([...state.eventsInIndia.drawPile.slice(0, 2)].sort()).toEqual(["crisis-delhi", "crisis-punjab"]);
    expect([...state.eventsInIndia.drawPile.slice(2)].sort()).toEqual(
      ["peace-mysore", "shuffle-madras", "turmoil-delhi", "turmoil-punjab"].sort(),
    );
  });
});

describe("Envoy to the Mughals (blackmail #7)", () => {
  function withEnvoy(state: GameState, playerId: string): GameState {
    const card = { id: "blackmail-envoy", cardId: "envoy-to-the-mughals", facedown: true };
    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...state.players[playerId], blackmailCards: [card] },
      },
      hidden: { ...state.hidden, privateCards: { ...state.hidden.privateCards, [playerId]: [card] } },
    };
  }

  it("offers the card to its holder before the storm die, moves the Elephant, and pays the highest open order", () => {
    let state = withEnvoy(eventsInIndiaState({ drawPile: ["turmoil-delhi", "turmoil-punjab"] }), BLUE);
    const cash = state.players[BLUE].cash;

    state = resolve(state);

    expect(state.pendingDecision.step).toBe("eventsInIndia.envoyToTheMughals");
    expect(state.pendingDecision.actor).toBe(BLUE);
    expect(state.log.some((entry) => entry.type === "eventsInIndia.stormDieRolled")).toBe(false);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = chooseByPayload(state, { play: true, regionId: "bengal", facing: "delhi" });

    expect(state.players[BLUE].blackmailCards[0].facedown).toBe(false);
    expect(state.players[BLUE].cash).toBe(cash + 6);
    expect(state.phase).toBe("parliament");
  });

  it("asks once and moves on when the holder declines", () => {
    let state = withEnvoy(eventsInIndiaState({ drawPile: ["turmoil-delhi", "turmoil-punjab"] }), BLUE);

    state = resolve(state);
    state = chooseByPayload(state, { play: false });

    expect(state.players[BLUE].blackmailCards[0].facedown).toBe(true);
    expect(state.phase).toBe("parliament");
  });

  it("is not offered to anyone without the card", () => {
    const state = resolve(eventsInIndiaState({ drawPile: ["turmoil-delhi", "turmoil-punjab"] }));

    expect(state.phase).toBe("parliament");
  });
});

describe("a full 1710 phase from setup", () => {
  it("resolves from a real new game without a stuck decision", () => {
    let state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "events-full",
      gameId: "game-events-full",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: RED, name: "Red", color: "red" },
        { id: BLUE, name: "Blue", color: "blue" },
        { id: YELLOW, name: "Yellow", color: "yellow" },
      ],
    });
    state = {
      ...state,
      phase: "eventsInIndia",
      pendingDecision: {
        id: "decision-full",
        phase: "eventsInIndia",
        step: "eventsInIndia.confirm",
        actor: "system",
        visibility: "public",
        prompt: "Confirm Events in India.",
        legalCommands: [{ type: "eventsInIndia.confirm", label: "Resolve", payload: {} }],
        canSave: true,
      },
    };

    state = resolve(state);

    expect(state.phase).toBe("parliament");
    expect(state.eventsInIndia.progress).toBeUndefined();
    expect(state.eventsInIndia.drawPile.length + state.eventsInIndia.discards.length).toBe(20);
  });
});
