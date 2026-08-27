// API-HR.3 — Multi-Principal Direct-Read Probe Harness (read-only operator tool).
//
// Verifies whether known authorized and unauthorized rows are visible to each
// authenticated context via DIRECT PostgREST reads only.
//
// Hard rules enforced by this file:
//   - GET /rest/v1/<table> only. No RPC, no Edge Function, no custom URL.
//   - No mutation method, ever.
//   - No service-role principal, no service-role key.
//   - Secrets are referenced by environment-variable NAME only.
//   - A non-zero row count is never, by itself, treated as a defect. Only an
//     exact mismatch against explicitly declared expected identifier sets is.
//   - Output never contains tokens, the anon key, Authorization headers, JWT
//     payloads, complete response rows, decrypted text or env values.
//
// JWT payload inspection is a CONFIGURATION PRECONDITION ONLY. It is not
// signature verification and establishes no authority or authorization
// evidence whatsoever.

export const PROBE_CONFIG_SCHEMA = "api_hr_multi_principal_probe_v1";
export const PROBE_RESULT_SCHEMA = "api_hr_multi_principal_probe_result_v1";

export const REQUIRED_PRINCIPAL_SCENARIOS = [
  "anonymous",
  "ordinary_org_admin",
  "ordinary_workspace_admin",
  "ordinary_project_member",
  "ordinary_same_org_non_member",
  "ordinary_cross_org",
  "ordinary_removed_membership",
  "ordinary_deactivated_user",
  "external_oauth",
] as const;

export type PrincipalScenario = (typeof REQUIRED_PRINCIPAL_SCENARIOS)[number];

export const PRINCIPAL_TYPES = [
  "anonymous",
  "ordinary_browser",
  "external_oauth",
] as const;

export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const CLASSIFICATIONS = [
  "pm_business_data",
  "identity_membership_control",
  "server_only",
  "explicitly_public",
] as const;

export type ProbeClassification = (typeof CLASSIFICATIONS)[number];

/** Classifications that must never be directly visible to contained principals. */
const PROTECTED_CLASSIFICATIONS: ProbeClassification[] = [
  "pm_business_data",
  "identity_membership_control",
  "server_only",
];

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATE_IDS = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

const SENSITIVE_COLUMN_TERMS = [
  "_encrypted",
  "secret",
  "password",
  "credential",
  "token",
  "key_material",
  "content_bytes",
  "base64",
];

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PrincipalConfig {
  scenario: string;
  type: string;
  /** Environment-variable NAME holding the bearer token. Omitted for anonymous. */
  token_env?: string;
}

export interface ProbeDefinition {
  probe_key: string;
  table: string;
  classification: string;
  identifier_column: string;
  safe_columns: string[];
  candidate_ids: string[];
  /** Exact expected visible identifiers, keyed by principal scenario. */
  expected_visible_ids: Record<string, string[]>;
}

export interface CoverageDeclaration {
  tenant_ids: string[];
  organization_ids: string[];
  workspace_ids: string[];
  project_ids: string[];
}

export interface ProbeConfig {
  schema: string;
  supabase_url_env: string;
  supabase_anon_key_env: string;
  timeout_ms?: number;
  coverage: CoverageDeclaration;
  principals: PrincipalConfig[];
  probes: ProbeDefinition[];
}

export type ProbeOutcome = "passed" | "failed" | "blocked";

export interface ProbeResultEntry {
  principal_scenario: string;
  principal_type: string;
  probe_key: string;
  table: string;
  classification: string;
  http_status: number | null;
  outcome: ProbeOutcome;
  returned_ids: string[];
  unexpected_ids: string[];
  missing_expected_ids: string[];
  reason_code: string;
}

export interface ProbeRunResult {
  schema: typeof PROBE_RESULT_SCHEMA;
  config_schema: string;
  started_at: string;
  completed_at: string;
  summary: {
    passed: number;
    failed: number;
    blocked: number;
    total: number;
  };
  results: ProbeResultEntry[];
}

export class ProbeConfigError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "ProbeConfigError";
  }
}

// -----------------------------------------------------------------------------
// Configuration validation
// -----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Closed-schema guard: reject any property that is not explicitly declared.
 * Rejected property VALUES are never echoed — only a safe error code is raised.
 */
function assertExactKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new ProbeConfigError(code);
    }
  }
}

const ALLOWED_CONFIG_KEYS = [
  "schema",
  "supabase_url_env",
  "supabase_anon_key_env",
  "timeout_ms",
  "coverage",
  "principals",
  "probes",
] as const;

const ALLOWED_COVERAGE_KEYS = [
  "tenant_ids",
  "organization_ids",
  "workspace_ids",
  "project_ids",
] as const;

const ALLOWED_PRINCIPAL_KEYS = ["scenario", "type", "token_env"] as const;

const ALLOWED_PROBE_KEYS = [
  "probe_key",
  "table",
  "classification",
  "identifier_column",
  "safe_columns",
  "candidate_ids",
  "expected_visible_ids",
] as const;


function requireIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !SQL_IDENTIFIER.test(value)) {
    throw new ProbeConfigError(code);
  }
  return value;
}

function requireEnvName(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw new ProbeConfigError(code);
  }
  return value;
}

function assertNoInlineSecret(value: unknown, code: string): void {
  if (typeof value !== "string") return;
  // A JWT-shaped or long opaque value in configuration is always rejected.
  if (value.split(".").length === 3 || value.length > 120) {
    throw new ProbeConfigError(code);
  }
}

function validateColumn(column: unknown): string {
  const name = requireIdentifier(column, "invalid_column_identifier");
  if (name === "*") throw new ProbeConfigError("select_star_forbidden");
  const lower = name.toLowerCase();
  for (const term of SENSITIVE_COLUMN_TERMS) {
    if (lower.includes(term)) {
      throw new ProbeConfigError("sensitive_column_forbidden");
    }
  }
  return name;
}

function validateCoverage(raw: unknown): CoverageDeclaration {
  if (!isPlainObject(raw)) throw new ProbeConfigError("coverage_missing");
  assertExactKeys(raw, ALLOWED_COVERAGE_KEYS, "undeclared_coverage_property");

  const read = (key: keyof CoverageDeclaration): string[] => {
    const value = raw[key];
    if (!Array.isArray(value) || value.length < 2) {
      throw new ProbeConfigError(`coverage_insufficient_${key}`);
    }
    const ids = value.map((id) => {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
        throw new ProbeConfigError(`coverage_invalid_${key}`);
      }
      return id;
    });
    if (new Set(ids).size !== ids.length) {
      throw new ProbeConfigError(`coverage_duplicate_${key}`);
    }
    return ids;
  };
  return {
    tenant_ids: read("tenant_ids"),
    organization_ids: read("organization_ids"),
    workspace_ids: read("workspace_ids"),
    project_ids: read("project_ids"),
  };
}

/**
 * Decode a JWT payload for configuration preflight only.
 * NOT signature verification. NOT authorization evidence.
 */
export function inspectJwtPayloadForPreflight(
  token: string,
): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ProbeConfigError("token_not_jwt_shaped");
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    if (!isPlainObject(payload)) {
      throw new ProbeConfigError("token_payload_invalid");
    }
    return payload;
  } catch (error) {
    if (error instanceof ProbeConfigError) throw error;
    throw new ProbeConfigError("token_payload_invalid");
  }
}

function assertPrincipalTokenShape(
  principal: PrincipalConfig,
  token: string,
): void {
  const payload = inspectJwtPayloadForPreflight(token);
  const hasClientId = Object.prototype.hasOwnProperty.call(
    payload,
    "client_id",
  );
  if (principal.type === "ordinary_browser" && hasClientId) {
    throw new ProbeConfigError("ordinary_browser_token_has_client_id");
  }
  if (principal.type === "external_oauth") {
    const clientId = payload.client_id;
    // Must be a string and non-empty AFTER trimming. A whitespace-only value is
    // a blocked preflight, never a pass.
    if (typeof clientId !== "string" || clientId.trim().length === 0) {
      throw new ProbeConfigError("external_oauth_token_missing_client_id");
    }
  }
}

