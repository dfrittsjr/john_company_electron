import { lawsById, policyDial } from "../../../data";
import type { PolicySpace } from "../../../data";
import { nextUint32 } from "../../rng";
import { officeDefinition, officeHolder, playerOffices, playerWritersOnOrders, companySharesByPlayer, chairmanHolder, shipyardOwner, PRESIDENCY_IDS } from "../../selectors";
import type { ArmyId, CrownClimate, GameState, LegalCommand, PendingDecision, PlayerId } from "../../types";
import { coState } from "../../phases/company-operation/context";
import { adjacentPolicySpaces, policyRotationOptions } from "../../phases/parliament/laws";
import { policyTargetItems, windowTaxItems } from "../../phases/parliament/holdings";
import type { PolicyTarget } from "../../phases/parliament.state";
import {
  choose,
  crownDecidingStep,
  effectFavor,
  firstMatching,
  optionsOfType,
  type CrownArea,
  type CrownCubeDetector,
  type CrownFavorDefinition,
  type CrownPolicy,
} from "../kit";
import {
  CROWN_PLAYER_ID,
  addCrownEffect,
  byCrownPresidencyOrder,
  climateName,
  crownClimate,
  crownDirection,
  crownEffects,
  crownSplayIndex,
  humanPlayerIds,
} from "../state";
import { DEREGULATION_SPEND } from "./parliament-rules";

// The Crown in the Vote to Deregulate (Handbook p.2), Parliament Meets (pp.14-16), Upkeep and Game
// End (p.15), and in negotiation (it makes and accepts no deals, p.2). Climate shift, Royal
// Privilege, treasury votes and the solo Game End table are in ./parliament-rules.ts, which the
// phases use; the phases also seat the Crown first in the voting order and give it its vote options.

// --- The Voting Plan (p.16) ---

/** Facts the Voting Plan asks about. "Most" includes ties, with at least one (p.46). */
export type VoteCondition =
  | "primeMinister"
  | "directorOfTrade"
  | "chairman"
  | "mostWorkshops"
  | "mostPrizes"
  | "mostLuxuries"
  | "mostRottenBoroughs"
  | "mostWritersOnOrders"
  | "mostGovernors"
  | "mostOfPolicy";

/** One row of the Voting Plan: the Crown votes for in these cases and against otherwise. */
export type VotingRule =
  | { kind: "climate"; for: CrownClimate[] }
  | { kind: "forIf"; condition: VoteCondition }
  | { kind: "againstIf"; condition: VoteCondition }
  /** Old Ideas Made New! is never voted on: the Crown only picks the law from the discards at random. */
  | { kind: "select" };

/** The Crown's Voting Plan (Handbook p.16), by law id. */
export const crownVotingPlan: Record<string, VotingRule> = {
  "army-spending": { kind: "climate", for: ["bear", "peacock"] },
  "board-of-control": { kind: "forIf", condition: "primeMinister" },
  "calico-acts": { kind: "forIf", condition: "mostWorkshops" },
  "company-aids-government": { kind: "climate", for: ["bear", "peacock"] },
  "debt-restructure": { kind: "climate", for: ["bull", "stag"] },
  "envoy-to-china": { kind: "climate", for: ["lion", "bear", "peacock"] },
  "governor-general": { kind: "forIf", condition: "directorOfTrade" },
  "inclosure-acts": { kind: "forIf", condition: "mostPrizes" },
  "industry-subsidy": { kind: "climate", for: ["lion", "bear", "peacock"] },
  "masses-demand-franchise": { kind: "againstIf", condition: "mostRottenBoroughs" },
  "military-oversight": { kind: "forIf", condition: "primeMinister" },
  "old-ideas-made-new": { kind: "select" },
  "public-demands-impeachment": { kind: "forIf", condition: "primeMinister" },
  "relief-demanded-for-indian-famine": { kind: "againstIf", condition: "mostOfPolicy" },
  "royal-protection": { kind: "forIf", condition: "mostLuxuries" },
  "sepoy-recruitment": { kind: "climate", for: ["lion", "bear", "peacock"] },
  "ship-subsidy": { kind: "climate", for: ["bull", "stag", "lion"] },
  "tenure-limits": { kind: "againstIf", condition: "chairman" },
  "trade-regulations": { kind: "climate", for: ["bear", "peacock"] },
  "treasure-reform": { kind: "climate", for: ["bull", "stag"] },
  "war-against-france": { kind: "forIf", condition: "primeMinister" },
  "window-tax-repeal": { kind: "climate", for: ["peacock"] },
  "writer-graft-reform": { kind: "climate", for: ["bull"] },
  "writer-privileges": { kind: "forIf", condition: "mostWritersOnOrders" },
  "zamindar-taxes": { kind: "forIf", condition: "mostGovernors" },
};

