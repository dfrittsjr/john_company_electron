import { describe, expect, it } from "vitest";
import { setupCardDecks } from "../../data";
import type { SetupCardEffect } from "../../data";
import { createNewGame, type GameState } from "../../engine";
import { applySetupCard } from "../../engine/phases/setup";
import { companyExpectations } from "../../engine";
import { startedCrownGame } from "../fixtures/crown";
import {
  applyCommandOrThrow,
  applyFirstLegalCommand,
  expectFamilyPiecesConserved,
  expectGameInvariants,
} from "../fixtures/game";

// 1758 "Company Under Siege" and 1813 "Post Monopoly" setup (rulebook pp.4-5; scenario cards and
// Situation in India, Bridge Fronts/Backs p.9; setup cards, MiniEuro Fronts pp.29-31).

const ALL_PLAYERS = [
  { id: "player-red", name: "Red", color: "red" },
  { id: "player-blue", name: "Blue", color: "blue" },
  { id: "player-yellow", name: "Yellow", color: "yellow" },
  { id: "player-green", name: "Green", color: "green" },
  { id: "player-purple", name: "Purple", color: "purple" },
  { id: "player-black", name: "Black", color: "black" },
];

type Scenario = "1758" | "1813";

function newGame(scenario: Scenario, count: number, seed = `setup-${scenario}-${count}`): GameState {
  return createNewGame({
    mode: "hotseat",
    scenario,
    seed,
    gameId: `game-${scenario}-${count}`,
    now: "2026-06-13T12:00:00.000Z",
    players: ALL_PLAYERS.slice(0, count),
  });
}

function dealt(scenario: Scenario, count: number, seed?: string): GameState {
  const state = newGame(scenario, count, seed);
  return applyCommandOrThrow(state, {
    id: "command-setup",
    actorId: "player-red",
    type: "setup.confirmStart",
    payload: state.pendingDecision.legalCommands[0]?.payload ?? {},
  });
}

function deck(scenario: Scenario) {
  return setupCardDecks.find((candidate) => candidate.id === scenario)!;
}

/** Which cards each player got, from the setup log entry. */
function distribution(state: GameState): { cards: Record<string, string[]>; removed: string[] } {
  const entry = state.log.find((candidate) => candidate.type === "setup.confirmed")!;
  const details = entry.details as { setupCardDistribution: Record<string, string[]>; removedSetupCards: string[] };
  return { cards: details.setupCardDistribution, removed: details.removedSetupCards };
}

function holderOf(state: GameState, officeId: string) {
  return state.company.offices[officeId]?.holder;
}

describe.each(["1758", "1813"] as const)("%s setup cards", (scenario) => {
  it("has 12 base and 6 extra cards with unique ids and sheet positions", () => {
    const { cards } = deck(scenario);
    expect(cards.filter((card) => !card.extra)).toHaveLength(12);
    expect(cards.filter((card) => card.extra)).toHaveLength(6);
    expect(new Set(cards.map((card) => card.id)).size).toBe(18);
    expect(new Set(cards.map((card) => `${card.sheetPage}:${card.sheetPosition.row}:${card.sheetPosition.column}`)).size).toBe(18);
  });

  it.each([3, 4, 5, 6])("deals every card once for %i players, with the extras at 5 and 6", (count) => {
    const state = dealt(scenario, count);
    const { cards, removed } = distribution(state);
    const extras = count === 6 ? 6 : count === 5 ? 3 : 0;
    const dealtIds = Object.values(cards).flat();

    expect(state.phase).toBe("family");
    expect(Object.keys(cards)).toHaveLength(count);
    expect(dealtIds).toHaveLength(12 + extras);
    expect(new Set(dealtIds).size).toBe(dealtIds.length);
    expect(removed).toHaveLength(6 - extras);
    expect([...dealtIds, ...removed].sort()).toEqual(
      deck(scenario).cards
        .filter((card) => !card.extra || dealtIds.includes(card.id) || removed.includes(card.id))
        .map((card) => card.id)
        .sort(),
    );
    // Every base card is dealt, whatever the player count.
    for (const card of deck(scenario).cards.filter((candidate) => !candidate.extra)) expect(dealtIds).toContain(card.id);
    expect(state.decks[`setup-${scenario}`].discardPile).toHaveLength(12 + extras);
    expect(state.decks[`setup-${scenario}`].removed).toEqual(removed);
    expectFamilyPiecesConserved(state);
    expectGameInvariants(state);
  });
});

