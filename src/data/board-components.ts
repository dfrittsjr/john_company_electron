// Board and punchboard component data for John Company: Second Edition.
// Transcribed from board_image-1.png and the print-and-play punchboard / rulebook PDFs.
// Self-contained: no imports from the rest of src/data.

export type BoardComponentSourceRef = string;

export type BoardPoint = { x: number; y: number };

export type ArmyId = "bombay" | "madras" | "bengal";

export type BoardRegionId =
  | "punjab"
  | "delhi"
  | "bombay"
  | "maratha"
  | "bengal"
  | "hyderabad"
  | "mysore"
  | "madras";

export type BoardScenarioId = "1710" | "1758" | "1813" | "long-1710";

/** The four Power track markers; also the targets of Policy spaces. */
export type PowerTargetId = "social" | "companyShare" | "shipping" | "manufacturing";

export type PrizeDefinition = {
  id: string;
  /** 1 = top (cheapest) box on the board's left edge, 5 = bottom. */
  order: number;
  cost: number;
  /** Paid per family member on the prize in Upkeep and Refresh. */
  upkeep: number;
  victoryPoints: number;
  windowTaxIcons: number;
  otherIcons: string[];
  /** Approximate centre of the prize box in board_image-1.png pixels. */
  boardPosition: BoardPoint;
  source: BoardComponentSourceRef;
  notes: string[];
};

export type PowerTrackPositionId = "top" | "middle" | "bottomLeft" | "bottomRight";

export type PowerTrackPosition = {
  id: PowerTrackPositionId;
  power: number;
  /** Printed label in this position, which is also the setup position of that marker. */
  printedLabel: string;
  /** Position whose marker is swapped in when a Power policy targets this position. */
  nextHigher?: PowerTrackPositionId;
};

export type PowerTrackDefinition = {
  positions: PowerTrackPosition[];
  startingPositions: Record<PowerTargetId, PowerTrackPositionId>;
  source: BoardComponentSourceRef;
  notes: string[];
};

export type PolicyConsequence = "tax" | "taxAndWindowTax" | "bonus" | "power";

export type PolicySpace = {
  /** Clockwise order around the Prime Minister dial, starting at the 1710 space. */
  index: number;
  consequence: PolicyConsequence;
  target: PowerTargetId;
  /** Scenario date printed beside this space; the arm starts here for that scenario. */
  printedDate?: "1710" | "1758" | "1813";
};

export type PolicyDialDefinition = {
  spaces: PolicySpace[];
  startingSpaceByScenario: Record<BoardScenarioId, number>;
  primeMinisterPower: number;
  source: BoardComponentSourceRef;
  notes: string[];
};

export type PowerAwardBand = {
  finalTurns: number[];
  firstPlace: number;
  secondPlace: number;
};

export type PowerAwardDefinition = {
  bands: PowerAwardBand[];
  source: BoardComponentSourceRef;
  notes: string[];
};

export type ShareValue = { companySucceeded: number; companyFailed: number };

export type CompanyShareScoringDefinition = {
  /** Value printed in the Court of Directors box. */
  courtPrinted: ShareValue;
  /** Company share VP token: placed (or flipped) in the Court, replacing the printed value. */
  vpTokenSides: ShareValue[];
  maxAbsoluteValue: number;
  source: BoardComponentSourceRef;
  notes: string[];
};

export type LootTokenDefinition = {
  id: string;
  region: BoardRegionId;
  /** £ value on the loot side. */
  lootValue: number;
  /** Symbol on the control side (same as the region's Governor overlay). */
  controlSymbol: string;
  source: BoardComponentSourceRef;
};

export type LocalAllianceDefinition = {
  id: string;
  name: string;
  army: ArmyId;
  /** Paid from the President's treasury when a Commander buys it. */
  cost: number;
  /** Dice it gives when exhausted for Deploy, and its strength for defence. */
  strength: number;
  source: BoardComponentSourceRef;
};

export type GovernorOverlayDefinition = {
  id: string;
  region: BoardRegionId;
  symbol: string;
  source: BoardComponentSourceRef;
};

export type PunchboardPieceDefinition = {
  id: string;
  label: string;
  count: number;
  /** What each face shows, front then back. */
  faces: string[];
  gameValues?: Record<string, number>;
  /** Where the count comes from: the rulebook component list unless stated. */
  countSource: BoardComponentSourceRef;
  notes: string[];
};

