import { describe, expect, it } from "vitest";
import {
  applyCommand,
  chairmanHolder,
  commanderOf,
  createNewGame,
  playerCourtShares,
  playerOffices,
  playerOfficers,
  playerStockExchangeSlots,
  playerWriters,
  presidentOf,
  type GameState,
} from "../../engine";
import {
  withAssociatedRegion,
  withCash,
  withCommander,
  withCourtShares,
  withFilledOrder,
  withHiringQueue,
  withNoSupply,
  withOffice,
  withOfficers,
  withOfficersInTraining,
  withRegiments,
  withWriterOnOrder,
  withWriters,
} from "../fixtures/builders";
import {
  advanceThroughStarterFamily,
  advanceThroughStarterHiring,
  applyCommandOrThrow,
  applyFirstLegalCommand,
  createHotseatGame,
  expectGameInvariants,
  expectSaveRoundTripPreservesPendingDecision,
} from "../fixtures/game";

describe("command application", () => {
  it("reports unknown command types explicitly", () => {
    const state = createHotseatGame({
      seed: "unknown-command",
      gameId: "game-unknown-command",
    });
    const result = applyCommand(state, {
      id: "command-1",
      gameId: state.gameId,
      actorId: state.pendingDecision.actor === "simultaneous" ? "player-red" : state.pendingDecision.actor,
      decisionId: state.pendingDecision.id,
      type: "not.a.real.command",
      payload: {},
      clientTimestamp: "2026-06-13T12:01:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "UNKNOWN_COMMAND",
        }),
      );
    }
  });

  it("creates legal Family actions after setup is confirmed", () => {
    const state = createHotseatGame({
      seed: "family-actions",
      gameId: "game-family-actions",
    });
    const result = applyCommand(state, {
      id: "command-setup",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "setup.confirmStart",
      payload: {},
      clientTimestamp: "2026-06-13T12:01:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.pendingDecision.step).toBe("family.chooseAction");
      expect(result.state.pendingDecision.legalCommands.map((command) => command.label)).toEqual([
        "Enlist Writer (Bombay)",
        "Enlist Writer (Madras)",
        "Enlist Writer (Bengal)",
        "Enlist Officer",
      ]);
    }
  });

  it("deals and applies random hotseat 1710 setup cards by default", () => {
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "random-1710-setup",
      gameId: "game-random-1710-setup",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
      ],
    });
    const nextState = applyCommandOrThrow(state, {
      id: "command-setup-random",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: state.pendingDecision.legalCommands[0]?.payload ?? {},
      clientTimestamp: "2026-06-13T12:01:00.000Z",
    });
    const distribution = nextState.log.at(-1)?.details as {
      setupCardDistribution: Record<string, string[]>;
      removedSetupCards: string[];
    };

    expect(nextState.phase).toBe("family");
    expect(Object.values(distribution.setupCardDistribution).map((cards) => cards.length)).toEqual([
      4,
      4,
      4,
    ]);
    expect(nextState.decks["setup-1710"]).toEqual({
      drawPile: [],
      discardPile: expect.arrayContaining(Object.values(distribution.setupCardDistribution).flat()),
      removed: distribution.removedSetupCards,
    });
    expect(nextState.decks["setup-1710"].discardPile).toHaveLength(12);
    expect(nextState.decks["setup-1710"].removed).toHaveLength(6);
    expect(totalPlayerCash(nextState)).toBe(21);
    expect(nextState.company.court).toHaveLength(5);
    expect(Object.values(nextState.company.offices).filter((office) => office.holder)).toHaveLength(7);
    expect(nextState.company.ships.map((ship) => ship.location).sort()).toEqual([
      "east-indian",
      "south-indian",
      "west-indian",
    ]);
    expect(totalEnterprises(nextState, "shipyard")).toBe(3);
    expect(totalWriters(nextState)).toBe(3);
    expect(totalCommanders(nextState)).toBe(3);
    expect(totalBlackmail(nextState)).toBe(1);
    expect(totalFamilySupply(nextState)).toBe(36);
    expectSaveRoundTripPreservesPendingDecision(nextState);
  });

  it("adds three extra setup cards for five-player random 1710 setup", () => {
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "random-1710-setup-five-player",
      gameId: "game-random-1710-setup-five-player",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
        { id: "player-green", name: "Green", color: "green" },
        { id: "player-purple", name: "Purple", color: "purple" },
      ],
    });
    const nextState = applyCommandOrThrow(state, {
      id: "command-setup-random-five-player",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: state.pendingDecision.legalCommands[0]?.payload ?? {},
      clientTimestamp: "2026-06-13T12:01:00.000Z",
    });
    const distribution = nextState.log.at(-1)?.details as {
      setupCardDistribution: Record<string, string[]>;
      removedSetupCards: string[];
    };

    expect(Object.values(distribution.setupCardDistribution).map((cards) => cards.length)).toEqual([
      3,
      3,
      3,
      3,
      3,
    ]);
    expect(nextState.decks["setup-1710"].discardPile).toHaveLength(15);
    expect(nextState.decks["setup-1710"].removed).toHaveLength(3);
  });

  it("places a writer and advances to the next human player", () => {
    const state = createHotseatGame({
      seed: "family-action-next-player",
      gameId: "game-family-action-next-player",
    });
    const setupResult = applyCommand(state, {
      id: "command-setup",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "setup.confirmStart",
      payload: {},
      clientTimestamp: "2026-06-13T12:01:00.000Z",
    });

    expect(setupResult.ok).toBe(true);
    if (!setupResult.ok) return;

    const familyCommand = setupResult.state.pendingDecision.legalCommands.find(
      (command) => command.label === "Enlist Writer (Bombay)",
    );
    expect(familyCommand).toBeDefined();

    const familyResult = applyCommand(setupResult.state, {
      id: "command-family",
      gameId: setupResult.state.gameId,
      actorId: "player-red",
      decisionId: setupResult.state.pendingDecision.id,
      type: familyCommand?.type ?? "family.chooseAction",
      payload: familyCommand?.payload ?? {},
      clientTimestamp: "2026-06-13T12:02:00.000Z",
    });

    expect(familyResult.ok).toBe(true);
    if (familyResult.ok) {
      expect(familyResult.state.players["player-red"].opportunityMarker).toBe("enlist-writer");
      expect(familyResult.state.players["player-red"].familyMembers.supply).toBe(17);
      expect(playerWriters(familyResult.state, "player-red").Bombay).toBe(1);
      expect(familyResult.state.india.presidencies.Bombay.writers["player-red"]).toBe(1);
      expect(familyResult.state.pendingDecision.actor).toBe("player-blue");
      expect(familyResult.state.log.at(-1)?.summary).toBe("Red chose Enlist Writer.");
    }
  });

  it("filters Family actions by cash, pieces, stock exchange slots, and enterprise supply", () => {
    const state = startFamilyWithRedCash(5, "family-filtering");

    expect(state.pendingDecision.legalCommands.map((command) => command.label)).toEqual([
      "Enlist Writer (Bombay)",
      "Enlist Writer (Madras)",
      "Enlist Writer (Bengal)",
      "Enlist Officer",
      // Seek Share may use any empty Stock Exchange space the player can afford (p.14).
      "Seek Share (£2, stock-exchange-2)",
      "Seek Share (£3, stock-exchange-3-left)",
      "Seek Share (£3, stock-exchange-3-right)",
      "Seek Share (£4, stock-exchange-4)",
      "Seek Share (£5, stock-exchange-5)",
      "Purchase Shipyard (£2)",
      "Purchase Workshop (£5)",
      "Purchase Luxury (£4)",
    ]);
  });

  it("rejects Family action payloads that are not legal for the current resources", () => {
    const state = startFamilyWithRedCash(0, "family-illegal-purchase");
    const result = applyCommand(state, {
      id: "command-family-illegal",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "family.chooseAction",
      payload: { action: "purchase-workshop" },
      clientTimestamp: "2026-06-13T12:02:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_FAMILY_ACTION",
          field: "payload.action",
        }),
      );
    }
  });

  it("places an officer in training", () => {
    const state = startFamilyWithRedCash(0, "family-officer");
    const nextState = applyFamilyCommandByAction(state, "enlist-officer");

    expect(nextState.players["player-red"].familyMembers.supply).toBe(17);
    expect(nextState.players["player-red"].familyMembers.officersInTraining).toBe(1);
    expect(nextState.players["player-red"].opportunityMarker).toBe("enlist-officer");
  });

  it("offers an optional repeat when the opportunity marker started on the chosen action", () => {
    let state = startFamilyWithRedCash(0, "family-repeat-writer", {
      opportunityMarker: "enlist-writer",
    });

    state = applyFamilyCommandByAction(state, "enlist-writer", {
      commandId: "command-repeat-writer-bombay",
      payload: { action: "enlist-writer", presidency: "Bombay" },
    });

    expect(state.pendingDecision.step).toBe("family.chooseRepeatAction");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.players["player-red"].opportunityMarker).toBe("enlist-writer");
    expect(state.players["player-red"].familyMembers.supply).toBe(17);
    expectSaveRoundTripPreservesPendingDecision(state);
    expect(
      state.pendingDecision.legalCommands
        .filter((command) => command.type === "family.chooseAction")
        .map((command) => (command.payload as { action?: string }).action),
    ).toEqual(["enlist-writer", "enlist-writer", "enlist-writer"]);
    expect(state.pendingDecision.legalCommands.at(-1)).toEqual(
      expect.objectContaining({
        type: "family.finishAction",
      }),
    );

    state = applyFamilyCommandByAction(state, "enlist-writer", {
      commandId: "command-repeat-writer-madras",
      payload: { action: "enlist-writer", presidency: "Madras" },
    });

    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.players["player-red"].familyMembers.supply).toBe(16);
    expect(playerWriters(state, "player-red").Bombay).toBe(1);
    expect(playerWriters(state, "player-red").Madras).toBe(1);
    expect(state.players["player-red"].opportunityMarker).toBe("enlist-writer");
    expect(state.log.at(-1)?.summary).toBe("Red repeated Enlist Writer.");
  });

  it("allows a player to decline an optional opportunity-marker repeat", () => {
    let state = startFamilyWithRedCash(0, "family-repeat-skip", {
      opportunityMarker: "enlist-writer",
    });

    state = applyFamilyCommandByAction(state, "enlist-writer", {
      commandId: "command-repeat-skip-writer",
      payload: { action: "enlist-writer", presidency: "Bombay" },
    });

    const finishCommand = state.pendingDecision.legalCommands.find(
      (command) => command.type === "family.finishAction",
    );
    expect(finishCommand).toBeDefined();

    state = applyCommandOrThrow(state, {
      id: "command-repeat-skip-finish",
      actorId: "player-red",
      type: finishCommand?.type ?? "family.finishAction",
      payload: finishCommand?.payload ?? {},
      clientTimestamp: "2026-06-13T12:03:00.000Z",
    });

    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.players["player-red"].familyMembers.supply).toBe(17);
    expect(playerWriters(state, "player-red").Bombay).toBe(1);
    expect(state.players["player-red"].opportunityMarker).toBe("enlist-writer");
    expect(state.log.at(-1)?.summary).toBe("Red finished Enlist Writer.");
  });

  it("moves the opportunity marker without repeating when choosing a different action", () => {
    const state = startFamilyWithRedCash(0, "family-marker-move", {
      opportunityMarker: "enlist-writer",
    });
    const nextState = applyFamilyCommandByAction(state, "enlist-officer");

    expect(nextState.pendingDecision.actor).toBe("player-blue");
    expect(nextState.players["player-red"].familyMembers.officersInTraining).toBe(1);
    expect(nextState.players["player-red"].opportunityMarker).toBe("enlist-officer");
  });

  it("places a family member on the cheapest affordable Stock Exchange slot", () => {
    const state = startFamilyWithRedCash(2, "family-seek-share");
    const nextState = applyFamilyCommandByAction(state, "seek-share");

    expect(nextState.players["player-red"].cash).toBe(0);
    expect(nextState.players["player-red"].familyMembers.supply).toBe(17);
    expect(playerStockExchangeSlots(nextState, "player-red")).toEqual([
      "stock-exchange-2",
    ]);
    expect(nextState.company.stockExchange[0].share).toEqual(
      expect.objectContaining({
        owner: "player-red",
      }),
    );
  });

  it("converts rightmost Stock Exchange family members into Company shares when debt exists", () => {
    let state = startFamilyWithRedCash(2, "family-share-creation", {
      companyDebt: 1,
    });

    state = applyFamilyCommandByAction(state, "seek-share", "command-seek-share");
    state = applyFirstLegalCommand(state, {
      commandId: "command-blue-family",
      actorId: "player-blue",
    });
    state = applyFirstLegalCommand(state, {
      commandId: "command-yellow-family",
      actorId: "player-yellow",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.debt).toBe(0);
    expect(state.company.court).toEqual([
      expect.objectContaining({
        owner: "player-red",
      }),
    ]);
    expect(playerCourtShares(state, "player-red")).toBe(1);
    expect(playerStockExchangeSlots(state, "player-red")).toEqual([]);
    expect(state.company.stockExchange[0].share).toBeUndefined();
  });

  it("recomputes legal Stock Exchange slots for a repeated Seek Share action", () => {
    let state = startFamilyWithRedCash(5, "family-repeat-seek-share", {
      opportunityMarker: "seek-share",
    });

    state = applyFamilyCommandByAction(state, "seek-share", {
      commandId: "command-repeat-seek-share-first",
    });

    expect(state.pendingDecision.step).toBe("family.chooseRepeatAction");
    expect(
      state.pendingDecision.legalCommands.find((command) => command.type === "family.chooseAction")?.payload,
    ).toEqual({
      action: "seek-share",
      slotId: "stock-exchange-3-left",
    });

    state = applyFamilyCommandByAction(state, "seek-share", {
      commandId: "command-repeat-seek-share-second",
    });

    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.players["player-red"].cash).toBe(0);
    expect(playerStockExchangeSlots(state, "player-red")).toEqual([
      "stock-exchange-2",
      "stock-exchange-3-left",
    ]);
  });

  it("resolves Stock Exchange shares only after a last-player repeat finishes", () => {
    let state = startFamilyWithRedCash(0, "family-last-repeat-share-resolution", {
      companyDebt: 2,
      playerOverrides: {
        "player-yellow": {
          cash: 5,
          opportunityMarker: "seek-share",
        },
      },
    });

    state = applyFamilyCommandByAction(state, "enlist-officer", {
      commandId: "command-red-family",
    });
    state = applyFamilyCommandByAction(state, "enlist-officer", {
      actorId: "player-blue",
      commandId: "command-blue-family",
    });
    state = applyFamilyCommandByAction(state, "seek-share", {
      actorId: "player-yellow",
      commandId: "command-yellow-seek-share-first",
    });
    state = applyFamilyCommandByAction(state, "seek-share", {
      actorId: "player-yellow",
      commandId: "command-yellow-seek-share-second",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.debt).toBe(0);
    expect(state.company.court.filter((share) => share.owner === "player-yellow")).toHaveLength(2);
    expect(playerCourtShares(state, "player-yellow")).toBe(2);
    expect(playerStockExchangeSlots(state, "player-yellow")).toEqual([]);
  });

  it("purchases shipyards, workshops, and luxuries with their immediate effects", () => {
    const shipyardState = applyFamilyCommandByAction(
      startFamilyWithRedCash(2, "family-purchase-shipyard"),
      "purchase-shipyard",
    );
    expect(shipyardState.players["player-red"].cash).toBe(0);
    expect(shipyardState.players["player-red"].enterprises[0]).toEqual(
      expect.objectContaining({
        type: "shipyard",
        cardId: "shipyard-01",
      }),
    );
    expect(shipyardState.company.ships[0]).toEqual(
      expect.objectContaining({
        id: "ship-shipyard-01",
        kind: "player",
        shipyardCardId: "shipyard-01",
        location: "shipyard",
      }),
    );

    const workshopState = applyFamilyCommandByAction(
      startFamilyWithRedCash(5, "family-purchase-workshop"),
      "purchase-workshop",
    );
    expect(workshopState.players["player-red"].cash).toBe(0);
    expect(workshopState.players["player-red"].enterprises[0]).toEqual(
      expect.objectContaining({
        type: "workshop",
        cardId: "workshop-01",
      }),
    );

    const luxuryState = applyFamilyCommandByAction(
      startFamilyWithRedCash(4, "family-purchase-luxury"),
      "purchase-luxury",
    );
    expect(luxuryState.players["player-red"].cash).toBe(0);
    expect(luxuryState.players["player-red"].victoryPoints).toBe(2);
    expect(luxuryState.players["player-red"].windows).toBe(1);
    expect(luxuryState.players["player-red"].enterprises[0]).toEqual(
      expect.objectContaining({
        type: "luxury",
        cardId: "luxury-01",
      }),
    );
  });

  it("does not repeat No Action and places the opportunity marker in supply", () => {
    const state = startFamilyWithRedCash(0, "family-no-action-marker", {
      familySupply: 0,
      opportunityMarker: "no-action",
    });
    const nextState = applyFamilyCommandByAction(state, "no-action");

    expect(nextState.pendingDecision.step).toBe("family.chooseAction");
    expect(nextState.pendingDecision.actor).toBe("player-blue");
    expect(nextState.players["player-red"].opportunityMarker).toBe("supply");
  });

  it("enters the Company Operation office loop when Hiring has no vacant offices", () => {
    const state = advanceThroughStarterFamily();

    expect(state.phase).toBe("companyOperation");
    expect(state.pendingDecision.step).toBe("companyOperation.skipOffice");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "companyOperation.passOffice",
        label: "Skip Chairman",
        payload: { officeId: "chairman" },
      }),
    );
    expect(state.log.at(-1)?.summary).toBe("Yellow chose Enlist Writer.");
  });

  it("elects a Chairman as soon as declared support reaches a majority of Company shares (p.15)", () => {
    let state = createGameWithVacantOffice("chairman", {
      courtShares: [
        { id: "share-red-1", owner: "player-red" },
        { id: "share-red-2", owner: "player-red" },
        { id: "share-blue-1", owner: "player-blue" },
      ],
    });

    state = advanceThroughFamilyFromSetup(state, "chairman-election");

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.chairmanSupport");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.prompt).toContain("2 of 3 Company shares make a majority");
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      { candidateId: "player-red" },
      { candidateId: "player-blue" },
      { candidateId: null },
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-support-self",
      actorId: "player-red",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices.chairman).toEqual(
      expect.objectContaining({
        holder: "player-red",
        vacant: false,
        created: true,
      }),
    );
    expect(chairmanHolder(state)).toBe("player-red");
    expect(state.company.chairmanMarker).toBe("player-red");
    expect(playerCourtShares(state, "player-red")).toBe(1);
    expect(playerOffices(state, "player-red")).toContain("chairman");
    expect(state.company.court).toHaveLength(2);
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Red was elected Chairman.");
  });

  it("rejects support for a player without a Company share", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithVacantOffice("chairman", {
        courtShares: [
          { id: "share-red-1", owner: "player-red" },
          { id: "share-red-2", owner: "player-red" },
          { id: "share-blue-1", owner: "player-blue" },
        ],
      }),
      "chairman-election-illegal",
    );

    const result = applyCommand(state, {
      id: "command-support-illegal",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "hiring.declareChairmanSupport",
      payload: { candidateId: "player-yellow" },
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_HIRING_CHOICE",
        }),
      );
    }
  });

  it("lets the former Chairman choose when no candidate reaches a majority (p.15)", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithVacantOffice("chairman", {
        courtShares: [
          { id: "share-red-1", owner: "player-red" },
          { id: "share-blue-1", owner: "player-blue" },
        ],
      }),
      "chairman-election-contested",
    );

    state = applyCommandOrThrow(state, {
      id: "command-red-supports-self",
      actorId: "player-red",
      type: "hiring.declareChairmanSupport",
      payload: { candidateId: "player-red" },
    });
    state = applyCommandOrThrow(state, {
      id: "command-blue-supports-self",
      actorId: "player-blue",
      type: "hiring.declareChairmanSupport",
      payload: { candidateId: "player-blue" },
    });

    expect(state.pendingDecision.step).toBe("hiring.electChairman");
    expect(state.pendingDecision.prompt).toBe(
      "No candidate has majority support. The former Chairman chooses the new Chairman.",
    );
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      { officeId: "chairman", candidateId: "player-red" },
      { officeId: "chairman", candidateId: "player-blue" },
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyCommandOrThrow(state, {
      id: "command-elect-contested-chairman",
      actorId: "system",
      type: "hiring.electChairman",
      payload: { officeId: "chairman", candidateId: "player-blue" },
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices.chairman.holder).toBe("player-blue");
    expect(chairmanHolder(state)).toBe("player-blue");
    expect(playerCourtShares(state, "player-blue")).toBe(0);
    expect(state.company.court).toEqual([
      expect.objectContaining({
        id: "share-red-1",
        owner: "player-red",
      }),
    ]);
  });

  it("leaves the Chairman vacant when the Court is empty and there is no former Chairman", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithVacantOffice("chairman", {
        courtShares: [],
      }),
      "chairman-election-empty-court",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.prompt).toBe(
      "The Court is empty and the former Chairman has no family member to place: there is no Chairman.",
    );
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.skipVacancy",
        label: "Skip Chairman",
        payload: { officeId: "chairman" },
      }),
    );
  });

  it("hires a non-nepotism writer into a Chairman-hired office", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("manager-of-shipping", {
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
      }),
      "hire-manager-writer",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "manager-of-shipping",
          candidateId: "player-blue",
          source: {
            type: "writer",
            presidency: "Bombay",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-manager",
      actorId: "player-red",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        created: true,
      }),
    );
    expect(playerWriters(state, "player-blue").Bombay).toBe(0);
    expect(state.india.presidencies.Bombay.writers["player-blue"]).toBe(0);
    expect(playerOffices(state, "player-blue")).toContain("manager-of-shipping");
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Blue filled Manager of Shipping.");
  });

  it("rejects illegal office-hire payloads and actors", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("manager-of-shipping", {
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
      }),
      "hire-manager-illegal",
    );
    const legalPayload = state.pendingDecision.legalCommands[0]?.payload;

    const wrongActorResult = applyCommand(state, {
      id: "command-hire-manager-wrong-actor",
      gameId: state.gameId,
      actorId: "system",
      decisionId: state.pendingDecision.id,
      type: "hiring.hireOffice",
      payload: legalPayload,
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });
    expect(wrongActorResult.ok).toBe(false);
    if (!wrongActorResult.ok) {
      expect(wrongActorResult.errors).toContainEqual(
        expect.objectContaining({
          code: "ACTOR_NOT_ALLOWED",
        }),
      );
    }

    const wrongPayloadResult = applyCommand(state, {
      id: "command-hire-manager-wrong-payload",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "hiring.hireOffice",
      payload: {
        officeId: "manager-of-shipping",
        candidateId: "player-yellow",
        source: {
          type: "writer",
          presidency: "Bombay",
        },
      },
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });
    expect(wrongPayloadResult.ok).toBe(false);
    if (!wrongPayloadResult.ok) {
      expect(wrongPayloadResult.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_HIRING_CHOICE",
          field: "payload",
        }),
      );
    }
  });

  it("hires a Commander into Military Affairs before lower-priority military pieces", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndMilitaryVacancy({
        commanderOwner: "player-blue",
        commanderArmy: "Bengal",
        officerOwner: "player-yellow",
        officerArmy: "Bombay",
        officerReadiness: "ready",
        officersInTraining: {
          "player-yellow": 1,
        },
      }),
      "hire-military-affairs-commander",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "military-affairs",
          candidateId: "player-blue",
          source: {
            type: "commander",
            army: "Bengal",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-military-commander",
      actorId: "player-red",
    });

    expect(state.company.offices["military-affairs"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        created: true,
      }),
    );
    expect(state.company.armies.Bengal.commander).toBeUndefined();
    expect((commanderOf(state, "Bengal") === "player-blue")).toBe(false);
    expect(playerOffices(state, "player-blue")).toContain("military-affairs");
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Blue filled Military Affairs.");
  });

  it("hires an officer into Military Affairs when no Commander is available", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndMilitaryVacancy({
        officerOwner: "player-blue",
        officerArmy: "Madras",
        officerReadiness: "exhausted",
      }),
      "hire-military-affairs-officer",
    );

    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        payload: {
          officeId: "military-affairs",
          candidateId: "player-blue",
          source: {
            type: "officer",
            army: "Madras",
            readiness: "exhausted",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-military-officer",
      actorId: "player-red",
    });

    expect(playerOfficers(state, "player-blue").Madras.exhausted).toBe(0);
    expect(state.company.armies.Madras.officers["player-blue"].exhausted).toBe(0);
    expect(state.company.offices["military-affairs"].holder).toBe("player-blue");
  });

  it("hires an officer in training into Military Affairs when no army piece is available", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndMilitaryVacancy({
        officersInTraining: {
          "player-red": 1,
          "player-blue": 1,
        },
      }),
      "hire-military-affairs-training",
    );

    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      { officeId: "military-affairs", candidateId: "player-red", source: { type: "officersInTraining" } },
      { officeId: "military-affairs", candidateId: "player-blue", source: { type: "officersInTraining" } },
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyCommandOrThrow(state, {
      id: "command-hire-military-training",
      actorId: "player-red",
      type: "hiring.hireOffice",
      payload: { officeId: "military-affairs", candidateId: "player-blue", source: { type: "officersInTraining" } },
    });

    expect(state.players["player-red"].familyMembers.officersInTraining).toBe(1);
    expect(state.players["player-blue"].familyMembers.officersInTraining).toBe(0);
    expect(state.company.offices["military-affairs"].holder).toBe("player-blue");
  });

  it("rejects writer payloads for Military Affairs", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndMilitaryVacancy({
        officerOwner: "player-blue",
        officerArmy: "Bombay",
        officerReadiness: "ready",
      }),
      "hire-military-affairs-illegal-writer",
    );

    const result = applyCommand(state, {
      id: "command-hire-military-writer",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "hiring.hireOffice",
      payload: {
        officeId: "military-affairs",
        candidateId: "player-blue",
        source: {
          type: "writer",
          presidency: "Bombay",
        },
      },
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_HIRING_CHOICE",
          field: "payload",
        }),
      );
    }
  });

  it("lets the Director of Trade hire a matching Presidency writer as President", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithDirectorAndPresidentVacancy("president-bombay", {
        director: "player-red",
        chairman: "player-yellow",
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
        extraWriterOwner: "player-yellow",
        extraWriterPresidency: "Madras",
      }),
      "hire-president-writer",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "president-bombay",
          candidateId: "player-blue",
          source: {
            type: "writer",
            presidency: "Bombay",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-president-writer",
      actorId: "player-red",
    });

    expect(state.company.offices["president-bombay"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        created: true,
      }),
    );
    expect(presidentOf(state, "Bombay")).toBe("player-blue");
    expect(playerWriters(state, "player-blue").Bombay).toBe(0);
    expect(state.india.presidencies.Bombay.writers["player-blue"]).toBe(0);
    expect(state.company.vacantOffices).toEqual([]);
  });

  it("lets the Director of Trade promote an associated Governor to President", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithDirectorAndPresidentVacancy("president-bombay", {
        director: "player-red",
        governorOfficeId: "governor-bombay",
        governor: "player-blue",
        governorFatigue: 2,
      }),
      "hire-president-governor",
    );

    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        payload: {
          officeId: "president-bombay",
          candidateId: "player-blue",
          source: {
            type: "office",
            officeId: "governor-bombay",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-promote-governor-president",
      actorId: "player-red",
    });

    expect(state.company.offices["president-bombay"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        fatigue: 2,
        vacant: false,
      }),
    );
    expect(state.company.offices["governor-bombay"]).toEqual(
      expect.objectContaining({
        vacant: true,
        fatigue: 0,
      }),
    );
    expect(presidentOf(state, "Bombay")).toBe("player-blue");
    expect(playerOffices(state, "player-blue")).toContain("president-bombay");
    expect(playerOffices(state, "player-blue")).not.toContain("governor-bombay");
    expect(state.company.vacantOffices).toEqual(["governor-bombay"]);
  });

  it("skips President hiring when Director of Trade is vacant", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithDirectorAndPresidentVacancy("president-madras", {
        director: undefined,
        writerOwner: "player-blue",
        writerPresidency: "Madras",
      }),
      "hire-president-no-director",
    );

    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.skipVacancy",
        payload: { officeId: "president-madras" },
      }),
    );
  });

  it("requests nepotism consent for President self-hires", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithDirectorAndPresidentVacancy("president-bengal", {
        director: "player-red",
        writerOwner: "player-red",
        writerPresidency: "Bengal",
        extraWriterOwner: "player-blue",
        extraWriterPresidency: "Bengal",
      }),
      "hire-president-self-hire",
    );

    expect(state.pendingDecision.step).toBe("hiring.hireOffice");

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-president-nepotism",
      actorId: "player-red",
    });

    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.resolveNepotismConsent",
        payload: {
          accepted: true,
          hire: {
            officeId: "president-bengal",
            candidateId: "player-red",
            source: {
              type: "writer",
              presidency: "Bengal",
            },
          },
        },
      }),
    );
  });

  it("does not promote a Governor from a different Presidency into a President office", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithDirectorAndPresidentVacancy("president-bombay", {
        director: "player-red",
        governorOfficeId: "governor-madras",
        governor: "player-blue",
      }),
      "hire-president-wrong-governor",
    );

    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "president-bombay",
    });
  });

  it("lets a President hire a writer from their Presidency as Governor", () => {
    // Governor card backs: "Chosen by: Its President. Candidates: Consider writers and officers
    // in this Presidency."
    let state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-bombay", {
        presidentOfficeId: "president-bombay",
        president: "player-red",
        regionId: "bombay",
        regionPresidency: "Bombay",
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
        otherOfficerOwner: "player-yellow",
        otherOfficerArmy: "Madras",
      }),
      "hire-governor-presidency-writer",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "governor-bombay",
          candidateId: "player-blue",
          source: {
            type: "writer",
            presidency: "Bombay",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-governor-writer",
      actorId: "player-red",
    });

    expect(state.company.offices["governor-bombay"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        created: true,
      }),
    );
    expect(playerWriters(state, "player-blue").Bombay).toBe(0);
    expect(playerOffices(state, "player-blue")).toContain("governor-bombay");
    expect(state.company.vacantOffices).toEqual([]);
  });

  it("offers officers in the associated Presidency's Army as Governor candidates", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-mysore", {
        presidentOfficeId: "president-madras",
        president: "player-red",
        regionId: "mysore",
        regionPresidency: "Madras",
        officerOwner: "player-blue",
        officerArmy: "Madras",
        officerReadiness: "ready",
        otherOfficerOwner: "player-yellow",
        otherOfficerArmy: "Bombay",
      }),
      "hire-governor-officer",
    );

    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        payload: {
          officeId: "governor-mysore",
          candidateId: "player-blue",
          source: {
            type: "officer",
            army: "Madras",
            readiness: "ready",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-governor-officer",
      actorId: "player-red",
    });

    expect(playerOfficers(state, "player-blue").Madras.ready).toBe(0);
    expect(playerOfficers(state, "player-yellow").Bombay.ready).toBe(1);
    expect(state.company.offices["governor-mysore"].holder).toBe("player-blue");
  });

  it("has a conquered region's Governor hired by the President whose Army conquered it", () => {
    // Regions join a Presidency on conquest (p.23), so Hyderabad taken by the Army of Bombay is
    // governed from Bombay, not Madras.
    const state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-hyderabad", {
        presidentOfficeId: "president-bombay",
        president: "player-yellow",
        regionId: "hyderabad",
        regionPresidency: "Bombay",
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
        officerOwner: "player-red",
        officerArmy: "Madras",
      }),
      "hire-governor-conquered-region",
    );

    expect(state.pendingDecision.actor).toBe("player-yellow");
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      {
        officeId: "governor-hyderabad",
        candidateId: "player-blue",
        source: { type: "writer", presidency: "Bombay" },
      },
    ]);
  });

  it("requests nepotism consent for Governor self-hires", () => {
    let state = advanceThroughFamilyFromSetup(
      withWriters(
        createGameWithPresidentAndGovernorVacancy("governor-bengal", {
          presidentOfficeId: "president-bengal",
          president: "player-red",
          regionId: "bengal",
          regionPresidency: "Bengal",
          writerOwner: "player-red",
          writerPresidency: "Bengal",
        }),
        "player-yellow",
        "Bengal",
        1,
      ),
      "hire-governor-self-hire",
    );

    expect(state.pendingDecision.step).toBe("hiring.hireOffice");

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-governor-nepotism",
      actorId: "player-red",
    });

    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
    expect(state.pendingDecision.actor).toBe("player-yellow");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.resolveNepotismConsent",
        payload: {
          accepted: true,
          hire: {
            officeId: "governor-bengal",
            candidateId: "player-red",
            source: {
              type: "writer",
              presidency: "Bengal",
            },
          },
        },
      }),
    );
  });

  it("skips Governor hiring when the associated President is vacant", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-punjab", {
        presidentOfficeId: "president-bombay",
        president: undefined,
        regionId: "punjab",
        regionPresidency: "Bombay",
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
      }),
      "hire-governor-no-president",
    );

    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "governor-punjab",
    });
  });

  it("does not offer writers still sitting on orders as Governor candidates", () => {
    // Writers return to their Presidency box during Refresh, before the next Hiring phase.
    const state = advanceThroughFamilyFromSetup(
      withWriterOnOrder(
        createGameWithPresidentAndGovernorVacancy("governor-bombay", {
          presidentOfficeId: "president-bombay",
          president: "player-red",
          regionId: "bombay",
          regionPresidency: "Bombay",
        }),
        "bombay-north-3",
        "player-blue",
        "Bombay",
      ),
      "hire-governor-order-writer",
    );

    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
  });

  it("resolves lower-numbered vacancies before Chairman-hired writer offices", () => {
    const game = createGameWithChairmanAndWriterVacancy("manager-of-shipping", {
      writerOwner: "player-blue",
      writerPresidency: "Bombay",
    });
    const state = advanceThroughFamilyFromSetup(
      {
        ...game,
        company: {
          ...game.company,
          offices: {
            ...game.company.offices,
            "director-of-trade": {
              id: "director-of-trade",
              treasury: 0,
              fatigue: 0,
              vacant: true,
              created: true,
              actedThisTurn: false,
            },
          },
          vacantOffices: ["manager-of-shipping", "director-of-trade"],
        },
      },
      "hire-office-order",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "director-of-trade",
          candidateId: "player-blue",
          source: {
            type: "writer",
            presidency: "Bombay",
          },
        },
      }),
    );
  });

  it("promotes a non-Governor officeholder into Director of Trade and moves fatigue", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndOfficeholderVacancy("director-of-trade", {
        sourceOfficeId: "manager-of-shipping",
        officeholder: "player-blue",
        fatigue: 2,
      }),
      "hire-director-promotion",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "director-of-trade",
          candidateId: "player-blue",
          source: {
            type: "office",
            officeId: "manager-of-shipping",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-promote-director",
      actorId: "player-red",
    });

    expect(state.phase).toBe("hiring");
    expect(state.company.offices["director-of-trade"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        fatigue: 2,
        familyMemberId: "manager-of-shipping-test",
      }),
    );
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        vacant: true,
        fatigue: 0,
      }),
    );
    expect(playerOffices(state, "player-blue")).toContain("director-of-trade");
    expect(playerOffices(state, "player-blue")).not.toContain("manager-of-shipping");
    expect(state.company.vacantOffices).toEqual(["manager-of-shipping"]);
    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "manager-of-shipping",
    });
  });

  it("hires a writer into Director of Trade when no officeholder can be promoted", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("director-of-trade", {
        writerOwner: "player-blue",
        writerPresidency: "Madras",
      }),
      "hire-director-writer-fallback",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "director-of-trade",
          candidateId: "player-blue",
          source: {
            type: "writer",
            presidency: "Madras",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-director-writer",
      actorId: "player-red",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices["director-of-trade"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        fatigue: 0,
      }),
    );
    expect(playerWriters(state, "player-blue").Madras).toBe(0);
    expect(state.india.presidencies.Madras.writers["player-blue"]).toBe(0);
    expect(playerOffices(state, "player-blue")).toContain("director-of-trade");
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Blue filled Director of Trade.");
  });

  it("promotes a non-Governor officeholder into Governor General and moves fatigue", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndOfficeholderVacancy("governor-general", {
        sourceOfficeId: "manager-of-shipping",
        officeholder: "player-blue",
        fatigue: 1,
      }),
      "hire-governor-general-promotion",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "governor-general",
          candidateId: "player-blue",
          source: {
            type: "office",
            officeId: "manager-of-shipping",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-promote-governor-general",
      actorId: "player-red",
    });

    expect(state.company.offices["governor-general"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        fatigue: 1,
      }),
    );
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        vacant: true,
        fatigue: 0,
      }),
    );
    expect(playerOffices(state, "player-blue")).toContain("governor-general");
    expect(playerOffices(state, "player-blue")).not.toContain("manager-of-shipping");
    expect(state.company.vacantOffices).toEqual(["manager-of-shipping"]);
  });

  it("hires a writer into Governor General when no officeholder can be promoted", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("governor-general", {
        writerOwner: "player-blue",
        writerPresidency: "Bengal",
      }),
      "hire-governor-general-writer",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "governor-general",
          candidateId: "player-blue",
          source: {
            type: "writer",
            presidency: "Bengal",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-governor-general-writer",
      actorId: "player-red",
    });

    expect(state.company.offices["governor-general"]).toEqual(
      expect.objectContaining({
        holder: "player-blue",
        vacant: false,
        fatigue: 0,
      }),
    );
    expect(playerWriters(state, "player-blue").Bengal).toBe(0);
    expect(state.india.presidencies.Bengal.writers["player-blue"]).toBe(0);
    expect(playerOffices(state, "player-blue")).toContain("governor-general");
    expect(state.company.vacantOffices).toEqual([]);
  });

  it("accepts nepotism consent from the other candidate's family and completes a self-hire (p.14)", () => {
    let state = advanceThroughFamilyFromSetup(
      withWriters(
        createGameWithChairmanAndWriterVacancy("director-of-trade", {
          writerOwner: "player-red",
          writerPresidency: "Bengal",
        }),
        "player-blue",
        "Madras",
        1,
      ),
      "hire-director-writer-nepotism-accepted",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "director-of-trade",
          candidateId: "player-red",
          source: {
            type: "writer",
            presidency: "Bengal",
          },
        },
      }),
    );

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-director-nepotism",
      actorId: "player-red",
    });

    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.legalCommands.map((command) => command.label)).toEqual([
      "Consent",
      "Refuse",
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-accept-director-nepotism",
      actorId: "player-blue",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices["director-of-trade"]).toEqual(
      expect.objectContaining({
        holder: "player-red",
        vacant: false,
        created: true,
      }),
    );
    expect(playerWriters(state, "player-red").Bengal).toBe(0);
    expect(state.india.presidencies.Bengal.writers["player-red"]).toBe(0);
    expect(playerOffices(state, "player-red")).toContain("director-of-trade");
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe(
      "Nepotism consent given; Red filled Director of Trade.",
    );
  });

  it("makes the hirer choose someone else when nepotism consent is refused (p.14, p.16)", () => {
    let state = advanceThroughFamilyFromSetup(
      withWriters(
        createGameWithChairmanAndWriterVacancy("superintendent-of-trade-in-china", {
          writerOwner: "player-red",
          writerPresidency: "Bengal",
        }),
        "player-blue",
        "Bombay",
        1,
      ),
      "hire-superintendent-nepotism-denied",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-superintendent-nepotism",
      actorId: "player-red",
    });
    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");

    const refuseCommand = state.pendingDecision.legalCommands.find((command) => command.label === "Refuse");
    state = applyCommandOrThrow(state, {
      id: "command-deny-superintendent-nepotism",
      actorId: "player-blue",
      type: refuseCommand?.type ?? "hiring.resolveNepotismConsent",
      payload: refuseCommand?.payload ?? {},
    });

    expect(state.log.at(-1)?.summary).toBe(
      "Blue refused consent; Red must hire someone else as Superintendent of Trade in China.",
    );
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      {
        officeId: "superintendent-of-trade-in-china",
        candidateId: "player-blue",
        source: { type: "writer", presidency: "Bombay" },
      },
    ]);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-blue-superintendent",
      actorId: "player-red",
    });

    expect(state.company.offices["superintendent-of-trade-in-china"].holder).toBe("player-blue");
    expect(playerWriters(state, "player-red").Bengal).toBe(1);
  });

  it("accepts nepotism consent for a self-promotion and moves fatigue", () => {
    let state = advanceThroughFamilyFromSetup(
      withOffice(
        createGameWithChairmanAndOfficeholderVacancy("director-of-trade", {
          sourceOfficeId: "manager-of-shipping",
          officeholder: "player-red",
          fatigue: 2,
        }),
        "president-bombay",
        "player-blue",
      ),
      "hire-director-self-promotion-nepotism",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.hireOffice",
        payload: {
          officeId: "director-of-trade",
          candidateId: "player-red",
          source: {
            type: "office",
            officeId: "manager-of-shipping",
          },
        },
      }),
    );

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-promotion-nepotism",
      actorId: "player-red",
    });
    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");

    expect(state.pendingDecision.actor).toBe("player-blue");
    state = applyFirstLegalCommand(state, {
      commandId: "command-accept-promotion-nepotism",
      actorId: "player-blue",
    });

    expect(state.company.offices["director-of-trade"]).toEqual(
      expect.objectContaining({
        holder: "player-red",
        fatigue: 2,
        vacant: false,
      }),
    );
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        fatigue: 0,
        vacant: true,
      }),
    );
    expect(state.company.vacantOffices).toEqual(["manager-of-shipping"]);
  });

  it("skips an unresolved Hiring vacancy without filling the office", () => {
    let state = createGameWithVacantOffice("director-of-trade");

    state = advanceThroughFamilyFromSetup(state, "hiring-skip-vacancy");

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.skipVacancy",
        payload: { officeId: "director-of-trade" },
      }),
    );

    state = applyFirstLegalCommand(state, {
      commandId: "command-skip-director",
      actorId: "system",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices["director-of-trade"].vacant).toBe(true);
    expect(state.company.vacantOffices).toEqual(["director-of-trade"]);
    expect(state.hiring.skippedThisTurn).toEqual(["director-of-trade"]);
    expect(state.log.at(-1)?.summary).toBe("Director of Trade remained vacant.");
  });

  it("starts Company Operation at the first occupied red-ribbon office", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("manager-of-shipping", {
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
      }),
      "company-operation-first-office",
    );

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-manager-for-company-operation",
      actorId: "player-red",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.pendingDecision.step).toBe("companyOperation.chairman");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands).toContainEqual(
      expect.objectContaining({
        type: "companyOperation.chairman",
        payload: { action: "debt" },
      }),
    );
    expectSaveRoundTripPreservesPendingDecision(state);
  });

  it("resolves Chairman debt and allocation before continuing in order", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("manager-of-shipping", {
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
      }),
      "company-operation-pass-office",
    );
    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-manager-for-pass",
      actorId: "player-red",
    });

    const chairman = (id: string, payload: unknown) =>
      applyCommandOrThrow(state, { id, actorId: "player-red", type: "companyOperation.chairman", payload });
    state = chairman("command-chairman-debt", { action: "debt" });
    expect(state.company.debt).toBe(1);
    expect(state.company.balance).toBe(5);
    // p.18: the whole Balance must be allocated before the Chairman may finish.
    expect(state.pendingDecision.legalCommands).not.toContainEqual(
      expect.objectContaining({ payload: { action: "finish" } }),
    );
    state = chairman("command-chairman-shipping", { action: "allocate", officeId: "manager-of-shipping", amount: 1 });
    state = chairman("command-chairman-shipping-2", { action: "allocate", officeId: "manager-of-shipping", amount: 1 });
    state = chairman("command-chairman-shipping-3", { action: "allocate", officeId: "manager-of-shipping", amount: 1 });
    state = chairman("command-chairman-shipping-4", { action: "allocate", officeId: "manager-of-shipping", amount: 1 });
    state = chairman("command-chairman-bombay", { action: "allocate", officeId: "president-bombay", amount: 1 });
    expect(state.company.balance).toBe(0);
    state = chairman("command-chairman-finish", { action: "finish" });

    expect(state.company.debt).toBe(1);
    // 1710 puts £3 in every Company treasury at setup.
    expect(state.company.offices["manager-of-shipping"].treasury).toBe(7);
    expect(state.company.offices["president-bombay"].treasury).toBe(4);
    expect(state.pendingDecision.step).toBe("companyOperation.skipOffice");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "director-of-trade",
    });
    expect(state.log.at(-1)?.summary).toBe("The Chairman finished (1 Debt advance).");

    state = applyFirstLegalCommand(state, {
      commandId: "command-skip-director-company-operation",
      actorId: "system",
    });

    expect(state.pendingDecision.step).toBe("companyOperation.shipping");
    expect(state.pendingDecision.actor).toBe("player-blue");
  });

  it("rejects Chairman choices that are not listed", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("manager-of-shipping", {
        writerOwner: "player-blue",
        writerPresidency: "Bombay",
      }),
      "company-operation-wrong-office",
    );
    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-manager-for-wrong-office",
      actorId: "player-red",
    });

    const result = applyCommand(state, {
      id: "command-pass-wrong-office",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "companyOperation.chairman",
      payload: { action: "allocate", officeId: "military-affairs", amount: 1 },
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_COMPANY_OPERATION_CHOICE",
          field: "payload",
        }),
      );
    }
  });

  it("advances to Bonuses after the last Company Operation office resolves", () => {
    let state = createCompanyOperationStateAtOffice("superintendent-of-trade-in-china", {
      holder: "player-blue",
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-pass-superintendent",
      actorId: "player-blue",
    });

    expect(state.phase).toBe("bonuses");
    expect(state.pendingDecision.step).toBe("bonuses.confirm");
    expect(state.pendingDecision.legalCommands[0]?.type).toBe("bonuses.confirm");
  });

  it("pays Bonuses for workshops and fitted shipyards", () => {
    let state = createBonusesState();

    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-confirm-bonuses-income",
      actorId: "system",
    });

    expect(state.phase).toBe("revenue");
    expect(state.players["player-red"].cash).toBe(3);
    expect(state.players["player-blue"].cash).toBe(1);
    expect(state.log.at(-1)?.summary).toBe("Bonuses paid £3.");
    expect(state.log.at(-1)?.details).toEqual({
      incomeByPlayer: {
        "player-red": {
          workshops: 1,
          fittedShipyards: 1,
          total: 2,
        },
        "player-blue": {
          workshops: 1,
          fittedShipyards: 0,
          total: 1,
        },
      },
    });
  });

  it("pays Revenue expenses from Company Balance", () => {
    // p.27: £1 per Debt, per regiment and officer in an Army, and per ship in the sea zones.
    let state = createRevenueState({
      balance: 18,
      debt: 2,
      bombayRegiments: { ready: 2, exhausted: 1 },
      bombayOfficerStack: { ready: 1, exhausted: 1 },
      ships: [
        { id: "company-ship-bombay", kind: "company", location: "west-indian", fatigued: false },
        { id: "company-ship-china", kind: "company", location: "china", fatigued: false },
        {
          id: "ship-shipyard-03",
          kind: "player",
          shipyardCardId: "shipyard-03",
          location: "shipyard",
          fatigued: false,
        },
      ],
    });

    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-expenses",
      actorId: "system",
    });

    expect(state.phase).toBe("revenue");
    expect(state.pendingDecision.step).toBe("revenue.chooseDividends");
    expect(state.pendingDecision.actor).toBe("system");
    expectSaveRoundTripPreservesPendingDecision(state);
    expect(state.company.balance).toBe(9);
    expect(state.company.debt).toBe(2);
    expect(state.company.standing).toBe(3);
    expect(state.log.at(-1)?.summary).toBe("Revenue paid £9 in Company expenses.");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        emergencyLoans: 0,
        endingBalance: 9,
        publicEmbarrassmentStandingLoss: 0,
        expectationsStandingLoss: 1,
        expenses: {
          debt: 2,
          armies: 5,
          ships: 2,
          total: 9,
        },
      }),
    );
  });

  it("takes emergency loans, zeroes the Balance, and lowers Standing once for 1-2 loans", () => {
    let state = createRevenueState({
      balance: 1,
      debt: 1,
      bombayRegiments: { ready: 3, exhausted: 0 },
      bombayOfficerStack: { ready: 1, exhausted: 0 },
      ships: [
        { id: "company-ship-madras", kind: "company", location: "south-indian", fatigued: true },
        {
          id: "ship-shipyard-04",
          kind: "player",
          shipyardCardId: "shipyard-04",
          location: "east-indian",
          fatigued: false,
        },
      ],
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-emergency-loans",
      actorId: "system",
    });

    // Expenses £7 against £1: two £5 loans cover it; the £4 surplus is lost.
    expect(state.phase).toBe("revenue");
    expect(state.pendingDecision.step).toBe("revenue.chooseDividends");
    expect(state.company.balance).toBe(0);
    expect(state.company.debt).toBe(3);
    // Standing 4 (£10): -1 for 1-2 loans, then -1 because £0 is below the new £8 Expectations.
    expect(state.company.standing).toBe(2);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        emergencyLoans: 2,
        startingBalance: 1,
        endingBalance: 0,
        publicEmbarrassmentStandingLoss: 1,
        expectations: 8,
        expectationsStandingLoss: 1,
        expenses: {
          debt: 1,
          armies: 4,
          ships: 2,
          total: 7,
        },
      }),
    );
  });

  it("lowers Standing twice for three or more emergency loans and caps Debt at 8", () => {
    let state = createRevenueState({
      balance: 0,
      debt: 7,
      standing: 6,
      bombayRegiments: { ready: 6, exhausted: 0 },
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-three-loans",
      actorId: "system",
    });

    // Expenses £13: three loans. Debt stops at the end of the track (8).
    expect(state.company.debt).toBe(8);
    expect(state.company.balance).toBe(0);
    // Standing 6 (£14): -2 for 3+ loans to 4 (£10), then -1 for missing Expectations.
    expect(state.company.standing).toBe(3);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({ emergencyLoans: 3, publicEmbarrassmentStandingLoss: 2, debtAfterLoans: 8 }),
    );
  });

  it("pays Revenue dividends to Company shareholders and advances Standing above Expectations", () => {
    let state = createRevenueState({
      balance: 8,
      debt: 0,
      standing: 1,
      courtShares: ["player-red", "player-blue"],
      chairman: "player-red",
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-before-dividends",
      actorId: "system",
    });

    expect(state.pendingDecision.step).toBe("revenue.chooseDividends");
    expect(state.pendingDecision.actor).toBe("player-red");
    expectSaveRoundTripPreservesPendingDecision(state);

    // Two dividends, each £1 per share including the Chairman's: £6 > £4 Expectations (p.27).
    state = applyCommandOrThrow(state, {
      id: "command-revenue-pay-dividends",
      actorId: "player-red",
      type: "revenue.chooseDividends",
      payload: { amountPerShare: 2 },
      clientTimestamp: "2026-06-13T12:11:00.000Z",
    });

    expect(state.phase).toBe("eventsInIndia");
    expect(state.company.balance).toBe(2);
    expect(state.company.standing).toBe(2);
    expect(state.company.failed).toBe(false);
    expect(state.players["player-red"].cash).toBe(4);
    expect(state.players["player-blue"].cash).toBe(2);
    expect(state.log.at(-1)?.summary).toBe("Revenue paid £6 in dividends.");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        amountPerShare: 2,
        shareCount: 3,
        totalDividends: 6,
        dividendIncomeByPlayer: {
          "player-red": 4,
          "player-blue": 2,
        },
        expectations: 4,
        standingGain: 1,
      }),
    );
  });

  it("does not advance Standing when dividends only match Expectations", () => {
    let state = createRevenueState({
      balance: 6,
      debt: 0,
      standing: 1,
      courtShares: ["player-red", "player-blue"],
    });

    state = applyFirstLegalCommand(state, { commandId: "command-revenue-match", actorId: "system" });
    state = applyCommandOrThrow(state, {
      id: "command-revenue-match-dividends",
      actorId: "system",
      type: "revenue.chooseDividends",
      payload: { amountPerShare: 2 },
    });

    expect(state.company.standing).toBe(1);
  });

  it("fails the Company as soon as Standing reaches the leftmost space and goes to Final Scoring", () => {
    // Standing 1 (£4): one emergency loan drops it onto the failure space (p.27, p.9).
    let state = createRevenueState({
      balance: 0,
      debt: 2,
      standing: 1,
      courtShares: ["player-yellow"],
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-failure",
      actorId: "system",
    });

    expect(state.company.standing).toBe(0);
    expect(state.company.failed).toBe(true);
    expect(state.phase).toBe("finalScoring");
    expect(state.pendingDecision.step).toBe("finalScoring.confirm");
    expect(state.log.at(-1)?.summary).toBe("The Company failed during Revenue.");
  });

  it("starts 1710 on the £10 Standing space, so a bad Revenue does not end the game", () => {
    let state = createRevenueState({ balance: 0, debt: 0, bombayRegiments: { ready: 1, exhausted: 0 } });

    expect(state.company.standing).toBe(4);
    state = applyFirstLegalCommand(state, { commandId: "command-revenue-first-turn", actorId: "system" });

    expect(state.company.failed).toBe(false);
    expect(state.company.standing).toBe(2);
    expect(state.phase).toBe("revenue");
  });

  it("rejects Revenue dividends above Company Balance", () => {
    let state = createRevenueState({
      balance: 2,
      debt: 0,
      courtShares: ["player-red", "player-blue"],
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-invalid-dividend-setup",
      actorId: "system",
    });

    const result = applyCommand(state, {
      id: "command-revenue-invalid-dividend",
      gameId: state.gameId,
      actorId: "system",
      decisionId: state.pendingDecision.id,
      type: "revenue.chooseDividends",
      payload: { amountPerShare: 2 },
      clientTimestamp: "2026-06-13T12:12:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_REVENUE_DIVIDEND",
          field: "payload.amountPerShare",
        }),
      );
    }
  });

  it("returns writers from filled orders and clears filled-order markers during Upkeep", () => {
    let state = createUpkeepStateWithFilledOrders();

    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-upkeep-cleanup",
      actorId: "system",
    });

    const cleanedOrders = state.india.regions.bombay.orders;
    expect(state.phase).toBe("londonSeason");
    expect(state.turn).toBe(2);
    expect(playerWriters(state, "player-red").Bombay).toBe(1);
    expect(state.india.presidencies.Bombay.writers["player-red"]).toBe(1);
    expect(cleanedOrders[0].writer).toBeUndefined();
    expect(cleanedOrders[0].filledThisTurnBy).toEqual([]);
    expect(cleanedOrders[1].filledThisTurnBy).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Upkeep resolved. Advanced to turn 2.");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        returnedWriters: [
          {
            playerId: "player-red",
            presidency: "Bombay",
            orderId: "bombay-north-3",
          },
        ],
        cleanedOrderIds: ["bombay-north-3", "bombay-home-4"],
      }),
    );
  });

  it("readies exhausted officers and regiments during Upkeep", () => {
    let state = createUpkeepStateWithExhaustedArmies();

    state = applyFirstLegalCommand(state, {
      commandId: "command-upkeep-army-refresh",
      actorId: "system",
    });

    expect(state.phase).toBe("londonSeason");
    expect(state.company.armies.Bombay.regiments).toEqual({
      ready: 3,
      exhausted: 0,
    });
    expect(state.company.armies.Bombay.officers["player-red"]).toEqual({
      ready: 3,
      exhausted: 0,
    });
    expect(state.company.armies.Madras.regiments).toEqual({
      ready: 1,
      exhausted: 0,
    });
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        refreshedArmies: [
          {
            armyId: "Bombay",
            regimentsReadied: 2,
            officersReadiedByPlayer: {
              "player-red": 2,
            },
          },
        ],
      }),
    );
  });

  it("advances through every remaining starter phase in a full turn", () => {
    let state = advanceThroughStarterHiring();

    state = advanceThroughCompanyOperationLoop(state, "starter-turn-company-operation");

    const expectedSteps = [
      ["bonuses", "bonuses.confirm", "revenue"],
      ["revenue", "revenue.confirm", "revenue"],
      ["revenue", "revenue.chooseDividends", "eventsInIndia"],
      ["eventsInIndia", "eventsInIndia.confirm", "parliament"],
      ["parliament", "parliament.confirm", "upkeep"],
      ["upkeep", "upkeep.confirm", "londonSeason"],
    ] as const;

    for (const [phase, commandType, nextPhase] of expectedSteps) {
      expect(state.phase).toBe(phase);
      expect(state.pendingDecision.legalCommands[0]?.type).toBe(commandType);

      state = applyFirstLegalCommand(state, {
        commandId: `command-${commandType}`,
        actorId: "system",
      });

      expect(state.phase).toBe(nextPhase);
      expect(state.log.at(-1)?.sequence).toBe(state.log.length);
    }

    expect(state.turn).toBe(2);
    expect(state.pendingDecision.step).toBe("londonSeason.confirm");

    state = applyFirstLegalCommand(state, {
      commandId: "command-london-season",
      actorId: "system",
    });

    expect(state.phase).toBe("family");
    expect(state.pendingDecision.step).toBe("family.chooseAction");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.log.at(-1)?.summary).toBe("London Season resolved with no retirements.");
  });

  it("skips London Season on turn 1 and advances to Family", () => {
    let state = createLondonSeasonState({ turn: 1 });

    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-london-season-turn-1",
      actorId: "system",
    });

    expect(state.phase).toBe("family");
    expect(state.pendingDecision.step).toBe("family.chooseAction");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.log.at(-1)?.summary).toBe("London Season skipped on the scenario's first turn (turn 1).");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        note: "Rules skip London Season on the game's first turn (p.11).",
      }),
    );
  });

  it("applies London Season office attrition and retires officeholders", () => {
    let state = createLondonSeasonStateWithOfficeholder({
      turn: 2,
      officeId: "manager-of-shipping",
      holder: "player-blue",
      fatigue: 4,
    });

    expectSaveRoundTripPreservesPendingDecision(state);
    const counterBefore = state.rng.counter;

    state = applyFirstLegalCommand(state, {
      commandId: "command-london-season-retirement",
      actorId: "system",
    });

    // The retired officeholder is now a pensioner who may retire to a prize (p.11).
    expect(state.phase).toBe("londonSeason");
    expect(state.pendingDecision.step).toBe("retirement.retirePensioner");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.players["player-blue"].familyMembers.pensioners).toBe(1);
    expect(playerOffices(state, "player-blue")).not.toContain("manager-of-shipping");
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        vacant: true,
        fatigue: 0,
      }),
    );
    expect(state.company.vacantOffices).toContain("manager-of-shipping");
    expect(state.rng.counter).toBe(counterBefore + 1);
    expect(state.log.at(-1)?.summary).toBe("London Season retired 1 officeholder(s).");
    expect(state.log.at(-1)?.rngRolls).toHaveLength(1);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        retiredOffices: [
          expect.objectContaining({
            officeId: "manager-of-shipping",
            holder: "player-blue",
            fatigueBefore: 4,
            stressModifier: 0,
            outcome: "retired",
          }),
        ],
      }),
    );

    // Declining to retire sends the pensioner back to supply at the end of the season (p.12).
    state = applyCommandOrThrow(state, {
      id: "command-london-season-decline-retirement",
      actorId: "player-blue",
      type: "retirement.stop",
      payload: {},
    });

    expect(state.phase).toBe("family");
    expect(state.players["player-blue"].familyMembers.pensioners).toBe(0);
    expect(state.players["player-blue"].familyMembers.supply).toBe(18);
  });

  it("applies the Chairman stress modifier to London Season retirement", () => {
    let state = createLondonSeasonStateWithOfficeholder({
      turn: 2,
      officeId: "chairman",
      holder: "player-red",
      fatigue: 3,
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-london-season-chairman-retirement",
      actorId: "system",
    });

    expect(state.players["player-red"].familyMembers.supply).toBe(17);
    expect(state.players["player-red"].familyMembers.pensioners).toBe(1);
    expect(chairmanHolder(state)).toBeUndefined();
    expect(state.company.offices.chairman.vacant).toBe(true);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        retiredOffices: [
          expect.objectContaining({
            officeId: "chairman",
            holder: "player-red",
            fatigueBefore: 3,
            stressModifier: 1,
            outcome: "retired",
          }),
        ],
      }),
    );
  });

  it("enters and confirms starter final scoring when Upkeep completes the final turn", () => {
    let state = { ...advanceThroughStarterHiring(), finalTurn: 1 };

    state = advanceThroughCompanyOperationLoop(state, "final-turn-company-operation");

    for (const commandId of [
      "command-bonuses",
      "command-revenue-expenses",
      "command-revenue-dividends",
      "command-events-in-india",
      "command-parliament",
    ]) {
      state = applyFirstLegalCommand(state, { commandId, actorId: "system" });
    }

    expect(state.phase).toBe("upkeep");

    state = applyFirstLegalCommand(state, {
      commandId: "command-upkeep",
      actorId: "system",
    });

    expect(state.phase).toBe("finalScoring");
    expect(state.pendingDecision.step).toBe("finalScoring.confirm");
    expect(state.pendingDecision.legalCommands[0]?.type).toBe("finalScoring.confirm");
    expect(state.log.at(-1)?.summary).toBe("Upkeep resolved. The game is ready for final scoring.");

    state = applyFirstLegalCommand(state, {
      commandId: "command-final-scoring",
      actorId: "system",
    });

    expect(state.phase).toBe("finalScoring");
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
    expect(state.log.at(-1)?.summary).toMatch(/^Final Scoring: the Company survived\./);
    expect(state.finalScoring.complete).toBe(true);
    expect(state.finalScoring.ranking).toHaveLength(3);
  });

  it("keeps command invariants and save round trips valid through the starter sequence", () => {
    let state = createHotseatGame({
      seed: "starter-invariants",
      gameId: "game-starter-invariants",
      finalTurn: 1,
    });

    expectGameInvariants(state);
    expectSaveRoundTripPreservesPendingDecision(state);

    for (let index = 0; index < 40 && state.pendingDecision.step !== "finalScoring.complete"; index += 1) {
      state = applyFirstLegalCommand(state, {
        commandId: `command-invariant-${index + 1}`,
      });
      expectSaveRoundTripPreservesPendingDecision(state);
    }

    expect(state.pendingDecision.step).toBe("finalScoring.complete");
  });

  it("supports explicit command application from fixtures", () => {
    const state = createHotseatGame({
      seed: "explicit-command-fixture",
      gameId: "game-explicit-command-fixture",
    });
    const nextState = applyCommandOrThrow(state, {
      id: "command-explicit-setup",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: {},
      clientTimestamp: "2026-06-13T12:01:00.000Z",
    });

    expect(nextState.pendingDecision.step).toBe("family.chooseAction");
  });
});

