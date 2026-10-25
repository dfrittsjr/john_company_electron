import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIDDEN_PLAYER_ID, type ChatMessage, type GameView } from "../../online/protocol";
import { GameScreen } from "../GameScreen";
import { saveTextFile } from "../platform/files";
import { suggestedSaveName } from "../save-names";
import { playerName } from "../view-model";
import {
  ApiRequestError,
  OnlineConnection,
  describeError,
  describeRejection,
  exportGame,
  fetchView,
  isFatalApiError,
  mergeChat,
  sendChat,
  sendCommand,
  sendUndo,
  type ConnectionStatus,
} from "./api";
import { ChatPanel } from "./ChatPanel";
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
  if (actor === HIDDEN_PLAYER_ID) return "Waiting for a player's private decision.";
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
  const [chat, setChat] = useState<ChatMessage[]>([]);
  // Messages up to this id have been on screen, or were there when the page opened.
  const [chatSeen, setChatSeen] = useState<number | null>(null);

  useEffect(() => {
    const options = {
      gameId,
      token,
      onView: (next: GameView) => {
        setView(next);
        if (!next.chat) return;
        // What was already said before this page opened counts as read.
        const newest = next.chat[next.chat.length - 1]?.id ?? 0;
        setChatSeen((seen) => seen ?? newest);
        setChat((current) => mergeChat(current, next.chat ?? []));
      },
      onChat: (message: ChatMessage) => setChat((current) => mergeChat(current, [message])),
      onStatus: (next: ConnectionStatus, detail?: { polling: boolean }) => {
        setStatus(next);
        setPolling(Boolean(detail?.polling));
      },
      onFatal: (error: { code: string; message: string }) => setFatal(error.message),
      onRejected: (errors: Array<{ code: string; message: string }>) => setCommandError(describeRejection(errors)),
    };
    const conn = connectionFactory ? connectionFactory(options) : new OnlineConnection(options);
    connection.current = conn;
    conn.start();
    // Don't wait for the socket handshake to show the board; also surfaces bad links quickly.
    fetchView(gameId, token)
      .then((first) => conn.applyView(first))
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && isFatalApiError(error)) {
          conn.stop();
          setFatal(describeError(error));
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

  const viewerSeat = view?.viewer.kind === "seat" ? view.viewer.playerId : null;
  const unread = chat.filter((message) => message.id > (chatSeen ?? Infinity) && message.playerId !== viewerSeat).length;
  const markChatSeen = useCallback(() => setChatSeen(chat[chat.length - 1]?.id ?? 0), [chat]);

  const postChat = useCallback(
    async (text: string) => {
      try {
        const response = await sendChat(gameId, token, text);
        setChat((current) => mergeChat(current, [response.message]));
      } catch (error) {
        throw new Error(describeError(error, "The message was not sent."));
      }
    },
    [gameId, token],
  );

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
        setCommandError(response.ok ? null : describeRejection(response.errors));
      } catch (error) {
        if (error instanceof ApiRequestError && isFatalApiError(error)) {
          connection.current?.stop();
          setFatal(describeError(error));
        } else {
          setCommandError(describeError(error, "The command failed."));
        }
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
          setCommandError(response.ok ? null : describeRejection(response.errors));
          if (response.ok) setNotice("Undid your last action.");
        } catch (error) {
          setCommandError(describeError(error, "Undo failed."));
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
      setNotice(describeError(error, "Export is not available."));
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
  // The server says whether this viewer may download now (the creator, or anyone after the game).
  // A server that does not say yet is treated as allowing it; it refuses with EXPORT_NOT_ALLOWED if not.
  const canExport = isSeat && (view.export?.available ?? true);
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
      onSaveFinal={canExport ? exportSave : undefined}
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
            {canExport ? (
              <button type="button" onClick={exportSave} title="Download a .joco save of this game.">
                Export .joco
              </button>
            ) : null}
            {permission === "default" ? (
              <button type="button" onClick={askNotifications} title="Get a desktop notification when it is your turn and this tab is in the background.">
                Notify me
              </button>
            ) : null}
          </>
        ) : null
      }
      extraTab={{
        label: "Chat",
        unread,
        onShow: markChatSeen,
        content: <ChatPanel game={view.state} messages={chat} canPost={isSeat} onSend={postChat} />,
      }}
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
