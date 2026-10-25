import { CROWN_PLAYER_ID, isCrownGame } from "../../crown/state";
import { PRESIDENCY_IDS, officeHolder } from "../../selectors";
import type { ArmyId, ArmyState, GameState, LegalCommand, PendingDecision, PlayerId } from "../../types";
import type { OfficeMove, OfficeProgress } from "../company-operation.state";
import { coState, decisionId, playerName, withCo } from "./context";
import { finishOffice, type OperationStep, type StepResult } from "./step";

// Military Affairs (p.19): up to two Army transfers (one officer or regiment each), then assign every
// officer-in-training to an Army, then appoint Commanders where a player has more total pieces in an
// Army than the Commander's player, or the slot is vacant. Moved and new pieces go to the top half.

const OFFICE_ID = "military-affairs";
const MAX_TRANSFERS = 2;

type MilitaryProgress = Extract<OfficeProgress, { office: "military-affairs" }>;

export type MilitaryPayload =
  | { action: "moveOfficer"; playerId: PlayerId; from: ArmyId; to: ArmyId }
  | { action: "moveRegiment"; from: ArmyId; to: ArmyId }
  | { action: "endTransfers" }
  | { action: "assignOfficer"; playerId: PlayerId; army: ArmyId }
  | { action: "appointCommander"; army: ArmyId; playerId: PlayerId };

function progress(state: GameState): MilitaryProgress {
  const current = coState(state).current;
  return current?.office === OFFICE_ID
    ? current
    : { office: OFFICE_ID, stage: "transfers", transfersMade: 0, armiesResolved: [] };
}

function officerCount(army: ArmyState, playerId: PlayerId): number {
  const stack = army.officers[playerId];
  return stack ? stack.ready + stack.exhausted : 0;
}

/** Total pieces per player in an Army: officers plus the Commander piece (p.19). */
export function armyPieceTotals(army: ArmyState): Map<PlayerId, number> {
  const totals = new Map<PlayerId, number>();
  for (const [playerId, stack] of Object.entries(army.officers)) {
    const count = stack.ready + stack.exhausted;
    if (count > 0) totals.set(playerId, count);
  }
  if (army.commander) totals.set(army.commander, (totals.get(army.commander) ?? 0) + 1);
  return totals;
}

/** Players Military Affairs may appoint, or [] when the current Commander stays. */
export function commanderCandidates(army: ArmyState): PlayerId[] {
  const totals = armyPieceTotals(army);
  const withOfficers = [...totals.keys()].filter((playerId) => officerCount(army, playerId) > 0);
  if (withOfficers.length === 0) return [];

  const best = Math.max(...withOfficers.map((playerId) => totals.get(playerId) ?? 0));
  if (army.commander) {
    const commanderTotal = totals.get(army.commander) ?? 0;
    if (!withOfficers.some((playerId) => playerId !== army.commander && (totals.get(playerId) ?? 0) > commanderTotal)) {
      return [];
    }
  }
  return withOfficers.filter((playerId) => (totals.get(playerId) ?? 0) === best);
}

/** Move one of the player's officers to the Commander slot; the old Commander becomes an officer. */
export function appointCommander(state: GameState, armyId: ArmyId, playerId: PlayerId): GameState {
  const army = state.company.armies[armyId];
  const officers = { ...army.officers };
  const stack = officers[playerId];
  officers[playerId] =
    stack.ready > 0 ? { ...stack, ready: stack.ready - 1 } : { ...stack, exhausted: stack.exhausted - 1 };
  if (army.commander) {
    const previous = officers[army.commander] ?? { ready: 0, exhausted: 0 };
    officers[army.commander] = { ...previous, ready: previous.ready + 1 };
  }

  return {
    ...state,
    company: {
      ...state.company,
      armies: { ...state.company.armies, [armyId]: { ...army, officers, commander: playerId } },
    },
  };
}

