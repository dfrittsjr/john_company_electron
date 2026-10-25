import { officeHolder, shipyardOwner } from "../../selectors";
import type { GameState, LegalCommand, PendingDecision } from "../../types";
import type { ShipDestination } from "../company-operation.state";
import {
  SEA_ZONE_LABEL,
  addCompanyShip,
  changeOfficeTreasury,
  companyShipPiecesInSupply,
  decisionId,
  isLawInEffect,
  payPlayer,
  playerName,
  prestigeCardHolders,
  shipDestinations,
  withCo,
} from "./context";
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
  const commands = done || treasury > 2 ? purchases : [...purchases, finish];

  return {
    id: decisionId(state, "company-operation-shipping"),
    phase: "companyOperation",
    step: "companyOperation.shipping",
    actor: officeHolder(state, OFFICE_ID) ?? "system",
    visibility: "public",
    prompt: done
      ? `Manager of Shipping: nothing more to spend (treasury £${treasury}).`
      : treasury > 2
        ? `Manager of Shipping: spend until £2 or less remains (treasury £${treasury}).`
        : `Manager of Shipping: you may spend more or finish (treasury £${treasury}).`,
    legalCommands: done ? [finish] : commands,
    canSave: true,
  };
}

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
  } else {
    const cost = payload.action === "lease" ? LEASE_COST : COMPANY_SHIP_COST;
    next = addCompanyShip(changeOfficeTreasury(state, OFFICE_ID, -cost), payload.to, payload.action === "lease" ? "extra" : "company");
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
