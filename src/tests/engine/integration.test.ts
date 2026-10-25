import { describe, expect, it } from "vitest";
import { applyCommand, resourceProblems, type GameState } from "../../engine";
import { payOfficeholderBonus, vacateAfterCatastrophe } from "../../engine/phases/company-operation/context";
import { withOffice } from "../fixtures/builders";
import { withCash } from "../fixtures/builders";
import { applyCommandOrThrow, createHotseatGame } from "../fixtures/game";
import { atConfirmation, withDisplay, withPensioners } from "../fixtures/london-season";
import { act } from "../fixtures/negotiation";
import { choose, hasCommand, parliamentState, withEnterprises } from "../fixtures/parliament";

// Cross-phase behaviour: anytime commands (p.8) can change cash and holdings under any pending
// decision, so options must be rebuilt and nothing may be spent that isn't there.

const RED = "player-red";
const BLUE = "player-blue";
const YELLOW = "player-yellow";

function confirmSystem(state: GameState): GameState {
  const legal = state.pendingDecision.legalCommands[0];
  return applyCommandOrThrow(state, { id: `system-${state.log.length}`, actorId: "system", type: legal.type, payload: legal.payload ?? {} });
}

/** Pass every vote and stop voting, until Parliament reaches a decision other than voting. */
function finishVoting(state: GameState): GameState {
  let current = state;
  while (current.pendingDecision.step === "parliament.vote" || current.pendingDecision.step === "parliament.continueVoting") {
    current =
      current.pendingDecision.step === "parliament.vote"
        ? choose(current, "parliament.passVote")
        : choose(current, "parliament.continueVoting", (payload) => payload.another === false);
  }
  return current;
}

function voteState(cash: Record<string, number>): GameState {
  let state = parliamentState({ drawPile: ["trade-regulations"], cash });
  state = choose(state, "parliament.confirm");
  state = choose(state, "parliament.selectLaw");
  return choose(state, "parliament.choosePolicy", (payload) => payload.space === 2);
}

const cashVotes = (state: GameState) =>
  state.pendingDecision.legalCommands
    .filter((command) => command.type === "parliament.castVotes")
    .map((command) => command.payload as { source: string; votes?: number })
    .filter((payload) => payload.source === "cash")
    .map((payload) => payload.votes);

describe("options after anytime commands (p.8)", () => {
  it("drops cash votes the voter can no longer afford and rejects the stale command", () => {
    const state = voteState({ [RED]: 2, [BLUE]: 5 });
    expect(state.pendingDecision.actor).toBe(RED);
    expect(cashVotes(state)).toEqual([1, 2]);
    const stale = state.pendingDecision.legalCommands.find(
      (command) => command.type === "parliament.castVotes" && (command.payload as { votes?: number }).votes === 2,
    )!;

    const after = act(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "cash", amount: 1 }] });

    expect(after.pendingDecision.actor).toBe(RED);
    expect(cashVotes(after)).toEqual([1]);
    const result = applyCommand(after, {
      id: "stale-vote",
      gameId: after.gameId,
      actorId: RED,
      decisionId: after.pendingDecision.id,
      type: stale.type,
      payload: stale.payload,
      clientTimestamp: "2026-06-13T12:10:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(after.players[RED].cash).toBe(1);
  });

  it("moves on when the voter gives away everything they could vote with", () => {
    const state = voteState({ [RED]: 2, [BLUE]: 5 });

    const after = act(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "cash", amount: 2 }] });

    expect(after.players[RED].cash).toBe(0);
    expect(after.pendingDecision.actor).not.toBe(RED);
  });

  it("adds cash votes the voter can newly afford", () => {
    const state = voteState({ [RED]: 1, [BLUE]: 5 });
    expect(cashVotes(state)).toEqual([1]);

    const after = act(state, BLUE, "negotiation.give", { to: RED, items: [{ kind: "cash", amount: 2 }] });

    expect(cashVotes(after)).toEqual([1, 2, 3]);
  });
});

