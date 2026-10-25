import { describe, expect, test } from "vitest";
import {
  blackmailPlayChoices,
  enterpriseVoteGuarantors,
  isActivatedThisPhase,
  markActivated,
  nepotismConsentGuarantors,
  powerMarkerPositions,
  prestigePickTakenBy,
  promiseCallOptions,
  recordOfficeholderBonus,
  registerConsentResolver,
  removePromiseFromGame,
  requestConsent,
  wasTransferredThisTurn,
  type GameState,
} from "../../engine";
import { appendLog } from "../../engine/phases/negotiation";
import { withCourtShares, withOffice } from "../fixtures/builders";
import {
  BLUE,
  RED,
  YELLOW,
  act,
  atPhase,
  holderOf,
  negotiationGame,
  promiseId,
  rejectedMessages,
  roundTrip,
  withBlackmail,
  withEnterprise,
  withPrestige,
  withPrizePieces,
} from "../fixtures/negotiation";

const give = (state: GameState, from: string, to: string, items: unknown[]) =>
  act(state, from, "negotiation.give", { to, items });

describe("binding immediate transfers (p.8)", () => {
  test("family cash moves between treasuries", () => {
    const state = give(negotiationGame("parliament", { [RED]: 7 }), RED, BLUE, [{ kind: "cash", amount: 3 }]);

    expect(state.players[RED].cash).toBe(4);
    expect(state.players[BLUE].cash).toBe(13);
    expect(state.log.at(-1)?.type).toBe("negotiation.transfer");
    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "cash", amount: 5 }] })).toEqual([
      "Red has only £4.",
    ]);
  });

  test("a luxury carries its 2 VP and window icon to the new owner (p.8, p.13)", () => {
    let state = withEnterprise(negotiationGame(), RED, { id: "lux-1", type: "luxury", cardId: "luxury-01" });
    state = give(state, RED, BLUE, [{ kind: "enterprise", enterpriseId: "lux-1" }]);

    expect(state.players[RED]).toMatchObject({ victoryPoints: 0, windows: 0, enterprises: [] });
    expect(state.players[BLUE]).toMatchObject({ victoryPoints: 2, windows: 1 });
    expect(state.players[BLUE].enterprises.map((enterprise) => enterprise.id)).toEqual(["lux-1"]);
    expect(wasTransferredThisTurn(state, "lux-1")).toBe(true);
  });

  test("a spouse can forbid receiving an enterprise (John Thorpe, p.12)", () => {
    let state = withEnterprise(negotiationGame(), RED, { id: "ws-1", type: "workshop", cardId: "workshop-01" });
    state = withPrestige(state, BLUE, "john-thorpe");

    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "enterprise", enterpriseId: "ws-1" }] })[0]).toMatch(
      /cannot hold workshops because of John Thorpe/,
    );
  });

  test("enterprise prestige cards transfer with their windows; spouses do not (p.12)", () => {
    let state = withPrestige(negotiationGame(), RED, "scottish-castle", "castle");
    state = withPrestige(state, RED, "lord-highgate", "highgate");
    state = give(state, RED, YELLOW, [{ kind: "prestige", cardInstanceId: "castle" }]);

    expect(state.players[YELLOW].prestigeCards.map((card) => card.id)).toEqual(["castle"]);
    expect(state.players[YELLOW].windows).toBe(2);
    expect(rejectedMessages(state, RED, "negotiation.give", { to: YELLOW, items: [{ kind: "prestige", cardInstanceId: "highgate" }] })).toEqual([
      "Spouses cannot be transferred (p.8, p.12).",
    ]);
  });

  test("face-down blackmail moves without revealing it; played blackmail stays put (p.8)", () => {
    let state = withBlackmail(negotiationGame(), RED, "company-fraud", { instanceId: "bm-fraud" });
    state = withBlackmail(state, RED, "hiring-preference", { instanceId: "bm-played", facedown: false });
    state = give(state, RED, BLUE, [{ kind: "blackmail", cardInstanceId: "bm-fraud" }]);

    expect(state.players[BLUE].blackmailCards).toEqual([{ id: "bm-fraud", cardId: "company-fraud", facedown: true }]);
    expect(state.hidden.privateCards[BLUE].map((card) => card.id)).toEqual(["bm-fraud"]);
    expect(state.hidden.privateCards[RED]).toEqual([]);
    expect(state.log.at(-1)?.summary).toBe("Red gave a face-down blackmail card to Blue.");
    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "blackmail", cardInstanceId: "bm-played" }] })).toEqual([
      "Played blackmail cards cannot be transferred (p.8, p.12).",
    ]);
  });

  test("Esther Summerson's family cannot receive blackmail (p.12)", () => {
    let state = withBlackmail(negotiationGame(), RED, "company-fraud", { instanceId: "bm-fraud" });
    state = withPrestige(state, BLUE, "esther-summerson");

    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "blackmail", cardInstanceId: "bm-fraud" }] })[0]).toMatch(
      /Esther Summerson/,
    );
  });

  test("a Company share is replaced by the receiver's own family member (p.8)", () => {
    let state = withCourtShares(negotiationGame(), [{ id: "share-1", owner: RED }]);
    const redSupply = state.players[RED].familyMembers.supply;
    const blueSupply = state.players[BLUE].familyMembers.supply;
    state = give(state, RED, BLUE, [{ kind: "share", shareId: "share-1" }]);

    expect(state.company.court).toEqual([{ id: "share-1", owner: BLUE }]);
    expect(state.players[RED].familyMembers.supply).toBe(redSupply + 1);
    expect(state.players[BLUE].familyMembers.supply).toBe(blueSupply - 1);
  });

  test("the Chairman cannot be transferred (p.8)", () => {
    const state = withOffice(negotiationGame(), "chairman", RED);

    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "chairmanShare" }] })).toEqual([
      "The Chairman cannot be transferred (p.8).",
    ]);
    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "share", shareId: "chairman" }] })).toEqual([
      "The Chairman cannot be transferred (p.8).",
    ]);
  });

  test("with no family member in supply, the receiver takes one from a prize and loses its VP (p.13)", () => {
    let state = withCourtShares(negotiationGame(), [{ id: "share-1", owner: RED }]);
    state = withPrizePieces(state, BLUE, "prize-8", 1, 4);
    state = withPrizePieces(state, BLUE, "prize-2", state.players[BLUE].familyMembers.supply, 0);

    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "share", shareId: "share-1" }] })[0]).toMatch(
      /no family member in supply/,
    );

    state = give(state, RED, BLUE, [{ kind: "share", shareId: "share-1", fromPrizeId: "prize-8" }]);

    expect(state.company.court).toEqual([{ id: "share-1", owner: BLUE }]);
    expect(state.players[BLUE].familyMembers.prizes["prize-8"]).toBe(0);
    expect(state.players[BLUE].victoryPoints).toBe(0);
  });

  test("promise cards can be given, passed on, and returned to their guarantor (p.8)", () => {
    const card = promiseId(RED, "take-up-to-2-from-me");
    let state = give(negotiationGame(), RED, BLUE, [{ kind: "promise", promiseId: card }]);
    expect(holderOf(state, card)).toBe(BLUE);

    state = give(state, BLUE, YELLOW, [{ kind: "promise", promiseId: card }]);
    expect(holderOf(state, card)).toBe(YELLOW);

    state = give(state, YELLOW, RED, [{ kind: "promise", promiseId: card }]);
    expect(holderOf(state, card)).toBe(RED);
    expect(rejectedMessages(state, BLUE, "negotiation.give", { to: YELLOW, items: [{ kind: "promise", promiseId: card }] })).toEqual([
      `Blue does not hold promise card "${card}".`,
    ]);
  });

  test.each([
    ["office", "Officeholders cannot be transferred (p.8)."],
    ["writer", "Writers cannot be transferred (p.8)."],
    ["officer", "Officers cannot be transferred (p.8)."],
    ["prize", "Pieces on prizes cannot be transferred (p.8)."],
    ["spouse", "Spouses cannot be transferred (p.8, p.12)."],
    ["passedLaw", "Passed laws cannot be transferred (p.8)."],
    ["playedBlackmail", "Played blackmail cards cannot be transferred (p.8, p.12)."],
    ["primeMinister", "The Prime Minister dial cannot be transferred (p.8)."],
    ["trophy", "Trophies cannot be transferred (p.8)."],
  ])("rejects transferring %s", (kind, message) => {
    expect(rejectedMessages(negotiationGame(), RED, "negotiation.give", { to: BLUE, items: [{ kind }] })).toEqual([message]);
  });

  test("a transfer never touches the pending decision's actor", () => {
    const state = negotiationGame();
    const after = give(state, RED, BLUE, [{ kind: "cash", amount: 1 }]);
    expect(after.pendingDecision).toEqual(state.pendingDecision);
  });

  test("a transfer during a Family decision rebuilds the affordable actions", () => {
    let state = atPhase(negotiationGame("parliament", { [RED]: 5 }), "family");
    const labels = (game: GameState) => game.pendingDecision.legalCommands.map((command) => command.label);
    expect(labels(state)).toContain("Purchase Workshop (£5)");

    state = give(state, RED, BLUE, [{ kind: "cash", amount: 2 }]);
    expect(labels(state)).not.toContain("Purchase Workshop (£5)");
    expect(labels(state)).toContain("Purchase Shipyard (£2)");
  });

  test("nothing changes hands after the game is over (p.8)", () => {
    const state = negotiationGame("finalScoring");
    expect(rejectedMessages(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "cash", amount: 1 }] })[0]).toMatch(/game is over/);
  });
});

