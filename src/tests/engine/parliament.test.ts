import { describe, expect, it } from "vitest";
import type { GameState } from "../../engine";
import { grantEnterpriseVotes } from "../../engine/phases/parliament";
import { calculateCompanyExpenses } from "../../engine/phases/revenue";
import { createRngState } from "../../engine/rng";
import { withCommander, withCourtShares, withOffice, withOfficers, withRegiments } from "../fixtures/builders";
import { expectSaveRoundTripPreservesPendingDecision } from "../fixtures/game";
import {
  choose,
  hasCommand,
  parliamentState,
  withBlackmail,
  withEnterprises,
  withPrestigeCards,
  withPrize,
} from "../fixtures/parliament";

const start = (state: GameState) => choose(state, "parliament.confirm");
const pass = (state: GameState) => choose(state, "parliament.passVote");
const resolveVote = (state: GameState) => choose(state, "parliament.continueVoting", (payload) => payload.another === false);
const castCash = (state: GameState, direction: "for" | "against", votes: number) =>
  choose(state, "parliament.castVotes", (payload) => payload.source === "cash" && payload.direction === direction && payload.votes === votes);
const passedLawIds = (state: GameState) => state.parliament.passedLaws.map((law) => law.lawId);

describe("Selecting a law and policy (pp.34-35)", () => {
  it("follows the Selecting a Law example: Calico Acts, then the dilemma Masses Demand Franchise! must be chosen", () => {
    let state = start(parliamentState({ drawPile: ["calico-acts", "masses-demand-franchise", "army-spending"], dial: 6 }));

    expect(state.pendingDecision.step).toBe("parliament.chooseLaw");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(hasCommand(state, "parliament.selectLaw", (payload) => payload.lawId === "calico-acts")).toBe(true);
    expect(hasCommand(state, "parliament.drawLaw")).toBe(true);

    // Drawing a dilemma stops drawing: it is the only law that may be chosen.
    state = choose(state, "parliament.drawLaw");
    expect(state.pendingDecision.legalCommands.map((command) => [command.type, command.payload])).toEqual([
      ["parliament.selectLaw", { lawId: "masses-demand-franchise" }],
    ]);

    state = choose(state, "parliament.selectLaw");
    expect(state.parliament.lawDeck.discardPile).toEqual(["calico-acts"]);
    expect(state.parliament.voteMarker).toBe(1);

    // Social icon: clockwise reaches a power policy, counterclockwise taxes social enterprises and windows.
    expect(state.pendingDecision.step).toBe("parliament.choosePolicy");
    expect(state.pendingDecision.legalCommands.map((command) => [command.payload, command.label])).toEqual([
      [{ space: 7 }, "Rotate clockwise to Power: social enterprises"],
      [{ space: 3 }, "Rotate counterclockwise to Tax & Window Tax: social enterprises"],
    ]);
  });

  it("offers at most three draws", () => {
    let state = start(parliamentState({ drawPile: ["calico-acts", "army-spending", "debt-restructure", "ship-subsidy"] }));
    state = choose(state, "parliament.drawLaw");
    state = choose(state, "parliament.drawLaw");

    expect(hasCommand(state, "parliament.drawLaw")).toBe(false);
    expect(state.pendingDecision.legalCommands).toHaveLength(3);
  });

  it("Old Ideas Made New! brings back a discarded law, then reshuffles everything (law #52)", () => {
    let state = start(
      parliamentState({ drawPile: ["old-ideas-made-new", "army-spending"], discardPile: ["calico-acts"], dial: 9 }),
    );
    state = choose(state, "parliament.selectLaw");
    expect(state.pendingDecision.step).toBe("parliament.selectFromDiscard");

    state = choose(state, "parliament.selectFromDiscard", (payload) => payload.lawId === "calico-acts");
    expect(state.parliament.voteMarker).toBe(1);
    state = choose(state, "parliament.choosePolicy", (payload) => payload.space === 10);

    while (state.phase === "parliament") state = pass(state);

    expect(passedLawIds(state)).toContain("calico-acts");
    expect(state.parliament.lawDeck.discardPile).toEqual([]);
    expect([...state.parliament.lawDeck.drawPile].sort()).toEqual(["army-spending", "old-ideas-made-new"]);
  });

  it("ignores Old Ideas Made New! when the discard pile is empty and draws a new law", () => {
    let state = start(parliamentState({ drawPile: ["old-ideas-made-new", "debt-restructure"] }));
    state = choose(state, "parliament.selectLaw");

    expect(state.pendingDecision.step).toBe("parliament.chooseLaw");
    expect(state.parliament.session?.drawn).toHaveLength(1);
    expect(state.parliament.session?.drawn[0]).not.toBe("old-ideas-made-new");
  });

  it("does not redraw Old Ideas Made New! forever when it is the last law (regression)", () => {
    let state = start(parliamentState({ drawPile: ["old-ideas-made-new"] }));
    state = choose(state, "parliament.selectLaw");

    // No other law can be drawn, so no law comes before Parliament this turn.
    expect(state.phase).toBe("upkeep");
    expect(state.parliament.lawDeck.drawPile).toEqual(["old-ideas-made-new"]);
  });
});

