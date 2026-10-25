import { describe, expect, it } from "vitest";
import { undoBlockReason, type GameState } from "../../engine";
import { startFamilyPhase } from "../../engine/phases/family";
import { withCash } from "../fixtures/builders";
import { eventsInIndiaState } from "../fixtures/events-in-india";
import { choose, withBlackmailCard } from "../fixtures/family-hiring";
import { createHotseatGame } from "../fixtures/game";

const RED = "player-red";

function base(): GameState {
  return createHotseatGame({ seed: "undo", gameId: "game-undo" });
}

describe("undoBlockReason", () => {
  it("allows undoing a Family purchase", () => {
    const before = startFamilyPhase(withCash(base(), { [RED]: 10 }));
    const after = choose(before, "Purchase Luxury");

    expect(after.players[RED].cash).toBeLessThan(before.players[RED].cash);
    expect(undoBlockReason(before, after)).toBeUndefined();
  });

  it("blocks after dice or a shuffle", () => {
    const before = base();
    const after = { ...before, rng: { ...before.rng, counter: before.rng.counter + 1 } };
    expect(undoBlockReason(before, after)).toMatch(/dice/i);
  });

  it("blocks after a law is drawn", () => {
    const before = base();
    const drawPile = before.parliament.lawDeck.drawPile;
    expect(drawPile.length).toBeGreaterThan(0);
    const after = {
      ...before,
      parliament: { ...before.parliament, lawDeck: { ...before.parliament.lawDeck, drawPile: drawPile.slice(1) } },
    };
    expect(undoBlockReason(before, after)).toMatch(/drawn/);
  });

  it("blocks after a London Season card is drawn", () => {
    const start = base();
    const before = { ...start, londonSeason: { ...start.londonSeason, deck: ["a", "b"] } };
    const after = { ...before, londonSeason: { ...before.londonSeason, deck: ["b"] } };
    expect(undoBlockReason(before, after)).toMatch(/drawn/);
  });

  it("blocks after an Events in India tile is drawn", () => {
    const before = eventsInIndiaState({ drawPile: ["turmoil-bombay", "turmoil-madras"] });
    const after = { ...before, eventsInIndia: { ...before.eventsInIndia, drawPile: ["turmoil-madras"] } };
    expect(undoBlockReason(before, after)).toMatch(/drawn/);
  });

  it("blocks after a blackmail card is turned face up", () => {
    const before = withBlackmailCard(base(), RED, "blackmail-test");
    const card = before.players[RED].blackmailCards[0];
    const after = {
      ...before,
      players: { ...before.players, [RED]: { ...before.players[RED], blackmailCards: [{ ...card, facedown: false }] } },
    };
    expect(undoBlockReason(before, after)).toMatch(/blackmail/);
    expect(undoBlockReason(before, before)).toBeUndefined();
  });

  it("blocks once the game has ended", () => {
    const before = base();
    const after = { ...before, finalScoring: { ...before.finalScoring, complete: true } };
    expect(undoBlockReason(before, after)).toMatch(/ended/);
  });
});
