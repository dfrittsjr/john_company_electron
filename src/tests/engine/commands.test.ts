import { describe, expect, it } from "vitest";
import { applyCommand, createNewGame, rollDie, type GameState } from "../../engine";
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
      expect(familyResult.state.players["player-red"].familyMembers.writers.Bombay).toBe(1);
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
      "Seek Share (£2)",
      "Purchase Shipyard",
      "Purchase Workshop",
      "Purchase Luxury",
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
    expect(state.players["player-red"].familyMembers.writers.Bombay).toBe(1);
    expect(state.players["player-red"].familyMembers.writers.Madras).toBe(1);
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
    expect(state.players["player-red"].familyMembers.writers.Bombay).toBe(1);
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
    expect(nextState.players["player-red"].familyMembers.stockExchange).toEqual([
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
    expect(state.players["player-red"].familyMembers.courtShares).toBe(1);
    expect(state.players["player-red"].familyMembers.stockExchange).toEqual([]);
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
    expect(state.players["player-red"].familyMembers.stockExchange).toEqual([
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
    expect(state.players["player-yellow"].familyMembers.courtShares).toBe(2);
    expect(state.players["player-yellow"].familyMembers.stockExchange).toEqual([]);
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
        owner: "player-red",
        location: expect.stringContaining("shipyard:"),
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

  it("elects a Chairman when one player controls a pure majority of Company shares", () => {
    let state = createGameWithVacantOffice("chairman", {
      courtShares: [
        { id: "share-red-1", owner: "player-red" },
        { id: "share-red-2", owner: "player-red" },
        { id: "share-blue-1", owner: "player-blue" },
      ],
      playerCourtShares: {
        "player-red": 2,
        "player-blue": 1,
      },
    });

    state = advanceThroughFamilyFromSetup(state, "chairman-election");

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.electChairman");
    expect(state.pendingDecision.actor).toBe("system");
    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.electChairman",
        payload: {
          officeId: "chairman",
          candidateId: "player-red",
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-elect-chairman",
      actorId: "system",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices.chairman).toEqual(
      expect.objectContaining({
        holder: "player-red",
        vacant: false,
        created: true,
      }),
    );
    expect(state.players["player-red"].familyMembers.chairmanShare).toBe(true);
    expect(state.players["player-red"].familyMembers.courtShares).toBe(1);
    expect(state.players["player-red"].familyMembers.offices).toContain("chairman");
    expect(state.company.court).toHaveLength(2);
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Red was elected Chairman.");
  });

  it("rejects Chairman election candidates without a Company-share majority", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithVacantOffice("chairman", {
        courtShares: [
          { id: "share-red-1", owner: "player-red" },
          { id: "share-red-2", owner: "player-red" },
          { id: "share-blue-1", owner: "player-blue" },
        ],
        playerCourtShares: {
          "player-red": 2,
          "player-blue": 1,
        },
      }),
      "chairman-election-illegal",
    );

    const result = applyCommand(state, {
      id: "command-elect-chairman-illegal",
      gameId: state.gameId,
      actorId: "system",
      decisionId: state.pendingDecision.id,
      type: "hiring.electChairman",
      payload: {
        officeId: "chairman",
        candidateId: "player-blue",
      },
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_HIRING_CHOICE",
          field: "payload.candidateId",
        }),
      );
    }
  });

  it("offers contested Chairman candidates when no player has a pure majority", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithVacantOffice("chairman", {
        courtShares: [
          { id: "share-red-1", owner: "player-red" },
          { id: "share-blue-1", owner: "player-blue" },
        ],
        playerCourtShares: {
          "player-red": 1,
          "player-blue": 1,
        },
      }),
      "chairman-election-contested",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.electChairman");
    expect(state.pendingDecision.prompt).toBe(
      "Elect the Chairman from table-negotiated Company-share support.",
    );
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      {
        officeId: "chairman",
        candidateId: "player-red",
      },
      {
        officeId: "chairman",
        candidateId: "player-blue",
      },
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    const blueCommand = state.pendingDecision.legalCommands.find(
      (command) => (command.payload as { candidateId?: string }).candidateId === "player-blue",
    );
    expect(blueCommand).toBeDefined();

    state = applyCommandOrThrow(state, {
      id: "command-elect-contested-chairman",
      actorId: "system",
      type: blueCommand?.type ?? "hiring.electChairman",
      payload: blueCommand?.payload ?? {},
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices.chairman.holder).toBe("player-blue");
    expect(state.players["player-blue"].familyMembers.chairmanShare).toBe(true);
    expect(state.players["player-blue"].familyMembers.courtShares).toBe(0);
    expect(state.company.court).toEqual([
      expect.objectContaining({
        id: "share-red-1",
        owner: "player-red",
      }),
    ]);
  });

  it("exposes an explicit empty-Court Chairman skip", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithVacantOffice("chairman", {
        courtShares: [],
        playerCourtShares: {},
      }),
      "chairman-election-empty-court",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.prompt).toBe(
      "The Court is empty and no Company shares can support a Chairman.",
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
    expect(state.players["player-blue"].familyMembers.writers.Bombay).toBe(0);
    expect(state.india.presidencies.Bombay.writers["player-blue"]).toBe(0);
    expect(state.players["player-blue"].familyMembers.offices).toContain("manager-of-shipping");
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
    expect(state.players["player-blue"].familyMembers.commanders.Bengal).toBe(false);
    expect(state.players["player-blue"].familyMembers.offices).toContain("military-affairs");
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

    expect(state.players["player-blue"].familyMembers.officers.Madras.exhausted).toBe(0);
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

    expect(state.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        payload: {
          officeId: "military-affairs",
          candidateId: "player-blue",
          source: {
            type: "officersInTraining",
          },
        },
      }),
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-hire-military-training",
      actorId: "player-red",
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
    expect(state.india.presidencies.Bombay.president).toBe("player-blue");
    expect(state.players["player-blue"].familyMembers.writers.Bombay).toBe(0);
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
    expect(state.india.presidencies.Bombay.president).toBe("player-blue");
    expect(state.players["player-blue"].familyMembers.offices).toContain("president-bombay");
    expect(state.players["player-blue"].familyMembers.offices).not.toContain("governor-bombay");
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
      }),
      "hire-president-self-hire",
    );

    expect(state.pendingDecision.step).toBe("hiring.hireOffice");

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-president-nepotism",
      actorId: "player-red",
    });

    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
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

  it("lets a President hire a regional order writer as Governor", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-bombay", {
        presidentOfficeId: "president-bombay",
        president: "player-red",
        regionId: "bombay",
        regionalWriterOwner: "player-blue",
        regionalWriterPresidency: "Bombay",
      }),
      "hire-governor-regional-writer",
    );

    const orderId = state.india.regions.bombay.orders[0].id;

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
            type: "regionalWriter",
            regionId: "bombay",
            orderId,
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
    expect(state.india.regions.bombay.orders[0].writer).toBeUndefined();
    expect(state.players["player-blue"].familyMembers.offices).toContain("governor-bombay");
    expect(state.company.vacantOffices).toEqual([]);
  });

  it("hires an associated Presidency officer as Governor when no regional writer is available", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-mysore", {
        presidentOfficeId: "president-madras",
        president: "player-red",
        regionId: "mysore",
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

    expect(state.players["player-blue"].familyMembers.officers.Madras.ready).toBe(0);
    expect(state.company.armies.Madras.officers["player-blue"].ready).toBe(0);
    expect(state.players["player-yellow"].familyMembers.officers.Bombay.ready).toBe(1);
    expect(state.company.offices["governor-mysore"].holder).toBe("player-blue");
  });

  it("requests nepotism consent for Governor self-hires", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-bengal", {
        presidentOfficeId: "president-bengal",
        president: "player-red",
        regionId: "bengal",
        regionalWriterOwner: "player-red",
        regionalWriterPresidency: "Bengal",
      }),
      "hire-governor-self-hire",
    );

    expect(state.pendingDecision.step).toBe("hiring.hireOffice");

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-governor-nepotism",
      actorId: "player-red",
    });

    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.resolveNepotismConsent",
        payload: {
          accepted: true,
          hire: {
            officeId: "governor-bengal",
            candidateId: "player-red",
            source: {
              type: "regionalWriter",
              regionId: "bengal",
              orderId: "bengal-order-test",
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
        regionalWriterOwner: "player-blue",
        regionalWriterPresidency: "Bombay",
      }),
      "hire-governor-no-president",
    );

    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "governor-punjab",
    });
  });

  it("rejects regional writer payloads from the wrong Governor region", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithPresidentAndGovernorVacancy("governor-bombay", {
        presidentOfficeId: "president-bombay",
        president: "player-red",
        regionId: "bombay",
        regionalWriterOwner: "player-blue",
        regionalWriterPresidency: "Bombay",
      }),
      "hire-governor-wrong-region",
    );

    const result = applyCommand(state, {
      id: "command-hire-governor-wrong-region",
      gameId: state.gameId,
      actorId: "player-red",
      decisionId: state.pendingDecision.id,
      type: "hiring.hireOffice",
      payload: {
        officeId: "governor-bombay",
        candidateId: "player-blue",
        source: {
          type: "regionalWriter",
          regionId: "madras",
          orderId: state.india.regions.madras.orders[0].id,
          presidency: "Madras",
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
        familyMemberId: "officeholder-manager-of-shipping",
      }),
    );
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        vacant: true,
        fatigue: 0,
      }),
    );
    expect(state.players["player-blue"].familyMembers.offices).toContain("director-of-trade");
    expect(state.players["player-blue"].familyMembers.offices).not.toContain("manager-of-shipping");
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
    expect(state.players["player-blue"].familyMembers.writers.Madras).toBe(0);
    expect(state.india.presidencies.Madras.writers["player-blue"]).toBe(0);
    expect(state.players["player-blue"].familyMembers.offices).toContain("director-of-trade");
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
    expect(state.players["player-blue"].familyMembers.offices).toContain("governor-general");
    expect(state.players["player-blue"].familyMembers.offices).not.toContain("manager-of-shipping");
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
    expect(state.players["player-blue"].familyMembers.writers.Bengal).toBe(0);
    expect(state.india.presidencies.Bengal.writers["player-blue"]).toBe(0);
    expect(state.players["player-blue"].familyMembers.offices).toContain("governor-general");
    expect(state.company.vacantOffices).toEqual([]);
  });

  it("accepts nepotism consent and completes a self-hire", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("director-of-trade", {
        writerOwner: "player-red",
        writerPresidency: "Bengal",
      }),
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
    expect(state.pendingDecision.actor).toBe("system");
    expect(state.pendingDecision.legalCommands.map((command) => command.label)).toEqual([
      "Accept Nepotism",
      "Deny Nepotism",
    ]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-accept-director-nepotism",
      actorId: "system",
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices["director-of-trade"]).toEqual(
      expect.objectContaining({
        holder: "player-red",
        vacant: false,
        created: true,
      }),
    );
    expect(state.players["player-red"].familyMembers.writers.Bengal).toBe(0);
    expect(state.india.presidencies.Bengal.writers["player-red"]).toBe(0);
    expect(state.players["player-red"].familyMembers.offices).toContain("director-of-trade");
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe(
      "Nepotism consent accepted; Red filled Director of Trade.",
    );
  });

  it("denies nepotism consent and leaves the vacancy unfilled", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("superintendent-of-trade-in-china", {
        writerOwner: "player-red",
        writerPresidency: "Bengal",
      }),
      "hire-superintendent-nepotism-denied",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");

    state = applyFirstLegalCommand(state, {
      commandId: "command-request-superintendent-nepotism",
      actorId: "player-red",
    });
    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");

    const denyCommand = state.pendingDecision.legalCommands.find(
      (command) => command.label === "Deny Nepotism",
    );
    expect(denyCommand).toBeDefined();

    state = applyCommandOrThrow(state, {
      id: "command-deny-superintendent-nepotism",
      actorId: "system",
      type: denyCommand?.type ?? "hiring.resolveNepotismConsent",
      payload: denyCommand?.payload ?? {},
    });

    expect(state.phase).toBe("companyOperation");
    expect(state.company.offices["superintendent-of-trade-in-china"].vacant).toBe(true);
    expect(state.players["player-red"].familyMembers.writers.Bengal).toBe(1);
    expect(state.india.presidencies.Bengal.writers["player-red"]).toBe(1);
    expect(state.players["player-red"].familyMembers.offices).not.toContain(
      "superintendent-of-trade-in-china",
    );
    expect(state.company.vacantOffices).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe(
      "Nepotism consent denied; Superintendent of Trade in China remained vacant.",
    );
  });

  it("accepts nepotism consent for a self-promotion and moves fatigue", () => {
    let state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndOfficeholderVacancy("director-of-trade", {
        sourceOfficeId: "manager-of-shipping",
        officeholder: "player-red",
        fatigue: 2,
      }),
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

    state = applyFirstLegalCommand(state, {
      commandId: "command-accept-promotion-nepotism",
      actorId: "system",
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
    expect(state.company.vacantOffices).toEqual([]);
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
    expect(state.pendingDecision.step).toBe("companyOperation.resolveChairman");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "companyOperation.resolveChairman",
        label: "Resolve Chairman",
        payload: { officeId: "chairman", debtTaken: 0, allocations: {} },
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

    state = applyCommandOrThrow(state, {
      id: "command-resolve-chairman",
      actorId: "player-red",
      type: "companyOperation.resolveChairman",
      payload: {
        officeId: "chairman",
        debtTaken: 1,
        allocations: {
          "manager-of-shipping": 4,
        },
      },
    });

    expect(state.company.offices.chairman).toEqual(
      expect.objectContaining({
        holder: "player-red",
        familyMemberId: "chairman-share-test",
        actedThisTurn: true,
      }),
    );
    expect(state.company.debt).toBe(1);
    expect(state.company.balance).toBe(1);
    expect(state.company.offices["manager-of-shipping"].treasury).toBe(4);
    expect(state.pendingDecision.step).toBe("companyOperation.skipOffice");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "director-of-trade",
    });
    expect(state.log.at(-1)?.summary).toBe("Red resolved Chairman debt and allocation.");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        debtTaken: 1,
        debtProceeds: 5,
        allocatedTotal: 4,
        endingBalance: 1,
      }),
    );

    state = applyFirstLegalCommand(state, {
      commandId: "command-skip-director-company-operation",
      actorId: "system",
    });

    expect(state.pendingDecision.step).toBe("companyOperation.passOffice");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "manager-of-shipping",
    });
  });

  it("rejects invalid Chairman allocation payloads", () => {
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
      type: "companyOperation.resolveChairman",
      payload: {
        officeId: "chairman",
        debtTaken: 0,
        allocations: {
          "manager-of-shipping": 1,
        },
      },
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
      assumption:
        "A shipyard pays if its matching ship is owned by the same player and located at shipyard:<enterprise id>.",
    });
  });

  it("pays Revenue expenses from Company Balance", () => {
    let state = createRevenueState({
      balance: 10,
      debt: 2,
      bombayRegiments: { ready: 2, exhausted: 1 },
      bombayOfficerStack: { ready: 1, exhausted: 1 },
      ships: [
        {
          id: "company-ship-bombay",
          owner: "company",
          location: "bombay-sea-zone",
          exhausted: false,
        },
        {
          id: "company-ship-workshop",
          owner: "company",
          location: "shipyard:ignored",
          exhausted: false,
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
    expect(state.company.balance).toBe(2);
    expect(state.company.debt).toBe(2);
    expect(state.log.at(-1)?.summary).toBe("Revenue paid £8 in Company expenses.");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        emergencyLoans: 0,
        endingBalance: 2,
        publicEmbarrassmentStandingLoss: 0,
        expenses: {
          debt: 2,
          armies: 5,
          ships: 1,
          total: 8,
        },
      }),
    );
  });

  it("takes emergency loans when Revenue expenses exceed Company Balance", () => {
    let state = createRevenueState({
      balance: 1,
      debt: 1,
      bombayRegiments: { ready: 3, exhausted: 0 },
      bombayOfficerStack: { ready: 1, exhausted: 0 },
      ships: [
        {
          id: "company-ship-madras",
          owner: "company",
          location: "madras-sea-zone",
          exhausted: true,
        },
        {
          id: "player-ship-bengal",
          owner: "player-red",
          location: "bengal-sea-zone",
          exhausted: false,
        },
      ],
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-emergency-loans",
      actorId: "system",
    });

    expect(state.phase).toBe("revenue");
    expect(state.pendingDecision.step).toBe("revenue.chooseDividends");
    expect(state.company.balance).toBe(4);
    expect(state.company.debt).toBe(3);
    expect(state.company.standing).toBe(-2);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        emergencyLoans: 2,
        startingBalance: 1,
        endingBalance: 4,
        publicEmbarrassmentStandingLoss: 2,
        expenses: {
          debt: 1,
          armies: 4,
          ships: 2,
          total: 7,
        },
      }),
    );
  });

  it("pays Revenue dividends to Company shareholders and advances Standing above Expectations", () => {
    let state = createRevenueState({
      balance: 8,
      debt: 0,
      expectations: 3,
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
        standingGain: 1,
      }),
    );
  });

  it("marks the Company failed when Revenue Standing pressure is not recovered by dividends", () => {
    let state = createRevenueState({
      balance: 0,
      debt: 2,
      expectations: 1,
      standing: 1,
      courtShares: ["player-yellow"],
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-failure-pressure",
      actorId: "system",
    });

    expect(state.company.balance).toBe(3);
    expect(state.company.debt).toBe(3);
    expect(state.company.standing).toBe(0);

    state = applyCommandOrThrow(state, {
      id: "command-revenue-no-dividends-fails",
      actorId: "system",
      type: "revenue.chooseDividends",
      payload: { amountPerShare: 0 },
    });

    expect(state.phase).toBe("eventsInIndia");
    expect(state.company.standing).toBe(0);
    expect(state.company.failed).toBe(false);

    state = createRevenueState({
      balance: 0,
      debt: 2,
      expectations: 4,
      standing: 1,
      courtShares: ["player-yellow"],
    });

    state = applyFirstLegalCommand(state, {
      commandId: "command-revenue-failure-pressure-expectations",
      actorId: "system",
    });

    expect(state.company.standing).toBe(-1);

    state = applyCommandOrThrow(state, {
      id: "command-revenue-no-dividends-fails-after-expectations",
      actorId: "system",
      type: "revenue.chooseDividends",
      payload: { amountPerShare: 0 },
    });

    expect(state.company.failed).toBe(true);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        failed: true,
      }),
    );
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

  it("rolls the Events in India storm die and saves before resolving follow-up events", () => {
    let state = createEventsInIndiaState("events-storm-roll");
    const expectedRoll = rollDie(state.rng, 6, "eventsInIndia.stormDie");

    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-events-storm-roll",
      actorId: "system",
    });

    expect(state.phase).toBe("eventsInIndia");
    expect(state.pendingDecision.step).toBe("eventsInIndia.resolveRolledEvents");
    expect(state.rng.counter).toBe(1);
    expect(state.log.at(-1)?.type).toBe("eventsInIndia.stormDieRolled");
    expect(state.log.at(-1)?.rngRolls).toEqual([expectedRoll.roll]);

    const stormPayload = state.pendingDecision.legalCommands[0]?.payload as
      | { stormDieRoll: number; eventTileCount: number; stormsActive: boolean }
      | undefined;
    expect(stormPayload).toEqual(
      mapExpectedTemporaryStormDie(expectedRoll.value),
    );
    expectSaveRoundTripPreservesPendingDecision(state);

    state = applyFirstLegalCommand(state, {
      commandId: "command-events-resolve-rolled",
      actorId: "system",
    });

    expect(state.phase).toBe("parliament");
    expect(state.rng).toEqual(expectedRoll.rng);
    expect(state.pendingDecision.step).toBe("parliament.confirm");
    expect(state.log.at(-1)?.summary).toBe("Events in India resolved.");
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
    expect(state.players["player-red"].familyMembers.writers.Bombay).toBe(1);
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
            orderId: "bombay-order-1",
          },
        ],
        cleanedOrderIds: ["bombay-order-1", "bombay-order-2"],
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
      ready: 0,
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
      ["eventsInIndia", "eventsInIndia.confirm", "eventsInIndia"],
      ["eventsInIndia", "eventsInIndia.resolveRolledEvents", "parliament"],
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
    expect(state.log.at(-1)?.summary).toBe("London Season skipped on turn 1.");
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        note: "Rules skip London Season on the first turn.",
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

    state = applyFirstLegalCommand(state, {
      commandId: "command-london-season-retirement",
      actorId: "system",
    });

    expect(state.phase).toBe("family");
    expect(state.players["player-blue"].familyMembers.pensioners).toBe(1);
    expect(state.players["player-blue"].familyMembers.offices).not.toContain("manager-of-shipping");
    expect(state.company.offices["manager-of-shipping"]).toEqual(
      expect.objectContaining({
        vacant: true,
        fatigue: 0,
      }),
    );
    expect(state.company.vacantOffices).toContain("manager-of-shipping");
    expect(state.rng.counter).toBe(1);
    expect(state.log.at(-1)?.summary).toBe("London Season retired 1 officeholder(s).");
    expect(state.log.at(-1)?.rngRolls).toHaveLength(1);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        retiredOffices: [
          expect.objectContaining({
            officeId: "manager-of-shipping",
            holder: "player-blue",
            fatigue: 5,
            stressModifier: 0,
          }),
        ],
      }),
    );
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

    expect(state.players["player-red"].familyMembers.pensioners).toBe(1);
    expect(state.players["player-red"].familyMembers.chairmanShare).toBe(false);
    expect(state.company.offices.chairman.vacant).toBe(true);
    expect(state.log.at(-1)?.details).toEqual(
      expect.objectContaining({
        retiredOffices: [
          expect.objectContaining({
            officeId: "chairman",
            holder: "player-red",
            fatigue: 4,
            stressModifier: 1,
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
      "command-events-roll",
      "command-events-resolve",
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
    expect(state.log.at(-1)?.summary).toBe("Starter Final Scoring confirmed.");
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
    playerCourtShares?: Record<string, number>;
  } = {},
): GameState {
  const state = createHotseatGame({
    seed: `hiring-${officeId}`,
    gameId: `game-hiring-${officeId}`,
  });

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            courtShares: options.playerCourtShares?.[playerId] ?? player.familyMembers.courtShares,
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      court: options.courtShares ?? state.company.court,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          treasury: 0,
          fatigue: 0,
          vacant: true,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: [officeId],
    },
  };
}

function createGameWithChairmanAndWriterVacancy(
  officeId: string,
  options: {
    writerOwner: string;
    writerPresidency: "Bombay" | "Madras" | "Bengal";
  },
): GameState {
  const state = createGameWithVacantOffice(officeId);

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            supply: 0,
            chairmanShare: playerId === "player-red",
            writers: {
              ...player.familyMembers.writers,
              [options.writerPresidency]: playerId === options.writerOwner ? 1 : 0,
            },
            offices:
              playerId === "player-red"
                ? [...new Set([...player.familyMembers.offices, "chairman"])]
                : player.familyMembers.offices,
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        chairman: {
          id: "chairman",
          holder: "player-red",
          familyMemberId: "chairman-share-test",
          treasury: 0,
          fatigue: 0,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: [officeId],
    },
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        [options.writerPresidency]: {
          ...state.india.presidencies[options.writerPresidency],
          writers: {
            ...state.india.presidencies[options.writerPresidency].writers,
            [options.writerOwner]: 1,
          },
        },
      },
    },
  };
}

