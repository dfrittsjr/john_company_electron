import { enterpriseDecks, offices, prestigeCards, prizes } from "../../../data";
import { isDeregulated, firmById, allFirms, firmShareTotal } from "../../firms";
import { activeInterrupt, applyTransfer, moveBlackmailCard } from "../../phases/negotiation";
import type { FirmAction } from "../../phases/firms/investments";
import { isSpecialRetirementStage, prizeDefinition, retirementOptionCost } from "../../phases/retirements";
import { rollDie } from "../../rng";
import {
  companyShareCount,
  companySharesByPlayer,
  isShipFitted,
  playerForbidsHolding,
  regionPresidency,
} from "../../selectors";
import type { GameState, LegalCommand, PendingDecision, PlayerId, PresidencyId } from "../../types";
import {
  choose,
  crownDecidingStep,
  optionsOfType,
  printedCost,
  type CrownArea,
  type CrownChoice,
  type CrownCubeDetector,
  type CrownFavorDefinition,
  type CrownPolicy,
} from "../kit";
import {
  addCrownEffect,
  appendCrownLog,
  climateName,
  crownClimate,
  crownDirection,
  crownPickPlayer,
  crownPresidencyOrder,
  crownSplayIndex,
  CROWN_PLAYER_ID,
  crownEffects,
  humanPlayerIds,
} from "../state";
import {
  CROWN_FAMILY_CHART,
  crownWriterPresidencies,
  nextChartPosition,
} from "./early-phases-rules";

// The Crown in the London Season, Family, Firms and Hiring phases (Crown Handbook pp.2-3), plus the
// favours on the Crown's family board. Phase code only offers the Crown its decisions; everything
// it chooses is decided here.

const CROWN = CROWN_PLAYER_ID;
const payloadOf = (command: LegalCommand) => (command.payload ?? {}) as Record<string, any>;
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

const isSolo = (state: GameState) => humanPlayerIds(state).length === 1;
const isTwoPlayer = (state: GameState) => humanPlayerIds(state).length === 2;
const prizeVictoryPoints = (prizeId: string) => prizes.find((prize) => prize.id === prizeId)?.victoryPoints ?? 0;

/** Commands that place a piece: those from supply, else those taking the lowest-VP prize piece (p.13). */
function cheapestSource(commands: LegalCommand[]): LegalCommand[] {
  const fromSupply = commands.filter((command) => !payloadOf(command).fromPrize);
  if (fromSupply.length > 0) return fromSupply;
  const lowest = Math.min(...commands.map((command) => prizeVictoryPoints(payloadOf(command).fromPrize)));
  return commands.filter((command) => prizeVictoryPoints(payloadOf(command).fromPrize) === lowest);
}

// ---------------------------------------------------------------------------------------------
// London Season (Handbook p.2)
// ---------------------------------------------------------------------------------------------

/** Retirements: the highest VP prize within half the treasury (rounded up), one pensioner at a time. */
const retirementPolicy: CrownPolicy = (state, decision) => {
  const progress = state.londonSeason.retirement;
  const crown = state.players[CROWN];
  if (!progress || !crown) return undefined;
  const stop = optionsOfType(decision, "retirement.stop")[0];
  const special = isSpecialRetirementStage(progress);

  const options = optionsOfType(decision, "retirement.retirePensioner").map((command) => {
    const payload = payloadOf(command) as { prizeId: string; discounts: string[] };
    const prize = prizeDefinition(payload.prizeId)!;
    return { command, prize, cost: retirementOptionCost(state, CROWN, payload), discounts: payload.discounts.length };
  });
  const best = (candidates: typeof options) =>
    [...candidates].sort(
      (a, b) => b.prize.victoryPoints - a.prize.victoryPoints || a.cost - b.cost || a.discounts - b.discounts,
    )[0];

  if (special) {
    // "When Deregulation is in effect, the Crown will take the single highest VP special retirement they can afford."
    const pick = best(options);
    return pick
      ? choose(pick.command, `Special retirement: the highest VP prize it can afford (£${pick.prize.cost}, ${pick.prize.victoryPoints} VP, for £${pick.cost}).`)
      : choose(stop, "Special retirement: no prize is affordable.");
  }

  // Hard and Expert: "During Final Retirement, the Crown will spend as much as possible on pensioners."
  const spendAll =
    progress.context === "finalScoring" && (state.crown?.difficulty === "hard" || state.crown?.difficulty === "expert");
  const budget = spendAll ? crown.cash : Math.ceil(crown.cash / 2);
  // "The Crown will only retire to the £2 space if it entitles them to a card from the London Season":
  // a pensioner's retirement there entitles the family to one card, and only the first does.
  const entitlesCard = progress.context === "londonSeason" && !progress.retired.includes(CROWN);
  const affordable = options.filter(({ prize, cost }) => cost <= budget && (prize.victoryPoints > 0 || entitlesCard));
  const pick = best(affordable);
  const limit = spendAll ? "everything it has (Final Retirement, Hard/Expert)" : `at most half of £${crown.cash}, rounded up (£${budget})`;
  return pick
    ? choose(pick.command, `Retires a pensioner to the highest VP prize it can buy with ${limit}: £${pick.prize.cost} (${pick.prize.victoryPoints} VP) for £${pick.cost}.`)
    : choose(stop, `Stops retiring: no prize with VP fits within ${limit}.`);
};

/** Prestige Cards: the card in the face-up AI card's shaded slot, else the next to the right. */
const prestigePolicy: CrownPolicy = (state, decision) => {
  const takes = optionsOfType(decision, "londonSeason.choosePrestigeCard", (payload) => payload.action === "take");
  const slots = state.londonSeason.display.map((_, slot) => takes.some((command) => payloadOf(command).slot === slot));
  const slot = crownSplayIndex(state, slots);
  if (slot === undefined) return undefined;
  const pick = takes.find((command) => payloadOf(command).slot === slot);
  return choose(pick, `Takes the Display card in the AI card's shaded slot (position ${slot + 1}), or the next to its right.`);
};

