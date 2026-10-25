import { describe, expect, it } from "vitest";
import { crownAiCards, lawsById, prizes } from "../../data";
import {
  crownFavorOffers,
  exchangeCubes,
  playerCubes,
  type CrownClimate,
  type GameState,
  type LegalCommand,
  type PendingDecision,
} from "../../engine";
import { crownizeDecision } from "../../engine/crown/policy";
import { crownWriterPresidencies, CROWN_FAMILY_CHART } from "../../engine/crown/areas/early-phases-rules";
import { investmentCommands, startFirmInvestments } from "../../engine/phases/firms/investments";
import { startFamilyPhase } from "../../engine/phases/family";
import { advanceRetirements, beginRetirements } from "../../engine/phases/retirements";
import { startHiringPhase } from "../../engine/phases/hiring";
import { londonSeasonCommandHandlers } from "../../engine/phases/london-season";
import { playerForbidsHolding } from "../../engine/selectors";
import { withCash, withCourtShares, withHiringQueue, withOffice, withWriters } from "../fixtures/builders";
import { act, command, crownPlays, startedCrownGame } from "../fixtures/crown";
import { TEST_NOW } from "../fixtures/game";

const ANN = "player-ann";
const BEN = "player-ben";
const CROWN = "crown";

/** The pending decision as the Crown's policy leaves it. */
function decided(state: GameState, decision?: PendingDecision): PendingDecision {
  return crownizeDecision(decision ? { ...state, pendingDecision: decision } : state).pendingDecision;
}

function withClimate(state: GameState, climate: CrownClimate): GameState {
  return { ...state, crown: { ...state.crown!, climate } };
}

/** An AI card with the given splay slot, face up, over a top face-down card. */
function withSplay(state: GameState, slot: "left" | "middle" | "right"): GameState {
  const card = crownAiCards.find((candidate) => candidate.splaySlot === slot)!;
  return { ...state, crown: { ...state.crown!, faceupAiCard: card.id } };
}

function withCrownCash(state: GameState, cash: number): GameState {
  return { ...state, players: { ...state.players, [CROWN]: { ...state.players[CROWN], cash } } };
}

function withDifficulty(state: GameState, difficulty: "easy" | "normal" | "hard" | "expert"): GameState {
  return { ...state, crown: { ...state.crown!, difficulty } };
}

const only = (decision: PendingDecision) => {
  expect(decision.legalCommands).toHaveLength(1);
  return decision.legalCommands[0];
};

// ---------------------------------------------------------------------------------------------

describe("Crown retirements (Handbook p.2)", () => {
  function retiring(cash: number, options: { context?: "londonSeason" | "finalScoring"; difficulty?: "normal" | "hard"; retired?: boolean } = {}) {
    let state = withDifficulty(withCrownCash(startedCrownGame({ seed: "retire" }), cash), options.difficulty ?? "normal");
    state = { ...state, players: { ...state.players, [CROWN]: { ...state.players[CROWN], familyMembers: { ...state.players[CROWN].familyMembers, pensioners: 2 } } } };
    state = beginRetirements(state, options.context ?? "londonSeason");
    const progress = state.londonSeason.retirement!;
    state = {
      ...state,
      londonSeason: { ...state.londonSeason, retirement: { ...progress, order: [CROWN], current: 0, retired: options.retired ? [CROWN] : [] } },
    };
    const advanced = advanceRetirements(state);
    return { ...advanced.state, pendingDecision: advanced.decision! };
  }

  it("buys the highest VP prize costing no more than half the treasury, rounded up", () => {
    // Half of £17 rounded up is £9: the £8 prize (4 VP).
    expect(only(decided(retiring(17))).payload).toMatchObject({ prizeId: "prize-8" });
    // Half of £9 rounded up is £5: the £4 prize.
    expect(only(decided(retiring(9))).payload).toMatchObject({ prizeId: "prize-4" });
  });

  it("retires to the £2 space only to earn a London Season card, and only once", () => {
    expect(only(decided(retiring(3))).payload).toMatchObject({ prizeId: "prize-2" });
    expect(only(decided(retiring(3, { retired: true }))).type).toBe("retirement.stop");
  });

  it("spends as much as possible in Hard and Expert Final Retirement, not otherwise", () => {
    const rich = prizes.filter((prize) => prize.cost <= 20).at(-1)!;
    const hard = decided(retiring(20, { context: "finalScoring", difficulty: "hard" }));
    expect(only(hard).payload).toMatchObject({ prizeId: rich.id });
    const normal = decided(retiring(20, { context: "finalScoring", difficulty: "normal" }));
    expect((only(normal).payload as { prizeId: string }).prizeId).not.toBe(rich.id);
  });
});