export type UncertainField = {
  path: string;
  reason: string;
};

const BOARD = "board_image-1.png";
const PUNCH_FRONTS = "printnplay/Punchboard/John Company Punchboard (Fronts).pdf";
const PUNCH_BACKS = "printnplay/Punchboard/John Company Punchboard (Backs).pdf";
const RULES = "printnplay/Rulebooks/John Company Rules.pdf";

export const prizes: PrizeDefinition[] = [
  {
    id: "prize-2",
    order: 1,
    cost: 2,
    upkeep: 0,
    victoryPoints: 0,
    windowTaxIcons: 0,
    otherIcons: [],
    boardPosition: { x: 320, y: 662 },
    source: `${BOARD} prize boxes (left edge, 1st)`,
    notes: ["Only a £2 cost is printed: no upkeep, no window icons, no VP."],
  },
  {
    id: "prize-4",
    order: 2,
    cost: 4,
    upkeep: 1,
    victoryPoints: 2,
    windowTaxIcons: 1,
    otherIcons: [],
    boardPosition: { x: 320, y: 1025 },
    source: `${BOARD} prize boxes (left edge, 2nd)`,
    notes: [],
  },
  {
    id: "prize-8",
    order: 3,
    cost: 8,
    upkeep: 2,
    victoryPoints: 4,
    windowTaxIcons: 2,
    otherIcons: [],
    boardPosition: { x: 320, y: 1390 },
    source: `${BOARD} prize boxes (left edge, 3rd)`,
    notes: [],
  },
  {
    id: "prize-14",
    order: 4,
    cost: 14,
    upkeep: 3,
    victoryPoints: 8,
    windowTaxIcons: 3,
    otherIcons: [],
    boardPosition: { x: 320, y: 1752 },
    source: `${BOARD} prize boxes (left edge, 4th)`,
    notes: [],
  },
  {
    id: "prize-20",
    order: 5,
    cost: 20,
    upkeep: 4,
    victoryPoints: 12,
    windowTaxIcons: 4,
    otherIcons: [],
    boardPosition: { x: 320, y: 2117 },
    source: `${BOARD} prize boxes (left edge, 5th)`,
    notes: [],
  },
];

export const powerTrack: PowerTrackDefinition = {
  positions: [
    { id: "top", power: 2, printedLabel: "Social" },
    { id: "middle", power: 1, printedLabel: "Company Share", nextHigher: "top" },
    { id: "bottomLeft", power: 0, printedLabel: "Shipping", nextHigher: "middle" },
    { id: "bottomRight", power: 0, printedLabel: "Manufacturing", nextHigher: "middle" },
  ],
  startingPositions: {
    social: "top",
    companyShare: "middle",
    shipping: "bottomLeft",
    manufacturing: "bottomRight",
  },
  source: `${BOARD} Power track (top left, beside Company Standing); markers on ${PUNCH_FRONTS} p.7`,
  notes: [
    "The track is a small tree: one box worth 2 power, one worth 1, and two bottom boxes worth 0 (rulebook p.9: 'The bottom two spaces are worth 0 power').",
    "Each box prints the name of the marker that starts there (rulebook setup step 5: 'indicated spaces').",
    "Power policy (rulebook p.34): swap the target's marker with the next higher marker; vines link both bottom boxes to the middle box, which links to the top. If the target is already on top, swap any two other markers.",
    "Marker colours: shipping blue (anchor), manufacturing yellow (gear), social pink (top hat), Company share red (EIC heart).",
  ],
};

