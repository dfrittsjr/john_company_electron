// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  blackmailCards,
  indiaEventTiles,
  laws as lawCards,
  offices,
  prestigeCards,
} from "../../data";
import {
  HIDDEN_BLACKMAIL_CARD_ID,
  HIDDEN_DECISION_STEP,
  HIDDEN_EVENT_TILE_ID,
  HIDDEN_LAW_ID,
  HIDDEN_LONDON_SEASON_CARD_ID,
  HIDDEN_PLAYER_ID,
  applyCommand,
  createNewGame,
  hiddenBlackmailInstanceId,
  projectForViewer,
  resolveHiddenIds,
  topOfStackRegion,
  type GameState,
  type PlayerId,
  type ProjectionViewer,
} from "../../engine";
import { withOffice } from "../fixtures/builders";
import { applyCommandOrThrow } from "../fixtures/game";
import { act, BLUE, negotiationGame, RED, withBlackmail, YELLOW } from "../fixtures/negotiation";

const NOW = "2026-10-25T12:00:00.000Z";
const SEED = "projection-secret-seed-1234";
const ANN = "player-1";
const BEN = "player-2";
const CAT = "player-3";
const SEATS: PlayerId[] = [ANN, BEN, CAT];

function viewers(players: PlayerId[]): ProjectionViewer[] {
  return [...players.map((playerId) => ({ kind: "seat" as const, playerId })), { kind: "spectator" as const }];
}

/** A random 1710 setup past "Begin setup", with face-down blackmail in a seat and in the display. */
function startedGame(seed = "p2"): GameState {
  const state = createNewGame({
    mode: "hotseat",
    scenario: "1710",
    seed,
    gameId: "game-projection",
    now: NOW,
    setupDistribution: "random",
    players: [
      { id: ANN, name: "Ann", color: "red" },
      { id: BEN, name: "Ben", color: "blue" },
      { id: CAT, name: "Cat", color: "yellow" },
    ],
  });
  const legal = state.pendingDecision.legalCommands[0];
  const result = applyCommand(state, {
    id: "c1",
    gameId: state.gameId,
    actorId: state.pendingDecision.actor,
    decisionId: state.pendingDecision.id,
    type: legal.type,
    payload: legal.payload,
    clientTimestamp: NOW,
  });
  if (!result.ok) throw new Error(result.errors[0].message);
  return { ...result.state, rng: { ...result.state.rng, seed: SEED } };
}

function faceDownOf(state: GameState, playerId: PlayerId) {
  return state.players[playerId].blackmailCards.filter((card) => card.facedown !== false);
}

/** Every string anywhere in a value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => strings(item, out));
  return out;
}

/** True when any string in `view` equals or contains `secret`. */
function mentions(view: unknown, secret: string): boolean {
  return strings(view).some((text) => text === secret || text.includes(secret));
}

/** Secrets of a state that only `viewer` may know (or nobody, for a spectator). */
function secretsHiddenFrom(state: GameState, viewer: ProjectionViewer): string[] {
  const me = viewer.kind === "seat" ? viewer.playerId : undefined;
  const secrets = [SEED];
  for (const [playerId, player] of Object.entries(state.players)) {
    if (playerId === me) continue;
    for (const card of player.blackmailCards.filter((candidate) => candidate.facedown !== false)) {
      secrets.push(card.cardId, card.id);
    }
  }
  const blackmailIds = new Set(blackmailCards.map((card) => card.id));
  for (const cardId of state.londonSeason.display) if (blackmailIds.has(cardId)) secrets.push(cardId);
  return secrets;
}

