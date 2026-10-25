import { localAlliances } from "../../../data";
import { countSixes, rollCheck } from "../../checks";
import { rollDice } from "../../rng";
import { commanderOf, presidentOf } from "../../selectors";
import type {
  ArmyState,
  GameState,
  LegalCommand,
  PendingDecision,
  PlayerId,
  PresidencyId,
  RegionId,
  RngRollRecord,
} from "../../types";
import type { CommanderActivity, DeploySelection, PendingCheck } from "../company-operation.state";
import {
  addToCompanyBalance,
  changeOfficeTreasury,
  decisionId,
  isLawInEffect,
  payPlayer,
  playerName,
  playersClockwiseFrom,
  presidentOfficeId,
  regionPresidencyId,
  unplayedBlackmailHolder,
  withCo,
} from "./context";
import { presidencyProgress, withActivity, withPresidencyProgress } from "./presidency-progress";
import type { StepResult } from "./step";

// Commanders (pp.21-23). First, with the President's consent and treasury, buy local alliances in the
// Army box (they move to the top half, usable once this turn). Then Deploy any number of times:
// pick a legal target, exhaust officers/regiments (1 die each) and alliances (their strength in dice),
// subtract the target's strength (its empire's too; Company regions count 0), roll, then every family
// rolls for each of its exhausted officers and loses one per 6. On success: divide loot, take trophies,
// remove tower/dome/flags, impose order, and form a Governorship if the Company did not yet control it.

export type CommanderPayload =
  | { action: "buyAlliance"; allianceId: string }
  | { action: "beginDeploys" }
  | { action: "target"; regionId: RegionId }
  | { action: "exhaustOfficer"; playerId: PlayerId }
  | { action: "exhaustRegiment" }
  | { action: "exhaustAlliance"; allianceId: string }
  | { action: "roll" }
  | { action: "cancelDeploy" }
  | { action: "finish" };

const EMPTY_SELECTION: DeploySelection = { officers: {}, regiments: 0, alliances: [] };
const LOOT_PER_TOWER_LEVEL = 4;

export function startCommander(state: GameState, presidency: PresidencyId): GameState {
  return withActivity(state, presidency, { kind: "commander", stage: "alliances" });
}

function alliance(allianceId: string) {
  return localAlliances.find((candidate) => candidate.id === allianceId)!;
}

// ---- targets and strength --------------------------------------------------------------------------

/** Region strength when defending (p.6, p.22): towers, plus its empire's regions; Company regions 0. */
export function defendingStrength(state: GameState, regionId: RegionId): number {
  const region = state.india.regions[regionId];
  if (region.companyControlled) return 0;
  if (!region.empireFlag) return region.towerLevels;
  return Object.values(state.india.regions)
    .filter((candidate) => candidate.empireFlag === region.empireFlag)
    .reduce((total, candidate) => total + candidate.towerLevels, 0);
}

function readyPieceDice(army: ArmyState): number {
  const officers = Object.values(army.officers).reduce((total, stack) => total + stack.ready, 0);
  const alliances = Object.entries(army.localAlliances ?? {})
    .filter(([, status]) => status === "ready")
    .reduce((total, [allianceId]) => total + alliance(allianceId).strength, 0);
  return officers + army.regiments.ready + alliances;
}

/** Deploy targets (p.22 step 1), limited to those the available dice could succeed against. */
export function deployTargets(state: GameState, presidency: PresidencyId): RegionId[] {
  const regions = Object.values(state.india.regions);
  const associated = regions.filter((region) => regionPresidencyId(state, region.id) === presidency).map((region) => region.id);
  const home = regions.find((region) => region.homePresidency === presidency)!.id;
  const candidates = new Set<RegionId>([home, ...associated]);
  for (const regionId of associated) for (const neighbour of state.india.regions[regionId].adjacent) candidates.add(neighbour);

  const dice = readyPieceDice(state.company.armies[presidency]);
  return [...candidates].filter((regionId) => {
    const region = state.india.regions[regionId];
    if (region.homePresidency && region.homePresidency !== presidency) return false;
    if (region.companyControlled) {
      if (regionPresidencyId(state, regionId) !== presidency) return false;
      // No dead actions: a Company region needs a closed order or unrest to restore.
      if (!region.orders.some((order) => order.closed) && region.unrest === 0) return false;
    }
    return dice - defendingStrength(state, regionId) >= 1;
  });
}

