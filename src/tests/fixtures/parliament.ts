import type { GameState, LegalCommand } from "../../engine";
import { applyCommandOrThrow } from "./game";

/** A quick way through a vote: decline extras, stop voting, resolve; otherwise take the first option. */
function preferredCommand(legalCommands: LegalCommand[]): LegalCommand {
  const prefer = (predicate: (command: LegalCommand) => boolean) => legalCommands.find(predicate);
  return (
    prefer((command) => command.type === "parliament.passVote") ??
    prefer((command) => command.type === "parliament.continueVoting" && (command.payload as { another: boolean }).another === false) ??
    prefer((command) => command.type === "parliament.taxCollectors" && (command.payload as { propose: boolean }).propose === false) ??
    prefer((command) => command.type === "parliament.selectLaw") ??
    legalCommands[0]
  );
}

/** Plays Parliament Meets through to the next phase, checking invariants after every command. */
export function resolveParliament(state: GameState, commandPrefix = "command-parliament"): GameState {
  let current = state;
  for (let index = 0; current.phase === "parliament"; index += 1) {
    if (index > 500) throw new Error("Parliament did not finish.");
    const legal = preferredCommand(current.pendingDecision.legalCommands);
    const actor = current.pendingDecision.actor;
    current = applyCommandOrThrow(current, {
      id: `${commandPrefix}-${index}`,
      actorId: actor === "simultaneous" ? current.seatingOrder[0] : actor,
      type: legal.type,
      payload: legal.payload ?? {},
    });
  }
  return current;
}