function humans(state: GameState): PlayerId[] {
  return humanPlayerIds(state);
}

/** More than or equal to every human family, with at least one (p.46). */
function crownHasMost(state: GameState, count: (playerId: PlayerId) => number): boolean {
  const crown = count(CROWN_PLAYER_ID);
  return crown >= 1 && humans(state).every((playerId) => crown >= count(playerId));
}

/** The target of the policy space chosen for the current law. */
function sessionTarget(state: GameState): PolicyTarget | undefined {
  const space = state.parliament.session?.policySpace;
  return space === undefined ? undefined : policyDial.spaces[space]?.target;
}

export function voteConditionHolds(state: GameState, condition: VoteCondition): boolean {
  switch (condition) {
    case "primeMinister":
      return state.parliament.primeMinister === CROWN_PLAYER_ID;
    case "directorOfTrade":
      return officeHolder(state, "director-of-trade") === CROWN_PLAYER_ID;
    case "chairman":
      return chairmanHolder(state) === CROWN_PLAYER_ID;
    case "mostWorkshops":
      return crownHasMost(state, (playerId) => policyTargetItems(state, playerId, "manufacturing").length);
    case "mostLuxuries":
      return crownHasMost(state, (playerId) => policyTargetItems(state, playerId, "social").length);
    case "mostPrizes":
      return crownHasMost(state, (playerId) => Object.values(state.players[playerId].familyMembers.prizes).reduce((sum, count) => sum + count, 0));
    case "mostRottenBoroughs":
      return crownHasMost(state, (playerId) => state.players[playerId].prestigeCards.filter((card) => card.cardId.startsWith("rotten-borough")).length);
    case "mostWritersOnOrders":
      return crownHasMost(state, (playerId) => playerWritersOnOrders(state, playerId));
    case "mostGovernors":
      return crownHasMost(state, (playerId) => playerOffices(state, playerId).filter((officeId) => officeDefinition(officeId)?.category === "governor").length);
    case "mostOfPolicy": {
      const target = sessionTarget(state);
      return target !== undefined && crownHasMost(state, (playerId) => policyTargetItems(state, playerId, target).length);
    }
  }
}

const CONDITION_TEXT: Record<VoteCondition, string> = {
  primeMinister: "the Crown is Prime Minister",
  directorOfTrade: "the Crown is Director of Trade",
  chairman: "the Crown is Chairman",
  mostWorkshops: "the Crown has the most workshops",
  mostPrizes: "the Crown has the most prizes",
  mostLuxuries: "the Crown has the most luxuries",
  mostRottenBoroughs: "the Crown has the most Rotten Boroughs",
  mostWritersOnOrders: "the Crown has the most writers on orders",
  mostGovernors: "the Crown has the most Governors",
  mostOfPolicy: "the Crown has the most of the policy's target",
};

/** How the Voting Plan has the Crown vote on a law now, and why. Undefined for Old Ideas Made New!. */
export function crownVoteOn(state: GameState, lawId: string): { vote: "for" | "against"; why: string } | undefined {
  const rule = crownVotingPlan[lawId];
  if (!rule || rule.kind === "select") return undefined;
  const name = lawsById.get(lawId)?.name ?? lawId;
  const climate = crownClimate(state);
  if (rule.kind === "climate") {
    const isFor = rule.for.includes(climate);
    return {
      vote: isFor ? "for" : "against",
      why: `${climateName(climate)}: votes ${isFor ? "for" : "against"} ${name} (Voting Plan: for in ${rule.for.map(climateName).join(", ")}).`,
    };
  }
  const holds = voteConditionHolds(state, rule.condition);
  const isFor = rule.kind === "forIf" ? holds : !holds;
  const text = rule.kind === "forIf" ? `for if ${CONDITION_TEXT[rule.condition]}` : `against if ${CONDITION_TEXT[rule.condition]}`;
  return {
    vote: isFor ? "for" : "against",
    why: `${climateName(climate)}: votes ${isFor ? "for" : "against"} ${name} (Voting Plan: ${text}; ${holds ? "it does" : "it doesn't"}).`,
  };
}

