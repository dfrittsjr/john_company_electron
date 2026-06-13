import type { EnterpriseCardDefinition, EnterpriseDeckDefinition, EnterpriseType } from "./types";

const source = "John-Company-Rules.txt" as const;

const enterprise = (
  type: EnterpriseType,
  id: string,
  label: string,
  overrides: Partial<EnterpriseCardDefinition> = {},
): EnterpriseCardDefinition => ({
  id,
  type,
  label,
  source,
  cost: type === "workshop" ? 5 : type === "luxury" ? 4 : 2,
  parliamentVotes: type === "workshop" ? 2 : type === "shipyard" ? 1 : 0,
  bonusIncome: type === "luxury" ? 0 : 1,
  victoryPoints: type === "luxury" ? 2 : 0,
  failureVictoryPoints: type === "workshop" ? 1 : 0,
  windowTaxIcons: type === "luxury" ? 1 : 0,
  notes: [],
  ...overrides,
});

const shipyardNames = [
  "Atlas",
  "Britannia",
  "Constant Friend",
  "Diligence",
  "Eliza",
  "Fortitude",
  "Ganges",
  "Hampshire",
  "Indefatigable",
  "James",
  "King George",
  "Lady Flora",
  "Neptune",
  "Obra Dinn",
  "Queen Charlotte",
  "Recovery",
  "Samaritan",
  "Thistleworth",
  "Union",
  "Walpole",
  "York",
  "Zenobia",
];

const numberedCards = (type: Extract<EnterpriseType, "workshop" | "luxury">, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const label = `${type === "workshop" ? "Workshop" : "Luxury"} ${number}`;

    return enterprise(type, `${type}-${number}`, label, {
      notes: [
        "The card front is functionally anonymous for rules enforcement; keep the numbered id stable for deck order.",
      ],
    });
  });

export const enterpriseDecks: EnterpriseDeckDefinition[] = [
  {
    type: "shipyard",
    source,
    cards: shipyardNames.map((name, index) =>
      enterprise("shipyard", `shipyard-${String(index + 1).padStart(2, "0")}`, name, {
        shipTokenName: name,
        notes: ["Shipyard name also identifies the matching player-owned ship token."],
      }),
    ),
  },
  {
    type: "workshop",
    source,
    cards: numberedCards("workshop", 20),
  },
  {
    type: "luxury",
    source,
    cards: numberedCards("luxury", 16),
  },
];
