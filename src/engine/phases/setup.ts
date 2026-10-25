import type { CommandHandler } from "../command-handler";
import { enterpriseDecks, setupCardDecks } from "../../data";
import type { EnterpriseType, SetupCardDefinition, SetupCardEffect } from "../../data";
import { shuffle } from "../rng";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  PlayerId,
  PlayerState,
  PresidencyId,
} from "../types";
import { availableEnterpriseCard, startFamilyPhase } from "./family";
import { buildLondonSeasonDisplay, drawSetupBlackmail } from "./london-season";
import { createCommandLogEntry } from "./shared";

export function confirmStart(state: GameState, command: GameCommand): ApplyCommandResult {
  const now = command.clientTimestamp;
  const setupDistribution = parseSetupDistribution(state, command.payload);
  const setupResult =
    setupDistribution === "random" && state.mode === "hotseat" && setupDeckIdForScenario(state) === "1710"
      ? applyRandomHotseat1710SetupCards(state)
      : { state, details: undefined };
  // Setup step 12: build the London Season Display after setup cards have taken their blackmail.
  const setupState = buildLondonSeasonDisplay(setupResult.state);
  if (!setupState.seatingOrder.some((playerId) => !setupState.players[playerId].isCrown)) {
    return {
      ok: false,
      errors: [
        {
          code: "NO_HUMAN_ACTOR",
          message: "Cannot advance setup because there is no human player.",
        },
      ],
    };
  }

  const logEntry = createCommandLogEntry({
    state: setupState,
    command,
    now,
    type: "setup.confirmed",
    summary:
      setupResult.details === undefined
        ? `${setupState.players[command.actorId]?.name ?? command.actorId} confirmed setup start.`
        : `${setupState.players[command.actorId]?.name ?? command.actorId} confirmed setup and dealt 1710 setup cards.`,
    details: setupResult.details,
  });

  // The London Season is skipped on the first turn (p.11), so play starts with Family.
  return {
    ok: true,
    logEntry,
    state: startFamilyPhase({
      ...setupState,
      updatedAt: now,
      log: [...setupState.log, logEntry],
    }),
  };
}

// Long 1710 "begins identically to the 1710 scenario" (p.4), so it deals the 1710 setup cards.
function setupDeckIdForScenario(state: GameState): string {
  return state.scenario === "long-1710" ? "1710" : state.scenario;
}

function parseSetupDistribution(state: GameState, payload: unknown): "starter" | "random" {
  const explicit = setupDistributionFromPayload(payload);
  if (explicit) return explicit;

  const legalPayload = state.pendingDecision.legalCommands.find(
    (command) => command.type === "setup.confirmStart",
  )?.payload;
  const legal = setupDistributionFromPayload(legalPayload);

  return legal ?? "random";
}

function setupDistributionFromPayload(payload: unknown): "starter" | "random" | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { setupDistribution?: unknown };

  if (raw.setupDistribution === "starter") return "starter";
  if (raw.setupDistribution === "random") return "random";

  return undefined;
}

