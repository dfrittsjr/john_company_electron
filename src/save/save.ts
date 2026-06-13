import type { GameState } from "../engine";
import { checksumJson, stableStringify } from "./checksum";
import {
  DEFAULT_APP_VERSION,
  DEFAULT_RULESET_VERSION,
  SAVE_FILE_TYPE,
  SAVE_SCHEMA_VERSION,
  type CreateSaveEnvelopeOptions,
  type SaveEnvelope,
  type SaveValidationErrorDetail,
} from "./types";

export class SaveValidationError extends Error {
  readonly errors: SaveValidationErrorDetail[];

  constructor(errors: SaveValidationErrorDetail[]) {
    super(errors.map((error) => error.message).join("; "));
    this.name = "SaveValidationError";
    this.errors = errors;
  }
}

export function createSaveEnvelope(
  state: GameState,
  options: CreateSaveEnvelopeOptions,
): SaveEnvelope {
  const rulesetVersion = options.rulesetVersion ?? DEFAULT_RULESET_VERSION;
  const savedAt = options.now ?? new Date().toISOString();

  return {
    fileType: SAVE_FILE_TYPE,
    schemaVersion: SAVE_SCHEMA_VERSION,
    appVersion: options.appVersion ?? DEFAULT_APP_VERSION,
    rulesetVersion,
    createdAt: state.createdAt,
    savedAt,
    gameId: state.gameId,
    saveId: options.saveId,
    parentSaveId: options.parentSaveId ?? null,
    turn: state.turn,
    phase: state.phase,
    activeActor: state.pendingDecision.actor,
    pendingDecisionId: state.pendingDecision.id,
    hiddenInfoMode: state.hidden.mode,
    state,
    log: state.log,
    checksums: {
      stateSha256: checksumGameState(state),
      dataSha256: checksumRuleset(rulesetVersion),
    },
  };
}

export function serializeSave(state: GameState, options: CreateSaveEnvelopeOptions): string;
export function serializeSave(envelope: SaveEnvelope): string;
export function serializeSave(
  stateOrEnvelope: GameState | SaveEnvelope,
  options?: CreateSaveEnvelopeOptions,
): string {
  const envelope =
    isSaveEnvelope(stateOrEnvelope) ? stateOrEnvelope : createSaveEnvelope(stateOrEnvelope, requireOptions(options));

  return `${stableStringify(envelope)}\n`;
}

export function deserializeSave(serialized: string): SaveEnvelope {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new SaveValidationError([
      {
        code: "INVALID_JSON",
        message: "Save file is not valid JSON.",
      },
    ]);
  }

  const envelope = parsed as SaveEnvelope;
  const errors = validateSaveEnvelope(envelope);

  if (errors.length > 0) {
    throw new SaveValidationError(errors);
  }

  return envelope;
}

export function deserializeGameState(serialized: string): GameState {
  return deserializeSave(serialized).state;
}

export function validateSaveEnvelope(envelope: SaveEnvelope): SaveValidationErrorDetail[] {
  const errors: SaveValidationErrorDetail[] = [];

  if (!envelope || typeof envelope !== "object") {
    return [
      {
        code: "INVALID_ENVELOPE",
        message: "Save file does not contain a JSON object envelope.",
      },
    ];
  }

  if (envelope.fileType !== SAVE_FILE_TYPE) {
    errors.push({
      code: "INVALID_FILE_TYPE",
      message: `Save fileType must be "${SAVE_FILE_TYPE}".`,
      field: "fileType",
    });
  }

  if (envelope.schemaVersion !== SAVE_SCHEMA_VERSION) {
    errors.push({
      code: "UNSUPPORTED_SAVE_SCHEMA",
      message: `Unsupported save schema version "${String(envelope.schemaVersion)}".`,
      field: "schemaVersion",
    });
  }

  if (!envelope.state || typeof envelope.state !== "object") {
    errors.push({
      code: "MISSING_STATE",
      message: "Save file does not include game state.",
      field: "state",
    });
  }

  if (!envelope.checksums || typeof envelope.checksums !== "object") {
    errors.push({
      code: "MISSING_CHECKSUMS",
      message: "Save file does not include checksums.",
      field: "checksums",
    });
  }

  if (errors.length > 0) {
    return errors;
  }

  const stateChecksum = checksumGameState(envelope.state);
  if (envelope.checksums.stateSha256 !== stateChecksum) {
    errors.push({
      code: "STATE_CHECKSUM_MISMATCH",
      message: "Save state checksum does not match the embedded state.",
      field: "checksums.stateSha256",
    });
  }

  const dataChecksum = checksumRuleset(envelope.rulesetVersion);
  if (envelope.checksums.dataSha256 !== dataChecksum) {
    errors.push({
      code: "DATA_CHECKSUM_MISMATCH",
      message: "Save ruleset checksum does not match the declared ruleset version.",
      field: "checksums.dataSha256",
    });
  }

  if (envelope.gameId !== envelope.state.gameId) {
    errors.push({
      code: "GAME_ID_MISMATCH",
      message: "Save envelope gameId does not match state.gameId.",
      field: "gameId",
    });
  }

  if (envelope.pendingDecisionId !== envelope.state.pendingDecision.id) {
    errors.push({
      code: "PENDING_DECISION_MISMATCH",
      message: "Save envelope pendingDecisionId does not match state.pendingDecision.id.",
      field: "pendingDecisionId",
    });
  }

  return errors;
}

export function checksumGameState(state: GameState): string {
  return checksumJson(state);
}

export function checksumRuleset(rulesetVersion = DEFAULT_RULESET_VERSION): string {
  return checksumJson({
    rulesetVersion,
    saveSchemaVersion: SAVE_SCHEMA_VERSION,
  });
}

function isSaveEnvelope(value: GameState | SaveEnvelope): value is SaveEnvelope {
  return (value as SaveEnvelope).fileType === SAVE_FILE_TYPE;
}

function requireOptions(options: CreateSaveEnvelopeOptions | undefined): CreateSaveEnvelopeOptions {
  if (!options) {
    throw new Error("Save envelope options are required when serializing a GameState.");
  }

  return options;
}
