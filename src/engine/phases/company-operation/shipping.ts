import { CROWN_PLAYER_ID, appendCrownLog, crownEffects, exchangeCubes, isCrownGame } from "../../crown/state";
import { officeHolder, shipyardOwner } from "../../selectors";
import type { GameCommand, GameState, LegalCommand, PendingDecision } from "../../types";
import type { ShipDestination } from "../company-operation.state";
import {
  SEA_ZONE_LABEL,
  addCompanyShip,
  changeOfficeTreasury,
  companyShipPiecesInSupply,
  coState,
  decisionId,
  isLawInEffect,
  payPlayer,
  playerName,
  prestigeCardHolders,
  shipDestinations,
  withCo,
} from "./context";
import { registerDecisionRefresher } from "../negotiation";
import { finishOffice, type OperationStep } from "./step";

// Manager of Shipping (p.19): must spend until the treasury holds £2 or less.
// Lease an extra ship £2; fit a ship from a shipyard £3 (no owner consent; Ship Subsidy makes it £2);
// buy a Company ship £5 only when no ships are on shipyards. Ships go to any sea zone (China once open).
// Assumption: £2 is a minimum spend, not a stop. While the treasury is above £2 only purchases are offered;
// at £2 or less any still-affordable purchase is offered plus "Finish". The step ends by itself only when
// nothing is affordable.

const OFFICE_ID = "manager-of-shipping";
const LEASE_COST = 2;
const COMPANY_SHIP_COST = 5;

export type ShippingPayload =
  | { action: "lease"; to: ShipDestination }
  | { action: "fit"; shipId: string; to: ShipDestination }
  | { action: "buy"; to: ShipDestination }
  | { action: "finish" };

function fitCost(state: GameState): number {
  return isLawInEffect(state, "ship-subsidy") ? 2 : 3;
}

function shipsOnShipyards(state: GameState) {
  return state.company.ships.filter((ship) => ship.kind === "player" && ship.location === "shipyard");
}

function shippingCommands(state: GameState): LegalCommand[] {
  const treasury = state.company.offices[OFFICE_ID]?.treasury ?? 0;
  const commands: LegalCommand[] = [];
  const destinations = shipDestinations(state);
  const supply = companyShipPiecesInSupply(state);
  const onShipyards = shipsOnShipyards(state);

  if (treasury >= fitCost(state)) {
    for (const ship of onShipyards) {
      for (const to of destinations) {
        commands.push({
          type: "companyOperation.shipping",
          label: `Fit the ${ship.shipyardCardId} ship (${playerName(state, shipyardOwner(state, ship.shipyardCardId ?? ""))}) into ${SEA_ZONE_LABEL[to]} for £${fitCost(state)}`,
          payload: { action: "fit", shipId: ship.id, to } satisfies ShippingPayload,
        });
      }
    }
  }
  if (supply > 0 && treasury >= LEASE_COST) {
    for (const to of destinations) {
      commands.push({
        type: "companyOperation.shipping",
        label: `Lease an extra ship into ${SEA_ZONE_LABEL[to]} for £${LEASE_COST}`,
        payload: { action: "lease", to } satisfies ShippingPayload,
      });
    }
  }
  if (supply > 0 && treasury >= COMPANY_SHIP_COST && onShipyards.length === 0) {
    for (const to of destinations) {
      commands.push({
        type: "companyOperation.shipping",
        label: `Buy a Company ship into ${SEA_ZONE_LABEL[to]} for £${COMPANY_SHIP_COST}`,
        payload: { action: "buy", to } satisfies ShippingPayload,
      });
    }
  }
  return commands;
}

export function shippingDecision(state: GameState): PendingDecision {
  const treasury = state.company.offices[OFFICE_ID]?.treasury ?? 0;
  const purchases = shippingCommands(state);
  const done = purchases.length === 0;
  const finish: LegalCommand = {
    type: "companyOperation.shipping",
    label: "Finish as Manager of Shipping",
    payload: { action: "finish" } satisfies ShippingPayload,
  };
  // The favour "The Crown must leave £2 unspent" lets the Crown Manager stop with more than £2 (p.8).
  const leavesTwo =
    isCrownGame(state) &&
    officeHolder(state, OFFICE_ID) === CROWN_PLAYER_ID &&
    treasury >= 2 &&
    crownEffects(state, "shipping.leaveTwo").length > 0;
  const commands = done || (treasury > 2 && !leavesTwo) ? purchases : [...purchases, finish];

  return {
    id: decisionId(state, "company-operation-shipping"),
    phase: "companyOperation",
    step: "companyOperation.shipping",
    actor: officeHolder(state, OFFICE_ID) ?? "system",
    visibility: "public",
    prompt:
      (done
        ? `Manager of Shipping: nothing more to spend (treasury £${treasury}).`
        : treasury > 2
          ? `Manager of Shipping: spend until £2 or less remains (treasury £${treasury}).`
          : `Manager of Shipping: you may spend more or finish (treasury £${treasury}).`) + ` ${shipsAtSea(state)}`,
    legalCommands: done ? [finish] : commands,
    canSave: true,
  };
}

