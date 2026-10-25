import { rollDice } from "./rng";
import type { RngRollRecord, RngState } from "./types";

// Success checks (rulebook p.17): roll the dice, the lowest die decides.
// 1-2 success, 3-4 failure (may retry if resources allow), 5-6 catastrophic failure.

export type CheckOutcome = "success" | "failure" | "catastrophe";

export type CheckResult = {
  dice: number;
  values: number[];
  lowest: number | null;
  outcome: CheckOutcome;
  rng: RngState;
  roll?: RngRollRecord;
};

export function outcomeForLowestDie(lowest: number): CheckOutcome {
  if (lowest <= 2) return "success";
  if (lowest <= 4) return "failure";
  return "catastrophe";
}

/** A check with no dice left after penalties is a failure (Mercantile/Diplomatic Connection text). */
export function rollCheck(rng: RngState, dice: number, label: string): CheckResult {
  if (dice <= 0) {
    return { dice: 0, values: [], lowest: null, outcome: "failure", rng };
  }

  const rolled = rollDice(rng, dice, 6, label);
  const lowest = Math.min(...rolled.values);

  return {
    dice,
    values: rolled.values,
    lowest,
    outcome: outcomeForLowestDie(lowest),
    rng: rolled.rng,
    roll: rolled.roll,
  };
}

/** Dice that roll a 6, used by officer loss checks (p.22) and the Governor General's Govern (p.26). */
export function countSixes(values: number[]): number {
  return values.filter((value) => value === 6).length;
}
