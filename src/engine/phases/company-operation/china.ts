import { rollCheck } from "../../checks";
import { officeHolder } from "../../selectors";
import type { GameState, LegalCommand, PendingDecision } from "../../types";
import {
  CHINA_OFFICE_ID,
  addToCompanyBalance,
  coState,
  decisionId,
  isLawInEffect,
  payOfficeholderBonus,
  playerName,
  vacateAfterCatastrophe,
  withCo,
} from "./context";
import { finishOffice, type OperationStep } from "./step";

// Superintendent of Trade in China (p.25): acts after Bengal. One check per turn, one die per ship in
// the office, only if Company-controlled regions have export icons. Success: the Company Balance gains
// £4 per export icon in Company regions (£5 with Envoy to China) and the Superintendent takes £1 each.

export type ChinaPayload = { action: "trade" } | { action: "finish" };

export function chinaShips(state: GameState): number {
  return state.company.ships.filter((ship) => ship.location === "china").length;
}

export function companyExportIcons(state: GameState): number {
  return Object.values(state.india.regions)
    .filter((region) => region.companyControlled)
    .reduce((total, region) => total + region.exportIcons, 0);
}

function canTradeInChina(state: GameState): boolean {
  return !coState(state).chinaTradeAttempted && chinaShips(state) > 0 && companyExportIcons(state) > 0;
}

export function chinaDecision(state: GameState): PendingDecision {
  const commands: LegalCommand[] = [
    { type: "companyOperation.china", label: "Finish as Superintendent", payload: { action: "finish" } satisfies ChinaPayload },
  ];
  if (canTradeInChina(state)) {
    commands.unshift({
      type: "companyOperation.china",
      label: `Trade in China (${chinaShips(state)} ${chinaShips(state) === 1 ? "die" : "dice"}, ${companyExportIcons(state)} export icons)`,
      payload: { action: "trade" } satisfies ChinaPayload,
    });
  }

  return {
    id: decisionId(state, "company-operation-china"),
    phase: "companyOperation",
    step: "companyOperation.china",
    actor: officeHolder(state, CHINA_OFFICE_ID) ?? "system",
    visibility: "public",
    prompt: "Superintendent of Trade in China: trade once, or finish.",
    legalCommands: commands,
    canSave: true,
  };
}

export const chinaStep: OperationStep = (state, command) => {
  const payload = command.payload as ChinaPayload;
  if (payload.action === "finish") {
    return { state: finishOffice(state, CHINA_OFFICE_ID), summary: "The Superintendent of Trade in China finished." };
  }

  const dice = chinaShips(state);
  const icons = companyExportIcons(state);
  const check = rollCheck(state.rng, dice, "companyOperation.tradeInChina");
  let next: GameState = withCo({ ...state, rng: check.rng }, { chinaTradeAttempted: true });
  const head = `Trade in China with ${dice} ${dice === 1 ? "die" : "dice"} [${check.values.join(", ")}]: ${check.outcome}.`;
  const rngRolls = check.roll ? [check.roll] : undefined;

  if (check.outcome === "success") {
    const perIcon = isLawInEffect(next, "envoy-to-china") ? 5 : 4;
    next = addToCompanyBalance(next, perIcon * icons);
    next = payOfficeholderBonus(next, CHINA_OFFICE_ID, icons).state;
    return {
      state: finishOffice(next, CHINA_OFFICE_ID),
      summary: `${head} The Company Balance gains £${perIcon * icons}; the Superintendent takes £${icons}.`,
      rngRolls,
    };
  }
  if (check.outcome === "catastrophe") {
    const holder = officeHolder(state, CHINA_OFFICE_ID);
    return {
      state: finishOffice(vacateAfterCatastrophe(next, CHINA_OFFICE_ID), CHINA_OFFICE_ID),
      summary: `${head} ${playerName(state, holder)}'s Superintendent returns to supply.`,
      rngRolls,
    };
  }
  return { state: finishOffice(next, CHINA_OFFICE_ID), summary: head, rngRolls };
};