describe("1758 Company Under Siege", () => {
  const game = newGame("1758", 4);

  it("starts on turn 3 and ends after turn 7, with Deregulation available but not passed", () => {
    expect([game.turn, game.startTurn, game.finalTurn]).toEqual([3, 3, 7]);
    expect(game.parliament.deregulated).toBe(false);
    expect(game.firms).toBeUndefined();
  });

  it("sets the tracks, laws, regiments and ship from the scenario card", () => {
    expect(game.company.standing).toBe(5);
    expect(companyExpectations(game)).toBe(12);
    expect(game.company.debt).toBe(3);
    for (const officeId of ["director-of-trade", "manager-of-shipping", "president-bombay", "president-madras", "president-bengal"]) {
      expect(game.company.offices[officeId].treasury).toBe(4);
    }
    expect(game.parliament.passedLaws.map((law) => law.lawId)).toEqual(["calico-acts"]);
    expect(Object.values(game.company.armies).map((army) => army.regiments.ready)).toEqual([1, 1, 1]);
    expect(game.company.ships).toEqual([expect.objectContaining({ kind: "company", location: "east-indian" })]);
  });

  it("draws Situation in India: towers, closed orders, the empire and the Elephant", () => {
    const regions = game.india.regions;
    expect(Object.fromEntries(Object.entries(regions).map(([id, region]) => [id, region.towerLevels]))).toEqual({
      punjab: 1,
      delhi: 1,
      bombay: 2,
      maratha: 2,
      bengal: 0,
      hyderabad: 1,
      mysore: 2,
      madras: 1,
    });
    const closed = Object.values(regions).flatMap((region) => region.orders.filter((order) => order.closed).map((order) => order.id));
    expect(closed.sort()).toEqual(["delhi-east-5", "delhi-west-3", "hyderabad-7", "madras-home-5", "madras-south-4", "mysore-south-6", "punjab-7"]);
    expect(regions.delhi.isCapital).toBe(true);
    expect(regions.punjab.empireFlag).toBe(regions.delhi.empireFlag);
    expect(regions.maratha.empireFlag).toBeUndefined();
    expect(game.india.elephant).toEqual({ regionId: "delhi", facing: "bengal" });
  });

  it("starts Bengal Company-controlled and associated with its Presidency, with no dome", () => {
    const bengal = game.india.regions.bengal;
    expect(bengal.companyControlled).toBe(true);
    expect(bengal.associatedPresidency).toBe("Bengal");
    expect(bengal.hasDome).toBe(false);
    expect(bengal.towerLevels).toBe(0);
    // The loot/control token is on its control side above the President's box (p.23).
    expect(bengal.lootToken).toEqual(expect.objectContaining({ available: false, face: "control" }));
    for (const id of ["bombay", "madras", "delhi", "mysore"]) expect(game.india.regions[id].companyControlled).toBe(false);
  });

  it("opens the Governor of Bengal office (vacant until a setup card fills it), and no other Governor", () => {
    expect(game.company.offices["governor-bengal"]).toEqual(expect.objectContaining({ created: true, vacant: true }));
    expect(game.company.vacantOffices).toContain("governor-bengal");
    expect(game.company.unusedOffices).not.toContain("governor-bengal");
    expect(game.company.unusedOffices).toContain("governor-madras");
    expect(game.company.governorGeneralInPlay).toBe(false);
    expect(game.company.offices["superintendent-of-trade-in-china"]?.created).not.toBe(true);
  });

  it("settles the open question: the setup deal always fills the Governor of Bengal and places Commanders with trophies", () => {
    for (const count of [3, 4, 5, 6]) {
      const state = dealt("1758", count);
      expect(holderOf(state, "governor-bengal")).toBeDefined();
      expect(state.company.vacantOffices).not.toContain("governor-bengal");
      const commanders = Object.values(state.company.armies).map((army) => army.commander);
      expect(commanders.every(Boolean)).toBe(true);
      // Three Commander cards print "Trophy": one each.
      expect(Object.values(state.players).reduce((total, player) => total + player.trophies, 0)).toBe(3);
      expect(Object.values(state.players).filter((player) => player.trophies > 0).length).toBeGreaterThan(0);
    }
  });

  it("places the shipyards' ships in the indicated sea zones, and the Prime Minister's unfitted", () => {
    const state = dealt("1758", 3);
    const zones = state.company.ships.filter((ship) => ship.kind === "player").map((ship) => ship.location).sort();
    expect(zones).toEqual(["east-indian", "east-indian", "east-indian", "shipyard", "south-indian", "west-indian"]);
    expect(state.company.ships.filter((ship) => ship.kind === "company")).toHaveLength(1);
  });

  it("skips the London Season on its first turn, turn 3, and goes to Family", () => {
    const state = dealt("1758", 3);
    expect([state.turn, state.phase]).toEqual([3, "family"]);
    expect(state.log.some((entry) => entry.phase === "londonSeason")).toBe(false);
    expect(state.londonSeason.display).toBeDefined();
  });
});

