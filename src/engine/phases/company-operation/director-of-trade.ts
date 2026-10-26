import { beginImmediateHire } from "../hiring";
import { rollCheck } from "../../checks";
import { PRESIDENCY_IDS, familyAdjective, officeHolder } from "../../selectors";
import type { GameState, LegalCommand, PendingDecision, PlayerId, PresidencyId, ShipState } from "../../types";
import { isCrownGame } from "../../crown/state";
import type { OfficeMove, OfficeProgress, ShipDestination } from "../company-operation.state";
import {
  CHINA_OFFICE_ID,
  SEA_ZONE_LABEL,
  changeOfficeTreasury,
  chinaOpen,
  coState,
  decisionId,
  playerName,
  shipDestinations,
  vacateAfterCatastrophe,
  withCo,
} from "./context";
import { finishOffice, type OperationStep } from "./step";

// Director of Trade (p.18): Special Envoy any number of times (£1 per die, no penalty; success opens
// trade with China or one closed order in a region the Company does not control), then up to two
// transfers, each moving one writer or ship between Presidencies or sea zones (China counts once open).

const OFFICE_ID = "director-of-trade";
const MAX_TRANSFERS = 2;

type DirectorProgress = Extract<OfficeProgress, { office: "director-of-trade" }>;

export type DirectorPayload =
  | { action: "envoy"; spend: number }
  | { action: "stopEnvoys" }
  | { action: "openChina" }
  | { action: "openOrder"; orderId: string }
  | { action: "moveWriter"; playerId: PlayerId; from: PresidencyId; to: PresidencyId }
  | { action: "moveShip"; shipId: string; to: ShipDestination }
  | { action: "finish" };

function progress(state: GameState): DirectorProgress {
  const current = coState(state).current;
  return current?.office === OFFICE_ID ? current : { office: OFFICE_ID, stage: "envoy", transfersMade: 0 };
}

/** Closed orders a Special Envoy may open: any region the Company does not control. */
function envoyOrderTargets(state: GameState): string[] {
  return Object.values(state.india.regions)
    .filter((region) => !region.companyControlled)
    .flatMap((region) => region.orders.filter((order) => order.closed).map((order) => order.id));
}

/** Presidencies whose home port is closed: their Presidents can't Trade until it reopens (p.20). */
function closedHomePorts(state: GameState): PresidencyId[] {
  return PRESIDENCY_IDS.filter((presidency) =>
    Object.values(state.india.regions).some((region) => region.orders.some((order) => order.isHomePortFor === presidency && order.closed)),
  );
}

function orderLabel(state: GameState, orderId: string): string {
  for (const region of Object.values(state.india.regions)) {
    const order = region.orders.find((candidate) => candidate.id === orderId);
    if (!order) continue;
    return order.isHomePortFor
      ? `Reopen ${order.isHomePortFor}'s home port (the £${order.value} order in ${region.name}): its President can Trade again`
      : `Open the £${order.value} order in ${region.name}`;
  }
  return `Open order ${orderId}`;
}

function envoyHasEffect(state: GameState): boolean {
  return !chinaOpen(state) || envoyOrderTargets(state).length > 0;
}

