import { describe, expect, it } from "vitest";
import { crownAiCards, crownBoardFavors, crownHandbook } from "../../data";
import { crownAreas } from "../../engine/crown/registry";
import type { CrownArea } from "../../engine/crown/kit";
import {
  aiCard,
  climateFromCard,
  crownDirection,
  crownPresidencyOrder,
  crownSplayIndex,
  exchangeCubes,
  flipAiCard,
  printedFavor,
  shiftClimate,
  type GameState,
} from "../../engine";
import { act, command, newCrownGame, playUntil, startedCrownGame } from "../fixtures/crown";
import { TEST_NOW } from "../fixtures/game";

function withCards(state: GameState, faceUp: number, top: number): GameState {
  const id = (number: number) => crownAiCards[number - 1].id;
  const rest = crownAiCards.map((card) => card.id).filter((cardId) => cardId !== id(faceUp) && cardId !== id(top));
  return { ...state, crown: { ...state.crown!, faceupAiCard: id(faceUp), aiDeck: { drawPile: [id(top), ...rest], discardPile: [], removed: [] } } };
}

describe("the AI cards (rulebook p.45)", () => {
  const game = startedCrownGame();

  it("picks Presidencies and the direction from the top face-down card, as in the p.45 example", () => {
    // Card 1 face up (1st arrow top, 2nd bottom, hand upper); card 8's back reads Bengal, Bombay, Madras.
    const state = withCards(game, 1, 8);
    expect(crownPresidencyOrder(state)).toEqual(["Bengal", "Madras", "Bombay"]);
    expect(crownDirection(state)).toBe("clockwise");
  });

  it("takes the shaded splay slot, else the next to the right, wrapping round", () => {
    expect(crownSplayIndex(withCards(game, 1, 8), [true, true, true])).toBe(0);
    expect(crownSplayIndex(withCards(game, 1, 8), [false, true, true])).toBe(1);
    expect(crownSplayIndex(withCards(game, 3, 8), [true, true, false])).toBe(0);
    expect(crownSplayIndex(withCards(game, 2, 8), [false, false, false])).toBeUndefined();
  });

  it("reads the climate off the card's chart", () => {
    const card1 = aiCard("crown-ai-01");
    const at = (standing: number) => ({ ...game, company: { ...game.company, standing } });
    expect(climateFromCard(at(1), card1)).toBe("peacock"); // £4
    expect(climateFromCard(at(0), card1)).toBe("peacock"); // failure: below the chart
    expect(climateFromCard(at(2), card1)).toBe("lion"); // £6
    expect(climateFromCard(at(6), card1)).toBe("bull"); // £14: £8+
  });

  it("uses card 6's Deregulation band once Deregulation has passed", () => {
    const card6 = aiCard("crown-ai-06");
    const shares = game.company.court.filter((share) => share.owner).length;
    expect(shares).toBeLessThanOrEqual(6);
    expect(climateFromCard(game, card6)).toBe("bull");
    expect(climateFromCard({ ...game, parliament: { ...game.parliament, deregulated: true } }, card6)).toBe("peacock");
  });

  it("flips the next card and reshuffles an emptied deck", () => {
    const last = {
      ...game,
      crown: { ...game.crown!, faceupAiCard: "crown-ai-01", aiDeck: { drawPile: ["crown-ai-02"], discardPile: ["crown-ai-03", "crown-ai-04"], removed: [] } },
    };
    const flipped = flipAiCard(last, TEST_NOW);
    expect(flipped.crown!.faceupAiCard).toBe("crown-ai-02");
    expect([...flipped.crown!.aiDeck.drawPile].sort()).toEqual(["crown-ai-01", "crown-ai-03", "crown-ai-04"]);
    expect(flipped.crown!.aiDeck.discardPile).toEqual([]);
    expect(flipped.crown!.climate).toBe(climateFromCard(flipped, aiCard("crown-ai-02")));
    expect(flipped.log.at(-1)?.type).toBe("crown.aiCardFlipped");
  });

  it("shifts the climate along the track, stopping at the ends", () => {
    const bull = { ...game, crown: { ...game.crown!, climate: "bull" as const } };
    expect(shiftClimate(bull, -1).crown!.climate).toBe("bull");
    expect(shiftClimate(bull, 2).crown!.climate).toBe("lion");
    expect(shiftClimate(shiftClimate(bull, 9), 0).crown!.climate).toBe("peacock");
  });
});

