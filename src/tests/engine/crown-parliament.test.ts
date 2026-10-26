import { crownPolicyFor } from "../../engine/crown/registry";
import { describe, expect, it } from "vitest";
import { crownAiCards, enterpriseDecks, lawsById, prizes } from "../../data";
import {
  crownFavorOffers,
  type CrownClimate,
  type GameState,
  type LegalCommand,
  type PendingDecision,
} from "../../engine";
import { crownizeDecision } from "../../engine/crown/policy";
import { parliamentCrown, crownVoteOn, crownVotingPlan, policyCrownTotal } from "../../engine/crown/areas/parliament";
import {
  crownTreasuryVotes,
  payWithRoyalPrivilege,
  rollClimateShift,
  soloFailureAdjustment,
} from "../../engine/crown/areas/parliament-rules";
import { validateTransfer } from "../../engine/phases/negotiation";
import { refreshParliamentDecision } from "../../engine/phases/parliament";
import { act, command, crownPlays, playUntil, startedCrownGame, TWO_PLAYERS } from "../fixtures/crown";

// The Crown in Parliament, the Vote to Deregulate, Upkeep, Final Scoring and negotiation (Handbook
// pp.2, 14-16).

const CLIMATES: CrownClimate[] = ["bull", "stag", "lion", "bear", "peacock"];
const ANN = "player-ann";

/** A solo game at the start of Parliament, turn 1, with the Crown as Prime Minister. */
const atParliament = playUntil(
  startedCrownGame({ seed: "d-test-1" }),
  (state) => state.phase === "parliament" && state.pendingDecision.step === "parliament.confirm",
  { maxSteps: 900 },
);

function patchPlayer(state: GameState, playerId: string, patch: Partial<GameState["players"][string]>): GameState {
  return { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], ...patch } } };
}

function inClimate(state: GameState, climate: CrownClimate): GameState {
  return { ...state, crown: { ...state.crown!, climate } };
}

function withPrimeMinister(state: GameState, playerId: string): GameState {
  return { ...state, parliament: { ...state.parliament, primeMinister: playerId } };
}

function withLawsOnTop(state: GameState, lawIds: string[]): GameState {
  const rest = state.parliament.lawDeck.drawPile.filter((lawId) => !lawIds.includes(lawId));
  return { ...state, parliament: { ...state.parliament, lawDeck: { ...state.parliament.lawDeck, drawPile: [...lawIds, ...rest] } } };
}

function withSplaySlot(state: GameState, slot: "left" | "middle" | "right"): GameState {
  const card = crownAiCards.find((candidate) => candidate.splaySlot === slot)!;
  const others = crownAiCards.map((candidate) => candidate.id).filter((id) => id !== card.id);
  return { ...state, crown: { ...state.crown!, faceupAiCard: card.id, aiDeck: { drawPile: others, discardPile: [], removed: [] } } };
}

const workshopCard = enterpriseDecks.flatMap((deck) => deck.cards).find((card) => card.parliamentVotes > 0)!;

function enterpriseOf(type: "workshop" | "luxury" | "shipyard", id: string) {
  return { id, type, cardId: workshopCard.id };
}

/** A decision as a phase would build it, for testing a policy on its own. */
function decisionOf(step: string, actor: string, legalCommands: LegalCommand[]): PendingDecision {
  return { id: `decision-${step}`, phase: "parliament", step, actor, visibility: "public", prompt: "", legalCommands, canSave: true };
}

function policy(step: string) {
  return parliamentCrown.policies[step];
}

describe("treasury votes (Handbook p.14)", () => {
  it.each([
    [0, 0], [3, 0], [4, 1], [6, 1], [7, 2], [10, 2], [11, 3], [14, 3], [15, 4], [40, 4],
  ])("£%i gives %i bonus votes", (cash, votes) => {
    expect(crownTreasuryVotes(cash)).toBe(votes);
  });
});

