import { useEffect, useRef, useState } from "react";
import {
  applyCommand,
  createNewGame,
  standingLabel,
  undoBlockReason,
  crownPausingFavorKeys,
  runCrownSteps,
  type GameCommand,
  type GameState,
  type LegalCommand,
} from "../engine";
import {
  policyDial,
  validateNewGameStaticData,
  type CrownDifficulty,
  type PlayMode,
  type ScenarioId,
  type ValidationIssue,
} from "../data";
import { CROWN_DIFFICULTIES, PLAYABLE_SCENARIOS } from "../online/protocol";
import { deserializeGameState, serializeSave } from "../save";
import "./game-screen.css";
import { GameScreen } from "./GameScreen";
import { HandoffBanner } from "./HandoffBanner";
import { copyText, openTextFile, saveTextFile, TEXT_FILE_TYPE } from "./platform/files";
import { installFlexGapFallback } from "./platform/flex-gap-fallback";
import { nextActorName, suggestedSaveName, suggestedSummaryName } from "./save-names";
import { FAMILY_PALETTE, commandTargets, handoffTarget, humanize, phaseLabel, playerName, soloPlayer } from "./view-model";

type PlayerSetup = {
  id: string;
  name: string;
  color: string;
};

type SetupState = {
  scenario: ScenarioId;
  playerCount: number;
  crownDifficulty: CrownDifficulty;
  setupDistribution: "draft" | "random";
  players: PlayerSetup[];
};

const scenarioOptions = [
  ...PLAYABLE_SCENARIOS,
  { id: "1758" as ScenarioId, name: "1758", description: "Not available yet: this scenario's setup is not built." },
  { id: "1813" as ScenarioId, name: "1813", description: "Not available yet: this scenario's setup is not built." },
];

const playableIds = new Set<ScenarioId>(PLAYABLE_SCENARIOS.map((scenario) => scenario.id));


function createPlayers(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    color: FAMILY_PALETTE[index],
  }));
}

function modeForPlayerCount(playerCount: number): PlayMode {
  if (playerCount === 1) return "soloCrown";
  if (playerCount === 2) return "twoPlayerCrown";
  return "hotseat";
}

function formatMode(mode: PlayMode): string {
  if (mode === "soloCrown") return "Solo Crown";
  if (mode === "twoPlayerCrown") return "Two-player Crown";
  return "Hotseat";
}

function summarizeValidationIssues(issues: ValidationIssue[]): string[] {
  const crownAiPlaceholderIssues = issues.filter(
    (issue) => issue.code === "new-game.crown.ai-card-field-missing",
  );
  const otherIssues = issues.filter(
    (issue) => issue.code !== "new-game.crown.ai-card-field-missing",
  );
  const summaries = otherIssues.map((issue) => issue.message);

  if (crownAiPlaceholderIssues.length > 0) {
    const cardIds = [
      ...new Set(
        crownAiPlaceholderIssues
          .map((issue) => issue.path.match(/crown\.aiCards\.([^.]+)/)?.[1])
          .filter((cardId): cardId is string => Boolean(cardId)),
      ),
    ];
    const fieldCount = new Set(
      crownAiPlaceholderIssues.map((issue) =>
        issue.path.replace(/^crown\.aiCards\.[^.]+\./, ""),
      ),
    ).size;

    summaries.unshift(
      `Crown modes are blocked by placeholder AI cards: ${cardIds.length} card${cardIds.length === 1 ? "" : "s"} (${cardIds.join(", ")}) are missing ${fieldCount} required Crown AI fields from the Crown Handbook.`,
    );
  }

  return summaries;
}

function actorLabel(game: GameState): string {
  if (game.pendingDecision.actor === "simultaneous") return "Simultaneous";
  if (game.pendingDecision.actor === "system") return "System";

  return game.players[game.pendingDecision.actor]?.name ?? game.pendingDecision.actor;
}