describe("deals that need the other player's consent", () => {
  test("a proposed trade waits for the other player, then applies atomically", () => {
    let state = withEnterprise(negotiationGame("parliament", { [RED]: 4, [BLUE]: 0 }), BLUE, { id: "yard-1", type: "shipyard", cardId: "shipyard-01" });
    const before = state.pendingDecision;
    state = act(state, RED, "negotiation.proposeTrade", {
      to: BLUE,
      give: [{ kind: "cash", amount: 3 }, { kind: "promise", promiseId: promiseId(RED, "my-consent-for-nepotism") }],
      receive: [{ kind: "enterprise", enterpriseId: "yard-1" }],
    });

    expect(state.pendingDecision).toMatchObject({ actor: BLUE, step: "negotiation.consent" });
    expect(state.players[RED].cash).toBe(4);

    state = roundTrip(state);
    state = act(state, BLUE, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: true });

    expect(state.players[RED].cash).toBe(1);
    expect(state.players[BLUE].cash).toBe(3);
    expect(state.players[RED].enterprises.map((enterprise) => enterprise.id)).toEqual(["yard-1"]);
    expect(holderOf(state, promiseId(RED, "my-consent-for-nepotism"))).toBe(BLUE);
    expect(state.pendingDecision).toEqual(before);
    expect(state.log.at(-1)?.type).toBe("negotiation.tradeCompleted");
  });

  test("a refused trade changes nothing", () => {
    let state = negotiationGame();
    state = act(state, RED, "negotiation.proposeTrade", { to: BLUE, give: [{ kind: "cash", amount: 2 }], receive: [] });
    state = act(state, BLUE, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: false });

    expect(state.players[RED].cash).toBe(10);
    expect(state.negotiation.interrupts).toEqual([]);
    expect(state.log.at(-1)?.type).toBe("negotiation.tradeRefused");
  });

  test("a deal that is no longer possible when accepted fails without moving anything", () => {
    let state = negotiationGame("parliament", { [RED]: 2 });
    state = act(state, RED, "negotiation.proposeTrade", { to: BLUE, give: [{ kind: "cash", amount: 2 }], receive: [] });
    state = give(state, RED, YELLOW, [{ kind: "cash", amount: 2 }]);
    state = act(state, BLUE, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: true });

    expect(state.players[BLUE].cash).toBe(10);
    expect(state.players[YELLOW].cash).toBe(12);
    expect(state.log.at(-1)).toMatchObject({ type: "negotiation.tradeFailed", summary: "The deal could not be completed: Red has only £0." });
  });

  test("requestConsent asks each player in turn and stops at the first refusal", () => {
    const seen: Array<{ accepted: boolean; answers: Record<string, boolean> }> = [];
    registerConsentResolver("test.consent", (state, request, accepted) => {
      seen.push({ accepted, answers: request.answers });
      return appendLog(state, { type: "test.resolved", summary: `resolved ${accepted}`, timestamp: state.updatedAt });
    });

    let state = requestConsent(negotiationGame(), {
      kind: "test.consent",
      requestedBy: RED,
      from: [RED, BLUE, YELLOW],
      prompt: "Allow the test?",
      context: { reason: "test" },
    });
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = act(state, BLUE, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: true });
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = roundTrip(state);
    state = act(state, YELLOW, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: true });
    expect(seen.at(-1)).toEqual({ accepted: true, answers: { [BLUE]: true, [YELLOW]: true } });
    expect(state.pendingDecision.step).toBe("parliament.confirm");

    state = requestConsent(state, { kind: "test.consent", requestedBy: RED, from: [BLUE, YELLOW], prompt: "Again?", context: {} });
    state = act(state, BLUE, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: false });
    expect(seen.at(-1)).toEqual({ accepted: false, answers: { [BLUE]: false } });
    expect(state.negotiation.interrupts).toEqual([]);
  });
});

