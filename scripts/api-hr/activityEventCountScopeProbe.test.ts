// API-HR.17 — focused tests for the activity_events count-response scope probe.
// Mocked fetch only. No live Supabase or external network call.

import { describe, expect, it } from "bun:test";
import {
  ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA,
  ACTIVITY_EVENT_COUNT_RESULT_SCHEMA,
  ACTIVITY_EVENT_REST_PATH,
  ActivityEventCountScopeConfigError,
  EXAMPLE_ACTIVITY_EVENT_COUNT_CONFIG,
  REQUIRED_ACTIVITY_EVENT_SCENARIOS,
  buildActivityEventCountRequestHeaders,
  buildActivityEventCountRequestUrl,
  evaluateActivityEventCountResponse,
  exitCodeForActivityEventCountResult,
  parseActivityEventCountCliArgs,
  parseExactCountContentRange,
  runActivityEventCountScopeProbe,
  validateActivityEventCountScopeConfig,
} from "./activityEventCountScopeProbe";

// --- helpers -----------------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;

const ORDINARY_TOKEN = jwt({
  sub: "11111111-1111-4111-8111-111111111111",
  role: "authenticated",
});
const OAUTH_TOKEN = jwt({ sub: "x", client_id: "btpm-external-app" });

const EXAMPLE = EXAMPLE_ACTIVITY_EVENT_COUNT_CONFIG;

function envFor(config = EXAMPLE): Record<string, string> {
  const env: Record<string, string> = {
    PROBE_SUPABASE_URL: "https://example.supabase.co",
    PROBE_SUPABASE_ANON_KEY: "anon-key-value",
  };
  for (const p of config.principals) env[p.token_env] = ORDINARY_TOKEN;
  return env;
}

type Spec = {
  status: number;
  contentRange?: string | null;
  throwError?: boolean;
  abort?: boolean;
};

/** Response whose body-reading methods throw if ever called. */
function bodyHostileResponse(spec: Spec) {
  const headers = new Headers();
  if (spec.contentRange !== null && spec.contentRange !== undefined) {
    headers.set("content-range", spec.contentRange);
  }
  const explode = () => {
    throw new Error("response body must never be read");
  };
  return {
    status: spec.status,
    headers,
    json: explode,
    text: explode,
    arrayBuffer: explode,
    blob: explode,
    formData: explode,
  } as unknown as Response;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function mockFetch(resolve: (url: string) => Spec) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      (init?.headers ?? {}) as Record<string, string>,
    )) {
      headers[k] = v;
    }
    calls.push({ url, method: String(init?.method ?? "GET"), headers });
    const spec = resolve(url);
    if (spec.throwError) throw new Error("network down");
    if (spec.abort) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return bodyHostileResponse(spec);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Answer every request with the operator-declared expectation (all-pass run). */
function conformingResolver(config = EXAMPLE) {
  return (url: string): Spec => {
    const candidate = config.candidates.find((c) =>
      url.includes(`eq.${c.event_id}`),
    );
    if (!candidate) return { status: 500 };
    // Expectations are per principal; the token is identical across principals in
    // tests, so resolve by the widest-truth candidate is not possible. Instead the
    // conforming runs below use a single-principal config.
    const anyTrue = Object.values(candidate.expected_visible).some(Boolean);
    return {
      status: 200,
      contentRange: anyTrue ? "0-0/1" : "*/0",
    };
  };
}

// --- configuration -----------------------------------------------------------

