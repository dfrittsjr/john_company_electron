import { useState } from "react";
import boardImage from "../../board_image-1.png";
import {
  applyCommand,
  createNewGame,
  type GameCommand,
  type GameState,
  type LegalCommand,
} from "../engine";

type ScenarioId = "1710" | "1758" | "1813" | "long-1710";
type GameMode = "soloCrown" | "twoPlayerCrown" | "hotseat";
type CrownDifficulty = "easy" | "normal" | "hard" | "expert";

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

const scenarioOptions: Array<{
  id: ScenarioId;
  name: string;
  description: string;
}> = [
  {
    id: "1710",
    name: "1710",
    description: "Early Company start with the broadest room for expansion.",
  },
  {
    id: "1758",
    name: "1758",
    description: "Mid-game Company power with Deregulation pressure.",
  },
  {
    id: "1813",
    name: "1813",
    description: "Free trade era with firms from the beginning.",
  },
  {
    id: "long-1710",
    name: "Long 1710",
    description: "Extended campaign across the full arc of the Company.",
  },
];

const playerColors = ["#8d1d34", "#b88a1d", "#b9483f", "#6f5aa7", "#2f6f73", "#4f6732"];

function createPlayers(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    color: playerColors[index],
  }));
}

function modeForPlayerCount(playerCount: number): GameMode {
  if (playerCount === 1) return "soloCrown";
  if (playerCount === 2) return "twoPlayerCrown";
  return "hotseat";
}

