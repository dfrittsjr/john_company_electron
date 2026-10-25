import { describe, expect, test } from "vitest";
import {
  applyCommand,
  blackmailPlayChoices,
  promiseCallOptions,
  promiseCardsHeldBy,
  recordOfficeholderBonus,
  type GameState,
  type PhaseId,
  type PlayerId,
} from "../../engine";
import { createRngState, rollDie } from "../../engine/rng";
import { withCourtShares, withOffice } from "../fixtures/builders";
import { expectGameInvariants } from "../fixtures/game";
import { BLUE, RED, YELLOW, negotiationGame, withBlackmail, withEnterprise } from "../fixtures/negotiation";

// Random anytime play in every phase: gifts, deals, promise calls (including the guarantor's
// choice) and blackmail with Man on the Inside reactions must never be rejected after being
// offered, never break piece conservation, and always hand control back to the parked decision.

const PLAYERS = [RED, BLUE, YELLOW];
const NEGOTIATION_STEPS = new Set(["negotiation.consent", "negotiation.choosePromise", "negotiation.blackmailReaction"]);
const seenLogTypes = new Set<string>();

function seeded(phase: PhaseId): GameState {
  let state = negotiationGame(phase, { [RED]: 6, [BLUE]: 4, [YELLOW]: 3 });
  state = withOffice(state, "chairman", RED);
  state = withOffice(state, "director-of-trade", BLUE);
  state = withOffice(state, "president-bombay", YELLOW);
  state = withCourtShares(state, [
    { id: "share-1", owner: BLUE },
    { id: "share-2", owner: YELLOW },
  ]);
  state = withEnterprise(state, RED, { id: "lux-1", type: "luxury", cardId: "luxury-01" });
  state = withEnterprise(state, BLUE, { id: "ws-1", type: "workshop", cardId: "workshop-01" });
  state = withBlackmail(state, RED, "the-prime-ministers-ear", { instanceId: "ear" });
  state = withBlackmail(state, RED, "envoy-to-the-mughals", { instanceId: "envoy" });
  state = withBlackmail(state, BLUE, "scandal-on-leadenhall-street", { instanceId: "leadenhall" });
  state = withBlackmail(state, BLUE, "scandal-in-india", { instanceId: "india" });
  state = withBlackmail(state, YELLOW, "man-on-the-inside", { instanceId: "man" });
  state = recordOfficeholderBonus(state, { officeId: "president-bombay", playerId: YELLOW, amount: 3 });
  state = {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        "president-bombay": { ...state.company.offices["president-bombay"], actedThisTurn: true },
      },
    },
  };
  // Hand out each family's promises so there is something to call in.
  // Red holds both of Yellow's cash promises, so calling them together can exceed Yellow's cash.
  const promises = state.negotiation.promiseCards.map((card, index) => ({
    ...card,
    holder:
      card.guarantor === YELLOW && (card.type === "take-up-to-2-from-me" || card.type === "take-my-officeholders-bonus")
        ? RED
        : PLAYERS[(PLAYERS.indexOf(card.guarantor) + 1 + (index % 2)) % 3],
  }));
  return { ...state, negotiation: { ...state.negotiation, promiseCards: promises } };
}

type Move = { actor: PlayerId; type: string; payload: unknown };

function anytimeMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  for (const actor of PLAYERS) {
    for (const to of PLAYERS.filter((candidate) => candidate !== actor)) {
      if (state.players[actor].cash > 0) {
        moves.push({ actor, type: "negotiation.give", payload: { to, items: [{ kind: "cash", amount: 1 }] } });
      }
      if (state.negotiation.interrupts.length === 0 && state.players[to].cash > 0) {
        moves.push({ actor, type: "negotiation.proposeTrade", payload: { to, give: [], receive: [{ kind: "cash", amount: 1 }] } });
      }
      for (const card of promiseCardsHeldBy(state, actor).slice(0, 1)) {
        moves.push({ actor, type: "negotiation.give", payload: { to, items: [{ kind: "promise", promiseId: card.id }] } });
      }
    }
    const options = promiseCallOptions(state, actor);
    for (const option of options) {
      moves.push({ actor, type: "negotiation.callInPromises", payload: { calls: [{ promiseId: option.promiseId, option: option.option }] } });
    }
    const oneOptionPerCard = options.filter(
      (option, index) => options.findIndex((candidate) => candidate.promiseId === option.promiseId) === index,
    );
    if (oneOptionPerCard.length > 1) {
      moves.push({
        actor,
        type: "negotiation.callInPromises",
        payload: { calls: oneOptionPerCard.slice(0, 2).map((option) => ({ promiseId: option.promiseId, option: option.option })) },
      });
    }
    for (const choice of blackmailPlayChoices(state, actor)) {
      for (const option of choice.options) {
        moves.push({ actor, type: "negotiation.playBlackmail", payload: { cardInstanceId: choice.cardInstanceId, params: option.params } });
      }
    }
  }
  return moves;
}

function run(phase: PhaseId, seed: string, steps: number): void {
  let state = seeded(phase);
  const parkedStep = state.pendingDecision.step;
  let rng = createRngState(seed);
  const choose = <T,>(items: T[]): T => {
    if (items.length === 1) return items[0];
    const roll = rollDie(rng, items.length, "negotiation.random");
    rng = roll.rng;
    return items[roll.value - 1];
  };

  for (let step = 0; step < steps; step += 1) {
    const decision = state.pendingDecision;
    let move: Move | undefined;
    if (NEGOTIATION_STEPS.has(decision.step)) {
      const legal = choose(decision.legalCommands);
      move = { actor: decision.actor as PlayerId, type: legal.type, payload: legal.payload };
    } else {
      expect(decision.step).toBe(parkedStep);
      expect(state.negotiation.interrupts).toEqual([]);
      const moves = anytimeMoves(state);
      if (moves.length === 0) break;
      move = choose(moves);
    }

    const result = applyCommand(state, {
      id: `random-${step}`,
      gameId: state.gameId,
      actorId: move.actor,
      decisionId: state.pendingDecision.id,
      type: move.type,
      payload: move.payload,
      clientTimestamp: "2026-06-13T12:10:00.000Z",
    });
    if (!result.ok) {
      throw new Error(`${phase} step ${step}: ${move.type} ${JSON.stringify(move.payload)} rejected: ${result.errors.map((error) => error.message).join(" ")}`);
    }
    seenLogTypes.add(result.logEntry.type);
    for (const entry of result.state.log.slice(state.log.length)) seenLogTypes.add(entry.type);
    state = result.state;
    expectGameInvariants(state);
    for (const playerId of PLAYERS) expect(state.players[playerId].cash).toBeGreaterThanOrEqual(0);
  }
}

describe("random negotiation play", () => {
  test.each<PhaseId>(["londonSeason", "family", "hiring", "companyOperation", "revenue", "eventsInIndia", "parliament", "upkeep"])(
    "%s: offered anytime moves are always accepted and control returns",
    (phase) => {
      for (const seed of ["a", "b", "c", "d", "e"]) run(phase, `${phase}-${seed}`, 300);
    },
  );

  test("reaches every negotiation path", () => {
    expect([...seenLogTypes].filter((type) => type.startsWith("negotiation.")).sort()).toEqual([
      "negotiation.blackmailCanceled",
      "negotiation.blackmailPlayed",
      "negotiation.blackmailResolved",
      "negotiation.consentGiven",
      "negotiation.consentRefused",
      "negotiation.promiseCalledIn",
      "negotiation.promiseFulfilled",
      "negotiation.promisesUnfulfilled",
      "negotiation.tradeCompleted",
      "negotiation.tradeProposed",
      "negotiation.tradeRefused",
      "negotiation.transfer",
    ]);
  });
});
