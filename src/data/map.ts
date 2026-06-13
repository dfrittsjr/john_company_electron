import type { MapDefinition, OrderDefinition, PresidencyDefinition, RegionDefinition } from "./types";

const source = "board_image-1.png" as const;

const order = (
  id: string,
  region: OrderDefinition["region"],
  value: number,
  boardPosition: OrderDefinition["boardPosition"],
  connectedOrderIds: string[],
  isHomePortFor?: OrderDefinition["isHomePortFor"],
): OrderDefinition => ({
  id,
  region,
  value,
  connectedOrderIds,
  isHomePortFor,
  boardPosition,
  source,
  notes: [
    "Starter transcription from the board image; board overlay work may refine exact coordinates.",
  ],
});

export const presidencies: PresidencyDefinition[] = [
  {
    id: "bombay",
    label: "Bombay Presidency",
    army: "bombay",
    homeRegion: "bombay",
    seaZone: "west-indian",
    presidentOfficeId: "president-bombay",
    governorOfficeIds: ["governor-bombay", "governor-punjab", "governor-maratha"],
    associatedRegionIds: ["bombay", "punjab", "maratha"],
    source,
    notes: ["Needed by Family writer placement, Hiring, Presidencies, and Commander targets."],
  },
  {
    id: "madras",
    label: "Madras Presidency",
    army: "madras",
    homeRegion: "madras",
    seaZone: "south-indian",
    presidentOfficeId: "president-madras",
    governorOfficeIds: ["governor-madras", "governor-mysore", "governor-hyderabad"],
    associatedRegionIds: ["madras", "mysore", "hyderabad"],
    source,
    notes: ["Needed by Family writer placement, Hiring, Presidencies, and Commander targets."],
  },
  {
    id: "bengal",
    label: "Bengal Presidency",
    army: "bengal",
    homeRegion: "bengal",
    seaZone: "east-indian",
    presidentOfficeId: "president-bengal",
    governorOfficeIds: ["governor-bengal", "governor-delhi"],
    associatedRegionIds: ["bengal", "delhi"],
    source,
    notes: ["Needed by Family writer placement, Hiring, Presidencies, and Commander targets."],
  },
];

