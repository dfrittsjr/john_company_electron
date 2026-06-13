import type { ScenarioDefinition, ScenarioSetupSection } from "./types";

const commonCompleteSections: ScenarioSetupSection[] = [
  "companyTracks",
  "turnAndPolicyDial",
  "startingRegiments",
  "startingCompanyShips",
];

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

const missingAfterStarter = (
  encodedSections: ScenarioSetupSection[],
): ScenarioSetupSection[] =>
  fullScenarioSections.filter((section) => !encodedSections.includes(section));

export const scenarios: ScenarioDefinition[] = [
  {
    id: "1710",
    name: "Early Company",
    displayYear: "1710",
    recommendedPlayerCounts: [3, 4, 5, 6],
    deregulationAvailable: false,
    startsDeregulated: false,
    completeness: "starter",
    source: "rulebook-scenario-1710",
    setup: {
      companyTracks: {
        standingExpectationSpace: 10,
        debt: 0,
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
      notes: [
        "Rulebook setup text states the Standing marker begins above GBP 10 expectations, Debt begins at 0, each Presidency army begins with one regiment, and there are no starting Company ships.",
      ],
      encodedSections: commonCompleteSections,
      missingSections: missingAfterStarter(commonCompleteSections),
    },
  },
  {
    id: "1758",
    name: "Monopoly Company",
    displayYear: "1758",
    recommendedPlayerCounts: [3, 4, 5, 6],
    deregulationAvailable: true,
    startsDeregulated: false,
    completeness: "placeholder",
    source: "rulebook-scenario-1758",
    setup: {
      companyTracks: {},
      startingRegiments: {},
      startingCompanyShips: {},
      notes: [
        "Scenario shell reserved for the 1758 scenario card. Exact setup tracks, map state, laws, and setup deck contents still need transcription from source material.",
      ],
      encodedSections: [],
      missingSections: missingAfterStarter([]),
    },
  },
  {
    id: "1813",
    name: "Deregulated Company",
    displayYear: "1813",
    recommendedPlayerCounts: [5, 6],
    deregulationAvailable: true,
    startsDeregulated: true,
    completeness: "placeholder",
    source: "rulebook-scenario-1813",
    setup: {
      companyTracks: {},
      startingRegiments: {},
      startingCompanyShips: {},
      notes: [
        "Scenario shell reserved for the advanced 1813 scenario. It starts without the monopoly and must eventually include firm/deregulation setup data.",
      ],
      encodedSections: ["deregulation"],
      missingSections: missingAfterStarter(["deregulation"]),
    },
  },
  {
    id: "long-1710",
    name: "Long 1710",
    displayYear: "Long 1710",
    recommendedPlayerCounts: [3, 4, 5, 6],
    turnLimit: 8,
    deregulationAvailable: true,
    startsDeregulated: false,
    completeness: "placeholder",
    source: "rulebook-scenario-long-1710",
    setup: {
      companyTracks: {
        standingExpectationSpace: 10,
        debt: 0,
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
      notes: [
        "Rulebook overview says Long 1710 begins identically to 1710 but adds Deregulation tools and can run up to eight turns.",
      ],
      encodedSections: [...commonCompleteSections, "deregulation"],
      missingSections: missingAfterStarter([...commonCompleteSections, "deregulation"]),
    },
  },
];

export const scenarioIds = scenarios.map((scenario) => scenario.id);
