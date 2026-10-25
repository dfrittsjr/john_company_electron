import { describe, expect, it } from "vitest";
import {
  chairmanHolder,
  playerCourtShares,
  playerOffices,
  playerWriters,
  presidentOf,
  type GameState,
} from "../../engine";
import { startFamilyPhase } from "../../engine/phases/family";
import { beginImmediateHire, installGovernorGeneral, startHiringPhase } from "../../engine/phases/hiring";
import { registerHiringResume } from "../../engine/phases/hiring-resume";
import {
  withCash,
  withCourtShares,
  withHiringQueue,
  withOffice,
  withOfficersInTraining,
  withWriters,
} from "../fixtures/builders";
import {
  choose,
  labels,
  withBlackmailCard,
  withChairmanMarker,
  withDebt,
  withOpportunityMarker,
  withPassedLaws,
  withPiecesOnPrize,
  withPrestigeCard,
  withStockExchangePiece,
  withSupply,
} from "../fixtures/family-hiring";
import {
  applyCommandOrThrow,
  createHotseatGame,
  expectGameInvariants,
  expectSaveRoundTripPreservesPendingDecision,
} from "../fixtures/game";
import { createRngState, rollDie } from "../../engine/rng";

const RED = "player-red";
const BLUE = "player-blue";
const YELLOW = "player-yellow";

function baseGame(seed: string): GameState {
  return createHotseatGame({ seed, gameId: `game-${seed}` });
}

function family(state: GameState): GameState {
  const started = startFamilyPhase(state);
  expectGameInvariants(started);
  return started;
}

function hiring(state: GameState): GameState {
  const started = startHiringPhase(state);
  expectGameInvariants(started);
  return started;
}

