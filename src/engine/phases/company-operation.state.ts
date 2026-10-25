import type { CheckOutcome } from "../checks";
import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { ArmyId, FirmId, OfficeId, PlayerId, PresidencyId, RegionId, SeaZoneId } from "../types";

/**
 * State owned by Company Operation (rulebook pp.17-26): progress through the red-ribbon offices
 * and any office action in flight. Everything is keyed to `turn`; data left over from an earlier
 * turn is ignored, so the phase starts fresh each turn without other phases resetting it.
 */
export type CompanyOperationState = {
  turn?: number;
  /** Red-ribbon offices that have finished acting this turn. */
  actedOffices?: OfficeId[];
  current?: OfficeProgress;
  /** A decision that interrupts the current office: a reaction, consent, or law trigger. */
  interrupt?: OperationInterrupt;
  /** One Trade (p.20): Presidencies that have traded successfully this turn. */
  tradedPresidencies?: PresidencyId[];
  /** The Superintendent may attempt Trade in China once per turn (p.25). */
  chinaTradeAttempted?: boolean;
  /** One Govern (p.26). */
  governorGeneralGoverned?: boolean;
  /** Board of Control may be used once per turn (law #34). */
  boardOfControlUsed?: boolean;
  /** Deregulation (p.40): firms that have already filled their orders this turn. */
  firmsFilled?: FirmId[];
  /** Deregulation (p.40): the order-filling round for one Presidency, in progress. */
  firmFill?: FirmFillState;
  /** A Connection blackmail was played on this check and waits for Man on the Inside to answer. */
  pendingConnection?: { cardId: "mercantile-connection" | "diplomatic-connection"; holder: PlayerId; check: PendingCheck };
};

/**
 * Filling orders with firms (p.40): firms with an initiative, and the Company if its President's Trade
 * succeeded, fill in initiative order. The Company's placement waits in `company.activity` for its turn.
 */
export type FirmFillState = {
  presidency: PresidencyId;
  company?: { initiative: number; activity: TradeActivity; started: boolean };
  /** The firm now choosing orders. */
  current?: { firmId: FirmId; orderIds: string[] };
  /** The firms fill at the end of the Presidency's operations (no successful Trade): finish the office after. */
  finishesOffice: boolean;
};

export type ShipDestination = SeaZoneId | "china";

export type OfficeProgress =
  | { office: "chairman"; debtAdvances: number; consentRefused: boolean }
  | {
      office: "director-of-trade";
      stage: "envoy" | "envoyEffect" | "transfers";
      transfersMade: number;
    }
  | {
      office: "military-affairs";
      stage: "transfers" | "assign" | "commanders";
      transfersMade: number;
      armiesResolved: ArmyId[];
    }
  | { office: "presidency"; presidency: PresidencyId; commanderDone: boolean; governorsDone: OfficeId[]; activity?: PresidencyActivity }
  | {
      office: "governor-general";
      stage: "begin" | "govern" | "choices" | "taxTarget" | "taxUnrest";
      choicesRemaining: number;
      taxRegions: RegionId[];
    };

export type PresidencyActivity = TradeActivity | CommanderActivity | GovernorActivity;

export type TradeActivity = {
  kind: "trade";
  stage: "declare" | "place";
  declared: RegionId[];
  /** Ships in the Presidency's sea zone when the check succeeded: one order each. */
  ships: number;
  placedOrderIds: string[];
  /** £ each placed order is worth: half value for an order a firm filled first (p.40). Defaults to the printed value. */
  placedValues?: number[];
};

export type DeploySelection = {
  officers: Record<PlayerId, number>;
  regiments: number;
  alliances: string[];
};

export type CommanderActivity = {
  kind: "commander";
  stage: "alliances" | "deploy" | "exhaust";
  target?: RegionId;
  selection?: DeploySelection;
  /** Deploys rolled so far (the Crown's "deploy again?" chart reads it). */
  deploys?: number;
  /** Local Alliance purchases asked for so far (the Crown buys at most one, or two with a favour). */
  alliancesAsked?: number;
};

export type GovernorActivity = {
  kind: "governor";
  officeId: OfficeId;
  dicePool: number;
  /** Result of this Governor's previous Administer roll this turn, if any. */
  lastRollSucceeded?: boolean;
  taxes: number;
  /** A successful Administer check is waiting for its effect to be chosen. */
  awaitingChoice: boolean;
};

export type PendingCheck =
  | { context: "trade"; presidency: PresidencyId; dice: number; values: number[]; outcome: CheckOutcome }
  | { context: "firmTrade"; presidency: PresidencyId; firmId: FirmId; dice: number; values: number[]; outcome: CheckOutcome }
  | {
      context: "deploy";
      presidency: PresidencyId;
      target: RegionId;
      selection: DeploySelection;
      dice: number;
      values: number[];
      outcome: CheckOutcome;
    };

export type OperationInterrupt =
  | {
      kind: "debtConsent";
      /** Shareholders still to be asked, in order from the Chairman's left (p.18). */
      pending?: PlayerId[];
      /** Company shares whose owners have consented so far (the Chairman's own count). */
      consenting?: number;
      /** Company shares whose owners have refused so far. */
      refusing?: number;
    }
  | {
      kind: "connection";
      cardId: "mercantile-connection" | "diplomatic-connection";
      holder: PlayerId;
      check: PendingCheck;
    }
  | { kind: "allianceConsent"; presidency: PresidencyId; allianceId: string }
  | { kind: "boardOfControl"; officeId: OfficeId }
  | { kind: "militaryOversight"; stage: "demote" }
  | { kind: "militaryOversight"; stage: "appoint"; army: ArmyId; selfRefused?: boolean }
  | {
      kind: "militaryOversight";
      stage: "nepotism";
      army: ArmyId;
      candidate: PlayerId;
      /** Families still to be asked for Nepotism consent, in order from the Prime Minister's left (p.14). */
      pending: PlayerId[];
    };

export function createInitialCompanyOperationState(
  input: SubsystemInitInput,
): SubsystemInitResult<CompanyOperationState> {
  return { state: {}, rng: input.rng };
}
