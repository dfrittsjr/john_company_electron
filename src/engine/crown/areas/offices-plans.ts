import type { ChairmanPayload, DebtConsentPayload } from "../../phases/company-operation/chairman";
import { coState, presidentOfficeId } from "../../phases/company-operation/context";
import type { DirectorPayload } from "../../phases/company-operation/director-of-trade";
import type { GovernorGeneralPayload } from "../../phases/company-operation/governor-general";
import type { MilitaryPayload } from "../../phases/company-operation/military-affairs";
import type { ShippingPayload } from "../../phases/company-operation/shipping";
import type { OfficeMove } from "../../phases/company-operation.state";
import { PRESIDENCY_IDS, officeHolder } from "../../selectors";
import type { ArmyId, CrownClimate, GameState, LegalCommand, OfficeId, PendingDecision, PlayerId, PresidencyId, ShipState } from "../../types";
import { choose, type CrownChoice } from "../kit";
import {
  CROWN_PLAYER_ID,
  climateName,
  crownClimate,
  crownEffects,
  crownPickPlayer,
  crownRegionOrder,
} from "../state";
import {
  aiOrder,
  allWriters,
  armyTotals,
  crownIsCommander,
  crownIsGovernor,
  crownHasArmyMajority,
  crownHasOfficerMajority,
  crownPresidencies,
  crownWriters,
  extreme,
  hasMajority,
  hasOpenHomePort,
  isCrownShip,
  majorityHolder,
  ownerOfShip,
  playerIsCommander,
  playerPresidencies,
  playerWriters,
  preferredShips,
  presidencyOfZone,
  seaZoneOf,
  ships,
  tradeRoute,
} from "./offices-metrics";

// What the Crown does in the office steps (Handbook pp.4-9), as pure plans over the decision's legal
// commands. ./offices.ts registers them as policies; ./offices-favors.ts reuses the ones a favour
// changes.

const CROWN = CROWN_PLAYER_ID;

/** "Bull: ..." Every reason names the climate and what the Handbook says. */
export function why(state: GameState, text: string): string {
  return `${climateName(crownClimate(state))}: ${text}`;
}

function payloadOf<T>(command: LegalCommand): T {
  return command.payload as T;
}

function effectCount(state: GameState, favorId: string): number {
  return crownEffects(state, favorId).length;
}

function choice(commands: LegalCommand[], reason: string): CrownChoice | undefined {
  return commands.length > 0 ? { commands, reason } : undefined;
}

// =============================================================================================
// Chairman (pp.4-5)
// =============================================================================================

type ChairmanProgress = { debtAdvances: number; consentRefused: boolean; allocated?: Partial<Record<OfficeId, number>> };

export function chairmanProgress(state: GameState): ChairmanProgress {
  const current = coState(state).current;
  return current?.office === "chairman" ? current : { debtAdvances: 0, consentRefused: false };
}

const DEBT_RULE: Record<CrownClimate, string> = {
  bull: "advance Debt for each Presidency with an open home port",
  stag: "advance Debt for each Presidency with an open home port",
  lion: "advance Debt for each sea zone with fewer than 2 ships",
  bear: "advance Debt for each Presidency where the Crown is Commander or has the most Army pieces",
  peacock: "do not advance Debt",
};

/** How many times the Crown Chairman advances the Debt marker (p.5), favours included. */
export function debtAdvancesWanted(state: GameState): number {
  const climate = crownClimate(state);
  let base = 0;
  if (climate === "bull" || climate === "stag") base = PRESIDENCY_IDS.filter((presidency) => hasOpenHomePort(state, presidency)).length;
  else if (climate === "lion") base = PRESIDENCY_IDS.filter((presidency) => ships(state, presidency) < 2).length;
  else if (climate === "bear") {
    base = PRESIDENCY_IDS.filter((army) => crownIsCommander(state, army) || crownHasArmyMajority(state, army)).length;
  }
  return Math.max(0, base + effectCount(state, "chairman.debtMore") - effectCount(state, "chairman.debtLess"));
}

type Wish = { officeId: OfficeId; amount: number; rule: string };

/** The Director of Trade's treasury is the Governor General's once that office exists (p.26). */
export function directorOffice(state: GameState): OfficeId {
  return state.company.governorGeneralInPlay ? "governor-general" : "director-of-trade";
}

