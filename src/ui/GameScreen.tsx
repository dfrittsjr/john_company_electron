import { useEffect, useState, type ReactNode } from "react";
import { crownFavorsPausing, standingLabel, type CrownFavorOffer, type GameState, type LegalCommand, type PlayerId } from "../engine";
import { policyDial } from "../data";
import "./game-screen.css";
import { BoardView } from "./BoardView";
import { CrownBoard } from "./CrownBoard";
import { CrownFavors } from "./CrownFavors";
import { DecisionPanel } from "./DecisionPanel";
import { DetailsPanel } from "./DetailsPanel";
import { FinalScoringView } from "./FinalScoringView";
import { LogPanel } from "./LogPanel";
import { NegotiationPanel } from "./NegotiationPanel";
import { ParliamentPanel } from "./ParliamentPanel";
import { PlayerDashboards } from "./PlayerDashboards";
import { RulesPanel } from "./RulesPanel";
import { deregulationAvailable, deregulationStatus } from "./firm-view";
import { commandTargets, humanize, phaseLabel, playerName } from "./view-model";

export type GameScreenProps = {
  game: GameState;
  /** "local" is the hotseat / save-file game; "online" is a server-held game seen by one viewer. */
  mode: "local" | "online";
  /** Runs a command. Local mode applies it in the browser; online mode sends it to the server. */
  runCommand: (actorId: string, type: string, payload: unknown) => void;
  commandError: string | null;
  /**
   * The player whose private information is on screen. Local: whoever confirmed they hold the
   * device. Online: always the viewer's own seat (null for spectators).
   */
  revealedPlayer: PlayerId | null;
  /** Local only: the device-holder changes. */
  onRevealPlayer?: (playerId: PlayerId | null) => void;
  undo: { run: () => void; blockedReason: string | null };
  /** Header buttons between Undo and "Final scores" (save, load, export...). */
  headerActions?: ReactNode;
  onMenu?: () => void;
  /** Rendered under the header (hand-off banner, waiting banner, watching badge). */
  banner?: ReactNode;
  /** Status strips at the top of the sidebar. */
  notices?: ReactNode;
  /** The Save button on the Final Scoring dialog. */
  onSaveFinal?: () => void;
  /** Changing this resets the board's pan and zoom. */
  boardResetKey?: number;
  /** Online: replaces the empty-decision text when someone else (or nobody you control) is to act. */
  decisionNote?: string;
  /** Online spectators: no Deals & Cards form. */
  readOnly?: boolean;
  /** Online: the Deals & Cards form always acts as this player. */
  fixedPlayer?: PlayerId;
  /** Extra header content next to the title (e.g. a connection indicator). */
  titleExtra?: ReactNode;
  /**
   * Local Crown games: whether the Crown waits for favours, and the favours already passed on
   * (crownPausingFavorKeys), so the favours list opens only when the Crown is really waiting.
   */
  crownPauses?: { waitForFavors: boolean; setWaitForFavors: (on: boolean) => void; seenFavors: ReadonlySet<string> };
  /** Online: one more sidebar tab (table talk). `onShow` runs while it is open and `unread` changes. */
  extraTab?: { label: string; unread?: number; content: ReactNode; onShow?: () => void };
};

