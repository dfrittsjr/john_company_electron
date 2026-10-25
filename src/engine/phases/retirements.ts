import { blackmailCards, offices, prestigeCards, prizes } from "../../data";
import type { PrizeDefinition } from "../../data";
import { vacateOffice } from "../offices";
import { rollDie } from "../rng";
import { chairmanTitleHolder, clockwiseFrom, playerSpouses } from "../selectors";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  LegalCommand,
  OfficeId,
  PendingDecision,
  PlayerId,
  RngRollRecord,
} from "../types";
import type { DiscountKey, RetirementContext, RetirementProgress } from "./london-season.state";
import { registerDecisionRefresher } from "./negotiation";

// Attrition and pensioner retirements, shared by the London Season (p.11) and the final
// retirement in Final Scoring (p.9).

export const LETTERS_OF_INTRODUCTION = "letters-of-introduction";

const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));
const blackmailById = new Map(blackmailCards.map((card) => [card.id, card]));
const prizeById = new Map(prizes.map((prize) => [prize.id, prize]));

export type AttritionRecord = {
  officeId: OfficeId;
  holder: PlayerId;
  fatigueBefore: number;
  roll: number;
  stressModifier: number;
  total: number;
  outcome: "none" | "fatigued" | "retired";
};

export function prizeDefinition(prizeId: string): PrizeDefinition | undefined {
  return prizeById.get(prizeId);
}

/**
 * Attrition (p.11): roll one die per office card held, adding existing fatigue and +1 for the
 * Chairman. 1-2 nothing; 3-4 add a fatigue; 5+ the officeholder retires to the Pensioners box.
 */
export function resolveOfficeAttrition(
  state: GameState,
  labelPrefix: string,
): {
  state: GameState;
  attritionedOffices: AttritionRecord[];
  retiredOffices: AttritionRecord[];
  rolls: RngRollRecord[];
} {
  const occupiedOffices = Object.values(state.company.offices)
    .filter((office) => !office.vacant && office.holder)
    .sort((left, right) => officeOrder(left.id) - officeOrder(right.id));
  const attritionedOffices: AttritionRecord[] = [];
  const retiredOffices: AttritionRecord[] = [];
  const rolls: RngRollRecord[] = [];
  let nextState = state;
  let nextRng = state.rng;

  for (const office of occupiedOffices) {
    const holder = office.holder as PlayerId;
    const stressModifier = office.id === "chairman" ? 1 : 0;
    // Tenure Limits (#37): "The Chairman will always retire during the first step of the London
    // Season." No die is rolled for the Chairman while it is in effect.
    const alwaysRetires = office.id === "chairman" && tenureLimitsInEffect(state);
    const roll = alwaysRetires ? undefined : rollDie(nextRng, 6, `${labelPrefix}.${office.id}`);
    if (roll) {
      nextRng = roll.rng;
      rolls.push(roll.roll);
    }

    const total = alwaysRetires ? Infinity : roll!.value + office.fatigue + stressModifier;
    const outcome: AttritionRecord["outcome"] = total >= 5 ? "retired" : total >= 3 ? "fatigued" : "none";
    const record: AttritionRecord = {
      officeId: office.id,
      holder,
      fatigueBefore: office.fatigue,
      roll: roll?.value ?? 0,
      stressModifier,
      total: alwaysRetires ? 0 : total,
      outcome,
    };
    attritionedOffices.push(record);

    if (outcome === "retired") {
      retiredOffices.push(record);
      nextState = retireOfficeholder(nextState, office.id);
    } else if (outcome === "fatigued") {
      nextState = {
        ...nextState,
        company: {
          ...nextState.company,
          offices: {
            ...nextState.company.offices,
            [office.id]: { ...nextState.company.offices[office.id], fatigue: office.fatigue + 1 },
          },
        },
      };
    }
  }

  return { state: { ...nextState, rng: nextRng }, attritionedOffices, retiredOffices, rolls };
}