function createGameWithChairmanAndOfficeholderVacancy(
  officeId: string,
  options: {
    sourceOfficeId: string;
    officeholder: string;
    fatigue: number;
  },
): GameState {
  const state = createGameWithChairmanAndWriterVacancy(officeId, {
    writerOwner: "player-yellow",
    writerPresidency: "Madras",
  });

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            writers: {
              Bombay: 0,
              Madras: 0,
              Bengal: 0,
            },
            offices:
              playerId === options.officeholder
                ? [...new Set([...player.familyMembers.offices, options.sourceOfficeId])]
                : player.familyMembers.offices,
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [options.sourceOfficeId]: {
          id: options.sourceOfficeId,
          holder: options.officeholder,
          familyMemberId: `officeholder-${options.sourceOfficeId}`,
          treasury: 0,
          fatigue: options.fatigue,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: [officeId],
    },
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        Madras: {
          ...state.india.presidencies.Madras,
          writers: {},
        },
      },
    },
  };
}

function createGameWithChairmanAndMilitaryVacancy(options: {
  commanderOwner?: string;
  commanderArmy?: "Bombay" | "Madras" | "Bengal";
  officerOwner?: string;
  officerArmy?: "Bombay" | "Madras" | "Bengal";
  officerReadiness?: "ready" | "exhausted";
  officersInTraining?: Record<string, number>;
}): GameState {
  const state = createGameWithVacantOffice("military-affairs");
  const commanderArmy = options.commanderArmy ?? "Bombay";
  const officerArmy = options.officerArmy ?? "Bombay";
  const officerReadiness = options.officerReadiness ?? "ready";

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            supply: 0,
            chairmanShare: playerId === "player-red",
            officersInTraining: options.officersInTraining?.[playerId] ?? 0,
            commanders: {
              Bombay: false,
              Madras: false,
              Bengal: false,
              ...(playerId === options.commanderOwner
                ? {
                    [commanderArmy]: true,
                  }
                : {}),
            },
            officers: {
              Bombay: { ready: 0, exhausted: 0 },
              Madras: { ready: 0, exhausted: 0 },
              Bengal: { ready: 0, exhausted: 0 },
              ...(playerId === options.officerOwner
                ? {
                    [officerArmy]: {
                      ready: officerReadiness === "ready" ? 1 : 0,
                      exhausted: officerReadiness === "exhausted" ? 1 : 0,
                    },
                  }
                : {}),
            },
            offices:
              playerId === "player-red"
                ? [...new Set([...player.familyMembers.offices, "chairman"])]
                : player.familyMembers.offices,
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        chairman: {
          id: "chairman",
          holder: "player-red",
          familyMemberId: "chairman-share-test",
          treasury: 0,
          fatigue: 0,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
      },
      armies: Object.fromEntries(
        Object.entries(state.company.armies).map(([armyId, army]) => [
          armyId,
          {
            ...army,
            commander: armyId === options.commanderArmy ? options.commanderOwner : undefined,
            officers:
              armyId === options.officerArmy && options.officerOwner
                ? {
                    [options.officerOwner]: {
                      ready: officerReadiness === "ready" ? 1 : 0,
                      exhausted: officerReadiness === "exhausted" ? 1 : 0,
                    },
                  }
                : {},
          },
        ]),
      ) as GameState["company"]["armies"],
      vacantOffices: ["military-affairs"],
    },
  };
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
  },
): GameState {
  const state = createGameWithVacantOffice(officeId);
  const chairman = options.chairman ?? "player-red";
  const director = options.director;

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => {
        const writerCounts = {
          Bombay: 0,
          Madras: 0,
          Bengal: 0,
        };
        if (playerId === options.writerOwner && options.writerPresidency) {
          writerCounts[options.writerPresidency] += 1;
        }
        if (playerId === options.extraWriterOwner && options.extraWriterPresidency) {
          writerCounts[options.extraWriterPresidency] += 1;
        }

        return [
          playerId,
          {
            ...player,
            familyMembers: {
              ...player.familyMembers,
              supply: 0,
              chairmanShare: playerId === chairman,
              writers: writerCounts,
              offices: [
                ...new Set(
                  player.familyMembers.offices
                    .concat(playerId === chairman ? ["chairman"] : [])
                    .concat(playerId === director ? ["director-of-trade"] : [])
                    .concat(playerId === options.governor ? [options.governorOfficeId ?? ""] : [])
                    .filter(Boolean),
                ),
              ],
            },
          },
        ];
      }),
    ),
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        chairman: {
          id: "chairman",
          holder: chairman,
          familyMemberId: "chairman-share-test",
          treasury: 0,
          fatigue: 0,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
        "director-of-trade": director
          ? {
              id: "director-of-trade",
              holder: director,
              familyMemberId: "director-test",
              treasury: 0,
              fatigue: 0,
              vacant: false,
              created: true,
              actedThisTurn: false,
            }
          : {
              id: "director-of-trade",
              treasury: 0,
              fatigue: 0,
              vacant: true,
              created: true,
              actedThisTurn: false,
            },
        ...(options.governorOfficeId && options.governor
          ? {
              [options.governorOfficeId]: {
                id: options.governorOfficeId,
                holder: options.governor,
                familyMemberId: `${options.governorOfficeId}-test`,
                treasury: 0,
                fatigue: options.governorFatigue ?? 0,
                vacant: false,
                created: true,
                actedThisTurn: false,
              },
            }
          : {}),
      },
      vacantOffices: [officeId],
    },
    india: {
      ...state.india,
      presidencies: Object.fromEntries(
        Object.entries(state.india.presidencies).map(([presidency, presidencyState]) => [
          presidency,
          {
            ...presidencyState,
            writers: Object.fromEntries(
              Object.keys(state.players).map((playerId) => [
                playerId,
                (playerId === options.writerOwner && presidency === options.writerPresidency ? 1 : 0) +
                  (playerId === options.extraWriterOwner && presidency === options.extraWriterPresidency ? 1 : 0),
              ]),
            ),
          },
        ]),
      ) as GameState["india"]["presidencies"],
    },
  };
}