/** "Any Crown blackmail cards are kept facedown." */
const scandalPolicy: CrownPolicy = (_state, decision) =>
  choose(optionsOfType(decision, "londonSeason.resolveScandal", (payload) => payload.action === "keep")[0], "Crown blackmail cards are kept face down.");

// ---------------------------------------------------------------------------------------------
// Family (Handbook p.3)
// ---------------------------------------------------------------------------------------------

type Move = LegalCommand;

/** Picks the parameters of a chart action among its legal options (Seek Share space, Presidency, source). */
function actionOptions(state: GameState, moves: Move[], action: string, why: string): CrownChoice | undefined {
  const same = moves.filter((command) => payloadOf(command).action === action);
  if (same.length === 0) return undefined;

  if (action === "seek-share") {
    // "Places on the cheapest space (will take rightmost of the £3 spots if £3 is the cheapest)."
    const exchange = state.company.stockExchange;
    const costOf = (command: Move) => exchange.find((slot) => slot.id === payloadOf(command).slotId)?.cost ?? Infinity;
    const cheapest = Math.min(...same.map(costOf));
    const slots = same.filter((command) => costOf(command) === cheapest);
    const rightmost = Math.max(...slots.map((command) => exchange.findIndex((slot) => slot.id === payloadOf(command).slotId)));
    const pick = cheapestSource(slots.filter((command) => exchange.findIndex((slot) => slot.id === payloadOf(command).slotId) === rightmost));
    return { commands: pick, reason: `${why}: Seek Share on the cheapest space (£${cheapest}${slots.length > 1 ? ", the rightmost" : ""}).` };
  }
  if (action === "enlist-writer") {
    const presidencies = [...new Set(same.map((command) => payloadOf(command).presidency as PresidencyId))];
    const [presidency] = crownWriterPresidencies(state, presidencies);
    return {
      commands: cheapestSource(same.filter((command) => payloadOf(command).presidency === presidency)),
      reason: `${why}: Enlist Writer in ${presidency} (vacant Presidencies with no Crown writer, then Crown Presidencies, then fewest Crown writers, then the AI card).`,
    };
  }
  if (action === "enlist-officer") return { commands: cheapestSource(same), reason: `${why}: Enlist Officer.` };
  return { commands: same, reason: `${why}: ${action === "purchase-shipyard" ? "buy a shipyard" : action === "purchase-luxury" ? "buy a luxury" : "buy a workshop"}.` };
}

/** The Crown's chart actions, left to right, skipping any that is not viable or affordable. */
const familyChartPolicy: CrownPolicy = (state, decision) => {
  const crown = state.family.turn?.crown;
  if (!crown) return undefined;
  const climate = crownClimate(state);
  const moves = decision.legalCommands.filter((command) => command.type === "family.chooseAction" && !payloadOf(command).stockBroker);
  const next = nextChartPosition(CROWN_FAMILY_CHART[climate], crown.chartIndex, (action) =>
    moves.some((command) => payloadOf(command).action === action),
  );
  if (!next) {
    return choose(
      moves.find((command) => payloadOf(command).action === "no-action"),
      `${climateName(climate)}: nothing further on the family chart is viable or affordable.`,
    );
  }
  return actionOptions(state, moves, next.action, `${climateName(climate)}: chart action ${ORDINALS[next.index]}`);
};

/** "They will attempt to take the most recently passed extra action unless they have already done so." */
const familyExtraActionPolicy: CrownPolicy = (state, decision) => {
  const moves = decision.legalCommands.filter((command) => command.type === "family.chooseExtraAction" && !payloadOf(command).stockBroker);
  const action = moves[0] && (payloadOf(moves[0]).action as string);
  if (!action) return choose(optionsOfType(decision, "family.skipExtraAction")[0], "No extra action is viable.");
  return actionOptions(state, moves, action, "The most recently passed extra action");
};

/** Free Enlist Writer: four or more vacant offices; then a Presidency without a President or a Crown writer. */
const freeWriterPolicy: CrownPolicy = (state, decision) => {
  const moves = optionsOfType(decision, "family.placeExtraWriter");
  const presidencies = [...new Set(moves.map((command) => payloadOf(command).presidency as PresidencyId))];
  const [presidency] = crownWriterPresidencies(state, presidencies);
  const picked = cheapestSource(moves.filter((command) => payloadOf(command).presidency === presidency));
  return {
    commands: picked,
    reason:
      decision.step === "family.crownFreeWriter"
        ? `Four or more offices are vacant: a free Enlist Writer in ${presidency}.`
        : `No President and no Crown writer in ${presidency}: a free Enlist Writer there.`,
  };
};

/** The Crown never gives permission (Handbook p.2), the Stock Broker's included. */
const stockBrokerConsentPolicy: CrownPolicy = (_state, decision) =>
  choose(
    optionsOfType(decision, "family.resolveStockBrokerConsent", (payload) => payload.accepted === false)[0],
    "The Crown gives no permission or consent unless the Handbook says so (p.2).",
  );

// ---------------------------------------------------------------------------------------------
// Firms (Handbook p.3) and consent
// ---------------------------------------------------------------------------------------------

/** Does the Crown hold a majority of Company shares (Court and Chairman)? */
function crownHasCompanyMajority(state: GameState): boolean {
  return (companySharesByPlayer(state).get(CROWN) ?? 0) * 2 > companyShareCount(state);
}

/**
 * Where the Crown may invest: the invest commands it has, minus any that would give it a majority of
 * that firm's shares ("the Crown will never invest if it gives them the majority of shares in that firm").
 */