function createGameWithVacantOffice(
  officeId: string,
  options: {
    courtShares?: Array<{ id: string; owner: string }>;
  } = {},
): GameState {
  let state = createHotseatGame({
    seed: `hiring-${officeId}`,
    gameId: `game-hiring-${officeId}`,
  });
  state = withOffice(state, officeId, undefined);
  if (options.courtShares) state = withCourtShares(state, options.courtShares);

  // Family actions in these tests should not place pieces that change candidate pools.
  return withHiringQueue(withNoSupply(state), [officeId]);
}

function createGameWithChairmanAndWriterVacancy(
  officeId: string,
  options: {
    writerOwner: string;
    writerPresidency: "Bombay" | "Madras" | "Bengal";
  },
): GameState {
  let state = createGameWithVacantOffice(officeId);
  state = withOffice(state, "chairman", "player-red");
  state = withWriters(state, options.writerOwner, options.writerPresidency, 1);

  return withHiringQueue(state, [officeId]);
}

function createGameWithChairmanAndOfficeholderVacancy(
  officeId: string,
  options: {
    sourceOfficeId: string;
    officeholder: string;
    fatigue: number;
  },
): GameState {
  let state = createGameWithVacantOffice(officeId);
  state = withOffice(state, "chairman", "player-red");
  state = withOffice(state, options.sourceOfficeId, options.officeholder, { fatigue: options.fatigue });

  return withHiringQueue(state, [officeId]);
}