/** "Allocate funds in priority order" (p.5): who should get how much, top of the list first. */
export function allocationWishes(state: GameState): Wish[] {
  const climate = crownClimate(state);
  const wishes: Wish[] = [];
  const give = (officeId: OfficeId, amount: number, rule: string) => {
    if (amount > 0) wishes.push({ officeId, amount, rule });
  };
  const presidencies = (filter: (presidency: PresidencyId) => boolean) => aiOrder(state, PRESIDENCY_IDS.filter(filter));
  const eachPresidency = (amount: number, rule: string, filter: (presidency: PresidencyId) => boolean) => {
    for (const presidency of presidencies(filter)) give(presidentOfficeId(presidency), amount, rule);
  };
  const dot = directorOffice(state);
  const crownGovernorGeneral = () =>
    state.company.governorGeneralInPlay && officeHolder(state, "governor-general") === CROWN ? "governor-general" : undefined;

  if (climate === "bull") {
    eachPresidency(4, "£4 to each Presidency with an open home port", (presidency) => hasOpenHomePort(state, presidency));
    give(dot, 5, "£5 to the Director of Trade / Governor General");
  } else if (climate === "stag") {
    eachPresidency(4, "£4 to each Crown Presidency with an open home port", (presidency) =>
      crownPresidencies(state).includes(presidency) && hasOpenHomePort(state, presidency),
    );
    eachPresidency(1, "£1 to each Presidency with a Crown writer", (presidency) => crownWriters(state, presidency) > 0);
    give(dot, 3, "£3 to the Director of Trade / Governor General");
  } else if (climate === "lion") {
    give(
      "manager-of-shipping",
      5 * PRESIDENCY_IDS.filter((presidency) => ships(state, presidency) < 2).length,
      "£5 to the Manager of Shipping for each Presidency with a sea zone of fewer than 2 ships",
    );
    const busiest = extreme(state, crownPresidencies(state), (presidency) => ships(state, presidency), "most")[0];
    if (busiest) give(presidentOfficeId(busiest), 4, "£4 to the Crown Presidency with the most ships");
    give(dot, 3, "£3 to the Director of Trade / Governor General");
    eachPresidency(1, "£1 to each Presidency with a Crown writer", (presidency) => crownWriters(state, presidency) > 0);
  } else if (climate === "bear") {
    eachPresidency(4, "£4 to each Presidency where the Crown has a majority of Army pieces", (presidency) =>
      crownHasArmyMajority(state, presidency),
    );
    eachPresidency(2, "£2 to each Presidency with a Crown Governor", (presidency) => crownIsGovernor(state, presidency));
    const governorGeneral = crownGovernorGeneral();
    if (governorGeneral) give(governorGeneral, 4, "£4 to the Crown Governor General");
    eachPresidency(2, "£2 to each Presidency with a Crown writer", (presidency) => crownWriters(state, presidency) > 0);
  } else {
    eachPresidency(5, "£5 to each Presidency where the Crown is Commander or has a majority of officers", (presidency) =>
      crownIsCommander(state, presidency) || crownHasOfficerMajority(state, presidency),
    );
    eachPresidency(2, "£2 to each Presidency with a Crown Governor", (presidency) => crownIsGovernor(state, presidency));
    const governorGeneral = crownGovernorGeneral();
    if (governorGeneral) give(governorGeneral, 5, "£5 to the Crown Governor General");
  }
  return wishes;
}

export function chairmanPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const progress = chairmanProgress(state);
  const find = (action: ChairmanPayload["action"]) =>
    decision.legalCommands.filter((command) => payloadOf<ChairmanPayload>(command).action === action);

  // Seek Debt first.
  const wanted = debtAdvancesWanted(state);
  const debt = find("debt")[0];
  if (debt && progress.debtAdvances < wanted) {
    return choose(debt, why(state, `Seek Debt: ${DEBT_RULE[crownClimate(state)]} (advance ${progress.debtAdvances + 1} of ${wanted}).`));
  }

  // Allocate the Company Balance in priority order, giving as much as possible to a step that can't
  // be filled in full; what is left goes to the Manager of Shipping.
  const balance = state.company.balance;
  if (balance > 0) {
    const given = { ...progress.allocated };
    const allocations = find("allocate");
    for (const wish of allocationWishes(state)) {
      const have = given[wish.officeId] ?? 0;
      const used = Math.min(have, wish.amount);
      given[wish.officeId] = have - used;
      const owed = wish.amount - used;
      if (owed <= 0) continue;
      const amount = Math.min(owed, balance);
      const command = allocations.find((candidate) => {
        const payload = payloadOf<Extract<ChairmanPayload, { action: "allocate" }>>(candidate);
        return payload.officeId === wish.officeId && payload.amount === amount;
      });
      if (command) {
        const note = amount < owed ? ` (all that is left of the £${owed})` : "";
        return choose(command, why(state, `Allocate: ${wish.rule}${note}.`));
      }
    }
    const rest = allocations.find((candidate) => {
      const payload = payloadOf<Extract<ChairmanPayload, { action: "allocate" }>>(candidate);
      return payload.officeId === "manager-of-shipping" && payload.amount === balance;
    });
    return choose(rest, why(state, `Allocate: the remaining £${balance} goes to the Manager of Shipping.`));
  }
  return choose(find("finish")[0], why(state, "The Company Balance is allocated."));
}

/** Debt consent (p.2): "If any card requires permission or consent from the Crown, they will not give it". */
export function debtConsentPolicy(_state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const refuse = decision.legalCommands.find((command) => !payloadOf<DebtConsentPayload>(command).accepted);
  return choose(refuse, "The Crown's shares do not consent to more Debt (Handbook p.2) unless a favour pays for it (p.4).");
}

export function consentCommands(decision: PendingDecision): LegalCommand[] {
  return decision.legalCommands.filter((command) => payloadOf<DebtConsentPayload>(command).accepted);
}

// =============================================================================================
// Director of Trade (pp.6-7) and Governor General (p.7)
// =============================================================================================

export type DirectorProgress = { stage: "envoy" | "envoyEffect" | "transfers"; transfersMade: number; envoys?: number; moves?: OfficeMove[] };

export function directorProgress(state: GameState): DirectorProgress {
  const current = coState(state).current;
  return current?.office === "director-of-trade" ? current : { stage: "envoy", transfersMade: 0 };
}

export const ENVOY_COST = 3;

/**
 * The closed order the Crown's Special Envoy opens: the northernmost one in the first region on the
 * AI card's strip that the Company does not control (p.6).
 */
export function envoyTargetOrder(state: GameState): string | undefined {
  for (const regionId of crownRegionOrder(state)) {
    const region = state.india.regions[regionId];
    if (!region || region.companyControlled) continue;
    const closed = region.orders.filter((order) => order.closed);
    if (closed.length === 0) continue;
    return closed.reduce((best, order) => (order.boardPosition.y < best.boardPosition.y ? order : best)).id;
  }
  return undefined;
}

export type EnvoyForce = { spend: number; stop: boolean; at: number };

function directorPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const progress = directorProgress(state);
  if (progress.stage === "envoy") return envoyPolicy(state, decision, progress);
  if (progress.stage === "envoyEffect") return envoyEffectPolicy(state, decision);
  return directorTransfersPolicy(state, decision, progress);
}

