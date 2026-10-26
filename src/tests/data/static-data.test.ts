import { describe, expect, test } from "vitest";
import {
  componentManifest,
  crownAiCards,
  enterpriseDecks,
  familyActions,
  mapData,
  offices,
  requiredScenarioIds,
  scenarios,
  setupCardDecks,
  staticData,
  stockExchangeTrack,
  validateComponentData,
  validateCrownData,
  validateEnterpriseData,
  validateFamilyActionData,
  validateMapData,
  validateNewGameStaticData,
  validateOfficeData,
  validateScenarioData,
  validateSetupCardData,
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
          path: "scenarios.1710.setup.lawsAndDilemmas",
          message: expect.stringContaining("lawsAndDilemmas"),
        }),
        expect.objectContaining({
          code: "scenario.setup-section-missing",
          path: "scenarios.1758.setup.mapSetup",
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

  test("encodes enterprise decks needed by Family purchase actions", () => {
    const result = validateEnterpriseData();
    const shipyardDeck = enterpriseDecks.find((deck) => deck.type === "shipyard");
    const workshopDeck = enterpriseDecks.find((deck) => deck.type === "workshop");
    const luxuryDeck = enterpriseDecks.find((deck) => deck.type === "luxury");

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(shipyardDeck?.cards).toHaveLength(22);
    expect(workshopDeck?.cards).toHaveLength(20);
    expect(luxuryDeck?.cards).toHaveLength(16);
    expect(shipyardDeck?.cards[0]).toEqual(
      expect.objectContaining({
        label: "Atlas",
        cost: 2,
        parliamentVotes: 1,
        bonusIncome: 1,
        shipTokenName: "Atlas",
      }),
    );
    expect(workshopDeck?.cards[0]).toEqual(
      expect.objectContaining({
        cost: 5,
        parliamentVotes: 2,
        bonusIncome: 1,
        failureVictoryPoints: 1,
      }),
    );
    expect(luxuryDeck?.cards[0]).toEqual(
      expect.objectContaining({
        cost: 4,
        victoryPoints: 2,
        windowTaxIcons: 1,
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

  test("encodes Presidencies, regions, home ports, and adjacency", () => {
    const result = validateMapData();
    const homePorts = mapData.regions
      .flatMap((region) => region.orders)
      .filter((order) => order.isHomePortFor)
      .map((order) => [order.isHomePortFor, order.id])
      .sort();

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(mapData.presidencies.map((presidency) => presidency.id).sort()).toEqual([
      "bengal",
      "bombay",
      "madras",
    ]);
    expect(mapData.regions.map((region) => region.id).sort()).toEqual([
      "bengal",
      "bombay",
      "delhi",
      "hyderabad",
      "madras",
      "maratha",
      "mysore",
      "punjab",
    ]);
    expect(homePorts).toEqual([
      ["bengal", "bengal-home-6"],
      ["bombay", "bombay-home-4"],
      ["madras", "madras-home-5"],
    ]);
    expect(mapData.regions.find((region) => region.id === "hyderabad")?.adjacentRegionIds.sort()).toEqual([
      "bombay",
      "madras",
      "maratha",
      "mysore",
    ]);
  });

  test("encodes the starter order graph with board positions", () => {
    const orders = mapData.regions.flatMap((region) => region.orders);

    expect(orders).toHaveLength(17);
    expect(orders.every((order) => order.connectedOrderIds.length > 0)).toBe(true);
    expect(
      orders.every(
        (order) =>
          order.boardPosition.x >= 0 &&
          order.boardPosition.x <= mapData.boardSize.width &&
          order.boardPosition.y >= 0 &&
          order.boardPosition.y <= mapData.boardSize.height,
      ),
    ).toBe(true);
  });

  test("encodes the 1710 setup card deck and extra-card distribution", () => {
    const result = validateSetupCardData();
    const deck1710 = setupCardDecks.find((deck) => deck.id === "1710");

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(deck1710).toBeDefined();
    expect(deck1710?.baseCardsForThreeOrFourPlayers).toBe(12);
    expect(deck1710?.extraCardsForFivePlayers).toBe(3);
    expect(deck1710?.extraCardsForSixPlayers).toBe(6);
    expect(deck1710?.cards.filter((card) => !card.extra)).toHaveLength(12);
    expect(deck1710?.cards.filter((card) => card.extra)).toHaveLength(6);
  });

  test("encodes representative 1710 setup card effects", () => {
    const deck1710 = setupCardDecks.find((deck) => deck.id === "1710");

    expect(deck1710?.cards.find((card) => card.id === "1710-01-chairman-share")?.effects).toEqual([
      { type: "office", officeId: "chairman" },
      { type: "companyShare", count: 1 },
      { type: "cash", amount: 1 },
    ]);
    expect(
      deck1710?.cards.find((card) => card.id === "1710-08-commander-bombay-writer")?.effects,
    ).toEqual([
      { type: "commander", army: "bombay" },
      { type: "writer", presidency: "bombay", count: 1 },
      { type: "cash", amount: 4 },
    ]);
    expect(
      deck1710?.cards.find((card) => card.id === "1710-extra-02-two-unfitted-shipyards")
        ?.effects,
    ).toEqual([{ type: "shipyard", count: 2, ship: { status: "unfitted" } }]);
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

  test("has every AI card field, from the transcribed cards", () => {
    expect(validateCrownData()).toMatchObject({ valid: true });
    for (const card of crownAiCards) {
      expect(card.climateBands.length).toBeGreaterThanOrEqual(3);
      expect(card.regionPriority).toHaveLength(8);
      expect(new Set(card.regionPriority).size).toBe(8);
      expect(new Set(card.back.presidencies)).toEqual(new Set(["bombay", "madras", "bengal"]));
      expect(card.firstArrow).not.toBe(card.secondArrow);
    }
    // Rulebook p.45's example: card 1 is Company Expectations, £4 peacock / £6 lion / £8+ bull,
    // left slot, regions Madras first and Bengal last.
    expect(crownAiCards[0]).toMatchObject({
      criterion: "Company Expectations",
      climateBands: [
        { range: "£4", climate: "peacock" },
        { range: "£6", climate: "lion" },
        { range: "£8+", climate: "bull" },
      ],
      splaySlot: "left",
    });
    expect(crownAiCards[0].regionPriority[0]).toBe("madras");
    expect(crownAiCards[0].regionPriority[7]).toBe("bengal");
  });

  test("reports a missing AI card field", () => {
    const [first, ...rest] = crownAiCards;
    const broken = { ...first, splaySlot: undefined } as unknown as typeof first;
    const result = validateCrownData({ ...staticData.crown, aiCards: [broken, ...rest] });
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "crown.ai-card-field-missing", path: "crown.aiCards.crown-ai-01.splaySlot" })]),
    );
  });

  test("allows the Crown modes now the Crown's behaviour is built", () => {
    for (const [mode, humanPlayerCount] of [["soloCrown", 1], ["twoPlayerCrown", 2]] as const) {
      const result = validateNewGameStaticData({ scenarioId: "1710", mode, humanPlayerCount });
      expect(result.valid).toBe(true);
      expect(result.issues.map((issue) => issue.code)).not.toContain("new-game.crown-not-built");
    }
  });
});