function createGameWithChairmanAndMilitaryVacancy(options: {
  commanderOwner?: string;
  commanderArmy?: "Bombay" | "Madras" | "Bengal";
  officerOwner?: string;
  officerArmy?: "Bombay" | "Madras" | "Bengal";
  officerReadiness?: "ready" | "exhausted";
  officersInTraining?: Record<string, number>;
}): GameState {
  let state = createGameWithVacantOffice("military-affairs");
  state = withOffice(state, "chairman", "player-red");
  if (options.commanderOwner) {
    state = withCommander(state, options.commanderArmy ?? "Bombay", options.commanderOwner);
  }
  if (options.officerOwner) {
    const readiness = options.officerReadiness ?? "ready";
    state = withOfficers(state, options.officerOwner, options.officerArmy ?? "Bombay", { [readiness]: 1 });
  }
  for (const [playerId, count] of Object.entries(options.officersInTraining ?? {})) {
    state = withOfficersInTraining(state, playerId, count);
  }

  return withHiringQueue(state, ["military-affairs"]);
}

function createGameWithDirectorAndPresidentVacancy(
  officeId: "president-bombay" | "president-madras" | "president-bengal",
  options: {
    director?: string;
    chairman?: string;
    writerOwner?: string;
    writerPresidency?: "Bombay" | "Madras" | "Bengal";
    extraWriterOwner?: string;
    extraWriterPresidency?: "Bombay" | "Madras" | "Bengal";
    governorOfficeId?: string;
    governor?: string;
    governorFatigue?: number;
    /** The Presidency whose Army conquered the Governor's region; defaults to its home Presidency. */
    governorRegionPresidency?: "Bombay" | "Madras" | "Bengal";
  },
): GameState {
  let state = createGameWithVacantOffice(officeId);
  state = withOffice(state, "chairman", options.chairman ?? "player-red");
  state = withOffice(state, "director-of-trade", options.director, { inHiringQueue: false });
  if (options.writerOwner && options.writerPresidency) {
    state = withWriters(state, options.writerOwner, options.writerPresidency, 1);
  }
  if (options.extraWriterOwner && options.extraWriterPresidency) {
    state = withWriters(state, options.extraWriterOwner, options.extraWriterPresidency, 1);
  }
  if (options.governorOfficeId && options.governor) {
    const regionId = options.governorOfficeId.replace("governor-", "");
    const presidency = options.governorRegionPresidency ?? state.india.regions[regionId].homePresidency;
    if (presidency) state = withAssociatedRegion(state, regionId, presidency);
    state = withOffice(state, options.governorOfficeId, options.governor, {
      fatigue: options.governorFatigue ?? 0,
    });
  }

  return withHiringQueue(state, [officeId]);
}