function envoyPolicy(state: GameState, decision: PendingDecision, progress: DirectorProgress): CrownChoice | undefined {
  const sent = progress.envoys ?? 0;
  const stop = decision.legalCommands.find((command) => payloadOf<DirectorPayload>(command).action === "stopEnvoys");
  const envoyWith = (spend: number) =>
    decision.legalCommands.find((command) => {
      const payload = payloadOf<DirectorPayload>(command);
      return payload.action === "envoy" && payload.spend === spend;
    });

  // "Force the Crown to spend more or less money (any amount, including zero, and optionally skip
  // additional Special Envoy actions)" (favour, p.6).
  const forces = crownEffects(state, "director.spend").map((effect) => effect.option as EnvoyForce);
  const force = forces.filter((candidate) => candidate.at === sent).pop();
  if (forces.some((candidate) => candidate.stop && candidate.at === sent - 1)) {
    return choose(stop, why(state, "Special Envoy: a favour ended the Special Envoy actions."));
  }
  if (force) {
    const command = force.spend > 0 ? envoyWith(force.spend) : undefined;
    return choose(command ?? stop, why(state, force.spend > 0 ? `Special Envoy with £${force.spend} (favour).` : "Special Envoy: no money spent (favour)."));
  }

  const treasury = state.company.offices[directorOffice(state)]?.treasury ?? 0;
  const target = envoyTargetOrder(state);
  if (treasury >= ENVOY_COST && target) {
    return choose(envoyWith(ENVOY_COST), why(state, `Special Envoy with exactly £${ENVOY_COST}, aimed at the northernmost closed order in the first open region (${target}).`));
  }
  return choose(stop, why(state, `Special Envoy: ${treasury < ENVOY_COST ? `only £${treasury} left, £${ENVOY_COST} needed` : "no closed order outside Company control"}; on to transfers.`));
}

function envoyEffectPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const target = envoyTargetOrder(state);
  const command = decision.legalCommands.find((candidate) => {
    const payload = payloadOf<DirectorPayload>(candidate);
    return payload.action === "openOrder" && payload.orderId === target;
  });
  return choose(command, why(state, `Special Envoy opens the northernmost closed order in the first priority region (${target}).`));
}

// --- Transfers (pp.6-7) ---

type Metric = "route" | "ships" | "crownWriters" | "playerWriters";
type Pick = { by: "most" | "fewest"; metric: Metric } | { set: "crown" | "player" } | { china: true };
type TransferItem = "crownWriter" | "playerWriter" | "ship";
type TransferRule = { text: string; item: TransferItem; from: Pick; to: Pick };

const most = (metric: Metric): Pick => ({ by: "most", metric });
const fewest = (metric: Metric): Pick => ({ by: "fewest", metric });

/** The Transfer Priority List, Director of Trade / Governor General (p.7), top to bottom. */
export const TRANSFER_RULES: Record<CrownClimate, TransferRule[]> = {
  bull: [
    { text: "a Crown writer from the shortest trade route to the longest", item: "crownWriter", from: fewest("route"), to: most("route") },
    { text: "a ship from the shortest trade route to the longest", item: "ship", from: fewest("route"), to: most("route") },
    { text: "a player writer from the longest trade route to the shortest", item: "playerWriter", from: most("route"), to: fewest("route") },
  ],
  stag: [
    { text: "a ship from the shortest trade route to the longest", item: "ship", from: fewest("route"), to: most("route") },
    { text: "a Crown writer from the fewest ships to the most", item: "crownWriter", from: fewest("ships"), to: most("ships") },
    { text: "a player writer from the longest trade route to the shortest", item: "playerWriter", from: most("route"), to: fewest("route") },
  ],
  lion: [
    { text: "a ship from the fewest Crown writers to the most", item: "ship", from: fewest("crownWriters"), to: most("crownWriters") },
    { text: "a Crown writer from the fewest ships to the most", item: "crownWriter", from: fewest("ships"), to: most("ships") },
    { text: "a ship from the fewest Crown writers to China", item: "ship", from: fewest("crownWriters"), to: { china: true } },
    { text: "a ship from the most player writers to the fewest", item: "ship", from: most("playerWriters"), to: fewest("playerWriters") },
  ],
  bear: [
    { text: "a ship from a player Presidency to a Crown Presidency", item: "ship", from: { set: "player" }, to: { set: "crown" } },
    { text: "a Crown writer from the fewest ships to the most", item: "crownWriter", from: fewest("ships"), to: most("ships") },
    { text: "a Crown writer from a player Presidency to a Crown Presidency", item: "crownWriter", from: { set: "player" }, to: { set: "crown" } },
  ],
  peacock: [
    { text: "a Crown writer from a player Presidency to a Crown Presidency", item: "crownWriter", from: { set: "player" }, to: { set: "crown" } },
    { text: "a ship from the fewest Crown writers to the most", item: "ship", from: fewest("crownWriters"), to: most("crownWriters") },
    { text: "a ship from the fewest Crown writers to the most", item: "ship", from: fewest("crownWriters"), to: most("crownWriters") },
    { text: "a player writer from a player Presidency to a Crown Presidency", item: "playerWriter", from: { set: "player" }, to: { set: "crown" } },
  ],
};

function metricValue(state: GameState, metric: Metric): (presidency: PresidencyId) => number {
  switch (metric) {
    case "route":
      return (presidency) => tradeRoute(state, presidency);
    case "ships":
      return (presidency) => ships(state, presidency);
    case "crownWriters":
      return (presidency) => crownWriters(state, presidency);
    case "playerWriters":
      return (presidency) => playerWriters(state, presidency);
  }
}

/**
 * The candidates a pick selects, in the order to try them (ties by the AI card, p.45). "Fewest" and
 * "most" compare every Presidency (but `besides`, the one moved from), not just those with something
 * to move: if the Presidency with the fewest ships has no Crown writer, that transfer can't be made.
 */
