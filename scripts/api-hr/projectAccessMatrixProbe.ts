// API-HR.13 — Canonical has_project_access Multi-Principal Matrix Harness.
//
// Read-only operator tool. Verifies EFFECTIVE ordinary-browser Project
// visibility (direct PostgREST reads of public.projects) against the canonical
// BTPM has_project_access authority matrix.
//
// Hard rules enforced by this file:
//   - Exactly one bounded request per principal: GET /rest/v1/projects
//   - select=id only. Never select=*, never a complete Project row.
//   - No RPC, no Edge Function, no custom URL, no mutation method, ever.
//   - Ordinary browser principals only. No anonymous, no external OAuth,
//     no service-role principal, no service-role key.
//   - Credentials are referenced by environment-variable NAME only.
//   - A non-zero row count is never, by itself, a defect. Only an exact
//     mismatch against explicitly declared expected Project ID sets is.
//   - Output never contains tokens, the anon key, Authorization headers, JWT
//     payloads, complete rows, names, descriptions, emails or encrypted text.
//
// This step makes NO runtime, RLS, grant, function, API or application change.
// JWT payload inspection is a CONFIGURATION PRECONDITION ONLY. It is not
// signature verification and establishes no authorization evidence.

export const MATRIX_CONFIG_SCHEMA = "api_hr_project_access_matrix_v1";
export const MATRIX_RESULT_SCHEMA = "api_hr_project_access_matrix_result_v1";

/** The ten mandatory ordinary-browser scenarios. */
export const REQUIRED_MATRIX_SCENARIOS = [
  "ordinary_org_admin",
  "ordinary_workspace_admin",
  "ordinary_project_manager",
  "ordinary_contributor",
  "ordinary_viewer",
  "ordinary_workspace_member_no_project",
  "ordinary_same_org_other_workspace",
  "ordinary_cross_org",
  "ordinary_removed_project_membership",
  "ordinary_deactivated_user",
] as const;

export type MatrixScenario = (typeof REQUIRED_MATRIX_SCENARIOS)[number];

/** Only ordinary BTPM browser sessions are supported in this step. */
export const ALLOWED_PRINCIPAL_TYPES = ["ordinary_browser"] as const;

const FORBIDDEN_PRINCIPAL_TYPES = [
  "anonymous",
  "external_oauth",
  "service_role",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CANDIDATE_PROJECT_IDS = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Fixed, non-configurable read surface. */
export const PROJECT_TABLE = "projects";
export const PROJECT_ID_COLUMN = "id";

const MIN_COVERAGE = {
  tenant_ids: 2,
  organization_ids: 2,
  workspace_ids: 3,
  project_ids: 4,
} as const;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MatrixPrincipalConfig {
  scenario: MatrixScenario;
  type: "ordinary_browser";
  /** Environment-variable NAME holding the ordinary browser bearer token. */
  token_env: string;
}

export interface MatrixCoverageDeclaration {
  tenant_ids: string[];
  organization_ids: string[];
  workspace_ids: string[];
  project_ids: string[];
}

export interface MatrixConfig {
  schema: string;
  supabase_url_env: string;
  supabase_anon_key_env: string;
  timeout_ms: number;
  coverage: MatrixCoverageDeclaration;
  principals: MatrixPrincipalConfig[];
  candidate_project_ids: string[];
  expected_visible_project_ids: Record<string, string[]>;
}

export type MatrixOutcome = "passed" | "failed" | "blocked";

export interface MatrixResultEntry {
  principal_scenario: string;
  principal_type: string;
  http_status: number | null;
  outcome: MatrixOutcome;
  returned_project_ids: string[];
  unexpected_project_ids: string[];
  missing_expected_project_ids: string[];
  reason_code: string;
}

export interface MatrixRunResult {
  schema: typeof MATRIX_RESULT_SCHEMA;
  config_schema: string;
  started_at: string;
  completed_at: string;
  summary: { passed: number; failed: number; blocked: number; total: number };
  results: MatrixResultEntry[];
}

export class MatrixConfigError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "MatrixConfigError";
  }
}