// --- Choosing a law (p.15) ---

type LawPlan = { draw?: LegalCommand; select?: LegalCommand; reason: string };

/**
 * A Crown Prime Minister draws as many laws as the shaded slot on the AI card says (left 1, middle
 * 2, right 3), stopping at a Dilemma, and brings the last one drawn before Parliament.
 */
function lawPlan(state: GameState, decision: PendingDecision, withFavors: boolean): LawPlan | undefined {
  const session = state.parliament.session;
  if (!session) return undefined;
  const options = decision.crown?.all ?? decision.legalCommands;
  const selects = optionsOfType(decision, "parliament.selectLaw");
  const all = options.filter((command) => command.type === "parliament.selectLaw");
  const drawCommand = options.find((command) => command.type === "parliament.drawLaw");
  const climate = climateName(crownClimate(state));
  const last = session.drawn[session.drawn.length - 1];
  const lastSelect = all.find((command) => (command.payload as { lawId: string }).lawId === last);
  const dilemma = session.drawn.some((lawId) => lawsById.get(lawId)?.kind === "dilemma");
  if (dilemma && selects.length > 0) {
    return { select: selects[0], reason: `${climate}: stops drawing at a Dilemma and brings it before Parliament (Handbook p.15).` };
  }

  const slot = crownSplayIndex(state, [true, true, true]) ?? 0;
  let draws = slot + 1;
  let favor = "";
  if (withFavors && crownEffects(state, "parliament.stopDrawing").length > 0) {
    draws = Math.max(session.drawn.length, 1);
    favor = " (favour: stop drawing)";
  } else if (withFavors && crownEffects(state, "parliament.skipLaw").length > 0) {
    draws = 3;
    favor = " (favour: skip the law drawn)";
  }
  if (session.drawn.length >= draws || !drawCommand) {
    return {
      select: lastSelect,
      reason: `${climate}: brings the law drawn in slot ${Math.min(draws, 3)} before Parliament${favor} (Handbook p.15).`,
    };
  }
  return { draw: drawCommand, reason: `${climate}: draws law ${session.drawn.length + 1} of ${draws} (the shaded slot on the AI card)${favor}.` };
}

const chooseLaw: CrownPolicy = (state, decision) => {
  const plan = lawPlan(state, decision, true);
  return choose(plan?.draw ?? plan?.select, plan?.reason ?? "");
};

/** "Choose the Law randomly": a die off the game's RNG, read without advancing it. */
const selectFromDiscard: CrownPolicy = (state, decision) => {
  const options = decision.legalCommands;
  if (options.length === 0) return undefined;
  const pick = options[nextUint32(state.rng).value % options.length];
  return choose(pick, `${climateName(crownClimate(state))}: Old Ideas Made New! - the Crown picks a law from the discards at random (Voting Plan).`);
};

// --- Policy marker movement (p.15) ---

function entityCount(state: GameState, playerId: PlayerId, target: PolicyTarget): number {
  return policyTargetItems(state, playerId, target).length;
}

/**
 * The Crown total of a policy space: its entities minus the players' for the space's target (and
 * window icons for a TAX & WINDOW TAX space), times -1 for a tax.
 */
export function policyCrownTotal(state: GameState, space: number): number {
  const definition: PolicySpace = policyDial.spaces[space];
  const diff = (count: (playerId: PlayerId) => number) =>
    count(CROWN_PLAYER_ID) - humans(state).reduce((sum, playerId) => sum + count(playerId), 0);
  let total = diff((playerId) => entityCount(state, playerId, definition.target));
  if (definition.consequence === "taxAndWindowTax") {
    total += diff((playerId) => windowTaxItems(state, playerId).reduce((sum, item) => sum + item.windowIcons, 0));
  }
  return definition.consequence === "tax" || definition.consequence === "taxAndWindowTax" ? -total : total;
}