function tenureLimitsInEffect(state: GameState): boolean {
  return state.parliament.passedLaws.some((law) => law.lawId === "tenure-limits");
}

// The retiring family member moves to the Pensioners box; the office card goes to the Vacant
// Offices box and its fatigue returns to supply (p.11). A retiring Chairman takes the Chairman
// slot's Company share with them.
function retireOfficeholder(state: GameState, officeId: OfficeId): GameState {
  return vacateOffice(state, officeId, "pensioners").state;
}

function officeOrder(officeId: OfficeId): number {
  return offices.find((office) => office.id === officeId)?.hiringOrder ?? Number.MAX_SAFE_INTEGER;
}

/** Remember the sitting Chairman so a later vacancy still knows who leads retirements (p.11). */
/** "Starting with the Chairman (or former Chairman if the office is vacant) and going clockwise" (p.11). */
export function beginRetirements(state: GameState, context: RetirementContext): GameState {
  const leader = chairmanTitleHolder(state);
  const progress: RetirementProgress = {
    context,
    order: clockwiseFrom(state, leader),
    current: 0,
    spending: {},
    retired: [],
    usedDiscounts: {},
    lettersOfIntroduction: [],
  };

  return { ...state, londonSeason: { ...state.londonSeason, retirement: progress } };
}

/**
 * Moves to the next player with pensioners and returns their decision, or no decision when every
 * player has finished retiring.
 */
export function advanceRetirements(state: GameState): { state: GameState; decision?: PendingDecision } {
  const progress = state.londonSeason.retirement;
  if (!progress) return { state };

  // A player with no affordable prize is still asked: another player may lend them cash first
  // ("players can transfer funds to each other at any time", p.8, p.36).
  let current = progress.current;
  while (current < progress.order.length && (state.players[progress.order[current]]?.familyMembers.pensioners ?? 0) === 0) {
    current += 1;
  }
  const next = state;

  const nextState: GameState =
    current === progress.current && next === state
      ? state
      : { ...next, londonSeason: { ...next.londonSeason, retirement: { ...progress, current } } };

  if (current >= progress.order.length) return { state: nextState };

  return { state: nextState, decision: retirementDecision(nextState, progress.order[current]) };
}

// Cash can change hands mid-retirement (p.8): rebuild the affordable prizes after a transfer.
registerDecisionRefresher("retirement.retirePensioner", (state) => {
  const actor = state.pendingDecision.actor;
  return state.londonSeason.retirement && actor !== "system" && actor !== "simultaneous"
    ? retirementDecision(state, actor)
    : state.pendingDecision;
});

function retirementDecision(state: GameState, playerId: PlayerId): PendingDecision {
  const progress = state.londonSeason.retirement as RetirementProgress;
  const player = state.players[playerId];
  const prizeOptions = retirementOptions(state, progress, playerId);
  const legalCommands: LegalCommand[] = [...prizeOptions];
  const holdsLetters =
    !progress.lettersOfIntroduction.includes(playerId) &&
    player.blackmailCards.some((card) => card.cardId === LETTERS_OF_INTRODUCTION && card.facedown !== false);

  if (holdsLetters) {
    legalCommands.push({
      type: "retirement.playLettersOfIntroduction",
      label: "Play Letters of Introduction: also use every other player's spouse discounts",
      payload: {},
    });
  }

  legalCommands.push({
    type: "retirement.stop",
    label:
      player.familyMembers.pensioners === 1
        ? "Do not retire this pensioner"
        : `Do not retire the remaining ${player.familyMembers.pensioners} pensioners`,
    description:
      progress.context === "londonSeason"
        ? "Unretired pensioners return to supply at the end of the London Season (p.12)."
        : "Unretired pensioners score nothing.",
    payload: {},
  });

  return {
    id: `decision-retirement-${progress.context}-t${state.turn}-${playerId}-${state.log.length + 1}`,
    phase: state.phase,
    step: "retirement.retirePensioner",
    actor: playerId,
    // Offering Letters of Introduction would reveal a face-down blackmail card.
    visibility: holdsLetters ? "private" : "public",
    prompt:
      prizeOptions.length > 0
        ? `${player.name}: retire a pensioner to a prize (${player.familyMembers.pensioners} pensioner(s), £${player.cash}).`
        : `${player.name}: no prize is affordable with £${player.cash}. Another player may lend you cash first (Deals & Cards); otherwise choose not to retire.`,
    legalCommands,
    canSave: true,
  };
}

