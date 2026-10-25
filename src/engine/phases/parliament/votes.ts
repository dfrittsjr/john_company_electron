import { enterpriseVoteGuarantors } from "../negotiation";
import { policyDial } from "../../../data";
import type { GameState, PlayerId } from "../../types";
import type { ParliamentSession } from "../parliament.state";
import { enterpriseCard, ownsPrestigeCard, prestigeCard } from "./holdings";
import { isLawPassed } from "./laws";

/** A card in a play area that can be rotated to cast its vote icons (p.35). */
export type VoteCardSource = {
  key: string;
  ownerId: PlayerId;
  cardInstanceId: string;
  label: string;
  votes: number;
};

export function cardKey(ownerId: PlayerId, cardInstanceId: string): string {
  return `${ownerId}:${cardInstanceId}`;
}

/** Lady Newcome: "Act as if your enterprises no longer have vote icons." */
function enterprisesHaveNoVotes(state: GameState, playerId: PlayerId): boolean {
  return ownsPrestigeCard(state, playerId, "lady-newcome");
}

/** Vote-bearing cards in one player's area, given the policy being voted on. */
export function ownedVoteCards(state: GameState, ownerId: PlayerId, session: ParliamentSession): VoteCardSource[] {
  const owner = state.players[ownerId];
  if (!owner) return [];
  const noEnterpriseVotes = enterprisesHaveNoVotes(state, ownerId);
  const target = session.policySpace === undefined ? undefined : policyDial.spaces[session.policySpace]?.target;
  const rottenBoroughVotes = isLawPassed(state, "masses-demand-franchise") ? 1 : 3;
  const sources: VoteCardSource[] = [];

  if (!noEnterpriseVotes) {
    for (const enterprise of owner.enterprises) {
      const votes = enterpriseCard(enterprise.cardId)?.parliamentVotes ?? 0;
      if (votes > 0) {
        sources.push({
          key: cardKey(ownerId, enterprise.id),
          ownerId,
          cardInstanceId: enterprise.id,
          label: enterpriseCard(enterprise.cardId)?.label ?? enterprise.type,
          votes,
        });
      }
    }
  }

  for (const instance of owner.prestigeCards) {
    const card = prestigeCard(instance.cardId);
    if (!card) continue;
    if (card.enterpriseType && noEnterpriseVotes) continue;

    let votes = card.id.startsWith("rotten-borough") ? rottenBoroughVotes : card.votes;
    for (const effect of card.effects) {
      if (effect.type === "conditionalVotes" && target && effect.policyTargets.includes(target)) {
        votes += effect.votes;
      }
    }
    if (votes > 0) {
      sources.push({ key: cardKey(ownerId, instance.id), ownerId, cardInstanceId: instance.id, label: card.name, votes });
    }
  }

  return sources;
}

/**
 * Cards a voter may rotate: their own, plus the enterprises of anyone whose "Vote with my
 * enterprises as if you owned them" promise they have called in this session.
 */
export function availableVoteCards(state: GameState, voterId: PlayerId, session: ParliamentSession): VoteCardSource[] {
  // Lent through grantEnterpriseVotes, or through the promise called in with Negotiation this phase.
  const lenders = [...new Set([...(session.borrowedEnterprises[voterId] ?? []), ...enterpriseVoteGuarantors(state, voterId)])];
  const borrowed = lenders.flatMap((lenderId) =>
    ownedVoteCards(state, lenderId, session).filter((source) => {
      const lender = state.players[lenderId];
      // Only the lender's enterprises are lent, not spouses or other cards.
      const isEnterprise =
        lender?.enterprises.some((enterprise) => enterprise.id === source.cardInstanceId) ||
        Boolean(
          prestigeCard(lender?.prestigeCards.find((card) => card.id === source.cardInstanceId)?.cardId ?? "")
            ?.enterpriseType,
        );
      return isEnterprise;
    }),
  );

  return [...ownedVoteCards(state, voterId, session), ...borrowed].filter(
    (source) => !session.usedCards.includes(source.key),
  );
}