describe("the Voting Plan (Handbook p.16)", () => {
  const game = withPrimeMinister(atParliament, "crown");
  const human = withPrimeMinister(atParliament, ANN);

  it("has a row for every law in the draw deck", () => {
    for (const law of lawsById.values()) {
      if (law.kind === "specialSession") continue;
      expect(crownVotingPlan[law.id], law.name).toBeDefined();
    }
  });

  const climateRows: Array<[string, CrownClimate[]]> = [
    ["army-spending", ["bear", "peacock"]],
    ["company-aids-government", ["bear", "peacock"]],
    ["debt-restructure", ["bull", "stag"]],
    ["envoy-to-china", ["lion", "bear", "peacock"]],
    ["industry-subsidy", ["lion", "bear", "peacock"]],
    ["sepoy-recruitment", ["lion", "bear", "peacock"]],
    ["ship-subsidy", ["bull", "stag", "lion"]],
    ["trade-regulations", ["bear", "peacock"]],
    ["treasure-reform", ["bull", "stag"]],
    ["window-tax-repeal", ["peacock"]],
    ["writer-graft-reform", ["bull"]],
  ];
  it.each(climateRows)("%s: for in %j, against otherwise", (lawId, forClimates) => {
    for (const climate of CLIMATES) {
      expect(crownVoteOn(inClimate(game, climate), lawId)?.vote, `${lawId} in ${climate}`).toBe(forClimates.includes(climate) ? "for" : "against");
    }
  });

  it.each(["board-of-control", "military-oversight", "public-demands-impeachment", "war-against-france"])(
    "%s: for if the Crown is Prime Minister, otherwise against",
    (lawId) => {
      expect(crownVoteOn(game, lawId)?.vote).toBe("for");
      expect(crownVoteOn(human, lawId)?.vote).toBe("against");
    },
  );

  it("Governor General: for if the Crown is Director of Trade", () => {
    const office = (holder: string | undefined) => ({
      ...game,
      company: { ...game.company, offices: { ...game.company.offices, "director-of-trade": { ...game.company.offices["director-of-trade"], holder, vacant: !holder } } },
    });
    expect(crownVoteOn(office("crown"), "governor-general")?.vote).toBe("for");
    expect(crownVoteOn(office(ANN), "governor-general")?.vote).toBe("against");
    expect(crownVoteOn(office(undefined), "governor-general")?.vote).toBe("against");
  });

  it("Tenure Limits: for, unless the Crown is Chairman", () => {
    const chairman = (holder: string) => ({
      ...game,
      company: { ...game.company, offices: { ...game.company.offices, chairman: { ...game.company.offices.chairman, holder, vacant: false } } },
    });
    expect(crownVoteOn(chairman(ANN), "tenure-limits")?.vote).toBe("for");
    expect(crownVoteOn(chairman("crown"), "tenure-limits")?.vote).toBe("against");
  });

  /** Gives the Crown and Ann the stated holdings and asks about a "most" row. */
  function mostRow(lawId: string, setup: (crown: number, ann: number) => GameState, expectation: { forMost: "for" | "against" }) {
    const other = expectation.forMost === "for" ? "against" : "for";
    expect(crownVoteOn(setup(2, 1), lawId)?.vote, "more than Ann").toBe(expectation.forMost);
    expect(crownVoteOn(setup(1, 1), lawId)?.vote, "a tie counts as most").toBe(expectation.forMost);
    expect(crownVoteOn(setup(1, 2), lawId)?.vote, "fewer than Ann").toBe(other);
    expect(crownVoteOn(setup(0, 0), lawId)?.vote, "most needs at least one").toBe(other);
  }

  const enterprises = (type: "workshop" | "luxury") => (crown: number, ann: number) =>
    patchPlayer(
      patchPlayer(game, "crown", { enterprises: Array.from({ length: crown }, (_, index) => enterpriseOf(type, `c-${index}`)) }),
      ANN,
      { enterprises: Array.from({ length: ann }, (_, index) => enterpriseOf(type, `a-${index}`)) },
    );

  it("Calico Acts: for if the Crown has the most workshops", () => {
    mostRow("calico-acts", enterprises("workshop"), { forMost: "for" });
  });

  it("Royal Protection: for if the Crown has the most luxuries", () => {
    mostRow("royal-protection", enterprises("luxury"), { forMost: "for" });
  });

  it("Inclosure Acts: for if the Crown has the most prizes", () => {
    const prizeId = prizes.find((prize) => prize.upkeep > 0)!.id;
    const setup = (crown: number, ann: number) => {
      const withCrown = patchPlayer(game, "crown", { familyMembers: { ...game.players.crown.familyMembers, prizes: { [prizeId]: crown } } });
      return patchPlayer(withCrown, ANN, { familyMembers: { ...game.players[ANN].familyMembers, prizes: { [prizeId]: ann } } });
    };
    mostRow("inclosure-acts", setup, { forMost: "for" });
  });

  it("Masses Demand Franchise!: for, unless the Crown has the most Rotten Boroughs", () => {
    const borough = (index: number) => ({ id: `rb-${index}`, cardId: "rotten-borough-1" });
    const setup = (crown: number, ann: number) =>
      patchPlayer(patchPlayer(game, "crown", { prestigeCards: Array.from({ length: crown }, (_, i) => borough(i)) }), ANN, {
        prestigeCards: Array.from({ length: ann }, (_, i) => borough(i + 10)),
      });
    mostRow("masses-demand-franchise", setup, { forMost: "against" });
  });

  it("Writer Privileges: for if the Crown has the most writers currently on orders", () => {
    const setup = (crown: number, ann: number) => {
      const orders = Object.values(game.india.regions).flatMap((region) => region.orders.map((order) => ({ regionId: region.id, order })));
      const placed = new Map<string, string>();
      orders.slice(0, crown).forEach(({ order }) => placed.set(order.id, "crown"));
      orders.slice(crown, crown + ann).forEach(({ order }) => placed.set(order.id, ANN));
      const regions = Object.fromEntries(
        Object.entries(game.india.regions).map(([regionId, region]) => [
          regionId,
          { ...region, orders: region.orders.map((order) => ({ ...order, writer: placed.has(order.id) ? { playerId: placed.get(order.id)!, presidency: "Bombay" as const } : undefined })) },
        ]),
      );
      return { ...game, india: { ...game.india, regions } };
    };
    mostRow("writer-privileges", setup, { forMost: "for" });
  });

  it("Zamindar Taxes: for if the Crown has the most Governors", () => {
    const setup = (crown: number, ann: number) => {
      const governors = ["governor-bengal", "governor-delhi", "governor-bombay"];
      const offices = { ...game.company.offices };
      for (const officeId of governors) offices[officeId] = { ...offices[officeId], id: officeId, holder: undefined, vacant: true };
      governors.slice(0, crown).forEach((officeId) => (offices[officeId] = { ...offices[officeId], holder: "crown", vacant: false }));
      governors.slice(crown, crown + ann).forEach((officeId) => (offices[officeId] = { ...offices[officeId], holder: ANN, vacant: false }));
      return { ...game, company: { ...game.company, offices } };
    };
    mostRow("zamindar-taxes", setup, { forMost: "for" });
  });

  it("Relief Demanded for Indian Famine!: for, unless the Crown has the most of the policy's target", () => {
    // Policy space 0 is "Power: manufacturing", so workshops are the given policy.
    const setup = (crown: number, ann: number) => {
      const withEnterprises = enterprises("workshop")(crown, ann);
      return { ...withEnterprises, parliament: { ...withEnterprises.parliament, session: { ...(withEnterprises.parliament.session ?? emptySession()), policySpace: 0 } } };
    };
    mostRow("relief-demanded-for-indian-famine", setup, { forMost: "against" });
  });

  it("Old Ideas Made New! is never voted on", () => {
    expect(crownVoteOn(game, "old-ideas-made-new")).toBeUndefined();
  });
});

