import { governorsLostToRegionLossOnTurn } from "./events-in-india";
import type { CommandHandler } from "../command-handler";
import {
  blackmailCards,
  companyFailureCards,
  companyShareScoring,
  policyDial,
  powerAward,
  prestigeCards,
} from "../../data";
import type { FailureCard, PowerTargetId } from "../../data";
import { rollDie } from "../rng";
import {
  companySharesByPlayer,
  officeDefinition,
  playerCommands,
  playerOffices,
  playerOfficers,
  playerWindowIcons,
  powerTrackValue,
  PRESIDENCY_IDS,
  primeMinisterOrder,
} from "../selectors";
import type { ApplyCommandResult, EnterpriseInstance, GameCommand, GameState, PendingDecision, PlayerId, RngRollRecord } from "../types";
import type { FinalScoringEntry, FinalScoringPlayerResult, PowerBreakdown } from "./final-scoring.state";
import { advanceRetirements, beginRetirements, resolveOfficeAttrition, returnPensionersToSupply } from "./retirements";
import { createCommandLogEntry, wrongPhase } from "./shared";

// Final Scoring (p.9): Power Award, Court and workshops, then the final retirement if the
// Company survived or a Company failure card if it failed. Ties go to most window icons, then
// Prime Minister order.

const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));
const blackmailById = new Map(blackmailCards.map((card) => [card.id, card]));

export function confirmFinalScoring(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "finalScoring" || state.pendingDecision.step !== "finalScoring.confirm") {
    return wrongPhase("Final Scoring can only start from its confirmation step.");
  }

  const now = command.clientTimestamp;
  const survived = !state.company.failed;
  const rolls: RngRollRecord[] = [];
  let next: GameState = state;

  let failureCard: FailureCard | undefined;
  if (!survived) {
    const draw = rollDie(next.rng, companyFailureCards.length, "finalScoring.failureCard");
    rolls.push(draw.roll);
    failureCard = companyFailureCards[draw.value - 1];
    next = { ...next, rng: draw.rng };
  }

  next = scoreBeforeRetirement(next, survived, failureCard);
  let summary = survived
    ? "Final Scoring: the Company survived."
    : `Final Scoring: the Company failed; drew ${failureCard?.name}.`;

  let decision: PendingDecision | undefined;
  if (survived) {
    // "If the Company survived, all players roll for attrition and retire any pensioners. No
    // prestige cards are gained" (p.9).
    const attrition = resolveOfficeAttrition(next, "finalScoring.attrition");
    rolls.push(...attrition.rolls);
    next = beginRetirements(attrition.state, "finalScoring");
    next = {
      ...next,
      finalScoring: {
        ...next.finalScoring,
        victoryPointsBeforeRetirement: Object.fromEntries(
          Object.values(next.players).map((player) => [player.id, player.victoryPoints]),
        ),
      },
    };
    const advanced = advanceRetirements(next);
    next = advanced.state;
    decision = advanced.decision;
    summary += ` Final attrition retired ${attrition.retiredOffices.length} officeholder(s).`;
  }

  if (!decision) {
    next = completeFinalScoring(next);
  }

  const logEntry = createCommandLogEntry({
    state: next,
    command,
    now,
    type: "finalScoring.started",
    summary,
    details: {
      companySurvived: survived,
      failureCardId: failureCard?.id,
      players: next.finalScoring.players,
    },
    rngRolls: rolls,
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...next,
      updatedAt: now,
      pendingDecision: decision ?? next.pendingDecision,
      log: [...next.log, logEntry],
    },
  };
}

/** Called when the final retirement step has no more decisions. */
export function finishFinalScoringAfterRetirements(state: GameState): GameState {
  const before = state.finalScoring.victoryPointsBeforeRetirement ?? {};
  const players = { ...(state.finalScoring.players ?? {}) };

  for (const [playerId, result] of Object.entries(players)) {
    const gained = state.players[playerId].victoryPoints - (before[playerId] ?? state.players[playerId].victoryPoints);
    if (gained !== 0) {
      players[playerId] = {
        ...result,
        entries: [...result.entries, { label: "Final retirement to prizes", victoryPoints: gained }],
      };
    }
  }

  return completeFinalScoring({
    ...state,
    londonSeason: { ...state.londonSeason, retirement: undefined },
    finalScoring: { ...state.finalScoring, players },
  });
}

