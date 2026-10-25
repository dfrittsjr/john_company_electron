import { describe, expect, it } from "vitest";
import {
  applyCommand,
  companyExpectations,
  createNewGame,
  familyPieceLocations,
  playerOffices,
  rollDie,
  type GameState,
} from "../../engine";
import { createNextCompanyOperationDecision } from "../../engine/phases/company-operation";
import { serializeSave, deserializeSave, SaveValidationError, createSaveEnvelope } from "../../save";
import { withCourtShares, withHiringQueue, withNoSupply, withOffice } from "../fixtures/builders";
import {
  applyCommandOrThrow,
  applyFirstLegalCommand,
  createHotseatGame,
  expectFamilyPiecesConserved,
  expectSaveRoundTripPreservesPendingDecision,
} from "../fixtures/game";

const PLAYERS = [
  { id: "player-red", name: "Red", color: "red" },
  { id: "player-blue", name: "Blue", color: "blue" },
  { id: "player-yellow", name: "Yellow", color: "yellow" },
];

function newGame(scenario: "1710" | "1758" | "1813" | "long-1710", players = PLAYERS): GameState {
  return createNewGame({
    mode: "hotseat",
    scenario,
    seed: `setup-${scenario}`,
    gameId: `game-setup-${scenario}`,
    now: "2026-06-13T12:00:00.000Z",
    players,
  });
}