describe("1813 Post Monopoly", () => {
  const game = newGame("1813", 6);

  it("starts deregulated on turn 5 and ends after turn 8", () => {
    expect([game.turn, game.finalTurn]).toEqual([5, 8]);
    expect(game.parliament.deregulated).toBe(true);
    expect(game.firms).toEqual([]);
    expect(game.company.shareValue).toBe(2);
  });

  it("passes Military Oversight, Deregulation and Calico Acts; the Governor General law is not in the deck", () => {
    expect(game.parliament.passedLaws.map((law) => law.lawId).sort()).toEqual(["calico-acts", "deregulation", "military-oversight"]);
    expect(game.parliament.lawDeck.drawPile).not.toContain("governor-general");
  });

  it("sets the tracks, regiments and a Company ship in each sea zone", () => {
    expect(game.company.standing).toBe(4);
    expect(companyExpectations(game)).toBe(10);
    expect(game.company.debt).toBe(0);
    expect(Object.values(game.company.armies).map((army) => army.regiments.ready)).toEqual([2, 2, 2]);
    expect(game.company.ships.map((ship) => ship.location).sort()).toEqual(["east-indian", "south-indian", "west-indian"]);
  });

  it("puts the Governor General in play over the Director of Trade, and opens the China office", () => {
    const company = game.company;
    expect(company.governorGeneralInPlay).toBe(true);
    expect(company.offices["governor-general"]).toEqual(expect.objectContaining({ created: true, vacant: true, treasury: 3 }));
    expect(company.vacantOffices).toContain("governor-general");
    expect(company.offices["director-of-trade"].created).toBe(false);
    expect(company.vacantOffices).not.toContain("director-of-trade");
    expect(company.unusedOffices).toContain("director-of-trade");
    expect(company.offices["superintendent-of-trade-in-china"]).toEqual(expect.objectContaining({ created: true, vacant: true }));
    expect(company.vacantOffices).toContain("superintendent-of-trade-in-china");
  });

  it("draws Situation in India: three Company-controlled home regions, no empires", () => {
    const regions = game.india.regions;
    expect(Object.fromEntries(Object.entries(regions).map(([id, region]) => [id, region.towerLevels]))).toEqual({
      punjab: 2,
      delhi: 1,
      bombay: 0,
      maratha: 2,
      bengal: 0,
      hyderabad: 1,
      mysore: 2,
      madras: 0,
    });
    const closed = Object.values(regions).flatMap((region) => region.orders.filter((order) => order.closed).map((order) => order.id));
    expect(closed.sort()).toEqual(["bengal-home-6", "bengal-north-5", "delhi-east-5", "delhi-west-3", "madras-south-4", "maratha-west-3", "punjab-7"]);
    expect(Object.values(regions).some((region) => region.empireFlag)).toBe(false);
    expect(game.india.elephant).toEqual({ regionId: "mysore", facing: "madras" });
    for (const [id, presidency] of [["bombay", "Bombay"], ["madras", "Madras"], ["bengal", "Bengal"]] as const) {
      expect(regions[id]).toEqual(expect.objectContaining({ companyControlled: true, associatedPresidency: presidency, hasDome: false }));
      expect(regions[id].lootToken).toEqual(expect.objectContaining({ available: false, face: "control" }));
    }
    for (const id of ["punjab", "delhi", "maratha", "hyderabad", "mysore"]) expect(regions[id].companyControlled).toBe(false);
  });

  it("creates no Governors with the Governor General in play (p.26)", () => {
    for (const region of Object.values(game.india.regions)) {
      expect(game.company.offices[region.governorOffice]?.created).not.toBe(true);
      expect(game.company.vacantOffices).not.toContain(region.governorOffice);
    }
  });

  it("deals the Governor General, the China office, trophies, prizes and a private firm", () => {
    const state = dealt("1813", 3);
    expect(holderOf(state, "governor-general")).toBeDefined();
    expect(holderOf(state, "superintendent-of-trade-in-china")).toBeDefined();
    expect(holderOf(state, "director-of-trade")).toBeUndefined();
    // The Company ship under the China office sits on its overlay.
    expect(state.company.ships.filter((ship) => ship.location === "china")).toEqual([expect.objectContaining({ kind: "company" })]);
    expect(state.company.ships.filter((ship) => ship.kind === "company")).toHaveLength(4);
    // "Two Trophies" on the Military Affairs Commander card.
    expect(Object.values(state.players).reduce((total, player) => total + player.trophies, 0)).toBe(2);
    // Two "Prize 2" cards: two pieces on the 2 VP prize, scoring 2 each.
    const onPrize = Object.values(state.players).reduce((total, player) => total + (player.familyMembers.prizes["prize-4"] ?? 0), 0);
    expect(onPrize).toBe(2);
    // The private firm.
    const { cards } = distribution(state);
    const owner = Object.entries(cards).find(([, ids]) => ids.some((id) => id.includes("private-firm")))![0];
    expect(state.firms).toEqual([
      expect.objectContaining({ manager: owner, londonTreasury: 8, indiaTreasury: 0, value: 1, shares: { [owner]: 1 } }),
    ]);
    expectFamilyPiecesConserved(state);
  });

  it("skips the London Season on its first turn, turn 5, and goes to Family", () => {
    const state = dealt("1813", 5);
    expect([state.turn, state.phase]).toEqual([5, "family"]);
    expect(state.log.some((entry) => entry.phase === "londonSeason")).toBe(false);
  });

  it("skips a London Season confirmation on turn 5 without rolling", () => {
    const state: GameState = {
      ...game,
      phase: "londonSeason",
      pendingDecision: {
        id: "decision-london-1813",
        phase: "londonSeason",
        step: "londonSeason.confirm",
        actor: "system",
        visibility: "public",
        prompt: "Confirm London Season.",
        legalCommands: [{ type: "londonSeason.confirm", label: "Confirm London Season", payload: {} }],
        canSave: true,
      },
    };
    const next = applyFirstLegalCommand(state, { commandId: "command-london-1813", actorId: "system" });
    expect(next.log.at(-1)?.type).toBe("londonSeason.skipped");
    expect(next.rng.counter).toBe(state.rng.counter);
  });
});

