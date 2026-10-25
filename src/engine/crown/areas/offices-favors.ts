import { MAX_COMPANY_DEBT } from "../../../data";
import { officeLabel, companyShipPiecesInSupply } from "../../phases/company-operation/context";
import type { ChairmanPayload } from "../../phases/company-operation/chairman";
import type { DirectorPayload } from "../../phases/company-operation/director-of-trade";
import type { GovernorGeneralPayload } from "../../phases/company-operation/governor-general";
import type { MilitaryPayload } from "../../phases/company-operation/military-affairs";
import type { ShippingPayload } from "../../phases/company-operation/shipping";
import { PRESIDENCY_IDS, officeHolder } from "../../selectors";
import type { GameCommand, GameState, LegalCommand, OfficeId, PendingDecision, PlayerId } from "../../types";
import {
  chooseForCrownFavor,
  crownDecidingStep,
  effectFavor,
  printedCost,
  sameCommand,
  type CrownCubeDetector,
  type CrownFavorDefinition,
} from "../kit";
import { CROWN_PLAYER_ID, addCrownEffect, crownEffects, isCrownPresidency } from "../state";
import {
  allWriters,
  crownWriters,
  presidencyOfZone,
  ships,
} from "./offices-metrics";
import {
  GOVERN_RESULT,
  chairmanProgress,
  consentCommands,
  debtAdvancesWanted,
  directorProgress,
  militaryProgress,
  nextOfficerToAssign,
  placementDestination,
  shippingNext,
  undoesArmyMove,
  undoesDirectorMove,
  type EnvoyForce,
} from "./offices-plans";

// The favours on Handbook pp.4-9: the ones players buy from the Crown (CrownFavorDefinition) and the
// ones a human officeholder earns or owes by what they do (CrownCubeDetector).

const CROWN = CROWN_PLAYER_ID;

function payloadOf<T>(command: LegalCommand): T {
  return command.payload as T;
}

function holds(state: GameState, officeId: OfficeId, playerId: PlayerId): boolean {
  return officeHolder(state, officeId) === playerId;
}

function crownHolds(state: GameState, officeId: OfficeId): boolean {
  return officeHolder(state, officeId) === CROWN;
}

const DIRECTOR = "companyOperation.directorOfTrade";
const MILITARY = "companyOperation.militaryAffairs";
const SHIPPING = "companyOperation.shipping";

function directorOffice(state: GameState): OfficeId {
  return state.company.governorGeneralInPlay ? "governor-general" : "director-of-trade";
}

// =============================================================================================
// Favours bought from the Crown
// =============================================================================================

// --- Chairman (pp.4-5) ---

function crownChairmanDeciding(state: GameState): boolean {
  return crownDecidingStep(state, ["companyOperation.chairman"]) && crownHolds(state, "chairman");
}

/** Seek Debt comes before the first allocation. */
function seekingDebt(state: GameState): boolean {
  const progress = chairmanProgress(state);
  return crownChairmanDeciding(state) && Object.keys(progress.allocated ?? {}).length === 0 && !progress.consentRefused && state.company.debt < MAX_COMPANY_DEBT;
}

/**
 * chooseForCrownFavor for a favour that names the one option the Crown would otherwise refuse
 * ("consent", "open trade with China"): on offer while the buyer's choices differ from the Crown's.
 */
function forceChoiceFavor(input: {
  id: string;
  printed: CrownFavorDefinition["printed"];
  steps: string[];
  when?: (state: GameState) => boolean;
  choices: (decision: PendingDecision) => LegalCommand[];
}): CrownFavorDefinition {
  const choicesFor = (state: GameState) => input.choices({ ...state.pendingDecision, legalCommands: state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands });
  return {
    id: input.id,
    printed: input.printed,
    available: (state) => {
      if (!crownDecidingStep(state, input.steps) || !(input.when?.(state) ?? true)) return false;
      if (crownEffects(state, input.id).some((effect) => effect.decisionId === state.pendingDecision.id)) return false;
      const choices = choicesFor(state);
      const current = state.pendingDecision.legalCommands;
      return choices.length > 0 && !(choices.length === current.length && choices.every((choice) => current.some((own) => sameCommand(own, choice))));
    },
    apply: (state, playerId) =>
      addCrownEffect(state, {
        favorId: input.id,
        by: playerId,
        turn: state.turn,
        phase: state.phase,
        decisionId: state.pendingDecision.id,
        choices: choicesFor(state),
      }),
  };
}

