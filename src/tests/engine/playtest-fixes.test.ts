import { describe, expect, it } from "vitest";
import type { GameState } from "../../engine";
import { createNewGame, chairmanHolder } from "../../engine";
import { resolveNewCompanyShares, startFamilyPhase } from "../../engine/phases/family";
import { startHiringPhase } from "../../engine/phases/hiring";
import { withChairmanMarker, withDebt, withPrestigeCard, withStockExchangePiece } from "../fixtures/family-hiring";
import { withHiringQueue } from "../fixtures/builders";
import { createRngState, rollDie } from "../../engine/rng";
import { atConfirmation, withDisplay, withPensioners, withPrestigeCards } from "../fixtures/london-season";
import { withCash } from "../fixtures/builders";
// from "../fixtures/london-season";
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

describe("Esther Summerson (card #12)", () => {
  function beckyState(topOfDeck: string): GameState {
    let state = createHotseatGame({ seed: "be1" });
    state = atConfirmation({ ...state, turn: 2 }, "londonSeason", "londonSeason.confirm");
    state = withPensioners(state, RED, 1);
    state = withCash(state, { [RED]: 5 });
    state = withPrestigeCards(state, RED, ["becky-sharp", "esther-summerson"]);
    state = withDisplay(state, ["shipbuilders", "foundry", "social-magazine"], [topOfDeck, "labour-newspaper"]);
    state = applyCommandOrThrow(state, { id: "be-1", actorId: "system", type: "londonSeason.confirm", payload: {} });
    // Retiring the pensioner earns a Prestige Cards pick.
    const retire = state.pendingDecision.legalCommands.find((command) => command.label.includes("£2 prize"));
    return applyCommandOrThrow(state, { id: "be-2", actorId: RED, type: retire!.type, payload: retire!.payload });
  }

  it("Becky Sharp's top-of-deck option is not offered when the top card is blackmail", () => {
    const state = beckyState("company-fraud");
    expect(state.pendingDecision.step).toBe("londonSeason.choosePrestigeCard");
    expect(hasCommand(state, "londonSeason.choosePrestigeCard", (payload) => payload.action === "takeTopOfDeck")).toBe(false);
  });

  it("Becky Sharp's top-of-deck option is still offered when the top card is a prestige card", () => {
    const state = beckyState("labour-newspaper");
    expect(hasCommand(state, "londonSeason.choosePrestigeCard", (payload) => payload.action === "takeTopOfDeck")).toBe(true);
  });
});

describe("Joseph Sedley (card #15)", () => {
  it("a holder's Stock Exchange piece does not become a Court share at the end of Family", () => {
    let state = withStockExchangePiece(createHotseatGame({ seed: "sd2" }), "stock-exchange-5", RED);
    state = withPrestigeCard(state, RED, "joseph-sedley");
    state = withDebt(state, 1);
    const supplyBefore = state.players[RED].familyMembers.supply;
    const next = resolveNewCompanyShares(state);
    expect(next.company.court.filter((share) => share.owner === RED)).toHaveLength(0);
    expect(next.company.stockExchange.every((slot) => !slot.share)).toBe(true);
    expect(next.players[RED].familyMembers.supply).toBe(supplyBefore + 1);
  });

  it("without Sedley the same piece does become a Court share", () => {
    let state = withStockExchangePiece(createHotseatGame({ seed: "sd2" }), "stock-exchange-5", RED);
    state = withDebt(state, 1);
    expect(resolveNewCompanyShares(state).company.court.filter((share) => share.owner === RED)).toHaveLength(1);
  });

  it("taking Sedley returns the holder's Stock Exchange pieces to supply", () => {
    let state = createHotseatGame({ seed: "sd3" });
    state = withStockExchangePiece(state, "stock-exchange-5", RED);
    state = atConfirmation({ ...state, turn: 2 }, "londonSeason", "londonSeason.confirm");
    state = withPensioners(state, RED, 1);
    state = withCash(state, { [RED]: 5 });
    state = withDisplay(state, ["joseph-sedley", "foundry", "social-magazine"], ["labour-newspaper"]);
    state = applyCommandOrThrow(state, { id: "sd-1", actorId: "system", type: "londonSeason.confirm", payload: {} });
    const retire = state.pendingDecision.legalCommands.find((command) => command.label.includes("£2 prize"))!;
    state = applyCommandOrThrow(state, { id: "sd-2", actorId: RED, type: retire.type, payload: retire.payload });
    const take = state.pendingDecision.legalCommands.find((command) => command.label.includes("Joseph Sedley"))!;
    const supplyBefore = state.players[RED].familyMembers.supply;
    state = applyCommandOrThrow(state, { id: "sd-3", actorId: RED, type: take.type, payload: take.payload });
    expect(state.company.stockExchange.every((slot) => !slot.share)).toBe(true);
    expect(state.players[RED].familyMembers.supply).toBe(supplyBefore + 1);
  });

  it("in an empty Court (p.15) a Sedley holder cannot continue as Chairman: there is no Chairman", () => {
    let state = withPrestigeCard(withChairmanMarker(createHotseatGame({ seed: "sd4" }), BLUE), BLUE, "joseph-sedley");
    state = startHiringPhase(withHiringQueue(state, ["chairman"]));
    expect(state.pendingDecision.step).not.toBe("hiring.emptyCourtChairman");
    expect(chairmanHolder(state)).toBeUndefined();
  });
});
