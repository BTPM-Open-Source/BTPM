// BTPM — Wave C2, Step C2.5
// Shared, deterministic, pure KPI App payload builder.
//
// Responsibilities:
//   - Convert one decrypted outbox-source bundle (from
//     public.get_kpi_app_payload_source) into the external KPI App payload:
//         { generated: { value: [ ...rows ] } }
//   - Produce a deterministic SHA-256 payload hash over the canonical JSON
//     form of the payload.
//   - Produce a compact, NON-SECRET payload summary (no decrypted comments,
//     action plans, or string values).
//   - Resolve entered_by_email per mapping rule.
//   - Map numeric vs text value handling.
//   - Map comment / action_plan source rules.
//   - Provide a deterministic daily-expansion helper that does NOT write
//     anything to BTPM and is NOT activated by UI in C2.5.
//
// This module is pure: no I/O, no DB calls, no fetch, no secrets.
// It is intended to be reused by C2.6 connector, C2.9 Report Now,
// C2.10 retry, and C2.11 scheduler.

// -----------------------------------------------------------------------------
// Types — local to Supabase functions; intentionally NOT added to frontend.
// -----------------------------------------------------------------------------

export type SourceValueType = "percent" | "number" | "currency" | "text";

export type EnteredByEmailSource =
  | "submitted_by_user"
  | "snapshot_created_by"
  | "configured_user";

export type CommentSource = "snapshot" | "empty";
export type ActionPlanSource = "snapshot" | "empty";

export interface PayloadSourceBundle {
  outbox: {
    id: string;
    organization_id: string;
    workspace_id: string;
    project_id: string;
    mapping_id: string;
    kpi_definition_id: string;
    source_snapshot_id: string;
    reporting_period_start: string; // ISO date
    reporting_period_end: string;   // ISO date
    validity_date: string;          // ISO date
    source_value_type: SourceValueType;
    source_value_amount: number | null;
    source_string_value: string | null;
    source_comment: string | null;
    source_action_plan: string | null;
    submission_mode: string;
    status: string;
    carry_forward_used: boolean;
    submitted_by: string | null;
  };
  mapping: {
    id: string;
    is_active: boolean;
    // Numeric IDs may arrive from SQL JSON as either number or numeric string
    // depending on driver behavior; the builder normalizes to positive integers.
    scenario_id: number | string;
    currency_id: number | string;
    external_kpi_id: number | string;
    reporting_frequency: string;
    entered_by_email_source: EnteredByEmailSource;
    entered_by_user_id: string | null;
    comment_source: CommentSource;
    action_plan_source: ActionPlanSource;
    carry_forward_allowed: boolean;
  };
  snapshot: {
    id: string;
    period_start: string;
    period_end: string;
    value_type: SourceValueType;
    value_amount: number | null;
    string_value: string | null;
    comment: string | null;
    action_plan: string | null;
    created_by: string | null;
    calculation_status: string | null;
  };
  snapshot_created_by_email: string | null;
  configured_user_email: string | null;
  caller_email: string | null;
}

export interface PayloadRow {
  kpi_id: number;
  validity_date: string;
  scenario_id: number;
  currency_id: number;
  entered_by_email: string;
  value_amount: number | null;
  string_value: string;
  comment: string;
  action_plan: string;
}

export interface BuiltPayload {
  generated: { value: PayloadRow[] };
}

export interface PayloadSummary {
  row_count: number;
  kpi_ids: number[];
  validity_dates: string[];
  value_types: SourceValueType[];
  mapping_id: string;
  source_snapshot_id: string;
  reporting_period_start: string;
  reporting_period_end: string;
  carry_forward_used: boolean;
}

export interface BuildOptions {
  /** When true, expand into one payload row per day in the reporting period.
   *  Default: false — single row using outbox.validity_date.
   *  This flag is NOT exposed to the frontend in C2.5. */
  dailyExpansion?: boolean;
}

export interface BuildResult {
  payload: BuiltPayload;
  payload_hash: string;          // sha256 hex
  payload_row_count: number;
  payload_summary: PayloadSummary;
  carry_forward_used: boolean;
}