type Discount = { key: DiscountKey; amount: number; label: string };

function availableDiscounts(state: GameState, progress: RetirementProgress, playerId: PlayerId): Discount[] {
  const used = new Set(progress.usedDiscounts[playerId] ?? []);
  const discounts: Discount[] = playerSpouses(state, playerId)
    .filter((spouse) => spouse.retirementDiscount > 0)
    .map((spouse) => ({ key: `own:${spouse.id}`, amount: spouse.retirementDiscount, label: spouse.name }));

  // Letters of Introduction: "act as if you also have retirement discounts equal to those on all
  // other players' spouses".
  if (progress.lettersOfIntroduction.includes(playerId)) {
    for (const otherId of state.seatingOrder) {
      if (otherId === playerId) continue;
      for (const spouse of playerSpouses(state, otherId)) {
        if (spouse.retirementDiscount <= 0) continue;
        discounts.push({
          key: `borrowed:${otherId}:${spouse.id}`,
          amount: spouse.retirementDiscount,
          label: `${spouse.name} (${state.players[otherId].name}'s, via Letters of Introduction)`,
        });
      }
    }
  }

  return discounts.filter((discount) => !used.has(discount.key));
}

/** Lord Highgate: "You may only retire to the 8 or 12 victory point prizes." */
function allowedPrizes(state: GameState, playerId: PlayerId): PrizeDefinition[] {
  const allowedVp = playerSpouses(state, playerId)
    .flatMap((spouse) => spouse.effects)
    .flatMap((effect) => (effect.type === "restrictRetirementPrizes" ? [effect.allowedPrizeVictoryPoints] : []));

  return prizes.filter((prize) => allowedVp.every((allowed) => allowed.includes(prize.victoryPoints)));
}

/**
 * One option per prize and per useful combination of unused discounts (p.12: discounts stack and
 * each is used once per London Season / Final Scoring). Discounts of equal value are
 * interchangeable, so combinations are enumerated by how many of each value are used.
 */
function retirementOptions(state: GameState, progress: RetirementProgress, playerId: PlayerId): LegalCommand[] {
  const player = state.players[playerId];
  const discounts = availableDiscounts(state, progress, playerId).sort(
    (left, right) => right.amount - left.amount || left.key.localeCompare(right.key),
  );
  const amounts = [...new Set(discounts.map((discount) => discount.amount))];
  const combos: Discount[][] = [];

  const build = (groupIndex: number, chosen: Discount[]): void => {
    if (groupIndex === amounts.length) {
      combos.push(chosen);
      return;
    }
    const group = discounts.filter((discount) => discount.amount === amounts[groupIndex]);
    for (let count = 0; count <= group.length; count += 1) {
      build(groupIndex + 1, [...chosen, ...group.slice(0, count)]);
    }
  };
  build(0, []);

  const options: LegalCommand[] = [];
  for (const prize of allowedPrizes(state, playerId)) {
    for (const combo of combos) {
      const total = combo.reduce((sum, discount) => sum + discount.amount, 0);
      const smallest = combo.reduce((min, discount) => Math.min(min, discount.amount), Infinity);
      // Skip combinations with a discount that would save nothing.
      if (combo.length > 0 && total - smallest >= prize.cost) continue;

      const cost = Math.max(0, prize.cost - total);
      if (player.cash < cost) continue;

      const discountText =
        combo.length === 0 ? "" : ` using ${combo.map((discount) => `-£${discount.amount} ${discount.label}`).join(", ")}`;
      options.push({
        type: "retirement.retirePensioner",
        label: `Retire to the £${prize.cost} prize (${prize.victoryPoints} VP, upkeep £${prize.upkeep}) for £${cost}${discountText}`,
        payload: { prizeId: prize.id, discounts: combo.map((discount) => discount.key) },
      });
    }
  }

  return options;
}