function createGameWithPresidentAndGovernorVacancy(
  officeId: string,
  options: {
    presidentOfficeId: string;
    president?: string;
    regionId: string;
    /** The Presidency the region is associated with (by conquest); omit for an unconquered region. */
    regionPresidency?: "Bombay" | "Madras" | "Bengal";
    writerOwner?: string;
    writerPresidency?: "Bombay" | "Madras" | "Bengal";
    officerOwner?: string;
    officerArmy?: "Bombay" | "Madras" | "Bengal";
    officerReadiness?: "ready" | "exhausted";
    otherOfficerOwner?: string;
    otherOfficerArmy?: "Bombay" | "Madras" | "Bengal";
  },
): GameState {
  let state = createGameWithVacantOffice(officeId);
  if (options.regionPresidency) {
    state = withAssociatedRegion(state, options.regionId, options.regionPresidency);
  }
  state = withOffice(state, options.presidentOfficeId, options.president, { inHiringQueue: false });
  if (options.writerOwner && options.writerPresidency) {
    state = withWriters(state, options.writerOwner, options.writerPresidency, 1);
  }
  if (options.officerOwner && options.officerArmy) {
    state = withOfficers(state, options.officerOwner, options.officerArmy, {
      [options.officerReadiness ?? "ready"]: 1,
    });
  }
  if (options.otherOfficerOwner && options.otherOfficerArmy) {
    state = withOfficers(state, options.otherOfficerOwner, options.otherOfficerArmy, { ready: 1 });
  }

  return withHiringQueue(state, [officeId]);
}