export function crownInvestmentChoices(state: GameState, commands: LegalCommand[]): LegalCommand[] {
  return commands.filter((command) => {
    if (command.type !== "firms.invest") return false;
    const firm = firmById(state, payloadOf(command).firmId);
    if (!firm) return false;
    const total = firmShareTotal(firm);
    const createsShare = total < 10;
    const crownAfter = (firm.shares[CROWN] ?? 0) + (createsShare ? 1 : 0);
    return crownAfter * 2 <= total + (createsShare ? 1 : 0);
  });
}

const FIRM_INVEST_FAVOR = "firms.investInYourFirm";

const crownInvestmentPolicy: CrownPolicy = (state, decision) => {
  const pass = optionsOfType(decision, "firms.pass")[0];
  const climate = crownClimate(state);
  const willSeek = climate === "lion" || climate === "bear" || climate === "peacock";
  const paidFor = crownEffects(state, FIRM_INVEST_FAVOR).map((effect) => effect.option as string);
  if (!willSeek && paidFor.length === 0) return choose(pass, `${climateName(climate)}: the Crown will not invest in a firm.`);
  if (!crownHasCompanyMajority(state)) return choose(pass, "The Crown invests only with a majority of Company shares.");

  let options = crownInvestmentChoices(state, decision.legalCommands);
  // Bull and Stag: only the firm a player has paid it to invest in.
  if (!willSeek) options = options.filter((command) => paidFor.includes(payloadOf(command).firmId));
  if (options.length === 0) return choose(pass, "No firm can take a Crown investment without giving it the majority of that firm's shares.");

  // "Using Company shares (unless they are weak), and then workshops."
  const shares = options.filter((command) => payloadOf(command).source.kind === "companyShare");
  const bySource = shares.length > 0 ? shares : options;
  // Two players: the firm of the player holding the Player Button, which then passes (p.44; Handbook p.3).
  const managers = [...new Set(bySource.map((command) => firmById(state, payloadOf(command).firmId)!.manager))];
  const picked = managers.length > 1 ? crownPickPlayer(state, managers) : { playerId: managers[0], passButton: false };
  const commands = bySource.filter((command) => firmById(state, payloadOf(command).firmId)!.manager === picked.playerId);
  return {
    commands: commands.slice(0, 1),
    reason: `${climateName(climate)}: the Crown seeks one investment${picked.passButton ? " in the Button holder's firm" : ""}, with a ${
      shares.length > 0 ? "Company share" : "workshop"
    }.`,
    ...(picked.passButton ? { passButton: true } : {}),
  };
};

/** The consent request on top of the negotiation stack, if the pending decision is one. */
function consentRequest(state: GameState) {
  const frame = activeInterrupt(state);
  return frame && frame.kind === "consent" && state.pendingDecision.step === "negotiation.consent" ? frame.request : undefined;
}

/**
 * Consent the Crown is asked for: "if any card requires permission or consent from the Crown, they
 * will not give it" (p.2), except that it "always give[s] consent for dissolution and merging of
 * firms" (p.3). Other areas' exceptions (Crown Presidents consenting to Crown Commanders' Local
 * Alliances, Handbook p.12) belong in this table too.
 */
const consentPolicy: CrownPolicy = (state, decision) => {
  const request = consentRequest(state);
  const accept = optionsOfType(decision, "negotiation.respondToConsent", (payload) => payload.accept === true)[0];
  const refuse = optionsOfType(decision, "negotiation.respondToConsent", (payload) => payload.accept === false)[0];
  if (!request) return undefined;
  if (request.kind === "firms.action") {
    const action = request.context as FirmAction;
    if (action.kind === "dissolve" || action.kind === "merge") {
      return choose(accept, "The Crown always gives consent for dissolution and merging of firms (Handbook p.3).");
    }
  }
  return choose(refuse, "The Crown gives no permission or consent unless the Handbook says so (p.2).");
};

// ---------------------------------------------------------------------------------------------
// Hiring (Handbook p.3)
// ---------------------------------------------------------------------------------------------

function courtShareCounts(state: GameState): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const share of state.company.court) if (share.owner) counts.set(share.owner, (counts.get(share.owner) ?? 0) + 1);
  return counts;
}

/** "If the Crown has majority of shares (or an equality and is former Chairman), they will elect themselves." */
export function crownElectsItself(state: GameState): boolean {
  const counts = courtShareCounts(state);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const own = counts.get(CROWN) ?? 0;
  if (own === 0) return false;
  const former = state.hiring.election?.formerChairman ?? state.company.chairmanMarker;
  return own * 2 > total || (own * 2 === total && former === CROWN);
}

const chairmanSupportPolicy: CrownPolicy = (state, decision) => {
  const moves = optionsOfType(decision, "hiring.declareChairmanSupport");
  if (crownElectsItself(state)) {
    return choose(
      moves.find((command) => payloadOf(command).candidateId === CROWN),
      "The Crown has a majority of Company shares (or an equality as former Chairman): it elects itself Chairman.",
    );
  }
  return choose(
    moves.find((command) => payloadOf(command).candidateId === null),
    "The Crown has no majority of Company shares, so it supports no one.",
  );
};

const chairmanPickPolicy: CrownPolicy = (state, decision) => {
  if (!crownElectsItself(state)) return undefined;
  return choose(
    optionsOfType(decision, "hiring.electChairman").find((command) => payloadOf(command).candidateId === CROWN),
    "The Crown has a majority of Company shares (or an equality as former Chairman): it elects itself Chairman.",
  );
};

/** The presidency a candidate belongs to, for the AI card's tie-break. */
function candidatePresidency(state: GameState, command: LegalCommand): PresidencyId | undefined {
  const source = payloadOf(command).source as { type: string; presidency?: PresidencyId; army?: PresidencyId; officeId?: string };
  if (source.type === "writer") return source.presidency;
  if (source.type === "commander" || source.type === "officer") return source.army;
  if (source.type === "office") {
    const region = offices.find((office) => office.id === source.officeId)?.region;
    return region ? regionPresidency(state, region) : undefined;
  }
  return undefined;
}