const debtConsentFirst = forceChoiceFavor({
  id: "chairman.consent.first",
  printed: { page: 4, text: "Consent from Crown shares for the first additional" },
  steps: ["companyOperation.debtConsent"],
  when: (state) => chairmanProgress(state).debtAdvances === 3,
  choices: consentCommands,
});

const debtConsentFurther = forceChoiceFavor({
  id: "chairman.consent.further",
  printed: { page: 4, text: "Consent from a Crown share for any additional" },
  steps: ["companyOperation.debtConsent"],
  when: (state) => chairmanProgress(state).debtAdvances > 3,
  choices: consentCommands,
});

const debtMore = effectFavor({
  id: "chairman.debtMore",
  printed: { page: 5, text: "Request an additional Company Debt" },
  available: (state) => seekingDebt(state),
});

const debtLess = effectFavor({
  id: "chairman.debtLess",
  printed: { page: 5, text: "Request one less Company Debt" },
  available: (state) => seekingDebt(state) && chairmanProgress(state).debtAdvances < debtAdvancesWanted(state),
});

/** "At any point before each step, request that £3 (or less) be allocated to a specific office." */
const requestAllocation: CrownFavorDefinition = {
  id: "chairman.requestAllocation",
  printed: { page: 5, text: "At any point before each step" },
  available: (state) => crownChairmanDeciding(state) && state.company.balance > 0,
  options: (state) => {
    const all = state.pendingDecision.crown?.all ?? state.pendingDecision.legalCommands;
    const offices = [
      ...new Set(
        all
          .map((command) => payloadOf<ChairmanPayload>(command))
          .flatMap((payload) => (payload.action === "allocate" ? [payload.officeId] : [])),
      ),
    ];
    return offices.map((officeId) => ({ label: officeLabel(officeId), option: officeId }));
  },
  apply: (state, _playerId, option) => {
    const officeId = option as OfficeId;
    const office = state.company.offices[officeId];
    const amount = Math.min(3, state.company.balance);
    if (!office || amount <= 0) throw new Error("There is nothing to allocate.");
    return {
      ...state,
      company: {
        ...state.company,
        balance: state.company.balance - amount,
        offices: { ...state.company.offices, [officeId]: { ...office, treasury: office.treasury + amount } },
      },
    };
  },
};

// --- Director of Trade (p.6) ---

function crownDirectorDeciding(state: GameState, stage: "envoy" | "envoyEffect" | "transfers"): boolean {
  return crownDecidingStep(state, [`${DIRECTOR}.${stage}`]);
}

const forceSpending: CrownFavorDefinition = {
  id: "director.spend",
  printed: { page: 6, text: "Force the Crown to spend more or less money" },
  available: (state) => crownDirectorDeciding(state, "envoy"),
  options: (state) => {
    const at = directorProgress(state).envoys ?? 0;
    const treasury = state.company.offices[directorOffice(state)]?.treasury ?? 0;
    const options: Array<{ label: string; option: EnvoyForce }> = [{ label: "spend nothing, no more Special Envoys", option: { spend: 0, stop: true, at } }];
    for (let spend = 1; spend <= treasury; spend += 1) {
      options.push({ label: `spend £${spend}`, option: { spend, stop: false, at } });
      options.push({ label: `spend £${spend}, then no more Special Envoys`, option: { spend, stop: true, at } });
    }
    return options;
  },
  apply: (state, playerId, option) =>
    addCrownEffect(state, {
      favorId: "director.spend",
      by: playerId,
      turn: state.turn,
      phase: state.phase,
      decisionId: state.pendingDecision.id,
      option,
    }),
};

const targetOrder = chooseForCrownFavor({
  id: "director.targetOrder",
  printed: { page: 6, text: "Target a specific order." },
  steps: [`${DIRECTOR}.envoyEffect`],
  choices: (_state, decision) => decision.legalCommands.filter((command) => payloadOf<DirectorPayload>(command).action === "openOrder"),
});