function createLondonSeasonState(options: { turn: number; seed?: string }): GameState {
  const state = createHotseatGame({
    seed: options.seed ?? `london-season-turn-${options.turn}`,
    gameId: `game-london-season-turn-${options.turn}`,
  });

  return {
    ...state,
    turn: options.turn,
    phase: "londonSeason",
    pendingDecision: {
      id: `decision-london-season-turn-${options.turn}`,
      phase: "londonSeason",
      step: "londonSeason.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm London Season.",
      legalCommands: [
        {
          type: "londonSeason.confirm",
          label: "Confirm London Season",
          payload: {},
        },
      ],
      canSave: true,
    },
  };
}

function createLondonSeasonStateWithOfficeholder(options: {
  turn: number;
  officeId: string;
  holder: string;
  fatigue: number;
  seed?: string;
}): GameState {
  const state = createLondonSeasonState({ turn: options.turn, seed: options.seed });

  return withHiringQueue(
    withOffice(state, options.officeId, options.holder, { fatigue: options.fatigue }),
    [],
  );
}

const COMPANY_OPERATION_OFFICE_ORDER = [
  "chairman",
  "director-of-trade",
  "manager-of-shipping",
  "military-affairs",
  "president-bombay",
  "president-madras",
  "president-bengal",
  "superintendent-of-trade-in-china",
] as const;