/** Steps 1 and 2 of Final Scoring (and the failure card), applied to each player's VP. */
function scoreBeforeRetirement(state: GameState, survived: boolean, failureCard: FailureCard | undefined): GameState {
  const powers = new Map(state.seatingOrder.map((playerId) => [playerId, playerPower(state, playerId)]));
  const awards = powerAwards(state, powers);
  const sharesScoreAsSuccess =
    survived || Boolean(failureCard?.effects.some((effect) => effect.type === "scoreSharesAsIfCompanySucceeded"));
  const shareVp = shareVictoryPoints(state, sharesScoreAsSuccess);
  const skipWorkshops = Boolean(
    failureCard?.effects.some((effect) => effect.type === "skipScoring" && effect.items.includes("workshops")),
  );
  const shares = companySharesByPlayer(state);

  const players: Record<PlayerId, FinalScoringPlayerResult> = {};
  let nextPlayers = state.players;

  for (const playerId of state.seatingOrder) {
    const player = state.players[playerId];
    const entries: FinalScoringEntry[] = [];

    const award = awards.get(playerId);
    if (award) entries.push(award);

    const shareCount = shares.get(playerId) ?? 0;
    if (shareCount > 0) {
      entries.push({
        label: `Company shares: ${shareCount} × ${shareVp > 0 ? "+" : ""}${shareVp}`,
        victoryPoints: shareCount * shareVp,
      });
    }

    if (!survived && !skipWorkshops) {
      const workshops = player.enterprises.filter((enterprise) => enterprise.type === "workshop").length;
      if (workshops > 0) entries.push({ label: `Workshops: ${workshops} × +1`, victoryPoints: workshops });
    }

    if (failureCard) entries.push(...failureCardEntries(state, playerId, failureCard));

    const total = entries.reduce((sum, entry) => sum + entry.victoryPoints, 0);
    players[playerId] = {
      playerId,
      victoryPointsBefore: player.victoryPoints,
      power: powers.get(playerId) as PowerBreakdown,
      entries,
      finalVictoryPoints: player.victoryPoints + total,
      windowIcons: playerWindowIcons(state, playerId),
      rank: 0,
    };
    nextPlayers = { ...nextPlayers, [playerId]: { ...player, victoryPoints: player.victoryPoints + total } };
  }

  return {
    ...state,
    players: nextPlayers,
    finalScoring: {
      ...state.finalScoring,
      companySurvived: survived,
      failureCardId: failureCard?.id,
      players,
    },
  };
}

function enterpriseKind(enterprise: EnterpriseInstance): PowerTargetId {
  switch (enterprise.type) {
    case "shipyard":
      return "shipping";
    case "workshop":
      return "manufacturing";
    case "luxury":
    default:
      return "social";
  }
}

/** Power (p.9): Power track, Prime Minister, passed laws, cards, and trophies. */
export function playerPower(state: GameState, playerId: PlayerId): PowerBreakdown {
  const player = state.players[playerId];
  let powerTrack = player.enterprises.reduce((sum, enterprise) => sum + powerTrackValue(state, enterpriseKind(enterprise)), 0);

  let cards = 0;
  for (const card of player.prestigeCards) {
    const definition = prestigeById.get(card.cardId);
    if (!definition) continue;
    // Prestige cards with an enterprise icon also count as enterprises (p.2, p.12).
    if (definition.enterpriseType) powerTrack += powerTrackValue(state, definition.enterpriseType);
    cards += definition.power;
  }
  // Blackmail power counts "if the card is faceup or down" (p.9).
  for (const card of player.blackmailCards) {
    cards += blackmailById.get(card.cardId)?.power ?? 0;
  }

  powerTrack += (companySharesByPlayer(state).get(playerId) ?? 0) * powerTrackValue(state, "companyShare");
  const primeMinister = state.parliament.primeMinister === playerId ? policyDial.primeMinisterPower : 0;
  const passedLaws = player.passedLawTokens;
  const trophies = player.trophies;

  return {
    powerTrack,
    primeMinister,
    passedLaws,
    cards,
    trophies,
    total: powerTrack + primeMinister + passedLaws + cards + trophies,
  };
}

/**
 * Power Award (p.9): most and second most power score by the final turn's band. Players tied for
 * most each take the lower value and no other award is given; players tied for second get nothing.
 */
function powerAwards(state: GameState, powers: Map<PlayerId, PowerBreakdown>): Map<PlayerId, FinalScoringEntry> {
  const band =
    powerAward.bands.find((candidate) => candidate.finalTurns.includes(state.turn)) ??
    powerAward.bands[powerAward.bands.length - 1];
  const awards = new Map<PlayerId, FinalScoringEntry>();
  const entries = [...powers.entries()];
  if (entries.length === 0) return awards;

  const most = Math.max(...entries.map(([, power]) => power.total));
  const tiedForMost = entries.filter(([, power]) => power.total === most).map(([playerId]) => playerId);

  if (tiedForMost.length > 1) {
    for (const playerId of tiedForMost) {
      awards.set(playerId, {
        label: `Power Award: tied for most power (${most}), lower award`,
        victoryPoints: band.secondPlace,
      });
    }
    return awards;
  }

  awards.set(tiedForMost[0], { label: `Power Award: most power (${most})`, victoryPoints: band.firstPlace });
  const rest = entries.filter(([playerId]) => playerId !== tiedForMost[0]);
  if (rest.length === 0) return awards;

  const second = Math.max(...rest.map(([, power]) => power.total));
  const tiedForSecond = rest.filter(([, power]) => power.total === second);
  if (tiedForSecond.length === 1) {
    awards.set(tiedForSecond[0][0], {
      label: `Power Award: second most power (${second})`,
      victoryPoints: band.secondPlace,
    });
  }

  return awards;
}

