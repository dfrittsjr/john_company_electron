// @vitest-environment node
import { describe, expect, it } from "vitest";
import { setupCardDecks } from "../../data";
import { applyCommand, createNewGame, projectForViewer, HIDDEN_CARD_ID, type GameState, type PlayerId } from "../../engine";
import { applySetupCard } from "../../engine/phases/setup";
import { deserializeGameState, serializeSave } from "../../save";
import { applyCommandOrThrow } from "../fixtures/game";

const NOW = "2026-10-25T12:00:00.000Z";
const deck = setupCardDecks.find((candidate) => candidate.id === "1710")!;

function draftGame(count: number, seed = "draft-seed"): GameState {
  const game = createNewGame({
    mode: "hotseat",
    scenario: "1710",
    seed,
    now: NOW,
    setupDistribution: "draft",
    players: Array.from({ length: count }, (_, index) => ({ id: `player-${index + 1}`, name: `P${index + 1}`, color: "red" })),
  });
  return applyCommandOrThrow(game, { id: "start", actorId: "player-1", type: "setup.confirmStart", payload: {}, clientTimestamp: NOW });
}

function pick(state: GameState, index = 0): GameState {
  const decision = state.pendingDecision;
  expect(decision.step).toBe("setup.draftPick");
  const legal = decision.legalCommands[index];
  return applyCommandOrThrow(state, {
    id: `pick-${state.log.length}`,
    actorId: decision.actor as PlayerId,
    type: legal.type,
    payload: legal.payload,
    clientTimestamp: NOW,
  });
}

function distribution(state: GameState): Record<PlayerId, string[]> {
  const entry = state.log.find((candidate) => candidate.type === "setup.confirmed")!;
  return (entry.details as { setupCardDistribution: Record<PlayerId, string[]> }).setupCardDistribution;
}