function emptySession() {
  return {
    stage: "voting" as const,
    drawn: [],
    oldIdeasMadeNew: false,
    startingSupport: 0,
    extraWindowTax: false,
    taxCollectorsOffered: [],
    votingOrder: [],
    voterIndex: 0,
    round: 0,
    votesThisRound: 0,
    votes: {},
    opposition: [],
    creditTo: {},
    borrowedEnterprises: {},
    usedCards: [],
    queue: [],
  };
}

describe("a Crown Prime Minister choosing a law (Handbook p.15)", () => {
  const laws = ["army-spending", "ship-subsidy", "trade-regulations"];
  const start = (slot: "left" | "middle" | "right") =>
    act(withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, "crown"), slot), laws), 0);

  it.each([
    ["left", 1],
    ["middle", 2],
    ["right", 3],
  ] as const)("draws %s -> %i law(s) and brings the last one drawn", (slot, count) => {
    const state = crownPlays(start(slot));
    const session = state.parliament.session!;
    expect(session.drawn).toEqual(laws.slice(0, count));
    expect(session.lawId).toBe(laws[count - 1]);
    // The other cards drawn go to the discards.
    expect(state.parliament.lawDeck.discardPile.slice(-(count - 1) || undefined)).toEqual(count === 1 ? expect.anything() : laws.slice(0, count - 1));
  });

  it("stops drawing at a Dilemma and brings it before Parliament", () => {
    const state = crownPlays(act(withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, "crown"), "right"), ["army-spending", "war-against-france", "ship-subsidy"]), 0));
    expect(state.parliament.session!.drawn).toEqual(["army-spending", "war-against-france"]);
    expect(state.parliament.session!.lawId).toBe("war-against-france");
  });

  it("offers the two -2 favours while it draws, and they change the number of laws", () => {
    let state = act(withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, "crown"), "middle"), laws), 0);
    // After the first draw the Crown still wants a second law: "stops drawing" is on offer, "skips" is not.
    expect(state.pendingDecision.step).toBe("parliament.chooseLaw");
    expect(state.pendingDecision.legalCommands.map((legal) => legal.type)).toEqual(["parliament.drawLaw"]);
    const offers = crownFavorOffers(state, ANN).map((offer) => offer.favorId);
    expect(offers).toContain("parliament.stopDrawing");
    expect(offers).not.toContain("parliament.skipLaw");
    const cubes = state.crown!.promiseCubes.byHumanPlayer[ANN];
    state = command(state, ANN, "crown.favor", { favorId: "parliament.stopDrawing" });
    expect(state.pendingDecision.legalCommands.map((legal) => (legal.payload as { lawId?: string }).lawId)).toEqual(["army-spending"]);
    expect(state.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(cubes - 2);

    // From the left slot, the Crown would take the first law; "skips" makes it take the third.
    let skip = act(withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, "crown"), "left"), laws), 0);
    expect(skip.pendingDecision.legalCommands.map((legal) => legal.type)).toEqual(["parliament.selectLaw"]);
    expect(crownFavorOffers(skip, ANN).map((offer) => offer.favorId)).toContain("parliament.skipLaw");
    skip = command(skip, ANN, "crown.favor", { favorId: "parliament.skipLaw" });
    expect(skip.pendingDecision.legalCommands.map((legal) => legal.type)).toEqual(["parliament.drawLaw"]);
    skip = crownPlays(skip);
    expect(skip.parliament.session!.lawId).toBe("trade-regulations");
  });
});

describe("climate shift (Handbook p.15)", () => {
  /** Independent statement of the four shifts, applied one after the other. */
  function expected(climate: CrownClimate, standing: number, successes: number, bad: number): CrownClimate {
    let index = CLIMATES.indexOf(climate);
    const move = (by: number) => (index = Math.max(0, Math.min(4, index + by)));
    if (successes >= standing) move(1);
    if (successes > standing) move(1);
    if (bad <= standing) move(-1);
    if (bad < standing) move(-1);
    return CLIMATES[index];
  }

  it("rolls 6 dice, counts the faces like any check, and shifts by the four rules", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      for (const standing of [0, 1, 3, 5, 7]) {
        for (const climate of ["bull", "lion", "peacock"] as const) {
          const base = { ...inClimate(atParliament, climate), rng: { ...atParliament.rng, seed: `shift-${seed}`, counter: 0, internalState: atParliament.rng.internalState.map((value, i) => (value + seed * (i + 1)) >>> 0) as [number, number, number, number] } };
          const state = { ...base, company: { ...base.company, standing } };
          const shift = rollClimateShift(state);
          expect(shift.roll.values).toHaveLength(6);
          expect(shift.roll.values.every((value) => value >= 1 && value <= 6)).toBe(true);
          const successes = shift.roll.values.filter((value) => value <= 2).length;
          const catastrophes = shift.roll.values.filter((value) => value >= 5).length;
          expect([shift.successes, shift.catastrophes]).toEqual([successes, catastrophes]);
          expect(shift.successes + shift.failures + shift.catastrophes).toBe(6);
          expect(shift.state.crown!.climate).toBe(expected(climate, standing, successes, 6 - successes));
          seen.add(`${standing}:${shift.state.crown!.climate === climate ? "same" : "moved"}`);
        }
      }
    }
    // Standing 0 (failure) always moves right at least once; the sample reaches both outcomes elsewhere.
    expect(seen.size).toBeGreaterThan(4);
  });

  it("happens once the law and policy are chosen and before the Crown votes, whoever is Prime Minister", () => {
    for (const pm of ["crown", ANN]) {
      let state = crownPlays(act(withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, pm), "left"), ["army-spending"]), 0));
      while (state.pendingDecision.step !== "parliament.vote" && state.pendingDecision.actor !== "crown") {
        state = crownPlays(act(state, state.pendingDecision.legalCommands[0]));
      }
      const rolled = state.log.filter((entry) => entry.rngRolls?.some((roll) => roll.label === "parliament.climateShift"));
      expect(rolled, `PM ${pm}`).toHaveLength(1);
      expect(rolled[0].summary).toMatch(/Climate shift: the Crown rolled/);
      const firstVote = state.log.findIndex((entry) => entry.type === "parliament.votesCast");
      expect(firstVote === -1 || state.log.indexOf(rolled[0]) < firstVote).toBe(true);
    }
  });
});

