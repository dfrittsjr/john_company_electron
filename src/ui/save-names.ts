import { crownFavorOffers, humanPlayerIds, type GameState } from "../engine";

// Names a save after whoever has to act next, e.g. "1710-t2-hiring-for-Yellow.joco",
// so the file itself tells the group whose turn it is.
export function suggestedSaveName(game: GameState): string {
  return `${saveNameStem(game)}.joco`;
}

export function suggestedSummaryName(game: GameState): string {
  return `${saveNameStem(game)}-summary.txt`;
}

export function nextActorName(game: GameState): string {
  const actor = game.pendingDecision.actor;
  if (actor === "simultaneous") return "everyone";
  if (actor === "system") return "anyone";
  // The Crown acts through whoever chooses for it. When it waits for favours, the save goes to the
  // one player who could buy one; otherwise whoever holds the game lets it act.
  if (game.players[actor]?.isCrown) {
    const chooser = game.pendingDecision.crown?.chooser;
    if (chooser) return game.players[chooser]?.name ?? chooser;
    const buyers = game.crown
      ? humanPlayerIds(game).filter((playerId) => crownFavorOffers(game, playerId).some((offer) => offer.pausesCrown))
      : [];
    return buyers.length === 1 ? (game.players[buyers[0]]?.name ?? buyers[0]) : "anyone";
  }

  return game.players[actor]?.name ?? actor;
}

function saveNameStem(game: GameState): string {
  return [
    fileNamePart(game.scenario).toLowerCase(),
    `t${game.turn}`,
    fileNamePart(game.phase).toLowerCase(),
    "for",
    fileNamePart(nextActorName(game)),
  ].join("-");
}

function fileNamePart(value: string): string {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}