type Candidate = { space: number; direction: "clockwise" | "counterclockwise"; command: LegalCommand };

/** The best candidate: highest Crown total, ties by the AI card's arrows. */
function bestPolicy(state: GameState, candidates: Candidate[]): { best: Candidate; totals: string } | undefined {
  if (candidates.length === 0) return undefined;
  const direction = crownDirection(state);
  const scored = candidates.map((candidate) => ({ candidate, total: policyCrownTotal(state, candidate.space) }));
  const top = Math.max(...scored.map((entry) => entry.total));
  const tied = scored.filter((entry) => entry.total === top);
  const best = tied.find((entry) => entry.candidate.direction === direction) ?? tied[0];
  return {
    best: best.candidate,
    totals: scored.map((entry) => `${entry.total >= 0 ? "+" : ""}${entry.total}`).join(" vs "),
  };
}

function policyCandidates(state: GameState, decision: PendingDecision, all: boolean): Candidate[] {
  const session = state.parliament.session;
  const law = session?.lawId ? lawsById.get(session.lawId) : undefined;
  const commands = all ? (decision.crown?.all ?? decision.legalCommands) : decision.legalCommands;
  if (decision.step === "parliament.choosePolicy" && law?.policyIcon) {
    return policyRotationOptions(state.parliament.policyDialPosition, law.policyIcon).flatMap(({ direction, space }) => {
      const command = commands.find((candidate) => (candidate.payload as { space: number }).space === space);
      return command ? [{ space, direction, command }] : [];
    });
  }
  return adjacentPolicySpaces(state.parliament.policyDialPosition).flatMap(({ direction, space }) => {
    const command = commands.find((candidate) => {
      const payload = candidate.payload as { space: number; addWindowTax: boolean };
      return payload.space === space && !payload.addWindowTax;
    });
    return command ? [{ space, direction, command }] : [];
  });
}

const choosePolicy: CrownPolicy = (state, decision) => {
  const picked = bestPolicy(state, policyCandidates(state, decision, false));
  if (!picked) return undefined;
  return choose(
    picked.best.command,
    `${climateName(crownClimate(state))}: policy marker to the space with the highest Crown total (${picked.totals}; ties by the AI card arrows) (Handbook p.15).`,
  );
};

/** "If the Crown chooses a Power policy in which the Power marker is already in the highest position, swap the two bottom Power markers." */
const choosePowerSwap: CrownPolicy = (state, decision) => {
  const track = state.company.powerTrack as Record<PolicyTarget, number>;
  const sum = (command: LegalCommand) => (command.payload as { targets: PolicyTarget[] }).targets.reduce((total, target) => total + track[target], 0);
  const lowest = Math.min(...decision.legalCommands.map(sum));
  return {
    commands: decision.legalCommands.filter((command) => sum(command) === lowest),
    reason: "Power marker already highest: the Crown swaps the two bottom Power markers (Handbook p.15).",
  };
};

// --- Law-specific choices in the Voting Plan ---

/** Public Demands Impeachment!: "the first player office from left to right on the ribbon; if all Crown offices, randomly". */
const chooseImpeachmentTarget: CrownPolicy = (state, decision) => {
  const player = decision.legalCommands.find((command) => {
    const holder = officeHolder(state, (command.payload as { officeId: string }).officeId);
    return holder !== undefined && holder !== CROWN_PLAYER_ID;
  });
  if (player) return choose(player, "Public Demands Impeachment!: the first player's office from left to right on the ribbon (Voting Plan).");
  const options = decision.legalCommands;
  return choose(options[nextUint32(state.rng).value % options.length], "Public Demands Impeachment!: all offices are the Crown's, so one at random (Voting Plan).");
};