describe("voting (Handbook pp.14, 16)", () => {
  function voteState(options: { law: string; climate: CrownClimate; cash: number; pm?: string }) {
    let state = withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, options.pm ?? "crown"), "left"), [options.law]);
    state = patchPlayer(state, "crown", { cash: options.cash, enterprises: [enterpriseOf("workshop", "w-1"), enterpriseOf("luxury", "w-2")] });
    state = act(state, 0);
    state = crownPlays(state);
    // Walk to the vote (the soloist picks any policy option), fixing the climate after the shift.
    for (let guard = 0; guard < 20 && state.pendingDecision.step !== "parliament.vote"; guard += 1) {
      state = crownPlays(act(state, state.pendingDecision.legalCommands[0]));
    }
    return state;
  }

  it("the Crown votes first, with every enterprise's votes, then the treasury's bonus votes, then passes", () => {
    let state = voteState({ law: "army-spending", climate: "bear", cash: 8 });
    // Army Spending: for in Bear/Peacock, against otherwise; follow whatever the climate shift left it at.
    const climate = state.crown!.climate;
    const direction = ["bear", "peacock"].includes(climate) ? "for" : "against";
    const entries = state.log.filter((entry) => entry.type === "parliament.votesCast");
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.every((entry) => entry.actor === "crown")).toBe(true);
    expect(entries.every((entry) => entry.summary.includes(`${direction} the law`))).toBe(true);
    // 2 enterprises + the treasury's +2 bonus (£8) = three casts, all before Ann.
    expect(entries).toHaveLength(3);
    expect(entries.at(-1)!.summary).toMatch(/cast 2 votes/);
    expect(state.pendingDecision.actor).toBe(ANN);
    expect(state.pendingDecision.step).toBe("parliament.vote");
  });

  it("the Crown pays no cash for votes and may vote against its own law as Prime Minister", () => {
    const state = voteState({ law: "ship-subsidy", climate: "peacock", cash: 20 });
    expect(state.players.crown.cash).toBe(20);
    expect(state.parliament.primeMinister).toBe("crown");
    const climate = state.crown!.climate;
    const entries = state.log.filter((entry) => entry.type === "parliament.votesCast");
    const against = !["bull", "stag", "lion"].includes(climate);
    expect(entries.every((entry) => entry.summary.includes(against ? "against the law" : "for the law"))).toBe(true);
    if (against) expect(state.parliament.oppositionLeader).toBe("crown");
  });
});

describe("policy marker movement (Handbook p.15)", () => {
  const choosePolicy = policy("parliament.choosePolicy");

  it("counts the net entities of the target, negated for a tax, and takes the highest Crown total", () => {
    // Policy 1 is Tax: Company shares; 3 is Tax & Window Tax: social. Crown with two luxuries, Ann with none.
    const game = patchPlayer(withPrimeMinister(atParliament, "crown"), "crown", { enterprises: [enterpriseOf("luxury", "l-1"), enterpriseOf("luxury", "l-2")] });
    const noShares = { ...game, company: { ...game.company, court: game.company.court.map((share) => ({ ...share, owner: undefined })) } };
    expect(policyCrownTotal(noShares, 3)).toBe(-2); // tax on the Crown's two luxuries, no window icons
    expect(policyCrownTotal(noShares, 5)).toBe(0); // bonus: manufacturing
    expect(policyCrownTotal(patchPlayer(noShares, ANN, { enterprises: [enterpriseOf("luxury", "a-1")] }), 3)).toBe(-1);
    expect(policyCrownTotal(patchPlayer(noShares, ANN, { enterprises: [enterpriseOf("luxury", "a-1"), enterpriseOf("luxury", "a-2"), enterpriseOf("luxury", "a-3")] }), 3)).toBe(1);
  });

  it("breaks ties with the AI card's arrows", () => {
    const state = withPrimeMinister(
      { ...atParliament, parliament: { ...atParliament.parliament, policyDialPosition: 0, session: { ...emptySession(), stage: "choosePolicy", lawId: "army-spending" } } },
      "crown",
    );
    const options = [
      { type: "parliament.choosePolicy", label: "a", payload: { space: 1 } },
      { type: "parliament.choosePolicy", label: "b", payload: { space: 13 } },
    ];
    const choice = choosePolicy(state, decisionOf("parliament.choosePolicy", "crown", options));
    expect(choice?.commands).toHaveLength(1);
    expect(choice!.reason).toMatch(/highest Crown total/);
  });
});