describe("setup card draft (p.5)", () => {
  it.each([
    [3, 4, 0],
    [4, 3, 0],
    [5, 3, 3],
    [6, 3, 6],
  ])("%i players: hands of %i, %i extras added", (count, handSize, extras) => {
    const state = draftGame(count);
    const draft = state.hidden.setupDraft!;
    expect(state.pendingDecision.actor).toBe("player-1");
    expect(state.pendingDecision.visibility).toBe("private");
    expect(Object.values(draft.hands).map((hand) => hand.length)).toEqual(Array(count).fill(handSize));
    const dealt = Object.values(draft.hands).flat();
    expect(new Set(dealt).size).toBe(dealt.length);
    expect(dealt.filter((id) => deck.cards.find((card) => card.id === id)?.extra)).toHaveLength(extras);
    expect(dealt.length + draft.removed.length).toBe(deck.cards.length);
    expect(state.pendingDecision.legalCommands).toHaveLength(handSize);
  });

  it("passes the remaining hands left and ends with every card held by exactly one player", () => {
    let state = draftGame(4);
    const first = state.hidden.setupDraft!.hands;
    state = pick(state);
    const taken = first["player-1"][0];
    expect(state.hidden.setupDraft!.picks["player-1"]).toEqual([taken]);
    for (let i = 0; i < 3; i += 1) state = pick(state);
    // Round two: player-2 now holds player-1's remaining cards (passed left).
    const draft = state.hidden.setupDraft!;
    expect(state.pendingDecision.actor).toBe("player-1");
    expect(draft.hands["player-2"]).toEqual(first["player-1"].filter((id) => id !== taken));
    expect(draft.hands["player-1"]).toEqual(first["player-4"].filter((id) => id !== draft.picks["player-4"][0]));

    const all = Object.values(draft.hands).flat().concat(Object.values(draft.picks).flat());
    expect(new Set(all).size).toBe(12);
    let guard = 0;
    while (state.hidden.setupDraft && guard++ < 50) state = pick(state);
    expect(state.phase).toBe("family");
    expect(state.hidden.setupDraft).toBeUndefined();
    const held = Object.values(distribution(state)).flat();
    expect([...held].sort()).toEqual(deck.cards.filter((card) => !card.extra).map((card) => card.id).sort());
    expect([...state.decks["setup-1710"].discardPile].sort()).toEqual([...held].sort());
    expect(state.londonSeason.display.length).toBeGreaterThan(0);
  });

  it("gives the same result as applying the picked cards", () => {
    for (const count of [3, 5]) {
      const start = draftGame(count, `equal-${count}`);
      let state = start;
      while (state.hidden.setupDraft) state = pick(state, 1);
      const picks = distribution(state);

      let expected: GameState = { ...start, hidden: { ...start.hidden, setupDraft: undefined } };
      for (const [playerId, cardIds] of Object.entries(picks)) {
        for (const cardId of cardIds) expected = applySetupCard(expected, playerId, deck.cards.find((card) => card.id === cardId)!);
      }
      for (const playerId of Object.keys(picks)) {
        const got = state.players[playerId];
        const want = expected.players[playerId];
        expect(got.cash).toBe(want.cash);
        expect(got.victoryPoints).toBe(want.victoryPoints);
        expect(got.enterprises).toEqual(want.enterprises);
        expect(got.familyMembers).toEqual(want.familyMembers);
        expect(got.blackmailCards.length).toBe(want.blackmailCards.length);
      }
      expect(state.company.offices).toEqual(expected.company.offices);
      expect(state.india.presidencies).toEqual(expected.india.presidencies);
    }
  });

  it("rejects a pick from the wrong player or a card not in hand", () => {
    const state = draftGame(3);
    const other = state.pendingDecision.legalCommands[0];
    const base = { gameId: state.gameId, decisionId: state.pendingDecision.id, type: "setup.draftPick", clientTimestamp: NOW };
    expect(applyCommand(state, { ...base, id: "a", actorId: "player-2", payload: other.payload }).ok).toBe(false);
    const foreign = { cardId: state.hidden.setupDraft!.hands["player-2"][0] };
    expect(applyCommand(state, { ...base, id: "b", actorId: "player-1", payload: foreign }).ok).toBe(false);
  });

  it("round-trips through a save in the middle of the draft", () => {
    let state = draftGame(4);
    state = pick(state);
    state = pick(state);
    const loaded = deserializeGameState(serializeSave(state, { saveId: "mid-draft" }));
    expect(loaded).toEqual(state);
    let a = loaded;
    let b = state;
    while (a.hidden.setupDraft) a = pick(a);
    while (b.hidden.setupDraft) b = pick(b);
    expect(a.players).toEqual(b.players);
  });

  it("an online viewer sees only their own hand and picks", () => {
    let state = draftGame(4);
    state = pick(state);
    state = pick(state);
    const real = state.hidden.setupDraft!;
    for (const viewer of ["player-1", "player-2", "player-3", "player-4"]) {
      const view = projectForViewer(state, { kind: "seat", playerId: viewer }).hidden.setupDraft!;
      for (const playerId of real.order) {
        if (playerId === viewer) {
          expect(view.hands[playerId]).toEqual(real.hands[playerId]);
          expect(view.picks[playerId]).toEqual(real.picks[playerId]);
        } else {
          expect(view.hands[playerId]).toEqual(real.hands[playerId].map(() => HIDDEN_CARD_ID));
          expect(view.picks[playerId]).toEqual(real.picks[playerId].map(() => HIDDEN_CARD_ID));
        }
      }
    }
    const spectator = projectForViewer(state, { kind: "spectator" });
    expect(JSON.stringify(spectator.hidden.setupDraft)).not.toMatch(/1710-/);
    expect(spectator.pendingDecision.legalCommands).toEqual([]);
    expect(JSON.stringify(spectator.log)).not.toMatch(/1710-\d/);
    // The actor sees their options; nobody else does.
    expect(projectForViewer(state, { kind: "seat", playerId: "player-3" }).pendingDecision.legalCommands.length).toBeGreaterThan(0);
    expect(projectForViewer(state, { kind: "seat", playerId: "player-2" }).pendingDecision.legalCommands).toEqual([]);
  });
});
