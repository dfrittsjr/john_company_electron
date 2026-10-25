import { rollCheck } from "../../checks";
import { crownEffects, isCrownPlayer } from "../../crown/state";
import { PRESIDENCY_IDS, clockwiseFrom, commanderOf, familyAdjective, officeHolder, presidentOf } from "../../selectors";
import type { ArmyId, GameState, LegalCommand, PendingDecision, PlayerId, PresidencyId, RngRollRecord } from "../../types";
import { appendLog, nepotismConsentGuarantors, registerDecisionRefresher } from "../negotiation";
import {
  facedownBlackmailInstance,
  registerBlackmailResume,
  registerInFlowBlackmail,
  startBlackmailPlay,
} from "../negotiation-blackmail";
import { decideOperation } from "./decide";
import type { OperationInterrupt, PendingCheck } from "../company-operation.state";
import { buyAlliance, resolveDeployCheck } from "./commander";
import {
  coState,
  decisionId,
  officeLabel,
  playerName,
  primeMinister,
  vacateOffice,
  withCo,
} from "./context";
import { localAlliances } from "../../../data";
import { withBoardOfControlOffer, type OperationStep, type StepResult } from "./step";
import { resolveTradeCheck } from "./trade";
import { resolveFirmRoll } from "./firm-trade";
import { presidencyProgress, withActivity } from "./presidency-progress";

// Decisions that interrupt an office: blackmail reactions, consents, and laws that trigger after an
// office acts. Each records enough in CompanyOperationState to resume where the office left off.

export type InterruptPayload =
  | { action: "playConnection" }
  | { action: "declineConnection" }
  | { action: "approveAlliance" }
  | { action: "refuseAlliance" }
  | { action: "boardOfControl"; remove: boolean }
  | { action: "oversightDemote"; army: ArmyId }
  | { action: "oversightDecline" }
  | { action: "oversightAppoint"; army: ArmyId; playerId: PlayerId }
  | { action: "oversightConsent"; accepted: boolean };

const TYPE = "companyOperation.interrupt";

function command(label: string, payload: InterruptPayload, description?: string): LegalCommand {
  return { type: TYPE, label, description, payload };
}

function decision(state: GameState, step: string, actor: PlayerId | "system", prompt: string, commands: LegalCommand[]): PendingDecision {
  return {
    id: decisionId(state, `company-operation-${step}`),
    phase: "companyOperation",
    step: `companyOperation.${step}`,
    actor,
    visibility: "public",
    prompt,
    legalCommands: commands,
    canSave: true,
  };
}

