import { describe, expect, it } from "vitest";
import { blackmailCards, companyFailureCards, prestigeCards } from "../../data";
import {
  createNewGame,
  createRngState,
  playerWindowIcons,
  rollDie,
  type GameState,
  type PlayerId,
} from "../../engine";
import { deserializeGameState, serializeSave } from "../../save";
import { withCash, withCourtShares, withOffice } from "../fixtures/builders";
import {
  applyCommandOrThrow,
  createHotseatGame,
  expectSaveRoundTripPreservesPendingDecision,
} from "../fixtures/game";
import {
  atConfirmation,
  choiceLabelled,
  withBlackmail,
  withDisplay,
  withEnterprises,
  withPensioners,
  withPlayerFields,
  withPrestigeCards,
  withPrizePieces,
} from "../fixtures/london-season";

const RED = "player-red";
const BLUE = "player-blue";
const YELLOW = "player-yellow";

let commandCount = 0;

function choose(state: GameState, labelText: string, actorId?: PlayerId | "system"): GameState {
  const choice = choiceLabelled(state, labelText);
  commandCount += 1;
  return applyCommandOrThrow(state, {
    id: `command-ls-${commandCount}`,
    actorId: actorId ?? (state.pendingDecision.actor as PlayerId),
    type: choice.type,
    payload: choice.payload,
  });
}

function confirm(state: GameState): GameState {
  commandCount += 1;
  const legal = state.pendingDecision.legalCommands[0];
  return applyCommandOrThrow(state, {
    id: `command-ls-${commandCount}`,
    actorId: "system",
    type: legal.type,
    payload: legal.payload ?? {},
  });
}

/** A seed whose first die rolls satisfy `predicate` (labels don't change the values). */
function seedWhere(dice: number, sides: number, predicate: (rolls: number[]) => boolean): string {
  for (let index = 0; index < 5000; index += 1) {
    const seed = `ls-seed-${index}`;
    let rng = createRngState(seed);
    const rolls: number[] = [];
    for (let die = 0; die < dice; die += 1) {
      const roll = rollDie(rng, sides);
      rng = roll.rng;
      rolls.push(roll.value);
    }
    if (predicate(rolls)) return seed;
  }
  throw new Error("No seed found");
}

function londonSeasonGame(seed = "london-season"): GameState {
  const base = createHotseatGame({ seed, gameId: `game-${seed}` });
  return atConfirmation({ ...base, turn: 2 }, "londonSeason", "londonSeason.confirm");
}