function selectionDice(selection: DeploySelection): number {
  const officers = Object.values(selection.officers).reduce((total, count) => total + count, 0);
  const alliances = selection.alliances.reduce((total, allianceId) => total + alliance(allianceId).strength, 0);
  return officers + selection.regiments + alliances;
}

// ---- decisions -----------------------------------------------------------------------------------

export function commanderDecision(state: GameState, presidency: PresidencyId, activity: CommanderActivity): PendingDecision {
  const army = state.company.armies[presidency];
  const commander = commanderOf(state, presidency) ?? "system";
  const commands: LegalCommand[] = [];
  let prompt: string;

  if (activity.stage === "alliances") {
    prompt = `Commander of the Army of ${presidency}: buy local alliances with the President's funds, then deploy.`;
    commands.push({
      type: "companyOperation.commander",
      label: "Go on to Deploy",
      payload: { action: "beginDeploys" } satisfies CommanderPayload,
    });
    const president = presidentOf(state, presidency);
    const treasury = state.company.offices[presidentOfficeId(presidency)]?.treasury ?? 0;
    if (president) {
      for (const [allianceId, status] of Object.entries(army.localAlliances ?? {})) {
        const definition = alliance(allianceId);
        if (status !== "exhausted" || definition.cost > treasury) continue;
        commands.push({
          type: "companyOperation.commander",
          label: `Buy ${definition.name} (strength ${definition.strength}) for £${definition.cost} from the President's treasury`,
          payload: { action: "buyAlliance", allianceId } satisfies CommanderPayload,
        });
      }
    }
  } else if (activity.stage === "deploy") {
    prompt = `Commander of the Army of ${presidency}: choose a Deploy target, or finish.`;
    commands.push({
      type: "companyOperation.commander",
      label: "Finish as Commander",
      payload: { action: "finish" } satisfies CommanderPayload,
    });
    for (const regionId of deployTargets(state, presidency)) {
      commands.push({
        type: "companyOperation.commander",
        label: `Deploy against ${state.india.regions[regionId].name} (strength ${defendingStrength(state, regionId)})`,
        payload: { action: "target", regionId } satisfies CommanderPayload,
      });
    }
  } else {
    const selection = activity.selection ?? EMPTY_SELECTION;
    const target = activity.target!;
    const strength = defendingStrength(state, target);
    const dice = selectionDice(selection);
    const net = dice - strength;
    prompt =
      `Deploy against ${state.india.regions[target].name}: ${dice} ${dice === 1 ? "die" : "dice"} from exhausted pieces ` +
      `− strength ${strength} = ${Math.max(net, 0)} to roll (p.22). ` +
      (net >= 1 ? "Exhaust more pieces or roll." : `Exhaust pieces worth ${1 - net} more ${1 - net === 1 ? "die" : "dice"} before you can roll.`);
    if (dice - strength >= 1) {
      commands.push({
        type: "companyOperation.commander",
        label: `Roll ${dice - strength} ${dice - strength === 1 ? "die" : "dice"}`,
        payload: { action: "roll" } satisfies CommanderPayload,
      });
    }
    for (const [playerId, stack] of Object.entries(army.officers)) {
      if (stack.ready - (selection.officers[playerId] ?? 0) <= 0) continue;
      commands.push({
        type: "companyOperation.commander",
        label: `Exhaust a ${playerName(state, playerId)} officer`,
        payload: { action: "exhaustOfficer", playerId } satisfies CommanderPayload,
      });
    }
    if (army.regiments.ready - selection.regiments > 0) {
      commands.push({
        type: "companyOperation.commander",
        label: "Exhaust a regiment",
        payload: { action: "exhaustRegiment" } satisfies CommanderPayload,
      });
    }
    for (const [allianceId, status] of Object.entries(army.localAlliances ?? {})) {
      if (status !== "ready" || selection.alliances.includes(allianceId)) continue;
      commands.push({
        type: "companyOperation.commander",
        label: `Exhaust ${alliance(allianceId).name} (${alliance(allianceId).strength} dice)`,
        payload: { action: "exhaustAlliance", allianceId } satisfies CommanderPayload,
      });
    }
    commands.push({
      type: "companyOperation.commander",
      label: "Cancel this Deploy",
      payload: { action: "cancelDeploy" } satisfies CommanderPayload,
    });
  }

  return {
    id: decisionId(state, `company-operation-commander-${presidency.toLowerCase()}`),
    phase: "companyOperation",
    step: `companyOperation.commander.${activity.stage}`,
    actor: commander,
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

// ---- steps ---------------------------------------------------------------------------------------

export function commanderStep(
  state: GameState,
  presidency: PresidencyId,
  activity: CommanderActivity,
  payload: CommanderPayload,
): StepResult {
  const commanderName = playerName(state, commanderOf(state, presidency));
  switch (payload.action) {
    case "buyAlliance": {
      const president = presidentOf(state, presidency);
      if (president !== commanderOf(state, presidency)) {
        return {
          state: withCo(state, { interrupt: { kind: "allianceConsent", presidency, allianceId: payload.allianceId } }),
          summary: `${commanderName} asked the President of ${presidency} to pay for ${alliance(payload.allianceId).name}.`,
        };
      }
      return {
        state: buyAlliance(state, presidency, payload.allianceId),
        summary: `${commanderName} bought ${alliance(payload.allianceId).name} for £${alliance(payload.allianceId).cost}.`,
      };
    }
    case "beginDeploys":
      return { state: withActivity(state, presidency, { kind: "commander", stage: "deploy" }), summary: `${commanderName} moved on to Deploy.` };
    case "target":
      return {
        state: withActivity(state, presidency, { kind: "commander", stage: "exhaust", target: payload.regionId, selection: EMPTY_SELECTION }),
        summary: `${commanderName} targeted ${state.india.regions[payload.regionId].name}.`,
      };
    case "exhaustOfficer":
    case "exhaustRegiment":
    case "exhaustAlliance": {
      const selection = activity.selection ?? EMPTY_SELECTION;
      const next: DeploySelection =
        payload.action === "exhaustOfficer"
          ? { ...selection, officers: { ...selection.officers, [payload.playerId]: (selection.officers[payload.playerId] ?? 0) + 1 } }
          : payload.action === "exhaustRegiment"
            ? { ...selection, regiments: selection.regiments + 1 }
            : { ...selection, alliances: [...selection.alliances, payload.allianceId] };
      return {
        state: withActivity(state, presidency, { ...activity, selection: next }),
        summary:
          payload.action === "exhaustOfficer"
            ? `${commanderName} committed a ${playerName(state, payload.playerId)} officer.`
            : payload.action === "exhaustRegiment"
              ? `${commanderName} committed a regiment.`
              : `${commanderName} committed ${alliance(payload.allianceId).name}.`,
      };
    }
    case "cancelDeploy":
      return { state: withActivity(state, presidency, { kind: "commander", stage: "deploy" }), summary: `${commanderName} cancelled the Deploy.` };
    case "roll":
      return rollDeploy(state, presidency, activity);
    case "finish":
      return finishCommander(state, presidency, `${commanderName} finished as Commander of the Army of ${presidency}.`);
  }
}

export function finishCommander(state: GameState, presidency: PresidencyId, summary: string): StepResult {
  const progress = presidencyProgress(state, presidency);
  return { state: withPresidencyProgress(state, { ...progress, commanderDone: true, activity: undefined }), summary };
}

export function buyAlliance(state: GameState, presidency: PresidencyId, allianceId: string): GameState {
  const paid = changeOfficeTreasury(state, presidentOfficeId(presidency), -alliance(allianceId).cost);
  const army = paid.company.armies[presidency];
  return {
    ...paid,
    company: {
      ...paid.company,
      armies: {
        ...paid.company.armies,
        [presidency]: { ...army, localAlliances: { ...(army.localAlliances ?? {}), [allianceId]: "ready" } },
      },
    },
  };
}

function rollDeploy(state: GameState, presidency: PresidencyId, activity: CommanderActivity): StepResult {
  const selection = activity.selection ?? EMPTY_SELECTION;
  const target = activity.target!;
  const dice = selectionDice(selection) - defendingStrength(state, target);
  const exhausted = exhaustSelection(state, presidency, selection);
  const check = rollCheck(exhausted.rng, dice, `companyOperation.deploy.${presidency}`);
  const rolled: GameState = { ...exhausted, rng: check.rng };
  const pending: Extract<PendingCheck, { context: "deploy" }> = {
    context: "deploy",
    presidency,
    target,
    selection,
    dice,
    values: check.values,
    outcome: check.outcome,
  };
  const summary = `${playerName(state, commanderOf(state, presidency))} deployed against ${state.india.regions[target].name} with ${dice} ${dice === 1 ? "die" : "dice"} [${check.values.join(", ")}]: ${check.outcome}.`;
  const rolls: RngRollRecord[] = check.roll ? [check.roll] : [];

  // Diplomatic Connection (blackmail #9) may force a reroll after any Deploy check.
  const holder = unplayedBlackmailHolder(rolled, "diplomatic-connection");
  if (holder) {
    return {
      state: withCo(rolled, { interrupt: { kind: "connection", cardId: "diplomatic-connection", holder, check: pending } }),
      summary,
      rngRolls: rolls,
    };
  }

  const resolved = resolveDeployCheck(rolled, pending);
  return { state: resolved.state, summary: `${summary} ${resolved.summary}`, details: resolved.details, rngRolls: [...rolls, ...resolved.rolls] };
}

function exhaustSelection(state: GameState, presidency: PresidencyId, selection: DeploySelection): GameState {
  const army = state.company.armies[presidency];
  const officers = { ...army.officers };
  for (const [playerId, count] of Object.entries(selection.officers)) {
    officers[playerId] = { ready: officers[playerId].ready - count, exhausted: officers[playerId].exhausted + count };
  }
  const localAlliancesState = { ...(army.localAlliances ?? {}) };
  for (const allianceId of selection.alliances) localAlliancesState[allianceId] = "exhausted";

  return {
    ...state,
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [presidency]: {
          ...army,
          officers,
          regiments: { ready: army.regiments.ready - selection.regiments, exhausted: army.regiments.exhausted + selection.regiments },
          localAlliances: localAlliancesState,
        },
      },
    },
  };
}

