import { describe, expect, it } from "vitest";
import {
  aiCard,
  climateFromCard,
  crownFavorOffers,
  crownizeDecision,
  crownPresidencyOrder,
  type CrownClimate,
  type GameState,
  type OfficeId,
  type PlayerId,
  type PresidencyId,
  type ShipState,
} from "../../engine";
import { beginCompanyOperation, createNextCompanyOperationDecision } from "../../engine/phases/company-operation";
import {
  withCommander,
  withCourtShares,
  withOfficers,
  withOfficersInTraining,
  withOffice,
  withRegiments,
  withWriters,
} from "../fixtures/builders";
import { withOrder, withTreasury } from "../fixtures/company-operation";
import { tradeRoute } from "../../engine/crown/areas/offices-metrics";
import { act, command, crownPlays, startedCrownGame } from "../fixtures/crown";

const ANN = "player-ann";
const CROWN = "crown";

/** A solo Crown game dropped into Company Operation with the given offices, climate and Balance. */
function operate(
  options: {
    climate?: CrownClimate;
    acted?: OfficeId[];
    offices?: Record<string, PlayerId | undefined>;
    balance?: number;
    current?: unknown;
    ships?: ShipState[];
    build?: (state: GameState) => GameState;
  } = {},
): GameState {
  let state = startedCrownGame({ seed: "crown-offices" });
  state = {
    ...state,
    phase: "companyOperation",
    company: { ...state.company, vacantOffices: [], balance: options.balance ?? 0, ships: options.ships ?? [] },
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => [
        id,
        { ...player, enterprises: player.enterprises.filter((enterprise) => enterprise.type !== "shipyard") },
      ]),
    ),
    crown: { ...state.crown!, climate: options.climate ?? "bull", favorEffects: [] },
    companyOperation: { turn: state.turn, actedOffices: options.acted ?? [], ...(options.current ? { current: options.current as never } : {}) },
  };
  // A clean slate: no Commanders, officers or Governors from the random setup.
  for (const army of ["Bombay", "Madras", "Bengal"] as const) {
    state = withCommander(state, army, undefined);
    for (const playerId of Object.keys(state.company.armies[army].officers)) state = withOfficers(state, playerId, army, {});
  }
  for (const office of Object.values(state.company.offices)) {
    if (office.holder && office.id.startsWith("governor-") && office.id !== "governor-general") state = withOffice(state, office.id, undefined);
  }
  for (const [officeId, holder] of Object.entries(options.offices ?? {})) state = withOffice(state, officeId, holder);
  if (options.build) state = options.build(state);
  return crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
}

function controlHomeRegions(state: GameState): GameState {
  return {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([id, region]) => [id, ["bengal", "bombay", "madras"].includes(id) ? { ...region, companyControlled: true } : region]),
      ),
    },
  };
}

/** A shipyard (and its ship) owned by `owner`. */
function shipyard(state: GameState, owner: PlayerId, cardId: string, location: ShipState["location"] = "shipyard", extra: Partial<ShipState> = {}): GameState {
  const player = state.players[owner];
  return {
    ...state,
    players: { ...state.players, [owner]: { ...player, enterprises: [...player.enterprises, { id: `yard-${cardId}`, type: "shipyard", cardId }] } },
    company: { ...state.company, ships: [...state.company.ships, { id: `ship-${cardId}`, kind: "player", shipyardCardId: cardId, location, fatigued: false, ...extra }] },
  };
}

function withCards(state: GameState, faceUp: number, top: number): GameState {
  const id = (number: number) => `crown-ai-${String(number).padStart(2, "0")}`;
  const rest = state.crown!.aiDeck.drawPile.concat(state.crown!.aiDeck.discardPile, state.crown!.faceupAiCard).filter((card) => card !== id(faceUp) && card !== id(top));
  return crownizeDecision({ ...state, crown: { ...state.crown!, faceupAiCard: id(faceUp), aiDeck: { drawPile: [id(top), ...rest], discardPile: [], removed: [] } } });
}

