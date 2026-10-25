import { describe, expect, it } from "vitest";
import {
  companyShareCount,
  crownFavorOffers,
  crownizeDecision,
  type CrownClimate,
  type GameState,
  type LegalCommand,
  type GameCommand,
  type OfficeId,
} from "../../engine";
import { presidenciesCrown } from "../../engine/crown/areas/presidencies";
import { createNextCompanyOperationDecision } from "../../engine/phases/company-operation";
import { withActivity } from "../../engine/phases/company-operation/presidency-progress";
import { withCo } from "../../engine/phases/company-operation/context";
import { withAssociatedRegion, withCommander, withOffice, withOfficers, withRegiments, withWriters } from "../fixtures/builders";
import { OFFICES_BEFORE_PRESIDENCIES, withDice, withOrder, withRegion, withShips } from "../fixtures/company-operation";
import { act, command, crownPlays, startedCrownGame } from "../fixtures/crown";

const ANN = "player-ann";
const BEN = "player-ben";
const CROWN = "crown";
const BEFORE_MADRAS: OfficeId[] = [...OFFICES_BEFORE_PRESIDENCIES, "president-bombay"];

/** A Crown game in Company Operation with the Crown President of Madras holding £`treasury`. */
function scene(options: { climate?: CrownClimate; players?: 1 | 2; treasury?: number; ships?: number } = {}): GameState {
  let state = startedCrownGame({ players: options.players, seed: "presidencies" });
  state = { ...state, crown: { ...state.crown!, climate: options.climate ?? "lion" } };
  state = withOffice(state, "president-madras", CROWN, { treasury: options.treasury ?? 10 });
  state = withCommander(state, "Madras", undefined);
  state = withShips(state, "south-indian", options.ships ?? 5);
  state = { ...state, phase: "companyOperation", companyOperation: { turn: state.turn, actedOffices: BEFORE_MADRAS } };
  return redecide(state);
}

/** Rebuilds the Company Operation decision from the state and lets the Crown decide it. */
function redecide(state: GameState): GameState {
  return crownizeDecision({ ...state, pendingDecision: createNextCompanyOperationDecision(state) });
}

const payload = (legal: LegalCommand) => (legal.payload ?? {}) as Record<string, unknown>;
const only = (state: GameState): Record<string, unknown> => {
  expect(state.pendingDecision.legalCommands).toHaveLength(1);
  return payload(state.pendingDecision.legalCommands[0]);
};
const reason = (state: GameState) => state.pendingDecision.crown?.reason ?? "";

function activityOf(state: GameState) {
  const current = state.companyOperation.current;
  return current?.office === "presidency" ? current.activity : undefined;
}

/** Puts a Madras Governor or Commander activity in place and lets the Crown decide it. */
function inActivity(state: GameState, activity: Parameters<typeof withActivity>[2]): GameState {
  return redecide(withActivity(state, "Madras", activity));
}

describe("Presidency operations (Handbook p.10)", () => {
  it("makes Governors act first in order of formation, then the Commander, then Trade", () => {
    let state = scene();
    state = withAssociatedRegion(state, "mysore", "Madras");
    state = withAssociatedRegion(state, "hyderabad", "Madras");
    // Hyderabad's Governorship was formed first.
    state = withOffice(state, "governor-hyderabad", ANN);
    state = withOffice(state, "governor-mysore", CROWN);
    state = withCommander(state, "Madras", ANN);
    state = redecide(state);

    expect(only(state)).toEqual({ action: "governor", presidency: "Madras", officeId: "governor-hyderabad" });
    expect(reason(state)).toMatch(/Governors act first, in order of formation/);

    state = withActivity(state, "Madras", undefined);
    state = withCo(state, { current: { office: "presidency", presidency: "Madras", commanderDone: false, governorsDone: ["governor-hyderabad", "governor-mysore"] } });
    state = redecide(state);
    expect(only(state)).toEqual({ action: "commander", presidency: "Madras" });

    state = withCo(state, { current: { office: "presidency", presidency: "Madras", commanderDone: true, governorsDone: ["governor-hyderabad", "governor-mysore"] } });
    state = redecide(state);
    expect(only(state)).toEqual({ action: "trade", presidency: "Madras" });
    expect(reason(state)).toMatch(/attempts Trade, needing 4 dice/);
  });

  it("does not Trade when the treasury cannot pay for the required dice", () => {
    const state = scene({ treasury: 3, climate: "lion" });
    expect(only(state)).toEqual({ action: "end", presidency: "Madras" });
    expect(reason(state)).toMatch(/cannot pay for 4 dice/);
  });

  it("offers the single-change favour while the Crown President is choosing", () => {
    const state = scene();
    expect(crownFavorOffers(state, ANN).map((offer) => offer.favorId)).toContain("presidencies.order");
  });
});