function ranked(state: GameState, pick: Pick, candidates: PresidencyId[], besides?: PresidencyId): PresidencyId[] {
  if ("by" in pick) {
    const all = PRESIDENCY_IDS.filter((presidency) => presidency !== besides);
    return extreme(state, all, metricValue(state, pick.metric), pick.by).filter((presidency) => candidates.includes(presidency));
  }
  if ("set" in pick) {
    const allowed = pick.set === "crown" ? crownPresidencies(state) : playerPresidencies(state);
    return aiOrder(state, candidates.filter((presidency) => allowed.includes(presidency)));
  }
  return [];
}

type TransferOption = { command: LegalCommand; from: PresidencyId; to: PresidencyId | "china"; owner?: PlayerId; ship?: ShipState };

/** Whether a Director of Trade transfer would undo one already made this turn (p.6). */
export function undoesDirectorMove(payload: DirectorPayload, moves: OfficeMove[]): boolean {
  if (payload.action === "moveWriter") {
    return moves.some((move) => move.kind === "writer" && move.playerId === payload.playerId && move.from === payload.to && move.to === payload.from);
  }
  if (payload.action === "moveShip") {
    return moves.some((move) => move.kind === "ship" && move.shipId === payload.shipId && move.from === payload.to);
  }
  return false;
}

/** Whether an Army transfer would undo one already made this turn (p.9). */
export function undoesArmyMove(payload: MilitaryPayload, moves: OfficeMove[]): boolean {
  if (payload.action === "moveRegiment") {
    return moves.some((move) => move.kind === "regiment" && move.from === payload.to && move.to === payload.from);
  }
  if (payload.action === "moveOfficer") {
    return moves.some((move) => move.kind === "officer" && move.playerId === payload.playerId && move.from === payload.to && move.to === payload.from);
  }
  return false;
}

function transferOptions(state: GameState, legal: LegalCommand[], item: TransferItem, moves: OfficeMove[]): TransferOption[] {
  const options: TransferOption[] = [];
  for (const command of legal) {
    const payload = payloadOf<DirectorPayload>(command);
    if (payload.action === "moveWriter" && item !== "ship") {
      if ((payload.playerId === CROWN) !== (item === "crownWriter")) continue;
      if (undoesDirectorMove(payload, moves)) continue;
      options.push({ command, from: payload.from, to: payload.to, owner: payload.playerId });
    } else if (payload.action === "moveShip" && item === "ship") {
      const ship = state.company.ships.find((candidate) => candidate.id === payload.shipId);
      const from = ship ? presidencyOfZone(ship.location) : undefined;
      if (!ship || !from) continue;
      if (undoesDirectorMove(payload, moves)) continue;
      options.push({ command, from, to: payload.to === "china" ? "china" : (presidencyOfZone(payload.to) as PresidencyId), ship });
    }
  }
  return options;
}

/** Between several players' pieces the Crown takes the Button holder's (p.44). */
function pickOwner<T extends { owner?: PlayerId }>(state: GameState, options: T[]): { option: T; passButton: boolean } | undefined {
  const humans = [...new Set(options.map((option) => option.owner).filter((owner): owner is PlayerId => Boolean(owner) && owner !== CROWN))];
  if (humans.length > 1) {
    const picked = crownPickPlayer(state, humans);
    const option = options.find((candidate) => candidate.owner === picked.playerId);
    if (option) return { option, passButton: picked.passButton };
  }
  return options[0] ? { option: options[0], passButton: false } : undefined;
}

/** The first transfer on the list's rule `rule` that can be made, as a command. */
function findTransfer(
  state: GameState,
  legal: LegalCommand[],
  rule: TransferRule,
  moves: OfficeMove[],
): { command: LegalCommand; passButton: boolean } | undefined {
  const options = transferOptions(state, legal, rule.item, moves);
  const froms = ranked(state, rule.from, [...new Set(options.map((option) => option.from))]);
  for (const from of froms) {
    const fromHere = options.filter((option) => option.from === from && option.to !== from);
    const tos: Array<PresidencyId | "china"> =
      "china" in rule.to ? (fromHere.some((option) => option.to === "china") ? ["china"] : []) : ranked(state, rule.to, [...new Set(fromHere.map((option) => option.to).filter((to): to is PresidencyId => to !== "china"))], from);
    for (const to of tos) {
      let here = fromHere.filter((option) => option.to === to);
      if (rule.item === "ship") {
        const best = preferredShips(state, here.map((option) => option.ship!));
        here = here.filter((option) => best.includes(option.ship!));
      }
      const picked = pickOwner(state, here);
      if (picked) return { command: picked.option.command, passButton: picked.passButton };
    }
  }
  return undefined;
}

/** The rule number the Crown's last transfer this turn came from (tagged "[rule N]" in its reason). */
function lastTransferRule(state: GameState, logType: string): number {
  for (let index = state.log.length - 1; index >= 0; index -= 1) {
    const entry = state.log[index];
    if (entry.turn !== state.turn) break;
    if (entry.type !== logType || entry.actor !== CROWN) continue;
    const match = /\[rule (\d+)\]/.exec(entry.crownReason ?? "");
    if (match) return Number(match[1]);
  }
  return 0;
}

function directorTransfersPolicy(state: GameState, decision: PendingDecision, progress: DirectorProgress): CrownChoice | undefined {
  const finish = decision.legalCommands.find((command) => payloadOf<DirectorPayload>(command).action === "finish");
  const allowed = 2 - effectCount(state, "director.preventTransfer");
  if (progress.transfersMade >= allowed) {
    return choose(finish, why(state, `Transfers: ${progress.transfersMade >= 2 ? "two made" : "a favour prevented one"}.`));
  }
  const rules = TRANSFER_RULES[crownClimate(state)];
  // "Skip any that cannot be performed, and stop once 2 transfers have been performed or the bottom
  // of the list has been reached": the list is walked once, top to bottom.
  for (let index = lastTransferRule(state, "companyOperation.directorOfTrade"); index < rules.length; index += 1) {
    const found = findTransfer(state, decision.legalCommands, rules[index], progress.moves ?? []);
    if (found) {
      return {
        commands: [found.command],
        reason: why(state, `Transfer ${rules[index].text} (priority ${index + 1}) [rule ${index + 1}].`),
        ...(found.passButton ? { passButton: true } : {}),
      };
    }
  }
  return choose(finish, why(state, "Transfers: nothing further on the priority list can be done."));
}

