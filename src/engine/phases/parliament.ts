// Parliament Meets (rulebook pp.34-36): the Prime Minister draws and selects a law, picks a
// policy, players vote in rounds, and the law passes or fails with its policy consequence.
import type { CommandHandler } from "../command-handler";
import type { LawPolicyIcon } from "../../data";
import { shuffle } from "../rng";
import type { ApplyCommandResult, GameCommand, GameState, LegalCommand, PendingDecision, PlayerId } from "../types";
import type { ParliamentSession, PolicyTarget } from "./parliament.state";
import { createFinalScoringDecision } from "./revenue";
import { createCommandLogEntry, createSystemDecision, wrongPhase } from "./shared";
import { registerHiringResume } from "./hiring-resume";
import { markActivated, registerConsentResolver, registerStateRefresher, requestConsent } from "./negotiation";
import { newCollector, nextDecisionId, playerName, primeMinisterOrder, updatePlayer, type Collector } from "./parliament/common";
import { crownTreasuryVotes, DEREGULATION_SPEND, rollClimateShift } from "../crown/areas/parliament-rules";
import { CROWN_PLAYER_ID } from "../crown/state";
import { prestigeCardOwners } from "./parliament/holdings";
import {
  addPassedLaw,
  describePolicySpace,
  discardLaws,
  drawLawCard,
  lawCard,
  policyRotationOptions,
  voteCost,
} from "./parliament/laws";
import { officeLabel } from "../offices";
import {
  applyPowerSwapChoice,
  applySurrender,
  applyWarPiece,
  applyWarShip,
  primeMinister,
  runQueue,
  withSession,
  PARLIAMENT_HIRE_RESUME,
  PARLIAMENT_INDIA_RESUME,
} from "./parliament/resolution";
import { registerNestedIndiaResume } from "./events-in-india";
import { availableVoteCards, ownedVoteCards } from "./parliament/votes";
import { DEREGULATION_LAW_ID, deregulationStartingSupport } from "./parliament/deregulation";
import { londonSeasonStartDecision } from "./turn-start";

export { isLawPassed } from "./parliament/laws";
export { playerWindowIcons } from "./parliament/holdings";
export { vacateOffice } from "../offices";

const MAX_LAWS_DRAWN = 3;

function emptySession(): ParliamentSession {
  return {
    stage: "chooseLaw",
    drawn: [],
    oldIdeasMadeNew: false,
    startingSupport: 0,
    extraWindowTax: false,
    taxCollectorsOffered: [],
    votingOrder: [],
    voterIndex: 0,
    round: 0,
    votesThisRound: 0,
    votes: {},
    opposition: [],
    creditTo: {},
    borrowedEnterprises: {},
    usedCards: [],
    queue: [],
  };
}

/** Parliament begins: the Prime Minister reveals the first law (p.34). */
export function confirmParliament(state: GameState, command: GameCommand): ApplyCommandResult {
  if (state.phase !== "parliament" || state.pendingDecision.step !== "parliament.confirm") {
    return wrongPhase("Parliament can only begin at the start of Parliament Meets.");
  }

  const collector = newCollector();
  collector.notes.push("Parliament meets.");
  // The Vote to Deregulate is a special session at the start of a turn (p.36); Deregulation is
  // out of scope, so it is not offered here.
  const opened: GameState = {
    ...state,
    parliament: {
      ...state.parliament,
      session: emptySession(),
      voteMarker: 0,
      currentVotingRound: 0,
      votesByPlayer: {},
    },
  };
  return complete(state, drawIntoSession(opened, collector), command, collector, "parliament.opened");
}

function drawIntoSession(state: GameState, collector: Collector): GameState {
  const session = state.parliament.session!;
  const drawn = drawLawCard(state, collector);
  if (!drawn.lawId) {
    collector.notes.push("No laws remain to be drawn.");
    return drawn.state;
  }

  const law = lawCard(drawn.lawId);
  collector.notes.push(
    `${playerName(state, primeMinister(state))} revealed ${law.name}${law.kind === "dilemma" ? " (a dilemma, which must be chosen)" : ""}.`,
  );
  return withSession(drawn.state, { drawn: [...session.drawn, drawn.lawId] });
}

// ---------------------------------------------------------------------------------------------
// Progress: work out the next decision, resolving anything automatic on the way.

function progressParliament(state: GameState, collector: Collector): { state: GameState; decision: PendingDecision } {
  let current = state;

  for (let guard = 0; guard < 200; guard += 1) {
    const session = current.parliament.session;
    if (!session) return { state: current, decision: exitDecision(current) };

    switch (session.stage) {
      case "chooseLaw":
        if (session.drawn.length === 0) {
          current = withSession(current, { stage: "resolving", queue: [{ kind: "finish" }] });
          continue;
        }
        return { state: current, decision: chooseLawDecision(current, session) };
      case "chooseFromDiscard":
        return { state: current, decision: chooseFromDiscardDecision(current) };
      case "choosePolicy": {
        const icon = lawCard(session.lawId!).policyIcon;
        if (!icon) {
          current = afterPolicy(current);
          continue;
        }
        return { state: current, decision: choosePolicyDecision(current, icon) };
      }
      case "chooseImpeachmentTarget": {
        const decision = impeachmentDecision(current);
        if (decision) return { state: current, decision };
        current = withSession(current, { stage: "taxCollectorsOffer" });
        continue;
      }
      case "taxCollectorsOffer": {
        const owner = prestigeCardOwners(current, "tax-collectors").find(
          (playerId) => !session.taxCollectorsOffered.includes(playerId),
        );
        if (!owner || session.extraWindowTax) {
          current = startVoting(current, collector);
          continue;
        }
        return { state: current, decision: taxCollectorsDecision(current, owner) };
      }
      case "taxCollectorsConsent":
        return { state: current, decision: taxCollectorsConsentDecision(current) };
      case "voting": {
        const next = nextVoter(current, collector);
        if (next.decision) return { state: next.state, decision: next.decision };
        current = next.state;
        continue;
      }
      case "continueVoting":
        return { state: current, decision: continueVotingDecision(current) };
      case "resolving": {
        const resolved = runQueue(current, collector);
        if (resolved.decision) return { state: resolved.state, decision: resolved.decision };
        // The Vote to Deregulate leads straight on to the London Season (p.36).
        if (session.special && !resolved.state.parliament.session) {
          return { state: resolved.state, decision: londonSeasonStartDecision(resolved.state) };
        }
        current = resolved.state.parliament.session
          ? withSession(resolved.state, { queue: [{ kind: "finish" }] })
          : resolved.state;
        continue;
      }
    }
  }

  throw new Error("Parliament did not reach a decision.");
}