const reasons = (state: GameState, count = 20) =>
  state.log.slice(-count).flatMap((entry) => (entry.crownReason ? [entry.crownReason] : []));

describe("Set Climate (Handbook pp.4-5)", () => {
  it("flips a new AI card in the command that ends a human Chairman's turn", () => {
    const state = operate({ offices: { chairman: ANN } });
    const before = state.crown!.faceupAiCard;
    const next = act(state, state.pendingDecision.legalCommands.find((legal) => (legal.payload as { action: string }).action === "finish")!);
    expect(next.crown!.faceupAiCard).not.toBe(before);
    expect(next.crown!.climate).toBe(climateFromCard(next, aiCard(next.crown!.faceupAiCard)));
    expect(next.log.some((entry) => entry.type === "crown.aiCardFlipped")).toBe(true);
    expect(next.companyOperation.actedOffices).toContain("chairman");
  });

  it("flips before the Crown acts as Chairman, as Company Operation begins", () => {
    let state = operate({ offices: { chairman: CROWN } });
    const before = state.crown!.faceupAiCard;
    state = beginCompanyOperation({ ...state, companyOperation: { turn: state.turn } });
    expect(state.crown!.faceupAiCard).not.toBe(before);
    expect(state.pendingDecision.actor).toBe("crown");
    expect(state.pendingDecision.step).toBe("companyOperation.chairman");
  });
});

describe("the Crown as Chairman (pp.4-5)", () => {
  it("advances Debt per Presidency with an open home port (Bull), then allocates in priority order", () => {
    const state = operate({ offices: { chairman: CROWN, "president-bombay": ANN, "president-madras": ANN, "president-bengal": CROWN } });
    const played = crownPlays(state);
    expect(played.company.debt).toBe(state.company.debt + 3);
    const order = crownPresidencyOrder(state);
    // 3 x £5 of Debt = £15: £4 to each Presidency in AI-card order, then what is left (£3) to the Director of Trade.
    const gained = (officeId: string) => played.company.offices[officeId].treasury - state.company.offices[officeId].treasury;
    expect(["Bombay", "Madras", "Bengal"].map((presidency) => gained(`president-${presidency.toLowerCase()}`))).toEqual([4, 4, 4]);
    expect(gained("director-of-trade")).toBe(3);
    expect(played.company.balance).toBe(0);
    expect(order).toHaveLength(3);
    expect(reasons(played).some((reason) => /^Bull: Allocate: £4 to each Presidency with an open home port/.test(reason))).toBe(true);
    expect(reasons(played).some((reason) => reason.includes("(all that is left of the £5)"))).toBe(true);
  });

  it("sends the remainder to the Manager of Shipping (Peacock: only Commanders and Governor General rank)", () => {
    const state = operate({ climate: "peacock", balance: 30, offices: { chairman: CROWN, "president-bombay": ANN }, build: (built) => withCommander(built, "Bombay", CROWN) });
    const played = crownPlays(state);
    const gained = (officeId: string) => played.company.offices[officeId].treasury - state.company.offices[officeId].treasury;
    expect(played.company.debt).toBe(state.company.debt); // Peacock: do not advance Debt
    expect(gained("president-bombay")).toBe(5);
    expect(gained("manager-of-shipping")).toBe(25);
    expect(reasons(played).some((reason) => reason.includes("remaining £25 goes to the Manager of Shipping"))).toBe(true);
  });

  it("refuses consent to more Debt, and a favour buys it", () => {
    const base = operate({ climate: "bull", offices: { chairman: ANN }, current: { office: "chairman", debtAdvances: 3, consentRefused: false } });
    let state = withCourtShares(base, [
      { id: "s1", owner: ANN },
      { id: "s2", owner: CROWN },
      { id: "s3", owner: CROWN },
    ]);
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    state = act(state, state.pendingDecision.legalCommands.find((legal) => (legal.payload as { action: string }).action === "debt")!);
    expect(state.pendingDecision.step).toBe("companyOperation.debtConsent");
    expect(state.pendingDecision.actor).toBe("crown");
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ accepted: false });

    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "chairman.consent.first")!;
    expect(offer.cubes).toBe(-1); // Bull
    const bought = command(state, ANN, "crown.favor", { favorId: "chairman.consent.first" });
    expect(bought.pendingDecision.legalCommands).toHaveLength(1);
    expect(bought.pendingDecision.legalCommands[0].payload).toEqual({ accepted: true });
    expect(bought.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(state.crown!.promiseCubes.byHumanPlayer[ANN] - 1);
    const done = act(bought, 0);
    expect(done.company.debt).toBe(state.company.debt + 1);
  });

  it("lets a favour request £3 for a specific office, and the debt favours change the advances", () => {
    const state = operate({ offices: { chairman: CROWN, "president-bombay": ANN }, balance: 10 });
    expect(crownFavorOffers(state, ANN).some((offer) => offer.favorId === "chairman.debtMore")).toBe(true);
    const more = command(state, ANN, "crown.favor", { favorId: "chairman.debtMore" });
    expect(crownPlays(more).company.debt).toBe(state.company.debt + 4);

    const request = crownFavorOffers(state, ANN).find((offer) => offer.favorId === "chairman.requestAllocation" && (offer.option as string) === "manager-of-shipping")!;
    const asked = command(state, ANN, "crown.favor", { favorId: request.favorId, option: request.option });
    expect(asked.company.offices["manager-of-shipping"].treasury).toBe(state.company.offices["manager-of-shipping"].treasury + 3);
    expect(asked.company.balance).toBe(7);
    // The decision was rebuilt, so the Crown cannot allocate more than is left.
    expect(asked.pendingDecision.legalCommands.length).toBeGreaterThan(0);
  });
});