function advanceThroughCompanyOperationLoop(state: GameState, seed: string): GameState {
  let nextState = state;

  for (let index = 0; index < 20 && nextState.phase === "companyOperation"; index += 1) {
    nextState = applyFirstLegalCommand(nextState, {
      commandId: `command-${seed}-${index + 1}`,
    });
  }

  return nextState;
}

function createCompanyOperationStateAtOffice(
  officeId: string,
  options: {
    holder: string;
  },
): GameState {
  const state = withOffice(
    createHotseatGame({
      seed: `company-operation-${officeId}`,
      gameId: `game-company-operation-${officeId}`,
    }),
    officeId,
    options.holder,
  );
  const officeIndex = COMPANY_OPERATION_OFFICE_ORDER.indexOf(
    officeId as (typeof COMPANY_OPERATION_OFFICE_ORDER)[number],
  );
  const actedOfficeIds = COMPANY_OPERATION_OFFICE_ORDER.slice(0, officeIndex);

  return {
    ...state,
    phase: "companyOperation",
    pendingDecision: {
      id: `decision-company-operation-${officeId}-test`,
      phase: "companyOperation",
      step: "companyOperation.passOffice",
      actor: options.holder,
      visibility: "private",
      prompt: `Resolve ${officeId}.`,
      legalCommands: [
        {
          type: "companyOperation.passOffice",
          label: `Pass ${officeId}`,
          payload: { officeId },
        },
      ],
      canSave: true,
    },
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        ...Object.fromEntries(
          actedOfficeIds.map((actedOfficeId) => [
            actedOfficeId,
            {
              id: actedOfficeId,
              treasury: 0,
              fatigue: 0,
              created: false,
              vacant: true,
              actedThisTurn: true,
            },
          ]),
        ),
      },
    },
  };
}

