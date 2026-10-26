import { useEffect, useState } from "react";
import type { CreateGameResponse, StoredSeat } from "../../online/protocol";
import { CROWN_DIFFICULTIES, CROWN_SCENARIOS, ONLINE_PAGE_PATH, PLAYABLE_SCENARIOS } from "../../online/protocol";
import type { CrownDifficulty, ScenarioId } from "../../data";
import { openTextFile } from "../platform/files";
import { FAMILY_PALETTE } from "../view-model";
import { createGame, describeError, fetchView, importGame } from "./api";
import { isMyDecision } from "./OnlineGame";
import { loadStoredSeats, removeStoredSeat } from "./storage";
import { Turnstile } from "./Turnstile";
import "./online.css";

function absoluteUrl(url: string): string {
  try {
    return new URL(url, location.origin).toString();
  } catch {
    return url;
  }
}

function errorText(error: unknown): string {
  return describeError(error);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link:", text);
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function LinksScreen({ result, onDone }: { result: CreateGameResponse; onDone: () => void }) {
  return (
    <section className="panel online-links" aria-labelledby="links-heading">
      <h2 id="links-heading">Your game is ready</h2>
      <p className="status-note">
        Send each friend their own link. A seat link is that player&apos;s password: anyone who has it can play that seat.
        The creator&apos;s link (marked) can also download the game while it is being played. Send the spectator link to anyone who just wants to watch.
      </p>
      <ul className="link-list">
        {result.seats.map((seat) => (
          <li key={seat.playerId}>
            <div className="link-owner">
              <strong>{seat.name}</strong>
              {seat.creator ? (
                <span className="badge" title="The creator can download the game at any time. Everyone else can once it ends.">
                  Creator
                </span>
              ) : null}
              <a href={absoluteUrl(seat.url)} aria-label={`Open ${seat.name}'s seat`}>
                Open
              </a>
            </div>
            <input readOnly value={absoluteUrl(seat.url)} aria-label={`${seat.name} private link`} onFocus={(event) => event.currentTarget.select()} />
            <CopyButton text={absoluteUrl(seat.url)} label={`Copy ${seat.name}'s link`} />
          </li>
        ))}
        <li>
          <div className="link-owner">
            <strong>Spectators</strong>
            <a href={absoluteUrl(result.spectatorUrl)} aria-label="Open spectator view">
              Open
            </a>
          </div>
          <input readOnly value={absoluteUrl(result.spectatorUrl)} aria-label="Spectator link" onFocus={(event) => event.currentTarget.select()} />
          <CopyButton text={absoluteUrl(result.spectatorUrl)} label="Copy spectator link" />
        </li>
      </ul>
      <button type="button" className="plain-button" onClick={onDone}>
        Back
      </button>
    </section>
  );
}

function StartOnline({ onCreated }: { onCreated: (result: CreateGameResponse) => void }) {
  const [scenario, setScenario] = useState<ScenarioId>("1710");
  const [count, setCount] = useState(4);
  const [difficulty, setDifficulty] = useState<CrownDifficulty>("normal");
  const [names, setNames] = useState<string[]>(["", "", "", "", "", ""]);
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One or two players play against the Crown (rulebook pp.43-46), in the scenarios it has setup cards for.
  const crown = count <= 2;
  const scenarioChoices = PLAYABLE_SCENARIOS.filter((option) => !crown || CROWN_SCENARIOS.includes(option.id));

  async function submit() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createGame({
        scenario,
        players: names.slice(0, count).map((name, index) => ({
          name: name.trim() || `Player ${index + 1}`,
          color: FAMILY_PALETTE[index],
        })),
        turnstileToken: token,
        ...(crown ? { crownDifficulty: difficulty } : {}),
      });
      onCreated(result);
    } catch (reason) {
      setError(errorText(reason));
      setResetSignal((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="start-online-heading">
      <h2 id="start-online-heading">Start an online game</h2>
      <label className="field">
        <span>Scenario</span>
        <select value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioId)} aria-label="Scenario">
          {scenarioChoices.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <small className="status-note">{PLAYABLE_SCENARIOS.find((option) => option.id === scenario)?.description}</small>
      </label>
      <label className="field">
        <span>Players</span>
        <select
          value={count}
          onChange={(event) => {
            const next = Number(event.target.value);
            setCount(next);
            // The Crown has no setup cards for the other scenarios.
            if (next <= 2 && !CROWN_SCENARIOS.includes(scenario)) setScenario(CROWN_SCENARIOS[0]);
          }}
          aria-label="Player count"
        >
          {[1, 2, 3, 4, 5, 6].map((value) => (
            <option key={value} value={value}>
              {value}
              {value <= 2 ? " with the Crown" : ""}
            </option>
          ))}
        </select>
      </label>
      {crown ? (
        <fieldset className="difficulty-list">
          <legend>Crown difficulty</legend>
          {CROWN_DIFFICULTIES.map((option) => (
            <label key={option.id} className="scenario-option">
              <input type="radio" name="crown-difficulty" checked={difficulty === option.id} onChange={() => setDifficulty(option.id)} />
              <span>
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
          <p className="status-note">
            The Crown plays itself from the Crown Handbook, and the server plays its moves.{" "}
            {count === 1 ? "You play alone against it." : "The two of you play against it; whoever holds the Player Button chooses for it when the rules leave a choice."}
          </p>
        </fieldset>
      ) : null}
      <div className="player-list">
        {Array.from({ length: count }, (_, index) => (
          <label key={index} className="player-row">
            <span className="swatch" style={{ backgroundColor: FAMILY_PALETTE[index] }} />
            <input
              value={names[index]}
              placeholder={`Player ${index + 1}`}
              onChange={(event) => setNames((current) => current.map((name, i) => (i === index ? event.target.value : name)))}
              aria-label={`Player ${index + 1} name`}
            />
          </label>
        ))}
      </div>
      <Turnstile onToken={setToken} resetSignal={resetSignal} />
      <button type="button" onClick={submit} disabled={!token || busy}>
        {busy ? "Creating..." : "Create game"}
      </button>
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ImportOnline({ onCreated }: { onCreated: (result: CreateGameResponse) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<{ name: string; text: string } | null>(null);

  async function pick() {
    const result = await openTextFile();
    if (result.status === "success") {
      setSave({ name: result.fileName, text: result.content });
      setError(null);
    } else if (result.status === "error") {
      setError(result.message);
    }
  }

  async function submit() {
    if (!token || !save) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await importGame({ saveText: save.text, turnstileToken: token }));
    } catch (reason) {
      setError(errorText(reason));
      setResetSignal((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="import-heading">
      <h2 id="import-heading">Import a .joco save</h2>
      <p className="status-note">Move a game you are already playing from save files to an online table.</p>
      <div className="import-row">
        <button type="button" onClick={pick}>
          Choose .joco file
        </button>
        <span>{save ? save.name : "No file chosen"}</span>
      </div>
      <Turnstile onToken={setToken} resetSignal={resetSignal} />
      <button type="button" onClick={submit} disabled={!token || !save || busy}>
        {busy ? "Importing..." : "Import and create links"}
      </button>
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type GameSummary = { turn?: number; yourTurn: boolean; finished: boolean; unavailable?: string };

function MyGames() {
  const [seats, setSeats] = useState<StoredSeat[]>(() => loadStoredSeats());
  const [summaries, setSummaries] = useState<Record<string, GameSummary>>({});

  useEffect(() => {
    let cancelled = false;
    for (const seat of seats) {
      fetchView(seat.gameId, seat.token)
        .then((view) => {
          if (cancelled) return;
          const finished = Boolean(view.state.finalScoring.complete);
          setSummaries((current) => ({
            ...current,
            [seat.gameId + seat.token]: {
              turn: view.state.turn,
              finished,
              yourTurn: !finished && isMyDecision(view),
            },
          }));
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setSummaries((current) => ({
            ...current,
            [seat.gameId + seat.token]: { yourTurn: false, finished: false, unavailable: errorText(reason) },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
    // Fetch once per list; the list changes only when a game is removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats.length]);

  if (seats.length === 0) {
    return (
      <section className="panel" aria-labelledby="my-games-heading">
        <h2 id="my-games-heading">Your games in this browser</h2>
        <p className="status-note">None yet. Open a seat or spectator link from a friend, or start a game above.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="my-games-heading">
      <h2 id="my-games-heading">Your games in this browser</h2>
      <ul className="my-games">
        {seats.map((seat) => {
          const summary = summaries[seat.gameId + seat.token];
          const who = seat.viewer.kind === "seat" ? (seat.playerName ?? "Player") : "Spectator";
          return (
            <li key={seat.gameId + seat.token}>
              <a href={`${ONLINE_PAGE_PATH}?game=${encodeURIComponent(seat.gameId)}`}>
                {who} · {seat.scenario ?? "1710"} · {seat.gameId.slice(0, 8)}
              </a>
              {summary?.yourTurn ? <span className="badge turn-badge">Your turn</span> : null}
              {summary?.finished ? <span className="badge">Finished</span> : null}
              {summary?.turn !== undefined && !summary.finished ? <small>Turn {summary.turn}</small> : null}
              {summary?.unavailable ? <small>Unavailable: {summary.unavailable}</small> : null}
              <button
                type="button"
                className="plain-button"
                aria-label={`Forget ${who} ${seat.gameId.slice(0, 8)}`}
                onClick={() => {
                  removeStoredSeat(seat.gameId, seat.token);
                  setSeats(loadStoredSeats());
                }}
              >
                Forget
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function OnlineLanding() {
  const [result, setResult] = useState<CreateGameResponse | null>(null);

  return (
    <main className="setup-screen online-landing">
      <header className="topbar">
        <a className="button-link plain-link" href="/">
          Home
        </a>
        <div>
          <p className="eyebrow">Online</p>
          <h1>Play online</h1>
        </div>
        <a className="button-link plain-link" href="/how-to-play/#playing-online">
          How it works
        </a>
      </header>
      <div className="setup-grid online-grid">
        {result ? (
          <LinksScreen result={result} onDone={() => setResult(null)} />
        ) : (
          <>
            <StartOnline onCreated={setResult} />
            <ImportOnline onCreated={setResult} />
          </>
        )}
        <MyGames />
      </div>
    </main>
  );
}
