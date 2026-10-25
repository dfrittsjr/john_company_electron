import { crownChooser, type GameState, type LegalCommand } from "../engine";
import { ruleSectionForPhase } from "../data/rules-text";
import { HIDDEN_PLAYER_ID } from "../online/protocol";
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
  /** Online: shown instead of "Nothing to decide" when the decision is not this viewer's. */
  note?: string;
};

const COMPACT_GROUP_SIZE = 7;

export function DecisionPanel({ game, hidden, onReveal, onRun, onHover, filter, onClearFilter, error, onOpenRules, note }: Props) {
  const decision = game.pendingDecision;
  const actor = decision.actor;
  const crownActs = actor !== "system" && actor !== "simultaneous" && Boolean(game.players[actor]?.isCrown);
  const actorName =
    actor === "system"
      ? "Anyone (automatic step)"
      : actor === "simultaneous"
        ? "Everyone"
        : actor === HIDDEN_PLAYER_ID
          ? "A private decision"
          : playerName(game, actor);
  const color = actor !== "system" && actor !== "simultaneous" ? playerColors(game)[actor] : undefined;
  // The Crown's decision: it takes its one option itself, or the soloist / Button holder chooses for it (p.46).
  const crownInfo = crownActs ? decision.crown : undefined;
  const crownOnly = crownActs && decision.legalCommands.length === 1 && !crownInfo?.chooser ? decision.legalCommands[0] : undefined;
  const crownChooserId = crownActs && !crownOnly && decision.legalCommands.length > 0 ? (crownInfo?.chooser ?? crownChooser(game)) : undefined;

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
      {crownInfo?.reason ? (
        <p className="crown-reason">
          <strong>The Crown:</strong> {crownInfo.reason}
        </p>
      ) : null}
      {crownOnly ? (
        <p className="crown-will">
          The Crown will: <strong>{crownOnly.label}</strong>
        </p>
      ) : null}
      {crownChooserId ? (
        <p className="crown-will">
          <strong>{playerName(game, crownChooserId)}</strong> chooses for the Crown
          {game.crown?.playerButton ? " (holding the Player Button)" : ""}:
        </p>
      ) : null}
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
      ) : crownOnly ? (
        <div className="command-groups" onMouseLeave={() => onHover([])}>
          <button
            type="button"
            className="command-button"
            title={crownOnly.description}
            onClick={() => onRun(crownOnly)}
            onMouseEnter={() => onHover(commandTargets(crownOnly))}
            onFocus={() => onHover(commandTargets(crownOnly))}
          >
            Let the Crown act
          </button>
          {crownOnly.description ? <small className="command-description">{crownOnly.description}</small> : null}
        </div>
      ) : decision.legalCommands.length === 0 ? (
        <p className="status-note">
          {game.finalScoring.complete ? "The game is over. See the final scores." : (note ?? "Nothing to decide right now.")}
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
                {group.commands.map(({ command }) => {
                  const warning = Boolean(command.description?.startsWith("Warning"));
                  return (
                    <div key={originalIndex.get(command)} className="command-item">
                      <button
                        type="button"
                        className="command-button"
                        title={command.description}
                        onClick={() => onRun(command)}
                        onMouseEnter={() => onHover(commandTargets(command))}
                        onFocus={() => onHover(commandTargets(command))}
                      >
                        {command.label}
                      </button>
                      {command.description ? (
                        <small className={warning ? "command-description command-warning" : "command-description"}>{command.description}</small>
                      ) : null}
                    </div>
                  );
                })}
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
