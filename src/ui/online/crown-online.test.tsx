import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { crownFavorOffers, humanPlayerIds, projectForViewer, type GameState } from "../../engine";
import type { GameView } from "../../online/protocol";
import { crownPlays, startedCrownGame } from "../../tests/fixtures/crown";
import { CrownFavors } from "../CrownFavors";
import { DecisionPanel } from "../DecisionPanel";
import { isMyDecision } from "./OnlineGame";

afterEach(cleanup);

/** The Crown's one move, waiting only for favours to be passed on (as the server leaves it). */
function waitingGame(): GameState {
  const game = crownPlays(startedCrownGame({ players: 2 }));
  const crownMove = game.pendingDecision.legalCommands[0];
  return {
    ...game,
    pendingDecision: {
      ...game.pendingDecision,
      actor: "crown",
      prompt: "The Crown: test move.",
      legalCommands: [crownMove],
      crown: { all: [crownMove], reason: "A test reason." },
    },
  };
}

function viewFor(game: GameState, playerId: string): GameView {
  return { gameId: "g", viewer: { kind: "seat", playerId }, version: 1, state: projectForViewer(game, { kind: "seat", playerId }), undo: { available: false } };
}

describe("a Crown game online", () => {
  test("both seats are offered 'Let the Crown act' while it waits for favours, but neither is 'up'", () => {
    const game = waitingGame();
    for (const playerId of humanPlayerIds(game)) {
      const view = viewFor(game, playerId);
      expect(view.state.pendingDecision.legalCommands).toHaveLength(1);
      expect(isMyDecision(view)).toBe(false);
    }
    const view = viewFor(game, "player-ann");
    render(<DecisionPanel game={view.state} hidden={false} onReveal={() => {}} onRun={vi.fn()} onHover={() => {}} filter={null} onClearFilter={() => {}} error={null} />);
    expect(screen.getByRole("button", { name: "Let the Crown act" })).toBeTruthy();
    expect(screen.getByText("A test reason.")).toBeTruthy();
  });

  test("only the chooser is offered a Crown decision with several options, and is 'up'", () => {
    const game = waitingGame();
    const [first] = game.pendingDecision.legalCommands;
    const choosing: GameState = {
      ...game,
      pendingDecision: {
        ...game.pendingDecision,
        legalCommands: [first, { ...first, label: "Another option", payload: { other: true } }],
        crown: { ...game.pendingDecision.crown!, all: game.pendingDecision.legalCommands, chooser: "player-ben" },
      },
    };
    expect(isMyDecision(viewFor(choosing, "player-ben"))).toBe(true);
    expect(viewFor(choosing, "player-ben").state.pendingDecision.legalCommands).toHaveLength(2);
    expect(isMyDecision(viewFor(choosing, "player-ann"))).toBe(false);
    expect(viewFor(choosing, "player-ann").state.pendingDecision.legalCommands).toEqual([]);
  });

  test("the favours list shows only the viewer's own favours and gifts online", () => {
    const game = startedCrownGame({ players: 2 });
    const mine = crownFavorOffers(game, "player-ann");
    const { container } = render(<CrownFavors game={game} waiting={false} only="player-ann" onFavor={vi.fn()} onGive={vi.fn()} />);
    const section = within(container);
    expect(section.queryByRole("heading", { name: /Ben/ })).toBeNull();
    expect(section.queryByRole("button", { name: /Ben gives/ })).toBeNull();
    expect(container.querySelectorAll(".favor-player h4").length).toBe(2); // Ann's list and the gift row
    expect(container.querySelectorAll(".favor-list li").length).toBe(mine.length);
  });
});
