import type { GameState } from "./types";

/**
 * Why undoing from `after` back to `before` would be unfair, or undefined when it is allowed.
 * Undo exists to fix misclicks, so it must never let anyone reroll dice, redraw a card, or look
 * at hidden information and then take the move back.
 */
export function undoBlockReason(before: GameState, after: GameState): string | undefined {
  if (after.rng.counter !== before.rng.counter) {
    return "Dice were rolled or cards were shuffled.";
  }

  if (
    after.parliament.lawDeck.drawPile.length < before.parliament.lawDeck.drawPile.length ||
    after.londonSeason.deck.length < before.londonSeason.deck.length ||
    after.eventsInIndia.drawPile.length < before.eventsInIndia.drawPile.length
  ) {
    return "A card or tile was drawn.";
  }

  for (const [playerId, player] of Object.entries(after.players)) {
    const earlier = before.players[playerId]?.blackmailCards ?? [];
    const revealed = player.blackmailCards.some((card) =>
      earlier.some((old) => old.id === card.id && old.facedown && !card.facedown),
    );
    if (revealed) return "A blackmail card was turned face up.";
  }

  if (after.finalScoring.complete && !before.finalScoring.complete) {
    return "The game has ended.";
  }

  return undefined;
}
