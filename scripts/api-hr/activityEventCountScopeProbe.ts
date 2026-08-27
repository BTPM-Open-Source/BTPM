// API-HR.17 — activity_events Count-Response Scope Probe.
//
// Read-only operator tool. Proves EFFECTIVE ordinary-browser visibility of known
// candidate activity events WITHOUT ever retrieving an activity-event row body,
// metadata, actor, target, event type or timestamp.
//
// Fixed verification surface (non-configurable):
//   public.activity_events
//
// Hard rules enforced by this file:
//   - Exactly one bounded request per principal × candidate:
//       HEAD /rest/v1/activity_events?select=id&id=eq.<candidate>&limit=1
//     with `Prefer: count=exact` and `Range: 0-0`.
//   - HEAD only. The response body is NEVER read (no .json(), .text(),
//     .arrayBuffer(), .blob(), .formData()).
//   - Visibility evidence comes exclusively from the `Content-Range` response
//     header. Because activity_events.id is unique, only counts 0 and 1 are
//     acceptable; anything else is blocked.
//   - No select=*, no metadata/actor/target/event-type/timestamp selection, no
//     custom relation, no custom column, no RPC, no Edge Function, no
//     service-role material, and no mutation method — ever.
//   - Ordinary browser principals only. No anonymous, no external OAuth,
//     no service-role principal.
//   - Credentials are referenced by environment-variable NAME only.
//   - Candidate activity-event UUIDs are configuration-local: they appear only
//     inside the outbound PostgREST filter and are NEVER emitted in results.
//
// This step makes NO runtime authorization change. It does not modify
// activity_events, ae_select_scoped, api_e_oauth_read_containment, any other
// activity-event RLS policy, log_activity_event, list_project_activity_events,
// any activity-event trigger, encryption handling or grant, and it does not
// touch src/hooks/useAccessHistory.ts or src/hooks/useProjectActivityEvents.ts.
//
// JWT payload inspection is a CONFIGURATION PRECONDITION ONLY: it is not
// signature verification and establishes no authorization evidence.
//
// The harness does NOT derive activity-event ownership, target relationships or
// scope. Fixture relationships are OPERATOR-DECLARED.

export const ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA =
  "api_hr_activity_event_count_scope_v1";
export const ACTIVITY_EVENT_COUNT_RESULT_SCHEMA =
  "api_hr_activity_event_count_scope_result_v1";

