import { countSixes, rollCheck } from "../../checks";
import { PRESIDENCY_IDS, officeHolder } from "../../selectors";
import type { ArmyId, GameState, LegalCommand, OfficeId, PendingDecision, RegionId } from "../../types";
import type { OfficeProgress, ShipDestination } from "../company-operation.state";
import { chairmanAllocationTargets } from "./chairman";
import {
  GOVERNOR_GENERAL_OFFICE_ID,
  SEA_ZONE_LABEL,
  addCompanyShip,
  addRegiment,
  addToCompanyBalance,
  changeOfficeTreasury,
  coState,
  companyControlledRegions,
  companyShipPiecesInSupply,
  decisionId,
  isLawInEffect,
  officeLabel,
  payOfficeholderBonus,
  playerName,
  regimentsInSupply,
  shipDestinations,
  vacateAfterCatastrophe,
  withCo,
} from "./context";
import { addUnrest } from "./governor";
import { finishOffice, type OperationStep } from "./step";

// Governor General (p.26), acting in the Director of Trade's slot with its treasury: first the Company
// Balance gains £3 per Company region; then Govern any number of times (£1 per die, no penalty), each 6
// adding unrest to every Company region. Success (once per turn): take £1 per Company region, then for
// each Company region choose a Company ship (any sea zone), a regiment (any Army), or a £2 tax (to the
// Balance or any other Company treasury, adding unrest to a different Company region each time).
// Failure adds unrest to every Company region. Zamindar Taxes: +£3 bonus, 2 unrest per failure.

const OFFICE_ID = GOVERNOR_GENERAL_OFFICE_ID;
const INCOME_PER_REGION = 3;
const TAX_AMOUNT = 2;

type GovernorGeneralProgress = Extract<OfficeProgress, { office: "governor-general" }>;

export type GovernorGeneralPayload =
  | { action: "collect" }
  | { action: "govern"; spend: number }
  | { action: "ship"; to: ShipDestination }
  | { action: "regiment"; army: ArmyId }
  | { action: "tax"; to: "balance" | OfficeId }
  | { action: "taxUnrest"; regionId: RegionId }
  | { action: "finish" };

function progress(state: GameState): GovernorGeneralProgress {
  const current = coState(state).current;
  return current?.office === OFFICE_ID ? current : { office: OFFICE_ID, stage: "begin", choicesRemaining: 0, taxRegions: [] };
}

