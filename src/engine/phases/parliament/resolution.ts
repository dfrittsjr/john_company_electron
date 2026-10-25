// Resolving a vote (rulebook pp.34-36): policy consequences, law effects and the choices they need.
import { companyShareScoring, policyDial } from "../../../data";
import { shuffle } from "../../rng";
import type { ArmyId, GameState, LegalCommand, PendingDecision, PlayerId } from "../../types";
import { lowerStanding } from "../revenue";
import type { ParliamentResolutionStep, ParliamentSession, PolicyTarget } from "../parliament.state";
import { addCash, nextDecisionId, playerName, primeMinisterOrder, updatePlayer, type Collector } from "./common";
import { policyTargetItems, prestigeCardOwners, surrenderItem, windowTaxItems, type TaxedItem } from "./holdings";
import { startNestedIndiaResolution } from "../events-in-india";
import {
  adjacentPolicySpaces,
  describePolicySpace,
  discardPassedLaw,
  isLawPassed,
  lawCard,
} from "./laws";
import { installGovernorGeneral, officeCategory, officeLabel, vacateOffice } from "../../offices";
import { beginImmediateHire } from "../hiring";
import { enactDeregulation, failDeregulation } from "./deregulation";

type StepOutcome =
  | { state: GameState; decision?: undefined; replaceWith?: ParliamentResolutionStep[] }
  | { state: GameState; decision: PendingDecision; replaceWith?: undefined };

const POLICY_TARGETS: PolicyTarget[] = ["social", "companyShare", "shipping", "manufacturing"];
const TARGET_NAME: Record<PolicyTarget, string> = {
  social: "social enterprise",
  companyShare: "Company share",
  shipping: "shipping enterprise",
  manufacturing: "manufacturing enterprise",
};

export function primeMinister(state: GameState): PlayerId {
  return state.parliament.primeMinister ?? state.seatingOrder[0];
}

export function withSession(state: GameState, patch: Partial<ParliamentSession>): GameState {
  const session = state.parliament.session;
  if (!session) return state;
  return { ...state, parliament: { ...state.parliament, session: { ...session, ...patch } } };
}

function setQueue(state: GameState, queue: ParliamentResolutionStep[]): GameState {
  return withSession(state, { queue });
}

/** Resume key for law effects resolved through Events in India; registered in parliament.ts. */
export const PARLIAMENT_INDIA_RESUME = "parliament.indiaEffects";

/** Hiring resume key for offices a law creates (Envoy to China); registered in parliament.ts. */
export const PARLIAMENT_HIRE_RESUME = "parliament.immediateHire";

/** Runs queued steps until one needs a player's choice or the vote is fully resolved. */
export function runQueue(state: GameState, collector: Collector): { state: GameState; decision?: PendingDecision } {
  let current = state;
  for (let guard = 0; guard < 500; guard += 1) {
    const session = current.parliament.session;
    const step = session?.queue[0];
    if (!session || !step) return { state: current };

    const outcome = runStep(current, step, collector);
    if (outcome.decision) return { state: outcome.state, decision: outcome.decision };

    const after = outcome.state.parliament.session;
    if (!after) return { state: outcome.state };
    current = setQueue(outcome.state, [...(outcome.replaceWith ?? []), ...after.queue.slice(1)]);
  }

  throw new Error("Parliament resolution did not settle.");
}

