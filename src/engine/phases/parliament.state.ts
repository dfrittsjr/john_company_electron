import type { TileWorkItem } from "./events-in-india.state";
import { lawDeckForScenario, policyDial, powerTrack, startingPassedLaws } from "../../data";
import { shuffle } from "../rng";
import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { LawInstance, PlayerId } from "../types";

/** A Power track marker or Policy target (board-components PowerTargetId). */
export type PolicyTarget = "social" | "companyShare" | "shipping" | "manufacturing";

/**
 * One step of resolving a vote (rulebook pp.34-36). Steps run in order; a step that needs a
 * player's choice stays at the head of the queue until that choice is made.
 */
export type ParliamentResolutionStep =
  | { kind: "policy"; space: number; actor?: PlayerId; extraWindowTax: boolean }
  | { kind: "tax"; target: PolicyTarget; players: PlayerId[] }
  | { kind: "windowTax"; players: PlayerId[]; exemptFromRepeal: boolean }
  | { kind: "bonus"; target: PolicyTarget }
  | { kind: "power"; target: PolicyTarget; actor?: PlayerId }
  | { kind: "lawPassed"; lawId: string }
  | { kind: "lawFailed"; lawId: string }
  | { kind: "impeach"; officeId: string }
  | { kind: "warShips"; remaining: number }
  | { kind: "warPieces"; remaining: number }
  | { kind: "changePrimeMinister" }
  | { kind: "movePolicyAfterFailure"; taxCollectorsMayAdd: boolean }
  | { kind: "hireImmediately"; officeId: string }
  | { kind: "indiaEffects"; label: string; work: TileWorkItem[] }
  | { kind: "finish" };

export type ParliamentStage =
  | "chooseLaw"
  | "chooseFromDiscard"
  | "choosePolicy"
  | "chooseImpeachmentTarget"
  | "taxCollectorsOffer"
  | "taxCollectorsConsent"
  | "voting"
  | "continueVoting"
  | "resolving";

export type ParliamentVoteTally = {
  for: number;
  against: number;
  /** Votes against credited to this player for the Opposition Leader, including coalition votes. */
  credited: number;
};

/** In-flight Parliament Meets session; cleared when the phase ends. */
export type ParliamentSession = {
  stage: ParliamentStage;
  /** Laws revealed this session, in draw order. */
  drawn: string[];
  /** Old Ideas Made New! was drawn: drawn cards stay aside and everything is reshuffled at the end. */
  oldIdeasMadeNew: boolean;
  /** The law being voted on. */
  lawId?: string;
  policySpace?: number;
  startingSupport: number;
  impeachmentOfficeId?: string;
  /** Tax Collectors added a window tax to the proposed policy (with the Prime Minister's consent). */
  extraWindowTax: boolean;
  /** Tax Collectors owners who have already been offered the chance to add a window tax. */
  taxCollectorsOffered: PlayerId[];
  taxCollectorsProposer?: PlayerId;
  votingOrder: PlayerId[];
  voterIndex: number;
  round: number;
  votesThisRound: number;
  votes: Record<PlayerId, ParliamentVoteTally>;
  /** Players who have voted against (or committed to); they may not vote for this law. */
  opposition: PlayerId[];
  /** Coalitions: whom a voter's votes against are credited to (p.35). */
  creditTo: Record<PlayerId, PlayerId>;
  /** Coalition requests a partner refused this law, as `${voter}>${partner}` (they are not asked again). */
  coalitionRefused?: string[];
  /** "Vote with my enterprises as if you owned them": beneficiary -> guarantors. */
  borrowedEnterprises: Record<PlayerId, PlayerId[]>;
  /** Cards rotated to vote this session, as `${ownerId}:${cardInstanceId}`. */
  usedCards: string[];
  outcome?: "passed" | "failed";
  /** The Vote to Deregulate special session (p.36): no policy, the Prime Minister may vote against. */
  special?: "deregulation";
  queue: ParliamentResolutionStep[];
  /** An office a law created is being hired at once; resume the queue when it is filled (p.25). */
  awaitingHire?: boolean;
  /** A law's India effects are being resolved through Events in India; resume the queue after. */
  awaitingIndia?: boolean;
};

export type RevenueStage = "companyFraud" | "firms" | "royalProtection" | "dividends" | "scandal";