describe("law-specific choices in the Voting Plan", () => {
  const game = withPrimeMinister(atParliament, "crown");

  it("Public Demands Impeachment!: the first player office on the ribbon, else at random", () => {
    const offices = { ...game.company.offices };
    for (const officeId of Object.keys(offices)) offices[officeId] = { ...offices[officeId], holder: undefined, vacant: true };
    offices["director-of-trade"] = { ...offices["director-of-trade"], holder: "crown", vacant: false };
    offices["manager-of-shipping"] = { ...offices["manager-of-shipping"], holder: ANN, vacant: false };
    offices["president-bengal"] = { ...offices["president-bengal"], holder: ANN, vacant: false };
    const state = { ...game, company: { ...game.company, offices } };
    const decision = decisionOf(
      "parliament.chooseImpeachmentTarget",
      "crown",
      ["director-of-trade", "manager-of-shipping", "president-bengal"].map((officeId) => ({ type: "parliament.chooseImpeachmentTarget", label: officeId, payload: { officeId } })),
    );
    expect(policy("parliament.chooseImpeachmentTarget")(state, decision)?.commands.map((c) => c.payload)).toEqual([{ officeId: "manager-of-shipping" }]);

    const allCrown = { ...state, company: { ...state.company, offices: { ...offices, "manager-of-shipping": { ...offices["manager-of-shipping"], holder: "crown" }, "president-bengal": { ...offices["president-bengal"], holder: "crown" } } } };
    const random = policy("parliament.chooseImpeachmentTarget")(allCrown, decision);
    expect(random?.commands).toHaveLength(1);
    expect(random!.reason).toMatch(/at random/);
  });

  it("War Against France!: player ships, then Company ships, then Crown ships", () => {
    const ships = [
      { id: "s-crown", kind: "player" as const, shipyardCardId: "crown-yard", location: "east-indian" as const, fatigued: false },
      { id: "s-company", kind: "company" as const, location: "east-indian" as const, fatigued: false },
      { id: "s-ann", kind: "player" as const, shipyardCardId: "ann-yard", location: "east-indian" as const, fatigued: false },
    ];
    const state = {
      ...game,
      company: { ...game.company, ships },
      players: {
        ...game.players,
        crown: { ...game.players.crown, enterprises: [{ id: "e-1", type: "shipyard" as const, cardId: "crown-yard" }] },
        [ANN]: { ...game.players[ANN], enterprises: [{ id: "e-2", type: "shipyard" as const, cardId: "ann-yard" }] },
      },
    };
    const commands = ships.map((ship) => ({ type: "parliament.warAgainstFranceShip", label: ship.id, payload: { shipId: ship.id } }));
    const pick = (list: LegalCommand[]) => policy("parliament.warAgainstFranceShip")(state, decisionOf("parliament.warAgainstFranceShip", "crown", list))?.commands.map((c) => (c.payload as { shipId: string }).shipId);
    expect(pick(commands)).toEqual(["s-ann"]);
    expect(pick(commands.filter((c) => (c.payload as { shipId: string }).shipId !== "s-ann"))).toEqual(["s-company"]);
    expect(pick(commands.filter((c) => (c.payload as { shipId: string }).shipId === "s-crown"))).toEqual(["s-crown"]);
  });

  it("War Against France!: player officers, then Company regiments, then Crown officers", () => {
    const pieces: LegalCommand[] = [
      { type: "parliament.warAgainstFrancePiece", label: "crown officer", payload: { army: "Bombay", piece: "officer", owner: "crown" } },
      { type: "parliament.warAgainstFrancePiece", label: "regiment", payload: { army: "Bombay", piece: "regiment" } },
      { type: "parliament.warAgainstFrancePiece", label: "Ann's officer", payload: { army: "Bombay", piece: "officer", owner: ANN } },
    ];
    const pick = (list: LegalCommand[]) => policy("parliament.warAgainstFrancePiece")(game, decisionOf("parliament.warAgainstFrancePiece", "crown", list))?.commands.map((c) => c.label);
    expect(pick(pieces)).toEqual(["Ann's officer"]);
    expect(pick(pieces.slice(0, 2))).toEqual(["regiment"]);
    expect(pick(pieces.slice(0, 1))).toEqual(["crown officer"]);
  });

  it("Old Ideas Made New!: picks a discarded law at random, the same pick every time it is asked", () => {
    const options = ["army-spending", "ship-subsidy", "debt-restructure"].map((lawId) => ({ type: "parliament.selectFromDiscard", label: lawId, payload: { lawId } }));
    const decision = decisionOf("parliament.selectFromDiscard", "crown", options);
    const first = policy("parliament.selectFromDiscard")(game, decision);
    expect(first?.commands).toHaveLength(1);
    expect(policy("parliament.selectFromDiscard")(game, decision)?.commands).toEqual(first?.commands);
  });

  it("Tax Collectors: the Crown doesn't do what a card 'may' do, and gives no consent", () => {
    const optional = decisionOf("parliament.taxCollectors", "crown", [
      { type: "parliament.taxCollectors", label: "yes", payload: { propose: true } },
      { type: "parliament.taxCollectors", label: "no", payload: { propose: false } },
    ]);
    expect(policy("parliament.taxCollectors")(game, optional)?.commands.map((c) => c.payload)).toEqual([{ propose: false }]);
    const consent = decisionOf("parliament.taxCollectorsConsent", "crown", [
      { type: "parliament.taxCollectorsConsent", label: "yes", payload: { accept: true } },
      { type: "parliament.taxCollectorsConsent", label: "no", payload: { accept: false } },
    ]);
    expect(policy("parliament.taxCollectorsConsent")(game, consent)?.commands.map((c) => c.payload)).toEqual([{ accept: false }]);
  });

  it("Power: already highest -> swap the two bottom markers", () => {
    const state = { ...game, company: { ...game.company, powerTrack: { social: 0, companyShare: 2, shipping: 1, manufacturing: 0 } } };
    const pair = (a: string, b: string, label: string) => ({ type: "parliament.choosePowerSwap", label, payload: { targets: [a, b] } });
    const decision = decisionOf("parliament.choosePowerSwap", "crown", [pair("social", "shipping", "x"), pair("social", "manufacturing", "bottom"), pair("shipping", "manufacturing", "z")]);
    expect(policy("parliament.choosePowerSwap")(state, decision)?.commands.map((c) => c.label)).toEqual(["bottom"]);
  });
});