describe("Trade (Handbook p.13)", () => {
  it.each([
    ["bull", 2],
    ["stag", 3],
    ["lion", 4],
    ["bear", 5],
    ["peacock", 6],
  ] as const)("%s: needs %i dice, and spends up to £3 more", (climate, dice) => {
    let state = scene({ climate, treasury: 12, ships: 3 });
    state = act(state, state.pendingDecision.legalCommands[0]);
    expect(state.pendingDecision.step).toBe("companyOperation.trade.declare");
    // Whatever route it chose, every region it declares costs a die.
    for (let guard = 0; guard < 4 && payload(state.pendingDecision.legalCommands[0]).action === "declare"; guard += 1) {
      state = act(state, state.pendingDecision.legalCommands[0]);
    }
    const roll = only(state);
    const declared = (activityOf(state) as { declared: string[] }).declared.length;
    expect(roll).toEqual({ action: "roll", spend: Math.min(12, declared - 1 + dice + 3) });
    expect(reason(state)).toMatch(new RegExp(`${dice} dice needed`));
  });

  it("trades in fewer regions when that is the only way to reach the required dice", () => {
    // Home region only: Madras's own orders; extra regions cost a die each.
    let rich = scene({ treasury: 12, ships: 5 });
    rich = act(rich, rich.pendingDecision.legalCommands[0]);
    let poor = scene({ treasury: 4, ships: 5 });
    poor = act(poor, poor.pendingDecision.legalCommands[0]);
    const declaredRich = (activityOf(rich) as { declared: string[] }).declared;
    expect(declaredRich).toEqual(["madras"]);
    // £4 buys exactly the 4 dice (lion): no region beyond the home region is affordable.
    expect(only(poor)).toEqual({ action: "roll", spend: 4 });
  });

  it("fills the highest value route, with its own writers first", () => {
    let state = scene({ treasury: 12, ships: 2 });
    state = withWriters(state, CROWN, "Madras", 1);
    state = withWriters(state, ANN, "Madras", 2);
    state = act(state, state.pendingDecision.legalCommands[0]);
    // Force a successful Trade: go straight to placing.
    state = redecide(
      withActivity(state, "Madras", { kind: "trade", stage: "place", declared: ["madras"], ships: 2, placedOrderIds: [] }),
    );
    expect(state.pendingDecision.step).toBe("companyOperation.trade.place");
    expect(payload(state.pendingDecision.legalCommands[0])).toMatchObject({ action: "place", writer: CROWN });
    expect(reason(state)).toMatch(/its own writer first/);
  });

  it("2P: places the Player Button holder's writer after its own run out, and passes the Button", () => {
    let state = scene({ treasury: 12, ships: 2, players: 2 });
    state = withWriters(state, ANN, "Madras", 1);
    state = withWriters(state, BEN, "Madras", 1);
    state = { ...state, crown: { ...state.crown!, playerButton: { holder: BEN } } };
    state = redecide(withActivity(state, "Madras", { kind: "trade", stage: "place", declared: ["madras"], ships: 2, placedOrderIds: [] }));
    expect(payload(state.pendingDecision.legalCommands[0])).toMatchObject({ action: "place", writer: BEN });
    expect(state.pendingDecision.crown?.passButton).toBe(true);
    const after = act(state, state.pendingDecision.legalCommands[0]);
    expect(after.crown!.playerButton?.holder).toBe(ANN);
  });

  it("the -1 favour makes the Crown place the buyer's writer instead of another", () => {
    let state = scene({ treasury: 12, ships: 2, players: 2 });
    state = withWriters(state, ANN, "Madras", 1);
    state = withWriters(state, BEN, "Madras", 1);
    state = { ...state, crown: { ...state.crown!, playerButton: { holder: BEN } } };
    state = redecide(withActivity(state, "Madras", { kind: "trade", stage: "place", declared: ["madras"], ships: 2, placedOrderIds: [] }));
    expect(crownFavorOffers(state, ANN).map((offer) => offer.favorId)).toContain("presidencies.trade.writer");
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.trade.writer" });
    expect(payload(state.pendingDecision.legalCommands[0])).toMatchObject({ action: "place", writer: ANN });
    expect(reason(state)).toMatch(/favour/);
  });

  it("the dice favour changes the required dice, and ends with the roll", () => {
    let state = scene({ treasury: 12 });
    expect(reason(state)).toMatch(/needing 4 dice/);
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.trade.dice", option: { scope: "trade:Madras", delta: 1 } });
    expect(reason(state)).toMatch(/needing 5 dice/);
    state = act(state, state.pendingDecision.legalCommands[0]);
    // Declared everything it wanted; the roll is the next decision.
    while (payload(state.pendingDecision.legalCommands[0]).action === "declare") state = act(state, state.pendingDecision.legalCommands[0]);
    expect(reason(state)).toMatch(/5 dice needed/);
  });
});

describe("Governors (Handbook p.10)", () => {
  function governor(climate: CrownClimate, activity: { dicePool: number; awaitingChoice?: boolean }, options: { president?: boolean } = {}): GameState {
    let state = scene({ climate });
    if (options.president === false) state = withOffice(state, "president-madras", ANN, { treasury: 10 });
    state = withAssociatedRegion(state, "mysore", "Madras");
    state = withOffice(state, "governor-mysore", CROWN);
    return inActivity(state, { kind: "governor", officeId: "governor-mysore", dicePool: activity.dicePool, taxes: 0, awaitingChoice: activity.awaitingChoice ?? false });
  }

  it.each([
    ["bull", 3],
    ["stag", 2],
    ["lion", 2],
    ["bear", 2],
    ["peacock", 1],
  ] as const)("%s: Administers only while it can roll %i dice", (climate, required) => {
    const enough = governor(climate, { dicePool: required });
    expect(only(enough)).toEqual({ action: "administer" });
    const short = governor(climate, { dicePool: required - 1 });
    expect(only(short)).toEqual({ action: "stop" });
    expect(reason(short)).toMatch(new RegExp(`${required} ${required === 1 ? "die" : "dice"} required`));
  });

  it("the dice favour moves the requirement for that Governor", () => {
    let state = governor("lion", { dicePool: 2 });
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.governor.dice", option: { scope: "governor:governor-mysore", delta: 1 } });
    expect(only(state)).toEqual({ action: "stop" });
  });

  it("'take no Administer actions' makes it stop", () => {
    let state = governor("bull", { dicePool: 4 });
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.governor.none", option: { scope: "governor:governor-mysore" } });
    expect(only(state)).toEqual({ action: "stop" });
  });

  it("Bull and Stag tax into the Crown President's treasury; Lion builds a ship; Bear and Peacock commission a regiment", () => {
    expect(only(governor("bull", { dicePool: 2, awaitingChoice: true }))).toEqual({ action: "tax", to: "president" });
    expect(only(governor("stag", { dicePool: 2, awaitingChoice: true }))).toEqual({ action: "tax", to: "president" });
    expect(only(governor("lion", { dicePool: 2, awaitingChoice: true }))).toEqual({ action: "buildShip" });
    expect(only(governor("bear", { dicePool: 2, awaitingChoice: true }))).toEqual({ action: "commissionRegiment" });
    expect(only(governor("peacock", { dicePool: 2, awaitingChoice: true }))).toEqual({ action: "commissionRegiment" });
  });

  it("taxes the Company Balance when a player is President", () => {
    expect(only(governor("bull", { dicePool: 2, awaitingChoice: true }, { president: false }))).toEqual({ action: "tax", to: "balance" });
  });

  it("the -2 favour lets the buyer choose a different result", () => {
    let state = governor("lion", { dicePool: 2, awaitingChoice: true });
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.governor.result" });
    expect(state.pendingDecision.legalCommands.length).toBeGreaterThan(1);
    expect(state.pendingDecision.crown?.chooser).toBe(ANN);
  });
});

