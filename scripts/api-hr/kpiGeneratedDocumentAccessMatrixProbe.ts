// API-HR.16 — KPI & Generated-Document Project-Scope Matrix Harness.
//
// Read-only operator tool. Verifies EFFECTIVE ordinary-browser visibility of KPI
// and generated-document metadata rows against operator-declared expectations.
//
// Fixed verification surfaces (non-configurable):
//   public.kpi_definitions, public.kpi_updates, public.kpi_snapshots,
//   public.generated_operational_documents
//
// All four relations key on `id`, so the harness selects `id` and nothing else.
//
// Hard rules enforced by this file:
//   - Exactly one bounded request per principal × surface:
//       GET /rest/v1/<fixed-surface>?select=id&id=in.(...)&limit=<n>
//   - select=id only. Never select=*, never a complete row, never a KPI name,
//     description, value, comment, action plan, generated filename, SharePoint
//     identifier/URL, error note or any encrypted/decrypted field.
//   - No RPC, no Edge Function, no generation call, no SharePoint call, no
//     custom URL, no custom relation name, no mutation method, ever.
//   - Ordinary browser principals only. No anonymous, no external OAuth,
//     no service-role principal, no service-role key.
//   - Credentials are referenced by environment-variable NAME only.
//   - A non-zero row count is never, by itself, a defect. Administrative and
//     Project-derived breadth are legitimate. Only an exact mismatch against the
//     explicitly declared expected ID set is a defect.
//
// This step makes NO runtime authorization, RLS, grant, function, trigger, KPI
// data, generated-document, SharePoint, API or application change. JWT payload
// inspection is a CONFIGURATION PRECONDITION ONLY: it is not signature
// verification and establishes no authorization evidence. The harness does NOT
// reconstruct the KPI definition → update → snapshot hierarchy and does NOT
// query additional relations to prove which Project a candidate row belongs to;
// fixture correctness is operator-declared.

export const KPI_DOC_MATRIX_CONFIG_SCHEMA =
  "api_hr_kpi_generated_document_access_matrix_v1";
export const KPI_DOC_MATRIX_RESULT_SCHEMA =
  "api_hr_kpi_generated_document_access_matrix_result_v1";

/** The ten mandatory ordinary-browser scenarios for API-HR.16. */
export const REQUIRED_KPI_DOC_MATRIX_SCENARIOS = [
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

export type KpiDocMatrixScenario =
  (typeof REQUIRED_KPI_DOC_MATRIX_SCENARIOS)[number];

/** Fixed, non-configurable KPI / generated-document read surfaces. */
export const KPI_DOC_SURFACES = [
  "kpi_definitions",
  "kpi_updates",
  "kpi_snapshots",
  "generated_operational_documents",
] as const;

export type KpiDocSurface = (typeof KPI_DOC_SURFACES)[number];

/** Only ordinary BTPM browser sessions are supported in this step. */
export const ALLOWED_KPI_DOC_PRINCIPAL_TYPES = ["ordinary_browser"] as const;

const FORBIDDEN_PRINCIPAL_TYPES = [
  "anonymous",
  "external_oauth",
  "service_role",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CANDIDATE_IDS_PER_SURFACE = 25;

/** Canonical probe identifier per fixed surface. Nothing else is ever selected. */
export const KPI_DOC_SURFACE_ID_COLUMN: Record<KpiDocSurface, "id"> = {
  kpi_definitions: "id",
  kpi_updates: "id",
  kpi_snapshots: "id",
  generated_operational_documents: "id",
};

const MIN_COVERAGE = {
  tenant_ids: 2,
  organization_ids: 2,
  workspace_ids: 3,
  project_ids: 4,
} as const;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface KpiDocMatrixPrincipalConfig {
  scenario: KpiDocMatrixScenario;
  type: "ordinary_browser";
  /** Environment-variable NAME holding the ordinary browser bearer token. */
  token_env: string;
}

export interface KpiDocMatrixCoverageDeclaration {
  tenant_ids: string[];
  organization_ids: string[];
  workspace_ids: string[];
  project_ids: string[];
}

export interface KpiDocSurfaceConfig {
  candidate_ids: string[];
  expected_visible_ids: Record<string, string[]>;
}

export interface KpiDocMatrixConfig {
  schema: string;
  supabase_url_env: string;
  supabase_anon_key_env: string;
  timeout_ms: number;
  coverage: KpiDocMatrixCoverageDeclaration;
  principals: KpiDocMatrixPrincipalConfig[];
  surfaces: Record<KpiDocSurface, KpiDocSurfaceConfig>;
}

export type KpiDocMatrixOutcome = "passed" | "failed" | "blocked";

export interface KpiDocMatrixResultEntry {
  principal_scenario: string;
  principal_type: string;
  surface: KpiDocSurface;
  http_status: number | null;
  outcome: KpiDocMatrixOutcome;
  returned_ids: string[];
  unexpected_ids: string[];
  missing_expected_ids: string[];
  reason_code: string;
}

export interface KpiDocMatrixRunResult {
  schema: typeof KPI_DOC_MATRIX_RESULT_SCHEMA;
  config_schema: string;
  started_at: string;
  completed_at: string;
  summary: { passed: number; failed: number; blocked: number; total: number };
  results: KpiDocMatrixResultEntry[];
}

export class KpiDocMatrixConfigError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "KpiDocMatrixConfigError";
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
    if (!allowed.includes(key)) throw new KpiDocMatrixConfigError(code);
  }
}