/** Loss checks, then the check's result (after any Diplomatic Connection reroll). */
export function resolveDeployCheck(
  state: GameState,
  check: Extract<PendingCheck, { context: "deploy" }>,
): { state: GameState; summary: string; details: unknown; rolls: RngRollRecord[] } {
  const presidency = check.presidency;
  const commander = commanderOf(state, presidency);
  const rolls: RngRollRecord[] = [];
  let next = state;

  // Loss checks (p.22 step 3): one die per exhausted officer, never regiments; each 6 loses an officer.
  const survivors: Record<PlayerId, number> = {};
  const losses: Record<PlayerId, number> = {};
  for (const [playerId, count] of Object.entries(check.selection.officers)) {
    if (count <= 0) continue;
    const roll = rollDice(next.rng, count, 6, `companyOperation.deploy.losses.${playerId}`);
    rolls.push(roll.roll);
    next = { ...next, rng: roll.rng };
    const lost = countSixes(roll.values);
    losses[playerId] = lost;
    survivors[playerId] = count - lost;
    if (lost > 0) next = loseExhaustedOfficers(next, presidency, playerId, lost);
  }

  const lossNote = Object.entries(losses)
    .filter(([, lost]) => lost > 0)
    .map(([playerId, lost]) => `${playerName(next, playerId)} lost ${lost} officer${lost === 1 ? "" : "s"}`)
    .join(", ");
  const parts = lossNote ? [`Loss checks: ${lossNote}.`] : ["No officers lost."];
  let details: Record<string, unknown> = { losses };

  if (check.outcome === "success") {
    const conquest = conquer(next, presidency, check.target, check.selection, survivors);
    next = withActivity(conquest.state, presidency, { kind: "commander", stage: "deploy" });
    parts.push(conquest.summary);
    details = { ...details, ...conquest.details };
  } else if (check.outcome === "catastrophe" && commander) {
    // Catastrophic failure (p.23): lose half the family's trophies (rounding up) and the Commander.
    const player = next.players[commander];
    const lostTrophies = Math.ceil(player.trophies / 2);
    next = {
      ...next,
      players: {
        ...next.players,
        [commander]: {
          ...player,
          trophies: player.trophies - lostTrophies,
          familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 },
        },
      },
      company: {
        ...next.company,
        armies: { ...next.company.armies, [presidency]: { ...next.company.armies[presidency], commander: undefined } },
      },
    };
    const finished = finishCommander(next, presidency, "");
    next = finished.state;
    parts.push(`${playerName(next, commander)} loses ${lostTrophies} troph${lostTrophies === 1 ? "y" : "ies"} and the Commander returns to supply.`);
  } else {
    next = withActivity(next, presidency, { kind: "commander", stage: "deploy" });
    parts.push("The Commander may deploy again while pieces remain.");
  }

  return { state: next, summary: parts.join(" "), details, rolls };
}