function createGameWithPresidentAndGovernorVacancy(
  officeId: string,
  options: {
    presidentOfficeId: string;
    president?: string;
    regionId: string;
    regionalWriterOwner?: string;
    regionalWriterPresidency?: "Bombay" | "Madras" | "Bengal";
    officerOwner?: string;
    officerArmy?: "Bombay" | "Madras" | "Bengal";
    officerReadiness?: "ready" | "exhausted";
    otherOfficerOwner?: string;
    otherOfficerArmy?: "Bombay" | "Madras" | "Bengal";
  },
): GameState {
  const state = createGameWithVacantOffice(officeId);
  const officerReadiness = options.officerReadiness ?? "ready";
  const primaryRegion = state.india.regions[options.regionId] ?? createTestRegion(options.regionId);
  const madrasRegion = state.india.regions.madras ?? createTestRegion("madras");
  const regions = {
    ...state.india.regions,
    madras: madrasRegion,
    [options.regionId]: {
      ...primaryRegion,
      orders: primaryRegion.orders.map((order, index) =>
        index === 0 && options.regionalWriterOwner && options.regionalWriterPresidency
          ? {
              ...order,
              writer: {
                playerId: options.regionalWriterOwner,
                presidency: options.regionalWriterPresidency,
              },
            }
          : {
              ...order,
              writer: undefined,
            },
      ),
    },
  };

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            supply: 0,
            officers: {
              Bombay: { ready: 0, exhausted: 0 },
              Madras: { ready: 0, exhausted: 0 },
              Bengal: { ready: 0, exhausted: 0 },
              ...(playerId === options.officerOwner && options.officerArmy
                ? {
                    [options.officerArmy]: {
                      ready: officerReadiness === "ready" ? 1 : 0,
                      exhausted: officerReadiness === "exhausted" ? 1 : 0,
                    },
                  }
                : {}),
              ...(playerId === options.otherOfficerOwner && options.otherOfficerArmy
                ? {
                    [options.otherOfficerArmy]: {
                      ready: 1,
                      exhausted: 0,
                    },
                  }
                : {}),
            },
            offices:
              playerId === options.president
                ? [...new Set([...player.familyMembers.offices, options.presidentOfficeId])]
                : player.familyMembers.offices,
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [options.presidentOfficeId]: options.president
          ? {
              id: options.presidentOfficeId,
              holder: options.president,
              familyMemberId: `${options.presidentOfficeId}-test`,
              treasury: 0,
              fatigue: 0,
              vacant: false,
              created: true,
              actedThisTurn: false,
            }
          : {
              id: options.presidentOfficeId,
              treasury: 0,
              fatigue: 0,
              vacant: true,
              created: true,
              actedThisTurn: false,
            },
      },
      armies: Object.fromEntries(
        Object.entries(state.company.armies).map(([armyId, army]) => [
          armyId,
          {
            ...army,
            officers: {
              ...(armyId === options.officerArmy && options.officerOwner
                ? {
                    [options.officerOwner]: {
                      ready: officerReadiness === "ready" ? 1 : 0,
                      exhausted: officerReadiness === "exhausted" ? 1 : 0,
                    },
                  }
                : {}),
              ...(armyId === options.otherOfficerArmy && options.otherOfficerOwner
                ? {
                    [options.otherOfficerOwner]: {
                      ready: 1,
                      exhausted: 0,
                    },
                  }
                : {}),
            },
          },
        ]),
      ) as GameState["company"]["armies"],
      vacantOffices: [officeId],
    },
    india: {
      ...state.india,
      regions,
    },
  };
}