describe("Family phase (pp.13-14)", () => {
  it("starts with the Chairman and proceeds clockwise (p.13)", () => {
    const state = family(withOffice(baseGame("family-order"), "chairman", YELLOW, { inHiringQueue: false }));

    expect(state.family.order).toEqual([YELLOW, RED, BLUE]);
    expect(state.pendingDecision.actor).toBe(YELLOW);
  });

  it("starts with the former Chairman while the office is vacant", () => {
    const state = family(withChairmanMarker(baseGame("family-order-vacant"), BLUE));

    expect(state.family.order).toEqual([BLUE, YELLOW, RED]);
  });

  it("lets Seek Share use any empty Stock Exchange space at that space's price (p.14)", () => {
    let state = family(withCash(baseGame("seek-any"), { [RED]: 10 }));

    state = choose(state, "Seek Share (£4, stock-exchange-4)");

    expect(state.players[RED].cash).toBe(6);
    expect(state.company.stockExchange.find((slot) => slot.id === "stock-exchange-4")?.share?.owner).toBe(RED);
  });

  it("offers one extra writer when four or more offices are vacant (p.13)", () => {
    let state = baseGame("extra-writer");
    for (const officeId of ["director-of-trade", "manager-of-shipping", "military-affairs", "president-bombay"]) {
      state = withOffice(state, officeId, undefined);
    }
    state = family(state);

    state = choose(state, "Enlist Writer (Bombay)");
    expect(state.pendingDecision.step).toBe("family.chooseExtraWriter");
    expect(state.pendingDecision.actor).toBe(RED);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "Extra writer (Madras)");
    expect(playerWriters(state, RED)).toEqual({ Bombay: 1, Madras: 1, Bengal: 0 });
    expect(state.family.extraWriterUsedBy).toEqual([RED]);
    expect(state.pendingDecision.actor).toBe(BLUE);
  });

  it("gives three writers with the opportunity marker on Enlist Writer and 4+ vacancies (p.13)", () => {
    let state = baseGame("three-writers");
    for (const officeId of ["director-of-trade", "manager-of-shipping", "military-affairs", "president-bombay"]) {
      state = withOffice(state, officeId, undefined);
    }
    state = family(withOpportunityMarker(state, RED, "enlist-writer"));

    state = choose(state, "Enlist Writer (Bombay)");
    state = choose(state, "No extra writer");
    expect(state.pendingDecision.step).toBe("family.chooseRepeatAction");
    state = choose(state, "Enlist Writer (Bengal)");
    // The extra writer is still available once this turn after the repeat.
    expect(state.pendingDecision.step).toBe("family.chooseExtraWriter");
    state = choose(state, "Extra writer (Bengal)");

    expect(playerWriters(state, RED)).toEqual({ Bombay: 1, Madras: 0, Bengal: 2 });
    expect(state.players[RED].opportunityMarker).toBe("enlist-writer");
    expect(state.pendingDecision.actor).toBe(BLUE);
  });

  it("does not offer the extra writer with fewer than four vacant offices", () => {
    let state = family(withOffice(baseGame("no-extra-writer"), "director-of-trade", undefined));
    state = choose(state, "Enlist Writer (Bombay)");

    expect(state.pendingDecision.actor).toBe(BLUE);
  });

  it("offers the most recently passed law's extra action after the family action (p.13)", () => {
    let state = withPassedLaws(withCash(baseGame("law-extra"), { [RED]: 10 }), ["calico-acts", "army-spending"]);
    state = family(state);

    state = choose(state, "Purchase Luxury");
    expect(state.pendingDecision.step).toBe("family.chooseExtraAction");
    // Army Spending passed after Calico Acts, so only its extra officer is available.
    expect(labels(state)).toEqual(["Enlist Officer", "Skip the extra action"]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "Enlist Officer");
    expect(state.players[RED].familyMembers.officersInTraining).toBe(1);
    // Extra actions do not move the opportunity marker (p.13).
    expect(state.players[RED].opportunityMarker).toBe("purchase-luxury");
    expect(state.pendingDecision.actor).toBe(BLUE);
  });

  it("does not grant the Tenure Limits writer after Enlist Writer (law #37)", () => {
    let state = family(withPassedLaws(baseGame("tenure-limits"), ["tenure-limits"]));
    state = choose(state, "Enlist Writer (Bombay)");
    expect(state.pendingDecision.actor).toBe(BLUE);

    state = choose(state, "Enlist Officer");
    expect(state.pendingDecision.step).toBe("family.chooseExtraAction");
    expect(labels(state)).toEqual([
      "Enlist Writer (Bombay)",
      "Enlist Writer (Madras)",
      "Enlist Writer (Bengal)",
      "Skip the extra action",
    ]);
  });

  it("takes a family member from a prize when the supply is empty, losing that prize's VP (p.13)", () => {
    let state = withSupply(withPiecesOnPrize(baseGame("from-prize"), RED, "prize-8", 1), RED, 0);
    state = { ...state, players: { ...state.players, [RED]: { ...state.players[RED], victoryPoints: 4 } } };
    state = family(state);

    expect(labels(state)).toContain("Enlist Officer (from £8 prize, -4 VP)");
    state = choose(state, "Enlist Officer (from £8 prize");

    expect(state.players[RED].familyMembers.prizes["prize-8"]).toBe(0);
    expect(state.players[RED].victoryPoints).toBe(0);
    expect(state.players[RED].familyMembers.officersInTraining).toBe(1);
  });

  it("offers No Action only to a family with no pieces, prizes, or money (p.13)", () => {
    const state = family(withSupply(baseGame("no-action"), RED, 0));

    expect(labels(state)).toEqual(["No Action"]);
  });

  describe("spouse restrictions (prestige cards #11-#20)", () => {
    it("forbids Enlist Writer with Mr. Rochester but still allows the Tenure Limits writer", () => {
      let state = withPrestigeCard(baseGame("rochester"), RED, "mr-rochester");
      state = family(withPassedLaws(state, ["tenure-limits"]));

      expect(labels(state).some((label) => label.startsWith("Enlist Writer"))).toBe(false);
      state = choose(state, "Enlist Officer");
      expect(labels(state)).toContain("Enlist Writer (Madras)");
    });

    it("forbids Enlist Officer with William Collins", () => {
      const state = family(withPrestigeCard(baseGame("collins"), RED, "william-collins"));

      expect(labels(state)).not.toContain("Enlist Officer");
    });

    it("forbids workshops with John Thorpe, even through Calico Acts", () => {
      let state = withCash(withPrestigeCard(baseGame("thorpe"), RED, "john-thorpe"), { [RED]: 10 });
      state = family(withPassedLaws(state, ["calico-acts"]));

      expect(labels(state).some((label) => label.startsWith("Purchase Workshop"))).toBe(false);
      state = choose(state, "Enlist Officer");
      expect(state.pendingDecision.actor).toBe(BLUE);
    });

    it("forbids shipyards with Violet Effingham and shares with Joseph Sedley", () => {
      let state = withCash(baseGame("violet-sedley"), { [RED]: 10 });
      state = withPrestigeCard(withPrestigeCard(state, RED, "violet-effingham"), RED, "joseph-sedley");
      state = family(state);

      expect(labels(state).some((label) => label.startsWith("Purchase Shipyard"))).toBe(false);
      expect(labels(state).some((label) => label.startsWith("Seek Share"))).toBe(false);
    });

    it("removes the double action with Lady Glencora and never places her marker", () => {
      let state = withPrestigeCard(baseGame("glencora"), RED, "lady-glencora");
      state = family(withOpportunityMarker(state, RED, "enlist-officer"));

      state = choose(state, "Enlist Officer");
      expect(state.pendingDecision.actor).toBe(BLUE);
      expect(state.players[RED].opportunityMarker).toBe("removed");
    });
  });

  describe("enterprise prestige cards and laws", () => {
    it("lets the Stock Broker's owner seek any share for £1", () => {
      let state = withCash(withPrestigeCard(baseGame("broker-owner"), RED, "stock-broker"), { [RED]: 1 });
      state = family(state);

      state = choose(state, "Seek Share (£1, stock-exchange-5)");
      expect(state.players[RED].cash).toBe(0);
    });

    it("lets another family use the Stock Broker with its owner's permission", () => {
      let state = withCash(withPrestigeCard(baseGame("broker-request"), BLUE, "stock-broker"), { [RED]: 1 });
      state = family(state);

      state = choose(state, "Seek Share (£1 with Blue's Stock Broker, stock-exchange-5)");
      expect(state.pendingDecision.step).toBe("family.stockBrokerConsent");
      expect(state.pendingDecision.actor).toBe(BLUE);
      expectSaveRoundTripPreservesPendingDecision(state);

      state = choose(state, "Allow");
      expect(state.players[RED].cash).toBe(0);
      expect(state.company.stockExchange.find((slot) => slot.id === "stock-exchange-5")?.share?.owner).toBe(RED);
      expect(state.pendingDecision.actor).toBe(BLUE);
      expect(state.pendingDecision.step).toBe("family.chooseAction");
    });

    it("sends a refused Stock Broker request back to the action choice without the Broker", () => {
      let state = withCash(withPrestigeCard(baseGame("broker-refused"), BLUE, "stock-broker"), { [RED]: 2 });
      state = family(state);

      state = choose(state, "Seek Share (£1 with Blue's Stock Broker, stock-exchange-5)");
      state = choose(state, "Refuse");

      expect(state.pendingDecision.actor).toBe(RED);
      expect(state.pendingDecision.step).toBe("family.chooseAction");
      expect(labels(state).some((label) => label.includes("Stock Broker"))).toBe(false);
      expect(labels(state)).toContain("Seek Share (£2, stock-exchange-2)");
    });

    it("pays the Foundry's owner £1 whenever anyone buys a workshop", () => {
      let state = withCash(withPrestigeCard(baseGame("foundry"), YELLOW, "foundry"), { [RED]: 5 });
      state = family(state);

      state = choose(state, "Purchase Workshop");
      expect(state.players[YELLOW].cash).toBe(1);
      expect(state.players[RED].cash).toBe(0);
    });

    it("charges £3 for a workshop under Industry Subsidy unless the marker is on workshops (law #44)", () => {
      let state = withPassedLaws(withCash(baseGame("industry-subsidy"), { [RED]: 10, [BLUE]: 10 }), ["industry-subsidy"]);
      state = withOpportunityMarker(state, BLUE, "purchase-workshop");
      state = family(state);

      expect(labels(state)).toContain("Purchase Workshop (£3)");
      state = choose(state, "Purchase Workshop (£3)");
      expect(state.players[RED].cash).toBe(7);

      expect(labels(state)).toContain("Purchase Workshop (£5)");
    });

    it("does not discount a Calico Acts workshop under Industry Subsidy", () => {
      let state = withPassedLaws(withCash(baseGame("calico-subsidy"), { [RED]: 10 }), ["industry-subsidy", "calico-acts"]);
      state = family(state);

      state = choose(state, "Enlist Officer");
      expect(labels(state)).toEqual(["Purchase Workshop (£5)", "Skip the extra action"]);
    });

    it("does not sell a returned shipyard while its fitted ship is still at sea (p.34)", () => {
      let state = withCash(baseGame("returned-shipyard"), { [RED]: 2 });
      state = {
        ...state,
        company: {
          ...state.company,
          ships: [{ id: "ship-shipyard-01", kind: "player", shipyardCardId: "shipyard-01", location: "west-indian", fatigued: false }],
        },
      };
      state = family(state);

      state = choose(state, "Purchase Shipyard");
      expect(state.players[RED].enterprises.map((enterprise) => enterprise.cardId)).toEqual(["shipyard-02"]);
    });
  });

  describe("new Company shares (p.14)", () => {
    it("slides Stock Exchange pieces rightward even with no Company Debt", () => {
      let state = withStockExchangePiece(baseGame("slide"), "stock-exchange-2", RED);
      state = withStockExchangePiece(state, "stock-exchange-3-left", BLUE);
      state = withSupply(withSupply(withSupply(state, RED, 0), BLUE, 0), YELLOW, 0);
      state = family(state);
      for (let step = 0; state.phase === "family"; step += 1) state = choose(state, "No Action", `no-action-${step}`);

      expect(state.company.stockExchange.map((slot) => slot.share?.owner)).toEqual([
        undefined,
        undefined,
        undefined,
        RED,
        BLUE,
      ]);
    });

    it("moves the rightmost piece into the Court for each Debt, then slides the rest", () => {
      let state = withStockExchangePiece(baseGame("convert"), "stock-exchange-2", RED);
      state = withStockExchangePiece(state, "stock-exchange-4", BLUE);
      state = withDebt(withSupply(withSupply(withSupply(state, RED, 0), BLUE, 0), YELLOW, 0), 1);
      state = family(state);
      for (let step = 0; state.phase === "family"; step += 1) state = choose(state, "No Action", `no-action-${step}`);

      expect(state.company.debt).toBe(0);
      expect(playerCourtShares(state, BLUE)).toBe(1);
      expect(state.company.stockExchange.map((slot) => slot.share?.owner)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        RED,
      ]);
    });
  });
});