describe("the Crown as Director of Trade (pp.6-7)", () => {
  it("sends a Special Envoy with exactly £3 at the northernmost closed order of the first open region", () => {
    let state = withCards(operate({ offices: { "director-of-trade": CROWN }, acted: ["chairman"] }), 1, 8);
    state = withTreasury(state, "director-of-trade", 7);
    state = withOrder(withOrder(state, "mysore-north-3", { closed: true }), "mysore-south-6", { closed: true });
    state = { ...state, india: { ...state.india, regions: { ...state.india.regions, madras: { ...state.india.regions.madras, companyControlled: true }, mysore: { ...state.india.regions.mysore, companyControlled: false } } } };
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "envoy", spend: 3 });
    expect(state.pendingDecision.crown!.reason).toContain("mysore-north-3");
    // At £2 it is not enough: on to transfers.
    const poor = crownizeDecision({ ...withTreasury(state, "director-of-trade", 2), pendingDecision: createNextCompanyOperationDecision(withTreasury(state, "director-of-trade", 2)) });
    expect(poor.pendingDecision.legalCommands[0].payload).toEqual({ action: "stopEnvoys" });
  });

  it("opens the targeted order once the Envoy succeeds", () => {
    let state = withCards(operate({ offices: { "director-of-trade": CROWN }, acted: ["chairman"], current: { office: "director-of-trade", stage: "envoyEffect", transfersMade: 0 } }), 1, 8);
    state = withOrder(withOrder(state, "mysore-north-3", { closed: true }), "mysore-south-6", { closed: true });
    state = { ...state, india: { ...state.india, regions: { ...state.india.regions, madras: { ...state.india.regions.madras, companyControlled: true }, mysore: { ...state.india.regions.mysore, companyControlled: false } } } };
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "openOrder", orderId: "mysore-north-3" });
    // "Target a specific order" lets the buyer pick another closed order.
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "director.targetOrder")!;
    expect(offer.cubes).toBeLessThan(0);
    const targeted = command(state, ANN, "crown.favor", { favorId: "director.targetOrder" });
    expect(targeted.pendingDecision.crown!.chooser).toBe(ANN);
    expect(targeted.pendingDecision.legalCommands.length).toBeGreaterThan(1);
  });

  it("makes two transfers from the priority list, walking it once, with the AI card breaking ties", () => {
    // Bull: 1. a Crown writer from the shortest route to the longest; 2. a ship likewise.
    let state = operate({ offices: { "director-of-trade": CROWN, "president-bengal": ANN }, acted: ["chairman"] });
    state = withOrder(state, "bombay-home-4", { closed: true }); // Bombay's route is 0: shortest
    state = withWriters(state, CROWN, "Bombay", 1);
    state = withTreasury(state, "director-of-trade", 0);
    state = {
      ...state,
      company: {
        ...state.company,
        ships: [
          { id: "company-bombay", kind: "company", location: "west-indian", fatigued: false },
          { id: "extra-bombay", kind: "extra", location: "west-indian", fatigued: true },
        ],
      },
    };
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    state = act(state, state.pendingDecision.legalCommands.find((legal) => (legal.payload as { action: string }).action === "stopEnvoys")!);
    expect(tradeRoute(state, "Bombay")).toBe(0);
    const others = crownPresidencyOrder(state).filter((presidency) => presidency !== "Bombay");
    const best = Math.max(...others.map((presidency) => tradeRoute(state, presidency)));
    const longest = others.filter((presidency) => tradeRoute(state, presidency) === best);
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "moveWriter", playerId: CROWN, from: "Bombay", to: longest[0] });
    state = act(state, 0);
    // Second transfer: rule 2, a ship (a Company ship before a fatigued extra one).
    const ship = state.pendingDecision.legalCommands[0].payload as { action: string; shipId: string; to: string };
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(ship.action).toBe("moveShip");
    expect(ship.shipId).toBe("company-bombay");
    expect(state.pendingDecision.crown!.reason).toContain("[rule 2]");
    state = act(state, 0);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "finish" });
  });

  it("lets favours prevent a transfer or pick one, but never undo one", () => {
    let state = operate({ offices: { "director-of-trade": CROWN, "president-bengal": ANN }, acted: ["chairman"], current: { office: "director-of-trade", stage: "transfers", transfersMade: 0 } });
    state = withWriters(state, CROWN, "Bombay", 1);
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    const prevented = command(state, ANN, "crown.favor", { favorId: "director.preventTransfer" });
    const first = act(prevented, 0);
    expect(first.pendingDecision.legalCommands[0].payload).toEqual({ action: "finish" }); // one left of two, but a favour used one
    const chosen = command(state, ANN, "crown.favor", { favorId: "director.chooseTransfer" });
    expect(chosen.pendingDecision.crown!.chooser).toBe(ANN);
    expect(chosen.pendingDecision.legalCommands.every((legal) => (legal.payload as { action: string }).action !== "finish")).toBe(true);
  });
});