const hirePolicy: CrownPolicy = (state, decision) => {
  const hires = optionsOfType(decision, "hiring.hireOffice");
  if (hires.length === 0) return undefined;
  const officeId = payloadOf(hires[0]).officeId as string;
  // "The Crown always hires their own family if able."
  const own = hires.filter((command) => payloadOf(command).candidateId === CROWN);
  let pool = own.length > 0 ? own : hires;
  const who = own.length > 0 ? "hires its own family" : "hires";

  // Director of Trade and Governor General: "the first eligible officeholder, clockwise or
  // counterclockwise as indicated by the AI card, along the Company Operation ribbon starting at Chairman."
  if (officeId === "director-of-trade" || officeId === "governor-general") {
    const promotions = pool.filter((command) => payloadOf(command).source.type === "office");
    if (promotions.length > 0) {
      const direction = crownDirection(state);
      const place = (command: LegalCommand) => offices.find((office) => office.id === payloadOf(command).source.officeId)?.operationOrder ?? 99;
      const ordered = [...promotions].sort((a, b) => (direction === "clockwise" ? place(a) - place(b) : place(b) - place(a)));
      return choose(ordered[0], `The Crown ${who}: the first eligible officeholder ${direction} along the Company Operation ribbon from the Chairman.`);
    }
  }

  // "Priority to writers, officers, and then Governors. Use AI card to break ties between candidates."
  const tier = (command: LegalCommand) => {
    const type = payloadOf(command).source.type;
    return type === "writer" ? 0 : type === "office" ? 2 : 1;
  };
  const bestTier = Math.min(...pool.map(tier));
  pool = pool.filter((command) => tier(command) === bestTier);
  const order = crownPresidencyOrder(state);
  const rank = (command: LegalCommand) => {
    const presidency = candidatePresidency(state, command);
    return presidency ? order.indexOf(presidency) : order.length;
  };
  const bestRank = Math.min(...pool.map(rank));
  pool = pool.filter((command) => rank(command) === bestRank);

  // Still tied between the two players: the Crown picks the one holding the Player Button (p.44).
  const candidates = [...new Set(pool.map((command) => payloadOf(command).candidateId as string))];
  let passButton = false;
  if (candidates.length > 1 && candidates.every((candidate) => candidate !== CROWN)) {
    const picked = crownPickPlayer(state, candidates);
    if (picked.playerId) {
      pool = pool.filter((command) => payloadOf(command).candidateId === picked.playerId);
      passButton = picked.passButton;
    }
  }
  const label = ["writers", "officers", "Governors"][bestTier];
  return {
    commands: pool,
    reason: `The Crown ${who}: priority to ${label}${bestRank < order.length ? `, then the AI card's Presidency order` : ""}.`,
    ...(passButton ? { passButton: true } : {}),
  };
};

const nepotismConsentPolicy: CrownPolicy = (_state, decision) =>
  choose(
    optionsOfType(decision, "hiring.resolveNepotismConsent", (payload) => payload.accepted === false)[0],
    "The Crown gives no consent for nepotism unless a favour buys it (Handbook p.2).",
  );

// ---------------------------------------------------------------------------------------------
// Favours
// ---------------------------------------------------------------------------------------------

/** A favour that makes the Crown take one particular option (or a few) on the pending decision. */
function choiceFavor(input: {
  id: string;
  printed: CrownFavorDefinition["printed"];
  steps: string[];
  when?: (state: GameState, playerId: PlayerId, option: unknown) => boolean;
  options?: CrownFavorDefinition["options"];
  cost?: CrownFavorDefinition["cost"];
  choices: (state: GameState, playerId: PlayerId, option: unknown) => LegalCommand[];
}): CrownFavorDefinition {
  const all = (state: GameState) => state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands;
  const usable = (state: GameState, playerId: PlayerId, option: unknown) =>
    input.choices(state, playerId, option).filter((choice) => all(state).some((legal) => legal.type === choice.type && JSON.stringify(legal.payload) === JSON.stringify(choice.payload)));
  return {
    id: input.id,
    printed: input.printed,
    options: input.options,
    cost: input.cost,
    available: (state, playerId) => {
      if (!crownDecidingStep(state, input.steps)) return false;
      if (crownEffects(state).some((effect) => effect.decisionId === state.pendingDecision.id && effect.choices)) return false;
      if (input.options) return input.options(state, playerId).some(({ option }) => (input.when?.(state, playerId, option) ?? true) && usable(state, playerId, option).length > 0);
      return (input.when?.(state, playerId, undefined) ?? true) && usable(state, playerId, undefined).length > 0;
    },
    apply: (state, playerId, option) => {
      const choices = usable(state, playerId, option);
      if (choices.length === 0) throw new Error("The Crown has no such option now.");
      return addCrownEffect(state, {
        favorId: input.id,
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        ...(option !== undefined ? { option } : {}),
        choices,
      });
    },
  };
}

function withPlayer(state: GameState, playerId: PlayerId, change: (player: GameState["players"][string]) => GameState["players"][string]): GameState {
  return { ...state, players: { ...state.players, [playerId]: change(state.players[playerId]) } };
}

/** Moves pounds between families' treasuries. */
function moveCash(state: GameState, from: PlayerId, to: PlayerId, amount: number): GameState {
  return withPlayer(withPlayer(state, from, (player) => ({ ...player, cash: player.cash - amount })), to, (player) => ({
    ...player,
    cash: player.cash + amount,
  }));
}

// --- London Season (p.2) ---

/** No retirement has been taken yet this London Season: "At the start of this phase (before retirements)". */
function beforeRetirements(state: GameState): boolean {
  const progress = state.londonSeason.retirement;
  return (
    state.phase === "londonSeason" &&
    progress?.context === "londonSeason" &&
    state.pendingDecision.step === "retirement.retirePensioner" &&
    progress.retired.length === 0 &&
    Object.keys(progress.spending).length === 0 &&
    (progress.specialUsed ?? []).length === 0
  );
}

