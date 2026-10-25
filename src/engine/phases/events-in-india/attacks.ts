import { localAlliances } from "../../../data";
import { officeHolder, PRESIDENCY_IDS } from "../../selectors";
import type { ArmyId, GameState, PendingDecision, PlayerId, PresidencyId, RegionId } from "../../types";
import { lowerStanding } from "../revenue";
import type { ActiveCompanyAttack, ActiveTile, CompanyAttack } from "../events-in-india.state";
import type { ResolutionContext } from "./context";
import { log, playerName, progress, regionName, roll } from "./context";
import {
  applyInvasionSuccess,
  closeAllOrdersOrCascade,
  region,
  removeTowerLevel,
  setTowerLevels,
  unrestStrength,
} from "./india";

// Attacks against the Company (rulebook p.32) and Region Loss (p.29).

export type DefenceChoice =
  | { piece: "regiment" }
  | { piece: "officer"; playerId: PlayerId }
  | { piece: "alliance"; allianceId: string }
  | { piece: "auto" };

/** The Presidency (and so the Army) a Company-controlled region belongs to. */
export function regionArmy(state: GameState, regionId: RegionId): ArmyId | undefined {
  const target = region(state, regionId);
  return target.associatedPresidency ?? (target.companyControlled ? target.homePresidency : undefined);
}

/** Vacant Commander (p.32): Military Affairs acts in its stead, then the Chairman. */
export function actingCommander(state: GameState, army: ArmyId | undefined): { actor?: PlayerId; commander?: PlayerId } {
  const commander = army ? state.company.armies[army]?.commander : undefined;
  if (commander) return { actor: commander, commander };
  return { actor: officeHolder(state, "military-affairs") ?? officeHolder(state, "chairman") };
}

/** Begin an attack sequence: the primary Crisis, then a Rebellion in every other region with unrest. */
export function startCompanyAttack(ctx: ResolutionContext, primary: CompanyAttack): void {
  progress(ctx).attacks = { primary };
}

type ReadyPieces = {
  regiments: number;
  officers: Array<{ playerId: PlayerId; ready: number }>;
  /** Local alliances bought this turn and not yet used: each counts its printed strength (p.21). */
  alliances: Array<{ allianceId: string; strength: number }>;
};

function readyPieces(state: GameState, army: ArmyId | undefined): ReadyPieces {
  if (!army) return { regiments: 0, officers: [], alliances: [] };
  const armyState = state.company.armies[army];
  const officers = state.seatingOrder
    .map((playerId) => ({ playerId, ready: armyState.officers[playerId]?.ready ?? 0 }))
    .filter((entry) => entry.ready > 0);
  const alliances = Object.entries(armyState.localAlliances ?? {})
    .filter(([, status]) => status === "ready")
    .map(([allianceId]) => ({ allianceId, strength: localAlliances.find((alliance) => alliance.id === allianceId)?.strength ?? 0 }));
  return { regiments: armyState.regiments.ready, officers, alliances };
}

function piecesStrength(pieces: ReadyPieces): number {
  return (
    pieces.regiments +
    pieces.officers.reduce((sum, entry) => sum + entry.ready, 0) +
    pieces.alliances.reduce((sum, entry) => sum + entry.strength, 0)
  );
}

/** A local alliance's strength "cannot be split among more than one purpose" (p.21): it is used whole. */
function exhaustAlliance(ctx: ResolutionContext, current: ActiveCompanyAttack, allianceId: string): void {
  const army = ctx.draft.company.armies[current.army!];
  army.localAlliances = { ...(army.localAlliances ?? {}), [allianceId]: "exhausted" };
  current.exhausted += localAlliances.find((alliance) => alliance.id === allianceId)?.strength ?? 0;
}

function exhaustRegiment(ctx: ResolutionContext, current: ActiveCompanyAttack): void {
  const regiments = ctx.draft.company.armies[current.army!].regiments;
  regiments.ready -= 1;
  regiments.exhausted += 1;
  current.exhausted += 1;
}

function exhaustOfficer(ctx: ResolutionContext, current: ActiveCompanyAttack, playerId: PlayerId): void {
  const stack = ctx.draft.company.armies[current.army!].officers[playerId];
  stack.ready -= 1;
  stack.exhausted += 1;
  current.exhausted += 1;
}

/** Exhaust pieces in a fixed order (regiments, officers in seating order, then alliances) up to `count` strength. */
function exhaustAutomatically(ctx: ResolutionContext, current: ActiveCompanyAttack, count: number): void {
  const target = current.exhausted + count;
  while (current.exhausted < target) {
    const pieces = readyPieces(ctx.draft, current.army);
    if (pieces.regiments > 0) exhaustRegiment(ctx, current);
    else if (pieces.officers.length > 0) exhaustOfficer(ctx, current, pieces.officers[0].playerId);
    else if (pieces.alliances.length > 0) exhaustAlliance(ctx, current, pieces.alliances[0].allianceId);
    else break;
  }
}

