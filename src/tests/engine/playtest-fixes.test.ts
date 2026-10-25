import { describe, expect, it } from "vitest";
import type { GameState } from "../../engine";
import { createNewGame } from "../../engine";
import { createRngState, rollDie } from "../../engine/rng";
import { atConfirmation } from "../fixtures/london-season";
import { applyCommandOrThrow } from "../fixtures/game";
import { withOffice } from "../fixtures/builders";
import { createHotseatGame } from "../fixtures/game";
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

describe("Setup", () => {
  it("starts the Company Balance at 5 (setup step 4, p.4)", () => {
    const state = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "balance",
      gameId: "game-balance",
      now: "2026-06-13T12:00:00.000Z",
      players: [
        { id: RED, name: "Red", color: "red" },
        { id: BLUE, name: "Blue", color: "blue" },
        { id: YELLOW, name: "Yellow", color: "yellow" },
      ],
    });
    expect(state.company.balance).toBe(5);
  });
});

describe("Tenure Limits (law #37)", () => {
  function seedWhereFirstDieIs1(): string {
    for (let i = 0; i < 500; i += 1) {
      if (rollDie(createRngState(`tl-${i}`), 6).value === 1) return `tl-${i}`;
    }
    throw new Error("no seed");
  }

  function londonSeason(passedLaws: string[]): GameState {
    let state = createHotseatGame({ seed: seedWhereFirstDieIs1() });
    state = withOffice(state, "chairman", RED);
    state = {
      ...state,
      parliament: { ...state.parliament, passedLaws: passedLaws.map((lawId) => ({ id: `law-${lawId}`, lawId })) },
    };
    return atConfirmation({ ...state, turn: 3 }, "londonSeason", "londonSeason.confirm");
  }

  it("the Chairman always retires in Attrition even on a low roll", () => {
    const state = applyCommandOrThrow(londonSeason(["tenure-limits"]), { id: "tenure-1", actorId: "system", type: "londonSeason.confirm", payload: {} });
    expect(state.company.offices.chairman.vacant).toBe(true);
    expect(state.players[RED].familyMembers.pensioners).toBeGreaterThanOrEqual(1);
  });

  it("without the law a low roll leaves the Chairman in office", () => {
    const state = applyCommandOrThrow(londonSeason([]), { id: "tenure-2", actorId: "system", type: "londonSeason.confirm", payload: {} });
    expect(state.company.offices.chairman.vacant).toBe(false);
  });
});
