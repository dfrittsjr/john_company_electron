import { offices } from "../data";
import type { GameState, OfficeId, PlayerId } from "./types";

// Office cards moving between the Vacant Offices box, the unused stack, and officeholders. Every
// phase that removes or creates an office goes through these helpers.

function updatePlayer(state: GameState, playerId: PlayerId, update: (player: GameState["players"][string]) => GameState["players"][string]): GameState {
  return { ...state, players: { ...state.players, [playerId]: update(state.players[playerId]) } };
}

/**
 * Removes an officeholder: their piece goes to their supply ("without retirement") or to the
 * Pensioners box, the office card goes to the Vacant Offices box and its fatigue is returned.
 * The Chairman's piece is also a Company share, so removing it removes that share (p.15).
 */
export function vacateOffice(
  state: GameState,
  officeId: OfficeId,
  destination: "supply" | "pensioners",
): { state: GameState; holder?: PlayerId } {
  const office = state.company.offices[officeId];
  if (!office || office.vacant || !office.holder) return { state };

  const holder = office.holder;
  const withPiece = updatePlayer(state, holder, (player) => ({
    ...player,
    familyMembers: {
      ...player.familyMembers,
      supply: player.familyMembers.supply + (destination === "supply" ? 1 : 0),
      pensioners: player.familyMembers.pensioners + (destination === "pensioners" ? 1 : 0),
    },
  }));

  return {
    holder,
    state: {
      ...withPiece,
      company: {
        ...withPiece.company,
        offices: {
          ...withPiece.company.offices,
          [officeId]: {
            ...office,
            holder: undefined,
            familyMemberId: undefined,
            fatigue: 0,
            vacant: true,
          },
        },
        vacantOffices: withPiece.company.vacantOffices.includes(officeId)
          ? withPiece.company.vacantOffices
          : [...withPiece.company.vacantOffices, officeId],
      },
    },
  };
}

/**
 * "Vacate their office without retirement" (Scandal cards, p.12) and catastrophic failure (p.17):
 * the officeholder returns to its family's supply rather than the Pensioners box.
 */
export function vacateOfficeWithoutRetirement(state: GameState, officeId: OfficeId): GameState {
  return vacateOffice(state, officeId, "supply").state;
}

export function officeLabel(officeId: OfficeId): string {
  return offices.find((office) => office.id === officeId)?.label ?? officeId;
}

export function officeCategory(officeId: OfficeId): string | undefined {
  return offices.find((office) => office.id === officeId)?.category;
}

/** Puts an office that is not yet in play into the Vacant Offices box (e.g. Envoy to China, p.25). */
export function createOffice(state: GameState, officeId: OfficeId): GameState {
  const existing = state.company.offices[officeId];
  if (existing?.created) return state;

  return {
    ...state,
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          treasury: 0,
          fatigue: 0,
          vacant: true,
          created: true,
          actedThisTurn: false,
        },
      },
      unusedOffices: state.company.unusedOffices.filter((candidate) => candidate !== officeId),
      vacantOffices: state.company.vacantOffices.includes(officeId)
        ? state.company.vacantOffices
        : [...state.company.vacantOffices, officeId],
    },
  };
}

/** Returns an office card to the box: no longer in play, not vacant, not hired. */
export function returnOfficeToBox(state: GameState, officeId: OfficeId): GameState {
  const existing = state.company.offices[officeId];
  return {
    ...state,
    company: {
      ...state.company,
      offices: existing
        ? {
            ...state.company.offices,
            [officeId]: {
              ...existing,
              holder: undefined,
              familyMemberId: undefined,
              treasury: 0,
              fatigue: 0,
              vacant: true,
              created: false,
            },
          }
        : state.company.offices,
      vacantOffices: state.company.vacantOffices.filter((candidate) => candidate !== officeId),
      unusedOffices: state.company.unusedOffices.includes(officeId)
        ? state.company.unusedOffices
        : [...state.company.unusedOffices, officeId],
    },
  };
}

/**
 * The Governor General law (p.26): every Governor becomes a pensioner and its card returns to the
 * box, unfinished Company ships are removed, and the Director of Trade's card, holder, fatigue and
 * treasury pass to the Governor General, who is hired like the Director of Trade when vacant.
 */
export function installGovernorGeneral(state: GameState): GameState {
  let current = state;
  const governorIds = Object.keys(current.company.offices).filter((officeId) => officeCategory(officeId) === "governor");
  for (const officeId of governorIds) {
    current = returnOfficeToBox(vacateOffice(current, officeId, "pensioners").state, officeId);
  }

  const director = current.company.offices["director-of-trade"];
  const directorHeld = Boolean(director && !director.vacant && director.holder);
  const governorGeneral = {
    id: "governor-general",
    holder: directorHeld ? director.holder : undefined,
    familyMemberId: directorHeld ? director.familyMemberId : undefined,
    treasury: director?.treasury ?? 0,
    fatigue: directorHeld ? director.fatigue : 0,
    vacant: !directorHeld,
    created: true,
    actedThisTurn: director?.actedThisTurn ?? false,
  };
  current = returnOfficeToBox(current, "director-of-trade");

  return {
    ...current,
    company: {
      ...current.company,
      governorGeneralInPlay: true,
      offices: { ...current.company.offices, "governor-general": governorGeneral },
      unusedOffices: current.company.unusedOffices.filter((officeId) => officeId !== "governor-general"),
      vacantOffices: directorHeld
        ? current.company.vacantOffices.filter((officeId) => officeId !== "governor-general")
        : [...new Set([...current.company.vacantOffices, "governor-general"])],
    },
    india: {
      ...current.india,
      regions: Object.fromEntries(
        Object.entries(current.india.regions).map(([regionId, region]) => [regionId, { ...region, partialCompanyShip: false }]),
      ),
    },
  };
}
