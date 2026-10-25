import { describe, expect, test } from "vitest";
import type { GameState } from "../engine";
import { suggestedSaveName, suggestedSummaryName } from "./save-names";

function gameAt(fields: {
  scenario: string;
  turn: number;
  phase: string;
  actor: string;
  players?: Record<string, { name: string }>;
}): GameState {
  return {
    scenario: fields.scenario,
    turn: fields.turn,
    phase: fields.phase,
    pendingDecision: { actor: fields.actor },
    players: fields.players ?? {},
  } as unknown as GameState;
}

describe("suggestedSaveName", () => {
  test("names the save after the player who acts next", () => {
    const game = gameAt({
      scenario: "1710",
      turn: 2,
      phase: "hiring",
      actor: "player-yellow",
      players: { "player-yellow": { name: "Yellow" } },
    });

    expect(suggestedSaveName(game)).toBe("1710-t2-hiring-for-Yellow.joco");
    expect(suggestedSummaryName(game)).toBe("1710-t2-hiring-for-Yellow-summary.txt");
  });

  test("kebab-cases phases and strips characters that are unsafe in file names", () => {
    const game = gameAt({
      scenario: "long-1710",
      turn: 7,
      phase: "companyOperation",
      actor: "player-1",
      players: { "player-1": { name: "Lady Glencora / Pink" } },
    });

    expect(suggestedSaveName(game)).toBe("long-1710-t7-company-operation-for-Lady-Glencora-Pink.joco");
  });

  test("uses neutral names for system and simultaneous decisions", () => {
    expect(
      suggestedSaveName(gameAt({ scenario: "1710", turn: 1, phase: "eventsInIndia", actor: "system" })),
    ).toBe("1710-t1-events-in-india-for-anyone.joco");
    expect(
      suggestedSaveName(gameAt({ scenario: "1813", turn: 5, phase: "firms", actor: "simultaneous" })),
    ).toBe("1813-t5-firms-for-everyone.joco");
  });
});