/** The Crown has finished its retirements, special ones included. */
function crownRetirementsDone(state: GameState): boolean {
  if (state.phase !== "londonSeason") return false;
  const progress = state.londonSeason.retirement;
  if (progress) return progress.order.indexOf(CROWN) < progress.current;
  return state.londonSeason.prestige !== undefined;
}

const takeCashFavors: CrownFavorDefinition[] = [
  {
    id: "londonSeason.start.takeCash",
    printed: { page: 2, text: "Take £1 from the Crown family treasury.", nth: 0 },
    available: (state) => beforeRetirements(state) && (state.players[CROWN]?.cash ?? 0) >= 1,
    apply: (state, playerId) => moveCash(state, CROWN, playerId, 1),
  },
  {
    id: "londonSeason.afterRetirements.takeCash",
    printed: { page: 2, text: "Take £1 from the Crown family treasury.", nth: 1 },
    available: (state) => crownRetirementsDone(state) && (state.players[CROWN]?.cash ?? 0) >= 1,
    pausesCrown: false,
    apply: (state, playerId) => moveCash(state, CROWN, playerId, 1),
  },
];

const crownCards = (state: GameState, kind: "enterprise" | "blackmail") =>
  kind === "blackmail"
    ? state.players[CROWN].blackmailCards
    : state.players[CROWN].prestigeCards.filter((card) => prestigeType(card.cardId) === "enterprise");

const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));
const prestigeType = (cardId: string) => prestigeById.get(cardId)?.prestigeType;
const prestigeNameById = (cardId: string) => prestigeById.get(cardId)?.name ?? cardId;

const prestigeFavors: CrownFavorDefinition[] = [
  {
    id: "londonSeason.takeEnterpriseCard",
    printed: { page: 2, text: "Take an enterprise prestige card from the Crown." },
    available: (state) => state.phase === "londonSeason" && state.londonSeason.prestige !== undefined && crownCards(state, "enterprise").length > 0,
    options: (state) =>
      crownCards(state, "enterprise").map((card) => ({ label: prestigeNameById(card.cardId), option: card.id })),
    apply: (state, playerId, option) => applyTransfer(state, CROWN, playerId, [{ kind: "prestige", cardInstanceId: option as string }]),
  },
  {
    id: "londonSeason.takeBlackmailCard",
    printed: { page: 2, text: "Take a blackmail card from the Crown." },
    available: (state, playerId) =>
      state.phase === "londonSeason" &&
      state.londonSeason.prestige !== undefined &&
      crownCards(state, "blackmail").length > 0 &&
      !playerForbidsHolding(state, playerId, "blackmail"),
    apply: (state, playerId, _option, now) => {
      // "You may not peek": which card comes is left to chance.
      const cards = crownCards(state, "blackmail");
      const roll = rollDie(state.rng, cards.length < 2 ? 2 : cards.length, "crown.takeBlackmail");
      const card = cards[cards.length < 2 ? 0 : roll.value - 1];
      const moved = moveBlackmailCard({ ...state, rng: roll.rng }, CROWN, playerId, card.id, true);
      return appendCrownLog(moved, {
        now,
        actor: playerId,
        type: "crown.blackmailTaken",
        summary: `${moved.players[playerId].name} took a face-down blackmail card from the Crown.`,
      });
    },
  },
];

// --- Firms (p.3) ---

const firmsFavors: CrownFavorDefinition[] = [
  choiceFavor({
    id: "firms.consentFitCrownShip",
    printed: { page: 3, text: "Consent to fit a Crown ship." },
    steps: ["negotiation.consent"],
    when: (state) => consentIs(state, "fitShip"),
    choices: (state) => consentOptions(state, true),
  }),
  choiceFavor({
    id: "firms.consentBuybackCrownShip",
    printed: { page: 3, text: "Consent to buyback a Crown-owned ship from the Company." },
    steps: ["negotiation.consent"],
    when: (state) => consentIs(state, "buyBack"),
    choices: (state) => consentOptions(state, true),
  }),
  {
    // Bull and Stag: the Crown would not invest at all, so a player pays for it to invest in their firm.
    id: FIRM_INVEST_FAVOR,
    printed: { page: 3, text: "Will invest in your firm for one investment." },
    available: (state, playerId) => {
      const fp = state.firmsPhase;
      return (
        state.phase === "firms" &&
        fp?.step === "investments" &&
        !fp.crownActed &&
        state.pendingDecision.actor !== CROWN &&
        crownHasCompanyMajority(state) &&
        allFirms(state).some((firm) => firm.manager === playerId) &&
        !crownEffects(state, FIRM_INVEST_FAVOR).some((effect) => effect.by === playerId)
      );
    },
    pausesCrown: false,
    apply: (state, playerId) => {
      const firm = allFirms(state).find((candidate) => candidate.manager === playerId)!;
      return addCrownEffect(state, {
        favorId: FIRM_INVEST_FAVOR,
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        option: firm.id,
      });
    },
  },
  {
    id: "firms.denyCrownInvestment",
    printed: { page: 3, text: "[SOLO ONLY] Deny the Crown's investment." },
    available: (state, playerId) => {
      if (!isSolo(state) || !crownDecidingStep(state, ["firms.crownInvestment"]) || boughtOnDecision(state)) return false;
      return crownInvestsIn(state, playerId) !== undefined;
    },
    cost: (state, playerId) => {
      const firm = crownInvestsIn(state, playerId);
      return firm && printedCost(state, { page: 3, text: "[SOLO ONLY] Deny the Crown's investment." }) ? -firm.value : undefined;
    },
    apply: (state, playerId) =>
      addCrownEffect(state, {
        favorId: "firms.denyCrownInvestment",
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        choices: (state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands).filter((command) => command.type === "firms.pass"),
      }),
  },
  choiceFavor({
    id: "firms.consentHostileTakeover",
    printed: { page: 3, text: "[2P ONLY] The Crown will give consent for a hostile takeover" },
    steps: ["negotiation.consent"],
    when: (state, playerId) => {
      const request = consentRequest(state);
      const action = request?.context as FirmAction | undefined;
      return (
        isTwoPlayer(state) &&
        action?.kind === "takeOver" &&
        action.actor === playerId &&
        state.crown?.playerButton?.holder === playerId
      );
    },
    cost: (state) => {
      const action = consentRequest(state)?.context as FirmAction | undefined;
      const firm = action?.kind === "takeOver" ? firmById(state, action.firmId) : undefined;
      return firm ? -(firm.shares[CROWN] ?? 0) : undefined;
    },
    choices: (state) => consentOptions(state, true),
  }),
];

