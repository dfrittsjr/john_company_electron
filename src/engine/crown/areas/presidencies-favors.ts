import { firmCharter } from "../../../data";
import { firmById, firmInvestmentSources, firmShareTotal } from "../../firms";
import { commanderOf } from "../../selectors";
import type { GameState, LegalCommand, PlayerId, PresidencyId, RegionId } from "../../types";
import type { DeploySelection } from "../../phases/company-operation.state";
import { coState } from "../../phases/company-operation/context";
import { withActivity } from "../../phases/company-operation/presidency-progress";
import { defendingStrength } from "../../phases/company-operation/commander";
import { governorRegion } from "../../phases/company-operation/governor";
import {
  chooseForCrownFavor,
  crownDecidingStep,
  effectFavor,
  printedCost,
  type CrownCubeDetector,
  type CrownFavorDefinition,
  type CrownFavorSource,
} from "../kit";
import { addCrownEffect, crownEffects, CROWN_PLAYER_ID, isCrownPresidency, writersOf } from "../state";
import {
  allianceStrength,
  commanderActivity,
  currentActivity,
  deployRequired,
  diceOptions,
  EMPTY_SELECTION,
  hasEffect,
  isCrownCommander,
  isCrownPresident,
  operatingPresidency,
  payloadOf,
  readyUnits,
} from "./presidencies-shared";

// The favours of Presidency operations, Governors, Commanders, Presidents and China (Handbook
// pp.10-13) and of Revenue (p.14). Dice favours are effects the policies read (presidencies-shared.ts
// diceDelta); the phases end them with clearScopedCrownEffects when the action is over.

const page = (pageNumber: number, text: string, nth?: number): CrownFavorSource => ({ page: pageNumber, text, ...(nth !== undefined ? { nth } : {}) });
const scoped = (scope: string) => [{ label: "", option: { scope } }];

function governorScope(state: GameState): string {
  const activity = currentActivity(state);
  return `governor:${activity?.kind === "governor" ? activity.officeId : ""}`;
}

function commanderScope(state: GameState): string {
  return `commander:${operatingPresidency(state)}`;
}

function crownPresidentHere(state: GameState): PresidencyId | undefined {
  const presidency = operatingPresidency(state);
  return presidency && isCrownPresident(state, presidency) ? presidency : undefined;
}

function pendingAll(state: GameState): LegalCommand[] {
  return state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands;
}

/** True once a "choose for the Crown" style favour has been bought on this decision. */
function boughtOnDecision(state: GameState): boolean {
  return crownEffects(state).some((effect) => effect.decisionId === state.pendingDecision.id && effect.choices);
}

// ---------------------------------------------------------------------------------------------
// Pp.10-11: Presidency operations, Governors, Local Alliances.

const orderFavor = chooseForCrownFavor({
  id: "presidencies.order",
  printed: page(10, "Make a single change"),
  steps: ["companyOperation.presidency"],
  when: (state) => Boolean(crownPresidentHere(state)),
});

const governorDice = effectFavor({
  id: "presidencies.governor.dice",
  printed: page(10, "Increase or decrease the required number of die"),
  available: (state) => crownDecidingStep(state, ["companyOperation.governor.administer"]),
  options: (state) => diceOptions(governorScope(state)),
});

const governorNone = effectFavor({
  id: "presidencies.governor.none",
  printed: page(10, "Take no Administer actions"),
  available: (state) => crownDecidingStep(state, ["companyOperation.governor.administer"]),
  options: (state) => scoped(governorScope(state)),
});

const governorResult = chooseForCrownFavor({
  id: "presidencies.governor.result",
  printed: page(10, "Choose a different result"),
  steps: ["companyOperation.governor.choose"],
});