function loseExhaustedOfficers(state: GameState, presidency: PresidencyId, playerId: PlayerId, lost: number): GameState {
  const army = state.company.armies[presidency];
  const stack = army.officers[playerId];
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + lost } },
    },
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [presidency]: { ...army, officers: { ...army.officers, [playerId]: { ...stack, exhausted: stack.exhausted - lost } } },
      },
    },
  };
}

// ---- success -------------------------------------------------------------------------------------

/**
 * Divide loot (p.23): the Commander takes £1 (Commander's share) plus £1 per own officer, then each
 * next player clockwise £1 per officer, then £1 to the bank per regiment and alliance; repeat while
 * cash remains. Only officers that were used and survived count.
 */
export function divideLoot(
  state: GameState,
  commander: PlayerId,
  loot: number,
  survivors: Record<PlayerId, number>,
  bankShares: number,
): { payouts: Record<PlayerId, number>; bank: number } {
  const payouts: Record<PlayerId, number> = {};
  let remaining = loot;
  let bank = 0;
  const pay = (playerId: PlayerId, amount: number) => {
    const paid = Math.min(amount, remaining);
    if (paid > 0) payouts[playerId] = (payouts[playerId] ?? 0) + paid;
    remaining -= paid;
  };

  while (remaining > 0) {
    pay(commander, 1);
    for (const playerId of playersClockwiseFrom(state, commander)) {
      if (remaining <= 0) break;
      pay(playerId, survivors[playerId] ?? 0);
    }
    if (remaining > 0 && bankShares > 0) {
      const paid = Math.min(bankShares, remaining);
      bank += paid;
      remaining -= paid;
    }
  }
  return { payouts, bank };
}