describe("Hiring phase (pp.14-17)", () => {
  it("follows the Chairman Election example: Pink backs Yellow, who wins with 3 of 5 shares (p.15)", () => {
    // Pink is played by Red. Blue is the former Chairman and declares the majority needed.
    let state = withCourtShares(baseGame("election-example"), [
      { id: "s-blue-1", owner: BLUE },
      { id: "s-blue-2", owner: BLUE },
      { id: "s-yellow-1", owner: YELLOW },
      { id: "s-yellow-2", owner: YELLOW },
      { id: "s-red-1", owner: RED },
    ]);
    state = hiring(withHiringQueue(withChairmanMarker(withOffice(state, "chairman", undefined), BLUE), ["chairman"]));

    expect(state.pendingDecision.step).toBe("hiring.chairmanSupport");
    expect(state.pendingDecision.actor).toBe(BLUE);
    expect(state.pendingDecision.prompt).toContain("3 of 5 Company shares make a majority");

    state = choose(state, "Support yourself");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = choose(state, "Support yourself");
    expect(state.pendingDecision.actor).toBe(RED);
    expectSaveRoundTripPreservesPendingDecision(state);
    state = choose(state, "Support Yellow");

    expect(chairmanHolder(state)).toBe(YELLOW);
    expect(state.company.chairmanMarker).toBe(YELLOW);
    expect(playerCourtShares(state, YELLOW)).toBe(1);
    expect(state.log.at(-1)?.summary).toBe("Yellow was elected Chairman.");
  });

  it("lets the former Chairman continue when the Court is empty, placing a piece from supply (p.15)", () => {
    let state = hiring(withHiringQueue(withChairmanMarker(baseGame("empty-court"), BLUE), ["chairman"]));

    expect(state.pendingDecision.step).toBe("hiring.emptyCourtChairman");
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, "Continue as Chairman");

    expect(chairmanHolder(state)).toBe(BLUE);
    expect(state.players[BLUE].familyMembers.supply).toBe(17);
  });

  it("takes the empty-Court Chairman from a prize when the former Chairman's supply is empty", () => {
    let state = withSupply(withPiecesOnPrize(baseGame("empty-court-prize"), BLUE, "prize-4", 1), BLUE, 0);
    state = { ...state, players: { ...state.players, [BLUE]: { ...state.players[BLUE], victoryPoints: 2 } } };
    state = hiring(withHiringQueue(withChairmanMarker(state, BLUE), ["chairman"]));

    state = choose(state, "Continue as Chairman (piece from the £4 prize)");
    expect(chairmanHolder(state)).toBe(BLUE);
    expect(state.players[BLUE].victoryPoints).toBe(0);
  });

  it("follows the General Hiring example: consent refused, so Pink promotes the Manager of Shipping (p.16)", () => {
    // Pink (Red) is Chairman and Military Affairs; Blue is Manager of Shipping with one fatigue;
    // Yellow is President of Madras.
    let state = withOffice(baseGame("general-hiring"), "chairman", RED, { inHiringQueue: false });
    state = withOffice(state, "military-affairs", RED, { inHiringQueue: false });
    state = withOffice(state, "manager-of-shipping", BLUE, { fatigue: 1, inHiringQueue: false });
    state = withOffice(state, "president-madras", YELLOW, { inHiringQueue: false });
    state = hiring(withHiringQueue(withOffice(state, "director-of-trade", undefined), ["director-of-trade"]));

    expect(state.pendingDecision.actor).toBe(RED);
    expect([...labels(state)].sort()).toEqual([
      "Promote Blue from Manager of Shipping",
      "Promote Red from Military Affairs",
      "Promote Yellow from Presidency of Madras",
    ]);

    // Nepotism: Pink needs the consent of Blue and Yellow, the other players in the pool.
    state = choose(state, "Promote Red from Military Affairs");
    expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, "Refuse");

    expect([...labels(state)].sort()).toEqual([
      "Promote Blue from Manager of Shipping",
      "Promote Yellow from Presidency of Madras",
    ]);
    state = choose(state, "Promote Blue from Manager of Shipping");

    expect(state.company.offices["director-of-trade"]).toEqual(
      expect.objectContaining({ holder: BLUE, fatigue: 1, vacant: false }),
    );
    expect(state.company.offices["manager-of-shipping"]).toEqual(expect.objectContaining({ vacant: true, fatigue: 0 }));
    // The Shipping card joins the Vacant Offices box and is hired next, in its own order.
    expect(state.company.vacantOffices).toContain("manager-of-shipping");
    // Nobody can fill it this turn, so it is skipped automatically with a log entry (p.17).
    expect(state.log.some((entry) => entry.type === "hiring.vacancySkipped" && entry.summary.includes("Manager of Shipping"))).toBe(true);
  });

  it("collects nepotism consent from each other player in turn and survives save/load between them", () => {
    let state = withOffice(baseGame("consent-each"), "chairman", RED, { inHiringQueue: false });
    state = withWriters(withWriters(withWriters(state, RED, "Bombay", 1), BLUE, "Madras", 1), YELLOW, "Bengal", 1);
    state = hiring(withHiringQueue(withOffice(state, "manager-of-shipping", undefined), ["manager-of-shipping"]));

    state = choose(state, "Hire Red Bombay writer");
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, "Consent");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    expect(state.hiring.nepotism?.consented).toEqual([BLUE]);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "Consent");
    expect(state.company.offices["manager-of-shipping"].holder).toBe(RED);
  });

  it("treats a called-in \"My consent for nepotism\" promise as that player's consent (card back)", () => {
    let state = withOffice(baseGame("consent-promise"), "chairman", RED, { inHiringQueue: false });
    state = withWriters(withWriters(state, RED, "Bombay", 1), BLUE, "Madras", 1);
    state = hiring(withHiringQueue(withOffice(state, "manager-of-shipping", undefined), ["manager-of-shipping"]));
    const promise = `promise-${BLUE}-my-consent-for-nepotism`;
    state = applyCommandOrThrow(state, { id: "give-promise", actorId: BLUE, type: "negotiation.give", payload: { to: RED, items: [{ kind: "promise", promiseId: promise }] } });
    state = applyCommandOrThrow(state, { id: "call-promise", actorId: RED, type: "negotiation.callInPromises", payload: { calls: [{ promiseId: promise, option: {} }] } });

    state = choose(state, "Hire Red Bombay writer");
    expect(state.company.offices["manager-of-shipping"].holder).toBe(RED);
  });

  it("hires your own family member without consent when no other player is in the pool", () => {
    let state = withOffice(baseGame("no-pool"), "chairman", RED, { inHiringQueue: false });
    state = withWriters(state, RED, "Bombay", 1);
    state = hiring(withHiringQueue(withOffice(state, "manager-of-shipping", undefined), ["manager-of-shipping"]));

    state = choose(state, "Hire Red Bombay writer");
    expect(state.company.offices["manager-of-shipping"].holder).toBe(RED);
  });

  it("lets the Hiring Preference holder force the hirer's choice and ignore Nepotism (blackmail #6)", () => {
    let state = withOffice(baseGame("hiring-preference"), "chairman", RED, { inHiringQueue: false });
    state = withWriters(withWriters(state, RED, "Bombay", 1), BLUE, "Madras", 1);
    state = withBlackmailCard(state, BLUE, "hiring-preference");
    state = hiring(withHiringQueue(withOffice(state, "manager-of-shipping", undefined), ["manager-of-shipping"]));

    expect(state.pendingDecision.step).toBe("hiring.hiringPreference");
    expect(state.pendingDecision.actor).toBe(BLUE);
    expectSaveRoundTripPreservesPendingDecision(state);
    state = choose(state, "Play Hiring Preference");

    expect(state.players[BLUE].blackmailCards[0].facedown).toBe(false);
    expect(state.pendingDecision.actor).toBe(RED);
    expect(labels(state)).toEqual(["Hire Blue Madras writer"]);
    state = choose(state, "Hire Blue Madras writer");
    expect(state.company.offices["manager-of-shipping"].holder).toBe(BLUE);
  });

  it("lets a hirer holding Hiring Preference hire themselves without consent", () => {
    let state = withOffice(baseGame("hiring-preference-self"), "chairman", RED, { inHiringQueue: false });
    state = withWriters(withWriters(state, RED, "Bombay", 1), BLUE, "Madras", 1);
    state = withBlackmailCard(state, RED, "hiring-preference");
    state = hiring(withHiringQueue(withOffice(state, "manager-of-shipping", undefined), ["manager-of-shipping"]));

    state = choose(state, "Play Hiring Preference");
    state = choose(state, "Hire Red Bombay writer");
    expect(state.company.offices["manager-of-shipping"].holder).toBe(RED);
  });

  it("keeps a skipped office in the Vacant Offices box and hires it next turn (p.14)", () => {
    let state = hiring(withHiringQueue(withOffice(baseGame("skip-next-turn"), "manager-of-shipping", undefined), [
      "manager-of-shipping",
    ]));
    // With no Chairman to hire it the office is skipped automatically and stays vacant (p.14, p.17).
    expect(state.pendingDecision.step).not.toBe("hiring.skipVacancy");
    expect(state.company.vacantOffices).toEqual(["manager-of-shipping"]);
    expect(state.log.some((entry) => entry.type === "hiring.vacancySkipped")).toBe(true);

    // Next turn there is a Chairman and a writer, so the office is hired.
    state = withWriters(withOffice(state, "chairman", BLUE, { inHiringQueue: false }), YELLOW, "Bombay", 1);
    state = hiring(state);
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.pendingDecision.prompt).toContain("Manager of Shipping");
  });

  it("has the Governor General hire Presidents once in play (p.26)", () => {
    let state = withOffice(baseGame("gg-hires"), "chairman", RED, { inHiringQueue: false });
    state = withOffice(state, "director-of-trade", BLUE, { fatigue: 1, treasury: 4, inHiringQueue: false });
    state = installGovernorGeneral(state);

    expect(state.company.governorGeneralInPlay).toBe(true);
    expect(state.company.offices["governor-general"]).toEqual(
      expect.objectContaining({ holder: BLUE, fatigue: 1, treasury: 4, vacant: false }),
    );
    expect(state.company.offices["director-of-trade"]).toEqual(expect.objectContaining({ created: false }));

    state = withWriters(state, YELLOW, "Madras", 1);
    state = hiring(withHiringQueue(withOffice(state, "president-madras", undefined), ["president-madras"]));
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, "Hire Yellow Madras writer");
    expect(presidentOf(state, "Madras")).toBe(YELLOW);
  });

  it("turns Governors into pensioners when the Governor General arrives (p.26)", () => {
    let state = withOffice(baseGame("gg-governors"), "governor-bombay", YELLOW, { inHiringQueue: false });
    state = installGovernorGeneral(state);

    expect(playerOffices(state, YELLOW)).toEqual([]);
    expect(state.players[YELLOW].familyMembers.pensioners).toBe(1);
    expect(state.company.vacantOffices).toContain("governor-general");
    expectGameInvariants({ ...state, pendingDecision: { ...state.pendingDecision, phase: state.phase } });
  });

  it("hires a newly created office immediately and resumes the interrupted phase (p.18, p.25)", () => {
    registerHiringResume("test.afterChina", (resumed) => ({
      ...resumed,
      pendingDecision: {
        id: "decision-test-resumed",
        phase: resumed.phase,
        step: "test.resumed",
        actor: "system",
        visibility: "public",
        prompt: "Resumed after China was opened.",
        legalCommands: [],
        canSave: true,
      },
    }));
    let state = withOffice(baseGame("immediate-china"), "chairman", RED, { inHiringQueue: false });
    state = withWriters(state, BLUE, "Bengal", 1);
    state = { ...state, phase: "companyOperation" };

    state = beginImmediateHire(state, "superintendent-of-trade-in-china", "test.afterChina");
    expect(state.phase).toBe("companyOperation");
    expect(state.pendingDecision.phase).toBe("companyOperation");
    expect(state.pendingDecision.step).toBe("hiring.hireOffice");
    expect(state.company.unusedOffices).not.toContain("superintendent-of-trade-in-china");

    state = choose(state, "Hire Blue Bengal writer");
    expect(state.company.offices["superintendent-of-trade-in-china"].holder).toBe(BLUE);
    expect(state.pendingDecision.step).toBe("test.resumed");
    expect(state.hiring.immediate).toBeUndefined();
  });

  it("leaves a newly created office vacant for the next Hiring phase when nobody can be hired", () => {
    registerHiringResume("test.afterChinaVacant", (resumed) => ({
      ...resumed,
      pendingDecision: { ...resumed.pendingDecision, step: "test.resumed" },
    }));
    let state = withOffice(baseGame("immediate-china-vacant"), "chairman", RED, { inHiringQueue: false });
    state = { ...state, phase: "companyOperation" };

    state = beginImmediateHire(state, "superintendent-of-trade-in-china", "test.afterChinaVacant");
    expect(state.pendingDecision.step).toBe("test.resumed");
    expect(state.company.offices["superintendent-of-trade-in-china"]).toEqual(
      expect.objectContaining({ created: true, vacant: true }),
    );
    expect(state.company.vacantOffices).toContain("superintendent-of-trade-in-china");
  });

  it("includes the Chairman's own officers in training for Military Affairs, subject to Nepotism", () => {
    let state = withOffice(baseGame("ma-oit"), "chairman", RED, { inHiringQueue: false });
    state = withOfficersInTraining(state, RED, 1);
    state = hiring(withHiringQueue(withOffice(state, "military-affairs", undefined), ["military-affairs"]));

    // Red is the only candidate, so no other player needs to consent.
    state = choose(state, "Hire Red officer in training");
    expect(state.company.offices["military-affairs"].holder).toBe(RED);
  });
});