export function governorGeneralDecision(state: GameState): PendingDecision {
  const current = progress(state);
  const regions = companyControlledRegions(state);
  const treasury = state.company.offices[OFFICE_ID]?.treasury ?? 0;
  const commands: LegalCommand[] = [];
  let prompt: string;

  if (current.stage === "begin") {
    prompt = "Governor General: collect £3 per Company region for the Company Balance.";
    commands.push({
      type: "companyOperation.governorGeneral",
      label: `Add £${INCOME_PER_REGION * regions.length} to the Company Balance (${regions.length} Company region${regions.length === 1 ? "" : "s"})`,
      payload: { action: "collect" } satisfies GovernorGeneralPayload,
    });
  } else if (current.stage === "govern") {
    prompt = `Governor General: Govern (£1 per die, treasury £${treasury}) or finish.`;
    commands.push({
      type: "companyOperation.governorGeneral",
      label: "Finish as Governor General",
      payload: { action: "finish" } satisfies GovernorGeneralPayload,
    });
    if (!coState(state).governorGeneralGoverned && regions.length > 0) {
      for (let spend = 1; spend <= treasury; spend += 1) {
        commands.push({
          type: "companyOperation.governorGeneral",
          label: `Govern with ${spend} ${spend === 1 ? "die" : "dice"} (£${spend})`,
          payload: { action: "govern", spend } satisfies GovernorGeneralPayload,
        });
      }
    }
  } else if (current.stage === "choices") {
    prompt = `Governor General: choose ${current.choicesRemaining} more effect(s), one per Company region.`;
    if (companyShipPiecesInSupply(state) > 0) {
      for (const to of shipDestinations(state)) {
        commands.push({
          type: "companyOperation.governorGeneral",
          label: `Shipbuilding: a Company ship into ${SEA_ZONE_LABEL[to]}`,
          payload: { action: "ship", to } satisfies GovernorGeneralPayload,
        });
      }
    }
    if (regimentsInSupply(state) > 0) {
      for (const army of PRESIDENCY_IDS) {
        commands.push({
          type: "companyOperation.governorGeneral",
          label: `Commission a regiment for the Army of ${army}`,
          payload: { action: "regiment", army } satisfies GovernorGeneralPayload,
        });
      }
    }
    if (regions.some((regionId) => !current.taxRegions.includes(regionId))) {
      commands.push({
        type: "companyOperation.governorGeneral",
        label: `Tax: £${TAX_AMOUNT} to the Company Balance (adds unrest)`,
        payload: { action: "tax", to: "balance" } satisfies GovernorGeneralPayload,
      });
      for (const officeId of chairmanAllocationTargets(state).filter((id) => id !== OFFICE_ID)) {
        commands.push({
          type: "companyOperation.governorGeneral",
          label: `Tax: £${TAX_AMOUNT} to ${officeLabel(officeId)} (adds unrest)`,
          payload: { action: "tax", to: officeId } satisfies GovernorGeneralPayload,
        });
      }
    }
  } else {
    prompt = "Governor General's Tax: place an unrest in a Company region not already taxed this turn.";
    for (const regionId of regions.filter((id) => !current.taxRegions.includes(id))) {
      commands.push({
        type: "companyOperation.governorGeneral",
        label: `Unrest in ${state.india.regions[regionId].name}`,
        payload: { action: "taxUnrest", regionId } satisfies GovernorGeneralPayload,
      });
    }
  }

  return {
    id: decisionId(state, "company-operation-governor-general"),
    phase: "companyOperation",
    step: `companyOperation.governorGeneral.${current.stage}`,
    actor: officeHolder(state, OFFICE_ID) ?? "system",
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

function addUnrestEverywhere(state: GameState, amount: number): GameState {
  return companyControlledRegions(state).reduce((next, regionId) => addUnrest(next, regionId, amount), state);
}

function afterChoice(state: GameState, current: GovernorGeneralProgress): GameState {
  const remaining = current.choicesRemaining - 1;
  return withCo(state, { current: { ...current, choicesRemaining: remaining, stage: remaining > 0 ? "choices" : "govern" } });
}

export const governorGeneralStep: OperationStep = (state, command) => {
  const payload = command.payload as GovernorGeneralPayload;
  const current = progress(state);
  const regions = companyControlledRegions(state);

  switch (payload.action) {
    case "collect": {
      const income = INCOME_PER_REGION * regions.length;
      return {
        state: withCo(addToCompanyBalance(state, income), { current: { ...current, stage: "govern" } }),
        summary: `The Governor General added £${income} to the Company Balance.`,
      };
    }
    case "finish":
      return { state: finishOffice(state, OFFICE_ID), summary: "The Governor General finished." };
    case "govern": {
      const paid = changeOfficeTreasury(state, OFFICE_ID, -payload.spend);
      const check = rollCheck(paid.rng, payload.spend, "companyOperation.govern");
      let next: GameState = { ...paid, rng: check.rng };
      const sixes = countSixes(check.values);
      if (sixes > 0) next = addUnrestEverywhere(next, sixes);
      const head = `The Governor General governed with ${payload.spend} ${payload.spend === 1 ? "die" : "dice"} [${check.values.join(", ")}]: ${check.outcome}${sixes > 0 ? `; ${sixes} unrest in each Company region for the 6s` : ""}.`;
      const rngRolls = check.roll ? [check.roll] : undefined;

      if (check.outcome === "success") {
        const zamindar = isLawInEffect(next, "zamindar-taxes") ? 3 : 0;
        next = payOfficeholderBonus(next, OFFICE_ID, regions.length + zamindar).state;
        next = withCo(next, {
          governorGeneralGoverned: true,
          current: { ...current, stage: regions.length > 0 ? "choices" : "govern", choicesRemaining: regions.length },
        });
        return { state: next, summary: `${head} The Governor General takes £${regions.length + zamindar}.`, rngRolls };
      }
      if (check.outcome === "catastrophe") {
        const holder = officeHolder(state, OFFICE_ID);
        return {
          state: finishOffice(vacateAfterCatastrophe(next, OFFICE_ID), OFFICE_ID),
          summary: `${head} ${playerName(state, holder)}'s Governor General returns to supply.`,
          rngRolls,
        };
      }
      const unrest = isLawInEffect(next, "zamindar-taxes") ? 2 : 1;
      next = addUnrestEverywhere(next, unrest);
      return { state: withCo(next, { current }), summary: `${head} ${unrest} unrest in each Company region.`, rngRolls };
    }
    case "ship":
      return {
        state: afterChoice(addCompanyShip(state, payload.to, "company"), current),
        summary: `Governor General's Shipbuilding: a Company ship into ${SEA_ZONE_LABEL[payload.to]}.`,
      };
    case "regiment":
      return {
        state: afterChoice(addRegiment(state, payload.army), current),
        summary: `Governor General commissioned a regiment for the Army of ${payload.army}.`,
      };
    case "tax": {
      const next = payload.to === "balance" ? addToCompanyBalance(state, TAX_AMOUNT) : changeOfficeTreasury(state, payload.to, TAX_AMOUNT);
      return {
        state: withCo(next, { current: { ...current, stage: "taxUnrest" } }),
        summary: `Governor General's Tax: £${TAX_AMOUNT} to ${payload.to === "balance" ? "the Company Balance" : officeLabel(payload.to)}.`,
      };
    }
    case "taxUnrest": {
      const next = addUnrest(state, payload.regionId, 1);
      return {
        state: afterChoice(next, { ...current, taxRegions: [...current.taxRegions, payload.regionId] }),
        summary: `The Governor General's Tax added unrest in ${state.india.regions[payload.regionId].name}.`,
      };
    }
  }
};
