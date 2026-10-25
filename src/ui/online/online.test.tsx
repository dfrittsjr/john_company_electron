import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GameState } from "../../engine";
import { startFamilyPhase } from "../../engine/phases/family";
import { STORED_SEATS_KEY, type CreateGameResponse } from "../../online/protocol";
import { withCash } from "../../tests/fixtures/builders";
import { createHotseatGame } from "../../tests/fixtures/game";
import { OnlineConnection, setFetchImplementation, setSocketFactory } from "./api";
import { MockServer, PLACEHOLDER_CARD } from "./mock-server";
import { OnlineApp } from "./OnlineApp";
import { OnlineGame } from "./OnlineGame";
import { resetOnlineLocationCache } from "./storage";

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

  test("hidden information arrives as placeholders without crashing", async () => {
    const state = familyGame();
    state.players["player-blue"].blackmailCards = [{ id: "bm-1", cardId: "real-secret", facedown: true }];
    const created = server.createFromState(state);
    openSeat(created, 0);
    await screen.findByRole("button", { name: /Purchase Luxury/ });

    const view = server.viewFor(server.game(created.gameId), { kind: "seat", playerId: "player-red" });
    expect(view.state.players["player-blue"].blackmailCards[0].cardId).toBe(PLACEHOLDER_CARD);
    expect(view.state.parliament.lawDeck.drawPile.every((card) => card === PLACEHOLDER_CARD)).toBe(true);
    expect(within(screen.getByLabelText("Blue dashboard")).getByText(/face-down card/)).toBeTruthy();
    // Deals & Cards with a placeholder-holding partner.
    fireEvent.click(screen.getByRole("tab", { name: /Deals/ }));
    expect(screen.getByRole("heading", { name: /Deals & Cards: Red/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reveal/ })).toBeNull();
  });

  test("a bad link shows an error instead of the board", async () => {
    const created = server.createFromState(familyGame());
    open(`/online/?game=${created.gameId}#seat=not-a-real-token`);
    await screen.findByText("Can't open this game");
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