/** War Against France!: player ships and officers, then Company ships, then Crown ships and officers (Voting Plan). */
const warAgainstFranceShip: CrownPolicy = (state, decision) => {
  const owner = (command: LegalCommand): "player" | "company" | "crown" => {
    const ship = state.company.ships.find((candidate) => candidate.id === (command.payload as { shipId: string }).shipId);
    if (!ship || ship.kind !== "player") return "company";
    return shipyardOwner(state, ship.shipyardCardId ?? "") === CROWN_PLAYER_ID ? "crown" : "player";
  };
  return firstMatching(decision, [
    { reason: "War Against France!: player ships first (Voting Plan).", match: (command) => owner(command) === "player" },
    { reason: "War Against France!: then Company ships (Voting Plan).", match: (command) => owner(command) === "company" },
    { reason: "War Against France!: Crown ships last (Voting Plan).", match: (command) => owner(command) === "crown" },
  ]);
};

const warAgainstFrancePiece: CrownPolicy = (_state, decision) => {
  const payload = (command: LegalCommand) => command.payload as { piece: string; owner?: PlayerId };
  return firstMatching(decision, [
    { reason: "War Against France!: player officers first (Voting Plan).", match: (command) => payload(command).piece === "officer" && payload(command).owner !== CROWN_PLAYER_ID },
    { reason: "War Against France!: then Company regiments (Voting Plan).", match: (command) => payload(command).piece === "regiment" },
    { reason: "War Against France!: Crown officers last (Voting Plan).", match: (command) => payload(command).piece === "officer" && payload(command).owner === CROWN_PLAYER_ID },
  ]);
};

/** Board of Control: "remove a player from office at first opportunity". */
const boardOfControl: CrownPolicy = (state, decision) => {
  const interrupt = coState(state).interrupt;
  const holder = interrupt?.kind === "boardOfControl" ? officeHolder(state, interrupt.officeId) : undefined;
  const remove = holder !== undefined && holder !== CROWN_PLAYER_ID;
  const command = decision.legalCommands.find((candidate) => (candidate.payload as { remove?: boolean }).remove === remove);
  return choose(
    command,
    remove ? "Board of Control: the Crown removes a player from office at the first opportunity (Voting Plan)." : "Board of Control: the Crown doesn't remove its own officeholder.",
  );
};

/** Military Oversight: "a Crown MA will always demote a non-Crown Commander if a Crown Officer is available in that Army". */
const militaryOversight: CrownPolicy = (state, decision) => {
  const action = (command: LegalCommand) => (command.payload as { action: string; army?: ArmyId; playerId?: PlayerId });
  const demotions = optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "oversightDemote");
  if (demotions.length > 0 || optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "oversightDecline").length > 0) {
    const viable = demotions.filter((command) => {
      const army = state.company.armies[action(command).army!];
      const stack = army.officers[CROWN_PLAYER_ID];
      return army.commander !== CROWN_PLAYER_ID && stack !== undefined && stack.ready + stack.exhausted > 0;
    });
    if (viable.length > 0) {
      const [first] = byCrownPresidencyOrder(state, viable, (command) => action(command).army!);
      return choose(first, "Military Oversight: the Crown demotes a non-Crown Commander where it has an officer (Voting Plan).");
    }
    return choose(
      optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "oversightDecline")[0],
      "Military Oversight: no army has a non-Crown Commander and a Crown officer, so no demotion (Voting Plan).",
    );
  }
  const own = optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "oversightAppoint" && payload.playerId === CROWN_PLAYER_ID);
  if (own.length > 0) return choose(own[0], "Military Oversight: the Crown appoints its own officer as Commander (Voting Plan).");
  return undefined;
};

// --- Voting (pp.14, 16, 2) ---

