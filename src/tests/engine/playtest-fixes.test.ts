import { describe, expect, it } from "vitest";
import type { GameState } from "../../engine";
import { withOffice } from "../fixtures/builders";
import { choose, hasCommand, parliamentState, withBlackmail } from "../fixtures/parliament";

// Fixes from playtest reports. Each test names the rulebook page or card it checks.

const RED = "player-red";
const BLUE = "player-blue";
const YELLOW = "player-yellow";

function revenueState(): GameState {
  const state = parliamentState({ drawPile: [], passedLaws: [] });
  return {
    ...state,
    phase: "revenue",
    company: { ...state.company, balance: 0, debt: 0, vacantOffices: [] },
    pendingDecision: {
      id: "decision-revenue-test",
      phase: "revenue",
      step: "revenue.confirm",
      actor: "system",
      visibility: "public",
      prompt: "Revenue",
      legalCommands: [{ type: "revenue.confirm", label: "Revenue", payload: {} }],
      canSave: true,
    },
  };
}

describe("Blackmail reactions restore a playable decision (Man on the Inside, p.12)", () => {
  it("after Man on the Inside cancels a Scandal, the restored Scandal offer no longer offers that card", () => {
    let state = withBlackmail(revenueState(), BLUE, "scandal-on-leadenhall-street");
    state = withBlackmail(state, YELLOW, "man-on-the-inside");
    state = withOffice(state, "manager-of-shipping", RED);
    state = choose(state, "revenue.confirm");
    state = choose(state, "revenue.chooseDividends");
    expect(state.pendingDecision.step).toBe("revenue.playScandal");
    state = choose(state, "revenue.playScandal", (payload) => Boolean(payload.cardInstanceId));
    expect(state.pendingDecision.step).toBe("negotiation.blackmailReaction");
    state = choose(state, "negotiation.respondToBlackmail", (payload) => payload.cancel === true);

    // The cancelled card is now face up in Yellow's area; the game continues instead of throwing.
    expect(state.players[YELLOW].blackmailCards.find((card) => card.cardId === "scandal-on-leadenhall-street")?.facedown).toBe(false);
    expect(hasCommand(state, "revenue.playScandal", (payload) => Boolean(payload.cardInstanceId))).toBe(false);
    expect(state.pendingDecision.step).not.toBe("negotiation.blackmailReaction");
  });
});
