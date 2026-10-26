import {
  companyTracks,
  enterpriseDecks,
  offices,
  powerTrack,
  prestigeCards,
  prizes,
  scenarios,
  type PowerTargetId,
  type PowerTrackPositionId,
} from "../data";
import type { PowerTargetId as PowerTargetKind, PrestigeCard } from "../data";
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

/** A family's name used before a piece: "a Red officer", "a Crown writer" (not "a The Crown writer"). */
export function familyAdjective(state: GameState, playerId: PlayerId): string {
  const player = state.players[playerId];
  return player?.isCrown ? "Crown" : player?.name ?? playerId;
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

// --- London Season, Upkeep and Final Scoring views (LS) ---

const enterpriseCardById = new Map(enterpriseDecks.flatMap((deck) => deck.cards).map((card) => [card.id, card]));
const prestigeCardById = new Map(prestigeCards.map((card) => [card.id, card]));
const prizeById = new Map(prizes.map((prize) => [prize.id, prize]));

/** Seating order rotated so `first` leads, continuing clockwise. Unknown `first` keeps seat order. */
export function clockwiseFrom(state: GameState, first: PlayerId | undefined): PlayerId[] {
  const index = first ? state.seatingOrder.indexOf(first) : -1;
  if (index <= 0) return [...state.seatingOrder];
  return [...state.seatingOrder.slice(index), ...state.seatingOrder.slice(0, index)];
}

/** "Prime Minister order (clockwise, starting with the Prime Minister)" (p.9, p.12). */
export function primeMinisterOrder(state: GameState): PlayerId[] {
  return clockwiseFrom(state, state.parliament.primeMinister);
}

/**
 * Window tax icons a family has: luxuries, prestige cards with window icons, and each family
 * member on a prize (p.11, p.13). Used for tie-breaks (p.9, p.12) and window taxes (p.34).
 */
export function playerWindowIcons(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) return 0;

  const enterpriseWindows = player.enterprises.reduce(
    (total, enterprise) => total + (enterpriseCardById.get(enterprise.cardId ?? "")?.windowTaxIcons ?? 0),
    0,
  );
  const prestigeWindows = player.prestigeCards.reduce(
    (total, card) => total + (prestigeCardById.get(card.cardId)?.windowTaxIcons ?? 0),
    0,
  );
  const prizeWindows = Object.entries(player.familyMembers.prizes).reduce(
    (total, [prizeId, count]) => total + count * (prizeById.get(prizeId)?.windowTaxIcons ?? 0),
    0,
  );

  return enterpriseWindows + prestigeWindows + prizeWindows;
}

/** Spouse cards a family holds (they cannot be transferred, p.12). */
export function playerSpouses(state: GameState, playerId: PlayerId): PrestigeCard[] {
  return (state.players[playerId]?.prestigeCards ?? [])
    .map((card) => prestigeCardById.get(card.cardId))
    .filter((card): card is PrestigeCard => card?.prestigeType === "spouse");
}

/** True when one of the player's spouses forbids holding this kind of card or piece (e.g. Joseph Sedley and shares). */
export function playerForbidsHolding(
  state: GameState,
  playerId: PlayerId,
  holding: "blackmail" | "workshop" | "shipyard" | "companyShare",
): boolean {
  // The Crown ignores any text effects on Spouse cards (Crown Handbook p.2).
  if (state.players[playerId]?.isCrown) return false;
  return playerSpouses(state, playerId).some((spouse) =>
    spouse.effects.some((effect) => effect.type === "forbidHolding" && effect.holding === holding),
  );
}

export function playerHasPrestigeCard(state: GameState, playerId: PlayerId, cardId: string): boolean {
  return (state.players[playerId]?.prestigeCards ?? []).some((card) => card.cardId === cardId);
}

/**
 * Power of each Power track marker (p.9). `company.powerTrack` stores the power value of the box
 * each marker sits in; missing entries fall back to the printed starting boxes.
 */
export function powerTrackValue(state: GameState, target: PowerTargetKind): number {
  const stored = state.company.powerTrack[target];
  if (typeof stored === "number") return stored;

  const startBox = powerTrack.startingPositions[target];
  return powerTrack.positions.find((position) => position.id === startBox)?.power ?? 0;
}

/** True once the game has ended: no negotiation, promises or blackmail except as cards allow (p.9). */
export function isGameOver(state: GameState): boolean {
  return state.phase === "finalScoring";
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

/**
 * Where each power marker sits. company.powerTrack stores each marker's power value (2, 1 or 0, the
 * value of its box); Parliament's power policies and Final Scoring read it that way. The two bottom
 * boxes are both worth 0 and both link to the middle box, so a marker on 0 is placed in its printed
 * starting box when that box is a bottom box and free, otherwise in the other bottom box.
 */
export function powerMarkerPositions(state: GameState): Record<PowerTargetId, PowerTrackPositionId> {
  const targets = Object.keys(powerTrack.startingPositions) as PowerTargetId[];
  const positions = { ...powerTrack.startingPositions };
  const used = new Set<PowerTrackPositionId>();
  const boxWorth = (power: number) => powerTrack.positions.filter((position) => position.power === power);

  for (const target of targets) {
    const power = powerTrackValue(state, target);
    if (power === 0) continue;
    const box = boxWorth(power)[0];
    if (box) {
      positions[target] = box.id;
      used.add(box.id);
    }
  }

  for (const target of targets) {
    if (powerTrackValue(state, target) !== 0) continue;
    const bottomBoxes = boxWorth(0).map((position) => position.id);
    const start = powerTrack.startingPositions[target];
    const box = bottomBoxes.includes(start) && !used.has(start) ? start : bottomBoxes.find((id) => !used.has(id));
    if (box) {
      positions[target] = box;
      used.add(box);
    }
  }

  return positions;
}

export function withPowerMarkerPositions(
  state: GameState,
  positions: Record<PowerTargetId, PowerTrackPositionId>,
): GameState {
  const powerOf = (box: PowerTrackPositionId) =>
    powerTrack.positions.find((position) => position.id === box)?.power ?? 0;

  return {
    ...state,
    company: {
      ...state.company,
      powerTrack: Object.fromEntries(
        Object.entries(positions).map(([target, box]) => [target, powerOf(box)]),
      ),
    },
  };
}