describe("API-HR.17 configuration", () => {
  it("accepts the complete synthetic example configuration", () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    expect(config.schema).toBe(ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA);
    expect(config.principals).toHaveLength(10);
    expect(config.candidates.length).toBeGreaterThan(0);
  });

  it("requires all ten principal scenarios", () => {
    for (const scenario of REQUIRED_ACTIVITY_EVENT_SCENARIOS) {
      const config = clone(EXAMPLE);
      config.principals = config.principals.filter(
        (p) => p.scenario !== scenario,
      );
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        /missing_principal_scenario/,
      );
    }
  });

  it("rejects a duplicate scenario", () => {
    const config = clone(EXAMPLE);
    config.principals[1] = { ...config.principals[0] };
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /duplicate_principal_scenario|missing_principal_scenario/,
    );
  });

  it("rejects an unknown scenario", () => {
    const config = clone(EXAMPLE);
    (config.principals[0] as { scenario: string }).scenario = "ordinary_wizard";
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /unknown_principal_scenario/,
    );
  });

  it("rejects anonymous, external OAuth and service-role principal types", () => {
    for (const type of ["anonymous", "external_oauth", "service_role"]) {
      const config = clone(EXAMPLE);
      (config.principals[0] as { type: string }).type = type;
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        new RegExp(`${type}_principal_forbidden`),
      );
    }
  });

  it("rejects a custom principal type", () => {
    const config = clone(EXAMPLE);
    (config.principals[0] as { type: string }).type = "robot";
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /principal_type_invalid/,
    );
  });

  it("rejects inline bearer tokens and inline anon keys", () => {
    const withInlineToken = clone(EXAMPLE);
    (withInlineToken.principals[0] as { token_env: string }).token_env =
      ORDINARY_TOKEN;
    expect(() =>
      validateActivityEventCountScopeConfig(withInlineToken),
    ).toThrow(/inline_secret_forbidden/);

    for (const key of ["supabase_anon_key", "anon_key", "token", "authorization"]) {
      const config = clone(EXAMPLE) as unknown as Record<string, unknown>;
      config[key] = "value";
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        /undeclared_top_level_property/,
      );
    }
  });

  it("blocks an ordinary token carrying client_id at runtime preflight", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const env = envFor();
    env[config.principals[0].token_env] = OAUTH_TOKEN;
    const { calls, fetchImpl } = mockFetch(conformingResolver());
    const result = await runActivityEventCountScopeProbe(config, {
      env,
      fetchImpl,
    });
    const blocked = result.results.filter(
      (r) => r.reason_code === "ordinary_browser_token_has_client_id",
    );
    expect(blocked.length).toBe(config.candidates.length);
    expect(calls.every((c) => !c.headers.Authorization.includes(OAUTH_TOKEN))).toBe(
      true,
    );
  });

  it("safely blocks a blank or malformed JWT", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const env = envFor();
    env[config.principals[0].token_env] = "not-a-jwt";
    env[config.principals[1].token_env] = "   ";
    const { fetchImpl } = mockFetch(conformingResolver());
    const result = await runActivityEventCountScopeProbe(config, {
      env,
      fetchImpl,
    });
    const codes = new Set(
      result.results.filter((r) => r.outcome === "blocked").map((r) => r.reason_code),
    );
    expect(
      [...codes].some((c) =>
        ["token_not_jwt_shaped", "token_blank", "missing_principal_token_env"].includes(
          c,
        ),
      ),
    ).toBe(true);
  });

  it("rejects an undeclared top-level property", () => {
    const config = clone(EXAMPLE) as unknown as Record<string, unknown>;
    config.extra = true;
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /undeclared_top_level_property/,
    );
  });

  it("rejects an undeclared principal property", () => {
    const config = clone(EXAMPLE);
    (config.principals[0] as unknown as Record<string, unknown>).note = "x";
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /undeclared_principal_property/,
    );
  });

  it("rejects an undeclared coverage property", () => {
    const config = clone(EXAMPLE);
    (config.coverage as unknown as Record<string, unknown>).team_ids = [];
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /undeclared_coverage_property/,
    );
  });

  it("enforces coverage minimums", () => {
    const minima: Record<string, number> = {
      tenant_ids: 2,
      organization_ids: 2,
      workspace_ids: 3,
      project_ids: 4,
      user_ids: 4,
    };
    for (const [key, min] of Object.entries(minima)) {
      const config = clone(EXAMPLE);
      const list = (config.coverage as unknown as Record<string, string[]>)[key];
      expect(list.length).toBeGreaterThanOrEqual(min);
      (config.coverage as unknown as Record<string, string[]>)[key] = list.slice(
        0,
        min - 1,
      );
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        new RegExp(`coverage_insufficient_${key}`),
      );
    }
  });

  it("rejects invalid and duplicate coverage UUIDs", () => {
    const invalid = clone(EXAMPLE);
    invalid.coverage.project_ids[0] = "not-a-uuid";
    expect(() => validateActivityEventCountScopeConfig(invalid)).toThrow(
      /coverage_invalid_project_ids/,
    );

    const duplicate = clone(EXAMPLE);
    duplicate.coverage.user_ids[1] = duplicate.coverage.user_ids[0];
    expect(() => validateActivityEventCountScopeConfig(duplicate)).toThrow(
      /coverage_duplicate_user_ids/,
    );
  });

  it("rejects empty candidates and more than 25 candidates", () => {
    const empty = clone(EXAMPLE);
    empty.candidates = [];
    expect(() => validateActivityEventCountScopeConfig(empty)).toThrow(
      /candidates_missing/,
    );

    const many = clone(EXAMPLE);
    const template = many.candidates[0];
    many.candidates = Array.from({ length: 26 }, (_, i) => ({
      ...clone(template),
      alias: `candidate_${i}`,
      event_id: `00000000-0000-4000-8000-${String(700000 + i).padStart(12, "0")}`,
    }));
    expect(() => validateActivityEventCountScopeConfig(many)).toThrow(
      /candidates_exceed_bound/,
    );
  });

  it("rejects invalid and duplicate candidate event UUIDs", () => {
    const invalid = clone(EXAMPLE);
    invalid.candidates[0].event_id = "nope";
    expect(() => validateActivityEventCountScopeConfig(invalid)).toThrow(
      /candidate_event_id_invalid/,
    );

    const duplicate = clone(EXAMPLE);
    duplicate.candidates[1].event_id = duplicate.candidates[0].event_id;
    expect(() => validateActivityEventCountScopeConfig(duplicate)).toThrow(
      /duplicate_candidate_event_id/,
    );
  });

  it("rejects invalid and duplicate candidate aliases", () => {
    for (const alias of ["Has Upper", "has-dash", "", "x".repeat(65), "a b"]) {
      const config = clone(EXAMPLE);
      config.candidates[0].alias = alias;
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        /candidate_alias_invalid/,
      );
    }
    const duplicate = clone(EXAMPLE);
    duplicate.candidates[1].alias = duplicate.candidates[0].alias;
    expect(() => validateActivityEventCountScopeConfig(duplicate)).toThrow(
      /duplicate_candidate_alias/,
    );
  });

  it("rejects an undeclared candidate property", () => {
    const config = clone(EXAMPLE);
    (config.candidates[0] as unknown as Record<string, unknown>).note = "x";
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /undeclared_candidate_property/,
    );
  });

  it("rejects a missing expected scenario", () => {
    const config = clone(EXAMPLE);
    delete (config.candidates[0].expected_visible as Record<string, unknown>)
      .ordinary_viewer;
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /missing_expected_scenario:ordinary_viewer/,
    );
  });

  it("rejects an unknown scenario key inside expected_visible", () => {
    const config = clone(EXAMPLE);
    (config.candidates[0].expected_visible as Record<string, unknown>).wizard =
      true;
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /unknown_principal_scenario/,
    );
  });

  it("rejects non-boolean expectations", () => {
    for (const value of ["true", 1, null, [], {}]) {
      const config = clone(EXAMPLE);
      (config.candidates[0].expected_visible as Record<string, unknown>)
        .ordinary_viewer = value;
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        /expected_visible_not_boolean/,
      );
    }
  });

  it("rejects a deactivated-user true expectation", () => {
    const config = clone(EXAMPLE);
    config.candidates[0].expected_visible.ordinary_deactivated_user = true;
    expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
      /deactivated_user_must_expect_hidden/,
    );
  });

  it("rejects an unsupported config schema and invalid timeout", () => {
    const badSchema = clone(EXAMPLE);
    (badSchema as { schema: string }).schema = "other_v9";
    expect(() => validateActivityEventCountScopeConfig(badSchema)).toThrow(
      /unsupported_config_schema/,
    );

    for (const timeout of [0, 10, 999, 120_000, "5000", NaN]) {
      const config = clone(EXAMPLE) as unknown as Record<string, unknown>;
      config.timeout_ms = timeout;
      expect(() => validateActivityEventCountScopeConfig(config)).toThrow(
        /timeout_ms_invalid/,
      );
    }
  });
});