describe("setup from scenario data", () => {
  it("sets up 1710 from its scenario card and Situation in India card", () => {
    const state = newGame("1710");

    expect([state.turn, state.startTurn, state.finalTurn]).toEqual([1, 1, 5]);
    // "Place the Standing marker on the space above £10 expectations. Place the Debt marker on 0."
    expect(state.company.standing).toBe(4);
    expect(companyExpectations(state)).toBe(10);
    expect(state.company.debt).toBe(0);
    // "Company Treasuries: Place £3 in every Company treasury" (coin boxes on the ribbon).
    expect(
      Object.fromEntries(Object.values(state.company.offices).map((office) => [office.id, office.treasury])),
    ).toEqual({
      chairman: 0,
      "director-of-trade": 3,
      "manager-of-shipping": 3,
      "military-affairs": 0,
      "president-bombay": 3,
      "president-madras": 3,
      "president-bengal": 3,
    });
    expect(state.company.unusedOffices).toContain("superintendent-of-trade-in-china");
    expect(state.company.unusedOffices).toContain("governor-general");
    // "Starting Regiments: 1 in each Army. Starting Company Ships: None."
    expect(Object.values(state.company.armies).map((army) => army.regiments.ready)).toEqual([1, 1, 1]);
    expect(state.company.ships).toEqual([]);
  });

  it("builds India from the 1710 Situation in India card", () => {
    const { regions, elephant } = newGame("1710").india;

    expect(Object.keys(regions).sort()).toEqual([
      "bengal",
      "bombay",
      "delhi",
      "hyderabad",
      "madras",
      "maratha",
      "mysore",
      "punjab",
    ]);
    expect(
      Object.fromEntries(Object.values(regions).map((region) => [region.id, region.towerLevels])),
    ).toEqual({ punjab: 0, delhi: 1, bombay: 1, maratha: 2, bengal: 1, hyderabad: 1, mysore: 1, madras: 1 });
    expect(Object.values(regions).every((region) => region.hasDome)).toBe(true);

    // Delhi is an empire capital dominating Punjab and Maratha.
    expect(regions.delhi).toEqual(expect.objectContaining({ isCapital: true, empireFlag: "empire-flag-1" }));
    expect(regions.punjab).toEqual(expect.objectContaining({ isCapital: false, empireFlag: "empire-flag-1" }));
    expect(regions.maratha).toEqual(expect.objectContaining({ isCapital: false, empireFlag: "empire-flag-1" }));
    expect(regions.bombay.empireFlag).toBeUndefined();

    expect(
      Object.values(regions)
        .flatMap((region) => region.orders)
        .filter((order) => order.closed)
        .map((order) => order.id)
        .sort(),
    ).toEqual([
      "bombay-east-3",
      "delhi-east-5",
      "delhi-west-3",
      "hyderabad-7",
      "madras-south-4",
      "maratha-west-3",
      "punjab-7",
    ]);
    expect(elephant).toEqual({ regionId: "maratha", facing: "delhi" });
  });

  it("gives only home regions a fixed Presidency and associates none at the start of 1710", () => {
    const { regions } = newGame("1710").india;

    expect(
      Object.values(regions)
        .filter((region) => region.homePresidency)
        .map((region) => [region.id, region.homePresidency]),
    ).toEqual([
      ["bombay", "Bombay"],
      ["bengal", "Bengal"],
      ["madras", "Madras"],
    ]);
    expect(Object.values(regions).some((region) => region.associatedPresidency)).toBe(false);
    expect(Object.values(regions).some((region) => region.companyControlled)).toBe(false);
    expect(regions.bengal.exportIcons).toBe(2);
    // Loot token values from the punchboard (Hyderabad's £7 matches the p.22-23 example).
    expect(regions.hyderabad.lootToken.value).toBe(7);
  });

  it("uses the Turn track dates and scenario cards for the later scenarios", () => {
    const siege = newGame("1758");
    expect([siege.turn, siege.finalTurn]).toEqual([3, 7]);
    expect(siege.company.standing).toBe(5);
    expect(companyExpectations(siege)).toBe(12);
    expect(siege.company.debt).toBe(3);
    expect(siege.company.offices["director-of-trade"].treasury).toBe(4);
    expect(siege.company.ships).toEqual([
      expect.objectContaining({ kind: "company", location: "east-indian" }),
    ]);

    const postMonopoly = newGame("1813", [
      ...PLAYERS,
      { id: "player-green", name: "Green", color: "green" },
      { id: "player-purple", name: "Purple", color: "purple" },
    ]);
    expect([postMonopoly.turn, postMonopoly.finalTurn]).toEqual([5, 8]);
    expect(Object.values(postMonopoly.company.armies).map((army) => army.regiments.ready)).toEqual([2, 2, 2]);
    expect(postMonopoly.company.ships.map((ship) => ship.location).sort()).toEqual([
      "east-indian",
      "south-indian",
      "west-indian",
    ]);

    expect(newGame("long-1710").finalTurn).toBe(8);
  });

  it("deals the 1710 setup cards for Long 1710 and keeps every family's 18 pieces on the board", () => {
    let state = newGame("long-1710");
    state = applyCommandOrThrow(state, {
      id: "command-setup-long-1710",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: state.pendingDecision.legalCommands[0]?.payload ?? {},
    });

    expect(state.decks["setup-1710"].discardPile).toHaveLength(12);
    expect(Object.values(state.company.offices).filter((office) => office.holder)).toHaveLength(7);
    expectFamilyPiecesConserved(state);
  });

  it("places unfitted setup shipyards' ships on their shipyards", () => {
    let state = newGame("1710", [
      ...PLAYERS,
      { id: "player-green", name: "Green", color: "green" },
      { id: "player-purple", name: "Purple", color: "purple" },
      { id: "player-black", name: "Black", color: "black" },
    ]);
    state = applyCommandOrThrow(state, {
      id: "command-setup-six",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: state.pendingDecision.legalCommands[0]?.payload ?? {},
    });

    // Six players use all six extra cards, including "two shipyards (both unfitted)".
    expect(state.company.ships.filter((ship) => ship.location === "shipyard")).toHaveLength(2);
    expect(state.company.ships.filter((ship) => ship.kind === "player")).toHaveLength(5);
  });
});

