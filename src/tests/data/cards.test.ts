import { describe, expect, test } from "vitest";
import {
  BLACKMAIL_CARD_COUNT,
  COMPANY_FAILURE_CARD_COUNT,
  PRESTIGE_CARD_COUNT,
  PROMISE_CARD_TYPE_COUNT,
  blackmailCards,
  companyFailureCards,
  prestigeCards,
  promiseCardFamilies,
  promiseCardTypes,
} from "../../data/cards";

const allCards = [...prestigeCards, ...blackmailCards, ...companyFailureCards];
const byId = (id: string) => allCards.find((card) => card.id === id);

describe("card counts match the rulebook component list (p.2, p.8)", () => {
  test("20 prestige, 10 blackmail, 6 failure cards, and 5 promise types", () => {
    expect(prestigeCards).toHaveLength(PRESTIGE_CARD_COUNT);
    expect(PRESTIGE_CARD_COUNT).toBe(20);
    expect(blackmailCards).toHaveLength(BLACKMAIL_CARD_COUNT);
    expect(BLACKMAIL_CARD_COUNT).toBe(10);
    expect(companyFailureCards).toHaveLength(COMPANY_FAILURE_CARD_COUNT);
    expect(COMPANY_FAILURE_CARD_COUNT).toBe(6);
    expect(promiseCardTypes).toHaveLength(PROMISE_CARD_TYPE_COUNT);
    expect(PROMISE_CARD_TYPE_COUNT).toBe(5);
    expect(promiseCardFamilies).toHaveLength(6);
  });

  test("prestige cards are 10 spouses and 10 enterprises", () => {
    expect(prestigeCards.filter((card) => card.prestigeType === "spouse")).toHaveLength(10);
    expect(prestigeCards.filter((card) => card.prestigeType === "enterprise")).toHaveLength(10);
  });
});

