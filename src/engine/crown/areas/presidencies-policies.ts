import { localAlliances } from "../../../data";
import { commanderOf, companyShareCount, presidentOf } from "../../selectors";
import type { GameState, LegalCommand, PresidencyId, RegionId } from "../../types";
import { coState, regionPresidencyId } from "../../phases/company-operation/context";
import { chinaShips } from "../../phases/company-operation/china";
import { defendingStrength } from "../../phases/company-operation/commander";
import { homeRegionOf } from "../../phases/company-operation/trade";
import { choose, optionsOfType, type CrownPolicy } from "../kit";
import { byCrownRegionOrder, crownPickPlayer, crownEffects, CROWN_PLAYER_ID } from "../state";
import {
  armyStrength,
  byClimate,
  bestRoute,
  canMake,
  climateIs,
  commanderActivity,
  currentActivity,
  deployFeasible,
  deployRequired,
  deploysAllowed,
  dice,
  diceDelta,
  EMPTY_SELECTION,
  hasEffect,
  isCrownPresident,
  label,
  operatingPresidency,
  orderValue,
  payloadOf,
  planTrade,
  presidentTreasury,
  readyUnits,
  regionDistances,
  tradeRequired,
  type Unit,
} from "./presidencies-shared";

// The Crown as President, Governor, Commander and Superintendent (Handbook pp.10-13), in Events in
// India and in Revenue (p.14).


// ---------------------------------------------------------------------------------------------
// Presidency operations (p.10): Governors in order of formation, then the Commander, then Trade.

/** Order of formation: offices are added to the Company's office record as Governorships form. */
function formationIndex(state: GameState, officeId: string): number {
  const index = Object.keys(state.company.offices).indexOf(officeId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

const presidencyPolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  if (!presidency) return undefined;
  const governors = optionsOfType(decision, "companyOperation.presidency", (payload) => payload.action === "governor").sort(
    (a, b) => formationIndex(state, payloadOf(a).officeId as string) - formationIndex(state, payloadOf(b).officeId as string),
  );
  if (governors.length > 0) {
    return { commands: [governors[0]], reason: `${label(state)}: Governors act first, in order of formation (Handbook p.10).` };
  }
  const commander = optionsOfType(decision, "companyOperation.presidency", (payload) => payload.action === "commander");
  if (commander.length > 0) return { commands: commander, reason: `${label(state)}: the Commander acts after the Governors (Handbook p.10).` };

  const trade = optionsOfType(decision, "companyOperation.presidency", (payload) => payload.action === "trade");
  const end = optionsOfType(decision, "companyOperation.presidency", (payload) => payload.action === "end");
  if (trade.length > 0 && isCrownPresident(state, presidency)) {
    const required = tradeRequired(state, presidency);
    const treasury = presidentTreasury(state, presidency);
    if (planTrade(state, presidency, [homeRegionOf(state, presidency)], treasury)) {
      return { commands: trade, reason: `${label(state)}: attempts Trade, needing ${dice(required)} (Handbook p.13).` };
    }
    if (end.length > 0) {
      return {
        commands: end,
        reason: `${label(state)}: the Presidency's £${treasury} cannot pay for ${dice(required)}, so it does not Trade (Handbook p.13).`,
      };
    }
  }
  return end.length > 0 ? { commands: end, reason: `${label(state)}: nothing more to do in this Presidency.` } : undefined;
};

// ---------------------------------------------------------------------------------------------
// Governors (p.10).

const administerPolicy: CrownPolicy = (state, decision) => {
  const activity = currentActivity(state);
  if (activity?.kind !== "governor") return undefined;
  const scope = `governor:${activity.officeId}`;
  const stop = optionsOfType(decision, "companyOperation.governor", (payload) => payload.action === "stop");
  if (hasEffect(state, "presidencies.governor.none", scope)) {
    return choose(stop[0], `${label(state)}: takes no Administer actions (favour).`);
  }
  const required = Math.max(1, byClimate(state, [3, 2, 2, 2, 1]) + diceDelta(state, "presidencies.governor.dice", scope));
  if (activity.dicePool >= required) {
    return choose(
      optionsOfType(decision, "companyOperation.governor", (payload) => payload.action === "administer")[0],
      `${label(state)}: Administers while it can roll ${dice(required)}; the pool holds ${activity.dicePool} (Handbook p.10).`,
    );
  }
  return choose(stop[0], `${label(state)}: stops, as the pool of ${activity.dicePool} is under the ${dice(required)} required (Handbook p.10).`);
};

const governorResultPolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  if (!presidency) return undefined;
  const crownPresident = isCrownPresident(state, presidency);
  const tax = optionsOfType(decision, "companyOperation.governor", (payload) => payload.action === "tax" && payload.to === (crownPresident ? "president" : "balance"));
  const ship = optionsOfType(decision, "companyOperation.governor", (payload) => payload.action === "buildShip");
  const regiment = optionsOfType(decision, "companyOperation.governor", (payload) => payload.action === "commissionRegiment");
  const climate = label(state);
  const taxReason = `${climate}: Tax, adding the funds to ${crownPresident ? "the Crown President's treasury" : "the Company Balance"} (Handbook p.10).`;
  if (climateIs(state, "bull", "stag")) return choose(tax[0], taxReason);
  const wanted = climateIs(state, "lion") ? ship : regiment;
  if (wanted.length > 0) {
    return choose(wanted[0], climateIs(state, "lion") ? `${climate}: builds a Company ship (Handbook p.10).` : `${climate}: commissions a regiment (Handbook p.10).`);
  }
  return choose(tax[0], `${climate}: ${climateIs(state, "lion") ? "no Company ship can be built" : "no regiment is left to commission"}, so it taxes (Handbook p.10).`);
};

