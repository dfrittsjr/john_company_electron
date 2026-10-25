import { indiaEventTiles } from "../../data";
import type { ElephantShape } from "../../data/india-events";
import { shuffle } from "../rng";
import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { ArmyId, OfficeId, PhaseId, PlayerId, RegionId } from "../types";

/** An attack against the Company (rulebook p.32). */
export type CompanyAttack = {
  regionId: RegionId;
  strength: number;
  primary: boolean;
  crisisKind: "invasion" | "rebellion" | "foreignInvasion";
  /** The sovereign invader of an Invasion Crisis; the empire rules apply to it afterwards. */
  attackerRegionId?: RegionId;
  /** Foreign Invasion strength die: a lost region's strength becomes half of it (p.33). */
  foreignRoll?: number;
};

/** An attack whose defence is being mounted. */
export type ActiveCompanyAttack = {
  attack: CompanyAttack;
  army?: ArmyId;
  /** Pieces the Army must exhaust: the attack's strength, never below zero. */
  needed: number;
  exhausted: number;
  /** Who chooses the pieces: the Commander, else Military Affairs, else the Chairman (p.32). */
  actor?: PlayerId;
  /** The real Commander, who gains or loses trophies. Undefined when someone acts in its stead. */
  commander?: PlayerId;
};

export type AttackSequence = {
  /** The primary Crisis, until it starts. */
  primary?: CompanyAttack;
  /** Set once the primary Crisis is resolved: other Company regions with unrest still to rebel. */
  pendingRebellions?: RegionId[];
  current?: ActiveCompanyAttack;
};

export type TileWorkItem =
  | { kind: "resolve" }
  | { kind: "march"; shape: ElephantShape }
  | { kind: "crisisMarch" }
  | { kind: "leaderRedirect" }
  | { kind: "foreignInvasionTarget"; regionId: RegionId }
  | { kind: "foreignInvasionRedirect" }
  | { kind: "shuffleIntoStack" }
  // Work started from outside the phase (law effects resolved through Events in India's rules):
  | { kind: "turmoilAt"; regionId: RegionId }
  | { kind: "unrestInCompanyRegions" }
  | { kind: "foreignInvasionStorm" };

export type ActiveTile = {
  tileId: string;
  /** Region pictured on top of the draw stack when this tile was flipped. */
  locationRegionId?: RegionId;
  /** Company-controlled region the Elephant stood fully within when the tile was flipped. */
  elephantCenteredRegionId?: RegionId;
  work: TileWorkItem[];
  /** Regions that have overflowed this tile: each region can Cascade once per tile (p.28). */
  cascaded: RegionId[];
  /** Capital to march to after a successful Invasion (Imperial Ambitions, p.30). */
  imperialCapitalId?: RegionId;
  /** Company regions lost to a Rebellion during this tile (Leader's Elephant Redirect). */
  rebelledRegionIds: RegionId[];
  /** Set when Foreign Invasion targets the Company region the Elephant stands in. */
  foreignInvasionRedirect: boolean;
  /** Shuffle puts its own tile back in the draw stack instead of the discards. */
  returnedToStack: boolean;
};

export type EventsInIndiaProgress = {
  turn: number;
  /** Players already offered Envoy to the Mughals in this phase. */
  envoyOffered: PlayerId[];
  stormFaceId?: string;
  eventsRemaining: number;
  tile?: ActiveTile;
  attacks?: AttackSequence;
  /** Set when another phase (a law) runs India effects through this phase's rules; see startNestedIndiaResolution. */
  nested?: { resumeKey: string; returnPhase: PhaseId };
};

export type GovernorLossRecord = {
  turn: number;
  regionId: RegionId;
  officeId: OfficeId;
  holder: PlayerId;
};

/**
 * State owned by Events in India (rulebook pp.28-33): the event tile draw stack (top first) and
 * discards, the in-progress resolution of the current phase, and a record of Governors removed
 * by Region Loss for "The British Despots of India!".
 */
export type EventsInIndiaState = {
  drawPile: string[];
  discards: string[];
  progress?: EventsInIndiaProgress;
  governorsLostToRegionLoss: GovernorLossRecord[];
};

// Setup step 2 (p.4): shuffle the India event tiles.
export function createInitialEventsInIndiaState(input: SubsystemInitInput): SubsystemInitResult<EventsInIndiaState> {
  const shuffled = shuffle(
    input.rng,
    indiaEventTiles.map((tile) => tile.id),
  );

  return {
    state: { drawPile: shuffled.items, discards: [], governorsLostToRegionLoss: [] },
    rng: shuffled.rng,
  };
}