function validatePrincipals(raw: unknown): PrincipalConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProbeConfigError("principals_missing");
  }
  const principals: PrincipalConfig[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) throw new ProbeConfigError("principal_invalid");
    assertExactKeys(
      entry,
      ALLOWED_PRINCIPAL_KEYS,
      "undeclared_principal_property",
    );

    const scenario = entry.scenario;
    const type = entry.type;
    if (typeof type !== "string") {
      throw new ProbeConfigError("principal_type_invalid");
    }
    if (type === "service_role" || type.includes("service_role")) {
      throw new ProbeConfigError("service_role_principal_forbidden");
    }
    if (!(PRINCIPAL_TYPES as readonly string[]).includes(type)) {
      throw new ProbeConfigError("principal_type_invalid");
    }
    if (
      typeof scenario !== "string" ||
      !(REQUIRED_PRINCIPAL_SCENARIOS as readonly string[]).includes(scenario)
    ) {
      throw new ProbeConfigError("unknown_principal_scenario");
    }
    if (scenario === "anonymous" && type !== "anonymous") {
      throw new ProbeConfigError("principal_type_scenario_mismatch");
    }
    if (scenario === "external_oauth" && type !== "external_oauth") {
      throw new ProbeConfigError("principal_type_scenario_mismatch");
    }
    if (scenario.startsWith("ordinary_") && type !== "ordinary_browser") {
      throw new ProbeConfigError("principal_type_scenario_mismatch");
    }
    let tokenEnv: string | undefined;
    if (type === "anonymous") {
      if (entry.token_env !== undefined) {
        throw new ProbeConfigError("anonymous_principal_must_not_have_token");
      }
    } else {
      assertNoInlineSecret(entry.token_env, "inline_secret_forbidden");
      tokenEnv = requireEnvName(entry.token_env, "principal_token_env_invalid");
    }
    principals.push({ scenario, type, token_env: tokenEnv });
  }
  const scenarios = principals.map((p) => p.scenario);
  if (new Set(scenarios).size !== scenarios.length) {
    throw new ProbeConfigError("duplicate_principal_scenario");
  }
  for (const required of REQUIRED_PRINCIPAL_SCENARIOS) {
    if (!scenarios.includes(required)) {
      throw new ProbeConfigError(`missing_principal_scenario:${required}`);
    }
  }
  return principals;
}