function runStep(state: GameState, step: ParliamentResolutionStep, collector: Collector): StepOutcome {
  switch (step.kind) {
    case "policy":
      return { state, replaceWith: expandPolicy(state, step) };
    case "tax":
      return settleTax(state, step, collector);
    case "windowTax":
      return settleWindowTax(state, step, collector);
    case "bonus":
      return payBonus(state, step.target, collector);
    case "power":
      return applyPower(state, step.target, step.actor ?? primeMinister(state), collector);
    case "lawPassed":
      return applyLawPassed(state, step.lawId, collector);
    case "lawFailed":
      return applyLawFailed(state, step.lawId, collector);
    case "impeach": {
      const result = vacateOffice(state, step.officeId, "supply");
      collector.notes.push(
        result.holder
          ? `${playerName(state, result.holder)} was impeached from ${officeLabel(step.officeId)}.`
          : `${officeLabel(step.officeId)} was already vacant.`,
      );
      return { state: result.state };
    }
    case "warShips":
      return chooseWarShip(state, step.remaining);
    case "warPieces":
      return chooseWarPiece(state, step.remaining);
    case "changePrimeMinister":
      return changePrimeMinister(state, collector);
    case "indiaEffects": {
      const session = state.parliament.session!;
      const resolved = startNestedIndiaResolution(state, step.label, step.work, PARLIAMENT_INDIA_RESUME);
      // Done without any decision: back in Parliament, and runQueue drops this step.
      if (!resolved.eventsInIndia.progress?.nested) return { state: resolved };
      // Waiting for a Commander's defence: drop this step now; the queue resumes afterwards.
      const waiting = withSession(setQueue(resolved, session.queue.slice(1)), { awaitingIndia: true });
      return { state: waiting, decision: resolved.pendingDecision };
    }
    case "hireImmediately": {
      const session = state.parliament.session!;
      const hired = beginImmediateHire(state, step.officeId, PARLIAMENT_HIRE_RESUME);
      // Filled or left vacant at once: the queue carries on (runQueue drops this step).
      if (!hired.hiring.immediate) return { state: { ...hired, phase: "parliament" } };
      // Waiting for the Chairman: drop this step now; the queue resumes once the hire is done.
      const waiting = withSession(setQueue(hired, session.queue.slice(1)), { awaitingHire: true });
      return { state: waiting, decision: hired.pendingDecision };
    }
    case "movePolicyAfterFailure":
      return moveFailedPolicyDecision(state, step.taxCollectorsMayAdd);
    case "finish":
      return { state: finishSession(state, collector) };
  }
}

/** Tax, Bonus, or Power on the space's target; a TAX & WINDOW TAX space adds a window tax (p.34). */
function expandPolicy(
  state: GameState,
  step: Extract<ParliamentResolutionStep, { kind: "policy" }>,
): ParliamentResolutionStep[] {
  const space = policyDial.spaces[step.space];
  const players = primeMinisterOrder(state);
  const steps: ParliamentResolutionStep[] = [];

  switch (space.consequence) {
    case "tax":
      steps.push({ kind: "tax", target: space.target, players });
      break;
    case "taxAndWindowTax":
      steps.push({ kind: "tax", target: space.target, players });
      steps.push({ kind: "windowTax", players, exemptFromRepeal: false });
      break;
    case "bonus":
      steps.push({ kind: "bonus", target: space.target });
      break;
    case "power":
      steps.push({ kind: "power", target: space.target, actor: step.actor });
      break;
  }

  // Tax Collectors: "a single window tax exempt from" Window Tax Repeal.
  if (step.extraWindowTax) steps.push({ kind: "windowTax", players, exemptFromRepeal: true });
  return steps;
}

function surrenderDecision(state: GameState, playerId: PlayerId, items: TaxedItem[], prompt: string): PendingDecision {
  return {
    id: nextDecisionId(state, "parliament.surrender"),
    phase: "parliament",
    step: "parliament.surrender",
    actor: playerId,
    visibility: "public",
    prompt,
    legalCommands: items.map((item) => ({
      type: "parliament.surrender",
      label: `Return ${item.label} to supply`,
      description: "You cannot pay for everything taxed; choose what is returned (p.34).",
      payload: { itemId: item.id },
    })),
    canSave: true,
  };
}

