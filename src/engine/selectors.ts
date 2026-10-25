import { companyTracks, offices, scenarios } from "../data";
import type { OfficeDefinition, ScenarioDefinition } from "../data/types";
import type {
  ArmyId,
  GameState,
  OfficeId,
  PieceStack,
  PlayerId,
  PresidencyId,
  RegionId,
  ShipState,
} from "./types";

// Read-only views over canonical state. Each family piece is stored in exactly one place;
// these functions answer per-player questions without keeping copies in PlayerState.

export const PRESIDENCY_IDS: readonly PresidencyId[] = ["Bombay", "Madras", "Bengal"];

/** Office boxes on the red ribbon that hold cash (board_image-1.png: coin icons). */
export const COMPANY_TREASURY_OFFICE_IDS: readonly OfficeId[] = [
  "director-of-trade",
  "manager-of-shipping",
  "president-bombay",
  "president-madras",
  "president-bengal",
];

export function scenarioDefinition(state: Pick<GameState, "scenario">): ScenarioDefinition {
  const scenario = scenarios.find((candidate) => candidate.id === state.scenario);
  if (!scenario) throw new Error(`Unknown scenario "${state.scenario}".`);

  return scenario;
}

export function officeDefinition(officeId: OfficeId): OfficeDefinition | undefined {
  return offices.find((office) => office.id === officeId);
}

export function toEnginePresidency(presidency: string): PresidencyId {
  switch (presidency) {
    case "bombay":
    case "Bombay":
      return "Bombay";
    case "madras":
    case "Madras":
      return "Madras";
    case "bengal":
    case "Bengal":
      return "Bengal";
    default:
      throw new Error(`Unknown Presidency id "${presidency}".`);
  }
}

export function officeHolder(state: GameState, officeId: OfficeId): PlayerId | undefined {
  const office = state.company.offices[officeId];
  return office && !office.vacant ? office.holder : undefined;
}

export function playerOffices(state: GameState, playerId: PlayerId): OfficeId[] {
  return Object.values(state.company.offices)
    .filter((office) => !office.vacant && office.holder === playerId)
    .map((office) => office.id);
}

export function presidentOf(state: GameState, presidency: PresidencyId): PlayerId | undefined {
  return officeHolder(state, `president-${presidency.toLowerCase()}`);
}

export function commanderOf(state: GameState, army: ArmyId): PlayerId | undefined {
  return state.company.armies[army]?.commander;
}

export function playerCommands(state: GameState, playerId: PlayerId): ArmyId[] {
  return PRESIDENCY_IDS.filter((army) => commanderOf(state, army) === playerId);
}

export function chairmanHolder(state: GameState): PlayerId | undefined {
  return officeHolder(state, "chairman");
}

/**
 * The family with the Chairman title: the Chairman, or the former Chairman (marker holder) while
 * the office is vacant. Retirements and Family turns start with this player (pp.11, 13).
 */
export function chairmanTitleHolder(state: GameState): PlayerId | undefined {
  return chairmanHolder(state) ?? state.company.chairmanMarker;
}

export function playerCourtShares(state: GameState, playerId: PlayerId): number {
  return state.company.court.filter((share) => share.owner === playerId).length;
}

/** Company shares are Court pieces plus the Chairman's piece (p.15). */
export function companyShareCount(state: GameState): number {
  return state.company.court.filter((share) => share.owner).length + (chairmanHolder(state) ? 1 : 0);
}

export function companySharesByPlayer(state: GameState): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const share of state.company.court) {
    if (!share.owner) continue;
    counts.set(share.owner, (counts.get(share.owner) ?? 0) + 1);
  }

  const chairman = chairmanHolder(state);
  if (chairman) counts.set(chairman, (counts.get(chairman) ?? 0) + 1);

  return counts;
}

export function playerStockExchangeSlots(state: GameState, playerId: PlayerId): string[] {
  return state.company.stockExchange
    .filter((slot) => slot.share?.owner === playerId)
    .map((slot) => slot.id);
}