describe("Trade in China (Handbook p.13)", () => {
  function china(climate: CrownClimate, ships: number): GameState {
    let state = startedCrownGame({ seed: "china" });
    state = { ...state, crown: { ...state.crown!, climate } };
    state = withOffice(state, "superintendent-of-trade-in-china", CROWN);
    state = withShips(state, "china", ships);
    state = withRegion(state, "madras", { companyControlled: true, exportIcons: 1 });
    state = {
      ...state,
      phase: "companyOperation",
      companyOperation: { turn: state.turn, actedOffices: [...BEFORE_MADRAS, "president-madras", "president-bengal"] },
    };
    return redecide(state);
  }

  it.each([
    ["bull", 1],
    ["stag", 2],
    ["lion", 2],
    ["bear", 3],
    ["peacock", 3],
  ] as const)("%s: trades with at least %i dice", (climate, required) => {
    const state = china(climate, required);
    expect(state.pendingDecision.step).toBe("companyOperation.china");
    expect(only(state)).toEqual({ action: "trade" });
    if (required > 1) expect(only(china(climate, required - 1))).toEqual({ action: "finish" });
  });

  it("the dice favour changes the requirement", () => {
    let state = china("bull", 1);
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.china.dice", option: { scope: "china", delta: 1 } });
    expect(only(state)).toEqual({ action: "finish" });
  });
});

