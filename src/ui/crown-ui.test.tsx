import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GameState } from "../engine";
import { startedCrownGame, TWO_PLAYERS } from "../tests/fixtures/crown";
import { CrownBoard } from "./CrownBoard";
import { CrownFavors } from "./CrownFavors";
import { CrownRichText } from "./CrownIcons";
import { DecisionPanel } from "./DecisionPanel";
import { RulesPanel } from "./RulesPanel";
import { App } from "./App";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function crownDecision(game: GameState, options: { count: number; chooser?: string }): GameState {
  const legal = Array.from({ length: options.count }, (_, index) => ({ type: "test.option", label: `Option ${index + 1}`, payload: { index } }));
  return {
    ...game,
    pendingDecision: {
      ...game.pendingDecision,
      actor: "crown",
      legalCommands: legal,
      crown: { all: legal, reason: "Lion: build a Company ship (Govern result).", chooser: options.chooser },
    },
  };
}

function panel(game: GameState, onRun = vi.fn()) {
  render(
    <DecisionPanel game={game} hidden={false} onReveal={vi.fn()} onRun={onRun} onHover={vi.fn()} filter={null} onClearFilter={vi.fn()} error={null} />,
  );
  return onRun;
}

describe("Crown decisions", () => {
  test("a single option shows what the Crown will do, with a button", () => {
    const game = crownDecision(startedCrownGame(), { count: 1 });
    const onRun = panel(game);
    expect(screen.getByText("The Crown")).toBeTruthy();
    expect(screen.getByText(/Lion: build a Company ship/)).toBeTruthy();
    expect(screen.getByText(/The Crown will:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Let the Crown act" }));
    expect(onRun).toHaveBeenCalledWith(game.pendingDecision.legalCommands[0]);
  });

  test("several options are chosen by the soloist", () => {
    const game = crownDecision(startedCrownGame(), { count: 3, chooser: "player-ann" });
    panel(game);
    expect(screen.getByText(/chooses for the Crown/).textContent).toContain("Ann");
    expect(screen.queryByRole("button", { name: "Let the Crown act" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /\S/ }).length).toBeGreaterThan(1);
  });
});

describe("Crown board", () => {
  test("shows the climate, the cards, the counts and the Button", () => {
    const game = startedCrownGame({ players: 2 });
    render(<CrownBoard game={game} />);
    const track = screen.getByLabelText("Climate track");
    expect(within(track).getAllByRole("listitem")).toHaveLength(5);
    expect(track.querySelector("[aria-current='true']")?.textContent).toContain(game.crown!.climate.charAt(0).toUpperCase());
    expect(screen.getByLabelText(/Face-up AI card/)).toBeTruthy();
    expect(screen.getByLabelText(/face-down AI card/)).toBeTruthy();
    expect(screen.getByText("Player Button")).toBeTruthy();
    expect(screen.getByText("Direction").nextElementSibling?.textContent).toMatch(/clockwise/i);
  });
});

describe("Favours", () => {
  test("two players can give cubes to each other", () => {
    const game = startedCrownGame({ players: 2 });
    const onGive = vi.fn();
    render(<CrownFavors game={game} waiting={false} onFavor={vi.fn()} onGive={onGive} />);
    fireEvent.click(screen.getByText(/Favours \(/));
    fireEvent.click(screen.getByRole("button", { name: `${TWO_PLAYERS[0].name} gives 1 cube to ${TWO_PLAYERS[1].name}` }));
    expect(onGive).toHaveBeenCalledWith("player-ann", "player-ben", 1);
  });
});

describe("Crown Handbook in the rules", () => {
  test("icon tokens become badges", () => {
    const { container } = render(<p><CrownRichText text="Roll {die} on {lion} for {cube}." /></p>);
    expect(container.querySelectorAll(".crown-icon")).toHaveLength(3);
    expect(container.textContent).not.toContain("{");
  });

  test("the rules panel lists Handbook pages in Crown games only", () => {
    render(<RulesPanel onClose={vi.fn()} crown />);
    fireEvent.click(screen.getByRole("button", { name: /^Handbook p\.2/ }));
    expect(screen.getByText(/Crown Handbook, page 2/)).toBeTruthy();
    expect(document.querySelector(".handbook-table")).toBeTruthy();
    cleanup();
    render(<RulesPanel onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Handbook p\./ })).toBeNull();
  });
});

describe("New Crown game", () => {
  test("a solo game starts and the Crown board is shown", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    fireEvent.change(screen.getByLabelText("Player count"), { target: { value: "1" } });
    expect(screen.getByText("Expert")).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start" }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(screen.getByLabelText("The Crown")).toBeTruthy();
  });

  test("a solo player's private choices show without passing the device", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    fireEvent.change(screen.getByLabelText("Player count"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // Drafting the setup cards is a private choice.
    fireEvent.click(screen.getByRole("button", { name: /Draft the setup cards/ }));
    expect(screen.getByText(/you drew three/)).toBeTruthy();
    expect(screen.queryByText(/Pass the device/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Keep:/ })).toHaveLength(3);
  });
});