/** Each player pays £1 per target or returns targets they cannot pay for (p.34). */
function settleTax(
  state: GameState,
  step: Extract<ParliamentResolutionStep, { kind: "tax" }>,
  collector: Collector,
): StepOutcome {
  let current = state;
  const players = [...step.players];

  while (players.length > 0) {
    const playerId = players[0];
    const items = policyTargetItems(current, playerId, step.target);
    const cash = current.players[playerId].cash;
    if (items.length === 0) {
      players.shift();
      continue;
    }
    if (cash >= items.length) {
      current = addCash(current, playerId, -items.length);
      collector.notes.push(
        `${playerName(current, playerId)} paid £${items.length} tax on ${items.length} ${TARGET_NAME[step.target]}(s).`,
      );
      players.shift();
      continue;
    }

    const updated = setQueue(current, [{ ...step, players }, ...current.parliament.session!.queue.slice(1)]);
    return {
      state: updated,
      decision: surrenderDecision(
        updated,
        playerId,
        items,
        `${playerName(updated, playerId)} owes £${items.length} tax on ${TARGET_NAME[step.target]}s but has £${cash}. Choose one to return to supply.`,
      ),
    };
  }

  return { state: current };
}

/** Window tax: pay each family member on a prize's and each enterprise's window icons, or lose it (p.34). */
function settleWindowTax(
  state: GameState,
  step: Extract<ParliamentResolutionStep, { kind: "windowTax" }>,
  collector: Collector,
): StepOutcome {
  if (!step.exemptFromRepeal && isLawPassed(state, "window-tax-repeal")) {
    collector.notes.push("Window Tax Repeal: no window tax is collected.");
    return { state };
  }

  let current = state;
  const players = [...step.players];
  while (players.length > 0) {
    const playerId = players[0];
    const items = windowTaxItems(current, playerId);
    const due = items.reduce((total, item) => total + item.windowIcons, 0);
    const cash = current.players[playerId].cash;
    if (due === 0) {
      players.shift();
      continue;
    }
    if (cash >= due) {
      current = addCash(current, playerId, -due);
      collector.notes.push(`${playerName(current, playerId)} paid £${due} window tax.`);
      players.shift();
      continue;
    }

    const updated = setQueue(current, [{ ...step, players }, ...current.parliament.session!.queue.slice(1)]);
    return {
      state: updated,
      decision: surrenderDecision(
        updated,
        playerId,
        items,
        `${playerName(updated, playerId)} owes £${due} window tax but has £${cash}. Choose what to give up.`,
      ),
    };
  }

  return { state: current };
}

/** The player choosing at a tax decision gives up one item; the tax step then re-checks them. */
export function applySurrender(state: GameState, playerId: PlayerId, itemId: string, collector: Collector): GameState {
  const label =
    [...windowTaxItems(state, playerId), ...POLICY_TARGETS.flatMap((target) => policyTargetItems(state, playerId, target))]
      .find((item) => item.id === itemId)?.label ?? itemId;
  collector.notes.push(`${playerName(state, playerId)} could not pay and returned ${label} to supply.`);
  return surrenderItem(state, playerId, itemId);
}

function payBonus(state: GameState, target: PolicyTarget, collector: Collector): StepOutcome {
  let current = state;
  for (const playerId of primeMinisterOrder(state)) {
    const count = policyTargetItems(current, playerId, target).length;
    if (count === 0) continue;
    current = addCash(current, playerId, count);
    collector.notes.push(`${playerName(current, playerId)} took a £${count} bonus.`);
  }
  return { state: current };
}

function powerTrackOf(state: GameState): Record<PolicyTarget, number> {
  return state.company.powerTrack as Record<PolicyTarget, number>;
}

function swapPower(state: GameState, a: PolicyTarget, b: PolicyTarget): GameState {
  const track = powerTrackOf(state);
  return {
    ...state,
    company: { ...state.company, powerTrack: { ...track, [a]: track[b], [b]: track[a] } },
  };
}