describe("Commanders (Handbook pp.11-12)", () => {
  function commander(climate: CrownClimate, stage: "alliances" | "deploy", setup: (state: GameState) => GameState = (state) => state): GameState {
    let state = scene({ climate, treasury: 10 });
    state = withCommander(state, "Madras", CROWN);
    state = setup(state);
    return inActivity(state, { kind: "commander", stage });
  }
  const withAlliances = (ready: string[]) => (state: GameState): GameState => ({
    ...state,
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        Madras: {
          ...state.company.armies.Madras,
          localAlliances: Object.fromEntries(["alliance-the-nizam", "alliance-arcot"].map((id) => [id, ready.includes(id) ? "ready" : "exhausted"])),
        },
      },
    },
  });
  const strong = (state: GameState) => withOfficers(withRegiments(state, { Madras: { ready: 3, exhausted: 0 } }), CROWN, "Madras", { ready: 2 });

  it("a Crown President's refusal stands: the Commander isn't offered that alliance again", () => {
    let state = scene({ climate: "lion", treasury: 10 });
    state = withCommander(state, "Madras", ANN);
    state = withAlliances([])(state);
    state = inActivity(state, { kind: "commander", stage: "alliances" });
    const buy = (id: string) => state.pendingDecision.legalCommands.find((legal) => payload(legal).allianceId === id);
    state = act(state, buy("alliance-arcot")!);
    expect(state.pendingDecision.step).toBe("companyOperation.allianceConsent");
    state = act(state, state.pendingDecision.legalCommands[0]);
    expect(buy("alliance-arcot")).toBeUndefined();
    expect(buy("alliance-the-nizam")).toBeDefined();
  });

  it("Bull and Stag buy no Local Alliance", () => {
    expect(only(commander("bull", "alliances", strong))).toEqual({ action: "beginDeploys" });
    expect(only(commander("stag", "alliances", strong))).toEqual({ action: "beginDeploys" });
  });

  it("Lion with an Army of strength 3+ buys the cheapest affordable Local Alliance", () => {
    expect(only(commander("lion", "alliances", strong))).toEqual({ action: "buyAlliance", allianceId: "alliance-the-nizam" });
    expect(only(commander("lion", "alliances", (s) => withRegiments(s, { Madras: { ready: 1, exhausted: 0 } })))).toEqual({ action: "beginDeploys" });
  });

  it("Bear and Peacock with strength 2+ buy the most expensive affordable one", () => {
    expect(only(commander("bear", "alliances", strong))).toEqual({ action: "buyAlliance", allianceId: "alliance-arcot" });
    expect(only(commander("peacock", "alliances", (s) => withRegiments(s, { Madras: { ready: 2, exhausted: 0 } })))).toEqual({
      action: "buyAlliance",
      allianceId: "alliance-arcot",
    });
  });

  it("buys one, then moves on; the 'more expensive' and 'will not purchase' favours change it", () => {
    let state = commander("lion", "alliances", strong);
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.commander.alliance.dearer", option: { scope: "commander:Madras" } });
    expect(only(state)).toEqual({ action: "buyAlliance", allianceId: "alliance-arcot" });
    let none = commander("lion", "alliances", strong);
    none = command(none, ANN, "crown.favor", { favorId: "presidencies.commander.alliance.none", option: { scope: "commander:Madras" } });
    expect(only(none)).toEqual({ action: "beginDeploys" });
    const plain = commander("lion", "alliances", strong);
    expect(only(act(plain, plain.pendingDecision.legalCommands[0]))).toEqual({ action: "beginDeploys" });
  });

  it("the extra-purchase favour buys the Local Alliance of the buyer's choice as well", () => {
    let state = commander("lion", "alliances", strong);
    state = command(state, ANN, "crown.favor", { favorId: "presidencies.commander.alliance.extra", option: { scope: "commander:Madras", allianceId: "alliance-arcot" } });
    state = act(state, state.pendingDecision.legalCommands[0]);
    expect(only(state)).toEqual({ action: "buyAlliance", allianceId: "alliance-arcot" });
    expect(reason(state)).toMatch(/extra Local Alliance/);
  });

  describe("choosing where to Deploy", () => {
    // Madras is Company-controlled (with a closed order); Mysore, next to it, is not.
    const scenario = (state: GameState) =>
      withOrder(
        withRegion(withOfficers(withAssociatedRegion(state, "madras", "Madras"), CROWN, "Madras", { ready: 6 }), "mysore", { towerLevels: 0 }),
        "madras-south-4",
        { closed: true },
      );

    it("Bull and Stag restore the home region with closed orders first", () => {
      const state = commander("bull", "deploy", scenario);
      expect(only(state)).toMatchObject({ action: "target", regionId: "madras" });
      expect(reason(state)).toMatch(/home region with closed orders/);
    });

    it("Lion, Bear and Peacock go for a region next to the Company's before restoring one", () => {
      const state = commander("lion", "deploy", scenario);
      expect(["mysore", "hyderabad"]).toContain(only(state).regionId);
      expect(reason(state)).toMatch(/next to a Company region of this Presidency/);
    });

    it("finishes when no target can be matched exactly", () => {
      const state = commander("bull", "deploy", (s) => withOfficers(withRegion(withAssociatedRegion(s, "madras", "Madras"), "mysore", { towerLevels: 0 }), CROWN, "Madras", { ready: 0 }));
      expect(only(state)).toEqual({ action: "finish" });
    });

    it("Deploys once, or again on Bear and Peacock; the favours flip that", () => {
      const second = (climate: CrownClimate) => {
        let state = withCommander(scenario(scene({ climate, treasury: 10 })), "Madras", CROWN);
        state = withOfficers(state, CROWN, "Madras", { ready: 6 });
        return inActivity(state, { kind: "commander", stage: "deploy", deploys: 1 });
      };
      expect(only(second("lion"))).toEqual({ action: "finish" });
      expect(only(second("bear"))).toMatchObject({ action: "target" });
      const again = command(second("lion"), ANN, "crown.favor", { favorId: "presidencies.commander.again", option: { scope: "commander:Madras" } });
      expect(only(again)).toMatchObject({ action: "target" });
      const notAgain = command(second("bear"), ANN, "crown.favor", { favorId: "presidencies.commander.notAgain", option: { scope: "commander:Madras" } });
      expect(only(notAgain)).toEqual({ action: "finish" });
    });

    it("the -2 favour lets the buyer choose the target", () => {
      let state = commander("bull", "deploy", scenario);
      state = command(state, ANN, "crown.favor", { favorId: "presidencies.deploy.target" });
      expect(state.pendingDecision.crown?.chooser).toBe(ANN);
      expect(state.pendingDecision.legalCommands.every((legal) => payload(legal).action === "target")).toBe(true);
    });
  });

  describe("exhausting pieces to match the dice exactly", () => {
    const empty = { officers: {}, regiments: 0, alliances: [] as string[] };
    function exhausting(climate: CrownClimate, setup: (state: GameState) => GameState, selection = empty): GameState {
      let state = scene({ climate, treasury: 10 });
      state = withCommander(state, "Madras", CROWN);
      state = withRegion(state, "madras", { towerLevels: 0 });
      state = setup(state);
      return inActivity(state, { kind: "commander", stage: "exhaust", target: "madras", selection });
    }

    it("Local Alliances first, then Crown officers, then player officers, then regiments", () => {
      // Lion, non-Company Madras: 4 dice. A 2-strength alliance, a Crown officer, a player officer.
      const setup = (state: GameState) =>
        withRegiments(withOfficers(withOfficers(withAlliances(["alliance-the-nizam"])(state), CROWN, "Madras", { ready: 1 }), ANN, "Madras", { ready: 3 }), {
          Madras: { ready: 3, exhausted: 0 },
        });
      let state = exhausting("lion", setup);
      expect(only(state)).toEqual({ action: "exhaustAlliance", allianceId: "alliance-the-nizam" });
      state = act(state, state.pendingDecision.legalCommands[0]);
      expect(only(state)).toEqual({ action: "exhaustOfficer", playerId: CROWN });
      state = act(state, state.pendingDecision.legalCommands[0]);
      expect(only(state)).toEqual({ action: "exhaustOfficer", playerId: ANN });
      state = act(state, state.pendingDecision.legalCommands[0]);
      expect(only(state)).toEqual({ action: "roll" });
      expect(reason(state)).toMatch(/4 dice/);
    });

    it("skips a piece that would overshoot the exact number", () => {
      // Peacock: 2 dice to roll against Madras strength 1 = 3 pieces' worth. Two 2-strength alliances, one officer.
      const setup = (state: GameState) =>
        withOfficers(withRegion(withAlliances(["alliance-the-nizam", "alliance-arcot"])(state), "madras", { towerLevels: 1 }), CROWN, "Madras", { ready: 1 });
      let state = exhausting("peacock", setup);
      state = act(state, state.pendingDecision.legalCommands[0]);
      expect(only(state)).toEqual({ action: "exhaustOfficer", playerId: CROWN });
      state = act(state, state.pendingDecision.legalCommands[0]);
      expect(only(state)).toEqual({ action: "roll" });
    });

    it("the dice favour changes how many pieces it commits", () => {
      const setup = (state: GameState) => withOfficers(state, CROWN, "Madras", { ready: 6 });
      let state = exhausting("peacock", setup, { officers: { [CROWN]: 2 }, regiments: 0, alliances: [] });
      expect(only(state)).toEqual({ action: "roll" });
      state = command(state, ANN, "crown.favor", { favorId: "presidencies.commander.dice", option: { scope: "commander:Madras", delta: 1 } });
      expect(only(state)).toEqual({ action: "exhaustOfficer", playerId: CROWN });
    });

    it("-X: exchanges exhausted pieces for ones that were not, once they match", () => {
      const setup = (state: GameState) => withRegiments(withOfficers(state, CROWN, "Madras", { ready: 2 }), { Madras: { ready: 2, exhausted: 0 } });
      let state = exhausting("peacock", setup, { officers: { [CROWN]: 2 }, regiments: 0, alliances: [] });
      expect(only(state)).toEqual({ action: "roll" });
      const offers = crownFavorOffers(state, ANN).filter((offer) => offer.favorId === "presidencies.commander.exchange");
      expect(offers.length).toBeGreaterThan(0);
      const swap = offers.find(
        (offer) => (offer.option as { out: string[]; in: string[] }).out[0] === `officer:${CROWN}` && (offer.option as { in: string[] }).in[0] === "regiment",
      )!;
      expect(swap.cubes).toBe(-1);
      state = command(state, ANN, "crown.favor", { favorId: "presidencies.commander.exchange", option: swap.option });
      const selection = (activityOf(state) as { selection: { officers: Record<string, number>; regiments: number } }).selection;
      expect(selection.officers[CROWN]).toBe(1);
      expect(selection.regiments).toBe(1);
      expect(only(state)).toEqual({ action: "roll" });
    });

    it("2P: takes the Player Button holder's officers first and passes the Button", () => {
      let state = startedCrownGame({ players: 2, seed: "presidencies" });
      state = { ...state, crown: { ...state.crown!, climate: "lion", playerButton: { holder: BEN } } };
      state = withOffice(state, "president-madras", CROWN, { treasury: 10 });
      state = withCommander(state, "Madras", CROWN);
      state = withRegion(state, "madras", { towerLevels: 0 });
      state = withOfficers(withOfficers(state, ANN, "Madras", { ready: 4 }), BEN, "Madras", { ready: 4 });
      state = { ...state, phase: "companyOperation", companyOperation: { turn: state.turn, actedOffices: BEFORE_MADRAS } };
      state = inActivity(state, { kind: "commander", stage: "exhaust", target: "madras", selection: empty });
      expect(only(state)).toEqual({ action: "exhaustOfficer", playerId: BEN });
      expect(state.pendingDecision.crown?.passButton).toBe(true);
    });
  });
});

