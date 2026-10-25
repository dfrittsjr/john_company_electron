// Read-only helpers that turn firm and Deregulation state into things the UI draws (rulebook
// pp.36-42). No game rules live here; the Vote to Deregulate rule is mirrored from p.36 only to
// say whether the vote can or must be called.

import { companyTracks, scenarios } from "../data";
import { firmById, firmName, isDeregulated, type FirmId, type GameState, type OrderState } from "../engine";

export type DeregulationStatus = {
  kind: "deregulated" | "unavailable" | "must" | "may" | "not-yet";
  /** Short text for the header strip. */
  summary: string;
  /** One or two sentences for the Laws tab. */
  detail: string;
};

function standingSpace(game: GameState) {
  return companyTracks.standing[game.company.standing];
}

function debtSpace(game: GameState) {
  return companyTracks.debt.find((space) => space.value === game.company.debt);
}

export function deregulationAvailable(game: GameState): boolean {
  return scenarios.find((scenario) => scenario.id === game.scenario)?.deregulationAvailable ?? false;
}

export function deregulationStatus(game: GameState): DeregulationStatus {
  if (isDeregulated(game)) {
    return {
      kind: "deregulated",
      summary: "Deregulated",
      detail: "The Company is deregulated. Players may form and manage firms in the Firms phase (pp.37-42).",
    };
  }
  if (!deregulationAvailable(game)) {
    return { kind: "unavailable", summary: "Not in play", detail: "This scenario has no Deregulation." };
  }
  const standing = standingSpace(game);
  const debt = debtSpace(game);
  const lined = Boolean(standing?.lined || debt?.lined);
  const starred = Boolean(standing?.star || debt?.star);
  const where = [standing?.lined ? `Standing (${standing.label})` : null, debt?.lined ? `Debt (${debt.value})` : null]
    .filter(Boolean)
    .join(" and ");
  if (starred) {
    return {
      kind: "must",
      summary: "Vote required",
      detail: `${where} is on a lined space and one is starred: at the start of the turn the Prime Minister must call a Vote to Deregulate (p.36).`,
    };
  }
  if (lined) {
    return {
      kind: "may",
      summary: "Vote may be called",
      detail: `${where} is on a lined space: at the start of the turn the Prime Minister may call a Vote to Deregulate (p.36).`,
    };
  }
  return {
    kind: "not-yet",
    summary: "Not yet",
    detail:
      "Not deregulated. The Prime Minister may call a Vote to Deregulate when Standing or Debt reaches a lined space, and must when one reaches a starred space (p.36).",
  };
}

/** Victory points per share as the charter prints them: -1, 0, ½, 1, 1½, 2. */
export function formatVictoryPoints(points: number): string {
  const sign = points < 0 ? "-" : "";
  const abs = Math.abs(points);
  const whole = Math.floor(abs);
  const half = abs - whole >= 0.5;
  if (whole === 0) return half ? `${sign}½` : "0";
  return `${sign}${whole}${half ? "½" : ""}`;
}

/** Who filled an order this turn, for its tooltip and its board mark. */
export function orderFillers(game: GameState, order: OrderState): { company: boolean; firms: string[] } {
  const firms = order.filledThisTurnBy
    .filter((who): who is FirmId => who !== "company")
    .map((id) => {
      const firm = firmById(game, id);
      return firm ? firmName(game, firm) : id;
    });
  return { company: order.filledThisTurnBy.includes("company"), firms };
}

export function describeFillers(fillers: { company: boolean; firms: string[] }): string {
  return [fillers.company ? "the Company" : null, ...fillers.firms].filter(Boolean).join(", ");
}
