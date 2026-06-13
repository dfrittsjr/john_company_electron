import type {
  CrownAiCardId,
  CrownAiCardPlaceholder,
  CrownDifficultySetting,
  CrownSetupDistribution,
} from "./types";

export const CROWN_AI_CARD_COUNT = 10;
export const CROWN_PROMISE_CUBE_COUNT = 12;

export const crownAiCards: CrownAiCardPlaceholder[] = Array.from(
  { length: CROWN_AI_CARD_COUNT },
  (_, index) => {
    const number = String(index + 1).padStart(2, "0");

    return {
      id: `crown-ai-${number}` as CrownAiCardId,
      source: "crown-handbook",
      placeholderReason:
        "Card identity is reserved, but Crown Handbook card fields have not been transcribed yet.",
    };
  },
);

export const crownSetupDistributions: CrownSetupDistribution[] = [
  {
    mode: "soloCrown",
    variant: "draft",
    humanSetupCards: 4,
    crownSetupCards: 8,
    promiseCubesWithCrown: 6,
    promiseCubesPerHuman: 6,
    source: "docs/crown-ai-design.md",
  },
  {
    mode: "soloCrown",
    variant: "random",
    humanSetupCards: 4,
    crownSetupCards: 8,
    promiseCubesWithCrown: 6,
    promiseCubesPerHuman: 6,
    source: "docs/crown-ai-design.md",
  },
  {
    mode: "twoPlayerCrown",
    variant: "draft",
    humanSetupCards: 4,
    crownSetupCards: 4,
    promiseCubesWithCrown: 4,
    promiseCubesPerHuman: 4,
    source: "docs/crown-ai-design.md",
  },
];

export const crownDifficultySettings: CrownDifficultySetting[] = [
  {
    id: "easy",
    source: "docs/crown-ai-design.md",
    promiseCardCubeTradesAllowed: true,
    additionalCrownPromiseCubes: 0,
    extraSetupCards: 0,
  },
  {
    id: "normal",
    source: "docs/crown-ai-design.md",
    promiseCardCubeTradesAllowed: false,
    additionalCrownPromiseCubes: 0,
    extraSetupCards: 0,
  },
  {
    id: "hard",
    source: "docs/crown-ai-design.md",
    promiseCardCubeTradesAllowed: false,
    additionalCrownPromiseCubes: 4,
    extraSetupCards: 0,
  },
  {
    id: "expert",
    source: "docs/crown-ai-design.md",
    promiseCardCubeTradesAllowed: false,
    additionalCrownPromiseCubes: 4,
    extraSetupCards: 3,
  },
];