describe("Local Alliance consent (Handbook p.11)", () => {
  function asking(climate: CrownClimate): GameState {
    let state = scene({ climate, treasury: 10 });
    state = withCommander(state, "Madras", ANN);
    state = redecide(state);
    state = act(state, state.pendingDecision.legalCommands.find((legal) => payload(legal).action === "commander")!);
    return act(state, state.pendingDecision.legalCommands.find((legal) => payload(legal).action === "buyAlliance")!);
  }

  it("a Crown President refuses a player Commander's Local Alliance", () => {
    const state = asking("lion");
    expect(state.pendingDecision.step).toBe("companyOperation.allianceConsent");
    expect(only(state)).toEqual({ action: "refuseAlliance" });
    expect(reason(state)).toMatch(/no consent/);
  });

  it("the consent favour buys it, at the climate's price", () => {
    const state = asking("lion");
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "presidencies.alliance.consent")!;
    expect(offer.cubes).toBe(-1);
    const bought = command(state, ANN, "crown.favor", { favorId: "presidencies.alliance.consent" });
    expect(only(bought)).toEqual({ action: "approveAlliance" });
    // Bear and Peacock: free.
    expect(crownFavorOffers(asking("bear"), ANN).find((candidate) => candidate.favorId === "presidencies.alliance.consent")?.cubes).toBe(0);
  });

  it("a player President who consents to the Crown Commander earns a cube", () => {
    let state = scene({ climate: "lion", treasury: 10 });
    state = withOffice(state, "president-madras", ANN, { treasury: 10 });
    state = withCommander(state, "Madras", CROWN);
    state = withRegiments(withOfficers(state, CROWN, "Madras", { ready: 2 }), { Madras: { ready: 2, exhausted: 0 } });
    state = redecide(state);
    expect(state.pendingDecision.actor).toBe(ANN);
    state = act(state, state.pendingDecision.legalCommands.find((legal) => payload(legal).action === "commander")!);
    expect(state.pendingDecision.actor).toBe(CROWN);
    state = act(state, state.pendingDecision.legalCommands[0]);
    expect(state.pendingDecision.step).toBe("companyOperation.allianceConsent");
    expect(state.pendingDecision.actor).toBe(ANN);
    const before = state.crown!.promiseCubes.byHumanPlayer[ANN];
    state = act(state, state.pendingDecision.legalCommands.find((legal) => payload(legal).action === "approveAlliance")!);
    expect(state.crown!.promiseCubes.byHumanPlayer[ANN]).toBe(before + 1);
  });
});

