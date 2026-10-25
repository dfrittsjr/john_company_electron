import { useState } from "react";
import { crownFavorOffers, humanPlayerIds, playerCubes, type CrownFavorOffer, type GameState, type PlayerId } from "../engine";
import { playerName } from "./view-model";

type Props = {
  game: GameState;
  /** The Crown is waiting at a decision a favour could change: show the list open. */
  waiting: boolean;
  onFavor: (playerId: PlayerId, offer: CrownFavorOffer) => void;
  onGive: (from: PlayerId, to: PlayerId, count: number) => void;
  /** Whether the Crown stops for favours that could change its move (a per-browser setting). */
  waitForFavors?: { on: boolean; set: (on: boolean) => void };
};

/** A favour's cost: red when the player pays cubes, blue when the player gains them (rulebook p.46). */
export function CubeCost({ cubes }: { cubes: number }) {
  const pays = cubes < 0;
  return (
    <span
      className={pays ? "cube-cost cube-cost-pay" : "cube-cost cube-cost-gain"}
      title={pays ? `Pay ${-cubes} promise cube${cubes === -1 ? "" : "s"} to the Crown` : `Gain ${cubes} promise cube${cubes === 1 ? "" : "s"} from the Crown`}
    >
      <span className="promise-cube" aria-hidden="true" />
      {pays ? `−${-cubes}` : `+${cubes}`}
    </span>
  );
}

function GiveCubes({ game, from, to, onGive }: { game: GameState; from: PlayerId; to: PlayerId; onGive: Props["onGive"] }) {
  const have = playerCubes(game, from);
  const [count, setCount] = useState(1);
  if (have === 0) return null;
  const chosen = Math.min(count, have);
  return (
    <div className="give-cubes">
      <label>
        <span className="visually-hidden">Cubes to give from {playerName(game, from)}</span>
        <select value={chosen} onChange={(event) => setCount(Number(event.target.value))}>
          {Array.from({ length: have }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => onGive(from, to, chosen)}>
        {playerName(game, from)} gives {chosen} cube{chosen === 1 ? "" : "s"} to {playerName(game, to)}
      </button>
    </div>
  );
}

/** The favours on offer to each human now, and (two players) a way to pass promise cubes between them. */
export function CrownFavors({ game, waiting, onFavor, onGive, waitForFavors }: Props) {
  if (!game.crown || game.finalScoring.complete) return null;
  const humans = humanPlayerIds(game);
  const offers = humans.map((playerId) => ({ playerId, offers: crownFavorOffers(game, playerId) }));
  const total = offers.reduce((sum, entry) => sum + entry.offers.length, 0);
  const twoPlayer = humans.length === 2;

  const body = (
    <div className="favor-lists">
      {waitForFavors ? (
        <label className="favor-wait">
          <input type="checkbox" checked={waitForFavors.on} onChange={(event) => waitForFavors.set(event.target.checked)} />
          Wait for me when a favour could change the Crown's move
        </label>
      ) : null}
      {offers.map(({ playerId, offers: list }) => (
        <div key={playerId} className="favor-player">
          <h4>
            {playerName(game, playerId)} <small>{playerCubes(game, playerId)} cubes</small>
          </h4>
          {list.length === 0 ? (
            <p className="status-note">No favours on offer.</p>
          ) : (
            <ul className="favor-list">
              {list.map((offer, index) => (
                <li key={`${offer.favorId}:${JSON.stringify(offer.option ?? null)}:${index}`}>
                  <CubeCost cubes={offer.cubes} />
                  <span className="favor-text">{offer.label}</span>
                  <button type="button" onClick={() => onFavor(playerId, offer)}>
                    {offer.cubes < 0 ? "Pay" : "Do"} favour
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {twoPlayer ? (
        <div className="favor-player">
          <h4>Promise cubes between the players</h4>
          {humans.map((from) => (
            <GiveCubes key={from} game={game} from={from} to={humans.find((id) => id !== from)!} onGive={onGive} />
          ))}
          {humans.every((id) => playerCubes(game, id) === 0) ? <p className="status-note">Neither player has a cube to give.</p> : null}
        </div>
      ) : null}
    </div>
  );

  if (waiting) {
    return (
      <section className="crown-favors crown-favors-waiting" aria-label="Favours">
        <h3>Favours on offer</h3>
        <p className="status-note">The Crown waits so that a favour can change what it does.</p>
        {body}
      </section>
    );
  }
  return (
    <details className="crown-favors" aria-label="Favours">
      <summary>
        Favours ({total} on offer{twoPlayer ? ", give cubes" : ""})
      </summary>
      {body}
    </details>
  );
}