/** Applies a validated `retirement.*` command for the acting player. */
export function applyRetirementCommand(
  state: GameState,
  command: GameCommand,
): { ok: true; state: GameState; summary: string; details: unknown } | Extract<ApplyCommandResult, { ok: false }> {
  const progress = state.londonSeason.retirement;
  if (!progress) return illegal("No retirement step is in progress.");

  const legal = findLegalCommand(state, command);
  if (!legal) return illegal(`"${command.type}" with this payload is not one of the listed choices.`);

  const playerId = progress.order[progress.current];
  const player = state.players[playerId];

  if (command.type === "retirement.stop") {
    return {
      ok: true,
      state: {
        ...state,
        londonSeason: { ...state.londonSeason, retirement: { ...progress, current: progress.current + 1 } },
      },
      summary: `${player.name} stopped retiring pensioners.`,
      details: { playerId, unretiredPensioners: player.familyMembers.pensioners },
    };
  }



  const payload = command.payload as { prizeId: string; discounts: DiscountKey[] };
  const prize = prizeById.get(payload.prizeId) as PrizeDefinition;
  const discountTotal = availableDiscounts(state, progress, playerId)
    .filter((discount) => payload.discounts.includes(discount.key))
    .reduce((sum, discount) => sum + discount.amount, 0);
  const cost = Math.max(0, prize.cost - discountTotal);

  return {
    ok: true,
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          cash: player.cash - cost,
          victoryPoints: player.victoryPoints + prize.victoryPoints,
          familyMembers: {
            ...player.familyMembers,
            pensioners: player.familyMembers.pensioners - 1,
            prizes: {
              ...player.familyMembers.prizes,
              [prize.id]: (player.familyMembers.prizes[prize.id] ?? 0) + 1,
            },
          },
        },
      },
      londonSeason: {
        ...state.londonSeason,
        retirement: {
          ...progress,
          spending: { ...progress.spending, [playerId]: (progress.spending[playerId] ?? 0) + cost },
          retired: progress.retired.includes(playerId) ? progress.retired : [...progress.retired, playerId],
          usedDiscounts: {
            ...progress.usedDiscounts,
            [playerId]: [...(progress.usedDiscounts[playerId] ?? []), ...payload.discounts],
          },
        },
      },
    },
    summary: `${player.name} retired a pensioner to the £${prize.cost} prize for £${cost} (+${prize.victoryPoints} VP).`,
    details: { playerId, prizeId: prize.id, cost, discounts: payload.discounts, victoryPoints: prize.victoryPoints },
  };
}

/** Pensioners left in the box return to their family's supply (p.12). */
export function returnPensionersToSupply(state: GameState): GameState {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        player.familyMembers.pensioners === 0
          ? player
          : {
              ...player,
              familyMembers: {
                ...player.familyMembers,
                supply: player.familyMembers.supply + player.familyMembers.pensioners,
                pensioners: 0,
              },
            },
      ]),
    ),
  };
}

export function prestigeCardName(cardId: string): string {
  return prestigeById.get(cardId)?.name ?? blackmailById.get(cardId)?.name ?? cardId;
}

/** Matches a command against the pending decision's listed choices, payload included. */
export function findLegalCommand(state: GameState, command: GameCommand): LegalCommand | undefined {
  const key = stableKey(command.payload ?? {});
  return state.pendingDecision.legalCommands.find(
    (legal) => legal.type === command.type && stableKey(legal.payload ?? {}) === key,
  );
}

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableKey((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function illegal(message: string): Extract<ApplyCommandResult, { ok: false }> {
  return { ok: false, errors: [{ code: "ILLEGAL_CHOICE", message, field: "payload" }] };
}