/** Puts a fabricated Crown decision in front of the policies (for steps that are hard to reach). */
function crownFaces(state: GameState, step: string, commands: Array<{ type: string; payload: unknown }>): GameState {
  return crownizeDecision({
    ...state,
    pendingDecision: {
      id: `decision-test-${step}`,
      phase: state.phase,
      step,
      actor: CROWN,
      visibility: "public",
      prompt: "",
      legalCommands: commands.map((entry, index) => ({ type: entry.type, label: `option ${index}`, payload: entry.payload })),
      canSave: true,
    },
  });
}

describe("Events in India (Handbook p.14)", () => {
  const defend = [
    { type: "eventsInIndia.defend", payload: { piece: "regiment" } },
    { type: "eventsInIndia.defend", payload: { piece: "officer", playerId: ANN } },
    { type: "eventsInIndia.defend", payload: { piece: "auto" } },
  ];

  it("a Crown Commander defending a Crisis leaves every piece to the soloist", () => {
    const state = crownFaces(startedCrownGame(), "eventsInIndia.defend", defend);
    expect(state.pendingDecision.legalCommands).toHaveLength(3);
    expect(state.pendingDecision.crown?.chooser).toBe(ANN);
    expect(reason(state)).toMatch(/you choose which pieces are exhausted/);
  });

  it("in two-player games the Player Button holder chooses", () => {
    let game = startedCrownGame({ players: 2 });
    game = { ...game, crown: { ...game.crown!, playerButton: { holder: BEN } } };
    const state = crownFaces(game, "eventsInIndia.defend", defend);
    expect(state.pendingDecision.crown?.chooser).toBe(BEN);
  });

  it("never plays Envoy to the Mughals: the Crown's blackmail stays face down", () => {
    const state = crownFaces(startedCrownGame(), "eventsInIndia.envoyToTheMughals", [
      { type: "eventsInIndia.envoyToTheMughals", payload: { play: true, regionId: "delhi", facing: null } },
      { type: "eventsInIndia.envoyToTheMughals", payload: { play: false } },
    ]);
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
    expect(payload(state.pendingDecision.legalCommands[0])).toEqual({ play: false });
  });
});

describe("Revenue: dividends and Royal Protection (Handbook p.14)", () => {
  function dividends(climate: CrownClimate, balance: number): { state: GameState; shares: number } {
    let game = startedCrownGame();
    game = { ...game, phase: "revenue", crown: { ...game.crown!, climate }, company: { ...game.company, balance } };
    const shares = companyShareCount(game);
    const commands = Array.from({ length: Math.floor(balance / shares) + 1 }, (_, amountPerShare) => ({ type: "revenue.chooseDividends", payload: { amountPerShare } }));
    return { state: crownFaces(game, "revenue.chooseDividends", commands), shares };
  }
  const paid = (state: GameState) => payload(state.pendingDecision.legalCommands[0]).amountPerShare as number;

  it.each([
    ["bull", 0],
    ["stag", 2],
    ["lion", 4],
    ["bear", 6],
    ["peacock", 8],
  ] as const)("%s: pays as many dividends as leave £%i in the Balance", (climate, leave) => {
    const balance = 40;
    const { state, shares } = dividends(climate, balance);
    const amount = paid(state);
    expect(amount).toBe(Math.max(1, Math.floor((balance - leave) / shares)));
    expect(balance - amount * shares).toBeGreaterThanOrEqual(leave);
    expect(balance - (amount + 1) * shares).toBeLessThan(leave);
  });

  it("pays 1 dividend at least, if it can", () => {
    const base = dividends("peacock", 40).shares;
    expect(paid(dividends("peacock", base).state)).toBe(1);
    expect(paid(dividends("peacock", base - 1).state)).toBe(0);
  });

  it("the favours pay out one less or one more", () => {
    const { state, shares } = dividends("lion", 40);
    const normal = paid(state);
    const less = command(state, ANN, "crown.favor", { favorId: "presidencies.dividends.less" });
    expect(paid(less)).toBe(normal - 1);
    const more = command(state, ANN, "crown.favor", { favorId: "presidencies.dividends.more" });
    expect(paid(more)).toBe(Math.min(normal + 1, Math.floor(40 / shares)));
    expect(crownFavorOffers(state, ANN).find((offer) => offer.favorId === "presidencies.dividends.less")?.cubes).toBe(-1);
  });

  it("always discards Royal Protection when there are emergency loans", () => {
    const state = crownFaces(startedCrownGame(), "revenue.royalProtection", [
      { type: "revenue.royalProtection", payload: { discard: true } },
      { type: "revenue.royalProtection", payload: { discard: false } },
    ]);
    expect(payload(state.pendingDecision.legalCommands[0])).toEqual({ discard: true });
    expect(state.pendingDecision.legalCommands).toHaveLength(1);
  });
});