function createLondonSeasonState(options: { turn: number }): GameState {
  const state = createHotseatGame({
    seed: `london-season-turn-${options.turn}`,
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
}): GameState {
  const state = createLondonSeasonState({ turn: options.turn });

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            chairmanShare: playerId === options.holder && options.officeId === "chairman",
            offices:
              playerId === options.holder
                ? [...new Set([...player.familyMembers.offices, options.officeId])]
                : player.familyMembers.offices.filter((officeId) => officeId !== options.officeId),
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [options.officeId]: {
          id: options.officeId,
          holder: options.holder,
          familyMemberId: `officeholder-${options.officeId}`,
          treasury: 0,
          fatigue: options.fatigue,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: state.company.vacantOffices.filter(
        (officeId) => officeId !== options.officeId,
      ),
    },
  };
}

function createTestRegion(regionId: string): GameState["india"]["regions"][string] {
  const presidency =
    regionId === "madras" || regionId === "mysore" || regionId === "hyderabad"
      ? "Madras"
      : regionId === "bengal" || regionId === "delhi"
        ? "Bengal"
        : "Bombay";

  return {
    id: regionId,
    name: regionId,
    presidency,
    adjacent: [],
    orders: [
      {
        id: `${regionId}-order-test`,
        value: 1,
        closed: false,
        filledThisTurnBy: [],
        connectedOrderIds: [],
        boardPosition: { x: 0, y: 0 },
      },
    ],
    towerLevels: 0,
    hasDome: false,
    isCapital: false,
    companyControlled: true,
    associatedPresidency: presidency,
    governorOffice: `governor-${regionId}`,
    unrest: 0,
    lootToken: {
      available: true,
      value: 1,
      face: "loot",
    },
    exportIcons: 0,
    partialCompanyShip: false,
  };
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
  const state = createHotseatGame({
    seed: `company-operation-${officeId}`,
    gameId: `game-company-operation-${officeId}`,
  });
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
    players: {
      ...state.players,
      [options.holder]: {
        ...state.players[options.holder],
        familyMembers: {
          ...state.players[options.holder].familyMembers,
          offices: [...new Set([...state.players[options.holder].familyMembers.offices, officeId])],
        },
      },
    },
    company: {
      ...state.company,
      offices: {
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
        [officeId]: {
          id: officeId,
          holder: options.holder,
          familyMemberId: `officeholder-${officeId}`,
          treasury: 0,
          fatigue: 0,
          created: true,
          vacant: false,
          actedThisTurn: false,
        },
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
          owner: "player-red",
          location: "shipyard:shipyard-red-fitted",
          exhausted: false,
        },
        {
          id: "ship-shipyard-02",
          owner: "player-red",
          location: "south-indian",
          exhausted: false,
        },
      ],
    },
  };
}