// ---------------------------------------------------------------------------------------------
// Trade (p.13).

const tradeDeclarePolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  const activity = currentActivity(state);
  if (!presidency || activity?.kind !== "trade") return undefined;
  const treasury = presidentTreasury(state, presidency);
  const required = tradeRequired(state, presidency);
  const plan = planTrade(state, presidency, activity.declared, treasury);
  const cancel = optionsOfType(decision, "companyOperation.trade", (payload) => payload.action === "cancel");
  if (!plan) {
    return choose(cancel[0], `${label(state)}: cannot pay for ${dice(required)}, so it does not Trade (Handbook p.13).`);
  }
  const missing = plan.regions.filter((regionId) => !activity.declared.includes(regionId));
  const declare = optionsOfType(decision, "companyOperation.trade", (payload) => payload.action === "declare" && missing.includes(payload.regionId as RegionId));
  const route = `the highest value route (£${plan.route.value} over ${plan.route.count} order${plan.route.count === 1 ? "" : "s"})`;
  if (declare.length > 0) {
    const [first] = byCrownRegionOrder(state, declare, (command) => payloadOf(command).regionId as RegionId);
    return choose(first, `${label(state)}: declares ${state.india.regions[payloadOf(first).regionId as RegionId].name} for ${route} (Handbook p.13).`);
  }
  const spend = Math.min(treasury, plan.penalty + required + 3);
  const roll = optionsOfType(decision, "companyOperation.trade", (payload) => payload.action === "roll" && payload.spend === spend);
  return choose(
    roll[0],
    `${label(state)}: spends £${spend} (${dice(required)} needed${plan.penalty > 0 ? `, ${dice(plan.penalty)} lost to extra regions` : ""}, up to £3 more) for ${route} (Handbook p.13).`,
  );
};

const tradePlacePolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  const activity = currentActivity(state);
  if (!presidency || activity?.kind !== "trade") return undefined;
  const places = optionsOfType(decision, "companyOperation.trade", (payload) => payload.action === "place");
  if (places.length === 0) return undefined;

  // The order: highest value route first, then the home region, then closest to it, then most southerly (p.13).
  const nodes = new Map(Object.values(state.india.regions).flatMap((region) => region.orders.map((order) => [order.id, { order, regionId: region.id }] as const)));
  const allowed = new Set(activity.declared);
  const distances = regionDistances(state, presidency);
  const home = homeRegionOf(state, presidency);
  const orderIds = [...new Set(places.map((command) => payloadOf(command).orderId as string))];
  const scored = orderIds.map((orderId) => {
    const node = nodes.get(orderId)!;
    const rest = bestRoute(state, presidency, allowed, activity.ships, [...activity.placedOrderIds, orderId]);
    return {
      orderId,
      total: orderValue(node.order) + rest.value,
      home: node.regionId === home,
      distance: distances.get(node.regionId) ?? 99,
      south: node.order.boardPosition.y,
    };
  });
  scored.sort((a, b) => b.total - a.total || Number(b.home) - Number(a.home) || a.distance - b.distance || b.south - a.south);
  const best = scored[0];
  const forOrder = places.filter((command) => payloadOf(command).orderId === best.orderId);

  // The writer: the Crown's own first, then the players' (by the Player Button in 2P); the -1 favour picks one.
  const writers = forOrder.map((command) => payloadOf(command).writer as string);
  const why = `${label(state)}: fills ${best.orderId}, the highest value route (Handbook p.13)`;
  if (writers.length === 1 && writers[0] === "token") return choose(forOrder[0], `${why}, with a filled-order token.`);
  const favoured = crownEffects(state, "presidencies.trade.writer").find((effect) => effect.decisionId === decision.id && writers.includes(effect.by));
  if (favoured) {
    return choose(forOrder.find((command) => payloadOf(command).writer === favoured.by), `${why}, placing ${state.players[favoured.by].name}'s writer (favour).`);
  }
  if (writers.includes(CROWN_PLAYER_ID)) {
    return choose(forOrder.find((command) => payloadOf(command).writer === CROWN_PLAYER_ID), `${why}, placing its own writer first.`);
  }
  const pick = crownPickPlayer(state, writers);
  const command = forOrder.find((candidate) => payloadOf(candidate).writer === pick.playerId);
  const choice = choose(command, `${why}, placing ${state.players[pick.playerId ?? ""]?.name ?? "a player"}'s writer${pick.passButton ? " (Player Button)" : ""}.`);
  return choice && pick.passButton ? { ...choice, passButton: true } : choice;
};

// ---------------------------------------------------------------------------------------------
// Trade in China (p.13).

const chinaPolicy: CrownPolicy = (state, decision) => {
  const required = Math.max(1, byClimate(state, [1, 2, 2, 3, 3]) + diceDelta(state, "presidencies.china.dice", "china"));
  const trade = optionsOfType(decision, "companyOperation.china", (payload) => payload.action === "trade");
  const finish = optionsOfType(decision, "companyOperation.china", (payload) => payload.action === "finish");
  if (trade.length > 0 && chinaShips(state) >= required) {
    return choose(trade[0], `${label(state)}: Trades in China, rolling all ${dice(chinaShips(state))} (${dice(required)} needed; Handbook p.13).`);
  }
  return choose(finish[0], `${label(state)}: ${trade.length > 0 ? `only ${dice(chinaShips(state))} to roll against the ${dice(required)} needed` : "no valid Trade in China"}, so it finishes (Handbook p.13).`);
};

// ---------------------------------------------------------------------------------------------
// Commanders (pp.11-12).

const alliancesPolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  const activity = commanderActivity(state);
  if (!presidency || !activity) return undefined;
  const scope = `commander:${presidency}`;
  const asked = activity.alliancesAsked ?? 0;
  const begin = optionsOfType(decision, "companyOperation.commander", (payload) => payload.action === "beginDeploys");
  const buys = optionsOfType(decision, "companyOperation.commander", (payload) => payload.action === "buyAlliance");
  const cost = (command: LegalCommand) => localAlliances.find((alliance) => alliance.id === payloadOf(command).allianceId)!.cost;
  const byCost = [...buys].sort((a, b) => cost(a) - cost(b));

  // What it wants to buy: the chart's purchase first (only before it has bought), then the favour's extras.
  const wanted: Array<{ command: LegalCommand; why: string }> = [];
  const strength = armyStrength(state, presidency);
  const skipChart = isCrownPresident(state, presidency) && hasEffect(state, "presidencies.commander.alliance.none", scope);
  if (asked === 0 && !skipChart && byCost.length > 0) {
    if (climateIs(state, "lion") && strength >= 3) {
      const index = hasEffect(state, "presidencies.commander.alliance.dearer", scope) ? Math.min(1, byCost.length - 1) : 0;
      wanted.push({ command: byCost[index], why: `Army strength ${strength} is 3+, so it buys the ${index === 0 ? "cheapest" : "next more expensive"} affordable Local Alliance` });
    } else if (climateIs(state, "bear", "peacock") && strength >= 2) {
      const index = hasEffect(state, "presidencies.commander.alliance.cheaper", scope) ? Math.max(byCost.length - 2, 0) : byCost.length - 1;
      wanted.push({ command: byCost[index], why: `Army strength ${strength} is 2+, so it buys the ${index === byCost.length - 1 ? "most expensive" : "next less expensive"} affordable Local Alliance` });
    }
  }
  const chart = wanted[0];
  const extras = crownEffects(state, "presidencies.commander.alliance.extra").filter((effect) => (effect.option as { scope?: string } | undefined)?.scope === scope);
  for (const effect of extras) {
    const command = buys.find((candidate) => payloadOf(candidate).allianceId === (effect.option as { allianceId?: string }).allianceId);
    if (command && !wanted.some((entry) => entry.command === command)) wanted.push({ command, why: `buys the extra Local Alliance ${state.players[effect.by].name} chose (favour)` });
  }
  // Asked-for purchases are counted, so a refused one is not asked again.
  const next = chart ?? (asked < 1 + extras.length ? wanted[0] : undefined);
  if (next) return choose(next.command, `${label(state)}: ${next.why} (Handbook p.11).`);
  return choose(
    begin[0],
    asked > 0
      ? `${label(state)}: has bought what it will; on to Deploy (Handbook p.11).`
      : `${label(state)}: ${noPurchaseWhy(state, strength, byCost.length, skipChart)}; on to Deploy (Handbook p.11).`,
  );
};

function noPurchaseWhy(state: GameState, strength: number, affordable: number, skipped: boolean): string {
  if (climateIs(state, "bull", "stag")) return "will not purchase a Local Alliance";
  if (skipped) return "will not purchase a Local Alliance (favour)";
  const needed = climateIs(state, "lion") ? 3 : 2;
  if (strength < needed) return `Army strength ${strength} is under ${needed}, so it buys no Local Alliance`;
  return affordable === 0 ? "no Local Alliance is affordable" : "buys no Local Alliance";
}

/** The regions the Crown Commander aims at, best first: p.12's list for the climate. */
function deployCategories(state: GameState, presidency: PresidencyId): Array<{ why: string; match: (regionId: RegionId) => boolean }> {
  const regions = state.india.regions;
  const home = homeRegionOf(state, presidency);
  const closed = (regionId: RegionId) => regions[regionId].orders.some((order) => order.closed);
  const associated = (regionId: RegionId) => regions[regionId].companyControlled && regionPresidencyId(state, regionId) === presidency;
  const nextToCompany = (regionId: RegionId, only: (neighbour: RegionId) => boolean) =>
    !regions[regionId].companyControlled && regions[regionId].adjacent.some((neighbour) => regions[neighbour].companyControlled && only(neighbour));
  const homeClosed = { why: "the home region with closed orders", match: (regionId: RegionId) => regionId === home && closed(regionId) };
  const associatedClosed = { why: "a Company region of this Presidency with closed orders", match: (regionId: RegionId) => associated(regionId) && closed(regionId) };
  const homeLost = { why: "the home region, not Company-controlled", match: (regionId: RegionId) => regionId === home && !regions[regionId].companyControlled };
  if (climateIs(state, "bull", "stag")) {
    return [
      homeClosed,
      associatedClosed,
      homeLost,
      { why: "a region next to a Company region", match: (regionId) => nextToCompany(regionId, () => true) },
    ];
  }
  return [
    homeLost,
    { why: "a region next to a Company region of this Presidency", match: (regionId) => nextToCompany(regionId, associated) },
    associatedClosed,
  ];
}

const deployPolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  const activity = commanderActivity(state);
  if (!presidency || !activity) return undefined;
  const finish = optionsOfType(decision, "companyOperation.commander", (payload) => payload.action === "finish");
  const deploys = activity.deploys ?? 0;
  const allowed = deploysAllowed(state, presidency);
  if (deploys >= allowed) {
    return choose(finish[0], `${label(state)}: ${deploys === 0 ? "does not Deploy" : "does not Deploy again"} (Handbook p.12).`);
  }
  const targets = optionsOfType(decision, "companyOperation.commander", (payload) => payload.action === "target");
  const feasible = targets.filter((command) => deployFeasible(state, presidency, payloadOf(command).regionId as RegionId));
  for (const category of deployCategories(state, presidency)) {
    const matching = feasible.filter((command) => category.match(payloadOf(command).regionId as RegionId));
    if (matching.length === 0) continue;
    const [first] = byCrownRegionOrder(state, matching, (command) => payloadOf(command).regionId as RegionId);
    const regionId = payloadOf(first).regionId as RegionId;
    return choose(first, `${label(state)}: Deploys against ${state.india.regions[regionId].name}, ${category.why}, with ${dice(deployRequired(state, presidency, regionId))} to roll (Handbook p.12).`);
  }
  return choose(finish[0], `${label(state)}: no target it can reach with exactly the ${targets.length > 0 ? "required dice" : "pieces"}, so it finishes as Commander (Handbook p.12).`);
};

const exhaustPolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state);
  const activity = commanderActivity(state);
  if (!presidency || !activity?.target) return undefined;
  const selection = activity.selection ?? EMPTY_SELECTION;
  const strength = defendingStrength(state, activity.target);
  const required = deployRequired(state, presidency, activity.target);
  const picked =
    Object.values(selection.officers).reduce((total, count) => total + count, 0) +
    selection.regiments +
    selection.alliances.reduce((total, allianceId) => total + (localAlliances.find((alliance) => alliance.id === allianceId)?.strength ?? 0), 0);
  const remaining = required + strength - picked;
  const commanderAction = (name: string) => optionsOfType(decision, "companyOperation.commander", (payload) => payload.action === name);

  if (remaining <= 0) {
    return choose(commanderAction("roll")[0], `${label(state)}: the pieces match the ${dice(required)} to roll (Handbook p.12).`);
  }
  const units = readyUnits(state, presidency, selection);
  // Local Alliances first, then Crown officers, then player officers, then regiments (p.12).
  const playerOfficers = units.filter((unit) => unit.kind === "officer" && unit.playerId !== CROWN_PLAYER_ID);
  const pick = crownPickPlayer(state, [...new Set(playerOfficers.map((unit) => (unit as { playerId: string }).playerId))]);
  const ordered: Unit[] = [
    ...units.filter((unit) => unit.kind === "alliance").sort((a, b) => b.value - a.value),
    ...units.filter((unit) => unit.kind === "officer" && unit.playerId === CROWN_PLAYER_ID),
    ...playerOfficers.filter((unit) => (unit as { playerId: string }).playerId === pick.playerId),
    ...playerOfficers.filter((unit) => (unit as { playerId: string }).playerId !== pick.playerId),
    ...units.filter((unit) => unit.kind === "regiment"),
  ];
  for (const unit of ordered) {
    const others = [...units];
    others.splice(others.indexOf(unit), 1);
    if (unit.value > remaining || !canMake(remaining - unit.value, others.map((other) => other.value))) continue;
    const command =
      unit.kind === "alliance"
        ? commanderAction("exhaustAlliance").find((candidate) => payloadOf(candidate).allianceId === unit.allianceId)
        : unit.kind === "officer"
          ? commanderAction("exhaustOfficer").find((candidate) => payloadOf(candidate).playerId === unit.playerId)
          : commanderAction("exhaustRegiment")[0];
    const choice = choose(
      command,
      `${label(state)}: exhausts ${unit.kind === "alliance" ? "a Local Alliance" : unit.kind === "officer" ? (unit.playerId === CROWN_PLAYER_ID ? "a Crown officer" : `one of ${state.players[unit.playerId].name}'s officers`) : "a regiment"}, ${remaining} dice short of matching the exact ${dice(required)} (Handbook p.12).`,
    );
    return choice && unit.kind === "officer" && unit.playerId === pick.playerId && pick.passButton ? { ...choice, passButton: true } : choice;
  }
  return choose(commanderAction("cancelDeploy")[0], `${label(state)}: the pieces cannot match exactly ${dice(required)}, so it cancels the Deploy (Handbook p.12).`);
};