/**
 * Firm expenses and dividends at the start of Revenue (pp.41-42), one firm at a time. The head of
 * `queue` is the firm being settled. See phases/revenue-firms.ts.
 */
export type FirmRevenueProgress = {
  queue: string[];
  /** What the head firm is waiting for. */
  step: "start" | "payFrom" | "rescue" | "investAsk" | "mergeConsent" | "dividends" | "waiver";
  /** Firms whose expenses are paid this Revenue (an emergency merger needs to know, p.41). */
  paid: string[];
  /** Cash from emergency investments in the head firm: spent first on expenses, the rest is lost. */
  emergencyCash: number;
  /** Investors who declined to invest in the head firm (`${player}:${kind}`); not asked again. */
  declined: string[];
  /** An emergency investment the manager asked this player for. */
  ask?: { investor: PlayerId; source: { kind: "companyShare"; shareId: string } | { kind: "workshop"; enterpriseId: string } };
  /** An emergency merger being put to every shareholder of both firms. */
  merge?: { other: string; primary: string; askers: PlayerId[] };
  /** Other firms whose shareholders refused a merger with the head firm. */
  mergeRefused: string[];
  /** Dividends paid so far this Revenue by the head firm. */
  dividendsPaid: number;
  /** £ paid out so far by the head firm (the dividend cube). */
  cashPaid: number;
  /** A dividend being set up: holders still to be asked and what each forgoes. */
  waivers?: { holders: PlayerId[]; forgone: Record<PlayerId, number> };
};

/** In-flight Revenue phase choices (Revenue's rules live with the Parliament area). */
export type RevenueProgress = {
  stage: RevenueStage;
  /** Players still to be offered a start-of-Revenue blackmail (Company Fraud). */
  fraudCandidates: PlayerId[];
  /** Players still to be offered an after-Revenue blackmail (the Scandal cards). */
  scandalCandidates: PlayerId[];
  /** Firm expenses and dividends in progress (pp.41-42). */
  firms?: FirmRevenueProgress;
  /** Set once the firms have settled, so they are not started again. */
  firmsSettled?: boolean;
};

export type ParliamentState = {
  primeMinister?: PlayerId;
  /** Index into policyDial.spaces: where the Prime Minister dial's arm points. */
  policyDialPosition: number;
  lawDeck: { drawPile: string[]; discardPile: string[] };
  /** Support for the current law (the Votes marker); may run past either end of the track. */
  voteMarker: number;
  currentVotingRound: number;
  /** Holder of the Opposition Leader marker; it persists between votes until used (p.35-36). */
  oppositionLeader?: PlayerId;
  votesByPlayer: Record<PlayerId, { for: number; against: number }>;
  passedLaws: LawInstance[];
  deregulated: boolean;
  session?: ParliamentSession;
  revenue?: RevenueProgress;
};

export function lawInstance(lawId: string): LawInstance {
  return { id: `law-${lawId}`, lawId };
}

/** Power values per marker at setup (rulebook p.4 step 5; board Power track). */
export function initialPowerTrack(): Record<PolicyTarget, number> {
  const powerAt = (position: string) =>
    powerTrack.positions.find((candidate) => candidate.id === position)?.power ?? 0;

  return {
    social: powerAt(powerTrack.startingPositions.social),
    companyShare: powerAt(powerTrack.startingPositions.companyShare),
    shipping: powerAt(powerTrack.startingPositions.shipping),
    manufacturing: powerAt(powerTrack.startingPositions.manufacturing),
  };
}

export function createInitialParliamentState(
  input: SubsystemInitInput,
): SubsystemInitResult<ParliamentState> {
  const deck = shuffle(input.rng, lawDeckForScenario(input.scenario.id));

  return {
    state: {
      // Setup cards assign the Prime Minister (p.5); until then the first seat holds the dial.
      primeMinister: input.seatingOrder[0],
      policyDialPosition: policyDial.startingSpaceByScenario[input.scenario.id] ?? 0,
      lawDeck: { drawPile: deck.items, discardPile: [] },
      voteMarker: 0,
      currentVotingRound: 0,
      votesByPlayer: {},
      passedLaws: startingPassedLaws(input.scenario.id).map(lawInstance),
      deregulated: input.scenario.startsDeregulated,
    },
    rng: deck.rng,
  };
}
