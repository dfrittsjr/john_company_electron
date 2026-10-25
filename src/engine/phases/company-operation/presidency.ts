import { clearScopedCrownEffects } from "../../crown/state";
import { chairmanHolder, commanderOf, officeHolder, presidentOf } from "../../selectors";
import type { GameState, LegalCommand, OfficeId, PendingDecision, PresidencyId } from "../../types";
import { coState, decisionId, officeLabel, playerName, presidentOfficeId, regionPresidencyId } from "./context";
import { commanderDecision, commanderStep, startCommander, type CommanderPayload } from "./commander";
import { governorDecision, governorStep, startGovernor, type GovernorPayload } from "./governor";
import { presidencyProgress } from "./presidency-progress";
import { finishOffice, type OperationStep, type StepResult } from "./step";
import { firmFillDecision, firmRevealDecision, firmsNeedAttention, pendingFillers, startFirmFill, unrevealedFirms } from "./firm-trade";
import { isDeregulated } from "../../firms";
import { canTrade, startTrade, tradeDecision, tradeStep, tradeUnavailableReason, type TradePayload } from "./trade";

// Presidency Operations (p.20): the President decides the order in which they Trade and their Commander
// and Governor(s) act. Commanders and Governors need not act but must be given the opportunity, and each
// finishes before the next begins; Trade may come anytime between them. A vacant President's order is
// set by the Chairman, and then nobody trades or approves local alliance purchases.

export type PresidencyPayload =
  | { action: "trade"; presidency: PresidencyId }
  | { action: "commander"; presidency: PresidencyId }
  | { action: "governor"; presidency: PresidencyId; officeId: OfficeId }
  | { action: "end"; presidency: PresidencyId };

/** Governors of Company regions associated with this Presidency who still have their turn (p.24). */
export function pendingGovernors(state: GameState, presidency: PresidencyId): OfficeId[] {
  if (state.company.governorGeneralInPlay) return [];
  const done = presidencyProgress(state, presidency).governorsDone;
  return Object.values(state.india.regions)
    .filter((region) => region.companyControlled && regionPresidencyId(state, region.id) === presidency)
    .map((region) => region.governorOffice)
    .filter((officeId) => officeHolder(state, officeId) && !done.includes(officeId));
}

function commanderPending(state: GameState, presidency: PresidencyId): boolean {
  return Boolean(commanderOf(state, presidency)) && !presidencyProgress(state, presidency).commanderDone;
}

/** True when this Presidency has nobody to act this turn, so the office is simply skipped. */
export function presidencyHasNothingToDo(state: GameState, presidency: PresidencyId): boolean {
  return (
    !presidentOf(state, presidency) &&
    !commanderPending(state, presidency) &&
    pendingGovernors(state, presidency).length === 0 &&
    !firmsNeedAttention(state, presidency)
  );
}

export function presidencyChooser(state: GameState, presidency: PresidencyId) {
  return presidentOf(state, presidency) ?? chairmanHolder(state) ?? "system";
}