describe("Board of Control and Military Oversight (Voting Plan)", () => {
  const game = withPrimeMinister(atParliament, "crown");
  const interrupt = (payload: unknown) => ({ type: "companyOperation.interrupt", label: "", payload });

  it("Board of Control: removes a player from office at the first opportunity, never its own officeholder", () => {
    const decision = decisionOf("companyOperation.boardOfControl", "crown", [
      interrupt({ action: "boardOfControl", remove: false }),
      interrupt({ action: "boardOfControl", remove: true }),
    ]);
    const on = (holder: string) => ({
      ...game,
      company: { ...game.company, offices: { ...game.company.offices, "director-of-trade": { ...game.company.offices["director-of-trade"], holder, vacant: false } } },
      companyOperation: { turn: game.turn, interrupt: { kind: "boardOfControl" as const, officeId: "director-of-trade" } },
    });
    expect(policy("companyOperation.boardOfControl")(on(ANN), decision)?.commands.map((c) => c.payload)).toEqual([{ action: "boardOfControl", remove: true }]);
    expect(policy("companyOperation.boardOfControl")(on("crown"), decision)?.commands.map((c) => c.payload)).toEqual([{ action: "boardOfControl", remove: false }]);
  });

  it("Military Oversight: demotes a non-Crown Commander where it has an officer, then appoints its own", () => {
    const armies = { ...game.company.armies };
    armies.Bombay = { ...armies.Bombay, commander: ANN, officers: { ...armies.Bombay.officers, crown: { ready: 1, exhausted: 0 } } };
    armies.Madras = { ...armies.Madras, commander: ANN, officers: { ...armies.Madras.officers, crown: { ready: 0, exhausted: 0 } } };
    const state = { ...game, company: { ...game.company, armies } };
    const demote = decisionOf("companyOperation.militaryOversight", "crown", [
      interrupt({ action: "oversightDecline" }),
      interrupt({ action: "oversightDemote", army: "Bombay" }),
      interrupt({ action: "oversightDemote", army: "Madras" }),
    ]);
    expect(policy("companyOperation.militaryOversight")(state, demote)?.commands.map((c) => c.payload)).toEqual([{ action: "oversightDemote", army: "Bombay" }]);

    const noOfficer = { ...state, company: { ...state.company, armies: { ...armies, Bombay: { ...armies.Bombay, officers: { ...armies.Bombay.officers, crown: { ready: 0, exhausted: 0 } } } } } };
    expect(policy("companyOperation.militaryOversight")(noOfficer, demote)?.commands.map((c) => c.payload)).toEqual([{ action: "oversightDecline" }]);

    const appoint = decisionOf("companyOperation.militaryOversight", "crown", [
      interrupt({ action: "oversightAppoint", army: "Bombay", playerId: ANN }),
      interrupt({ action: "oversightAppoint", army: "Bombay", playerId: "crown" }),
    ]);
    expect(policy("companyOperation.militaryOversight")(state, appoint)?.commands.map((c) => c.payload)).toEqual([{ action: "oversightAppoint", army: "Bombay", playerId: "crown" }]);
  });
});

describe("the Vote to Deregulate (Handbook p.2)", () => {
  const long = playUntil(
    startedCrownGame({ seed: "d-dereg-1", scenario: "long-1710" }),
    (state) => state.phase === "parliament" && state.pendingDecision.step === "parliament.confirm",
    { maxSteps: 900 },
  );

  it("never initiates the vote unless it must", () => {
    const decision = decisionOf("parliament.deregulationCall", "crown", [
      { type: "parliament.deregulationCall", label: "call", payload: { call: true } },
      { type: "parliament.deregulationCall", label: "don't", payload: { call: false } },
    ]);
    expect(policy("parliament.deregulationCall")(long, decision)?.commands.map((c) => c.payload)).toEqual([{ call: false }]);
    // When it must there is only one option, so the Crown simply takes it.
    const mustCall = decisionOf("parliament.deregulationCall", "crown", [decision.legalCommands[0]]);
    expect(policy("parliament.deregulationCall")(long, mustCall)).toBeUndefined();
  });

  function specialSession(marker: number, climate: CrownClimate, cash: number) {
    let state = withPrimeMinister(inClimate(long, climate), ANN);
    state = patchPlayer(state, "crown", { cash, enterprises: [] });
    return {
      ...state,
      parliament: {
        ...state.parliament,
        voteMarker: marker,
        session: { ...emptySession(), lawId: "deregulation", special: "deregulation" as const },
      },
    };
  }
  const casts = (limit: number): LegalCommand[] => [
    ...Array.from({ length: limit }, (_, index) => ({ type: "parliament.castVotes", label: `${index + 1}`, payload: { direction: "against", source: "cash", votes: index + 1 } })),
    { type: "parliament.passVote", label: "pass", payload: {} },
  ];

  it.each([
    ["bull", 6], ["stag", 5], ["lion", 4], ["bear", 3], ["peacock", 2],
  ] as const)("%s: spends up to £%i, once, only if it moves the marker to failing", (climate, limit) => {
    const vote = policy("parliament.vote");
    const choice = (marker: number) => vote(specialSession(marker, climate, 30), decisionOf("parliament.vote", "crown", casts(limit)))?.commands.map((c) => c.payload);
    expect(choice(limit - 1)).toEqual([{ direction: "against", source: "cash", votes: limit }]); // marker + 1 votes tip it below 0
    expect(choice(0)).toEqual([{ direction: "against", source: "cash", votes: 1 }]);
    expect(choice(limit)).toEqual([{}]); // would need more than the limit: pass
    expect(choice(-1)).toEqual([{}]); // already failing: pass
  });
});

