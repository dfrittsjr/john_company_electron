import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GameState } from "../engine";
import { createHotseatGame } from "../tests/fixtures/game";
import { DecisionPanel } from "./DecisionPanel";
import { rulesSections } from "../data/rules-text";
import { RulesPanel } from "./RulesPanel";

afterEach(cleanup);

function Host({ game }: { game: GameState }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <DecisionPanel
        game={game}
        hidden={false}
        onReveal={vi.fn()}
        onRun={vi.fn()}
        onHover={vi.fn()}
        filter={null}
        onClearFilter={vi.fn()}
        error={null}
        onOpenRules={setOpen}
      />
      {open ? <RulesPanel initialSectionId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

describe("RulesPanel", () => {
  test("the decision panel link opens the section for the current phase", () => {
    const game = { ...createHotseatGame(), phase: "revenue" } as GameState;
    render(<Host game={game} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rules for this phase" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 3, name: "VI. Revenue" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "VI. Revenue" }).getAttribute("aria-current")).toBe("true");
    expect(within(dialog).getByText(/John Company: Second Edition rulebook by Cole Wehrle/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the link opens the hiring section in the hiring phase", () => {
    const game = { ...createHotseatGame(), phase: "hiring" } as GameState;
    render(<Host game={game} />);
    fireEvent.click(screen.getByRole("button", { name: "Rules for this phase" }));
    expect(screen.getByRole("heading", { level: 3, name: "III. Hiring" })).toBeTruthy();
  });

  test("searching filters the contents and highlights matches", () => {
    render(<RulesPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the rules" }), { target: { value: "emergency loan" } });

    const toc = screen.getByRole("navigation", { name: "Rules contents" });
    expect(within(toc).getByRole("button", { name: "VI. Revenue" })).toBeTruthy();
    expect(within(toc).queryByRole("button", { name: "Introduction" })).toBeNull();
    expect(screen.getByRole("dialog").querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  test("search with no matches says so", () => {
    render(<RulesPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the rules" }), { target: { value: "qqqqzzz" } });
    expect(screen.getByText("No section mentions that.")).toBeTruthy();
  });
});

describe("rules panel figures", () => {
  test("shows the section's figures with alt text, captions and a full-size link", () => {
    const section = rulesSections.find((candidate) => candidate.id === "presidency-operations")!;
    expect(section.figures?.length).toBeGreaterThan(0);
    render(<RulesPanel initialSectionId="presidency-operations" onClose={vi.fn()} />);
    const figure = section.figures![0];
    const image = screen.getByAltText(figure.alt);
    expect(image.getAttribute("src")).toBe(figure.src);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("width")).toBe(String(figure.width));
    expect(image.closest("a")?.getAttribute("href")).toBe(figure.src);
    expect(screen.getByText(`${figure.caption} (rulebook p.${figure.page})`)).toBeTruthy();
  });

  test("a section without pictures renders no figures", () => {
    render(<RulesPanel initialSectionId="introduction" onClose={vi.fn()} />);
    expect(document.querySelectorAll("figure").length).toBe(0);
  });
});