function createBonusesState(): GameState {
  const state = createHotseatGame({
    seed: "bonuses-income",
    gameId: "game-bonuses-income",
  });

  return {
    ...state,
    phase: "bonuses",
    pendingDecision: {
      id: "decision-bonuses-income-test",
      phase: "bonuses",
      step: "bonuses.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Bonuses.",
      legalCommands: [
        {
          type: "bonuses.confirm",
          label: "Confirm Bonuses",
          payload: {},
        },
      ],
      canSave: true,
    },
    players: {
      ...state.players,
      "player-red": {
        ...state.players["player-red"],
        cash: 1,
        enterprises: [
          {
            id: "workshop-red-1",
            type: "workshop",
            cardId: "workshop-01",
          },
          {
            id: "shipyard-red-fitted",
            type: "shipyard",
            cardId: "shipyard-01",
          },
          {
            id: "shipyard-red-unfitted",
            type: "shipyard",
            cardId: "shipyard-02",
          },
        ],
      },
      "player-blue": {
        ...state.players["player-blue"],
        enterprises: [
          {
            id: "workshop-blue-1",
            type: "workshop",
            cardId: "workshop-02",
          },
        ],
      },
    },
    company: {
      ...state.company,
      ships: [
        {
          id: "ship-shipyard-01",
          kind: "player",
          shipyardCardId: "shipyard-01",
          location: "south-indian",
          fatigued: false,
        },
        {
          id: "ship-shipyard-02",
          kind: "player",
          shipyardCardId: "shipyard-02",
          location: "shipyard",
          fatigued: false,
        },
      ],
    },
  };
}

