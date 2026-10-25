import { rollCheck } from "../../checks";
import { PRESIDENCY_IDS, chairmanHolder, commanderOf, officeHolder, presidentOf } from "../../selectors";
import type { ArmyId, GameState, LegalCommand, PendingDecision, PlayerId, PresidencyId } from "../../types";
import type { OperationInterrupt, PendingCheck } from "../company-operation.state";
import { buyAlliance, resolveDeployCheck } from "./commander";
import {
  CHINA_OFFICE_ID,
  coState,
  decisionId,
  markBlackmailPlayed,
  officeLabel,
  playerName,
  primeMinister,
  vacateOffice,
  withCo,
} from "./context";
import { writerCandidates } from "./director-of-trade";
import { localAlliances } from "../../../data";
import { withBoardOfControlOffer, type OperationStep, type StepResult } from "./step";
import { resolveTradeCheck } from "./trade";

// Decisions that interrupt an office: blackmail reactions, consents, and laws that trigger after an
// office acts. Each records enough in CompanyOperationState to resume where the office left off.

export type InterruptPayload =
  | { action: "playConnection" }
  | { action: "declineConnection" }
  | { action: "approveAlliance" }
  | { action: "refuseAlliance" }
  | { action: "hireChina"; playerId: PlayerId; presidency: PresidencyId }
  | { action: "chinaConsent"; accepted: boolean }
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
      return decision(state, "connection", interrupt.holder, `${card}: force a reroll of this ${interrupt.check.context === "trade" ? "Trade" : "Deploy"} check (${interrupt.check.outcome}) with ${half} ${half === 1 ? "die" : "dice"}?`, [
        command(`Don't play ${card}`, { action: "declineConnection" }),
        command(`Play ${card}: reroll with ${half} ${half === 1 ? "die" : "dice"}`, { action: "playConnection" }, "Zero dice counts as a failure."),
      ]);
    }
    case "allianceConsent": {
      const definition = localAlliances.find((alliance) => alliance.id === interrupt.allianceId)!;
      return decision(state, "allianceConsent", presidentOf(state, interrupt.presidency) ?? "system", `The Commander asks the President of ${interrupt.presidency} to pay £${definition.cost} for ${definition.name}.`, [
        command("Approve the purchase", { action: "approveAlliance" }),
        command("Refuse", { action: "refuseAlliance" }),
      ]);
    }
    case "chinaHire": {
      const chairman = chairmanHolder(state);
      const candidates = writerCandidates(state).filter((candidate) => !(interrupt.selfRefused && candidate.playerId === chairman));
      return decision(
        state,
        "chinaHire",
        chairman ?? "system",
        "Hire the new Superintendent of Trade in China from any writer.",
        candidates.map((candidate) =>
          command(`Hire a ${playerName(state, candidate.playerId)} writer from ${candidate.presidency}`, {
            action: "hireChina",
            playerId: candidate.playerId,
            presidency: candidate.presidency,
          }),
        ),
      );
    }
    case "chinaHireConsent":
      return decision(state, "chinaHireConsent", "system", `Nepotism (p.14): do the other families with writers consent to the Chairman hiring their own writer?`, [
        command("Everyone consents", { action: "chinaConsent", accepted: true }),
        command("Someone refuses", { action: "chinaConsent", accepted: false }),
      ]);
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
            command(`Appoint a ${playerName(state, playerId)} officer`, { action: "oversightAppoint", army: interrupt.army, playerId }),
          ),
        );
      }
      return decision(state, "militaryOversight", "system", "Nepotism (p.14): do the other families with officers in that Army consent to the Prime Minister appointing their own officer?", [
        command("Everyone consents", { action: "oversightConsent", accepted: true }),
        command("Someone refuses", { action: "oversightConsent", accepted: false }),
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
      let next = withCo(state, { interrupt: undefined });
      let check = interrupt.check;
      const rolls = [];
      let summary = `${playerName(state, interrupt.holder)} did not play the card.`;
      if (payload.action === "playConnection") {
        // TODO(NG): Man on the Inside may cancel this blackmail when played.
        next = markBlackmailPlayed(next, interrupt.holder, interrupt.cardId);
        const dice = Math.floor(check.dice / 2);
        const reroll = rollCheck(next.rng, dice, `companyOperation.${interrupt.cardId}`);
        next = { ...next, rng: reroll.rng };
        if (reroll.roll) rolls.push(reroll.roll);
        check = { ...check, dice, values: reroll.values, outcome: reroll.outcome } as PendingCheck;
        summary = `${playerName(state, interrupt.holder)} played ${interrupt.cardId === "mercantile-connection" ? "Mercantile Connection" : "Diplomatic Connection"}: reroll with ${dice} ${dice === 1 ? "die" : "dice"} [${reroll.values.join(", ")}], ${reroll.outcome}.`;
      }
      if (check.context === "trade") {
        const resolved = resolveTradeCheck(next, check);
        return { state: resolved.state, summary: `${summary} ${resolved.note}`, rngRolls: rolls };
      }
      const resolved = resolveDeployCheck(next, check);
      return { state: resolved.state, summary: `${summary} ${resolved.summary}`, details: resolved.details, rngRolls: [...rolls, ...resolved.rolls] };
    }
    case "approveAlliance":
    case "refuseAlliance": {
      if (interrupt.kind !== "allianceConsent") break;
      const name = localAlliances.find((alliance) => alliance.id === interrupt.allianceId)!.name;
      const cleared = withCo(state, { interrupt: undefined });
      return payload.action === "approveAlliance"
        ? { state: buyAlliance(cleared, interrupt.presidency, interrupt.allianceId), summary: `The President approved buying ${name}.` }
        : { state: cleared, summary: `The President refused to pay for ${name}.` };
    }
    case "hireChina": {
      if (interrupt.kind !== "chinaHire") break;
      const chairman = chairmanHolder(state);
      const otherCandidates = writerCandidates(state).some((candidate) => candidate.playerId !== chairman);
      if (payload.playerId === chairman && otherCandidates) {
        return {
          state: withCo(state, { interrupt: { kind: "chinaHireConsent", candidate: { playerId: payload.playerId, presidency: payload.presidency } } }),
          summary: "The Chairman proposed their own writer as Superintendent of Trade in China.",
        };
      }
      return hireChinaWriter(state, payload.playerId, payload.presidency);
    }
    case "chinaConsent": {
      if (interrupt.kind !== "chinaHireConsent") break;
      if (payload.accepted) return hireChinaWriter(state, interrupt.candidate.playerId, interrupt.candidate.presidency);
      return {
        state: withCo(state, { interrupt: { kind: "chinaHire", selfRefused: true } }),
        summary: "Nepotism consent refused; the Chairman must hire another family's writer.",
      };
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
      const others = Object.entries(state.company.armies[payload.army].officers).some(
        ([playerId, stack]) => playerId !== pm && stack.ready + stack.exhausted > 0,
      );
      if (payload.playerId === pm && others) {
        return {
          state: withCo(state, { interrupt: { kind: "militaryOversight", stage: "nepotism", army: payload.army, candidate: payload.playerId } }),
          summary: "The Prime Minister proposed their own officer as Commander.",
        };
      }
      return appointByOversight(state, payload.army, payload.playerId);
    }
    case "oversightConsent": {
      if (interrupt.kind !== "militaryOversight" || interrupt.stage !== "nepotism") break;
      if (payload.accepted) return appointByOversight(state, interrupt.army, interrupt.candidate);
      return {
        state: withCo(state, { interrupt: { kind: "militaryOversight", stage: "appoint", army: interrupt.army, selfRefused: true } }),
        summary: "Nepotism consent refused; the Prime Minister must appoint another family's officer.",
      };
    }
  }
  throw new Error(`Interrupt command ${payload.action} does not match the pending interrupt.`);
};

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

function hireChinaWriter(state: GameState, playerId: PlayerId, presidency: PresidencyId): StepResult {
  const box = state.india.presidencies[presidency];
  const office = state.company.offices[CHINA_OFFICE_ID];
  const next: GameState = {
    ...state,
    india: {
      ...state.india,
      presidencies: {
        ...state.india.presidencies,
        [presidency]: { ...box, writers: { ...box.writers, [playerId]: (box.writers[playerId] ?? 0) - 1 } },
      },
    },
    company: {
      ...state.company,
      offices: {
        ...state.company.offices,
        [CHINA_OFFICE_ID]: { ...office, holder: playerId, familyMemberId: `china-writer-${playerId}-t${state.turn}`, vacant: false, created: true },
      },
      vacantOffices: state.company.vacantOffices.filter((officeId) => officeId !== CHINA_OFFICE_ID),
    },
  };
  return {
    state: withCo(next, { interrupt: undefined }),
    summary: `${playerName(state, playerId)} became Superintendent of Trade in China.`,
  };
}
