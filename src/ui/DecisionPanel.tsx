import type { GameState, LegalCommand } from "../engine";
import { ruleSectionForPhase } from "../data/rules-text";
import { commandTargets, groupLegalCommands, phaseLabel, playerColors, playerName } from "./view-model";

type Props = {
  game: GameState;
  /** The pending decision is private and its player has not confirmed they hold the device. */
  hidden: boolean;
  onReveal: () => void;
  onRun: (command: LegalCommand) => void;
  /** Board targets of the option under the pointer, or none. */
  onHover: (targets: string[]) => void;
  /** A board element the player clicked: show only options that refer to it. */
  filter: string | null;
  onClearFilter: () => void;
  error: string | null;
  /** Opens the rules reference at a section. Without it the rules link is not shown. */
  onOpenRules?: (sectionId: string) => void;
};

const COMPACT_GROUP_SIZE = 7;

export function DecisionPanel({ game, hidden, onReveal, onRun, onHover, filter, onClearFilter, error, onOpenRules }: Props) {
  const decision = game.pendingDecision;
  const actor = decision.actor;
  const actorName =
    actor === "system" ? "Anyone (automatic step)" : actor === "simultaneous" ? "Everyone" : playerName(game, actor);
  const color = actor !== "system" && actor !== "simultaneous" ? playerColors(game)[actor] : undefined;

  const visible = filter
    ? decision.legalCommands.filter((command) => commandTargets(command).includes(filter))
    : decision.legalCommands;
  const groups = groupLegalCommands(visible);
  const phaseRules = ruleSectionForPhase(game.phase);
  const originalIndex = new Map(decision.legalCommands.map((command, index) => [command, index]));

  return (
    <section className="decision-panel" aria-labelledby="decision-heading">
      <p className="eyebrow">
        Turn {game.turn} of {game.finalTurn} · {phaseLabel(game.phase)}
      </p>
      <h2 id="decision-heading" className="decision-actor">
        {color ? <span className="swatch" style={{ backgroundColor: color }} aria-hidden="true" /> : null}
        {actorName}
      </h2>
      <p className="decision-prompt">{decision.prompt}</p>
      {onOpenRules && phaseRules ? (
        <p className="rules-link-row">
          <button type="button" className="link-button" onClick={() => onOpenRules(phaseRules.id)}>
            Rules for this phase
          </button>
        </p>
      ) : null}

      {hidden ? (
        <div className="privacy-curtain">
          <p className="status-note">This choice is private. Pass the device to {actorName}.</p>
          <button type="button" onClick={onReveal}>
            I am {actorName}: reveal
          </button>
        </div>
      ) : decision.legalCommands.length === 0 ? (
        <p className="status-note">
          {game.finalScoring.complete ? "The game is over. See the final scores." : "Nothing to decide right now."}
        </p>
      ) : (
        <div className="command-groups" onMouseLeave={() => onHover([])}>
          {filter ? (
            <p className="filter-note">
              Showing options for the selected board element.{" "}
              <button type="button" className="link-button" onClick={onClearFilter}>
                Show all {decision.legalCommands.length}
              </button>
            </p>
          ) : null}
          {filter && visible.length === 0 ? <p className="status-note">No option refers to that element.</p> : null}
          {groups.map((group) => (
            <div key={group.key} className="command-group">
              {groups.length > 1 || group.commands.length > 1 ? <h3>{group.title}</h3> : null}
              <div className={group.commands.length >= COMPACT_GROUP_SIZE ? "command-grid" : "command-list"}>
                {group.commands.map(({ command }) => (
                  <button
                    key={originalIndex.get(command)}
                    type="button"
                    className="command-button"
                    title={command.description}
                    onClick={() => onRun(command)}
                    onMouseEnter={() => onHover(commandTargets(command))}
                    onFocus={() => onHover(commandTargets(command))}
                  >
                    {command.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