// -----------------------------------------------------------------------------
// Configuration validation (closed schema at every level)
// -----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reject any property that is not explicitly declared. Values are never echoed. */
function assertExactKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new MatrixConfigError(code);
  }
}

const ALLOWED_CONFIG_KEYS = [
  "schema",
  "supabase_url_env",
  "supabase_anon_key_env",
  "timeout_ms",
  "coverage",
  "principals",
  "candidate_project_ids",
  "expected_visible_project_ids",
] as const;

const ALLOWED_COVERAGE_KEYS = [
  "tenant_ids",
  "organization_ids",
  "workspace_ids",
  "project_ids",
] as const;

const ALLOWED_PRINCIPAL_KEYS = ["scenario", "type", "token_env"] as const;

const FORBIDDEN_TOP_LEVEL_KEYS = [
  "supabase_url",
  "supabase_anon_key",
  "anon_key",
  "apikey",
  "service_role_key",
  "authorization",
  "token",
  "tokens",
  "bearer",
  "url",
  "rpc",
  "method",
  "table",
  "select",
];

function requireEnvName(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw new MatrixConfigError(code);
  }
  return value;
}

function assertNoInlineSecret(value: unknown, code: string): void {
  if (typeof value !== "string") return;
  if (value.split(".").length === 3 || value.length > 120) {
    throw new MatrixConfigError(code);
  }
}

function requireUuidList(
  value: unknown,
  minimum: number,
  key: string,
): string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new MatrixConfigError(`coverage_insufficient_${key}`);
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new MatrixConfigError(`coverage_invalid_${key}`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new MatrixConfigError(`coverage_duplicate_${key}`);
  }
  return ids;
}

function validateCoverage(raw: unknown): MatrixCoverageDeclaration {
  if (!isPlainObject(raw)) throw new MatrixConfigError("coverage_missing");
  assertExactKeys(raw, ALLOWED_COVERAGE_KEYS, "undeclared_coverage_property");
  return {
    tenant_ids: requireUuidList(
      raw.tenant_ids,
      MIN_COVERAGE.tenant_ids,
      "tenant_ids",
    ),
    organization_ids: requireUuidList(
      raw.organization_ids,
      MIN_COVERAGE.organization_ids,
      "organization_ids",
    ),
    workspace_ids: requireUuidList(
      raw.workspace_ids,
      MIN_COVERAGE.workspace_ids,
      "workspace_ids",
    ),
    project_ids: requireUuidList(
      raw.project_ids,
      MIN_COVERAGE.project_ids,
      "project_ids",
    ),
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
  if (parts.length !== 3) throw new MatrixConfigError("token_not_jwt_shaped");
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!isPlainObject(payload)) {
      throw new MatrixConfigError("token_payload_invalid");
    }
    return payload;
  } catch (error) {
    if (error instanceof MatrixConfigError) throw error;
    throw new MatrixConfigError("token_payload_invalid");
  }
}

/** Ordinary browser tokens must never carry an external OAuth client_id claim. */
export function assertOrdinaryBrowserToken(token: string): void {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new MatrixConfigError("token_blank");
  }
  const payload = inspectJwtPayloadForPreflight(token);
  if (Object.prototype.hasOwnProperty.call(payload, "client_id")) {
    throw new MatrixConfigError("ordinary_browser_token_has_client_id");
  }
}