export function applyDefenceChoice(ctx: ResolutionContext, choice: DefenceChoice): void {
  const current = progress(ctx).attacks?.current;
  if (!current) throw new Error("No attack is being defended.");

  if (choice.piece === "regiment") exhaustRegiment(ctx, current);
  else if (choice.piece === "officer") exhaustOfficer(ctx, current, choice.playerId);
  else if (choice.piece === "alliance") exhaustAlliance(ctx, current, choice.allianceId);
  else exhaustAutomatically(ctx, current, current.needed - current.exhausted);
}

export function chooseNextRebellion(ctx: ResolutionContext, regionId: RegionId): void {
  const sequence = progress(ctx).attacks;
  if (!sequence?.pendingRebellions?.includes(regionId)) throw new Error(`No attack is pending in ${regionId}.`);
  sequence.pendingRebellions = sequence.pendingRebellions.filter((candidate) => candidate !== regionId);
  beginAttack(ctx, rebellionFromUnrest(ctx.draft, regionId));
}

function rebellionFromUnrest(state: GameState, regionId: RegionId): CompanyAttack {
  return {
    regionId,
    primary: false,
    crisisKind: "rebellion",
    strength: unrestStrength(state, region(state, regionId).unrest),
  };
}

function beginAttack(ctx: ResolutionContext, attack: CompanyAttack): void {
  const army = regionArmy(ctx.draft, attack.regionId);
  const { actor, commander } = actingCommander(ctx.draft, army);
  progress(ctx).attacks!.current = {
    attack,
    army,
    needed: Math.max(0, attack.strength),
    exhausted: 0,
    actor,
    commander,
  };
  log(
    ctx,
    "eventsInIndia.companyAttacked",
    `${attack.primary ? "Primary Crisis" : "Rebellion"} against the Company in ${regionName(ctx, attack.regionId)}: strength ${attack.strength}.`,
    { attack, army, defender: actor ?? "system", commander },
  );
}

/**
 * Advance the attack sequence. Returns a decision when a player must choose (which attack to
 * resolve next, or which piece to exhaust); returns undefined once the whole sequence is over.
 */
export function stepAttacks(ctx: ResolutionContext, tile: ActiveTile): PendingDecision | undefined {
  const sequence = progress(ctx).attacks;
  if (!sequence) return undefined;

  for (let guard = 0; guard < 1000; guard += 1) {
    if (sequence.current) {
      const decision = continueDefence(ctx, sequence.current, tile);
      if (decision) return decision;
      sequence.current = undefined;
      continue;
    }

    if (sequence.primary) {
      const primary = sequence.primary;
      sequence.primary = undefined;
      beginAttack(ctx, primary);
      continue;
    }

    if (!sequence.pendingRebellions) {
      // Every other Company region with unrest now rebels (p.32).
      sequence.pendingRebellions = Object.values(ctx.draft.india.regions)
        .filter((candidate) => candidate.companyControlled && candidate.unrest > 0)
        .map((candidate) => candidate.id);
      continue;
    }

    if (sequence.pendingRebellions.length === 0) {
      progress(ctx).attacks = undefined;
      return undefined;
    }

    // Order of Resolution: Commanders from Bombay downwards, each in any order they choose.
    const presidency = nextPresidencyWithAttacks(ctx.draft, sequence.pendingRebellions);
    const candidates = sequence.pendingRebellions.filter((regionId) => regionArmy(ctx.draft, regionId) === presidency);
    const { actor } = actingCommander(ctx.draft, presidency);
    if (presidency && candidates.length > 1 && actor) {
      return chooseAttackDecision(ctx.draft, actor, presidency, candidates);
    }

    chooseNextRebellion(ctx, candidates[0] ?? sequence.pendingRebellions[0]);
  }

  throw new Error("Attack sequence did not finish.");
}

function nextPresidencyWithAttacks(state: GameState, pending: RegionId[]): PresidencyId | undefined {
  return PRESIDENCY_IDS.find((presidency) => pending.some((regionId) => regionArmy(state, regionId) === presidency));
}