/** Power: swap with the next higher marker; from the top, swap any two other markers (p.34). */
function applyPower(state: GameState, target: PolicyTarget, actor: PlayerId, collector: Collector): StepOutcome {
  const track = powerTrackOf(state);
  const value = track[target];
  const higher = POLICY_TARGETS.find((candidate) => track[candidate] === value + 1);
  if (higher) {
    collector.notes.push(`Power: ${TARGET_NAME[target]}s swapped with ${TARGET_NAME[higher]}s on the Power track.`);
    return { state: swapPower(state, target, higher) };
  }

  const others = POLICY_TARGETS.filter((candidate) => candidate !== target);
  const pairs: Array<[PolicyTarget, PolicyTarget]> = [];
  for (let first = 0; first < others.length; first += 1) {
    for (let second = first + 1; second < others.length; second += 1) pairs.push([others[first], others[second]]);
  }

  return {
    state,
    decision: {
      id: nextDecisionId(state, "parliament.choosePowerSwap"),
      phase: "parliament",
      step: "parliament.choosePowerSwap",
      actor,
      visibility: "public",
      prompt: `${TARGET_NAME[target]}s are already highest on the Power track. Swap two other markers.`,
      legalCommands: pairs.map(([a, b]) => ({
        type: "parliament.choosePowerSwap",
        label: `Swap ${TARGET_NAME[a]}s (${track[a]}) and ${TARGET_NAME[b]}s (${track[b]})`,
        payload: { targets: [a, b] },
      })),
      canSave: true,
    },
  };
}

export function applyPowerSwapChoice(state: GameState, targets: [PolicyTarget, PolicyTarget], collector: Collector): GameState {
  collector.notes.push(`Power: ${TARGET_NAME[targets[0]]}s and ${TARGET_NAME[targets[1]]}s swapped places.`);
  return swapPower(state, targets[0], targets[1]);
}

/** Immediate effects of a passed law (law cards, pp.34-35). Ongoing effects are read where they apply. */
function applyLawPassed(state: GameState, lawId: string, collector: Collector): StepOutcome {
  const law = lawCard(lawId);
  let current = state;
  const extraSteps: ParliamentResolutionStep[] = [];

  for (const effect of law.effects) {
    if (effect.timing !== "onPass") continue;
    switch (effect.type) {
      case "gainCashPerEnterprise":
        for (const playerId of primeMinisterOrder(current)) {
          const count = policyTargetItems(current, playerId, effect.enterpriseType).length;
          if (count === 0) continue;
          current = addCash(current, playerId, count * effect.amount);
          collector.notes.push(`${playerName(current, playerId)} gained £${count * effect.amount} from ${law.name}.`);
        }
        break;
      case "createOfficeIfMissing":
        if (!current.company.offices[effect.officeId]?.created) {
          // "The office is hired immediately by the Chairman" (p.25).
          extraSteps.push({ kind: "hireImmediately", officeId: effect.officeId });
          collector.notes.push(`${officeLabel(effect.officeId)} was created and is hired at once.`);
        }
        break;
      case "placeRegimentsInEachArmy":
        current = placeRegiments(current, effect.count, collector);
        break;
      case "setCompanyDebtToLeftmost":
        current = { ...current, company: { ...current.company, debt: 0 } };
        collector.notes.push("Company Debt was lowered to 0.");
        break;
      case "discardPassedLaw":
        if (isLawPassed(current, effect.lawId)) {
          current = discardPassedLaw(current, effect.lawId);
          collector.notes.push(`${lawCard(effect.lawId).name} was discarded.`);
        }
        break;
      case "advanceCompanyShareValue": {
        const shareValue = Math.min(companyShareScoring.maxAbsoluteValue, current.company.shareValue + 1);
        current = { ...current, company: { ...current.company, shareValue } };
        collector.notes.push(`Company shares are now worth +${shareValue}/-${shareValue} VP.`);
        break;
      }
      default:
        // enactPolicyConsequenceAgain, rottenBoroughVotes and voteCost are handled when the vote is
        // set up or read from the passed laws.
        break;
    }
  }

  switch (law.effectHandler) {
    case "governor-general":
      current = enactGovernorGeneral(current, collector);
      break;
    case "deregulation":
      current = enactDeregulation(current, collector);
      break;
    case "public-demands-impeachment": {
      const officeId = current.parliament.session?.impeachmentOfficeId;
      if (officeId) extraSteps.push({ kind: "impeach", officeId });
      break;
    }
    case "war-against-france":
      extraSteps.push({ kind: "warShips", remaining: 3 }, { kind: "warPieces", remaining: 3 });
      break;
    default:
      break;
  }

  return { state: current, replaceWith: extraSteps };
}