function boughtOnDecision(state: GameState): boolean {
  return crownEffects(state).some((effect) => effect.decisionId === state.pendingDecision.id && effect.choices);
}

/** The firm the Crown's policy would invest in now, if it is this player's. */
function crownInvestsIn(state: GameState, playerId: PlayerId) {
  const invest = state.pendingDecision.legalCommands.find((command) => command.type === "firms.invest");
  const firm = invest && firmById(state, payloadOf(invest).firmId);
  return firm && firm.manager === playerId ? firm : undefined;
}

function consentIs(state: GameState, kind: FirmAction["kind"]): boolean {
  const request = consentRequest(state);
  if (!request || request.kind !== "firms.action" || request.askOrder[0] !== CROWN) return false;
  return (request.context as FirmAction).kind === kind;
}

function consentOptions(state: GameState, accept: boolean): LegalCommand[] {
  const all = state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands;
  return all.filter((command) => command.type === "negotiation.respondToConsent" && payloadOf(command).accept === accept);
}

// --- Hiring (p.3) ---

const HIRING_STEPS = ["hiring.chairmanSupport", "hiring.electChairman"];

/** Hiring has begun: no office has been filled or skipped yet this phase (the Crown pauses once, here). */
function hiringJustStarted(state: GameState): boolean {
  for (let index = state.log.length - 1; index >= 0; index -= 1) {
    const entry = state.log[index];
    if (entry.turn !== state.turn || entry.phase !== "hiring") return true;
    if (entry.type.startsWith("hiring.")) return false;
  }
  return true;
}

/** Hiring, once the New Company Shares step is complete; not while a Chairman election has begun taking support. */
function inHiringShareWindow(state: GameState): boolean {
  if (state.phase !== "hiring" || state.hiring.immediate) return false;
  const election = state.hiring.election;
  return !election || election.nextSupporterIndex === 0;
}

function courtShareOf(state: GameState, owner: PlayerId) {
  return state.company.court.find((share) => share.owner === owner);
}

function hiringShareFavor(
  kind: "take" | "give" | "cash",
  start: boolean,
): CrownFavorDefinition {
  const text = { take: "Take a share from the Crown.", give: "Give a share to the Crown.", cash: "Give £1 from your family treasury to the Crown" }[kind];
  return {
    id: `hiring.${kind}${kind === "cash" ? "" : "Share"}${start ? ".start" : ""}`,
    printed: { page: 3, text },
    available: (state, playerId) => {
      if (!inHiringShareWindow(state) || hiringJustStarted(state) !== start) return false;
      const player = state.players[playerId];
      if (kind === "cash") return player.cash >= 1 && crownHasCompanyMajority(state);
      if (kind === "take") {
        return courtShareOf(state, CROWN) !== undefined && player.familyMembers.supply >= 1 && !playerForbidsHolding(state, playerId, "companyShare");
      }
      return courtShareOf(state, playerId) !== undefined && state.players[CROWN].familyMembers.supply >= 1;
    },
    pausesCrown: start,
    apply: (state, playerId) => {
      let next: GameState;
      if (kind === "cash") next = moveCash(state, playerId, CROWN, 1);
      else {
        const from = kind === "take" ? CROWN : playerId;
        const to = kind === "take" ? playerId : CROWN;
        next = applyTransfer(state, from, to, [{ kind: "share", shareId: courtShareOf(state, from)!.id }]);
      }
      return next;
    },
  };
}

function chairmanCandidates(state: GameState): PlayerId[] {
  return humanPlayerIds(state).filter((playerId) => courtShareOf(state, playerId));
}

/** The Crown's options that elect or back `candidate` on the pending Chairman decision. */
function backing(state: GameState, candidate: PlayerId): LegalCommand[] {
  const all = state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands;
  return all.filter((command) => payloadOf(command).candidateId === candidate && (command.type === "hiring.declareChairmanSupport" || command.type === "hiring.electChairman"));
}