function validateProbes(
  raw: unknown,
  principals: PrincipalConfig[],
): ProbeDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProbeConfigError("probes_missing");
  }
  const probes: ProbeDefinition[] = [];
  const keys = new Set<string>();
  for (const entry of raw) {
    if (!isPlainObject(entry)) throw new ProbeConfigError("probe_invalid");
    if (entry.url !== undefined || entry.rpc !== undefined) {
      throw new ProbeConfigError("custom_url_or_rpc_forbidden");
    }
    if (entry.method !== undefined) {
      throw new ProbeConfigError("mutation_method_forbidden");
    }
    assertExactKeys(entry, ALLOWED_PROBE_KEYS, "undeclared_probe_property");
    const probeKey = entry.probe_key;
    if (typeof probeKey !== "string" || probeKey.trim().length === 0) {
      throw new ProbeConfigError("probe_key_invalid");
    }
    if (keys.has(probeKey)) throw new ProbeConfigError("duplicate_probe_key");
    keys.add(probeKey);

    const table = requireIdentifier(entry.table, "invalid_table_identifier");

    const classification = entry.classification;
    if (
      typeof classification !== "string" ||
      !(CLASSIFICATIONS as readonly string[]).includes(classification)
    ) {
      throw new ProbeConfigError("invalid_classification");
    }
    const identifierColumn = validateColumn(entry.identifier_column);

    if (!Array.isArray(entry.safe_columns) || entry.safe_columns.length === 0) {
      throw new ProbeConfigError("safe_columns_missing");
    }
    if (entry.safe_columns.some((c) => c === "*")) {
      throw new ProbeConfigError("select_star_forbidden");
    }
    const safeColumns = entry.safe_columns.map(validateColumn);
    if (!safeColumns.includes(identifierColumn)) {
      throw new ProbeConfigError("identifier_column_not_selected");
    }

    if (!Array.isArray(entry.candidate_ids) || entry.candidate_ids.length === 0) {
      throw new ProbeConfigError("candidate_ids_missing");
    }
    if (entry.candidate_ids.length > MAX_CANDIDATE_IDS) {
      throw new ProbeConfigError("candidate_ids_exceed_bound");
    }
    const candidateIds = entry.candidate_ids.map((id) => {
      if (typeof id !== "string" || id.length === 0 || /[,()"]/.test(id)) {
        throw new ProbeConfigError("candidate_id_invalid");
      }
      return id;
    });
    if (new Set(candidateIds).size !== candidateIds.length) {
      throw new ProbeConfigError("duplicate_candidate_id");
    }

    if (!isPlainObject(entry.expected_visible_ids)) {
      throw new ProbeConfigError("expected_visible_ids_missing");
    }
    // Closed schema: only the nine required scenario keys are permitted.
    assertExactKeys(
      entry.expected_visible_ids,
      REQUIRED_PRINCIPAL_SCENARIOS,
      "unknown_principal_scenario",
    );
    const expected: Record<string, string[]> = {};
    for (const [scenario, ids] of Object.entries(entry.expected_visible_ids)) {
      if (!Array.isArray(ids)) {
        throw new ProbeConfigError("expected_visible_ids_invalid");
      }
      const list = ids.map((id) => {
        if (typeof id !== "string" || !candidateIds.includes(id)) {
          throw new ProbeConfigError("expected_id_outside_candidates");
        }
        return id;
      });
      if (new Set(list).size !== list.length) {
        throw new ProbeConfigError("duplicate_expected_id");
      }
      expected[scenario] = list;
    }

    // Every probe must explicitly declare all nine expectation sets, for every
    // classification. A missing scenario is NEVER inferred as empty; an empty
    // expectation must be written out as [].
    for (const required of REQUIRED_PRINCIPAL_SCENARIOS) {
      if (expected[required] === undefined) {
        throw new ProbeConfigError("missing_explicit_expectation");
      }
    }

    const isProtected = PROTECTED_CLASSIFICATIONS.includes(
      classification as ProbeClassification,
    );
    for (const principal of principals) {
      const declared = expected[principal.scenario] ?? [];
      if (declared.length === 0) continue;
      if (principal.type === "anonymous" && isProtected) {
        throw new ProbeConfigError("anonymous_must_expect_no_protected_rows");
      }
      if (principal.type === "external_oauth" && isProtected) {
        throw new ProbeConfigError("external_oauth_must_expect_no_protected_rows");
      }
      if (classification === "server_only") {
        throw new ProbeConfigError("server_only_must_expect_no_rows");
      }
    }


    probes.push({
      probe_key: probeKey,
      table,
      classification,
      identifier_column: identifierColumn,
      safe_columns: safeColumns,
      candidate_ids: candidateIds,
      expected_visible_ids: expected,
    });
  }
  return probes;
}

export function validateProbeConfig(raw: unknown): ProbeConfig {
  if (!isPlainObject(raw)) throw new ProbeConfigError("config_not_object");
  if (raw.schema !== PROBE_CONFIG_SCHEMA) {
    throw new ProbeConfigError("unsupported_config_schema");
  }
  for (const forbidden of [
    "supabase_anon_key",
    "anon_key",
    "service_role_key",
    "tokens",
  ]) {
    if (raw[forbidden] !== undefined) {
      throw new ProbeConfigError("inline_secret_forbidden");
    }
  }
  assertExactKeys(raw, ALLOWED_CONFIG_KEYS, "undeclared_config_property");

  const supabaseUrlEnv = requireEnvName(
    raw.supabase_url_env,
    "supabase_url_env_invalid",
  );
  const anonKeyEnv = requireEnvName(
    raw.supabase_anon_key_env,
    "supabase_anon_key_env_invalid",
  );
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (raw.timeout_ms !== undefined) {
    if (
      typeof raw.timeout_ms !== "number" ||
      !Number.isFinite(raw.timeout_ms) ||
      raw.timeout_ms <= 0 ||
      raw.timeout_ms > 60_000
    ) {
      throw new ProbeConfigError("timeout_invalid");
    }
    timeoutMs = raw.timeout_ms;
  }
  const coverage = validateCoverage(raw.coverage);
  const principals = validatePrincipals(raw.principals);
  const probes = validateProbes(raw.probes, principals);
  return {
    schema: PROBE_CONFIG_SCHEMA,
    supabase_url_env: supabaseUrlEnv,
    supabase_anon_key_env: anonKeyEnv,
    timeout_ms: timeoutMs,
    coverage,
    principals,
    probes,
  };
}