function applyLawFailed(state: GameState, lawId: string, collector: Collector): StepOutcome {
  const law = lawCard(lawId);
  let current = state;

  for (const effect of law.effects) {
    if (effect.timing === "onFail" && effect.type === "lowerStanding") {
      current = { ...current, company: lowerStanding(current.company, effect.spaces) };
      collector.notes.push(
        current.company.failed
          ? "Company Standing fell to the failure space: the Company has failed."
          : `Company Standing fell ${effect.spaces} space.`,
      );
    }
  }

  // These dilemmas resolve India effects with Events in India's own rules, including attacks on
  // the Company and their defence decisions.
  switch (law.effectHandler) {
    case "deregulation":
      return { state: failDeregulation(current, collector) };
    case "relief-demanded-for-indian-famine":
      return {
        state: current,
        replaceWith: [
          {
            kind: "indiaEffects",
            label: "relief-demanded-for-indian-famine",
            work: [
              { kind: "turmoilAt", regionId: "bombay" },
              { kind: "turmoilAt", regionId: "madras" },
              { kind: "turmoilAt", regionId: "bengal" },
              { kind: "unrestInCompanyRegions" },
            ],
          },
        ],
      };
    case "war-against-france":
      return {
        state: current,
        replaceWith: [{ kind: "indiaEffects", label: "war-against-france", work: [{ kind: "foreignInvasionStorm" }] }],
      };
    default:
      return { state: current };
  }
}

/** Army Spending: regiments to every Army; Foundry pays £1 per regiment added (prestige #24). */
function placeRegiments(state: GameState, perArmy: number, collector: Collector): GameState {
  const armies = Object.fromEntries(
    Object.entries(state.company.armies).map(([armyId, army]) => [
      armyId,
      { ...army, regiments: { ...army.regiments, ready: army.regiments.ready + perArmy } },
    ]),
  ) as GameState["company"]["armies"];
  let current: GameState = { ...state, company: { ...state.company, armies } };
  const added = perArmy * Object.keys(armies).length;
  collector.notes.push(`${perArmy} regiments were placed in each Army.`);

  for (const owner of prestigeCardOwners(current, "foundry")) {
    current = addCash(current, owner, added);
    collector.notes.push(`${playerName(current, owner)} took £${added} from the Foundry.`);
  }
  return current;
}

/**
 * Governor General (p.26): Governors become pensioners, Governor overlays and unfinished Company
 * ships are removed, and the Director of Trade's card, holder, fatigue and treasury pass to the
 * Governor General, who is then hired like the Director and hires Presidents (Hiring, p.26).
 */
function enactGovernorGeneral(state: GameState, collector: Collector): GameState {
  for (const office of Object.values(state.company.offices)) {
    if (officeCategory(office.id) === "governor" && office.holder && !office.vacant) {
      collector.notes.push(`${playerName(state, office.holder)}'s ${officeLabel(office.id)} became a pensioner.`);
    }
  }
  const next = installGovernorGeneral(state);
  const holder = next.company.offices["governor-general"]?.holder;
  collector.notes.push(
    holder
      ? `${playerName(next, holder)}'s Director of Trade became the Governor General.`
      : "The Governor General office was created and is vacant.",
  );
  return next;
}