describe("setup with the Crown (rulebook pp.43-44)", () => {
  it("drafts solo: keep one of three, the Crown takes two, four times", () => {
    let state = newCrownGame({ seed: "draft-solo" });
    state = act(state, 0);
    for (let pick = 0; pick < 4; pick += 1) {
      expect(state.pendingDecision.step).toBe("setup.crownDraftPick");
      expect(state.pendingDecision.legalCommands).toHaveLength(3);
      state = act(state, 0);
    }
    expect(state.phase).toBe("family");
    expect(state.decks["setup-1710"].discardPile).toHaveLength(12);
    expect(state.seatingOrder).toEqual(["player-ann", "crown"]);
    expect(state.players.crown.familyMembers.supply + 0).toBeLessThan(36);
    expect(state.crown!.climate).toBe(climateFromCard(state, aiCard(state.crown!.faceupAiCard)));
    expect(state.crown!.setupDraft).toBeUndefined();
  });

  it("drafts with two players: each gives the Crown one of three, twice", () => {
    let state = newCrownGame({ players: 2, seed: "draft-2p" });
    state = act(state, 0);
    const pickers: string[] = [];
    while (state.pendingDecision.step === "setup.crownDraftPick") {
      pickers.push(String(state.pendingDecision.actor));
      state = act(state, 0);
    }
    expect(pickers).toEqual(["player-ann", "player-ben", "player-ann", "player-ben"]);
    expect(state.seatingOrder.at(-1)).toBe("crown");
    // The Button goes to the player on the side the AI card's finger points to.
    const crownSeat = state.seatingOrder.indexOf("crown");
    const side = crownDirection(state) === "clockwise" ? 1 : -1;
    expect(state.crown!.playerButton?.holder).toBe(state.seatingOrder[(crownSeat + side + 3) % 3]);
  });

  it("seats the Crown last from the Chairman, or before the next officeholder if it is Chairman", () => {
    for (const seed of ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6"]) {
      const state = startedCrownGame({ players: 2, seed });
      expect(state.seatingOrder.at(-1)).toBe("crown");
      const chairman = state.company.offices.chairman?.holder;
      if (chairman && chairman !== "crown") expect(state.seatingOrder[0]).toBe(chairman);
    }
  });

  it("gives the Crown three extra setup cards on Expert and four more cubes on Hard", () => {
    const expert = startedCrownGame({ difficulty: "expert" });
    expect(expert.decks["setup-1710"].discardPile).toHaveLength(15);
    expect(expert.crown!.promiseCubes).toEqual({ crownSupply: 10, byHumanPlayer: { "player-ann": 2 } });
    const hard2p = startedCrownGame({ difficulty: "hard", players: 2 });
    expect(hard2p.crown!.promiseCubes).toEqual({ crownSupply: 8, byHumanPlayer: { "player-ann": 2, "player-ben": 2 } });
  });
});

describe("promise cubes (rulebook pp.44, 46)", () => {
  it("never gives more than the Crown has, and takes only what a player has", () => {
    const state = startedCrownGame();
    expect(exchangeCubes(state, "player-ann", 9).moved).toBe(6);
    expect(() => exchangeCubes(state, "player-ann", -7)).toThrow();
    expect(exchangeCubes(state, "player-ann", -7, { partial: true }).moved).toBe(-6);
  });

  it("lets two players trade cubes at any time", () => {
    const state = startedCrownGame({ players: 2 });
    const next = command(state, "player-ann", "crown.giveCubes", { to: "player-ben", count: 3 });
    expect(next.crown!.promiseCubes.byHumanPlayer).toEqual({ "player-ann": 1, "player-ben": 7 });
    expect(() => command(state, "player-ann", "crown.giveCubes", { to: "crown", count: 1 })).toThrow();
  });
});

describe("the Crown's decisions", () => {
  it("only ever offers options the rules allow, with a reason, and a chooser when there are several", () => {
    let state = startedCrownGame({ seed: "decisions" });
    let crownDecisions = 0;
    state = playUntil(
      state,
      (current) => {
        const decision = current.pendingDecision;
        if (decision.actor === "crown") {
          crownDecisions += 1;
          expect(decision.crown).toBeDefined();
          const all = decision.crown!.all.map((legal) => JSON.stringify([legal.type, legal.payload]));
          for (const legal of decision.legalCommands) expect(all).toContain(JSON.stringify([legal.type, legal.payload]));
          expect(Boolean(decision.crown!.chooser)).toBe(decision.legalCommands.length > 1);
          expect(decision.crown!.reason.length).toBeGreaterThan(0);
        }
        return current.finalScoring.complete === true || current.turn > 2;
      },
      { maxSteps: 3000 },
    );
    expect(crownDecisions).toBeGreaterThan(0);
  });
});

describe("Crown favour coverage", () => {
  const areas = crownAreas();
  const sources = (area: CrownArea) => [
    ...area.favors.map((favor) => favor.printed),
    ...area.detectors.map((detector) => detector.printed),
    ...area.notDone.map((entry) => entry.printed),
  ];

  it("resolves every favour's printed text, with unique ids", () => {
    const favorIds = areas.flatMap((area) => area.favors.map((favor) => favor.id));
    expect(new Set(favorIds).size).toBe(favorIds.length);
    for (const area of areas) for (const source of sources(area)) expect(() => printedFavor(source)).not.toThrow();
  });

  it("covers every favour printed on the pages each area owns", () => {
    const owned = new Map<number, CrownArea>();
    for (const area of areas) for (const page of area.pages) {
      expect(owned.has(page), `two areas own Handbook p.${page}`).toBe(false);
      owned.set(page, area);
    }
    const missing: string[] = [];
    for (const page of crownHandbook) {
      const area = owned.get(page.page);
      if (!area) continue;
      for (const section of page.sections) {
        for (const favor of section.favors ?? []) {
          const covered = sources(area).some((source) => "page" in source && source.page === page.page && favor.text.startsWith(source.text));
          if (!covered) missing.push(`p.${page.page} ${section.title}: ${favor.text}`);
        }
      }
    }
    const board = areas.find((area) => area.boardFavors);
    if (board) {
      for (const favor of crownBoardFavors) {
        const covered = sources(board).some((source) => "board" in source && favor.text.startsWith(source.board));
        if (!covered) missing.push(`board: ${favor.text}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