describe("London Season (pp.11-12)", () => {
  it("plays the rulebook's attrition and London Display examples (p.11, p.12)", () => {
    // Blue's Manager of Shipping retires; Yellow's Director of Trade (1 fatigue) retires and
    // Yellow's President of Madras (1 fatigue) gains a fatigue. Rolls go in hiring order: Director
    // of Trade, Manager of Shipping, President of Madras.
    const seed = seedWhere(3, 6, ([trade, shipping, madras]) => trade >= 4 && shipping >= 5 && (madras === 2 || madras === 3));
    let state = londonSeasonGame();
    state = withOffice(state, "director-of-trade", YELLOW, { fatigue: 1, inHiringQueue: false });
    state = withOffice(state, "manager-of-shipping", BLUE, { inHiringQueue: false });
    state = withOffice(state, "president-madras", YELLOW, { fatigue: 1, inHiringQueue: false });
    state = withCash(state, { [RED]: 0, [BLUE]: 8, [YELLOW]: 4 });
    state = withDisplay(state, ["company-fraud", "lord-highgate", "foundry"], ["stock-broker", "rotten-borough-1", "shipbuilders", "tax-collectors"]);
    // The Chairman office is vacant, so the former Chairman (Yellow) leads retirements (p.11).
    state = { ...state, rng: createRngState(seed), company: { ...state.company, chairmanMarker: YELLOW } };

    state = confirm(state);

    expect(state.company.offices["director-of-trade"].vacant).toBe(true);
    expect(state.company.offices["manager-of-shipping"].vacant).toBe(true);
    expect(state.company.offices["president-madras"]).toEqual(expect.objectContaining({ holder: YELLOW, fatigue: 2 }));
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "retirement.retirePensioner", actor: YELLOW }));

    // "Yellow goes first and retires to the £4 prize. Blue opts for the £8 prize."
    state = choose(state, "Retire to the £4 prize");
    expect(state.pendingDecision.actor).toBe(BLUE);
    state = choose(state, "Retire to the £8 prize");

    // "Blue spent £8 and Yellow spent £4, and so Blue will go first."
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "londonSeason.choosePrestigeCard", actor: BLUE }));
    expect(state.pendingDecision.legalCommands.map((legal) => legal.label)).toContain("Take face-down blackmail: Company Fraud");
    state = choose(state, "Take Lord Highgate");
    expect(state.pendingDecision.actor).toBe(YELLOW);
    state = choose(state, "Take face-down blackmail: Company Fraud");

    // "The remaining card is discarded and three new cards are placed in the London Season Display."
    expect(state.phase).toBe("family");
    expect(state.londonSeason.display).toEqual(["stock-broker", "rotten-borough-1", "shipbuilders"]);
    expect(state.londonSeason.deck).toEqual(["tax-collectors"]);
    expect(state.londonSeason.discard).toContain("foundry");
    expect(state.players[BLUE]).toEqual(expect.objectContaining({ cash: 0, victoryPoints: 4 + 3 }));
    expect(state.players[BLUE].familyMembers.prizes["prize-8"]).toBe(1);
    expect(state.players[YELLOW]).toEqual(expect.objectContaining({ cash: 0, victoryPoints: 2 }));
    expect(state.players[YELLOW].blackmailCards).toEqual([{ id: "blackmail-company-fraud", cardId: "company-fraud", facedown: true }]);
    expect(state.players[BLUE].familyMembers.pensioners + state.players[YELLOW].familyMembers.pensioners).toBe(0);
  });

  it("saves and loads in the middle of the retirement step", () => {
    let state = withPensioners(withCash(londonSeasonGame(), { [RED]: 4 }), RED, 2);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);
    state = choose(state, "Retire to the £2 prize");

    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "retirement.retirePensioner", actor: RED }));
    expectSaveRoundTripPreservesPendingDecision(state);

    const loaded = deserializeGameState(serializeSave(state, { saveId: "mid-retirement" }));
    expect(loaded.londonSeason.retirement).toEqual(state.londonSeason.retirement);
    const finished = choose(loaded, "Retire to the £2 prize");
    expect(finished.players[RED].familyMembers.prizes["prize-2"]).toBe(2);
    expect(finished.pendingDecision.step).toBe("londonSeason.choosePrestigeCard");
  });

  it("lets a spouse's discount lower a retirement, once per London Season (p.12)", () => {
    let state = withPrestigeCards(withPensioners(withCash(londonSeasonGame(), { [RED]: 2 }), RED, 2), RED, ["lady-glencora"]);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    // £4 with no discount is unaffordable; with Lady Glencora's -£2 it costs £2.
    expect(state.pendingDecision.legalCommands.some((legal) => legal.label.startsWith("Retire to the £4 prize (2 VP, upkeep £1) for £4"))).toBe(false);
    state = choose(state, "Retire to the £4 prize (2 VP, upkeep £1) for £2 using -£2 Lady Glencora");

    // The discount is spent, so the second pensioner can't use it again this season.
    // Red is out of cash: the second pensioner is still offered, in case another player lends
    // Red the money (p.8), with no discounted prize left to pick.
    expect(state.players[RED].cash).toBe(0);
    expect(state.pendingDecision.step).toBe("retirement.retirePensioner");
    expect(state.pendingDecision.legalCommands.map((legal) => legal.type)).toEqual(["retirement.stop"]);
  });

  it("restricts Lord Highgate's family to the 8 and 12 VP prizes", () => {
    let state = withPrestigeCards(withPensioners(withCash(londonSeasonGame(), { [RED]: 20 }), RED, 1), RED, ["lord-highgate"]);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    const prizeIds = state.pendingDecision.legalCommands
      .filter((legal) => legal.type === "retirement.retirePensioner")
      .map((legal) => (legal.payload as { prizeId: string }).prizeId);
    expect(new Set(prizeIds)).toEqual(new Set(["prize-14", "prize-20"]));
  });

  it("lets Letters of Introduction borrow other players' spouse discounts", () => {
    let state = withPensioners(withCash(londonSeasonGame(), { [RED]: 2 }), RED, 1);
    state = withBlackmail(state, RED, ["letters-of-introduction"]);
    state = withPrestigeCards(state, BLUE, ["lady-glencora"]);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    state = choose(state, "Play Letters of Introduction");
    expect(state.players[RED].blackmailCards[0].facedown).toBe(false);
    state = choose(state, "Retire to the £4 prize (2 VP, upkeep £1) for £2 using -£2 Lady Glencora (Blue's");
    expect(state.players[RED]).toEqual(expect.objectContaining({ cash: 0, victoryPoints: 2 }));
  });

  it("makes a newly married family trade or discard holdings their spouse forbids", () => {
    let state = withPensioners(withCash(londonSeasonGame(), { [RED]: 4 }), RED, 1);
    state = withEnterprises(state, RED, [{ type: "workshop", cardId: "workshop-01" }]);
    state = withDisplay(state, ["john-thorpe", "stock-broker", "tax-collectors"], ["foundry"]);
    state = confirm(state);
    state = choose(state, "Retire to the £4 prize");
    state = choose(state, "Take John Thorpe");

    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "londonSeason.resolveRestriction", actor: RED }));
    expectSaveRoundTripPreservesPendingDecision(state);
    state = choose(state, "Discard workshop");

    expect(state.phase).toBe("family");
    expect(state.players[RED].enterprises).toEqual([]);
    expect(state.players[RED].victoryPoints).toBe(2 + 2);
  });

  it("removes Lady Glencora's opportunity marker and moves Joseph Sedley's Chairman into the Court", () => {
    let state = withPensioners(withCash(londonSeasonGame(), { [RED]: 2, [BLUE]: 2 }), RED, 1);
    state = withPensioners(state, BLUE, 1);
    state = withOffice(state, "chairman", BLUE, { inHiringQueue: false });
    state = withDisplay(state, ["lady-glencora", "joseph-sedley", "tax-collectors"]);
    state = confirm(state);
    // Blue (Chairman) retires first, then Red; both spend £2, Blue has no window icons, Red neither;
    // Prime Minister order (Red is Prime Minister) breaks the tie, so Red picks first.
    state = choose(state, "Retire to the £2 prize");
    state = choose(state, "Retire to the £2 prize");
    expect(state.pendingDecision.actor).toBe(RED);
    state = choose(state, "Take Lady Glencora");
    expect(state.players[RED].opportunityMarker).toBe("removed");

    state = choose(state, "Take Joseph Sedley");
    // Sedley vacates the Chairman office into the Court; then Blue must trade or remove the share.
    expect(state.company.offices.chairman.vacant).toBe(true);
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "londonSeason.resolveRestriction", actor: BLUE }));
    state = choose(state, "Remove a Company share");
    expect(state.company.court.filter((share) => share.owner === BLUE)).toHaveLength(0);
    expect(state.phase).toBe("family");
  });

  it("lets Scandal on Leadenhall Street be played when taken (card text)", () => {
    let state = withPensioners(withCash(londonSeasonGame(), { [RED]: 2 }), RED, 1);
    state = withOffice(state, "manager-of-shipping", BLUE, { inHiringQueue: false });
    state = withDisplay(state, ["scandal-on-leadenhall-street", "stock-broker", "tax-collectors"]);
    state = confirm(state);
    state = choose(state, "Retire to the £2 prize");
    state = choose(state, "Take face-down blackmail: Scandal on Leadenhall Street");

    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "londonSeason.resolveScandal", actor: RED }));
    expect(state.pendingDecision.legalCommands.map((legal) => legal.label).join()).not.toContain("Presidency");
    const blueSupply = state.players[BLUE].familyMembers.supply;
    state = choose(state, "Manager of Shipping");

    expect(state.company.offices["manager-of-shipping"].vacant).toBe(true);
    expect(state.players[BLUE].familyMembers.supply).toBe(blueSupply + 1);
    expect(state.players[RED].blackmailCards[0].facedown).toBe(false);
  });

  it("lets Becky Sharp take the top card of the deck instead", () => {
    let state = withPrestigeCards(withPensioners(withCash(londonSeasonGame(), { [RED]: 2 }), RED, 1), RED, ["becky-sharp"]);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"], ["social-magazine", "rotten-borough-2", "rotten-borough-3", "shipbuilders"]);
    state = confirm(state);
    state = choose(state, "Retire to the £2 prize");
    state = choose(state, "Take the top card of the deck (Becky Sharp)");

    expect(state.players[RED].prestigeCards.map((card) => card.cardId)).toContain("social-magazine");
    expect(state.londonSeason.display).toEqual(["rotten-borough-2", "rotten-borough-3", "shipbuilders"]);
    expect(state.londonSeason.discard).toEqual(["foundry", "stock-broker", "tax-collectors"]);
  });

  it("skips the Prestige Cards step for players who did not retire, and refills the display anyway", () => {
    let state = withDisplay(londonSeasonGame(), ["foundry", "stock-broker", "tax-collectors"], ["shipbuilders", "social-magazine", "rotten-borough-1"]);
    state = confirm(state);

    expect(state.phase).toBe("family");
    expect(state.londonSeason.display).toEqual(["shipbuilders", "social-magazine", "rotten-borough-1"]);
  });
});