function validatePrincipals(raw: unknown): MatrixPrincipalConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MatrixConfigError("principals_missing");
  }
  const principals: MatrixPrincipalConfig[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) throw new MatrixConfigError("principal_invalid");
    assertExactKeys(
      entry,
      ALLOWED_PRINCIPAL_KEYS,
      "undeclared_principal_property",
    );

    const type = entry.type;
    if (typeof type !== "string") {
      throw new MatrixConfigError("principal_type_invalid");
    }
    for (const forbidden of FORBIDDEN_PRINCIPAL_TYPES) {
      if (type === forbidden || type.includes(forbidden)) {
        throw new MatrixConfigError(`${forbidden}_principal_forbidden`);
      }
    }
    if (!(ALLOWED_PRINCIPAL_TYPES as readonly string[]).includes(type)) {
      throw new MatrixConfigError("principal_type_invalid");
    }

    const scenario = entry.scenario;
    if (
      typeof scenario !== "string" ||
      !(REQUIRED_MATRIX_SCENARIOS as readonly string[]).includes(scenario)
    ) {
      throw new MatrixConfigError("unknown_principal_scenario");
    }

    assertNoInlineSecret(entry.token_env, "inline_secret_forbidden");
    const tokenEnv = requireEnvName(
      entry.token_env,
      "principal_token_env_invalid",
    );

    principals.push({
      scenario: scenario as MatrixScenario,
      type: "ordinary_browser",
      token_env: tokenEnv,
    });
  }

  const scenarios = principals.map((p) => p.scenario);
  if (new Set(scenarios).size !== scenarios.length) {
    throw new MatrixConfigError("duplicate_principal_scenario");
  }
  for (const required of REQUIRED_MATRIX_SCENARIOS) {
    if (!scenarios.includes(required)) {
      throw new MatrixConfigError(`missing_principal_scenario:${required}`);
    }
  }
  return principals;
}

function validateCandidateProjectIds(
  raw: unknown,
  coverage: MatrixCoverageDeclaration,
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MatrixConfigError("candidate_project_ids_missing");
  }
  if (raw.length > MAX_CANDIDATE_PROJECT_IDS) {
    throw new MatrixConfigError("candidate_project_ids_exceed_bound");
  }
  const ids = raw.map((id) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new MatrixConfigError("candidate_project_id_invalid");
    }
    if (!coverage.project_ids.includes(id)) {
      throw new MatrixConfigError("candidate_project_id_outside_coverage");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new MatrixConfigError("duplicate_candidate_project_id");
  }
  return ids;
}

function validateExpectedVisibility(
  raw: unknown,
  candidateIds: string[],
): Record<string, string[]> {
  if (!isPlainObject(raw)) {
    throw new MatrixConfigError("expected_visible_project_ids_missing");
  }
  assertExactKeys(
    raw,
    REQUIRED_MATRIX_SCENARIOS,
    "unknown_principal_scenario",
  );
  const expected: Record<string, string[]> = {};
  for (const [scenario, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids)) {
      throw new MatrixConfigError("expected_visible_project_ids_invalid");
    }
    const list = ids.map((id) => {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
        throw new MatrixConfigError("expected_project_id_invalid");
      }
      if (!candidateIds.includes(id)) {
        throw new MatrixConfigError("expected_id_outside_candidates");
      }
      return id;
    });
    if (new Set(list).size !== list.length) {
      throw new MatrixConfigError("duplicate_expected_project_id");
    }
    expected[scenario] = list;
  }
  // Every scenario must be declared explicitly. A missing scenario is NEVER
  // inferred as empty; an empty expectation must be written out as [].
  for (const required of REQUIRED_MATRIX_SCENARIOS) {
    if (expected[required] === undefined) {
      throw new MatrixConfigError("missing_explicit_expectation");
    }
  }
  // Only a deactivated user is structurally required to see zero candidate
  // Projects. The other negative scenarios verify denial of a specific Project
  // or scope boundary and may legitimately retain access to other candidate
  // Projects; their explicit expected set is authoritative.
  if (expected.ordinary_deactivated_user.length > 0) {
    throw new MatrixConfigError(
      "ordinary_deactivated_user_must_expect_no_projects",
    );
  }

  return expected;
}

