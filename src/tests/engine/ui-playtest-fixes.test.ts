import { describe, expect, it } from "vitest";
import { tradeUnavailableReason } from "../../engine/phases/company-operation/trade";
import { withOffice } from "../fixtures/builders";
import { createHotseatGame } from "../fixtures/game";

// Findings from the three-player playtest through the web UI.

describe("Trade availability is explained (p.17, no dead actions)", () => {
  it("names the empty sea zone when the President has no ships to trade with", () => {
    const state = withOffice(createHotseatGame({ seed: "no-ships" }), "president-madras", "player-red");
    expect(state.company.ships.some((ship) => ship.location === "south-indian")).toBe(false);
    expect(tradeUnavailableReason(state, "Madras")).toMatch(/no ships in the South Indian sea zone/);
  });

  it("gives no reason when the President could trade", () => {
    let state = withOffice(createHotseatGame({ seed: "ships" }), "president-madras", "player-red");
    state = {
      ...state,
      company: {
        ...state.company,
        ships: [...state.company.ships, { id: "company-ship-test", kind: "company", location: "south-indian", fatigued: false }],
      },
    };
    expect(tradeUnavailableReason(state, "Madras")).toBeUndefined();
  });
});
