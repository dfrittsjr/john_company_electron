import { describe, expect, it } from "vitest";
import { companyFailureCards } from "../../data";
import { createNewGame, createRngState, rollDie, type FirmState, type GameState, type PlayerId } from "../../engine";
import { withCash, withFilledOrder, withOffice } from "../fixtures/builders";
import { deregulatedGame } from "../fixtures/firms";
import { applyCommandOrThrow, expectSaveRoundTripPreservesPendingDecision } from "../fixtures/game";
import {
  atConfirmation,
  choiceLabelled,
  withDisplay,
  withEnterprises,
  withPensioners,
  withPrizePieces,
  withPlayerFields,
  withPrestigeCards,
} from "../fixtures/london-season";

// Deregulation, SC area: special retirement (p.37), firms in Final Scoring (p.37, p.41), invested
// workshops on failure (p.38), Refresh (p.36) and Long 1710 (8 turns).

const RED = "player-red";
const BLUE = "player-blue";
const YELLOW = "player-yellow";

let commandCount = 0;

function choose(state: GameState, labelText: string): GameState {
  const choice = choiceLabelled(state, labelText);
  commandCount += 1;
  return applyCommandOrThrow(state, {
    id: `command-sc-${commandCount}`,
    actorId: state.pendingDecision.actor as PlayerId,
    type: choice.type,
    payload: choice.payload,
  });
}

function confirm(state: GameState): GameState {
  commandCount += 1;
  const legal = state.pendingDecision.legalCommands[0];
  return applyCommandOrThrow(state, { id: `command-sc-${commandCount}`, actorId: "system", type: legal.type, payload: legal.payload ?? {} });
}

function seedWhere(sides: number, predicate: (roll: number) => boolean): string {
  for (let index = 0; index < 5000; index += 1) {
    const seed = `sc-seed-${index}`;
    if (predicate(rollDie(createRngState(seed), sides).value)) return seed;
  }
  throw new Error("No seed found");
}

/** Adds a firm. Share pieces come out of supply so the family-piece invariant holds. */
function withFirm(
  state: GameState,
  id: string,
  manager: PlayerId,
  shares: Record<PlayerId, number>,
  extra: Partial<FirmState> = {},
): GameState {
  const players = { ...state.players };
  for (const [playerId, count] of Object.entries(shares)) {
    const player = players[playerId];
    players[playerId] = { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count } };
  }
  const firm: FirmState = {
    id,
    manager,
    londonTreasury: 0,
    indiaTreasury: 0,
    value: 1,
    shares,
    formedTurn: 1,
    ...extra,
  };
  return { ...state, players, firms: [...(state.firms ?? []), firm] };
}

function withPrison(state: GameState, playerId: PlayerId, count: number): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count, debtorPrison: player.familyMembers.debtorPrison + count },
      },
    },
  };
}

function londonGame(): GameState {
  return atConfirmation({ ...deregulatedGame("sc-london"), turn: 2 }, "londonSeason", "londonSeason.confirm");
}

function retireLabels(state: GameState): string[] {
  return state.pendingDecision.legalCommands.filter((legal) => legal.type === "retirement.retirePensioner").map((legal) => legal.label);
}