export function interruptDecision(state: GameState, interrupt: OperationInterrupt): PendingDecision {
  switch (interrupt.kind) {
    case "debtConsent":
      throw new Error("Debt consent is built by the Chairman module.");
    case "connection": {
      const card = interrupt.cardId === "mercantile-connection" ? "Mercantile Connection" : "Diplomatic Connection";
      const half = Math.floor(interrupt.check.dice / 2);
      return decision(state, "connection", interrupt.holder, `${card}: force a reroll of this ${interrupt.check.context === "deploy" ? "Deploy" : interrupt.check.context === "firmTrade" ? "firm Trade" : "Trade"} check (${interrupt.check.outcome}) with ${half} ${half === 1 ? "die" : "dice"}?`, [
        command(`Don't play ${card}`, { action: "declineConnection" }),
        command(`Play ${card}: reroll with ${half} ${half === 1 ? "die" : "dice"}`, { action: "playConnection" }, "Zero dice counts as a failure."),
      ]);
    }
    case "allianceConsent": {
      const definition = localAlliances.find((alliance) => alliance.id === interrupt.allianceId)!;
      const president = presidentOf(state, interrupt.presidency);
      // Crown favour (Handbook p.11): a President who paid for the Crown's extra Local Alliance must consent.
      const bound = crownEffects(state, "presidencies.commander.alliance.extra").some(
        (effect) => effect.by === president && (effect.option as { scope?: string } | undefined)?.scope === `commander:${interrupt.presidency}`,
      );
      return decision(state, "allianceConsent", president ?? "system", `The Commander asks the President of ${interrupt.presidency} to pay £${definition.cost} for ${definition.name}.${bound ? " You paid the Crown for an extra Local Alliance, so you must consent." : ""}`, [
        command("Approve the purchase", { action: "approveAlliance" }),
        ...(bound ? [] : [command("Refuse", { action: "refuseAlliance" })]),
      ]);
    }
    case "boardOfControl": {
      const holder = officeHolder(state, interrupt.officeId);
      return decision(state, "boardOfControl", primeMinister(state) ?? "system", `Board of Control: remove ${playerName(state, holder)} from ${officeLabel(interrupt.officeId)}?`, [
        command("Leave the officeholder", { action: "boardOfControl", remove: false }),
        command(`Remove ${playerName(state, holder)}`, { action: "boardOfControl", remove: true }, "Once per turn; the piece returns to supply."),
      ]);
    }
    case "militaryOversight": {
      const pm = primeMinister(state) ?? "system";
      if (interrupt.stage === "demote") {
        return decision(state, "militaryOversight", pm, "Military Oversight: you may demote one Commander and appoint another from that Army's officers.", [
          command("Leave the Commanders", { action: "oversightDecline" }),
          ...PRESIDENCY_IDS.filter((army) => commanderOf(state, army)).map((army) =>
            command(`Demote ${playerName(state, commanderOf(state, army))}, Commander of the Army of ${army}`, { action: "oversightDemote", army }),
          ),
        ]);
      }
      if (interrupt.stage === "appoint") {
        const pmId = primeMinister(state);
        const army = state.company.armies[interrupt.army];
        const refusedSelf = Boolean(interrupt.selfRefused);
        const candidates = Object.entries(army.officers)
          .filter(([, stack]) => stack.ready + stack.exhausted > 0)
          .map(([playerId]) => playerId)
          .filter((playerId) => !(refusedSelf && playerId === pmId));
        return decision(
          state,
          "militaryOversight",
          pm,
          `Military Oversight: appoint the new Commander of the Army of ${interrupt.army} from its officers.`,
          candidates.map((playerId) =>
            command(`Appoint a ${familyAdjective(state, playerId)} officer`, { action: "oversightAppoint", army: interrupt.army, playerId }),
          ),
        );
      }
      const pmName = playerName(state, interrupt.candidate);
      return decision(state, "militaryOversight", interrupt.pending[0], `Nepotism (p.14): ${pmName} wants to appoint their own officer as Commander of the Army of ${interrupt.army}. Do you consent?`, [
        command("Consent", { action: "oversightConsent", accepted: true }, `Allow ${pmName} to appoint their own officer.`),
        command("Refuse", { action: "oversightConsent", accepted: false }, `${pmName} must appoint another family's officer.`),
      ]);
    }
  }
}

