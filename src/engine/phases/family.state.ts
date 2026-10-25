import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { FamilyActionId, PlayerId } from "../types";

/** Optional follow-ups a player may get after their main Family action (p.13). */
export type FamilyTurnStage =
  | "extraWriterAfterMain"
  | "repeat"
  | "extraWriterAfterRepeat"
  | "lawExtraAction";

export type FamilyTurnState = {
  playerId: PlayerId;
  /** Where the opportunity marker stood when the turn began; it decides the double action (p.13). */
  markerAtStart: FamilyActionId | "supply" | "removed";
  mainAction?: FamilyActionId;
  repeatAction?: FamilyActionId;
  /** Follow-up stages already offered and resolved (taken or declined) this turn. */
  resolvedStages: FamilyTurnStage[];
  /** The follow-up stage the pending decision belongs to. */
  currentStage?: FamilyTurnStage;
  /** A Seek Share waiting for the Stock Broker owner's permission. */
  stockBrokerRequest?: {
    slotId: string;
    owner: PlayerId;
    stage: "main" | "repeat" | "lawExtraAction";
    fromPrize?: string;
  };
};

/** State owned by the Family phase: turn order and in-progress turns (rulebook pp.13-14). */
export type FamilyState = {
  /** Clockwise from the player with the Chairman title, fixed when the phase starts (p.13). */
  order: PlayerId[];
  index: number;
  /** Players who placed their extra writer for four or more vacant offices this turn (p.13). */
  extraWriterUsedBy: PlayerId[];
  /** Players whose request to use another family's Stock Broker was refused this phase. */
  stockBrokerRefused: PlayerId[];
  turn?: FamilyTurnState;
};

export function createInitialFamilyState(input: SubsystemInitInput): SubsystemInitResult<FamilyState> {
  return {
    state: { order: [], index: 0, extraWriterUsedBy: [], stockBrokerRefused: [] },
    rng: input.rng,
  };
}