// -----------------------------------------------------------------------------
// Request construction (GET /rest/v1/<table> only)
// -----------------------------------------------------------------------------

export function buildProbeRequestUrl(
  baseUrl: string,
  probe: ProbeDefinition,
): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmed}/rest/v1/${probe.table}`);
  url.searchParams.set("select", probe.safe_columns.join(","));
  url.searchParams.set(
    probe.identifier_column,
    `in.(${probe.candidate_ids.join(",")})`,
  );
  url.searchParams.set("limit", String(probe.candidate_ids.length));
  return url.toString();
}

// -----------------------------------------------------------------------------
// Assertion
// -----------------------------------------------------------------------------

export function evaluateProbeResponse(args: {
  principal: PrincipalConfig;
  probe: ProbeDefinition;
  expectedIds: string[];
  status: number | null;
  body: unknown;
  transportError?: boolean;
}): Pick<
  ProbeResultEntry,
  "outcome" | "returned_ids" | "unexpected_ids" | "missing_expected_ids" | "reason_code"
> {
  const empty = {
    returned_ids: [] as string[],
    unexpected_ids: [] as string[],
    missing_expected_ids: [] as string[],
  };
  if (args.transportError) {
    return { ...empty, outcome: "blocked", reason_code: "transport_error" };
  }
  const expectDenied = args.expectedIds.length === 0;
  const status = args.status;

  if (expectDenied && (status === 401 || status === 403)) {
    return { ...empty, outcome: "passed", reason_code: "contained_direct_read" };
  }
  if (status !== 200) {
    return {
      ...empty,
      outcome: "blocked",
      reason_code: "unexpected_http_status",
    };
  }
  if (!Array.isArray(args.body)) {
    return { ...empty, outcome: "blocked", reason_code: "response_not_array" };
  }

  const returned: string[] = [];
  for (const row of args.body) {
    if (!isPlainObject(row)) {
      return { ...empty, outcome: "failed", reason_code: "malformed_row" };
    }
    const id = row[probeIdKey(args.probe)];
    if (typeof id !== "string" || id.length === 0) {
      return { ...empty, outcome: "failed", reason_code: "malformed_identifier" };
    }
    if (returned.includes(id)) {
      return {
        ...empty,
        outcome: "failed",
        reason_code: "duplicate_identifier",
        returned_ids: [...returned, id],
      };
    }
    returned.push(id);
  }

  const outside = returned.filter((id) => !args.probe.candidate_ids.includes(id));
  if (outside.length > 0) {
    return {
      outcome: "failed",
      reason_code: "row_outside_candidate_set",
      returned_ids: returned,
      unexpected_ids: outside,
      missing_expected_ids: [],
    };
  }

  const unexpected = returned.filter((id) => !args.expectedIds.includes(id));
  const missing = args.expectedIds.filter((id) => !returned.includes(id));

  if (unexpected.length === 0 && missing.length === 0) {
    return {
      outcome: "passed",
      reason_code: expectDenied ? "expected_empty_result" : "exact_set_match",
      returned_ids: returned,
      unexpected_ids: [],
      missing_expected_ids: [],
    };
  }

  const isProtected = PROTECTED_CLASSIFICATIONS.includes(
    args.probe.classification as ProbeClassification,
  );
  let reason = "identifier_set_mismatch";
  if (unexpected.length > 0 && isProtected) {
    if (args.principal.type === "external_oauth") {
      reason = "external_oauth_saw_protected_row";
    } else if (args.principal.type === "anonymous") {
      reason = "anonymous_saw_protected_row";
    } else if (args.probe.classification === "server_only") {
      reason = "server_only_row_visible_to_client";
    } else {
      reason = "unexpected_cross_scope_row";
    }
  } else if (unexpected.length === 0) {
    reason = "expected_identifier_missing";
  }
  return {
    outcome: "failed",
    reason_code: reason,
    returned_ids: returned,
    unexpected_ids: unexpected,
    missing_expected_ids: missing,
  };
}

function probeIdKey(probe: ProbeDefinition): string {
  return probe.identifier_column;
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

export interface RunnerEnvironment {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now?: () => Date;
}

export async function runProbes(
  config: ProbeConfig,
  runtime: RunnerEnvironment,
): Promise<ProbeRunResult> {
  const now = runtime.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: ProbeResultEntry[] = [];

  const baseUrl = runtime.env[config.supabase_url_env];
  const anonKey = runtime.env[config.supabase_anon_key_env];

  for (const principal of config.principals) {
    let token: string | undefined;
    let principalBlockedReason: string | null = null;

    if (!baseUrl) principalBlockedReason = "missing_supabase_url_env";
    else if (!anonKey) principalBlockedReason = "missing_anon_key_env";

    if (!principalBlockedReason && principal.type !== "anonymous") {
      token = runtime.env[principal.token_env as string];
      if (!token) {
        principalBlockedReason = "missing_principal_token_env";
      } else {
        try {
          assertPrincipalTokenShape(principal, token);
        } catch (error) {
          principalBlockedReason =
            error instanceof ProbeConfigError ? error.code : "token_preflight_failed";
        }
      }
    }

    for (const probe of config.probes) {
      const expectedIds = probe.expected_visible_ids[principal.scenario] ?? [];
      if (principalBlockedReason) {
        results.push({
          principal_scenario: principal.scenario,
          principal_type: principal.type,
          probe_key: probe.probe_key,
          table: probe.table,
          classification: probe.classification,
          http_status: null,
          outcome: "blocked",
          returned_ids: [],
          unexpected_ids: [],
          missing_expected_ids: [],
          reason_code: principalBlockedReason,
        });
        continue;
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        config.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      );
      const headers: Record<string, string> = {
        apikey: anonKey as string,
        Accept: "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      let status: number | null = null;
      let body: unknown = null;
      let transportError = false;
      try {
        const response = await runtime.fetchImpl(
          buildProbeRequestUrl(baseUrl as string, probe),
          { method: "GET", headers, signal: controller.signal },
        );
        status = response.status;
        if (status === 200) {
          try {
            body = await response.json();
          } catch {
            body = null;
          }
        }
      } catch {
        transportError = true;
      } finally {
        clearTimeout(timer);
      }

      const evaluation = evaluateProbeResponse({
        principal,
        probe,
        expectedIds,
        status,
        body,
        transportError,
      });
      results.push({
        principal_scenario: principal.scenario,
        principal_type: principal.type,
        probe_key: probe.probe_key,
        table: probe.table,
        classification: probe.classification,
        http_status: status,
        ...evaluation,
      });
    }
  }

  const summary = {
    passed: results.filter((r) => r.outcome === "passed").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    blocked: results.filter((r) => r.outcome === "blocked").length,
    total: results.length,
  };

  return {
    schema: PROBE_RESULT_SCHEMA,
    config_schema: config.schema,
    started_at: startedAt,
    completed_at: now().toISOString(),
    summary,
    results,
  };
}

export function exitCodeForResult(result: ProbeRunResult): 0 | 1 | 2 {
  if (result.summary.blocked > 0) return 2;
  if (result.summary.failed > 0) return 1;
  return 0;
}

// -----------------------------------------------------------------------------
// Example configuration (placeholders only — no real BTPM data)
// -----------------------------------------------------------------------------

export const EXAMPLE_CONFIG = {
  schema: PROBE_CONFIG_SCHEMA,
  supabase_url_env: "PROBE_SUPABASE_URL",
  supabase_anon_key_env: "PROBE_SUPABASE_ANON_KEY",
  timeout_ms: 10000,
  coverage: {
    tenant_ids: [
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ],
    organization_ids: [
      "00000000-0000-4000-8000-000000000201",
      "00000000-0000-4000-8000-000000000202",
    ],
    workspace_ids: [
      "00000000-0000-4000-8000-000000000301",
      "00000000-0000-4000-8000-000000000302",
    ],
    project_ids: [
      "00000000-0000-4000-8000-000000000401",
      "00000000-0000-4000-8000-000000000402",
    ],
  },
  principals: [
    { scenario: "anonymous", type: "anonymous" },
    {
      scenario: "ordinary_org_admin",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_ORG_ADMIN",
    },
    {
      scenario: "ordinary_workspace_admin",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_WORKSPACE_ADMIN",
    },
    {
      scenario: "ordinary_project_member",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_PROJECT_MEMBER",
    },
    {
      scenario: "ordinary_same_org_non_member",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_SAME_ORG_NON_MEMBER",
    },
    {
      scenario: "ordinary_cross_org",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_CROSS_ORG",
    },
    {
      scenario: "ordinary_removed_membership",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_REMOVED_MEMBERSHIP",
    },
    {
      scenario: "ordinary_deactivated_user",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_DEACTIVATED_USER",
    },
    {
      scenario: "external_oauth",
      type: "external_oauth",
      token_env: "PROBE_TOKEN_EXTERNAL_OAUTH",
    },
  ],
  probes: [
    {
      probe_key: "projects_direct_read",
      table: "projects",
      classification: "pm_business_data",
      identifier_column: "id",
      safe_columns: ["id", "workspace_id"],
      candidate_ids: [
        "00000000-0000-4000-8000-000000000401",
        "00000000-0000-4000-8000-000000000402",
      ],
      expected_visible_ids: {
        anonymous: [],
        ordinary_org_admin: ["00000000-0000-4000-8000-000000000401"],
        ordinary_workspace_admin: ["00000000-0000-4000-8000-000000000401"],
        ordinary_project_member: ["00000000-0000-4000-8000-000000000401"],
        ordinary_same_org_non_member: [],
        ordinary_cross_org: [],
        ordinary_removed_membership: [],
        ordinary_deactivated_user: [],
        external_oauth: [],
      },
    },
  ],
} as const;

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

const HELP_TEXT = `API-HR.3 multi-principal direct-read probe harness (read-only)

