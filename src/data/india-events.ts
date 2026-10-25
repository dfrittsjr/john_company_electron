// Events in India: the 20 ganjifa event tiles and the storm die.
//
// Each tile has two sides. The print-and-play kit calls the painted region side "Fronts" and
// the event side "Backs"; in play the painted side is the one showing on top of the draw stack
// (rulebook p.28: "the location of the event often depends on the back of the top tile").
// Here `region` is the painted side and `kind`/`modifier`/`marchShape` describe the event side.
//
// Pairing: the backs sheet is printed mirrored left-to-right, so the event tile at row r,
// column c pairs with the painted tile at row r, column 3 - c on the same page. Every event tile
// also carries a small thumbnail of its painted pair (top right). For all 20 tiles the mirrored
// position and the thumbnail agree, and the per-region totals match the "Pocket Guide to India"
// card (Bridge, Fronts p.10).

export type IndiaEventRegionId =
  | "punjab"
  | "delhi"
  | "bombay"
  | "maratha"
  | "bengal"
  | "hyderabad"
  | "mysore"
  | "madras";

export type ElephantShape = "circle" | "triangle" | "square";

export type IndiaEventKind =
  | "turmoil"
  | "windfall"
  | "shuffle"
  | "leader"
  | "peace"
  | "crisis"
  | "foreignInvasion";

export type IndiaEventTile = {
  id: string;
  kind: IndiaEventKind;
  /** Text as printed on the event side. */
  label: string;
  /**
   * Crisis: the strength modifier in the burst (may be negative).
   * Leader: the Rebellion modifier used when the region is dominated.
   */
  modifier?: number;
  /** Windfall: £ paid per writer on an order here and in adjacent regions. */
  windfallPerWriter?: number;
  /**
   * Shape printed on the event side for the Elephant's March (rulebook p.30).
   * Crisis, Peace and Shuffle print it beside "Top of Stack / Invade or Rebel?" inside a red
   * redirect arrow; Leader prints it beside the Rebellion burst. Turmoil, Windfall and Foreign
   * Invasion print none (see FOREIGN_INVASION_MARCH_SHAPE).
   */
  marchShape?: ElephantShape;
  /** Region painted on the other side of the tile. */
  region: IndiaEventRegionId;
  eventSideSource: string;
  regionSideSource: string;
  uncertain: string[];
  notes: string[];
};

export type SeaZoneId = "west-indian" | "south-indian" | "east-indian";

export type StormDieFace = {
  id: string;
  /** Number printed on the face: how many event tiles to resolve. */
  events: number;
  /** Sea zones whose ships check for storms. */
  storms: SeaZoneId[];
  label: string;
  source: string;
};

const EVENT_PDF = "printnplay/Punchboard/John Company Ganjifa Tiles (Backs).pdf";
const REGION_PDF = "printnplay/Punchboard/John Company Ganjifa Tiles (Fronts).pdf";

const sources = (page: number, row: number, column: 1 | 2) => ({
  eventSideSource: `${EVENT_PDF} p.${page} row ${row} column ${column}`,
  regionSideSource: `${REGION_PDF} p.${page} row ${row} column ${3 - column}`,
});

const tile = (
  kind: IndiaEventKind,
  region: IndiaEventRegionId,
  label: string,
  position: [page: number, row: number, column: 1 | 2],
  details: Pick<IndiaEventTile, "modifier" | "windfallPerWriter" | "marchShape"> = {},
  notes: string[] = [],
): IndiaEventTile => ({
  id: `${kind === "foreignInvasion" ? "foreign-invasion" : kind}-${region}`,
  kind,
  label,
  ...details,
  region,
  ...sources(...position),
  uncertain: [],
  notes,
});

const TURMOIL =
  "Turmoil: Close northernmost open order. If all are closed, perform Cascade (close orders in connected regions).";
const WINDFALL = "Windfall: Gain £1 for writers here and in adjacent regions.";
const PEACE =
  "Peace: If the Elephant is fully in a Company-controlled region, clear unrest and open all orders instead.";
const leaderLabel = (modifier: number) =>
  `Leader: Strengthen if sovereign / Rebellion +${modifier} if dominated.`;
const crisisLabel = (modifier: number) =>
  `Resolve Crisis ${modifier >= 0 ? "+" : ""}${modifier}`;