export function presidencyDecision(state: GameState, presidency: PresidencyId): PendingDecision {
  // Firms of this Presidency reveal and roll before anyone acts (p.40).
  if (unrevealedFirms(state, presidency).length > 0) return firmRevealDecision(state, presidency);
  const progress = presidencyProgress(state, presidency);
  const activity = progress.activity;
  const firmFill = coState(state).firmFill;
  if (!activity && firmFill?.presidency === presidency) return firmFillDecision(state, firmFill);
  if (activity?.kind === "trade") return tradeDecision(state, presidency, activity);
  if (activity?.kind === "commander") return commanderDecision(state, presidency, activity);
  if (activity?.kind === "governor") return governorDecision(state, presidency, activity);

  const commands: LegalCommand[] = [];
  const governors = pendingGovernors(state, presidency);
  const positionsLeft = commanderPending(state, presidency) || governors.length > 0;

  if (!positionsLeft) {
    commands.push({
      type: "companyOperation.presidency",
      label: `End the Presidency of ${presidency}'s operations`,
      payload: { action: "end", presidency } satisfies PresidencyPayload,
    });
  }
  if (canTrade(state, presidency)) {
    commands.push({
      type: "companyOperation.presidency",
      label: "Trade",
      payload: { action: "trade", presidency } satisfies PresidencyPayload,
    });
  }
  if (commanderPending(state, presidency)) {
    commands.push({
      type: "companyOperation.presidency",
      label: `Commander of the Army of ${presidency} (${playerName(state, commanderOf(state, presidency))}) acts`,
      payload: { action: "commander", presidency } satisfies PresidencyPayload,
    });
  }
  for (const officeId of governors) {
    commands.push({
      type: "companyOperation.presidency",
      label: `${officeLabel(officeId)} (${playerName(state, officeHolder(state, officeId))}) acts`,
      payload: { action: "governor", presidency, officeId } satisfies PresidencyPayload,
    });
  }

  const chooser = presidencyChooser(state, presidency);
  const noTrade = presidentOf(state, presidency) ? tradeUnavailableReason(state, presidency) : undefined;
  return {
    id: decisionId(state, `company-operation-presidency-${presidency.toLowerCase()}`),
    phase: "companyOperation",
    step: "companyOperation.presidency",
    actor: chooser,
    visibility: "public",
    prompt: presidentOf(state, presidency)
      ? `President of ${presidency}: choose who acts next.${noTrade ? ` No Trade: ${noTrade}.` : ""}`
      : `The President of ${presidency} is vacant: the Chairman orders the Commander and Governors.`,
    legalCommands: commands,
    canSave: true,
  };
}

function currentPresidency(state: GameState): PresidencyId {
  const progress = presidencyProgressForCurrent(state);
  return progress.presidency;
}

function presidencyProgressForCurrent(state: GameState) {
  const current = coState(state).current;
  if (current?.office !== "presidency") throw new Error("No Presidency is operating.");
  return current;
}

export const presidencyStep: OperationStep = (state, command) => {
  const payload = command.payload as PresidencyPayload;
  const presidency = payload.presidency;

  switch (payload.action) {
    case "trade":
      return { state: startTrade(state, presidency), summary: `The President of ${presidency} began a Trade.` };
    case "commander":
      return {
        state: startCommander(state, presidency),
        summary: `The Commander of the Army of ${presidency} began acting.`,
      };
    case "governor":
      return {
        state: startGovernor(state, presidency, payload.officeId),
        summary: `The ${officeLabel(payload.officeId)} began acting.`,
      };
    case "end": {
      state = clearScopedCrownEffects(state, "presidencies.trade.", `trade:${presidency}`);
      // With no successful Trade this turn the firms fill after everyone else has acted (p.40).
      if (isDeregulated(state) && pendingFillers(state, presidency).length > 0) {
        const started = startFirmFill(state, presidency, undefined, true);
        return {
          state: started.state,
          summary: [`The Presidency of ${presidency} finished its operations; the firms fill orders.`, ...started.notes].join(" "),
        };
      }
      return {
        state: finishOffice(state, presidentOfficeId(presidency)),
        summary: `The Presidency of ${presidency} finished its operations.`,
      };
    }
  }
};

/** Steps inside an activity look up the Presidency from the operation in progress. */
function activityStep(kind: "trade" | "commander" | "governor") {
  return (state: GameState, payload: unknown): StepResult => {
    const presidency = currentPresidency(state);
    const activity = presidencyProgress(state, presidency).activity;
    if (!activity || activity.kind !== kind) throw new Error(`No ${kind} in progress for ${presidency}.`);
    switch (activity.kind) {
      case "trade":
        return tradeStep(state, presidency, activity, payload as TradePayload);
      case "commander":
        return commanderStep(state, presidency, activity, payload as CommanderPayload);
      case "governor":
        return governorStep(state, presidency, activity, payload as GovernorPayload);
    }
  };
}

export const tradeCommandStep: OperationStep = (state, command) => activityStep("trade")(state, command.payload);
export const commanderCommandStep: OperationStep = (state, command) => activityStep("commander")(state, command.payload);
export const governorCommandStep: OperationStep = (state, command) => activityStep("governor")(state, command.payload);
