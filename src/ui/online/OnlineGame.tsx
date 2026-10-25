import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameView } from "../../online/protocol";
import { GameScreen } from "../GameScreen";
import { saveTextFile } from "../platform/files";
import { suggestedSaveName } from "../save-names";
import { playerName } from "../view-model";
import { ApiRequestError, OnlineConnection, exportGame, fetchView, sendCommand, sendUndo, type ConnectionStatus } from "./api";
import { saveStoredSeat } from "./storage";
import "./online.css";

const BASE_TITLE = "John Company";
const TURN_TITLE = "(Your turn) John Company";

type Props = {
  gameId: string;
  token: string;
  /** Test hook: build the connection differently (e.g. with a fake socket). */
  connectionFactory?: (options: ConstructorParameters<typeof OnlineConnection>[0]) => OnlineConnection;
};

function newCommandId(): string {
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Whether this viewer has something to decide right now. */
export function isMyDecision(view: GameView): boolean {
  if (view.viewer.kind !== "seat" || view.state.finalScoring.complete) return false;
  const { actor, legalCommands } = view.state.pendingDecision;
  if (actor === view.viewer.playerId) return true;
  return actor === "simultaneous" && (legalCommands?.length ?? 0) > 0;
}

function waitingText(view: GameView): string {
  const decision = view.state.pendingDecision;
  const actor = decision.actor;
  let who: string;
  if (actor === "system") who = "the table";
  else if (actor === "simultaneous") who = "the other players";
  else who = playerName(view.state, actor);
  return `Waiting for ${who}: ${decision.prompt}`;
}

export function OnlineGame({ gameId, token, connectionFactory }: Props) {
  const [view, setView] = useState<GameView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [polling, setPolling] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const connection = useRef<OnlineConnection | null>(null);
  const previousMine = useRef<boolean | null>(null);

  useEffect(() => {
    const options = {
      gameId,
      token,
      onView: (next: GameView) => setView(next),
      onStatus: (next: ConnectionStatus, detail?: { polling: boolean }) => {
        setStatus(next);
        setPolling(Boolean(detail?.polling));
      },
      onFatal: (error: { code: string; message: string }) => setFatal(error.message),
      onRejected: (errors: Array<{ message: string }>) => setCommandError(errors.map((error) => error.message).join(" ")),
    };
    const conn = connectionFactory ? connectionFactory(options) : new OnlineConnection(options);
    connection.current = conn;
    conn.start();
    // Don't wait for the socket handshake to show the board; also surfaces bad links quickly.
    fetchView(gameId, token)
      .then((first) => conn.applyView(first))
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
          conn.stop();
          setFatal(error.message);
        }
      });

    const online = () => conn.retryNow();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      conn.stop();
      connection.current = null;
    };
  }, [gameId, token, connectionFactory]);

  // Remember this seat so the landing page can list it.
  const viewerKey = view ? JSON.stringify(view.viewer) : null;
  useEffect(() => {
    if (!view) return;
    saveStoredSeat({
      gameId,
      token,
      viewer: view.viewer,
      playerName: view.viewer.kind === "seat" ? view.state.players[view.viewer.playerId]?.name : undefined,
      scenario: view.state.scenario,
      joinedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, token, viewerKey]);

  const mine = view ? isMyDecision(view) : false;

  useEffect(() => {
    document.title = mine ? TURN_TITLE : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [mine]);

  useEffect(() => {
    if (!view) return;
    // Only a change to "your turn" while the tab is hidden is worth a notification.
    if (mine && previousMine.current === false && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("John Company: your turn", { body: view.state.pendingDecision.prompt });
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
    previousMine.current = mine;
  }, [mine, view]);

  const runCommand = useCallback(
    async (_actorId: string, type: string, payload: unknown) => {
      const current = view;
      const conn = connection.current;
      if (!current || !conn || current.viewer.kind !== "seat") return;
      if (status === "offline") {
        setCommandError("You are offline. Reconnect to act.");
        return;
      }
      if (busy) return;
      setBusy(true);
      setNotice(null);
      try {
        const response = await sendCommand(gameId, token, {
          id: newCommandId(),
          decisionId: current.state.pendingDecision.id,
          type,
          payload,
        });
        conn.applyView(response.view);
        setCommandError(response.ok ? null : response.errors.map((error) => error.message).join(" "));
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : "The command failed.");
      } finally {
        setBusy(false);
      }
    },
    [view, status, busy, gameId, token],
  );

  const undo = useMemo(() => {
    let blockedReason: string | null = null;
    if (!view) blockedReason = "Loading.";
    else if (view.viewer.kind !== "seat") blockedReason = "Spectators can't undo.";
    else if (busy) blockedReason = "Working...";
    else if (!view.undo.available) blockedReason = view.undo.reason ?? "Undo is not available right now.";

    return {
      blockedReason,
      run: async () => {
        const conn = connection.current;
        if (!conn) return;
        setBusy(true);
        try {
          const response = await sendUndo(gameId, token);
          conn.applyView(response.view);
          setCommandError(response.ok ? null : response.errors.map((error) => error.message).join(" "));
          if (response.ok) setNotice("Undid your last action.");
        } catch (error) {
          setCommandError(error instanceof Error ? error.message : "Undo failed.");
        } finally {
          setBusy(false);
        }
      },
    };
  }, [view, busy, gameId, token]);

  async function exportSave() {
    if (!view) return;
    try {
      const text = await exportGame(gameId, token);
      const result = await saveTextFile(text, suggestedSaveName(view.state));
      if (result.status === "saved" || result.status === "downloaded") setNotice(`Saved ${result.fileName}.`);
      else if (result.status === "error") setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export is not available.");
    }
  }

  async function askNotifications() {
    if (typeof Notification === "undefined") return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(Notification.permission);
    }
  }

  if (fatal) {
    return (
      <main className="start-screen">
        <section className="start-panel" role="alert">
          <h1>Can&apos;t open this game</h1>
          <p>{fatal}</p>
          <p>Check that you opened the whole link, including the part after the #.</p>
          <a className="button-link" href="/online/">
            Back to online games
          </a>
        </section>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="start-screen">
        <section className="start-panel" aria-live="polite">
          <h1>Opening the game...</h1>
          <p>{status === "reconnecting" || status === "offline" ? "Having trouble connecting. Still trying." : "Connecting to the table."}</p>
        </section>
      </main>
    );
  }

  const isSeat = view.viewer.kind === "seat";
  const viewerId = view.viewer.kind === "seat" ? view.viewer.playerId : null;
  const over = Boolean(view.state.finalScoring.complete);
  const waiting = isSeat && !mine && !over ? waitingText(view) : undefined;
  const statusLabel = status === "live" ? (polling ? "Live (polling)" : "Live") : status === "offline" ? "Offline" : status === "reconnecting" ? "Reconnecting" : "Connecting";

  return (
    <GameScreen
      game={view.state}
      mode="online"
      runCommand={runCommand}
      commandError={commandError}
      revealedPlayer={viewerId}
      fixedPlayer={viewerId ?? undefined}
      readOnly={!isSeat}
      undo={undo}
      decisionNote={!isSeat ? "You are watching this game." : waiting ? "Your options appear here when it is your decision." : undefined}
      onMenu={() => {
        window.location.href = "/online/";
      }}
      onSaveFinal={isSeat ? exportSave : undefined}
      titleExtra={
        <p className="online-badges">
          {isSeat ? (
            <span className="badge">Playing as {playerName(view.state, viewerId ?? "")}</span>
          ) : (
            <span className="badge watching-badge">Watching</span>
          )}
          <span className={`badge connection-badge connection-${status}`} role="status" aria-label={`Connection: ${statusLabel}`}>
            {statusLabel}
          </span>
        </p>
      }
      headerActions={
        isSeat ? (
          <>
            <button type="button" onClick={exportSave} title="Download a .joco save of this game (the host, or anyone once the game ends).">
              Export .joco
            </button>
            {permission === "default" ? (
              <button type="button" onClick={askNotifications} title="Get a desktop notification when it is your turn and this tab is in the background.">
                Notify me
              </button>
            ) : null}
          </>
        ) : null
      }
      banner={
        waiting ? (
          <div className="waiting-banner" role="status">
            {waiting}
          </div>
        ) : mine ? (
          <div className="waiting-banner your-turn-banner" role="status">
            Your turn: {view.state.pendingDecision.prompt}
          </div>
        ) : null
      }
      notices={
        <>
          {status !== "live" ? (
            <p className="status-strip" role="status">
              {status === "offline" ? "Offline. Showing the last known position." : "Reconnecting. Showing the last known position."}
            </p>
          ) : null}
          {notice ? (
            <p className="status-strip" role="status">
              {notice}
            </p>
          ) : null}
        </>
      }
    />
  );
}