function applyRandomHotseat1710SetupCards(state: GameState): {
  state: GameState;
  details: {
    setupCardDistribution: Record<PlayerId, string[]>;
    removedSetupCards: string[];
    note: string;
  };
} {
  const deck = setupCardDecks.find((candidate) => candidate.id === "1710");
  if (!deck) {
    throw new Error("1710 setup card deck is not encoded.");
  }

  const humanPlayerIds = state.seatingOrder.filter((playerId) => !state.players[playerId].isCrown);
  const baseCards = deck.cards.filter((card) => !card.extra);
  const extraCards = deck.cards.filter((card) => card.extra);
  const extraCount =
    humanPlayerIds.length >= 6
      ? deck.extraCardsForSixPlayers
      : humanPlayerIds.length === 5
        ? deck.extraCardsForFivePlayers
        : 0;
  const shuffledExtras = shuffle(state.rng, extraCards);
  const selectedExtras = shuffledExtras.items.slice(0, extraCount);
  const removedSetupCards = shuffledExtras.items.slice(extraCount).map((card) => card.id);
  const shuffledDeal = shuffle(shuffledExtras.rng, [...baseCards, ...selectedExtras]);
  const setupCardDistribution: Record<PlayerId, string[]> = Object.fromEntries(
    humanPlayerIds.map((playerId) => [playerId, []]),
  );
  let nextState: GameState = {
    ...state,
    rng: shuffledDeal.rng,
    decks: {
      ...state.decks,
      "setup-1710": {
        drawPile: [],
        discardPile: shuffledDeal.items.map((card) => card.id),
        removed: removedSetupCards,
      },
    },
  };

  shuffledDeal.items.forEach((card, index) => {
    const playerId = humanPlayerIds[index % humanPlayerIds.length];
    if (!playerId) return;

    setupCardDistribution[playerId] = [...(setupCardDistribution[playerId] ?? []), card.id];
    nextState = applySetupCard(nextState, playerId, card);
  });

  return {
    state: nextState,
    details: {
      setupCardDistribution,
      removedSetupCards,
      note:
        "Random hotseat 1710 setup is implemented. Draft setup and real blackmail deck draws remain TODO; blackmail setup effects create facedown placeholder cards until that deck is encoded.",
    },
  };
}

export function applySetupCard(state: GameState, playerId: PlayerId, card: SetupCardDefinition): GameState {
  return card.effects.reduce(
    (nextState, effect, effectIndex) =>
      applySetupCardEffect(nextState, playerId, card, effect, effectIndex),
    state,
  );
}

function applySetupCardEffect(
  state: GameState,
  playerId: PlayerId,
  card: SetupCardDefinition,
  effect: SetupCardEffect,
  effectIndex: number,
): GameState {
  switch (effect.type) {
    case "cash":
      return updatePlayer(state, playerId, (player) => ({ ...player, cash: player.cash + effect.amount }));
    case "office":
      return placeOffice(state, playerId, effect.officeId);
    case "companyShare":
      return addCompanyShares(state, playerId, effect.count, card.id);
    case "primeMinister":
      return { ...state, parliament: { ...state.parliament, primeMinister: playerId } };
    case "randomBlackmail":
      return drawSetupBlackmail(state, playerId, effect.count);
    case "writer":
      return addWriters(state, playerId, normalizePresidency(effect.presidency), effect.count);
    case "commander":
      return addCommander(state, playerId, normalizePresidency(effect.army));
    case "officersInTraining":
      return updatePlayer(state, playerId, (player) => ({
        ...player,
        familyMembers: {
          ...player.familyMembers,
          supply: player.familyMembers.supply - effect.count,
          officersInTraining: player.familyMembers.officersInTraining + effect.count,
        },
      }));
    case "officer":
      return addOfficers(state, playerId, normalizePresidency(effect.army), effect.count);
    case "shipyard":
      return addEnterprises(state, playerId, "shipyard", effect.count, card.id, effectIndex, effect.ship);
    case "luxury":
      return addEnterprises(state, playerId, "luxury", effect.count, card.id, effectIndex);
    case "workshop":
      return addEnterprises(state, playerId, "workshop", effect.count, card.id, effectIndex);
    case "trophy":
      return updatePlayer(state, playerId, (player) => ({
        ...player,
        trophies: player.trophies + effect.count,
      }));
  }
}

function placeOffice(state: GameState, playerId: PlayerId, officeId: string): GameState {
  const office = state.company.offices[officeId];
  const stateWithOffice: GameState = {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          holder: playerId,
          treasury: office?.treasury ?? 0,
          fatigue: office?.fatigue ?? 0,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: state.company.vacantOffices.filter((candidate) => candidate !== officeId),
      unusedOffices: state.company.unusedOffices.filter((candidate) => candidate !== officeId),
      // The Chairman also takes the Chairman marker (p.15).
      chairmanMarker: officeId === "chairman" ? playerId : state.company.chairmanMarker,
    },
  };

  return takeFromSupply(stateWithOffice, playerId, 1);
}