describe("Voting (p.35)", () => {
  function tradeRegulationsVote(options: { previousLeader?: string } = {}) {
    let state = parliamentState({
      drawPile: ["trade-regulations"],
      cash: { "player-red": 2, "player-blue": 5, "player-yellow": 5 },
    });
    state = { ...state, parliament: { ...state.parliament, oppositionLeader: options.previousLeader } };
    state = start(state);
    state = choose(state, "parliament.selectLaw");
    return choose(state, "parliament.choosePolicy", (payload) => payload.space === 2);
  }

  it("starts with the Prime Minister, who may not vote against (the Prime Minister's Honor)", () => {
    const state = tradeRegulationsVote();

    expect(state.pendingDecision.step).toBe("parliament.vote");
    expect(state.pendingDecision.actor).toBe("player-red");
    expect(hasCommand(state, "parliament.castVotes", (payload) => payload.direction === "against")).toBe(false);
    expect(hasCommand(state, "parliament.castVotes", (payload) => payload.direction === "for")).toBe(true);
    expectSaveRoundTripPreservesPendingDecision(state);
  });

  it("gives the Opposition Leader marker to the player with most votes against; a tie keeps it", () => {
    let state = pass(tradeRegulationsVote());
    state = pass(castCash(state, "against", 2));
    expect(state.parliament.oppositionLeader).toBe("player-blue");

    // Yellow ties Blue: the previous holder keeps the marker.
    state = castCash(state, "against", 2);
    expect(state.parliament.oppositionLeader).toBe("player-blue");

    state = castCash(state, "against", 1);
    expect(state.parliament.oppositionLeader).toBe("player-yellow");
  });

  it("leaves the marker with its earlier holder when nobody votes against (assumption)", () => {
    let state = pass(tradeRegulationsVote({ previousLeader: "player-yellow" }));
    state = pass(pass(state));

    // Trade Regulations starts at -1 support and fails; the marker never moved, so its holder
    // from an earlier vote takes the Prime Minister dial (literal reading of pp.35-36).
    expect(state.parliament.primeMinister).toBe("player-yellow");
    expect(state.pendingDecision.actor).toBe("player-yellow");
  });

  it("does not let a player who voted against vote for the law later", () => {
    let state = pass(tradeRegulationsVote());
    state = castCash(state, "against", 1);

    expect(hasCommand(state, "parliament.castVotes", (payload) => payload.direction === "for")).toBe(false);
  });

  it("transfers the Prime Minister dial to the Opposition Leader when the law fails (p.36)", () => {
    let state = pass(tradeRegulationsVote());
    state = pass(castCash(state, "against", 2));
    state = pass(state);
    state = resolveVote(state);

    expect(state.parliament.primeMinister).toBe("player-blue");
    expect(state.parliament.oppositionLeader).toBeUndefined();
    expect(state.parliament.lawDeck.discardPile).toContain("trade-regulations");
    expect(state.pendingDecision.step).toBe("parliament.moveFailedPolicy");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([
      { space: 3, addWindowTax: false },
      { space: 1, addWindowTax: false },
    ]);

    state = choose(state, "parliament.moveFailedPolicy", (payload) => payload.space === 1);
    expect(state.parliament.policyDialPosition).toBe(1);
    expect(state.phase).toBe("upkeep");
  });

  it("lets a coalition credit votes against to another player (p.35)", () => {
    let state = pass(tradeRegulationsVote());
    state = pass(castCash(state, "against", 1));
    state = choose(state, "parliament.setVoteCredit", (payload) => payload.creditTo === "player-blue");
    state = castCash(state, "against", 2);

    expect(state.parliament.session?.votes["player-blue"].credited).toBe(3);
    expect(state.parliament.oppositionLeader).toBe("player-blue");
  });

  it("counts card votes: workshops 2, shipyards 1, Labour Newspaper 4 on manufacturing policies", () => {
    let state = withEnterprises(
      parliamentState({ drawPile: ["calico-acts"], dial: 9 }),
      "player-blue",
      [
        { type: "workshop", cardId: "workshop-01" },
        { type: "shipyard", cardId: "shipyard-01" },
      ],
    );
    state = withPrestigeCards(state, "player-blue", ["labour-newspaper", "lady-glencora"]);
    // The Prime Minister (Red) has nothing to vote with and is skipped.
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 10);
    expect(state.pendingDecision.actor).toBe("player-blue");

    const forVotes = state.pendingDecision.legalCommands
      .filter((command) => (command.payload as { source?: string; direction?: string }).source === "card")
      .filter((command) => (command.payload as { direction: string }).direction === "for")
      .map((command) => command.label);
    expect(forVotes).toEqual([
      "Rotate Workshop 01 for 2 votes for",
      "Rotate Atlas for 1 vote for",
      "Rotate Labour Newspaper for 4 votes for",
    ]);

    state = choose(state, "parliament.castVotes", (payload) => payload.source === "card" && payload.direction === "for");
    expect(state.parliament.voteMarker).toBe(3);
    // A rotated card cannot vote again this session.
    expect(state.pendingDecision.legalCommands.filter((command) => command.label.includes("Workshop 01"))).toEqual([]);
  });

  it("charges £2 per vote once Masses Demand Franchise! has passed", () => {
    let state = parliamentState({
      drawPile: ["calico-acts"],
      dial: 9,
      passedLaws: ["masses-demand-franchise"],
      cash: { "player-red": 5 },
    });
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 10);

    expect(state.pendingDecision.legalCommands.map((command) => command.label)).toContain("Spend £4 for 2 votes for");
    state = castCash(state, "for", 2);
    expect(state.players["player-red"].cash).toBe(1);
  });

  it("lends enterprise votes through the Vote with my enterprises promise hook (NG)", () => {
    let state = withEnterprises(
      parliamentState({ drawPile: ["calico-acts"], dial: 9 }),
      "player-red",
      [{ type: "workshop", cardId: "workshop-02" }],
    );
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 10);
    const lent = grantEnterpriseVotes(state, "player-red", "player-blue");
    expect(lent.ok).toBe(true);
    if (!lent.ok) return;

    // The Prime Minister's own workshop can be voted against through the promise.
    state = pass(lent.state);
    expect(
      hasCommand(state, "parliament.castVotes", (payload) => payload.source === "card" && payload.direction === "against"),
    ).toBe(true);
  });
});

