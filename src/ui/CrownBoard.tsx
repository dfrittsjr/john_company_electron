import { CROWN_CLIMATES, type CrownAiCard } from "../data";
import {
  crownCubes,
  crownDirection,
  crownPresidencyOrder,
  crownRegionOrder,
  faceUpAiCard,
  humanPlayerIds,
  playerCubes,
  topFaceDownAiCard,
  type GameState,
} from "../engine";
import { CrownIcon } from "./CrownIcons";
import { humanize, playerName } from "./view-model";

type Props = {
  game: GameState;
  onOpenRules?: (sectionId: string) => void;
};

const SLOT_ROW = { top: 0, middle: 1, bottom: 2 } as const;
const SPLAY_SLOTS = ["left", "middle", "right"] as const;
/** Height of one Presidency row on the card lane; the arrows sit on the row boundaries. */
const ROW = 28;

/** The face-up AI card, drawn from its data (rulebook p.45). */
function FaceUpCard({ card }: { card: CrownAiCard }) {
  return (
    <div className="ai-card ai-card-front" role="group" aria-label={`Face-up AI card ${card.number}`}>
      <div className="ai-card-lane" aria-hidden="true">
        <span className="ai-arrow ai-arrow-first" style={{ top: SLOT_ROW[card.firstArrow] * ROW + ROW / 2 }} title="1st arrow">
          1st
        </span>
        <span className="ai-arrow ai-arrow-second" style={{ top: SLOT_ROW[card.secondArrow] * ROW + ROW / 2 }} title="2nd arrow">
          2nd
        </span>
        <span className="ai-hand" style={{ top: card.hand === "upper" ? ROW : ROW * 2 }} title="The pointing hand: the Crown's direction">
          {"☞"}
        </span>
      </div>
      <div className="ai-card-main">
        <p className="ai-card-criterion">
          <span className="ai-card-number">{card.number}</span> {card.criterion}
        </p>
        <ul className="ai-bands" aria-label="Climate by criterion">
          {card.climateBands.map((band, index) => (
            <li key={index}>
              <span>{band.range}</span>
              <CrownIcon name={band.climate} />
              {band.deregulated ? <small>(deregulated)</small> : null}
            </li>
          ))}
        </ul>
        <div className="ai-splay" role="img" aria-label={`Shaded splay slot: ${card.splaySlot}`}>
          {SPLAY_SLOTS.map((slot) => (
            <span key={slot} className={slot === card.splaySlot ? "ai-slot ai-slot-shaded" : "ai-slot"} />
          ))}
        </div>
        <p className="ai-regions" title="Region priority, left to right">
          {card.regionPriority.map(humanize).join(" > ")}
        </p>
      </div>
    </div>
  );
}

/** The back of the top face-down card: three Presidencies and the two arrows (rulebook p.45). */
function CardBack({ card }: { card: CrownAiCard }) {
  const arrow = (direction: "clockwise" | "counterclockwise") => (direction === "clockwise" ? "↻" : "↺");
  return (
    <div className="ai-card ai-card-back" role="group" aria-label="Top face-down AI card, back">
      <ol className="ai-back-lane">
        {card.back.presidencies.map((presidency) => (
          <li key={presidency}>{humanize(presidency)}</li>
        ))}
      </ol>
      <span className="ai-back-arrow" style={{ top: ROW }} title={`Upper arrow: ${card.back.upperArrow}`}>
        {arrow(card.back.upperArrow)}
      </span>
      <span className="ai-back-arrow" style={{ top: ROW * 2 }} title={`Lower arrow: ${card.back.lowerArrow}`}>
        {arrow(card.back.lowerArrow)}
      </span>
    </div>
  );
}

export function CrownBoard({ game, onOpenRules }: Props) {
  const crown = game.crown;
  if (!crown) return null;
  const faceUp = faceUpAiCard(game);
  const top = crown.aiDeck.drawPile.length > 0 ? topFaceDownAiCard(game) : undefined;
  const order = top ? crownPresidencyOrder(game) : [];
  const direction = top ? crownDirection(game) : undefined;
  const holder = crown.playerButton?.holder;
  const humans = humanPlayerIds(game);

  return (
    <section className="crown-board" aria-label="The Crown">
      <header className="crown-board-header">
        <h2>
          <span className="swatch" style={{ backgroundColor: crown.colors[0] }} aria-hidden="true" /> The Crown
        </h2>
        <span className="crown-difficulty">{humanize(crown.difficulty)}</span>
        {onOpenRules ? (
          <button type="button" className="link-button" onClick={() => onOpenRules("crown-handbook-2")}>
            Crown Handbook
          </button>
        ) : null}
      </header>

      <ol className="climate-track" aria-label="Climate track">
        {CROWN_CLIMATES.map((climate) => (
          <li
            key={climate}
            className={climate === crown.climate ? "climate-cell climate-current" : "climate-cell"}
            aria-current={climate === crown.climate ? "true" : undefined}
          >
            <CrownIcon name={climate} />
            <span>{humanize(climate)}</span>
            {climate === crown.climate ? <small>now</small> : null}
          </li>
        ))}
      </ol>

      <div className="ai-cards">
        <FaceUpCard card={faceUp} />
        {top ? <CardBack card={top} /> : <p className="status-note">The AI deck is empty.</p>}
        <div className="ai-meaning">
          <h3>What they mean now</h3>
          <dl>
            <dt>Presidencies</dt>
            <dd>{order.length > 0 ? order.join(", then ") : "-"}</dd>
            <dt>Direction</dt>
            <dd>{direction ? humanize(direction) : "-"}</dd>
            <dt>Regions</dt>
            <dd>{crownRegionOrder(game).slice(0, 3).map(humanize).join(", ")}, ...</dd>
            <dt>Splay</dt>
            <dd>{humanize(faceUp.splaySlot)} card</dd>
          </dl>
        </div>
      </div>

      <dl className="crown-counts">
        <div>
          <dt>AI deck</dt>
          <dd>{crown.aiDeck.drawPile.length}</dd>
        </div>
        <div>
          <dt>Discard</dt>
          <dd>{crown.aiDeck.discardPile.length}</dd>
        </div>
        <div>
          <dt>Crown cubes</dt>
          <dd>
            <span className="promise-cube" aria-hidden="true" /> {crownCubes(game)}
          </dd>
        </div>
        {humans.map((playerId) => (
          <div key={playerId}>
            <dt>{playerName(game, playerId)}</dt>
            <dd>
              <span className="promise-cube" aria-hidden="true" /> {playerCubes(game, playerId)}
            </dd>
          </div>
        ))}
        {holder ? (
          <div title="The Player Button: the Crown picks this player when it must choose, then passes it">
            <dt>Player Button</dt>
            <dd>{playerName(game, holder)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
