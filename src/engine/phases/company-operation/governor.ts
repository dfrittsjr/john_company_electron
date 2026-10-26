import { rollCheck } from "../../checks";
import { clearScopedCrownEffects } from "../../crown/state";
import { officeHolder } from "../../selectors";
import type { GameState, LegalCommand, OfficeId, PendingDecision, PresidencyId, RegionId } from "../../types";
import type { GovernorActivity } from "../company-operation.state";
import {
  SEA_ZONE_BY_PRESIDENCY,
  SEA_ZONE_LABEL,
  addCompanyShip,
  addRegiment,
  addToCompanyBalance,
  changeOfficeTreasury,
  companyShipPiecesInSupply,
  decisionId,
  isLawInEffect,
  payOfficeholderBonus,
  playerName,
  presidentOfficeId,
  regimentsInSupply,
  vacateAfterCatastrophe,
} from "./context";
import { presidencyProgress, withActivity, withPresidencyProgress } from "./presidency-progress";
import { withBoardOfControlOffer, type StepResult } from "./step";

// Governors (p.24): a diminishing dice pool of Administer checks, no penalty. Success: take £1 (£2 if
// the previous roll was not a success) and build a Company ship (two successes: start it in the
// region, then launch it to the President's sea zone), commission a regiment for the President's Army,
// or tax £2 to the Company Balance or the President's treasury (each Tax after the first adds unrest).
// Failure adds unrest. The pool drops by one after every check; stop on catastrophe, empty pool, or choice.

/** Initial dice pools printed on the Governor cards (Bridge cards, fronts pp.8-9). */
export const GOVERNOR_DICE_POOLS: Record<RegionId, number> = {
  bombay: 3,
  madras: 4,
  bengal: 4,
  punjab: 3,
  delhi: 4,
  maratha: 3,
  hyderabad: 3,
  mysore: 3,
};

const TAX_AMOUNT = 2;

export type GovernorPayload =
  | { action: "administer" }
  | { action: "stop" }
  | { action: "buildShip" }
  | { action: "commissionRegiment" }
  | { action: "tax"; to: "balance" | "president" };

export function governorRegion(state: GameState, officeId: OfficeId): RegionId {
  return Object.values(state.india.regions).find((region) => region.governorOffice === officeId)!.id;
}

export function startGovernor(state: GameState, presidency: PresidencyId, officeId: OfficeId): GameState {
  const region = governorRegion(state, officeId);
  // Zamindar Taxes (law #41): every Governor adds one die to its pool.
  const pool = GOVERNOR_DICE_POOLS[region] + (isLawInEffect(state, "zamindar-taxes") ? 1 : 0);
  const activity: GovernorActivity = { kind: "governor", officeId, dicePool: pool, taxes: 0, awaitingChoice: false };
  return withActivity(state, presidency, activity);
}