const vote: CrownPolicy = (state, decision) => {
  const session = state.parliament.session;
  if (!session?.lawId) return undefined;
  const pass = optionsOfType(decision, "parliament.passVote")[0];
  const casts = optionsOfType(decision, "parliament.castVotes");
  const climate = climateName(crownClimate(state));

  if (session.special) {
    // Vote to Deregulate: always last and against, with up to £X once if it makes the vote fail.
    const against = casts.filter((command) => (command.payload as { direction: string }).direction === "against");
    const card = against.find((command) => (command.payload as { source: string }).source === "card");
    if (card) return choose(card, `${climate}: votes against Deregulation with an enterprise's votes (Handbook p.2).`);
    const marker = state.parliament.voteMarker;
    const cash = against
      .filter((command) => (command.payload as { source: string }).source === "cash")
      .filter((command) => marker - (command.payload as { votes: number }).votes < 0)
      .sort((a, b) => (a.payload as { votes: number }).votes - (b.payload as { votes: number }).votes)[0];
    if (marker >= 0 && cash) {
      return choose(cash, `${climate}: spends up to £${DEREGULATION_SPEND[crownClimate(state)]} once, as that moves the Votes marker to a failing position (Handbook p.2).`);
    }
    return choose(pass, `${climate}: nothing more to vote against Deregulation (Handbook p.2).`);
  }

  const plan = crownVoteOn(state, session.lawId);
  if (!plan) return choose(pass, "Old Ideas Made New! is not voted on.");
  const mine = casts.filter((command) => (command.payload as { direction: string }).direction === plan.vote);
  const next =
    mine.find((command) => (command.payload as { source: string }).source === "card") ??
    mine.find((command) => (command.payload as { source: string }).source === "treasury");
  if (next) return choose(next, `${plan.why} Uses all its enterprise votes and the treasury's bonus votes (Handbook p.14).`);
  return choose(pass, `${plan.why} No votes left.`);
};

/** The Crown has used every vote it has; more rounds could only help the players. */
const continueVoting: CrownPolicy = (_state, decision) =>
  choose(
    optionsOfType(decision, "parliament.continueVoting", (payload) => payload.another === false)[0],
    "The Crown, as Prime Minister, resolves the vote: it has used all its votes.",
  );

const deregulationCall: CrownPolicy = (_state, decision) =>
  choose(
    optionsOfType(decision, "parliament.deregulationCall", (payload) => payload.call === false)[0],
    "The Crown never initiates the Vote to Deregulate unless it must (Handbook p.2).",
  );

/** "If any card says the Crown 'may' do something, they will not." */
const taxCollectors: CrownPolicy = (_state, decision) =>
  choose(optionsOfType(decision, "parliament.taxCollectors", (payload) => payload.propose === false)[0], "Tax Collectors: the Crown doesn't do what a card says it 'may' (Handbook p.2).");

/** "If any card requires permission or consent from the Crown, they will not give it." */
const taxCollectorsConsent: CrownPolicy = (_state, decision) =>
  choose(optionsOfType(decision, "parliament.taxCollectorsConsent", (payload) => payload.accept === false)[0], "The Crown gives no consent (Handbook p.2).");

/** The Crown moves the policy after a failed law with the same Crown-total rule as for choosing it. */
const moveFailedPolicy = choosePolicy;

// --- Negotiation (p.2): no deals, no consent (consents are area A's `negotiation.consent`) ---

/** The Crown's blackmail cards stay face down and it plays none (p.2): it never cancels a play. */
const blackmailReaction: CrownPolicy = (_state, decision) =>
  choose(optionsOfType(decision, "negotiation.respondToBlackmail", (payload) => payload.cancel === false)[0], "The Crown never plays blackmail cards (Handbook p.2).");

const connection: CrownPolicy = (_state, decision) =>
  choose(
    optionsOfType(decision, "companyOperation.interrupt", (payload) => payload.action === "declineConnection")[0],
    "The Crown never plays its blackmail cards (Handbook p.2).",
  );

// --- Favours on pages 15 and 16 ---

const crownPrimeMinister = (state: GameState) => state.parliament.primeMinister === CROWN_PLAYER_ID;