function createRevenueState(options: {
  balance: number;
  debt: number;
  expectations?: number;
  standing?: number;
  courtShares?: string[];
  chairman?: string;
  bombayRegiments?: { ready: number; exhausted: number };
  bombayOfficerStack?: { ready: number; exhausted: number };
  ships?: GameState["company"]["ships"];
}): GameState {
  const state = createHotseatGame({
    seed: "revenue-expenses",
    gameId: "game-revenue-expenses",
  });

  return {
    ...state,
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
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          cash: 0,
          familyMembers: {
            ...player.familyMembers,
            courtShares: options.courtShares?.filter((owner) => owner === playerId).length ?? 0,
            chairmanShare: options.chairman === playerId,
            offices: options.chairman === playerId
              ? [...new Set([...player.familyMembers.offices, "chairman"])]
              : player.familyMembers.offices,
          },
        },
      ]),
    ),
    company: {
      ...state.company,
      standing: options.standing ?? state.company.standing,
      balance: options.balance,
      debt: options.debt,
      expectations: options.expectations ?? state.company.expectations,
      court:
        options.courtShares?.map((owner, index) => ({
          id: `revenue-share-${index + 1}`,
          owner,
        })) ?? state.company.court,
      offices: options.chairman
        ? {
            ...state.company.offices,
            chairman: {
              id: "chairman",
              holder: options.chairman,
              familyMemberId: "revenue-chairman-share",
              treasury: 0,
              fatigue: 0,
              vacant: false,
              created: true,
              actedThisTurn: false,
            },
          }
        : state.company.offices,
      ships: options.ships ?? [],
      armies: {
        ...state.company.armies,
        Bombay: {
          ...state.company.armies.Bombay,
          regiments: options.bombayRegiments ?? state.company.armies.Bombay.regiments,
          officers: options.bombayOfficerStack
            ? {
                "player-red": options.bombayOfficerStack,
              }
            : state.company.armies.Bombay.officers,
        },
      },
    },
  };
}

