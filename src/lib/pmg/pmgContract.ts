/**
 * PMG.1A — Shared Project Mutation Gateway result contract.
 *
 * This module defines the TypeScript mirror of the SQL envelope produced by
 * `public.pmg_build_result` and the frozen status vocabulary declared by
 * `public.pmg_command_status`.
 *
 * It intentionally contains NO Supabase caller, NO command dispatcher, and
 * NO React hook. Those belong to later PMG steps.
 */

export const PMG_COMMAND_STATUSES = [
  "ready",
  "applied",
  "no_change",
  "confirmation_required",
  "conflict",
  "blocked",
  "not_authorized",
  "invalid",
] as const;

export type PmgCommandStatus = (typeof PMG_COMMAND_STATUSES)[number];

/**
 * PMG.1B — Trusted source channels. Mirrors `public.pmg_source_channel`.
 * Order must match the SQL enum exactly.
 */
export const PMG_SOURCE_CHANNELS = [
  "btpm_ui",
  "admin_import",
  "external_api",
  "mcp",
  "background_job",
  "btpm_internal",
] as const;

export type PmgSourceChannel = (typeof PMG_SOURCE_CHANNELS)[number];

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

export interface PmgCommandResult {
  status: PmgCommandStatus;
  command: string;
  target_type: string | null;
  target_id: string | null;
  project_id: string | null;
  data: JsonObject;
  changes: JsonArray;
  warnings: JsonArray;
  confirmations: JsonArray;
  conflict: JsonObject | null;
}

class PmgContractError extends Error {
  constructor(message: string) {
    super(`PMG result contract violation: ${message}`);
    this.name = "PmgContractError";
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new PmgContractError(`${field} must be a string or null`);
  }
  return value;
}

/**
 * Validate an unknown value against the PMG result envelope and return a
 * strongly typed `PmgCommandResult`. Throws `PmgContractError` when the
 * server response deviates from the frozen contract.
 */
export function parsePmgCommandResult(input: unknown): PmgCommandResult {
  if (!isPlainObject(input)) {
    throw new PmgContractError("result must be a JSON object");
  }

  const status = input.status;
  if (
    typeof status !== "string" ||
    !(PMG_COMMAND_STATUSES as readonly string[]).includes(status)
  ) {
    throw new PmgContractError(
      `status must be one of: ${PMG_COMMAND_STATUSES.join(", ")}`,
    );
  }

  const command = input.command;
  if (typeof command !== "string" || command.trim() === "") {
    throw new PmgContractError("command must be a non-empty string");
  }

  const target_type = assertNullableString(input.target_type, "target_type");
  const target_id = assertNullableString(input.target_id, "target_id");
  const project_id = assertNullableString(input.project_id, "project_id");

  const data = input.data;
  if (!isPlainObject(data)) {
    throw new PmgContractError("data must be a JSON object");
  }

  const changes = input.changes;
  if (!Array.isArray(changes)) {
    throw new PmgContractError("changes must be an array");
  }
  const warnings = input.warnings;
  if (!Array.isArray(warnings)) {
    throw new PmgContractError("warnings must be an array");
  }
  const confirmations = input.confirmations;
  if (!Array.isArray(confirmations)) {
    throw new PmgContractError("confirmations must be an array");
  }

  const conflict = input.conflict;
  let conflictValue: JsonObject | null;
  if (conflict === null || conflict === undefined) {
    conflictValue = null;
  } else if (isPlainObject(conflict)) {
    conflictValue = conflict;
  } else {
    throw new PmgContractError("conflict must be null or a JSON object");
  }

  return {
    status: status as PmgCommandStatus,
    command,
    target_type,
    target_id,
    project_id,
    data,
    changes,
    warnings,
    confirmations,
    conflict: conflictValue,
  };
}