describe("setup builds the London Season Display (setup steps 10-12)", () => {
  it("deals real blackmail to setup cards and three cards to the display", () => {
    const game = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "display-setup",
      gameId: "game-display-setup",
      now: "2026-06-13T12:00:00.000Z",
      setupDistribution: "random",
      players: [
        { id: RED, name: "Red", color: "red" },
        { id: BLUE, name: "Blue", color: "blue" },
        { id: YELLOW, name: "Yellow", color: "yellow" },
      ],
    });
    const state = applyCommandOrThrow(game, {
      id: "command-display-setup",
      actorId: RED,
      type: "setup.confirmStart",
      payload: game.pendingDecision.legalCommands[0].payload,
    });
    const blackmailIds = new Set(blackmailCards.map((card) => card.id));
    const held = Object.values(state.players).flatMap((player) => player.blackmailCards);

    expect(held.length).toBe(1);
    expect(held.every((card) => blackmailIds.has(card.cardId) && card.facedown)).toBe(true);
    expect(state.londonSeason.displayBuilt).toBe(true);
    expect(state.londonSeason.display).toHaveLength(3);
    expect(state.londonSeason.deck).toHaveLength(prestigeCards.length + blackmailCards.length - 3 - held.length);
  });
});

describe("Upkeep and Refresh (p.36)", () => {
  function upkeepGame(): GameState {
    let state = createHotseatGame({ seed: "upkeep", gameId: "game-upkeep" });
    state = withPrizePieces(state, RED, "prize-8", 1, 6);
    state = withPrizePieces(state, RED, "prize-4", 1);
    state = withPrizePieces(state, BLUE, "prize-4", 1, 2);
    state = withCash(state, { [RED]: 2, [BLUE]: 5 });
    return atConfirmation(state, "upkeep", "upkeep.confirm");
  }

  it("charges each family member on a prize its upkeep", () => {
    const state = confirm(withCash(upkeepGame(), { [RED]: 10 }));

    expect(state.players[RED].cash).toBe(10 - 3);
    expect(state.players[BLUE].cash).toBe(5 - 1);
    expect(state.phase).toBe("londonSeason");
    expect(state.turn).toBe(2);
  });

  it("returns pieces a family cannot pay for, losing that prize's VP", () => {
    let state = confirm(upkeepGame());

    expect(state.players[BLUE].cash).toBe(4);
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "upkeep.cannotPay", actor: RED }));
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "Return a piece from the £8 prize");

    expect(state.players[RED]).toEqual(expect.objectContaining({ victoryPoints: 6 - 4, cash: 2 - 1 }));
    expect(state.players[RED].familyMembers.prizes).toEqual({ "prize-8": 0, "prize-4": 1 });
    expect(state.players[RED].familyMembers.supply).toBe(18 - 1);
    expect(state.phase).toBe("londonSeason");
  });

  it("returns extra ships to the supply during Refresh", () => {
    const base = withCash(upkeepGame(), { [RED]: 10 });
    const state = confirm({ ...base, company: { ...base.company, ships: [{ id: "extra-1", kind: "extra", location: "west-indian", fatigued: false }] } });

    expect(state.company.ships).toEqual([]);
  });

  it("goes to Final Scoring instead of refreshing on the final turn", () => {
    const base = withCash(upkeepGame(), { [RED]: 10 });
    const state = confirm({
      ...base,
      finalTurn: 1,
      company: { ...base.company, ships: [{ id: "extra-1", kind: "extra", location: "west-indian", fatigued: false }] },
    });

    expect(state.pendingDecision.step).toBe("finalScoring.confirm");
    expect(state.turn).toBe(1);
    expect(state.company.ships).toHaveLength(1);
  });
});

