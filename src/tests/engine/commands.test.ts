import { describe, expect, it } from "vitest";
import { applyCommand, createNewGame } from "../../engine";

describe("command application", () => {
  it("reports unknown command types explicitly", () => {
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "unknown-command",
      gameId: "game-unknown-command",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
      ],
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
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "family-actions",
      gameId: "game-family-actions",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
      ],
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
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "family-action-next-player",
      gameId: "game-family-action-next-player",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
      ],
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
      const passCommand = state.pendingDecision.legalCommands[0];
      const result = applyCommand(state, {
        id: `command-hiring-${actorId}`,
        gameId: state.gameId,
        actorId,
        decisionId: state.pendingDecision.id,
        type: passCommand.type,
        payload: passCommand.payload ?? {},
        clientTimestamp: "2026-06-13T12:10:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    expect(state.phase).toBe("companyOperation");
    expect(state.pendingDecision.step).toBe("companyOperation.notImplemented");
    expect(state.log.at(-1)?.summary).toBe("Yellow passed starter Hiring.");
  });
});

function advanceThroughStarterFamily() {
  let state = createNewGame({
    mode: "hotseat",
    scenario: "1710",
    seed: "advance-through-family",
    gameId: "game-advance-through-family",
    now: "2026-06-13T12:00:00.000Z",
    players: [
      { id: "player-red", name: "Red", color: "red" },
      { id: "player-blue", name: "Blue", color: "blue" },
      { id: "player-yellow", name: "Yellow", color: "yellow" },
    ],
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

  if (!setupResult.ok) {
    throw new Error("Expected setup command to succeed.");
  }
  state = setupResult.state;

  for (const actorId of ["player-red", "player-blue", "player-yellow"]) {
    const command = state.pendingDecision.legalCommands[0];
    const result = applyCommand(state, {
      id: `command-family-${actorId}`,
      gameId: state.gameId,
      actorId,
      decisionId: state.pendingDecision.id,
      type: command.type,
      payload: command.payload ?? {},
      clientTimestamp: "2026-06-13T12:02:00.000Z",
    });

    if (!result.ok) {
      throw new Error(`Expected family command for ${actorId} to succeed.`);
    }
    state = result.state;
  }

  return state;
}