describe("projectForViewer", () => {
  it("hides the RNG, deck orders and other seats' blackmail from every other viewer", () => {
    const state = startedGame();
    expect(faceDownOf(state, BEN).length).toBeGreaterThan(0);

    for (const viewer of viewers(SEATS)) {
      const view = projectForViewer(state, viewer);
      const secrets = secretsHiddenFrom(state, viewer);
      expect(secrets.length).toBeGreaterThan(1);
      for (const secret of secrets) {
        expect(mentions(state, secret), `${secret} is in the full state`).toBe(true);
        expect(mentions(view, secret), `${JSON.stringify(viewer)} must not see ${secret}`).toBe(false);
      }

      expect(view.rng.seed).toBe("");
      expect(view.rng.internalState).toEqual([0, 0, 0, 0]);
      expect(view.rng.counter).toBe(state.rng.counter);

      expect(view.parliament.lawDeck.drawPile).toEqual(state.parliament.lawDeck.drawPile.map(() => HIDDEN_LAW_ID));
      expect(view.londonSeason.deck).toEqual(state.londonSeason.deck.map(() => HIDDEN_LONDON_SEASON_CARD_ID));
      expect(view.eventsInIndia.drawPile).toHaveLength(state.eventsInIndia.drawPile.length);
      expect(view.eventsInIndia.drawPile.slice(1).every((id) => id === HIDDEN_EVENT_TILE_ID)).toBe(true);
      // The top tile's painted region side stays public, and the engine helper still reads it.
      expect(topOfStackRegion(view)).toBe(topOfStackRegion(state));
      expect(topOfStackRegion(view)).toBeDefined();

      // No event tile, law or London Season card order survives in the piles.
      for (const tile of indiaEventTiles) expect(view.eventsInIndia.drawPile).not.toContain(tile.id);
      for (const law of lawCards) expect(view.parliament.lawDeck.drawPile).not.toContain(law.id);
    }
  });

  it("keeps the viewer's own face-down blackmail and private cards", () => {
    const state = startedGame();
    const mine = faceDownOf(state, BEN);
    const view = projectForViewer(state, { kind: "seat", playerId: BEN });

    expect(view.players[BEN].blackmailCards).toEqual(state.players[BEN].blackmailCards);
    expect(view.hidden.privateCards[BEN] ?? mine).toEqual(state.hidden.privateCards[BEN] ?? mine);
    expect(Object.keys(view.hidden.privateCards).filter((playerId) => playerId !== BEN)).toEqual([]);

    // Everyone else sees the same number of cards, as placeholders.
    for (const other of [ANN, CAT]) {
      const theirs = projectForViewer(state, { kind: "seat", playerId: other }).players[BEN].blackmailCards;
      expect(theirs).toHaveLength(state.players[BEN].blackmailCards.length);
      expect(theirs.every((card) => card.cardId === HIDDEN_BLACKMAIL_CARD_ID && card.facedown)).toBe(true);
      expect(theirs[0].id).toBe(hiddenBlackmailInstanceId(BEN, 0));
    }
  });

  it("removes other players' private cards, firm secrets and the Crown's internals", () => {
    const base = startedGame();
    const state: GameState = {
      ...base,
      hidden: {
        ...base.hidden,
        privateCards: { [ANN]: [{ id: "x-ann", cardId: "secret-ann", facedown: true }], [BEN]: [{ id: "x-ben", cardId: "secret-ben", facedown: true }] },
        firmStrategySecrets: {
          "firm-a": { firmId: "firm-a", committedBy: ANN, strategy: "south-indian", bid: 4 },
          "firm-b": { firmId: "firm-b", committedBy: BEN, strategy: "west-indian", bid: 3, revealed: true },
        },
      },
    };

    const ben = projectForViewer(state, { kind: "seat", playerId: BEN });
    expect(ben.hidden.privateCards).toEqual({ [BEN]: state.hidden.privateCards[BEN] });
    expect(ben.hidden.firmStrategySecrets["firm-a"]).toEqual({ firmId: "firm-a", committedBy: ANN });
    expect(ben.hidden.firmStrategySecrets["firm-b"]).toEqual(state.hidden.firmStrategySecrets["firm-b"]);
    expect(JSON.stringify(ben.hidden.firmStrategySecrets)).not.toContain("south-indian");
    expect(mentions(ben, "secret-ann")).toBe(false);

    const ann = projectForViewer(state, { kind: "seat", playerId: ANN });
    expect(ann.hidden.firmStrategySecrets["firm-a"]).toEqual(state.hidden.firmStrategySecrets["firm-a"]);
    // Someone else's revealed strategy is public; its bid already is (FirmState.tradeBid).
    expect(ann.hidden.firmStrategySecrets["firm-b"]).toEqual({ firmId: "firm-b", committedBy: BEN, strategy: "west-indian", revealed: true });

    const spectator = projectForViewer(state, { kind: "spectator" });
    expect(spectator.hidden.privateCards).toEqual({});
    expect(mentions(spectator, "secret-")).toBe(false);
  });

  it("hides the Crown's AI deck order", () => {
    const solo = createNewGame({ mode: "soloCrown", scenario: "1710", seed: SEED, now: NOW, players: [{ id: ANN, name: "Ann", color: "red" }] });
    const view = projectForViewer(solo, { kind: "seat", playerId: ANN });
    expect(solo.crown?.aiDeck.drawPile.length).toBeGreaterThan(0);
    const [top, ...rest] = solo.crown!.aiDeck.drawPile;
    // The top card's back is on the table; the order below it is hidden.
    expect(view.crown?.aiDeck.drawPile).toEqual([top, ...rest.map(() => "hidden:card")]);
    for (const cardId of rest) expect(view.crown!.aiDeck.drawPile).not.toContain(cardId);
  });

  it("gives legal commands only to the player who must decide", () => {
    const state = startedGame();
    const actor = state.pendingDecision.actor as PlayerId;
    expect(state.pendingDecision.legalCommands.length).toBeGreaterThan(0);

    for (const viewer of viewers(SEATS)) {
      const view = projectForViewer(state, viewer);
      const isActor = viewer.kind === "seat" && viewer.playerId === actor;
      expect(view.pendingDecision.legalCommands).toEqual(isActor ? state.pendingDecision.legalCommands : []);
      expect(view.pendingDecision.actor).toBe(actor);
      expect(view.pendingDecision.id).toBe(state.pendingDecision.id);
    }
  });

  it("removes seeds and shuffle rolls from the log", () => {
    const base = startedGame();
    const roll = { algorithm: "xoshiro128ss" as const, seed: SEED, startCounter: 1, endCounter: 2, values: [4] };
    const state: GameState = {
      ...base,
      log: [
        ...base.log,
        {
          id: "log-x",
          sequence: base.log.length + 1,
          timestamp: NOW,
          turn: base.turn,
          phase: base.phase,
          type: "test.rolls",
          summary: "Rolled.",
          rngRolls: [
            { ...roll, label: "shuffle[12]" },
            { ...roll, label: "companyOperation.trade" },
          ],
        },
      ],
    };
    const view = projectForViewer(state, { kind: "spectator" });
    expect(view.log.at(-1)?.rngRolls).toEqual([{ ...roll, seed: "", label: "companyOperation.trade" }]);
    expect(mentions(view, SEED)).toBe(false);
  });

  it("follows a face-down card through a transfer, the log and a deal", () => {
    let state = withBlackmail(negotiationGame("parliament"), RED, "company-fraud", { instanceId: "blackmail-company-fraud" });
    state = act(state, RED, "negotiation.give", { to: BLUE, items: [{ kind: "blackmail", cardInstanceId: "blackmail-company-fraud" }] });
    expect(state.log.at(-1)?.details).toMatchObject({ items: [{ cardInstanceId: "blackmail-company-fraud" }] });
    expect(state.negotiation.transfers.map((event) => event.assetId)).toContain("blackmail-company-fraud");

    for (const viewer of viewers([RED, YELLOW])) {
      const view = projectForViewer(state, viewer);
      expect(mentions(view, "company-fraud"), JSON.stringify(viewer)).toBe(false);
    }
    expect(mentions(projectForViewer(state, { kind: "seat", playerId: BLUE }), "blackmail-company-fraud")).toBe(true);

    // Yellow asks Blue for the card it cannot see, using the placeholder from its own view.
    const yellowView = projectForViewer(state, { kind: "seat", playerId: YELLOW });
    const placeholder = yellowView.players[BLUE].blackmailCards[0].id;
    const payload = { to: BLUE, give: [{ kind: "cash", amount: 1 }], receive: [{ kind: "blackmail", cardInstanceId: placeholder }] };
    const resolved = resolveHiddenIds(state, { kind: "seat", playerId: YELLOW }, payload);
    expect(resolved).toEqual({ ...payload, receive: [{ kind: "blackmail", cardInstanceId: "blackmail-company-fraud" }] });

    state = act(state, YELLOW, "negotiation.proposeTrade", resolved);
    expect(state.pendingDecision).toMatchObject({ actor: BLUE, step: "negotiation.consent" });
    // The pending deal, its saved decision and the consent prompt don't name the card to Red.
    const redView = projectForViewer(state, { kind: "seat", playerId: RED });
    expect(mentions(redView, "company-fraud")).toBe(false);
    expect(redView.negotiation.interrupts[0].savedDecision.legalCommands).toEqual([]);

    state = act(state, BLUE, "negotiation.respondToConsent", { requestId: state.negotiation.interrupts[0].id, accept: true });
    expect(state.players[YELLOW].blackmailCards.map((card) => card.id)).toEqual(["blackmail-company-fraud"]);
    expect(mentions(projectForViewer(state, { kind: "seat", playerId: BLUE }), "company-fraud")).toBe(false);
    expect(mentions(projectForViewer(state, { kind: "spectator" }), "company-fraud")).toBe(false);
  });

  it("shows face-down display blackmail only to the player choosing from the display", () => {
    const base = startedGame();
    const blackmailIds = new Set(blackmailCards.map((card) => card.id));
    const display = ["man-on-the-inside", base.londonSeason.display[1], base.londonSeason.display[2]];
    const state: GameState = {
      ...base,
      phase: "londonSeason",
      londonSeason: { ...base.londonSeason, display },
      pendingDecision: {
        id: "decision-london-season-prestige-test",
        phase: "londonSeason",
        step: "londonSeason.choosePrestigeCard",
        actor: ANN,
        visibility: "private",
        prompt: "Ann: take or discard one card from the London Season Display. You may look at face-down blackmail.",
        legalCommands: [
          { type: "londonSeason.choosePrestigeCard", label: "Take face-down blackmail: Man on the Inside", payload: { action: "take", slot: 0, cardId: "man-on-the-inside" } },
        ],
        canSave: true,
      },
    };

    const ann = projectForViewer(state, { kind: "seat", playerId: ANN });
    expect(ann.londonSeason.display[0]).toBe("man-on-the-inside");
    expect(ann.pendingDecision.legalCommands).toEqual(state.pendingDecision.legalCommands);

    for (const viewer of [{ kind: "seat" as const, playerId: BEN }, { kind: "spectator" as const }]) {
      const view = projectForViewer(state, viewer);
      expect(view.londonSeason.display[0]).toBe(HIDDEN_BLACKMAIL_CARD_ID);
      for (const cardId of display.filter((id) => blackmailIds.has(id))) expect(mentions(view, cardId)).toBe(false);
      expect(mentions(view, "Man on the Inside")).toBe(false);
    }
  });

  it("keeps discarded blackmail unidentified, in the discards and in the log", () => {
    const base = startedGame();
    const state: GameState = {
      ...base,
      londonSeason: { ...base.londonSeason, discard: [...base.londonSeason.discard, "joseph-sedley", "company-fraud"] },
      log: [
        ...base.log,
        {
          id: "log-discard",
          sequence: base.log.length + 1,
          timestamp: NOW,
          turn: base.turn,
          phase: base.phase,
          type: "londonSeason.restrictionResolved",
          summary: "Ann discarded a face-down blackmail card.",
          details: { playerId: ANN, action: "discard", kind: "blackmail", id: "blackmail-company-fraud" },
        },
      ],
    };
    for (const viewer of viewers(SEATS)) {
      const view = projectForViewer(state, viewer);
      expect(view.londonSeason.discard.slice(-2)).toEqual(["joseph-sedley", HIDDEN_BLACKMAIL_CARD_ID]);
      expect(mentions(view, "company-fraud")).toBe(false);
    }
  });

  it("does not name the step when a decision exists only because of a face-down card", () => {
    let state = withBlackmail(negotiationGame("revenue"), RED, "company-fraud", { instanceId: "blackmail-company-fraud" });
    state = {
      ...state,
      parliament: { ...state.parliament, revenue: { stage: "companyFraud", fraudCandidates: [RED], scandalCandidates: [] } },
      pendingDecision: {
        id: "decision-revenue.companyFraud-1",
        phase: "revenue",
        step: "revenue.companyFraud",
        actor: RED,
        visibility: "private",
        prompt: "Play Company Fraud? Roll a die per officeholder.",
        legalCommands: [{ type: "revenue.companyFraud", label: "Keep the card", payload: { play: false } }],
        canSave: true,
      },
    };

    const red = projectForViewer(state, { kind: "seat", playerId: RED });
    expect(red.pendingDecision).toEqual(state.pendingDecision);
    expect(red.parliament.revenue?.fraudCandidates).toEqual([RED]);

    const blue = projectForViewer(state, { kind: "seat", playerId: BLUE });
    expect(blue.pendingDecision).toMatchObject({ actor: HIDDEN_PLAYER_ID, step: HIDDEN_DECISION_STEP, legalCommands: [] });
    expect(blue.pendingDecision.prompt).not.toMatch(/fraud/i);
    expect(blue.pendingDecision.id).not.toMatch(/fraud/i);
    expect(blue.parliament.revenue?.fraudCandidates).toEqual([]);
    expect(mentions(blue, "company-fraud")).toBe(false);

    // Keeping the card: only Red reads that they kept it; the others see who acted on nothing.
    const kept = applyCommandOrThrow(withOffice(state, "manager-of-shipping", RED), { id: "keep-fraud", actorId: RED, type: "revenue.companyFraud", payload: { play: false } });
    const entries = (game: GameState) => game.log.slice(state.log.length);
    expect(entries(projectForViewer(kept, { kind: "seat", playerId: RED })).map((entry) => entry.summary).join(" ")).toMatch(/kept their blackmail card/);
    for (const viewer of [{ kind: "seat", playerId: BLUE } as const, { kind: "spectator" } as const]) {
      const others = entries(projectForViewer(kept, viewer));
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((entry) => entry.actor === undefined && entry.publicSummary === undefined)).toBe(true);
      expect(others.map((entry) => entry.summary).join(" ")).not.toMatch(/kept|blackmail|Red/i);
    }
  });

  it("hands a multi-option system decision to the Chairman title holder", () => {
    const base = negotiationGame("revenue");
    const state: GameState = {
      ...base,
      company: { ...base.company, chairmanMarker: BLUE },
      pendingDecision: {
        id: "decision-revenue-dividends-test",
        phase: "revenue",
        step: "revenue.chooseDividends",
        actor: "system",
        visibility: "public",
        prompt: "No Chairman is in office; choose Revenue dividends.",
        legalCommands: [
          { type: "revenue.chooseDividends", label: "Pay No Dividends", payload: { amountPerShare: 0 } },
          { type: "revenue.chooseDividends", label: "Pay 1 Dividend", payload: { amountPerShare: 1 } },
        ],
        canSave: true,
      },
    };
    const blue = projectForViewer(state, { kind: "seat", playerId: BLUE });
    expect(blue.pendingDecision.actor).toBe(BLUE);
    expect(blue.pendingDecision.legalCommands).toHaveLength(2);
    for (const viewer of viewers([RED, YELLOW])) {
      const view = projectForViewer(state, viewer);
      expect(view.pendingDecision.actor).toBe(BLUE);
      expect(view.pendingDecision.legalCommands).toEqual([]);
    }
  });

  it("does not change the authoritative state", () => {
    const state = startedGame();
    const copy = structuredClone(state);
    for (const viewer of viewers(SEATS)) projectForViewer(state, viewer);
    expect(state).toEqual(copy);
  });
});

describe("placeholder ids", () => {
  it("never collide with real component ids, and blackmail ids are unique among them", () => {
    const blackmail = blackmailCards.map((card) => card.id);
    const others = [
      ...prestigeCards.map((card) => card.id),
      ...lawCards.map((card) => card.id),
      ...indiaEventTiles.map((tile) => tile.id),
      ...offices.map((office) => office.id),
    ];
    for (const id of [...blackmail, ...others]) expect(id.startsWith("hidden:")).toBe(false);
    for (const id of blackmail) expect(others).not.toContain(id);
  });
});
