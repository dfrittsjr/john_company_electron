import { enterpriseDecks, setupCardDecks } from "../../data";
import type { EnterpriseType, SetupCardDefinition, SetupCardEffect } from "../../data";
import { shuffle } from "../rng";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  PendingDecision,
  PlayerId,
  PlayerState,
  PresidencyId,
} from "../types";
import { createFamilyActionCommands } from "./family";
import { createCommandLogEntry } from "./shared";

export function confirmStart(state: GameState, command: GameCommand): ApplyCommandResult {
  const now = command.clientTimestamp;
  const setupDistribution = parseSetupDistribution(state, command.payload);
  const setupResult =
    setupDistribution === "random" && state.mode === "hotseat" && state.scenario === "1710"
      ? applyRandomHotseat1710SetupCards(state)
      : { state, details: undefined };
  const setupState = setupResult.state;
  const nextActor = setupState.seatingOrder.find((playerId) => !setupState.players[playerId].isCrown);

  if (!nextActor) {
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

  const pendingDecision: PendingDecision = {
    id: "decision-family-choose-action-turn-1",
    phase: "family",
    step: "family.chooseAction",
    actor: nextActor,
    visibility: "private",
    prompt: "Choose a family action.",
    legalCommands: createFamilyActionCommands(setupState, nextActor),
    canSave: true,
  };
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

  return {
    ok: true,
    logEntry,
    state: {
      ...setupState,
      updatedAt: now,
      phase: "family",
      pendingDecision,
      log: [...setupState.log, logEntry],
    },
  };
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

function applySetupCard(state: GameState, playerId: PlayerId, card: SetupCardDefinition): GameState {
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
      return addPlaceholderBlackmail(state, playerId, effect.count, card.id);
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
  const presidency = presidencyForOffice(officeId);
  const stateWithOffice: GameState = {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          holder: playerId,
          treasury: state.company.offices[officeId]?.treasury ?? 0,
          fatigue: state.company.offices[officeId]?.fatigue ?? 0,
          vacant: false,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: state.company.vacantOffices.filter((candidate) => candidate !== officeId),
    },
    india: presidency
      ? {
          ...state.india,
          presidencies: {
            ...state.india.presidencies,
            [presidency]: {
              ...state.india.presidencies[presidency],
              president: playerId,
            },
          },
        }
      : state.india,
  };

  return updatePlayer(
    stateWithOffice,
    playerId,
    (player) => ({
      ...player,
      familyMembers: {
        ...player.familyMembers,
        supply: player.familyMembers.supply - 1,
        offices: player.familyMembers.offices.includes(officeId)
          ? player.familyMembers.offices
          : [...player.familyMembers.offices, officeId],
      },
    }),
  );
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

  return updatePlayer(
    {
      ...state,
      company: {
        ...state.company,
        court: [...state.company.court, ...shares],
      },
    },
    playerId,
    (player) => ({
      ...player,
      familyMembers: {
        ...player.familyMembers,
        supply: player.familyMembers.supply - count,
        courtShares: player.familyMembers.courtShares + count,
      },
    }),
  );
}

function addPlaceholderBlackmail(
  state: GameState,
  playerId: PlayerId,
  count: number,
  sourceCardId: string,
): GameState {
  const existingCount = state.players[playerId]?.blackmailCards.length ?? 0;
  const cards = Array.from({ length: count }, (_, index) => ({
    id: `setup-blackmail-${sourceCardId}-${existingCount + index + 1}`,
    cardId: "blackmail-placeholder",
    facedown: true,
  }));

  return updatePlayer(
    {
      ...state,
      hidden: {
        ...state.hidden,
        privateCards: {
          ...state.hidden.privateCards,
          [playerId]: [...(state.hidden.privateCards[playerId] ?? []), ...cards],
        },
      },
    },
    playerId,
    (player) => ({
      ...player,
      blackmailCards: [...player.blackmailCards, ...cards],
    }),
  );
}

function addWriters(
  state: GameState,
  playerId: PlayerId,
  presidency: PresidencyId,
  count: number,
): GameState {
  return updatePlayer(
    {
      ...state,
      india: {
        ...state.india,
        presidencies: {
          ...state.india.presidencies,
          [presidency]: {
            ...state.india.presidencies[presidency],
            writers: {
              ...state.india.presidencies[presidency].writers,
              [playerId]: (state.india.presidencies[presidency].writers[playerId] ?? 0) + count,
            },
          },
        },
      },
    },
    playerId,
    (player) => ({
      ...player,
      familyMembers: {
        ...player.familyMembers,
        supply: player.familyMembers.supply - count,
        writers: {
          ...player.familyMembers.writers,
          [presidency]: player.familyMembers.writers[presidency] + count,
        },
      },
    }),
  );
}

function addCommander(state: GameState, playerId: PlayerId, army: PresidencyId): GameState {
  return updatePlayer(
    {
      ...state,
      company: {
        ...state.company,
        armies: {
          ...state.company.armies,
          [army]: {
            ...state.company.armies[army],
            commander: playerId,
          },
        },
      },
    },
    playerId,
    (player) => ({
      ...player,
      familyMembers: {
        ...player.familyMembers,
        supply: player.familyMembers.supply - 1,
        commanders: {
          ...player.familyMembers.commanders,
          [army]: true,
        },
      },
    }),
  );
}

function addOfficers(
  state: GameState,
  playerId: PlayerId,
  army: PresidencyId,
  count: number,
): GameState {
  return updatePlayer(
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
              [playerId]: {
                ready: (state.company.armies[army].officers[playerId]?.ready ?? 0) + count,
                exhausted: state.company.armies[army].officers[playerId]?.exhausted ?? 0,
              },
            },
          },
        },
      },
    },
    playerId,
    (player) => ({
      ...player,
      familyMembers: {
        ...player.familyMembers,
        supply: player.familyMembers.supply - count,
        officers: {
          ...player.familyMembers.officers,
          [army]: {
            ready: player.familyMembers.officers[army].ready + count,
            exhausted: player.familyMembers.officers[army].exhausted,
          },
        },
      },
    }),
  );
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
    const card = nextEnterpriseCard(nextState, type);
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
          type === "shipyard" && ship?.status === "placed"
            ? {
                ...nextState.company,
                ships: [
                  ...nextState.company.ships,
                  {
                    id: `ship-${card.id}`,
                    owner: playerId,
                    location: ship.seaZone,
                    exhausted: false,
                  },
                ],
              }
            : nextState.company,
      },
      playerId,
      (player) => ({
        ...player,
        victoryPoints: player.victoryPoints + card.victoryPoints,
        windows: player.windows + card.windowTaxIcons,
        enterprises: [...player.enterprises, instance],
      }),
    );
  }

  return nextState;
}

function nextEnterpriseCard(state: GameState, type: EnterpriseType) {
  const deck = enterpriseDecks.find((candidate) => candidate.type === type);
  if (!deck) return undefined;

  const ownedCount = Object.values(state.players).reduce(
    (count, player) =>
      count + player.enterprises.filter((enterprise) => enterprise.type === type).length,
    0,
  );

  return deck.cards[ownedCount];
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

function presidencyForOffice(officeId: string): PresidencyId | undefined {
  switch (officeId) {
    case "president-bombay":
      return "Bombay";
    case "president-madras":
      return "Madras";
    case "president-bengal":
      return "Bengal";
    default:
      return undefined;
  }
}