describe("the Crown as Governor General (p.7)", () => {
  function governor(treasury: number, climate: CrownClimate, stage = "govern", extra: object = {}): GameState {
    const state = operate({
      climate,
      build: controlHomeRegions,
      offices: { "director-of-trade": undefined, "governor-general": CROWN, "president-bengal": CROWN, "president-madras": CROWN, "president-bombay": ANN },
      acted: ["chairman"],
      current: { office: "governor-general", stage, choicesRemaining: 0, taxRegions: [], ...extra },
    });
    const withGeneral = { ...withTreasury(state, "governor-general", treasury), company: { ...state.company, governorGeneralInPlay: true, offices: { ...state.company.offices, "governor-general": { ...state.company.offices["governor-general"], created: true, treasury } } } };
    return crownizeDecision({ ...withGeneral, pendingDecision: createNextCompanyOperationDecision(withGeneral) });
  }

  it("Governs only if it can roll the required dice: 5 in Bull, 3 in Lion, 2 in Peacock", () => {
    expect(governor(4, "bull").pendingDecision.legalCommands[0].payload).toEqual({ action: "finish" });
    expect(governor(5, "bull").pendingDecision.legalCommands[0].payload).toEqual({ action: "govern", spend: 5 });
    expect(governor(9, "lion").pendingDecision.legalCommands[0].payload).toEqual({ action: "govern", spend: 3 });
    expect(governor(2, "peacock").pendingDecision.legalCommands[0].payload).toEqual({ action: "govern", spend: 2 });
  });

  it("takes a favour to change the required dice by one", () => {
    const state = governor(4, "bull");
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "finish" });
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "governorGeneral.dice" && candidate.option === -1)!;
    const less = command(state, ANN, "crown.favor", { favorId: offer.favorId, option: offer.option });
    expect(less.pendingDecision.legalCommands[0].payload).toEqual({ action: "govern", spend: 4 });
  });

  it("Taxes evenly among Crown Presidencies, then the remainder to the Company Balance (Bull)", () => {
    let state = governor(9, "bull", "choices", { choicesRemaining: 3 });
    const regions = Object.values(state.india.regions);
    expect(regions.filter((region) => region.companyControlled).length).toBeGreaterThanOrEqual(3);
    const before = state;
    state = crownPlays(state);
    const gained = (officeId: string) => state.company.offices[officeId].treasury - before.company.offices[officeId].treasury;
    expect(gained("president-bengal") + gained("president-madras")).toBe(4);
    expect(gained("president-bengal")).toBe(2);
    expect(gained("president-bombay")).toBe(0);
    expect(state.company.balance - before.company.balance).toBe(2);
  });

  it("builds a Company ship in Lion and commissions a regiment in Bear", () => {
    const lion = governor(9, "lion", "choices", { choicesRemaining: 1 });
    expect(lion.pendingDecision.legalCommands.every((legal) => (legal.payload as { action: string }).action === "ship")).toBe(true);
    const bear = governor(9, "bear", "choices", { choicesRemaining: 1 });
    expect(bear.pendingDecision.legalCommands.every((legal) => (legal.payload as { action: string }).action === "regiment")).toBe(true);
  });
});