const hiringFavors: CrownFavorDefinition[] = [
  ...(["take", "give", "cash"] as const).flatMap((kind) => [hiringShareFavor(kind, true), hiringShareFavor(kind, false)]),
  choiceFavor({
    id: "hiring.bribeChairman",
    printed: { page: 3, text: "If the Crown has majority (or an equality and is former Chairman), a player may bribe" },
    steps: HIRING_STEPS,
    when: (state) => crownElectsItself(state),
    options: (state) => chairmanCandidates(state).map((playerId) => ({ label: `elect ${state.players[playerId].name}`, option: playerId })),
    cost: (state) => (isDeregulated(state) ? -12 : -3),
    choices: (state, _playerId, option) => backing(state, option as PlayerId),
  }),
  choiceFavor({
    id: "hiring.persuadeChairman",
    printed: { page: 3, text: "[2P ONLY] If the Crown does not have a majority" },
    steps: ["hiring.chairmanSupport"],
    when: (state, playerId) => isTwoPlayer(state) && !crownElectsItself(state) && (courtShareCounts(state).get(CROWN) ?? 0) > 0 && chairmanCandidates(state).includes(playerId),
    options: (state, playerId) => [{ label: `support ${state.players[playerId].name}`, option: playerId }],
    cost: (state) => -(courtShareCounts(state).get(CROWN) ?? 0),
    choices: (state, _playerId, option) => backing(state, option as PlayerId),
  }),
  choiceFavor({
    id: "hiring.consentNepotism",
    printed: { page: 3, text: "Consent for Nepotism." },
    steps: ["hiring.nepotismConsent"],
    when: (state, playerId) => state.hiring.nepotism?.hirer === playerId,
    choices: (state) => (state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands).filter((command) => payloadOf(command).accepted === true),
  }),
  // "Make a hiring decision for the Crown": the buyer picks among every legal hire.
  {
    id: "hiring.decideForCrown",
    printed: { page: 3, text: "Make a hiring decision for the Crown." },
    available: (state) =>
      crownDecidingStep(state, ["hiring.hireOffice"]) &&
      !boughtOnDecision(state) &&
      (state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands).length > 1,
    apply: (state, playerId) =>
      addCrownEffect(state, {
        favorId: "hiring.decideForCrown",
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        choices: state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands,
      }),
  },
];

// --- The Crown's family board (anytime from the start of Firms to the end of Revenue) ---

const BOARD_PHASES = ["firms", "hiring", "companyOperation", "bonuses", "eventsInIndia", "revenue"];
const inBoardWindow = (state: GameState) => BOARD_PHASES.includes(state.phase);

type EnterpriseKind = "unfitted shipyard" | "fitted shipyard" | "uninvested workshop" | "invested workshop" | "luxury";

const BOARD_ITEMS: Array<{ kind: EnterpriseKind; text: string; id: string }> = [
  { kind: "unfitted shipyard", text: "Give (or take) an unfitted shipyard.", id: "unfittedShipyard" },
  { kind: "fitted shipyard", text: "Give (or take) a fitted shipyard.", id: "fittedShipyard" },
  { kind: "uninvested workshop", text: "Give (or take) an uninvested workshop.", id: "uninvestedWorkshop" },
  { kind: "invested workshop", text: "Give (or take) an invested workshop.", id: "investedWorkshop" },
  { kind: "luxury", text: "Give (or take) a luxury.", id: "luxury" },
];

function enterprisesOf(state: GameState, owner: PlayerId, kind: EnterpriseKind) {
  return state.players[owner].enterprises.filter((enterprise) => {
    switch (kind) {
      case "unfitted shipyard":
      case "fitted shipyard": {
        if (enterprise.type !== "shipyard") return false;
        const ship = state.company.ships.find((candidate) => candidate.kind === "player" && candidate.shipyardCardId === enterprise.cardId);
        return isShipFitted(ship) === (kind === "fitted shipyard");
      }
      case "uninvested workshop":
        return enterprise.type === "workshop" && !enterprise.invested;
      case "invested workshop":
        return enterprise.type === "workshop" && Boolean(enterprise.invested);
      case "luxury":
        return enterprise.type === "luxury";
    }
  });
}

const enterpriseNames = new Map(enterpriseDecks.flatMap((deck) => deck.cards).map((card) => [card.id as string, card.label]));

function boardFavors(): CrownFavorDefinition[] {
  const items = BOARD_ITEMS.flatMap(({ kind, text, id }) => {
    const holding = kind.includes("shipyard") ? "shipyard" : kind.includes("workshop") ? "workshop" : undefined;
    const options = (owner: (playerId: PlayerId) => PlayerId, verb: string) => (state: GameState, playerId: PlayerId) =>
      enterprisesOf(state, owner(playerId), kind).map((enterprise) => ({
        label: `${verb} ${enterpriseNames.get(enterprise.cardId ?? "") ?? enterprise.cardId ?? enterprise.id}`,
        option: enterprise.id,
      }));
    const give: CrownFavorDefinition = {
      id: `board.give.${id}`,
      printed: { board: text },
      available: inBoardWindow,
      options: options((playerId) => playerId, "give"),
      pausesCrown: false,
      apply: (state, playerId, option) => applyTransfer(state, playerId, CROWN, [{ kind: "enterprise", enterpriseId: option as string }]),
    };
    const take: CrownFavorDefinition = {
      id: `board.take.${id}`,
      printed: { board: text, take: true },
      available: (state, playerId) => inBoardWindow(state) && !(holding && playerForbidsHolding(state, playerId, holding)),
      options: options(() => CROWN, "take the Crown's"),
      pausesCrown: false,
      apply: (state, playerId, option) => applyTransfer(state, CROWN, playerId, [{ kind: "enterprise", enterpriseId: option as string }]),
    };
    return [give, take];
  });

  const prestigeEnterprise: CrownFavorDefinition = {
    id: "board.give.prestigeEnterprise",
    printed: { board: "Give an enterprise from a prestige card." },
    available: inBoardWindow,
    options: (state, playerId) =>
      state.players[playerId].prestigeCards
        .filter((card) => prestigeType(card.cardId) === "enterprise")
        .map((card) => ({ label: prestigeNameById(card.cardId), option: card.id })),
    pausesCrown: false,
    apply: (state, playerId, option) => applyTransfer(state, playerId, CROWN, [{ kind: "prestige", cardInstanceId: option as string }]),
  };
  const cash: CrownFavorDefinition = {
    id: "board.give.cash",
    printed: { board: "Give £3." },
    available: (state, playerId) => inBoardWindow(state) && state.players[playerId].cash >= 3,
    pausesCrown: false,
    apply: (state, playerId) => moveCash(state, playerId, CROWN, 3),
  };
  return [...items, prestigeEnterprise, cash, ...easyFavor()];
}