const ALLOWED_CONFIG_KEYS = [
  "schema",
  "supabase_url_env",
  "supabase_anon_key_env",
  "timeout_ms",
  "coverage",
  "principals",
  "surfaces",
] as const;

const ALLOWED_COVERAGE_KEYS = [
  "tenant_ids",
  "organization_ids",
  "workspace_ids",
  "project_ids",
] as const;

const ALLOWED_PRINCIPAL_KEYS = ["scenario", "type", "token_env"] as const;

const ALLOWED_SURFACE_KEYS = ["candidate_ids", "expected_visible_ids"] as const;

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
  "tables",
  "select",
  "columns",
  "edge_function",
  "sharepoint",
];

function requireEnvName(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw new KpiDocMatrixConfigError(code);
  }
  return value;
}

function assertNoInlineSecret(value: unknown, code: string): void {
  if (typeof value !== "string") return;
  if (value.split(".").length === 3 || value.length > 120) {
    throw new KpiDocMatrixConfigError(code);
  }
}

function requireUuidList(
  value: unknown,
  minimum: number,
  key: string,
): string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new KpiDocMatrixConfigError(`coverage_insufficient_${key}`);
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new KpiDocMatrixConfigError(`coverage_invalid_${key}`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new KpiDocMatrixConfigError(`coverage_duplicate_${key}`);
  }
  return ids;
}

function validateCoverage(raw: unknown): KpiDocMatrixCoverageDeclaration {
  if (!isPlainObject(raw)) {
    throw new KpiDocMatrixConfigError("coverage_missing");
  }
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
  if (parts.length !== 3) {
    throw new KpiDocMatrixConfigError("token_not_jwt_shaped");
  }
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!isPlainObject(payload)) {
      throw new KpiDocMatrixConfigError("token_payload_invalid");
    }
    return payload;
  } catch (error) {
    if (error instanceof KpiDocMatrixConfigError) throw error;
    throw new KpiDocMatrixConfigError("token_payload_invalid");
  }
}

/** Ordinary browser tokens must never carry an external OAuth client_id claim. */
export function assertOrdinaryBrowserToken(token: string): void {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new KpiDocMatrixConfigError("token_blank");
  }
  const payload = inspectJwtPayloadForPreflight(token);
  if (Object.prototype.hasOwnProperty.call(payload, "client_id")) {
    throw new KpiDocMatrixConfigError("ordinary_browser_token_has_client_id");
  }
}

