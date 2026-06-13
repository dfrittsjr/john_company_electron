import type { FamilyActionDefinition } from "./types";

export const familyActions: FamilyActionDefinition[] = [
  {
    id: "enlist-writer",
    label: "Enlist Writer",
    source: "John-Company-Rules.txt",
    cost: { type: "none" },
    placesFamilyMember: true,
    notes: [
      "Place one family member in one of the three regional Writers boxes.",
      "If there are four or more vacant offices, the action may place an additional writer once this turn.",
    ],
  },
  {
    id: "enlist-officer",
    label: "Enlist Officer",
    source: "John-Company-Rules.txt",
    cost: { type: "none" },
    placesFamilyMember: true,
    notes: ["Place one family member in the Officers-in-Training box."],
  },
  {
    id: "purchase-luxury",
    label: "Purchase Luxury",
    source: "John-Company-Rules.txt",
    cost: { type: "fixed", amount: 4 },
    placesFamilyMember: false,
    enterpriseType: "luxury",
    victoryPoints: 2,
    notes: [
      "Take one luxury.",
      "Each luxury gives 2 victory points while in possession and has a window tax icon.",
    ],
  },
  {
    id: "purchase-shipyard",
    label: "Purchase Shipyard",
    source: "John-Company-Rules.txt",
    cost: { type: "fixed", amount: 2 },
    placesFamilyMember: false,
    enterpriseType: "shipyard",
    parliamentVotes: 1,
    bonusIncome: 1,
    notes: [
      "Take one shipyard and place the matching ship token on the shipyard in the indicated space.",
      "Shipyards provide GBP 1 during Bonuses if their ship has been fitted.",
    ],
  },
  {
    id: "purchase-workshop",
    label: "Purchase Workshop",
    source: "John-Company-Rules.txt",
    cost: { type: "fixed", amount: 5 },
    placesFamilyMember: false,
    enterpriseType: "workshop",
    parliamentVotes: 2,
    bonusIncome: 1,
    notes: [
      "Take one workshop.",
      "Workshops provide GBP 1 during Bonuses and are worth 1 VP if the Company fails.",
    ],
  },
  {
    id: "seek-share",
    label: "Seek Share",
    source: "John-Company-Rules.txt",
    cost: { type: "stockExchangeSlot" },
    placesFamilyMember: true,
    notes: [
      "Place a family member on an empty Stock Exchange space and pay that space's printed price.",
      "These family members may become Company shares at the end of the Family phase.",
    ],
  },
];
