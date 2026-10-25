import { describe, expect, test } from "vitest";
import {
  companyShareScoring,
  governorOverlays,
  localAlliances,
  londonSeasonDisplay,
  lootTokens,
  policyDial,
  powerAward,
  powerTrack,
  prizes,
  punchboardPieces,
  rulebookComponentCounts,
} from "../../data/board-components";

const allRegions = ["bengal", "bombay", "delhi", "hyderabad", "madras", "maratha", "mysore", "punjab"];

const expectUniqueIds = (records: Array<{ id: string }>) => {
  const ids = records.map((record) => record.id);
  expect(new Set(ids).size).toBe(ids.length);
};

describe("prize boxes", () => {
  test("five prizes with cost, upkeep, VP and window icons from the board", () => {
    expectUniqueIds(prizes);
    expect(prizes).toHaveLength(rulebookComponentCounts.prizes);
    expect(prizes.map((prize) => [prize.cost, prize.upkeep, prize.victoryPoints, prize.windowTaxIcons])).toEqual([
      [2, 0, 0, 0],
      [4, 1, 2, 1],
      [8, 2, 4, 2],
      [14, 3, 8, 3],
      [20, 4, 12, 4],
    ]);
  });

  test("rulebook p.11 example retires to the £4 and £8 prizes", () => {
    expect(prizes.map((prize) => prize.cost)).toEqual(expect.arrayContaining([4, 8]));
  });
});

describe("Power track", () => {
  test("one 2-power box, one 1-power box and two 0-power boxes (rulebook p.9)", () => {
    expect(powerTrack.positions.map((position) => position.power).sort()).toEqual([0, 0, 1, 2]);
  });

  test("each marker starts in the box that prints its name, one marker per box", () => {
    const positions = Object.values(powerTrack.startingPositions);
    expect(new Set(positions).size).toBe(4);
    expect(powerTrack.startingPositions).toEqual({
      social: "top",
      companyShare: "middle",
      shipping: "bottomLeft",
      manufacturing: "bottomRight",
    });
  });

  test("every box except the top has a next-higher box", () => {
    for (const position of powerTrack.positions) {
      if (position.id === "top") {
        expect(position.nextHigher).toBeUndefined();
      } else {
        const higher = powerTrack.positions.find((candidate) => candidate.id === position.nextHigher);
        expect(higher!.power).toBeGreaterThan(position.power);
      }
    }
  });
});

describe("Prime Minister dial", () => {
  test("14 policy spaces in order with valid consequences and targets", () => {
    expect(policyDial.spaces.map((space) => space.index)).toEqual([...Array(14).keys()]);
    for (const space of policyDial.spaces) {
      expect(["tax", "taxAndWindowTax", "bonus", "power"]).toContain(space.consequence);
      expect(["social", "companyShare", "shipping", "manufacturing"]).toContain(space.target);
    }
  });

  test("the arm starts on the space printed with each scenario date", () => {
    for (const [scenario, index] of Object.entries(policyDial.startingSpaceByScenario)) {
      const date = scenario === "long-1710" ? "1710" : scenario;
      expect(policyDial.spaces[index].printedDate).toBe(date);
    }
    expect(policyDial.spaces[0]).toEqual({
      index: 0,
      consequence: "power",
      target: "manufacturing",
      printedDate: "1710",
    });
  });

  test("window tax only appears on social and shipping tax spaces", () => {
    expect(
      policyDial.spaces
        .filter((space) => space.consequence === "taxAndWindowTax")
        .map((space) => space.target),
    ).toEqual(["social", "shipping", "social"]);
  });

  test("the Prime Minister is worth 2 power (rulebook p.9)", () => {
    expect(policyDial.primeMinisterPower).toBe(2);
  });
});

