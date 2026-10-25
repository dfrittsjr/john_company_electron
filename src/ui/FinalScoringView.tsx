import { companyFailureCards } from "../data";
import type { GameState } from "../engine";
import { playerColors, playerName } from "./view-model";

type Props = {
  game: GameState;
  onClose: () => void;
};

/** Per-player breakdown of Final Scoring (rulebook p.9), from state.finalScoring. */
export function FinalScoringView({ game, onClose }: Props) {
  const scoring = game.finalScoring;
  const colors = playerColors(game);
  const ranking = scoring.ranking ?? game.seatingOrder;
  const failureCard = scoring.failureCardId
    ? companyFailureCards.find((card) => card.id === scoring.failureCardId)
    : undefined;

  return (
    <div className="final-scoring-backdrop" role="dialog" aria-modal="true" aria-labelledby="final-scoring-title">
      <section className="final-scoring">
        <header>
          <div>
            <p className="eyebrow">Game over</p>
            <h2 id="final-scoring-title">Final Scoring</h2>
            <p>
              {scoring.companySurvived === false
                ? `The Company failed.${failureCard ? ` Failure card: ${failureCard.name}` : ""}`
                : "The Company survived."}
            </p>
            {failureCard ? <p className="status-note">{failureCard.text}</p> : null}
          </div>
          <button type="button" onClick={onClose}>
            View the board
          </button>
        </header>
        <ol className="final-ranking">
          {ranking.map((playerId, index) => {
            const result = scoring.players?.[playerId];
            return (
              <li key={playerId} className="final-row">
                <div className="final-row-head">
                  <span className="final-rank">{index + 1}</span>
                  <span className="swatch" style={{ backgroundColor: colors[playerId] }} aria-hidden="true" />
                  <strong>{playerName(game, playerId)}</strong>
                  <span className="final-vp">{result?.finalVictoryPoints ?? game.players[playerId].victoryPoints} VP</span>
                </div>
                {result ? (
                  <table className="final-table">
                    <tbody>
                      <tr>
                        <td>Before Final Scoring</td>
                        <td>{result.victoryPointsBefore}</td>
                      </tr>
                      {result.entries.map((entry, entryIndex) => (
                        <tr key={entryIndex}>
                          <td>{entry.label}</td>
                          <td>{entry.victoryPoints > 0 ? `+${entry.victoryPoints}` : entry.victoryPoints}</td>
                        </tr>
                      ))}
                      <tr className="final-power">
                        <td>
                          Power {result.power.total} (track {result.power.powerTrack}, Prime Minister {result.power.primeMinister}, laws{" "}
                          {result.power.passedLaws}, cards {result.power.cards}, trophies {result.power.trophies})
                        </td>
                        <td>{result.windowIcons} windows</td>
                      </tr>
                    </tbody>
                  </table>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