describe("Special retirement in the London Season (p.37)", () => {
  it("caps the money spent at the highest dividend of a firm the player holds shares in", () => {
    let state = withFirm(londonGame(), "firm-1", BLUE, { [RED]: 1, [BLUE]: 1 }, { dividendCube: 4 });
    state = withCash(state, { [RED]: 20 });
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    // Red has no pensioners, yet is asked, with a piece from supply; Blue (also a shareholder, £5 cash) too.
    expect(state.pendingDecision).toEqual(expect.objectContaining({ step: "retirement.retirePensioner", actor: RED }));
    expect(retireLabels(state).some((label) => label.startsWith("Retire to the £4 prize"))).toBe(true);
    expect(retireLabels(state).some((label) => label.startsWith("Retire to the £8 prize"))).toBe(false);
    expect(state.pendingDecision.legalCommands.at(-1)?.label).toBe("Do not take a special retirement");
    expectSaveRoundTripPreservesPendingDecision(state);

    const supply = state.players[RED].familyMembers.supply;
    state = choose(state, "Retire to the £4 prize");
    expect(state.players[RED]).toEqual(expect.objectContaining({ cash: 16, victoryPoints: state.players[RED].victoryPoints }));
    expect(state.players[RED].familyMembers.supply).toBe(supply - 1);
    expect(state.players[RED].familyMembers.prizes["prize-4"]).toBe(1);
    expect(state.players[RED].familyMembers.pensioners).toBe(0);
    // Ordinary retirement afterwards: it counts toward the Prestige Cards order (spending 4).
    expect(state.londonSeason.retirement?.spending[RED]).toBe(4);
    expect(state.londonSeason.retirement?.retired).toContain(RED);
  });

  it("ignores a firm whose dividend cube was never placed or sits on 0 (disreputable)", () => {
    let state = withFirm(londonGame(), "firm-1", BLUE, { [RED]: 1, [BLUE]: 1 });
    state = withFirm(state, "firm-2", YELLOW, { [RED]: 1, [YELLOW]: 1 }, { dividendCube: 0 });
    state = withCash(state, { [RED]: 20, [BLUE]: 20, [YELLOW]: 20 });
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    expect(state.londonSeason.retirement).toBeUndefined();
    expect(state.pendingDecision.step).not.toBe("retirement.retirePensioner");
    expect(state.phase).not.toBe("londonSeason");
  });

  it("lets a spouse discount reach a prize worth more than the dividend", () => {
    let state = withFirm(londonGame(), "firm-1", BLUE, { [RED]: 1, [BLUE]: 1 }, { dividendCube: 2 });
    state = withPrestigeCards(withCash(state, { [RED]: 20 }), RED, ["lady-glencora"]);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    const labels = retireLabels(state);
    // The £4 prize costs £2 with the -£2 discount; the £8 prize still costs £6.
    expect(labels.some((label) => label.startsWith("Retire to the £4 prize") && label.includes("for £2 using -£2 Lady Glencora"))).toBe(true);
    expect(labels.some((label) => label.includes("for £4"))).toBe(false);
    expect(labels.some((label) => label.startsWith("Retire to the £8 prize"))).toBe(false);
  });

  it("allows only one special retirement per player, whatever their firms, after their pensioners", () => {
    let state = withFirm(londonGame(), "firm-1", BLUE, { [RED]: 1, [BLUE]: 1 }, { dividendCube: 2 });
    state = withFirm(state, "firm-2", YELLOW, { [RED]: 1, [YELLOW]: 1 }, { dividendCube: 6 });
    state = withPensioners(withCash(state, { [RED]: 30, [BLUE]: 0, [YELLOW]: 0 }), RED, 1);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);

    // The pensioner is not limited by the dividend.
    expect(retireLabels(state).some((label) => label.startsWith("Retire to the £20 prize"))).toBe(true);
    state = choose(state, "Retire to the £2 prize");
    // Then the special retirement, capped by the better firm (£6).
    expect(state.pendingDecision.actor).toBe(RED);
    expect(state.pendingDecision.legalCommands.at(-1)?.label).toBe("Do not take a special retirement");
    expect(retireLabels(state).some((label) => label.startsWith("Retire to the £4 prize"))).toBe(true);
    expect(retireLabels(state).some((label) => label.startsWith("Retire to the £8 prize"))).toBe(false);
    state = choose(state, "Retire to the £4 prize");
    expect(state.players[RED].familyMembers.prizes["prize-4"]).toBe(1);
    // Not asked again; Red's only shareholding rivals have no cash for a prize beyond £2... they are skipped or asked, never Red.
    expect(state.pendingDecision.actor === RED && state.pendingDecision.step === "retirement.retirePensioner").toBe(false);
  });

  it("skips the special retirement when the player has nothing left in supply", () => {
    let state = withFirm(londonGame(), "firm-1", BLUE, { [RED]: 1, [BLUE]: 1 }, { dividendCube: 4 });
    state = withPrizePieces(withCash(state, { [RED]: 20 }), RED, "prize-2", state.players[RED].familyMembers.supply);
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);
    expect(state.pendingDecision.actor === RED && state.pendingDecision.step === "retirement.retirePensioner").toBe(false);
  });
});

