import type { ComponentManifest } from "./types";

export const componentManifest: ComponentManifest = {
  source: "John-Company-Rules.txt",
  families: {
    count: 6,
    familyMembersPerFamily: 18,
    victoryPointMarkersPerFamily: 1,
    promiseCardsPerFamily: 5,
    opportunityMarkersPerFamily: 1,
    firmCubesPerFamily: 2,
    firmStrategyCardsPerFamily: 4,
  },
  money: {
    bankUnlimited: true,
    denominations: [
      { value: 1, count: 40 },
      { value: 2, count: 20 },
      { value: 5, count: 20 },
      { value: 10, count: 10 },
    ],
  },
  enterprises: {
    shipyards: 22,
    workshops: 20,
    luxuries: 16,
  },
  offices: {
    officeCards: 17,
  },
  crown: {
    aiCards: 10,
    promiseCubes: 12,
  },
};