/** The ten mandatory ordinary-browser scenarios for API-HR.17. */
export const REQUIRED_ACTIVITY_EVENT_SCENARIOS = [
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

export type ActivityEventScenario =
  (typeof REQUIRED_ACTIVITY_EVENT_SCENARIOS)[number];

/** Fixed, non-configurable relation. */
export const ACTIVITY_EVENT_RELATION = "activity_events" as const;
/** Fixed, non-configurable REST path. */
export const ACTIVITY_EVENT_REST_PATH = "/rest/v1/activity_events" as const;
/** Fixed, non-configurable selected column. */
export const ACTIVITY_EVENT_SELECT_COLUMN = "id" as const;
/** Fixed, non-configurable HTTP method. */
export const ACTIVITY_EVENT_REQUEST_METHOD = "HEAD" as const;

/** Only ordinary BTPM browser sessions are supported in this step. */
export const ALLOWED_ACTIVITY_EVENT_PRINCIPAL_TYPES = [
  "ordinary_browser",
] as const;

const FORBIDDEN_PRINCIPAL_TYPES = [
  "anonymous",
  "external_oauth",
  "service_role",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALIAS_PATTERN = /^[a-z0-9_]{1,64}$/;

const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 25;

const MIN_COVERAGE = {
  tenant_ids: 2,
  organization_ids: 2,
  workspace_ids: 3,
  project_ids: 4,
  user_ids: 4,
} as const;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ActivityEventPrincipalConfig {
  scenario: ActivityEventScenario;
  type: "ordinary_browser";
  /** Environment-variable NAME holding the ordinary browser bearer token. */
  token_env: string;
}

export interface ActivityEventCoverageDeclaration {
  tenant_ids: string[];
  organization_ids: string[];
  workspace_ids: string[];
  project_ids: string[];
  user_ids: string[];
}

export interface ActivityEventCandidateConfig {
  /** Non-sensitive local fixture alias — the ONLY candidate identifier in output. */
  alias: string;
  /** Config-local candidate UUID. Never emitted in results. */
  event_id: string;
  /** Explicit boolean expectation for every one of the ten scenarios. */
  expected_visible: Record<string, boolean>;
}

export interface ActivityEventCountScopeConfig {
  schema: string;
  supabase_url_env: string;
  supabase_anon_key_env: string;
  timeout_ms: number;
  coverage: ActivityEventCoverageDeclaration;
  principals: ActivityEventPrincipalConfig[];
  candidates: ActivityEventCandidateConfig[];
}

export type ActivityEventOutcome = "passed" | "failed" | "blocked";

export interface ActivityEventResultEntry {
  principal_scenario: string;
  candidate_alias: string;
  expected_visible: boolean;
  observed_count: number | null;
  http_status: number | null;
  outcome: ActivityEventOutcome;
  reason_code: string;
}

export interface ActivityEventCountScopeRunResult {
  schema: typeof ACTIVITY_EVENT_COUNT_RESULT_SCHEMA;
  config_schema: string;
  started_at: string;
  completed_at: string;
  summary: { passed: number; failed: number; blocked: number; total: number };
  results: ActivityEventResultEntry[];
}

export class ActivityEventCountScopeConfigError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ActivityEventCountScopeConfigError";
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
    if (!allowed.includes(key)) {
      throw new ActivityEventCountScopeConfigError(code);
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
  "candidates",
] as const;

const ALLOWED_COVERAGE_KEYS = [
  "tenant_ids",
  "organization_ids",
  "workspace_ids",
  "project_ids",
  "user_ids",
] as const;

const ALLOWED_PRINCIPAL_KEYS = ["scenario", "type", "token_env"] as const;

const ALLOWED_CANDIDATE_KEYS = [
  "alias",
  "event_id",
  "expected_visible",
] as const;

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
  "relation",
  "select",
  "columns",
  "metadata",
  "event_type",
  "target_type",
  "actor_id",
  "edge_function",
];

function requireEnvName(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw new ActivityEventCountScopeConfigError(code);
  }
  return value;
}

function assertNoInlineSecret(value: unknown, code: string): void {
  if (typeof value !== "string") return;
  if (value.split(".").length === 3 || value.length > 120) {
    throw new ActivityEventCountScopeConfigError(code);
  }
}

function requireUuidList(
  value: unknown,
  minimum: number,
  key: string,
): string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new ActivityEventCountScopeConfigError(
      `coverage_insufficient_${key}`,
    );
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new ActivityEventCountScopeConfigError(`coverage_invalid_${key}`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new ActivityEventCountScopeConfigError(`coverage_duplicate_${key}`);
  }
  return ids;
}

function validateCoverage(raw: unknown): ActivityEventCoverageDeclaration {
  if (!isPlainObject(raw)) {
    throw new ActivityEventCountScopeConfigError("coverage_missing");
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
    user_ids: requireUuidList(raw.user_ids, MIN_COVERAGE.user_ids, "user_ids"),
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
    throw new ActivityEventCountScopeConfigError("token_not_jwt_shaped");
  }
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!isPlainObject(payload)) {
      throw new ActivityEventCountScopeConfigError("token_payload_invalid");
    }
    return payload;
  } catch (error) {
    if (error instanceof ActivityEventCountScopeConfigError) throw error;
    throw new ActivityEventCountScopeConfigError("token_payload_invalid");
  }
}

/** Ordinary browser tokens must never carry an external OAuth client_id claim. */
export function assertOrdinaryBrowserToken(token: string): void {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new ActivityEventCountScopeConfigError("token_blank");
  }
  const payload = inspectJwtPayloadForPreflight(token);
  if (Object.prototype.hasOwnProperty.call(payload, "client_id")) {
    throw new ActivityEventCountScopeConfigError(
      "ordinary_browser_token_has_client_id",
    );
  }
}