const favors: CrownFavorDefinition[] = [
  effectFavor({
    id: "parliament.stopDrawing",
    printed: { page: 15, text: "The Crown stops drawing" },
    available: (state) => {
      const decision = state.pendingDecision;
      if (!crownDecidingStep(state, ["parliament.chooseLaw"]) || !state.parliament.session) return false;
      if (crownEffects(state, "parliament.stopDrawing").length + crownEffects(state, "parliament.skipLaw").length > 0) return false;
      const plan = lawPlan(state, decision, false);
      return Boolean(plan?.draw) && state.parliament.session.drawn.length >= 1;
    },
  }),
  effectFavor({
    id: "parliament.skipLaw",
    printed: { page: 15, text: "The Crown skips the law drawn" },
    available: (state) => {
      if (!crownDecidingStep(state, ["parliament.chooseLaw"]) || !state.parliament.session) return false;
      if (crownEffects(state, "parliament.stopDrawing").length + crownEffects(state, "parliament.skipLaw").length > 0) return false;
      const plan = lawPlan(state, state.pendingDecision, false);
      const options = state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands;
      return Boolean(plan?.select) && state.parliament.session.drawn.length < 3 && options.some((command) => command.type === "parliament.drawLaw");
    },
  }),
  {
    id: "parliament.policyMarker",
    printed: { page: 15, text: "The Crown moves the policy marker" },
    available: (state) => {
      if (!crownDecidingStep(state, ["parliament.choosePolicy", "parliament.moveFailedPolicy"]) || !crownPrimeMinister(state)) return false;
      if (state.crown!.favorEffects.some((effect) => effect.decisionId === state.pendingDecision.id && effect.choices)) return false;
      return alternativePolicy(state) !== undefined;
    },
    apply: (state, playerId) =>
      addCrownEffect(state, {
        favorId: "parliament.policyMarker",
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        choices: [alternativePolicy(state)!],
      }),
  },
];

/** The policy space the Crown would not choose, if there is one. */
function alternativePolicy(state: GameState): LegalCommand | undefined {
  const decision = state.pendingDecision;
  const candidates = policyCandidates(state, decision, true);
  const picked = bestPolicy(state, candidates);
  return picked ? candidates.find((candidate) => candidate.space !== picked.best.space)?.command : undefined;
}

/**
 * "+1 [SOLO]: you have one or more writers in a Crown Presidency, but you do not have at least one
 * writer return from filling an order in that Presidency." Checked when Upkeep's Refresh returns
 * the writers (the turn advances); once per Upkeep.
 */
const soloWriterCube: CrownCubeDetector = {
  favorId: "upkeep.soloWriters",
  printed: { page: 15, text: "[SOLO] You have one or more writers" },
  detect: (before, after) => {
    if (before.mode !== "soloCrown" || after.turn !== before.turn + 1 || before.phase !== "upkeep") return [];
    const [soloist] = humanPlayerIds(before);
    const qualifies = PRESIDENCY_IDS.some((presidency) => {
      if (before.company.offices[`president-${presidency.toLowerCase()}`]?.holder !== CROWN_PLAYER_ID) return false;
      const inBox = before.india.presidencies[presidency].writers[soloist] ?? 0;
      let onOrders = 0;
      let returning = 0;
      for (const region of Object.values(before.india.regions)) {
        for (const order of region.orders) {
          if (order.writer?.playerId === soloist && order.writer.presidency === presidency) {
            onOrders += 1;
            returning += 1;
          }
        }
      }
      return inBox + onOrders >= 1 && returning === 0;
    });
    return qualifies ? [{ playerId: soloist, cubes: 1, reason: "writers in a Crown Presidency that filled no order (Upkeep)" }] : [];
  },
};

export const parliamentCrown: CrownArea = {
  pages: [15, 16],
  policies: {
    "parliament.deregulationCall": deregulationCall,
    "parliament.chooseLaw": chooseLaw,
    "parliament.selectFromDiscard": selectFromDiscard,
    "parliament.choosePolicy": choosePolicy,
    "parliament.chooseImpeachmentTarget": chooseImpeachmentTarget,
    "parliament.taxCollectors": taxCollectors,
    "parliament.taxCollectorsConsent": taxCollectorsConsent,
    "parliament.vote": vote,
    "parliament.continueVoting": continueVoting,
    "parliament.choosePowerSwap": choosePowerSwap,
    "parliament.warAgainstFranceShip": warAgainstFranceShip,
    "parliament.warAgainstFrancePiece": warAgainstFrancePiece,
    "parliament.moveFailedPolicy": moveFailedPolicy,
    "companyOperation.boardOfControl": boardOfControl,
    "companyOperation.militaryOversight": militaryOversight,
    "companyOperation.connection": connection,
    "negotiation.blackmailReaction": blackmailReaction,
  },
  favors,
  detectors: [soloWriterCube],
  notDone: [],
};