function createRevenueState(options: {
  balance: number;
  debt: number;
  standing?: number;
  courtShares?: string[];
  chairman?: string;
  bombayRegiments?: { ready: number; exhausted: number };
  bombayOfficerStack?: { ready: number; exhausted: number };
  ships?: GameState["company"]["ships"];
}): GameState {
  let state = createHotseatGame({
    seed: "revenue-expenses",
    gameId: "game-revenue-expenses",
  });
  state = withRegiments(state, {
    Bombay: options.bombayRegiments ?? { ready: 0, exhausted: 0 },
    Madras: { ready: 0, exhausted: 0 },
    Bengal: { ready: 0, exhausted: 0 },
  });
  if (options.bombayOfficerStack) {
    state = withOfficers(state, "player-red", "Bombay", options.bombayOfficerStack);
  }
  if (options.courtShares) {
    state = withCourtShares(
      state,
      options.courtShares.map((owner, index) => ({ id: `revenue-share-${index + 1}`, owner })),
    );
  }
  if (options.chairman) {
    state = withHiringQueue(withOffice(state, "chairman", options.chairman), []);
  }

  return {
    ...withCash(state, Object.fromEntries(Object.keys(state.players).map((playerId) => [playerId, 0]))),
    phase: "revenue",
    pendingDecision: {
      id: "decision-revenue-expenses-test",
      phase: "revenue",
      step: "revenue.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Revenue.",
      legalCommands: [
        {
          type: "revenue.confirm",
          label: "Confirm Revenue",
          payload: {},
        },
      ],
      canSave: true,
    },
    company: {
      ...state.company,
      standing: options.standing ?? state.company.standing,
      balance: options.balance,
      debt: options.debt,
      ships: options.ships ?? [],
    },
  };
}

function createUpkeepStateWithFilledOrders(): GameState {
  let state = createHotseatGame({
    seed: "upkeep-filled-orders",
    gameId: "game-upkeep-filled-orders",
  });
  state = withWriterOnOrder(state, "bombay-north-3", "player-red", "Bombay");
  state = withFilledOrder(state, "bombay-home-4", ["company"]);

  return {
    ...state,
    phase: "upkeep",
    pendingDecision: {
      id: "decision-upkeep-filled-orders-test",
      phase: "upkeep",
      step: "upkeep.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Upkeep.",
      legalCommands: [
        {
          type: "upkeep.confirm",
          label: "Confirm Upkeep",
          payload: {},
        },
      ],
      canSave: true,
    },
  };
}

function createUpkeepStateWithExhaustedArmies(): GameState {
  let state = createHotseatGame({
    seed: "upkeep-army-refresh",
    gameId: "game-upkeep-army-refresh",
  });
  state = withRegiments(state, { Bombay: { ready: 1, exhausted: 2 } });
  state = withOfficers(state, "player-red", "Bombay", { ready: 1, exhausted: 2 });

  return {
    ...state,
    phase: "upkeep",
    pendingDecision: {
      id: "decision-upkeep-army-refresh-test",
      phase: "upkeep",
      step: "upkeep.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Upkeep.",
      legalCommands: [
        {
          type: "upkeep.confirm",
          label: "Confirm Upkeep",
          payload: {},
        },
      ],
      canSave: true,
    },
  };
}

function totalPlayerCash(state: GameState): number {
  return Object.values(state.players).reduce((total, player) => total + player.cash, 0);
}

function totalFamilySupply(state: GameState): number {
  return Object.values(state.players).reduce(
    (total, player) => total + player.familyMembers.supply,
    0,
  );
}

function totalEnterprises(
  state: GameState,
  type: "shipyard" | "workshop" | "luxury",
): number {
  return Object.values(state.players).reduce(
    (total, player) =>
      total + player.enterprises.filter((enterprise) => enterprise.type === type).length,
    0,
  );
}

function totalWriters(state: GameState): number {
  return Object.keys(state.players).reduce((total, playerId) => {
    const writers = playerWriters(state, playerId);
    return total + writers.Bombay + writers.Madras + writers.Bengal;
  }, 0);
}

function totalCommanders(state: GameState): number {
  return Object.values(state.company.armies).filter((army) => army.commander).length;
}

function totalBlackmail(state: GameState): number {
  return Object.values(state.players).reduce(
    (total, player) => total + player.blackmailCards.length,
    0,
  );
}

function advanceThroughFamilyFromSetup(state: GameState, seed: string): GameState {
  let nextState = applyCommandOrThrow(state, {
    id: `command-setup-${seed}`,
    actorId: "player-red",
    type: "setup.confirmStart",
    payload: {},
    clientTimestamp: "2026-06-13T12:01:00.000Z",
  });

  // Family turns start with the Chairman (p.13), so follow the pending decision's actor.
  for (let step = 0; nextState.phase === "family" && step < 20; step += 1) {
    const actorId = nextState.pendingDecision.actor;
    nextState = applyFirstLegalCommand(nextState, {
      commandId: `command-family-${seed}-${step}`,
      actorId: actorId === "simultaneous" ? "player-red" : actorId,
      clientTimestamp: "2026-06-13T12:02:00.000Z",
    });
  }

  return nextState;
}

function startFamilyWithRedCash(
  cash: number,
  seed: string,
  options: {
    companyDebt?: number;
    familySupply?: number;
    opportunityMarker?: string;
    playerOverrides?: Record<string, { cash?: number; familySupply?: number; opportunityMarker?: string }>;
  } = {},
): GameState {
  const state = createHotseatGame({
    seed,
    gameId: `game-${seed}`,
  });
  const players = Object.fromEntries(
    Object.entries(state.players).map(([playerId, player]) => {
      const override = playerId === "player-red"
        ? {
            cash,
            familySupply: options.familySupply,
            opportunityMarker: options.opportunityMarker,
            ...options.playerOverrides?.[playerId],
          }
        : options.playerOverrides?.[playerId];

      return [
        playerId,
        {
          ...player,
          cash: override?.cash ?? player.cash,
          opportunityMarker: override?.opportunityMarker ?? player.opportunityMarker,
          familyMembers: {
            ...player.familyMembers,
            supply: override?.familySupply ?? player.familyMembers.supply,
          },
        },
      ];
    }),
  );
  // A family with less supply has the difference parked in the Pensioners box.
  const parkedPlayers = Object.fromEntries(
    Object.entries(players).map(([playerId, player]) => {
      const parked = state.players[playerId].familyMembers.supply - player.familyMembers.supply;
      return [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            pensioners: player.familyMembers.pensioners + parked,
          },
        },
      ];
    }),
  );
  const fundedState: GameState = {
    ...state,
    company: {
      ...state.company,
      debt: options.companyDebt ?? state.company.debt,
    },
    players: parkedPlayers,
  };

  return applyCommandOrThrow(fundedState, {
    id: `command-setup-${seed}`,
    actorId: "player-red",
    type: "setup.confirmStart",
    payload: {},
    clientTimestamp: "2026-06-13T12:01:00.000Z",
  });
}

function applyFamilyCommandByAction(
  state: GameState,
  action: string,
  options:
    | string
    | {
        actorId?: string;
        commandId?: string;
        payload?: unknown;
      } = `command-${action}`,
): GameState {
  const commandId = typeof options === "string" ? options : options.commandId ?? `command-${action}`;
  const actorId = typeof options === "string" ? "player-red" : options.actorId ?? "player-red";
  const expectedPayload = typeof options === "string" ? undefined : options.payload;
  const command = state.pendingDecision.legalCommands.find((candidate) => {
    const payload = candidate.payload as { action?: string } | undefined;
    return (
      payload?.action === action &&
      (expectedPayload === undefined ||
        JSON.stringify(candidate.payload) === JSON.stringify(expectedPayload))
    );
  });

  expect(command).toBeDefined();

  return applyCommandOrThrow(state, {
    id: commandId,
    actorId,
    type: command?.type ?? "family.chooseAction",
    payload: command?.payload ?? {},
    clientTimestamp: "2026-06-13T12:02:00.000Z",
  });
}
