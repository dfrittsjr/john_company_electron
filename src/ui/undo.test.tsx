import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GameState } from "../engine";
import { startFamilyPhase } from "../engine/phases/family";
import { serializeSave } from "../save";
import { withCash } from "../tests/fixtures/builders";
import { eventsInIndiaState } from "../tests/fixtures/events-in-india";
import { createHotseatGame } from "../tests/fixtures/game";
import { App } from "./App";

const files = vi.hoisted(() => ({ content: "" }));

vi.mock("./platform/files", () => ({
  openTextFile: async () => ({ status: "success", fileName: "test.joco", content: files.content }),
  saveTextFile: async () => ({ status: "downloaded", fileName: "out.joco" }),
  copyText: async () => ({ status: "success" }),
  TEXT_FILE_TYPE: { description: "Text file", mimeType: "text/plain", extension: ".txt" },
}));

beforeEach(() => {
  // jsdom has no layout engine; the board's pan/zoom code only needs these to exist.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loadIntoApp(game: GameState) {
  files.content = serializeSave(game, { saveId: "save-undo", now: "2026-06-13T12:30:00.000Z" });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Load Save" }));
  await screen.findByRole("button", { name: "Undo" });
}

function redCash(): string {
  const dashboard = screen.getByLabelText("Red dashboard");
  return within(dashboard).getByText("Cash").nextElementSibling?.textContent ?? "";
}

function purchaseLuxury() {
  // Family decisions are private: the player confirms they hold the device first.
  fireEvent.click(screen.getByRole("button", { name: /reveal/ }));
  fireEvent.click(screen.getByRole("button", { name: /Purchase Luxury/ }));
}

describe("Undo", () => {
  test("reverts a purchase and restores the cash", async () => {
    await loadIntoApp(startFamilyPhase(withCash(createHotseatGame(), { "player-red": 10 })));
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).toBe("Nothing to undo.");
    expect(redCash()).toBe("£10");

    purchaseLuxury();
    expect(redCash()).not.toBe("£10");
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(redCash()).toBe("£10");
    expect(screen.getByText(/^Undid: /)).toBeTruthy();
    expect(undo.disabled).toBe(true);
  });

  test("supports Ctrl+Z", async () => {
    await loadIntoApp(startFamilyPhase(withCash(createHotseatGame(), { "player-red": 10 })));
    purchaseLuxury();
    expect(redCash()).not.toBe("£10");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getAllByText("£10").length).toBeGreaterThan(0));
  });

  test("refuses to undo a dice roll and says why", async () => {
    const start = eventsInIndiaState({ drawPile: ["turmoil-bombay"] });
    await loadIntoApp(start);

    fireEvent.click(screen.getByRole("button", { name: /Resolve Events in India/ }));

    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).toMatch(/Dice were rolled/);
    expect(undo.getAttribute("aria-describedby")).toBe("undo-reason");
    expect(document.getElementById("undo-reason")?.textContent).toMatch(/Dice were rolled/);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.queryByText(/^Undid: /)).toBeNull();
  });
});