function validatePrincipals(raw: unknown): KpiDocMatrixPrincipalConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new KpiDocMatrixConfigError("principals_missing");
  }
  const principals: KpiDocMatrixPrincipalConfig[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      throw new KpiDocMatrixConfigError("principal_invalid");
    }
    assertExactKeys(
      entry,
      ALLOWED_PRINCIPAL_KEYS,
      "undeclared_principal_property",
    );

    const type = entry.type;
    if (typeof type !== "string") {
      throw new KpiDocMatrixConfigError("principal_type_invalid");
    }
    for (const forbidden of FORBIDDEN_PRINCIPAL_TYPES) {
      if (type === forbidden || type.includes(forbidden)) {
        throw new KpiDocMatrixConfigError(`${forbidden}_principal_forbidden`);
      }
    }
    if (!(ALLOWED_KPI_DOC_PRINCIPAL_TYPES as readonly string[]).includes(type)) {
      throw new KpiDocMatrixConfigError("principal_type_invalid");
    }

    const scenario = entry.scenario;
    if (
      typeof scenario !== "string" ||
      !(REQUIRED_KPI_DOC_MATRIX_SCENARIOS as readonly string[]).includes(
        scenario,
      )
    ) {
      throw new KpiDocMatrixConfigError("unknown_principal_scenario");
    }

    assertNoInlineSecret(entry.token_env, "inline_secret_forbidden");
    const tokenEnv = requireEnvName(
      entry.token_env,
      "principal_token_env_invalid",
    );

    principals.push({
      scenario: scenario as KpiDocMatrixScenario,
      type: "ordinary_browser",
      token_env: tokenEnv,
    });
  }

  const scenarios = principals.map((p) => p.scenario);
  if (new Set(scenarios).size !== scenarios.length) {
    throw new KpiDocMatrixConfigError("duplicate_principal_scenario");
  }
  for (const required of REQUIRED_KPI_DOC_MATRIX_SCENARIOS) {
    if (!scenarios.includes(required)) {
      throw new KpiDocMatrixConfigError(
        `missing_principal_scenario:${required}`,
      );
    }
  }
  return principals;
}

function validateCandidateIds(raw: unknown, surface: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new KpiDocMatrixConfigError(`candidate_ids_missing:${surface}`);
  }
  if (raw.length > MAX_CANDIDATE_IDS_PER_SURFACE) {
    throw new KpiDocMatrixConfigError(`candidate_ids_exceed_bound:${surface}`);
  }
  const ids = raw.map((id) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new KpiDocMatrixConfigError(`candidate_id_invalid:${surface}`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new KpiDocMatrixConfigError(`duplicate_candidate_id:${surface}`);
  }
  return ids;
}

function validateExpectedVisibility(
  raw: unknown,
  candidateIds: string[],
  surface: string,
): Record<string, string[]> {
  if (!isPlainObject(raw)) {
    throw new KpiDocMatrixConfigError(`expected_visible_ids_missing:${surface}`);
  }
  assertExactKeys(
    raw,
    REQUIRED_KPI_DOC_MATRIX_SCENARIOS,
    "unknown_principal_scenario",
  );
  const expected: Record<string, string[]> = {};
  for (const [scenario, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids)) {
      throw new KpiDocMatrixConfigError(
        `expected_visible_ids_invalid:${surface}`,
      );
    }
    const list = ids.map((id) => {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
        throw new KpiDocMatrixConfigError(`expected_id_invalid:${surface}`);
      }
      if (!candidateIds.includes(id)) {
        throw new KpiDocMatrixConfigError(
          `expected_id_outside_candidates:${surface}`,
        );
      }
      return id;
    });
    if (new Set(list).size !== list.length) {
      throw new KpiDocMatrixConfigError(`duplicate_expected_id:${surface}`);
    }
    expected[scenario] = list;
  }

  // Every scenario must be declared explicitly. A missing scenario is NEVER
  // inferred as empty; an empty expectation must be written out as [].
  for (const required of REQUIRED_KPI_DOC_MATRIX_SCENARIOS) {
    if (expected[required] === undefined) {
      throw new KpiDocMatrixConfigError(
        `missing_explicit_expectation:${surface}`,
      );
    }
  }

  // Each KPI / generated-document relation has its own intentional RLS
  // contract. Administrative breadth, Project-derived breadth and mixed
  // legitimate boundary visibility are all valid, so the harness imposes NO
  // hard-coded visibility model. The single structural rule is fail-closed for a
  // deactivated user.
  if (expected.ordinary_deactivated_user.length > 0) {
    throw new KpiDocMatrixConfigError(
      `ordinary_deactivated_user_must_expect_no_rows:${surface}`,
    );
  }

  return expected;
}