export function validateMatrixConfig(raw: unknown): MatrixConfig {
  if (!isPlainObject(raw)) throw new MatrixConfigError("config_not_object");
  if (raw.schema !== MATRIX_CONFIG_SCHEMA) {
    throw new MatrixConfigError("unsupported_config_schema");
  }
  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    if (raw[forbidden] !== undefined) {
      throw new MatrixConfigError("undeclared_config_property");
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
  if (raw.timeout_ms === undefined) {
    throw new MatrixConfigError("timeout_invalid");
  }
  if (
    typeof raw.timeout_ms !== "number" ||
    !Number.isFinite(raw.timeout_ms) ||
    raw.timeout_ms <= 0 ||
    raw.timeout_ms > 60_000
  ) {
    throw new MatrixConfigError("timeout_invalid");
  }

  const coverage = validateCoverage(raw.coverage);
  const principals = validatePrincipals(raw.principals);
  const candidateProjectIds = validateCandidateProjectIds(
    raw.candidate_project_ids,
    coverage,
  );
  const expected = validateExpectedVisibility(
    raw.expected_visible_project_ids,
    candidateProjectIds,
  );

  return {
    schema: MATRIX_CONFIG_SCHEMA,
    supabase_url_env: supabaseUrlEnv,
    supabase_anon_key_env: anonKeyEnv,
    timeout_ms: raw.timeout_ms,
    coverage,
    principals,
    candidate_project_ids: candidateProjectIds,
    expected_visible_project_ids: expected,
  };
}

// -----------------------------------------------------------------------------
// Request construction — bounded GET /rest/v1/projects, id only
// -----------------------------------------------------------------------------

export function buildProjectAccessRequestUrl(
  baseUrl: string,
  candidateProjectIds: string[],
): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmed}/rest/v1/${PROJECT_TABLE}`);
  url.searchParams.set("select", PROJECT_ID_COLUMN);
  url.searchParams.set(
    PROJECT_ID_COLUMN,
    `in.(${candidateProjectIds.join(",")})`,
  );
  url.searchParams.set("limit", String(candidateProjectIds.length));
  return url.toString();
}

// -----------------------------------------------------------------------------
// Evaluation — exact set comparison, order independent
// -----------------------------------------------------------------------------

export function evaluateProjectAccessResponse(args: {
  scenario: string;
  candidateProjectIds: string[];
  expectedIds: string[];
  status: number | null;
  body: unknown;
  transportError?: boolean;
}): Pick<
  MatrixResultEntry,
  | "outcome"
  | "returned_project_ids"
  | "unexpected_project_ids"
  | "missing_expected_project_ids"
  | "reason_code"
> {
  const empty = {
    returned_project_ids: [] as string[],
    unexpected_project_ids: [] as string[],
    missing_expected_project_ids: [] as string[],
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
    return { ...empty, outcome: "blocked", reason_code: "unexpected_http_status" };
  }
  if (!Array.isArray(args.body)) {
    return { ...empty, outcome: "blocked", reason_code: "response_not_array" };
  }

  const returned: string[] = [];
  for (const row of args.body) {
    if (!isPlainObject(row)) {
      return { ...empty, outcome: "failed", reason_code: "malformed_row" };
    }
    const id = row[PROJECT_ID_COLUMN];
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      return {
        ...empty,
        outcome: "failed",
        reason_code: "malformed_project_identifier",
      };
    }
    if (returned.includes(id)) {
      return {
        ...empty,
        outcome: "failed",
        reason_code: "duplicate_project_identifier",
        returned_project_ids: [...returned, id],
      };
    }
    returned.push(id);
  }

  const outside = returned.filter(
    (id) => !args.candidateProjectIds.includes(id),
  );
  if (outside.length > 0) {
    return {
      outcome: "failed",
      reason_code: "project_outside_candidate_set",
      returned_project_ids: returned,
      unexpected_project_ids: outside,
      missing_expected_project_ids: [],
    };
  }

  const unexpected = returned.filter((id) => !args.expectedIds.includes(id));
  const missing = args.expectedIds.filter((id) => !returned.includes(id));

  if (unexpected.length === 0 && missing.length === 0) {
    return {
      outcome: "passed",
      reason_code: expectDenied ? "expected_empty_result" : "exact_set_match",
      returned_project_ids: returned,
      unexpected_project_ids: [],
      missing_expected_project_ids: [],
    };
  }

  let reason = "project_id_set_mismatch";
  if (unexpected.length > 0) {
    switch (args.scenario) {
      case "ordinary_deactivated_user":
        reason = "deactivated_user_saw_project";
        break;
      case "ordinary_removed_project_membership":
        reason = "removed_project_member_saw_project";
        break;
      case "ordinary_workspace_member_no_project":
        reason = "workspace_member_without_project_membership_saw_project";
        break;
      case "ordinary_same_org_other_workspace":
        reason = "same_org_membership_crossed_workspace_boundary";
        break;
      case "ordinary_cross_org":
        reason = "cross_org_or_cross_tenant_project_visible";
        break;
      default:
        reason = "unexpected_cross_scope_project";
    }
  } else if (unexpected.length === 0) {
    reason = "expected_project_missing";
  }

  return {
    outcome: "failed",
    reason_code: reason,
    returned_project_ids: returned,
    unexpected_project_ids: unexpected,
    missing_expected_project_ids: missing,
  };
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

export interface MatrixRunnerEnvironment {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now?: () => Date;
}

export async function runProjectAccessMatrix(
  config: MatrixConfig,
  runtime: MatrixRunnerEnvironment,
): Promise<MatrixRunResult> {
  const now = runtime.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: MatrixResultEntry[] = [];

  const baseUrl = runtime.env[config.supabase_url_env];
  const anonKey = runtime.env[config.supabase_anon_key_env];

  for (const principal of config.principals) {
    const expectedIds =
      config.expected_visible_project_ids[principal.scenario] ?? [];

    let blockedReason: string | null = null;
    let token: string | undefined;

    if (!baseUrl) blockedReason = "missing_supabase_url_env";
    else if (!anonKey) blockedReason = "missing_anon_key_env";

    if (!blockedReason) {
      token = runtime.env[principal.token_env];
      if (!token) {
        blockedReason = "missing_principal_token_env";
      } else {
        try {
          assertOrdinaryBrowserToken(token);
        } catch (error) {
          blockedReason =
            error instanceof MatrixConfigError
              ? error.code
              : "token_preflight_failed";
        }
      }
    }

    if (blockedReason) {
      results.push({
        principal_scenario: principal.scenario,
        principal_type: principal.type,
        http_status: null,
        outcome: "blocked",
        returned_project_ids: [],
        unexpected_project_ids: [],
        missing_expected_project_ids: [],
        reason_code: blockedReason,
      });
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout_ms);
    const headers: Record<string, string> = {
      apikey: anonKey as string,
      Accept: "application/json",
      Authorization: `Bearer ${token as string}`,
    };

    let status: number | null = null;
    let body: unknown = null;
    let transportError = false;
    try {
      const response = await runtime.fetchImpl(
        buildProjectAccessRequestUrl(
          baseUrl as string,
          config.candidate_project_ids,
        ),
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

    const evaluation = evaluateProjectAccessResponse({
      scenario: principal.scenario,
      candidateProjectIds: config.candidate_project_ids,
      expectedIds,
      status,
      body,
      transportError,
    });

    results.push({
      principal_scenario: principal.scenario,
      principal_type: principal.type,
      http_status: status,
      ...evaluation,
    });
  }

  const summary = {
    passed: results.filter((r) => r.outcome === "passed").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    blocked: results.filter((r) => r.outcome === "blocked").length,
    total: results.length,
  };

  return {
    schema: MATRIX_RESULT_SCHEMA,
    config_schema: config.schema,
    started_at: startedAt,
    completed_at: now().toISOString(),
    summary,
    results,
  };
}

export function exitCodeForMatrixResult(result: MatrixRunResult): 0 | 1 | 2 {
  if (result.summary.blocked > 0) return 2;
  if (result.summary.failed > 0) return 1;
  return 0;
}

// -----------------------------------------------------------------------------
// Example configuration (synthetic UUIDs and env names only)
// -----------------------------------------------------------------------------

const P = {
  authorized: "00000000-0000-4000-8000-000000000401",
  sameWorkspaceOther: "00000000-0000-4000-8000-000000000402",
  otherWorkspaceSameOrg: "00000000-0000-4000-8000-000000000403",
  otherOrgOrTenant: "00000000-0000-4000-8000-000000000404",
} as const;

export const EXAMPLE_MATRIX_CONFIG = {
  schema: MATRIX_CONFIG_SCHEMA,
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
      "00000000-0000-4000-8000-000000000303",
    ],
    project_ids: [
      P.authorized,
      P.sameWorkspaceOther,
      P.otherWorkspaceSameOrg,
      P.otherOrgOrTenant,
    ],
  },
  principals: [
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
      scenario: "ordinary_project_manager",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_PROJECT_MANAGER",
    },
    {
      scenario: "ordinary_contributor",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_CONTRIBUTOR",
    },
    {
      scenario: "ordinary_viewer",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_VIEWER",
    },
    {
      scenario: "ordinary_workspace_member_no_project",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_WORKSPACE_MEMBER_NO_PROJECT",
    },
    {
      scenario: "ordinary_same_org_other_workspace",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_SAME_ORG_OTHER_WORKSPACE",
    },
    {
      scenario: "ordinary_cross_org",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_CROSS_ORG",
    },
    {
      scenario: "ordinary_removed_project_membership",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_REMOVED_PROJECT_MEMBERSHIP",
    },
    {
      scenario: "ordinary_deactivated_user",
      type: "ordinary_browser",
      token_env: "PROBE_TOKEN_DEACTIVATED_USER",
    },
  ],
  candidate_project_ids: [
    P.authorized,
    P.sameWorkspaceOther,
    P.otherWorkspaceSameOrg,
    P.otherOrgOrTenant,
  ],
  expected_visible_project_ids: {
    ordinary_org_admin: [P.authorized, P.sameWorkspaceOther, P.otherWorkspaceSameOrg],
    ordinary_workspace_admin: [P.authorized, P.sameWorkspaceOther],
    ordinary_project_manager: [P.authorized],
    ordinary_contributor: [P.authorized],
    ordinary_viewer: [P.authorized],
    ordinary_workspace_member_no_project: [],
    ordinary_same_org_other_workspace: [],
    ordinary_cross_org: [],
    // Mixed visibility is legitimate: this principal was removed from the
    // authorized Project but retains active membership in another Project.
    ordinary_removed_project_membership: [P.sameWorkspaceOther],

    ordinary_deactivated_user: [],
  },
};

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

export const MATRIX_HELP_TEXT = `
API-HR.13 — Canonical has_project_access Multi-Principal Matrix Harness