describe("Firms in Final Scoring (p.37, p.41)", () => {
  function scoringGame(options: { failed?: boolean; seed?: string; turn?: number } = {}): GameState {
    const base = deregulatedGame("sc-final");
    const state: GameState = {
      ...base,
      company: { ...base.company, failed: options.failed ?? false },
      parliament: { ...base.parliament, primeMinister: YELLOW },
      rng: options.seed ? createRngState(options.seed) : base.rng,
    };
    return atConfirmation(state, "finalScoring", "finalScoring.confirm", options.turn ?? 8);
  }
  function entryVp(state: GameState, playerId: PlayerId, labelStart: string): number | undefined {
    return state.finalScoring.players?.[playerId].entries.find((entry) => entry.label.startsWith(labelStart))?.victoryPoints;
  }
  const noAttrition = (state: GameState): GameState => state;
  void noAttrition;

  it("scores each share at its firm's Value and each Debtor's Prison piece -1, rounding the total down", () => {
    // Value 3 and 4 are 0.5 VP per share, Value 8 is 1.5. Red: 0.5 + 0.5 + 2 x 1.5 = 4; Blue: 0.5 - 1 = -0.5 -> -1.
    let state = scoringGame({ failed: true, seed: seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "court-of-directors-blameless") });
    state = withFirm(state, "firm-1", RED, { [RED]: 1, [BLUE]: 1 }, { value: 3 });
    state = withFirm(state, "firm-2", YELLOW, { [RED]: 1 }, { value: 4 });
    state = withFirm(state, "firm-3", YELLOW, { [RED]: 2 }, { value: 8 });
    state = withPrison(state, BLUE, 1);
    state = confirm(state);

    const firmVp = (playerId: PlayerId) =>
      state.finalScoring.players![playerId].entries.filter((e) => /shares|Debtor|Fractions/.test(e.label) && !e.label.startsWith("Company")).reduce((s, e) => s + e.victoryPoints, 0);
    expect(firmVp(RED)).toBe(4);
    expect(firmVp(BLUE)).toBe(-1);
    // The fraction is only dropped once per player, across firms (0.5 + 0.5 is 1, not 0).
    expect(state.finalScoring.players![BLUE].entries.some((entry) => entry.label.startsWith("Fractions"))).toBe(true);
  });

  it("sums fractions across firms before rounding (0.5 + 0.5 = 1)", () => {
    let state = scoringGame({ failed: true, seed: seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "court-of-directors-blameless") });
    state = withFirm(state, "firm-1", RED, { [RED]: 1 }, { value: 3 });
    state = withFirm(state, "firm-2", YELLOW, { [RED]: 1 }, { value: 4 });
    const before = state.players[RED].victoryPoints;
    state = confirm(state);
    const entries = state.finalScoring.players![RED].entries.filter((entry) => entry.label.includes("shares:"));
    expect(entries).toHaveLength(2);
    expect(state.players[RED].victoryPoints - before).toBe(1 + (entryVp(state, RED, "Power Award") ?? 0));
  });

  it("offers each shareholder one special retirement before the rest of scoring, even after a failed Company", () => {
    let state = scoringGame({ failed: true, seed: seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "parliament-exposed") });
    state = withFirm(state, "firm-1", RED, { [RED]: 2 }, { value: 5, dividendCube: 4 });
    state = withCash(state, { [RED]: 10 });
    state = confirm(state);

    // Firm shares are already scored (2 x 1 VP); no Power Award yet, and no Display card is taken.
    expect(state.pendingDecision).toEqual(expect.objectContaining({ phase: "finalScoring", step: "retirement.retirePensioner", actor: RED }));
    expect(state.finalScoring.players).toBeUndefined();
    expect(state.players[RED].victoryPoints).toBe(2);
    expectSaveRoundTripPreservesPendingDecision(state);

    const display = state.londonSeason.display;
    state = choose(state, "Retire to the £4 prize");
    expect(state.londonSeason.display).toEqual(display);
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
    const entries = state.finalScoring.players![RED].entries;
    expect(entries.map((entry) => entry.label.split(":")[0])).toEqual(expect.arrayContaining(["Special retirement to prizes"]));
    // 2 (shares) + 2 (prize) + Power Award (Red has 2 shares? no, Red power 0; Yellow is PM) - the failure card's penalties.
    expect(state.players[RED].victoryPoints).toBe(state.finalScoring.players![RED].finalVictoryPoints);
    expect(state.finalScoring.players![RED].victoryPointsBefore).toBe(0);
  });

  it("runs the special retirement before the pensioners when the Company survived, sharing one discount", () => {
    let state = scoringGame({ seed: seedWhere(6, (roll) => roll <= 2) });
    state = withFirm(state, "firm-1", RED, { [RED]: 1 }, { value: 2, dividendCube: 2 });
    state = withPrestigeCards(withPensioners(withCash(state, { [RED]: 10 }), RED, 1), RED, ["lady-glencora"]);
    state = confirm(state);

    expect(state.pendingDecision.step).toBe("retirement.retirePensioner");
    expect(state.pendingDecision.id).toContain("finalSpecial-special");
    // Special: the £4 prize for £2 with Lady Glencora's discount.
    state = choose(state, "Retire to the £4 prize (2 VP, upkeep £1) for £2 using -£2 Lady Glencora");
    expect(state.pendingDecision.id).toContain("finalScoring-t");
    expect(state.pendingDecision.id).not.toContain("special");
    // The discount was used once for the whole Final Scoring: the pensioner can't use it again.
    expect(retireLabels(state).some((label) => label.includes("Lady Glencora"))).toBe(false);
    state = choose(state, "Retire to the £4 prize");
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
    expect(state.players[RED].familyMembers.prizes["prize-4"]).toBe(2);
  });

  it("skips a disreputable firm's special retirement in Final Scoring", () => {
    let state = scoringGame({ failed: true, seed: seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "parliament-exposed") });
    state = withFirm(state, "firm-1", RED, { [RED]: 2 }, { value: 5, dividendCube: 0 });
    state = confirm(state);
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
  });

  it("does not score firm shares or Debtor's Prison under Industry's Greed Condemned!, nor workshops", () => {
    const seed = seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "industrys-greed-condemned");
    let state = scoringGame({ failed: true, seed });
    state = withFirm(state, "firm-1", RED, { [RED]: 2 }, { value: 8 });
    state = withPrison(state, BLUE, 2);
    state = withEnterprises(state, RED, [{ type: "workshop", cardId: "workshop-01" }]);
    state = confirm(state);

    expect(state.finalScoring.failureCardId).toBe("industrys-greed-condemned");
    expect(state.finalScoring.players![RED].entries.some((entry) => entry.label.includes("shares:"))).toBe(false);
    expect(entryVp(state, BLUE, "Debtor")).toBeUndefined();
    expect(entryVp(state, RED, "Workshops")).toBeUndefined();
  });

  it("still scores firm shares and Debtor's Prison under other failure cards, and when the Company survived", () => {
    const seed = seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "parliament-exposed");
    let state = scoringGame({ failed: true, seed });
    state = withFirm(state, "firm-1", RED, { [RED]: 2 }, { value: 8 });
    state = withPrison(state, BLUE, 2);
    state = confirm(state);
    expect(entryVp(state, BLUE, "Debtor")).toBe(-2);
    expect(state.finalScoring.players![RED].entries.some((entry) => entry.label.includes("shares:"))).toBe(true);
  });

  it("does not score invested workshops when the Company fails (p.38)", () => {
    const seed = seedWhere(companyFailureCards.length, (roll) => companyFailureCards[roll - 1].id === "parliament-exposed");
    let state = scoringGame({ failed: true, seed });
    state = withEnterprises(state, RED, [
      { type: "workshop", cardId: "workshop-01" },
      { type: "workshop", cardId: "workshop-02" },
    ]);
    state = {
      ...state,
      players: {
        ...state.players,
        [RED]: { ...state.players[RED], enterprises: state.players[RED].enterprises.map((e, i) => (i === 0 ? { ...e, invested: true } : e)) },
      },
    };
    state = confirm(state);
    expect(entryVp(state, RED, "Workshops")).toBe(1);
  });

  it("does not change an ordinary game: no special retirement and no firm entries", () => {
    const base = createNewGame({
      mode: "hotseat",
      scenario: "1710",
      seed: "sc-plain",
      gameId: "sc-plain",
      now: "2026-06-13T12:00:00.000Z",
      setupDistribution: "starter",
      players: [
        { id: RED, name: "Red", color: "red" },
        { id: BLUE, name: "Blue", color: "blue" },
        { id: YELLOW, name: "Yellow", color: "yellow" },
      ],
    });
    const state = confirm(atConfirmation({ ...base, company: { ...base.company, failed: true } }, "finalScoring", "finalScoring.confirm", 5));
    expect(state.finalScoring.openingEntries).toEqual({});
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
  });
});