export function militaryDecision(state: GameState): PendingDecision {
  const current = progress(state);
  const commands: LegalCommand[] = [];
  let prompt: string;

  if (current.stage === "transfers") {
    prompt = `Military Affairs: make up to ${MAX_TRANSFERS - current.transfersMade} more Army transfer(s).`;
    commands.push({
      type: "companyOperation.militaryAffairs",
      label: "Done with transfers",
      payload: { action: "endTransfers" } satisfies MilitaryPayload,
    });
    for (const from of PRESIDENCY_IDS) {
      const army = state.company.armies[from];
      for (const to of PRESIDENCY_IDS.filter((candidate) => candidate !== from)) {
        for (const playerId of Object.keys(army.officers).filter((id) => officerCount(army, id) > 0)) {
          commands.push({
            type: "companyOperation.militaryAffairs",
            label: `Move a ${playerName(state, playerId)} officer from the Army of ${from} to ${to}`,
            payload: { action: "moveOfficer", playerId, from, to } satisfies MilitaryPayload,
          });
        }
        if (army.regiments.ready + army.regiments.exhausted > 0) {
          commands.push({
            type: "companyOperation.militaryAffairs",
            label: `Move a regiment from the Army of ${from} to ${to}`,
            payload: { action: "moveRegiment", from, to } satisfies MilitaryPayload,
          });
        }
      }
    }
  } else if (current.stage === "assign") {
    prompt = "Military Affairs: assign each officer-in-training to an Army.";
    for (const playerId of state.seatingOrder.filter((id) => state.players[id].familyMembers.officersInTraining > 0)) {
      for (const army of PRESIDENCY_IDS) {
        commands.push({
          type: "companyOperation.militaryAffairs",
          label: `Assign a ${playerName(state, playerId)} officer-in-training to the Army of ${army}`,
          payload: { action: "assignOfficer", playerId, army } satisfies MilitaryPayload,
        });
      }
    }
  } else {
    const army = PRESIDENCY_IDS.find((id) => !current.armiesResolved.includes(id))!;
    prompt = `Military Affairs: appoint the Commander of the Army of ${army} from the players tied for the most pieces there.`;
    const candidates = commanderCandidates(state.company.armies[army]);
    // Handbook p.9: a human Military Affairs "always" assigns the Crown as Commander when able.
    const crownFirst =
      isCrownGame(state) && officeHolder(state, OFFICE_ID) !== CROWN_PLAYER_ID && candidates.includes(CROWN_PLAYER_ID);
    for (const playerId of crownFirst ? [CROWN_PLAYER_ID] : candidates) {
      commands.push({
        type: "companyOperation.militaryAffairs",
        label: `Appoint a ${playerName(state, playerId)} officer as Commander of the Army of ${army}`,
        payload: { action: "appointCommander", army, playerId } satisfies MilitaryPayload,
      });
    }
  }

  return {
    id: decisionId(state, "company-operation-military-affairs"),
    phase: "companyOperation",
    step: `companyOperation.militaryAffairs.${current.stage}`,
    actor: officeHolder(state, OFFICE_ID) ?? "system",
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

export const militaryStep: OperationStep = (state, command) => {
  const payload = command.payload as MilitaryPayload;
  const current = progress(state);

  switch (payload.action) {
    case "moveOfficer": {
      const next = moveOfficer(state, payload.playerId, payload.from, payload.to);
      const made = current.transfersMade + 1;
      const moves = recordMove(state, current, { kind: "officer", playerId: payload.playerId, from: payload.from, to: payload.to });
      return advance(
        withCo(next, { current: { ...current, ...moves, transfersMade: made, stage: made >= MAX_TRANSFERS ? "assign" : "transfers" } }),
        `Military Affairs moved a ${playerName(state, payload.playerId)} officer from the Army of ${payload.from} to ${payload.to}.`,
      );
    }
    case "moveRegiment": {
      const next = moveRegiment(state, payload.from, payload.to);
      const made = current.transfersMade + 1;
      const moves = recordMove(state, current, { kind: "regiment", from: payload.from, to: payload.to });
      return advance(
        withCo(next, { current: { ...current, ...moves, transfersMade: made, stage: made >= MAX_TRANSFERS ? "assign" : "transfers" } }),
        `Military Affairs moved a regiment from the Army of ${payload.from} to ${payload.to}.`,
      );
    }
    case "endTransfers":
      return advance(withCo(state, { current: { ...current, stage: "assign" } }), "Military Affairs finished transfers.");
    case "assignOfficer":
      return advance(
        withCo(assignOfficer(state, payload.playerId, payload.army), { current }),
        `Military Affairs assigned a ${playerName(state, payload.playerId)} officer-in-training to the Army of ${payload.army}.`,
      );
    case "appointCommander": {
      const next = appointCommander(state, payload.army, payload.playerId);
      return advance(
        withCo(next, { current: { ...current, armiesResolved: [...current.armiesResolved, payload.army] } }),
        `Military Affairs appointed ${playerName(state, payload.playerId)} Commander of the Army of ${payload.army}.`,
      );
    }
  }
};

/** Crown games remember each transfer, so nobody (Crown or favour) undoes one this turn (p.9). */
function recordMove(state: GameState, current: MilitaryProgress, move: OfficeMove): { moves?: OfficeMove[] } {
  return isCrownGame(state) ? { moves: [...(current.moves ?? []), move] } : {};
}

/**
 * Move through the automatic parts: once no officers-in-training remain, go to Commanders; resolve
 * each Army that needs no choice (no change, or a single candidate) and stop at the first real choice.
 */
function advance(state: GameState, summary: string): StepResult {
  let next = state;
  let current = progress(next);
  const notes: string[] = [];

  if (current.stage === "assign" && !state.seatingOrder.some((id) => state.players[id].familyMembers.officersInTraining > 0)) {
    current = { ...current, stage: "commanders" };
    next = withCo(next, { current });
  }

  if (current.stage === "commanders") {
    for (const army of PRESIDENCY_IDS) {
      if (current.armiesResolved.includes(army)) continue;
      const candidates = commanderCandidates(next.company.armies[army]);
      if (candidates.length > 1) break;
      if (candidates.length === 1) {
        next = appointCommander(next, army, candidates[0]);
        notes.push(`${playerName(next, candidates[0])} became Commander of the Army of ${army}.`);
      }
      current = { ...current, armiesResolved: [...current.armiesResolved, army] };
      next = withCo(next, { current });
    }

    if (PRESIDENCY_IDS.every((army) => current.armiesResolved.includes(army))) {
      next = finishOffice(next, OFFICE_ID);
      notes.push("Military Affairs finished.");
    }
  }

  return { state: next, summary: [summary, ...notes].join(" ") };
}

function moveOfficer(state: GameState, playerId: PlayerId, from: ArmyId, to: ArmyId): GameState {
  const source = state.company.armies[from];
  const stack = source.officers[playerId];
  const sourceStack =
    stack.ready > 0 ? { ...stack, ready: stack.ready - 1 } : { ...stack, exhausted: stack.exhausted - 1 };
  const destination = state.company.armies[to];
  const destinationStack = destination.officers[playerId] ?? { ready: 0, exhausted: 0 };

  return {
    ...state,
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [from]: { ...source, officers: { ...source.officers, [playerId]: sourceStack } },
        [to]: {
          ...destination,
          officers: { ...destination.officers, [playerId]: { ...destinationStack, ready: destinationStack.ready + 1 } },
        },
      },
    },
  };
}

function moveRegiment(state: GameState, from: ArmyId, to: ArmyId): GameState {
  const source = state.company.armies[from];
  const regiments =
    source.regiments.ready > 0
      ? { ...source.regiments, ready: source.regiments.ready - 1 }
      : { ...source.regiments, exhausted: source.regiments.exhausted - 1 };
  const destination = state.company.armies[to];

  return {
    ...state,
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [from]: { ...source, regiments },
        [to]: { ...destination, regiments: { ...destination.regiments, ready: destination.regiments.ready + 1 } },
      },
    },
  };
}

function assignOfficer(state: GameState, playerId: PlayerId, armyId: ArmyId): GameState {
  const player = state.players[playerId];
  const army = state.company.armies[armyId];
  const stack = army.officers[playerId] ?? { ready: 0, exhausted: 0 };

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        familyMembers: { ...player.familyMembers, officersInTraining: player.familyMembers.officersInTraining - 1 },
      },
    },
    company: {
      ...state.company,
      armies: {
        ...state.company.armies,
        [armyId]: { ...army, officers: { ...army.officers, [playerId]: { ...stack, ready: stack.ready + 1 } } },
      },
    },
  };
}