const openChina = forceChoiceFavor({
  id: "director.openChina",
  printed: { page: 6, text: "Open trade with China." },
  steps: [`${DIRECTOR}.envoyEffect`],
  choices: (decision) => decision.legalCommands.filter((command) => payloadOf<DirectorPayload>(command).action === "openChina"),
});

function transfersLeft(state: GameState, preventFavor: string, made: number): boolean {
  return made + crownEffects(state, preventFavor).length < 2;
}

const preventDirectorTransfer = effectFavor({
  id: "director.preventTransfer",
  printed: { page: 6, text: "Prevent a transfer" },
  available: (state) => crownDirectorDeciding(state, "transfers") && transfersLeft(state, "director.preventTransfer", directorProgress(state).transfersMade),
});

const chooseDirectorTransfer = chooseForCrownFavor({
  id: "director.chooseTransfer",
  printed: { page: 6, text: "Transfer 1 writer/ship to a Presidency/sea zone" },
  steps: [`${DIRECTOR}.transfers`],
  when: (state) => transfersLeft(state, "director.preventTransfer", directorProgress(state).transfersMade),
  // "Players may not undo a previous transfer."
  choices: (state, decision) => {
    const moves = directorProgress(state).moves ?? [];
    return decision.legalCommands.filter((command) => {
      const payload = payloadOf<DirectorPayload>(command);
      return (payload.action === "moveWriter" || payload.action === "moveShip") && !undoesDirectorMove(payload, moves);
    });
  },
});

// --- Governor General (p.7) ---

const governDice = effectFavor({
  id: "governorGeneral.dice",
  printed: { page: 7, text: "Increase or decrease the required number of dice" },
  available: (state) => crownDecidingStep(state, ["companyOperation.governorGeneral.govern"]),
  options: () => [
    { label: "one more die", option: 1 },
    { label: "one fewer die", option: -1 },
  ],
});

const governResult = chooseForCrownFavor({
  id: "governorGeneral.result",
  printed: { page: 7, text: "Choose a different result" },
  steps: ["companyOperation.governorGeneral.choices"],
  // Not the result the Crown's climate picks.
  choices: (state, decision) => {
    const own = GOVERN_RESULT[state.crown!.climate];
    return decision.legalCommands.filter((command) => payloadOf<GovernorGeneralPayload>(command).action !== own);
  },
});

// --- Manager of Shipping (p.8) ---

function crownShippingDeciding(state: GameState): boolean {
  return crownDecidingStep(state, [SHIPPING]);
}

const fitSpecificShip = chooseForCrownFavor({
  id: "shipping.fitSpecific",
  printed: { page: 8, text: "Fit a specific ship." },
  steps: [SHIPPING],
  choices: (state, decision) => {
    const fits = decision.legalCommands.filter((command) => payloadOf<ShippingPayload>(command).action === "fit");
    const place = placementDestination(state, shipDestinationsOf(decision.legalCommands));
    return fits.filter((command) => !place || (payloadOf<ShippingPayload>(command) as { to: string }).to === place.to);
  },
});

function shipDestinationsOf(commands: LegalCommand[]): string[] {
  return [...new Set(commands.map((command) => (payloadOf<ShippingPayload>(command) as { to?: string }).to).filter((to): to is string => Boolean(to)))];
}

/** "The Crown fits one ship into sea zone (or China) of your choice": the ship it would take next, anywhere. */
const placeShipWhereYouLike = chooseForCrownFavor({
  id: "shipping.placeAnywhere",
  printed: { page: 8, text: "The Crown fits one ship into sea zone" },
  steps: [SHIPPING],
  choices: (state, decision) => {
    const next = shippingNext(state, decision);
    if (!next) return [];
    const chosen = payloadOf<ShippingPayload>(next.command);
    if (chosen.action === "finish") return [];
    return decision.legalCommands.filter((command) => {
      const payload = payloadOf<ShippingPayload>(command);
      if (payload.action !== chosen.action) return false;
      return chosen.action !== "fit" || payload.action !== "fit" || payload.shipId === chosen.shipId;
    });
  },
});

