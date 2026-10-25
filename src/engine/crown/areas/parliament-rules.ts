import { MAX_COMPANY_DEBT } from "../../../data";
import { rollDice } from "../../rng";
import type { CrownClimate, GameState, PlayerId, RngRollRecord } from "../../types";
import { CROWN_PLAYER_ID, climateName, shiftClimate } from "../state";

// Crown rules for Parliament, Upkeep and Final Scoring that the phase modules need (Handbook pp.2,
// 14-15). Phases may import this file because it imports no phase module.

/** Each emergency loan adds £5 to the Company Balance (rulebook p.27). */
const EMERGENCY_LOAN = 5;

/** Treasury bonus votes (p.14): £0-3 +0, £4-6 +1, £7-10 +2, £11-14 +3, £15+ +4. */
export function crownTreasuryVotes(cash: number): number {
  if (cash >= 15) return 4;
  if (cash >= 11) return 3;
  if (cash >= 7) return 2;
  if (cash >= 4) return 1;
  return 0;
}

/** The most the Crown spends (once) on votes against Deregulation, by climate (p.2). */
export const DEREGULATION_SPEND: Record<CrownClimate, number> = { bull: 6, stag: 5, lion: 4, bear: 3, peacock: 2 };

// --- Climate shift (p.15) ---

export type ClimateShift = {
  state: GameState;
  roll: RngRollRecord;
  successes: number;
  failures: number;
  catastrophes: number;
  /** The four conditions in order: +1, +1, -1, -1 (true when it applies). */
  steps: [boolean, boolean, boolean, boolean];
  note: string;
};

/**
 * "After the law is chosen, and before voting begins, roll 6 dice." Each die is a check die:
 * 1-2 a success, 3-4 a failure, 5-6 a catastrophic failure (rulebook p.17). Standing runs 0-7 with
 * failure = 0, as `company.standing` does. Shifts go right for successes and left for failures, each
 * "if able", one after the other.
 */
export function rollClimateShift(state: GameState): ClimateShift {
  const standing = state.company.standing;
  const rolled = rollDice(state.rng, 6, 6, "parliament.climateShift");
  const successes = rolled.values.filter((value) => value <= 2).length;
  const catastrophes = rolled.values.filter((value) => value >= 5).length;
  const failures = rolled.values.length - successes - catastrophes;
  const bad = failures + catastrophes;
  const steps: ClimateShift["steps"] = [successes >= standing, successes > standing, bad <= standing, bad < standing];

  let next: GameState = { ...state, rng: rolled.rng };
  const before = next.crown!.climate;
  const directions = [1, 1, -1, -1];
  steps.forEach((applies, index) => {
    if (applies) next = shiftClimate(next, directions[index]);
  });
  const after = next.crown!.climate;
  return {
    state: next,
    roll: rolled.roll,
    successes,
    failures,
    catastrophes,
    steps,
    note:
      `Climate shift: the Crown rolled ${rolled.values.join(", ")} (${successes} success${successes === 1 ? "" : "es"}, ` +
      `${failures} failure${failures === 1 ? "" : "s"}, ${catastrophes} catastrophic) against Company Standing ${standing}: ` +
      (after === before ? `the climate stays ${climateName(before)}.` : `the climate moves from ${climateName(before)} to ${climateName(after)}.`),
  };
}

// --- Royal Privilege (p.15) ---

export type RoyalPrivilegePayment = { state: GameState; note: string; loans: number };

/**
 * The Crown pays `amount` it may not have: from its own treasury first, then "additional funds from
 * the Company treasury" (the Balance), then emergency loans for the rest. Each loan moves Debt one
 * space right (never past the end) and adds £5 to the Balance; one or two loans lower Standing by 1,
 * three or more by 2 (public embarrassment, p.27). That may fail the Company.
 */
export function payWithRoyalPrivilege(state: GameState, amount: number, purpose: string): RoyalPrivilegePayment {
  const crown = state.players[CROWN_PLAYER_ID];
  const own = Math.min(Math.max(crown.cash, 0), amount);
  let shortfall = amount - own;
  const fromBalance = Math.min(state.company.balance, shortfall);
  shortfall -= fromBalance;
  const loans = shortfall > 0 ? Math.ceil(shortfall / EMERGENCY_LOAN) : 0;

  let company = { ...state.company, balance: state.company.balance - fromBalance };
  if (loans > 0) {
    const loss = loans <= 2 ? 1 : 2;
    const standing = Math.max(0, company.standing - loss);
    company = {
      ...company,
      balance: company.balance + loans * EMERGENCY_LOAN - shortfall,
      debt: Math.min(MAX_COMPANY_DEBT, company.debt + loans),
      standing,
      failed: company.failed || standing === 0,
    };
  }
  const players: Record<PlayerId, GameState["players"][string]> = {
    ...state.players,
    [CROWN_PLAYER_ID]: { ...crown, cash: crown.cash - own },
  };

  const parts = [`£${own} from its own treasury`];
  if (fromBalance > 0) parts.push(`£${fromBalance} from the Company treasury`);
  if (loans > 0) parts.push(`${loans} emergency loan${loans === 1 ? "" : "s"}`);
  const note =
    own === amount
      ? `The Crown paid £${amount} ${purpose}.`
      : `Royal Privilege: the Crown paid £${amount} ${purpose} with ${parts.join(", ")}.` +
        (loans > 0 ? ` Public embarrassment lowered Standing by ${loans <= 2 ? 1 : 2}.` : "") +
        (company.failed && !state.company.failed ? " The Company has failed." : "");
  return { state: { ...state, players, company }, note, loans };
}

// --- Game End [SOLO] (p.15) ---

/** Victory points the soloist loses when the Company failed on `turn` (p.15's table; Long 1710 uses the 1710 row). */
export function soloFailureAdjustment(scenario: string, turn: number): number {
  const rows: Record<string, Record<number, number>> = {
    "1710": { 1: -5, 2: -4, 3: -3, 4: -2, 5: -1 },
    "long-1710": { 1: -5, 2: -4, 3: -3, 4: -2, 5: -1 },
    "1758": { 3: -5, 4: -4, 5: -3, 6: -2, 7: -1 },
    "1813": { 5: -4, 6: -3, 7: -2, 8: -1 },
  };
  return rows[scenario]?.[turn] ?? 0;
}
