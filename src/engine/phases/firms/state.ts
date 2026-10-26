import type { FirmId, PlayerId } from "../../types";

// State of the Firms phase (rulebook pp.38-40). Present from startFirmsPhase until Hiring begins.

/** A merger being put together before its consent request (p.39). */
export type MergeDraft = {
  initiator: PlayerId;
  /** Every firm in the merger, the initiator's own first. */
  firmIds: FirmId[];
  /** Chosen (or the only highest-Value firm) once known. */
  primaryId?: FirmId;
  /** Excess shares to return to their owners' supply, per owner (p.39). */
  returned: Record<PlayerId, number>;
};

export type FirmsPhaseState = {
  /** Firm Investments (p.38) or Firm Strategy (p.40). */
  step: "investments" | "strategy";
  /**
   * Investments: every human player in Prime Minister order. Strategy: the firm managers in that
   * order. Rounds are walked in this order (docs/phases/deregulation.md, ruling 2).
   */
  order: PlayerId[];
  /** Whose turn it is, as an index into `order`. */
  index: number;
  /** Turns in a row that were a pass, an automatic pass or a refused request. Ends the step at `order.length`. */
  passes: number;
  merge?: MergeDraft;
  /** The Crown's one investment (Crown Handbook p.3) has been offered; it comes after every player has finished. */
  crownActed?: boolean;
};