// --- Governor General ---

type GovernorGeneralProgress = { stage: string; choicesRemaining: number; taxRegions: string[] };

function governorGeneralProgress(state: GameState): GovernorGeneralProgress {
  const current = coState(state).current;
  return current?.office === "governor-general" ? current : { stage: "begin", choicesRemaining: 0, taxRegions: [] };
}

const GOVERN_DICE: Record<CrownClimate, number> = { bull: 5, stag: 3, lion: 3, bear: 3, peacock: 2 };

/** The dice the Crown Governor General must be able to roll to Govern (p.7), favours included. */
export function governDiceRequired(state: GameState): number {
  const shift = crownEffects(state, "governorGeneral.dice").reduce((total, effect) => total + (Number(effect.option) || 0), 0);
  return Math.max(1, GOVERN_DICE[crownClimate(state)] + shift);
}

export type GovernResult = "tax" | "ship" | "regiment";
export const GOVERN_RESULT: Record<CrownClimate, GovernResult> = { bull: "tax", stag: "tax", lion: "ship", bear: "regiment", peacock: "regiment" };
const GOVERN_RESULT_TEXT: Record<GovernResult, string> = {
  tax: "Tax",
  ship: "build a Company ship",
  regiment: "commission a regiment",
};

function governorGeneralPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const progress = governorGeneralProgress(state);
  const options = (action: GovernorGeneralPayload["action"]) =>
    decision.legalCommands.filter((command) => payloadOf<GovernorGeneralPayload>(command).action === action);

  if (progress.stage === "govern") {
    const required = governDiceRequired(state);
    const govern = options("govern").find((command) => (payloadOf<GovernorGeneralPayload>(command) as { spend: number }).spend === required);
    if (govern) return choose(govern, why(state, `Govern, rolling the required ${required} ${required === 1 ? "die" : "dice"}.`));
    return choose(options("finish")[0], why(state, `Govern: cannot roll the required ${required} dice (or already governed); finish.`));
  }

  if (progress.stage === "choices") {
    const preferred = GOVERN_RESULT[crownClimate(state)];
    const order: GovernResult[] = [preferred, ...(["tax", "ship", "regiment"] as const).filter((result) => result !== preferred)];
    for (const result of order) {
      const command = governResultCommand(state, result, options(result), progress);
      if (command) {
        const note = result === preferred ? "" : ` (${GOVERN_RESULT_TEXT[preferred]} is not possible)`;
        return choose(command.command, why(state, `Govern succeeded: ${GOVERN_RESULT_TEXT[result]}${note}${command.detail ? `, ${command.detail}` : ""}.`));
      }
    }
    return undefined;
  }

  if (progress.stage === "taxUnrest") {
    const order = crownRegionOrder(state);
    const regions = options("taxUnrest").sort(
      (a, b) =>
        order.indexOf((payloadOf<GovernorGeneralPayload>(a) as { regionId: string }).regionId) -
        order.indexOf((payloadOf<GovernorGeneralPayload>(b) as { regionId: string }).regionId),
    );
    return choose(regions[0], why(state, "Tax unrest goes to the first region on the AI card's strip."));
  }
  return undefined;
}

function governResultCommand(
  state: GameState,
  result: GovernResult,
  commands: LegalCommand[],
  progress: GovernorGeneralProgress,
): { command: LegalCommand; detail?: string } | undefined {
  if (commands.length === 0) return undefined;
  const first = aiOrder(state, PRESIDENCY_IDS)[0];
  if (result === "ship") {
    const command = commands.find((candidate) => (payloadOf<GovernorGeneralPayload>(candidate) as { to: string }).to === seaZoneOf(first));
    return command ? { command, detail: `in the ${first} sea zone (first Presidency on the AI card)` } : { command: commands[0] };
  }
  if (result === "regiment") {
    const command = commands.find((candidate) => (payloadOf<GovernorGeneralPayload>(candidate) as { army: ArmyId }).army === first);
    return command ? { command, detail: `for the Army of ${first} (first Presidency on the AI card)` } : { command: commands[0] };
  }
  // Tax: "adding funds evenly among Crown Presidencies, then remainder to Company Balance".
  const done = progress.taxRegions.length;
  const total = done + progress.choicesRemaining;
  const offices = aiOrder(state, crownPresidencies(state))
    .map((presidency) => presidentOfficeId(presidency))
    .filter((officeId) => commands.some((candidate) => (payloadOf<GovernorGeneralPayload>(candidate) as { to: string }).to === officeId));
  const share = offices.length > 0 ? Math.floor(total / offices.length) : 0;
  const target = done < share * offices.length ? offices[done % offices.length] : "balance";
  const command = commands.find((candidate) => (payloadOf<GovernorGeneralPayload>(candidate) as { to: string }).to === target);
  if (!command) return { command: commands[0] };
  return { command, detail: target === "balance" ? "the remainder to the Company Balance" : `£2 to the Crown's ${target}` };
}

// =============================================================================================
// Manager of Shipping (p.8)
// =============================================================================================

/** Company ships the Crown Manager buys this turn, before favours: Bull 0, Stag 1, Lion as many as able, Bear 1, Peacock 0. */
const BUY_BASE: Record<CrownClimate, number> = { bull: 0, stag: 1, lion: Infinity, bear: 1, peacock: 0 };
const BUY_TEXT: Record<CrownClimate, string> = {
  bull: "will not buy Company ships",
  stag: "buys 1 Company ship if able",
  lion: "buys as many Company ships as able",
  bear: "buys 1 Company ship if able",
  peacock: "will not buy Company ships",
};

