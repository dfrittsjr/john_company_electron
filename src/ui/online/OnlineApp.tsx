import { useEffect, useState } from "react";
import "../game-screen.css";
import { installFlexGapFallback } from "../platform/flex-gap-fallback";
import { OnlineGame } from "./OnlineGame";
import { OnlineLanding } from "./OnlineLanding";
import { readOnlineLocation, storedSeatFor } from "./storage";

export function OnlineApp() {
  useEffect(() => installFlexGapFallback(), []);
  // Read once: this also moves the secret out of the address bar.
  const [location_] = useState(() => readOnlineLocation());
  const { gameId, token: linkToken } = location_;

  if (!gameId) return <OnlineLanding />;

  const token = linkToken ?? storedSeatFor(gameId)?.token ?? null;
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

  return <OnlineGame gameId={gameId} token={token} />;
}