function createEventsInIndiaState(seed: string): GameState {
  const state = createHotseatGame({
    seed,
    gameId: `game-${seed}`,
  });

  return {
    ...state,
    phase: "eventsInIndia",
    pendingDecision: {
      id: `decision-${seed}`,
      phase: "eventsInIndia",
      step: "eventsInIndia.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Confirm Events in India.",
      legalCommands: [
        {
          type: "eventsInIndia.confirm",
          label: "Confirm Events in India",
          payload: {},
        },
      ],
      canSave: true,
    },
  };
}

function mapExpectedTemporaryStormDie(roll: number) {
  return {
    stormDieRoll: roll,
    eventTileCount: roll <= 2 ? 1 : roll <= 4 ? 2 : 3,
    stormsActive: roll >= 5,
  };
}

function createUpkeepStateWithFilledOrders(): GameState {
  const state = createHotseatGame({
    seed: "upkeep-filled-orders",
    gameId: "game-upkeep-filled-orders",
  });

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
    players: {
      ...state.players,
      "player-red": {
        ...state.players["player-red"],
        familyMembers: {
          ...state.players["player-red"].familyMembers,
          writers: {
            ...state.players["player-red"].familyMembers.writers,
            Bombay: 0,
          },
        },
      },
    },
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        Bombay: {
          ...state.india.presidencies.Bombay,
          writers: {
            ...state.india.presidencies.Bombay.writers,
            "player-red": 0,
          },
        },
      },
      regions: {
        ...state.india.regions,
        bombay: {
          id: "bombay",
          name: "Bombay",
          presidency: "Bombay",
          adjacent: [],
          towerLevels: 0,
          hasDome: false,
          isCapital: false,
          companyControlled: true,
          unrest: 0,
          lootToken: {
            available: false,
            value: 0,
            face: "loot",
          },
          exportIcons: 0,
          partialCompanyShip: false,
          orders: [
            {
              id: "bombay-order-1",
              value: 2,
              closed: false,
              filledThisTurnBy: ["company"],
              writer: {
                playerId: "player-red",
                presidency: "Bombay",
              },
              connectedOrderIds: [],
              boardPosition: { x: 0, y: 0 },
            },
            {
              id: "bombay-order-2",
              value: 3,
              closed: false,
              filledThisTurnBy: ["company"],
              connectedOrderIds: [],
              boardPosition: { x: 1, y: 1 },
            },
          ],
        },
      },
    },
  };
}

