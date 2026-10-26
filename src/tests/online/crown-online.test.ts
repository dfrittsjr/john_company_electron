// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  crownAwaitsLetGo,
  crownChooserOf,
  crownFavorOffers,
  crownPausingFavorKeys,
  delegatedActorFor,
  effectiveDecisionActor,
  humanPlayerIds,
  playerCubes,
  projectForViewer,
  type GameState,
  type LegalCommand,
  type PlayerId,
} from "../../engine";
import type { CommandResponse, CreateGameResponse, GameView } from "../../online/protocol";
import { GameRoomCore, MemoryRoomStorage, type CoreResult } from "../../worker/game-room-core";
import { startedCrownGame } from "../fixtures/crown";

const ORIGIN = "https://jc.example";

function counterRandom(start = 0) {
  let counter = start;
  return (length: number) => Uint8Array.from({ length }, () => (counter += 37) % 256);
}

function body<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.status} ${result.error.code}: ${result.error.message}`);
  return result.body;
}

function tokenOf(url: string): string {
  return url.split("#")[1].split("=")[1];
}

type Table = { core: GameRoomCore; storage: MemoryRoomStorage; created: CreateGameResponse; tokens: Record<PlayerId, string>; watch: string };

async function crownTable(
  names: string[],
  options: { difficulty?: string; seed?: number; storage?: MemoryRoomStorage; scenario?: string } = {},
): Promise<Table> {
  const storage = options.storage ?? new MemoryRoomStorage();
  const core = new GameRoomCore(storage, {
    random: counterRandom(options.seed ?? 0),
    // Bots play hundreds of moves in a second.
    limits: { rateBurst: 1_000_000, ratePerSecond: 1_000_000 },
  });
  const created = body(
    await core.create({
      gameId: "crown-game",
      origin: ORIGIN,
      body: {
        scenario: options.scenario ?? "1710",
        players: names.map((name) => ({ name })),
        ...(options.difficulty ? { crownDifficulty: options.difficulty } : {}),
      },
    }),
  );
  return {
    core,
    storage,
    created,
    tokens: Object.fromEntries(created.seats.map((seat) => [seat.playerId, tokenOf(seat.url)])),
    watch: tokenOf(created.spectatorUrl),
  };
}

function currentState(table: Table): GameState {
  return JSON.parse(table.storage.snapshots.get(table.storage.meta!.version)!) as GameState;
}

async function viewOf(table: Table, playerId: PlayerId): Promise<GameView> {
  return body(await table.core.view(table.tokens[playerId]));
}

let counter = 0;
async function send(table: Table, playerId: PlayerId, view: GameView, legal: Pick<LegalCommand, "type" | "payload">): Promise<CommandResponse> {
  counter += 1;
  return body(
    await table.core.command(table.tokens[playerId], {
      command: { id: `c-${counter}`, decisionId: view.state.pendingDecision.id, type: legal.type, payload: legal.payload ?? {} },
    }),
  );
}

/** A small deterministic generator, so bot games are repeatable. */
function lcg(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

/**
 * Plays the way clients do: each seat looks at its own view; whichever seats are offered options
 * may act (more than one only while the Crown waits for favours). Returns when `until` is true of
 * the stored state, the game is over, or `moves` run out.
 */
async function botPlay(table: Table, moves: number, random: () => number, until?: (state: GameState) => boolean): Promise<number> {
  for (let move = 0; move < moves; move += 1) {
    const state = currentState(table);
    if (state.finalScoring.complete || until?.(state)) return move;
    const seats = Object.keys(table.tokens);
    const views = await Promise.all(seats.map((playerId) => viewOf(table, playerId)));
    const offered = views.map((view, index) => ({ view, playerId: seats[index] })).filter(({ view }) => view.state.pendingDecision.legalCommands.length > 0);
    expect(offered.length, `${state.pendingDecision.step} offers nothing to any seat`).toBeGreaterThan(0);
    // Only the Crown waiting for favours is open to several seats.
    if (offered.length > 1) expect(crownAwaitsLetGo(state)).toBe(true);
    const { view, playerId } = offered[Math.floor(random() * offered.length)];
    const options = view.state.pendingDecision.legalCommands;
    const response = await send(table, playerId, view, options[Math.floor(random() * options.length)]);
    expect(response.ok, `${state.pendingDecision.step}: ${JSON.stringify(response.ok ? "" : response.errors)}`).toBe(true);
  }
  return moves;
}

/** Plays two-player bot games, one seed after another, until `wanted` is true of a stored state. */
async function twoPlayerTableWhere(wanted: (state: GameState) => boolean): Promise<Table> {
  for (let seed = 1; seed <= 30; seed += 1) {
    const table = await crownTable(["Ann", "Ben"], { seed });
    await botPlay(table, 1500, lcg(seed * 17), wanted);
    if (wanted(currentState(table))) return table;
  }
  throw new Error("No game reached the wanted position.");
}

describe("creating a Crown game", () => {
  it("makes a solo game for one player and a two-player game for two, with seats for the humans only", async () => {
    const solo = await crownTable(["Ann"], { difficulty: "expert" });
    const soloState = currentState(solo);
    expect(soloState.mode).toBe("soloCrown");
    expect(soloState.crown?.difficulty).toBe("expert");
    expect(solo.created.seats.map((seat) => seat.name)).toEqual(["Ann"]);
    expect(Object.keys(soloState.players)).toEqual(["player-1", "crown"]);
    // The first decision is the player's: how to share out the setup cards.
    expect(soloState.pendingDecision.step).toBe("setup.confirmCrownStart");
    expect(soloState.pendingDecision.actor).toBe("player-1");

    const duo = await crownTable(["Ann", "Ben"]);
    const duoState = currentState(duo);
    expect(duoState.mode).toBe("twoPlayerCrown");
    expect(duoState.crown?.difficulty).toBe("normal");
    expect(duo.created.seats.map((seat) => seat.name)).toEqual(["Ann", "Ben"]);
    expect(humanPlayerIds(duoState)).toEqual(["player-1", "player-2"]);
  });

  it("plays the Crown in any scenario (p.43), with that scenario's own setup", async () => {
    for (const scenario of ["1758", "1813"]) {
      const table = await crownTable(["Ann"], { scenario });
      const state = currentState(table);
      expect(state.scenario).toBe(scenario);
      expect(state.mode).toBe("soloCrown");
      expect(state.turn).toBe(scenario === "1758" ? 3 : 5);
    }
  });

  it("refuses a bad difficulty and leaves 3+ player games alone", async () => {
    const core = new GameRoomCore(new MemoryRoomStorage());
    const bad = await core.create({ gameId: "g", origin: ORIGIN, body: { scenario: "1710", players: [{ name: "Ann" }], crownDifficulty: "impossible" } });
    expect(bad.ok).toBe(false);
    const hotseat = await crownTable(["Ann", "Ben", "Cat"], { difficulty: "hard" });
    expect(currentState(hotseat).mode).toBe("hotseat");
    expect(currentState(hotseat).crown).toBeUndefined();
  });
});

describe("the room plays the Crown", () => {
  it("takes the Crown's own steps after every command, and stops where someone must act or choose for it", async () => {
    const table = await crownTable(["Ann"]);
    const view = await viewOf(table, "player-1");
    const random = view.state.pendingDecision.legalCommands.find((legal) => (legal.payload as { variant?: string }).variant === "random")!;
    expect((await send(table, "player-1", view, random)).ok).toBe(true);

    const state = currentState(table);
    // Setup finished; the room went on through the automatic steps to the first real decision.
    expect(state.phase).not.toBe("setup");
    expect(state.pendingDecision.legalCommands.length).toBeGreaterThan(0);
    const stopsForPlayer = state.pendingDecision.actor === "player-1" || crownChooserOf(state) || crownAwaitsLetGo(state);
    expect(stopsForPlayer).toBeTruthy();
    await botPlay(table, 60, lcg(4));
    // Every step between was the Crown's or the table's, and was recorded with who took it.
    const automatic = table.storage.commands.filter((record) => record.kind === "automatic");
    expect(automatic.length).toBeGreaterThan(0);
    expect(automatic.every((record) => record.actorId === "crown" || record.actorId === "system")).toBe(true);
  });

  it("lets only the chooser answer a Crown decision with several options, as the Crown", async () => {
    const table = await twoPlayerTableWhere((state) => Boolean(crownChooserOf(state)));
    const state = currentState(table);
    const chooser = crownChooserOf(state);
    expect(chooser, "no Crown choice came up").toBeDefined();
    expect(effectiveDecisionActor(state)).toBe(chooser);
    expect(state.pendingDecision.actor).toBe("crown");

    const other = humanPlayerIds(state).find((id) => id !== chooser)!;
    const chooserView = await viewOf(table, chooser!);
    const otherView = await viewOf(table, other);
    expect(chooserView.state.pendingDecision.legalCommands.length).toBeGreaterThan(1);
    expect(chooserView.state.pendingDecision.actor).toBe("crown");
    expect(chooserView.state.pendingDecision.crown?.reason).toBeTruthy();
    expect(otherView.state.pendingDecision.legalCommands).toEqual([]);
    expect(otherView.state.pendingDecision.crown?.reason).toBe(chooserView.state.pendingDecision.crown?.reason);
    expect((await body(await table.core.view(table.watch))).state.pendingDecision.legalCommands).toEqual([]);

    const legal = chooserView.state.pendingDecision.legalCommands[0];
    const refused = await send(table, other, chooserView, legal);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0].code).toBe("ACTOR_NOT_ALLOWED");
    const spectator = await table.core.command(table.watch, { command: { id: "w", decisionId: state.pendingDecision.id, type: legal.type, payload: legal.payload } });
    expect(spectator.ok).toBe(false);

    const before = state.log.length;
    expect((await send(table, chooser!, chooserView, legal)).ok).toBe(true);
    const after = currentState(table);
    expect(after.log.length).toBeGreaterThan(before);
    // The command went to the engine as the Crown's.
    expect(table.storage.commands.find((record) => record.kind === "command" && record.type === legal.type && record.actorId === "crown")).toBeDefined();
  });

  it("lets any seat press 'Let the Crown act' while favours are on offer, and then stops waiting for those favours", async () => {
    const table = await twoPlayerTableWhere((state) => crownAwaitsLetGo(state));
    const state = currentState(table);
    expect(crownAwaitsLetGo(state), "the Crown never waited for a favour").toBe(true);
    const offeredKeys = crownPausingFavorKeys(state);
    expect(offeredKeys.length).toBeGreaterThan(0);
    expect(state.crown?.passedFavors ?? []).not.toEqual(expect.arrayContaining(offeredKeys));

    // Both seats get the Crown's one option; the spectator gets none.
    const views = [await viewOf(table, "player-1"), await viewOf(table, "player-2")];
    for (const view of views) expect(view.state.pendingDecision.legalCommands).toHaveLength(1);
    expect(delegatedActorFor(state, "player-1")).toBe("crown");
    expect(delegatedActorFor(state, "player-2")).toBe("crown");
    expect(body(await table.core.view(table.watch)).state.pendingDecision.legalCommands).toEqual([]);

    // Either seat may press it; take the second, to show it is not just the first or the Button holder.
    const response = await send(table, "player-2", views[1], views[1].state.pendingDecision.legalCommands[0]);
    expect(response.ok, JSON.stringify(response.ok ? "" : response.errors)).toBe(true);
    expect(table.storage.commands.find((record) => record.kind === "command" && record.actorId === "crown")).toBeDefined();
    const after = currentState(table);
    expect(after.crown?.passedFavors).toEqual(expect.arrayContaining(offeredKeys));
    // Passed-on favours are part of the stored game, so they survive a restart.
    const restarted = new GameRoomCore(table.storage, { limits: { rateBurst: 1_000_000, ratePerSecond: 1_000_000 } });
    const restartedState = body(await restarted.view(table.tokens["player-1"])).state;
    expect(restartedState.crown?.passedFavors).toEqual(after.crown?.passedFavors);
  });

  it("takes favours and cube gifts from each seat for its own player", async () => {
    // A moment where a seat has a favour on offer that gains it cubes.
    const table = await twoPlayerTableWhere((state) => humanPlayerIds(state).some((id) => crownFavorOffers(state, id).some((offer) => offer.cubes > 0)));
    const state = currentState(table);
    const buyer = humanPlayerIds(state).find((id) => crownFavorOffers(state, id).some((offer) => offer.cubes > 0));
    expect(buyer, "no favour came up").toBeDefined();
    const other = humanPlayerIds(state).find((id) => id !== buyer)!;
    const offer = crownFavorOffers(state, buyer!).find((candidate) => candidate.cubes > 0)!;

    const view = await viewOf(table, buyer!);
    // The projected state offers the viewer the same favours (the UI computes its list from it).
    expect(crownFavorOffers(view.state, buyer!).map((candidate) => candidate.favorId)).toEqual(crownFavorOffers(state, buyer!).map((candidate) => candidate.favorId));
    const cubesBefore = playerCubes(state, buyer!);
    const bought = await send(table, buyer!, view, { type: "crown.favor", payload: { favorId: offer.favorId, ...(offer.option !== undefined ? { option: offer.option } : {}) } });
    expect(bought.ok, JSON.stringify(bought.ok ? "" : bought.errors)).toBe(true);
    expect(playerCubes(currentState(table), buyer!)).toBeGreaterThan(cubesBefore);
    expect(table.storage.commands.find((record) => record.type === "crown.favor")?.actorId).toBe(buyer);

    // Nobody can buy a favour as somebody else: the seat decides the actor.
    const stolen = await send(table, other, await viewOf(table, other), { type: "crown.favor", payload: { favorId: "no-such-favour" } });
    expect(stolen.ok).toBe(false);

    // Two players may pass promise cubes to each other at any time, whoever is to act.
    const giver = humanPlayerIds(currentState(table)).find((id) => playerCubes(currentState(table), id) > 0)!;
    const receiver = humanPlayerIds(currentState(table)).find((id) => id !== giver)!;
    const giverCubes = playerCubes(currentState(table), giver);
    const gift = await send(table, giver, await viewOf(table, giver), { type: "crown.giveCubes", payload: { to: receiver, count: 1 } });
    expect(gift.ok, JSON.stringify(gift.ok ? "" : gift.errors)).toBe(true);
    expect(playerCubes(currentState(table), giver)).toBe(giverCubes - 1);
  });

  it("undoes a 'Let the Crown act' with the steps after it, and the favours pass on again", async () => {
    const table = await twoPlayerTableWhere((state) => crownAwaitsLetGo(state));
    const view = await viewOf(table, "player-1");
    expect((await send(table, "player-1", view, view.state.pendingDecision.legalCommands[0])).ok).toBe(true);
    const undone = body(await table.core.undo(table.tokens["player-1"]));
    // Taking the move back is allowed unless dice rolled in the Crown's steps; either way the room says so.
    if (undone.ok) {
      expect(crownAwaitsLetGo(currentState(table))).toBe(true);
      expect(currentState(table).crown?.passedFavors ?? []).toEqual(expect.not.arrayContaining(crownPausingFavorKeys(currentState(table))));
    } else {
      expect(undone.errors[0].code).toBe("UNDO_UNAVAILABLE");
    }
  });
});

describe("what a Crown game's views hide", () => {
  it("shows the Crown's state, but not the AI deck below its top card or the Crown's face-down blackmail", async () => {
    const table = await crownTable(["Ann", "Ben"], { seed: 14 });
    await botPlay(table, 400, lcg(2));
    const state = currentState(table);
    for (const viewer of ["player-1", "player-2"]) {
      const view = (await viewOf(table, viewer)).state;
      expect(view.crown?.climate).toBe(state.crown?.climate);
      expect(view.crown?.promiseCubes).toEqual(state.crown?.promiseCubes);
      expect(view.crown?.aiDeck.drawPile[0]).toBe(state.crown?.aiDeck.drawPile[0]);
      expect(view.crown!.aiDeck.drawPile.slice(1).every((id) => id.startsWith("hidden:"))).toBe(true);
      expect(view.rng.seed).toBe("");
      expect(JSON.stringify(view)).not.toContain(state.rng.seed);
    }
  });

  it("makes the Crown's face-down blackmail look like any other player's", () => {
    const base = startedCrownGame({ players: 2 });
    const withBlackmail: GameState = {
      ...base,
      players: {
        ...base.players,
        crown: { ...base.players.crown, blackmailCards: [{ id: "blackmail-secret-crown-card", cardId: "secret-crown-card", facedown: true } as never] },
        "player-1": { ...base.players["player-1"], blackmailCards: [{ id: "blackmail-secret-own-card", cardId: "secret-own-card", facedown: true } as never] },
      },
    };
    const viewed = projectForViewer(withBlackmail, { kind: "seat", playerId: "player-1" });
    expect(JSON.stringify(viewed)).not.toContain("secret-crown-card");
    expect(viewed.players.crown.blackmailCards[0].cardId).toBe("hidden:blackmail");
    expect(viewed.players.crown.blackmailCards[0].id).toMatch(/^hidden:blackmail@crown#1$/);
    // The viewer's own stays readable, and the spectator sees neither.
    expect(viewed.players["player-1"].blackmailCards[0].cardId).toBe("secret-own-card");
    const spectator = projectForViewer(withBlackmail, { kind: "spectator" });
    expect(JSON.stringify(spectator)).not.toContain("secret-crown-card");
    expect(JSON.stringify(spectator)).not.toContain("secret-own-card");
  });

  it("keeps the setup-card draft's undrawn cards and the other player's hand to the picker", async () => {
    const table = await crownTable(["Ann", "Ben"]);
    const view = await viewOf(table, "player-1");
    const draft = view.state.pendingDecision.legalCommands.find((legal) => (legal.payload as { variant?: string }).variant === "draft")!;
    expect((await send(table, "player-1", view, draft)).ok).toBe(true);
    const state = currentState(table);
    expect(state.crown?.setupDraft).toBeDefined();
    const picker = state.crown!.setupDraft!.picker;
    const other = humanPlayerIds(state).find((id) => id !== picker)!;
    const pickerSees = (await viewOf(table, picker)).state.crown!.setupDraft!;
    const otherSees = (await viewOf(table, other)).state.crown!.setupDraft!;
    expect(pickerSees.hand).toEqual(state.crown!.setupDraft!.hand);
    expect(otherSees.hand.every((id) => id.startsWith("hidden:"))).toBe(true);
    expect(pickerSees.deck.every((id) => id.startsWith("hidden:"))).toBe(true);
    expect(JSON.stringify(otherSees)).not.toContain(state.crown!.setupDraft!.deck[0]);
  });
});

describe("whole games through the room", () => {
  for (const [name, players, seed] of [
    ["solo", ["Ann"], 3],
    ["two-player", ["Ann", "Ben"], 7],
  ] as const) {
    it(`plays a ${name} game to the final scores with random bots`, async () => {
      const table = await crownTable([...players], { seed });
      const random = lcg(seed * 101);
      let moves = 0;
      while (!currentState(table).finalScoring.complete && moves < 12000) {
        moves += await botPlay(table, 200, random);
      }
      const state = currentState(table);
      expect(state.finalScoring.complete, `stuck at ${state.phase} ${state.pendingDecision.step}`).toBe(true);
      const finalView = await viewOf(table, "player-1");
      expect(finalView.state.finalScoring.complete).toBe(true);
    }, 300_000);
  }
});