function validatePrincipals(raw: unknown): ActivityEventPrincipalConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ActivityEventCountScopeConfigError("principals_missing");
  }
  const principals: ActivityEventPrincipalConfig[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      throw new ActivityEventCountScopeConfigError("principal_invalid");
    }
    assertExactKeys(
      entry,
      ALLOWED_PRINCIPAL_KEYS,
      "undeclared_principal_property",
    );

    const type = entry.type;
    if (typeof type !== "string") {
      throw new ActivityEventCountScopeConfigError("principal_type_invalid");
    }
    for (const forbidden of FORBIDDEN_PRINCIPAL_TYPES) {
      if (type === forbidden || type.includes(forbidden)) {
        throw new ActivityEventCountScopeConfigError(
          `${forbidden}_principal_forbidden`,
        );
      }
    }
    if (
      !(ALLOWED_ACTIVITY_EVENT_PRINCIPAL_TYPES as readonly string[]).includes(
        type,
      )
    ) {
      throw new ActivityEventCountScopeConfigError("principal_type_invalid");
    }

    const scenario = entry.scenario;
    if (
      typeof scenario !== "string" ||
      !(REQUIRED_ACTIVITY_EVENT_SCENARIOS as readonly string[]).includes(
        scenario,
      )
    ) {
      throw new ActivityEventCountScopeConfigError(
        "unknown_principal_scenario",
      );
    }

    assertNoInlineSecret(entry.token_env, "inline_secret_forbidden");
    const tokenEnv = requireEnvName(
      entry.token_env,
      "principal_token_env_invalid",
    );

    principals.push({
      scenario: scenario as ActivityEventScenario,
      type: "ordinary_browser",
      token_env: tokenEnv,
    });
  }

  const scenarios = principals.map((p) => p.scenario);
  if (new Set(scenarios).size !== scenarios.length) {
    throw new ActivityEventCountScopeConfigError("duplicate_principal_scenario");
  }
  for (const required of REQUIRED_ACTIVITY_EVENT_SCENARIOS) {
    if (!scenarios.includes(required)) {
      throw new ActivityEventCountScopeConfigError(
        `missing_principal_scenario:${required}`,
      );
    }
  }
  return principals;
}

function validateExpectedVisible(
  raw: unknown,
  alias: string,
): Record<string, boolean> {
  if (!isPlainObject(raw)) {
    throw new ActivityEventCountScopeConfigError(
      `expected_visible_missing:${alias}`,
    );
  }
  assertExactKeys(
    raw,
    REQUIRED_ACTIVITY_EVENT_SCENARIOS,
    "unknown_principal_scenario",
  );
  const expected: Record<string, boolean> = {};
  for (const scenario of REQUIRED_ACTIVITY_EVENT_SCENARIOS) {
    if (!Object.prototype.hasOwnProperty.call(raw, scenario)) {
      throw new ActivityEventCountScopeConfigError(
        `missing_expected_scenario:${scenario}`,
      );
    }
    const value = raw[scenario];
    if (typeof value !== "boolean") {
      throw new ActivityEventCountScopeConfigError(
        `expected_visible_not_boolean:${scenario}`,
      );
    }
    expected[scenario] = value;
  }
  // The only structurally fixed expectation in API-HR.17.
  if (expected.ordinary_deactivated_user !== false) {
    throw new ActivityEventCountScopeConfigError(
      "deactivated_user_must_expect_hidden",
    );
  }
  return expected;
}

