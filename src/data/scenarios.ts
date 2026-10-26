import type { ScenarioDefinition, ScenarioSetupSection } from "./types";

const fullScenarioSections: ScenarioSetupSection[] = [
  "companyTracks",
  "turnAndPolicyDial",
  "startingRegiments",
  "startingCompanyShips",
  "mapSetup",
  "lawsAndDilemmas",
  "setupDeck",
  "deregulation",
];

const missingSections = (encodedSections: ScenarioSetupSection[]): ScenarioSetupSection[] =>
  fullScenarioSections.filter((section) => !encodedSections.includes(section));

// Scenario card fronts: "John Company Cards (Bridge, Fronts).pdf" p.9.
// "Situation in India" backs: "John Company Cards (Bridge, Bridge).pdf" p.9 (printed page 20).
// Start and final turns come from the dates and end markers on the board's Turn track.
const earlyCompanySections: ScenarioSetupSection[] = [
  "companyTracks",
  "turnAndPolicyDial",
  "startingRegiments",
  "startingCompanyShips",
  "mapSetup",
  "setupDeck",
];

const earlyCompanySetup: ScenarioDefinition["setup"] = {
  companyTracks: {
    standingSpace: 4,
    debt: 0,
    officeTreasury: 3,
  },
  startingRegiments: {
    bombay: 1,
    madras: 1,
    bengal: 1,
  },
  startingCompanyShips: {
    bombay: 0,
    madras: 0,
    bengal: 0,
  },
  startingPassedLaws: ["Royal Protection"],
  mapSetup: {
    regions: {
      punjab: { towerLevels: 0, closedOrderIds: ["punjab-7"] },
      delhi: { towerLevels: 1, closedOrderIds: ["delhi-west-3", "delhi-east-5"] },
      bombay: { towerLevels: 1, closedOrderIds: ["bombay-east-3"] },
      maratha: { towerLevels: 2, closedOrderIds: ["maratha-west-3"] },
      bengal: { towerLevels: 1, closedOrderIds: [] },
      hyderabad: { towerLevels: 1, closedOrderIds: ["hyderabad-7"] },
      mysore: { towerLevels: 1, closedOrderIds: [] },
      madras: { towerLevels: 1, closedOrderIds: ["madras-south-4"] },
    },
    empires: [{ capital: "delhi", dominated: ["punjab", "maratha"] }],
    companyControlled: [],
    elephant: { region: "maratha", facing: "delhi" },
  },
  notes: [
    "Standing starts on the space above £10 expectations; Debt 0; £3 in every Company treasury.",
    "Royal Protection starts passed, but law cards are not encoded yet.",
    "The Elephant starts on the Maratha-Delhi border facing Delhi: a looming Maratha Rebellion against Delhi.",
  ],
  encodedSections: earlyCompanySections,
  missingSections: missingSections(earlyCompanySections),
};

