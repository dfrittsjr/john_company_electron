import type { GameState } from "../engine";
import { DIE_FACES, humanize, logDice, phaseLabel, playerName } from "./view-model";

type Props = {
  game: GameState;
  limit?: number;
};

/** Recent log entries, newest first, with turn, phase, and dice. */
export function LogPanel({ game, limit = 60 }: Props) {
  const entries = game.log.slice(-limit).reverse();
  return (
    <ol className="log-panel" aria-label="Game log">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="log-meta">
            T{entry.turn} · {phaseLabel(entry.phase)}
            {entry.actor && entry.actor !== "system" ? ` · ${playerName(game, entry.actor)}` : ""}
          </span>
          <span className="log-summary">{entry.summary}</span>
          {entry.crownReason ? <span className="log-reason">{entry.crownReason}</span> : null}
          {logDice(entry).map((dice, index) => (
            <span key={index} className="log-dice" title={humanize(dice.label)}>
              {dice.dieFaces
                ? dice.values.map((value, dieIndex) => (
                    <span key={dieIndex} className="die" aria-label={`die showing ${value}`}>
                      {DIE_FACES[value - 1]}
                    </span>
                  ))
                : dice.values.join(", ")}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}