/** Crown Presidents give the Crown Commander consent; nobody else gets it from the Crown (pp.2, 11). */
const allianceConsentPolicy: CrownPolicy = (state, decision) => {
  const presidency = operatingPresidency(state) ?? (coState(state).interrupt as { presidency?: PresidencyId } | undefined)?.presidency;
  const approve = optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "approveAlliance");
  const refuse = optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "refuseAlliance");
  if (presidency && commanderOf(state, presidency) === CROWN_PLAYER_ID && presidentOf(state, presidency) === CROWN_PLAYER_ID) {
    return choose(approve[0], "Crown Presidents always consent to Crown Commanders' Local Alliances (Handbook p.11).");
  }
  return choose(refuse[0] ?? approve[0], "The Crown gives no consent to a Commander who has not paid for it (Handbook pp.2, 11).");
};

// ---------------------------------------------------------------------------------------------
// Filling orders with firms: the Handbook says nothing for the Crown, so the players choose.

const noFirmRule: CrownPolicy = (_state, decision) => ({
  commands: decision.legalCommands,
  reason: "The Handbook gives the Crown no rule for filling orders with firms, so you choose for the Crown.",
});

// ---------------------------------------------------------------------------------------------
// Events in India (p.14).

const defendPolicy: CrownPolicy = (_state, decision) => ({
  commands: decision.legalCommands,
  reason: "The Crown is a Commander defending a Crisis: you choose which pieces are exhausted (Handbook p.14).",
});

const chooseAttackPolicy: CrownPolicy = (_state, decision) => ({
  commands: decision.legalCommands,
  reason: "The Handbook does not say which Rebellion the Crown Commander faces first, so you choose for the Crown.",
});

/** The Crown's blackmail stays face down (p.2). */
const envoyPolicy: CrownPolicy = (_state, decision) =>
  choose(
    decision.legalCommands.find((command) => payloadOf(command).play === false),
    "The Crown's blackmail cards stay face down (Handbook p.2).",
  );

// ---------------------------------------------------------------------------------------------
// Revenue (p.14).

/** One dividend at least, then as many as leave £0 / 2 / 4 / 6 / 8 in the Company Balance (Bull to Peacock). */
export function crownDividends(state: GameState, maxPerShare: number): { amount: number; leave: number } {
  const leave = byClimate(state, [0, 2, 4, 6, 8]);
  const shares = Math.max(1, companyShareCount(state));
  const wanted = Math.max(1, Math.floor((state.company.balance - leave) / shares));
  const delta = crownEffects(state, "presidencies.dividends.more").length - crownEffects(state, "presidencies.dividends.less").length;
  return { amount: Math.max(0, Math.min(maxPerShare, wanted + delta)), leave };
}

