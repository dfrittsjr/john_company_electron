import { offices, punchboardPieces } from "../../../data";
import { vacateOfficeWithoutRetirement } from "../../offices";
import { recordOfficeholderBonus, voidOfficeholderBonuses } from "../negotiation";
import { chairmanHolder, officeHolder } from "../../selectors";
import type {
  ArmyId,
  GameCommand,
  GameState,
  OfficeId,
  PlayerId,
  PresidencyId,
  RegionId,
  SeaZoneId,
  ShipState,
} from "../../types";
import type { CompanyOperationState, OfficeProgress, ShipDestination } from "../company-operation.state";

// Helpers shared by the Company Operation offices (rulebook pp.17-26).

export const SEA_ZONE_BY_PRESIDENCY: Record<PresidencyId, SeaZoneId> = {
  Bombay: "west-indian",
  Madras: "south-indian",
  Bengal: "east-indian",
};

export const SEA_ZONE_LABEL: Record<ShipDestination, string> = {
  "west-indian": "West Indian",
  "south-indian": "South Indian",
  "east-indian": "East Indian",
  china: "China",
};

export const CHINA_OFFICE_ID = "superintendent-of-trade-in-china";
export const GOVERNOR_GENERAL_OFFICE_ID = "governor-general";

// Physical limits (rulebook p.2-3): 20 regiments; 14 double-sided Company/extra ship pieces.
const REGIMENT_PIECES = punchboardPieces.find((piece) => piece.id === "regiment")?.count ?? 20;
const COMPANY_SHIP_PIECES =
  punchboardPieces.find((piece) => piece.id === "company-extra-ship")?.count ?? 14;

/** The Company Operation slice for this turn; anything stored for an earlier turn is ignored. */
export function coState(state: GameState): CompanyOperationState {
  const co = state.companyOperation;
  return co.turn === state.turn ? co : { turn: state.turn };
}

export function withCo(state: GameState, patch: Partial<CompanyOperationState>): GameState {
  return { ...state, companyOperation: { ...coState(state), ...patch, turn: state.turn } };
}

export function withProgress(state: GameState, current: OfficeProgress | undefined): GameState {
  return withCo(state, { current });
}

export function officeLabel(officeId: OfficeId): string {
  return offices.find((office) => office.id === officeId)?.label ?? officeId;
}

export function playerName(state: GameState, playerId: PlayerId | undefined): string {
  if (!playerId) return "nobody";
  return state.players[playerId]?.name ?? playerId;
}

export function presidentOfficeId(presidency: PresidencyId): OfficeId {
  return `president-${presidency.toLowerCase()}`;
}

export function presidencyForPresidentOffice(officeId: OfficeId): PresidencyId | undefined {
  switch (officeId) {
    case "president-bombay":
      return "Bombay";
    case "president-madras":
      return "Madras";
    case "president-bengal":
      return "Bengal";
    default:
      return undefined;
  }
}

/** The Presidency a Company-controlled region answers to: its association, else its home Presidency. */
export function regionPresidencyId(state: GameState, regionId: RegionId): PresidencyId | undefined {
  const region = state.india.regions[regionId];
  return region?.associatedPresidency ?? (region?.companyControlled ? region.homePresidency : undefined);
}

export function isLawInEffect(state: GameState, lawId: string): boolean {
  return state.parliament.passedLaws.some((law) => law.lawId === lawId);
}

export function primeMinister(state: GameState): PlayerId | undefined {
  const pm = state.parliament.primeMinister;
  return pm && state.players[pm] ? pm : undefined;
}

/** The player holding an unplayed (facedown) copy of a blackmail card. */
export function unplayedBlackmailHolder(state: GameState, cardId: string): PlayerId | undefined {
  return state.seatingOrder.find((playerId) =>
    state.players[playerId]?.blackmailCards.some((card) => card.cardId === cardId && card.facedown !== false),
  );
}

/** Played blackmail goes face up in its owner's play area (p.12). */
export function markBlackmailPlayed(state: GameState, playerId: PlayerId, cardId: string): GameState {
  const player = state.players[playerId];
  let flipped = false;

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        blackmailCards: player.blackmailCards.map((card) => {
          if (flipped || card.cardId !== cardId || card.facedown === false) return card;
          flipped = true;
          return { ...card, facedown: false };
        }),
      },
    },
  };
}

/** Players owning a prestige enterprise card (it may sit with prestige cards or enterprises). */
export function prestigeCardHolders(state: GameState, cardId: string): PlayerId[] {
  return state.seatingOrder.filter((playerId) => {
    const player = state.players[playerId];
    return (
      player.prestigeCards.some((card) => card.cardId === cardId) ||
      player.enterprises.some((enterprise) => enterprise.cardId === cardId)
    );
  });
}

export function payPlayer(state: GameState, playerId: PlayerId, amount: number): GameState {
  if (amount === 0) return state;
  const player = state.players[playerId];
  return { ...state, players: { ...state.players, [playerId]: { ...player, cash: player.cash + amount } } };
}

export function addToCompanyBalance(state: GameState, amount: number): GameState {
  return amount === 0 ? state : { ...state, company: { ...state.company, balance: state.company.balance + amount } };
}

