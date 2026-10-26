import type { CrownDecisionInfo, GameState, LegalCommand, PendingDecision, PlayerId } from "../types";
import { sameCommand, type CrownChoice } from "./kit";
import { crownPolicyFor } from "./registry";
import { clearCrownEffects, CROWN_PLAYER_ID, crownChooser, crownEffects } from "./state";

// How the Crown decides (docs/phases/crown.md). Phases build the Crown's decisions like anyone
// else's, with actor "crown"; after every command the engine runs crownizeDecision, which asks the
// policy registered for that step which options the Crown takes and cuts legalCommands down to them.
// One option: the Crown just does it. Several the Handbook doesn't separate: the soloist or Player
// Button holder picks between them (rulebook p.46). No policy: they pick from everything.

export const NO_INSTRUCTION_REASON = "The Crown Handbook gives no instruction here, so you choose for the Crown.";

/** Re-decides the pending decision if it is the Crown's. Safe to call any number of times. */
export function crownizeDecision(state: GameState): GameState {
  if (!state.crown) return state;
  const current = dropStaleEffects(state);
  const decision = current.pendingDecision;
  if (decision.actor !== CROWN_PLAYER_ID) return current;

  const base: PendingDecision = { ...decision, legalCommands: decision.crown?.all ?? decision.legalCommands };
  delete base.crown;
  const { commands, info } = decideForCrown(current, base);
  return { ...current, pendingDecision: { ...base, legalCommands: commands, crown: info } };
}

function decideForCrown(
  state: GameState,
  decision: PendingDecision,
): { commands: LegalCommand[]; info: CrownDecisionInfo } {
  const all = decision.legalCommands;
  const chooser = crownChooser(state);
  const free = (reason: string) => ({ commands: all, info: { all, reason, ...(all.length > 1 ? { chooser } : {}) } });

  // A "choose for the Crown" favour bought on this decision.
  const bought = crownEffects(state).find((effect) => effect.decisionId === decision.id && effect.choices);
  if (bought?.choices) {
    const commands = sameCommands(bought.choices, all);
    if (commands.length > 0) {
      const name = state.players[bought.by]?.name ?? bought.by;
      return { commands, info: { all, reason: `${name} chooses for the Crown (favour).`, chooser: bought.by } };
    }
  }

  if (all.length === 0) return { commands: all, info: { all, reason: "" } };

  const policy = crownPolicyFor(decision.step);
  let choice: CrownChoice | undefined;
  try {
    choice = policy?.(state, decision);
  } catch (error) {
    return free(`The Crown's rule for this step failed (${(error as Error).message}), so you choose for the Crown.`);
  }
  if (!choice) return all.length === 1 ? { commands: all, info: { all, reason: "Its only option." } } : free(NO_INSTRUCTION_REASON);

  const commands = sameCommands(choice.commands, all);
  if (commands.length === 0) return free(`The Crown's rule found none of the options legal (${choice.reason}), so you choose for the Crown.`);
  return {
    commands,
    info: {
      all,
      reason: choice.reason,
      ...(commands.length > 1 ? { chooser } : {}),
      ...(choice.passButton ? { passButton: true } : {}),
    },
  };
}

/** Favour effects end with the phase they were bought in, unless their area cleared them sooner. */
function dropStaleEffects(state: GameState): GameState {
  return clearCrownEffects(state, (effect) => effect.phase !== state.phase || effect.turn !== state.turn);
}

/** The options in `wanted` that are also in `offered`, in `wanted`'s order, taken from `offered`. */
function sameCommands(wanted: LegalCommand[], offered: LegalCommand[]): LegalCommand[] {
  const result: LegalCommand[] = [];
  for (const want of wanted) {
    const match = offered.find((legal) => sameCommand(legal, want));
    if (match && !result.includes(match)) result.push(match);
  }
  return result;
}

/** The pending decision's chooser, when the players must pick for the Crown. */
export function crownDecisionChooser(state: GameState): PlayerId | undefined {
  return state.pendingDecision.actor === CROWN_PLAYER_ID ? state.pendingDecision.crown?.chooser : undefined;
}
