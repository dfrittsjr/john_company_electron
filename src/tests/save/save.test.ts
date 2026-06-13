import { describe, expect, it } from "vitest";
import { createNewGame } from "../../engine";
import {
  SaveValidationError,
  checksumGameState,
  createSaveEnvelope,
  deserializeGameState,
  deserializeSave,
  serializeSave,
} from "../../save";

const NOW = "2026-06-13T12:00:00.000Z";

describe("save envelopes", () => {
  it("round trips a save while preserving state and checksum metadata", () => {
    const state = createNewGame({
      mode: "soloCrown",
      scenario: "1710",
      seed: "save-roundtrip",
      gameId: "game-save-roundtrip",
      now: NOW,
      players: [{ id: "player-blue", name: "Blue", color: "blue" }],
      crownDifficulty: "normal",
    });
    const envelope = createSaveEnvelope(state, {
      saveId: "save-1",
      parentSaveId: null,
      now: NOW,
    });
    const serialized = serializeSave(envelope);
    const loadedEnvelope = deserializeSave(serialized);
    const loadedState = deserializeGameState(serialized);

    expect(loadedEnvelope).toEqual(envelope);
    expect(loadedState).toEqual(state);
    expect(loadedEnvelope.checksums.stateSha256).toBe(checksumGameState(state));
    expect(loadedEnvelope.activeActor).toBe(state.pendingDecision.actor);
    expect(loadedEnvelope.pendingDecisionId).toBe(state.pendingDecision.id);
  });

  it("rejects a save when the embedded state no longer matches its checksum", () => {
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1758",
      seed: "tamper-test",
      gameId: "game-tamper-test",
      now: NOW,
      players: [
        { id: "player-red", name: "Red", color: "red" },
        { id: "player-blue", name: "Blue", color: "blue" },
        { id: "player-yellow", name: "Yellow", color: "yellow" },
      ],
    });
    const envelope = createSaveEnvelope(state, {
      saveId: "save-1",
      now: NOW,
    });
    const tampered = {
      ...envelope,
      state: {
        ...envelope.state,
        turn: 2,
      },
    };

    expect(() => deserializeSave(JSON.stringify(tampered))).toThrow(SaveValidationError);
  });
});
