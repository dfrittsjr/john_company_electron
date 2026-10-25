import { companyTracks, firmCharter, firmNamesByColor, firmStrategyById, type FirmStrategyCard, type FirmStrategyId } from "../data";
import type { FirmId, FirmState, GameState, PlayerId, ShipState } from "./types";

// Shared firm rules (Deregulation, rulebook pp.36-42): selectors and the state changes several
// phases need (forming, investing, dissolving, merging, takeovers). They change pieces and cash
// only; the phases own the decisions, consents and log entries around them. See
// docs/phases/deregulation.md.

/** True once the Vote to Deregulate has passed (or the scenario starts deregulated). */
export function isDeregulated(state: GameState): boolean {
  return state.parliament.deregulated;
}

export function allFirms(state: GameState): FirmState[] {
  return state.firms ?? [];
}

export function firmById(state: GameState, firmId: FirmId): FirmState | undefined {
  return allFirms(state).find((firm) => firm.id === firmId);
}

/** The firm on this player's board, if they manage one. A player manages at most one firm (p.38). */
export function firmManagedBy(state: GameState, playerId: PlayerId): FirmState | undefined {
  return allFirms(state).find((firm) => firm.manager === playerId);
}

/** The charter name of the manager's family board, e.g. "Hastings & Co." */
export function firmName(state: GameState, firm: FirmState): string {
  const manager = state.players[firm.manager];
  return firmNamesByColor[manager?.color?.toLowerCase() ?? ""] ?? `${manager?.name ?? firm.manager} & Co.`;
}

export function firmShips(state: GameState, firmId: FirmId): ShipState[] {
  return state.company.ships.filter((ship) => ship.location === `firm:${firmId}`);
}

export function firmShareTotal(firm: FirmState): number {
  return Object.values(firm.shares).reduce((total, count) => total + count, 0);
}

/** Victory points per share at a Value space (charter). Fractions are summed before rounding down (p.37). */
export function firmShareVictoryPoints(value: number): number {
  const clamped = Math.min(firmCharter.maxValue, Math.max(firmCharter.minValue, value));
  return firmCharter.valueVictoryPoints[clamped - 1];
}

/** This turn's strategy card for a firm, from the hidden record (engine side; views may hide it). */
export function firmStrategy(state: GameState, firmId: FirmId): FirmStrategyCard | undefined {
  const id = state.hidden.firmStrategySecrets[firmId]?.strategy;
  return id ? firmStrategyById.get(id as FirmStrategyId) : undefined;
}

/**
 * "Weak Company shares": while Standing and/or Debt is on a lined space, Company shares can't form a
 * firm or invest (p.38). Returns why, or undefined when they can be used.
 */
export function weakCompanySharesReason(state: GameState): string | undefined {
  const standingLined = companyTracks.standing[state.company.standing]?.lined ?? false;
  const debtLined = companyTracks.debt.find((space) => space.value === state.company.debt)?.lined ?? false;
  if (standingLined && debtLined) return "Company Standing and Debt are both on lined spaces, so Company shares are weak.";
  if (standingLined) return "Company Standing is on a lined space, so Company shares are weak.";
  if (debtLined) return "Company Debt is on a lined space, so Company shares are weak.";
  return undefined;
}

/** What a player gives up to form or invest in a firm (p.38): a Company share or a workshop. */
export type FirmInvestmentSource = { kind: "companyShare"; shareId: string } | { kind: "workshop"; enterpriseId: string };

/**
 * The sources a player may use now. Company shares must be in the Court, not weak (p.38) and not
 * created this turn ("immature", p.38; applied to forming as well as investing, see the phase
 * notes). Workshops must not be invested already.
 */