describe("golden rule: nothing activates twice (p.8)", () => {
  test("activations are tracked per asset for the current phase", () => {
    const state = markActivated(negotiationGame("bonuses"), ["ws-1"]);
    expect(isActivatedThisPhase(state, "ws-1")).toBe(true);
    expect(isActivatedThisPhase(atPhase(state, "revenue"), "ws-1")).toBe(false);
  });
});

describe("promise cards (p.8 and card backs)", () => {
  test("each family starts with its five promise cards", () => {
    const state = negotiationGame();
    expect(state.negotiation.promiseCards).toHaveLength(15);
    expect(state.negotiation.promiseCards.filter((card) => card.guarantor === RED).map((card) => card.type)).toEqual([
      "take-up-to-2-from-me",
      "take-my-officeholders-bonus",
      "vote-with-my-enterprises",
      "my-consent-for-nepotism",
      "take-my-card-from-london-season-display",
    ]);
  });

  test("Take £2 or less from me: paid at once, then the card goes home", () => {
    const card = promiseId(RED, "take-up-to-2-from-me");
    let state = give(negotiationGame("family", { [RED]: 1 }), RED, BLUE, [{ kind: "promise", promiseId: card }]);
    state = act(state, BLUE, "negotiation.callInPromises", { calls: [{ promiseId: card, option: { amount: 2 } }] });

    expect(state.players[RED].cash).toBe(0);
    expect(state.players[BLUE].cash).toBe(11);
    expect(holderOf(state, card)).toBe(RED);
    expect(state.log.at(-1)?.summary).toBe('Red paid Blue £1 for "Take £2 or less from me.".');
  });

  test("a guarantor with no cash cannot be called on for cash", () => {
    const card = promiseId(RED, "take-up-to-2-from-me");
    const state = give(negotiationGame("parliament", { [RED]: 1 }), RED, BLUE, [
      { kind: "promise", promiseId: card },
      { kind: "cash", amount: 1 },
    ]);
    expect(promiseCallOptions(state, BLUE)).toEqual([]);
  });

  test("Take my officeholder's bonus claims a bonus Company Operation recorded", () => {
    const card = promiseId(RED, "take-my-officeholders-bonus");
    let state = withOffice(negotiationGame("companyOperation"), "president-madras", RED);
    state = give(state, RED, BLUE, [{ kind: "promise", promiseId: card }]);
    state = recordOfficeholderBonus(state, { officeId: "president-madras", playerId: RED, amount: 4 });
    expect(promiseCallOptions(state, BLUE)).toEqual([]);

    state = {
      ...state,
      company: {
        ...state.company,
        offices: { ...state.company.offices, "president-madras": { ...state.company.offices["president-madras"], actedThisTurn: true } },
      },
    };
    expect(promiseCallOptions(state, BLUE).map((option) => option.option)).toEqual([{ officeId: "president-madras" }]);

    state = act(state, BLUE, "negotiation.callInPromises", { calls: [{ promiseId: card, option: { officeId: "president-madras" } }] });
    expect(state.players[RED].cash).toBe(6);
    expect(state.players[BLUE].cash).toBe(14);
    expect(promiseCallOptions(state, BLUE)).toEqual([]);
  });

  test("Vote with my enterprises grants votes for this Parliament only", () => {
    const card = promiseId(RED, "vote-with-my-enterprises");
    let state = give(negotiationGame("upkeep"), RED, YELLOW, [{ kind: "promise", promiseId: card }]);
    expect(promiseCallOptions(state, YELLOW)).toEqual([]);

    state = atPhase(state, "parliament");
    state = act(state, YELLOW, "negotiation.callInPromises", { calls: [{ promiseId: card, option: {} }] });
    expect(enterpriseVoteGuarantors(state, YELLOW)).toEqual([RED]);
    expect(holderOf(state, card)).toBe(RED);
    expect(enterpriseVoteGuarantors(atPhase(state, "upkeep"), YELLOW)).toEqual([]);
  });

  test("My consent for nepotism is recorded for the hirer during Hiring", () => {
    const card = promiseId(BLUE, "my-consent-for-nepotism");
    let state = give(negotiationGame("hiring"), BLUE, RED, [{ kind: "promise", promiseId: card }]);
    state = act(state, RED, "negotiation.callInPromises", { calls: [{ promiseId: card, option: {} }] });
    expect(nepotismConsentGuarantors(state, RED)).toEqual([BLUE]);
  });

  test("Take my card from the London Season Display names who picks for the guarantor", () => {
    const card = promiseId(YELLOW, "take-my-card-from-london-season-display");
    let state = give(negotiationGame("londonSeason"), YELLOW, BLUE, [{ kind: "promise", promiseId: card }]);
    state = act(state, BLUE, "negotiation.callInPromises", { calls: [{ promiseId: card, option: {} }] });
    expect(prestigePickTakenBy(state, YELLOW)).toBe(BLUE);
  });

  test("when calls at once exceed the guarantor's cash, the guarantor chooses (p.8)", () => {
    const cash = promiseId(RED, "take-up-to-2-from-me");
    const bonus = promiseId(RED, "take-my-officeholders-bonus");
    let state = withOffice(negotiationGame("companyOperation", { [RED]: 3 }), "president-madras", RED);
    state = give(state, RED, BLUE, [
      { kind: "promise", promiseId: cash },
      { kind: "promise", promiseId: bonus },
    ]);
    state = recordOfficeholderBonus(state, { officeId: "president-madras", playerId: RED, amount: 3 });
    state = {
      ...state,
      company: {
        ...state.company,
        offices: { ...state.company.offices, "president-madras": { ...state.company.offices["president-madras"], actedThisTurn: true } },
      },
    };

    state = act(state, BLUE, "negotiation.callInPromises", {
      calls: [
        { promiseId: cash, option: { amount: 2 } },
        { promiseId: bonus, option: { officeId: "president-madras" } },
      ],
    });
    expect(state.pendingDecision).toMatchObject({ actor: RED, step: "negotiation.choosePromise" });
    expect(state.pendingDecision.legalCommands.map((command) => command.label)).toEqual([
      "Pay Blue up to £2",
      "Pay Blue up to £3",
      "Fulfil no more",
    ]);
    expect(rejectedMessages(state, BLUE, "negotiation.give", { to: YELLOW, items: [{ kind: "promise", promiseId: cash }] })).toEqual([
      "That promise card has been called in and is waiting for its guarantor.",
    ]);

    state = roundTrip(state);
    state = act(state, RED, "negotiation.fulfilPromise", { callId: state.pendingDecision.legalCommands[1].payload && (state.pendingDecision.legalCommands[1].payload as { callId: string }).callId });

    expect(state.players[RED].cash).toBe(0);
    expect(state.players[BLUE].cash).toBe(13);
    expect(holderOf(state, bonus)).toBe(RED);
    expect(holderOf(state, cash)).toBe(BLUE);
    expect(state.negotiation.interrupts).toEqual([]);
    expect(state.pendingDecision.step).toBe("companyOperation.passOffice");
    expect(state.log.at(-1)?.type).toBe("negotiation.promisesUnfulfilled");
  });

  test("promises cannot be called in once the game is over (p.8)", () => {
    const card = promiseId(RED, "take-up-to-2-from-me");
    let state = give(negotiationGame("upkeep"), RED, BLUE, [{ kind: "promise", promiseId: card }]);
    state = atPhase(state, "finalScoring");
    expect(promiseCallOptions(state, BLUE)).toEqual([]);
    expect(rejectedMessages(state, BLUE, "negotiation.callInPromises", { calls: [{ promiseId: card, option: { amount: 1 } }] })[0]).toMatch(
      /game is over/,
    );
  });

  test("Lady Newcome removes her family's Vote-with-my-enterprises card, wherever it is (p.12)", () => {
    const card = promiseId(RED, "vote-with-my-enterprises");
    let state = give(negotiationGame(), RED, BLUE, [{ kind: "promise", promiseId: card }]);
    state = removePromiseFromGame(state, RED, "vote-with-my-enterprises");
    expect(state.negotiation.promiseCards.find((candidate) => candidate.id === card)).toMatchObject({ removedFromGame: true });
    expect(promiseCallOptions(state, BLUE)).toEqual([]);
  });
});