function createUpkeepStateWithExhaustedArmies(): GameState {
  const state = createHotseatGame({
    seed: "upkeep-army-refresh",
    gameId: "game-upkeep-army-refresh",
  });

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
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        Bombay: {
          ...state.company.armies.Bombay,
          regiments: {
            ready: 1,
            exhausted: 2,
          },
          officers: {
            "player-red": {
              ready: 1,
              exhausted: 2,
            },
          },
        },
      },
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
  return Object.values(state.players).reduce(
    (total, player) =>
      total +
      player.familyMembers.writers.Bombay +
      player.familyMembers.writers.Madras +
      player.familyMembers.writers.Bengal,
    0,
  );
}

function totalCommanders(state: GameState): number {
  return Object.values(state.players).reduce(
    (total, player) =>
      total +
      Number(player.familyMembers.commanders.Bombay) +
      Number(player.familyMembers.commanders.Madras) +
      Number(player.familyMembers.commanders.Bengal),
    0,
  );
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

  for (const actorId of ["player-red", "player-blue", "player-yellow"] as const) {
    nextState = applyFirstLegalCommand(nextState, {
      commandId: `command-family-${seed}-${actorId}`,
      actorId,
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
  const fundedState: GameState = {
    ...state,
    company: {
      ...state.company,
      debt: options.companyDebt ?? state.company.debt,
    },
    players,
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
