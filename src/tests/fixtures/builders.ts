import type { ArmyId, GameState, OfficeId, PlayerId, PresidencyId, ShareInstance } from "../../engine";

// Test-state builders. Each one moves family pieces out of supply into a single canonical
// location, so the "every family has all its pieces somewhere" invariant keeps holding.

function takeFromSupply(state: GameState, playerId: PlayerId, count: number): GameState {
  const player = state.players[playerId];

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        familyMembers: { ...player.familyMembers, supply: player.familyMembers.supply - count },
      },
    },
  };
}

function returnOfficeholderToSupply(state: GameState, officeId: OfficeId): GameState {
  const previous = state.company.offices[officeId];
  if (!previous?.holder || previous.vacant) return state;

  return takeFromSupply(state, previous.holder, -1);
}

export function withOffice(
  state: GameState,
  officeId: OfficeId,
  holder: PlayerId | undefined,
  options: { fatigue?: number; treasury?: number; inHiringQueue?: boolean } = {},
): GameState {
  const cleared = returnOfficeholderToSupply(state, officeId);
  const previous = cleared.company.offices[officeId];
  const next = {
    ...cleared,
    company: {
      ...cleared.company,
      offices: {
        ...cleared.company.offices,
        [officeId]: {
          id: officeId,
          holder,
          familyMemberId: holder ? `${officeId}-test` : undefined,
          treasury: options.treasury ?? previous?.treasury ?? 0,
          fatigue: options.fatigue ?? 0,
          vacant: !holder,
          created: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: holder
        ? cleared.company.vacantOffices.filter((candidate) => candidate !== officeId)
        : options.inHiringQueue === false
          ? cleared.company.vacantOffices.filter((candidate) => candidate !== officeId)
          : [...new Set([...cleared.company.vacantOffices, officeId])],
      unusedOffices: cleared.company.unusedOffices.filter((candidate) => candidate !== officeId),
    },
  };

  return holder ? takeFromSupply(next, holder, 1) : next;
}

/** Only these offices are waiting to be hired. */
export function withHiringQueue(state: GameState, officeIds: OfficeId[]): GameState {
  return { ...state, company: { ...state.company, vacantOffices: officeIds } };
}

export function withCourtShares(state: GameState, shares: ShareInstance[]): GameState {
  let next: GameState = { ...state, company: { ...state.company, court: shares } };
  for (const share of state.company.court) {
    if (share.owner) next = takeFromSupply(next, share.owner, -1);
  }
  for (const share of shares) {
    if (share.owner) next = takeFromSupply(next, share.owner, 1);
  }

  return next;
}

export function withWriters(
  state: GameState,
  playerId: PlayerId,
  presidency: PresidencyId,
  count: number,
): GameState {
  const box = state.india.presidencies[presidency];
  const previous = box.writers[playerId] ?? 0;

  return takeFromSupply(
    {
      ...state,
      india: {
        ...state.india,
        presidencies: {
          ...state.india.presidencies,
          [presidency]: { ...box, writers: { ...box.writers, [playerId]: count } },
        },
      },
    },
    playerId,
    count - previous,
  );
}

export function withOfficers(
  state: GameState,
  playerId: PlayerId,
  army: ArmyId,
  stack: { ready?: number; exhausted?: number },
): GameState {
  const current = state.company.armies[army].officers[playerId] ?? { ready: 0, exhausted: 0 };
  const next = { ready: stack.ready ?? 0, exhausted: stack.exhausted ?? 0 };

  return takeFromSupply(
    {
      ...state,
      company: {
        ...state.company,
        armies: {
          ...state.company.armies,
          [army]: {
            ...state.company.armies[army],
            officers: { ...state.company.armies[army].officers, [playerId]: next },
          },
        },
      },
    },
    playerId,
    next.ready + next.exhausted - current.ready - current.exhausted,
  );
}

export function withCommander(state: GameState, army: ArmyId, playerId: PlayerId | undefined): GameState {
  const previous = state.company.armies[army].commander;
  let next: GameState = {
    ...state,
    company: {
      ...state.company,
      armies: { ...state.company.armies, [army]: { ...state.company.armies[army], commander: playerId } },
    },
  };
  if (previous) next = takeFromSupply(next, previous, -1);
  if (playerId) next = takeFromSupply(next, playerId, 1);

  return next;
}

export function withOfficersInTraining(state: GameState, playerId: PlayerId, count: number): GameState {
  const player = state.players[playerId];
  const previous = player.familyMembers.officersInTraining;

  return takeFromSupply(
    {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...player, familyMembers: { ...player.familyMembers, officersInTraining: count } },
      },
    },
    playerId,
    count - previous,
  );
}