export const regions: RegionDefinition[] = [
  {
    id: "punjab",
    label: "Punjab",
    presidency: "bombay",
    adjacentRegionIds: ["bombay", "delhi"],
    governorOfficeId: "governor-punjab",
    boardPosition: { x: 3650, y: 260 },
    orders: [
      order("punjab-north-7", "punjab", 7, { x: 3555, y: 145 }, [
        "punjab-south-5",
        "delhi-west-3",
      ]),
      order("punjab-south-5", "punjab", 5, { x: 3710, y: 350 }, [
        "punjab-north-7",
        "bombay-home-3",
        "delhi-west-3",
      ]),
    ],
    source,
    notes: ["Associated with the Bombay Presidency."],
  },
  {
    id: "delhi",
    label: "Delhi",
    presidency: "bengal",
    adjacentRegionIds: ["punjab", "bombay", "maratha", "bengal"],
    governorOfficeId: "governor-delhi",
    boardPosition: { x: 3920, y: 390 },
    orders: [
      order("delhi-west-3", "delhi", 3, { x: 3870, y: 310 }, [
        "punjab-north-7",
        "punjab-south-5",
        "bombay-home-3",
        "delhi-east-5",
        "maratha-west-3",
      ]),
      order("delhi-east-5", "delhi", 5, { x: 4170, y: 300 }, [
        "delhi-west-3",
        "maratha-east-4",
        "bengal-north-5",
      ]),
    ],
    source,
    notes: ["Associated with the Bengal Presidency."],
  },
  {
    id: "bombay",
    label: "Bombay",
    presidency: "bombay",
    adjacentRegionIds: ["punjab", "delhi", "maratha", "hyderabad", "mysore"],
    governorOfficeId: "governor-bombay",
    boardPosition: { x: 3335, y: 760 },
    orders: [
      order("bombay-home-3", "bombay", 3, { x: 3210, y: 430 }, [
        "punjab-south-5",
        "delhi-west-3",
        "bombay-south-4",
        "maratha-west-3",
      ], "bombay"),
      order("bombay-south-4", "bombay", 4, { x: 3175, y: 850 }, [
        "bombay-home-3",
        "maratha-south-2",
        "hyderabad-west-7",
        "mysore-west-4",
      ]),
    ],
    source,
    notes: ["Bombay is a Presidency home region."],
  },
  {
    id: "maratha",
    label: "Maratha",
    presidency: "bombay",
    adjacentRegionIds: ["bombay", "delhi", "bengal", "hyderabad"],
    governorOfficeId: "governor-maratha",
    boardPosition: { x: 3910, y: 745 },
    orders: [
      order("maratha-west-3", "maratha", 3, { x: 3500, y: 685 }, [
        "delhi-west-3",
        "bombay-home-3",
        "maratha-east-4",
        "maratha-south-2",
      ]),
      order("maratha-east-4", "maratha", 4, { x: 3930, y: 470 }, [
        "delhi-east-5",
        "maratha-west-3",
        "maratha-central-5",
        "bengal-north-5",
      ]),
      order("maratha-central-5", "maratha", 5, { x: 4260, y: 505 }, [
        "maratha-east-4",
        "maratha-south-2",
        "bengal-home-6",
        "hyderabad-east-6",
      ]),
      order("maratha-south-2", "maratha", 2, { x: 4070, y: 805 }, [
        "bombay-south-4",
        "maratha-west-3",
        "maratha-central-5",
        "hyderabad-west-7",
      ]),
    ],
    source,
    notes: ["Associated with the Bombay Presidency."],
  },
  {
    id: "bengal",
    label: "Bengal",
    presidency: "bengal",
    adjacentRegionIds: ["delhi", "maratha"],
    governorOfficeId: "governor-bengal",
    boardPosition: { x: 4540, y: 520 },
    orders: [
      order("bengal-north-5", "bengal", 5, { x: 4390, y: 165 }, [
        "delhi-east-5",
        "maratha-east-4",
        "bengal-home-6",
      ]),
      order("bengal-home-6", "bengal", 6, { x: 4575, y: 650 }, [
        "bengal-north-5",
        "maratha-central-5",
      ], "bengal"),
    ],
    source,
    notes: ["Bengal is a Presidency home region."],
  },
  {
    id: "hyderabad",
    label: "Hyderabad",
    presidency: "madras",
    adjacentRegionIds: ["bombay", "maratha", "mysore", "madras"],
    governorOfficeId: "governor-hyderabad",
    boardPosition: { x: 3740, y: 1220 },
    orders: [
      order("hyderabad-west-7", "hyderabad", 7, { x: 3780, y: 1060 }, [
        "bombay-south-4",
        "maratha-south-2",
        "hyderabad-south-3",
      ]),
      order("hyderabad-south-3", "hyderabad", 3, { x: 3425, y: 1240 }, [
        "hyderabad-west-7",
        "hyderabad-east-6",
        "mysore-west-4",
        "madras-home-5",
      ]),
      order("hyderabad-east-6", "hyderabad", 6, { x: 3575, y: 1390 }, [
        "hyderabad-south-3",
        "maratha-central-5",
      ]),
    ],
    source,
    notes: ["Associated with the Madras Presidency."],
  },
  {
    id: "mysore",
    label: "Mysore",
    presidency: "madras",
    adjacentRegionIds: ["bombay", "hyderabad", "madras"],
    governorOfficeId: "governor-mysore",
    boardPosition: { x: 3710, y: 1590 },
    orders: [
      order("mysore-west-4", "mysore", 4, { x: 3820, y: 1535 }, [
        "bombay-south-4",
        "hyderabad-south-3",
        "madras-home-5",
      ]),
    ],
    source,
    notes: ["Associated with the Madras Presidency."],
  },
  {
    id: "madras",
    label: "Madras",
    presidency: "madras",
    adjacentRegionIds: ["hyderabad", "mysore"],
    governorOfficeId: "governor-madras",
    boardPosition: { x: 3500, y: 1740 },
    orders: [
      order("madras-home-5", "madras", 5, { x: 3525, y: 1680 }, [
        "hyderabad-south-3",
        "mysore-west-4",
      ], "madras"),
    ],
    source,
    notes: ["Madras is a Presidency home region."],
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