export const interruptStep: OperationStep = (state, cmd) => {
  const payload = cmd.payload as InterruptPayload;
  const interrupt = coState(state).interrupt!;

  switch (payload.action) {
    case "declineConnection":
    case "playConnection": {
      if (interrupt.kind !== "connection") break;
      const cardName = interrupt.cardId === "mercantile-connection" ? "Mercantile Connection" : "Diplomatic Connection";
      if (payload.action === "playConnection") {
        const cardInstanceId = facedownBlackmailInstance(state, interrupt.holder, interrupt.cardId);
        if (cardInstanceId) {
          // Played through the shared blackmail path so Man on the Inside may cancel it (p.12);
          // the reroll happens in the resume below.
          const playing = withCo(state, {
            interrupt: undefined,
            pendingConnection: { cardId: interrupt.cardId, holder: interrupt.holder, check: interrupt.check },
          });
          return {
            state: startBlackmailPlay(playing, {
              playerId: interrupt.holder,
              cardInstanceId,
              params: {},
              resumeKey: CONNECTION_RESUME,
              timestamp: cmd.clientTimestamp,
            }),
            summary: `${playerName(state, interrupt.holder)} played ${cardName}.`,
          };
        }
      }
      const next = withCo(state, { interrupt: undefined });
      const resolved = resolveCheck(next, interrupt.check);
      return {
        state: resolved.state,
        summary: resolved.summary,
        privateNote: `${playerName(state, interrupt.holder)} did not play ${cardName}.`,
        details: resolved.details,
        rngRolls: resolved.rolls,
      };
    }
    case "approveAlliance":
    case "refuseAlliance": {
      if (interrupt.kind !== "allianceConsent") break;
      const name = localAlliances.find((alliance) => alliance.id === interrupt.allianceId)!.name;
      const cleared = withCo(state, { interrupt: undefined });
      if (payload.action === "approveAlliance") {
        return { state: buyAlliance(cleared, interrupt.presidency, interrupt.allianceId), summary: `The President approved buying ${name}.` };
      }
      return { state: rememberCrownRefusal(cleared, interrupt.presidency, interrupt.allianceId), summary: `The President refused to pay for ${name}.` };
    }
    case "boardOfControl": {
      if (interrupt.kind !== "boardOfControl") break;
      const holder = officeHolder(state, interrupt.officeId);
      if (!payload.remove) {
        return { state: withCo(state, { interrupt: undefined }), summary: "The Prime Minister left the officeholder in place." };
      }
      return {
        state: withCo(vacateOffice(state, interrupt.officeId), { interrupt: undefined, boardOfControlUsed: true }),
        summary: `Board of Control: the Prime Minister removed ${playerName(state, holder)} from ${officeLabel(interrupt.officeId)}.`,
      };
    }
    case "oversightDecline":
      return { state: withBoardOfControlOffer(withCo(state, { interrupt: undefined }), "military-affairs"), summary: "The Prime Minister left the Commanders in place." };
    case "oversightDemote": {
      const army = state.company.armies[payload.army];
      const previous = army.commander!;
      const stack = army.officers[previous] ?? { ready: 0, exhausted: 0 };
      const next: GameState = {
        ...state,
        company: {
          ...state.company,
          armies: {
            ...state.company.armies,
            [payload.army]: { ...army, commander: undefined, officers: { ...army.officers, [previous]: { ...stack, ready: stack.ready + 1 } } },
          },
        },
      };
      return {
        state: withCo(next, { interrupt: { kind: "militaryOversight", stage: "appoint", army: payload.army } }),
        summary: `Military Oversight: the Prime Minister demoted ${playerName(state, previous)}, Commander of the Army of ${payload.army}, to an officer.`,
      };
    }
    case "oversightAppoint": {
      const pm = primeMinister(state);
      const pending = payload.playerId === pm ? oversightConsentNeededFrom(state, payload.army, payload.playerId) : [];
      if (pending.length > 0) {
        return {
          state: withCo(state, { interrupt: { kind: "militaryOversight", stage: "nepotism", army: payload.army, candidate: payload.playerId, pending } }),
          summary: `The Prime Minister proposed their own officer as Commander; ${pending.map((playerId) => playerName(state, playerId)).join(", ")} must consent.`,
        };
      }
      return appointByOversight(state, payload.army, payload.playerId);
    }
    case "oversightConsent": {
      if (interrupt.kind !== "militaryOversight" || interrupt.stage !== "nepotism") break;
      const consenter = playerName(state, interrupt.pending[0]);
      if (!payload.accepted) {
        return {
          state: withCo(state, { interrupt: { kind: "militaryOversight", stage: "appoint", army: interrupt.army, selfRefused: true } }),
          summary: `${consenter} refused Nepotism consent; the Prime Minister must appoint another family's officer.`,
        };
      }
      const remaining = interrupt.pending.slice(1);
      if (remaining.length > 0) {
        return {
          state: withCo(state, { interrupt: { ...interrupt, pending: remaining } }),
          summary: `${consenter} consented to the Prime Minister appointing their own officer.`,
        };
      }
      const appointed = appointByOversight(state, interrupt.army, interrupt.candidate);
      return { ...appointed, summary: `${consenter} consented. ${appointed.summary}` };
    }
  }
  throw new Error(`Interrupt command ${payload.action} does not match the pending interrupt.`);
};

function resolveCheck(state: GameState, check: PendingCheck): { state: GameState; summary: string; details?: unknown; rolls: RngRollRecord[] } {
  if (check.context === "trade") {
    const resolved = resolveTradeCheck(state, check);
    return { state: resolved.state, summary: resolved.note, rolls: [] };
  }
  if (check.context === "firmTrade") {
    const resolved = resolveFirmRoll(state, check);
    return { state: resolved.state, summary: resolved.note, rolls: [] };
  }
  const resolved = resolveDeployCheck(state, check);
  return { state: resolved.state, summary: resolved.summary, details: resolved.details, rolls: resolved.rolls };
}

const CONNECTION_RESUME = "companyOperation.connection";