export function directorDecision(state: GameState): PendingDecision {
  const current = progress(state);
  const treasury = state.company.offices[OFFICE_ID]?.treasury ?? 0;
  const commands: LegalCommand[] = [];
  let prompt: string;

  if (current.stage === "envoy") {
    const closed = closedHomePorts(state);
    const closedNote = closed.length > 0 ? ` Closed home ports: ${closed.join(", ")}.` : "";
    prompt = `Director of Trade: send a Special Envoy (£1 per die, treasury £${treasury}) or move on to transfers.${closedNote}`;
    commands.push({
      type: "companyOperation.directorOfTrade",
      label: "Stop sending envoys",
      description:
        closed.length > 0 && treasury > 0
          ? `Warning: the home port of ${closed.join(" and ")} is still closed, so ${closed.length === 1 ? "that President" : "those Presidents"} can't Trade this turn.`
          : undefined,
      payload: { action: "stopEnvoys" } satisfies DirectorPayload,
    });
    if (envoyHasEffect(state)) {
      for (let spend = 1; spend <= treasury; spend += 1) {
        commands.push({
          type: "companyOperation.directorOfTrade",
          label: `Special Envoy with ${spend} ${spend === 1 ? "die" : "dice"} (£${spend})`,
          payload: { action: "envoy", spend } satisfies DirectorPayload,
        });
      }
    }
  } else if (current.stage === "envoyEffect") {
    prompt = "The Special Envoy succeeded. Open one closed order, or open trade with China.";
    // Home ports first: without one, a Presidency can't Trade at all.
    const targets = envoyOrderTargets(state);
    const homePorts = new Set(
      Object.values(state.india.regions).flatMap((region) => region.orders.filter((order) => order.isHomePortFor).map((order) => order.id)),
    );
    for (const orderId of [...targets.filter((id) => homePorts.has(id)), ...targets.filter((id) => !homePorts.has(id))]) {
      commands.push({
        type: "companyOperation.directorOfTrade",
        label: orderLabel(state, orderId),
        payload: { action: "openOrder", orderId } satisfies DirectorPayload,
      });
    }
    if (!chinaOpen(state)) {
      commands.push({
        type: "companyOperation.directorOfTrade",
        label: "Open trade with China",
        description: "Creates the Superintendent of Trade in China office (p.25).",
        payload: { action: "openChina" } satisfies DirectorPayload,
      });
    }
  } else {
    prompt = `Director of Trade: make up to ${MAX_TRANSFERS - current.transfersMade} more transfer(s), or finish.`;
    commands.push({
      type: "companyOperation.directorOfTrade",
      label: "Finish as Director of Trade",
      payload: { action: "finish" } satisfies DirectorPayload,
    });
    if (current.transfersMade < MAX_TRANSFERS) commands.push(...transferCommands(state));
  }

  return {
    id: decisionId(state, "company-operation-director-of-trade"),
    phase: "companyOperation",
    step: `companyOperation.directorOfTrade.${current.stage}`,
    actor: officeHolder(state, OFFICE_ID) ?? "system",
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

function transferCommands(state: GameState): LegalCommand[] {
  const commands: LegalCommand[] = [];
  for (const from of PRESIDENCY_IDS) {
    for (const [playerId, count] of Object.entries(state.india.presidencies[from].writers)) {
      if (count <= 0) continue;
      for (const to of PRESIDENCY_IDS.filter((presidency) => presidency !== from)) {
        commands.push({
          type: "companyOperation.directorOfTrade",
          label: `Move a ${familyAdjective(state, playerId)} writer from ${from} to ${to}`,
          payload: { action: "moveWriter", playerId, from, to } satisfies DirectorPayload,
        });
      }
    }
  }

  const destinations = shipDestinations(state);
  for (const ship of movableShips(state)) {
    for (const to of destinations.filter((destination) => destination !== ship.location)) {
      commands.push({
        type: "companyOperation.directorOfTrade",
        label: `Move ${shipLabel(state, ship)} from ${SEA_ZONE_LABEL[ship.location as ShipDestination]} to ${SEA_ZONE_LABEL[to]}`,
        payload: { action: "moveShip", shipId: ship.id, to } satisfies DirectorPayload,
      });
    }
  }
  return commands;
}

/** Ships at sea, with identical Company/extra ships in one place collapsed to a single choice. */
export function movableShips(state: GameState): ShipState[] {
  const destinations = new Set<string>(shipDestinations(state));
  const seen = new Set<string>();
  return state.company.ships.filter((ship) => {
    if (!destinations.has(ship.location)) return false;
    if (ship.kind === "player") return true;
    const key = `${ship.kind}|${ship.location}|${ship.fatigued}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function shipLabel(state: GameState, ship: ShipState): string {
  if (ship.kind === "player") return `the ${ship.shipyardCardId ?? "player"} ship`;
  return ship.kind === "company" ? "a Company ship" : "an extra ship";
}

export const directorStep: OperationStep = (state, command) => {
  const payload = command.payload as DirectorPayload;
  const current = progress(state);

  switch (payload.action) {
    case "envoy": {
      // Crown games count the envoys, so a favour can change "the next one" (Handbook p.6).
      const counted = isCrownGame(state) ? { ...current, envoys: (current.envoys ?? 0) + 1 } : current;
      const paid = changeOfficeTreasury(state, OFFICE_ID, -payload.spend);
      const check = rollCheck(paid.rng, payload.spend, "companyOperation.specialEnvoy");
      const rolled: GameState = { ...paid, rng: check.rng };
      const details = { spend: payload.spend, values: check.values, outcome: check.outcome };
      const rngRolls = check.roll ? [check.roll] : undefined;

      if (check.outcome === "success") {
        return {
          state: withCo(rolled, { current: { ...counted, stage: "envoyEffect" } }),
          summary: `Special Envoy succeeded on ${payload.spend} ${payload.spend === 1 ? "die" : "dice"} [${check.values.join(", ")}].`,
          details,
          rngRolls,
        };
      }
      if (check.outcome === "catastrophe") {
        const holder = officeHolder(state, OFFICE_ID);
        return {
          state: finishOffice(vacateAfterCatastrophe(rolled, OFFICE_ID), OFFICE_ID),
          summary: `Special Envoy was a catastrophic failure [${check.values.join(", ")}]; ${playerName(state, holder)}'s Director of Trade returns to supply.`,
          details,
          rngRolls,
        };
      }
      return {
        state: withCo(rolled, { current: counted }),
        summary: `Special Envoy failed [${check.values.join(", ")}].`,
        details,
        rngRolls,
      };
    }
    case "stopEnvoys":
      return {
        state: withCo(state, { current: { ...current, stage: "transfers" } }),
        summary: "The Director of Trade stopped sending envoys.",
      };
    case "openChina":
      // The new office "should be hired immediately" by the Chairman from any writer (p.18, p.25).
      return {
        state: beginImmediateHire(withCo(state, { current: { ...current, stage: "envoy" } }), CHINA_OFFICE_ID, CHINA_HIRE_RESUME),
        summary: "The Special Envoy opened trade with China: the Superintendent of Trade in China office is created.",
      };
    case "openOrder":
      return {
        state: withCo(openOrder(state, payload.orderId), { current: { ...current, stage: "envoy" } }),
        summary: `The Special Envoy opened order ${payload.orderId}.`,
      };
    case "moveWriter":
      return {
        state: withCo(moveWriter(state, payload.playerId, payload.from, payload.to), {
          current: {
            ...current,
            transfersMade: current.transfersMade + 1,
            ...recordMove(state, current, { kind: "writer", playerId: payload.playerId, from: payload.from, to: payload.to }),
          },
        }),
        summary: `The Director of Trade moved a ${familyAdjective(state, payload.playerId)} writer from ${payload.from} to ${payload.to}.`,
      };
    case "moveShip": {
      const ship = state.company.ships.find((candidate) => candidate.id === payload.shipId)!;
      return {
        state: withCo(moveShip(state, payload.shipId, payload.to), {
          current: {
            ...current,
            transfersMade: current.transfersMade + 1,
            ...recordMove(state, current, { kind: "ship", shipId: payload.shipId, from: ship.location, to: payload.to }),
          },
        }),
        summary: `The Director of Trade moved ${shipLabel(state, ship)} to ${SEA_ZONE_LABEL[payload.to]}.`,
      };
    }
    case "finish":
      return { state: finishOffice(state, OFFICE_ID), summary: "The Director of Trade finished." };
  }
};