/** Mounting Defense (p.32): exhaust pieces up to the attack's strength, or as many as possible. */
function continueDefence(
  ctx: ResolutionContext,
  current: ActiveCompanyAttack,
  tile: ActiveTile,
): PendingDecision | undefined {
  for (let guard = 0; guard < 1000; guard += 1) {
    const remaining = current.needed - current.exhausted;
    const pieces = readyPieces(ctx.draft, current.army);
    const total = piecesStrength(pieces);

    if (remaining <= 0 || total === 0) {
      resolveAttackOutcome(ctx, current, tile);
      return undefined;
    }

    const kinds = (pieces.regiments > 0 ? 1 : 0) + pieces.officers.length + pieces.alliances.length;
    if (total <= remaining || kinds === 1 || !current.actor) {
      exhaustAutomatically(ctx, current, remaining);
      continue;
    }

    return defenceDecision(ctx.draft, current, pieces);
  }

  throw new Error("Defence did not finish.");
}

function resolveAttackOutcome(ctx: ResolutionContext, current: ActiveCompanyAttack, tile: ActiveTile): void {
  const { attack } = current;
  const target = region(ctx.draft, attack.regionId);
  const succeeded = current.exhausted < attack.strength;

  if (!succeeded) {
    target.unrest = 0;
    if (current.commander) ctx.draft.players[current.commander].trophies += 1;
    log(
      ctx,
      "eventsInIndia.companyDefended",
      `The Army defends ${target.name} with ${current.exhausted} piece(s); unrest is cleared` +
        (current.commander ? ` and ${playerName(ctx, current.commander)} takes a trophy.` : "."),
      { regionId: target.id, exhausted: current.exhausted, strength: attack.strength },
    );

    // Failed Invasion: remove a tower level from the attacking region if possible.
    if (attack.primary && attack.crisisKind === "invasion" && attack.attackerRegionId) {
      if (removeTowerLevel(ctx, attack.attackerRegionId)) {
        log(ctx, "eventsInIndia.towerLowered", `The failed Invasion lowers ${regionName(ctx, attack.attackerRegionId)}'s tower.`);
      }
    }
    return;
  }

  log(
    ctx,
    "eventsInIndia.companyDefeated",
    `The Army exhausts ${current.exhausted} piece(s) against strength ${attack.strength}: ${target.name} is lost.`,
    { regionId: target.id, exhausted: current.exhausted, strength: attack.strength },
  );
  regionLoss(ctx, attack, current, tile);

  if (attack.crisisKind === "invasion" && attack.attackerRegionId) {
    applyInvasionSuccess(ctx, attack.attackerRegionId, attack.regionId);
    tile.imperialCapitalId = attack.attackerRegionId;
  }
  if (attack.crisisKind === "rebellion") tile.rebelledRegionIds.push(attack.regionId);
}

/** Region Loss (p.29), all five steps. */
function regionLoss(ctx: ResolutionContext, attack: CompanyAttack, current: ActiveCompanyAttack, tile: ActiveTile): void {
  const draft = ctx.draft;
  const target = region(draft, attack.regionId);
  const army = current.army ? draft.company.armies[current.army] : undefined;

  // 1. Tarnish the Commander's Name: lose half the family's trophies (rounding up), Commander to supply.
  if (army?.commander) {
    const commander = draft.players[army.commander];
    const lost = Math.ceil(commander.trophies / 2);
    commander.trophies -= lost;
    commander.familyMembers.supply += 1;
    log(
      ctx,
      "eventsInIndia.commanderTarnished",
      `${commander.name}'s Commander returns to their supply and they lose ${lost} trophy(ies).`,
      { playerId: commander.id, trophiesLost: lost },
    );
    army.commander = undefined;
  }

  // 2. Officer Rout: roll for every officer in the Army; each 6 removes one.
  if (army) {
    for (const playerId of draft.seatingOrder) {
      const stack = army.officers[playerId];
      const count = (stack?.ready ?? 0) + (stack?.exhausted ?? 0);
      if (!stack || count === 0) continue;

      const rolls = Array.from({ length: count }, () => roll(ctx, 6, `eventsInIndia.officerRout.${playerId}`));
      const sixes = rolls.filter((value) => value === 6).length;
      const fromExhausted = Math.min(sixes, stack.exhausted);
      stack.exhausted -= fromExhausted;
      stack.ready -= sixes - fromExhausted;
      draft.players[playerId].familyMembers.supply += sixes;
      log(
        ctx,
        "eventsInIndia.officerRout",
        `Officer Rout: ${playerName(ctx, playerId)} rolls ${rolls.join(", ")} and loses ${sixes} officer(s).`,
        { playerId, rolls, officersLost: sixes },
      );
    }
  }

  // 3. Governor Elimination (skipped while the Governor General is in play, p.26).
  if (!draft.company.governorGeneralInPlay) eliminateGovernor(ctx, target.governorOffice, target.id);

  // 4. Restore Local Authority.
  target.companyControlled = false;
  target.hasDome = true;
  target.unrest = 0;
  target.partialCompanyShip = false;
  target.associatedPresidency = undefined;
  target.empireFlag = undefined;
  target.isCapital = false;
  target.lootToken = { ...target.lootToken, available: false, face: "control" };
  setTowerLevels(ctx, target.id, attack.foreignRoll !== undefined ? Math.floor(attack.foreignRoll / 2) : 1);
  log(
    ctx,
    "eventsInIndia.localAuthorityRestored",
    `${target.name} returns to local authority with a dome and ${target.towerLevels} tower level(s).`,
    { regionId: target.id, towerLevels: target.towerLevels },
  );
  closeAllOrdersOrCascade(ctx, target.id, tile.cascaded);

  // 5. Company Humiliation: the Nth region lost this turn lowers Standing N spaces.
  draft.india.regionsLostThisTurn += 1;
  const before = draft.company.standing;
  draft.company = lowerStanding(draft.company, draft.india.regionsLostThisTurn);
  log(
    ctx,
    "eventsInIndia.companyHumiliated",
    `Region lost #${draft.india.regionsLostThisTurn} this turn: Company Standing drops ${before - draft.company.standing} space(s)` +
      (draft.company.failed ? " and the Company fails." : "."),
    { regionsLostThisTurn: draft.india.regionsLostThisTurn, standing: draft.company.standing },
  );
}