describe("End Game Scoring", () => {
  test("Power Award bands cover final turns 1-8 exactly once", () => {
    expect(powerAward.bands.flatMap((band) => band.finalTurns)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(powerAward.bands.map((band) => [band.firstPlace, band.secondPlace])).toEqual([
      [3, 1],
      [5, 2],
      [8, 4],
    ]);
  });

  test("Company shares are worth ±1 from the Court and up to ±3 with the VP token", () => {
    expect(companyShareScoring.courtPrinted).toEqual({ companySucceeded: 1, companyFailed: -1 });
    expect(companyShareScoring.vpTokenSides).toEqual([
      { companySucceeded: 2, companyFailed: -2 },
      { companySucceeded: 3, companyFailed: -3 },
    ]);
    expect(companyShareScoring.maxAbsoluteValue).toBe(3);
  });
});

describe("loot tokens", () => {
  test("one token per region (rulebook p.2: 8 control/loot tokens)", () => {
    expectUniqueIds(lootTokens);
    expect(lootTokens).toHaveLength(rulebookComponentCounts.lootControlTokens);
    expect(lootTokens.map((token) => token.region).sort()).toEqual(allRegions);
  });

  test("values match the rulebook loot examples", () => {
    const value = (region: string) => lootTokens.find((token) => token.region === region)!.lootValue;
    // p.23: Hyderabad is worth £15 = £4 per tower level x2 + £7 loot token.
    expect(value("hyderabad")).toBe(7);
    // p.22: Mysore would generate £9 = £4 for its one tower level + £5 loot token.
    expect(value("mysore")).toBe(5);
    expect(lootTokens.map((token) => [token.region, token.lootValue])).toEqual([
      ["punjab", 6],
      ["delhi", 8],
      ["bengal", 6],
      ["bombay", 4],
      ["maratha", 3],
      ["mysore", 5],
      ["hyderabad", 7],
      ["madras", 5],
    ]);
  });
});

describe("local alliances", () => {
  test("seven alliances split across the Armies as printed on the board", () => {
    expectUniqueIds(localAlliances);
    expect(localAlliances).toHaveLength(rulebookComponentCounts.localAlliances);
    const byArmy = (army: string) =>
      localAlliances
        .filter((alliance) => alliance.army === army)
        .map((alliance) => alliance.name)
        .sort();
    expect(byArmy("bombay")).toEqual(["Rajput Prince", "Sikhs"]);
    expect(byArmy("madras")).toEqual(["Arcot", "The Nizam"]);
    expect(byArmy("bengal")).toEqual(["Awadh", "Jagat Seths", "Orissa"]);
  });

  test("Jagat Seths has strength 2 (rulebook p.29 example totals 6 with 2 officers and 2 regiments)", () => {
    const jagatSeths = localAlliances.find((alliance) => alliance.name === "Jagat Seths")!;
    expect(jagatSeths).toMatchObject({ strength: 2, cost: 4 });
  });

  test("every alliance has a positive cost and strength", () => {
    for (const alliance of localAlliances) {
      expect(alliance.cost).toBeGreaterThan(0);
      expect(alliance.strength).toBeGreaterThan(0);
    }
  });
});

describe("other components", () => {
  test("eight Governor overlays, one per region", () => {
    expectUniqueIds(governorOverlays);
    expect(governorOverlays.map((overlay) => overlay.region).sort()).toEqual(allRegions);
  });

  test("punchboard piece counts match the rulebook component list", () => {
    expectUniqueIds(punchboardPieces);
    const count = (id: string) => punchboardPieces.find((piece) => piece.id === id)!.count;
    expect(count("regiment")).toBe(rulebookComponentCounts.regiments);
    expect(count("player-ship")).toBe(rulebookComponentCounts.playerShips);
    expect(count("company-extra-ship")).toBe(rulebookComponentCounts.companyExtraShips);
    expect(count("governor-overlay")).toBe(rulebookComponentCounts.governorOverlays);
    expect(count("trophy-passed-law")).toBe(rulebookComponentCounts.trophyPassedLawTokens);
    expect(count("closed-filled-order")).toBe(rulebookComponentCounts.closedFilledOrderTokens);
    expect(count("power-token")).toBe(rulebookComponentCounts.powerTokens);
    expect(count("presidency-divider")).toBe(rulebookComponentCounts.dividers);
    for (const piece of punchboardPieces) {
      expect(piece.label.length).toBeGreaterThan(0);
      expect(piece.faces.length).toBeGreaterThan(0);
      expect(piece.countSource.length).toBeGreaterThan(0);
    }
  });

  test("the London Season Display holds three cards", () => {
    expect(londonSeasonDisplay.slots).toBe(rulebookComponentCounts.londonSeasonDisplaySlots);
    expect(londonSeasonDisplay.slots).toBe(3);
  });
});