export function governorDecision(state: GameState, presidency: PresidencyId, activity: GovernorActivity): PendingDecision {
  const regionId = governorRegion(state, activity.officeId);
  const region = state.india.regions[regionId];
  const commands: LegalCommand[] = [];
  let prompt: string;

  if (activity.awaitingChoice) {
    prompt = `Governor of ${region.name}: the Administer check succeeded. Choose its effect.`;
    const canStartShip = !region.partialCompanyShip && companyShipPiecesInSupply(state) > 0;
    if (region.partialCompanyShip || canStartShip) {
      commands.push({
        type: "companyOperation.governor",
        label: region.partialCompanyShip
          ? `Launch the Company ship to the ${SEA_ZONE_LABEL[SEA_ZONE_BY_PRESIDENCY[presidency]]} sea zone`
          : `Start building a Company ship in ${region.name}`,
        payload: { action: "buildShip" } satisfies GovernorPayload,
      });
    }
    if (regimentsInSupply(state) > 0) {
      commands.push({
        type: "companyOperation.governor",
        label: `Commission a regiment for the Army of ${presidency}`,
        payload: { action: "commissionRegiment" } satisfies GovernorPayload,
      });
    }
    const unrestNote = activity.taxes > 0 ? " (adds unrest)" : "";
    commands.push(
      {
        type: "companyOperation.governor",
        label: `Tax: £${TAX_AMOUNT} to the Company Balance${unrestNote}`,
        payload: { action: "tax", to: "balance" } satisfies GovernorPayload,
      },
      {
        type: "companyOperation.governor",
        label: `Tax: £${TAX_AMOUNT} to the President of ${presidency}'s treasury${unrestNote}`,
        payload: { action: "tax", to: "president" } satisfies GovernorPayload,
      },
    );
  } else {
    prompt = `Governor of ${region.name}: Administer with ${activity.dicePool} ${activity.dicePool === 1 ? "die" : "dice"}, or stop.`;
    commands.push({
      type: "companyOperation.governor",
      label: `Administer (${activity.dicePool} ${activity.dicePool === 1 ? "die" : "dice"})`,
      payload: { action: "administer" } satisfies GovernorPayload,
    });
    commands.push({
      type: "companyOperation.governor",
      label: `Stop as Governor of ${region.name}`,
      payload: { action: "stop" } satisfies GovernorPayload,
    });
  }

  return {
    id: decisionId(state, `company-operation-governor-${regionId}`),
    phase: "companyOperation",
    step: activity.awaitingChoice ? "companyOperation.governor.choose" : "companyOperation.governor.administer",
    actor: officeHolder(state, activity.officeId) ?? "system",
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

export function governorStep(
  state: GameState,
  presidency: PresidencyId,
  activity: GovernorActivity,
  payload: GovernorPayload,
): StepResult {
  const regionId = governorRegion(state, activity.officeId);
  const regionName = state.india.regions[regionId].name;

  switch (payload.action) {
    case "stop":
      return finishGovernor(state, presidency, activity.officeId, `The Governor of ${regionName} stopped.`);
    case "administer": {
      const check = rollCheck(state.rng, activity.dicePool, `companyOperation.administer.${regionId}`);
      let next: GameState = { ...state, rng: check.rng };
      const rngRolls = check.roll ? [check.roll] : undefined;
      const pool = activity.dicePool - 1;
      const head = `The Governor of ${regionName} administered with ${activity.dicePool} ${activity.dicePool === 1 ? "die" : "dice"} [${check.values.join(", ")}]: ${check.outcome}.`;

      if (check.outcome === "success") {
        const earned = activity.lastRollSucceeded === false ? 2 : 1;
        const bonus = payOfficeholderBonus(next, activity.officeId, earned);
        next = withActivity(bonus.state, presidency, { ...activity, dicePool: pool, lastRollSucceeded: true, awaitingChoice: true });
        return { state: next, summary: `${head} The Governor earns £${earned}.`, rngRolls };
      }
      if (check.outcome === "catastrophe") {
        const holder = officeHolder(state, activity.officeId);
        // "If the check did not succeed, add an unrest to the region" (p.24): a catastrophe is a failure too.
        const catastropheUnrest = isLawInEffect(next, "zamindar-taxes") ? 2 : 1;
        next = addUnrest(next, regionId, catastropheUnrest);
        next = clearScopedCrownEffects(vacateAfterCatastrophe(next, activity.officeId), "presidencies.governor.", `governor:${activity.officeId}`);
        const progress = presidencyProgress(next, presidency);
        next = withPresidencyProgress(next, {
          ...progress,
          governorsDone: [...progress.governorsDone, activity.officeId],
          activity: undefined,
        });
        return { state: next, summary: `${head} ${playerName(state, holder)}'s Governor returns to supply.`, rngRolls };
      }

      // Failure: unrest (Zamindar Taxes: 2 unrest).
      const unrest = isLawInEffect(next, "zamindar-taxes") ? 2 : 1;
      next = addUnrest(next, regionId, unrest);
      const failed: GovernorActivity = { ...activity, dicePool: pool, lastRollSucceeded: false };
      if (pool <= 0) {
        return finishGovernor(next, presidency, activity.officeId, `${head} ${unrest} unrest added; the pool is empty.`, rngRolls);
      }
      return { state: withActivity(next, presidency, failed), summary: `${head} ${unrest} unrest added.`, rngRolls };
    }
    case "buildShip":
    case "commissionRegiment":
    case "tax": {
      let next = state;
      let summary: string;
      let taxes = activity.taxes;
      if (payload.action === "buildShip") {
        const region = next.india.regions[regionId];
        next = {
          ...next,
          india: {
            ...next.india,
            regions: { ...next.india.regions, [regionId]: { ...region, partialCompanyShip: !region.partialCompanyShip } },
          },
        };
        if (region.partialCompanyShip) {
          next = addCompanyShip(next, SEA_ZONE_BY_PRESIDENCY[presidency], "company");
          summary = `The Governor of ${regionName} launched a Company ship into the ${SEA_ZONE_LABEL[SEA_ZONE_BY_PRESIDENCY[presidency]]} sea zone.`;
        } else {
          summary = `The Governor of ${regionName} started building a Company ship.`;
        }
      } else if (payload.action === "commissionRegiment") {
        next = addRegiment(next, presidency);
        summary = `The Governor of ${regionName} commissioned a regiment for the Army of ${presidency}.`;
      } else {
        next =
          payload.to === "balance"
            ? addToCompanyBalance(next, TAX_AMOUNT)
            : changeOfficeTreasury(next, presidentOfficeId(presidency), TAX_AMOUNT);
        const unrest = taxes > 0 ? 1 : 0;
        if (unrest) next = addUnrest(next, regionId, unrest);
        taxes += 1;
        summary = `The Governor of ${regionName} taxed £${TAX_AMOUNT} to ${payload.to === "balance" ? "the Company Balance" : `the President of ${presidency}`}${unrest ? " (1 unrest)" : ""}.`;
      }

      const after: GovernorActivity = { ...activity, taxes, awaitingChoice: false };
      if (after.dicePool <= 0) {
        return finishGovernor(next, presidency, activity.officeId, `${summary} The pool is empty.`);
      }
      return { state: withActivity(next, presidency, after), summary };
    }
  }
}

function finishGovernor(
  state: GameState,
  presidency: PresidencyId,
  officeId: OfficeId,
  summary: string,
  rngRolls?: StepResult["rngRolls"],
): StepResult {
  const progress = presidencyProgress(state, presidency);
  const next = withPresidencyProgress(clearScopedCrownEffects(state, "presidencies.governor.", `governor:${officeId}`), {
    ...progress,
    governorsDone: [...progress.governorsDone, officeId],
    activity: undefined,
  });
  return { state: withBoardOfControlOffer(next, officeId), summary, rngRolls };
}

export function addUnrest(state: GameState, regionId: RegionId, amount: number): GameState {
  const region = state.india.regions[regionId];
  return {
    ...state,
    india: { ...state.india, regions: { ...state.india.regions, [regionId]: { ...region, unrest: region.unrest + amount } } },
  };
}