Usage:
  bun scripts/api-hr/multiPrincipalReadProbe.ts --config <local-config.json>

Options:
  --config <path>          Local probe configuration (never commit it)
  --output <path>          Write the safe result document to a file
  --print-example-config   Print a placeholder-only example configuration
  --help                   Show this help

Exit codes:
  0  every probe passed
  1  at least one authorization assertion failed
  2  configuration, fixture or transport execution was blocked

The harness performs bounded GET /rest/v1/<table> reads only. It never uses a
service-role key, an RPC, an Edge Function or any mutation method, and never
prints tokens, keys, JWT payloads or complete response rows.
`;

export function parseCliArgs(argv: string[]): {
  help: boolean;
  printExample: boolean;
  configPath?: string;
  outputPath?: string;
} {
  const out = { help: false, printExample: false } as {
    help: boolean;
    printExample: boolean;
    configPath?: string;
    outputPath?: string;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--print-example-config") out.printExample = true;
    else if (arg === "--config") out.configPath = argv[++i];
    else if (arg === "--output") out.outputPath = argv[++i];
    else throw new ProbeConfigError(`unknown_argument:${arg}`);
  }
  return out;
}

async function main(): Promise<void> {
  const g = globalThis as unknown as {
    process?: {
      argv: string[];
      env: Record<string, string | undefined>;
      exit: (code: number) => never;
    };
  };
  const proc = g.process;
  if (!proc) return;
  try {
    const args = parseCliArgs(proc.argv.slice(2));
    if (args.help) {
      console.log(HELP_TEXT);
      proc.exit(0);
    }
    if (args.printExample) {
      console.log(JSON.stringify(EXAMPLE_CONFIG, null, 2));
      proc.exit(0);
    }
    if (!args.configPath) {
      console.error("blocked: --config <path> is required");
      proc.exit(2);
    }
    const { readFile, writeFile } = await import("node:fs/promises");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(args.configPath as string, "utf8"));
    } catch {
      console.error("blocked: configuration could not be read or parsed");
      proc.exit(2);
    }
    const config = validateProbeConfig(raw);
    const result = await runProbes(config, {
      env: proc.env,
      fetchImpl: fetch,
    });
    const serialized = JSON.stringify(result, null, 2);
    if (args.outputPath) await writeFile(args.outputPath, serialized, "utf8");
    console.log(serialized);
    proc.exit(exitCodeForResult(result));
  } catch (error) {
    const code = error instanceof ProbeConfigError ? error.code : "blocked";
    console.error(`blocked: ${code}`);
    proc.exit(2);
  }
}

const isDirectRun = (() => {
  const g = globalThis as unknown as {
    process?: { argv?: string[] };
  };
  const argv1 = g.process?.argv?.[1] ?? "";
  return argv1.includes("multiPrincipalReadProbe.ts") &&
    !argv1.includes(".test.");
})();

if (isDirectRun) {
  await main();
}