function warShipCandidates(state: GameState) {
  return state.company.ships.filter(
    (ship) => ship.kind !== "extra" && ship.location !== "shipyard" && !ship.location.startsWith("firm:"),
  );
}

/** War Against France! passed: the Prime Minister returns 3 non-extra ships (dilemma #55). */
function chooseWarShip(state: GameState, remaining: number): StepOutcome {
  const ships = warShipCandidates(state);
  if (remaining <= 0 || ships.length === 0) return { state };

  return {
    state,
    decision: {
      id: nextDecisionId(state, "parliament.warAgainstFranceShip"),
      phase: "parliament",
      step: "parliament.warAgainstFranceShip",
      actor: primeMinister(state),
      visibility: "public",
      prompt: `War Against France!: choose a ship to return (${remaining} left).`,
      legalCommands: ships.map((ship) => ({
        type: "parliament.warAgainstFranceShip",
        label: `Return ${ship.kind === "player" ? `${ship.shipyardCardId ?? ship.id}` : "a Company ship"} in ${ship.location}`,
        payload: { shipId: ship.id },
      })),
      canSave: true,
    },
  };
}

export function applyWarShip(state: GameState, shipId: string, collector: Collector): GameState {
  const ship = state.company.ships.find((candidate) => candidate.id === shipId);
  if (!ship) return state;
  const ships =
    ship.kind === "player"
      ? state.company.ships.map((candidate) =>
          candidate.id === shipId ? { ...candidate, location: "shipyard" as const, fatigued: false } : candidate,
        )
      : state.company.ships.filter((candidate) => candidate.id !== shipId);
  collector.notes.push(
    ship.kind === "player" ? `A ship returned to its shipyard (${ship.shipyardCardId}).` : "A Company ship returned to the supply.",
  );
  return { ...state, company: { ...state.company, ships } };
}

function warPieceOptions(state: GameState): LegalCommand[] {
  const options: LegalCommand[] = [];
  for (const [armyId, army] of Object.entries(state.company.armies)) {
    if (army.regiments.ready + army.regiments.exhausted > 0) {
      options.push({
        type: "parliament.warAgainstFrancePiece",
        label: `Return a regiment from the Army of ${armyId}`,
        payload: { army: armyId, piece: "regiment" },
      });
    }
    for (const [owner, stack] of Object.entries(army.officers)) {
      if (stack.ready + stack.exhausted > 0) {
        options.push({
          type: "parliament.warAgainstFrancePiece",
          label: `Return ${playerName(state, owner)}'s officer from the Army of ${armyId}`,
          payload: { army: armyId, piece: "officer", owner },
        });
      }
    }
  }
  return options;
}

/** ... and 3 officers or regiments (Commanders are not officers, p.16). */
function chooseWarPiece(state: GameState, remaining: number): StepOutcome {
  const options = warPieceOptions(state);
  if (remaining <= 0 || options.length === 0) return { state };

  return {
    state,
    decision: {
      id: nextDecisionId(state, "parliament.warAgainstFrancePiece"),
      phase: "parliament",
      step: "parliament.warAgainstFrancePiece",
      actor: primeMinister(state),
      visibility: "public",
      prompt: `War Against France!: choose an officer or regiment to return (${remaining} left).`,
      legalCommands: options,
      canSave: true,
    },
  };
}