export function GameScreen({
  game,
  mode,
  runCommand,
  commandError,
  revealedPlayer,
  onRevealPlayer,
  undo,
  headerActions,
  onMenu,
  banner,
  notices,
  onSaveFinal,
  boardResetKey = 0,
  decisionNote,
  readOnly,
  fixedPlayer,
  titleExtra,
  extraTab,
  crownPauses,
}: GameScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string[]>([]);
  const [sideTab, setSideTab] = useState<"log" | "deals" | "laws" | "extra">("log");
  const [rulesOpen, setRulesOpen] = useState<{ sectionId?: string } | null>(null);
  const extraShown = sideTab === "extra" && Boolean(extraTab);
  const extraUnread = extraTab?.unread ?? 0;
  const onExtraShown = extraTab?.onShow;
  useEffect(() => {
    if (extraShown) onExtraShown?.();
  }, [extraShown, extraUnread, onExtraShown]);
  const [finalScoringDismissed, setFinalScoringDismissed] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

      event.preventDefault();
      doUndo();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function doUndo() {
    if (undo.blockedReason) return;
    undo.run();
    setHovered([]);
    setSelected(null);
  }

  function run(actorId: string, type: string, payload: unknown) {
    runCommand(actorId, type, payload);
    setHovered([]);
    setSelected(null);
  }

  const decisionActor = game.pendingDecision.actor;
  const decisionHidden =
    mode === "local" &&
    game.pendingDecision.visibility === "private" &&
    decisionActor !== "system" &&
    decisionActor !== "simultaneous" &&
    !game.players[decisionActor]?.isCrown &&
    revealedPlayer !== decisionActor;
  const legalCommands = game.pendingDecision.legalCommands ?? [];
  const highlights = new Set(decisionHidden ? [] : legalCommands.flatMap(commandTargets));
  const filter = selected && highlights.has(selected) ? selected : null;
  const optionCount = selected ? legalCommands.filter((command) => commandTargets(command).includes(selected)).length : 0;
  const policySpace = policyDial.spaces[game.parliament.policyDialPosition];
  const showFinalScoring = Boolean(game.finalScoring.complete) && !finalScoringDismissed;
  const undoBlocked = undo.blockedReason;

  function buyFavor(playerId: PlayerId, offer: CrownFavorOffer) {
    run(playerId, "crown.favor", { favorId: offer.favorId, ...(offer.option !== undefined ? { option: offer.option } : {}) });
  }

  function giveCubes(from: PlayerId, to: PlayerId, count: number) {
    run(from, "crown.giveCubes", { to, count });
  }

  const crownWaiting =
    Boolean(game.crown) &&
    decisionActor !== "system" &&
    decisionActor !== "simultaneous" &&
    game.players[decisionActor]?.isCrown === true &&
    (crownPauses?.waitForFavors ?? true) &&
    crownFavorsPausing(game, crownPauses?.seenFavors);

  function runLegal(legalCommand: LegalCommand) {
    // The acting player is whoever the decision names. Online, the server ignores this and uses
    // the viewer's token instead.
    run(String(decisionActor), legalCommand.type, legalCommand.payload ?? {});
  }

  return (
    <main className="game-screen">
      <header className="game-header">
        <div className="game-title">
          <p className="eyebrow">John Company · {game.scenario}</p>
          <h1>
            Turn {game.turn} · {phaseLabel(game.phase)}
          </h1>
          {titleExtra}
        </div>
        <dl className="track-strip">
          <div>
            <dt title="Company Standing: the Balance the Company must keep after expenses at Revenue (p.27)">Standing (expectations)</dt>
            <dd>
              {standingLabel(game)}
              {game.company.failed ? " (failed)" : ""}
            </dd>
          </div>
          <div>
            <dt>Debt</dt>
            <dd>{game.company.debt}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>£{game.company.balance}</dd>
          </div>
          {deregulationAvailable(game) || game.parliament.deregulated ? (
            <div>
              <dt title="Deregulation: see the Laws tab">Deregulation</dt>
              <dd>{deregulationStatus(game).summary}</dd>
            </div>
          ) : null}
          <div>
            <dt>Prime Minister</dt>
            <dd>{playerName(game, game.parliament.primeMinister)}</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>{policySpace ? `${humanize(policySpace.consequence)} · ${humanize(policySpace.target)}` : "-"}</dd>
          </div>
        </dl>
        <div className="header-actions">
          <button
            type="button"
            onClick={doUndo}
            disabled={Boolean(undoBlocked)}
            title={undoBlocked ?? "Undo the last action (Ctrl+Z)."}
            aria-describedby={undoBlocked ? "undo-reason" : undefined}
          >
            Undo
          </button>
          {undoBlocked ? (
            <span id="undo-reason" className="visually-hidden">
              {undoBlocked}
            </span>
          ) : null}
          {headerActions}
          {game.finalScoring.complete ? (
            <button type="button" onClick={() => setFinalScoringDismissed(false)}>
              Final scores
            </button>
          ) : null}
          <button type="button" onClick={() => setRulesOpen({})}>
            Rules
          </button>
          {onMenu ? (
            <button type="button" className="plain-button" onClick={onMenu}>
              Menu
            </button>
          ) : null}
        </div>
      </header>

      {banner}

      <div className="game-body">
        <div className="board-column">
          <div className="board-area">
            <BoardView
              game={game}
              resetKey={boardResetKey}
              highlights={highlights}
              focus={new Set(hovered)}
              selected={selected}
              onSelect={(target) => setSelected((current) => (current === target ? null : target))}
            />
            {selected ? (
              <DetailsPanel game={game} target={selected} optionCount={decisionHidden ? 0 : optionCount} onClose={() => setSelected(null)} />
            ) : null}
          </div>
          {game.crown ? <CrownBoard game={game} onOpenRules={(sectionId) => setRulesOpen({ sectionId })} /> : null}
          <PlayerDashboards game={game} revealedPlayer={revealedPlayer} onSelectPlayer={(playerId) => setSelected(`player:${playerId}`)} />
        </div>

        <aside className="sidebar">
          {notices}
          <DecisionPanel
            game={game}
            hidden={decisionHidden}
            onReveal={() => onRevealPlayer?.(typeof decisionActor === "string" ? decisionActor : null)}
            onRun={runLegal}
            onHover={setHovered}
            filter={filter}
            onClearFilter={() => setSelected(null)}
            error={commandError}
            onOpenRules={(sectionId) => setRulesOpen({ sectionId })}
            note={decisionNote}
          />
          {game.crown && !readOnly ? <CrownFavors
              game={game}
              waiting={crownWaiting}
              onFavor={buyFavor}
              onGive={giveCubes}
              waitForFavors={crownPauses ? { on: crownPauses.waitForFavors, set: crownPauses.setWaitForFavors } : undefined}
            /> : null}
          <div className="sidebar-tabs" role="tablist" aria-label="Side panels">
            <button type="button" role="tab" aria-selected={sideTab === "log"} className={sideTab === "log" ? "tab tab-active" : "tab"} onClick={() => setSideTab("log")}>
              Log
            </button>
            <button type="button" role="tab" aria-selected={sideTab === "deals"} className={sideTab === "deals" ? "tab tab-active" : "tab"} onClick={() => setSideTab("deals")}>
              Deals &amp; Cards
            </button>
            <button type="button" role="tab" aria-selected={sideTab === "laws"} className={sideTab === "laws" ? "tab tab-active" : "tab"} onClick={() => setSideTab("laws")}>
              Laws
            </button>
            {extraTab ? (
              <button type="button" role="tab" aria-selected={sideTab === "extra"} className={sideTab === "extra" ? "tab tab-active" : "tab"} onClick={() => setSideTab("extra")}>
                {extraTab.label}
                {extraTab.unread && sideTab !== "extra" ? (
                  <span className="tab-count" aria-label={`${extraTab.unread} unread`}>
                    {extraTab.unread}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          <div className="sidebar-tab-body">
            {sideTab === "extra" && extraTab ? (
              extraTab.content
            ) : sideTab === "log" ? (
              <LogPanel game={game} />
            ) : sideTab === "laws" ? (
              <ParliamentPanel game={game} />
            ) : readOnly ? (
              <section className="negotiation-panel">
                <h2>Deals &amp; Cards</h2>
                <p className="status-note">You are watching. Only seated players can make or accept deals.</p>
              </section>
            ) : (
              <NegotiationPanel
                game={game}
                revealedPlayer={revealedPlayer}
                onReveal={(playerId) => onRevealPlayer?.(playerId)}
                onCommand={run}
                fixedPlayer={fixedPlayer}
              />
            )}
          </div>
        </aside>
      </div>

      {showFinalScoring ? <FinalScoringView game={game} onClose={() => setFinalScoringDismissed(true)} onSave={onSaveFinal} /> : null}
      {rulesOpen ? <RulesPanel initialSectionId={rulesOpen.sectionId} crown={Boolean(game.crown)} onClose={() => setRulesOpen(null)} /> : null}
    </main>
  );
}