describe("Revenue: firms (Handbook p.14)", () => {
  function firmRevenue(shares: Record<string, number>, step: "investAsk" | "dividends" = "investAsk", players: 1 | 2 = 1): GameState {
    let game = startedCrownGame({ players });
    const court = game.company.court.find((share) => share.owner === ANN);
    // Firm shares are family pieces taken from the supply.
    game = {
      ...game,
      players: Object.fromEntries(
        Object.entries(game.players).map(([id, player]) => [
          id,
          { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - (shares[id] ?? 0) } },
        ]),
      ),
      phase: "revenue",
      firms: [{ id: "firm-1", manager: ANN, londonTreasury: 0, indiaTreasury: 10, value: 3, shares, formedTurn: 1 }],
      parliament: {
        ...game.parliament,
        revenue: {
          stage: "firms",
          fraudCandidates: [],
          scandalCandidates: [],
          firms: {
            queue: ["firm-1"],
            step,
            paid: [],
            emergencyCash: 0,
            declined: [],
            ask: { investor: CROWN, source: { kind: "companyShare", shareId: court?.id ?? "none" } },
            mergeRefused: [],
            dividendsPaid: 0,
            cashPaid: 0,
          },
        },
      },
    };
    return crownFaces(game, "revenue.firmInvestAsk", [
      { type: "revenue.firmInvestAnswer", payload: { accept: true } },
      { type: "revenue.firmInvestAnswer", payload: { accept: false } },
    ]);
  }

  it("the Crown will not invest in a firm seeking emergency investment", () => {
    const state = firmRevenue({ [ANN]: 3, [CROWN]: 1 });
    expect(payload(state.pendingDecision.legalCommands[0])).toEqual({ accept: false });
    expect(reason(state)).toMatch(/does not invest/);
  });

  it("the -4 favour makes it invest, unless that leaves it with more shares than the manager", () => {
    const state = firmRevenue({ [ANN]: 3, [CROWN]: 1 });
    const offer = crownFavorOffers(state, ANN).find((candidate) => candidate.favorId === "presidencies.firm.invest");
    expect(offer?.cubes).toBe(-4);
    const bought = command(state, ANN, "crown.favor", { favorId: "presidencies.firm.invest" });
    expect(payload(bought.pendingDecision.legalCommands[0])).toEqual({ accept: true });
    // The new share would give the Crown 2 against the manager's 1.
    expect(crownFavorOffers(firmRevenue({ [ANN]: 1, [CROWN]: 1 }), ANN).some((candidate) => candidate.favorId === "presidencies.firm.invest")).toBe(false);
  });

  it("always consents to merging firms, takes all its dividends, keeps its blackmail face down", () => {
    const game = startedCrownGame();
    const merge = crownFaces(game, "revenue.firmMergeConsent", [
      { type: "revenue.firmMergeAnswer", payload: { accept: false } },
      { type: "revenue.firmMergeAnswer", payload: { accept: true } },
    ]);
    expect(payload(merge.pendingDecision.legalCommands[0])).toEqual({ accept: true });
    const waive = crownFaces(game, "revenue.firmWaiver", [
      { type: "revenue.firmWaive", payload: { forgone: 1 } },
      { type: "revenue.firmWaive", payload: { forgone: 0 } },
    ]);
    expect(payload(waive.pendingDecision.legalCommands[0])).toEqual({ forgone: 0 });
    const fraud = crownFaces(game, "revenue.companyFraud", [
      { type: "revenue.companyFraud", payload: { play: true, cardInstanceId: "x" } },
      { type: "revenue.companyFraud", payload: { play: false } },
    ]);
    expect(payload(fraud.pendingDecision.legalCommands[0])).toEqual({ play: false });
  });

  it("firm dividends: +X (max 3) when the manager pays the Crown at least as much as any other shareholder", () => {
    const detector = presidenciesCrown.detectors.find((candidate) => candidate.favorId === "presidencies.firm.dividends")!;
    const before = firmRevenue({ [ANN]: 2, [BEN]: 2, [CROWN]: 4 }, "dividends", 2);
    const progress = before.parliament.revenue!.firms!;
    const withPayout = (cash: Record<string, number>): GameState => ({
      ...before,
      players: Object.fromEntries(Object.entries(before.players).map(([id, player]) => [id, { ...player, cash: player.cash + (cash[id] ?? 0) }])),
      parliament: { ...before.parliament, revenue: { ...before.parliament.revenue!, firms: { ...progress, dividendsPaid: 1 } } },
    });
    const cmd = { id: "c", gameId: before.gameId, actorId: ANN, decisionId: "d", type: "revenue.firmDividend", payload: { action: "pay" }, clientTimestamp: "" } as GameCommand;
    // Manager's dividend share (the charter's £2) is left out when comparing.
    const equalOrMore = detector.detect(before, withPayout({ [ANN]: 2 + 2, [BEN]: 2, [CROWN]: 4 }), cmd);
    expect(equalOrMore).toEqual([expect.objectContaining({ playerId: ANN, cubes: 3 })]);
    const lessThanBen = detector.detect(before, withPayout({ [ANN]: 4, [BEN]: 5, [CROWN]: 4 }), cmd);
    expect(lessThanBen).toEqual([]);
  });
});

describe("Free choices with firms", () => {
  it("the Handbook has no rule for who fills orders next, so the soloist chooses", () => {
    const state = crownFaces(startedCrownGame(), "companyOperation.firmFillOrder", [
      { type: "companyOperation.firmFill", payload: { action: "next", who: "company" } },
      { type: "companyOperation.firmFill", payload: { action: "next", who: "firm-1" } },
    ]);
    expect(state.pendingDecision.legalCommands).toHaveLength(2);
    expect(state.pendingDecision.crown?.chooser).toBe(ANN);
  });
});