describe("random legal play through Family and Hiring", () => {
  const OFFICES = [
    "chairman",
    "director-of-trade",
    "manager-of-shipping",
    "military-affairs",
    "president-bombay",
    "president-madras",
    "president-bengal",
  ];
  const PRESTIGE = ["mr-rochester", "william-collins", "john-thorpe", "lady-glencora", "stock-broker", "foundry"];
  const LAWS = ["calico-acts", "army-spending", "tenure-limits", "industry-subsidy", "debt-restructure"];
  const PLAYERS = [RED, BLUE, YELLOW];

  function randomGame(seed: number): GameState {
    let rng = createRngState(`family-hiring-fuzz-${seed}`);
    const roll = (sides: number) => {
      const result = rollDie(rng, sides, "fuzz");
      rng = result.rng;
      return result.value;
    };
    let state = baseGame(`fuzz-${seed}`);

    for (const playerId of PLAYERS) {
      state = withCash(state, { [playerId]: roll(12) - 1 });
      if (roll(3) === 1) state = withPrestigeCard(state, playerId, PRESTIGE[roll(PRESTIGE.length) - 1]);
      if (roll(4) === 1) state = withBlackmailCard(state, playerId, "hiring-preference");
      for (const presidency of ["Bombay", "Madras", "Bengal"] as const) {
        if (roll(2) === 1) state = withWriters(state, playerId, presidency, roll(2));
      }
      if (roll(3) === 1) state = withOfficersInTraining(state, playerId, 1);
      if (roll(4) === 1) state = withPiecesOnPrize(withSupply(state, playerId, 0), playerId, "prize-4", 1);
    }

    const shares = PLAYERS.flatMap((playerId, index) =>
      Array.from({ length: roll(3) - 1 }, (_, shareIndex) => ({ id: `fuzz-share-${index}-${shareIndex}`, owner: playerId })),
    );
    state = withCourtShares(state, shares);

    for (const officeId of OFFICES) {
      const holder = roll(3) === 1 ? undefined : PLAYERS[roll(3) - 1];
      if (holder && state.players[holder].familyMembers.supply === 0) continue;
      state = withOffice(state, officeId, holder);
    }

    state = withChairmanMarker(state, PLAYERS[roll(3) - 1]);
    state = withPassedLaws(state, LAWS.filter(() => roll(3) === 1));
    return withDebt(state, roll(4) - 1);
  }

  it("never rejects a listed command, loses a piece, or gets stuck before Company Operation", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      let state = family(randomGame(seed));
      let rng = createRngState(`family-hiring-moves-${seed}`);

      for (let step = 0; state.phase === "family" || state.phase === "hiring"; step += 1) {
        expect(step, `seed ${seed} did not reach Company Operation`).toBeLessThan(200);
        const legal = state.pendingDecision.legalCommands;
        expect(legal.length, `seed ${seed} stuck at ${state.pendingDecision.step}`).toBeGreaterThan(0);

        let index = 0;
        if (legal.length > 1) {
          const roll = rollDie(rng, legal.length, "fuzz-move");
          rng = roll.rng;
          index = roll.value - 1;
        }
        const command = legal[index];
        const actor = state.pendingDecision.actor;
        state = applyCommandOrThrow(state, {
          id: `fuzz-${seed}-${step}`,
          actorId: actor === "simultaneous" ? RED : actor,
          type: command.type,
          payload: command.payload ?? {},
        });
      }

      expect(state.phase).toBe("companyOperation");
    }
  });
});
