import type { ActorId, GameLogEntry, GameState, PhaseId } from "../engine";

export const SAVE_FILE_TYPE = "john-company-2e-save";
export const SAVE_SCHEMA_VERSION = 1;
export const DEFAULT_APP_VERSION = "0.1.0";
export const DEFAULT_RULESET_VERSION = "john-company-2e-data-1";

export type SaveChecksums = {
  stateSha256: string;
  dataSha256: string;
};

export type SaveEnvelope<TState = GameState> = {
  fileType: typeof SAVE_FILE_TYPE;
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  appVersion: string;
  rulesetVersion: string;
  createdAt: string;
  savedAt: string;
  gameId: string;
  saveId: string;
  parentSaveId: string | null;
  turn: number;
  phase: PhaseId;
  activeActor: ActorId | "simultaneous";
  pendingDecisionId: string;
  hiddenInfoMode: GameState["hidden"]["mode"];
  state: TState;
  log: GameLogEntry[];
  checksums: SaveChecksums;
};

export type CreateSaveEnvelopeOptions = {
  appVersion?: string;
  rulesetVersion?: string;
  saveId: string;
  parentSaveId?: string | null;
  now?: string;
};

export type SaveValidationErrorDetail = {
  code: string;
  message: string;
  field?: string;
};