// --- Content-Range parsing ---------------------------------------------------

describe("API-HR.17 Content-Range parsing", () => {
  it("accepts valid exact-count shapes", () => {
    expect(parseExactCountContentRange("0-0/1")).toEqual({ ok: true, total: 1 });
    expect(parseExactCountContentRange("*/0")).toEqual({ ok: true, total: 0 });
    expect(parseExactCountContentRange(" 0-0/1 ")).toEqual({ ok: true, total: 1 });
  });

  it("rejects missing, wildcard-total, non-numeric and malformed values", () => {
    expect(parseExactCountContentRange(null).ok).toBe(false);
    expect(parseExactCountContentRange(undefined).ok).toBe(false);
    expect(parseExactCountContentRange("   ").ok).toBe(false);
    expect(parseExactCountContentRange("0-0/*")).toEqual({
      ok: false,
      reason: "malformed_content_range",
    });
    expect(parseExactCountContentRange("0-0/unknown").ok).toBe(false);
    expect(parseExactCountContentRange("garbage").ok).toBe(false);
    expect(parseExactCountContentRange("0-0").ok).toBe(false);
  });
});

// --- count evaluation --------------------------------------------------------

describe("API-HR.17 count evaluation", () => {
  const base = { scenario: "ordinary_viewer", status: 200 } as const;

  it("passes when visibility is expected and count is 1", () => {
    const r = evaluateActivityEventCountResponse({
      ...base,
      expectedVisible: true,
      contentRange: "0-0/1",
    });
    expect(r.outcome).toBe("passed");
    expect(r.observed_count).toBe(1);
    expect(r.reason_code).toBe("expected_activity_event_visible");
  });

  it("fails when visibility is expected and count is 0", () => {
    const r = evaluateActivityEventCountResponse({
      ...base,
      expectedVisible: true,
      contentRange: "*/0",
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("expected_activity_event_not_visible");
  });

  it("passes when hidden is expected and count is 0", () => {
    const r = evaluateActivityEventCountResponse({
      ...base,
      expectedVisible: false,
      contentRange: "*/0",
    });
    expect(r.outcome).toBe("passed");
    expect(r.reason_code).toBe("expected_zero_count");
  });

  it("fails when hidden is expected and count is 1", () => {
    const r = evaluateActivityEventCountResponse({
      ...base,
      expectedVisible: false,
      contentRange: "0-0/1",
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("unexpected_activity_event_visible");
  });

  it("uses the dedicated failure reason for the deactivated user", () => {
    const r = evaluateActivityEventCountResponse({
      scenario: "ordinary_deactivated_user",
      status: 200,
      expectedVisible: false,
      contentRange: "0-0/1",
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("deactivated_user_saw_activity_event");
  });

  it("passes on 401 and 403 when hidden is expected", () => {
    for (const status of [401, 403]) {
      const r = evaluateActivityEventCountResponse({
        scenario: "ordinary_cross_org",
        status,
        expectedVisible: false,
        contentRange: null,
      });
      expect(r.outcome).toBe("passed");
      expect(r.reason_code).toBe("contained_direct_read");
    }
  });

  it("blocks on 401 and 403 when visibility is expected", () => {
    for (const status of [401, 403]) {
      const r = evaluateActivityEventCountResponse({
        ...base,
        status,
        expectedVisible: true,
        contentRange: null,
      });
      expect(r.outcome).toBe("blocked");
      expect(r.reason_code).toBe("expected_activity_event_request_denied");
    }
  });

  it("blocks on missing, malformed and wildcard-total Content-Range", () => {
    expect(
      evaluateActivityEventCountResponse({
        ...base,
        expectedVisible: true,
        contentRange: null,
      }).reason_code,
    ).toBe("missing_content_range");
    expect(
      evaluateActivityEventCountResponse({
        ...base,
        expectedVisible: false,
        contentRange: "bogus",
      }).reason_code,
    ).toBe("malformed_content_range");
    expect(
      evaluateActivityEventCountResponse({
        ...base,
        expectedVisible: false,
        contentRange: "0-0/*",
      }).outcome,
    ).toBe("blocked");
  });

  it("blocks a count greater than one", () => {
    const r = evaluateActivityEventCountResponse({
      ...base,
      expectedVisible: true,
      contentRange: "0-1/2",
    });
    expect(r.outcome).toBe("blocked");
    expect(r.reason_code).toBe("unexpected_count_greater_than_one");
  });

  it("blocks unexpected HTTP status, network failure and timeout", () => {
    expect(
      evaluateActivityEventCountResponse({
        ...base,
        status: 500,
        expectedVisible: true,
        contentRange: null,
      }).reason_code,
    ).toBe("unexpected_http_status");
    expect(
      evaluateActivityEventCountResponse({
        ...base,
        expectedVisible: true,
        contentRange: "0-0/1",
        transportError: true,
      }).reason_code,
    ).toBe("transport_error");
    expect(
      evaluateActivityEventCountResponse({
        ...base,
        expectedVisible: true,
        contentRange: "0-0/1",
        timedOut: true,
      }).reason_code,
    ).toBe("request_timeout");
  });
});

// --- request safety ----------------------------------------------------------

describe("API-HR.17 request safety", () => {
  it("builds only bounded HEAD-style count URLs against the fixed relation", () => {
    const url = buildActivityEventCountRequestUrl(
      "https://example.supabase.co/",
      EXAMPLE.candidates[0].event_id,
    );
    expect(url).toBe(
      `https://example.supabase.co${ACTIVITY_EVENT_REST_PATH}?select=id&id=eq.${EXAMPLE.candidates[0].event_id}&limit=1`,
    );
    expect(url).not.toContain("select=*");
    expect(url).not.toContain("metadata");
    expect(url).not.toContain("event_type");
    expect(url).not.toContain("target");
    expect(url).not.toContain("actor");
    expect(url).not.toContain("created_at");
    expect(url).not.toContain("/rpc/");
    expect(url).not.toContain("/functions/");
  });

  it("rejects a non-UUID candidate in URL construction", () => {
    expect(() =>
      buildActivityEventCountRequestUrl("https://example.supabase.co", "nope"),
    ).toThrow(ActivityEventCountScopeConfigError);
  });

  it("builds exact-count headers", () => {
    const headers = buildActivityEventCountRequestHeaders("anon", "tok");
    expect(headers.Prefer).toBe("count=exact");
    expect(headers.Range).toBe("0-0");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers.apikey).toBe("anon");
  });

  it("issues exactly one HEAD request per principal x candidate and never reads a body", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const { calls, fetchImpl } = mockFetch(() => ({
      status: 200,
      contentRange: "*/0",
    }));
    const result = await runActivityEventCountScopeProbe(config, {
      env: envFor(),
      fetchImpl,
    });

    const expectedChecks = config.principals.length * config.candidates.length;
    expect(calls).toHaveLength(expectedChecks);
    expect(result.summary.total).toBe(expectedChecks);
    for (const call of calls) {
      expect(call.method).toBe("HEAD");
      expect(call.method).not.toBe("GET");
      expect(call.url).toContain(ACTIVITY_EVENT_REST_PATH);
      expect(call.url).toContain("select=id");
      expect(call.url).toMatch(/[?&]id=eq\./);
      expect(call.url).toContain("limit=1");
      expect(call.headers.Prefer).toBe("count=exact");
      expect(call.headers.Range).toBe("0-0");
      expect(call.url).not.toContain("/rpc/");
      expect(call.url).not.toContain("/functions/");
      expect(call.url).not.toContain("select=*");
    }
  });

  it("never reaches a mutation method", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const { calls, fetchImpl } = mockFetch(() => ({
      status: 200,
      contentRange: "*/0",
    }));
    await runActivityEventCountScopeProbe(config, { env: envFor(), fetchImpl });
    for (const call of calls) {
      expect(["POST", "PUT", "PATCH", "DELETE"]).not.toContain(call.method);
    }
  });

  it("exposes no configurable relation, column or path", () => {
    const source = Object.keys(
      EXAMPLE as unknown as Record<string, unknown>,
    ).sort();
    expect(source).toEqual([
      "candidates",
      "coverage",
      "principals",
      "schema",
      "supabase_anon_key_env",
      "supabase_url_env",
      "timeout_ms",
    ]);
  });

  it("succeeds even when every response body method throws", async () => {
    const single = clone(EXAMPLE);
    single.candidates = [clone(EXAMPLE.candidates[0])];
    for (const scenario of REQUIRED_ACTIVITY_EVENT_SCENARIOS) {
      single.candidates[0].expected_visible[scenario] = false;
    }
    const config = validateActivityEventCountScopeConfig(single);
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      contentRange: "*/0",
    }));
    const result = await runActivityEventCountScopeProbe(config, {
      env: envFor(config),
      fetchImpl,
    });
    expect(result.summary.failed).toBe(0);
    expect(result.summary.blocked).toBe(0);
    expect(result.summary.passed).toBe(10);
    expect(exitCodeForActivityEventCountResult(result)).toBe(0);
  });

  it("classifies network failure and abort as blocked at runtime", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const { fetchImpl } = mockFetch(() => ({ status: 0, throwError: true }));
    const result = await runActivityEventCountScopeProbe(config, {
      env: envFor(),
      fetchImpl,
    });
    expect(result.summary.blocked).toBe(result.summary.total);
    expect(exitCodeForActivityEventCountResult(result)).toBe(2);
  });
});