export function firmInvestmentSources(state: GameState, playerId: PlayerId): FirmInvestmentSource[] {
  const sources: FirmInvestmentSource[] = [];
  if (!weakCompanySharesReason(state)) {
    for (const share of state.company.court) {
      if (share.owner === playerId && share.createdTurn !== state.turn) sources.push({ kind: "companyShare", shareId: share.id });
    }
  }
  for (const enterprise of state.players[playerId]?.enterprises ?? []) {
    if (enterprise.type === "workshop" && !enterprise.invested) sources.push({ kind: "workshop", enterpriseId: enterprise.id });
  }
  return sources;
}

/** Returns the Company share to its owner's supply, or flips the workshop to its invested side. */
export function spendInvestmentSource(state: GameState, playerId: PlayerId, source: FirmInvestmentSource): GameState {
  const player = state.players[playerId];
  if (source.kind === "companyShare") {
    const share = state.company.court.find((candidate) => candidate.id === source.shareId);
    if (!share || share.owner !== playerId) throw new Error(`${playerId} has no Company share ${source.shareId} in the Court.`);
    return {
      ...state,
      company: { ...state.company, court: state.company.court.filter((candidate) => candidate.id !== source.shareId) },
      players: {
        ...state.players,
        [playerId]: { ...player, familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply + 1 } },
      },
    };
  }
  const workshop = player.enterprises.find((enterprise) => enterprise.id === source.enterpriseId);
  if (!workshop || workshop.type !== "workshop" || workshop.invested) {
    throw new Error(`${playerId} has no uninvested workshop ${source.enterpriseId}.`);
  }
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        enterprises: player.enterprises.map((enterprise) => (enterprise.id === source.enterpriseId ? { ...enterprise, invested: true } : enterprise)),
      },
    },
  };
}

/** Why `playerId` can't form a firm now with `source`, or undefined if they can. */
export function formFirmBlockReason(state: GameState, playerId: PlayerId, source: FirmInvestmentSource): string | undefined {
  if (!isDeregulated(state)) return "Firms exist only after Deregulation.";
  if (firmManagedBy(state, playerId)) return "You already manage a firm.";
  if (!firmInvestmentSources(state, playerId).some((candidate) => sameSource(candidate, source))) {
    return "That Company share or workshop can't be used now.";
  }
  // The first share is a piece from supply; a returned Company share frees one.
  if (source.kind === "workshop" && state.players[playerId].familyMembers.supply < 1) return "You have no family member in supply for the first share.";
  return undefined;
}

/**
 * Forming a firm (p.38): give up a Company share or a workshop, flip the board to the charter, put
 * one piece from supply on Shares, the Value cube on 1, and £5 from the bank in London.
 */
export function formFirm(state: GameState, playerId: PlayerId, source: FirmInvestmentSource): { state: GameState; firmId: FirmId } {
  const reason = formFirmBlockReason(state, playerId, source);
  if (reason) throw new Error(reason);
  const spent = spendInvestmentSource(state, playerId, source);
  const firmId = newFirmId(spent);
  const firm: FirmState = {
    id: firmId,
    manager: playerId,
    londonTreasury: firmCharter.investmentCash,
    indiaTreasury: 0,
    value: firmCharter.minValue,
    shares: { [playerId]: 1 },
    formedTurn: state.turn,
  };
  return { state: withSupply({ ...spent, firms: [...allFirms(spent), firm] }, playerId, -1), firmId };
}

/** Why `investorId` can't invest in the firm now with `source`, or undefined if they can. */
export function investBlockReason(state: GameState, firmId: FirmId, investorId: PlayerId, source: FirmInvestmentSource): string | undefined {
  const firm = firmById(state, firmId);
  if (!firm) return "There is no such firm.";
  if (!firmInvestmentSources(state, investorId).some((candidate) => sameSource(candidate, source))) {
    return "That Company share or workshop can't be used now.";
  }
  const createsShare = firmShareTotal(firm) < firmCharter.maxShares;
  if (createsShare && source.kind === "workshop" && state.players[investorId].familyMembers.supply < 1) {
    return "You have no family member in supply for the new share.";
  }
  return undefined;
}