export const scenarios: ScenarioDefinition[] = [
  {
    id: "1710",
    name: "Early Company",
    displayYear: "1710",
    recommendedPlayerCounts: [3, 4, 5, 6],
    startTurn: 1,
    finalTurn: 5,
    deregulationAvailable: false,
    startsDeregulated: false,
    completeness: "starter",
    source: "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf",
    setup: earlyCompanySetup,
  },
  {
    id: "1758",
    name: "Company Under Siege",
    displayYear: "1758",
    recommendedPlayerCounts: [3, 4, 5, 6],
    startTurn: 3,
    finalTurn: 7,
    deregulationAvailable: true,
    startsDeregulated: false,
    completeness: "complete",
    source: "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf",
    setup: {
      companyTracks: {
        standingSpace: 5,
        debt: 3,
        officeTreasury: 4,
      },
      startingRegiments: {
        bombay: 1,
        madras: 1,
        bengal: 1,
      },
      startingCompanyShips: {
        bengal: 1,
      },
      startingPassedLaws: ["Calico Acts"],
      mapSetup: {
        regions: {
          punjab: { towerLevels: 1, closedOrderIds: ["punjab-7"] },
          delhi: { towerLevels: 1, closedOrderIds: ["delhi-west-3", "delhi-east-5"] },
          bombay: { towerLevels: 2, closedOrderIds: [] },
          maratha: { towerLevels: 2, closedOrderIds: [] },
          // Company-controlled: the red Governor overlay stands where the 1710 map has Bengal's dome.
          bengal: { towerLevels: 0, closedOrderIds: [] },
          hyderabad: { towerLevels: 1, closedOrderIds: ["hyderabad-7"] },
          mysore: { towerLevels: 2, closedOrderIds: ["mysore-south-6"] },
          madras: { towerLevels: 1, closedOrderIds: ["madras-home-5", "madras-south-4"] },
        },
        empires: [{ capital: "delhi", dominated: ["punjab"] }],
        // "Place the Bengal control token in the Bengal Presidency" (scenario card): the region is
        // Company-controlled and associated with Bengal, with its Governor office in play (p.23).
        companyControlled: ["bengal"],
        associatedPresidency: { bengal: "bengal" },
        governorOffices: ["bengal"],
        elephant: { region: "delhi", facing: "bengal" },
      },
      notes: [
        "Standing starts on the space above £12 expectations; Debt 3; £4 in every Company treasury.",
        "One Company ship starts in the East Indian sea zone. The Bengal control token starts in the Bengal Presidency.",
        "Situation in India (Bridge Backs p.9): Delhi is the capital of an empire dominating Punjab; the Elephant starts in Delhi facing Bengal.",
        "Bengal starts Company-controlled and associated with the Bengal Presidency, with no tower and the Governor of Bengal office in play (the setup cards fill it).",
        "The London Season is skipped on turn 3, the first turn (p.11).",
      ],
      encodedSections: fullScenarioSections,
      missingSections: [],
    },
  },
  {
    id: "1813",
    name: "Post Monopoly",
    displayYear: "1813",
    // The rulebook recommends 5-6 players (p.4); fewer work, the setup cards are the same.
    recommendedPlayerCounts: [3, 4, 5, 6],
    startTurn: 5,
    finalTurn: 8,
    deregulationAvailable: true,
    startsDeregulated: true,
    completeness: "complete",
    source: "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf",
    setup: {
      companyTracks: {
        standingSpace: 4,
        debt: 0,
        officeTreasury: 3,
      },
      startingRegiments: {
        bombay: 2,
        madras: 2,
        bengal: 2,
      },
      startingCompanyShips: {
        bombay: 1,
        madras: 1,
        bengal: 1,
      },
      startingPassedLaws: ["Military Oversight", "Deregulation (Debtor's Prison side)", "Calico Acts"],
      mapSetup: {
        regions: {
          punjab: { towerLevels: 2, closedOrderIds: ["punjab-7"] },
          delhi: { towerLevels: 1, closedOrderIds: ["delhi-west-3", "delhi-east-5"] },
          bombay: { towerLevels: 0, closedOrderIds: [] },
          maratha: { towerLevels: 2, closedOrderIds: ["maratha-west-3"] },
          bengal: { towerLevels: 0, closedOrderIds: ["bengal-north-5", "bengal-home-6"] },
          hyderabad: { towerLevels: 1, closedOrderIds: [] },
          mysore: { towerLevels: 2, closedOrderIds: [] },
          madras: { towerLevels: 0, closedOrderIds: ["madras-south-4"] },
        },
        empires: [],
        // "Place the Bombay/Madras/Bengal control tokens in the matching Presidencies" (scenario card).
        // The Governor General is in play, so no Governors or overlays exist (p.26).
        companyControlled: ["bombay", "madras", "bengal"],
        associatedPresidency: { bombay: "bombay", madras: "madras", bengal: "bengal" },
        governorOffices: [],
        elephant: { region: "mysore", facing: "madras" },
      },
      governorGeneral: true,
      chinaOffice: true,
      notes: [
        "Standing starts on the space above £10 expectations; Debt 0; £3 in every Company treasury.",
        "Governor General law returns to the box and its overlay goes over the Director of Trade.",
        "Company share VP token starts in the Court on its +2/-2 side. China office is placed right of the board.",
        "Bombay/Madras/Bengal control tokens start in the matching Presidencies: all three are Company-controlled with no towers. With the Governor General in play there are no Governors (p.26).",
        "Situation in India (Bridge Backs p.9): no empires; the Elephant starts in Mysore facing Madras.",
        "The rulebook recommends 5-6 players (p.4), but the setup cards work with 3-6.",
        "The London Season is skipped on turn 5, the first turn (p.11).",
      ],
      encodedSections: fullScenarioSections,
      missingSections: [],
    },
  },
  {
    id: "long-1710",
    name: "Long 1710",
    displayYear: "Long 1710",
    recommendedPlayerCounts: [3, 4, 5, 6],
    startTurn: 1,
    finalTurn: 8,
    deregulationAvailable: true,
    startsDeregulated: false,
    completeness: "placeholder",
    source: "printnplay/Rulebooks/John Company Rules.pdf",
    setup: {
      ...earlyCompanySetup,
      notes: [
        ...earlyCompanySetup.notes,
        "Rulebook p.4: begins identically to 1710 but adds Deregulation and may run up to 8 turns.",
      ],
      encodedSections: earlyCompanySections,
      missingSections: missingSections(earlyCompanySections),
    },
  },
];

export const scenarioIds = scenarios.map((scenario) => scenario.id);