// --- result confidentiality --------------------------------------------------

describe("API-HR.17 result confidentiality", () => {
  it("emits candidate aliases but never candidate event UUIDs or credentials", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      contentRange: "*/0",
    }));
    const result = await runActivityEventCountScopeProbe(config, {
      env: envFor(),
      fetchImpl,
    });
    const serialized = JSON.stringify(result);

    for (const candidate of config.candidates) {
      expect(serialized).toContain(candidate.alias);
      expect(serialized).not.toContain(candidate.event_id);
    }
    for (const list of Object.values(config.coverage)) {
      for (const id of list) expect(serialized).not.toContain(id);
    }
    expect(serialized).not.toContain(ORDINARY_TOKEN);
    expect(serialized).not.toContain("anon-key-value");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("apikey");
    expect(serialized).not.toContain("metadata");
    expect(serialized).not.toContain("event_type");
    expect(serialized).not.toContain("target_type");
    expect(serialized).not.toContain("actor_id");
    expect(serialized).not.toContain("content-range");
    expect(result.schema).toBe(ACTIVITY_EVENT_COUNT_RESULT_SCHEMA);
    expect(result.config_schema).toBe(ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA);
  });

  it("restricts result entry keys to the confidential-safe set", async () => {
    const config = validateActivityEventCountScopeConfig(clone(EXAMPLE));
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      contentRange: "*/0",
    }));
    const result = await runActivityEventCountScopeProbe(config, {
      env: envFor(),
      fetchImpl,
    });
    for (const entry of result.results) {
      expect(Object.keys(entry).sort()).toEqual([
        "candidate_alias",
        "expected_visible",
        "http_status",
        "observed_count",
        "outcome",
        "principal_scenario",
        "reason_code",
      ]);
    }
  });
});