function eliminateGovernor(ctx: ResolutionContext, officeId: string, regionId: RegionId): void {
  const company = ctx.draft.company;
  const office = company.offices[officeId];
  if (!office) return;

  const holder = !office.vacant ? office.holder : undefined;
  if (holder) {
    ctx.draft.players[holder].familyMembers.supply += 1;
    ctx.draft.eventsInIndia.governorsLostToRegionLoss.push({ turn: ctx.draft.turn, regionId, officeId, holder });
  }
  delete company.offices[officeId];
  company.vacantOffices = company.vacantOffices.filter((candidate) => candidate !== officeId);
  if (!company.unusedOffices.includes(officeId)) company.unusedOffices.push(officeId);
  log(
    ctx,
    "eventsInIndia.governorEliminated",
    holder
      ? `${playerName(ctx, holder)}'s Governor of ${regionName(ctx, regionId)} returns to their supply; the office card is removed.`
      : `The vacant Governor of ${regionName(ctx, regionId)} office card is removed.`,
    { officeId, holder },
  );
}

function defenceDecision(state: GameState, current: ActiveCompanyAttack, pieces: ReadyPieces): PendingDecision {
  const regionName = state.india.regions[current.attack.regionId]?.name ?? current.attack.regionId;
  const remaining = current.needed - current.exhausted;
  return {
    id: `decision-events-defend-${state.turn}-${state.log.length}`,
    phase: "eventsInIndia",
    step: "eventsInIndia.defend",
    actor: current.actor!,
    visibility: "public",
    prompt: `Defend ${regionName} (strength ${current.attack.strength}): exhaust ${remaining} more piece(s) from the Army of ${current.army}.`,
    legalCommands: [
      ...(pieces.regiments > 0
        ? [{ type: "eventsInIndia.defend", label: "Exhaust a regiment", payload: { piece: "regiment" } }]
        : []),
      ...pieces.officers.map((entry) => ({
        type: "eventsInIndia.defend",
        label: `Exhaust one of ${state.players[entry.playerId]?.name ?? entry.playerId}'s officers`,
        payload: { piece: "officer", playerId: entry.playerId },
      })),
      ...pieces.alliances.map((entry) => ({
        type: "eventsInIndia.defend",
        label: `Exhaust ${localAlliances.find((alliance) => alliance.id === entry.allianceId)?.name ?? entry.allianceId} (strength ${entry.strength})`,
        payload: { piece: "alliance", allianceId: entry.allianceId },
      })),
      {
        type: "eventsInIndia.defend",
        label: "Exhaust the rest automatically",
        description: "Regiments first, then officers in seating order.",
        payload: { piece: "auto" },
      },
    ],
    canSave: true,
  };
}

function chooseAttackDecision(
  state: GameState,
  actor: PlayerId,
  presidency: PresidencyId,
  regionIds: RegionId[],
): PendingDecision {
  return {
    id: `decision-events-choose-attack-${state.turn}-${state.log.length}`,
    phase: "eventsInIndia",
    step: "eventsInIndia.chooseAttack",
    actor,
    visibility: "public",
    prompt: `Choose which Rebellion against the Company the Army of ${presidency} faces next.`,
    legalCommands: regionIds.map((regionId) => ({
      type: "eventsInIndia.chooseAttack",
      label: `${state.india.regions[regionId]?.name ?? regionId} (${state.india.regions[regionId]?.unrest ?? 0} unrest)`,
      payload: { regionId },
    })),
    canSave: true,
  };
}