Read-only. Verifies effective ordinary-browser Project visibility against the
canonical BTPM has_project_access authority matrix.

Usage:
  bun scripts/api-hr/projectAccessMatrixProbe.ts --config <local-config.json>

Options:
  --config <path>          Local matrix configuration (never commit it)
  --output <path>          Write the safe result document to a file
  --print-example-config   Print a synthetic placeholder-only example config
  --help                   Show this help

Exit codes:
  0  every authorization assertion passed
  1  at least one authorization assertion failed
  2  configuration, fixture or transport execution was blocked

The harness performs exactly one bounded GET /rest/v1/projects request per
principal, selecting only id and filtering to the configured candidate Project
IDs. It never uses a service-role key, an RPC, an Edge Function or any mutation
method, and never prints tokens, keys, JWT payloads, headers or complete rows.
`;

export function parseMatrixCliArgs(argv: string[]): {
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
    else throw new MatrixConfigError(`unknown_argument:${arg}`);
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
    const args = parseMatrixCliArgs(proc.argv.slice(2));
    if (args.help) {
      console.log(MATRIX_HELP_TEXT);
      proc.exit(0);
    }
    if (args.printExample) {
      console.log(JSON.stringify(EXAMPLE_MATRIX_CONFIG, null, 2));
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
    const config = validateMatrixConfig(raw);
    const result = await runProjectAccessMatrix(config, {
      env: proc.env,
      fetchImpl: fetch,
    });
    const serialized = JSON.stringify(result, null, 2);
    if (args.outputPath) await writeFile(args.outputPath, serialized, "utf8");
    console.log(serialized);
    proc.exit(exitCodeForMatrixResult(result));
  } catch (error) {
    const code = error instanceof MatrixConfigError ? error.code : "blocked";
    console.error(`blocked: ${code}`);
    proc.exit(2);
  }
}

const isDirectRun = (() => {
  const g = globalThis as unknown as { process?: { argv?: string[] } };
  const argv1 = g.process?.argv?.[1] ?? "";
  return (
    argv1.includes("projectAccessMatrixProbe.ts") && !argv1.includes(".test.")
  );
})();

if (isDirectRun) {
  await main();
}