registerInFlowBlackmail("blackmail.force-half-dice-reroll.trade", "after a Trade check");
registerInFlowBlackmail("blackmail.force-half-dice-reroll.deploy", "after a Deploy check");

// Mercantile and Diplomatic Connection: "force a reroll with half the dice, rounded down"; zero
// dice is a failure. If Man on the Inside cancelled the card, the original roll stands.
registerBlackmailResume(CONNECTION_RESUME, (state, _play, outcome) => {
  const pending = coState(state).pendingConnection;
  let next = withCo(state, { pendingConnection: undefined });
  if (!pending) return { ...next, pendingDecision: decideOperation(next) };

  let check = pending.check;
  const rolls: RngRollRecord[] = [];
  let summary = "The original roll stands.";
  if (outcome === "resolved") {
    const dice = Math.floor(check.dice / 2);
    const reroll = rollCheck(next.rng, dice, `companyOperation.${pending.cardId}`);
    next = { ...next, rng: reroll.rng };
    if (reroll.roll) rolls.push(reroll.roll);
    check = { ...check, dice, values: reroll.values, outcome: reroll.outcome } as PendingCheck;
    summary = `Reroll with ${dice} ${dice === 1 ? "die" : "dice"} [${reroll.values.join(", ")}]: ${reroll.outcome}.`;
  }
  const resolved = resolveCheck(next, check);
  const logged = appendLog(resolved.state, {
    actor: pending.holder,
    type: "companyOperation.connection",
    summary: `${summary} ${resolved.summary}`,
    details: resolved.details,
    rngRolls: [...rolls, ...resolved.rolls],
    timestamp: state.updatedAt,
  });
  const decision = decideOperation(logged);
  return { ...logged, phase: decision.phase, pendingDecision: decision };
});

/**
 * Nepotism (p.14): every other family in the candidate pool, here the other families with officers
 * in that Army, must consent. A called-in "My consent for nepotism" promise counts as consent.
 */
function oversightConsentNeededFrom(state: GameState, armyId: ArmyId, candidate: PlayerId): PlayerId[] {
  const officers = state.company.armies[armyId].officers;
  const guarantors = new Set(nepotismConsentGuarantors(state, candidate));
  return clockwiseFrom(state, candidate).filter(
    (playerId) =>
      playerId !== candidate &&
      !state.players[playerId].isCrown &&
      !guarantors.has(playerId) &&
      (officers[playerId]?.ready ?? 0) + (officers[playerId]?.exhausted ?? 0) > 0,
  );
}

function appointByOversight(state: GameState, armyId: ArmyId, playerId: PlayerId): StepResult {
  const army = state.company.armies[armyId];
  const stack = army.officers[playerId];
  const officers = {
    ...army.officers,
    [playerId]: stack.ready > 0 ? { ...stack, ready: stack.ready - 1 } : { ...stack, exhausted: stack.exhausted - 1 },
  };
  const next: GameState = {
    ...state,
    company: { ...state.company, armies: { ...state.company.armies, [armyId]: { ...army, officers, commander: playerId } } },
  };
  return {
    state: withBoardOfControlOffer(withCo(next, { interrupt: undefined }), "military-affairs"),
    summary: `Military Oversight: ${playerName(state, playerId)} is now Commander of the Army of ${armyId}.`,
  };
}

// After Man on the Inside cancels a Connection, the restored reaction must not offer the played card again.
registerDecisionRefresher("companyOperation.connection", (state) => {
  const interrupt = coState(state).interrupt;
  const decision = state.pendingDecision;
  if (!interrupt || interrupt.kind !== "connection") return decision;
  if (facedownBlackmailInstance(state, interrupt.holder, interrupt.cardId)) return decision;
  return {
    ...decision,
    legalCommands: decision.legalCommands.filter(
      (legal) => (legal.payload as InterruptPayload).action !== "playConnection",
    ),
  };
});

/** A Crown President's refusal stands for the turn, so the Commander isn't offered that alliance again. */
function rememberCrownRefusal(state: GameState, presidency: PresidencyId, allianceId: string): GameState {
  const activity = presidencyProgress(state, presidency).activity;
  if (!isCrownPlayer(state, presidentOf(state, presidency)) || activity?.kind !== "commander") return state;
  return withActivity(state, presidency, { ...activity, alliancesRefused: [...(activity.alliancesRefused ?? []), allianceId] });
}
