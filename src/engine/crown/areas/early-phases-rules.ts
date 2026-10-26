import type { CrownClimate, GameState, PresidencyId } from "../../types";
import { presidentOf } from "../../selectors";
import { crownPresidencyOrder, CROWN_PLAYER_ID, humanPlayerIds, writersOf } from "../state";

// Handbook rules of the early phases that the phase modules themselves need (the Family chart's
// bookkeeping), kept apart from ./early-phases.ts because phases may not import an area module.
// Imports only crown/state.ts and types: no phase.

/** The family actions the Crown's chart uses (Handbook p.3): the engine's action ids, not the icons. */
export type CrownChartAction =
  | "seek-share"
  | "purchase-shipyard"
  | "enlist-writer"
  | "enlist-officer"
  | "purchase-luxury"
  | "purchase-workshop";

/**
 * The Family action chart, left to right, by climate (Handbook p.3). Icons: eic-shield = Seek
 * Shares, anchor = purchase a shipyard, writer-hand = Enlist Writer, musket-fort = Enlist Officer,
 * top-hat = purchase a luxury, cog = purchase a workshop.
 */
export const CROWN_FAMILY_CHART: Record<CrownClimate, CrownChartAction[]> = {
  bull: ["seek-share", "purchase-shipyard", "enlist-writer", "enlist-writer", "enlist-officer"],
  stag: ["seek-share", "enlist-writer", "purchase-shipyard", "enlist-writer", "enlist-officer"],
  lion: ["purchase-shipyard", "enlist-officer", "enlist-writer", "enlist-officer"],
  bear: ["enlist-officer", "purchase-luxury", "purchase-workshop", "enlist-officer", "enlist-writer"],
  peacock: ["purchase-workshop", "purchase-luxury", "enlist-officer", "enlist-officer", "enlist-writer"],
};

/** "The Crown always takes two family actions each turn"; in a two-player game, one (Handbook p.3). */
export function crownFamilyActionCount(state: GameState): number {
  return humanPlayerIds(state).length >= 2 ? 1 : 2;
}

/** The first chart position at or after `from` whose action `viable` accepts ("skip any action that is not viable"). */
export function nextChartPosition(
  chart: readonly CrownChartAction[],
  from: number,
  viable: (action: CrownChartAction) => boolean,
): { index: number; action: CrownChartAction } | undefined {
  for (let index = from; index < chart.length; index += 1) {
    if (viable(chart[index])) return { index, action: chart[index] };
  }
  return undefined;
}

/** Where the chart goes on after `action` was taken: just past its first appearance at or after `from`. */
export function chartIndexAfter(chart: readonly CrownChartAction[], from: number, action: string): number {
  const index = chart.findIndex((candidate, position) => position >= from && candidate === action);
  return index === -1 ? from : index + 1;
}

/**
 * Enlist Writer priorities (Handbook p.3): vacant Presidencies with no Crown writers; Crown
 * Presidencies with the fewest Crown writers; Presidencies with the fewest Crown writers; then the
 * AI card's Presidency priority. Each step narrows the candidates when it applies to any of them.
 */
export function crownWriterPresidencies(state: GameState, among: readonly PresidencyId[]): PresidencyId[] {
  let candidates = [...among];
  const crownWriters = (presidency: PresidencyId) => writersOf(state, presidency, CROWN_PLAYER_ID);
  const president = (presidency: PresidencyId) => presidentOf(state, presidency);

  const vacant = candidates.filter((presidency) => !president(presidency) && crownWriters(presidency) === 0);
  if (vacant.length > 0) candidates = vacant;

  const crownOwn = candidates.filter((presidency) => president(presidency) === CROWN_PLAYER_ID);
  if (crownOwn.length > 0) candidates = crownOwn;

  const fewest = Math.min(...candidates.map(crownWriters));
  candidates = candidates.filter((presidency) => crownWriters(presidency) === fewest);

  const order = crownPresidencyOrder(state);
  return candidates.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** The Presidencies with no President and no Crown writer: the second free Enlist Writer (Handbook p.3). */
export function vacantPresidenciesWithoutCrownWriter(state: GameState): PresidencyId[] {
  return (["Bombay", "Madras", "Bengal"] as const).filter(
    (presidency) => !presidentOf(state, presidency) && writersOf(state, presidency, CROWN_PLAYER_ID) === 0,
  );
}