/** "Ships at sea: West Indian 1, South Indian 0 (none: Madras can't Trade), East Indian 2." */
function shipsAtSea(state: GameState): string {
  const zones = (["west-indian", "south-indian", "east-indian"] as const).map((zone) => {
    const count = state.company.ships.filter((ship) => ship.location === zone).length;
    return `${SEA_ZONE_LABEL[zone]} ${count}${count === 0 ? ` (none: ${ZONE_PRESIDENCY[zone]} can't Trade)` : ""}`;
  });
  const china = state.company.ships.filter((ship) => ship.location === "china").length;
  return `Ships at sea: ${zones.join(", ")}${china > 0 ? `, China ${china}` : ""}.`;
}

const ZONE_PRESIDENCY = { "west-indian": "Bombay", "south-indian": "Madras", "east-indian": "Bengal" } as const;

export const shippingStep: OperationStep = (state, command) => {
  const payload = command.payload as ShippingPayload;
  if (payload.action === "finish") {
    return { state: finishOffice(state, OFFICE_ID), summary: "The Manager of Shipping finished." };
  }

  let next: GameState;
  let summary: string;
  if (payload.action === "fit") {
    const ship = state.company.ships.find((candidate) => candidate.id === payload.shipId)!;
    next = changeOfficeTreasury(state, OFFICE_ID, -fitCost(state));
    next = {
      ...next,
      company: {
        ...next.company,
        ships: next.company.ships.map((candidate) =>
          candidate.id === payload.shipId ? { ...candidate, location: payload.to, fatigued: false } : candidate,
        ),
      },
    };
    summary = `The Manager of Shipping fitted the ${ship.shipyardCardId} ship into ${SEA_ZONE_LABEL[payload.to]} (£${fitCost(state)}).`;
    const charge = crownFitsPlayerShip(next, command, ship.shipyardCardId);
    if (charge) {
      next = charge.state;
      summary += ` ${charge.note}`;
    }
  } else {
    const cost = payload.action === "lease" ? LEASE_COST : COMPANY_SHIP_COST;
    next = addCompanyShip(changeOfficeTreasury(state, OFFICE_ID, -cost), payload.to, payload.action === "lease" ? "extra" : "company");
    if (payload.action === "buy" && isCrownGame(state)) next = withCo(next, { shippingBought: (coState(next).shippingBought ?? 0) + 1 });
    // Shipbuilders (prestige #21): £1 to its owner for each extra or Company ship acquired.
    for (const holder of prestigeCardHolders(next, "shipbuilders")) next = payPlayer(next, holder, 1);
    summary =
      payload.action === "lease"
        ? `The Manager of Shipping leased an extra ship into ${SEA_ZONE_LABEL[payload.to]} (£${cost}).`
        : `The Manager of Shipping bought a Company ship into ${SEA_ZONE_LABEL[payload.to]} (£${cost}).`;
  }

  next = withCo(next, {});
  // Ends by itself only when nothing is affordable; at £2 or less the player may still buy or finish.
  return shippingCommands(next).length === 0
    ? { state: finishOffice(next, OFFICE_ID), summary: `${summary} The Manager of Shipping is done.` }
    : { state: next, summary };
};

/**
 * Handbook p.8: "If the Crown fits one of your ships, you must always perform this favor if able":
 * the owner pays the Crown a promise cube, unless they already bought "Fit a specific ship" for it.
 */
function crownFitsPlayerShip(state: GameState, command: GameCommand, shipyardCardId: string | undefined): { state: GameState; note: string } | undefined {
  if (!isCrownGame(state) || command.actorId !== CROWN_PLAYER_ID || !shipyardCardId) return undefined;
  const owner = shipyardOwner(state, shipyardCardId);
  if (!owner || state.players[owner]?.isCrown) return undefined;
  if (crownEffects(state, "shipping.fitSpecific").some((effect) => effect.by === owner && effect.decisionId === state.pendingDecision.id)) {
    return undefined;
  }
  const paid = exchangeCubes(state, owner, -1, { partial: true });
  const name = playerName(state, owner);
  const note = paid.moved === 0 ? `${name} has no promise cube to pay for the Crown fitting their ship.` : `${name} paid 1 promise cube: the Crown fitted their ship.`;
  return { state: appendCrownLog(paid.state, { now: state.updatedAt, actor: owner, type: "crown.favor", summary: note, details: { favorId: "shipping.fitMandatory", cubes: paid.moved } }), note };
}

// A favour can end the Crown Manager's spending early (p.8).
registerDecisionRefresher("companyOperation.shipping", (state) => ({ ...shippingDecision(state), id: state.pendingDecision.id }));
