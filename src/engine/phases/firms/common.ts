import type { ApplyCommandResult, GameState, PlayerId } from "../../types";

// Small helpers shared by the Firms phase modules.

export function nameOf(state: GameState, playerId: PlayerId): string {
  return state.players[playerId]?.name ?? playerId;
}

export function rejectFirms(code: string, message: string, field?: string): ApplyCommandResult {
  return { ok: false, errors: [{ code, message, field }] };
}

function canonical(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Payload equality that ignores key order and undefined fields. */
export function sameJson(left: unknown, right: unknown): boolean {
  return canonical(left ?? {}) === canonical(right ?? {});
}

/** Ship Subsidy makes fitting a ship £2 instead of £3 (laws.ts, p.39 for firms). */
export function shipFitCost(state: GameState, base: number): number {
  return state.parliament.passedLaws.some((law) => law.lawId === "ship-subsidy") ? Math.max(0, base - 1) : base;
}