const buysShip = effectFavor({
  id: "shipping.buyOne",
  printed: { page: 8, text: "Buys a Company ship." },
  available: (state) => crownShippingDeciding(state),
});
const buysNoShip = effectFavor({
  id: "shipping.buyNone",
  printed: { page: 8, text: "Does not buy a Company ship." },
  available: (state) => crownShippingDeciding(state),
});
const buysAnyShips = effectFavor({
  id: "shipping.buyMany",
  printed: { page: 8, text: "Buys as many Company ships as you wish." },
  available: (state) => crownShippingDeciding(state),
  options: (state) => {
    const treasury = state.company.offices["manager-of-shipping"]?.treasury ?? 0;
    const most = Math.min(Math.floor(treasury / 5), companyShipPiecesInSupply(state));
    return Array.from({ length: most + 1 }, (_, count) => ({ label: `${count} ship${count === 1 ? "" : "s"}`, option: count }));
  },
});
const buysAnotherShip = effectFavor({
  id: "shipping.buyAnother",
  printed: { page: 8, text: "The Crown buys another Company ship." },
  available: (state) => crownShippingDeciding(state),
});
const leavesTwoSpare = effectFavor({
  id: "shipping.leaveTwo",
  printed: { page: 8, text: "The Crown must leave" },
  available: (state) => crownShippingDeciding(state),
});

// --- Military Affairs (p.9) ---

function crownMilitaryDeciding(state: GameState, stage: "transfers" | "assign"): boolean {
  return crownDecidingStep(state, [`${MILITARY}.${stage}`]);
}

const chooseArmyTransfer = chooseForCrownFavor({
  id: "military.chooseTransfer",
  printed: { page: 9, text: "Transfer 1 officer or regiment" },
  steps: [`${MILITARY}.transfers`],
  when: (state) => transfersLeft(state, "military.preventTransfer", militaryProgress(state).transfersMade),
  choices: (state, decision) => {
    const moves = militaryProgress(state).moves ?? [];
    return decision.legalCommands.filter((command) => {
      const payload = payloadOf<MilitaryPayload>(command);
      return (payload.action === "moveOfficer" || payload.action === "moveRegiment") && !undoesArmyMove(payload, moves);
    });
  },
});

const preventArmyTransfer = effectFavor({
  id: "military.preventTransfer",
  printed: { page: 9, text: "Prevent any transfer" },
  available: (state) => crownMilitaryDeciding(state, "transfers") && transfersLeft(state, "military.preventTransfer", militaryProgress(state).transfersMade),
});

/** "Assign 1 officer to a Presidency of your choice": the officer the Crown would assign next, any Army. */
const assignOfficerWhere = chooseForCrownFavor({
  id: "military.assignOfficer",
  printed: { page: 9, text: "Assign 1 officer to a Presidency" },
  steps: [`${MILITARY}.assign`],
  choices: (state, decision) => {
    const next = nextOfficerToAssign(state, decision);
    if (!next) return [];
    return decision.legalCommands.filter((command) => (payloadOf<MilitaryPayload>(command) as { playerId: PlayerId }).playerId === next.owner);
  },
});

export const officesFavors: CrownFavorDefinition[] = [
  debtConsentFirst,
  debtConsentFurther,
  debtMore,
  debtLess,
  requestAllocation,
  forceSpending,
  targetOrder,
  openChina,
  preventDirectorTransfer,
  chooseDirectorTransfer,
  governDice,
  governResult,
  fitSpecificShip,
  placeShipWhereYouLike,
  buysShip,
  buysNoShip,
  buysAnyShips,
  buysAnotherShip,
  leavesTwoSpare,
  chooseArmyTransfer,
  preventArmyTransfer,
  assignOfficerWhere,
];

// =============================================================================================
// Favours earned or owed by what a human officeholder does
// =============================================================================================

/** A human holder of `officeId` made this command (`type`). */
function byHolder(before: GameState, command: GameCommand, type: string, officeId: OfficeId): boolean {
  return command.type === type && command.actorId !== CROWN && holds(before, officeId, command.actorId);
}

function gain(state: GameState, source: { page: number; text: string }): number {
  const cost = printedCost(state, source);
  return typeof cost === "number" && cost > 0 ? cost : 0;
}

