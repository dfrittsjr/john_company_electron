import { describe, expect, it } from "vitest";
import type { GameState } from "../../engine";
import {
  YELLOW as CO_YELLOW,
  choose as coChoose,
  enterOperation,
  operationGame,
  withDice,
  OFFICES_BEFORE_PRESIDENCIES,
} from "../fixtures/company-operation";
import { withAssociatedRegion } from "../fixtures/builders";
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
import { promiseCallOptions } from "../../engine";
import { choose, hasCommand, parliamentState, withBlackmail, withEnterprises } from "../fixtures/parliament";

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

describe("Governor administer (p.24)", () => {
  it("a catastrophic Administer also adds an unrest to the region before the Governor is removed", () => {
    let state = operationGame("catastrophe-unrest");
    state = withOffice(state, "president-madras", RED, { treasury: 0 });
    state = withAssociatedRegion(state, "madras", "Madras");
    state = withOffice(state, "governor-madras", CO_YELLOW);
    state = enterOperation(state, [...OFFICES_BEFORE_PRESIDENCIES, "president-bombay"]);
    state = coChoose(state, { action: "governor", officeId: "governor-madras" });
    const before = state.india.regions.madras.unrest;
    const result = withDice(
      state,
      (seeded) => coChoose(seeded, { action: "administer" }),
      (next) => next.company.offices["governor-madras"].vacant,
    );
    expect(result.india.regions.madras.unrest).toBe(before + 1);
    expect(result.log.at(-1)?.summary).toContain("catastroph");
  });
});

describe("Vote with my enterprises timing (card back: afterLawProposedBeforeVotes)", () => {
  it("can be called in only after the law and policy are proposed and before any vote is cast", () => {
    let state = parliamentState({ drawPile: ["calico-acts"], cash: { [BLUE]: 3, [YELLOW]: 1 } });
    state = withEnterprises(state, BLUE, [{ type: "workshop", cardId: "workshop-1" }]);
    const promiseId = "promise-player-blue-vote-with-my-enterprises";
    state = {
      ...state,
      negotiation: {
        ...state.negotiation,
        promiseCards: state.negotiation.promiseCards.map((card) => (card.id === promiseId ? { ...card, holder: YELLOW } : card)),
      },
    };
    const callable = (s: GameState) => promiseCallOptions(s, YELLOW).some((option) => option.promiseId === promiseId);

    expect(callable(state)).toBe(false); // before Parliament meets
    state = choose(state, "parliament.confirm");
    expect(callable(state)).toBe(false); // law not chosen yet
    state = choose(state, "parliament.selectLaw");
    expect(callable(state)).toBe(false); // policy not chosen yet
    state = choose(state, "parliament.choosePolicy");
    expect(state.pendingDecision.step).toBe("parliament.vote");
    expect(callable(state)).toBe(true);

    // Once any vote has been cast it is too late.
    for (let guard = 0; guard < 10 && state.pendingDecision.step === "parliament.vote"; guard += 1) {
      const actor = state.pendingDecision.actor;
      if (actor === BLUE) {
        state = choose(state, "parliament.castVotes", (payload) => payload.direction === "against" && payload.votes === 3);
        break;
      }
      state = choose(state, "parliament.passVote");
    }
    expect(callable(state)).toBe(false);
  });
});

describe("Coalitions need the partner's consent (p.35)", () => {
  function coalitionRequest(): GameState {
    let state = parliamentState({ drawPile: ["trade-regulations"], cash: { [RED]: 2, [BLUE]: 5, [YELLOW]: 5 } });
    state = choose(state, "parliament.confirm");
    state = choose(state, "parliament.selectLaw");
    state = choose(state, "parliament.choosePolicy", (payload) => payload.space === 2);
    state = choose(state, "parliament.passVote"); // Red, the Prime Minister
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, "parliament.passVote");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    return choose(state, "parliament.setVoteCredit", (payload) => payload.creditTo === BLUE);
  }

  it("asks the partner and joins the opposition only when they accept", () => {
    let state = coalitionRequest();
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "negotiation.consent", actor: BLUE }));
    expect(state.parliament.session?.opposition).not.toContain(BLUE);
    state = choose(state, "negotiation.respondToConsent", (payload) => payload.accept === true);
    expect(state.parliament.session?.creditTo[YELLOW]).toBe(BLUE);
    expect(state.parliament.session?.opposition).toContain(BLUE);
    expect(state.pendingDecision.actor).toBe(YELLOW);
  });

  it("changes nothing on refusal and does not offer the same partner again", () => {
    let state = coalitionRequest();
    state = choose(state, "negotiation.respondToConsent", (payload) => payload.accept === false);
    expect(state.parliament.session?.creditTo[YELLOW]).toBeUndefined();
    expect(state.parliament.session?.opposition).not.toContain(BLUE);
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "parliament.vote", actor: YELLOW }));
    expect(hasCommand(state, "parliament.setVoteCredit", (payload) => payload.creditTo === BLUE)).toBe(false);
  });
});

describe("Vote and allocation amounts", () => {
  it("offers every cash vote amount from 1 to the most the player can pay for (p.35)", () => {
    let state = parliamentState({ drawPile: ["trade-regulations"], cash: { [RED]: 2, [BLUE]: 7, [YELLOW]: 5 } });
    state = choose(state, "parliament.confirm");
    state = choose(state, "parliament.selectLaw");
    state = choose(state, "parliament.choosePolicy", (payload) => payload.space === 2);
    state = choose(state, "parliament.passVote"); // Red, the Prime Minister
    expect(state.pendingDecision.actor).toBe(BLUE);
    const against = state.pendingDecision.legalCommands
      .filter((command) => command.type === "parliament.castVotes")
      .map((command) => command.payload as { direction: string; source: string; votes?: number })
      .filter((payload) => payload.direction === "against" && payload.source === "cash")
      .map((payload) => payload.votes);
    expect(against).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("Chairman allocation amounts (p.18)", () => {
  it("offers 1, 2, 3, 5, 10 and all per office, only within the remaining Balance", () => {
    const amountsFor = (balance: number): number[] => {
      let state = withOffice(operationGame("allocation"), "chairman", RED);
      state = { ...state, company: { ...state.company, balance } };
      state = enterOperation(state, []);
      return state.pendingDecision.legalCommands
        .map((command) => command.payload as { action: string; officeId?: string; amount?: number })
        .filter((payload) => payload.action === "allocate" && payload.officeId === "manager-of-shipping")
        .map((payload) => payload.amount as number);
    };
    expect(amountsFor(12)).toEqual([1, 2, 3, 5, 10, 12]);
    expect(amountsFor(4)).toEqual([1, 2, 3, 4]);
  });
});