describe("Royal Privilege (Handbook p.15)", () => {
  const game = atParliament;
  const rich = { ...game, company: { ...game.company, balance: 8, debt: 2 } };

  it("pays from the Crown's own treasury when it can", () => {
    const paid = payWithRoyalPrivilege(patchPlayer(rich, "crown", { cash: 5 }), 3, "in tax");
    expect(paid.state.players.crown.cash).toBe(2);
    expect(paid.state.company.balance).toBe(8);
    expect(paid.loans).toBe(0);
  });

  it("then uses the Company treasury", () => {
    const paid = payWithRoyalPrivilege(patchPlayer(rich, "crown", { cash: 2 }), 6, "in tax");
    expect(paid.state.players.crown.cash).toBe(0);
    expect(paid.state.company.balance).toBe(4);
    expect(paid.state.company.debt).toBe(2);
    expect(paid.note).toMatch(/Royal Privilege/);
  });

  it("then takes emergency loans, which can fail the Company", () => {
    const poor = { ...patchPlayer(rich, "crown", { cash: 1 }), company: { ...rich.company, balance: 2, standing: 1 } };
    const paid = payWithRoyalPrivilege(poor, 10, "in family expenses");
    // £1 own + £2 Balance + £7 more: two loans (£5 each) leave £3 in the Balance.
    expect(paid.loans).toBe(2);
    expect(paid.state.players.crown.cash).toBe(0);
    expect(paid.state.company.balance).toBe(3);
    expect(paid.state.company.debt).toBe(4);
    expect(paid.state.company.standing).toBe(0);
    expect(paid.state.company.failed).toBe(true);
  });

  it("three or more loans cost two Standing", () => {
    const poor = { ...patchPlayer(rich, "crown", { cash: 0 }), company: { ...rich.company, balance: 0, standing: 5 } };
    const paid = payWithRoyalPrivilege(poor, 12, "in tax");
    expect(paid.loans).toBe(3);
    expect(paid.state.company.standing).toBe(3);
    expect(paid.state.company.failed).toBe(false);
  });
});

describe("Royal Privilege in a tax", () => {
  it("the Crown pays a tax it can't afford from the Company treasury instead of returning a share", () => {
    const crownShares = atParliament.company.court.filter((share) => share.owner === "crown").length + (atParliament.company.offices.chairman.holder === "crown" ? 1 : 0);
    expect(crownShares).toBeGreaterThan(1);
    const state = {
      ...patchPlayer(atParliament, "crown", { cash: 0 }),
      company: { ...atParliament.company, balance: 20 },
      parliament: {
        ...atParliament.parliament,
        session: { ...emptySession(), stage: "resolving" as const, queue: [{ kind: "tax" as const, target: "companyShare" as const, players: ["crown"] }, { kind: "finish" as const }] },
      },
    };
    const after = refreshParliamentDecision(state);
    expect(after.players.crown.cash).toBe(0);
    expect(after.company.balance).toBe(20 - crownShares);
    expect(after.company.court.filter((share) => share.owner === "crown").length).toBe(state.company.court.filter((share) => share.owner === "crown").length);
    expect(after.pendingDecision.step).not.toBe("parliament.surrender");
  });
});

describe("Upkeep (Handbook p.15)", () => {
  it("the Crown pays family expenses with Royal Privilege rather than give up prizes, and a failed Company goes to Final Scoring", () => {
    const prize = prizes.find((candidate) => candidate.upkeep > 0)!;
    let state = playUntil(startedCrownGame({ seed: "d-test-1" }), (s) => s.phase === "upkeep", { maxSteps: 900 });
    state = patchPlayer(state, "crown", { cash: 0, familyMembers: { ...state.players.crown.familyMembers, supply: state.players.crown.familyMembers.supply - 1, prizes: { [prize.id]: 1 } } });
    state = { ...state, company: { ...state.company, balance: 1, standing: 1 } };
    const before = state.players.crown.familyMembers.prizes[prize.id];
    state = act(state, 0);
    expect(state.players.crown.familyMembers.prizes[prize.id]).toBe(before);
    expect(state.players.crown.cash).toBe(0);
    expect(state.log.some((entry) => /Royal Privilege/.test(entry.summary))).toBe(true);
    expect(state.company.balance).toBeGreaterThanOrEqual(0);
    if (state.company.failed) expect(state.pendingDecision.step).toBe("finalScoring.confirm");
  });
});

describe("Game End [SOLO] (Handbook p.15)", () => {
  it.each([
    ["1710", [-5, -4, -3, -2, -1, 0, 0, 0]],
    ["long-1710", [-5, -4, -3, -2, -1, 0, 0, 0, 0, 0]],
    ["1758", [0, 0, -5, -4, -3, -2, -1, 0]],
    ["1813", [0, 0, 0, 0, -4, -3, -2, -1]],
  ])("%s: the soloist's failure adjustment by turn", (scenario, row) => {
    row.forEach((adjustment, index) => expect(soloFailureAdjustment(scenario, index + 1), `turn ${index + 1}`).toBe(adjustment));
  });

  it("awards the Power Award to first place only, and adjusts the soloist after a failure", () => {
    const base = playUntil(startedCrownGame({ seed: "d-test-1" }), (s) => s.phase === "parliament", { maxSteps: 900 });
    let state: GameState = { ...base, company: { ...base.company, failed: true, standing: 0 }, turn: 2 };
    state = { ...state, pendingDecision: { ...state.pendingDecision, phase: "finalScoring", step: "finalScoring.confirm", actor: "system", legalCommands: [{ type: "finalScoring.confirm", label: "go", payload: {} }] }, phase: "finalScoring" };
    state = act(state, 0);
    state = playUntil(state, (s) => s.finalScoring.complete === true, { maxSteps: 300 });
    const result = state.finalScoring.players![ANN];
    expect(result.entries.some((entry) => /Company failed on turn 2/.test(entry.label) && entry.victoryPoints === -4)).toBe(true);
    const awards = Object.values(state.finalScoring.players!).flatMap((player) => player.entries.filter((entry) => entry.label.startsWith("Power Award")));
    expect(awards.every((entry) => /most power/.test(entry.label) && !/second/.test(entry.label))).toBe(true);
  });
});