function conquer(
  state: GameState,
  presidency: PresidencyId,
  regionId: RegionId,
  selection: DeploySelection,
  survivors: Record<PlayerId, number>,
): { state: GameState; summary: string; details: Record<string, unknown> } {
  const region = state.india.regions[regionId];
  const commander = commanderOf(state, presidency);
  const survivingOfficers = Object.values(survivors).reduce((total, count) => total + count, 0);
  const printedLoot =
    region.towerLevels * LOOT_PER_TOWER_LEVEL +
    (region.lootToken.face === "loot" && region.lootToken.available ? region.lootToken.value ?? 0 : 0);
  // Loot Minimum: at least the surviving officers used + 1.
  const loot = Math.max(printedLoot, survivingOfficers + 1);
  let next = state;
  let lootNote: string;
  let payouts: Record<PlayerId, number> = {};
  let bank = 0;

  if (isLawInEffect(next, "treasure-reform")) {
    // Treasure Reform (law #42): all loot goes to the Company Balance.
    next = addToCompanyBalance(next, loot);
    lootNote = `£${loot} loot went to the Company Balance (Treasure Reform).`;
  } else if (commander) {
    const division = divideLoot(next, commander, loot, survivors, selection.regiments + selection.alliances.length);
    payouts = division.payouts;
    bank = division.bank;
    for (const [playerId, amount] of Object.entries(payouts)) next = payPlayer(next, playerId, amount);
    lootNote = `£${loot} loot: ${Object.entries(payouts).map(([playerId, amount]) => `${playerName(next, playerId)} £${amount}`).join(", ")}${bank > 0 ? `, bank £${bank}` : ""}.`;
  } else {
    lootNote = `£${loot} loot went to the bank.`;
  }

  // Trophies: one per tower level, to the Commander.
  const trophies = region.towerLevels;
  if (commander && trophies > 0) {
    const player = next.players[commander];
    next = { ...next, players: { ...next.players, [commander]: { ...player, trophies: player.trophies + trophies } } };
  }

  next = removeTowerAndFlags(next, regionId);

  // Impose Order: open every order and remove unrest.
  const wasControlled = region.companyControlled;
  const target = next.india.regions[regionId];
  next = {
    ...next,
    india: {
      ...next.india,
      regions: {
        ...next.india.regions,
        [regionId]: {
          ...target,
          unrest: 0,
          orders: target.orders.map((order) => ({ ...order, closed: false })),
        },
      },
    },
  };

  let governorNote = "";
  if (!wasControlled) {
    next = formGovernorship(next, presidency, regionId);
    governorNote = next.company.governorGeneralInPlay
      ? ` ${region.name} is now Company-controlled.`
      : ` ${region.name} is now Company-controlled; its Governor office is vacant.`;
  }

  // Elephant Redirect: an Elephant in the region facing out now faces inward (a looming Rebellion).
  if (next.india.elephant.regionId === regionId && next.india.elephant.facing) {
    next = { ...next, india: { ...next.india, elephant: { regionId } } };
  }

  return {
    state: next,
    summary: `${region.name} taken. ${lootNote}${trophies > 0 ? ` ${playerName(next, commander)} takes ${trophies} troph${trophies === 1 ? "y" : "ies"}.` : ""}${governorNote}`,
    details: { region: regionId, loot, payouts, bank, trophies },
  };
}