const allianceConsent: CrownFavorDefinition = {
  id: "presidencies.alliance.consent",
  printed: page(11, "Consent to purchase a Local Alliance"),
  available: (state, playerId) => {
    if (!crownDecidingStep(state, ["companyOperation.allianceConsent"]) || boughtOnDecision(state)) return false;
    const interrupt = coState(state).interrupt;
    return interrupt?.kind === "allianceConsent" && commanderOf(state, interrupt.presidency) === playerId;
  },
  apply: (state, playerId) =>
    addCrownEffect(state, {
      favorId: "presidencies.alliance.consent",
      by: playerId,
      turn: state.turn,
      phase: state.phase,
      decisionId: state.pendingDecision.id,
      choices: pendingAll(state).filter((command) => payloadOf(command).action === "approveAlliance"),
    }),
};

const crownBuysAlliances = (state: GameState) =>
  crownDecidingStep(state, ["companyOperation.commander.alliances"]) && (commanderActivity(state)?.alliancesAsked ?? 0) === 0;

const allianceExtra = effectFavor({
  id: "presidencies.commander.alliance.extra",
  printed: page(11, "Will purchase an additional Local Alliance"),
  available: (state) =>
    crownDecidingStep(state, ["companyOperation.commander.alliances"]) &&
    (commanderActivity(state)?.alliancesAsked ?? 0) <= 1 &&
    !hasEffect(state, "presidencies.commander.alliance.extra", commanderScope(state)) &&
    pendingAll(state).some((command) => payloadOf(command).action === "buyAlliance"),
  options: (state) =>
    pendingAll(state)
      .filter((command) => payloadOf(command).action === "buyAlliance")
      .map((command) => ({
        label: command.label.replace(/ from the President's treasury$/, ""),
        option: { scope: commanderScope(state), allianceId: payloadOf(command).allianceId },
      })),
});

const allianceDearer = effectFavor({
  id: "presidencies.commander.alliance.dearer",
  printed: page(11, "The Crown must purchase a more expensive"),
  available: crownBuysAlliances,
  options: (state) => scoped(commanderScope(state)),
});

const allianceCheaper = effectFavor({
  id: "presidencies.commander.alliance.cheaper",
  printed: page(11, "The Crown must purchase a less expensive"),
  available: crownBuysAlliances,
  options: (state) => scoped(commanderScope(state)),
});

const allianceNone = effectFavor({
  id: "presidencies.commander.alliance.none",
  printed: page(11, "If the Crown has the Presidency"),
  available: (state) => {
    const presidency = operatingPresidency(state);
    return crownBuysAlliances(state) && Boolean(presidency && isCrownPresident(state, presidency));
  },
  options: (state) => scoped(commanderScope(state)),
});

// ---------------------------------------------------------------------------------------------
// P.12: Deploy.

const deployTarget = chooseForCrownFavor({
  id: "presidencies.deploy.target",
  printed: page(12, "Choose a valid region"),
  steps: ["companyOperation.commander.deploy"],
  choices: (_state, decision) => decision.legalCommands.filter((command) => payloadOf(command).action === "target"),
});

const deployDice = effectFavor({
  id: "presidencies.commander.dice",
  printed: page(12, "Increase or decrease the required number of dice"),
  available: (state) => crownDecidingStep(state, ["companyOperation.commander.deploy", "companyOperation.commander.exhaust"]),
  options: (state) => diceOptions(commanderScope(state)),
});

const deployAgain = effectFavor({
  id: "presidencies.commander.again",
  printed: page(12, "The Crown takes the Deploy action again"),
  available: (state) =>
    crownDecidingStep(state, ["companyOperation.commander.deploy", "companyOperation.commander.exhaust"]) &&
    !hasEffect(state, "presidencies.commander.again", commanderScope(state)),
  options: (state) => scoped(commanderScope(state)),
});

const deployNotAgain = effectFavor({
  id: "presidencies.commander.notAgain",
  printed: page(12, "The Crown will not take the Deploy action again"),
  available: (state) =>
    crownDecidingStep(state, ["companyOperation.commander.deploy", "companyOperation.commander.exhaust"]) &&
    !hasEffect(state, "presidencies.commander.notAgain", commanderScope(state)),
  options: (state) => scoped(commanderScope(state)),
});

// "-X: Once pieces have been exhausted and before rolling dice, exchange X value pieces that were
// exhausted for pieces that were not." A Local Alliance of strength X counts as X pieces.
type PieceKind = { key: string; value: number; count: number };
type Swap = { scope: string; out: string[]; in: string[] };

function pieceKinds(state: GameState, presidency: PresidencyId, selection: DeploySelection): { chosen: PieceKind[]; spare: PieceKind[] } {
  const army = state.company.armies[presidency];
  const chosen: PieceKind[] = [];
  const spare: PieceKind[] = [];
  const add = (list: PieceKind[], key: string, value: number, count: number) => {
    if (count > 0) list.push({ key, value, count });
  };
  for (const allianceId of selection.alliances) add(chosen, `alliance:${allianceId}`, allianceStrength(allianceId), 1);
  for (const unit of readyUnits(state, presidency, selection)) {
    if (unit.kind === "alliance") add(spare, `alliance:${unit.allianceId}`, unit.value, 1);
  }
  for (const [playerId, stack] of Object.entries(army.officers)) {
    add(chosen, `officer:${playerId}`, 1, selection.officers[playerId] ?? 0);
    add(spare, `officer:${playerId}`, 1, stack.ready - (selection.officers[playerId] ?? 0));
  }
  add(chosen, "regiment", 1, selection.regiments);
  add(spare, "regiment", 1, army.regiments.ready - selection.regiments);
  return { chosen, spare };
}

/** Every multiset of pieces worth 1 to 3 in total, as lists of kind keys. */
function pieceSets(kinds: PieceKind[]): Array<{ keys: string[]; value: number }> {
  const sets: Array<{ keys: string[]; value: number }> = [];
  const walk = (index: number, keys: string[], value: number) => {
    if (index === kinds.length) {
      if (value >= 1) sets.push({ keys, value });
      return;
    }
    const kind = kinds[index];
    for (let take = 0; take <= kind.count && value + take * kind.value <= 3; take += 1) {
      walk(index + 1, [...keys, ...Array<string>(take).fill(kind.key)], value + take * kind.value);
    }
  };
  walk(0, [], 0);
  return sets;
}

function exchangeSwaps(state: GameState): Swap[] {
  const activity = commanderActivity(state);
  const presidency = operatingPresidency(state);
  if (!activity?.target || !presidency || !isCrownCommander(state, presidency)) return [];
  const selection = activity.selection ?? EMPTY_SELECTION;
  const { chosen, spare } = pieceKinds(state, presidency, selection);
  const swaps: Swap[] = [];
  for (const out of pieceSets(chosen)) {
    for (const incoming of pieceSets(spare)) {
      // Equal value, one piece against one or several; swapping identical pieces does nothing.
      if (out.value !== incoming.value || (out.keys.length > 1 && incoming.keys.length > 1)) continue;
      if (out.keys.length === incoming.keys.length && out.keys.every((key, index) => key === incoming.keys[index])) continue;
      swaps.push({ scope: commanderScope(state), out: out.keys, in: incoming.keys });
    }
  }
  return swaps;
}

function describeKey(state: GameState, key: string): string {
  if (key === "regiment") return "a regiment";
  const [kind, id] = key.split(":");
  if (kind === "officer") return id === CROWN_PLAYER_ID ? "a Crown officer" : `one of ${state.players[id]?.name ?? id}'s officers`;
  return `Local Alliance ${id.replace("alliance-", "")}`;
}

function applySwap(state: GameState, swap: Swap): GameState {
  const presidency = operatingPresidency(state)!;
  const activity = commanderActivity(state)!;
  const selection = activity.selection ?? EMPTY_SELECTION;
  const officers = { ...selection.officers };
  let regiments = selection.regiments;
  let alliances = [...selection.alliances];
  const change = (key: string, direction: 1 | -1) => {
    const [kind, id] = key.split(":");
    if (kind === "officer") officers[id] = (officers[id] ?? 0) + direction;
    else if (kind === "alliance") alliances = direction === 1 ? [...alliances, id] : alliances.filter((candidate) => candidate !== id);
    else regiments += direction;
  };
  for (const key of swap.out) change(key, -1);
  for (const key of swap.in) change(key, 1);
  for (const [playerId, count] of Object.entries(officers)) if (count === 0) delete officers[playerId];
  return withActivity(state, presidency, { ...activity, selection: { officers, regiments, alliances } });
}

function exchangeValue(swap: Swap): number {
  return swap.out.reduce((total, key) => total + (key.startsWith("alliance:") ? allianceStrength(key.slice(9)) : 1), 0);
}

const deployExchange: CrownFavorDefinition = {
  id: "presidencies.commander.exchange",
  printed: page(12, "Once pieces have been exhausted"),
  available: (state) => {
    if (!crownDecidingStep(state, ["companyOperation.commander.exhaust"])) return false;
    const presidency = operatingPresidency(state);
    const activity = commanderActivity(state);
    if (!presidency || !activity?.target) return false;
    // Only once the pieces match, just before the roll.
    const picked = pieceKinds(state, presidency, activity.selection ?? EMPTY_SELECTION).chosen.reduce((total, kind) => total + kind.value * kind.count, 0);
    return picked - defendingStrength(state, activity.target) >= deployRequired(state, presidency, activity.target) && exchangeSwaps(state).length > 0;
  },
  options: (state) =>
    exchangeSwaps(state).map((swap) => ({
      label: `${swap.out.map((key) => describeKey(state, key)).join(" + ")} for ${swap.in.map((key) => describeKey(state, key)).join(" + ")}`,
      option: swap,
    })),
  cost: (_state, _playerId, option) => -exchangeValue(option as Swap),
  apply: (state, _playerId, option) => applySwap(state, option as Swap),
};

// ---------------------------------------------------------------------------------------------
// P.13: Trade, filling orders, China.

const tradeDice = effectFavor({
  id: "presidencies.trade.dice",
  printed: page(13, "Increase or decrease the required number of dice", 0),
  available: (state) => {
    const presidency = crownPresidentHere(state);
    return (
      Boolean(presidency) &&
      crownDecidingStep(state, ["companyOperation.presidency", "companyOperation.trade.declare"]) &&
      !(coState(state).tradedPresidencies ?? []).includes(presidency!)
    );
  },
  options: (state) => diceOptions(`trade:${operatingPresidency(state)}`),
});

const tradeWriter = effectFavor({
  id: "presidencies.trade.writer",
  printed: page(13, "The Crown places your writer instead"),
  available: (state, playerId) => {
    if (!crownDecidingStep(state, ["companyOperation.trade.place"])) return false;
    if (crownEffects(state, "presidencies.trade.writer").some((effect) => effect.decisionId === state.pendingDecision.id)) return false;
    const writers = new Set(pendingAll(state).map((command) => payloadOf(command).writer));
    return writers.has(playerId) && writers.size > 1;
  },
});

const chinaDice = effectFavor({
  id: "presidencies.china.dice",
  printed: page(13, "Increase or decrease the required number of dice", 1),
  available: (state) => crownDecidingStep(state, ["companyOperation.china"]),
  options: () => diceOptions("china"),
});

// ---------------------------------------------------------------------------------------------
// P.14: Revenue.

const dividendsLess = effectFavor({
  id: "presidencies.dividends.less",
  printed: page(14, "The Crown pays out 1 less dividend"),
  available: (state) => crownDecidingStep(state, ["revenue.chooseDividends"]),
});

const dividendsMore = effectFavor({
  id: "presidencies.dividends.more",
  printed: page(14, "The Crown pays out 1 more dividend"),
  available: (state) => crownDecidingStep(state, ["revenue.chooseDividends"]),
});

/** "The Crown invests in your firm" for -4: the Crown's answer to the manager's ask becomes yes. */
const investBribe: CrownFavorDefinition = {
  id: "presidencies.firm.invest",
  printed: page(14, "The Crown invests in your firm"),
  available: (state, playerId) => {
    if (!crownDecidingStep(state, ["revenue.firmInvestAsk"]) || boughtOnDecision(state)) return false;
    const progress = state.parliament.revenue?.firms;
    const firm = progress ? firmById(state, progress.queue[0]) : undefined;
    if (!firm || firm.manager !== playerId || progress?.ask?.investor !== CROWN_PLAYER_ID) return false;
    // Company shares first (unless weak), then workshops.
    if (progress.ask.source.kind === "workshop" && firmInvestmentSources(state, CROWN_PLAYER_ID).some((source) => source.kind === "companyShare")) return false;
    // Not if it leaves the Crown with more shares in the firm than the manager.
    const created = firmShareTotal(firm) < firmCharter.maxShares ? 1 : 0;
    return (firm.shares[CROWN_PLAYER_ID] ?? 0) + created <= (firm.shares[firm.manager] ?? 0);
  },
  apply: (state, playerId) =>
    addCrownEffect(state, {
      favorId: "presidencies.firm.invest",
      by: playerId,
      turn: state.turn,
      phase: state.phase,
      decisionId: state.pendingDecision.id,
      choices: pendingAll(state).filter((command) => payloadOf(command).accept === true),
    }),
};

export const presidencyFavors: CrownFavorDefinition[] = [
  orderFavor,
  governorDice,
  governorNone,
  governorResult,
  allianceConsent,
  allianceExtra,
  allianceDearer,
  allianceCheaper,
  allianceNone,
  deployTarget,
  deployDice,
  deployExchange,
  deployAgain,
  deployNotAgain,
  tradeDice,
  tradeWriter,
  chinaDice,
  dividendsLess,
  dividendsMore,
  investBribe,
];

// ---------------------------------------------------------------------------------------------
// Cube detectors: favours that describe something a player does.

type Logged = { turn: number; type: string; actor?: string; summary: string };

/** How many of this turn's logged commands by players match (the current command is among them). */
function loggedThisTurn(state: GameState, type: string, pattern: RegExp): number {
  return (state.log as Logged[]).filter((entry) => entry.turn === state.turn && entry.type === type && entry.actor !== CROWN_PLAYER_ID && pattern.test(entry.summary)).length;
}

function presidencyBefore(before: GameState): PresidencyId | undefined {
  const current = coState(before).current;
  return current?.office === "presidency" ? current.presidency : undefined;
}

const governorTaxToCrown: CrownCubeDetector = {
  favorId: "presidencies.governor.tax",
  printed: page(10, "Add money from a Tax Administer action"),
  detect: (before, after, command) => {
    const payload = payloadOf(command);
    const presidency = presidencyBefore(before);
    if (command.type !== "companyOperation.governor" || payload.action !== "tax" || payload.to !== "president") return [];
    if (!presidency || !isCrownPresidency(before, presidency)) return [];
    // Once per turn per Presidency.
    if (loggedThisTurn(after, "companyOperation.governor", new RegExp(`taxed £\\d+ to the President of ${presidency}`)) !== 1) return [];
    return [{ playerId: command.actorId as PlayerId, cubes: 1, reason: `taxed into the Crown's Presidency of ${presidency} (Handbook p.10)` }];
  },
};

const governorShipToCrown: CrownCubeDetector = {
  favorId: "presidencies.governor.ship",
  printed: page(10, "Move a Company ship into the sea zone"),
  detect: (before, _after, command) => {
    const payload = payloadOf(command);
    const current = coState(before).current;
    if (command.type !== "companyOperation.governor" || payload.action !== "buildShip" || current?.office !== "presidency") return [];
    const activity = current.activity;
    if (activity?.kind !== "governor" || !isCrownPresidency(before, current.presidency)) return [];
    // Launching: the ship was already started in the Governor's region.
    if (!before.india.regions[governorRegion(before, activity.officeId)].partialCompanyShip) return [];
    return [{ playerId: command.actorId as PlayerId, cubes: 1, reason: `launched a Company ship into the sea of the Crown's ${current.presidency} (Handbook p.10)` }];
  },
};

const governorRegimentToCrown: CrownCubeDetector = {
  favorId: "presidencies.governor.regiment",
  printed: page(10, "Commission Regiment into an Army"),
  detect: (before, after, command) => {
    const payload = payloadOf(command);
    const presidency = presidencyBefore(before);
    if (command.type !== "companyOperation.governor" || payload.action !== "commissionRegiment") return [];
    if (!presidency || !isCrownPresidency(before, presidency)) return [];
    if (loggedThisTurn(after, "companyOperation.governor", new RegExp(`commissioned a regiment for the Army of ${presidency}`)) !== 1) return [];
    return [{ playerId: command.actorId as PlayerId, cubes: 1, reason: `commissioned a regiment for the Crown's Army of ${presidency} (Handbook p.10)` }];
  },
};

/** The Deploy a command has just resolved: its Presidency, target and the pieces used. */
function resolvedDeploy(before: GameState): { presidency: PresidencyId; target: RegionId; selection: DeploySelection } | undefined {
  const co = coState(before);
  const current = co.current;
  if (current?.office !== "presidency") return undefined;
  if (co.interrupt?.kind === "connection" && co.interrupt.check.context === "deploy") {
    return { presidency: current.presidency, target: co.interrupt.check.target, selection: co.interrupt.check.selection };
  }
  const activity = current.activity;
  if (activity?.kind === "commander" && activity.stage === "exhaust" && activity.target && activity.selection) {
    return { presidency: current.presidency, target: activity.target, selection: activity.selection };
  }
  return undefined;
}

const crownOfficerSource = page(11, "Successfully complete a Deploy action in a non-Company");
const crownWriterSource = page(11, "Successfully complete a Deploy action in a Company-controlled");

const deployWithCrownOfficers: CrownCubeDetector = {
  favorId: "presidencies.deploy.crownOfficers",
  printed: crownOfficerSource,
  detect: (before, after) => {
    const deploy = resolvedDeploy(before);
    if (!deploy || printedCost(after, crownOfficerSource) === undefined) return [];
    const commander = commanderOf(before, deploy.presidency);
    const taken = !before.india.regions[deploy.target].companyControlled && after.india.regions[deploy.target].companyControlled;
    if (!commander || commander === CROWN_PLAYER_ID || !taken || (deploy.selection.officers[CROWN_PLAYER_ID] ?? 0) === 0) return [];
    return [{ playerId: commander, cubes: 1, reason: `took ${before.india.regions[deploy.target].name} using Crown officers (Handbook p.11)` }];
  },
};

const deployInCrownRegion: CrownCubeDetector = {
  favorId: "presidencies.deploy.crownWriters",
  printed: crownWriterSource,
  detect: (before, after) => {
    const deploy = resolvedDeploy(before);
    if (!deploy || printedCost(after, crownWriterSource) === undefined) return [];
    const commander = commanderOf(before, deploy.presidency);
    const region = before.india.regions[deploy.target];
    const restored = region.orders.some((order) => order.closed) || region.unrest > 0;
    const after_ = after.india.regions[deploy.target];
    const done = !after_.orders.some((order) => order.closed) && after_.unrest === 0;
    const presidency = region.associatedPresidency ?? region.homePresidency;
    if (!commander || commander === CROWN_PLAYER_ID || !region.companyControlled || !restored || !done || !presidency) return [];
    if (!isCrownPresidency(before, presidency) || writersOf(before, presidency, CROWN_PLAYER_ID) < 1) return [];
    return [{ playerId: commander, cubes: 1, reason: `restored ${region.name}, a region of the Crown's ${presidency} with a Crown writer (Handbook p.11)` }];
  },
};

const allianceConsentGift: CrownCubeDetector = {
  favorId: "presidencies.alliance.consentGift",
  printed: page(11, "Give consent to the Crown purchasing"),
  detect: (before, _after, command) => {
    const interrupt = coState(before).interrupt;
    if (command.type !== "companyOperation.interrupt" || payloadOf(command).action !== "approveAlliance") return [];
    if (interrupt?.kind !== "allianceConsent" || commanderOf(before, interrupt.presidency) !== CROWN_PLAYER_ID) return [];
    const paid = hasEffect(before, "presidencies.commander.alliance.extra", `commander:${interrupt.presidency}`);
    if (paid) return [];
    return [{ playerId: command.actorId as PlayerId, cubes: 1, reason: `consented to the Crown Commander's Local Alliance in ${interrupt.presidency} (Handbook p.11)` }];
  },
};

/** "+X [mandatory]: Place X Crown writers when filling orders": X cubes for the human President who does. */
const crownWritersPlaced: CrownCubeDetector = {
  favorId: "presidencies.trade.crownWriters",
  printed: page(13, "Place X Crown writers"),
  detect: (before, after, command) => {
    if (command.type !== "companyOperation.trade" || payloadOf(command).action !== "place") return [];
    const count = (state: GameState) =>
      Object.values(state.india.regions).reduce(
        (total, region) => total + region.orders.filter((order) => order.writer?.playerId === CROWN_PLAYER_ID).length,
        0,
      );
    const placed = count(after) - count(before);
    return placed > 0 ? [{ playerId: command.actorId as PlayerId, cubes: placed, reason: `placed ${placed} Crown writer${placed === 1 ? "" : "s"} when filling orders (Handbook p.13)` }] : [];
  },
};

/** "+X: pay the Crown firm share dividends equal to or more than any other player": X = its firm shares (max 3). */
const firmDividendSource = page(14, "If you pay the Crown firm share dividends");
const firmDividends: CrownCubeDetector = {
  favorId: "presidencies.firm.dividends",
  printed: firmDividendSource,
  detect: (before, after) => {
    const was = before.parliament.revenue?.firms;
    const now = after.parliament.revenue?.firms;
    if (!was || !now || was.queue[0] !== now.queue[0] || now.dividendsPaid <= was.dividendsPaid) return [];
    const firm = firmById(before, was.queue[0]);
    const crownShares = firm?.shares[CROWN_PLAYER_ID] ?? 0;
    if (!firm || crownShares === 0) return [];
    // What each shareholder was paid, leaving out the manager's own dividend.
    const paid = (playerId: PlayerId) =>
      (after.players[playerId]?.cash ?? 0) - (before.players[playerId]?.cash ?? 0) - (playerId === firm.manager ? firmCharter.managerDividendShares : 0);
    const crown = paid(CROWN_PLAYER_ID);
    const others = Object.keys(firm.shares).filter((playerId) => playerId !== CROWN_PLAYER_ID);
    if (crown <= 0 || others.some((playerId) => paid(playerId) > crown)) return [];
    return [{ playerId: firm.manager, cubes: Math.min(3, crownShares), reason: `paid the Crown's ${crownShares} firm share${crownShares === 1 ? "" : "s"} at least as much as anyone (Handbook p.14)` }];
  },
};

export const presidencyDetectors: CrownCubeDetector[] = [
  governorTaxToCrown,
  governorShipToCrown,
  governorRegimentToCrown,
  deployWithCrownOfficers,
  deployInCrownRegion,
  allianceConsentGift,
  crownWritersPlaced,
  firmDividends,
];