/**
 * Investing (p.38): give up a Company share or a workshop; £5 from the bank goes to London and one
 * of the investor's pieces becomes a firm share, unless the firm already has 10. An emergency
 * investment during Revenue also lowers the Value by 1 (p.41), never below 1.
 * Consent (the manager's) is the caller's business.
 */
export function investInFirm(
  state: GameState,
  firmId: FirmId,
  investorId: PlayerId,
  source: FirmInvestmentSource,
  options: { emergency?: boolean } = {},
): { state: GameState; createdShare: boolean } {
  const reason = investBlockReason(state, firmId, investorId, source);
  if (reason) throw new Error(reason);
  const spent = spendInvestmentSource(state, investorId, source);
  const firm = firmById(spent, firmId)!;
  const createdShare = firmShareTotal(firm) < firmCharter.maxShares;
  const next: FirmState = {
    ...firm,
    londonTreasury: firm.londonTreasury + firmCharter.investmentCash,
    shares: createdShare ? { ...firm.shares, [investorId]: (firm.shares[investorId] ?? 0) + 1 } : firm.shares,
    value: options.emergency ? Math.max(firmCharter.minValue, firm.value - 1) : firm.value,
  };
  const updated = withFirm(spent, next);
  return { state: createdShare ? withSupply(updated, investorId, -1) : updated, createdShare };
}

/**
 * Dissolving a firm (p.41): every share goes to Debtor's Prison, its ships return unfitted to their
 * shipyards, its treasuries are lost, and the manager's board flips back. Invested workshops stay
 * invested.
 */
export function dissolveFirm(state: GameState, firmId: FirmId): GameState {
  const firm = firmById(state, firmId);
  if (!firm) throw new Error(`There is no firm ${firmId}.`);
  let next: GameState = {
    ...state,
    firms: allFirms(state).filter((candidate) => candidate.id !== firmId),
    company: {
      ...state.company,
      ships: state.company.ships.map((ship) => (ship.location === `firm:${firmId}` ? { ...ship, location: "shipyard", fatigued: false } : ship)),
    },
    hidden: { ...state.hidden, firmStrategySecrets: withoutKey(state.hidden.firmStrategySecrets, firmId) },
  };
  for (const [playerId, count] of Object.entries(firm.shares)) {
    if (count <= 0) continue;
    const player = next.players[playerId];
    next = {
      ...next,
      players: {
        ...next.players,
        [playerId]: { ...player, familyMembers: { ...player.familyMembers, debtorPrison: player.familyMembers.debtorPrison + count } },
      },
    };
  }
  return next;
}

/**
 * A merger (p.39): the secondary firms' treasuries, shares and ships move to the primary firm, which
 * keeps its manager, Value and dividend cube; the secondary boards flip back. If the primary would
 * hold more than 10 shares, `returned` says whose excess shares go back to their owners' supply (the
 * owners consent as part of the merger). Consents and any share trades are the caller's business.
 */