function validateCandidates(raw: unknown): ActivityEventCandidateConfig[] {
  if (!Array.isArray(raw) || raw.length < MIN_CANDIDATES) {
    throw new ActivityEventCountScopeConfigError("candidates_missing");
  }
  if (raw.length > MAX_CANDIDATES) {
    throw new ActivityEventCountScopeConfigError("candidates_exceed_bound");
  }
  const candidates: ActivityEventCandidateConfig[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      throw new ActivityEventCountScopeConfigError("candidate_invalid");
    }
    assertExactKeys(
      entry,
      ALLOWED_CANDIDATE_KEYS,
      "undeclared_candidate_property",
    );

    const alias = entry.alias;
    if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
      throw new ActivityEventCountScopeConfigError("candidate_alias_invalid");
    }
    const eventId = entry.event_id;
    if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
      throw new ActivityEventCountScopeConfigError("candidate_event_id_invalid");
    }

    candidates.push({
      alias,
      event_id: eventId,
      expected_visible: validateExpectedVisible(entry.expected_visible, alias),
    });
  }

  const aliases = candidates.map((c) => c.alias);
  if (new Set(aliases).size !== aliases.length) {
    throw new ActivityEventCountScopeConfigError("duplicate_candidate_alias");
  }
  const ids = candidates.map((c) => c.event_id);
  if (new Set(ids).size !== ids.length) {
    throw new ActivityEventCountScopeConfigError("duplicate_candidate_event_id");
  }
  return candidates;
}

export function validateActivityEventCountScopeConfig(
  raw: unknown,
): ActivityEventCountScopeConfig {
  if (!isPlainObject(raw)) {
    throw new ActivityEventCountScopeConfigError("config_not_object");
  }
  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, forbidden)) {
      throw new ActivityEventCountScopeConfigError(
        "undeclared_top_level_property",
      );
    }
  }
  assertExactKeys(raw, ALLOWED_CONFIG_KEYS, "undeclared_top_level_property");

  if (raw.schema !== ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA) {
    throw new ActivityEventCountScopeConfigError("unsupported_config_schema");
  }
  assertNoInlineSecret(raw.supabase_url_env, "inline_secret_forbidden");
  assertNoInlineSecret(raw.supabase_anon_key_env, "inline_secret_forbidden");

  const supabaseUrlEnv = requireEnvName(
    raw.supabase_url_env,
    "supabase_url_env_invalid",
  );
  const supabaseAnonKeyEnv = requireEnvName(
    raw.supabase_anon_key_env,
    "supabase_anon_key_env_invalid",
  );

  const timeout = raw.timeout_ms;
  if (
    typeof timeout !== "number" ||
    !Number.isFinite(timeout) ||
    timeout < 1_000 ||
    timeout > 60_000
  ) {
    throw new ActivityEventCountScopeConfigError("timeout_ms_invalid");
  }

  return {
    schema: ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA,
    supabase_url_env: supabaseUrlEnv,
    supabase_anon_key_env: supabaseAnonKeyEnv,
    timeout_ms: timeout,
    coverage: validateCoverage(raw.coverage),
    principals: validatePrincipals(raw.principals),
    candidates: validateCandidates(raw.candidates),
  };
}

// -----------------------------------------------------------------------------
// Request construction — bounded HEAD /rest/v1/activity_events, identifier only
// -----------------------------------------------------------------------------

export function buildActivityEventCountRequestUrl(
  baseUrl: string,
  candidateEventId: string,
): string {
  if (typeof candidateEventId !== "string" || !UUID_PATTERN.test(candidateEventId)) {
    throw new ActivityEventCountScopeConfigError("candidate_event_id_invalid");
  }
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmed}${ACTIVITY_EVENT_REST_PATH}`);
  url.searchParams.set("select", ACTIVITY_EVENT_SELECT_COLUMN);
  url.searchParams.set(
    ACTIVITY_EVENT_SELECT_COLUMN,
    `eq.${candidateEventId}`,
  );
  url.searchParams.set("limit", "1");
  return url.toString();
}

export function buildActivityEventCountRequestHeaders(
  anonKey: string,
  bearerToken: string,
): Record<string, string> {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${bearerToken}`,
    Prefer: "count=exact",
    Range: "0-0",
  };
}

// -----------------------------------------------------------------------------
// Content-Range parsing — the ONLY visibility evidence
// -----------------------------------------------------------------------------

export type ContentRangeParse =
  | { ok: true; total: number }
  | { ok: false; reason: "missing_content_range" | "malformed_content_range" };

/**
 * Accepts exact-count shapes such as `0-0/1` and `* /0`. The value after `/`
 * is authoritative. Wildcard, non-numeric and missing totals are rejected.
 */
