// Where things sit on board_image-1.png (4902 x 2481 px), for the SVG overlay.
//
// How these were measured: crops of board_image-1.png were rendered with a labelled 100 px grid
// (50 px for the Balance track) using PIL, and each element's centre or box was read off the grid.
// "grid crop x0-x1, y0-y1" in a comment names the crop it was read from. Order positions, region
// label positions, and prize boxes come from src/data, which was transcribed the same way.

import type { ArmyId, OfficeId, PhaseId, PresidencyId, RegionId, SeaZoneId } from "../engine";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export const BOARD_WIDTH = 4902;
export const BOARD_HEIGHT = 2481;

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({
  x: x0,
  y: y0,
  width: x1 - x0,
  height: y1 - y0,
});

// Victory Point track across the top (grid crop 0-2400, 0-800): "0" at x 112, one space per
// 100.8 px, centres on y 115. The black spaces down the left edge are -1, -2 and -3.
export function victoryPointSpace(vp: number): Point {
  if (vp < 0) return { x: 112, y: [216, 320, 419][Math.min(3, -vp) - 1] };
  return { x: 112 + 100.8 * Math.min(vp, 20), y: 115 };
}

// Company Standing (grid crop 0-2400, 0-800): circles left to right from the F space, y 291.
export const STANDING_SPACES: Point[] = [1248, 1371, 1499, 1629, 1755, 1885, 2011, 2136].map((x) => ({
  x,
  y: 291,
}));

// Company Debt 0-8 (grid crop 0-2400, 0-800), y 568.
export const DEBT_SPACES: Point[] = [1242, 1357, 1469, 1581, 1693, 1805, 1917, 2029, 2144].map((x) => ({
  x,
  y: 568,
}));

// Turn track (grid crop 0-800, 450-2481 and 600-2400, 650-2481): red circles at x 685, turn 1 at
// y 535, one turn per 100 px down to turn 8.
export function turnSpace(turn: number): Point {
  return { x: 685, y: 535 + 100 * (Math.min(Math.max(turn, 1), 8) - 1) };
}

// Company Balance along the bottom edge (grid crop 0-1200, 2250-2481 at full size): "0" centred at
// x 110, one space per 113 px to 40; y 2370.
export function balanceSpace(balance: number): Point {
  return { x: 110 + 113 * Math.min(Math.max(balance, 0), 40), y: 2370 };
}

// Power track boxes (grid crop 0-2400, 0-800).
export const POWER_BOXES: Record<"top" | "middle" | "bottomLeft" | "bottomRight", Point> = {
  top: { x: 963, y: 275 },
  middle: { x: 963, y: 419 },
  bottomLeft: { x: 883, y: 563 },
  bottomRight: { x: 1043, y: 563 },
};

// Votes track down the right edge (grid crop 4400-4902, 0-2481): "0" at y 1238, +10 ("Pass" end)
// at y 214, -10 ("Fail" end) at y 2267, x 4798.
export function voteSpace(support: number): Point {
  const clamped = Math.min(Math.max(support, -10), 10);
  return { x: 4798, y: 1238 - 102.4 * clamped };
}

// Phase circles on the red ribbon. Left column (grid crop 0-800, 450-2481): x 685. Right column
// (grid crop 4400-4902, 0-2481): x 4638. Company Operation is the ribbon itself (office icons).
export const PHASE_MARKERS: Partial<Record<PhaseId, Point>> = {
  londonSeason: { x: 685, y: 1402 },
  family: { x: 685, y: 1626 },
  firms: { x: 685, y: 1850 },
  hiring: { x: 685, y: 2063 },
  bonuses: { x: 4638, y: 1871 },
  revenue: { x: 4638, y: 1632 },
  eventsInIndia: { x: 4638, y: 1431 },
  parliament: { x: 4638, y: 1201 },
  upkeep: { x: 4638, y: 979 },
  finalScoring: { x: 300, y: 300 },
};

// Office icons on the red ribbon (grid crops 600-2400, 650-2481 and 2200-4902, 1800-2481).
// Governors sit on their overlays in India, at the region's emblem (see GOVERNOR_SPOTS).
export const OFFICE_SPOTS: Record<string, Point> = {
  chairman: { x: 867, y: 2242 },
  "director-of-trade": { x: 1436, y: 2242 },
  "governor-general": { x: 1436, y: 2242 },
  "manager-of-shipping": { x: 1886, y: 2242 },
  "military-affairs": { x: 2330, y: 2238 },
  "president-bombay": { x: 2773, y: 2238 },
  "president-madras": { x: 3398, y: 2238 },
  "president-bengal": { x: 4019, y: 2238 },
  "superintendent-of-trade-in-china": { x: 4638, y: 2067 },
};

// Treasury boxes above the ribbon (same crops): the Director of Trade box (shared with the
// Governor General), the Manager of Shipping box, and the coin half of each Presidency box.
export const TREASURY_SPOTS: Record<string, Point> = {
  "director-of-trade": { x: 1555, y: 2050 },
  "governor-general": { x: 1555, y: 2050 },
  "manager-of-shipping": { x: 2003, y: 2050 },
  "president-bombay": { x: 2867, y: 2070 },
  "president-madras": { x: 3488, y: 2070 },
  "president-bengal": { x: 4110, y: 2070 },
};