describe("Policy consequences (p.34)", () => {
  it("taxes each target; a player who cannot pay returns targets of their choice", () => {
    let state = withEnterprises(
      parliamentState({ drawPile: ["calico-acts"], dial: 9, cash: { "player-blue": 1 } }),
      "player-blue",
      [
        { type: "workshop", cardId: "workshop-01" },
        { type: "workshop", cardId: "workshop-02" },
      ],
    );
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 10);
    state = pass(state);

    expect(state.pendingDecision.step).toBe("parliament.surrender");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.legalCommands).toHaveLength(2);
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "parliament.surrender");
    // £1 tax on the remaining workshop, then Calico Acts pays £2 per manufacturing enterprise.
    expect(state.players["player-blue"].enterprises).toHaveLength(1);
    expect(state.players["player-blue"].cash).toBe(2);
    expect(passedLawIds(state)).toContain("calico-acts");
    expect(state.players["player-red"].passedLawTokens).toBe(1);
    expect(state.phase).toBe("upkeep");
  });

  it("returns the Chairman to supply when a Company share tax cannot be paid", () => {
    let state = withOffice(parliamentState({ drawPile: ["military-oversight"] }), "chairman", "player-blue");
    state = withCourtShares(state, [{ id: "share-yellow", owner: "player-yellow" }]);
    state = { ...state, players: { ...state.players, "player-yellow": { ...state.players["player-yellow"], cash: 3 } } };
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 1);
    while (state.pendingDecision.step === "parliament.vote") state = pass(state);

    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.legalCommands.map((command) => command.payload)).toEqual([{ itemId: "chairman" }]);
    const supplyBefore = state.players["player-blue"].familyMembers.supply;
    state = choose(state, "parliament.surrender");

    expect(state.company.offices.chairman.vacant).toBe(true);
    expect(state.company.vacantOffices).toContain("chairman");
    expect(state.players["player-blue"].familyMembers.supply).toBe(supplyBefore + 1);
    expect(state.players["player-yellow"].cash).toBe(2);
  });

  it("collects window tax on prizes and enterprises, or the item is lost", () => {
    let state = withEnterprises(
      parliamentState({ drawPile: ["masses-demand-franchise"], dial: 2, cash: { "player-blue": 2 } }),
      "player-blue",
      [{ type: "luxury", cardId: "luxury-01" }],
    );
    state = withPrize(state, "player-blue", "prize-8", 1, 4);
    const vpBefore = state.players["player-blue"].victoryPoints;
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 3);
    while (state.pendingDecision.step === "parliament.vote") state = pass(state);

    // £1 social tax paid; window tax due £3 (luxury 1 + £8 prize 2) against £1.
    expect(state.pendingDecision.step).toBe("parliament.surrender");
    state = choose(state, "parliament.surrender", (payload) => String(payload.itemId).startsWith("prize:"));

    expect(state.players["player-blue"].familyMembers.prizes["prize-8"]).toBe(0);
    expect(state.players["player-blue"].victoryPoints).toBe(vpBefore - 4);
    expect(state.players["player-blue"].cash).toBe(0);
    expect(state.players["player-blue"].enterprises).toHaveLength(1);
    expect(state.phase).toBe("upkeep");
  });

  it("collects no window tax while Window Tax Repeal is in effect", () => {
    let state = withEnterprises(
      parliamentState({ drawPile: ["masses-demand-franchise"], dial: 2, passedLaws: ["window-tax-repeal"], cash: { "player-blue": 2 } }),
      "player-blue",
      [{ type: "luxury", cardId: "luxury-01" }],
    );
    state = withPrize(state, "player-blue", "prize-8", 1, 4);
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 3);
    while (state.phase === "parliament") state = pass(state);

    expect(state.players["player-blue"].cash).toBe(1);
    expect(state.players["player-blue"].familyMembers.prizes["prize-8"]).toBe(1);
  });

  it("swaps a power marker with the next higher one", () => {
    let state = start(parliamentState({ drawPile: ["governor-general"] }));
    state = choose(choose(state, "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 2);
    while (state.phase === "parliament") state = pass(state);

    expect(state.company.powerTrack).toEqual({ social: 2, companyShare: 0, shipping: 1, manufacturing: 0 });
  });

  it("lets the Prime Minister swap two other markers when the target is already highest", () => {
    let state = start(parliamentState({ drawPile: ["masses-demand-franchise"], dial: 6 }));
    state = choose(choose(state, "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 7);
    while (state.pendingDecision.step === "parliament.vote") state = pass(state);

    expect(state.pendingDecision.step).toBe("parliament.choosePowerSwap");
    expect(state.pendingDecision.legalCommands).toHaveLength(3);
    state = choose(state, "parliament.choosePowerSwap", (payload) =>
      JSON.stringify(payload.targets) === JSON.stringify(["companyShare", "shipping"]),
    );
    expect(state.company.powerTrack).toEqual({ social: 2, companyShare: 0, shipping: 1, manufacturing: 0 });
  });
});

describe("Law and dilemma effects", () => {
  function passLaw(state: GameState, space: number, votesFor = 0): GameState {
    let next = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === space);
    // Spending all their cash leaves the voter nothing to cast, so they are skipped automatically.
    if (votesFor > 0) next = castCash(next, "for", votesFor);
    while (next.pendingDecision.step === "parliament.vote") next = pass(next);
    if (next.pendingDecision.step === "parliament.continueVoting") next = resolveVote(next);
    return next;
  }

  it("Army Spending places 2 regiments in each Army and pays the Foundry £1 each", () => {
    let state = withPrestigeCards(
      parliamentState({ drawPile: ["army-spending"], cash: { "player-red": 4 } }),
      "player-yellow",
      ["foundry"],
    );
    state = withRegiments(state, { Bombay: { ready: 1, exhausted: 0 }, Madras: { ready: 1, exhausted: 0 }, Bengal: { ready: 1, exhausted: 0 } });
    state = passLaw(state, 1, 4);

    expect(state.company.armies.Bombay.regiments.ready).toBe(3);
    expect(state.company.armies.Bengal.regiments.ready).toBe(3);
    expect(state.players["player-yellow"].cash).toBe(6);
  });

  it("Debt Restructure, Company Aids Government and Envoy to China change the Company", () => {
    let state = parliamentState({ drawPile: ["debt-restructure"], cash: { "player-red": 3 } });
    state = { ...state, company: { ...state.company, debt: 5 } };
    expect(passLaw(state, 1, 3).company.debt).toBe(0);

    const aid = passLaw(parliamentState({ drawPile: ["company-aids-government"] }), 2);
    expect(aid.company.shareValue).toBe(2);

    const envoy = passLaw(parliamentState({ drawPile: ["envoy-to-china"], cash: { "player-red": 3 } }), 2, 3);
    expect(envoy.company.offices["superintendent-of-trade-in-china"]).toEqual(expect.objectContaining({ created: true, vacant: true }));
    expect(envoy.company.vacantOffices).toContain("superintendent-of-trade-in-china");
  });

  it("Governor General: the Director of Trade becomes the Governor General and Governors become pensioners (p.26)", () => {
    let state = withOffice(parliamentState({ drawPile: ["governor-general"] }), "director-of-trade", "player-blue", {
      fatigue: 1,
      treasury: 4,
    });
    state = withOffice(state, "governor-madras", "player-yellow");
    state = passLaw(state, 2);

    expect(state.company.governorGeneralInPlay).toBe(true);
    expect(state.company.offices["governor-general"]).toEqual(
      expect.objectContaining({ holder: "player-blue", fatigue: 1, treasury: 4, vacant: false, created: true }),
    );
    expect(state.company.offices["director-of-trade"]).toEqual(expect.objectContaining({ created: false, vacant: true }));
    expect(state.company.offices["governor-madras"].created).toBe(false);
    expect(state.players["player-yellow"].familyMembers.pensioners).toBe(1);
  });

  it("Public Demands Impeachment! removes the picked officeholder if passed", () => {
    let state = withOffice(parliamentState({ drawPile: ["public-demands-impeachment"] }), "manager-of-shipping", "player-blue");
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 2);
    expect(state.pendingDecision.step).toBe("parliament.chooseImpeachmentTarget");
    state = choose(state, "parliament.chooseImpeachmentTarget", (payload) => payload.officeId === "manager-of-shipping");
    while (state.phase === "parliament") state = pass(state);

    expect(state.company.offices["manager-of-shipping"].vacant).toBe(true);
    expect(state.players["player-blue"].familyMembers.pensioners).toBe(0);
  });

  it("Public Demands Impeachment! lowers Standing if failed", () => {
    let state = withOffice(
      parliamentState({ drawPile: ["public-demands-impeachment"], cash: { "player-blue": 2 } }),
      "manager-of-shipping",
      "player-yellow",
    );
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 2);
    state = choose(state, "parliament.chooseImpeachmentTarget");
    state = resolveVote(castCash(state, "against", 2));
    state = choose(state, "parliament.moveFailedPolicy");

    expect(state.company.standing).toBe(3);
    expect(state.company.offices["manager-of-shipping"].vacant).toBe(false);
    expect(state.parliament.primeMinister).toBe("player-blue");
  });

  it("Relief Demanded for Indian Famine! failed: Turmoil in each home region (law #53)", () => {
    let state = parliamentState({ drawPile: ["relief-demanded-for-indian-famine"], cash: { "player-blue": 2 } });
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 1);
    state = resolveVote(castCash(state, "against", 2));

    const order = (regionId: string, orderId: string) =>
      state.india.regions[regionId].orders.find((candidate) => candidate.id === orderId)!;
    expect(order("bombay", "bombay-north-3").closed).toBe(true);
    expect(order("madras", "madras-home-5").closed).toBe(true);
    expect(order("bengal", "bengal-north-5").closed).toBe(true);
    expect(order("bengal", "bengal-home-6").closed).toBe(false);
  });

  it("War Against France! failed: an invaded Company region is defended through Events in India, then the vote finishes", () => {
    const build = (seed: string) => {
      let state = parliamentState({ drawPile: ["war-against-france"], cash: { "player-blue": 2 } });
      state = { ...state, rng: createRngState(seed) };
      state = withRegiments(state, { Bengal: { ready: 2, exhausted: 0 } });
      state = withOfficers(withCommander(state, "Bengal", "player-red"), "player-yellow", "Bengal", { ready: 2, exhausted: 0 });
      const bengal = state.india.regions.bengal;
      state = { ...state, india: { ...state.india, regions: { ...state.india.regions, bengal: { ...bengal, companyControlled: true, associatedPresidency: "Bengal", hasDome: false, towerLevels: 0 } } } };
      state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy");
      return resolveVote(castCash(state, "against", 2));
    };
    // Find a seed whose storm die strikes the East Indian zone and whose invasion needs a defence choice.
    let state: GameState | undefined;
    for (let index = 0; index < 400 && !state; index += 1) {
      const candidate = build(`war-${index}`);
      if (candidate.pendingDecision.step === "eventsInIndia.defend") state = candidate;
    }
    expect(state, "no seed produced a defence decision").toBeDefined();
    expect(state!.phase).toBe("eventsInIndia");
    expect(state!.pendingDecision.actor).toBe("player-red");
    expectSaveRoundTripPreservesPendingDecision(state!);

    let current = state!;
    while (current.phase === "eventsInIndia") current = choose(current, current.pendingDecision.legalCommands[0].type);
    while (current.phase === "parliament") current = choose(current, current.pendingDecision.legalCommands[0].type);
    expect(current.parliament.session).toBeUndefined();
    expect(passedLawIds(current)).not.toContain("war-against-france");
    expect(current.phase).toBe("upkeep");
  });

  it("War Against France! passed: the Prime Minister returns ships and officers/regiments", () => {
    let state = parliamentState({ drawPile: ["war-against-france"] });
    state = withEnterprises(state, "player-blue", [{ type: "shipyard", cardId: "shipyard-02" }]);
    state = {
      ...state,
      company: {
        ...state.company,
        ships: [
          { id: "company-ship-1", kind: "company", location: "west-indian", fatigued: false },
          { id: "ship-shipyard-02", kind: "player", shipyardCardId: "shipyard-02", location: "east-indian", fatigued: true },
          { id: "extra-1", kind: "extra", location: "south-indian", fatigued: false },
        ],
      },
    };
    state = withRegiments(state, { Bombay: { ready: 1, exhausted: 0 }, Madras: { ready: 0, exhausted: 0 }, Bengal: { ready: 0, exhausted: 0 } });
    state = withOfficers(state, "player-yellow", "Madras", { ready: 1, exhausted: 0 });
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 1);
    while (state.pendingDecision.step === "parliament.vote") state = pass(state);

    expect(state.pendingDecision.step).toBe("parliament.warAgainstFranceShip");
    expect(state.pendingDecision.legalCommands).toHaveLength(2);
    state = choose(state, "parliament.warAgainstFranceShip");
    state = choose(state, "parliament.warAgainstFranceShip");
    state = choose(state, "parliament.warAgainstFrancePiece");
    state = choose(state, "parliament.warAgainstFrancePiece");

    expect(state.company.ships.map((ship) => [ship.id, ship.location])).toEqual([
      ["ship-shipyard-02", "shipyard"],
      ["extra-1", "south-indian"],
    ]);
    expect(state.company.armies.Bombay.regiments.ready).toBe(0);
    expect(state.company.armies.Madras.officers["player-yellow"].ready).toBe(0);
    expect(state.phase).toBe("upkeep");
  });

  it("Tax Collectors adds a window tax with the Prime Minister's consent", () => {
    let state = withPrestigeCards(
      parliamentState({ drawPile: ["governor-general"], cash: { "player-yellow": 5 } }),
      "player-blue",
      ["tax-collectors"],
    );
    state = withPrize(state, "player-yellow", "prize-4", 1, 2);
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy", (payload) => payload.space === 2);
    expect(state.pendingDecision.step).toBe("parliament.taxCollectors");
    state = choose(state, "parliament.taxCollectors", (payload) => payload.propose === true);
    expect(state.pendingDecision.step).toBe("parliament.taxCollectorsConsent");
    state = choose(state, "parliament.taxCollectorsConsent", (payload) => payload.accept === true);
    while (state.pendingDecision.step === "parliament.vote") state = pass(state);

    expect(state.players["player-yellow"].cash).toBe(4);
  });
});

