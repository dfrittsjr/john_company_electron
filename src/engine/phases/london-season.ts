import type { CommandHandler } from "../command-handler";
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
  // "This phase is skipped on the game's first turn" (p.11): the scenario's start turn.
  const isFirstTurn = state.turn === state.startTurn;
  const londonSeasonResult = isFirstTurn
    ? { state, retiredOffices: [], attritionedOffices: [], rolls: [] }
    : resolveOfficeAttrition(state);
  const resolvedState = londonSeasonResult.state;

  const logEntry = createCommandLogEntry({
    state: resolvedState,
    command,
    now,
    type: isFirstTurn ? "londonSeason.skipped" : "londonSeason.confirmed",
    summary:
      isFirstTurn
        ? `London Season skipped on the scenario's first turn (turn ${state.turn}).`
        : londonSeasonResult.retiredOffices.length > 0
          ? `London Season retired ${londonSeasonResult.retiredOffices.length} officeholder(s).`
          : "London Season resolved with no retirements.",
    details: {
      note:
        isFirstTurn
          ? "Rules skip London Season on the game's first turn (p.11)."
          : "Resolved office attrition. Prize retirements and prestige/blackmail cards are TODO, so pensioners returned to supply.",
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

  // Attrition (p.11): roll one die per office, adding existing fatigue and +1 for the Chairman.
  // 1-2 nothing; 3-4 add a fatigue; 5+ the officeholder retires to the Pensioners box.
  for (const office of occupiedOffices) {
    const holder = office.holder as PlayerId;
    const stressModifier = office.id === "chairman" ? 1 : 0;
    const roll = rollDie(nextRng, 6, `londonSeason.attrition.${office.id}`);
    nextRng = roll.rng;
    rolls.push(roll.roll);

    const total = roll.value + office.fatigue + stressModifier;
    const outcome: AttritionRecord["outcome"] = total >= 5 ? "retired" : total >= 3 ? "fatigued" : "none";
    const record: AttritionRecord = {
      officeId: office.id,
      holder,
      fatigueBefore: office.fatigue,
      roll: roll.value,
      stressModifier,
      total,
      outcome,
    };
    attritionedOffices.push(record);

    if (outcome === "retired") {
      retiredOffices.push(record);
      nextState = retireOfficeholder(nextState, office.id, holder);
    } else if (outcome === "fatigued") {
      nextState = {
        ...nextState,
        company: {
          ...nextState.company,
          offices: {
            ...nextState.company.offices,
            [office.id]: {
              ...nextState.company.offices[office.id],
              fatigue: office.fatigue + 1,
            },
          },
        },
      };
    }
  }

  // Prize retirements and prestige cards are not implemented yet, so the final step of the
  // London Season runs straight away: "return any family members in the Pensioners box to their
  // supplies" (p.12).
  nextState = {
    ...nextState,
    players: Object.fromEntries(
      Object.entries(nextState.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          familyMembers: {
            ...player.familyMembers,
            supply: player.familyMembers.supply + player.familyMembers.pensioners,
            pensioners: 0,
          },
        },
      ]),
    ),
  };

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
  fatigueBefore: number;
  roll: number;
  stressModifier: number;
  total: number;
  outcome: "none" | "fatigued" | "retired";
};

type RetirementRecord = AttritionRecord;

// The retiring family member moves to the Pensioners box; the office card goes to the Vacant
// Offices box and its fatigue returns to supply (p.11). A retiring Chairman takes the Chairman
// slot's Company share with them.
function retireOfficeholder(state: GameState, officeId: OfficeId, holder: PlayerId): GameState {
  const office = state.company.offices[officeId];
  const player = state.players[holder];

  return {
    ...state,
    players: {
      ...state.players,
      [holder]: {
        ...player,
        familyMembers: {
          ...player.familyMembers,
          pensioners: player.familyMembers.pensioners + 1,
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
      vacantOffices: [...new Set([...state.company.vacantOffices, officeId])],
    },
  };
}

function officeOrder(officeId: OfficeId): number {
  return offices.find((office) => office.id === officeId)?.hiringOrder ?? Number.MAX_SAFE_INTEGER;
}

/** Commands this phase answers; composed by the dispatcher in ../commands.ts. */
export const londonSeasonCommandHandlers: Record<string, CommandHandler> = {
  "londonSeason.confirm": confirmLondonSeason,
};
