import { describe, expect, test } from "vitest";
import {
  FOREIGN_INVASION_MARCH_SHAPE,
  indiaEventTiles,
  stormDieFaces,
  stormSeaZoneRegion,
  type IndiaEventTile,
} from "../../data/india-events";

const SHAPE_GLYPH = { circle: "●", triangle: "▲", square: "■" } as const;

// How the Pocket Guide to India card (Bridge, Fronts p.10) lists a tile.
const pocketGuideEntry = (tile: IndiaEventTile): string => {
  const name = {
    turmoil: "Turmoil",
    windfall: "Windfall",
    shuffle: "Shuffle",
    leader: "Leader",
    peace: "Peace",
    crisis: "Crisis",
    foreignInvasion: "Foreign Invasion",
  }[tile.kind];
  const modifier =
    tile.modifier === undefined ? "" : ` ${tile.modifier >= 0 ? "+" : ""}${tile.modifier}`;
  const shape = tile.marchShape ? ` ${SHAPE_GLYPH[tile.marchShape]}` : "";
  return `${name}${modifier}${shape}`;
};

const countBy = <T extends string>(values: T[]): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});

describe("India event tiles", () => {
  test("there are 20 tiles with unique ids and no open uncertainties", () => {
    expect(indiaEventTiles).toHaveLength(20);
    expect(new Set(indiaEventTiles.map((tile) => tile.id)).size).toBe(20);
    expect(indiaEventTiles.flatMap((tile) => tile.uncertain)).toEqual([]);
  });

  test("event mix and painted regions", () => {
    expect(countBy(indiaEventTiles.map((tile) => tile.kind))).toEqual({
      crisis: 6,
      turmoil: 4,
      leader: 4,
      windfall: 2,
      peace: 2,
      shuffle: 1,
      foreignInvasion: 1,
    });
    expect(countBy(indiaEventTiles.map((tile) => tile.region))).toEqual({
      punjab: 3,
      delhi: 2,
      bombay: 3,
      maratha: 3,
      bengal: 2,
      hyderabad: 2,
      mysore: 2,
      madras: 3,
    });
  });

  test("each region's tiles match the Pocket Guide to India", () => {
    const byRegion: Record<string, string[]> = {};
    for (const tile of indiaEventTiles) {
      (byRegion[tile.region] ??= []).push(pocketGuideEntry(tile));
    }
    for (const entries of Object.values(byRegion)) {
      entries.sort();
    }

    expect(byRegion).toEqual({
      punjab: ["Crisis -1 ●", "Leader +3 ●", "Turmoil"],
      delhi: ["Crisis +0 ▲", "Turmoil"],
      bengal: ["Crisis +1 ▲", "Leader +2 ▲"],
      bombay: ["Crisis +1 ■", "Leader +2 ■", "Turmoil"],
      maratha: ["Crisis +3 ●", "Foreign Invasion", "Turmoil"],
      hyderabad: ["Leader +4 ▲", "Windfall"],
      mysore: ["Crisis +2 ■", "Peace ■"],
      madras: ["Peace ▲", "Shuffle ●", "Windfall"],
    });
  });

  test("shapes appear exactly where the tiles print them", () => {
    for (const tile of indiaEventTiles) {
      const printsShape = ["crisis", "leader", "peace", "shuffle"].includes(tile.kind);
      expect(tile.marchShape !== undefined, tile.id).toBe(printsShape);
    }
    expect(FOREIGN_INVASION_MARCH_SHAPE).toBe("circle");
  });

  test("spot checks against the printed tiles", () => {
    const byId = new Map(indiaEventTiles.map((tile) => [tile.id, tile]));

    expect(byId.get("crisis-maratha")).toMatchObject({ modifier: 3, marchShape: "circle" });
    expect(byId.get("crisis-punjab")).toMatchObject({ modifier: -1, marchShape: "circle" });
    expect(byId.get("leader-hyderabad")).toMatchObject({ modifier: 4, marchShape: "triangle" });
    expect(byId.get("windfall-madras")).toMatchObject({ windfallPerWriter: 1 });
    expect(byId.get("foreign-invasion-maratha")?.marchShape).toBeUndefined();
    expect(byId.get("crisis-delhi")?.eventSideSource).toContain("Backs).pdf p.1 row 1 column 1");
    expect(byId.get("crisis-delhi")?.regionSideSource).toContain("Fronts).pdf p.1 row 1 column 2");
  });
});

describe("storm die", () => {
  test("six faces from the Wood Manifest template", () => {
    expect(stormDieFaces).toHaveLength(6);
    expect(
      stormDieFaces.map((face) => [face.events, face.storms]).sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    ).toEqual(
      [
        [4, []],
        [4, []],
        [2, ["east-indian"]],
        [1, ["west-indian", "south-indian", "east-indian"]],
        [3, ["south-indian"]],
        [2, ["west-indian"]],
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });

  test("storms link to the Presidency home regions for Foreign Invasion", () => {
    expect(stormSeaZoneRegion).toEqual({
      "west-indian": "bombay",
      "south-indian": "madras",
      "east-indian": "bengal",
    });
  });
});