describe("Crown prestige cards (Handbook p.2)", () => {
  function pick(slot: "left" | "middle" | "right", display: string[]) {
    const state = withSplay(startedCrownGame({ seed: "prestige" }), slot);
    const decision: PendingDecision = {
      id: "decision-test-prestige",
      phase: "londonSeason",
      step: "londonSeason.choosePrestigeCard",
      actor: CROWN,
      visibility: "private",
      prompt: "",
      canSave: true,
      legalCommands: [
        ...display.map((cardId, index) => ({ type: "londonSeason.choosePrestigeCard", label: "take", payload: { action: "take", slot: index, cardId } })),
        ...display.map((cardId, index) => ({ type: "londonSeason.choosePrestigeCard", label: "discard", payload: { action: "discard", slot: index, cardId } })),
      ],
    };
    return decided(state, decision);
  }

  it("takes the card in the AI card's shaded slot", () => {
    const display = ["foundry", "stock-broker", "becky-sharp"];
    expect(only(pick("left", display)).payload).toMatchObject({ action: "take", slot: 0 });
    expect(only(pick("middle", display)).payload).toMatchObject({ action: "take", slot: 1 });
    expect(only(pick("right", display)).payload).toMatchObject({ action: "take", slot: 2 });
  });

  it("ignores Spouse text effects but keeps the victory points", () => {
    let state = startedCrownGame({ seed: "spouse" });
    state = withOffice(state, "chairman", CROWN);
    const display = ["joseph-sedley", "foundry", "stock-broker"];
    state = {
      ...withSplay(state, "left"),
      phase: "londonSeason",
      londonSeason: { ...state.londonSeason, display, prestige: { order: [CROWN], current: 0 } },
      pendingDecision: {
        id: "decision-test-spouse",
        phase: "londonSeason",
        step: "londonSeason.choosePrestigeCard",
        actor: CROWN,
        visibility: "private",
        prompt: "",
        canSave: true,
        legalCommands: [{ type: "londonSeason.choosePrestigeCard", label: "take", payload: { action: "take", slot: 0, cardId: "joseph-sedley" } }],
      },
    };
    const before = state.players[CROWN].victoryPoints;
    const result = londonSeasonCommandHandlers["londonSeason.choosePrestigeCard"](state, {
      id: "c1",
      gameId: state.gameId,
      actorId: CROWN,
      decisionId: state.pendingDecision.id,
      type: "londonSeason.choosePrestigeCard",
      payload: { action: "take", slot: 0, cardId: "joseph-sedley" },
      clientTimestamp: TEST_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[CROWN].prestigeCards.map((card) => card.cardId)).toContain("joseph-sedley");
    expect(result.state.players[CROWN].victoryPoints).toBeGreaterThan(before);
    // Joseph Sedley would make a human Chairman leave the office and restrict Company shares.
    expect(result.state.company.offices.chairman.holder).toBe(CROWN);
    expect(result.state.londonSeason.restriction).toBeUndefined();
    expect(playerForbidsHolding(result.state, CROWN, "companyShare")).toBe(false);
  });
});

describe("the Crown's Family turn (Handbook p.3)", () => {
  /** The Crown is Chairman and so goes first; a started game's other family then waits. */
  function crownFirst(options: { climate: CrownClimate; players?: 1 | 2; cash?: number; seed?: string }) {
    let state = startedCrownGame({ seed: options.seed ?? "family", players: options.players });
    state = withClimate(withCrownCash(state, options.cash ?? 40), options.climate);
    state = { ...state, company: { ...state.company, chairmanMarker: CROWN } };
    state = withOffice(state, "chairman", CROWN);
    return crownizeDecision(startFamilyPhase(state));
  }
  const actions = (state: GameState) =>
    state.log.filter((entry) => entry.actor === CROWN && entry.type === "family.action.chosen").map((entry) => (entry.details as { action: { action: string } }).action.action);

  it.each(Object.entries(CROWN_FAMILY_CHART) as Array<[CrownClimate, string[]]>)("takes two actions from the %s chart, left to right (solo)", (climate, chart) => {
    const state = crownPlays(crownFirst({ climate }));
    expect(actions(state)).toEqual(chart.slice(0, 2));
  });

  it("takes one action in a two-player game", () => {
    const state = crownPlays(crownFirst({ climate: "bull", players: 2 }));
    expect(actions(state)).toEqual(["seek-share"]);
  });

  it("skips actions it cannot afford", () => {
    // Bull: Seek Shares and the shipyard cost money, so the two writer actions follow.
    const state = crownPlays(crownFirst({ climate: "bull", cash: 0 }));
    expect(actions(state)).toEqual(["enlist-writer", "enlist-writer"]);
  });

  it("places on the cheapest Stock Exchange space, the rightmost if several", () => {
    const state = crownFirst({ climate: "bull" });
    const exchange = state.company.stockExchange;
    const cheapest = Math.min(...exchange.filter((slot) => !slot.share).map((slot) => slot.cost));
    const slots = exchange.filter((slot) => !slot.share && slot.cost === cheapest);
    expect(only(state.pendingDecision).payload).toMatchObject({ action: "seek-share", slotId: slots.at(-1)!.id });
  });

  function withExtraLaw(state: GameState, lawId: string): GameState {
    return { ...state, parliament: { ...state.parliament, passedLaws: [...state.parliament.passedLaws, { lawId, passedTurn: 1 } as never] } };
  }

  it("treats a chart action matching the latest extra action as that extra (three actions from the chart)", () => {
    expect(lawsById.get("ship-subsidy")?.extraAction?.familyAction).toBe("purchase-shipyard");
    let state = crownFirst({ climate: "bull" });
    state = crownizeDecision(startFamilyPhase(withExtraLaw({ ...state, pendingDecision: state.pendingDecision }, "ship-subsidy")));
    state = crownPlays(state);
    expect(actions(state)).toEqual(["seek-share", "purchase-shipyard", "enlist-writer"]);
  });

  it("takes the extra action after the chart when the chart did not use it", () => {
    expect(lawsById.get("army-spending")?.extraAction?.familyAction).toBe("enlist-officer");
    let state = crownFirst({ climate: "bull" });
    state = crownizeDecision(startFamilyPhase(withExtraLaw(state, "army-spending")));
    state = crownPlays(state);
    expect(state.log.filter((entry) => entry.actor === CROWN && entry.type === "family.extraAction")).toHaveLength(1);
    expect(actions(state)).toEqual(["seek-share", "purchase-shipyard"]);
  });

  it("enlists a free writer first with four or more vacant offices, then for a Presidency with no President or Crown writer", () => {
    let state = crownFirst({ climate: "lion" });
    for (const presidency of ["Bombay", "Madras", "Bengal"] as const) state = withWriters(state, CROWN, presidency, 0);
    state = withOffice(state, "president-bombay", undefined);
    state = withOffice(state, "president-madras", undefined);
    state = withOffice(state, "president-bengal", undefined);
    state = withOffice(state, "manager-of-shipping", undefined);
    state = crownizeDecision(startFamilyPhase(state));
    expect(state.pendingDecision.step).toBe("family.crownFreeWriter");
    state = act(crownizeDecision(state), 0, CROWN);
    state = crownizeDecision(state);
    expect(state.pendingDecision.step).toBe("family.crownVacancyWriter");
  });

  it("puts writers in vacant Presidencies without Crown writers first, then Crown Presidencies, then fewest", () => {
    let state = startedCrownGame({ seed: "writers" });
    for (const presidency of ["Bombay", "Madras", "Bengal"] as const) state = withWriters(state, CROWN, presidency, 0);
    state = withOffice(state, "president-bombay", ANN);
    state = withOffice(state, "president-madras", CROWN);
    state = withOffice(state, "president-bengal", ANN);
    expect(crownWriterPresidencies(state, ["Bombay", "Madras", "Bengal"])).toEqual(["Madras"]);
    state = withOffice(state, "president-bengal", undefined);
    expect(crownWriterPresidencies(state, ["Bombay", "Madras", "Bengal"])).toEqual(["Bengal"]);
    state = withWriters(state, CROWN, "Bengal", 1);
    state = withWriters(state, CROWN, "Madras", 1);
    // No vacant Presidency without a Crown writer now; Madras is the Crown's own.
    expect(crownWriterPresidencies(state, ["Bombay", "Madras", "Bengal"])).toEqual(["Madras"]);
  });

  it("refuses its permission to a Stock Broker request (Handbook p.2)", () => {
    const state = startedCrownGame({ seed: "broker" });
    const decision: PendingDecision = {
      id: "decision-test-broker",
      phase: "family",
      step: "family.stockBrokerConsent",
      actor: CROWN,
      visibility: "public",
      prompt: "",
      canSave: true,
      legalCommands: [
        { type: "family.resolveStockBrokerConsent", label: "Allow", payload: { accepted: true } },
        { type: "family.resolveStockBrokerConsent", label: "Refuse", payload: { accepted: false } },
      ],
    };
    expect(only(decided(state, decision)).payload).toEqual({ accepted: false });
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Crown in the Firms phase (Handbook p.3)", () => {
  function firmsGame(climate: CrownClimate, crownShares = 3) {
    let state = startedCrownGame({ seed: "firms" });
    state = { ...state, scenario: "long-1710", finalTurn: 8, parliament: { ...state.parliament, deregulated: true }, firms: [], phase: "firms" };
    state = withClimate(state, climate);
    state = withOffice(state, "chairman", ANN);
    state = withCourtShares(state, [
      ...Array.from({ length: crownShares }, (_, index) => ({ id: `court-crown-${index}`, owner: CROWN, createdTurn: 0 })),
    ]);
    state = { ...state, turn: 2 };
    return state;
  }
  const withFirm = (state: GameState, shares: Record<string, number>): GameState => {
    // Firm shares are family pieces, so they come out of supply.
    let players = state.players;
    for (const [owner, count] of Object.entries(shares)) {
      const player = players[owner];
      players = { ...players, [owner]: { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count } } };
    }
    return {
      ...state,
      players,
      firms: [{ id: "firm-1", manager: ANN, londonTreasury: 5, indiaTreasury: 0, value: 3, shares, formedTurn: 1 }],
    };
  };

  /** Firm Investments until the Crown's turn: the manager has dissolve and fitting to consider, so she passes. */
  function crownTurn(state: GameState): GameState {
    let current = startFirmInvestments(state);
    if (current.pendingDecision.actor === ANN) current = act(current, current.pendingDecision.legalCommands.find((candidate) => candidate.type === "firms.pass")!);
    return current;
  }

  it("never forms a firm: it may only invest or pass", () => {
    const state = withFirm(firmsGame("lion"), { [ANN]: 4 });
    const types = new Set(investmentCommands(state, CROWN).map((candidate) => candidate.type));
    expect([...types].sort()).toEqual(["firms.invest", "firms.pass"]);
  });

  it("seeks one investment after the players in Lion, Bear and Peacock with a majority of Company shares", () => {
    for (const climate of ["lion", "bear", "peacock"] as const) {
      const state = crownTurn(withFirm(firmsGame(climate), { [ANN]: 4 }));
      expect(state.pendingDecision.step).toBe("firms.crownInvestment");
      const decision = decided(state);
      expect(only(decision).type).toBe("firms.invest");
      expect(decision.crown?.reason).toContain("seeks one investment");
    }
  });

  it("will not invest in Bull or Stag, or without a majority of Company shares", () => {
    for (const climate of ["bull", "stag"] as const) {
      const state = crownTurn(withFirm(firmsGame(climate), { [ANN]: 4 }));
      expect(only(decided(state)).type).toBe("firms.pass");
    }
    const weak = crownTurn(withFirm(firmsGame("lion", 1), { [ANN]: 4 }));
    expect(only(decided(weak)).type).toBe("firms.pass");
  });

  it("never invests if that would give it the majority of the firm's shares", () => {
    const state = crownTurn(withFirm(firmsGame("lion"), { [ANN]: 1, [CROWN]: 1 }));
    // One more share would give it 2 of 3, a majority.
    expect(only(decided(state)).type).toBe("firms.pass");
  });

  it("uses a Company share before a workshop", () => {
    let state = withFirm(firmsGame("lion"), { [ANN]: 4 });
    state = { ...state, players: { ...state.players, [CROWN]: { ...state.players[CROWN], enterprises: [{ id: "workshop-crown", type: "workshop" }] } } };
    const decision = decided(crownTurn(state));
    expect(only(decision).payload).toMatchObject({ source: { kind: "companyShare" } });
  });

  it("the solo favour denies the investment for the firm's Value, and costs nothing it cannot pay", () => {
    const state = crownTurn(withFirm(firmsGame("lion"), { [ANN]: 4 }));
    const decision = decided(state);
    expect(only(decision).type).toBe("firms.invest");
    const offer = crownFavorOffers({ ...state, pendingDecision: decision }, ANN).find((candidate) => candidate.favorId === "firms.denyCrownInvestment");
    expect(offer?.cubes).toBe(-3);
    const denied = command({ ...state, pendingDecision: decision }, ANN, "crown.favor", { favorId: "firms.denyCrownInvestment" });
    expect(only(denied.pendingDecision).type).toBe("firms.pass");
    expect(playerCubes(denied, ANN)).toBe(playerCubes(state, ANN) - 3);
  });

  it("charges a mandatory 3 cubes (or all it has) when a player forms a firm", () => {
    let state = firmsGame("lion");
    state = withCourtShares(state, [...state.company.court, { id: "court-ann-0", owner: ANN, createdTurn: 0 }]);
    state = {
      ...state,
      firmsPhase: { step: "investments", order: [ANN], index: 0, passes: 0 },
      pendingDecision: { id: "decision-test-firms", phase: "firms", step: "firms.investments", actor: ANN, visibility: "public", prompt: "", canSave: true, legalCommands: [] },
    };
    state = { ...state, pendingDecision: { ...state.pendingDecision, legalCommands: investmentCommands(state, ANN) } };
    const form = state.pendingDecision.legalCommands.find((candidate) => candidate.type === "firms.formFirm")!;
    const cubes = playerCubes(state, ANN);
    const formed = act(state, form);
    expect(playerCubes(formed, ANN)).toBe(cubes - 3);
    expect(formed.crown!.promiseCubes.crownSupply).toBe(state.crown!.promiseCubes.crownSupply + 3);
  });

  it("always consents to dissolving a firm it holds shares in, but not to a takeover", () => {
    let state = withFirm(firmsGame("lion"), { [ANN]: 2, [CROWN]: 1 });
    state = {
      ...state,
      firmsPhase: { step: "investments", order: [ANN], index: 0, passes: 0 },
      pendingDecision: { id: "decision-test-firms", phase: "firms", step: "firms.investments", actor: ANN, visibility: "public", prompt: "", canSave: true, legalCommands: [] },
    };
    state = { ...state, pendingDecision: { ...state.pendingDecision, legalCommands: investmentCommands(state, ANN) } };
    const dissolve = state.pendingDecision.legalCommands.find((candidate) => candidate.type === "firms.dissolve")!;
    const asked = act(state, dissolve);
    expect(asked.pendingDecision.step).toBe("negotiation.consent");
    expect(asked.pendingDecision.actor).toBe(CROWN);
    expect(decided(asked).crown?.reason).toContain("dissolution and merging");
    expect(JSON.stringify(only(decided(asked)).payload)).toContain('"accept":true');
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Crown in Hiring (Handbook p.3)", () => {
  /** A hiring game: only these offices wait to be hired. */
  function hiring(queue: string[], seed = "hiring") {
    let state = startedCrownGame({ seed });
    for (const officeId of queue) state = withOffice(state, officeId, undefined);
    return withHiringQueue(state, queue);
  }

  describe("Chairman election", () => {
    function election(shares: Record<string, number>, former: string | undefined) {
      let state = hiring(["chairman"]);
      state = { ...state, company: { ...state.company, chairmanMarker: former } };
      const court = Object.entries(shares).flatMap(([owner, count]) => Array.from({ length: count }, (_, index) => ({ id: `court-${owner}-${index}`, owner, createdTurn: 0 })));
      state = withCourtShares(state, court);
      return crownizeDecision(startHiringPhase(state));
    }

    it("elects itself with a majority of Company shares", () => {
      const state = election({ [CROWN]: 3, [ANN]: 1 }, ANN);
      // Ann declares first (former Chairman), then the Crown.
      const afterAnn = crownizeDecision(act(state, state.pendingDecision.legalCommands.find((c) => (c.payload as { candidateId: unknown }).candidateId === null)!));
      expect(afterAnn.pendingDecision.actor).toBe(CROWN);
      expect(only(afterAnn.pendingDecision).payload).toEqual({ candidateId: CROWN });
    });

    it("elects itself on an equality as former Chairman, and supports no one on an equality otherwise", () => {
      const asFormer = election({ [CROWN]: 2, [ANN]: 2 }, CROWN);
      expect(asFormer.pendingDecision.actor).toBe(CROWN);
      expect(only(asFormer.pendingDecision).payload).toEqual({ candidateId: CROWN });
      const notFormer = election({ [CROWN]: 2, [ANN]: 2 }, ANN);
      const afterAnn = crownizeDecision(act(notFormer, notFormer.pendingDecision.legalCommands.find((c) => (c.payload as { candidateId: unknown }).candidateId === ANN)!));
      expect(afterAnn.pendingDecision.actor).toBe(CROWN);
      expect(only(afterAnn.pendingDecision).payload).toEqual({ candidateId: null });
    });

    it("pays +3 cubes to a player with a majority who elects the Crown (+6 under Deregulation)", () => {
      const state = election({ [ANN]: 3, [CROWN]: 1 }, ANN);
      const cubes = playerCubes(state, ANN);
      const elected = act(state, state.pendingDecision.legalCommands.find((c) => (c.payload as { candidateId: unknown }).candidateId === CROWN)!);
      expect(playerCubes(elected, ANN)).toBe(cubes + 3);
      const dereg = { ...state, parliament: { ...state.parliament, deregulated: true } };
      const electedDereg = act(dereg, dereg.pendingDecision.legalCommands.find((c) => (c.payload as { candidateId: unknown }).candidateId === CROWN)!);
      expect(playerCubes(electedDereg, ANN)).toBe(Math.min(cubes + 6, state.crown!.promiseCubes.crownSupply + cubes));
    });

    it("lets a player bribe the Crown to elect them when it would elect itself (-3 cubes, -12 under Deregulation)", () => {
      const state = election({ [CROWN]: 3, [ANN]: 1 }, CROWN);
      expect(only(state.pendingDecision).payload).toEqual({ candidateId: CROWN });
      const bribe = crownFavorOffers(state, ANN).find((offer) => offer.favorId === "hiring.bribeChairman");
      expect(bribe?.cubes).toBe(-3);
      const bribed = command(state, ANN, "crown.favor", { favorId: "hiring.bribeChairman", option: ANN });
      expect(only(bribed.pendingDecision).payload).toEqual({ candidateId: ANN });
      const dereg = crownizeDecision({ ...state, parliament: { ...state.parliament, deregulated: true } });
      expect(crownFavorOffers(dereg, ANN).find((offer) => offer.favorId === "hiring.bribeChairman")).toBeUndefined(); // 12 cubes: more than Ann has
    });
  });

  describe("persuading the Crown (two players)", () => {
    it("lets a player pay the number of supporting Crown shares to make it back them", () => {
      let state = startedCrownGame({ seed: "persuade", players: 2 });
      state = withOffice(state, "chairman", undefined);
      state = withHiringQueue(state, ["chairman"]);
      state = { ...state, company: { ...state.company, chairmanMarker: ANN } };
      state = withCourtShares(state, [
        { id: "court-crown-0", owner: CROWN, createdTurn: 0 },
        { id: "court-crown-1", owner: CROWN, createdTurn: 0 },
        { id: "court-ann-0", owner: ANN, createdTurn: 0 },
        { id: "court-ann-1", owner: ANN, createdTurn: 0 },
        { id: "court-ben-0", owner: BEN, createdTurn: 0 },
      ]);
      state = crownPlays(crownizeDecision(startHiringPhase(state)));
      // The Crown supports no one by itself; Ann (or Ben) is asked first, so play on until it is the Crown's turn.
      let current = state;
      while (current.pendingDecision.actor !== CROWN && current.pendingDecision.step === "hiring.chairmanSupport") {
        current = act(current, current.pendingDecision.legalCommands.find((candidate) => (candidate.payload as { candidateId: unknown }).candidateId === null)!);
      }
      expect(current.pendingDecision.actor).toBe(CROWN);
      expect(only(current.pendingDecision).payload).toEqual({ candidateId: null });
      const offer = crownFavorOffers(current, BEN).find((candidate) => candidate.favorId === "hiring.persuadeChairman");
      expect(offer?.cubes).toBe(-2);
      const bought = command(current, BEN, "crown.favor", { favorId: "hiring.persuadeChairman", option: BEN });
      expect(only(bought.pendingDecision).payload).toEqual({ candidateId: BEN });
    });
  });

  describe("hiring decisions", () => {
    function crownHires(office: string, options: { chairman?: string } = {}) {
      let state = hiring([office]);
      state = withOffice(state, "chairman", options.chairman ?? CROWN);
      return state;
    }

    it("hires its own family if able, writers before officers before Governors", () => {
      let state = crownHires("president-bombay");
      state = withWriters(state, CROWN, "Bombay", 1);
      state = withWriters(state, ANN, "Bombay", 1);
      const decision = decided(startHiringPhase(state));
      expect(decision.step).toMatch(/hiring\.(hireOffice|nepotismConsent)/);
      const picked = only(decision).payload as { candidateId: string; source: { type: string } };
      expect(picked.candidateId).toBe(CROWN);
      expect(picked.source.type).toBe("writer");
    });

    it("hires the first eligible officeholder along the Company Operation ribbon, in the AI card's direction", () => {
      let state = crownHires("director-of-trade");
      for (const presidency of ["bombay", "madras", "bengal"]) state = withOffice(state, `president-${presidency}`, undefined, { inHiringQueue: false });
      state = withOffice(state, "manager-of-shipping", CROWN);
      state = withOffice(state, "military-affairs", CROWN);
      const started = startHiringPhase(state);
      const direction = decided(started).crown?.reason;
      const payload = only(decided(started)).payload as { source: { officeId: string } };
      // Manager of Shipping comes before Military Affairs on the ribbon; the other direction reverses it.
      expect(payload.source.officeId).toBe(String(direction).includes("counterclockwise") ? "military-affairs" : "manager-of-shipping");
    });

    it("asks a human hirer's own-family pool for the Crown's consent, which it refuses", () => {
      let state = hiring(["manager-of-shipping"]);
      state = withOffice(state, "chairman", ANN);
      state = withWriters(state, ANN, "Bombay", 1);
      state = withWriters(state, CROWN, "Bengal", 1);
      state = startHiringPhase(state);
      const hire = state.pendingDecision.legalCommands.find((candidate) => (candidate.payload as { candidateId: string }).candidateId === ANN)!;
      const asked = crownizeDecision(act(state, hire));
      expect(asked.pendingDecision.step).toBe("hiring.nepotismConsent");
      expect(asked.pendingDecision.actor).toBe(CROWN);
      expect(only(asked.pendingDecision).payload).toMatchObject({ accepted: false });
      // The favour buys its consent for 2 cubes.
      const bought = command(asked, ANN, "crown.favor", { favorId: "hiring.consentNepotism" });
      expect(only(bought.pendingDecision).payload).toMatchObject({ accepted: true });
      expect(playerCubes(bought, ANN)).toBe(playerCubes(asked, ANN) - 2);
    });

    it("pays +1 for hiring a Crown family member over a non-Crown one", () => {
      let state = hiring(["manager-of-shipping"]);
      state = withOffice(state, "chairman", ANN);
      state = withWriters(state, ANN, "Bombay", 1);
      state = withWriters(state, CROWN, "Bengal", 1);
      state = startHiringPhase(state);
      const cubes = playerCubes(state, ANN);
      const hired = act(state, state.pendingDecision.legalCommands.find((candidate) => (candidate.payload as { candidateId: string }).candidateId === CROWN)!);
      expect(playerCubes(hired, ANN)).toBe(cubes + 1);
    });

    it("lets a player make a hiring decision for the Crown for 3 cubes", () => {
      let state = crownHires("president-bombay");
      state = withWriters(state, CROWN, "Bombay", 1);
      state = withWriters(state, ANN, "Bombay", 1);
      state = crownizeDecision(startHiringPhase(state));
      expect(state.pendingDecision.step).toBe("hiring.hireOffice");
      expect(state.pendingDecision.legalCommands).toHaveLength(1);
      const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "hiring.decideForCrown");
      expect(offer?.cubes).toBe(-3);
      const bought = command(state, ANN, "crown.favor", { favorId: "hiring.decideForCrown" });
      expect(bought.pendingDecision.legalCommands.length).toBeGreaterThan(1);
      expect(bought.pendingDecision.crown?.chooser).toBe(ANN);
    });
  });

  describe("consent to the Crown's nepotism", () => {
    function crownSelfHire(cubesWithCrown: number, players: 1 | 2 = 1) {
      let state = startedCrownGame({ seed: "nepotism", players });
      state = withOffice(state, "manager-of-shipping", undefined);
      state = withHiringQueue(state, ["manager-of-shipping"]);
      state = withOffice(state, "chairman", CROWN);
      state = withWriters(state, CROWN, "Bombay", 1);
      state = withWriters(state, ANN, "Bengal", 1);
      if (players === 2) state = withWriters(state, BEN, "Madras", 1);
      const held = state.crown!.promiseCubes.crownSupply;
      state = exchangeCubes(state, ANN, held - cubesWithCrown, { partial: true }).state;
      state = crownizeDecision(startHiringPhase(state));
      return crownPlays(state);
    }

    it("is mandatory for the soloist when the Crown has 2 or more promises, and pays +2", () => {
      const state = crownSelfHire(3);
      expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
      expect(state.pendingDecision.legalCommands.map((candidate) => (candidate.payload as { accepted: boolean }).accepted)).toEqual([true]);
      const cubes = playerCubes(state, ANN);
      expect(playerCubes(act(state, 0), ANN)).toBe(cubes + 2);
    });

    it("is optional with fewer than 2 promises", () => {
      const state = crownSelfHire(1);
      expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
      expect(state.pendingDecision.legalCommands).toHaveLength(2);
    });

    it("pays +1 to each of two players who both consent", () => {
      const state = crownSelfHire(6, 2);
      expect(state.pendingDecision.step).toBe("hiring.nepotismConsent");
      const annCubes = playerCubes(state, ANN);
      const benCubes = playerCubes(state, BEN);
      const first = act(state, state.pendingDecision.legalCommands.find((candidate) => (candidate.payload as { accepted: boolean }).accepted)!);
      const second = act(first, first.pendingDecision.legalCommands.find((candidate) => (candidate.payload as { accepted: boolean }).accepted)!);
      expect(playerCubes(second, ANN)).toBe(annCubes + 1);
      expect(playerCubes(second, BEN)).toBe(benCubes + 1);
    });
  });

  describe("shares and cash with the Crown, once hiring has begun", () => {
    function shareGame() {
      let state = hiring(["manager-of-shipping"]);
      state = withOffice(state, "chairman", ANN);
      state = withCourtShares(state, [
        { id: "court-crown-0", owner: CROWN, createdTurn: 0 },
        { id: "court-crown-1", owner: CROWN, createdTurn: 0 },
        { id: "court-crown-2", owner: CROWN, createdTurn: 0 },
        { id: "court-ann-0", owner: ANN, createdTurn: 0 },
      ]);
      state = withClimate(state, "bear");
      state = withWriters(state, ANN, "Bombay", 1);
      state = withWriters(state, ANN, "Bengal", 1);
      return crownizeDecision(startHiringPhase(state));
    }

    it("takes a share from the Crown for the climate's price and gives one back for its pay", () => {
      const state = shareGame();
      const offers = crownFavorOffers(state, ANN);
      expect(offers.find((offer) => offer.favorId.startsWith("hiring.takeShare"))?.cubes).toBe(-3); // Bear
      expect(offers.find((offer) => offer.favorId.startsWith("hiring.giveShare"))?.cubes).toBe(-4); // Bear
      const taken = command(state, ANN, "crown.favor", { favorId: offers.find((offer) => offer.favorId.startsWith("hiring.takeShare"))!.favorId });
      expect(taken.company.court.filter((share) => share.owner === CROWN)).toHaveLength(2);
      expect(taken.company.court.filter((share) => share.owner === ANN)).toHaveLength(2);
    });

    it("pays +1 cube for £1 given to the Crown only while it has a majority of Company shares", () => {
      const state = shareGame();
      const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId.startsWith("hiring.cash"));
      expect(offer?.cubes).toBe(1);
      const gave = command(state, ANN, "crown.favor", { favorId: offer!.favorId });
      expect(gave.players[CROWN].cash).toBe(state.players[CROWN].cash + 1);
      expect(gave.players[ANN].cash).toBe(state.players[ANN].cash - 1);
      const noMajority = withCourtShares(state, [{ id: "court-crown-0", owner: CROWN }, { id: "court-ann-0", owner: ANN }, { id: "court-ann-1", owner: ANN }]);
      expect(crownFavorOffers(noMajority, ANN).some((candidate) => candidate.favorId.startsWith("hiring.cash"))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Crown family board's favours", () => {
  function boardGame() {
    let state = startedCrownGame({ seed: "board" });
    state = { ...state, phase: "hiring" };
    state = {
      ...state,
      players: {
        ...state.players,
        [ANN]: { ...state.players[ANN], cash: 10, enterprises: [{ id: "luxury-1", type: "luxury", cardId: "luxury-1" }, { id: "workshop-1", type: "workshop", cardId: "workshop-1" }] },
      },
    };
    return state;
  }
  const offerFor = (state: GameState, id: string) => crownFavorOffers(state, ANN).find((offer) => offer.favorId === id);

  it("is open from the Firms phase to the end of Revenue, and shut in the Family phase", () => {
    const open = boardGame();
    expect(offerFor(open, "board.give.cash")).toBeDefined();
    for (const phase of ["firms", "companyOperation", "bonuses", "eventsInIndia", "revenue"] as const) {
      expect(offerFor({ ...open, phase }, "board.give.cash")).toBeDefined();
    }
    for (const phase of ["family", "parliament", "londonSeason", "upkeep"] as const) {
      expect(offerFor({ ...open, phase }, "board.give.cash")).toBeUndefined();
    }
    expect(crownFavorOffers(open, ANN).every((offer) => !offer.pausesCrown || !offer.favorId.startsWith("board."))).toBe(true);
  });

  it("gives £3 for 2 cubes", () => {
    const state = boardGame();
    expect(offerFor(state, "board.give.cash")?.cubes).toBe(2);
    const given = command(state, ANN, "crown.favor", { favorId: "board.give.cash" });
    expect(given.players[ANN].cash).toBe(7);
    expect(given.players[CROWN].cash).toBe(state.players[CROWN].cash + 3);
    expect(playerCubes(given, ANN)).toBe(playerCubes(state, ANN) + 2);
  });

  it("gives a luxury for 5 cubes and takes one back for 7", () => {
    const state = boardGame();
    const offer = offerFor(state, "board.give.luxury");
    expect(offer?.cubes).toBe(5);
    const given = command(state, ANN, "crown.favor", { favorId: "board.give.luxury", option: "luxury-1" });
    expect(given.players[CROWN].enterprises.map((enterprise) => enterprise.id)).toContain("luxury-1");
    expect(given.players[ANN].enterprises.map((enterprise) => enterprise.id)).not.toContain("luxury-1");
    const back = crownFavorOffers(given, ANN).find((candidate) => candidate.favorId === "board.take.luxury");
    expect(back?.cubes).toBe(-7);
    const taken = command(given, ANN, "crown.favor", { favorId: "board.take.luxury", option: "luxury-1" });
    expect(taken.players[ANN].enterprises.map((enterprise) => enterprise.id)).toContain("luxury-1");
  });

  it("gives an uninvested workshop for 4 cubes", () => {
    const offer = offerFor(boardGame(), "board.give.uninvestedWorkshop");
    expect(offer?.cubes).toBe(4);
  });

  it("offers the promise-card favour in Easy mode only, for turn/2 rounded up cubes", () => {
    let state = { ...boardGame(), turn: 3 };
    expect(offerFor(state, "board.easy.removePromise")).toBeUndefined();
    state = withDifficulty(state, "easy");
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "board.easy.removePromise");
    expect(offer?.cubes).toBe(2);
  });
});

describe("the London Season favours (Handbook p.2)", () => {
  function retirementTime(options: { crownDone?: boolean } = {}) {
    let state = startedCrownGame({ seed: "season" });
    state = beginRetirements({ ...state, phase: "londonSeason" }, "londonSeason");
    const progress = state.londonSeason.retirement!;
    state = {
      ...state,
      londonSeason: { ...state.londonSeason, retirement: { ...progress, order: options.crownDone ? [CROWN, ANN] : [ANN, CROWN], current: options.crownDone ? 1 : 0 } },
      pendingDecision: { id: "decision-test-retire", phase: "londonSeason", step: "retirement.retirePensioner", actor: ANN, visibility: "public", prompt: "", canSave: true, legalCommands: [] },
    };
    return state;
  }

  it("takes £1 from the Crown before retirements for 2 cubes", () => {
    const state = retirementTime();
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "londonSeason.start.takeCash");
    expect(offer?.cubes).toBe(-2);
    const taken = command(state, ANN, "crown.favor", { favorId: "londonSeason.start.takeCash" });
    expect(taken.players[ANN].cash).toBe(state.players[ANN].cash + 1);
    expect(taken.players[CROWN].cash).toBe(state.players[CROWN].cash - 1);
  });

  it("takes £1 for 1 cube only once the Crown has finished retiring", () => {
    expect(crownFavorOffers(retirementTime(), ANN).some((offer) => offer.favorId === "londonSeason.afterRetirements.takeCash")).toBe(false);
    const done = retirementTime({ crownDone: true });
    expect(crownFavorOffers(done, ANN).find((offer) => offer.favorId === "londonSeason.afterRetirements.takeCash")?.cubes).toBe(-1);
  });
});

describe("favours that buy the Crown's consent or investment", () => {
  function firmsTwoPlayers(shares: Record<string, number>, climate: CrownClimate = "bull") {
    let state = startedCrownGame({ seed: "consent", players: 2 });
    state = { ...state, scenario: "long-1710", finalTurn: 8, parliament: { ...state.parliament, deregulated: true }, phase: "firms", turn: 2 };
    state = withClimate(state, climate);
    state = withOffice(state, "chairman", ANN);
    state = withCourtShares(state, [0, 1, 2].map((index) => ({ id: `court-crown-${index}`, owner: CROWN, createdTurn: 0 })));
    let players = state.players;
    for (const [owner, count] of Object.entries(shares)) {
      const player = players[owner];
      players = { ...players, [owner]: { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count } } };
    }
    state = {
      ...state,
      players,
      firms: [{ id: "firm-1", manager: ANN, londonTreasury: 5, indiaTreasury: 0, value: 3, shares, formedTurn: 1 }],
      crown: { ...state.crown!, playerButton: { holder: BEN } },
      firmsPhase: { step: "investments", order: [ANN, BEN], index: 1, passes: 0 },
    };
    return {
      ...state,
      pendingDecision: {
        id: "decision-test-firms",
        phase: "firms" as const,
        step: "firms.investments",
        actor: BEN,
        visibility: "public" as const,
        prompt: "",
        canSave: true as const,
        legalCommands: investmentCommands(state, BEN),
      },
    };
  }

  it("a player holding the Button pays the Crown's firm shares in cubes for its consent to a hostile takeover (two players)", () => {
    const state = firmsTwoPlayers({ [ANN]: 1, [CROWN]: 3 });
    const asked = act(state, state.pendingDecision.legalCommands.find((candidate) => candidate.type === "firms.takeOver")!);
    expect(asked.pendingDecision.actor).toBe(CROWN);
    expect(only(decided(asked)).payload).toMatchObject({ accept: false });
    const offer = crownFavorOffers(asked, BEN).find((candidate) => candidate.favorId === "firms.consentHostileTakeover");
    expect(offer?.cubes).toBe(-3);
    expect(crownFavorOffers(asked, ANN).some((candidate) => candidate.favorId === "firms.consentHostileTakeover")).toBe(false);
    const bought = command(asked, BEN, "crown.favor", { favorId: "firms.consentHostileTakeover" });
    expect(only(bought.pendingDecision).payload).toMatchObject({ accept: true });
  });

  it("a player pays 2 cubes in Bull for the Crown to invest in their firm", () => {
    let state = firmsTwoPlayers({ [ANN]: 4 });
    state = { ...state, firmsPhase: { step: "investments", order: [ANN, BEN], index: 0, passes: 0 }, pendingDecision: { ...state.pendingDecision, actor: ANN } };
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "firms.investInYourFirm");
    expect(offer?.cubes).toBe(-2);
    const bought = command(state, ANN, "crown.favor", { favorId: "firms.investInYourFirm" });
    // Ann passes, then Ben, and the Crown invests though the climate is Bull.
    let current = act(bought, bought.pendingDecision.legalCommands.find((candidate) => candidate.type === "firms.pass")!, ANN);
    current = act(current, current.pendingDecision.legalCommands.find((candidate) => candidate.type === "firms.pass")!, BEN);
    expect(current.pendingDecision.step).toBe("firms.crownInvestment");
    expect(only(current.pendingDecision).type).toBe("firms.invest");
  });

  it("a player pays 2 cubes for the Crown's consent to fit a Crown-owned ship", () => {
    let state = firmsTwoPlayers({ [ANN]: 1 });
    // Nobody else owns shipyard-01.
    const without = Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => [id, { ...player, enterprises: player.enterprises.filter((enterprise) => enterprise.cardId !== "shipyard-01") }]),
    );
    state = {
      ...state,
      players: { ...without, [CROWN]: { ...without[CROWN], enterprises: [...without[CROWN].enterprises, { id: "sy-1", type: "shipyard", cardId: "shipyard-01" }] } },
      company: {
        ...state.company,
        ships: [
          ...state.company.ships.filter((ship) => ship.shipyardCardId !== "shipyard-01"),
          { id: "ship-shipyard-01", kind: "player", shipyardCardId: "shipyard-01", location: "shipyard", fatigued: false },
        ],
      },
      firmsPhase: { step: "investments", order: [ANN, BEN], index: 0, passes: 0 },
    };
    state = { ...state, pendingDecision: { ...state.pendingDecision, actor: ANN, legalCommands: investmentCommands(state, ANN) } };
    const fit = state.pendingDecision.legalCommands.find(
      (candidate) => candidate.type === "firms.fitShip" && (candidate.payload as { shipId: string }).shipId === "ship-shipyard-01",
    )!;
    const asked = act(state, fit);
    expect(asked.pendingDecision.actor).toBe(CROWN);
    expect(only(decided(asked)).payload).toMatchObject({ accept: false });
    const offer = crownFavorOffers(asked, ANN).find((candidate) => candidate.favorId === "firms.consentFitCrownShip");
    expect(offer?.cubes).toBe(-2);
    const bought = command(asked, ANN, "crown.favor", { favorId: "firms.consentFitCrownShip" });
    expect(only(bought.pendingDecision).payload).toMatchObject({ accept: true });
  });
});

describe("favours for the Crown's prestige cards (Handbook p.2)", () => {
  function prestigeStep() {
    let state = startedCrownGame({ seed: "cards" });
    state = {
      ...state,
      phase: "londonSeason",
      londonSeason: { ...state.londonSeason, prestige: { order: [CROWN], current: 0 } },
      players: {
        ...state.players,
        [CROWN]: {
          ...state.players[CROWN],
          prestigeCards: [{ id: "prestige-foundry", cardId: "foundry" }],
          blackmailCards: [{ id: "blackmail-hiring-preference", cardId: "hiring-preference", facedown: true }],
        },
      },
    };
    return state;
  }

  it("takes an enterprise prestige card for 5 cubes, with its victory points", () => {
    const state = prestigeStep();
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "londonSeason.takeEnterpriseCard");
    expect(offer?.cubes).toBe(-5);
    const taken = command(state, ANN, "crown.favor", { favorId: "londonSeason.takeEnterpriseCard", option: "prestige-foundry" });
    expect(taken.players[ANN].prestigeCards.map((card) => card.cardId)).toContain("foundry");
    expect(taken.players[CROWN].prestigeCards).toHaveLength(0);
  });

  it("takes a blackmail card for 4 cubes, unseen", () => {
    const state = prestigeStep();
    expect(crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "londonSeason.takeBlackmailCard")?.cubes).toBe(-4);
    const taken = command(state, ANN, "crown.favor", { favorId: "londonSeason.takeBlackmailCard" });
    expect(taken.players[ANN].blackmailCards).toHaveLength(state.players[ANN].blackmailCards.length + 1);
    expect(taken.players[CROWN].blackmailCards).toHaveLength(0);
    expect(taken.log.at(-1)?.summary).not.toContain("hiring-preference");
  });
});