// --- example configuration and CLI -------------------------------------------

describe("API-HR.17 example configuration and CLI", () => {
  it("uses synthetic UUIDs, synthetic aliases and env-var names only", () => {
    const serialized = JSON.stringify(EXAMPLE);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("supabase.co");
    for (const list of Object.values(EXAMPLE.coverage)) {
      for (const id of list) expect(id.startsWith("00000000-0000-4000-8000-")).toBe(true);
    }
    for (const candidate of EXAMPLE.candidates) {
      expect(candidate.event_id.startsWith("00000000-0000-4000-8000-")).toBe(true);
      expect(candidate.alias).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(candidate.expected_visible.ordinary_deactivated_user).toBe(false);
    }
    for (const p of EXAMPLE.principals) {
      expect(p.token_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("parses supported CLI arguments and rejects unknown ones", () => {
    expect(parseActivityEventCountCliArgs(["--help"])).toEqual({ help: true });
    expect(parseActivityEventCountCliArgs(["--print-example-config"])).toEqual({
      printExample: true,
    });
    expect(
      parseActivityEventCountCliArgs(["--config", "c.json", "--output", "r.json"]),
    ).toEqual({ configPath: "c.json", outputPath: "r.json" });
    expect(() => parseActivityEventCountCliArgs(["--live"])).toThrow(
      /unknown_argument/,
    );
  });

  it("returns exit code 2 when both failures and blocks exist", () => {
    const result = {
      schema: ACTIVITY_EVENT_COUNT_RESULT_SCHEMA,
      config_schema: ACTIVITY_EVENT_COUNT_CONFIG_SCHEMA,
      started_at: "a",
      completed_at: "b",
      summary: { passed: 1, failed: 1, blocked: 1, total: 3 },
      results: [],
    } as const;
    expect(exitCodeForActivityEventCountResult(result)).toBe(2);
    expect(
      exitCodeForActivityEventCountResult({
        ...result,
        summary: { passed: 1, failed: 1, blocked: 0, total: 2 },
      }),
    ).toBe(1);
  });
});