function buildSaveSummary(game: GameState): string {
  const lines = [
    "John Company 2E",
    `Game: ${game.scenario}, Turn ${game.turn}, ${game.phase}`,
    `Pending: ${actorLabel(game)} must resolve ${game.pendingDecision.step}`,
    `Game ID: ${game.gameId}`,
  ];

  if (game.crown) {
    const humanCubeSummary = Object.entries(game.crown.promiseCubes.byHumanPlayer)
      .map(([playerId, cubes]) => `${game.players[playerId]?.name ?? playerId} ${cubes}`)
      .join(" / ");
    lines.push(
      `Crown: ${game.crown.difficulty}, Climate ${game.crown.climate}, Promise cubes Crown ${game.crown.promiseCubes.crownSupply} / ${humanCubeSummary}`,
    );

    if (game.crown.playerButton) {
      lines.push(
        `Player Button: ${
          game.players[game.crown.playerButton.holder]?.name ?? game.crown.playerButton.holder
        }`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Plays the Crown's automatic steps; stops when a player must act or choose for the Crown, or a
 * favour they haven't passed on (`seenFavors`) is on offer.
 */
function playCrown(state: GameState, idPrefix: string, pauses?: { seenFavors: ReadonlySet<string>; waitForFavors: boolean }): GameState {
  if (!state.crown) return state;
  return runCrownSteps(state, {
    now: new Date().toISOString(),
    idPrefix: `${idPrefix}-crown`,
    seenFavors: pauses?.seenFavors,
    ignoreFavors: pauses ? !pauses.waitForFavors : false,
  }).state;
}

const WAIT_FOR_FAVORS_KEY = "jc-crown-wait-for-favours";

function readWaitForFavors(): boolean {
  try {
    return window.localStorage.getItem(WAIT_FOR_FAVORS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function App() {
  const [screen, setScreen] = useState<"start" | "setup" | "board">("start");
  const [game, setGame] = useState<GameState | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  // The player who has confirmed they hold the device; private cards and decisions show only to them.
  const [revealedPlayer, setRevealedPlayer] = useState<string | null>(null);
  // The player who should receive the save after the last move, when it is someone else.
  const [handoff, setHandoff] = useState<string | null>(null);
  const [boardResetKey, setBoardResetKey] = useState(0);
  // Earlier states of this browser session, oldest first. Cleared whenever the game is saved,
  // loaded, or created, so a file that has been passed on can never be taken back.
  const [history, setHistory] = useState<GameState[]>([]);
  // Favours the players let pass when the Crown waited (crownPausingFavorKeys): it doesn't wait for
  // the same favour again while acting in the same place. Keys carry the turn and phase.
  const seenFavors = useRef(new Set<string>());
  const [waitForFavors, setWaitForFavorsState] = useState(readWaitForFavors);
  function setWaitForFavors(on: boolean) {
    setWaitForFavorsState(on);
    try {
      window.localStorage.setItem(WAIT_FOR_FAVORS_KEY, on ? "on" : "off");
    } catch {
      // Private windows may refuse storage; the setting then lasts for this visit.
    }
  }
  const [undoStatus, setUndoStatus] = useState<string | null>(null);

  useEffect(() => installFlexGapFallback(), []);

  const previous = history.at(-1);
  const undoBlocked = !previous ? "Nothing to undo." : game ? undoBlockReason(previous, game) : "Nothing to undo.";

  function undo() {
    if (!game || !previous || undoBlocked) return;

    setUndoStatus(`Undid: ${game.log.at(-1)?.summary ?? "the last action"}`);
    setGame(previous);
    setHistory((current) => current.slice(0, -1));
    setCommandError(null);
    // The restored decision may belong to someone else: hide private information again.
    setHandoff(null);
    setRevealedPlayer(null);
  }

  const [setup, setSetup] = useState<SetupState>({
    scenario: "1710",
    playerCount: 4,
    crownDifficulty: "normal",
    setupDistribution: "random",
    players: createPlayers(4),
  });

  const mode = modeForPlayerCount(setup.playerCount);
  const crownEnabled = mode !== "hotseat";
  const newGameValidation = validateNewGameStaticData({
    scenarioId: setup.scenario,
    mode,
    humanPlayerCount: setup.playerCount,
  });
  const validationErrors = newGameValidation.issues.filter((issue) => issue.severity === "error");
  const validationWarnings = newGameValidation.issues.filter(
    (issue) => issue.severity === "warning",
  );
  const validationErrorSummaries = summarizeValidationIssues(validationErrors);
  const validationWarningSummaries = summarizeValidationIssues(validationWarnings);
  const startDisabled = !newGameValidation.valid || !playableIds.has(setup.scenario);

  function updatePlayerCount(playerCount: number) {
    setSetup((current) => ({
      ...current,
      playerCount,
      players: createPlayers(playerCount),
    }));
  }

  function updatePlayerName(id: string, name: string) {
    setSetup((current) => ({
      ...current,
      players: current.players.map((player) => (player.id === id ? { ...player, name } : player)),
    }));
  }

  function startGame() {
    if (!newGameValidation.valid || !playableIds.has(setup.scenario)) return;

    const nextGame = createNewGame({
      mode,
      scenario: setup.scenario,
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name.trim() || player.id,
        color: player.color,
      })),
      crownDifficulty: setup.crownDifficulty,
      setupDistribution: "random",
      seed: `${setup.scenario}:${mode}:${setup.players.map((player) => player.name).join("|")}${crownEnabled ? `:${Date.now()}` : ""}`,
    });

    setGame(playCrown(nextGame, `crown-${Date.now()}`));
    setHistory([]);
    setUndoStatus(null);
    setCommandError(null);
    setSaveStatus(null);
    setHandoff(null);
    setRevealedPlayer(null);
    setBoardResetKey((key) => key + 1);
    setScreen("board");
  }

  function runCommand(actorId: string, type: string, payload: unknown) {
    if (!game) return;

    if (game.pendingDecision.actor === "simultaneous") {
      setCommandError("Simultaneous decisions are not implemented in the starter UI yet.");
      return;
    }

    applyAndHandOff({
      id: `cmd-${Date.now()}`,
      gameId: game.gameId,
      actorId,
      decisionId: game.pendingDecision.id,
      type,
      payload,
      clientTimestamp: new Date().toISOString(),
    });
  }

  function applyAndHandOff(command: GameCommand) {
    if (!game) return;
    const result = applyCommand(game, command);

    if (!result.ok) {
      setCommandError(result.errors.map((error) => error.message).join(" "));
      return;
    }

    // Letting the Crown act passes on the favours that were on offer.
    if (game.crown && command.actorId === "crown") {
      for (const key of crownPausingFavorKeys(game)) seenFavors.current.add(key);
    }
    // In a Crown game the Crown's single-option steps follow without anyone clicking. They share
    // this move's history entry, so one Undo takes back the move and everything it triggered.
    const state = playCrown(result.state, command.id, { seenFavors: seenFavors.current, waitForFavors });
    const next = handoffTarget(state, command.actorId);
    setHistory((current) => [...current, game]);
    setUndoStatus(null);
    setGame(state);
    setCommandError(null);
    if (next) {
      // Someone else decides next: hide private information until they reveal it.
      setHandoff(next);
      setRevealedPlayer(null);
    } else {
      setHandoff(null);
    }
  }

  async function saveGame() {
    if (!game) return;

    const now = new Date().toISOString();
    const content = serializeSave(game, {
      saveId: `save-${Date.now()}`,
      now,
    });
    const result = await saveTextFile(content, suggestedSaveName(game));
    const handoff = `Send it to ${nextActorName(game)}.`;

    if (result.status === "saved" || result.status === "downloaded") {
      // The file is on its way to the next player: it can no longer be taken back.
      setHistory([]);
      setUndoStatus(null);
    }
    if (result.status === "saved") {
      setSaveStatus(`Saved ${result.fileName}. ${handoff}`);
    } else if (result.status === "downloaded") {
      setSaveStatus(`Downloaded ${result.fileName} to your downloads folder. ${handoff}`);
    } else if (result.status === "cancel") {
      setSaveStatus("Save canceled.");
    } else {
      setSaveStatus(result.message);
    }
  }

  async function loadGame() {
    const result = await openTextFile();
    if (result.status === "cancel") {
      setSaveStatus("Load canceled.");
      return;
    }
    if (result.status === "error") {
      setSaveStatus(result.message);
      return;
    }

    try {
      const loadedGame = deserializeGameState(result.content);
      setGame(loadedGame);
      setHistory([]);
      setUndoStatus(null);
      setBoardResetKey((key) => key + 1);
      setCommandError(null);
      setRevealedPlayer(null);
      setHandoff(null);
      setSaveStatus(`Loaded ${result.fileName}`);
      setScreen("board");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "Failed to load save file.");
    }
  }

  async function copySaveSummary() {
    if (!game) return;

    const summary = buildSaveSummary(game);
    const result = await copyText(summary);
    if (result.status === "success") {
      setSaveStatus("Save summary copied.");
    } else {
      setSaveStatus(`${result.message}\n${summary}`);
    }
  }

  async function downloadSaveSummary() {
    if (!game) return;

    const result = await saveTextFile(
      buildSaveSummary(game),
      suggestedSummaryName(game),
      TEXT_FILE_TYPE,
    );
    if (result.status === "saved" || result.status === "downloaded") {
      setSaveStatus(`Saved summary ${result.fileName}.`);
    } else if (result.status === "cancel") {
      setSaveStatus("Summary save canceled.");
    } else {
      setSaveStatus(result.message);
    }
  }

  if (screen === "start") {
    return (
      <main className="start-screen">
        <section className="start-panel" aria-labelledby="title">
          <p className="eyebrow">Unofficial browser edition</p>
          <h1 id="title">John Company: Second Edition</h1>
          <p>
            A rules-enforced adaptation for hotseat play or for passing a save file between
            friends.
          </p>
          <div className="start-actions">
            <button type="button" onClick={() => setScreen("setup")}>
              New Game
            </button>
            <button type="button" onClick={loadGame}>
              Load Save
            </button>
            <a className="button-link" href="/how-to-play/">
              How to Play
            </a>
            <a className="button-link" href="/credits/">
              Credits
            </a>
          </div>
          {saveStatus ? <p className="status-note start-status">{saveStatus}</p> : null}
        </section>
      </main>
    );
  }

  if (screen === "setup") {
    return (
      <main className="setup-screen">
        <header className="topbar">
          <button type="button" className="plain-button" onClick={() => setScreen("start")}>
            Back
          </button>
          <div>
            <p className="eyebrow">New game</p>
            <h1>Campaign Setup</h1>
          </div>
          <button
            type="button"
            onClick={startGame}
            disabled={startDisabled}
            title={
              startDisabled ? "Resolve static data validation issues before starting." : undefined
            }
          >
            Start
          </button>
        </header>

        <section className="setup-grid">
          <div className="panel">
            <h2>Scenario</h2>
            <div className="scenario-list">
              {scenarioOptions.map((scenario) => (
                <label key={scenario.id} className={playableIds.has(scenario.id) ? "scenario-option" : "scenario-option scenario-option-disabled"}>
                  <input
                    type="radio"
                    name="scenario"
                    checked={setup.scenario === scenario.id}
                    disabled={!playableIds.has(scenario.id)}
                    onChange={() => setSetup((current) => ({ ...current, scenario: scenario.id }))}
                  />
                  <span>
                    <strong>{scenario.name}</strong>
                    <small>{scenario.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Players</h2>
            <label className="field">
              <span>Player count</span>
              <select
                value={setup.playerCount}
                onChange={(event) => updatePlayerCount(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>
                    {count}
                    {count <= 2 ? " with Crown" : ""}
                  </option>
                ))}
              </select>
            </label>

            {crownEnabled ? (
              <div className="crown-settings">
                <fieldset className="difficulty-list">
                  <legend>Crown difficulty</legend>
                  {CROWN_DIFFICULTIES.map((difficulty) => (
                    <label key={difficulty.id} className="scenario-option">
                      <input
                        type="radio"
                        name="crown-difficulty"
                        checked={setup.crownDifficulty === difficulty.id}
                        onChange={() => setSetup((current) => ({ ...current, crownDifficulty: difficulty.id }))}
                      />
                      <span>
                        <strong>{difficulty.name}</strong>
                        <small>{difficulty.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="status-note">
                  The Crown plays itself from the Crown Handbook, in 1710 or Long 1710. You can also play it online.
                </p>
              </div>
            ) : null}

            <label className="field">
              <span>Setup distribution</span>
              <select
                value={setup.setupDistribution}
                onChange={(event) =>
                  setSetup((current) => ({
                    ...current,
                    setupDistribution: event.target.value as SetupState["setupDistribution"],
                  }))
                }
              >
                <option value="draft" disabled>
                  Draft (coming later)
                </option>
                <option value="random">Random</option>
              </select>
              <p className="status-note">
                Random setup is implemented for 1710 and Long 1710. Draft setup remains on the rules
                backlog.
              </p>
            </label>

            <div className="player-list">
              {setup.players.map((player) => (
                <label key={player.id} className="player-row">
                  <span className="swatch" style={{ backgroundColor: player.color }} />
                  <input
                    value={player.name}
                    onChange={(event) => updatePlayerName(player.id, event.target.value)}
                    aria-label={`${player.id} name`}
                  />
                </label>
              ))}
            </div>
          </div>

          <div
            className={`panel validation-panel ${
              newGameValidation.valid ? "validation-panel-valid" : "validation-panel-invalid"
            }`}
          >
            <h2>Static Data</h2>
            <p className="validation-summary">
              {newGameValidation.valid
                ? `${formatMode(mode)} ${setup.scenario} is ready to start with ${
                    setup.playerCount
                  } human player${setup.playerCount === 1 ? "" : "s"}.`
                : `${formatMode(mode)} ${setup.scenario} cannot start with ${
                    setup.playerCount
                  } human player${
                    setup.playerCount === 1 ? "" : "s"
                  } until static data issues are resolved.`}
            </p>
            {validationErrorSummaries.length > 0 ? (
              <div className="validation-issues" role="alert">
                <strong>Blocking issues</strong>
                <ul>
                  {validationErrorSummaries.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {validationWarningSummaries.length > 0 ? (
              <div className="validation-issues validation-warnings">
                <strong>Warnings</strong>
                <ul>
                  {validationWarningSummaries.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  if (!game) {
    return null;
  }

  return (
    <GameScreen
      key={boardResetKey}
      game={game}
      mode="local"
      runCommand={runCommand}
      commandError={commandError}
      revealedPlayer={soloPlayer(game) ?? revealedPlayer}
      onRevealPlayer={setRevealedPlayer}
      undo={{ run: undo, blockedReason: undoBlocked ?? null }}
      boardResetKey={boardResetKey}
      onMenu={() => setScreen("start")}
      onSaveFinal={saveGame}
      crownPauses={game.crown ? { waitForFavors, setWaitForFavors, seenFavors: seenFavors.current } : undefined}
      headerActions={
        <>
          <button type="button" onClick={saveGame} title="Save a .joco file named for whoever acts next, then send it to them.">
            Save &amp; pass
          </button>
          <button type="button" onClick={loadGame}>
            Load
          </button>
          <button type="button" onClick={copySaveSummary}>
            Copy summary
          </button>
          <button type="button" onClick={downloadSaveSummary}>
            Summary file
          </button>
        </>
      }
      banner={
        handoff && game.players[handoff] ? (
          <HandoffBanner game={game} target={handoff} onSave={saveGame} onDismiss={() => setHandoff(null)} />
        ) : null
      }
      notices={
        <>
          {saveStatus ? <p className="status-strip">{saveStatus}</p> : null}
          {undoStatus ? (
            <p className="status-strip" role="status">
              {undoStatus}
            </p>
          ) : null}
        </>
      }
    />
  );
}