export function App() {
  const [screen, setScreen] = useState<"start" | "setup" | "board">("start");
  const [game, setGame] = useState<GameState | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupState>({
    scenario: "1710",
    playerCount: 4,
    crownDifficulty: "normal",
    setupDistribution: "draft",
    players: createPlayers(4),
  });

  const mode = modeForPlayerCount(setup.playerCount);
  const crownEnabled = mode !== "hotseat";

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
    const nextGame = createNewGame({
      mode,
      scenario: setup.scenario,
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name.trim() || player.id,
        color: player.color,
      })),
      crownDifficulty: setup.crownDifficulty,
      seed: `${setup.scenario}:${mode}:${setup.players.map((player) => player.name).join("|")}`,
    });

    setGame(nextGame);
    setCommandError(null);
    setScreen("board");
  }

  function executeLegalCommand(legalCommand: LegalCommand) {
    if (!game) return;

    if (game.pendingDecision.actor === "simultaneous") {
      setCommandError("Simultaneous decisions are not implemented in the starter UI yet.");
      return;
    }

    const command: GameCommand = {
      id: `cmd-${Date.now()}`,
      gameId: game.gameId,
      actorId: game.pendingDecision.actor,
      decisionId: game.pendingDecision.id,
      type: legalCommand.type,
      payload: legalCommand.payload ?? {},
      clientTimestamp: new Date().toISOString(),
    };
    const result = applyCommand(game, command);

    if (result.ok) {
      setGame(result.state);
      setCommandError(null);
    } else {
      setCommandError(result.errors.map((error) => error.message).join(" "));
    }
  }

  if (screen === "start") {
    return (
      <main className="start-screen">
        <section className="start-panel" aria-labelledby="title">
          <p className="eyebrow">Local desktop implementation</p>
          <h1 id="title">John Company: Second Edition</h1>
          <p>
            A rules-enforced hotseat and async adaptation with Crown support planned from the engine
            outward.
          </p>
          <div className="start-actions">
            <button type="button" onClick={() => setScreen("setup")}>
              New Game
            </button>
            <button type="button" disabled title="Save/load arrives with the save milestone">
              Load Game
            </button>
            <button type="button" disabled title="Rules reference arrives after data entry">
              Rules Reference
            </button>
          </div>
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
          <button type="button" onClick={startGame}>
            Start
          </button>
        </header>

        <section className="setup-grid">
          <div className="panel">
            <h2>Scenario</h2>
            <div className="scenario-list">
              {scenarioOptions.map((scenario) => (
                <label key={scenario.id} className="scenario-option">
                  <input
                    type="radio"
                    name="scenario"
                    checked={setup.scenario === scenario.id}
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
                <label className="field">
                  <span>Crown difficulty</span>
                  <select
                    value={setup.crownDifficulty}
                    onChange={(event) =>
                      setSetup((current) => ({
                        ...current,
                        crownDifficulty: event.target.value as CrownDifficulty,
                      }))
                    }
                  >
                    <option value="easy">Easy</option>
                    <option value="normal">Normal</option>
                    <option value="hard">Hard</option>
                    <option value="expert">Expert</option>
                  </select>
                </label>
                <p className="status-note">
                  Crown mode initializes with promise cubes, AI deck, climate, and Player Button
                  state once the engine data milestone is complete.
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
                <option value="draft">Draft</option>
                <option value="random">Random</option>
              </select>
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
        </section>
      </main>
    );
  }

  if (!game) {
    return null;
  }

  const pendingActor =
    game.pendingDecision.actor === "simultaneous"
      ? "Simultaneous"
      : game.pendingDecision.actor === "system"
        ? "System"
        : (game.players[game.pendingDecision.actor]?.name ?? game.pendingDecision.actor);
  const playerRows = game.seatingOrder.map((playerId) => game.players[playerId]);

  return (
    <main className="game-screen">
      <header className="game-header">
        <div>
          <p className="eyebrow">John Company</p>
          <h1>{game.scenario}</h1>
        </div>
        <dl className="track-strip">
          <div>
            <dt>Mode</dt>
            <dd>{game.mode}</dd>
          </div>
          <div>
            <dt>Turn</dt>
            <dd>{game.turn}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{game.phase}</dd>
          </div>
          <div>
            <dt>Standing</dt>
            <dd>{game.company.standing}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>GBP {game.company.balance}</dd>
          </div>
          <div>
            <dt>Debt</dt>
            <dd>{game.company.debt}</dd>
          </div>
        </dl>
        <button type="button" onClick={() => setScreen("setup")}>
          Setup
        </button>
      </header>

      <section className="game-layout">
        <aside className="side-panel">
          <h2>Pending Decision</h2>
          <p>{game.pendingDecision.prompt}</p>
          <dl className="decision-meta">
            <div>
              <dt>Actor</dt>
              <dd>{pendingActor}</dd>
            </div>
            <div>
              <dt>Step</dt>
              <dd>{game.pendingDecision.step}</dd>
            </div>
          </dl>
          <div className="legal-command-list">
            {game.pendingDecision.legalCommands.length > 0 ? (
              game.pendingDecision.legalCommands.map((legalCommand, index) => (
                <button
                  key={`${legalCommand.type}-${index}`}
                  type="button"
                  onClick={() => executeLegalCommand(legalCommand)}
                  title={legalCommand.description}
                >
                  {legalCommand.label}
                </button>
              ))
            ) : (
              <p className="status-note">No legal commands are implemented for this step yet.</p>
            )}
          </div>
          {commandError ? <p className="error-note">{commandError}</p> : null}
          <button type="button" disabled>
            Save Game
          </button>

          {game.crown ? (
            <div className="crown-summary">
              <h3>Crown</h3>
              <p>Difficulty: {game.crown.difficulty}</p>
              <p>Climate: {game.crown.climate}</p>
              <p>Faceup AI card: {game.crown.faceupAiCard}</p>
              <p>Crown cubes: {game.crown.promiseCubes.crownSupply}</p>
              {game.crown.playerButton ? (
                <p>Player Button: {game.players[game.crown.playerButton.holder]?.name}</p>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="board-stage" aria-label="Game board">
          <div className="board-frame">
            <img src={boardImage} alt="John Company game board" />
            <div className="board-overlay standing">Standing</div>
            <div className="board-overlay offices">Offices</div>
            <div className="board-overlay india">India</div>
          </div>
        </section>

        <aside className="side-panel">
          <h2>Players</h2>
          <div className="dashboard-list">
            {playerRows.map((player) => (
              <div key={player.id} className="dashboard-row">
                <span className="swatch" style={{ backgroundColor: player.color }} />
                <strong>{player.name}</strong>
                <small>
                  GBP {player.cash} / family supply {player.familyMembers.supply}
                </small>
              </div>
            ))}
          </div>
          <h2>Log</h2>
          <ol className="log-list">
            {game.log.map((entry) => (
              <li key={entry.id}>{entry.summary}</li>
            ))}
          </ol>
        </aside>
      </section>
    </main>
  );
}
