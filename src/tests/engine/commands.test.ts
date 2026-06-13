import { describe, expect, it } from "vitest";
import { applyCommand } from "../../engine";
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

  it("creates legal starter family actions after setup is confirmed", () => {
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
        "Enlist Writer",
        "Enlist Officer",
        "Seek Share",
        "Purchase Workshop",
      ]);
    }
  });

  it("records a starter family action and advances to the next human player", () => {
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
      (command) => command.label === "Enlist Writer",
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
      expect(familyResult.state.pendingDecision.actor).toBe("player-blue");
      expect(familyResult.state.log.at(-1)?.summary).toBe("Red chose Enlist Writer.");
    }
  });

  it("starts a clickable Hiring pass loop after all starter Family actions", () => {
    const hiringState = advanceThroughStarterFamily();

    expect(hiringState.phase).toBe("hiring");
    expect(hiringState.pendingDecision.step).toBe("hiring.chooseStarterPass");
    expect(hiringState.pendingDecision.actor).toBe("player-red");
    expect(hiringState.pendingDecision.legalCommands).toEqual([
      expect.objectContaining({
        type: "hiring.pass",
        label: "Pass Hiring",
      }),
    ]);
  });

  it("records starter Hiring passes and advances to Company Operation boundary", () => {
    let state = advanceThroughStarterFamily();

    for (const actorId of ["player-red", "player-blue", "player-yellow"]) {
      state = applyFirstLegalCommand(state, {
        commandId: `command-hiring-${actorId}`,
        actorId,
      });
    }

    expect(state.phase).toBe("companyOperation");
    expect(state.pendingDecision.step).toBe("companyOperation.chooseStarterPass");
    expect(state.pendingDecision.legalCommands[0]).toEqual(
      expect.objectContaining({
        type: "companyOperation.passOffice",
        label: "Confirm Company Operation",
      }),
    );
    expect(state.log.at(-1)?.summary).toBe("Yellow passed starter Hiring.");
  });

  it("advances through every remaining starter phase in a full turn", () => {
    let state = advanceThroughStarterHiring();

    const expectedSteps = [
      ["companyOperation", "companyOperation.passOffice", "bonuses"],
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

    for (const commandId of [
      "command-company-operation",
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

    const commandActors = [
      "player-red",
      "player-red",
      "player-blue",
      "player-yellow",
      "player-red",
      "player-blue",
      "player-yellow",
      "system",
      "system",
      "system",
      "system",
      "system",
      "system",
      "system",
    ] as const;

    commandActors.forEach((actorId, index) => {
      state = applyFirstLegalCommand(state, {
        commandId: `command-invariant-${index + 1}`,
        actorId,
      });
      expectSaveRoundTripPreservesPendingDecision(state);
    });

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