describe("Final Scoring (p.9)", () => {
  function scoringGame(options: { turn?: number; failed?: boolean; seed?: string } = {}): GameState {
    const base = createHotseatGame({ seed: options.seed ?? "final-scoring", gameId: "game-final-scoring" });
    const state: GameState = {
      ...base,
      company: { ...base.company, failed: options.failed ?? false },
      parliament: { ...base.parliament, primeMinister: YELLOW },
      // Setup consumes random numbers (setup cards, event tiles), so pin the RNG the scoring rolls use.
      rng: options.seed ? createRngState(options.seed) : base.rng,
    };
    return atConfirmation(state, "finalScoring", "finalScoring.confirm", options.turn ?? 5);
  }

  function entryVp(state: GameState, playerId: PlayerId, labelStart: string): number | undefined {
    return state.finalScoring.players?.[playerId].entries.find((entry) => entry.label.startsWith(labelStart))?.victoryPoints;
  }

  it("gives players tied for most power the lower award and nobody else an award", () => {
    let state = withPlayerFields(scoringGame(), RED, { trophies: 3 });
    state = withPlayerFields(state, BLUE, { trophies: 3 });
    state = confirm(state);

    // Turn 5 is in the 4-6 band: 5 VP for most, 2 for second. Yellow's Prime Minister power is 2.
    expect(state.finalScoring.players?.[RED].power.total).toBe(3);
    expect(state.finalScoring.players?.[YELLOW].power.total).toBe(2);
    expect(entryVp(state, RED, "Power Award")).toBe(2);
    expect(entryVp(state, BLUE, "Power Award")).toBe(2);
    expect(entryVp(state, YELLOW, "Power Award")).toBeUndefined();
  });

  it("gives most power the first award and a unique second place the second award", () => {
    let state = withPlayerFields(scoringGame({ turn: 8 }), RED, { trophies: 4 });
    state = withPlayerFields(state, BLUE, { trophies: 3 });
    state = confirm(state);

    expect(entryVp(state, RED, "Power Award")).toBe(8);
    expect(entryVp(state, BLUE, "Power Award")).toBe(4);
    expect(entryVp(state, YELLOW, "Power Award")).toBeUndefined();
  });

  it("scores Company shares when the Company survived, then runs the final retirement", () => {
    const seed = seedWhere(1, 6, () => true);
    let state = withCourtShares(scoringGame({ seed }), [
      { id: "share-1", owner: RED },
      { id: "share-2", owner: RED },
      { id: "share-3", owner: BLUE },
    ]);
    // Fatigue 4 guarantees the final attrition roll retires the Manager of Shipping.
    state = withOffice(state, "manager-of-shipping", RED, { fatigue: 4, inHiringQueue: false });
    state = withCash(state, { [RED]: 4 });
    state = confirm(state);

    expect(entryVp(state, RED, "Company shares")).toBe(2);
    expect(entryVp(state, BLUE, "Company shares")).toBe(1);
    expect(state.pendingDecision).toEqual(expect.objectContaining({ phase: "finalScoring", step: "retirement.retirePensioner", actor: RED }));
    expectSaveRoundTripPreservesPendingDecision(state);

    state = choose(state, "Retire to the £4 prize");

    expect(state.pendingDecision.step).toBe("finalScoring.complete");
    expect(entryVp(state, RED, "Final retirement")).toBe(2);
    expect(state.finalScoring.complete).toBe(true);
    expect(state.finalScoring.ranking?.[0]).toBe(RED);
  });

  it("applies the Company failure card drawn when the Company failed (Parliament Exposed!)", () => {
    const parliamentExposed = companyFailureCards.findIndex((card) => card.id === "parliament-exposed") + 1;
    const seed = seedWhere(1, companyFailureCards.length, ([roll]) => roll === parliamentExposed);
    let state = withCourtShares(scoringGame({ failed: true, seed }), [{ id: "share-1", owner: RED }]);
    state = withEnterprises(state, RED, [{ type: "workshop", cardId: "workshop-01" }]);
    state = withPlayerFields(state, RED, { passedLawTokens: 2 });
    state = { ...state, parliament: { ...state.parliament, primeMinister: RED } };
    state = confirm(state);

    expect(state.finalScoring.failureCardId).toBe("parliament-exposed");
    // Power: 1 share x 1 + Prime Minister 2 + 2 laws = 5, the most: +5 in the 4-6 band.
    expect(entryVp(state, RED, "Power Award")).toBe(5);
    expect(entryVp(state, RED, "Company shares")).toBe(-1);
    expect(entryVp(state, RED, "Workshops")).toBe(1);
    const penalties = state.finalScoring.players?.[RED].entries.filter((entry) => entry.label.startsWith("Parliament Exposed!"));
    expect(penalties?.map((entry) => entry.victoryPoints)).toEqual([-2, -2]);
    expect(state.players[RED].victoryPoints).toBe(5 - 1 + 1 - 2 - 2);
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
  });

  it("scores shares as if the Company succeeded with Court of Directors Blameless!", () => {
    const blameless = companyFailureCards.findIndex((card) => card.id === "court-of-directors-blameless") + 1;
    const seed = seedWhere(1, companyFailureCards.length, ([roll]) => roll === blameless);
    const state = confirm(withCourtShares(scoringGame({ failed: true, seed }), [{ id: "share-1", owner: BLUE }]));

    expect(state.finalScoring.failureCardId).toBe("court-of-directors-blameless");
    expect(entryVp(state, BLUE, "Company shares")).toBe(1);
  });

  it("breaks ties by window icons, then Prime Minister order", () => {
    let state = withPrizePieces(scoringGame(), BLUE, "prize-4", 1, 10);
    state = withPlayerFields(state, RED, { victoryPoints: 10 });
    state = confirm(state);

    // Yellow takes the Power Award (Prime Minister, 2 power): 5 VP. Red and Blue tie on 10 VP;
    // Blue's prize piece carries a window icon.
    expect(playerWindowIcons(state, BLUE)).toBe(1);
    expect(state.finalScoring.ranking).toEqual([BLUE, RED, YELLOW]);

    let tied = withPlayerFields(scoringGame(), RED, { victoryPoints: 10 });
    tied = withPlayerFields(tied, BLUE, { victoryPoints: 10 });
    tied = confirm(tied);
    // Equal VP and windows: Prime Minister order from Yellow is Yellow, Red, Blue.
    expect(tied.finalScoring.ranking).toEqual([RED, BLUE, YELLOW]);
  });
});
