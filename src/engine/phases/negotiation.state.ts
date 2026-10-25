import { promiseCardTypes, type PromiseCardId } from "../../data";
import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { PendingDecision, PhaseId, PlayerId } from "../types";

/** One physical promise card. Each family owns five, one of each type (p.8). */
export type PromiseCardState = {
  id: string;
  type: PromiseCardId;
  /** The family whose name is on the card ("Guaranteed by the ... Family"). */
  guarantor: PlayerId;
  /** Who currently holds it; equal to the guarantor while it is in their own hand. */
  holder: PlayerId;
  /** Lady Newcome removes her family's "Vote with my enterprises" card from the game. */
  removedFromGame: boolean;
};

/**
 * A called-in promise whose effect lasts for the rest of its timing window. Other areas read these
 * through the selectors in negotiation.ts (nepotism consent, enterprise votes, London Season picks).
 */
export type PromiseGrant = {
  id: string;
  type: PromiseCardId;
  holder: PlayerId;
  guarantor: PlayerId;
  turn: number;
  phase: PhaseId;
  used: boolean;
};

/** Cash an officeholder earned this turn, recorded by Company Operation for "Take my officeholder's bonus". */
export type OfficeholderBonusRecord = {
  turn: number;
  officeId: string;
  playerId: PlayerId;
  amount: number;
  taken: boolean;
};

/** Golden rule (p.8): something transferred cannot activate twice. Keyed by asset id. */
export type AssetEvent = {
  turn: number;
  phase: PhaseId;
  assetId: string;
  /** For transfers: the player who gave the asset away. */
  from?: PlayerId;
};

/** Everything that can change hands in a binding immediate transfer (p.8). */
export type TransferItem =
  | { kind: "cash"; amount: number }
  | { kind: "enterprise"; enterpriseId: string }
  | { kind: "prestige"; cardInstanceId: string }
  | { kind: "blackmail"; cardInstanceId: string }
  | { kind: "share"; shareId: string; fromPrizeId?: string }
  | { kind: "promise"; promiseId: string };

export type ConsentRequest = {
  id: string;
  /** Resolver key registered with registerConsentResolver. */
  kind: string;
  requestedBy: PlayerId | "system";
  /** Players asked in order; every one must consent. */
  askOrder: PlayerId[];
  answers: Record<PlayerId, boolean>;
  prompt: string;
  /** Serializable data the resolver needs. */
  context: unknown;
};

export type PromiseCall = {
  id: string;
  promiseId: string;
  holder: PlayerId;
  /** Cash the guarantor owes (Take £2 or less, Take my officeholder's bonus). */
  amount: number;
  officeId?: string;
};

export type BlackmailPlay = {
  id: string;
  playerId: PlayerId;
  cardInstanceId: string;
  cardId: string;
  params: Record<string, unknown>;
  /** Key registered with registerBlackmailResume; omitted for anytime plays. */
  resumeKey?: string;
};

/** A response another player owes before the interrupted decision continues. */
export type InterruptFrame = {
  id: string;
  savedDecision: PendingDecision;
} & (
  | { kind: "consent"; request: ConsentRequest }
  | { kind: "blackmailReaction"; play: BlackmailPlay; reactor: PlayerId }
  | { kind: "promiseChoice"; guarantor: PlayerId; calls: PromiseCall[] }
);

/** State owned by Negotiation: promise cards, transfers and consent requests between players (p.8). */
export type NegotiationState = {
  promiseCards: PromiseCardState[];
  promiseGrants: PromiseGrant[];
  officeholderBonuses: OfficeholderBonusRecord[];
  activations: AssetEvent[];
  transfers: AssetEvent[];
  interrupts: InterruptFrame[];
  /** Counter for unique ids of requests, calls and plays. */
  sequence: number;
};

export function promiseCardId(guarantor: PlayerId, type: PromiseCardId): string {
  return `promise-${guarantor}-${type}`;
}

export function createInitialNegotiationState(input: SubsystemInitInput): SubsystemInitResult<NegotiationState> {
  // The Crown uses promise cubes instead of promise cards (p.43).
  const families = input.seatingOrder.filter((playerId) => playerId !== "crown");

  return {
    state: {
      promiseCards: families.flatMap((guarantor) =>
        promiseCardTypes.map((type) => ({
          id: promiseCardId(guarantor, type.id),
          type: type.id,
          guarantor,
          holder: guarantor,
          removedFromGame: false,
        })),
      ),
      promiseGrants: [],
      officeholderBonuses: [],
      activations: [],
      transfers: [],
      interrupts: [],
      sequence: 0,
    },
    rng: input.rng,
  };
}