export function mergeFirms(
  state: GameState,
  primaryId: FirmId,
  secondaryIds: FirmId[],
  returned: Record<PlayerId, number> = {},
): GameState {
  const primary = firmById(state, primaryId);
  if (!primary) throw new Error(`There is no firm ${primaryId}.`);
  const secondaries = secondaryIds.map((id) => {
    const firm = firmById(state, id);
    if (!firm || id === primaryId) throw new Error(`Firm ${id} can't merge into ${primaryId}.`);
    return firm;
  });

  const shares: Record<PlayerId, number> = { ...primary.shares };
  for (const firm of secondaries) {
    for (const [playerId, count] of Object.entries(firm.shares)) shares[playerId] = (shares[playerId] ?? 0) + count;
  }
  for (const [playerId, count] of Object.entries(returned)) {
    if (count < 0 || (shares[playerId] ?? 0) < count) throw new Error(`${playerId} can't return ${count} shares.`);
    shares[playerId] -= count;
  }
  if (Object.values(shares).reduce((total, count) => total + count, 0) > firmCharter.maxShares) {
    throw new Error(`A merged firm may hold at most ${firmCharter.maxShares} shares.`);
  }

  const merged: FirmState = {
    ...primary,
    londonTreasury: primary.londonTreasury + secondaries.reduce((total, firm) => total + firm.londonTreasury, 0),
    indiaTreasury: primary.indiaTreasury + secondaries.reduce((total, firm) => total + firm.indiaTreasury, 0),
    shares: Object.fromEntries(Object.entries(shares).filter(([, count]) => count > 0)),
  };
  const secondarySet = new Set(secondaryIds);
  let next: GameState = {
    ...state,
    firms: allFirms(state).filter((firm) => !secondarySet.has(firm.id)).map((firm) => (firm.id === primaryId ? merged : firm)),
    company: {
      ...state.company,
      ships: state.company.ships.map((ship) =>
        secondaryIds.some((id) => ship.location === `firm:${id}`) ? { ...ship, location: `firm:${primaryId}` as const } : ship,
      ),
    },
    hidden: {
      ...state.hidden,
      firmStrategySecrets: secondaryIds.reduce((secrets, id) => withoutKey(secrets, id), state.hidden.firmStrategySecrets),
    },
  };
  for (const [playerId, count] of Object.entries(returned)) if (count > 0) next = withSupply(next, playerId, count);
  return next;
}

/**
 * A hostile takeover (p.39): a player who manages no firm, with consent from holders of a majority
 * of its shares, moves the firm (cubes, ships, treasuries, shares) to their own board. Consent is the
 * caller's business.
 */
export function takeOverFirm(state: GameState, firmId: FirmId, newManager: PlayerId): GameState {
  const firm = firmById(state, firmId);
  if (!firm) throw new Error(`There is no firm ${firmId}.`);
  if (firmManagedBy(state, newManager)) throw new Error(`${newManager} already manages a firm.`);
  const next = withFirm(state, { ...firm, manager: newManager });
  const secret = state.hidden.firmStrategySecrets[firmId];
  return secret
    ? { ...next, hidden: { ...next.hidden, firmStrategySecrets: { ...next.hidden.firmStrategySecrets, [firmId]: { ...secret, committedBy: newManager } } } }
    : next;
}

/** Moves firm shares between players (trading shares, p.38). */
export function transferFirmShares(state: GameState, firmId: FirmId, from: PlayerId, to: PlayerId, count: number): GameState {
  const firm = firmById(state, firmId);
  if (!firm || (firm.shares[from] ?? 0) < count || count < 1) throw new Error(`${from} doesn't hold ${count} shares of ${firmId}.`);
  const shares = { ...firm.shares, [from]: firm.shares[from] - count, [to]: (firm.shares[to] ?? 0) + count };
  return withFirm(state, { ...firm, shares: Object.fromEntries(Object.entries(shares).filter(([, held]) => held > 0)) });
}

export function withFirm(state: GameState, firm: FirmState): GameState {
  return { ...state, firms: allFirms(state).map((candidate) => (candidate.id === firm.id ? firm : candidate)) };
}

/** "firm-<log length + 1>", made unique among live firms (two can form within one command in tests). */
function newFirmId(state: GameState): FirmId {
  const base = `firm-${state.log.length + 1}`;
  const taken = new Set(allFirms(state).map((firm) => firm.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function withSupply(state: GameState, playerId: PlayerId, delta: number): GameState {
  const player = state.players[playerId];
  const supply = player.familyMembers.supply + delta;
  if (supply < 0) throw new Error(`${playerId} has no family member in supply.`);
  return { ...state, players: { ...state.players, [playerId]: { ...player, familyMembers: { ...player.familyMembers, supply } } } };
}

function sameSource(left: FirmInvestmentSource, right: FirmInvestmentSource): boolean {
  return left.kind === "companyShare"
    ? right.kind === "companyShare" && left.shareId === right.shareId
    : right.kind === "workshop" && left.enterpriseId === right.enterpriseId;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}