const dividendsPolicy: CrownPolicy = (state, decision) => {
  const amounts = decision.legalCommands.map((command) => payloadOf(command).amountPerShare as number);
  const { amount, leave } = crownDividends(state, Math.max(...amounts));
  if (Math.max(...amounts) === 0) {
    return choose(decision.legalCommands[0], `${label(state)}: the Balance cannot pay even 1 dividend (Handbook p.14).`);
  }
  const delta = crownEffects(state, "presidencies.dividends.more").length - crownEffects(state, "presidencies.dividends.less").length;
  return choose(
    decision.legalCommands.find((command) => payloadOf(command).amountPerShare === amount),
    `${label(state)}: pays ${amount} dividend${amount === 1 ? "" : "s"}, at least 1 and as many as leave £${leave} in the Balance${delta ? ` (${delta > 0 ? "one more" : "one fewer"} by favour)` : ""} (Handbook p.14).`,
  );
};

const royalProtectionPolicy: CrownPolicy = (_state, decision) =>
  choose(
    decision.legalCommands.find((command) => payloadOf(command).discard === true),
    "With emergency loans coming, the Crown always discards Royal Protection (Handbook p.14).",
  );

/** The Crown never invests in a firm seeking emergency investment, unless paid (a favour on this decision). */
const investAskPolicy: CrownPolicy = (_state, decision) =>
  choose(
    decision.legalCommands.find((command) => payloadOf(command).accept === false),
    "The Crown does not invest in a firm seeking emergency investment (Handbook p.14).",
  );

const mergeConsentPolicy: CrownPolicy = (_state, decision) =>
  choose(
    decision.legalCommands.find((command) => payloadOf(command).accept === true),
    "The Crown always gives consent to merging firms (Handbook p.3).",
  );

const waiverPolicy: CrownPolicy = (_state, decision) =>
  choose(
    decision.legalCommands.find((command) => payloadOf(command).forgone === 0),
    "The Crown takes payment on all its firm shares.",
  );

const keepBlackmailPolicy: CrownPolicy = (_state, decision) =>
  choose(
    decision.legalCommands.find((command) => {
      const payload = payloadOf(command);
      return payload.play === false || !payload.cardInstanceId;
    }),
    "The Crown's blackmail cards stay face down (Handbook p.2).",
  );

export const presidencyPolicies: Record<string, CrownPolicy> = {
  "companyOperation.presidency": presidencyPolicy,
  "companyOperation.governor.administer": administerPolicy,
  "companyOperation.governor.choose": governorResultPolicy,
  "companyOperation.trade.declare": tradeDeclarePolicy,
  "companyOperation.trade.place": tradePlacePolicy,
  "companyOperation.china": chinaPolicy,
  "companyOperation.commander.alliances": alliancesPolicy,
  "companyOperation.commander.deploy": deployPolicy,
  "companyOperation.commander.exhaust": exhaustPolicy,
  "companyOperation.allianceConsent": allianceConsentPolicy,
  "companyOperation.firmFill": noFirmRule,
  "companyOperation.firmFillOrder": noFirmRule,
  "eventsInIndia.defend": defendPolicy,
  "eventsInIndia.chooseAttack": chooseAttackPolicy,
  "eventsInIndia.envoyToTheMughals": envoyPolicy,
  "revenue.chooseDividends": dividendsPolicy,
  "revenue.royalProtection": royalProtectionPolicy,
  "revenue.firmInvestAsk": investAskPolicy,
  "revenue.firmMergeConsent": mergeConsentPolicy,
  "revenue.firmWaiver": waiverPolicy,
  "revenue.companyFraud": keepBlackmailPolicy,
  "revenue.playScandal": keepBlackmailPolicy,
};