export function changeOfficeTreasury(state: GameState, officeId: OfficeId, delta: number): GameState {
  const office = state.company.offices[officeId];
  if (!office) throw new Error(`Office ${officeId} has no treasury.`);
  if (office.treasury + delta < 0) throw new Error(`Office ${officeId} cannot spend £${-delta}.`);

  return {
    ...state,
    company: {
      ...state.company,
      offices: { ...state.company.offices, [officeId]: { ...office, treasury: office.treasury + delta } },
    },
  };
}

export type BonusRecipient = { kind: "player"; playerId: PlayerId } | { kind: "companyBalance" } | { kind: "none" };

/**
 * Officeholder bonuses (the green boxes on office cards, p.5). Trade Regulations (law #40) sends the
 * President's bonus to the Company Balance instead. Each paid bonus is recorded with Negotiation so
 * a "Take my officeholder's bonus" promise holder can claim it (promise card back).
 */
export function payOfficeholderBonus(
  state: GameState,
  officeId: OfficeId,
  amount: number,
): { state: GameState; recipient: BonusRecipient } {
  if (amount <= 0) return { state, recipient: { kind: "none" } };
  if (presidencyForPresidentOffice(officeId) && isLawInEffect(state, "trade-regulations")) {
    return { state: addToCompanyBalance(state, amount), recipient: { kind: "companyBalance" } };
  }

  const holder = officeHolder(state, officeId);
  if (!holder) return { state, recipient: { kind: "none" } };

  return {
    state: recordOfficeholderBonus(payPlayer(state, holder, amount), { officeId, playerId: holder, amount }),
    recipient: { kind: "player", playerId: holder },
  };
}

/**
 * Catastrophic failure (p.17) and similar removals: the officeholder returns to supply, the office
 * card goes to Vacant Offices, and any fatigue returns to the supply. The treasury stays with the office.
 */
export function vacateOffice(state: GameState, officeId: OfficeId): GameState {
  return vacateOfficeWithoutRetirement(state, officeId);
}

/**
 * Catastrophic failure (p.17). A Governor removed this way forfeits the bonuses it made this turn
 * to "Take my officeholder's bonus" promise holders (promise card back).
 */
export function vacateAfterCatastrophe(state: GameState, officeId: OfficeId): GameState {
  return voidOfficeholderBonuses(vacateOffice(state, officeId), officeId);
}

export function regimentsInSupply(state: GameState): number {
  const inPlay = Object.values(state.company.armies).reduce(
    (total, army) => total + army.regiments.ready + army.regiments.exhausted,
    0,
  );
  return Math.max(0, REGIMENT_PIECES - inPlay);
}

export function companyShipPiecesInSupply(state: GameState): number {
  const ships = state.company.ships.filter((ship) => ship.kind !== "player").length;
  const partial = Object.values(state.india.regions).filter((region) => region.partialCompanyShip).length;
  return Math.max(0, COMPANY_SHIP_PIECES - ships - partial);
}

/** Commissioned regiments arrive ready. Foundry (prestige #24) pays £1 for each regiment added. */
export function addRegiment(state: GameState, army: ArmyId): GameState {
  const current = state.company.armies[army];
  let next: GameState = {
    ...state,
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [army]: { ...current, regiments: { ...current.regiments, ready: current.regiments.ready + 1 } },
      },
    },
  };
  for (const holder of prestigeCardHolders(next, "foundry")) next = payPlayer(next, holder, 1);
  return next;
}

export function addCompanyShip(
  state: GameState,
  location: ShipDestination,
  kind: "company" | "extra",
): GameState {
  const ship: ShipState = {
    id: `${kind}-ship-t${state.turn}-${state.log.length}-${state.company.ships.length + 1}`,
    kind,
    location,
    fatigued: false,
  };
  return { ...state, company: { ...state.company, ships: [...state.company.ships, ship] } };
}

export function chinaOpen(state: GameState): boolean {
  return Boolean(state.company.offices[CHINA_OFFICE_ID]?.created);
}

export function shipDestinations(state: GameState): ShipDestination[] {
  const zones: ShipDestination[] = ["west-indian", "south-indian", "east-indian"];
  return chinaOpen(state) ? [...zones, "china"] : zones;
}

export function companyControlledRegions(state: GameState): RegionId[] {
  return Object.values(state.india.regions)
    .filter((region) => region.companyControlled)
    .map((region) => region.id);
}

export function playersClockwiseFrom(state: GameState, first: PlayerId): PlayerId[] {
  const start = state.seatingOrder.indexOf(first);
  if (start < 0) return [...state.seatingOrder];
  return [...state.seatingOrder.slice(start), ...state.seatingOrder.slice(0, start)];
}

export function chairmanOrSystem(state: GameState): PlayerId | "system" {
  return chairmanHolder(state) ?? "system";
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left as Record<string, unknown>).filter(
    (key) => (left as Record<string, unknown>)[key] !== undefined,
  );
  const rightKeys = Object.keys(right as Record<string, unknown>).filter(
    (key) => (right as Record<string, unknown>)[key] !== undefined,
  );
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) =>
    deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

/** Every Company Operation command must be one of the listed legal commands, payload and all. */
export function isListedCommand(state: GameState, command: GameCommand): boolean {
  return state.pendingDecision.legalCommands.some(
    (legal) => legal.type === command.type && deepEqual(legal.payload ?? {}, command.payload ?? {}),
  );
}

export function decisionId(state: GameState, step: string): string {
  return `decision-${step}-turn-${state.turn}-${state.log.length}`;
}
