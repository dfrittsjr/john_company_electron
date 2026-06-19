import { describe, expect, it } from "vitest";
import { applyCommand, type GameState } from "../../engine";
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
<<<<<<< HEAD

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

    expect(state.phase).toBe("hiring");
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

  it("starts a clickable Hiring pass loop after all starter Family actions", () => {
    const hiringState = advanceThroughStarterFamily();
=======
>>>>>>> 92102859 (adding updates from first ralph loop. no clue what happened)

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

  it("skips Director of Trade writer fallback self-hires until nepotism consent exists", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("director-of-trade", {
        writerOwner: "player-red",
        writerPresidency: "Bengal",
      }),
      "hire-director-writer-nepotism-deferred",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.skipVacancy",
        payload: { officeId: "director-of-trade" },
      }),
    );
  });

  it("skips self-hiring for Chairman-hired writer offices until nepotism consent exists", () => {
    const state = advanceThroughFamilyFromSetup(
      createGameWithChairmanAndWriterVacancy("superintendent-of-trade-in-china", {
        writerOwner: "player-red",
        writerPresidency: "Bengal",
      }),
      "hire-superintendent-nepotism-deferred",
    );

    expect(state.phase).toBe("hiring");
    expect(state.pendingDecision.step).toBe("hiring.skipVacancy");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "hiring.skipVacancy",
        payload: { officeId: "superintendent-of-trade-in-china" },
      }),
    );
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
    expect(state.pendingDecision.step).toBe("companyOperation.passOffice");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "companyOperation.passOffice",
        label: "Pass Chairman",
        payload: { officeId: "chairman" },
      }),
    );
    expectSaveRoundTripPreservesPendingDecision(state);
  });

  it("passes an occupied Company Operation office and continues in order", () => {
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

    state = applyFirstLegalCommand(state, {
      commandId: "command-pass-chairman",
      actorId: "player-red",
    });

    expect(state.company.offices.chairman).toEqual(
      expect.objectContaining({
        holder: "player-red",
        familyMemberId: "chairman-share-test",
        actedThisTurn: true,
      }),
    );
    expect(state.pendingDecision.step).toBe("companyOperation.skipOffice");
    expect(state.pendingDecision.legalCommands[0]?.payload).toEqual({
      officeId: "director-of-trade",
    });
    expect(state.log.at(-1)?.summary).toBe("Red passed Chairman.");

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

  it("rejects Company Operation pass payloads for the wrong office", () => {
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
      type: "companyOperation.passOffice",
      payload: {
        officeId: "director-of-trade",
      },
      clientTimestamp: "2026-06-13T12:04:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "ILLEGAL_COMPANY_OPERATION_CHOICE",
          field: "payload.officeId",
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

  it("advances through every remaining starter phase in a full turn", () => {
    let state = advanceThroughStarterHiring();

    state = advanceThroughCompanyOperationLoop(state, "starter-turn-company-operation");

    const expectedSteps = [
      ["bonuses", "bonuses.confirm", "revenue"],
      ["revenue", "revenue.confirm", "eventsInIndia"],
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
    expect(state.log.at(-1)?.summary).toBe("Starter London Season confirmed.");
  });

  it("enters and confirms starter final scoring when Upkeep completes the final turn", () => {
    let state = { ...advanceThroughStarterHiring(), finalTurn: 1 };

    state = advanceThroughCompanyOperationLoop(state, "final-turn-company-operation");

    for (const commandId of [
      "command-bonuses",
      "command-revenue",
      "command-events",
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
    expect(state.log.at(-1)?.summary).toBe(
      "Starter Upkeep confirmed. The game is ready for final scoring.",
    );

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

<<<<<<< HEAD
function startFamilyWithRedCash(
  cash: number,
  seed: string,
  options: { companyDebt?: number } = {},
=======
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
>>>>>>> 92102859 (adding updates from first ralph loop. no clue what happened)
): GameState {
  const state = createHotseatGame({
    seed,
    gameId: `game-${seed}`,
  });
<<<<<<< HEAD
=======
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
>>>>>>> 92102859 (adding updates from first ralph loop. no clue what happened)
  const fundedState: GameState = {
    ...state,
    company: {
      ...state.company,
      debt: options.companyDebt ?? state.company.debt,
    },
<<<<<<< HEAD
    players: {
      ...state.players,
      "player-red": {
        ...state.players["player-red"],
        cash,
      },
    },
=======
    players,
>>>>>>> 92102859 (adding updates from first ralph loop. no clue what happened)
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
<<<<<<< HEAD
  commandId = `command-${action}`,
): GameState {
  const command = state.pendingDecision.legalCommands.find((candidate) => {
    const payload = candidate.payload as { action?: string } | undefined;
    return payload?.action === action;
=======
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
>>>>>>> 92102859 (adding updates from first ralph loop. no clue what happened)
  });

  expect(command).toBeDefined();

  return applyCommandOrThrow(state, {
    id: commandId,
<<<<<<< HEAD
    actorId: "player-red",
=======
    actorId,
>>>>>>> 92102859 (adding updates from first ralph loop. no clue what happened)
    type: command?.type ?? "family.chooseAction",
    payload: command?.payload ?? {},
    clientTimestamp: "2026-06-13T12:02:00.000Z",
  });
}