describe("Cube detectors for human Governors, Commanders and Presidents (Handbook pp.10-13)", () => {
  const cubes = (state: GameState) => state.crown!.promiseCubes.byHumanPlayer[ANN] ?? 0;

  /** Ann is Governor of Mysore under the Crown's President of Madras, with a successful Administer to resolve. */
  function annGoverns(climate: CrownClimate = "lion"): GameState {
    let state = scene({ climate, treasury: 10 });
    state = withAssociatedRegion(state, "mysore", "Madras");
    state = withOffice(state, "governor-mysore", ANN);
    return state;
  }
  const choosing = (state: GameState, taxes = 0) => inActivity(state, { kind: "governor", officeId: "governor-mysore", dicePool: 2, taxes, awaitingChoice: true });
  const doIt = (state: GameState, match: Record<string, unknown>) =>
    act(state, state.pendingDecision.legalCommands.find((legal) => Object.entries(match).every(([key, value]) => payload(legal)[key] === value))!);

  it("+1 for adding Tax to a Crown Presidency, once per turn per Presidency", () => {
    let state = choosing(annGoverns());
    const start = cubes(state);
    state = doIt(state, { action: "tax", to: "president" });
    expect(cubes(state)).toBe(start + 1);
    // The Governor's pool continues; a second tax to the Crown President earns nothing.
    state = choosing(state, 1);
    state = doIt(state, { action: "tax", to: "president" });
    expect(cubes(state)).toBe(start + 1);
  });

  it("no cube for taxing the Company Balance", () => {
    let state = choosing(annGoverns());
    const start = cubes(state);
    state = doIt(state, { action: "tax", to: "balance" });
    expect(cubes(state)).toBe(start);
  });

  it("+1 for moving a Company ship into a Crown Presidency's sea, but not for starting one", () => {
    let state = choosing(annGoverns());
    const start = cubes(state);
    state = doIt(state, { action: "buildShip" });
    expect(cubes(state)).toBe(start);
    state = choosing(state);
    state = doIt(state, { action: "buildShip" });
    expect(cubes(state)).toBe(start + 1);
  });

  it("+1 for commissioning a regiment into a Crown Presidency's Army, once per turn per Presidency", () => {
    let state = choosing(annGoverns());
    const start = cubes(state);
    state = doIt(state, { action: "commissionRegiment" });
    expect(cubes(state)).toBe(start + 1);
    state = choosing(state);
    state = doIt(state, { action: "commissionRegiment" });
    expect(cubes(state)).toBe(start + 1);
  });

  it("+X for each Crown writer the human President places (mandatory)", () => {
    let state = scene({ treasury: 10 });
    state = withOffice(state, "president-madras", ANN, { treasury: 10 });
    state = withWriters(state, CROWN, "Madras", 1);
    state = redecide(withActivity(state, "Madras", { kind: "trade", stage: "place", declared: ["madras"], ships: 1, placedOrderIds: [] }));
    expect(state.pendingDecision.actor).toBe(ANN);
    const start = cubes(state);
    state = act(state, state.pendingDecision.legalCommands.find((legal) => payload(legal).writer === CROWN)!);
    expect(cubes(state)).toBe(start + 1);
  });

  describe("Deploy by a human Commander", () => {
    function deploying(climate: CrownClimate, target: string, selection: { officers: Record<string, number>; regiments: number; alliances: string[] }, setup: (state: GameState) => GameState): GameState {
      let state = scene({ climate, treasury: 10 });
      state = withCommander(state, "Madras", ANN);
      state = setup(withRegion(state, target, { towerLevels: 0, unrest: 0 }));
      return inActivity(state, { kind: "commander", stage: "exhaust", target, selection });
    }
    const roll = (state: GameState, target: string) =>
      withDice(
        state,
        (seeded) => act(seeded, seeded.pendingDecision.legalCommands.find((legal) => payload(legal).action === "roll")!),
        (result) => result.india.regions[target].companyControlled,
      );

    it("+1 for taking a region not in the Company with Crown officers (Lion, Bear, Peacock)", () => {
      const state = deploying("lion", "mysore", { officers: { [CROWN]: 4 }, regiments: 0, alliances: [] }, (s) => withOfficers(s, CROWN, "Madras", { ready: 4 }));
      const start = cubes(state);
      expect(cubes(roll(state, "mysore"))).toBe(start + 1);
    });

    it("none for Crown officers in Bull, where that favour is not printed", () => {
      const state = deploying("bull", "mysore", { officers: { [CROWN]: 6 }, regiments: 0, alliances: [] }, (s) => withOfficers(s, CROWN, "Madras", { ready: 6 }));
      const start = cubes(state);
      expect(cubes(roll(state, "mysore"))).toBe(start);
    });

    it("+1 for restoring a Company region of a Crown Presidency with a Crown writer (Bull, Stag, Lion)", () => {
      const setup = (s: GameState) => withOrder(withWriters(withOfficers(withAssociatedRegion(s, "madras", "Madras"), CROWN, "Madras", { ready: 4 }), CROWN, "Madras", 1), "madras-south-4", { closed: true });
      const state = deploying("lion", "madras", { officers: { [CROWN]: 4 }, regiments: 0, alliances: [] }, setup);
      const start = cubes(state);
      const after = withDice(
        state,
        (seeded) => act(seeded, seeded.pendingDecision.legalCommands.find((legal) => payload(legal).action === "roll")!),
        (result) => result.india.regions.madras.orders.every((order) => !order.closed),
      );
      expect(cubes(after)).toBe(start + 1);
    });
  });
});

describe("a whole Presidency played by the Crown", () => {
  it("gives a reason for every Crown command", () => {
    let state = scene({ treasury: 12, climate: "lion" });
    state = withRegiments(withOfficers(withCommander(state, "Madras", CROWN), CROWN, "Madras", { ready: 3 }), { Madras: { ready: 2, exhausted: 0 } });
    state = redecide(state);
    const before = state.log.length;
    state = crownPlays(state);
    const crownEntries = state.log.slice(before).filter((entry) => entry.actor === CROWN);
    expect(crownEntries.length).toBeGreaterThan(2);
    for (const entry of crownEntries) expect(entry.crownReason, entry.summary).toBeTruthy();
  });
});
