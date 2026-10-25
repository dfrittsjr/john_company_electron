import { enterpriseDecks, prestigeCards, prizes } from "../../../data";
import type { EnterpriseCardDefinition, PrestigeCard } from "../../../data";
import { chairmanHolder } from "../../selectors";
import type { EnterpriseInstance, GameState, PlayerId } from "../../types";
import type { PolicyTarget } from "../parliament.state";
import { updatePlayer } from "./common";
import { vacateOffice } from "../../offices";

/** Something a policy taxes: an enterprise, a Company share, or a family member on a prize. */
export type TaxedItem = {
  id: string;
  label: string;
  windowIcons: number;
};

const ENTERPRISE_TARGET: Record<EnterpriseInstance["type"], PolicyTarget> = {
  shipyard: "shipping",
  workshop: "manufacturing",
  luxury: "social",
};

export function enterpriseCard(cardId: string | undefined): EnterpriseCardDefinition | undefined {
  if (!cardId) return undefined;
  for (const deck of enterpriseDecks) {
    const card = deck.cards.find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  return undefined;
}

export function prestigeCard(cardId: string): PrestigeCard | undefined {
  return prestigeCards.find((card) => card.id === cardId);
}

export function ownsPrestigeCard(state: GameState, playerId: PlayerId, cardId: string): boolean {
  return state.players[playerId]?.prestigeCards.some((card) => card.cardId === cardId) ?? false;
}

/** Players owning a prestige card, in seating order. */
export function prestigeCardOwners(state: GameState, cardId: string): PlayerId[] {
  return state.seatingOrder.filter((playerId) => ownsPrestigeCard(state, playerId, cardId));
}

/** The targets a policy names that this player owns (p.34): enterprises of a type, or Company shares. */
export function policyTargetItems(state: GameState, playerId: PlayerId, target: PolicyTarget): TaxedItem[] {
  const player = state.players[playerId];
  if (!player) return [];

  if (target === "companyShare") {
    const shares: TaxedItem[] = state.company.court
      .filter((share) => share.owner === playerId)
      .map((share) => ({ id: `court:${share.id}`, label: "Company share in the Court", windowIcons: 0 }));
    if (chairmanHolder(state) === playerId) {
      shares.push({ id: "chairman", label: "Chairman (Company share)", windowIcons: 0 });
    }
    return shares;
  }

  const enterprises: TaxedItem[] = player.enterprises
    .filter((enterprise) => ENTERPRISE_TARGET[enterprise.type] === target)
    .map((enterprise) => {
      const card = enterpriseCard(enterprise.cardId);
      return {
        id: `enterprise:${enterprise.id}`,
        label: card ? `${card.label} (${enterprise.type})` : enterprise.type,
        windowIcons: card?.windowTaxIcons ?? 0,
      };
    });
  const prestige: TaxedItem[] = player.prestigeCards
    .map((instance) => ({ instance, card: prestigeCard(instance.cardId) }))
    .filter(({ card }) => card?.enterpriseType === target)
    .map(({ instance, card }) => ({
      id: `prestige:${instance.id}`,
      label: `${card!.name} (prestige enterprise)`,
      windowIcons: card!.windowTaxIcons,
    }));

  return [...enterprises, ...prestige];
}

/** Everything that carries window icons: family members on prizes and enterprises (p.34). */
export function windowTaxItems(state: GameState, playerId: PlayerId): TaxedItem[] {
  const player = state.players[playerId];
  if (!player) return [];

  const onPrizes: TaxedItem[] = Object.entries(player.familyMembers.prizes).flatMap(([prizeId, count]) => {
    const prize = prizes.find((candidate) => candidate.id === prizeId);
    const windows = prize?.windowTaxIcons ?? 0;
    return Array.from({ length: count }, (_, index) => ({
      id: `prize:${prizeId}:${index + 1}`,
      label: `Family member on the £${prize?.cost ?? "?"} prize`,
      windowIcons: windows,
    }));
  });
  const enterprises = (["social", "shipping", "manufacturing"] as const).flatMap((target) =>
    policyTargetItems(state, playerId, target),
  );

  return [...onPrizes, ...enterprises].filter((item) => item.windowIcons > 0);
}

/** Window icons a player has: prizes, enterprises and prestige cards (used for tie breaks, p.9, p.12). */
export function playerWindowIcons(state: GameState, playerId: PlayerId): number {
  return windowTaxItems(state, playerId).reduce((total, item) => total + item.windowIcons, 0);
}

/**
 * Returns a taxed item to its supply because its owner could not pay (p.34). Luxuries and prizes
 * take their victory points with them. A fitted ship stays in play when its shipyard is returned;
 * an unfitted ship goes back with the card.
 */
export function surrenderItem(state: GameState, playerId: PlayerId, itemId: string): GameState {
  if (itemId === "chairman") {
    return vacateOffice(state, "chairman", "supply").state;
  }

  if (itemId.startsWith("court:")) {
    const shareId = itemId.slice("court:".length);
    const withoutShare: GameState = {
      ...state,
      company: { ...state.company, court: state.company.court.filter((share) => share.id !== shareId) },
    };
    return updatePlayer(withoutShare, playerId, (player) => ({
      ...player,
      familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 },
    }));
  }

  if (itemId.startsWith("prize:")) {
    const prizeId = itemId.split(":")[1];
    const prize = prizes.find((candidate) => candidate.id === prizeId);
    return updatePlayer(state, playerId, (player) => {
      const onPrize = player.familyMembers.prizes[prizeId] ?? 0;
      if (onPrize <= 0) return player;
      return {
        ...player,
        // Assumption: like unpaid upkeep (p.36), the family loses the prize's victory points.
        victoryPoints: player.victoryPoints - (prize?.victoryPoints ?? 0),
        familyMembers: {
          ...player.familyMembers,
          supply: player.familyMembers.supply + 1,
          prizes: { ...player.familyMembers.prizes, [prizeId]: onPrize - 1 },
        },
      };
    });
  }

  if (itemId.startsWith("enterprise:")) {
    const instanceId = itemId.slice("enterprise:".length);
    const enterprise = state.players[playerId]?.enterprises.find((candidate) => candidate.id === instanceId);
    if (!enterprise) return state;
    const card = enterpriseCard(enterprise.cardId);
    const withoutCard = updatePlayer(state, playerId, (player) => ({
      ...player,
      victoryPoints: player.victoryPoints - (card?.victoryPoints ?? 0),
      enterprises: player.enterprises.filter((candidate) => candidate.id !== instanceId),
    }));
    if (enterprise.type !== "shipyard") return withoutCard;

    return {
      ...withoutCard,
      company: {
        ...withoutCard.company,
        ships: withoutCard.company.ships.filter(
          (ship) => !(ship.kind === "player" && ship.shipyardCardId === enterprise.cardId && ship.location === "shipyard"),
        ),
      },
    };
  }

  if (itemId.startsWith("prestige:")) {
    const instanceId = itemId.slice("prestige:".length);
    // A returned prestige enterprise goes to the London Season discards.
    const cardId = state.players[playerId].prestigeCards.find((card) => card.id === instanceId)?.cardId;
    const returned = updatePlayer(state, playerId, (player) => ({
      ...player,
      prestigeCards: player.prestigeCards.filter((card) => card.id !== instanceId),
    }));
    return cardId
      ? { ...returned, londonSeason: { ...returned.londonSeason, discard: [...returned.londonSeason.discard, cardId] } }
      : returned;
  }

  return state;
}