describe("the Crown as Manager of Shipping (p.8)", () => {
  function manager(climate: CrownClimate, treasury: number, ships: ShipState[], build?: (state: GameState) => GameState): GameState {
    let state = operate({ climate, offices: { "manager-of-shipping": CROWN, "president-bengal": ANN }, acted: ["chairman", "director-of-trade"], ships });
    state = { ...state, players: { ...state.players, [ANN]: { ...state.players[ANN], enterprises: [{ id: "yard-a", type: "shipyard", cardId: "ann-yard" }] } } };
    state = { ...state, players: { ...state.players, crown: { ...state.players.crown, enterprises: [{ id: "yard-c", type: "shipyard", cardId: "crown-yard" }, { id: "yard-c2", type: "shipyard", cardId: "crown-yard-2" }] } } };
    state = withTreasury(build ? build(state) : state, "manager-of-shipping", treasury);
    return crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
  }
  const yard = (cardId: string): ShipState => ({ id: `ship-${cardId}`, kind: "player", shipyardCardId: cardId, location: "shipyard", fatigued: false });

  it("fits its own ships first, then the players', and the owner pays a cube", () => {
    let state = manager("bull", 9, [yard("ann-yard"), yard("crown-yard"), yard("crown-yard-2")]);
    const cubes = state.crown!.promiseCubes.byHumanPlayer[ANN];
    const fitted: string[] = [];
    for (let guard = 0; guard < 10 && state.pendingDecision.step === "companyOperation.shipping" && state.pendingDecision.actor === "crown" && !(state.pendingDecision.legalCommands[0].payload as { action: string }).action.startsWith("fin"); guard += 1) {
      fitted.push((state.pendingDecision.legalCommands[0].payload as { shipId: string }).shipId);
      expect(state.pendingDecision.legalCommands).toHaveLength(1);
      state = act(state, 0);
    }
    expect(fitted).toEqual(["ship-crown-yard", "ship-crown-yard-2", "ship-ann-yard"]);
    expect(state.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(cubes - 1);
    expect(state.company.ships.every((ship) => ship.location !== "shipyard")).toBe(true);
    expect(state.company.offices["manager-of-shipping"].treasury).toBe(0);
  });

  it("buys Company ships by climate, then leases extra ships with what is left", () => {
    const counts = (state: GameState) => ({
      company: state.company.ships.filter((ship) => ship.kind === "company").length,
      extra: state.company.ships.filter((ship) => ship.kind === "extra").length,
    });
    const run = (climate: CrownClimate) => {
      let state = manager(climate, 12, []);
      state = crownPlays(state);
      return { state, ...counts(state) };
    };
    expect(run("bull")).toMatchObject({ company: 0, extra: 6 }); // will not buy: lease 6 x £2
    expect(run("stag")).toMatchObject({ company: 1, extra: 3 });
    expect(run("lion")).toMatchObject({ company: 2, extra: 1 });
    expect(run("peacock")).toMatchObject({ company: 0, extra: 6 });
  });

  it("places ships by climate: Lion in a Crown Presidency's sea zone; Peacock in China when open", () => {
    const lion = manager("lion", 4, [], (state) => withOffice(state, "president-madras", CROWN));
    expect(lion.pendingDecision.legalCommands[0].payload).toEqual({ action: "lease", to: "south-indian" });
    expect(lion.pendingDecision.crown!.reason).toContain("a Crown Presidency's sea zone");
    const peacock = manager("peacock", 4, [], (state) => ({
      ...state,
      company: { ...state.company, offices: { ...state.company.offices, "superintendent-of-trade-in-china": { id: "superintendent-of-trade-in-china", treasury: 0, fatigue: 0, vacant: true, created: true, actedThisTurn: false } } },
    }));
    expect(peacock.pendingDecision.legalCommands[0].payload).toEqual({ action: "lease", to: "china" });
  });

  it("can be told to buy, not buy, or leave £2 unspent by favours", () => {
    const state = manager("bull", 12, []);
    const buy = crownFavorOffers(state, ANN).find((offer) => offer.favorId === "shipping.buyOne")!;
    expect(buy.cubes).toBe(-1);
    const bought = crownPlays(command(state, ANN, "crown.favor", { favorId: "shipping.buyOne" }));
    expect(bought.company.ships.filter((ship) => ship.kind === "company")).toHaveLength(1);
    const spare = crownPlays(command(state, ANN, "crown.favor", { favorId: "shipping.leaveTwo" }));
    expect(spare.company.offices["manager-of-shipping"].treasury).toBeGreaterThanOrEqual(2);
    expect(crownFavorOffers(state, ANN).some((offer) => offer.favorId === "shipping.buyNone")).toBe(false); // Bull: not on offer
  });
});

describe("the Crown as Military Affairs (p.9)", () => {
  function affairs(climate: CrownClimate, current?: object): GameState {
    let state = operate({
      climate,
      offices: { "military-affairs": CROWN, "president-bengal": CROWN, "president-bombay": ANN, "president-madras": ANN },
      acted: ["chairman", "director-of-trade", "manager-of-shipping"],
      current: current ? { office: "military-affairs", ...current } : undefined,
    });
    state = withRegiments(state, { Bombay: { ready: 0, exhausted: 0 }, Madras: { ready: 2, exhausted: 0 }, Bengal: { ready: 0, exhausted: 0 } });
    return crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
  }

  it("transfers regiments from a player Presidency's Army to a Crown Presidency's (Bull), twice, then assigns", () => {
    let state = affairs("bull");
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "moveRegiment", from: "Madras", to: "Bengal" });
    state = act(state, 0);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "moveRegiment", from: "Madras", to: "Bengal" });
    state = act(state, 0);
    expect(state.company.armies.Bengal.regiments.ready).toBe(2);
  });

  it("does not undo a transfer and stops when none is left (Lion)", () => {
    let state = affairs("lion", { stage: "transfers", transfersMade: 1, armiesResolved: [], moves: [{ kind: "regiment", from: "Bengal", to: "Madras" }] });
    state = withRegiments(state, { Bombay: { ready: 0, exhausted: 0 }, Madras: { ready: 1, exhausted: 0 }, Bengal: { ready: 0, exhausted: 0 } });
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    // Madras holds the only regiment and would send it back to Bengal, undoing the earlier move.
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "endTransfers" });
  });

  it("assigns the players' officers first, to the Army the priority picks (Bull: a Crown Presidency)", () => {
    let state = affairs("bull", { stage: "assign", transfersMade: 2, armiesResolved: [] });
    state = withOfficersInTraining(withOfficersInTraining(state, ANN, 1), CROWN, 1);
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "assignOfficer", playerId: ANN, army: "Bengal" });
    state = act(state, 0);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "assignOfficer", playerId: CROWN, army: "Bengal" });
  });

  it("in Bear first looks for a new Crown majority before a Crown Presidency", () => {
    let state = affairs("bear", { stage: "assign", transfersMade: 2, armiesResolved: [] });
    state = withOfficers(withOfficers(state, ANN, "Bombay", { ready: 1 }), CROWN, "Madras", { ready: 0 });
    state = withOfficersInTraining(state, CROWN, 1);
    // No Army has Crown pieces: a Crown officer creates a majority in every Army, so the next steps decide: Governor, Commander, Crown Presidency.
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "assignOfficer", playerId: CROWN, army: "Bengal" });
  });

  it("appoints its own officer Commander when it is one of several eligible", () => {
    let state = affairs("bull", { stage: "commanders", transfersMade: 2, armiesResolved: ["Bombay", "Bengal"] });
    state = withOfficers(withOfficers(state, ANN, "Madras", { ready: 1 }), CROWN, "Madras", { ready: 1 });
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(state.pendingDecision.legalCommands[0].payload).toEqual({ action: "appointCommander", army: "Madras", playerId: CROWN });
  });

  it("makes a human Military Affairs assign the Crown as Commander, and pays them a cube for it", () => {
    let state = operate({
      offices: { "military-affairs": ANN },
      acted: ["chairman", "director-of-trade", "manager-of-shipping"],
      current: { office: "military-affairs", stage: "commanders", transfersMade: 2, armiesResolved: ["Bombay", "Bengal"] },
    });
    state = withOfficers(withOfficers(state, ANN, "Madras", { ready: 1 }), CROWN, "Madras", { ready: 1 });
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    expect(state.pendingDecision.actor).toBe(ANN);
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    const cubes = state.crown!.promiseCubes.byHumanPlayer[ANN];
    const next = act(state, 0);
    expect(next.company.armies.Madras.commander).toBe(CROWN);
    expect(next.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(cubes + 1);
  });

  it("offers favours to transfer or prevent a transfer, and to place an officer", () => {
    const state = affairs("bull");
    const ids = crownFavorOffers(state, ANN).map((offer) => offer.favorId);
    expect(ids).toEqual(expect.arrayContaining(["military.chooseTransfer", "military.preventTransfer"]));
    const prevented = command(state, ANN, "crown.favor", { favorId: "military.preventTransfer" });
    const once = act(prevented, 0);
    expect(once.pendingDecision.legalCommands[0].payload).toEqual({ action: "endTransfers" });
  });
});