const MANDATORY_CHAIRMAN = { page: 4, text: "You must always perform this favor if able." };

/** "If You Are Chairman: -1 [mandatory]": a human Chairman pays 1 cube for the turn they act (read at the end of their turn). */
const chairmanMandatory: CrownCubeDetector = {
  favorId: "chairman.mandatory",
  printed: MANDATORY_CHAIRMAN,
  detect: (before, _after, command) => {
    if (!byHolder(before, command, "companyOperation.chairman", "chairman")) return [];
    if ((command.payload as ChairmanPayload).action !== "finish") return [];
    return [{ playerId: command.actorId, cubes: -1, partial: true, reason: "the Chairman's mandatory favour" }];
  },
};

function allocateToCrown(amount: number, source: { page: number; text: string }, id: string): CrownCubeDetector {
  return {
    favorId: id,
    printed: source,
    detect: (before, _after, command) => {
      if (!byHolder(before, command, "companyOperation.chairman", "chairman")) return [];
      const payload = command.payload as ChairmanPayload;
      if (payload.action !== "allocate" || payload.amount !== amount || !crownHolds(before, payload.officeId)) return [];
      const cubes = gain(before, source);
      return cubes > 0 ? [{ playerId: command.actorId, cubes, reason: `allocating £${amount} to the Crown's ${officeLabel(payload.officeId)}` }] : [];
    },
  };
}

const openCrownHomeOrder: CrownCubeDetector = {
  favorId: "director.openCrownOrder",
  printed: { page: 6, text: "Open an order in the home region" },
  detect: (before, _after, command) => {
    if (!byHolder(before, command, DIRECTOR, "director-of-trade")) return [];
    const payload = command.payload as DirectorPayload;
    if (payload.action !== "openOrder") return [];
    const region = Object.values(before.india.regions).find((candidate) => candidate.orders.some((order) => order.id === payload.orderId));
    const home = region?.homePresidency;
    if (!home || !isCrownPresidency(before, home) || crownWriters(before, home) < 1) return [];
    const cubes = gain(before, { page: 6, text: "Open an order in the home region" });
    return cubes > 0 ? [{ playerId: command.actorId, cubes, reason: `opening an order in the home region of the Crown's ${home}` }] : [];
  },
};