function addCompanyShares(
  state: GameState,
  playerId: PlayerId,
  count: number,
  sourceCardId: string,
): GameState {
  const existingShareCount = state.company.court.length;
  const shares = Array.from({ length: count }, (_, index) => ({
    id: `setup-share-${sourceCardId}-${index + 1 + existingShareCount}`,
    owner: playerId,
  }));

  return takeFromSupply(
    {
      ...state,
      company: {
        ...state.company,
        court: [...state.company.court, ...shares],
      },
    },
    playerId,
    count,
  );
}

function addWriters(
  state: GameState,
  playerId: PlayerId,
  presidency: PresidencyId,
  count: number,
): GameState {
  const box = state.india.presidencies[presidency];

  return takeFromSupply(
    {
      ...state,
      india: {
        ...state.india,
        presidencies: {
          ...state.india.presidencies,
          [presidency]: {
            ...box,
            writers: { ...box.writers, [playerId]: (box.writers[playerId] ?? 0) + count },
          },
        },
      },
    },
    playerId,
    count,
  );
}

function addCommander(state: GameState, playerId: PlayerId, army: PresidencyId): GameState {
  return takeFromSupply(
    {
      ...state,
      company: {
        ...state.company,
        armies: {
          ...state.company.armies,
          [army]: { ...state.company.armies[army], commander: playerId },
        },
      },
    },
    playerId,
    1,
  );
}

function addOfficers(
  state: GameState,
  playerId: PlayerId,
  army: PresidencyId,
  count: number,
): GameState {
  const current = state.company.armies[army].officers[playerId] ?? { ready: 0, exhausted: 0 };

  return takeFromSupply(
    {
      ...state,
      company: {
        ...state.company,
        armies: {
          ...state.company.armies,
          [army]: {
            ...state.company.armies[army],
            officers: {
              ...state.company.armies[army].officers,
              [playerId]: { ready: current.ready + count, exhausted: current.exhausted },
            },
          },
        },
      },
    },
    playerId,
    count,
  );
}

function takeFromSupply(state: GameState, playerId: PlayerId, count: number): GameState {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count },
  }));
}

function addEnterprises(
  state: GameState,
  playerId: PlayerId,
  type: EnterpriseType,
  count: number,
  sourceCardId: string,
  effectIndex: number,
  ship?: Extract<SetupCardEffect, { type: "shipyard" }>["ship"],
): GameState {
  let nextState = state;

  for (let index = 0; index < count; index += 1) {
    const card = availableEnterpriseCard(nextState, type);
    if (!card) throw new Error(`No ${type} enterprise cards remain for setup.`);

    const instance = {
      id: `setup-${type}-${sourceCardId}-${effectIndex + 1}-${index + 1}`,
      type,
      cardId: card.id,
    };

    nextState = updatePlayer(
      {
        ...nextState,
        company:
          type === "shipyard"
            ? {
                ...nextState.company,
                ships: [
                  ...nextState.company.ships,
                  {
                    id: `ship-${card.id}`,
                    kind: "player",
                    shipyardCardId: card.id,
                    // "Place the matching ship in the indicated sea zone or place on shipyard if unfitted" (p.5).
                    location: ship?.status === "placed" ? ship.seaZone : "shipyard",
                    fatigued: false,
                  },
                ],
              }
            : nextState.company,
      },
      playerId,
      (player) => ({
        ...player,
        victoryPoints: player.victoryPoints + card.victoryPoints,
        enterprises: [...player.enterprises, instance],
      }),
    );
  }

  return nextState;
}

function updatePlayer(
  state: GameState,
  playerId: PlayerId,
  update: (player: PlayerState) => PlayerState,
): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: update(state.players[playerId]),
    },
  };
}

function normalizePresidency(value: string): PresidencyId {
  switch (value) {
    case "bombay":
    case "Bombay":
      return "Bombay";
    case "madras":
    case "Madras":
      return "Madras";
    case "bengal":
    case "Bengal":
      return "Bengal";
    default:
      throw new Error(`Unknown Presidency id "${value}".`);
  }
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const setupCommandHandlers: Record<string, CommandHandler> = {
  "setup.confirmStart": confirmStart,
};