describe("Refresh clears firm records (p.36, pp.40-41)", () => {
  it("clears trade, tradeBid, strategy secrets and filled-order tokens that name a firm", () => {
    let state = withFirm(deregulatedGame("sc-refresh"), "firm-1", RED, { [RED]: 1 }, {
      value: 3,
      tradeBid: 1,
      trade: { strategy: "west-bombay", dice: 1, successes: 1, initiative: 0, income: 6 } as unknown as FirmState["trade"],
    });
    state = {
      ...state,
      hidden: { ...state.hidden, firmStrategySecrets: { "firm-1": { firmId: "firm-1", committedBy: RED, strategy: "west" as never, bid: 1, revealed: true } } },
    };
    const orderId = Object.values(state.india.regions).flatMap((region) => region.orders)[0].id;
    state = withFilledOrder(state, orderId, ["company", "firm-1"]);
    state = confirm(atConfirmation({ ...state, turn: 3 }, "upkeep", "upkeep.confirm"));

    expect(state.turn).toBe(4);
    expect(state.firms![0].trade).toBeUndefined();
    expect(state.firms![0].tradeBid).toBeUndefined();
    expect(state.firms![0].value).toBe(3);
    expect(state.hidden.firmStrategySecrets).toEqual({});
    expect(Object.values(state.india.regions).flatMap((region) => region.orders).every((order) => order.filledThisTurnBy.length === 0)).toBe(true);
  });
});