export function companyShipsToBuy(state: GameState): number {
  let count = BUY_BASE[crownClimate(state)];
  if (effectCount(state, "shipping.buyOne") > 0) count = Math.max(count, 1);
  if (effectCount(state, "shipping.buyNone") > 0) count = 0;
  const many = crownEffects(state, "shipping.buyMany").pop();
  if (many) count = Number(many.option) || 0;
  return count + effectCount(state, "shipping.buyAnother");
}

/**
 * Where the Crown places the ships it fits, buys and leases this turn (p.8). "The highest number
 * may be zero." `destinations` are the sea zones the decision offers (China once open).
 */
export function placementDestination(state: GameState, destinations: string[]): { to: string; rule: string } | undefined {
  const climate = crownClimate(state);
  const zones = PRESIDENCY_IDS.filter((presidency) => destinations.includes(seaZoneOf(presidency)));
  if (zones.length === 0) return destinations[0] ? { to: destinations[0], rule: "the only sea zone" } : undefined;
  const crownWritersMost = () => extreme(state, zones, (presidency) => crownWriters(state, presidency), "most", { allowZero: true });
  const route = () => extreme(state, zones, (presidency) => tradeRoute(state, presidency), "most", { allowZero: true });
  let picked: PresidencyId | undefined;
  let rule: string;
  switch (climate) {
    case "bull": {
      const longest = route();
      picked = longest.find((presidency) => crownPresidencies(state).includes(presidency)) ?? longest[0];
      rule = "the sea zone of the Presidency with the longest open trade route, a Crown Presidency first";
      break;
    }
    case "stag": {
      const longest = route();
      picked = extreme(state, longest, (presidency) => crownWriters(state, presidency), "most", { allowZero: true })[0];
      rule = "the sea zone of the Presidency with the longest open trade route, then the most Crown writers";
      break;
    }
    case "lion": {
      picked = aiOrder(state, zones.filter((presidency) => crownPresidencies(state).includes(presidency)))[0];
      if (picked) rule = "a Crown Presidency's sea zone";
      else {
        picked = extreme(state, zones, (presidency) => allWriters(state, presidency), "most", { allowZero: true })[0];
        rule = "the sea zone of the Presidency with the most writers (no Crown Presidency)";
      }
      break;
    }
    case "bear":
      picked = crownWritersMost()[0];
      rule = "the sea zone of the Presidency with the most Crown writers";
      break;
    case "peacock":
      if (destinations.includes("china")) return { to: "china", rule: "China" };
      picked = crownWritersMost()[0];
      rule = "the sea zone of the Presidency with the most Crown writers (China is not open)";
      break;
  }
  return picked ? { to: seaZoneOf(picked), rule } : undefined;
}

type ShippingAction = { command: LegalCommand; reason: string; passButton?: boolean };

/** What the Crown Manager of Shipping does next, or undefined to finish. */
export function shippingNext(state: GameState, decision: PendingDecision): ShippingAction | undefined {
  const legal = decision.legalCommands;
  const kind = (action: ShippingPayload["action"]) => legal.filter((command) => payloadOf<ShippingPayload>(command).action === action);
  const destinations = [...new Set(legal.map((command) => (payloadOf<ShippingPayload>(command) as { to?: string }).to).filter((to): to is string => Boolean(to)))];
  const place = placementDestination(state, destinations);
  const at = (commands: LegalCommand[]) => commands.filter((command) => (payloadOf<ShippingPayload>(command) as { to?: string }).to === place?.to);
  const placing = place ? `, into ${place.rule}` : "";

  // Fitting Ships: as many of the Crown's own ships as possible, then the players' (Button breaks ties).
  const fits = at(kind("fit"));
  const shipOf = (command: LegalCommand): ShipState | undefined =>
    state.company.ships.find((candidate) => candidate.id === (payloadOf<ShippingPayload>(command) as { shipId: string }).shipId);
  const crownFit = fits.find((command) => {
    const ship = shipOf(command);
    return ship ? isCrownShip(state, ship) : false;
  });
  if (crownFit) return { command: crownFit, reason: why(state, `Fitting Ships: fit one of the Crown's own ships${placing}.`) };
  if (fits.length > 0) {
    const options = fits.map((command) => ({ command, owner: ownerOfShip(state, shipOf(command)!) }));
    const picked = pickOwner(state, options)!;
    return {
      command: picked.option.command,
      reason: why(state, `Fitting Ships: no Crown ship left to fit, so fit a player's ship (the Player Button breaks ties)${placing}.`),
      ...(picked.passButton ? { passButton: true } : {}),
    };
  }

  // Buying Company Ships, by climate.
  const bought = coState(state).shippingBought ?? 0;
  const target = companyShipsToBuy(state);
  const buys = at(kind("buy"));
  if (buys.length > 0 && bought < target) {
    return { command: buys[0], reason: why(state, `Buying Company Ships: ${BUY_TEXT[crownClimate(state)]}${bought > 0 || target !== BUY_BASE[crownClimate(state)] ? ` (${bought} of ${target === Infinity ? "as many as able" : target} bought, favours counted)` : ""}${placing}.`) };
  }

  // Leasing Extra Ships: as many as possible with what remains ("must leave £2 unspent" favour).
  const treasury = state.company.offices["manager-of-shipping"]?.treasury ?? 0;
  const leaves = effectCount(state, "shipping.leaveTwo") > 0 ? 2 : 0;
  const leases = at(kind("lease"));
  if (leases.length > 0 && treasury - 2 >= leaves) {
    return { command: leases[0], reason: why(state, `Leasing Extra Ships: lease as many as possible${leaves ? " while leaving £2 unspent (favour)" : ""}${placing}.`) };
  }

  // The Manager must spend down to £2, so when the Crown would rather not, it still can't stop.
  const finish = kind("finish")[0];
  if (finish) return undefined;
  const forced = leases[0] ?? buys[0] ?? at(kind("fit"))[0] ?? legal[0];
  return forced ? { command: forced, reason: why(state, `The Manager of Shipping must spend down to £2 (p.19)${placing}.`) } : undefined;
}

function shippingPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const next = shippingNext(state, decision);
  if (next) return { commands: [next.command], reason: next.reason, ...(next.passButton ? { passButton: true } : {}) };
  const finish = decision.legalCommands.find((command) => payloadOf<ShippingPayload>(command).action === "finish");
  const treasury = state.company.offices["manager-of-shipping"]?.treasury ?? 0;
  return choose(finish, why(state, `Manager of Shipping is done (£${treasury} left).`));
}

// =============================================================================================
// Military Affairs (p.9)
// =============================================================================================

export type MilitaryProgress = { stage: "transfers" | "assign" | "commanders"; transfersMade: number; armiesResolved: ArmyId[]; moves?: OfficeMove[] };

export function militaryProgress(state: GameState): MilitaryProgress {
  const current = coState(state).current;
  return current?.office === "military-affairs" ? current : { stage: "transfers", transfersMade: 0, armiesResolved: [] };
}

type ArmyMoveOption = { command: LegalCommand; from: ArmyId; to: ArmyId; owner?: PlayerId };

function armyMoves(legal: LegalCommand[], kind: "regiment" | "crownOfficer" | "playerOfficer", moves: OfficeMove[]): ArmyMoveOption[] {
  const options: ArmyMoveOption[] = [];
  for (const command of legal) {
    const payload = payloadOf<MilitaryPayload>(command);
    if (payload.action === "moveRegiment" && kind === "regiment") {
      if (undoesArmyMove(payload, moves)) continue;
      options.push({ command, from: payload.from, to: payload.to });
    } else if (payload.action === "moveOfficer" && kind !== "regiment" && (payload.playerId === CROWN) === (kind === "crownOfficer")) {
      if (undoesArmyMove(payload, moves)) continue;
      options.push({ command, from: payload.from, to: payload.to, owner: payload.playerId });
    }
  }
  return options;
}

const TRANSFER_PRIORITY_TEXT: Record<CrownClimate, string> = {
  bull: "from a player Presidency's Army to a Crown Presidency's Army",
  stag: "from a player Presidency's Army to a Crown Presidency's Army",
  lion: "from the Army of the Presidency with the fewest ships to the one with the most",
  bear: "from an Army a player commands to an Army the Crown commands",
  peacock: "from an Army a player commands to an Army the Crown commands",
};

/** The Army transfer priority (p.9): which Armies to move from and to, in the order to try them. */
function armyEnds(state: GameState, options: ArmyMoveOption[]): Array<{ from: ArmyId; to: ArmyId }> {
  const climate = crownClimate(state);
  const froms = [...new Set(options.map((option) => option.from))];
  const pairs: Array<{ from: ArmyId; to: ArmyId }> = [];
  const toFor = (from: ArmyId) => [...new Set(options.filter((option) => option.from === from).map((option) => option.to))];
  if (climate === "bull" || climate === "stag") {
    for (const from of aiOrder(state, froms.filter((army) => playerPresidencies(state).includes(army)))) {
      for (const to of aiOrder(state, toFor(from).filter((army) => crownPresidencies(state).includes(army)))) pairs.push({ from, to });
    }
  } else if (climate === "lion") {
    // Fewest and most among all the Presidencies, not only those with something to move.
    const shipsOf = (army: ArmyId) => ships(state, army);
    for (const from of extreme(state, PRESIDENCY_IDS, shipsOf, "fewest").filter((army) => froms.includes(army))) {
      const others = PRESIDENCY_IDS.filter((army) => army !== from);
      for (const to of extreme(state, others, shipsOf, "most").filter((army) => toFor(from).includes(army))) pairs.push({ from, to });
    }
  } else {
    for (const from of aiOrder(state, froms.filter((army) => playerIsCommander(state, army)))) {
      for (const to of aiOrder(state, toFor(from).filter((army) => crownIsCommander(state, army)))) pairs.push({ from, to });
    }
  }
  return pairs;
}

function militaryTransfersPolicy(state: GameState, decision: PendingDecision, progress: MilitaryProgress): CrownChoice | undefined {
  const end = decision.legalCommands.find((command) => payloadOf<MilitaryPayload>(command).action === "endTransfers");
  const allowed = 2 - effectCount(state, "military.preventTransfer");
  if (progress.transfersMade >= allowed) {
    return choose(end, why(state, `Transfers: ${progress.transfersMade >= 2 ? "two made" : "a favour prevented one"}.`));
  }
  const text = TRANSFER_PRIORITY_TEXT[crownClimate(state)];
  // "The Crown will transfer regiments, then Crown officers, then player officers."
  for (const [kind, label] of [
    ["regiment", "a regiment"],
    ["crownOfficer", "a Crown officer"],
    ["playerOfficer", "a player officer"],
  ] as const) {
    const options = armyMoves(decision.legalCommands, kind, progress.moves ?? []);
    for (const end of armyEnds(state, options)) {
      const picked = pickOwner(state, options.filter((option) => option.from === end.from && option.to === end.to));
      if (picked) {
        return {
          commands: [picked.option.command],
          reason: why(state, `Transfer ${label} ${text} (the Army of ${end.from} to ${end.to}).`),
          ...(picked.passButton ? { passButton: true } : {}),
        };
      }
    }
  }
  return choose(end, why(state, "Transfers: no further transfer on the priority can be made without undoing one."));
}