export function playerWriters(state: GameState, playerId: PlayerId): Record<PresidencyId, number> {
  return {
    Bombay: state.india.presidencies.Bombay.writers[playerId] ?? 0,
    Madras: state.india.presidencies.Madras.writers[playerId] ?? 0,
    Bengal: state.india.presidencies.Bengal.writers[playerId] ?? 0,
  };
}

export function playerWritersOnOrders(state: GameState, playerId: PlayerId): number {
  return Object.values(state.india.regions).reduce(
    (total, region) => total + region.orders.filter((order) => order.writer?.playerId === playerId).length,
    0,
  );
}

export function playerOfficers(state: GameState, playerId: PlayerId): Record<ArmyId, PieceStack> {
  const stack = (army: ArmyId): PieceStack => ({
    ready: state.company.armies[army].officers[playerId]?.ready ?? 0,
    exhausted: state.company.armies[army].officers[playerId]?.exhausted ?? 0,
  });

  return { Bombay: stack("Bombay"), Madras: stack("Madras"), Bengal: stack("Bengal") };
}

export function playerFirmShares(state: GameState, playerId: PlayerId): number {
  return (state.firms ?? []).reduce((total, firm) => total + (firm.shares[playerId] ?? 0), 0);
}

/** Every location a family's pieces can occupy, for display and the piece-conservation invariant. */
export function familyPieceLocations(state: GameState, playerId: PlayerId): Record<string, number> {
  const player = state.players[playerId];
  const officers = playerOfficers(state, playerId);
  const writers = playerWriters(state, playerId);

  return {
    supply: player.familyMembers.supply,
    pensioners: player.familyMembers.pensioners,
    prizes: Object.values(player.familyMembers.prizes).reduce((total, count) => total + count, 0),
    officersInTraining: player.familyMembers.officersInTraining,
    debtorPrison: player.familyMembers.debtorPrison,
    offices: playerOffices(state, playerId).length,
    court: playerCourtShares(state, playerId),
    stockExchange: playerStockExchangeSlots(state, playerId).length,
    writers: writers.Bombay + writers.Madras + writers.Bengal,
    writersOnOrders: playerWritersOnOrders(state, playerId),
    officers: PRESIDENCY_IDS.reduce(
      (total, army) => total + officers[army].ready + officers[army].exhausted,
      0,
    ),
    commanders: playerCommands(state, playerId).length,
    firmShares: playerFirmShares(state, playerId),
  };
}

export function familyPieceTotal(state: GameState, playerId: PlayerId): number {
  return Object.values(familyPieceLocations(state, playerId)).reduce((total, count) => total + count, 0);
}

export function companyExpectations(state: GameState): number | null {
  return companyTracks.standing[state.company.standing]?.expectations ?? null;
}

export function standingLabel(state: GameState): string {
  return companyTracks.standing[state.company.standing]?.label ?? String(state.company.standing);
}

/** The Presidency a region is associated with: set on conquest, so `undefined` for most regions. */
export function regionPresidency(state: GameState, regionId: RegionId): PresidencyId | undefined {
  return state.india.regions[regionId]?.associatedPresidency;
}

export function shipyardOwner(state: GameState, shipyardCardId: string): PlayerId | undefined {
  return Object.values(state.players).find((player) =>
    player.enterprises.some((enterprise) => enterprise.type === "shipyard" && enterprise.cardId === shipyardCardId),
  )?.id;
}

export function shipForShipyard(state: GameState, shipyardCardId: string): ShipState | undefined {
  return state.company.ships.find((ship) => ship.kind === "player" && ship.shipyardCardId === shipyardCardId);
}

export function isShipFitted(ship: ShipState | undefined): boolean {
  return Boolean(ship && ship.location !== "shipyard");
}

/** Ships that pay Company expenses: everything in the three sea zones, plus China (counts as Eastern, p.25). */
export function shipsInSeaZones(state: GameState): ShipState[] {
  return state.company.ships.filter(
    (ship) =>
      ship.location === "west-indian" ||
      ship.location === "south-indian" ||
      ship.location === "east-indian" ||
      ship.location === "china",
  );
}
