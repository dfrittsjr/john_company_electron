import { describe, expect, it } from "vitest";
import type { GameState } from "../../engine";
import { withOffice } from "../fixtures/builders";
import { applyCommandOrThrow, createHotseatGame } from "../fixtures/game";
import { BLUE, choose, enterOperation, operationGame, payloads } from "../fixtures/company-operation";
import { atConfirmation, choiceLabelled, withDisplay, withPensioners, withPlayerFields, withPrizePieces } from "../fixtures/london-season";
import { parliamentState } from "../fixtures/parliament";
import { withRegiments } from "../fixtures/builders";

const RED = "player-red";
const OFFICE = "manager-of-shipping";

function shippingAt(treasury: number): GameState {
  let state = operationGame("shipping-minimum");
  state = withOffice(state, OFFICE, BLUE, { treasury });
  return enterOperation(state, ["chairman", "director-of-trade"]);
}

describe("Manager of Shipping spends at least down to £2, not exactly (p.19)", () => {
  it("above £2 only purchases are offered, with no Finish", () => {
    const state = shippingAt(4);
    expect(state.pendingDecision.step).toBe("companyOperation.shipping");
    expect(payloads(state).some((payload) => payload.action === "lease")).toBe(true);
    expect(payloads(state).some((payload) => payload.action === "finish")).toBe(false);
  });

  it("at £2 the Manager may still lease an extra ship, or finish", () => {
    let state = shippingAt(4);
    state = choose(state, { action: "lease", to: "south-indian" });
    expect(state.company.offices[OFFICE].treasury).toBe(2);
    expect(state.companyOperation.actedOffices).not.toContain(OFFICE);
    expect(payloads(state)).toContainEqual({ action: "finish" });
    expect(payloads(state).some((payload) => payload.action === "lease")).toBe(true);

    const leased = choose(state, { action: "lease", to: "south-indian" });
    expect(leased.company.offices[OFFICE].treasury).toBe(0);
    expect(leased.companyOperation.actedOffices).toContain(OFFICE);

    const finished = choose(state, { action: "finish" });
    expect(finished.company.offices[OFFICE].treasury).toBe(2);
    expect(finished.companyOperation.actedOffices).toContain(OFFICE);
  });

  it("ends automatically when nothing is affordable", () => {
    let state = shippingAt(3);
    expect(payloads(state).some((payload) => payload.action === "finish")).toBe(false);
    state = choose(state, { action: "lease", to: "south-indian" });
    expect(state.company.offices[OFFICE].treasury).toBe(1);
    expect(state.companyOperation.actedOffices).toContain(OFFICE);
    expect(state.pendingDecision.step).not.toBe("companyOperation.shipping");
  });
});

describe("Retirement warns when upkeep could not be paid (pp.11-12, p.36)", () => {
  function retirementFor(cash: number, existingPrize2 = 0) {
    let state = createHotseatGame({ seed: "retire-warning", gameId: "game-retire-warning" });
    state = atConfirmation({ ...state, turn: 2 }, "londonSeason", "londonSeason.confirm");
    state = withPlayerFields(state, RED, { cash });
    state = withPensioners(state, RED, 1);
    if (existingPrize2 > 0) state = withPrizePieces(state, RED, "prize-4", existingPrize2);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    const legal = state.pendingDecision.legalCommands[0];
    return applyCommandOrThrow(state, { id: "command-warn-1", actorId: "system", type: legal.type, payload: legal.payload ?? {} });
  }
  const option = (state: GameState, text: string) =>
    state.pendingDecision.legalCommands.find((legal) => legal.label.startsWith(text))!;

  it("warns when the cash left is below the upkeep owed", () => {
    const state = retirementFor(4);
    expect(state.pendingDecision.step).toBe("retirement.retirePensioner");
    const prize4 = option(state, "Retire to the £4 prize");
    expect(prize4.description).toContain("you'd have £0 left for £1 upkeep");
  });

  it("does not warn when the cash left covers the upkeep, and counts pieces already on prizes", () => {
    expect(option(retirementFor(6), "Retire to the £4 prize").description ?? "").not.toContain("upkeep");
    // One piece already on the £4 prize (upkeep £1) plus the new £4 piece (£1): £2 owed, £1 left.
    const withExisting = retirementFor(5, 1);
    expect(option(withExisting, "Retire to the £4 prize").description).toContain("you'd have £1 left for £2 upkeep");
    expect(choiceLabelled(withExisting, "Retire to the £4 prize").type).toBe("retirement.retirePensioner");
  });
});

describe("Royal Protection prompt (Revenue)", () => {
  it("says what discarding does", () => {
    let state = parliamentState({ drawPile: [], passedLaws: ["royal-protection"] });
    state = withRegiments(state, { Bombay: { ready: 6, exhausted: 0 }, Madras: { ready: 0, exhausted: 0 }, Bengal: { ready: 0, exhausted: 0 } });
    state = withOffice(state, "chairman", RED);
    state = {
      ...state,
      phase: "revenue",
      company: { ...state.company, balance: 2, debt: 0, vacantOffices: [] },
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
    state = applyCommandOrThrow(state, { id: "command-rp-1", actorId: "system", type: "revenue.confirm", payload: {} });
    expect(state.pendingDecision.step).toBe("revenue.royalProtection");
    const discard = state.pendingDecision.legalCommands.find((legal) => (legal.payload as { discard: boolean }).discard)!;
    const text = discard.description ?? "";
    expect(text).toContain("The Balance pays what it can");
    expect(text).toContain("no emergency loans");
    expect(text).toContain("Expectations are still checked afterwards");
  });
});