describe("Revenue law and card effects (p.27)", () => {
  function revenueState(options: { balance: number; regiments?: number; chairman?: string; passedLaws?: string[] }) {
    let state = parliamentState({ drawPile: [], passedLaws: options.passedLaws ?? ["royal-protection"] });
    state = withRegiments(state, {
      Bombay: { ready: options.regiments ?? 0, exhausted: 0 },
      Madras: { ready: 0, exhausted: 0 },
      Bengal: { ready: 0, exhausted: 0 },
    });
    if (options.chairman) state = withOffice(state, "chairman", options.chairman);
    return {
      ...state,
      phase: "revenue" as const,
      company: { ...state.company, balance: options.balance, debt: 0, vacantOffices: [] },
      pendingDecision: {
        id: "decision-revenue-test",
        phase: "revenue" as const,
        step: "revenue.confirm",
        actor: "system" as const,
        visibility: "public" as const,
        prompt: "Revenue",
        legalCommands: [{ type: "revenue.confirm", label: "Revenue", payload: {} }],
        canSave: true as const,
      },
    };
  }

  it("Royal Protection: the Chairman may discard it to avoid emergency loans", () => {
    let state = choose(revenueState({ balance: 2, regiments: 6, chairman: "player-red" }), "revenue.confirm");

    expect(state.pendingDecision.step).toBe("revenue.royalProtection");
    expect(state.pendingDecision.actor).toBe("player-red");
    expectSaveRoundTripPreservesPendingDecision(state);
    state = choose(state, "revenue.royalProtection", (payload) => payload.discard === true);

    expect(state.company.debt).toBe(0);
    expect(state.company.balance).toBe(0);
    // No embarrassment for loans, but £0 misses the £10 Expectations.
    expect(state.company.standing).toBe(3);
    expect(passedLawIds(state)).not.toContain("royal-protection");
    expect(state.parliament.lawDeck.discardPile).toContain("royal-protection");
    expect(state.pendingDecision.step).toBe("revenue.chooseDividends");
  });

  it("Royal Protection kept: loans are taken as usual", () => {
    let state = choose(revenueState({ balance: 2, regiments: 6, chairman: "player-red" }), "revenue.confirm");
    state = choose(state, "revenue.royalProtection", (payload) => payload.discard === false);

    expect(state.company.debt).toBe(1);
    expect(state.company.standing).toBe(2);
    expect(passedLawIds(state)).toContain("royal-protection");
  });

  it("Calico Acts lowers the Balance by £1 for every £7 at the start of Revenue", () => {
    const state = choose(revenueState({ balance: 15, passedLaws: ["calico-acts"] }), "revenue.confirm");
    expect(state.company.balance).toBe(13);
  });

  it("Sepoy Recruitment frees regiments and Company Aids Government doubles Debt expenses", () => {
    let state = revenueState({ balance: 0, regiments: 4, passedLaws: ["sepoy-recruitment", "company-aids-government"] });
    state = { ...state, company: { ...state.company, debt: 2 } };
    expect(calculateCompanyExpenses(state)).toEqual({ debt: 4, armies: 0, ships: 0, total: 4 });
  });

  it("Company Fraud: roll per officeholder, take twice the highest roll from the Balance", () => {
    let state = withBlackmail(revenueState({ balance: 20 }), "player-blue", "company-fraud");
    state = withOffice(state, "military-affairs", "player-blue");
    state = choose(state, "revenue.confirm");

    expect(state.pendingDecision.step).toBe("revenue.companyFraud");
    state = choose(state, "revenue.companyFraud", (payload) => payload.play === true);
    const taken = state.players["player-blue"].cash;
    expect(taken % 2).toBe(0);
    expect(taken).toBeGreaterThanOrEqual(2);
    expect(state.players["player-blue"].blackmailCards[0].facedown).toBe(false);
    expect(state.log.at(-1)?.rngRolls).toHaveLength(1);
  });

  it("Company Fraud goes through the shared blackmail path: Man on the Inside can cancel it (p.12)", () => {
    let state = withBlackmail(revenueState({ balance: 20 }), "player-blue", "company-fraud");
    state = withBlackmail(state, "player-yellow", "man-on-the-inside");
    state = withOffice(state, "military-affairs", "player-blue");
    state = choose(state, "revenue.confirm");
    state = choose(state, "revenue.companyFraud", (payload) => payload.play === true);

    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "negotiation.blackmailReaction", actor: "player-yellow" }));
    expectSaveRoundTripPreservesPendingDecision(state);
    state = choose(state, "negotiation.respondToBlackmail", (payload) => payload.cancel === true);

    expect(state.players["player-blue"].cash).toBe(0);
    expect(state.company.balance).toBe(20);
    expect(state.players["player-yellow"].blackmailCards.map((card) => card.cardId).sort()).toEqual(["company-fraud", "man-on-the-inside"]);
    expect(state.phase).toBe("revenue");
  });

  it("offers Scandal blackmail after Revenue to force an officeholder out without retirement", () => {
    let state = withBlackmail(revenueState({ balance: 0 }), "player-blue", "scandal-on-leadenhall-street");
    state = withOffice(state, "manager-of-shipping", "player-red");
    state = choose(state, "revenue.confirm");
    state = choose(state, "revenue.chooseDividends");

    expect(state.pendingDecision.step).toBe("revenue.playScandal");
    const supplyBefore = state.players["player-red"].familyMembers.supply;
    state = choose(state, "revenue.playScandal", (payload) => (payload.params as { officeId?: string } | undefined)?.officeId === "manager-of-shipping");

    expect(state.company.offices["manager-of-shipping"].vacant).toBe(true);
    expect(state.players["player-red"].familyMembers.supply).toBe(supplyBefore + 1);
    expect(state.players["player-red"].familyMembers.pensioners).toBe(0);
    expect(state.phase).toBe("eventsInIndia");
  });
});