describe("refreshers registered by the phases", () => {
  it("lets a taxed player borrow and pay instead of returning targets (pp.8, 34)", () => {
    let state = withEnterprises(
      parliamentState({ drawPile: ["calico-acts"], dial: 9, cash: { [BLUE]: 1, [RED]: 3 } }),
      BLUE,
      [
        { type: "workshop", cardId: "workshop-01" },
        { type: "workshop", cardId: "workshop-02" },
      ],
    );
    state = choose(state, "parliament.confirm");
    state = choose(state, "parliament.selectLaw");
    state = finishVoting(choose(state, "parliament.choosePolicy", (payload) => payload.space === 10));
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "parliament.surrender", actor: BLUE }));

    state = act(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "cash", amount: 1 }] });

    // Blue now has £2 for the two workshops, keeps both, and Calico Acts then pays £2 for each.
    expect(state.players[BLUE].enterprises).toHaveLength(2);
    expect(state.players[BLUE].cash).toBe(4);
    expect(state.phase).toBe("upkeep");
  });

  it("offers a prize a pensioner can newly afford after a gift (pp.8, 11)", () => {
    const base = createHotseatGame({ seed: "integration-retire", gameId: "game-integration-retire" });
    let state = withPensioners(withCash(atConfirmation({ ...base, turn: 2 }, "londonSeason", "londonSeason.confirm"), { [RED]: 2, [YELLOW]: 6 }), RED, 1);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirmSystem(state);
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "retirement.retirePensioner", actor: RED }));
    const prizeIds = (game: GameState) =>
      game.pendingDecision.legalCommands
        .filter((legal) => legal.type === "retirement.retirePensioner")
        .map((legal) => (legal.payload as { prizeId: string }).prizeId);
    expect(prizeIds(state)).toEqual(["prize-2"]);

    state = act(state, YELLOW, "negotiation.give", { to: RED, items: [{ kind: "cash", amount: 6 }] });

    expect(prizeIds(state)).toEqual(["prize-2", "prize-4", "prize-8"]);
  });
});