function validateSurfaces(
  raw: unknown,
): Record<KpiDocSurface, KpiDocSurfaceConfig> {
  if (!isPlainObject(raw)) {
    throw new KpiDocMatrixConfigError("surfaces_missing");
  }
  assertExactKeys(raw, KPI_DOC_SURFACES, "unknown_surface");
  const surfaces = {} as Record<KpiDocSurface, KpiDocSurfaceConfig>;
  for (const surface of KPI_DOC_SURFACES) {
    const entry = raw[surface];
    if (!isPlainObject(entry)) {
      throw new KpiDocMatrixConfigError(`missing_surface:${surface}`);
    }
    assertExactKeys(entry, ALLOWED_SURFACE_KEYS, "undeclared_surface_property");
    const candidateIds = validateCandidateIds(entry.candidate_ids, surface);
    surfaces[surface] = {
      candidate_ids: candidateIds,
      expected_visible_ids: validateExpectedVisibility(
        entry.expected_visible_ids,
        candidateIds,
        surface,
      ),
    };
  }
  return surfaces;
}

export function validateKpiDocMatrixConfig(raw: unknown): KpiDocMatrixConfig {
  if (!isPlainObject(raw)) {
    throw new KpiDocMatrixConfigError("config_not_object");
  }
  if (raw.schema !== KPI_DOC_MATRIX_CONFIG_SCHEMA) {
    throw new KpiDocMatrixConfigError("unsupported_config_schema");
  }
  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    if (raw[forbidden] !== undefined) {
      throw new KpiDocMatrixConfigError("undeclared_config_property");
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
  if (
    typeof raw.timeout_ms !== "number" ||
    !Number.isFinite(raw.timeout_ms) ||
    raw.timeout_ms <= 0 ||
    raw.timeout_ms > 60_000
  ) {
    throw new KpiDocMatrixConfigError("timeout_invalid");
  }

  return {
    schema: KPI_DOC_MATRIX_CONFIG_SCHEMA,
    supabase_url_env: supabaseUrlEnv,
    supabase_anon_key_env: anonKeyEnv,
    timeout_ms: raw.timeout_ms,
    coverage: validateCoverage(raw.coverage),
    principals: validatePrincipals(raw.principals),
    surfaces: validateSurfaces(raw.surfaces),
  };
}

// -----------------------------------------------------------------------------
// Request construction — bounded GET /rest/v1/<fixed-surface>, identifier only
// -----------------------------------------------------------------------------

export function buildKpiDocRequestUrl(
  baseUrl: string,
  surface: KpiDocSurface,
  candidateIds: string[],
): string {
  if (!(KPI_DOC_SURFACES as readonly string[]).includes(surface)) {
    throw new KpiDocMatrixConfigError("unknown_surface");
  }
  const idColumn = KPI_DOC_SURFACE_ID_COLUMN[surface];
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmed}/rest/v1/${surface}`);
  url.searchParams.set("select", idColumn);
  url.searchParams.set(idColumn, `in.(${candidateIds.join(",")})`);
  url.searchParams.set("limit", String(candidateIds.length));
  return url.toString();
}

// -----------------------------------------------------------------------------
// Evaluation — exact set comparison, order independent
// -----------------------------------------------------------------------------

export function evaluateKpiDocResponse(args: {
  scenario: string;
  surface: KpiDocSurface;
  candidateIds: string[];
  expectedIds: string[];
  status: number | null;
  body: unknown;
  transportError?: boolean;
}): Pick<
  KpiDocMatrixResultEntry,
  | "outcome"
  | "returned_ids"
  | "unexpected_ids"
  | "missing_expected_ids"
  | "reason_code"
> {
  const idColumn = KPI_DOC_SURFACE_ID_COLUMN[args.surface] ?? "id";
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
    return {
      ...empty,
      outcome: "passed",
      reason_code: "contained_direct_read",
    };
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
    const id = row[idColumn];
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      return {
        ...empty,
        outcome: "failed",
        reason_code: "malformed_kpi_generated_document_identifier",
      };
    }
    if (returned.includes(id)) {
      return {
        ...empty,
        outcome: "failed",
        reason_code: "duplicate_kpi_generated_document_identifier",
        returned_ids: [...returned, id],
      };
    }
    returned.push(id);
  }

  const outside = returned.filter((id) => !args.candidateIds.includes(id));
  if (outside.length > 0) {
    return {
      outcome: "failed",
      reason_code: "kpi_generated_document_row_outside_candidate_set",
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

  let reason: string;
  if (unexpected.length > 0) {
    reason =
      args.scenario === "ordinary_deactivated_user"
        ? "deactivated_user_saw_kpi_generated_document_row"
        : "unexpected_kpi_generated_document_row_visible";
  } else {
    reason = "expected_kpi_generated_document_row_missing";
  }

  return {
    outcome: "failed",
    reason_code: reason,
    returned_ids: returned,
    unexpected_ids: unexpected,
    missing_expected_ids: missing,
  };
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

export interface KpiDocMatrixRunnerEnvironment {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now?: () => Date;
}

export async function runKpiGeneratedDocumentAccessMatrix(
  config: KpiDocMatrixConfig,
  runtime: KpiDocMatrixRunnerEnvironment,
): Promise<KpiDocMatrixRunResult> {
  const now = runtime.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: KpiDocMatrixResultEntry[] = [];

  const baseUrl = runtime.env[config.supabase_url_env];
  const anonKey = runtime.env[config.supabase_anon_key_env];

  for (const principal of config.principals) {
    let principalBlockedReason: string | null = null;
    let token: string | undefined;

    if (!baseUrl) principalBlockedReason = "missing_supabase_url_env";
    else if (!anonKey) principalBlockedReason = "missing_anon_key_env";

    if (!principalBlockedReason) {
      token = runtime.env[principal.token_env];
      if (!token) {
        principalBlockedReason = "missing_principal_token_env";
      } else {
        try {
          assertOrdinaryBrowserToken(token);
        } catch (error) {
          principalBlockedReason =
            error instanceof KpiDocMatrixConfigError
              ? error.code
              : "token_preflight_failed";
        }
      }
    }

    for (const surface of KPI_DOC_SURFACES) {
      const surfaceConfig = config.surfaces[surface];
      const expectedIds =
        surfaceConfig.expected_visible_ids[principal.scenario] ?? [];

      if (principalBlockedReason) {
        results.push({
          principal_scenario: principal.scenario,
          principal_type: principal.type,
          surface,
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
          buildKpiDocRequestUrl(
            baseUrl as string,
            surface,
            surfaceConfig.candidate_ids,
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

      const evaluation = evaluateKpiDocResponse({
        scenario: principal.scenario,
        surface,
        candidateIds: surfaceConfig.candidate_ids,
        expectedIds,
        status,
        body,
        transportError,
      });

      results.push({
        principal_scenario: principal.scenario,
        principal_type: principal.type,
        surface,
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
    schema: KPI_DOC_MATRIX_RESULT_SCHEMA,
    config_schema: config.schema,
    started_at: startedAt,
    completed_at: now().toISOString(),
    summary,
    results,
  };
}

export function exitCodeForKpiDocMatrixResult(
  result: KpiDocMatrixRunResult,
): 0 | 1 | 2 {
  if (result.summary.blocked > 0) return 2;
  if (result.summary.failed > 0) return 1;
  return 0;
}

// -----------------------------------------------------------------------------
// Example configuration — FIXTURE ILLUSTRATION ONLY.
//
// The expectations below are NOT universal authorization truth. Each KPI and
// generated-document relation has its own intentional RLS contract, so a real
// operator configuration must be derived from that relation's actual policy and
// from the operator's known fixture relationships.
// -----------------------------------------------------------------------------

const syntheticId = (suffix: string) => `00000000-0000-4000-8000-${suffix}`;

/**
 * Synthetic candidate row IDs per surface (fixture illustration):
 *  authorized = row on the Project the Project members legitimately read
 *  sameWs     = row on another Project inside the same Workspace
 *  otherWs    = row on a Project in another Workspace of the same Organization
 *  crossOrg   = row on a Project in another Organization / Tenant
 *  removed    = row on the Project whose membership was removed
 */
function syntheticSurfaceIds(base: number) {
  return {
    authorized: syntheticId(String(base + 1).padStart(12, "0")),
    sameWs: syntheticId(String(base + 2).padStart(12, "0")),
    otherWs: syntheticId(String(base + 3).padStart(12, "0")),
    crossOrg: syntheticId(String(base + 4).padStart(12, "0")),
    removed: syntheticId(String(base + 5).padStart(12, "0")),
  };
}

const SURFACE_ID_BASES: Record<KpiDocSurface, number> = {
  kpi_definitions: 100_000,
  kpi_updates: 200_000,
  kpi_snapshots: 300_000,
  generated_operational_documents: 400_000,
};

function exampleSurface(surface: KpiDocSurface): KpiDocSurfaceConfig {
  const ids = syntheticSurfaceIds(SURFACE_ID_BASES[surface]);

  return {
    candidate_ids: [
      ids.authorized,
      ids.sameWs,
      ids.otherWs,
      ids.crossOrg,
      ids.removed,
    ],
    expected_visible_ids: {
      // Administrative breadth: legitimately several rows across the
      // administered Organization's Projects.
      ordinary_org_admin: [ids.authorized, ids.sameWs, ids.otherWs, ids.removed],
      // Narrower administrative breadth inside one Workspace.
      ordinary_workspace_admin: [ids.authorized, ids.sameWs, ids.removed],
      // Project-derived authority on the authorized Project.
      ordinary_project_manager: [ids.authorized],
      ordinary_contributor: [ids.authorized],
      ordinary_viewer: [ids.authorized],
      // Workspace member with no Project membership: no Project-derived rows.
      ordinary_workspace_member_no_project: [],
      // Boundary scenario with mixed legitimate visibility: this principal is a
      // member of the other Workspace's Project only.
      ordinary_same_org_other_workspace: [ids.otherWs],
      // Cross-Organization principal sees only its own Organization's row.
      ordinary_cross_org: [ids.crossOrg],
      // Removed Project membership excludes ids.removed, while unrelated
      // legitimate access to the authorized Project is retained.
      ordinary_removed_project_membership: [ids.authorized],
      // Fail-closed on every surface.
      ordinary_deactivated_user: [],
    },
  };
}

export const EXAMPLE_KPI_DOC_MATRIX_CONFIG: KpiDocMatrixConfig = {
  schema: KPI_DOC_MATRIX_CONFIG_SCHEMA,
  supabase_url_env: "PROBE_SUPABASE_URL",
  supabase_anon_key_env: "PROBE_SUPABASE_ANON_KEY",
  timeout_ms: 10_000,
  coverage: {
    tenant_ids: [syntheticId("000000000101"), syntheticId("000000000102")],
    organization_ids: [syntheticId("000000000201"), syntheticId("000000000202")],
    workspace_ids: [
      syntheticId("000000000301"),
      syntheticId("000000000302"),
      syntheticId("000000000303"),
    ],
    project_ids: [
      syntheticId("000000000401"),
      syntheticId("000000000402"),
      syntheticId("000000000403"),
      syntheticId("000000000404"),
    ],
  },
  principals: REQUIRED_KPI_DOC_MATRIX_SCENARIOS.map((scenario) => ({
    scenario,
    type: "ordinary_browser" as const,
    token_env: `PROBE_TOKEN_${scenario.toUpperCase()}`,
  })),
  surfaces: {
    kpi_definitions: exampleSurface("kpi_definitions"),
    kpi_updates: exampleSurface("kpi_updates"),
    kpi_snapshots: exampleSurface("kpi_snapshots"),
    generated_operational_documents: exampleSurface(
      "generated_operational_documents",
    ),
  },
};

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

export const KPI_DOC_MATRIX_HELP_TEXT = `API-HR.16 — KPI & Generated-Document Project-Scope Matrix Harness (read-only)

Usage:
  bun scripts/api-hr/kpiGeneratedDocumentAccessMatrixProbe.ts --config <local-config.json>

Options:
  --config <path>           Operator-local configuration (never commit it).
  --output <path>           Write the result document (never commit it).
  --print-example-config    Print a synthetic placeholder-only example config.
  --help                    Show this help.

Fixed surfaces: ${KPI_DOC_SURFACES.join(", ")}
Exit codes: 0 all passed, 1 authorization failure(s), 2 blocked check(s).

The harness performs exactly one bounded GET /rest/v1/<surface>?select=id
request per principal x surface. It never issues an RPC, an Edge Function call,
a generation or SharePoint call, a mutation, or a service-role request, and it
never emits tokens, keys, JWT payloads, KPI names, descriptions, values,
comments, action plans, generated filenames, SharePoint metadata,
encrypted/decrypted values, or complete database rows.

A non-zero row count is never, by itself, a defect: administrative breadth and
Project-derived breadth are legitimate. Only an exact mismatch against the
operator-declared expected set is a finding.`;

export function parseKpiDocMatrixCliArgs(argv: string[]): {
  help?: boolean;
  printExample?: boolean;
  configPath?: string;
  outputPath?: string;
} {
  const out: {
    help?: boolean;
    printExample?: boolean;
    configPath?: string;
    outputPath?: string;
  } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--print-example-config") out.printExample = true;
    else if (arg === "--config") out.configPath = argv[++i];
    else if (arg === "--output") out.outputPath = argv[++i];
    else throw new KpiDocMatrixConfigError(`unknown_argument:${arg}`);
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
    const args = parseKpiDocMatrixCliArgs(proc.argv.slice(2));
    if (args.help) {
      console.log(KPI_DOC_MATRIX_HELP_TEXT);
      proc.exit(0);
    }
    if (args.printExample) {
      console.log(JSON.stringify(EXAMPLE_KPI_DOC_MATRIX_CONFIG, null, 2));
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
    const config = validateKpiDocMatrixConfig(raw);
    const result = await runKpiGeneratedDocumentAccessMatrix(config, {
      env: proc.env,
      fetchImpl: fetch,
    });
    const serialized = JSON.stringify(result, null, 2);
    if (args.outputPath) await writeFile(args.outputPath, serialized, "utf8");
    console.log(serialized);
    proc.exit(exitCodeForKpiDocMatrixResult(result));
  } catch (error) {
    const code =
      error instanceof KpiDocMatrixConfigError ? error.code : "blocked";
    console.error(`blocked: ${code}`);
    proc.exit(2);
  }
}

const isDirectRun = (() => {
  const g = globalThis as unknown as { process?: { argv?: string[] } };
  const argv1 = g.process?.argv?.[1] ?? "";
  return (
    argv1.includes("kpiGeneratedDocumentAccessMatrixProbe.ts") &&
    !argv1.includes(".test.")
  );
})();

if (isDirectRun) {
  await main();
}
