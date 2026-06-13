import { describe, expect, test } from "vitest";
import {
  crownAiCards,
  requiredCrownAiCardFieldPaths,
  requiredScenarioIds,
  scenarios,
  validateCrownData,
  validateNewGameStaticData,
  validateScenarioData,
} from "../../data";

describe("scenario starter data", () => {
  test("contains all required scenario ids", () => {
    expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(
      [...requiredScenarioIds].sort(),
    );
  });

  test("has enough metadata for starter data entry", () => {
    const result = validateScenarioData();

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("reports missing full scenario setup sections with explicit paths", () => {
    const result = validateScenarioData(scenarios, { requireComplete: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "scenario.setup-section-missing",
          path: "scenarios.1710.setup.mapSetup",
          message: expect.stringContaining("mapSetup"),
        }),
        expect.objectContaining({
          code: "scenario.setup-section-missing",
          path: "scenarios.1758.setup.companyTracks",
          message: expect.stringContaining("1758"),
        }),
      ]),
    );
  });
});

describe("Crown starter data", () => {
  test("reserves the ten Crown AI card identities", () => {
    expect(crownAiCards).toHaveLength(10);
    expect(crownAiCards.map((card) => card.id)).toEqual([
      "crown-ai-01",
      "crown-ai-02",
      "crown-ai-03",
      "crown-ai-04",
      "crown-ai-05",
      "crown-ai-06",
      "crown-ai-07",
      "crown-ai-08",
      "crown-ai-09",
      "crown-ai-10",
    ]);
  });

  test("requires every Crown AI card field from the design schema", () => {
    const result = validateCrownData();

    expect(result.valid).toBe(false);
    for (const fieldPath of requiredCrownAiCardFieldPaths) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "crown.ai-card-field-missing",
            path: `crown.aiCards.crown-ai-01.${fieldPath}`,
          }),
        ]),
      );
    }
  });

  test("blocks solo Crown mode while Crown AI cards are placeholders", () => {
    const result = validateNewGameStaticData({
      scenarioId: "1710",
      mode: "soloCrown",
      humanPlayerCount: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "new-game.crown.ai-card-field-missing",
          message: expect.stringContaining("soloCrown"),
          path: "crown.aiCards.crown-ai-01.climateIcon",
        }),
      ]),
    );
  });

  test("blocks two-player Crown mode while Crown AI cards are placeholders", () => {
    const result = validateNewGameStaticData({
      scenarioId: "1710",
      mode: "twoPlayerCrown",
      humanPlayerCount: 2,
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "new-game.crown.ai-card-field-missing",
          message: expect.stringContaining("twoPlayerCrown"),
          path: "crown.aiCards.crown-ai-01.climateIcon",
        }),
      ]),
    );
  });

  test("allows hotseat setup to use starter scenario data without Crown data", () => {
    const result = validateNewGameStaticData({
      scenarioId: "1710",
      mode: "hotseat",
      humanPlayerCount: 3,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