describe("dispatcher guards", () => {
  it("rejects a payload that is not one of the offered options", () => {
    const state = voteState({ [RED]: 2, [BLUE]: 5 });
    const result = applyCommand(state, {
      id: "forged-vote",
      gameId: state.gameId,
      actorId: RED,
      decisionId: state.pendingDecision.id,
      type: "parliament.castVotes",
      payload: { direction: "for", source: "cash", votes: 50 },
      clientTimestamp: "2026-06-13T12:10:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((error) => error.code)).toEqual(["ILLEGAL_PAYLOAD_FOR_DECISION"]);
  });

  it("reports negative cash, negative piece counts, and missing family pieces", () => {
    const state = voteState({ [RED]: 2, [BLUE]: 5 });
    expect(resourceProblems(state)).toEqual([]);

    const broken = withCash(state, { [RED]: -1 });
    const red = broken.players[RED];
    const worse: GameState = {
      ...broken,
      players: {
        ...broken.players,
        [RED]: { ...red, familyMembers: { ...red.familyMembers, supply: red.familyMembers.supply - 20 } },
      },
    };

    expect(resourceProblems(worse)).toEqual([
      "Red would have £-1.",
      `Red would have ${red.familyMembers.supply - 20} family members in supply.`,
      `Red's family pieces would total -2, not 18.`,
    ]);
  });
});

describe("promise hooks", () => {
  it("records each paid officeholder bonus for the promise card, and voids it on catastrophe", () => {
    let state = withOffice(createHotseatGame({ seed: "bonus", gameId: "game-bonus" }), "governor-bengal", RED);
    state = { ...state, phase: "companyOperation" };
    state = payOfficeholderBonus(state, "governor-bengal", 2).state;
    expect(state.negotiation.officeholderBonuses).toEqual([
      expect.objectContaining({ officeId: "governor-bengal", playerId: RED, amount: 2, taken: false }),
    ]);

    state = vacateAfterCatastrophe(state, "governor-bengal");
    expect(state.negotiation.officeholderBonuses[0].taken).toBe(true);
    expect(state.company.offices["governor-bengal"].vacant).toBe(true);
  });

  it("lends the guarantor's enterprise votes once \"Vote with my enterprises\" is called in (card back)", () => {
    let state = voteState({ [RED]: 1, [BLUE]: 0 });
    state = withEnterprises(state, BLUE, [{ type: "workshop", cardId: "workshop-01" }]);
    const promise = `promise-${BLUE}-vote-with-my-enterprises`;
    state = act(state, BLUE, "negotiation.give", { to: RED, items: [{ kind: "promise", promiseId: promise }] });
    const cardVotes = (game: GameState) =>
      game.pendingDecision.legalCommands.filter((command) => (command.payload as { source?: string }).source === "card");
    expect(state.pendingDecision.actor).toBe(RED);
    expect(cardVotes(state)).toEqual([]);

    state = act(state, RED, "negotiation.callInPromises", { calls: [{ promiseId: promise, option: {} }] });

    expect(state.pendingDecision.actor).toBe(RED);
    expect(cardVotes(state).length).toBeGreaterThan(0);
  });

  it("gives the guarantor's London Season pick to the holder of \"Take my card\" (card back)", () => {
    const base = createHotseatGame({ seed: "integration-pick", gameId: "game-integration-pick" });
    let state = withPensioners(withCash(atConfirmation({ ...base, turn: 2 }, "londonSeason", "londonSeason.confirm"), { [RED]: 2 }), RED, 1);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    const promise = `promise-${RED}-take-my-card-from-london-season-display`;
    state = act(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "promise", promiseId: promise }] });
    state = confirmSystem(state);
    state = act(state, BLUE, "negotiation.callInPromises", { calls: [{ promiseId: promise, option: {} }] });
    const retire = state.pendingDecision.legalCommands.find((command) => command.type === "retirement.retirePensioner")!;
    state = applyCommandOrThrow(state, { id: "retire", actorId: RED, type: retire.type, payload: retire.payload });

    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "londonSeason.choosePrestigeCard", actor: BLUE }));
    const take = state.pendingDecision.legalCommands.find((command) => command.label.includes("Foundry") && command.label.startsWith("Take"))!;
    state = applyCommandOrThrow(state, { id: "take", actorId: BLUE, type: take.type, payload: take.payload });
    expect(state.players[BLUE].prestigeCards.map((card) => card.cardId)).toContain("foundry");
    expect(state.players[RED].prestigeCards).toEqual([]);
  });

  it("removes the Vote with my enterprises promise when Lady Newcome is taken", () => {
    const base = createHotseatGame({ seed: "integration-newcome", gameId: "game-integration-newcome" });
    let state = withPensioners(withCash(atConfirmation({ ...base, turn: 2 }, "londonSeason", "londonSeason.confirm"), { [RED]: 2 }), RED, 1);
    state = withDisplay(state, ["lady-newcome", "stock-broker", "tax-collectors"]);
    state = confirmSystem(state);
    const retire = state.pendingDecision.legalCommands.find((command) => command.type === "retirement.retirePensioner")!;
    state = applyCommandOrThrow(state, { id: "retire", actorId: RED, type: retire.type, payload: retire.payload });
    const take = state.pendingDecision.legalCommands.find((command) => command.label.startsWith("Take Lady Newcome"))!;
    state = applyCommandOrThrow(state, { id: "take", actorId: RED, type: take.type, payload: take.payload });

    const card = state.negotiation.promiseCards.find((candidate) => candidate.id === `promise-${RED}-vote-with-my-enterprises`);
    expect(card?.removedFromGame).toBe(true);
  });
});
