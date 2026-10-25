import type { GameState, PlayerId } from "../engine";
import { playerColors, playerName } from "./view-model";

type Props = {
  game: GameState;
  target: PlayerId;
  onSave: () => void;
  onDismiss: () => void;
};

/** Shown after a move when the next decision belongs to someone else: send them the save. */
export function HandoffBanner({ game, target, onSave, onDismiss }: Props) {
  const name = playerName(game, target);
  return (
    <div className="handoff-banner" role="status">
      <span className="swatch" style={{ backgroundColor: playerColors(game)[target] }} aria-hidden="true" />
      <p>
        <strong>{name}</strong> decides next. Save the game and send the file to {name}, or pass them the device.
      </p>
      <button type="button" onClick={onSave}>
        Save &amp; pass to {name}
      </button>
      <button type="button" className="plain-button" onClick={onDismiss}>
        Same device
      </button>
    </div>
  );
}
