import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GameState } from "../../engine";
import { startFamilyPhase } from "../../engine/phases/family";
import { HIDDEN_BLACKMAIL_CARD_ID, STORED_SEATS_KEY, hiddenBlackmailInstanceId, type CreateGameResponse } from "../../online/protocol";
import { withCash } from "../../tests/fixtures/builders";
import { createHotseatGame } from "../../tests/fixtures/game";
import { OnlineConnection, describeError, describeRejection, ApiRequestError, setFetchImplementation, setSocketFactory } from "./api";
import { MockServer } from "./mock-server";
import { OnlineApp } from "./OnlineApp";
import { OnlineGame } from "./OnlineGame";
import { resetOnlineLocationCache } from "./storage";
import { resetSiteKeyCache } from "./Turnstile";
import { DecisionPanel } from "../DecisionPanel";
import { cardName, isBlackmailCard } from "../view-model";

const files = vi.hoisted(() => ({ saved: [] as string[], content: "" }));

vi.mock("../platform/files", () => ({
  openTextFile: async () => ({ status: "success", fileName: "test.joco", content: files.content }),
  saveTextFile: async (content: string) => {
    files.saved.push(content);
    return { status: "downloaded", fileName: "out.joco" };
  },
  copyText: async () => ({ status: "success" }),
  TEXT_FILE_TYPE: { description: "Text file", mimeType: "text/plain", extension: ".txt" },
}));

let server: MockServer;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // The Turnstile widget passes at once, as Cloudflare's always-pass test key does.
  window.turnstile = {
    render: (_container, options) => {
      setTimeout(() => options.callback("test-turnstile-token"), 0);
      return "widget-1";
    },
    reset: () => {},
    remove: () => {},
  };
  server = new MockServer();
  setFetchImplementation(server.fetch as typeof fetch);
  setSocketFactory(server.createSocket);
  resetOnlineLocationCache();
  resetSiteKeyCache();
  localStorage.clear();
  files.saved = [];
});

afterEach(() => {
  cleanup();
  setFetchImplementation(null);
  setSocketFactory(null);
  delete window.turnstile;
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  document.title = "";
});

function familyGame(): GameState {
  return startFamilyPhase(withCash(createHotseatGame(), { "player-red": 10 }));
}

function open(path: string) {
  window.history.replaceState(null, "", path);
  resetOnlineLocationCache();
  return render(<OnlineApp />);
}

function openSeat(created: CreateGameResponse, index: number | "spectator") {
  const url = index === "spectator" ? created.spectatorUrl : created.seats[index].url;
  return open(url);
}

function redCash(): string {
  const dashboard = screen.getByLabelText("Red dashboard");
  return within(dashboard).getByText("Cash").nextElementSibling?.textContent ?? "";
}

function commandButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".command-button"));
}