describe("blackmail plays (p.12)", () => {
  test("The Prime Minister's Ear swaps two adjacent power markers before the Family phase", () => {
    let state = withBlackmail(negotiationGame("londonSeason"), RED, "the-prime-ministers-ear", { instanceId: "ear" });
    const [choice] = blackmailPlayChoices(state, RED);
    expect(choice.options.map((option) => option.label)).toEqual([
      "Swap social and companyShare",
      "Swap companyShare and shipping",
      "Swap companyShare and manufacturing",
    ]);

    state = act(state, RED, "negotiation.playBlackmail", { cardInstanceId: "ear", params: { markers: ["companyShare", "shipping"] } });

    expect(powerMarkerPositions(state)).toMatchObject({ shipping: "middle", companyShare: "bottomLeft" });
    expect(state.players[RED].blackmailCards).toEqual([{ id: "ear", cardId: "the-prime-ministers-ear", facedown: false }]);
    expect(state.hidden.privateCards[RED]).toEqual([]);
    expect(blackmailPlayChoices(atPhase(state, "family"), RED)).toEqual([]);
  });

  test("blackmail can only be played at its timing", () => {
    const state = withBlackmail(negotiationGame("family"), RED, "the-prime-ministers-ear", { instanceId: "ear" });
    expect(blackmailPlayChoices(state, RED)[0].unavailableReason).toBe("Play this on a turn before the Family phase.");
    expect(rejectedMessages(state, RED, "negotiation.playBlackmail", { cardInstanceId: "ear", params: { markers: ["social", "companyShare"] } })).toEqual([
      "Play this on a turn before the Family phase.",
    ]);
  });

  test("cards played inside another step are not offered as anytime plays", () => {
    const state = withBlackmail(negotiationGame("companyOperation"), RED, "mercantile-connection", { instanceId: "merc" });
    expect(blackmailPlayChoices(state, RED)[0].unavailableReason).toBe(
      "Mercantile Connection is played during another step of the game.",
    );
  });

  test("Scandal on Leadenhall Street vacates a Company office without retirement after Revenue", () => {
    let state = withOffice(negotiationGame("parliament"), "director-of-trade", BLUE, { fatigue: 2 });
    state = withOffice(state, "president-bombay", YELLOW);
    state = withBlackmail(state, RED, "scandal-on-leadenhall-street", { instanceId: "scandal" });
    const blueSupply = state.players[BLUE].familyMembers.supply;

    expect(blackmailPlayChoices(state, RED)[0].options.map((option) => option.params)).toEqual([{ officeId: "director-of-trade" }]);
    state = act(state, RED, "negotiation.playBlackmail", { cardInstanceId: "scandal", params: { officeId: "director-of-trade" } });

    expect(state.company.offices["director-of-trade"]).toMatchObject({ vacant: true, holder: undefined, fatigue: 0 });
    expect(state.company.vacantOffices).toContain("director-of-trade");
    expect(state.players[BLUE].familyMembers).toMatchObject({ supply: blueSupply + 1, pensioners: 0 });
  });

  test("Scandal in India targets Presidents and Governors only", () => {
    let state = withOffice(negotiationGame("eventsInIndia"), "director-of-trade", BLUE);
    state = withOffice(state, "president-bombay", YELLOW);
    state = withBlackmail(state, RED, "scandal-in-india", { instanceId: "scandal" });
    expect(blackmailPlayChoices(state, RED)[0].options.map((option) => option.params)).toEqual([{ officeId: "president-bombay" }]);
  });

  test("Man on the Inside cancels a blackmail and takes it face up", () => {
    let state = withOffice(negotiationGame("upkeep"), "director-of-trade", BLUE);
    state = withBlackmail(state, RED, "scandal-on-leadenhall-street", { instanceId: "scandal" });
    state = withBlackmail(state, YELLOW, "man-on-the-inside", { instanceId: "man" });
    const before = state.pendingDecision;

    state = act(state, RED, "negotiation.playBlackmail", { cardInstanceId: "scandal", params: { officeId: "director-of-trade" } });
    expect(state.pendingDecision).toMatchObject({ actor: YELLOW, step: "negotiation.blackmailReaction", visibility: "private" });
    expect(blackmailPlayChoices(state, YELLOW)[0].unavailableReason).toBe("Another player's response is pending.");

    state = roundTrip(state);
    state = act(state, YELLOW, "negotiation.respondToBlackmail", { playId: state.negotiation.interrupts[0].id, cancel: true });

    expect(state.company.offices["director-of-trade"].holder).toBe(BLUE);
    expect(state.players[RED].blackmailCards).toEqual([]);
    expect(state.players[YELLOW].blackmailCards).toEqual([
      { id: "man", cardId: "man-on-the-inside", facedown: false },
      { id: "scandal", cardId: "scandal-on-leadenhall-street", facedown: false },
    ]);
    expect(state.pendingDecision).toEqual(before);
  });

  test("letting the play resolve applies its effect", () => {
    let state = withOffice(negotiationGame("upkeep"), "director-of-trade", BLUE);
    state = withBlackmail(state, RED, "scandal-on-leadenhall-street", { instanceId: "scandal" });
    state = withBlackmail(state, YELLOW, "man-on-the-inside", { instanceId: "man" });
    state = act(state, RED, "negotiation.playBlackmail", { cardInstanceId: "scandal", params: { officeId: "director-of-trade" } });
    state = act(state, YELLOW, "negotiation.respondToBlackmail", { playId: state.negotiation.interrupts[0].id, cancel: false });

    expect(state.company.offices["director-of-trade"].vacant).toBe(true);
    expect(state.players[YELLOW].blackmailCards).toEqual([{ id: "man", cardId: "man-on-the-inside", facedown: true }]);
  });

  test("Envoy to the Mughals moves the Elephant and pays the highest open order in its tail region", () => {
    let state = withBlackmail(negotiationGame("hiring", { [RED]: 0 }), RED, "envoy-to-the-mughals", { instanceId: "envoy" });
    const option = blackmailPlayChoices(state, RED)[0].options.find(
      (candidate) => candidate.params.regionId === "bengal" && candidate.params.facing === "maratha",
    );
    expect(option).toBeDefined();

    state = act(state, RED, "negotiation.playBlackmail", { cardInstanceId: "envoy", params: option!.params });
    expect(state.india.elephant).toEqual({ regionId: "bengal", facing: "maratha" });
    expect(state.players[RED].cash).toBe(6);
  });
});