// -----------------------------------------------------------------------------
// Resolution helpers
// -----------------------------------------------------------------------------

export function resolveEnteredByEmail(b: PayloadSourceBundle): string {
  const src = b.mapping.entered_by_email_source;
  let email: string | null = null;
  if (src === "submitted_by_user") {
    email = b.caller_email;
  } else if (src === "snapshot_created_by") {
    email = b.snapshot_created_by_email;
  } else if (src === "configured_user") {
    email = b.configured_user_email;
  }
  if (!email || typeof email !== "string" || email.trim() === "") {
    throw new Error(
      `entered_by_email could not be resolved for mapping ${b.mapping.id} (source=${src})`,
    );
  }
  return email.trim();
}

export function resolveValueFields(
  b: PayloadSourceBundle,
): { value_amount: number | null; string_value: string } {
  const t = b.outbox.source_value_type;
  if (t === "text") {
    return {
      value_amount: null,
      string_value: b.outbox.source_string_value ?? "",
    };
  }
  // percent / number / currency
  return {
    value_amount: b.outbox.source_value_amount,
    string_value: "",
  };
}

// Upstream KPI App MS SQL text columns are length-constrained and may be
// VARCHAR-backed, so the safe limit must be enforced in UTF-8 bytes rather
// than JavaScript characters. The observed KPI_Value_Comments.Comment_Text
// column rejects the earlier 250-byte cap, so keep outbound comment/action
// plan text to a conservative 50-byte envelope and use ASCII-only truncation
// punctuation to avoid multibyte overflow at the boundary.
export const KPI_APP_COMMENT_MAX_BYTES = 50;
export const KPI_APP_ACTION_PLAN_MAX_BYTES = 50;

const UPSTREAM_ENCODER = new TextEncoder();
const UPSTREAM_TRUNCATION_SUFFIX = "...";

function normalizeForUpstreamText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u2026/g, "...")
    .replace(/\u00f7/g, "/")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ");
}

function truncateForUpstream(value: string, maxBytes: number): string {
  const normalized = normalizeForUpstreamText(value);
  if (UPSTREAM_ENCODER.encode(normalized).length <= maxBytes) return normalized;

  const suffixBytes = UPSTREAM_ENCODER.encode(UPSTREAM_TRUNCATION_SUFFIX).length;
  const budget = Math.max(0, maxBytes - suffixBytes);
  let out = "";
  let used = 0;
  for (const ch of normalized) {
    const chBytes = UPSTREAM_ENCODER.encode(ch).length;
    if (used + chBytes > budget) break;
    out += ch;
    used += chBytes;
  }
  return out + UPSTREAM_TRUNCATION_SUFFIX;
}

function compactAutomaticSnapshotComment(b: PayloadSourceBundle, value: string): string {
  const normalized = normalizeForUpstreamText(value).trim();
  if (!normalized.startsWith("Automatic snapshot for ")) return normalized;

  // Automatic snapshot narratives are intentionally rich inside BTPM, but the
  // upstream KPI App comment column is small. Preserve traceability with a
  // deterministic compact marker; KPI identity and value are already sent in
  // the structured payload fields.
  return `Auto KPI snapshot ${b.outbox.validity_date}`;
}

export function resolveComment(b: PayloadSourceBundle): string {
  if (b.mapping.comment_source === "snapshot") {
    const compacted = compactAutomaticSnapshotComment(b, b.outbox.source_comment ?? "");
    return truncateForUpstream(compacted, KPI_APP_COMMENT_MAX_BYTES);
  }
  return "";
}

/**
 * Normalize a numeric KPI App ID (kpi_id / scenario_id / currency_id).
 * Accepts number or numeric-string from SQL JSON. Rejects null, empty,
 * non-numeric, non-integer, zero, and negative values with a controlled
 * error including the field name. Never silently coerces to 0 or a default.
 */
