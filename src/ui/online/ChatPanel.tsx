import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { GameState } from "../../engine";
import { ONLINE_LIMITS, type ChatMessage } from "../../online/protocol";
import { playerColors } from "../view-model";

type Props = {
  game: GameState;
  messages: ChatMessage[];
  /** Spectators read but can't post. */
  canPost: boolean;
  /** Resolves when the server has the message; rejects with a sentence to show. */
  onSend: (text: string) => Promise<void>;
};

const TIME = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** Table talk for online games: deals are still made with Deals & Cards, this is for the talking. */
export function ChatPanel({ game, messages, canPost, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const colors = playerColors(game);

  // Keep the newest message in view.
  const newest = messages[messages.length - 1]?.id;
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [newest]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text);
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The message was not sent.");
    } finally {
      setSending(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section className="chat-panel" aria-label="Table talk">
      <h2>Table talk</h2>
      {messages.length === 0 ? (
        <p className="status-note">No messages yet. Negotiate here; make the binding deals in Deals &amp; Cards.</p>
      ) : (
        <ol className="chat-messages" ref={list} aria-live="polite">
          {messages.map((message) => (
            <li key={message.id}>
              <span className="chat-meta">
                <span className="swatch" style={{ backgroundColor: colors[message.playerId] }} aria-hidden="true" />
                <strong>{message.name}</strong>
                <time dateTime={message.at}>{TIME.format(new Date(message.at))}</time>
              </span>
              <span className="chat-text">{message.text}</span>
            </li>
          ))}
        </ol>
      )}
      {canPost ? (
        <form className="chat-form" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="chat-draft">
            Message
          </label>
          <textarea
            id="chat-draft"
            value={draft}
            maxLength={ONLINE_LIMITS.maxChatLength}
            rows={2}
            placeholder="Message the table"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keyDown}
          />
          <button type="submit" disabled={sending || !draft.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="status-note">You are watching. Only seated players can post.</p>
      )}
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
