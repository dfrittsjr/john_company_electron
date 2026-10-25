import type { SubsystemInitInput, SubsystemInitResult } from "../subsystem";
import type { CardInstanceId, PlayerId } from "../types";

/** Where a retirement step is running: the London Season (p.11) or Final Scoring (p.9). */
export type RetirementContext = "londonSeason" | "finalScoring";

/**
 * A retirement discount a player may use once this step. Own spouses are `own:<cardId>`;
 * discounts borrowed with Letters of Introduction are `borrowed:<ownerId>:<cardId>`.
 */
export type DiscountKey = string;

export type RetirementProgress = {
  context: RetirementContext;
  /** Chairman (or former Chairman if vacant) first, then clockwise (p.11). */
  order: PlayerId[];
  /** Index into `order` of the player now retiring. */
  current: number;
  /** Cash each player spent on retirements this step; sets the Prestige Cards order (p.12). */
  spending: Record<PlayerId, number>;
  /** Players who retired at least one pensioner this step (p.12). */
  retired: PlayerId[];
  /** Discounts each player has already used this step ("once per London Season", p.12). */
  usedDiscounts: Record<PlayerId, DiscountKey[]>;
  /** Players who played Letters of Introduction during this step. */
  lettersOfIntroduction: PlayerId[];
};

export type PrestigeProgress = {
  /** Players who retired, by spending, then window icons, then Prime Minister order (p.12). */
  order: PlayerId[];
  current: number;
};

/** Holdings a newly taken spouse forbids; resolved before the Prestige Cards step continues. */
export type RestrictionProgress = {
  playerId: PlayerId;
  spouseCardId: string;
};

/** A Scandal blackmail just taken from the display, which may be played at once. */
export type ScandalProgress = {
  playerId: PlayerId;
  cardInstanceId: CardInstanceId;
  cardId: string;
};

export type UpkeepProgress = {
  /** Players who cannot pay all prize upkeep and must choose which pieces to give up (p.36). */
  queue: PlayerId[];
};

/**
 * State owned by the London Season, Upkeep and Final Scoring area: the London Season Display
 * and its deck (prestige and blackmail shuffled together, p.4), and in-flight steps.
 */
export type LondonSeasonState = {
  /** Draw pile, top card first. Card ids from src/data/cards.ts. */
  deck: string[];
  discard: string[];
  /** Up to three card ids; blackmail sits face down (p.11). */
  display: string[];
  /** False until setup has dealt its blackmail cards and built the display (setup steps 10-12). */
  displayBuilt: boolean;
  /** Last known Chairman, so a vacant Chairman's predecessor can lead retirements (p.11). */
  formerChairman?: PlayerId;
  retirement?: RetirementProgress;
  prestige?: PrestigeProgress;
  restriction?: RestrictionProgress;
  scandal?: ScandalProgress;
  upkeep?: UpkeepProgress;
};

export function createInitialLondonSeasonState(input: SubsystemInitInput): SubsystemInitResult<LondonSeasonState> {
  return {
    state: { deck: [], discard: [], display: [], displayBuilt: false },
    rng: input.rng,
  };
}
