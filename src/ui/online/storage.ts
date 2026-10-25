import { STORED_SEATS_KEY, type StoredSeat } from "../../online/protocol";

export function loadStoredSeats(): StoredSeat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORED_SEATS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((seat): seat is StoredSeat => Boolean(seat && typeof seat.gameId === "string" && typeof seat.token === "string"))
      : [];
  } catch {
    return [];
  }
}

function writeStoredSeats(seats: StoredSeat[]): void {
  try {
    localStorage.setItem(STORED_SEATS_KEY, JSON.stringify(seats));
  } catch {
    // Private windows can refuse storage; the link still works for this tab.
  }
}

/** Adds or replaces the entry for this game and viewer. */
export function saveStoredSeat(seat: StoredSeat): void {
  const others = loadStoredSeats().filter(
    (existing) => !(existing.gameId === seat.gameId && JSON.stringify(existing.viewer) === JSON.stringify(seat.viewer)),
  );
  writeStoredSeats([seat, ...others]);
}

export function removeStoredSeat(gameId: string, token: string): void {
  writeStoredSeats(loadStoredSeats().filter((seat) => !(seat.gameId === gameId && seat.token === token)));
}

export function storedSeatFor(gameId: string): StoredSeat | undefined {
  const seats = loadStoredSeats().filter((seat) => seat.gameId === gameId);
  // A player seat beats a spectator link for the same game.
  return seats.find((seat) => seat.viewer.kind === "seat") ?? seats[0];
}

type OnlineLocation = { gameId: string | null; token: string | null; kind: "seat" | "watch" | null };
let cached: { search: string; value: OnlineLocation } | null = null;

/** Tests only. */
export function resetOnlineLocationCache(): void {
  cached = null;
}

const PENDING_LINK_PREFIX = "john-company.pending-link.";

/**
 * Reads ?game= and the #seat= / #watch= fragment, and removes the secret from the address bar.
 * Until the join succeeds (forgetPendingLink), the link's token waits in this tab's
 * sessionStorage, so reloading after a failed join still has it.
 */
export function readOnlineLocation(): OnlineLocation {
  const params = new URLSearchParams(location.search);
  const gameId = params.get("game");
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const seat = fragment.get("seat");
  const watch = fragment.get("watch");
  const token = seat ?? watch;
  // The fragment is removed below, so a second read (React may run initialisers twice) reuses this one.
  if (!token && cached && cached.search === location.search) return cached.value;
  if (token) {
    if (gameId) writePendingLink(gameId, { token, kind: seat ? "seat" : "watch" });
    try {
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch {
      // not fatal: the token just stays visible
    }
  }
  const pending = !token && gameId ? readPendingLink(gameId) : null;
  const value: OnlineLocation = pending
    ? { gameId, token: pending.token, kind: pending.kind }
    : { gameId, token, kind: seat ? "seat" : watch ? "watch" : null };
  cached = { search: location.search, value };
  return value;
}

type PendingLink = { token: string; kind: "seat" | "watch" };

function writePendingLink(gameId: string, link: PendingLink): void {
  try {
    sessionStorage.setItem(PENDING_LINK_PREFIX + gameId, JSON.stringify(link));
  } catch {
    // Storage refused: a failed join then needs the link again.
  }
}

function readPendingLink(gameId: string): PendingLink | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PENDING_LINK_PREFIX + gameId) ?? "null");
    return parsed && typeof parsed.token === "string" && (parsed.kind === "seat" || parsed.kind === "watch") ? parsed : null;
  } catch {
    return null;
  }
}

/** Called once the link's token is joined and stored as a seat. */
export function forgetPendingLink(gameId: string): void {
  try {
    sessionStorage.removeItem(PENDING_LINK_PREFIX + gameId);
  } catch {
    // nothing to forget
  }
}
