import type {
  CrownAiCard,
  CrownClimate,
  CrownDifficultySetting,
  CrownSetupDistribution,
} from "./types";

// The Crown, the automated opponent for solo and two-player games (rulebook pp.43-46; the Crown
// Handbook is in ./crown-handbook.ts). Transcribed twice independently and compared field by field
// (2026-10-25); marker positions were also checked on the card images.

export type { CrownClimate };

/** The five climates, left to right on the Crown family board and in every Handbook table. */
export const CROWN_CLIMATES: readonly CrownClimate[] = ["bull", "stag", "lion", "bear", "peacock"];

export const CROWN_AI_CARD_COUNT = 10;
export const CROWN_PROMISE_CUBE_COUNT = 12;

const FRONTS = "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf";
const BACKS = "printnplay/Cards/John Company Cards (Bridge, Bridge).pdf";

function card(number: number, frontPage: number, data: Omit<CrownAiCard, "id" | "number" | "source">): CrownAiCard {
  const id = `crown-ai-${String(number).padStart(2, "0")}` as CrownAiCard["id"];
  const source = { front: `${FRONTS} p.${frontPage}`, back: `${BACKS} p.${frontPage} (mirrored)` };
  return { id, number, source, ...data };
}

/**
 * The ten AI cards (rulebook p.45). On the face-up card:
 * - `climateBands`: the chart that sets the Crown's climate when a new card is flipped (4);
 * - `splaySlot`: the shaded slot; when the Crown picks one of three cards in a row it takes the
 *   one in that position, else the next to the right, wrapping round (3);
 * - `firstArrow` / `secondArrow`: the black "1st" and white "2nd" arrows on the left edge. They line
 *   up with the top, middle or bottom Presidency on the back of the top card of the face-down AI
 *   deck: the Crown picks the 1st, then the 2nd, then the remaining Presidency (1, 6);
 * - `hand`: the pointing hand lines up with one of that back's two arrows, upper (between top and
 *   middle) or lower (between middle and bottom), which gives the Crown's direction (2);
 * - `regionPriority`: the region strip, chosen left to right (5).
 * `back` is what the card shows when it is the top of the face-down deck.
 */