describe("Offices created by laws (p.25)", () => {
  it("Envoy to China: the Chairman hires the new Superintendent at once, then the vote resolves", () => {
    let state = withOffice(parliamentState({ drawPile: ["envoy-to-china"], cash: { "player-red": 5 } }), "chairman", "player-blue");
    state = { ...state, india: { ...state.india, presidencies: { ...state.india.presidencies, Bengal: { ...state.india.presidencies.Bengal, writers: { "player-yellow": 1 } } } } };
    state = { ...state, players: { ...state.players, "player-yellow": { ...state.players["player-yellow"], familyMembers: { ...state.players["player-yellow"].familyMembers, supply: state.players["player-yellow"].familyMembers.supply - 1 } } } };
    state = choose(choose(start(state), "parliament.selectLaw"), "parliament.choosePolicy");
    state = castCash(state, "for", 5);
    while (state.pendingDecision.step === "parliament.vote") state = pass(state);
    if (state.pendingDecision.step === "parliament.continueVoting") state = resolveVote(state);

    expect(passedLawIds(state)).toContain("envoy-to-china");
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "hiring.hireOffice", actor: "player-blue", phase: "parliament" }));
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "hiring.hireOffice");
    expect(state.company.offices["superintendent-of-trade-in-china"]).toEqual(
      expect.objectContaining({ holder: "player-yellow", vacant: false, created: true }),
    );
    expect(state.phase).toBe("upkeep");
  });
});