describe("the new setup effects", () => {
  const apply = (state: GameState, playerId: string, effect: SetupCardEffect) =>
    applySetupCard(state, playerId, {
      id: "test-card",
      deckId: "1813",
      scenario: "1813",
      extra: false,
      source: "printnplay/Cards/John Company Cards (MiniEuro, Fronts).pdf",
      sheetPage: 31,
      sheetPosition: { row: 1, column: 1 },
      effects: [effect],
    });

  it("trophy: trophy tokens for the card's family", () => {
    const state = apply(newGame("1758", 3), "player-red", { type: "trophy", count: 2 });
    expect(state.players["player-red"].trophies).toBe(2);
  });

  it("prize: a piece on the 2 VP prize for free, scoring its VP", () => {
    const base = newGame("1813", 3);
    const state = apply(base, "player-red", { type: "prize", prizeId: "prize-4" });
    const red = state.players["player-red"];
    expect(red.familyMembers.prizes).toEqual({ "prize-4": 1 });
    expect(red.familyMembers.supply).toBe(base.players["player-red"].familyMembers.supply - 1);
    expect(red.victoryPoints).toBe(base.players["player-red"].victoryPoints + 2);
    expect(red.cash).toBe(base.players["player-red"].cash);
    expectFamilyPiecesConserved(state);
  });

  it("companyShip: a Company ship on the China office", () => {
    const state = apply(newGame("1813", 3), "player-red", { type: "companyShip", count: 1, location: "china" });
    expect(state.company.ships.filter((ship) => ship.location === "china")).toHaveLength(1);
  });

  it("privateFirm: a firm with one share and £8 for a player, £3 for the Crown", () => {
    const effect = { type: "privateFirm", shares: 1, treasury: 8, crownCash: 3 } as const;
    const base = newGame("1813", 3);
    const state = apply(base, "player-blue", effect);
    expect(state.firms).toHaveLength(1);
    expect(state.firms![0]).toEqual(expect.objectContaining({ manager: "player-blue", londonTreasury: 8, shares: { "player-blue": 1 }, value: 1 }));
    expect(state.players["player-blue"].cash).toBe(0);
    expectFamilyPiecesConserved(state);

    const crownGame = startedCrownGame({ scenario: "1813" });
    const crownCash = crownGame.players.crown.cash;
    const crownState = apply(crownGame, "crown", effect);
    expect(crownState.firms ?? []).toEqual(crownGame.firms ?? []);
    expect(crownState.players.crown.cash).toBe(crownCash + 3);
  });

  it("office: a Governor of Bengal card seats the holder on the Governor's overlay", () => {
    const state = apply(newGame("1758", 3), "player-red", { type: "office", officeId: "governor-bengal" });
    expect(state.company.offices["governor-bengal"]).toEqual(expect.objectContaining({ holder: "player-red", vacant: false, created: true }));
    expect(state.company.vacantOffices).not.toContain("governor-bengal");
  });
});