/** The officer the Crown assigns next: players' officers first, then the Crown's, one at a time (p.9). */
export function nextOfficerToAssign(state: GameState, decision: PendingDecision): { owner: PlayerId; passButton: boolean } | undefined {
  const waiting = [...new Set(decision.legalCommands.map((command) => (payloadOf<MilitaryPayload>(command) as { playerId: PlayerId }).playerId))];
  const humans = waiting.filter((playerId) => playerId !== CROWN);
  if (humans.length > 1) {
    const picked = crownPickPlayer(state, humans);
    if (picked.playerId) return { owner: picked.playerId, passButton: picked.passButton };
  }
  if (humans[0]) return { owner: humans[0], passButton: false };
  return waiting.includes(CROWN) ? { owner: CROWN, passButton: false } : undefined;
}

type AssignStep = { text: string; apply: (state: GameState, owner: PlayerId, armies: ArmyId[]) => ArmyId[] };

function crownTotalsWith(state: GameState, army: ArmyId, owner: PlayerId) {
  return armyTotals(state.company.armies[army], owner);
}

const creatingCrownMajority: AssignStep = {
  text: "creates a new Crown majority of pieces",
  apply: (state, owner, armies) =>
    owner !== CROWN
      ? []
      : armies.filter(
          (army) =>
            !hasMajority(armyTotals(state.company.armies[army]), CROWN) && hasMajority(crownTotalsWith(state, army, owner), CROWN),
        ),
};

const creatingCrownEquality: AssignStep = {
  text: "creates a Crown equality with a player holding a majority",
  apply: (state, owner, armies) =>
    owner !== CROWN
      ? []
      : armies.filter((army) => {
          const before = armyTotals(state.company.armies[army]);
          const holder = majorityHolder(before);
          if (!holder || holder === CROWN) return false;
          return crownTotalsWith(state, army, owner).get(CROWN) === before.get(holder);
        }),
};

const keepingCrownMajority: AssignStep = {
  text: "has a Crown majority that it does not lose",
  apply: (state, owner, armies) =>
    armies.filter(
      (army) => hasMajority(armyTotals(state.company.armies[army]), CROWN) && hasMajority(crownTotalsWith(state, army, owner), CROWN),
    ),
};

const crownPresidency: AssignStep = {
  text: "is a Crown Presidency",
  apply: (state, _owner, armies) => armies.filter((army) => crownPresidencies(state).includes(army)),
};
const mostShips: AssignStep = {
  text: "has the most ships",
  apply: (state, _owner, armies) => extreme(state, armies, (army) => ships(state, army), "most"),
};
const crownGovernor: AssignStep = {
  text: "has a Crown Governor",
  apply: (state, _owner, armies) => armies.filter((army) => crownIsGovernor(state, army)),
};
const crownCommander: AssignStep = {
  text: "has the Crown as Commander",
  apply: (state, _owner, armies) => armies.filter((army) => crownIsCommander(state, army)),
};

/** "Assign Officers" priority (p.9). */
const ASSIGN_STEPS: Record<"early" | "late", AssignStep[]> = {
  early: [crownPresidency, mostShips, crownGovernor, creatingCrownMajority, creatingCrownEquality, keepingCrownMajority, crownCommander],
  late: [creatingCrownMajority, creatingCrownEquality, keepingCrownMajority, crownGovernor, crownCommander, crownPresidency, mostShips],
};

/**
 * The Army for one officer-in-training: each step that applies narrows the candidates, until one
 * remains; a tie left at the end goes to the AI card's arrows.
 */
export function chooseAssignmentArmy(state: GameState, owner: PlayerId, armies: ArmyId[]): { army: ArmyId; steps: string[] } {
  const climate = crownClimate(state);
  let candidates = armies;
  const used: string[] = [];
  for (const step of ASSIGN_STEPS[climate === "bear" || climate === "peacock" ? "late" : "early"]) {
    if (candidates.length === 1) break;
    const hit = step.apply(state, owner, candidates);
    if (hit.length > 0 && hit.length < candidates.length) {
      candidates = hit;
      used.push(step.text);
    }
  }
  return { army: aiOrder(state, candidates)[0], steps: used };
}

function militaryAssignPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const next = nextOfficerToAssign(state, decision);
  if (!next) return undefined;
  const armies = [...new Set(decision.legalCommands.map((command) => (payloadOf<MilitaryPayload>(command) as { army: ArmyId }).army))];
  const { army, steps } = chooseAssignmentArmy(state, next.owner, armies);
  const command = decision.legalCommands.find((candidate) => {
    const payload = payloadOf<MilitaryPayload>(candidate) as { playerId: PlayerId; army: ArmyId };
    return payload.playerId === next.owner && payload.army === army;
  });
  const who = next.owner === CROWN ? "a Crown officer" : `${state.players[next.owner]?.name ?? next.owner}'s officer`;
  const how = steps.length > 0 ? `the Army that ${steps.join(", then ")}` : "the Army the AI card's arrows pick";
  return command ? { commands: [command], reason: why(state, `Assign ${who} to ${how}: the Army of ${army}.`), ...(next.passButton ? { passButton: true } : {}) } : undefined;
}

function militaryCommanderPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const own = decision.legalCommands.filter((command) => (payloadOf<MilitaryPayload>(command) as { playerId: PlayerId }).playerId === CROWN);
  return choice(own, why(state, "Commander: with more than one eligible officer, the Crown chooses its own."));
}

function militaryPolicy(state: GameState, decision: PendingDecision): CrownChoice | undefined {
  const progress = militaryProgress(state);
  if (progress.stage === "transfers") return militaryTransfersPolicy(state, decision, progress);
  if (progress.stage === "assign") return militaryAssignPolicy(state, decision);
  return militaryCommanderPolicy(state, decision);
}

export { directorPolicy, governorGeneralPolicy, shippingPolicy, militaryPolicy };
