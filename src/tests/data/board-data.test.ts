import { describe, expect, test } from "vitest";
import {
  MAX_COMPANY_DEBT,
  companyTracks,
  expectationsForStanding,
  mapData,
  scenarios,
  validateCompanyTracksData,
  validateScenarioData,
} from "../../data";

// Expected values are read off board_image-1.png and the scenario cards in printnplay/Cards.
const orderValuesByRegion = (): Record<string, Array<[number, number]>> =>
  Object.fromEntries(
    mapData.regions.map((region) => [
      region.id,
      region.orders.map((order) => [order.value, order.deregulationValue] as [number, number]),
    ]),
  );

const connectionPairs = (): string[] => {
  const pairs = new Set<string>();
  for (const order of mapData.regions.flatMap((region) => region.orders)) {
    for (const connected of order.connectedOrderIds) {
      pairs.add([order.id, connected].sort().join(" <-> "));
    }
  }
  return [...pairs].sort();
};

describe("India map matches the printed board", () => {
  test("orders and their deregulation values per region", () => {
    expect(orderValuesByRegion()).toEqual({
      punjab: [[7, 3]],
      delhi: [
        [5, 2],
        [3, 1],
        [5, 2],
      ],
      bombay: [
        [3, 1],
        [3, 1],
        [4, 2],
      ],
      maratha: [
        [4, 2],
        [3, 1],
        [2, 1],
      ],
      bengal: [
        [5, 2],
        [6, 3],
      ],
      hyderabad: [[7, 3]],
      mysore: [
        [3, 1],
        [6, 3],
      ],
      madras: [
        [5, 2],
        [4, 2],
      ],
    });
  });

  test("order connections follow the dotted lines", () => {
    expect(connectionPairs()).toEqual(
      [
        "punjab-7 <-> delhi-north-5",
        "punjab-7 <-> bombay-north-3",
        "delhi-north-5 <-> delhi-west-3",
        "delhi-west-3 <-> bombay-north-3",
        "delhi-west-3 <-> delhi-east-5",
        "delhi-east-5 <-> maratha-north-4",
        "maratha-north-4 <-> bengal-north-5",
        "bengal-north-5 <-> bengal-home-6",
        "bengal-north-5 <-> maratha-east-2",
        "bombay-north-3 <-> bombay-home-4",
        "bombay-east-3 <-> bombay-home-4",
        "bombay-east-3 <-> maratha-west-3",
        "maratha-west-3 <-> maratha-east-2",
        "maratha-east-2 <-> hyderabad-7",
        "bombay-home-4 <-> mysore-north-3",
        "mysore-north-3 <-> mysore-south-6",
        "mysore-south-6 <-> hyderabad-7",
        "hyderabad-7 <-> madras-home-5",
        "mysore-south-6 <-> madras-south-4",
        "madras-south-4 <-> madras-home-5",
      ]
        .map((pair) => pair.split(" <-> ").sort().join(" <-> "))
        .sort(),
    );
  });

  test("export icons and home regions", () => {
    expect(
      Object.fromEntries(mapData.regions.map((region) => [region.id, region.exportIcons])),
    ).toEqual({
      punjab: 0,
      delhi: 1,
      bombay: 0,
      maratha: 0,
      bengal: 2,
      hyderabad: 1,
      mysore: 0,
      madras: 1,
    });
    expect(
      mapData.regions
        .filter((region) => region.homePresidency)
        .map((region) => [region.id, region.homePresidency]),
    ).toEqual([
      ["bombay", "bombay"],
      ["bengal", "bengal"],
      ["madras", "madras"],
    ]);
  });
});

describe("Elephant border shapes", () => {
  test("each region's circle, triangle, and square face the printed neighbour", () => {
    expect(Object.fromEntries(mapData.regions.map((region) => [region.id, region.borderShapes]))).toEqual({
      punjab: { circle: "bombay", triangle: "bombay", square: "delhi" },
      delhi: { circle: "maratha", triangle: "bengal", square: "punjab" },
      bombay: { circle: "maratha", triangle: "punjab", square: "hyderabad" },
      maratha: { circle: "bombay", triangle: "bengal", square: "delhi" },
      bengal: { circle: "maratha", triangle: "delhi", square: "delhi" },
      hyderabad: { circle: "madras", triangle: "maratha", square: "bombay" },
      mysore: { circle: "bombay", triangle: "hyderabad", square: "madras" },
      madras: { circle: "hyderabad", triangle: "mysore", square: "mysore" },
    });
  });

  test("matches the rulebook's Elephant examples (p.30, p.31)", () => {
    const mysore = mapData.regions.find((region) => region.id === "mysore")!;
    expect(mysore.borderShapes.circle).toBe("bombay");
    expect(mysore.borderShapes.triangle).toBe("hyderabad");
  });
});

describe("Company tracks", () => {
  test("Standing track has expectations £4-£16 after the failure space", () => {
    expect(validateCompanyTracksData().issues).toEqual([]);
    expect(companyTracks.standing.map((space) => space.expectations)).toEqual([
      null, 4, 6, 8, 10, 12, 14, 16,
    ]);
    expect(expectationsForStanding(4)).toBe(10);
    expect(companyTracks.standing.find((space) => space.deregulationReset)?.label).toBe("£10");
  });

  test("Debt track runs 0-8 with lined spaces 5-8", () => {
    expect(MAX_COMPANY_DEBT).toBe(8);
    expect(companyTracks.debt.filter((space) => space.lined).map((space) => space.value)).toEqual([
      5, 6, 7, 8,
    ]);
  });
});

describe("scenario setup", () => {
  test("scenario data references valid track spaces, regions, and orders", () => {
    expect(validateScenarioData().issues).toEqual([]);
  });

  test("start and final turns match the Turn track", () => {
    expect(
      Object.fromEntries(
        scenarios.map((scenario) => [scenario.id, [scenario.startTurn, scenario.finalTurn]]),
      ),
    ).toEqual({
      "1710": [1, 5],
      "1758": [3, 7],
      "1813": [5, 8],
      "long-1710": [1, 8],
    });
  });

  test("1710 starts above £10 expectations with the Situation in India card's map", () => {
    const setup = scenarios.find((scenario) => scenario.id === "1710")!.setup;

    expect(setup.companyTracks).toEqual({ standingSpace: 4, debt: 0, officeTreasury: 3 });
    expect(setup.mapSetup?.empires).toEqual([{ capital: "delhi", dominated: ["punjab", "maratha"] }]);
    expect(setup.mapSetup?.elephant).toEqual({ region: "maratha", facing: "delhi" });
    expect(
      Object.values(setup.mapSetup!.regions).flatMap((region) => region.closedOrderIds).sort(),
    ).toEqual([
      "bombay-east-3",
      "delhi-east-5",
      "delhi-west-3",
      "hyderabad-7",
      "madras-south-4",
      "maratha-west-3",
      "punjab-7",
    ]);
  });
});