export function withCash(state: GameState, cashByPlayer: Record<PlayerId, number>): GameState {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        { ...player, cash: cashByPlayer[playerId] ?? player.cash },
      ]),
    ),
  };
}

/** Mark a region as conquered by a Presidency, as a Commander's successful Deploy would (p.23). */
export function withAssociatedRegion(state: GameState, regionId: string, presidency: PresidencyId): GameState {
  const region = state.india.regions[regionId];

  return {
    ...state,
    india: {
      ...state.india,
      regions: {
        ...state.india.regions,
        [regionId]: {
          ...region,
          companyControlled: true,
          hasDome: false,
          towerLevels: 0,
          empireFlag: undefined,
          isCapital: false,
          associatedPresidency: presidency,
          lootToken: { ...region.lootToken, face: "control" },
        },
      },
    },
  };
}

/**
 * Park a family's remaining supply in the Pensioners box so the Family phase offers only
 * No Action (unless they have cash). Pensioners stay put until the next London Season.
 */
export function withNoSupply(state: GameState, playerIds: PlayerId[] = Object.keys(state.players)): GameState {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        playerIds.includes(playerId)
          ? {
              ...player,
              familyMembers: {
                ...player.familyMembers,
                pensioners: player.familyMembers.pensioners + player.familyMembers.supply,
                supply: 0,
              },
            }
          : player,
      ]),
    ),
  };
}

export function withWriterOnOrder(
  state: GameState,
  orderId: string,
  playerId: PlayerId,
  presidency: PresidencyId,
  options: { filledBy?: Array<"company" | string> } = {},
): GameState {
  const region = Object.values(state.india.regions).find((candidate) =>
    candidate.orders.some((order) => order.id === orderId),
  );
  if (!region) throw new Error(`Unknown order ${orderId}`);

  return takeFromSupply(
    {
      ...state,
      india: {
        ...state.india,
        regions: {
          ...state.india.regions,
          [region.id]: {
            ...region,
            orders: region.orders.map((order) =>
              order.id === orderId
                ? { ...order, writer: { playerId, presidency }, filledThisTurnBy: options.filledBy ?? ["company"] }
                : order,
            ),
          },
        },
      },
    },
    playerId,
    1,
  );
}

export function withFilledOrder(state: GameState, orderId: string, filledBy: Array<"company" | string>): GameState {
  const region = Object.values(state.india.regions).find((candidate) =>
    candidate.orders.some((order) => order.id === orderId),
  );
  if (!region) throw new Error(`Unknown order ${orderId}`);

  return {
    ...state,
    india: {
      ...state.india,
      regions: {
        ...state.india.regions,
        [region.id]: {
          ...region,
          orders: region.orders.map((order) =>
            order.id === orderId ? { ...order, filledThisTurnBy: filledBy } : order,
          ),
        },
      },
    },
  };
}

export function withRegiments(state: GameState, regiments: Partial<Record<ArmyId, { ready: number; exhausted: number }>>): GameState {
  return {
    ...state,
    company: {
      ...state.company,
      armies: Object.fromEntries(
        Object.entries(state.company.armies).map(([armyId, army]) => [
          armyId,
          { ...army, regiments: regiments[armyId as ArmyId] ?? army.regiments },
        ]),
      ) as GameState["company"]["armies"],
    },
  };
}