// Writers box: the quill half of each Presidency box (grid crop 2200-4902, 1800-2481).
export const WRITER_BOXES: Record<PresidencyId, Box> = {
  Bombay: box(2980, 1975, 3255, 2180),
  Madras: box(3600, 1975, 3875, 2180),
  Bengal: box(4220, 1975, 4495, 2180),
};

// Officers-in-Training box above Military Affairs (grid crop 2200-4902, 1800-2481).
export const OFFICERS_IN_TRAINING_BOX = box(2275, 1970, 2630, 2180);

// Army boxes (grid crop 2200-3000, 0-2000). Active pieces go in the top half, exhausted pieces in
// the bottom half; the Commander sits on the hat medallion.
export const ARMY_LAYOUT: Record<ArmyId, { commander: Point; active: Box; exhausted: Box; alliances: Point }> = {
  Bombay: {
    commander: { x: 2331, y: 350 },
    active: box(2290, 85, 2770, 300),
    exhausted: box(2290, 410, 2700, 620),
    alliances: { x: 2719, y: 569 },
  },
  Madras: {
    commander: { x: 2331, y: 981 },
    active: box(2290, 715, 2770, 930),
    exhausted: box(2290, 1040, 2700, 1250),
    alliances: { x: 2725, y: 1200 },
  },
  Bengal: {
    commander: { x: 2331, y: 1612 },
    active: box(2290, 1345, 2770, 1555),
    exhausted: box(2290, 1670, 2700, 1880),
    alliances: { x: 2725, y: 1825 },
  },
};

// Sea zones: the W, S and E storm markers (map crops 2950-4902, 0-2100 and 2200-3000, 0-2000).
// Ships are drawn just beside each marker. China ships go in open sea south-east of Bengal.
export const SEA_ZONE_SPOTS: Record<SeaZoneId | "china", Point> = {
  "west-indian": { x: 2960, y: 1480 },
  "south-indian": { x: 4030, y: 1690 },
  "east-indian": { x: 4330, y: 1250 },
  china: { x: 4380, y: 1840 },
};

// The red EIC emblem in each region, where the loot/control token and Governor overlay sit
// (grid crops of the map: 2780-3400, 0-1500 and 2950-4400, 0-1100; map crop 2950-4902, 0-2100).
export const GOVERNOR_SPOTS: Record<RegionId, Point> = {
  punjab: { x: 2874, y: 156 },
  delhi: { x: 3970, y: 126 },
  bombay: { x: 3205, y: 1019 },
  maratha: { x: 3675, y: 416 },
  bengal: { x: 4470, y: 411 },
  hyderabad: { x: 3491, y: 1044 },
  mysore: { x: 3306, y: 1457 },
  madras: { x: 3724, y: 1715 },
};

// Boxes in the middle of the board (grid crop 600-2400, 650-2481).
export const LONDON_DISPLAY_BOX = box(799, 699, 2194, 1261);
export const PENSIONERS_BOX = box(1365, 1331, 1616, 1891);
export const VACANT_OFFICES_BOX = box(1620, 1331, 2194, 1891);
export const COURT_BOX = box(810, 1745, 1290, 2180);

// Stock Exchange spaces above the Court (grid crop 600-2400, 650-2481). These replace the
// stock-exchange boardPosition values in src/data, which sit about 80-100 px too low.
export const STOCK_EXCHANGE_SPOTS: Record<string, Point> = {
  "stock-exchange-2": { x: 876, y: 1573 },
  "stock-exchange-3-left": { x: 961, y: 1430 },
  "stock-exchange-3-right": { x: 1046, y: 1573 },
  "stock-exchange-4": { x: 1131, y: 1430 },
  "stock-exchange-5": { x: 1217, y: 1573 },
};

// Prize boxes on the left edge (grid crop 0-800, 450-2481; matches src/data prizes): pieces are
// drawn in the lower half of each picture.
export const PRIZE_BOXES: Record<string, Box> = {
  "prize-2": box(72, 498, 571, 834),
  "prize-4": box(72, 858, 571, 1194),
  "prize-8": box(72, 1221, 571, 1554),
  "prize-14": box(72, 1583, 571, 1919),
  "prize-20": box(72, 1946, 571, 2279),
};

export const PRESIDENCY_OFFICE: Record<PresidencyId, OfficeId> = {
  Bombay: "president-bombay",
  Madras: "president-madras",
  Bengal: "president-bengal",
};

/** Preset views for the zoom controls, in board pixels. */
export const BOARD_VIEWS: Record<"board" | "india" | "company", Box> = {
  board: box(0, 0, BOARD_WIDTH, BOARD_HEIGHT),
  india: box(2760, 0, 4902, 1950),
  company: box(0, 0, 2800, 2481),
};