export const policyDial: PolicyDialDefinition = {
  spaces: [
    { index: 0, consequence: "power", target: "manufacturing", printedDate: "1710" },
    { index: 1, consequence: "tax", target: "companyShare" },
    { index: 2, consequence: "power", target: "shipping" },
    { index: 3, consequence: "taxAndWindowTax", target: "social" },
    { index: 4, consequence: "power", target: "companyShare" },
    { index: 5, consequence: "bonus", target: "manufacturing" },
    { index: 6, consequence: "power", target: "shipping", printedDate: "1758" },
    { index: 7, consequence: "power", target: "social" },
    { index: 8, consequence: "taxAndWindowTax", target: "shipping" },
    { index: 9, consequence: "bonus", target: "companyShare" },
    { index: 10, consequence: "tax", target: "manufacturing", printedDate: "1813" },
    { index: 11, consequence: "bonus", target: "manufacturing" },
    { index: 12, consequence: "taxAndWindowTax", target: "social" },
    { index: 13, consequence: "tax", target: "shipping" },
  ],
  startingSpaceByScenario: {
    "1710": 0,
    "1758": 6,
    "1813": 10,
    "long-1710": 0,
  },
  primeMinisterPower: 2,
  source: `${PUNCH_FRONTS} p.8 (Prime Minister dial)`,
  notes: [
    "14 wedges. Order is clockwise as printed on the dial face, starting at the wedge labelled 1710.",
    "Target icons: top hat = social, anchor = shipping, gear = manufacturing, EIC heart = Company share. Every TAX & WINDOW TAX wedge also shows a window icon.",
    "Scenario dates are printed on the inner ring beside their wedge; rulebook p.4 points the arm at the matching date. Long 1710 starts like 1710.",
    "The dial's centre shows 2 power: the Prime Minister's +2 power at Final Scoring (rulebook p.9).",
  ],
};

export const powerAward: PowerAwardDefinition = {
  bands: [
    { finalTurns: [1, 2, 3], firstPlace: 3, secondPlace: 1 },
    { finalTurns: [4, 5, 6], firstPlace: 5, secondPlace: 2 },
    { finalTurns: [7, 8], firstPlace: 8, secondPlace: 4 },
  ],
  source: `${BOARD} End Game Scoring box (top left)`,
  notes: [
    "Printed: 'If tied for first, take the lower award.' Rulebook p.9: tied first-place players take the lower value and no other award is given; players tied for second get nothing.",
  ],
};

export const companyShareScoring: CompanyShareScoringDefinition = {
  courtPrinted: { companySucceeded: 1, companyFailed: -1 },
  vpTokenSides: [
    { companySucceeded: 2, companyFailed: -2 },
    { companySucceeded: 3, companyFailed: -3 },
  ],
  maxAbsoluteValue: 3,
  source: `${BOARD} Court of Directors box; VP token on ${PUNCH_FRONTS} / ${PUNCH_BACKS} p.7`,
  notes: [
    "The Court prints a -1 / +1 pair: each Company share scores +1 VP if the Company survives, -1 if it fails (rulebook p.9).",
    "The Company share VP token is double-sided: +2/-2 on one face, +3/-3 on the other. 1813 starts with the +2/-2 side in the Court; a failed Vote to Deregulate places or flips it (rulebook p.36), never beyond +/-3.",
  ],
};

export const lootTokens: LootTokenDefinition[] = [
  { id: "loot-punjab", region: "punjab", lootValue: 6, controlSymbol: "turbaned head", source: `${PUNCH_FRONTS} p.1` },
  { id: "loot-delhi", region: "delhi", lootValue: 8, controlSymbol: "shield and spears", source: `${PUNCH_FRONTS} p.2` },
  { id: "loot-bengal", region: "bengal", lootValue: 6, controlSymbol: "tiger", source: `${PUNCH_FRONTS} p.3` },
  { id: "loot-bombay", region: "bombay", lootValue: 4, controlSymbol: "fish", source: `${PUNCH_FRONTS} p.4` },
  { id: "loot-maratha", region: "maratha", lootValue: 3, controlSymbol: "crossed swords", source: `${PUNCH_FRONTS} p.5` },
  { id: "loot-mysore", region: "mysore", lootValue: 5, controlSymbol: "double-headed eagle", source: `${PUNCH_FRONTS} p.5` },
  { id: "loot-hyderabad", region: "hyderabad", lootValue: 7, controlSymbol: "hookah", source: `${PUNCH_FRONTS} p.5` },
  { id: "loot-madras", region: "madras", lootValue: 5, controlSymbol: "turtle", source: `${PUNCH_FRONTS} p.5` },
];

