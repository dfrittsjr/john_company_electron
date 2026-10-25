// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  effectiveDecisionActor,
  isAutomaticDecision,
  runAutomaticSteps,
  systemDecisionDelegate,
  type GameState,
} from "../../engine";
import { BLUE, negotiationGame, RED, YELLOW } from "../fixtures/negotiation";

const NOW = "2026-10-25T12:00:00.000Z";

describe("automatic steps", () => {
  it("applies single-option system steps until a player must decide", () => {
    const start = negotiationGame("bonuses");
    expect(isAutomaticDecision(start.pendingDecision)).toBe(true);

    const result = runAutomaticSteps(start, { now: NOW, idPrefix: "auto" });
    expect(result.errors).toBeUndefined();
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.commands.every((command) => command.actorId === "system")).toBe(true);
    expect(result.commands[0]).toMatchObject({ id: "auto-1", type: "bonuses.confirm", decisionId: start.pendingDecision.id });
    expect(isAutomaticDecision(result.state.pendingDecision)).toBe(false);
    expect(result.state.log.length).toBeGreaterThan(start.log.length);
  });

  it("leaves a player's decision alone", () => {
    const start = negotiationGame("family");
    const result = runAutomaticSteps(start, { now: NOW, idPrefix: "auto" });
    expect(result.commands).toEqual([]);
    expect(result.state).toBe(start);
  });

  it("stops at the step limit", () => {
    const start = negotiationGame("bonuses");
    const result = runAutomaticSteps(start, { now: NOW, idPrefix: "auto", maxSteps: 0 });
    expect(result.errors?.[0].code).toBe("AUTOMATIC_STEP_LIMIT");
    expect(result.state).toBe(start);
  });

  it("never takes a system decision with a real choice; it names a player for it", () => {
    const base = negotiationGame("revenue");
    const state: GameState = {
      ...base,
      company: { ...base.company, chairmanMarker: YELLOW },
      pendingDecision: {
        id: "decision-revenue-dividends-test",
        phase: "revenue",
        step: "revenue.chooseDividends",
        actor: "system",
        visibility: "public",
        prompt: "No Chairman is in office; choose Revenue dividends.",
        legalCommands: [
          { type: "revenue.chooseDividends", label: "Pay No Dividends", payload: { amountPerShare: 0 } },
          { type: "revenue.chooseDividends", label: "Pay 1 Dividend", payload: { amountPerShare: 1 } },
        ],
        canSave: true,
      },
    };
    expect(isAutomaticDecision(state.pendingDecision)).toBe(false);
    expect(runAutomaticSteps(state, { now: NOW, idPrefix: "auto" }).commands).toEqual([]);
    expect(systemDecisionDelegate(state)).toBe(YELLOW);
    expect(effectiveDecisionActor(state)).toBe(YELLOW);

    // Without a Chairman title holder, the first seat answers.
    const noMarker = { ...state, company: { ...state.company, chairmanMarker: undefined } };
    expect(systemDecisionDelegate(noMarker)).toBe(state.seatingOrder[0]);
  });

  it("asks a family with officers in the Army for Military Oversight nepotism consent", () => {
    const base = negotiationGame("companyOperation");
    const state: GameState = {
      ...base,
      parliament: { ...base.parliament, primeMinister: RED },
      company: {
        ...base.company,
        armies: {
          ...base.company.armies,
          Bombay: { ...base.company.armies.Bombay, officers: { [RED]: { ready: 1, exhausted: 0 }, [YELLOW]: { ready: 1, exhausted: 0 } } },
        },
      },
      companyOperation: { ...base.companyOperation, interrupt: { kind: "militaryOversight", stage: "nepotism", army: "Bombay", candidate: RED } },
      pendingDecision: {
        id: "decision-oversight-test",
        phase: "companyOperation",
        step: "companyOperation.militaryOversight",
        actor: "system",
        visibility: "public",
        prompt: "Nepotism (p.14): do the other families with officers in that Army consent?",
        legalCommands: [
          { type: "companyOperation.interrupt", label: "Everyone consents", payload: { action: "oversightConsent", accepted: true } },
          { type: "companyOperation.interrupt", label: "Someone refuses", payload: { action: "oversightConsent", accepted: false } },
        ],
        canSave: true,
      },
    };
    expect(systemDecisionDelegate(state)).toBe(YELLOW);
    expect(systemDecisionDelegate(state)).not.toBe(BLUE);
  });

  it("has no delegate for a player's own decision", () => {
    expect(systemDecisionDelegate(negotiationGame("family"))).toBeUndefined();
    expect(effectiveDecisionActor(negotiationGame("family"))).toBe(RED);
  });
});