describe("human officeholders' cubes (pp.4-9)", () => {
  it("charges a human Chairman 1 cube for acting, and pays +1 for £3 to a Crown office in Bull", () => {
    const state = operate({ offices: { chairman: ANN, "president-bengal": CROWN }, balance: 3 });
    const cubes = state.crown!.promiseCubes.byHumanPlayer[ANN];
    expect(state.pendingDecision.legalCommands.some((legal) => (legal.payload as { amount?: number }).amount === 4)).toBe(false); // balance 3: no £4
    const gave = act(state, state.pendingDecision.legalCommands.find((legal) => {
      const payload = legal.payload as { action: string; officeId?: string; amount?: number };
      return payload.officeId === "president-bengal" && payload.amount === 3;
    })!);
    expect(gave.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(cubes + 1);
    const finished = act(gave, gave.pendingDecision.legalCommands.find((legal) => (legal.payload as { action: string }).action === "finish")!);
    expect(finished.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(cubes);
  });

  it("offers the £4 allocation that earns a cube in Stag", () => {
    const state = operate({ climate: "stag", offices: { chairman: ANN, "president-bengal": CROWN }, balance: 6 });
    const four = state.pendingDecision.legalCommands.find((legal) => {
      const payload = legal.payload as { officeId?: string; amount?: number };
      return payload.officeId === "president-bengal" && payload.amount === 4;
    })!;
    expect(four).toBeDefined();
    expect(act(state, four).crown!.promiseCubes.byHumanPlayer[ANN]).toBe(state.crown!.promiseCubes.byHumanPlayer[ANN] + 1);
  });

  it("pays a Governor General for taxing a Crown office, and a Manager for fitting a Crown ship", () => {
    let state = operate({
      offices: { "director-of-trade": undefined, "governor-general": ANN, "president-bengal": CROWN },
      acted: ["chairman"],
      build: controlHomeRegions,
      current: { office: "governor-general", stage: "choices", choicesRemaining: 1, taxRegions: [] },
    });
    state = { ...state, company: { ...state.company, governorGeneralInPlay: true, offices: { ...state.company.offices, "governor-general": { ...state.company.offices["governor-general"], created: true } } } };
    state = crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
    const cubes = state.crown!.promiseCubes.byHumanPlayer[ANN];
    const taxed = act(state, state.pendingDecision.legalCommands.find((legal) => (legal.payload as { to?: string }).to === "president-bengal")!);
    expect(taxed.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(cubes + 1);

    let shipping = operate({ offices: { "manager-of-shipping": ANN, "president-bombay": ANN }, acted: ["chairman", "director-of-trade"] });
    shipping = shipyard(shipping, CROWN, "crown-yard");
    shipping = withTreasury(shipping, "manager-of-shipping", 3);
    shipping = crownizeDecision({ ...shipping, pendingDecision: createNextCompanyOperationDecision(shipping) });
    const fit = shipping.pendingDecision.legalCommands.find((legal) => {
      const payload = legal.payload as { action: string; to?: string };
      return payload.action === "fit" && payload.to === "west-indian"; // no Crown President there: only "Fit a Crown ship" pays
    })!;
    expect(act(shipping, fit).crown!.promiseCubes.byHumanPlayer[ANN]).toBe(shipping.crown!.promiseCubes.byHumanPlayer[ANN] + 1);
  });

  it("covers Bonuses for the Crown's workshops like any family's", () => {
    let state = operate({ acted: ["chairman", "director-of-trade", "manager-of-shipping", "military-affairs", "president-bombay", "president-madras", "president-bengal"] });
    state = {
      ...state,
      players: { ...state.players, crown: { ...state.players.crown, enterprises: [{ id: "w1", type: "workshop" }, { id: "w2", type: "workshop" }] } },
    };
    state = { ...state, phase: "bonuses", pendingDecision: createNextCompanyOperationDecision(state) };
    expect(state.pendingDecision.step).toBe("bonuses.confirm");
    const cash = state.players.crown.cash;
    expect(act(state, 0).players.crown.cash).toBe(cash + 2);
  });
});

// A Presidency named in an assertion, to keep the type import honest.
export type _Presidency = PresidencyId;