/**
 * VP per Company share (p.9): the Court's printed +1/-1, or the Company share VP token when one
 * has been placed. `company.shareValue` holds the token's absolute value (0 = no token).
 */
function shareVictoryPoints(state: GameState, companySucceeded: boolean): number {
  const token = Math.min(Math.abs(state.company.shareValue), companyShareScoring.maxAbsoluteValue);
  if (token > 0) return companySucceeded ? token : -token;
  return companySucceeded
    ? companyShareScoring.courtPrinted.companySucceeded
    : companyShareScoring.courtPrinted.companyFailed;
}

function failureCardEntries(state: GameState, playerId: PlayerId, card: FailureCard): FinalScoringEntry[] {
  const player = state.players[playerId];
  const entries: FinalScoringEntry[] = [];
  const label = (text: string) => `${card.name} ${text}`;
  const officesHeld = playerOffices(state, playerId);

  for (const effect of card.effects) {
    switch (effect.type) {
      case "vpPenaltyPerHolding": {
        const count =
          effect.holding === "shipyard"
            ? player.enterprises.filter((enterprise) => enterprise.type === "shipyard").length
            : effect.holding === "passedLawToken"
              ? player.passedLawTokens
              : effect.holding === "governor"
                ? officesHeld.filter((officeId) => officeDefinition(officeId)?.category === "governor").length
                : officesHeld.filter((officeId) => officeDefinition(officeId)?.category === "governorGeneral").length;
        if (count > 0) {
          entries.push({ label: label(`(${count} ${effect.holding})`), victoryPoints: -effect.vp * count });
        }
        break;
      }
      case "vpPenaltyForPrimeMinister":
        if (state.parliament.primeMinister === playerId) {
          entries.push({ label: label("(Prime Minister)"), victoryPoints: -effect.vp });
        }
        break;
      case "vpPenaltyPerGovernorLostToRegionLossOnFinalTurn": {
        const lost = governorsLostToRegionLossOnFinalTurn(state, playerId);
        if (lost > 0) entries.push({ label: label(`(${lost} Governor(s) lost on the final turn)`), victoryPoints: -effect.vp * lost });
        break;
      }
      case "vpPenaltyHalfOfSum": {
        // Ruling (docs/phase-build-guide.md): officers-in-training are not officers.
        const officers = PRESIDENCY_IDS.reduce((sum, army) => {
          const stack = playerOfficers(state, playerId)[army];
          return sum + stack.ready + stack.exhausted;
        }, 0);
        const sum =
          (effect.holdings.includes("officer") ? officers : 0) +
          (effect.holdings.includes("commander") ? playerCommands(state, playerId).length : 0) +
          (effect.holdings.includes("trophy") ? player.trophies : 0);
        const penalty = Math.floor(sum / 2);
        if (penalty > 0) entries.push({ label: label(`(half of ${sum})`), victoryPoints: -penalty });
        break;
      }
      default:
        // scoreSharesAsIfCompanySucceeded and skipScoring change the share and workshop steps.
        break;
    }
  }

  return entries;
}

/** Governors this family lost to Region Loss on the final turn, for The British Despots of India!. */
function governorsLostToRegionLossOnFinalTurn(state: GameState, playerId: PlayerId): number {
  return governorsLostToRegionLossOnTurn(state, state.turn).filter((record) => record.holder === playerId).length;
}

function completeFinalScoring(state: GameState): GameState {
  const settled = returnPensionersToSupply(state);
  const pmOrder = primeMinisterOrder(settled);
  const results = { ...(settled.finalScoring.players ?? {}) };

  for (const playerId of settled.seatingOrder) {
    const result = results[playerId];
    if (!result) continue;
    results[playerId] = {
      ...result,
      finalVictoryPoints: settled.players[playerId].victoryPoints,
      windowIcons: playerWindowIcons(settled, playerId),
    };
  }

  // Ties go to most window icons, then Prime Minister order (p.9).
  const ranking = [...settled.seatingOrder].sort(
    (left, right) =>
      settled.players[right].victoryPoints - settled.players[left].victoryPoints ||
      playerWindowIcons(settled, right) - playerWindowIcons(settled, left) ||
      pmOrder.indexOf(left) - pmOrder.indexOf(right),
  );
  ranking.forEach((playerId, index) => {
    if (results[playerId]) results[playerId] = { ...results[playerId], rank: index + 1 };
  });

  const winner = settled.players[ranking[0]];
  const decision: PendingDecision = {
    id: `decision-final-scoring-complete-turn-${settled.turn}`,
    phase: "finalScoring",
    step: "finalScoring.complete",
    actor: "system",
    visibility: "public",
    prompt: `Final Scoring is complete: ${winner?.name ?? "nobody"} wins with ${winner?.victoryPoints ?? 0} VP.`,
    legalCommands: [],
    canSave: true,
  };

  return {
    ...settled,
    finalScoring: { ...settled.finalScoring, players: results, ranking, complete: true },
    pendingDecision: decision,
  };
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const finalScoringCommandHandlers: Record<string, CommandHandler> = {
  "finalScoring.confirm": confirmFinalScoring,
};