/** After Parliament: Upkeep, or Final Scoring if a law made the Company fail (p.35). */
function exitDecision(state: GameState): PendingDecision {
  if (state.company.failed) return createFinalScoringDecision(state);
  return createSystemDecision({
    id: `decision-upkeep-confirm-turn-${state.turn}`,
    phase: "upkeep",
    step: "upkeep.confirm",
    prompt: "Confirm Upkeep and Refresh.",
    commandType: "upkeep.confirm",
    label: "Confirm Upkeep",
    description: "Pay prize upkeep and refresh the board.",
  });
}

/** Recomputes the current Parliament decision, e.g. after an anytime transfer changed someone's cash. */
export function refreshParliamentDecision(state: GameState): GameState {
  if (state.phase !== "parliament" || !state.parliament.session) return state;
  const progressed = progressParliament(state, newCollector());
  return { ...progressed.state, phase: progressed.decision.phase, pendingDecision: progressed.decision };
}

// Votes come from cash and from cards in the voter's area (p.35), both of which can change hands
// mid-vote; rebuild the vote options after any transfer.
registerStateRefresher("parliament.vote", refreshParliamentDecision);
// A player returning taxed items may borrow first (p.8); re-settling the tax lets them pay instead.
registerStateRefresher("parliament.surrender", refreshParliamentDecision);

// Law effects resolved through Events in India (Relief Demanded, War Against France) that waited
// for a Commander's defence continue Parliament's resolution afterwards.
registerNestedIndiaResume(PARLIAMENT_INDIA_RESUME, (state) =>
  state.parliament.session?.awaitingIndia
    ? refreshParliamentDecision(withSession({ ...state, phase: "parliament" }, { awaitingIndia: false }))
    : state,
);

// An office created by a law is hired at once (p.25); when that hire had to wait for a player,
// Parliament's resolution continues afterwards.
registerHiringResume(PARLIAMENT_HIRE_RESUME, (state) =>
  state.parliament.session?.awaitingHire
    ? refreshParliamentDecision(withSession(state, { awaitingHire: false }))
    : state,
);