export const localAlliances: LocalAllianceDefinition[] = [
  { id: "alliance-rajput-prince", name: "Rajput Prince", army: "bombay", cost: 5, strength: 3, source: `${PUNCH_FRONTS} p.6` },
  { id: "alliance-sikhs", name: "Sikhs", army: "bombay", cost: 3, strength: 2, source: `${PUNCH_FRONTS} p.6` },
  { id: "alliance-the-nizam", name: "The Nizam", army: "madras", cost: 3, strength: 2, source: `${PUNCH_FRONTS} p.5` },
  { id: "alliance-arcot", name: "Arcot", army: "madras", cost: 4, strength: 2, source: `${PUNCH_FRONTS} p.5` },
  { id: "alliance-awadh", name: "Awadh", army: "bengal", cost: 4, strength: 2, source: `${PUNCH_FRONTS} p.6` },
  { id: "alliance-jagat-seths", name: "Jagat Seths", army: "bengal", cost: 4, strength: 2, source: `${PUNCH_FRONTS} p.5` },
  { id: "alliance-orissa", name: "Orissa", army: "bengal", cost: 2, strength: 1, source: `${PUNCH_FRONTS} p.5` },
];

export const governorOverlays: GovernorOverlayDefinition[] = [
  { id: "overlay-punjab", region: "punjab", symbol: "turbaned head", source: `${PUNCH_FRONTS} p.8` },
  { id: "overlay-delhi", region: "delhi", symbol: "shield and spears", source: `${PUNCH_FRONTS} p.8` },
  { id: "overlay-maratha", region: "maratha", symbol: "crossed swords", source: `${PUNCH_FRONTS} p.8` },
  { id: "overlay-mysore", region: "mysore", symbol: "double-headed eagle", source: `${PUNCH_FRONTS} p.8` },
  { id: "overlay-hyderabad", region: "hyderabad", symbol: "hookah", source: `${PUNCH_FRONTS} p.8` },
  { id: "overlay-madras", region: "madras", symbol: "turtle", source: `${PUNCH_FRONTS} p.8` },
  { id: "overlay-bengal", region: "bengal", symbol: "tiger", source: `${PUNCH_FRONTS} p.5` },
  { id: "overlay-bombay", region: "bombay", symbol: "fish", source: `${PUNCH_FRONTS} p.6` },
];

export const londonSeasonDisplay = {
  slots: 3,
  source: `${RULES} p.4 setup step 12 and p.12`,
  notes: ["Deal three; refill to three every London Season, even if no cards were taken. Blackmail cards are placed facedown, prestige cards faceup."],
} as const;