export function normalizePositiveIntegerId(
  value: unknown,
  fieldName: string,
): number {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Invalid ${fieldName}: missing value`);
  }
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || !/^-?\d+$/.test(trimmed)) {
      throw new Error(`Invalid ${fieldName}: not an integer (${value})`);
    }
    n = Number(trimmed);
  } else {
    throw new Error(`Invalid ${fieldName}: unsupported type (${typeof value})`);
  }
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${fieldName}: must be positive integer (${value})`);
  }
  return n;
}

export function resolveActionPlan(b: PayloadSourceBundle): string {
  if (b.mapping.action_plan_source === "snapshot") {
    return truncateForUpstream(b.outbox.source_action_plan ?? "", KPI_APP_ACTION_PLAN_MAX_BYTES);
  }
  return "";
}

// -----------------------------------------------------------------------------
// Daily expansion helper (deterministic, no I/O)
// -----------------------------------------------------------------------------

export function expandDailyDates(
  startIso: string,
  endIso: string,
): string[] {
  const start = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    throw new Error(`Invalid reporting period: ${startIso} -> ${endIso}`);
  }
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Canonical JSON + SHA-256 hash
// -----------------------------------------------------------------------------

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function computePayloadHash(payload: BuiltPayload): Promise<string> {
  return await sha256Hex(canonicalize(payload));
}

// -----------------------------------------------------------------------------
// Main builder
// -----------------------------------------------------------------------------

export async function buildKpiAppPayload(
  bundle: PayloadSourceBundle,
  opts: BuildOptions = {},
): Promise<BuildResult> {
  // Defensive guards — never trust upstream caller fully.
  if (!bundle?.outbox || !bundle?.mapping || !bundle?.snapshot) {
    throw new Error("Invalid payload source bundle");
  }
  if (!bundle.mapping.is_active) {
    throw new Error(`Mapping ${bundle.mapping.id} is inactive`);
  }
  // Defense-in-depth: schedule_signal must never be submittable; outbox
  // validator already rejects this, but never bypass it here either.
  if ((bundle as any).outbox?.calculation_key === "schedule_signal") {
    throw new Error("schedule_signal is not submittable");
  }

  const enteredByEmail = resolveEnteredByEmail(bundle);
  const { value_amount, string_value } = resolveValueFields(bundle);
  const comment = resolveComment(bundle);
  const actionPlan = resolveActionPlan(bundle);

  const kpiIdNum = normalizePositiveIntegerId(
    bundle.mapping.external_kpi_id,
    "external_kpi_id",
  );
  const scenarioIdNum = normalizePositiveIntegerId(
    bundle.mapping.scenario_id,
    "scenario_id",
  );
  const currencyIdNum = normalizePositiveIntegerId(
    bundle.mapping.currency_id,
    "currency_id",
  );

  const baseRow: Omit<PayloadRow, "validity_date"> = {
    kpi_id: kpiIdNum,
    scenario_id: scenarioIdNum,
    currency_id: currencyIdNum,
    entered_by_email: enteredByEmail,
    value_amount,
    string_value,
    comment,
    action_plan: actionPlan,
  };

  let dates: string[];
  if (opts.dailyExpansion) {
    dates = expandDailyDates(
      bundle.outbox.reporting_period_start,
      bundle.outbox.reporting_period_end,
    );
  } else {
    dates = [bundle.outbox.validity_date];
  }

  const rows: PayloadRow[] = dates.map((d) => ({ ...baseRow, validity_date: d }));
  const payload: BuiltPayload = { generated: { value: rows } };
  const payload_hash = await computePayloadHash(payload);

  const summary: PayloadSummary = {
    row_count: rows.length,
    kpi_ids: Array.from(new Set(rows.map((r) => r.kpi_id))),
    validity_dates: dates,
    value_types: [bundle.outbox.source_value_type],
    mapping_id: bundle.mapping.id,
    source_snapshot_id: bundle.outbox.source_snapshot_id,
    reporting_period_start: bundle.outbox.reporting_period_start,
    reporting_period_end: bundle.outbox.reporting_period_end,
    carry_forward_used: bundle.outbox.carry_forward_used === true,
  };

  return {
    payload,
    payload_hash,
    payload_row_count: rows.length,
    payload_summary: summary,
    carry_forward_used: summary.carry_forward_used,
  };
}
