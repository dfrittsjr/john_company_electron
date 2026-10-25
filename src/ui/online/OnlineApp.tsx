import { useEffect, useState } from "react";
import { ApiRequestError, describeError, joinGame } from "./api";
import { Turnstile } from "./Turnstile";
import "../game-screen.css";
import { installFlexGapFallback } from "../platform/flex-gap-fallback";
import { OnlineGame } from "./OnlineGame";
import { OnlineLanding } from "./OnlineLanding";
import { loadStoredSeats, readOnlineLocation, saveStoredSeat, storedSeatFor } from "./storage";

/**
 * The first time this browser opens a link, it exchanges the link's token for the viewer's role
 * with a Turnstile check (POST /join), then remembers the seat. Later visits skip this.
 */
function JoinGate({ gameId, token, onJoined }: { gameId: string; token: string; onJoined: () => void }) {
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    if (!turnstile) return;
    let cancelled = false;
    joinGame(gameId, { token, turnstileToken: turnstile })
      .then((joined) => {
        if (cancelled) return;
        saveStoredSeat({
          gameId,
          token,
          viewer: joined.viewer,
          playerName: joined.playerName,
          joinedAt: new Date().toISOString(),
        });
        onJoined();
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(describeError(reason, "Could not join this game."));
        // A used or failed bot-check token is no good again.
        if (!(reason instanceof ApiRequestError) || reason.code === "TURNSTILE_FAILED") setResetSignal((value) => value + 1);
        setTurnstile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [turnstile, gameId, token, onJoined]);

  return (
    <main className="start-screen">
      <section className="start-panel" aria-live="polite">
        <h1>Joining the game...</h1>
        <p>A quick check that you are a person, then you are at the table.</p>
        <Turnstile onToken={setTurnstile} resetSignal={resetSignal} />
        {error ? (
          <p className="error-note" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export function OnlineApp() {
  useEffect(() => installFlexGapFallback(), []);
  // Read once: this also moves the secret out of the address bar.
  const [location_] = useState(() => readOnlineLocation());
  const { gameId, token: linkToken } = location_;
  const [joined, setJoined] = useState(false);

  if (!gameId) return <OnlineLanding />;

  const token = linkToken ?? storedSeatFor(gameId)?.token ?? null;
  const needsJoin = Boolean(linkToken) && !joined && !loadStoredSeats().some((seat) => seat.gameId === gameId && seat.token === linkToken);
  if (!token) {
    return (
      <main className="start-screen">
        <section className="start-panel" role="alert">
          <h1>This link is missing its key</h1>
          <p>
            Seat and spectator links end in <code>#seat=...</code> or <code>#watch=...</code>. Ask the person who made the game
            to send the full link again.
          </p>
          <a className="button-link" href="/online/">
            Back to online games
          </a>
        </section>
      </main>
    );
  }

  if (needsJoin) return <JoinGate gameId={gameId} token={token} onJoined={() => setJoined(true)} />;
  return <OnlineGame gameId={gameId} token={token} />;
}
