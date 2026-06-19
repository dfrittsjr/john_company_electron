import { rollDie } from "../rng";
import { offices } from "../../data";
import type {
  ApplyCommandResult,
  GameCommand,
  GameState,
  OfficeId,
  PlayerId,
  RngRollRecord,
} from "../types";
import { createFamilyActionCommands } from "./family";
import {
  createCommandLogEntry,
  firstHumanActor,
  noHumanActor,
  wrongPhase,
} from "./shared";

export function confirmLondonSeason(
  state: GameState,
  command: GameCommand,
): ApplyCommandResult {
  if (state.phase !== "londonSeason" || state.pendingDecision.step !== "londonSeason.confirm") {
    return wrongPhase("London Season confirmation can only be chosen during starter London Season.");
  }

  const now = command.clientTimestamp;
  const nextActor = firstHumanActor(state);
  if (!nextActor) {
    return noHumanActor("Cannot advance London Season because there is no human player.");
  }
  const londonSeasonResult =
    state.turn === 1 ? { state, retiredOffices: [], attritionedOffices: [], rolls: [] } : resolveOfficeAttrition(state);
  const resolvedState = londonSeasonResult.state;

  const logEntry = createCommandLogEntry({
    state: resolvedState,
    command,
    now,
    type: state.turn === 1 ? "londonSeason.skipped" : "londonSeason.confirmed",
    summary:
      state.turn === 1
        ? "London Season skipped on turn 1."
        : londonSeasonResult.retiredOffices.length > 0
          ? `London Season retired ${londonSeasonResult.retiredOffices.length} officeholder(s).`
          : "London Season resolved with no retirements.",
    details: {
      note:
        state.turn === 1
          ? "Rules skip London Season on the first turn."
          : "Resolved office attrition and retirement rolls. Prize retirement and prestige/blackmail display rules remain TODO.",
      attritionedOffices: londonSeasonResult.attritionedOffices,
      retiredOffices: londonSeasonResult.retiredOffices,
    },
    rngRolls: londonSeasonResult.rolls,
  });

  return {
    ok: true,
    logEntry,
    state: {
      ...resolvedState,
      updatedAt: now,
      phase: "family",
      pendingDecision: {
        id: `decision-family-choose-action-turn-${state.turn}-${nextActor}`,
        phase: "family",
        step: "family.chooseAction",
        actor: nextActor,
        visibility: "private",
        prompt: "Choose a family action.",
        legalCommands: createFamilyActionCommands(resolvedState, nextActor),
        canSave: true,
      },
      log: [...resolvedState.log, logEntry],
    },
  };
}

function resolveOfficeAttrition(state: GameState): {
  state: GameState;
  attritionedOffices: AttritionRecord[];
  retiredOffices: RetirementRecord[];
  rolls: RngRollRecord[];
} {
  const occupiedOffices = Object.values(state.company.offices)
    .filter((office) => !office.vacant && office.holder)
    .sort((left, right) => officeOrder(left.id) - officeOrder(right.id));
  const attritionedOffices: AttritionRecord[] = [];
  const retiredOffices: RetirementRecord[] = [];
  const rolls: RngRollRecord[] = [];
  let nextState = state;
  let nextRng = state.rng;

  for (const office of occupiedOffices) {
    const holder = office.holder as PlayerId;
    const nextFatigue = office.fatigue + 1;
    const stressModifier = office.id === "chairman" ? 1 : 0;
    const roll = rollDie(nextRng, 6, `londonSeason.retirement.${office.id}`);
    nextRng = roll.rng;
    rolls.push(roll.roll);

    const total = roll.value + nextFatigue + stressModifier;
    attritionedOffices.push({
      officeId: office.id,
      holder,
      fatigue: nextFatigue,
      roll: roll.value,
      stressModifier,
      total,
    });

    if (total >= 5) {
      retiredOffices.push({
        officeId: office.id,
        holder,
        fatigue: nextFatigue,
        roll: roll.value,
        stressModifier,
        total,
      });
      nextState = retireOfficeholder(nextState, office.id, holder);
    } else {
      nextState = {
        ...nextState,
        company: {
          ...nextState.company,
          offices: {
            ...nextState.company.offices,
            [office.id]: {
              ...nextState.company.offices[office.id],
              fatigue: nextFatigue,
            },
          },
        },
      };
    }
  }

  return {
    state: {
      ...nextState,
      rng: nextRng,
    },
    attritionedOffices,
    retiredOffices,
    rolls,
  };
}

type AttritionRecord = {
  officeId: OfficeId;
  holder: PlayerId;
  fatigue: number;
  roll: number;
  stressModifier: number;
  total: number;
};

type RetirementRecord = AttritionRecord;

function retireOfficeholder(state: GameState, officeId: OfficeId, holder: PlayerId): GameState {
  const office = state.company.offices[officeId];
  const player = state.players[holder];
  const nextVacantOffices = [...state.company.vacantOffices, officeId].filter(
    (candidate, index, officeIds) => officeIds.indexOf(candidate) === index,
  );

  return {
    ...state,
    players: {
      ...state.players,
      [holder]: {
        ...player,
        familyMembers: {
          ...player.familyMembers,
          pensioners: player.familyMembers.pensioners + 1,
          chairmanShare: officeId === "chairman" ? false : player.familyMembers.chairmanShare,
          offices: player.familyMembers.offices.filter((candidate) => candidate !== officeId),
        },
      },
    },
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [officeId]: {
          id: officeId,
          treasury: office?.treasury ?? 0,
          fatigue: 0,
          created: office?.created ?? true,
          vacant: true,
          actedThisTurn: false,
        },
      },
      vacantOffices: nextVacantOffices,
    },
  };
}

function officeOrder(officeId: OfficeId): number {
  if (officeId === "chairman") return 0;

  return offices.find((office) => office.id === officeId)?.operationOrder ?? Number.MAX_SAFE_INTEGER;
}