/** [EASY MODE ONLY] Remove a promise card from the game for Turn/2 (rounded up) cubes. */
function easyFavor(): CrownFavorDefinition[] {
  return [
    {
      id: "board.easy.removePromise",
      printed: { board: "[EASY MODE ONLY]" },
      available: (state) => inBoardWindow(state) && state.crown?.difficulty === "easy",
      options: (state, playerId) =>
        state.negotiation.promiseCards
          .filter((card) => card.holder === playerId && !card.removedFromGame)
          .map((card) => ({ label: card.id, option: card.id })),
      cost: (state) => Math.ceil(state.turn / 2),
      pausesCrown: false,
      apply: (state, _playerId, option) => ({
        ...state,
        negotiation: {
          ...state.negotiation,
          promiseCards: state.negotiation.promiseCards.map((card) => (card.id === option ? { ...card, removedFromGame: true } : card)),
        },
      }),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Cube detectors: favours that describe what a player does
// ---------------------------------------------------------------------------------------------

const formFirmDetector: CrownCubeDetector = {
  favorId: "firms.formFirm",
  printed: { page: 3, text: "If you form a private firm" },
  detect: (before, after, command) => {
    if (command.type !== "firms.formFirm") return [];
    const known = new Set(allFirms(before).map((firm) => firm.id));
    return allFirms(after)
      .filter((firm) => !known.has(firm.id))
      .map((firm) => ({
        playerId: firm.manager,
        cubes: -3,
        partial: true,
        reason: "formed a private firm (mandatory favour, as many as they have)",
      }));
  },
};

/** Chairman election: a player with majority (or equality as former Chairman) backs the Crown. */
const electCrownDetector: CrownCubeDetector = {
  favorId: "hiring.electCrown",
  printed: { page: 3, text: "A player with majority (or an equality and is former Chairman) votes to elect the Crown" },
  detect: (before, after, command) => {
    if (command.type !== "hiring.declareChairmanSupport" && command.type !== "hiring.electChairman") return [];
    if ((command.payload as { candidateId?: unknown } | undefined)?.candidateId !== CROWN) return [];
    const playerId = command.actorId as PlayerId;
    if (before.players[playerId]?.isCrown) return [];
    const counts = courtShareCounts(before);
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const own = counts.get(playerId) ?? 0;
    const former = before.hiring.election?.formerChairman ?? before.company.chairmanMarker;
    if (!(own * 2 > total || (own * 2 === total && own > 0 && former === playerId))) return [];
    const cubes = isDeregulated(before) ? 6 : 3;
    return [{ playerId, cubes, reason: "voted to elect the Crown as Chairman" }];
  },
};

const hireCrownDetector: CrownCubeDetector = {
  favorId: "hiring.hireCrownFamily",
  printed: { page: 3, text: "Hire a Crown family member over any non-Crown family member." },
  detect: (before, _after, command) => {
    if (command.type !== "hiring.hireOffice" || (command.payload as { candidateId?: unknown }).candidateId !== CROWN) return [];
    const others = before.pendingDecision.legalCommands.some((legal) => payloadOf(legal).candidateId !== CROWN);
    return others ? [{ playerId: command.actorId as PlayerId, cubes: 1, reason: "hired a Crown family member over a non-Crown one" }] : [];
  },
};

/** Consent to the Crown's own nepotism: +2 solo (mandatory with 2+ promises), +1 each when both players agree in a two-player game. */
function nepotismDetector(solo: boolean): CrownCubeDetector {
  return {
    favorId: solo ? "hiring.crownNepotism.solo" : "hiring.crownNepotism.twoPlayer",
    printed: solo
      ? { page: 3, text: "[SOLO ONLY] You must give consent for nepotism to the Crown" }
      : { page: 3, text: "[2P ONLY] When both players are candidates" },
    detect: (before, _after, command) => {
      const nepotism = before.hiring.nepotism;
      const accepted = (command.payload as { accepted?: unknown } | undefined)?.accepted === true;
      if (command.type !== "hiring.resolveNepotismConsent" || !accepted || !nepotism || nepotism.hirer !== CROWN) return [];
      const playerId = command.actorId as PlayerId;
      if (solo) return isSolo(before) ? [{ playerId, cubes: 2, reason: "consented to the Crown's nepotism" }] : [];
      // Unanimous consent of both players, who were both asked because both are candidates.
      const everyone = [...nepotism.consented, playerId];
      if (!isTwoPlayer(before) || nepotism.pending.length !== 1 || !humanPlayerIds(before).every((id) => everyone.includes(id))) return [];
      return everyone.map((id) => ({ playerId: id, cubes: 1, reason: "consented, with the other player, to the Crown's nepotism" }));
    },
  };
}

// ---------------------------------------------------------------------------------------------

export const earlyPhasesCrown: CrownArea = {
  pages: [2, 3],
  boardFavors: true,
  policies: {
    "retirement.retirePensioner": retirementPolicy,
    "londonSeason.choosePrestigeCard": prestigePolicy,
    "londonSeason.resolveScandal": scandalPolicy,
    "family.chooseAction": familyChartPolicy,
    "family.chooseCrownAction": familyChartPolicy,
    "family.chooseExtraAction": familyExtraActionPolicy,
    "family.crownFreeWriter": freeWriterPolicy,
    "family.crownVacancyWriter": freeWriterPolicy,
    "family.stockBrokerConsent": stockBrokerConsentPolicy,
    "firms.crownInvestment": crownInvestmentPolicy,
    "negotiation.consent": consentPolicy,
    "hiring.chairmanSupport": chairmanSupportPolicy,
    "hiring.electChairman": chairmanPickPolicy,
    "hiring.hireOffice": hirePolicy,
    "hiring.nepotismConsent": nepotismConsentPolicy,
  },
  favors: [...takeCashFavors, ...prestigeFavors, ...firmsFavors, ...hiringFavors, ...boardFavors()],
  detectors: [formFirmDetector, electCrownDetector, hireCrownDetector, nepotismDetector(true), nepotismDetector(false)],
  notDone: [],
};