export const indiaEventTiles: IndiaEventTile[] = [
  // Event sheet p.1
  tile("crisis", "delhi", crisisLabel(0), [1, 1, 1], { modifier: 0, marchShape: "triangle" }),
  tile("crisis", "punjab", crisisLabel(-1), [1, 1, 2], { modifier: -1, marchShape: "circle" }),
  tile("crisis", "maratha", crisisLabel(3), [1, 2, 1], { modifier: 3, marchShape: "circle" }),
  tile("crisis", "bombay", crisisLabel(1), [1, 2, 2], { modifier: 1, marchShape: "square" }),
  tile("windfall", "hyderabad", WINDFALL, [1, 3, 1], { windfallPerWriter: 1 }),
  tile("crisis", "bengal", crisisLabel(1), [1, 3, 2], { modifier: 1, marchShape: "triangle" }),
  // Event sheet p.2
  tile("crisis", "mysore", crisisLabel(2), [2, 1, 1], { modifier: 2, marchShape: "square" }),
  tile("windfall", "madras", WINDFALL, [2, 1, 2], { windfallPerWriter: 1 }),
  tile("turmoil", "delhi", TURMOIL, [2, 2, 1]),
  tile("turmoil", "punjab", TURMOIL, [2, 2, 2]),
  tile("turmoil", "maratha", TURMOIL, [2, 3, 1]),
  tile("turmoil", "bombay", TURMOIL, [2, 3, 2]),
  // Event sheet p.3
  tile("leader", "hyderabad", leaderLabel(4), [3, 1, 1], { modifier: 4, marchShape: "triangle" }),
  tile("leader", "bengal", leaderLabel(2), [3, 1, 2], { modifier: 2, marchShape: "triangle" }),
  tile("peace", "mysore", PEACE, [3, 2, 1], { marchShape: "square" }),
  tile("peace", "madras", PEACE, [3, 2, 2], { marchShape: "triangle" }),
  tile(
    "shuffle",
    "madras",
    "Shuffle: Shuffle this tile in with the deck. Then shuffle the discards and place them on top.",
    [3, 3, 1],
    { marchShape: "circle" },
  ),
  tile(
    "foreignInvasion",
    "maratha",
    "Foreign Invasion: Roll storm die and resolve an Invasion in each region linked to a storm. (If none, use top event card.) For each, roll a die to determine strength. If this region falls, close every order there and set its strength to half of the die roll (round down).",
    [3, 3, 2],
    {},
    ["No shape is printed on this tile; the rulebook (p.33) supplies the circle for its Elephant Redirect."],
  ),
  // Event sheet p.4 (only the first row is used)
  tile("leader", "punjab", leaderLabel(3), [4, 1, 1], { modifier: 3, marchShape: "circle" }),
  tile("leader", "bombay", leaderLabel(2), [4, 1, 2], { modifier: 2, marchShape: "square" }),
];

/** Rulebook p.33: Foreign Invasion's Elephant Redirect uses the circle. */
export const FOREIGN_INVASION_MARCH_SHAPE: ElephantShape = "circle";

/** Rulebook p.33: the region linked to each sea zone's storm (used by Foreign Invasion). */
export const stormSeaZoneRegion: Record<SeaZoneId, IndiaEventRegionId> = {
  "west-indian": "bombay",
  "south-indian": "madras",
  "east-indian": "bengal",
};

const STORM_DIE_SOURCE =
  "printnplay/Hard Components/John Company Wood Manifest.pdf p.4 (storm die template)";

// The template shows six faces: 4, 4, 2 with an E storm, 1 with three storms, 3 with an S storm
// and 2 with a W storm. The rulebook (p.28) gives no face list; this template is the only source.
export const stormDieFaces: StormDieFace[] = [
  { id: "calm-4a", events: 4, storms: [], label: "4", source: STORM_DIE_SOURCE },
  { id: "calm-4b", events: 4, storms: [], label: "4", source: STORM_DIE_SOURCE },
  { id: "east-2", events: 2, storms: ["east-indian"], label: "2 E storm", source: STORM_DIE_SOURCE },
  {
    id: "all-storms-1",
    events: 1,
    storms: ["west-indian", "south-indian", "east-indian"],
    label: "1 with three storms",
    source: STORM_DIE_SOURCE,
  },
  { id: "south-3", events: 3, storms: ["south-indian"], label: "3 S storm", source: STORM_DIE_SOURCE },
  { id: "west-2", events: 2, storms: ["west-indian"], label: "2 W storm", source: STORM_DIE_SOURCE },
];