describe("Long 1710 (8 turns)", () => {
  function longGame(): GameState {
    return createNewGame({
      mode: "hotseat",
      scenario: "long-1710",
      seed: "sc-long",
      gameId: "sc-long",
      now: "2026-06-13T12:00:00.000Z",
      setupDistribution: "starter",
      players: [
        { id: RED, name: "Red", color: "red" },
        { id: BLUE, name: "Blue", color: "blue" },
        { id: YELLOW, name: "Yellow", color: "yellow" },
      ],
    });
  }

  it("runs turns 1-8 and goes to Final Scoring only after turn 8, with the turn 7-8 Power Award band", () => {
    const game = longGame();
    expect(game.finalTurn).toBe(8);

    let state = withCash(atConfirmation({ ...game, turn: 5 }, "upkeep", "upkeep.confirm"), { [RED]: 10, [BLUE]: 10, [YELLOW]: 10 });
    state = confirm(state);
    // Turn 5 is not the end of Long 1710.
    expect(state.turn).toBe(6);
    expect(state.phase).toBe("londonSeason");

    state = confirm(withCash(atConfirmation({ ...state, turn: 8 }, "upkeep", "upkeep.confirm"), { [RED]: 10, [BLUE]: 10, [YELLOW]: 10 }));
    expect(state.turn).toBe(8);
    expect(state.pendingDecision.step).toBe("finalScoring.confirm");

    state = withPlayerFields(state, RED, { trophies: 4 });
    state = { ...state, company: { ...state.company, failed: true } };
    state = confirm(state);
    expect(state.finalScoring.players![RED].entries.find((entry) => entry.label.startsWith("Power Award"))?.victoryPoints).toBe(8);
    expect(state.pendingDecision.step).toBe("finalScoring.complete");
  });
});

describe("Saving in the middle of the new decisions", () => {
  it("round-trips the London Season special retirement decision and resumes", () => {
    let state = withFirm(londonGame(), "firm-1", BLUE, { [RED]: 1, [BLUE]: 1 }, { dividendCube: 4 });
    state = withCash(state, { [RED]: 20 });
    state = withDisplay(state, ["foundry", "stock-broker", "tax-collectors"]);
    state = confirm(state);
    expectSaveRoundTripPreservesPendingDecision(state);
    const loaded = JSON.parse(JSON.stringify(state)) as GameState;
    const next = choose(loaded, "Do not take a special retirement");
    expect(next.pendingDecision.actor === RED && next.pendingDecision.step === "retirement.retirePensioner").toBe(false);
  });

  it("round-trips Final Scoring's opening special retirement and resumes", () => {
    const base = deregulatedGame("sc-save");
    let state = atConfirmation({ ...base, company: { ...base.company, failed: true } }, "finalScoring", "finalScoring.confirm", 8);
    state = withFirm(state, "firm-1", RED, { [RED]: 1 }, { value: 2, dividendCube: 4 });
    state = withCash(state, { [RED]: 10 });
    state = withOffice(state, "chairman", RED, { inHiringQueue: false });
    state = confirm(state);
    expect(state.pendingDecision.id).toContain("finalSpecial-special");
    expectSaveRoundTripPreservesPendingDecision(state);
    const loaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(choose(loaded, "Do not take a special retirement").pendingDecision.step).toBe("finalScoring.complete");
  });
});
