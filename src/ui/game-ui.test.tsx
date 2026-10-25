import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GameState, LegalCommand } from "../engine";
import { createHotseatGame } from "../tests/fixtures/game";
import { BLUE, RED, negotiationGame, withBlackmail } from "../tests/fixtures/negotiation";
import { DecisionPanel } from "./DecisionPanel";
import { HandoffBanner } from "./HandoffBanner";
import { PlayerDashboards } from "./PlayerDashboards";
import { commandTargets, groupLegalCommands, handoffTarget } from "./view-model";

afterEach(cleanup);

function withDecision(game: GameState, actor: string, visibility: "public" | "private", legalCommands: LegalCommand[]): GameState {
  return {
    ...game,
    pendingDecision: {
      ...game.pendingDecision,
      id: "decision-ui-test",
      actor,
      visibility,
      prompt: "Pick something.",
      legalCommands,
    },
  };
}

const voteCommands: LegalCommand[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((votes) => ({
    type: "parliament.castVotes",
    label: `Spend £${votes} for ${votes} votes for`,
    payload: { direction: "for", source: "cash", votes },
  })),
  { type: "parliament.passVote", label: "Done voting this round", payload: {} },
];

describe("view model", () => {
  test("names the board elements a command refers to", () => {
    expect(
      commandTargets({
        type: "companyOperation.trade",
        label: "Place",
        payload: { action: "place", orderId: "madras-home-5", writer: RED },
      }),
    ).toEqual(["order:madras-home-5"]);
    expect(
      commandTargets({
        type: "hiring.hireOffice",
        label: "Hire",
        payload: { officeId: "president-bombay", source: { type: "writer", presidency: "Bombay" } },
      }).sort(),
    ).toEqual(["office:president-bombay", "presidency:Bombay"]);
    expect(commandTargets({ type: "x.y", label: "Fit", payload: { shipId: "ship-1", to: "west-indian" } }).sort()).toEqual([
      "sea:west-indian",
      "ship:ship-1",
    ]);
  });

  test("groups vote amounts apart from finishing, keeping the original order", () => {
    const groups = groupLegalCommands(voteCommands);
    expect(groups.map((group) => group.title)).toEqual(["Vote for (cash)", "Finish voting"]);
    expect(groups[0].commands.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(groups[1].commands[0].index).toBe(8);
  });

  test("hands off only when someone else decides next", () => {
    const game = createHotseatGame();
    expect(handoffTarget(withDecision(game, BLUE, "public", voteCommands), RED)).toBe(BLUE);
    expect(handoffTarget(withDecision(game, RED, "public", voteCommands), RED)).toBeNull();
    expect(handoffTarget(withDecision(game, "system", "public", voteCommands), RED)).toBeNull();
    expect(handoffTarget(withDecision(game, BLUE, "public", []), RED)).toBeNull();
  });
});

describe("DecisionPanel", () => {
  test("shows a private decision only after its player reveals it", () => {
    const onReveal = vi.fn();
    const game = withDecision(createHotseatGame(), RED, "private", voteCommands);
    render(
      <DecisionPanel game={game} hidden onReveal={onReveal} onRun={vi.fn()} onHover={vi.fn()} filter={null} onClearFilter={vi.fn()} error={null} />,
    );

    expect(screen.queryByRole("button", { name: /Spend £1/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I am Red: reveal" }));
    expect(onReveal).toHaveBeenCalled();
  });

  test("groups options, runs the chosen one, and reports hovered targets", () => {
    const onRun = vi.fn();
    const onHover = vi.fn();
    const place: LegalCommand = { type: "companyOperation.trade", label: "Place on Madras", payload: { action: "place", orderId: "madras-home-5" } };
    const game = withDecision(createHotseatGame(), RED, "public", [...voteCommands, place]);
    render(
      <DecisionPanel game={game} hidden={false} onReveal={vi.fn()} onRun={onRun} onHover={onHover} filter={null} onClearFilter={vi.fn()} error={null} />,
    );

    expect(screen.getByRole("heading", { name: "Vote for (cash)" })).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Place on Madras" }));
    expect(onHover).toHaveBeenCalledWith(["order:madras-home-5"]);
    fireEvent.click(screen.getByRole("button", { name: "Spend £3 for 3 votes for" }));
    expect(onRun).toHaveBeenCalledWith(voteCommands[2]);
  });

  test("a selected board element filters the options to the ones that refer to it", () => {
    const place: LegalCommand = { type: "companyOperation.trade", label: "Place on Madras", payload: { action: "place", orderId: "madras-home-5" } };
    const game = withDecision(createHotseatGame(), RED, "public", [...voteCommands, place]);
    render(
      <DecisionPanel game={game} hidden={false} onReveal={vi.fn()} onRun={vi.fn()} onHover={vi.fn()} filter="order:madras-home-5" onClearFilter={vi.fn()} error={null} />,
    );

    expect(screen.getByRole("button", { name: "Place on Madras" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Spend £1/ })).toBeNull();
    expect(screen.getByRole("button", { name: `Show all ${voteCommands.length + 1}` })).toBeTruthy();
  });
});

describe("PlayerDashboards", () => {
  const game = withBlackmail(negotiationGame("londonSeason", { [RED]: 5 }), RED, "the-prime-ministers-ear", { instanceId: "ear" });

  test("shows each family's cash and keeps face-down blackmail hidden from others", () => {
    render(<PlayerDashboards game={game} revealedPlayer={BLUE} />);

    expect(screen.getByRole("article", { name: "Red dashboard" }).textContent).toContain("£5");
    expect(screen.getByText(/face-down blackmail/)).toBeTruthy();
    expect(screen.queryByText(/Prime Minister's Ear/)).toBeNull();
  });

  test("shows a player their own face-down blackmail after they reveal", () => {
    render(<PlayerDashboards game={game} revealedPlayer={RED} />);

    expect(screen.getByText(/The Prime Minister's Ear \(face down\)/)).toBeTruthy();
  });
});

describe("HandoffBanner", () => {
  test("offers to save and pass the game to the next player", () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(<HandoffBanner game={createHotseatGame()} target={BLUE} onSave={onSave} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Save & pass to Blue" }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Same device" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