describe("negotiation with the Crown (Handbook p.2)", () => {
  it("players can't give the Crown items or take items from it, but cubes pass between two players", () => {
    expect(validateTransfer(atParliament, ANN, "crown", [{ kind: "cash", amount: 1 }]).map((error) => error.message).join(" ")).toMatch(/Crown makes no deals/);
    expect(validateTransfer(atParliament, "crown", ANN, [{ kind: "cash", amount: 1 }]).length).toBeGreaterThan(0);
    const two = playUntil(startedCrownGame({ players: 2, seed: "d-two-1" }), (s) => s.phase === "family", { maxSteps: 50 });
    const [ann, ben] = TWO_PLAYERS.map((player) => two.seatingOrder.find((id) => two.players[id].name === player.name)!);
    expect(validateTransfer(two, ann, ben, [{ kind: "cash", amount: 1 }])).toEqual([]);
  });

  const consent = (kind: string, context: unknown) => {
    const request = { id: "consent-1", kind, requestedBy: ANN, askOrder: ["crown"], answers: {}, prompt: "?", context };
    const state = { ...atParliament, negotiation: { ...atParliament.negotiation, interrupts: [{ id: "consent-1", kind: "consent" as const, request, savedDecision: atParliament.pendingDecision }] } };
    const decision = decisionOf("negotiation.consent", "crown", [
      { type: "negotiation.respondToConsent", label: "Consent", payload: { requestId: "consent-1", accept: true } },
      { type: "negotiation.respondToConsent", label: "Refuse", payload: { requestId: "consent-1", accept: false } },
    ]);
    // The consent policy is area A's (one policy per step); Parliament relies on it.
    return crownPolicyFor("negotiation.consent")!({ ...state, pendingDecision: decision }, decision)?.commands.map((c) => (c.payload as { accept: boolean }).accept);
  };

  it("gives no consent, except to dissolving and merging firms", () => {
    expect(consent("negotiation.trade", {})).toEqual([false]);
    expect(consent("parliament.coalition", {})).toEqual([false]);
    expect(consent("firms.action", { kind: "takeOver" })).toEqual([false]);
    expect(consent("firms.action", { kind: "dissolve" })).toEqual([true]);
    expect(consent("firms.action", { kind: "merge" })).toEqual([true]);
  });

  it("never plays its blackmail cards or reacts to a play", () => {
    const reaction = decisionOf("negotiation.blackmailReaction", "crown", [
      { type: "negotiation.respondToBlackmail", label: "cancel", payload: { playId: "p", cancel: true } },
      { type: "negotiation.respondToBlackmail", label: "let it", payload: { playId: "p", cancel: false } },
    ]);
    expect(policy("negotiation.blackmailReaction")(atParliament, reaction)?.commands.map((c) => c.payload)).toEqual([{ playId: "p", cancel: false }]);
    const connection = decisionOf("companyOperation.connection", "crown", [
      { type: "companyOperation.interrupt", label: "play", payload: { action: "playConnection" } },
      { type: "companyOperation.interrupt", label: "decline", payload: { action: "declineConnection" } },
    ]);
    expect(policy("companyOperation.connection")(atParliament, connection)?.commands.map((c) => c.payload)).toEqual([{ action: "declineConnection" }]);
  });
});

describe("the solo writer cube (Handbook p.15)", () => {
  const detector = parliamentCrown.detectors[0];

  it("gives the soloist a cube at Refresh for writers in a Crown Presidency that filled no order", () => {
    const upkeep = playUntil(startedCrownGame({ seed: "d-test-1" }), (s) => s.phase === "upkeep", { maxSteps: 900 });
    const presidencies = (["Bombay", "Madras", "Bengal"] as const).map((presidency) => ({ presidency, office: `president-${presidency.toLowerCase()}` }));
    const crownPresidency = presidencies[0];
    const offices = { ...upkeep.company.offices, [crownPresidency.office]: { ...upkeep.company.offices[crownPresidency.office], holder: "crown", vacant: false } };
    const before = {
      ...upkeep,
      company: { ...upkeep.company, offices },
      india: {
        ...upkeep.india,
        presidencies: { ...upkeep.india.presidencies, [crownPresidency.presidency]: { ...upkeep.india.presidencies[crownPresidency.presidency], writers: { [ANN]: 1 } } },
      },
    };
    const after = { ...before, turn: before.turn + 1 };
    const found = detector.detect(before, after, { id: "c", gameId: "g", actorId: ANN, decisionId: "d", type: "upkeep.confirm", payload: {}, clientTimestamp: "" });
    // The other two Presidencies' Presidents may also be the Crown: either way a qualifying Presidency exists.
    expect(found).toEqual([{ playerId: ANN, cubes: 1, reason: expect.any(String) }]);
    // No cube when the Refresh doesn't happen (the final turn).
    expect(detector.detect(before, before, { id: "c", gameId: "g", actorId: ANN, decisionId: "d", type: "upkeep.confirm", payload: {}, clientTimestamp: "" })).toEqual([]);
  });
});

describe("crownizeDecision for Parliament steps", () => {
  it("names the climate and the Handbook rule in the reason", () => {
    const state = act(withLawsOnTop(withSplaySlot(withPrimeMinister(atParliament, "crown"), "left"), ["army-spending"]), 0);
    const decided = crownizeDecision(state);
    expect(decided.pendingDecision.crown?.reason).toMatch(/Handbook p\.15/);
    expect(decided.pendingDecision.crown?.reason).toMatch(/Bull|Stag|Lion|Bear|Peacock/);
  });
});
