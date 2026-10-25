import type { MapDefinition, OrderDefinition, PresidencyDefinition, RegionDefinition } from "./types";

const source = "board_image-1.png" as const;

// Transcribed from board_image-1.png (4902 x 2481). Positions are order-oval centres in
// full-image pixels. `deregulationValue` is the small number printed beside each order.
const order = (
  id: string,
  region: OrderDefinition["region"],
  value: number,
  deregulationValue: number,
  boardPosition: OrderDefinition["boardPosition"],
  connectedOrderIds: string[],
  isHomePortFor?: OrderDefinition["isHomePortFor"],
): OrderDefinition => ({
  id,
  region,
  value,
  deregulationValue,
  connectedOrderIds,
  isHomePortFor,
  boardPosition,
  source,
  notes: [],
});

export const presidencies: PresidencyDefinition[] = [
  {
    id: "bombay",
    label: "Bombay Presidency",
    army: "bombay",
    homeRegion: "bombay",
    seaZone: "west-indian",
    presidentOfficeId: "president-bombay",
    source,
    notes: [
      "Other regions become associated with a Presidency only when its Army conquers them (rulebook p.23) and lose that association on Region Loss (p.29).",
    ],
  },
  {
    id: "madras",
    label: "Madras Presidency",
    army: "madras",
    homeRegion: "madras",
    seaZone: "south-indian",
    presidentOfficeId: "president-madras",
    source,
    notes: [
      "Other regions become associated with a Presidency only when its Army conquers them (rulebook p.23) and lose that association on Region Loss (p.29).",
    ],
  },
  {
    id: "bengal",
    label: "Bengal Presidency",
    army: "bengal",
    homeRegion: "bengal",
    seaZone: "east-indian",
    presidentOfficeId: "president-bengal",
    source,
    notes: [
      "Other regions become associated with a Presidency only when its Army conquers them (rulebook p.23) and lose that association on Region Loss (p.29).",
    ],
  },
];