describe.each(["1758", "1813"] as const)("%s against the Crown", (scenario) => {
  it("sets up a solo game: the player drafts 4 cards and the Crown gets 8", () => {
    const state = startedCrownGame({ scenario });
    expect(state.scenario).toBe(scenario);
    expect(state.turn).toBe(scenario === "1758" ? 3 : 5);
    expect(state.phase).toBe("family");
    expect(state.decks[`setup-${scenario}`].discardPile).toHaveLength(12);
    expect(state.seatingOrder).toEqual(["player-ann", "crown"]);
    expectFamilyPiecesConserved(state);
  });

  it("sets up a two-player game", () => {
    const state = startedCrownGame({ scenario, players: 2 });
    expect(state.phase).toBe("family");
    expect(state.decks[`setup-${scenario}`].discardPile).toHaveLength(12);
    expect(state.crown?.playerButton).toBeDefined();
    expectFamilyPiecesConserved(state);
  });

  it("deals the Crown's Expert extras from the scenario's own deck", () => {
    const state = startedCrownGame({ scenario, difficulty: "expert" });
    expect(state.decks[`setup-${scenario}`].discardPile).toHaveLength(15);
    for (const id of state.decks[`setup-${scenario}`].discardPile) expect(id.startsWith(scenario)).toBe(true);
  });
});

describe("the 1813 Private Firm card and the Crown (Handbook p.3: the Crown never creates a private firm)", () => {
  it("gives a Crown that is dealt the card £3 and no firm; a human gets the firm", () => {
    let sawCrown = false;
    let sawHuman = false;
    for (let index = 0; index < 12; index += 1) {
      const state = startedCrownGame({ scenario: "1813", seed: `firm-${index}` });
      const crownHasCard = state.log
        .find((entry) => entry.type === "crown.setup")
        ?.details as { kept: Record<string, string[]> } | undefined;
      const crownCards = crownHasCard?.kept.crown ?? [];
      if (crownCards.some((id) => id.includes("private-firm"))) {
        sawCrown = true;
        expect(state.firms).toEqual([]);
      } else {
        sawHuman = true;
        expect(state.firms).toHaveLength(1);
        expect(state.firms![0].manager).toBe("player-ann");
      }
    }
    expect(sawCrown && sawHuman).toBe(true);
  });
});