/** Crown games remember each transfer, so nobody (Crown or favour) undoes one (Handbook pp.6, 9). */
function recordMove(state: GameState, current: DirectorProgress, move: OfficeMove): { moves?: OfficeMove[] } {
  return isCrownGame(state) ? { moves: [...(current.moves ?? []), move] } : {};
}

export const CHINA_HIRE_RESUME = "companyOperation.chinaHire";

export function writerCandidates(state: GameState): Array<{ playerId: PlayerId; presidency: PresidencyId }> {
  return PRESIDENCY_IDS.flatMap((presidency) =>
    Object.entries(state.india.presidencies[presidency].writers)
      .filter(([, count]) => count > 0)
      .map(([playerId]) => ({ playerId, presidency })),
  );
}

export function openOrder(state: GameState, orderId: string): GameState {
  return {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([regionId, region]) => [
          regionId,
          region.orders.some((order) => order.id === orderId)
            ? { ...region, orders: region.orders.map((order) => (order.id === orderId ? { ...order, closed: false } : order)) }
            : region,
        ]),
      ),
    },
  };
}

export function moveWriter(state: GameState, playerId: PlayerId, from: PresidencyId, to: PresidencyId): GameState {
  const fromBox = state.india.presidencies[from];
  const toBox = state.india.presidencies[to];
  return {
    ...state,
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        [from]: { ...fromBox, writers: { ...fromBox.writers, [playerId]: (fromBox.writers[playerId] ?? 0) - 1 } },
        [to]: { ...toBox, writers: { ...toBox.writers, [playerId]: (toBox.writers[playerId] ?? 0) + 1 } },
      },
    },
  };
}

export function moveShip(state: GameState, shipId: string, to: ShipDestination): GameState {
  return {
    ...state,
    company: {
      ...state.company,
      ships: state.company.ships.map((ship) => (ship.id === shipId ? { ...ship, location: to } : ship)),
    },
  };
}