export const regions: RegionDefinition[] = [
  {
    id: "punjab",
    label: "Punjab",
    adjacentRegionIds: ["delhi", "bombay"],
    governorOfficeId: "governor-punjab",
    borderShapes: { circle: "bombay", triangle: "bombay", square: "delhi" },
    exportIcons: 0,
    boardPosition: { x: 2990, y: 230 },
    orders: [
      order("punjab-7", "punjab", 7, 3, { x: 3112, y: 150 }, ["delhi-north-5", "bombay-north-3"]),
    ],
    source,
    notes: [],
  },
  {
    id: "delhi",
    label: "Delhi",
    adjacentRegionIds: ["punjab", "bombay", "maratha", "bengal"],
    governorOfficeId: "governor-delhi",
    borderShapes: { circle: "maratha", triangle: "bengal", square: "punjab" },
    exportIcons: 1,
    boardPosition: { x: 3700, y: 170 },
    orders: [
      order("delhi-north-5", "delhi", 5, 2, { x: 3557, y: 126 }, ["punjab-7", "delhi-west-3"]),
      order("delhi-west-3", "delhi", 3, 1, { x: 3455, y: 280 }, [
        "delhi-north-5",
        "delhi-east-5",
        "bombay-north-3",
      ]),
      order("delhi-east-5", "delhi", 5, 2, { x: 3847, y: 232 }, ["delhi-west-3", "maratha-north-4"]),
    ],
    source,
    notes: [],
  },
  {
    id: "bombay",
    label: "Bombay",
    homePresidency: "bombay",
    adjacentRegionIds: ["punjab", "delhi", "maratha", "hyderabad", "mysore"],
    governorOfficeId: "governor-bombay",
    borderShapes: { circle: "maratha", triangle: "punjab", square: "hyderabad" },
    exportIcons: 0,
    boardPosition: { x: 3150, y: 560 },
    orders: [
      order("bombay-north-3", "bombay", 3, 1, { x: 3185, y: 367 }, [
        "punjab-7",
        "delhi-west-3",
        "bombay-home-4",
      ]),
      order("bombay-east-3", "bombay", 3, 1, { x: 3320, y: 638 }, ["bombay-home-4", "maratha-west-3"]),
      order(
        "bombay-home-4",
        "bombay",
        4,
        2,
        { x: 3139, y: 836 },
        ["bombay-north-3", "bombay-east-3", "mysore-north-3"],
        "bombay",
      ),
    ],
    source,
    notes: ["Bombay is a Presidency home region; its £4 order is the home port."],
  },
  {
    id: "maratha",
    label: "Maratha",
    adjacentRegionIds: ["delhi", "bombay", "hyderabad", "bengal"],
    governorOfficeId: "governor-maratha",
    borderShapes: { circle: "bombay", triangle: "bengal", square: "delhi" },
    exportIcons: 0,
    boardPosition: { x: 3760, y: 560 },
    orders: [
      order("maratha-north-4", "maratha", 4, 2, { x: 3888, y: 435 }, ["delhi-east-5", "bengal-north-5"]),
      order("maratha-west-3", "maratha", 3, 1, { x: 3569, y: 653 }, ["bombay-east-3", "maratha-east-2"]),
      order("maratha-east-2", "maratha", 2, 1, { x: 4057, y: 793 }, [
        "maratha-west-3",
        "bengal-north-5",
        "hyderabad-7",
      ]),
    ],
    source,
    notes: [],
  },
  {
    id: "bengal",
    label: "Bengal",
    homePresidency: "bengal",
    adjacentRegionIds: ["delhi", "maratha"],
    governorOfficeId: "governor-bengal",
    borderShapes: { circle: "maratha", triangle: "delhi", square: "delhi" },
    exportIcons: 2,
    boardPosition: { x: 4400, y: 330 },
    orders: [
      order("bengal-north-5", "bengal", 5, 2, { x: 4231, y: 445 }, [
        "maratha-north-4",
        "maratha-east-2",
        "bengal-home-6",
      ]),
      order("bengal-home-6", "bengal", 6, 3, { x: 4553, y: 634 }, ["bengal-north-5"], "bengal"),
    ],
    source,
    notes: ["Bengal is a Presidency home region; its £6 order is the home port."],
  },
  {
    id: "hyderabad",
    label: "Hyderabad",
    adjacentRegionIds: ["bombay", "maratha", "mysore", "madras"],
    governorOfficeId: "governor-hyderabad",
    borderShapes: { circle: "madras", triangle: "maratha", square: "bombay" },
    exportIcons: 1,
    boardPosition: { x: 3560, y: 930 },
    orders: [
      order("hyderabad-7", "hyderabad", 7, 3, { x: 3767, y: 1059 }, [
        "maratha-east-2",
        "mysore-south-6",
        "madras-home-5",
      ]),
    ],
    source,
    notes: [],
  },
  {
    id: "mysore",
    label: "Mysore",
    adjacentRegionIds: ["bombay", "hyderabad", "madras"],
    governorOfficeId: "governor-mysore",
    borderShapes: { circle: "bombay", triangle: "hyderabad", square: "madras" },
    exportIcons: 0,
    boardPosition: { x: 3440, y: 1500 },
    orders: [
      order("mysore-north-3", "mysore", 3, 1, { x: 3390, y: 1198 }, ["bombay-home-4", "mysore-south-6"]),
      order("mysore-south-6", "mysore", 6, 3, { x: 3511, y: 1383 }, [
        "mysore-north-3",
        "hyderabad-7",
        "madras-south-4",
      ]),
    ],
    source,
    notes: [],
  },
  {
    id: "madras",
    label: "Madras",
    homePresidency: "madras",
    adjacentRegionIds: ["hyderabad", "mysore"],
    governorOfficeId: "governor-madras",
    borderShapes: { circle: "hyderabad", triangle: "mysore", square: "mysore" },
    exportIcons: 1,
    boardPosition: { x: 3650, y: 1650 },
    orders: [
      order(
        "madras-home-5",
        "madras",
        5,
        2,
        { x: 3812, y: 1375 },
        ["hyderabad-7", "madras-south-4"],
        "madras",
      ),
      order("madras-south-4", "madras", 4, 2, { x: 3719, y: 1538 }, ["mysore-south-6", "madras-home-5"]),
    ],
    source,
    notes: ["Madras is a Presidency home region; its £5 order is the home port."],
  },
];

export const mapData: MapDefinition = {
  source,
  boardSize: {
    width: 4902,
    height: 2481,
  },
  presidencies,
  regions,
};
