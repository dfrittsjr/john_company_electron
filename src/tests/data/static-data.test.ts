import { describe, expect, test } from "vitest";
import {
  componentManifest,
  crownAiCards,
  familyActions,
  offices,
  requiredCrownAiCardFieldPaths,
  requiredScenarioIds,
  scenarios,
  stockExchangeTrack,
  validateComponentData,
  validateCrownData,
  validateFamilyActionData,
  validateNewGameStaticData,
  validateOfficeData,
  validateScenarioData,
  validateStockExchangeData,
} from "../../data";
import { createNewGame } from "../../engine";

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

describe("core hotseat data", () => {
  test("encodes physical component counts needed by starter rules", () => {
    const result = validateComponentData();

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(componentManifest.families).toEqual(
      expect.objectContaining({
        count: 6,
        familyMembersPerFamily: 18,
        promiseCardsPerFamily: 5,
      }),
    );
    expect(componentManifest.enterprises).toEqual({
      shipyards: 22,
      workshops: 20,
      luxuries: 16,
    });
  });

  test("encodes Family action costs and starter effects", () => {
    const result = validateFamilyActionData();

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(familyActions.map((action) => action.id).sort()).toEqual([
      "enlist-officer",
      "enlist-writer",
      "purchase-luxury",
      "purchase-shipyard",
      "purchase-workshop",
      "seek-share",
    ]);
    expect(familyActions.find((action) => action.id === "purchase-luxury")?.cost).toEqual({
      type: "fixed",
      amount: 4,
    });
    expect(familyActions.find((action) => action.id === "purchase-shipyard")?.cost).toEqual({
      type: "fixed",
      amount: 2,
    });
    expect(familyActions.find((action) => action.id === "purchase-workshop")?.cost).toEqual({
      type: "fixed",
      amount: 5,
    });
    expect(familyActions.find((action) => action.id === "seek-share")?.cost).toEqual({
      type: "stockExchangeSlot",
    });
  });

  test("encodes Stock Exchange prices and rightward order", () => {
    const result = validateStockExchangeData();

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(stockExchangeTrack.slots.map((slot) => slot.cost)).toEqual([2, 3, 3, 4, 5]);
    expect(stockExchangeTrack.slots.map((slot) => slot.rightwardOrder)).toEqual([1, 2, 3, 4, 5]);
    expect(stockExchangeTrack.shareCreation).toEqual(
      expect.objectContaining({
        debtReductionPerCreatedShare: 1,
        createdFrom: "rightmost",
        slideRemainingPieces: "rightwardPreservingOrder",
      }),
    );
  });

  test("initializes new hotseat games with encoded family supply and stock exchange slots", () => {
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "core-data-setup",
      gameId: "game-core-data-setup",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
      ],
    });

    expect(state.players["player-red"].familyMembers.supply).toBe(
      componentManifest.families.familyMembersPerFamily,
    );
    expect(state.company.stockExchange).toEqual(
      stockExchangeTrack.slots.map((slot) => ({
        id: slot.id,
        cost: slot.cost,
      })),
    );
  });

  test("encodes office cards and red-ribbon Company Operation order", () => {
    const result = validateOfficeData();

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(offices).toHaveLength(17);
    expect(
      offices
        .filter((office) => office.operationOrder !== undefined)
        .sort((a, b) => (a.operationOrder ?? 0) - (b.operationOrder ?? 0))
        .map((office) => office.id),
    ).toEqual([
      "chairman",
      "director-of-trade",
      "manager-of-shipping",
      "military-affairs",
      "president-bombay",
      "president-madras",
      "president-bengal",
      "superintendent-of-trade-in-china",
    ]);
    expect(offices.filter((office) => office.category === "governor").map((office) => office.region).sort()).toEqual([
      "bengal",
      "bombay",
      "delhi",
      "hyderabad",
      "madras",
      "maratha",
      "mysore",
      "punjab",
    ]);
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