export const punchboardPieces: PunchboardPieceDefinition[] = [
  {
    id: "regiment",
    label: "Regiment",
    count: 20,
    faces: ["sepoys with drum", "sepoys with drum"],
    gameValues: { deployDice: 1, expense: 1 },
    countSource: `${RULES} p.3`,
    notes: ["Same art both sides; exhaustion is shown by moving it to the bottom half of the Army box (rulebook p.22)."],
  },
  {
    id: "player-ship",
    label: "Player-owned ship",
    count: 22,
    faces: ["named ship (blue)", "named ship (fatigued side)"],
    countSource: `${RULES} p.3`,
    notes: ["One per shipyard, matching the shipyard name. A fatigued ship that is fatigued again sinks (rulebook p.28)."],
  },
  {
    id: "company-extra-ship",
    label: "Company ship / Extra ship",
    count: 14,
    faces: ["Company (red)", "Extra (black)"],
    gameValues: { leaseExtraCost: 2, buyCompanyCost: 5, fitPlayerShipCost: 3 },
    countSource: `${RULES} p.3`,
    notes: ["Costs are the Manager of Shipping costs from rulebook p.19."],
  },
  {
    id: "loot-control-token",
    label: "Loot / control token",
    count: 8,
    faces: ["£ loot value + region symbol", "region symbol (control)"],
    countSource: `${RULES} p.2`,
    notes: ["See lootTokens for values."],
  },
  {
    id: "local-alliance",
    label: "Local alliance",
    count: 7,
    faces: ["strength, name, cost", "strength, name, cost"],
    countSource: `${RULES} p.3`,
    notes: ["Same face both sides. See localAlliances."],
  },
  {
    id: "governor-overlay",
    label: "Governor overlay",
    count: 8,
    faces: ["region symbol", "region symbol"],
    countSource: `${RULES} p.3`,
    notes: [],
  },
  {
    id: "superintendent-overlay",
    label: "Superintendent of Trade in China overlay",
    count: 1,
    faces: ["Superintendent of Trade in China", "Superintendent of Trade in China"],
    countSource: `${RULES} p.3`,
    notes: [],
  },
  {
    id: "governor-general-overlay",
    label: "Governor General overlay",
    count: 1,
    faces: ["Governor General", "Governor General"],
    countSource: `${RULES} p.3`,
    notes: [],
  },
  {
    id: "power-token",
    label: "Power token",
    count: 4,
    faces: ["target icon", "target icon"],
    countSource: `${RULES} p.3`,
    notes: ["Shipping, manufacturing, social, Company share."],
  },
  {
    id: "trophy-passed-law",
    label: "Trophy / passed law token",
    count: 18,
    faces: ["Trophy (1 power)", "Passed Law (1 power)"],
    gameValues: { power: 1 },
    countSource: `${RULES} p.3`,
    notes: ["Each trophy and each passed law token is worth +1 power at Final Scoring (rulebook p.9)."],
  },
  {
    id: "closed-filled-order",
    label: "Closed / filled order token",
    count: 17,
    faces: ["Filled", "Closed"],
    countSource: `${RULES} p.3`,
    notes: [],
  },
  {
    id: "presidency-divider",
    label: "Presidency divider",
    count: 6,
    faces: ["divider", "divider"],
    countSource: `${RULES} p.3`,
    notes: ["Marks the association of writers between Presidencies (rulebook p.20)."],
  },
  {
    id: "company-share-vp-token",
    label: "Company share VP token",
    count: 1,
    faces: ["+2 / -2", "+3 / -3"],
    countSource: `${RULES} p.3`,
    notes: ["See companyShareScoring."],
  },
  {
    id: "chairman-marker",
    label: "Chairman marker",
    count: 1,
    faces: ["Chairman", "Chairman"],
    countSource: `${RULES} p.3`,
    notes: [],
  },
  {
    id: "opposition-leader-marker",
    label: "Leader of the Opposition marker",
    count: 1,
    faces: ["Leader of the Opposition", "Leader of the Opposition"],
    countSource: `${RULES} p.3`,
    notes: [],
  },
  {
    id: "prime-minister-dial",
    label: "Prime Minister dial",
    count: 1,
    faces: ["Policy track and arm"],
    gameValues: { power: 2 },
    countSource: `${RULES} p.2`,
    notes: ["See policyDial."],
  },
];

/** Component counts from the rulebook component pages (p.2-3). */
export const rulebookComponentCounts = {
  towerLevels: 20,
  domes: 8,
  flagSets: 3,
  eventTiles: 20,
  lootControlTokens: 8,
  elephant: 1,
  pawns: 6,
  fatigueUnrestCubes: 30,
  crownPromiseCubes: 12,
  coins: { 1: 40, 2: 20, 5: 20, 10: 10 },
  playerShips: 22,
  companyExtraShips: 14,
  regiments: 20,
  localAlliances: 7,
  closedFilledOrderTokens: 17,
  powerTokens: 4,
  governorOverlays: 8,
  superintendentOverlays: 1,
  governorGeneralOverlays: 1,
  dividers: 6,
  trophyPassedLawTokens: 18,
  standardDice: 10,
  stormDice: 1,
  prizes: 5,
  londonSeasonDisplaySlots: 3,
  source: `${RULES} p.2-3`,
} as const;

export const boardComponentsUncertain: UncertainField[] = [
  {
    path: "lootTokens[*].lootValue",
    reason:
      "The punchboard tokens read £3-£8 (Maratha £3 ... Delhi £8), but the rulebook p.23 loot table prints '+£4 to +£9'. The tokens agree with both rulebook examples (Hyderabad £7, Mysore £4 tower + £5 = £9 on p.22-23), so the token values are used.",
  },
  {
    path: "punchboardPieces[*].count",
    reason:
      "Counts come from the rulebook component list; regiments, ships, and tokens were not individually counted on the punchboard sheets.",
  },
];

export const boardComponentsNotes = [
  "The large red oval tokens with region symbols on punchboard sheets 5, 6 and 8 are Governor overlays (red circle in the 'Situation in India' legend), not loot tokens. Loot/control tokens are the small rounded rectangles: £ value on the front, region symbol only on the back.",
  "Local alliances are printed identically on both sides.",
];