describe("London Season attrition (p.11)", () => {
  function attritionState(seed: string, fatigue: number): GameState {
    const base = createHotseatGame({ seed, gameId: `game-${seed}` });
    const withHolder = withHiringQueue(withOffice(base, "manager-of-shipping", "player-blue", { fatigue }), []);

    return {
      ...withHolder,
      turn: 2,
      phase: "londonSeason",
      pendingDecision: {
        id: `decision-${seed}`,
        phase: "londonSeason",
        step: "londonSeason.confirm",
        actor: "system",
        visibility: "public",
        prompt: "Confirm London Season.",
        legalCommands: [{ type: "londonSeason.confirm", label: "Confirm London Season", payload: {} }],
        canSave: true,
      },
    };
  }

  function seedWithRoll(predicate: (roll: number) => boolean): string {
    for (let index = 0; index < 200; index += 1) {
      const seed = `attrition-${index}`;
      // Setup may consume random numbers (e.g. shuffling decks), so roll from the game's own RNG.
      const roll = rollDie(attritionState(seed, 0).rng, 6, "londonSeason.attrition.manager-of-shipping").value;
      if (predicate(roll)) return seed;
    }
    throw new Error("No seed found");
  }

  function resolve(seed: string, fatigue: number) {
    const state = attritionState(seed, fatigue);
    const next = applyFirstLegalCommand(state, { commandId: `command-${seed}`, actorId: "system" });
    return { state, next, office: next.company.offices["manager-of-shipping"] };
  }

  it("does nothing on a total of 1 or 2", () => {
    const { office } = resolve(seedWithRoll((roll) => roll <= 2), 0);

    expect(office).toEqual(expect.objectContaining({ holder: "player-blue", vacant: false, fatigue: 0 }));
  });

  it("adds one fatigue on a total of 3 or 4, without retiring", () => {
    const { office } = resolve(seedWithRoll((roll) => roll === 3 || roll === 4), 0);

    expect(office).toEqual(expect.objectContaining({ holder: "player-blue", vacant: false, fatigue: 1 }));
  });

  it("retires the officeholder on 5 or more, counting existing fatigue", () => {
    // A roll of 4 with one fatigue totals 5.
    const { next, office } = resolve(seedWithRoll((roll) => roll === 4), 1);

    expect(office).toEqual(expect.objectContaining({ vacant: true, fatigue: 0 }));
    expect(office.holder).toBeUndefined();
    expect(next.company.vacantOffices).toContain("manager-of-shipping");
  });

  it("does not add fatigue unconditionally before rolling", () => {
    // Codex added a fatigue to every office before the roll, retiring on roll + fatigue + 1 >= 5.
    const { office } = resolve(seedWithRoll((roll) => roll === 4), 0);

    expect(office).toEqual(expect.objectContaining({ holder: "player-blue", fatigue: 1 }));
  });

  it("skips the London Season on the scenario's first turn, which is turn 3 in 1758", () => {
    const siege = newGame("1758");
    const state: GameState = {
      ...siege,
      phase: "londonSeason",
      pendingDecision: {
        id: "decision-london-1758",
        phase: "londonSeason",
        step: "londonSeason.confirm",
        actor: "system",
        visibility: "public",
        prompt: "Confirm London Season.",
        legalCommands: [{ type: "londonSeason.confirm", label: "Confirm London Season", payload: {} }],
        canSave: true,
      },
    };

    const next = applyFirstLegalCommand(state, { commandId: "command-london-1758", actorId: "system" });

    expect(next.log.at(-1)?.type).toBe("londonSeason.skipped");
    expect(next.rng.counter).toBe(state.rng.counter);
  });
});