describe("online landing", () => {
  test("creating a game shows each seat's private link and the spectator link", async () => {
    open("/online/");
    expect(screen.getByRole("heading", { name: "Start an online game" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Player 1 name"), { target: { value: "Ann" } });
    fireEvent.change(screen.getByLabelText("Player 2 name"), { target: { value: "Ben" } });
    const create = screen.getByRole("button", { name: "Create game" }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);

    await screen.findByRole("heading", { name: "Your game is ready" });
    expect(screen.getByText(/Send each friend their own link/)).toBeTruthy();
    const ann = screen.getByLabelText("Ann private link") as HTMLInputElement;
    const ben = screen.getByLabelText("Ben private link") as HTMLInputElement;
    expect(ann.value).toMatch(/\/online\/\?game=.+#seat=/);
    expect(ben.value).not.toBe(ann.value);
    expect((screen.getByLabelText("Spectator link") as HTMLInputElement).value).toMatch(/#watch=/);
    expect(screen.getByRole("button", { name: "Copy Ann's link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy spectator link" })).toBeTruthy();
    expect(screen.getAllByLabelText(/private link/)).toHaveLength(4);
  });

  test("importing a save shows the same links screen", async () => {
    const { serializeSave } = await import("../../save");
    files.content = serializeSave(familyGame(), { saveId: "s", now: "2026-06-13T12:30:00.000Z" });
    open("/online/");
    fireEvent.click(screen.getByRole("button", { name: "Choose .joco file" }));
    await screen.findByText("test.joco");
    const importButton = screen.getByRole("button", { name: "Import and create links" }) as HTMLButtonElement;
    await waitFor(() => expect(importButton.disabled).toBe(false));
    fireEvent.click(importButton);

    await screen.findByRole("heading", { name: "Your game is ready" });
    expect(screen.getByLabelText("Red private link")).toBeTruthy();
    expect(screen.getByLabelText("Yellow private link")).toBeTruthy();
  });

  test("lists games in this browser and marks the one waiting on you", async () => {
    const created = server.createFromState(familyGame());
    const redToken = server.tokenFor(created, 0);
    const blueToken = server.tokenFor(created, 1);
    localStorage.setItem(
      STORED_SEATS_KEY,
      JSON.stringify([
        { gameId: created.gameId, token: redToken, viewer: { kind: "seat", playerId: "player-red" }, playerName: "Red", scenario: "1710", joinedAt: "2026-01-01" },
        { gameId: created.gameId, token: blueToken, viewer: { kind: "seat", playerId: "player-blue" }, playerName: "Blue", scenario: "1710", joinedAt: "2026-01-01" },
      ]),
    );
    open("/online/");
    await screen.findByText("Your turn");
    expect(screen.getAllByText("Your turn")).toHaveLength(1);
    const rows = document.querySelectorAll(".my-games li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Your turn");
    expect(rows[1].textContent).not.toContain("Your turn");
  });
});

describe("online game screen", () => {
  test("a seat sees its own decision and acting updates the view", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 0);

    await screen.findByRole("button", { name: /Purchase Luxury/ });
    // No pass-the-device step online, and no local save-and-pass.
    expect(screen.queryByRole("button", { name: /reveal/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save & pass/ })).toBeNull();
    expect(redCash()).toBe("£10");
    expect(document.title).toBe("(Your turn) John Company");

    fireEvent.click(screen.getByRole("button", { name: /Purchase Luxury/ }));
    await waitFor(() => expect(redCash()).not.toBe("£10"));
    expect(server.requests.some((request) => request.path.endsWith("/commands"))).toBe(true);
    // Now it is Blue's turn.
    await screen.findByText(/Waiting for Blue/);
    expect(document.title).toBe("John Company");
  });

  test("the seat link's token moves out of the address bar into localStorage", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 0);
    await screen.findByRole("button", { name: /Purchase Luxury/ });
    expect(window.location.hash).toBe("");
    const stored = JSON.parse(localStorage.getItem(STORED_SEATS_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ gameId: created.gameId, viewer: { kind: "seat", playerId: "player-red" }, playerName: "Red" });
  });

  test("another seat's turn shows a waiting banner and no buttons", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 1);

    const banner = await screen.findByText(/Waiting for Red: /);
    expect(banner.textContent).toContain("Choose a family action.");
    expect(commandButtons()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Save & pass/ })).toBeNull();
    expect(document.title).toBe("John Company");
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).toBe("Nothing to undo.");
  });

  test("a spectator is read-only and sees the Watching badge", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, "spectator");

    await screen.findByText("Watching");
    expect(commandButtons()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: /Deals/ }));
    expect(screen.getByText(/Only seated players can make or accept deals/)).toBeTruthy();
  });

  test("undo uses the server and explains when it is disabled", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 0);
    fireEvent.click(await screen.findByRole("button", { name: /Purchase Luxury/ }));
    await waitFor(() => expect(redCash()).not.toBe("£10"));

    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    await waitFor(() => expect(undo.disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(() => expect(redCash()).toBe("£10"));
    expect(server.requests.some((request) => request.path.endsWith("/undo"))).toBe(true);
    await waitFor(() => expect(undo.disabled).toBe(true));
    expect(undo.title).toBe("Nothing to undo.");
  });

  test("shows the server's reason when someone else has acted since", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 0);
    fireEvent.click(await screen.findByRole("button", { name: /Purchase Luxury/ }));
    await screen.findByText(/Waiting for Blue/);

    const blue = server.tokenFor(created, 1);
    const blueView = server.fetch(`/api/games/${created.gameId}/view`, { headers: { Authorization: `Bearer ${blue}` } });
    const view = await (await blueView).json();
    const command = view.state.pendingDecision.legalCommands[0];
    act(() => {
      server.actAs(created.gameId, blue, command.type, command.payload ?? {});
    });
    await waitFor(() => expect(screen.getByText(/Waiting for (Yellow|Red)/)).toBeTruthy());
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    await waitFor(() => expect(undo.title).toBe("Another player acted since."));
    expect(undo.disabled).toBe(true);
  });

  test("hidden information arrives as placeholders and renders as face-down cards", async () => {
    const state = familyGame();
    state.players["player-blue"].blackmailCards = [{ id: "bm-1", cardId: "real-secret", facedown: true }];
    const created = server.createFromState(state);
    openSeat(created, 0);
    await screen.findByRole("button", { name: /Purchase Luxury/ });

    const view = server.viewFor(server.game(created.gameId), { kind: "seat", playerId: "player-red" });
    expect(view.state.players["player-blue"].blackmailCards[0].cardId).toBe(HIDDEN_BLACKMAIL_CARD_ID);
    expect(view.state.parliament.lawDeck.drawPile.every((card) => card.startsWith("hidden:"))).toBe(true);
    expect(within(screen.getByLabelText("Blue dashboard")).getByText(/face-down blackmail/)).toBeTruthy();
    // Deals & Cards with a placeholder-holding partner.
    fireEvent.click(screen.getByRole("tab", { name: /Deals/ }));
    expect(screen.getByRole("heading", { name: /Deals & Cards: Red/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reveal/ })).toBeNull();
  });

  test("placeholders are named and classified as face-down cards", () => {
    const hiddenInstance = hiddenBlackmailInstanceId("player-blue", 0);
    expect(isBlackmailCard(HIDDEN_BLACKMAIL_CARD_ID)).toBe(true);
    expect(isBlackmailCard(hiddenInstance)).toBe(true);
    expect(isBlackmailCard("hidden:law")).toBe(false);
    expect(cardName(HIDDEN_BLACKMAIL_CARD_ID)).toBe("Face-down blackmail");
    expect(cardName("hidden:law")).toBe("Face-down law");
    expect(cardName("hidden:event-tile@bombay")).toBe("Face-down event tile");
    expect(cardName("hidden:london-season-card")).toBe("Face-down card");
  });

  test("a hidden London Season Display slot is drawn as a face-down blackmail card", async () => {
    const { blackmailCards } = await import("../../data");
    const state = familyGame();
    state.londonSeason.display = [blackmailCards[0].id];
    const created = server.createFromState(state);
    openSeat(created, 0);
    await screen.findByRole("button", { name: /Purchase Luxury/ });
    const slot = document.querySelector('[data-target="display:0"]') as Element;
    expect(slot.querySelector("title")?.textContent).toBe("London Season Display: Blackmail");
    expect(slot.querySelector(".card-back")).toBeTruthy();
    expect(slot.textContent).toContain("face down");
  });

  test("asking for another player's face-down blackmail sends the placeholder back unchanged", async () => {
    const state = familyGame();
    state.players["player-blue"].blackmailCards = [{ id: "bm-real-1", cardId: "real-secret", facedown: true }];
    const created = server.createFromState(state);
    openSeat(created, 0);
    await screen.findByRole("button", { name: /Purchase Luxury/ });
    fireEvent.click(screen.getByRole("tab", { name: /Deals/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /With/ }), { target: { value: "player-blue" } });
    fireEvent.click(screen.getByLabelText(/Face-down blackmail 1/));
    fireEvent.click(screen.getByRole("button", { name: /Propose/ }));
    await waitFor(() => expect(server.commands.length).toBe(1));
    const placeholder = hiddenBlackmailInstanceId("player-blue", 0);
    expect(JSON.stringify(server.commands[0].sent.payload)).toContain(placeholder);
    expect(JSON.stringify(server.commands[0].sent.payload)).not.toContain("bm-real-1");
    // The server (the real resolveHiddenIds) maps it to the real card.
    expect(JSON.stringify(server.commands[0].applied.payload)).toContain("bm-real-1");
  });

  test("a link with a wrong token is refused at join and nothing is stored", async () => {
    const created = server.createFromState(familyGame());
    open(`/online/?game=${created.gameId}#seat=not-a-real-token`);
    await screen.findByText(/This link is not valid for this game/);
    expect(localStorage.getItem(STORED_SEATS_KEY)).toBeNull();
  });

  test("a stored token that stops working shows the can't-open screen", async () => {
    const created = server.createFromState(familyGame());
    localStorage.setItem(
      STORED_SEATS_KEY,
      JSON.stringify([{ gameId: created.gameId, token: "stale", viewer: { kind: "seat", playerId: "player-red" }, joinedAt: "2026-01-01T00:00:00.000Z" }]),
    );
    open(`/online/?game=${created.gameId}`);
    await screen.findByText("Can't open this game");
  });

  test("a first visit joins once, with the bot check, and later visits go straight in", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 1);
    await screen.findByText(/Waiting for Blue|Your turn|Waiting for/);
    expect(server.requests.filter((request) => request.path.endsWith("/join"))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORED_SEATS_KEY) ?? "[]")[0]).toMatchObject({ viewer: { kind: "seat", playerId: "player-blue" }, playerName: "Blue" });

    cleanup();
    server.requests = [];
    open(`/online/?game=${created.gameId}`);
    await screen.findByText(/Waiting for|Your turn/);
    expect(server.requests.some((request) => request.path.endsWith("/join"))).toBe(false);
  });

  test("the Turnstile site key comes from /api/config, then falls back to the test key", async () => {
    const keys: string[] = [];
    const install = () => {
      window.turnstile = {
        render: (_container, options) => {
          keys.push(options.sitekey);
          setTimeout(() => options.callback("t"), 0);
          return "w";
        },
        reset: () => {},
        remove: () => {},
      };
    };
    install();
    server.siteKey = "0x-server-key";
    open("/online/");
    await waitFor(() => expect(new Set(keys)).toEqual(new Set(["0x-server-key"])));
    cleanup();
    keys.length = 0;

    resetSiteKeyCache();
    server.offline = true;
    open("/online/");
    await waitFor(() => expect(new Set(keys)).toEqual(new Set(["1x00000000000000000000AA"])));
  });

  test("a hidden tab gets a notification when the turn arrives, and permission is asked only from the button", async () => {
    const shown: string[] = [];
    class FakeNotification {
      static permission = "default";
      static requestPermission = vi.fn(async () => {
        FakeNotification.permission = "granted";
        return "granted";
      });
      constructor(title: string) {
        shown.push(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    const created = server.createFromState(familyGame());
    const blue = server.tokenFor(created, 1);
    const red = server.tokenFor(created, 0);
    openSeat(created, 1);
    await screen.findByText(/Waiting for Red/);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Notify me" }));
    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    const redView = await (await server.fetch(`/api/games/${created.gameId}/view`, { headers: { Authorization: `Bearer ${red}` } })).json();
    const command = redView.state.pendingDecision.legalCommands[0];
    act(() => {
      server.actAs(created.gameId, red, command.type, command.payload ?? {});
    });
    await waitFor(() => expect(document.title).toBe("(Your turn) John Company"));
    expect(shown).toHaveLength(1);
    expect(blue).toBeTruthy();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  test("export asks the server and saves the file", async () => {
    const created = server.createFromState(familyGame());
    openSeat(created, 0);
    fireEvent.click(await screen.findByRole("button", { name: "Export .joco" }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(server.requests.some((request) => request.path.endsWith("/export"))).toBe(true);
  });
});

describe("connection", () => {
  const fast = { baseDelayMs: 5, maxDelayMs: 20, pollIntervalMs: 15, pingIntervalMs: 1000 };

  function renderGame(created: CreateGameResponse, index: number, extra: Partial<ConstructorParameters<typeof OnlineConnection>[0]> = {}) {
    const token = server.tokenFor(created, index);
    const factory = (options: ConstructorParameters<typeof OnlineConnection>[0]) =>
      new OnlineConnection({ ...options, ...fast, createSocket: server.createSocket, ...extra });
    return render(<OnlineGame gameId={created.gameId} token={token} connectionFactory={factory} />);
  }

  test("pushes arrive over the socket, and a reconnect never goes back to an older version", async () => {
    const created = server.createFromState(familyGame());
    renderGame(created, 1);
    await screen.findByText(/Waiting for Red/);
    await waitFor(() => expect(screen.getByRole("status", { name: /Connection: Live/ })).toBeTruthy());
    const staleView = server.viewFor(server.game(created.gameId), { kind: "seat", playerId: "player-blue" });

    const red = server.tokenFor(created, 0);
    const luxury = server.game(created.gameId).state.pendingDecision.legalCommands.find((command) => /Purchase Luxury/.test(command.label))!;
    act(() => {
      server.actAs(created.gameId, red, luxury.type, luxury.payload ?? {});
    });
    await screen.findByText(/Your turn: /);
    await waitFor(() => expect(redCash()).not.toBe("£10"));
    const newCash = redCash();

    // The socket breaks, and on reconnect the server first replays the old version.
    server.replayStaleViewOnNextHello(created.gameId, staleView);
    act(() => server.dropAllSockets());
    await waitFor(() => expect(screen.getByRole("status", { name: /Connection: (Reconnecting|Live)/ })).toBeTruthy());
    await waitFor(() => expect(server.sockets.size).toBe(1));
    await waitFor(() => expect(screen.getByRole("status", { name: /Connection: Live/ })).toBeTruthy());
    expect(redCash()).toBe(newCash);
    expect(screen.getByText(/Your turn: /)).toBeTruthy();
  });

  test("falls back to polling the view when WebSockets fail", async () => {
    const created = server.createFromState(familyGame());
    server.socketsFail = true;
    renderGame(created, 1, { maxSocketFailures: 2 });
    await screen.findByText(/Waiting for Red/);
    await waitFor(() => expect(screen.getByRole("status", { name: /Live \(polling\)/ })).toBeTruthy());

    const red = server.tokenFor(created, 0);
    const luxury = server.game(created.gameId).state.pendingDecision.legalCommands.find((command) => /Purchase Luxury/.test(command.label))!;
    act(() => {
      server.actAs(created.gameId, red, luxury.type, luxury.payload ?? {});
    });
    await waitFor(() => expect(redCash()).not.toBe("£10"), { timeout: 2000 });
    await screen.findByText(/Your turn: /);
  });

  test("goes offline while requests fail and recovers", async () => {
    const created = server.createFromState(familyGame());
    server.socketsFail = true;
    renderGame(created, 0, { maxSocketFailures: 1 });
    await screen.findByRole("button", { name: /Purchase Luxury/ });
    server.offline = true;
    await waitFor(() => expect(screen.getByRole("status", { name: /Connection: Offline/ })).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /Purchase Luxury/ }));
    await screen.findByText(/You are offline/);
    server.offline = false;
    await waitFor(() => expect(screen.getByRole("status", { name: /Live/ })).toBeTruthy(), { timeout: 2000 });
  });
});

describe("OnlineConnection", () => {
  test("applies only newer versions", async () => {
    const created = server.createFromState(familyGame());
    const seen: number[] = [];
    const conn = new OnlineConnection({ gameId: created.gameId, token: server.tokenFor(created, 0), onView: (view) => seen.push(view.version), createSocket: server.createSocket });
    const game = server.game(created.gameId);
    const viewer = { kind: "seat", playerId: "player-red" } as const;
    const v1 = server.viewFor(game, viewer);
    expect(conn.applyView({ ...v1, version: 5 })).toBe(true);
    expect(conn.applyView({ ...v1, version: 4 })).toBe(false);
    expect(conn.applyView({ ...v1, version: 5 })).toBe(false);
    expect(conn.applyView({ ...v1, version: 6 })).toBe(true);
    expect(seen).toEqual([5, 6]);
  });
});

describe("server errors", () => {
  test("describeError and describeRejection use the server's codes", () => {
    expect(describeError(new ApiRequestError("SPECTATOR_READ_ONLY", "raw", 403))).toMatch(/watching/);
    expect(describeError(new ApiRequestError("RATE_LIMITED", "raw", 429))).toMatch(/Too many requests/);
    expect(describeError(new ApiRequestError("network", "Failed to fetch", 0))).toMatch(/Could not reach the server/);
    expect(describeError(new ApiRequestError("EXPORT_NOT_ALLOWED", "Only the creator.", 403))).toBe("Only the creator.");
    expect(describeRejection([{ code: "DECISION_ID_MISMATCH", message: "stale" }])).toMatch(/moved on/);
    expect(describeRejection([{ code: "SOMETHING_ELSE", message: "engine says no" }])).toBe("engine says no");
  });

  test("a bad token on the socket is fatal, a rate limit is not", async () => {
    const created = server.createFromState(familyGame());
    const fatal = vi.fn();
    const rejected = vi.fn();
    const connection = new OnlineConnection({
      gameId: created.gameId,
      token: "wrong",
      onView: () => {},
      onFatal: fatal,
      onRejected: rejected,
      createSocket: server.createSocket,
      baseDelayMs: 5,
    });
    connection.start();
    await waitFor(() => expect(fatal).toHaveBeenCalled());
    expect(fatal.mock.calls[0][0].code).toBe("INVALID_TOKEN");
    expect(connection.currentStatus).toBe("offline");
    connection.stop();
  });

  test("polling keeps retrying through 429 and 500 but stops on 401 and 404", async () => {
    const created = server.createFromState(familyGame());
    const token = server.tokenFor(created, 0);
    const answers: Array<{ status: number; code: string }> = [
      { status: 429, code: "RATE_LIMITED" },
      { status: 500, code: "INTERNAL" },
    ];
    const real = server.fetch;
    setFetchImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = answers.shift();
      if (next) return new Response(JSON.stringify({ error: { code: next.code, message: "no" } }), { status: next.status });
      return real(input, init);
    }) as typeof fetch);
    server.socketsFail = true;
    const views = vi.fn();
    const fatal = vi.fn();
    const connection = new OnlineConnection({
      gameId: created.gameId,
      token,
      onView: views,
      onFatal: fatal,
      createSocket: server.createSocket,
      baseDelayMs: 1,
      maxDelayMs: 2,
      pollIntervalMs: 5,
      maxSocketFailures: 1,
    });
    connection.start();
    await waitFor(() => expect(views).toHaveBeenCalled());
    expect(fatal).not.toHaveBeenCalled();
    connection.stop();

    const bad = new OnlineConnection({
      gameId: created.gameId,
      token: "wrong",
      onView: () => {},
      onFatal: fatal,
      createSocket: server.createSocket,
      pollIntervalMs: 5,
      maxSocketFailures: 1,
    });
    bad.start();
    await waitFor(() => expect(fatal).toHaveBeenCalled());
    expect(fatal.mock.calls[0][0].code).toBe("INVALID_TOKEN");
    bad.stop();
  });

  test("a spectator's command gets 403 SPECTATOR_READ_ONLY; an engine rejection is HTTP 200 with ok: false", async () => {
    const created = server.createFromState(familyGame());
    const watch = server.tokenFor(created, "spectator");
    const blue = server.tokenFor(created, 1);
    const post = (token: string) =>
      server.fetch(`/api/games/${created.gameId}/commands`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: { id: "c1", decisionId: server.game(created.gameId).state.pendingDecision.id, type: "family.chooseAction", payload: {} } }),
      });
    const spectator = await post(watch);
    expect(spectator.status).toBe(403);
    expect((await spectator.json()).error.code).toBe("SPECTATOR_READ_ONLY");
    const wrongSeat = await post(blue);
    expect(wrongSeat.status).toBe(200);
    const body = await wrongSeat.json();
    expect(body.ok).toBe(false);
    expect(body.errors[0].code).toBe("ACTOR_NOT_ALLOWED");
  });
});