export const crownAiCards: CrownAiCard[] = [
  card(1, 10, {
    criterion: "Company Expectations",
    climateBands: [
      { range: "£4", climate: "peacock" },
      { range: "£6", climate: "lion" },
      { range: "£8+", climate: "bull" },
    ],
    splaySlot: "left",
    firstArrow: "top",
    secondArrow: "bottom",
    hand: "upper",
    regionPriority: ["madras", "mysore", "bombay", "punjab", "delhi", "maratha", "hyderabad", "bengal"],
    back: { presidencies: ["bombay", "madras", "bengal"], upperArrow: "clockwise", lowerArrow: "counterclockwise" },
  }),
  card(2, 10, {
    criterion: "Presidencies with Control of a Region",
    climateBands: [
      { range: "0-1", climate: "peacock" },
      { range: "2", climate: "bear" },
      { range: "3", climate: "bull" },
    ],
    splaySlot: "middle",
    firstArrow: "top",
    secondArrow: "middle",
    hand: "upper",
    regionPriority: ["mysore", "bombay", "punjab", "bengal", "delhi", "maratha", "hyderabad", "madras"],
    back: { presidencies: ["bombay", "madras", "bengal"], upperArrow: "counterclockwise", lowerArrow: "clockwise" },
  }),
  card(3, 10, {
    criterion: "Company Debt",
    climateBands: [
      { range: "0", climate: "stag" },
      { range: "1-4", climate: "bull" },
      { range: "5+", climate: "peacock" },
    ],
    splaySlot: "right",
    firstArrow: "top",
    secondArrow: "bottom",
    hand: "upper",
    regionPriority: ["bombay", "punjab", "delhi", "hyderabad", "maratha", "bengal", "madras", "mysore"],
    back: { presidencies: ["bombay", "madras", "bengal"], upperArrow: "clockwise", lowerArrow: "counterclockwise" },
  }),
  card(4, 10, {
    criterion: "Company Expectations",
    climateBands: [
      { range: "£4 or £6", climate: "bear" },
      { range: "£8", climate: "stag" },
      { range: "£10+", climate: "bull" },
    ],
    splaySlot: "left",
    firstArrow: "bottom",
    secondArrow: "middle",
    hand: "upper",
    regionPriority: ["punjab", "maratha", "delhi", "hyderabad", "bengal", "madras", "mysore", "bombay"],
    back: { presidencies: ["bombay", "bengal", "madras"], upperArrow: "counterclockwise", lowerArrow: "clockwise" },
  }),
  card(5, 10, {
    criterion: "Seas with ≥2 Ships",
    climateBands: [
      { range: "0-1", climate: "lion" },
      { range: "2", climate: "stag" },
      { range: "3", climate: "bull" },
    ],
    splaySlot: "middle",
    firstArrow: "middle",
    secondArrow: "top",
    hand: "upper",
    regionPriority: ["punjab", "hyderabad", "maratha", "bengal", "madras", "mysore", "bombay", "delhi"],
    back: { presidencies: ["madras", "bengal", "bombay"], upperArrow: "clockwise", lowerArrow: "counterclockwise" },
  }),
  card(6, 10, {
    criterion: "Total Company Shares",
    climateBands: [
      { range: "0-6", climate: "bull" },
      { range: "0-6", climate: "peacock", deregulated: true },
      { range: "7-8", climate: "bear" },
      { range: "9+", climate: "lion" },
    ],
    splaySlot: "right",
    firstArrow: "middle",
    secondArrow: "bottom",
    hand: "lower",
    regionPriority: ["hyderabad", "delhi", "bengal", "madras", "mysore", "bombay", "maratha", "punjab"],
    back: { presidencies: ["madras", "bengal", "bombay"], upperArrow: "clockwise", lowerArrow: "counterclockwise" },
  }),
  card(7, 10, {
    criterion: "Crown Treasury",
    climateBands: [
      { range: "£0-7", climate: "bear" },
      { range: "£8-16", climate: "peacock" },
      { range: "£17+", climate: "stag" },
    ],
    splaySlot: "left",
    firstArrow: "middle",
    secondArrow: "top",
    hand: "lower",
    regionPriority: ["maratha", "bengal", "madras", "mysore", "bombay", "delhi", "punjab", "hyderabad"],
    back: { presidencies: ["madras", "bengal", "bombay"], upperArrow: "clockwise", lowerArrow: "counterclockwise" },
  }),
  card(8, 11, {
    criterion: "Presidencies with ≥2 Crown Writers",
    climateBands: [
      { range: "0", climate: "peacock" },
      { range: "1-2", climate: "stag" },
      { range: "3", climate: "lion" },
    ],
    splaySlot: "middle",
    firstArrow: "bottom",
    secondArrow: "middle",
    hand: "lower",
    regionPriority: ["bengal", "madras", "mysore", "bombay", "hyderabad", "punjab", "maratha", "delhi"],
    back: { presidencies: ["bengal", "bombay", "madras"], upperArrow: "clockwise", lowerArrow: "counterclockwise" },
  }),
  card(9, 11, {
    criterion: "Crown Commanders",
    climateBands: [
      { range: "0", climate: "lion" },
      { range: "1-2", climate: "bear" },
      { range: "3", climate: "peacock" },
    ],
    splaySlot: "right",
    firstArrow: "bottom",
    secondArrow: "top",
    hand: "lower",
    regionPriority: ["delhi", "bengal", "bombay", "madras", "mysore", "punjab", "hyderabad", "maratha"],
    back: { presidencies: ["bengal", "bombay", "madras"], upperArrow: "counterclockwise", lowerArrow: "clockwise" },
  }),
  card(10, 11, {
    criterion: "Fitted Ships",
    climateBands: [
      { range: "0-5", climate: "lion" },
      { range: "6-8", climate: "stag" },
      { range: "9+", climate: "bear" },
    ],
    splaySlot: "middle",
    firstArrow: "bottom",
    secondArrow: "middle",
    hand: "lower",
    regionPriority: ["hyderabad", "bombay", "punjab", "mysore", "maratha", "delhi", "bengal", "madras"],
    back: { presidencies: ["bengal", "bombay", "madras"], upperArrow: "counterclockwise", lowerArrow: "clockwise" },
  }),
];

