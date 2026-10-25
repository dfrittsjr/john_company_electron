import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCommand,
  createNewGame,
  effectiveDecisionActor,
  projectForViewer,
  runAutomaticSteps,
  type GameState,
  type PlayerId,
  type ProjectionViewer,
} from "../../engine";
import { createRngState, rollDie } from "../../engine/rng";
import { BoardView } from "../../ui/BoardView";
import { DecisionPanel } from "../../ui/DecisionPanel";
import { DetailsPanel } from "../../ui/DetailsPanel";
import { LogPanel } from "../../ui/LogPanel";
import { NegotiationPanel } from "../../ui/NegotiationPanel";
import { ParliamentPanel } from "../../ui/ParliamentPanel";
import { PlayerDashboards } from "../../ui/PlayerDashboards";

// The projected views must still render in the existing game screen's components.

afterEach(cleanup);

const NOW = "2026-10-25T12:00:00.000Z";
const PLAYERS = ["player-1", "player-2", "player-3", "player-4"];
const noop = () => undefined;

/** Plays random legal moves the way the server would (automatic steps included), keeping snapshots. */
function playedSnapshots(moves: number, every: number): GameState[] {
  let state = createNewGame({
    mode: "hotseat",
    scenario: "1710",
    seed: "render-projection",
    gameId: "game-render",
    now: NOW,
    setupDistribution: "random",
    players: PLAYERS.map((id, index) => ({ id, name: `Player ${index + 1}`, color: ["red", "blue", "green", "purple"][index] })),
  });
  let rng = createRngState("render-picks");
  const snapshots: GameState[] = [state];
  for (let move = 0; move < moves; move += 1) {
    const decision = state.pendingDecision;
    if (decision.legalCommands.length === 0) break;
    let legal = decision.legalCommands[0];
    if (decision.legalCommands.length > 1) {
      const roll = rollDie(rng, decision.legalCommands.length);
      rng = roll.rng;
      legal = decision.legalCommands[roll.value - 1];
    }
    const actor = effectiveDecisionActor(state);
    const result = applyCommand(state, {
      id: `render-${move}`,
      gameId: state.gameId,
      actorId: decision.actor === "system" ? "system" : actor === "simultaneous" ? PLAYERS[0] : actor,
      decisionId: decision.id,
      type: legal.type,
      payload: legal.payload ?? {},
      clientTimestamp: NOW,
    });
    if (!result.ok) throw new Error(result.errors[0].message);
    state = runAutomaticSteps(result.state, { now: NOW, idPrefix: `render-${move}-auto` }).state;
    if (move % every === 0) snapshots.push(state);
  }
  snapshots.push(state);
  return snapshots;
}

function renderAll(game: GameState, me: PlayerId | null) {
  const { unmount } = render(
    <div>
      <BoardView game={game} highlights={new Set()} focus={new Set()} selected={null} onSelect={noop} />
      <PlayerDashboards game={game} revealedPlayer={me} onSelectPlayer={noop} />
      <DecisionPanel
        game={game}
        hidden={false}
        onReveal={noop}
        onRun={noop}
        onHover={noop}
        filter={null}
        onClearFilter={noop}
        error={null}
      />
      <LogPanel game={game} />
      <NegotiationPanel game={game} revealedPlayer={me} onReveal={noop} onCommand={noop} />
      <ParliamentPanel game={game} />
      {[0, 1, 2].map((slot) => (
        <DetailsPanel key={slot} game={game} target={`display:${slot}`} optionCount={0} onClose={noop} />
      ))}
    </div>,
  );
  unmount();
}

describe("projected views in the game screen", () => {
  it("render for every seat and a spectator throughout a game", () => {
    const snapshots = playedSnapshots(240, 40);
    expect(snapshots.length).toBeGreaterThan(4);
    const viewers: ProjectionViewer[] = [...PLAYERS.map((playerId) => ({ kind: "seat" as const, playerId })), { kind: "spectator" }];
    for (const state of snapshots) {
      for (const viewer of viewers) {
        const view = projectForViewer(state, viewer);
        expect(() => renderAll(view, viewer.kind === "seat" ? viewer.playerId : null)).not.toThrow();
      }
    }
  }, 120_000);
});