describe("Chairman debt and allocation (p.18)", () => {
  function chairmanState(options: { debt: number; balance: number; owners?: string[] }): GameState {
    let state = createHotseatGame({ seed: "chairman-debt", gameId: "game-chairman-debt" });
    state = withOffice(state, "chairman", "player-red");
    state = withOffice(state, "manager-of-shipping", "player-blue");
    state = withCourtShares(
      state,
      (options.owners ?? ["player-red", "player-blue"]).map((owner, index) => ({ id: `share-${owner}-${index}`, owner })),
    );
    state = withHiringQueue(withNoSupply(state), []);
    const ready: GameState = {
      ...state,
      phase: "companyOperation",
      company: { ...state.company, debt: options.debt, balance: options.balance },
    };
    return { ...ready, pendingDecision: createNextCompanyOperationDecision(ready) };
  }

  function chairman(state: GameState, payload: unknown, actorId = "player-red") {
    return applyCommand(state, {
      id: `command-chairman-${state.log.length}`,
      gameId: state.gameId,
      actorId,
      decisionId: state.pendingDecision.id,
      type: "companyOperation.chairman",
      payload,
      clientTimestamp: "2026-06-13T12:20:00.000Z",
    });
  }

  function chairmanOrThrow(state: GameState, payload: unknown): GameState {
    const result = chairman(state, payload);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join(" "));
    return result.state;
  }

  const offersDebt = (state: GameState) =>
    state.pendingDecision.legalCommands.some((command) => (command.payload as { action?: string })?.action === "debt");

  it("takes up to three Debt freely: the Seeking Debt example ends with £18 to allocate", () => {
    // "The Company has 2 Debt and a Balance of £3 ... increase it 3 spaces ... a total of £18."
    let state = chairmanState({ debt: 2, balance: 3 });
    for (let advance = 0; advance < 3; advance += 1) state = chairmanOrThrow(state, { action: "debt" });

    expect(state.company.debt).toBe(5);
    expect(state.company.balance).toBe(18);
    expect(state.pendingDecision.step).toBe("companyOperation.chairman");

    state = chairmanOrThrow(state, { action: "allocate", officeId: "manager-of-shipping", amount: 5 });
    state = chairmanOrThrow(state, { action: "allocate", officeId: "manager-of-shipping", amount: 5 });
    state = chairmanOrThrow(state, { action: "allocate", officeId: "president-bengal", amount: 8 });
    expect(state.company.balance).toBe(0);
    expect(state.company.offices["manager-of-shipping"].treasury).toBe(13);
    expect(state.company.offices["president-bengal"].treasury).toBe(11);

    state = chairmanOrThrow(state, { action: "finish" });
    expect(state.companyOperation.actedOffices).toContain("chairman");
  });

  it("must allocate the whole Balance, and only to offices with a treasury", () => {
    const state = chairmanState({ debt: 0, balance: 6 });

    expect(chairman(state, { action: "finish" }).ok).toBe(false);
    expect(chairman(state, { action: "allocate", officeId: "military-affairs", amount: 6 }).ok).toBe(false);
    expect(chairman(state, { action: "allocate", officeId: "director-of-trade", amount: 6 }).ok).toBe(true);
  });

  it("cannot advance Debt past the end of the track", () => {
    expect(offersDebt(chairmanState({ debt: 8, balance: 0 }))).toBe(false);
    expect(offersDebt(chairmanState({ debt: 7, balance: 0 }))).toBe(true);
  });

  it("asks the shareholders in turn from the Chairman's left beyond three advances (p.18)", () => {
    // Red is Chairman (1 share) and Blue and Yellow hold one each: 3 shares, a majority is 2.
    let state = chairmanState({ debt: 0, balance: 0, owners: ["player-blue", "player-yellow"] });
    for (let advance = 0; advance < 3; advance += 1) state = chairmanOrThrow(state, { action: "debt" });
    state = chairmanOrThrow(state, { action: "debt" });

    expect(state.pendingDecision.step).toBe("companyOperation.debtConsent");
    expect(state.pendingDecision.actor).toBe("player-blue");
    expect(state.pendingDecision.prompt).toContain("3 Company shares");
    expect(state.company.debt).toBe(3);
    expectSaveRoundTripPreservesPendingDecision(state);

    // Blue's consent plus the Chairman's own share is a majority: Yellow is never asked.
    const accepted = applyFirstLegalCommand(state, { commandId: "command-consent", actorId: "player-blue" });
    expect(accepted.company.debt).toBe(4);
    expect(accepted.company.balance).toBe(20);
    expect(accepted.pendingDecision.step).toBe("companyOperation.chairman");
  });

  it("goes on to the next shareholder after a refusal while a majority is still possible", () => {
    let state = chairmanState({ debt: 0, balance: 0, owners: ["player-blue", "player-yellow"] });
    for (let advance = 0; advance < 4; advance += 1) state = chairmanOrThrow(state, { action: "debt" });
    const refuse = (s: GameState, actorId: string) => {
      const command = s.pendingDecision.legalCommands.find((legal) => legal.label === "Refuse");
      return applyCommandOrThrow(s, { id: `command-refuse-${actorId}`, actorId, type: command?.type ?? "", payload: command?.payload });
    };

    state = refuse(state, "player-blue");
    expect(state.pendingDecision.step).toBe("companyOperation.debtConsent");
    expect(state.pendingDecision.actor).toBe("player-yellow");
    state = applyFirstLegalCommand(state, { commandId: "command-consent-yellow", actorId: "player-yellow" });
    expect(state.company.debt).toBe(4);
  });

  it("stops asking as soon as a majority is impossible, with no further advances", () => {
    let state = chairmanState({ debt: 0, balance: 0, owners: ["player-blue", "player-blue", "player-yellow"] });
    for (let advance = 0; advance < 4; advance += 1) state = chairmanOrThrow(state, { action: "debt" });

    // Blue holds 2 of 4 shares and refuses: 4 - 2 < 3, so Yellow is not asked.
    expect(state.pendingDecision.actor).toBe("player-blue");
    const refuse = state.pendingDecision.legalCommands.find((command) => command.label === "Refuse");
    const refused = applyCommandOrThrow(state, {
      id: "command-refuse",
      actorId: "player-blue",
      type: refuse?.type ?? "",
      payload: refuse?.payload,
    });

    expect(refused.pendingDecision.step).toBe("companyOperation.chairman");
    expect(refused.company.debt).toBe(3);
    expect(offersDebt(refused)).toBe(false);
  });

  it("needs no question when the Chairman's own shares are already a majority", () => {
    let state = chairmanState({ debt: 0, balance: 0, owners: ["player-red", "player-blue"] });
    for (let advance = 0; advance < 4; advance += 1) state = chairmanOrThrow(state, { action: "debt" });
    expect(state.company.debt).toBe(4);
    expect(state.pendingDecision.step).toBe("companyOperation.chairman");
  });
});