export function applyWarPiece(
  state: GameState,
  payload: { army: ArmyId; piece: "regiment" | "officer"; owner?: PlayerId },
  collector: Collector,
): GameState {
  const army = state.company.armies[payload.army];
  if (!army) return state;

  if (payload.piece === "regiment") {
    const regiments = army.regiments.ready > 0
      ? { ...army.regiments, ready: army.regiments.ready - 1 }
      : { ...army.regiments, exhausted: army.regiments.exhausted - 1 };
    collector.notes.push(`A regiment left the Army of ${payload.army}.`);
    return { ...state, company: { ...state.company, armies: { ...state.company.armies, [payload.army]: { ...army, regiments } } } };
  }

  const owner = payload.owner!;
  const stack = army.officers[owner];
  const nextStack = stack.ready > 0 ? { ...stack, ready: stack.ready - 1 } : { ...stack, exhausted: stack.exhausted - 1 };
  const withArmy: GameState = {
    ...state,
    company: {
      ...state.company,
      armies: { ...state.company.armies, [payload.army]: { ...army, officers: { ...army.officers, [owner]: nextStack } } },
    },
  };
  collector.notes.push(`${playerName(state, owner)}'s officer left the Army of ${payload.army}.`);
  return updatePlayer(withArmy, owner, (player) => ({
    ...player,
    familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 },
  }));
}

/** A failed law: the Opposition Leader returns the marker and takes the Prime Minister dial (p.36). */
function changePrimeMinister(state: GameState, collector: Collector): StepOutcome {
  const leader = state.parliament.oppositionLeader;
  if (!leader) {
    // Assumption: with nobody holding the marker, the Prime Minister stays in power.
    collector.notes.push(`No one holds the Opposition Leader marker; ${playerName(state, primeMinister(state))} remains Prime Minister.`);
    return { state };
  }

  collector.notes.push(`${playerName(state, leader)}, the Opposition Leader, became Prime Minister.`);
  return {
    state: { ...state, parliament: { ...state.parliament, primeMinister: leader, oppositionLeader: undefined } },
  };
}

/** The new Prime Minister moves the policy to an adjacent space and resolves it (p.36). */
function moveFailedPolicyDecision(state: GameState, taxCollectorsMayAdd: boolean): StepOutcome {
  const session = state.parliament.session!;
  if (session.policySpace === undefined) return { state };
  const pm = primeMinister(state);
  const withTaxCollectors = taxCollectorsMayAdd && prestigeCardOwners(state, "tax-collectors").includes(pm);
  const legalCommands: LegalCommand[] = adjacentPolicySpaces(state.parliament.policyDialPosition).flatMap(
    ({ direction, space }) => {
      const base = {
        type: "parliament.moveFailedPolicy",
        label: `Move ${direction} to ${describePolicySpace(space)}`,
        payload: { space, addWindowTax: false },
      };
      if (!withTaxCollectors) return [base];
      return [
        base,
        {
          type: "parliament.moveFailedPolicy",
          label: `Move ${direction} to ${describePolicySpace(space)} and add a window tax (Tax Collectors)`,
          payload: { space, addWindowTax: true },
        },
      ];
    },
  );

  return {
    state,
    decision: {
      id: nextDecisionId(state, "parliament.moveFailedPolicy"),
      phase: "parliament",
      step: "parliament.moveFailedPolicy",
      actor: pm,
      visibility: "public",
      prompt: "The law failed. Move the policy to an adjacent space; it is then resolved.",
      legalCommands,
      canSave: true,
    },
  };
}

/** Clean-up: cards used to vote turn back upright, Old Ideas Made New! reshuffles (law #52). */
function finishSession(state: GameState, collector: Collector): GameState {
  const session = state.parliament.session;
  if (!session) return state;
  let current = state;

  if (session.oldIdeasMadeNew) {
    const deck = current.parliament.lawDeck;
    const reshuffled = shuffle(current.rng, [...deck.drawPile, ...deck.discardPile, ...session.drawn]);
    collector.rolls.push(...reshuffled.rolls.slice(0, 1));
    collector.notes.push("Old Ideas Made New!: the discards, the laws drawn this turn and Old Ideas were shuffled into the deck.");
    current = {
      ...current,
      rng: reshuffled.rng,
      parliament: { ...current.parliament, lawDeck: { drawPile: reshuffled.items, discardPile: [] } },
    };
  }

  return { ...current, parliament: { ...current.parliament, session: undefined } };
}