function complete(
  before: GameState,
  after: GameState,
  command: GameCommand,
  collector: Collector,
  logType: string,
): ApplyCommandResult {
  const progressed = progressParliament(after, collector);
  const now = command.clientTimestamp;
  const logEntry = createCommandLogEntry({
    state: before,
    command,
    now,
    type: logType,
    summary: collector.notes.join(" ") || "Parliament continued.",
    details: {
      voteMarker: progressed.state.parliament.voteMarker,
      primeMinister: progressed.state.parliament.primeMinister,
      oppositionLeader: progressed.state.parliament.oppositionLeader,
    },
    rngRolls: collector.rolls.length > 0 ? collector.rolls : undefined,
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...progressed.state,
      updatedAt: now,
      phase: progressed.decision.phase,
      pendingDecision: progressed.decision,
      log: [...before.log, logEntry],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Choosing the law and policy (p.34).

function chooseLawDecision(state: GameState, session: ParliamentSession): PendingDecision {
  const pm = primeMinister(state);
  const dilemma = session.drawn.find((lawId) => lawCard(lawId).kind === "dilemma");
  const selectable = dilemma ? [dilemma] : session.drawn;
  const deck = state.parliament.lawDeck;
  const canDraw = !dilemma && session.drawn.length < MAX_LAWS_DRAWN && deck.drawPile.length + deck.discardPile.length > 0;
  const legalCommands: LegalCommand[] = selectable.map((lawId) => {
    const law = lawCard(lawId);
    return {
      type: "parliament.selectLaw",
      label: `Bring ${law.name} before Parliament${law.startingSupport === null ? "" : ` (support ${signed(law.startingSupport)})`}`,
      description: law.text,
      payload: { lawId },
    };
  });
  if (canDraw) {
    legalCommands.push({
      type: "parliament.drawLaw",
      label: `Draw another law (${session.drawn.length} of ${MAX_LAWS_DRAWN} revealed)`,
      payload: {},
    });
  }

  return {
    id: nextDecisionId(state, "parliament.chooseLaw"),
    phase: "parliament",
    step: "parliament.chooseLaw",
    actor: pm,
    visibility: "public",
    prompt: dilemma
      ? `${lawCard(dilemma).name} is a dilemma: the Prime Minister must bring it before Parliament.`
      : "Prime Minister: choose a law to bring before Parliament, or draw another.",
    legalCommands,
    canSave: true,
  };
}

function chooseFromDiscardDecision(state: GameState): PendingDecision {
  return {
    id: nextDecisionId(state, "parliament.selectFromDiscard"),
    phase: "parliament",
    step: "parliament.selectFromDiscard",
    actor: primeMinister(state),
    visibility: "public",
    prompt: "Old Ideas Made New!: choose a law from the discard pile to bring before Parliament.",
    legalCommands: [...new Set(state.parliament.lawDeck.discardPile)].map((lawId) => ({
      type: "parliament.selectFromDiscard",
      label: `Bring ${lawCard(lawId).name} back before Parliament`,
      description: lawCard(lawId).text,
      payload: { lawId },
    })),
    canSave: true,
  };
}

function choosePolicyDecision(state: GameState, icon: LawPolicyIcon): PendingDecision {
  const options = policyRotationOptions(state.parliament.policyDialPosition, icon);
  const bySpace = new Map<number, string[]>();
  for (const option of options) bySpace.set(option.space, [...(bySpace.get(option.space) ?? []), option.direction]);

  return {
    id: nextDecisionId(state, "parliament.choosePolicy"),
    phase: "parliament",
    step: "parliament.choosePolicy",
    actor: primeMinister(state),
    visibility: "public",
    prompt: `Rotate the policy arm to the first space matching ${lawCard(state.parliament.session!.lawId!).name}'s icon.`,
    legalCommands: [...bySpace.entries()].map(([space, directions]) => {
      // The dial repeats some spaces (Power: shipping is printed twice), so name the space when two
      // options would otherwise read the same.
      const same = [...bySpace.keys()].some((other) => other !== space && describePolicySpace(other) === describePolicySpace(space));
      return {
        type: "parliament.choosePolicy",
        label: `Rotate ${directions.join(" or ")} to ${describePolicySpace(space)}${same ? ` (dial space ${space + 1})` : ""}`,
        payload: { space },
      };
    }),
    canSave: true,
  };
}

function setLaw(state: GameState, lawId: string): GameState {
  const law = lawCard(lawId);
  const startingSupport = law.startingSupport ?? 0;
  return withSession(
    { ...state, parliament: { ...state.parliament, voteMarker: startingSupport } },
    { lawId, startingSupport, stage: "choosePolicy" },
  );
}

function afterPolicy(state: GameState): GameState {
  const lawId = state.parliament.session!.lawId!;
  return withSession(state, {
    stage: lawCard(lawId).effectHandler === "public-demands-impeachment" ? "chooseImpeachmentTarget" : "taxCollectorsOffer",
  });
}

function impeachmentDecision(state: GameState): PendingDecision | undefined {
  const held = Object.values(state.company.offices).filter((office) => !office.vacant && office.holder);
  if (held.length === 0) return undefined;

  return {
    id: nextDecisionId(state, "parliament.chooseImpeachmentTarget"),
    phase: "parliament",
    step: "parliament.chooseImpeachmentTarget",
    actor: primeMinister(state),
    visibility: "public",
    prompt: "Public Demands Impeachment!: first, the Prime Minister picks one officeholder.",
    legalCommands: held.map((office) => ({
      type: "parliament.chooseImpeachmentTarget",
      label: `Pick ${officeLabel(office.id)} (${playerName(state, office.holder)})`,
      payload: { officeId: office.id },
    })),
    canSave: true,
  };
}

function taxCollectorsDecision(state: GameState, owner: PlayerId): PendingDecision {
  const isPm = owner === primeMinister(state);
  return {
    id: nextDecisionId(state, "parliament.taxCollectors"),
    phase: "parliament",
    step: "parliament.taxCollectors",
    actor: owner,
    visibility: "public",
    prompt: "Tax Collectors: before voting, you may treat the proposed policy as including an additional window tax.",
    legalCommands: [
      {
        type: "parliament.taxCollectors",
        label: isPm ? "Add a window tax to the policy" : "Ask the Prime Minister to add a window tax",
        payload: { propose: true },
      },
      { type: "parliament.taxCollectors", label: "Don't add a window tax", payload: { propose: false } },
    ],
    canSave: true,
  };
}

function taxCollectorsConsentDecision(state: GameState): PendingDecision {
  const proposer = state.parliament.session!.taxCollectorsProposer;
  return {
    id: nextDecisionId(state, "parliament.taxCollectorsConsent"),
    phase: "parliament",
    step: "parliament.taxCollectorsConsent",
    actor: primeMinister(state),
    visibility: "public",
    prompt: `${playerName(state, proposer)} (Tax Collectors) asks to add a window tax to the policy. Do you consent?`,
    legalCommands: [
      { type: "parliament.taxCollectorsConsent", label: "Consent: add a window tax", payload: { accept: true } },
      { type: "parliament.taxCollectorsConsent", label: "Refuse", payload: { accept: false } },
    ],
    canSave: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Voting (p.35).

function startVoting(state: GameState, collector: Collector): GameState {
  let current = state;
  const special = current.parliament.session?.special;
  // Crown games: after the law is chosen and before voting, the climate shifts (Handbook p.15),
  // whoever is Prime Minister. The Vote to Deregulate is not Parliament Meets.
  if (current.crown && !special) {
    const shift = rollClimateShift(current);
    current = shift.state;
    collector.rolls.push(shift.roll);
    collector.notes.push(shift.note);
  }
  // The Crown votes first in Parliament Meets (Handbook p.14), and last and against in the Vote to
  // Deregulate (p.2).
  const base = primeMinisterOrder(current);
  const order = current.crown
    ? special
      ? [...base.filter((playerId) => playerId !== CROWN_PLAYER_ID), ...base.filter((playerId) => playerId === CROWN_PLAYER_ID)]
      : [...base.filter((playerId) => playerId === CROWN_PLAYER_ID), ...base.filter((playerId) => playerId !== CROWN_PLAYER_ID)]
    : base;
  return withSession(
    { ...current, parliament: { ...current.parliament, currentVotingRound: 1, votesByPlayer: {} } },
    {
      stage: "voting",
      votingOrder: order,
      voterIndex: 0,
      round: 1,
      votesThisRound: 0,
      votes: Object.fromEntries(order.map((playerId) => [playerId, { for: 0, against: 0, credited: 0 }])),
    },
  );
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function voteCommands(state: GameState, voter: PlayerId): { commands: LegalCommand[]; castCount: number } {
  const session = state.parliament.session!;
  const pm = primeMinister(state);
  const isCrown = voter === CROWN_PLAYER_ID && Boolean(state.crown);
  const directions: Array<"for" | "against"> = [];
  if (!session.opposition.includes(voter)) directions.push("for");
  // The Prime Minister's Honor: the Prime Minister cannot vote against the law, except the Vote to
  // Deregulate, which the Prime Minister may vote against (p.36). The Crown may vote against its
  // own law (Handbook p.15).
  if (voter !== pm || session.special || isCrown) directions.push("against");

  const cost = voteCost(state);
  // The Crown buys no votes with cash, except the one purchase against Deregulation, up to a limit
  // by climate (Handbook p.2).
  const cashLimit = !isCrown
    ? (state.players[voter]?.cash ?? 0)
    : session.special && !session.usedCards.includes(`${voter}:cash`)
      ? Math.min(state.players[voter]?.cash ?? 0, DEREGULATION_SPEND[state.crown!.climate])
      : 0;
  const maxCashVotes = Math.floor(cashLimit / cost);
  // Every amount from 1 to the most the voter can pay for; the UI groups long lists.
  const amounts = Array.from({ length: maxCashVotes }, (_, index) => index + 1);
  const cards = availableVoteCards(state, voter, session);
  const commands: LegalCommand[] = [];

  for (const direction of directions) {
    for (const votes of amounts) {
      commands.push({
        type: "parliament.castVotes",
        label: `Spend £${votes * cost} for ${votes} vote${votes === 1 ? "" : "s"} ${direction}`,
        payload: { direction, source: "cash", votes },
      });
    }
    // The Crown's treasury gives it bonus votes, once per Parliament (Handbook p.14).
    const bonus = isCrown && !session.special && !session.usedCards.includes(`${voter}:treasury`) ? crownTreasuryVotes(state.players[voter].cash) : 0;
    if (bonus > 0) {
      commands.push({
        type: "parliament.castVotes",
        label: `Use the treasury's ${bonus} bonus vote${bonus === 1 ? "" : "s"} ${direction}`,
        payload: { direction, source: "treasury", votes: bonus },
      });
    }
    for (const card of cards) {
      const borrowed = card.ownerId !== voter ? ` (${playerName(state, card.ownerId)}'s)` : "";
      commands.push({
        type: "parliament.castVotes",
        label: `Rotate ${card.label}${borrowed} for ${card.votes} vote${card.votes === 1 ? "" : "s"} ${direction}`,
        payload: { direction, source: "card", cardKey: card.key },
      });
    }
  }
  const castCount = commands.length;

  // Coalitions: a voter may pledge their votes against to another player once per vote; the
  // partner commits to the opposition (p.35).
  if (castCount > 0 && directions.includes("against") && !session.creditTo[voter] && !session.special) {
    for (const partner of state.seatingOrder) {
      if (partner === voter || partner === pm || state.players[partner]?.isCrown) continue;
      if (session.coalitionRefused?.includes(`${voter}>${partner}`)) continue;
      commands.push({
        type: "parliament.setVoteCredit",
        label: `Cast my votes against on behalf of ${playerName(state, partner)} (coalition; they must consent)`,
        payload: { creditTo: partner },
      });
    }
  }

  commands.push({ type: "parliament.passVote", label: "Done voting this round", payload: {} });
  return { commands, castCount };
}

function nextVoter(state: GameState, collector: Collector): { state: GameState; decision?: PendingDecision } {
  const session = state.parliament.session!;
  for (let index = session.voterIndex; index < session.votingOrder.length; index += 1) {
    const voter = session.votingOrder[index];
    const options = voteCommands(state, voter);
    if (options.castCount > 0) {
      const current = withSession(state, { voterIndex: index });
      return { state: current, decision: voteDecision(current, voter, options.commands) };
    }
  }

  const ended = withSession(state, { voterIndex: session.votingOrder.length });
  if (session.votesThisRound === 0) return { state: startResolution(ended, collector) };
  return { state: withSession(ended, { stage: "continueVoting" }) };
}

function voteDecision(state: GameState, voter: PlayerId, legalCommands: LegalCommand[]): PendingDecision {
  const session = state.parliament.session!;
  const law = lawCard(session.lawId!);
  const support = state.parliament.voteMarker;
  return {
    id: nextDecisionId(state, "parliament.vote"),
    phase: "parliament",
    step: "parliament.vote",
    actor: voter,
    visibility: "public",
    prompt:
      `Round ${session.round}: ${law.name}${session.policySpace === undefined ? "" : ` (${describePolicySpace(session.policySpace)})`} ` +
      `has support ${signed(support)}; it passes at 0 or more. ${playerName(state, voter)}, cast votes or finish.`,
    legalCommands,
    canSave: true,
  };
}

function continueVotingDecision(state: GameState): PendingDecision {
  return {
    id: nextDecisionId(state, "parliament.continueVoting"),
    phase: "parliament",
    step: "parliament.continueVoting",
    actor: primeMinister(state),
    visibility: "public",
    prompt: `Every player has had a chance to vote; support is ${signed(state.parliament.voteMarker)}. Call another round or resolve the vote.`,
    legalCommands: [
      { type: "parliament.continueVoting", label: "Call another round of voting", payload: { another: true } },
      { type: "parliament.continueVoting", label: "Resolve the vote", payload: { another: false } },
    ],
    canSave: true,
  };
}

/** The player with the most votes against holds the Opposition Leader marker; a tie keeps it (p.35). */
function updateOppositionLeader(state: GameState): GameState {
  const votes = state.parliament.session!.votes;
  const credited = Object.entries(votes).filter(([, tally]) => tally.credited > 0);
  if (credited.length === 0) return state;
  const most = Math.max(...credited.map(([, tally]) => tally.credited));
  const leaders = credited.filter(([, tally]) => tally.credited === most);
  if (leaders.length !== 1) return state;
  return { ...state, parliament: { ...state.parliament, oppositionLeader: leaders[0][0] } };
}

function startResolution(state: GameState, collector: Collector): GameState {
  const session = state.parliament.session!;
  const lawId = session.lawId!;
  const law = lawCard(lawId);
  const passed = state.parliament.voteMarker >= 0;
  const pm = primeMinister(state);
  collector.notes.push(`${law.name} ${passed ? "passed" : "failed"} with support ${signed(state.parliament.voteMarker)}.`);

  let next = state;
  const queue: ParliamentSession["queue"] = [];
  if (session.special) {
    // Deregulation: no policy; a pass gives the Prime Minister a passed law token; a failure keeps the
    // Prime Minister in power and the law is not discarded (p.36).
    if (passed) {
      next = addPassedLaw(next, lawId);
      next = updatePlayer(next, pm, (player) => ({ ...player, passedLawTokens: player.passedLawTokens + 1 }));
      queue.push({ kind: "lawPassed", lawId });
    } else {
      queue.push({ kind: "lawFailed", lawId });
    }
    queue.push({ kind: "finish" });
    return withSession(next, { stage: "resolving", outcome: passed ? "passed" : "failed", queue });
  }
  if (passed) {
    next = addPassedLaw(next, lawId);
    next = updatePlayer(next, pm, (player) => ({ ...player, passedLawTokens: player.passedLawTokens + 1 }));
    if (session.policySpace !== undefined) {
      queue.push({ kind: "policy", space: session.policySpace, actor: pm, extraWindowTax: session.extraWindowTax });
      // Relief Demanded for Indian Famine!: enact this policy consequence a second time.
      // Assumption: a Tax Collectors window tax is added only once.
      if (law.effects.some((effect) => effect.type === "enactPolicyConsequenceAgain")) {
        queue.push({ kind: "policy", space: session.policySpace, actor: pm, extraWindowTax: false });
      }
    }
    queue.push({ kind: "lawPassed", lawId });
  } else {
    next = discardLaws(next, [lawId]);
    queue.push({ kind: "lawFailed", lawId }, { kind: "changePrimeMinister" });
    if (session.policySpace !== undefined) {
      queue.push({ kind: "movePolicyAfterFailure", taxCollectorsMayAdd: Boolean(next.parliament.oppositionLeader) });
    }
  }
  queue.push({ kind: "finish" });

  return withSession(next, { stage: "resolving", outcome: passed ? "passed" : "failed", queue });
}

/**
 * Hook for the "Vote with my enterprises as if you owned them" promise (NG): after a law is
 * proposed and before votes, the beneficiary may vote with the guarantor's enterprises. The Prime
 * Minister's enterprises may then be used against the law (p.35).
 */
export function grantEnterpriseVotes(
  state: GameState,
  guarantorId: PlayerId,
  beneficiaryId: PlayerId,
): { ok: true; state: GameState } | { ok: false; reason: string } {
  const session = state.parliament.session;
  if (state.phase !== "parliament" || !session?.lawId || session.stage === "resolving") {
    return { ok: false, reason: "Enterprise votes can only be lent while a law is before Parliament." };
  }
  const votesCast = Object.values(session.votes).some((tally) => tally.for + tally.against > 0);
  if (votesCast) return { ok: false, reason: "This promise must be used before votes are cast." };
  if (guarantorId === beneficiaryId) return { ok: false, reason: "A player cannot lend votes to themselves." };
  if (ownedVoteCards(state, guarantorId, session).length === 0 && !state.players[guarantorId]) {
    return { ok: false, reason: "Unknown guarantor." };
  }
  if (prestigeCardOwners(state, "lady-newcome").includes(guarantorId)) {
    return { ok: false, reason: "Lady Newcome removed this promise from the game." };
  }

  const lenders = session.borrowedEnterprises[beneficiaryId] ?? [];
  const lent = withSession(state, {
    borrowedEnterprises: {
      ...session.borrowedEnterprises,
      [beneficiaryId]: lenders.includes(guarantorId) ? lenders : [...lenders, guarantorId],
    },
  });
  return { ok: true, state: refreshParliamentDecision(lent) };
}

// ---------------------------------------------------------------------------------------------
// Command handlers.

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The command must match one of the listed legal commands exactly, payload included. */
function legalPayload<T>(state: GameState, command: GameCommand): T | undefined {
  const wanted = canonical(command.payload ?? {});
  const match = state.pendingDecision.legalCommands.find(
    (legal) => legal.type === command.type && canonical(legal.payload ?? {}) === wanted,
  );
  return match ? (match.payload as T) : undefined;
}

function illegal(message: string): ApplyCommandResult {
  return { ok: false, errors: [{ code: "ILLEGAL_PARLIAMENT_COMMAND", message, field: "payload" }] };
}

function handler<T>(
  step: string,
  logType: string,
  apply: (state: GameState, payload: T, collector: Collector, command: GameCommand) => GameState,
): CommandHandler {
  return (state, command) => {
    if (state.phase !== "parliament" || state.pendingDecision.step !== step || !state.parliament.session) {
      return wrongPhase(`"${command.type}" is not available now.`);
    }
    const payload = legalPayload<T>(state, command);
    if (!payload) return illegal(`That choice is not one of the legal options for "${step}".`);

    const collector = newCollector();
    return complete(state, apply(state, payload, collector, command), command, collector, logType);
  };
}

/** The Prime Minister calls (or declines) the Vote to Deregulate at the start of a turn (p.36). */
const deregulationCall: CommandHandler = (state, command) => {
  if (state.pendingDecision.step !== "parliament.deregulationCall") {
    return wrongPhase(`"${command.type}" is not available now.`);
  }
  const payload = legalPayload<{ call: boolean }>(state, command);
  if (!payload) return illegal('That choice is not one of the legal options for "parliament.deregulationCall".');

  const collector = newCollector();
  const pm = primeMinister(state);
  const now = command.clientTimestamp;
  if (!payload.call) {
    collector.notes.push(`${playerName(state, pm)} did not call a special session on Deregulation.`);
    const decision = londonSeasonStartDecision(state);
    const logEntry = createCommandLogEntry({ state, command, now, type: "parliament.deregulationDeclined", summary: collector.notes.join(" ") });
    return {
      ok: true,
      logEntry,
      state: { ...state, updatedAt: now, phase: decision.phase, pendingDecision: decision, log: [...state.log, logEntry] },
    };
  }

  const startingSupport = deregulationStartingSupport(state);
  collector.notes.push(
    `${playerName(state, pm)} called a special session of Parliament to vote on Deregulation (starting support ${signed(startingSupport)}).`,
  );
  const opened = startVoting(
    {
      ...state,
      parliament: {
        ...state.parliament,
        session: { ...emptySession(), stage: "voting", lawId: DEREGULATION_LAW_ID, startingSupport, special: "deregulation" },
        voteMarker: startingSupport,
        votesByPlayer: {},
      },
    },
    collector,
  );
  return complete(state, opened, command, collector, "parliament.deregulationCalled");
};

const drawLaw = handler<Record<string, never>>("parliament.chooseLaw", "parliament.lawDrawn", (state, _payload, collector) =>
  drawIntoSession(state, collector),
);

const selectLaw = handler<{ lawId: string }>("parliament.chooseLaw", "parliament.lawSelected", (state, { lawId }, collector) => {
  const session = state.parliament.session!;
  const law = lawCard(lawId);

  if (law.effectHandler === "old-ideas-made-new") {
    if (state.parliament.lawDeck.discardPile.length === 0) {
      // No discards: ignore the card, shuffle it back into the deck and draw a new law.
      // Assumption: the replacement is drawn first, so Old Ideas cannot be redrawn at once.
      collector.notes.push("Old Ideas Made New! found no discards; a new law is drawn and it is shuffled back.");
      const withoutCard = withSession(state, { drawn: session.drawn.filter((drawnId) => drawnId !== lawId) });
      const replaced = drawIntoSession(withoutCard, collector);
      const deck = replaced.parliament.lawDeck;
      const reshuffled = shuffle(replaced.rng, [...deck.drawPile, lawId]);
      collector.rolls.push(...reshuffled.rolls.slice(0, 1));
      return {
        ...replaced,
        rng: reshuffled.rng,
        parliament: { ...replaced.parliament, lawDeck: { ...deck, drawPile: reshuffled.items } },
      };
    }
    collector.notes.push("Old Ideas Made New!: the Prime Minister searches the discard pile.");
    return withSession(state, { oldIdeasMadeNew: true, stage: "chooseFromDiscard" });
  }

  collector.notes.push(`${playerName(state, primeMinister(state))} brought ${law.name} before Parliament.`);
  const others = session.drawn.filter((drawnId) => drawnId !== lawId);
  return setLaw(discardLaws(state, others), lawId);
});

const selectFromDiscard = handler<{ lawId: string }>(
  "parliament.selectFromDiscard",
  "parliament.lawSelected",
  (state, { lawId }, collector) => {
    const deck = state.parliament.lawDeck;
    const index = deck.discardPile.indexOf(lawId);
    const discardPile = [...deck.discardPile.slice(0, index), ...deck.discardPile.slice(index + 1)];
    collector.notes.push(`${lawCard(lawId).name} was brought back before Parliament.`);
    return setLaw({ ...state, parliament: { ...state.parliament, lawDeck: { ...deck, discardPile } } }, lawId);
  },
);

const choosePolicy = handler<{ space: number }>("parliament.choosePolicy", "parliament.policyChosen", (state, { space }, collector) => {
  collector.notes.push(`The policy arm points at ${describePolicySpace(space)}.`);
  return afterPolicy(
    withSession({ ...state, parliament: { ...state.parliament, policyDialPosition: space } }, { policySpace: space }),
  );
});

const chooseImpeachmentTarget = handler<{ officeId: string }>(
  "parliament.chooseImpeachmentTarget",
  "parliament.impeachmentTarget",
  (state, { officeId }, collector) => {
    collector.notes.push(`The Prime Minister picked ${officeLabel(officeId)} for impeachment.`);
    return withSession(state, { impeachmentOfficeId: officeId, stage: "taxCollectorsOffer" });
  },
);

const taxCollectors = handler<{ propose: boolean }>(
  "parliament.taxCollectors",
  "parliament.taxCollectors",
  (state, { propose }, collector, command) => {
    const session = state.parliament.session!;
    const owner = state.pendingDecision.actor as PlayerId;
    const offered = withSession(state, { taxCollectorsOffered: [...session.taxCollectorsOffered, owner] });
    if (!propose) {
      collector.notes.push(`${playerName(state, owner)} did not add a window tax.`);
      return offered;
    }
    if (owner === primeMinister(state)) {
      collector.notes.push(`${playerName(state, owner)} added a window tax to the policy (Tax Collectors).`);
      return withSession(offered, { extraWindowTax: true });
    }
    collector.notes.push(`${playerName(state, command.actorId)} asked to add a window tax (Tax Collectors).`);
    return withSession(offered, { stage: "taxCollectorsConsent", taxCollectorsProposer: owner });
  },
);

const taxCollectorsConsent = handler<{ accept: boolean }>(
  "parliament.taxCollectorsConsent",
  "parliament.taxCollectorsConsent",
  (state, { accept }, collector) => {
    collector.notes.push(accept ? "The Prime Minister consented to the extra window tax." : "The Prime Minister refused the extra window tax.");
    return withSession(state, { extraWindowTax: accept, stage: "taxCollectorsOffer" });
  },
);

type CastPayload =
  | { direction: "for" | "against"; source: "cash"; votes: number }
  | { direction: "for" | "against"; source: "treasury"; votes: number }
  | { direction: "for" | "against"; source: "card"; cardKey: string };

const castVotes = handler<CastPayload>("parliament.vote", "parliament.votesCast", (state, payload, collector) => {
  const session = state.parliament.session!;
  const voter = state.pendingDecision.actor as PlayerId;
  let next = state;
  let votes: number;

  if (payload.source === "cash") {
    votes = payload.votes;
    next = updatePlayer(next, voter, (player) => ({ ...player, cash: player.cash - votes * voteCost(state) }));
    // The Crown's one purchase against Deregulation (Handbook p.2).
    if (voter === CROWN_PLAYER_ID) next = withSession(next, { usedCards: [...session.usedCards, `${voter}:cash`] });
  } else if (payload.source === "treasury") {
    votes = payload.votes;
    next = withSession(next, { usedCards: [...session.usedCards, `${voter}:treasury`] });
  } else {
    const card = availableVoteCards(state, voter, session).find((candidate) => candidate.key === payload.cardKey)!;
    votes = card.votes;
    next = withSession(markActivated(next, [card.cardInstanceId]), { usedCards: [...session.usedCards, card.key] });
  }

  const current = next.parliament.session!;
  const tallies = { ...current.votes };
  const voterTally = tallies[voter] ?? { for: 0, against: 0, credited: 0 };
  let opposition = current.opposition;
  if (payload.direction === "for") {
    tallies[voter] = { ...voterTally, for: voterTally.for + votes };
  } else {
    const creditedTo = current.creditTo[voter] ?? voter;
    tallies[voter] = { ...voterTally, against: voterTally.against + votes };
    const creditTally = tallies[creditedTo] ?? { for: 0, against: 0, credited: 0 };
    tallies[creditedTo] = { ...creditTally, credited: creditTally.credited + votes };
    opposition = [...new Set([...opposition, voter, creditedTo])];
  }

  const voteMarker = next.parliament.voteMarker + (payload.direction === "for" ? votes : -votes);
  next = withSession(
    {
      ...next,
      parliament: {
        ...next.parliament,
        voteMarker,
        votesByPlayer: {
          ...next.parliament.votesByPlayer,
          [voter]: { for: tallies[voter].for, against: tallies[voter].against },
        },
      },
    },
    { votes: tallies, opposition, votesThisRound: current.votesThisRound + votes },
  );
  collector.notes.push(
    `${playerName(state, voter)} cast ${votes} vote${votes === 1 ? "" : "s"} ${payload.direction} the law (support now ${signed(voteMarker)}).`,
  );
  // The special session changes no Prime Minister, so it hands out no Opposition Leader marker.
  return session.special ? next : updateOppositionLeader(next);
});

const applyVoteCredit = handler<{ creditTo: PlayerId }>("parliament.vote", "parliament.coalition", (state, { creditTo }, collector) => {
  const session = state.parliament.session!;
  const voter = state.pendingDecision.actor as PlayerId;
  collector.notes.push(
    creditTo === voter
      ? `${playerName(state, voter)} will cast votes against in their own name.`
      : `${playerName(state, voter)} will cast votes against on behalf of ${playerName(state, creditTo)}.`,
  );
  return withSession(state, {
    creditTo: { ...session.creditTo, [voter]: creditTo },
    // A coalition partner must have voted against or commit to doing so (p.35).
    opposition: creditTo === voter ? session.opposition : [...new Set([...session.opposition, creditTo])],
  });
});

// A coalition needs the partner's consent: they commit to the opposition (p.35). On refusal nothing
// changes except that the partner is not asked again for this law.
registerConsentResolver("parliament.coalition", (state, request, accepted) => {
  const { voter, partner } = request.context as { voter: PlayerId; partner: PlayerId };
  const session = state.parliament.session;
  if (!session) return state;
  if (!accepted) {
    const refused = withSession(state, { coalitionRefused: [...(session.coalitionRefused ?? []), `${voter}>${partner}`] });
    return refreshParliamentDecision(refused);
  }
  const credited = withSession(state, {
    creditTo: { ...session.creditTo, [voter]: partner },
    opposition: [...new Set([...session.opposition, partner])],
  });
  return refreshParliamentDecision(credited);
});

const setVoteCredit: CommandHandler = (state, command) => {
  if (state.phase !== "parliament" || state.pendingDecision.step !== "parliament.vote" || !state.parliament.session) {
    return wrongPhase(`"${command.type}" is not available now.`);
  }
  const payload = legalPayload<{ creditTo: PlayerId }>(state, command);
  if (!payload) return illegal('That choice is not one of the legal options for "parliament.vote".');
  const voter = state.pendingDecision.actor as PlayerId;
  if (payload.creditTo === voter) return applyVoteCredit(state, command);

  const requested = requestConsent(state, {
    kind: "parliament.coalition",
    requestedBy: voter,
    from: [payload.creditTo],
    prompt: `${playerName(state, voter)} asks ${playerName(state, payload.creditTo)} to join a coalition: they cast their votes against the law on your behalf and you commit to the opposition (p.35).`,
    context: { voter, partner: payload.creditTo },
  });
  const logEntry = createCommandLogEntry({
    state,
    command,
    now: command.clientTimestamp,
    type: "parliament.coalitionRequested",
    summary: `${playerName(state, voter)} asked ${playerName(state, payload.creditTo)} to join a coalition against the law.`,
    details: { voter, partner: payload.creditTo },
  });
  return { ok: true, logEntry, state: { ...requested, updatedAt: command.clientTimestamp, log: [...requested.log, logEntry] } };
};

const passVote = handler<Record<string, never>>("parliament.vote", "parliament.votePassed", (state, _payload, collector) => {
  const session = state.parliament.session!;
  collector.notes.push(`${playerName(state, session.votingOrder[session.voterIndex])} finished voting this round.`);
  return withSession(state, { voterIndex: session.voterIndex + 1 });
});

const continueVoting = handler<{ another: boolean }>(
  "parliament.continueVoting",
  "parliament.votingRound",
  (state, { another }, collector) => {
    const session = state.parliament.session!;
    if (!another) return startResolution(state, collector);
    collector.notes.push(`The Prime Minister called voting round ${session.round + 1}.`);
    return withSession(
      { ...state, parliament: { ...state.parliament, currentVotingRound: session.round + 1 } },
      { stage: "voting", round: session.round + 1, voterIndex: 0, votesThisRound: 0 },
    );
  },
);

function popStep(state: GameState): GameState {
  return withSession(state, { queue: state.parliament.session!.queue.slice(1) });
}

const surrender = handler<{ itemId: string }>("parliament.surrender", "parliament.taxSurrender", (state, { itemId }, collector) =>
  applySurrender(state, state.pendingDecision.actor as PlayerId, itemId, collector),
);

const choosePowerSwap = handler<{ targets: [PolicyTarget, PolicyTarget] }>(
  "parliament.choosePowerSwap",
  "parliament.powerSwap",
  (state, { targets }, collector) => popStep(applyPowerSwapChoice(state, targets, collector)),
);

function decrementHead(state: GameState): GameState {
  const [head, ...rest] = state.parliament.session!.queue;
  if (head && (head.kind === "warShips" || head.kind === "warPieces")) {
    const remaining = head.remaining - 1;
    return withSession(state, { queue: remaining > 0 ? [{ ...head, remaining }, ...rest] : rest });
  }
  return state;
}

const warAgainstFranceShip = handler<{ shipId: string }>(
  "parliament.warAgainstFranceShip",
  "parliament.warAgainstFrance",
  (state, { shipId }, collector) => decrementHead(applyWarShip(state, shipId, collector)),
);

const warAgainstFrancePiece = handler<{ army: "Bombay" | "Madras" | "Bengal"; piece: "regiment" | "officer"; owner?: PlayerId }>(
  "parliament.warAgainstFrancePiece",
  "parliament.warAgainstFrance",
  (state, payload, collector) => decrementHead(applyWarPiece(state, payload, collector)),
);

const moveFailedPolicy = handler<{ space: number; addWindowTax: boolean }>(
  "parliament.moveFailedPolicy",
  "parliament.policyMoved",
  (state, { space, addWindowTax }, collector) => {
    const pm = primeMinister(state);
    collector.notes.push(
      `${playerName(state, pm)} moved the policy to ${describePolicySpace(space)}${addWindowTax ? " and added a window tax" : ""}.`,
    );
    const [, ...rest] = state.parliament.session!.queue;
    return withSession(
      { ...state, parliament: { ...state.parliament, policyDialPosition: space } },
      { policySpace: space, queue: [{ kind: "policy", space, actor: pm, extraWindowTax: addWindowTax }, ...rest] },
    );
  },
);

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const parliamentCommandHandlers: Record<string, CommandHandler> = {
  "parliament.confirm": confirmParliament,
  "parliament.deregulationCall": deregulationCall,
  "parliament.drawLaw": drawLaw,
  "parliament.selectLaw": selectLaw,
  "parliament.selectFromDiscard": selectFromDiscard,
  "parliament.choosePolicy": choosePolicy,
  "parliament.chooseImpeachmentTarget": chooseImpeachmentTarget,
  "parliament.taxCollectors": taxCollectors,
  "parliament.taxCollectorsConsent": taxCollectorsConsent,
  "parliament.castVotes": castVotes,
  "parliament.setVoteCredit": setVoteCredit,
  "parliament.passVote": passVote,
  "parliament.continueVoting": continueVoting,
  "parliament.surrender": surrender,
  "parliament.choosePowerSwap": choosePowerSwap,
  "parliament.warAgainstFranceShip": warAgainstFranceShip,
  "parliament.warAgainstFrancePiece": warAgainstFrancePiece,
  "parliament.moveFailedPolicy": moveFailedPolicy,
};