describe("Hiring order uses the office card backs (p.14)", () => {
  it("hires the Governor General (2) before Governors in their printed order (9-16)", () => {
    let state = createHotseatGame({ seed: "hiring-order", gameId: "game-hiring-order" });
    for (const officeId of ["governor-mysore", "governor-bombay", "governor-general"]) {
      state = withOffice(state, officeId, undefined);
    }
    state = withHiringQueue(withNoSupply(state), ["governor-mysore", "governor-bombay", "governor-general"]);
    state = applyCommandOrThrow(state, {
      id: "command-setup-hiring-order",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: {},
    });

    for (let index = 0; index < 20 && state.phase !== "companyOperation"; index += 1) {
      state = applyFirstLegalCommand(state, { commandId: `command-hiring-order-${index}` });
    }

    // Nobody can hire any of them, so each is skipped automatically, in card-back order.
    const skipped = state.log
      .filter((entry) => entry.type === "hiring.vacancySkipped")
      .map((entry) => (entry.details as { officeId: string }).officeId);
    expect(state.phase).toBe("companyOperation");
    expect(skipped).toEqual(["governor-general", "governor-bombay", "governor-mysore"]);
  });
});

describe("canonical piece locations", () => {
  it("derives each family's view from the shared board locations", () => {
    let state = newGame("1710");
    state = applyCommandOrThrow(state, {
      id: "command-setup-canonical",
      actorId: "player-red",
      type: "setup.confirmStart",
      payload: state.pendingDecision.legalCommands[0]?.payload ?? {},
    });

    for (const playerId of Object.keys(state.players)) {
      const locations = familyPieceLocations(state, playerId);
      expect(Object.values(locations).reduce((total, count) => total + count, 0)).toBe(18);
      expect(locations.offices).toBe(playerOffices(state, playerId).length);
    }
    expect(state.players["player-red"].familyMembers).toEqual({
      supply: expect.any(Number),
      pensioners: 0,
      prizes: {},
      officersInTraining: expect.any(Number),
      debtorPrison: 0,
    });
  });
});

describe("save compatibility", () => {
  it("refuses saves from the old state schema with a readable message", () => {
    const state = createHotseatGame({ seed: "old-save", gameId: "game-old-save" });
    const oldState = { ...state, schemaVersion: 1 };
    const envelope = createSaveEnvelope(oldState as GameState, { saveId: "save-old", now: "2026-06-13T12:00:00.000Z" });

    expect(() => deserializeSave(serializeSave(envelope))).toThrow(SaveValidationError);
    expect(() => deserializeSave(serializeSave(envelope))).toThrow(/older version of the game/);
  });
});