describe("card records are well formed", () => {
  test("ids and printed card numbers are unique", () => {
    const ids = [...allCards.map((card) => card.id), ...promiseCardTypes.map((card) => card.id)];
    expect(new Set(ids).size).toBe(ids.length);

    const numbers = allCards.map((card) => card.cardNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("printed numbers run 1-10 blackmail, 11-30 prestige, 77-82 failure", () => {
    expect(blackmailCards.map((card) => card.cardNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(prestigeCards.map((card) => card.cardNumber)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 11),
    );
    expect(companyFailureCards.map((card) => card.cardNumber)).toEqual([77, 78, 79, 80, 81, 82]);
  });

  test("every card has a name, verbatim text, a source, and either effects or a handler", () => {
    for (const card of allCards) {
      expect(card.name, card.id).not.toBe("");
      expect(card.text, card.id).not.toBe("");
      expect(card.source, card.id).toMatch(/^printnplay\/Cards\/.+\.pdf p\.\d+/);
      expect(card.uncertain, card.id).toEqual([]);
    }
    for (const card of [...blackmailCards, ...companyFailureCards]) {
      expect(card.effects.length > 0 || Boolean(card.effectHandler), card.id).toBe(true);
    }
    for (const promise of promiseCardTypes) {
      expect(promise.timingAndClarifications.length, promise.id).toBeGreaterThan(0);
      expect(promise.effects.length > 0 || Boolean(promise.effectHandler), promise.id).toBe(true);
    }
  });

  test("spouses are untransferable with no enterprise type; enterprise prestige cards are the reverse", () => {
    for (const card of prestigeCards) {
      if (card.prestigeType === "spouse") {
        expect(card.transferable, card.id).toBe(false);
        expect(card.enterpriseType, card.id).toBeUndefined();
      } else {
        expect(card.transferable, card.id).toBe(true);
        expect(card.enterpriseType, card.id).toBeDefined();
        expect(card.retirementDiscount, card.id).toBe(0);
      }
    }
  });
});

describe("spot checks against the printed cards", () => {
  test("Lord Highgate and Lady Glencora match rulebook p.12", () => {
    expect(byId("lord-highgate")).toMatchObject({
      victoryPoints: 3,
      retirementDiscount: 2,
      effects: [{ type: "restrictRetirementPrizes", allowedPrizeVictoryPoints: [8, 12] }],
    });
    expect(byId("lady-glencora")).toMatchObject({
      victoryPoints: 2,
      retirementDiscount: 2,
      effects: [{ type: "removeOpportunityMarker" }],
    });
  });

  test("Becky Sharp is the one spouse worth power (rulebook p.9)", () => {
    const powerSpouses = prestigeCards.filter(
      (card) => card.prestigeType === "spouse" && card.power > 0,
    );
    expect(powerSpouses.map((card) => [card.id, card.power, card.victoryPoints])).toEqual([
      ["becky-sharp", 2, 0],
    ]);
  });

  test("spouse victory points and retirement discounts", () => {
    const spouses = prestigeCards.filter((card) => card.prestigeType === "spouse");
    expect(
      Object.fromEntries(
        spouses.map((card) => [card.id, [card.victoryPoints, card.retirementDiscount]]),
      ),
    ).toEqual({
      "mr-rochester": [2, 2],
      "esther-summerson": [2, 1],
      "john-thorpe": [2, 2],
      "violet-effingham": [3, 1],
      "joseph-sedley": [2, 1],
      "becky-sharp": [0, 0],
      "william-collins": [2, 1],
      "lady-glencora": [2, 2],
      "lord-highgate": [3, 2],
      "lady-newcome": [3, 2],
    });
  });

  test("enterprise prestige card types, votes, power, and windows", () => {
    const enterprises = prestigeCards.filter((card) => card.prestigeType === "enterprise");
    expect(
      enterprises.map((card) => [
        card.id,
        card.enterpriseType,
        card.votes,
        card.power,
        card.windowTaxIcons,
      ]),
    ).toEqual([
      ["shipbuilders", "shipping", 0, 0, 0],
      ["tax-collectors", "manufacturing", 0, 0, 0],
      ["labour-newspaper", "manufacturing", 0, 0, 0],
      ["foundry", "manufacturing", 0, 0, 0],
      ["stock-broker", "social", 0, 0, 0],
      ["social-magazine", "social", 0, 0, 0],
      ["scottish-castle", "social", 0, 3, 2],
      ["rotten-borough-1", "social", 3, 0, 0],
      ["rotten-borough-2", "social", 3, 0, 0],
      ["rotten-borough-3", "social", 3, 0, 0],
    ]);
    expect(byId("labour-newspaper")?.effects).toEqual([
      { type: "conditionalVotes", votes: 4, policyTargets: ["manufacturing", "shipping"] },
    ]);
    expect(byId("social-magazine")?.effects).toEqual([
      { type: "conditionalVotes", votes: 4, policyTargets: ["social", "companyShare"] },
    ]);
  });

  test("blackmail power icons (two cards have none)", () => {
    expect(Object.fromEntries(blackmailCards.map((card) => [card.id, card.power]))).toEqual({
      "the-prime-ministers-ear": 2,
      "company-fraud": 0,
      "letters-of-introduction": 1,
      "scandal-on-leadenhall-street": 2,
      "scandal-in-india": 2,
      "hiring-preference": 1,
      "envoy-to-the-mughals": 0,
      "mercantile-connection": 1,
      "diplomatic-connection": 2,
      "man-on-the-inside": 1,
    });
  });

  test("Military Rebuked! matches the rulebook p.2 illustration", () => {
    expect(byId("military-rebuked")?.text).toBe(
      "Lower each player's score by half of the sum of their officers, Commanders, and trophies (rounding down).",
    );
  });

  test("promise card fronts match the five texts on rulebook p.8 and the card sheets", () => {
    expect(promiseCardTypes.map((promise) => promise.text)).toEqual([
      "Take £2 or less from me.",
      "Take my officeholder's bonus.",
      "Vote with my enterprises as if you owned them.",
      "My consent for nepotism.",
      "Take my card from the London Season Display.",
    ]);
  });
});