/**
 * Favours on the Crown's family board (Punchboard (Fronts) p.7), available "anytime between the
 * start of the Firms phase and the end of the Revenue phase". `gain` is the cubes the player gets
 * for giving the item to the Crown; `take`, when printed, the cubes the player pays to take one.
 */
export const crownBoardFavors: Array<{ text: string; gain: string; take?: string; mode?: "easy" }> = [
  { text: "Give (or take) an unfitted shipyard.", gain: "+2", take: "-4" },
  { text: "Give (or take) a fitted shipyard.", gain: "+3", take: "-5" },
  { text: "Give (or take) an uninvested workshop.", gain: "+4", take: "-6" },
  { text: "Give (or take) an invested workshop.", gain: "+1", take: "-3" },
  { text: "Give (or take) a luxury.", gain: "+5", take: "-7" },
  { text: "Give an enterprise from a prestige card.", gain: "+4" },
  { text: "Give £3.", gain: "+2" },
  { text: "[EASY MODE ONLY]. Remove a promise card from the game. X = Turn/2, rounded up", gain: "+X", mode: "easy" },
];

/** Rulebook p.43 (solo) and p.44 (two players): setup cards and promise cubes. */
export const crownSetupDistributions: CrownSetupDistribution[] = [
  {
    mode: "soloCrown",
    variant: "draft",
    humanSetupCards: 4,
    crownSetupCards: 8,
    promiseCubesWithCrown: 6,
    promiseCubesPerHuman: 6,
    source: "printnplay/Rulebooks/John Company Rules.pdf",
  },
  {
    mode: "soloCrown",
    variant: "random",
    humanSetupCards: 4,
    crownSetupCards: 8,
    promiseCubesWithCrown: 6,
    promiseCubesPerHuman: 6,
    source: "printnplay/Rulebooks/John Company Rules.pdf",
  },
  {
    mode: "twoPlayerCrown",
    variant: "draft",
    humanSetupCards: 4,
    crownSetupCards: 4,
    promiseCubesWithCrown: 4,
    promiseCubesPerHuman: 4,
    source: "printnplay/Rulebooks/John Company Rules.pdf",
  },
];

/** Rulebook p.44 "Difficulty". Hard's 4 extra cubes come from the players (2 each in 2P). */
export const crownDifficultySettings: CrownDifficultySetting[] = [
  {
    id: "easy",
    source: "printnplay/Rulebooks/John Company Rules.pdf",
    promiseCardCubeTradesAllowed: true,
    additionalCrownPromiseCubes: 0,
    extraSetupCards: 0,
  },
  {
    id: "normal",
    source: "printnplay/Rulebooks/John Company Rules.pdf",
    promiseCardCubeTradesAllowed: false,
    additionalCrownPromiseCubes: 0,
    extraSetupCards: 0,
  },
  {
    id: "hard",
    source: "printnplay/Rulebooks/John Company Rules.pdf",
    promiseCardCubeTradesAllowed: false,
    additionalCrownPromiseCubes: 4,
    extraSetupCards: 0,
  },
  {
    id: "expert",
    source: "printnplay/Rulebooks/John Company Rules.pdf",
    promiseCardCubeTradesAllowed: false,
    additionalCrownPromiseCubes: 4,
    extraSetupCards: 3,
  },
];