/** Remove the tower and dome; a captured capital takes its empire's flags with it (p.23). */
function removeTowerAndFlags(state: GameState, regionId: RegionId): GameState {
  const region = state.india.regions[regionId];
  const flag = region.empireFlag;
  let regions = {
    ...state.india.regions,
    [regionId]: { ...region, towerLevels: 0, hasDome: false, empireFlag: undefined, isCapital: false },
  };

  if (flag) {
    if (region.isCapital) {
      regions = Object.fromEntries(
        Object.entries(regions).map(([id, candidate]) => [
          id,
          candidate.empireFlag === flag ? { ...candidate, empireFlag: undefined, isCapital: false } : candidate,
        ]),
      );
    } else {
      // Empire Decline (p.7): an empire reduced to its capital loses its flag.
      const remaining = Object.values(regions).filter((candidate) => candidate.empireFlag === flag);
      if (remaining.length === 1 && remaining[0].isCapital) {
        regions = { ...regions, [remaining[0].id]: { ...remaining[0], empireFlag: undefined, isCapital: false } };
      }
    }
  }

  return { ...state, india: { ...state.india, regions } };
}

/**
 * Form Governorship (p.23): the loot token goes above the President's box control side up, the region
 * is associated with this Presidency and Company-controlled, and its Governor office enters Vacant
 * Offices. With a Governor General in play no Governor is created (p.26).
 */
function formGovernorship(state: GameState, presidency: PresidencyId, regionId: RegionId): GameState {
  const region = state.india.regions[regionId];
  let next: GameState = {
    ...state,
    india: {
      ...state.india,
      regions: {
        ...state.india.regions,
        [regionId]: {
          ...region,
          companyControlled: true,
          associatedPresidency: presidency,
          lootToken: { ...region.lootToken, available: false, face: "control" },
        },
      },
    },
  };

  if (!next.company.governorGeneralInPlay) {
    const officeId = region.governorOffice;
    const office = next.company.offices[officeId];
    next = {
      ...next,
      company: {
        ...next.company,
        offices: {
          ...next.company.offices,
          [officeId]: {
            id: officeId,
            treasury: office?.treasury ?? 0,
            fatigue: 0,
            vacant: true,
            created: true,
            actedThisTurn: false,
          },
        },
        unusedOffices: next.company.unusedOffices.filter((candidate) => candidate !== officeId),
        vacantOffices: [...new Set([...next.company.vacantOffices, officeId])],
      },
    };
  }
  return next;
}