export function parseExactCountContentRange(
  headerValue: string | null | undefined,
): ContentRangeParse {
  if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
    return { ok: false, reason: "missing_content_range" };
  }
  const value = headerValue.trim();
  const match = /^(?:\*|\d+-\d+)\/(.+)$/.exec(value);
  if (!match) return { ok: false, reason: "malformed_content_range" };
  const totalRaw = match[1].trim();
  if (!/^\d+$/.test(totalRaw)) {
    return { ok: false, reason: "malformed_content_range" };
  }
  const total = Number(totalRaw);
  if (!Number.isSafeInteger(total) || total < 0) {
    return { ok: false, reason: "malformed_content_range" };
  }
  return { ok: true, total };
}

// -----------------------------------------------------------------------------
// Evaluation
// -----------------------------------------------------------------------------

export function evaluateActivityEventCountResponse(args: {
  scenario: string;
  expectedVisible: boolean;
  status: number | null;
  contentRange: string | null | undefined;
  transportError?: boolean;
  timedOut?: boolean;
}): Pick<
  ActivityEventResultEntry,
  "outcome" | "observed_count" | "reason_code"
> {
  if (args.timedOut) {
    return {
      outcome: "blocked",
      observed_count: null,
      reason_code: "request_timeout",
    };
  }
  if (args.transportError) {
    return {
      outcome: "blocked",
      observed_count: null,
      reason_code: "transport_error",
    };
  }

  const status = args.status;

  if (status === 401 || status === 403) {
    if (args.expectedVisible) {
      return {
        outcome: "blocked",
        observed_count: null,
        reason_code: "expected_activity_event_request_denied",
      };
    }
    return {
      outcome: "passed",
      observed_count: null,
      reason_code: "contained_direct_read",
    };
  }

  if (status !== 200 && status !== 206) {
    return {
      outcome: "blocked",
      observed_count: null,
      reason_code: "unexpected_http_status",
    };
  }

  const parsed = parseExactCountContentRange(args.contentRange);
  if (!parsed.ok) {
    return { outcome: "blocked", observed_count: null, reason_code: parsed.reason };
  }
  if (parsed.total > 1) {
    return {
      outcome: "blocked",
      observed_count: parsed.total,
      reason_code: "unexpected_count_greater_than_one",
    };
  }

  if (args.expectedVisible) {
    if (parsed.total === 1) {
      return {
        outcome: "passed",
        observed_count: 1,
        reason_code: "expected_activity_event_visible",
      };
    }
    return {
      outcome: "failed",
      observed_count: 0,
      reason_code: "expected_activity_event_not_visible",
    };
  }

  if (parsed.total === 0) {
    return {
      outcome: "passed",
      observed_count: 0,
      reason_code: "expected_zero_count",
    };
  }
  return {
    outcome: "failed",
    observed_count: 1,
    reason_code:
      args.scenario === "ordinary_deactivated_user"
        ? "deactivated_user_saw_activity_event"
        : "unexpected_activity_event_visible",
  };
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

export interface ActivityEventCountRunnerEnvironment {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now?: () => Date;
}

export async function runActivityEventCountScopeProbe(
  config: ActivityEventCountScopeConfig,
  runtime: ActivityEventCountRunnerEnvironment,
): Promise<ActivityEventCountScopeRunResult> {
  const now = runtime.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: ActivityEventResultEntry[] = [];

  const baseUrl = runtime.env[config.supabase_url_env];
  const anonKey = runtime.env[config.supabase_anon_key_env];

  for (const principal of config.principals) {
    let principalBlockedReason: string | null = null;
    let token: string | undefined;

    if (!baseUrl) principalBlockedReason = "missing_supabase_url_env";
    else if (!anonKey) principalBlockedReason = "missing_anon_key_env";
    else {
      token = runtime.env[principal.token_env];
      if (!token) principalBlockedReason = "missing_principal_token_env";
      else {
        try {
          assertOrdinaryBrowserToken(token);
        } catch (error) {
          principalBlockedReason =
            error instanceof ActivityEventCountScopeConfigError
              ? error.code
              : "token_preflight_failed";
        }
      }
    }

    for (const candidate of config.candidates) {
      const expectedVisible = candidate.expected_visible[principal.scenario];

      if (principalBlockedReason) {
        results.push({
          principal_scenario: principal.scenario,
          candidate_alias: candidate.alias,
          expected_visible: expectedVisible,
          observed_count: null,
          http_status: null,
          outcome: "blocked",
          reason_code: principalBlockedReason,
        });
        continue;
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeout_ms);

      let status: number | null = null;
      let contentRange: string | null = null;
      let transportError = false;

      try {
        const response = await runtime.fetchImpl(
          buildActivityEventCountRequestUrl(
            baseUrl as string,
            candidate.event_id,
          ),
          {
            method: ACTIVITY_EVENT_REQUEST_METHOD,
            headers: buildActivityEventCountRequestHeaders(
              anonKey as string,
              token as string,
            ),
            signal: controller.signal,
          },
        );
        status = response.status;
        // The response body is NEVER read. Only this single header is inspected.
        contentRange = response.headers.get("content-range");
      } catch {
        transportError = true;
      } finally {
        clearTimeout(timer);
      }

      const evaluation = evaluateActivityEventCountResponse({
        scenario: principal.scenario,
        expectedVisible,
        status,
        contentRange,
        transportError: transportError && !timedOut,
        timedOut,
      });

      results.push({
        principal_scenario: principal.scenario,
        candidate_alias: candidate.alias,
        expected_visible: expectedVisible,
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
    schema: ACTIVITY_EVENT_COUNT_RESULT_SCHEMA,
    config_schema: config.schema,
    started_at: startedAt,
    completed_at: now().toISOString(),
    summary,
    results,
  };
}

export function exitCodeForActivityEventCountResult(
  result: ActivityEventCountScopeRunResult,
): 0 | 1 | 2 {
  if (result.summary.blocked > 0) return 2;
  if (result.summary.failed > 0) return 1;
  return 0;
}

// -----------------------------------------------------------------------------
// Example configuration — FIXTURE ILLUSTRATION ONLY.
//
// Synthetic UUIDs, synthetic aliases and environment-variable NAMES only.
// The expectations below are NOT universal authorization truth: the operator
// derives every boolean from known fixture facts and the accepted
// activity_events RLS contract.
// -----------------------------------------------------------------------------

const syntheticId = (suffix: string) => `00000000-0000-4000-8000-${suffix}`;

function exampleExpectation(
  values: Partial<Record<ActivityEventScenario, boolean>>,
): Record<string, boolean> {
  const expected: Record<string, boolean> = {};
  for (const scenario of REQUIRED_ACTIVITY_EVENT_SCENARIOS) {
    expected[scenario] = values[scenario] ?? false;
  }
  expected.ordinary_deactivated_user = false;
  return expected;
}

export const EXAMPLE_ACTIVITY_EVENT_COUNT_CONFIG: ActivityEventCountScopeConfig =
  {
    schema: ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA,
    supabase_url_env: "PROBE_SUPABASE_URL",
    supabase_anon_key_env: "PROBE_SUPABASE_ANON_KEY",
    timeout_ms: 10_000,
    coverage: {
      tenant_ids: [syntheticId("000000000101"), syntheticId("000000000102")],
      organization_ids: [
        syntheticId("000000000201"),
        syntheticId("000000000202"),
      ],
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
      user_ids: [
        syntheticId("000000000501"),
        syntheticId("000000000502"),
        syntheticId("000000000503"),
        syntheticId("000000000504"),
      ],
    },
    principals: REQUIRED_ACTIVITY_EVENT_SCENARIOS.map((scenario) => ({
      scenario,
      type: "ordinary_browser" as const,
      token_env: `PROBE_TOKEN_${scenario.toUpperCase()}`,
    })),
    candidates: [
      {
        alias: "authorized_project_event",
        event_id: syntheticId("000000000601"),
        expected_visible: exampleExpectation({
          ordinary_org_admin: true,
          ordinary_workspace_admin: true,
          ordinary_project_manager: true,
          ordinary_contributor: true,
          ordinary_viewer: true,
          ordinary_removed_project_membership: true,
        }),
      },
      {
        alias: "other_project_same_workspace",
        event_id: syntheticId("000000000602"),
        expected_visible: exampleExpectation({
          ordinary_org_admin: true,
          ordinary_workspace_admin: true,
        }),
      },
      {
        alias: "other_workspace_same_org",
        event_id: syntheticId("000000000603"),
        expected_visible: exampleExpectation({
          ordinary_org_admin: true,
          ordinary_same_org_other_workspace: true,
        }),
      },
      {
        alias: "cross_org_event",
        event_id: syntheticId("000000000604"),
        expected_visible: exampleExpectation({
          ordinary_cross_org: true,
        }),
      },
      {
        alias: "removed_project_event",
        event_id: syntheticId("000000000605"),
        expected_visible: exampleExpectation({
          ordinary_org_admin: true,
          ordinary_workspace_admin: true,
        }),
      },
      {
        alias: "workspace_access_event",
        event_id: syntheticId("000000000606"),
        expected_visible: exampleExpectation({
          ordinary_org_admin: true,
          ordinary_workspace_admin: true,
        }),
      },
      {
        alias: "user_access_event",
        event_id: syntheticId("000000000607"),
        expected_visible: exampleExpectation({
          ordinary_org_admin: true,
        }),
      },
    ],
  };

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

export const ACTIVITY_EVENT_COUNT_HELP_TEXT = `API-HR.17 — activity_events Count-Response Scope Probe (read-only)

Usage:
  bun scripts/api-hr/activityEventCountScopeProbe.ts --config <local-config.json>

Options:
  --config <path>           Operator-local configuration (never commit it).
  --output <path>           Write the result document (never commit it).
  --print-example-config    Print a synthetic placeholder-only example config.
  --help                    Show this help.

Fixed relation: public.${ACTIVITY_EVENT_RELATION}
Exit codes: 0 all passed, 1 authorization failure(s), 2 blocked check(s).

The harness performs exactly one bounded
  HEAD ${ACTIVITY_EVENT_REST_PATH}?select=id&id=eq.<candidate>&limit=1
request per principal x candidate, with Prefer: count=exact and Range: 0-0. It
never reads a response body, never retrieves an activity-event row, metadata,
actor, target, event type or timestamp, never issues an RPC, Edge Function,
mutation or service-role request, and never emits tokens, keys, JWT payloads,
candidate event UUIDs or complete response headers.

Candidate visibility expectations are OPERATOR-DECLARED. The only structurally
fixed rule is that ordinary_deactivated_user must expect false everywhere.`;

export function parseActivityEventCountCliArgs(argv: string[]): {
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
    else
      throw new ActivityEventCountScopeConfigError(`unknown_argument:${arg}`);
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
    const args = parseActivityEventCountCliArgs(proc.argv.slice(2));
    if (args.help) {
      console.log(ACTIVITY_EVENT_COUNT_HELP_TEXT);
      proc.exit(0);
    }
    if (args.printExample) {
      console.log(JSON.stringify(EXAMPLE_ACTIVITY_EVENT_COUNT_CONFIG, null, 2));
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
    const config = validateActivityEventCountScopeConfig(raw);
    const result = await runActivityEventCountScopeProbe(config, {
      env: proc.env,
      fetchImpl: fetch,
    });
    const serialized = JSON.stringify(result, null, 2);
    if (args.outputPath) await writeFile(args.outputPath, serialized, "utf8");
    console.log(serialized);
    proc.exit(exitCodeForActivityEventCountResult(result));
  } catch (error) {
    const code =
      error instanceof ActivityEventCountScopeConfigError
        ? error.code
        : "blocked";
    console.error(`blocked: ${code}`);
    proc.exit(2);
  }
}

const isDirectRun = (() => {
  const g = globalThis as unknown as { process?: { argv?: string[] } };
  const argv1 = g.process?.argv?.[1] ?? "";
  return (
    argv1.includes("activityEventCountScopeProbe.ts") &&
    !argv1.includes(".test.")
  );
})();

if (isDirectRun) {
  await main();
}