function spread(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

const balancedPresidencies: CrownCubeDetector = {
  favorId: "director.balanced",
  printed: { page: 6, text: "After the office has acted" },
  detect: (before, after, command) => {
    if (!byHolder(before, command, DIRECTOR, "director-of-trade")) return [];
    if ((command.payload as DirectorPayload).action !== "finish") return [];
    // Read: no Presidency has 2 or more ships than another, nor 2 or more writers than another.
    if (spread(PRESIDENCY_IDS.map((presidency) => ships(after, presidency))) >= 2) return [];
    if (spread(PRESIDENCY_IDS.map((presidency) => allWriters(after, presidency))) >= 2) return [];
    const cubes = gain(before, { page: 6, text: "After the office has acted" });
    return cubes > 0 ? [{ playerId: command.actorId, cubes, reason: "leaving no Presidency 2 ships or writers ahead of another" }] : [];
  },
};

const governorGeneralMoney: CrownCubeDetector = {
  favorId: "governorGeneral.crownMoney",
  printed: { page: 7, text: "Add money to a Crown office's treasury." },
  detect: (before, _after, command) => {
    if (!byHolder(before, command, "companyOperation.governorGeneral", "governor-general")) return [];
    const payload = command.payload as GovernorGeneralPayload;
    if (payload.action !== "tax" || payload.to === "balance" || !crownHolds(before, payload.to)) return [];
    return [{ playerId: command.actorId, cubes: gain(before, { page: 7, text: "Add money to a Crown office's treasury." }), reason: "adding money to a Crown office's treasury" }];
  },
};

const governorGeneralRegiment: CrownCubeDetector = {
  favorId: "governorGeneral.crownRegiment",
  printed: { page: 7, text: "Place a regiment into an Army" },
  detect: (before, _after, command) => {
    if (!byHolder(before, command, "companyOperation.governorGeneral", "governor-general")) return [];
    const payload = command.payload as GovernorGeneralPayload;
    if (payload.action !== "regiment" || !isCrownPresidency(before, payload.army)) return [];
    return [{ playerId: command.actorId, cubes: gain(before, { page: 7, text: "Place a regiment into an Army" }), reason: `placing a regiment in the Army of the Crown's ${payload.army}` }];
  },
};

const governorGeneralShip: CrownCubeDetector = {
  favorId: "governorGeneral.crownShip",
  printed: { page: 7, text: "Place a Company ship into a sea zone" },
  detect: (before, _after, command) => {
    if (!byHolder(before, command, "companyOperation.governorGeneral", "governor-general")) return [];
    const payload = command.payload as GovernorGeneralPayload;
    const presidency = payload.action === "ship" ? presidencyOfZone(payload.to) : undefined;
    if (!presidency || !isCrownPresidency(before, presidency)) return [];
    return [{ playerId: command.actorId, cubes: gain(before, { page: 7, text: "Place a Company ship into a sea zone" }), reason: `placing a Company ship in the sea zone of the Crown's ${presidency}` }];
  },
};

const shippingFitCrownShip: CrownCubeDetector = {
  favorId: "shipping.fitCrownShip",
  printed: { page: 8, text: "Fit a Crown ship." },
  detect: (before, _after, command) => {
    if (!byHolder(before, command, SHIPPING, "manager-of-shipping")) return [];
    const payload = command.payload as ShippingPayload;
    if (payload.action !== "fit") return [];
    const ship = before.company.ships.find((candidate) => candidate.id === payload.shipId);
    const owner = ship?.shipyardCardId
      ? Object.values(before.players).find((player) => player.enterprises.some((enterprise) => enterprise.type === "shipyard" && enterprise.cardId === ship.shipyardCardId))
      : undefined;
    return owner?.isCrown ? [{ playerId: command.actorId, cubes: gain(before, { page: 8, text: "Fit a Crown ship." }), reason: "fitting a Crown ship" }] : [];
  },
};

const shippingPlaceCrown: CrownCubeDetector = {
  favorId: "shipping.placeInCrown",
  printed: { page: 8, text: "Place a ship in a Crown Presidency" },
  detect: (before, _after, command) => {
    if (!byHolder(before, command, SHIPPING, "manager-of-shipping")) return [];
    const payload = command.payload as ShippingPayload;
    if (payload.action === "finish") return [];
    const presidency = presidencyOfZone(payload.to);
    const crownZone = presidency ? isCrownPresidency(before, presidency) : payload.to === "china" && crownHolds(before, "superintendent-of-trade-in-china");
    return crownZone
      ? [{ playerId: command.actorId, cubes: gain(before, { page: 8, text: "Place a ship in a Crown Presidency" }), reason: "placing a ship in a Crown Presidency or the Crown's China" }]
      : [];
  },
};

/** "Assign the Crown as Commander of an Army when able. This always applies": each Army the Crown newly commands. */
const militaryAssignCrown: CrownCubeDetector = {
  favorId: "military.assignCrownCommander",
  printed: { page: 9, text: "Assign the Crown as Commander of an Army when able." },
  detect: (before, after, command) => {
    if (!byHolder(before, command, MILITARY, "military-affairs")) return [];
    const armies = PRESIDENCY_IDS.filter(
      (army) => after.company.armies[army].commander === CROWN && before.company.armies[army].commander !== CROWN,
    );
    return armies.map((army) => ({ playerId: command.actorId, cubes: 1, reason: `making the Crown Commander of the Army of ${army}` }));
  },
};

export const officesDetectors: CrownCubeDetector[] = [
  chairmanMandatory,
  allocateToCrown(3, { page: 4, text: "Allocate £3 to a Crown office." }, "chairman.allocate3"),
  allocateToCrown(4, { page: 4, text: "Allocate £4 to a Crown office." }, "chairman.allocate4"),
  allocateToCrown(5, { page: 4, text: "Allocate £5 to a Crown office." }, "chairman.allocate5"),
  openCrownHomeOrder,
  balancedPresidencies,
  governorGeneralMoney,
  governorGeneralRegiment,
  governorGeneralShip,
  shippingFitCrownShip,
  shippingPlaceCrown,
  militaryAssignCrown,
];