describe("export and creator", () => {
  test("only the creator's seat shows Export before the game ends", async () => {
    const created = server.createFromState(familyGame());
    expect(created.seats[0].creator).toBe(true);
    expect(created.seats[1].creator).toBeUndefined();
    openSeat(created, 1);
    await screen.findByText(/Waiting for/);
    expect(screen.queryByRole("button", { name: "Export .joco" })).toBeNull();
    const refused = await server.fetch(`/api/games/${created.gameId}/export`, { headers: { Authorization: `Bearer ${server.tokenFor(created, 1)}` } });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("EXPORT_NOT_ALLOWED");
  });

  test("everyone gets Export once the game is over", async () => {
    const state = familyGame();
    state.finalScoring.complete = true;
    const created = server.createFromState(state);
    openSeat(created, 1);
    expect(await screen.findByRole("button", { name: "Export .joco" })).toBeTruthy();
  });

  test("the links screen marks the creator's link", async () => {
    open("/online/");
    const create = screen.getByRole("button", { name: "Create game" }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    await screen.findByRole("heading", { name: "Your game is ready" });
    expect(screen.getAllByText("Creator")).toHaveLength(1);
  });
});

describe("option descriptions", () => {
  function panelWith(descriptions: Array<string | undefined>) {
    const game = familyGame();
    game.pendingDecision.legalCommands = descriptions.map((description, index) => ({
      type: "family.test",
      label: `Option ${index}`,
      description,
      payload: {},
    })) as typeof game.pendingDecision.legalCommands;
    return render(
      <DecisionPanel game={game} hidden={false} onReveal={() => {}} onRun={() => {}} onHover={() => {}} filter={null} onClearFilter={() => {}} error={null} />,
    );
  }

  test("each option prints its description under the button, and warnings are marked", () => {
    panelWith(["Costs £5.", "Warning: this ends your turn.", undefined]);
    const texts = Array.from(document.querySelectorAll(".command-description"));
    expect(texts.map((node) => node.textContent)).toEqual(["Costs £5.", "Warning: this ends your turn."]);
    expect(texts[0].classList.contains("command-warning")).toBe(false);
    expect(texts[1].classList.contains("command-warning")).toBe(true);
    // The tooltip stays for mouse users.
    expect(screen.getByRole("button", { name: "Option 0" }).title).toBe("Costs £5.");
  });
});
