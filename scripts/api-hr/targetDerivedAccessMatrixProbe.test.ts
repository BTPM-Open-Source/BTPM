// API-HR.14 — focused tests for the target-derived Project access matrix harness.
// Mocked fetch only. No live Supabase or external network call.

import { describe, expect, it } from "bun:test";
import {
  EXAMPLE_TARGET_MATRIX_CONFIG,
  REQUIRED_TARGET_MATRIX_SCENARIOS,
  TARGET_DERIVED_SURFACES,
  TARGET_MATRIX_CONFIG_SCHEMA,
  TARGET_MATRIX_RESULT_SCHEMA,
  TargetMatrixConfigError,
  buildTargetDerivedRequestUrl,
  evaluateTargetDerivedResponse,
  exitCodeForTargetMatrixResult,
  runTargetDerivedAccessMatrix,
  validateTargetMatrixConfig,
  type TargetDerivedSurface,
} from "./targetDerivedAccessMatrixProbe";

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

const OUTSIDE_ID = "00000000-0000-4000-8000-000000999999";

const ids = (surface: TargetDerivedSurface) =>
  EXAMPLE_TARGET_MATRIX_CONFIG.surfaces[surface].candidate_ids;

const expectedFor = (surface: TargetDerivedSurface, scenario: string) =>
  EXAMPLE_TARGET_MATRIX_CONFIG.surfaces[surface].expected_visible_ids[scenario];

function envFor(config = EXAMPLE_TARGET_MATRIX_CONFIG): Record<string, string> {
  const env: Record<string, string> = {
    PROBE_SUPABASE_URL: "https://example.supabase.co",
    PROBE_SUPABASE_ANON_KEY: "anon-key-value",
  };
  for (const p of config.principals) env[p.token_env] = ORDINARY_TOKEN;
  return env;
}

type Spec = { status: number; body?: unknown };

/**
 * Mocked fetch. Responses are keyed by "<scenario>:<surface>"; anything not
 * declared defaults to the canonical expected set for that pair (i.e. a pass).
 */
function mockFetch(
  overrides: Record<string, Spec> = {},
  calls: { url: string; init: RequestInit }[] = [],
  opts: { throwOn?: string } = {},
): typeof fetch {
  const order: string[] = [];
  for (const p of EXAMPLE_TARGET_MATRIX_CONFIG.principals) {
    for (const s of TARGET_DERIVED_SURFACES) order.push(`${p.scenario}:${s}`);
  }
  let index = 0;
  return (async (url: string, init: RequestInit) => {
    const key = order[index++];
    calls.push({ url: String(url), init });
    if (opts.throwOn === key) throw new Error("network down");
    const spec = overrides[key];
    if (spec) {
      return {
        status: spec.status,
        json: async () => spec.body ?? [],
      } as unknown as Response;
    }
    const [scenario, surface] = key.split(":") as [string, TargetDerivedSurface];
    const expected = expectedFor(surface, scenario);
    return {
      status: 200,
      json: async () => expected.map((id) => ({ id })),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const run = (
  overrides: Record<string, Spec> = {},
  calls: { url: string; init: RequestInit }[] = [],
  opts: { throwOn?: string; env?: Record<string, string | undefined> } = {},
) =>
  runTargetDerivedAccessMatrix(EXAMPLE_TARGET_MATRIX_CONFIG, {
    env: opts.env ?? envFor(),
    fetchImpl: mockFetch(overrides, calls, { throwOn: opts.throwOn }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

const entry = (
  result: Awaited<ReturnType<typeof run>>,
  scenario: string,
  surface: TargetDerivedSurface,
) =>
  result.results.find(
    (r) => r.principal_scenario === scenario && r.surface === surface,
  )!;

// --- configuration -----------------------------------------------------------

describe("API-HR.14 configuration contract", () => {
  it("accepts the complete synthetic example configuration", () => {
    const config = validateTargetMatrixConfig(clone(EXAMPLE_TARGET_MATRIX_CONFIG));
    expect(config.schema).toBe(TARGET_MATRIX_CONFIG_SCHEMA);
    expect(config.principals).toHaveLength(10);
    expect(Object.keys(config.surfaces).sort()).toEqual(
      [...TARGET_DERIVED_SURFACES].sort(),
    );
  });

  it("rejects an unsupported config schema", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as Record<string, unknown>;
    c.schema = "something_else";
    expect(() => validateTargetMatrixConfig(c)).toThrow(TargetMatrixConfigError);
  });

  it("requires every one of the ten principal scenarios", () => {
    for (const scenario of REQUIRED_TARGET_MATRIX_SCENARIOS) {
      const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG);
      c.principals = c.principals.filter((p) => p.scenario !== scenario);
      expect(() => validateTargetMatrixConfig(c)).toThrow(
        `missing_principal_scenario:${scenario}`,
      );
    }
  });

  it("rejects an unknown principal scenario", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.principals[0].scenario = "ordinary_super_admin";
    expect(() => validateTargetMatrixConfig(c)).toThrow(
      "unknown_principal_scenario",
    );
  });

  it("rejects anonymous, external OAuth and service-role principal types", () => {
    for (const type of ["anonymous", "external_oauth", "service_role"]) {
      const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
      c.principals[0].type = type;
      expect(() => validateTargetMatrixConfig(c)).toThrow(
        `${type}_principal_forbidden`,
      );
    }
  });

  it("rejects inline credentials in place of environment names", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.principals[0].token_env = ORDINARY_TOKEN;
    expect(() => validateTargetMatrixConfig(c)).toThrow(
      "inline_secret_forbidden",
    );

    const d = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    d.supabase_anon_key_env = "not-an-env-name";
    expect(() => validateTargetMatrixConfig(d)).toThrow(
      "supabase_anon_key_env_invalid",
    );
  });

  it("rejects undeclared top-level properties and credential-bearing keys", () => {
    for (const key of ["service_role_key", "authorization", "rpc", "table", "select"]) {
      const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
      c[key] = "x";
      expect(() => validateTargetMatrixConfig(c)).toThrow(
        "undeclared_config_property",
      );
    }
  });

  it("rejects undeclared surface properties", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.surfaces.blockers.table = "projects";
    expect(() => validateTargetMatrixConfig(c)).toThrow(
      "undeclared_surface_property",
    );
  });

  it("rejects a missing required surface", () => {
    for (const surface of TARGET_DERIVED_SURFACES) {
      const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
      delete c.surfaces[surface];
      expect(() => validateTargetMatrixConfig(c)).toThrow(
        `missing_surface:${surface}`,
      );
    }
  });

  it("rejects an extra or custom surface", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.surfaces.kpi_snapshots = clone(c.surfaces.blockers);
    expect(() => validateTargetMatrixConfig(c)).toThrow("unknown_surface");
  });

  it("rejects invalid, duplicate and over-bound candidate IDs", () => {
    const bad = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    bad.surfaces.risks.candidate_ids[0] = "not-a-uuid";
    expect(() => validateTargetMatrixConfig(bad)).toThrow(
      "candidate_id_invalid:risks",
    );

    const dup = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    dup.surfaces.comments.candidate_ids.push(
      dup.surfaces.comments.candidate_ids[0],
    );
    expect(() => validateTargetMatrixConfig(dup)).toThrow(
      "duplicate_candidate_id:comments",
    );

    const many = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    many.surfaces.blockers.candidate_ids = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    expect(() => validateTargetMatrixConfig(many)).toThrow(
      "candidate_ids_exceed_bound:blockers",
    );
  });

  it("rejects a missing expected scenario on any surface", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    delete c.surfaces.comments.expected_visible_ids.ordinary_viewer;
    expect(() => validateTargetMatrixConfig(c)).toThrow(
      "missing_explicit_expectation:comments",
    );
  });

  it("rejects an expected ID outside that surface's candidate set", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.surfaces.risks.expected_visible_ids.ordinary_viewer = [OUTSIDE_ID];
    expect(() => validateTargetMatrixConfig(c)).toThrow(
      "expected_id_outside_candidates:risks",
    );
  });

  it("accepts mixed legitimate expectations for the four boundary scenarios", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    const [a, b] = c.surfaces.blockers.candidate_ids;
    c.surfaces.blockers.expected_visible_ids.ordinary_workspace_member_no_project =
      [b];
    c.surfaces.blockers.expected_visible_ids.ordinary_same_org_other_workspace = [
      a,
    ];
    c.surfaces.blockers.expected_visible_ids.ordinary_cross_org = [b];
    c.surfaces.blockers.expected_visible_ids.ordinary_removed_project_membership =
      [a];
    const validated = validateTargetMatrixConfig(c);
    expect(
      validated.surfaces.blockers.expected_visible_ids.ordinary_cross_org,
    ).toEqual([b]);
  });

  it("rejects a non-empty deactivated-user expectation on every surface", () => {
    for (const surface of TARGET_DERIVED_SURFACES) {
      const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
      c.surfaces[surface].expected_visible_ids.ordinary_deactivated_user = [
        c.surfaces[surface].candidate_ids[0],
      ];
      expect(() => validateTargetMatrixConfig(c)).toThrow(
        `ordinary_deactivated_user_must_expect_no_rows:${surface}`,
      );
    }
  });

  it("enforces minimum coverage", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.coverage.workspace_ids = c.coverage.workspace_ids.slice(0, 2);
    expect(() => validateTargetMatrixConfig(c)).toThrow(
      "coverage_insufficient_workspace_ids",
    );
  });

  it("rejects an invalid timeout", () => {
    const c = clone(EXAMPLE_TARGET_MATRIX_CONFIG) as any;
    c.timeout_ms = 0;
    expect(() => validateTargetMatrixConfig(c)).toThrow("timeout_invalid");
  });
});

// --- evaluation --------------------------------------------------------------

describe("API-HR.14 exact-set evaluation", () => {
  const candidates = ids("blockers");

  it("passes on an exact set match regardless of ordering", () => {
    const r = evaluateTargetDerivedResponse({
      scenario: "ordinary_workspace_admin",
      candidateIds: candidates,
      expectedIds: [candidates[0], candidates[1]],
      status: 200,
      body: [{ id: candidates[1] }, { id: candidates[0] }],
    });
    expect(r.outcome).toBe("passed");
    expect(r.reason_code).toBe("exact_set_match");
  });

  it("fails when an expected row is missing", () => {
    const r = evaluateTargetDerivedResponse({
      scenario: "ordinary_viewer",
      candidateIds: candidates,
      expectedIds: [candidates[0], candidates[1]],
      status: 200,
      body: [{ id: candidates[0] }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("expected_target_row_missing");
    expect(r.missing_expected_ids).toEqual([candidates[1]]);
  });

  it("fails when an unexpected candidate row is visible", () => {
    const r = evaluateTargetDerivedResponse({
      scenario: "ordinary_cross_org",
      candidateIds: candidates,
      expectedIds: [candidates[3]],
      status: 200,
      body: [{ id: candidates[3] }, { id: candidates[0] }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("unexpected_target_derived_row_visible");
    expect(r.unexpected_ids).toEqual([candidates[0]]);
  });

  it("fails when a returned ID is outside the candidate set", () => {
    const r = evaluateTargetDerivedResponse({
      scenario: "ordinary_viewer",
      candidateIds: candidates,
      expectedIds: [candidates[0]],
      status: 200,
      body: [{ id: candidates[0] }, { id: OUTSIDE_ID }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("target_row_outside_candidate_set");
  });

  it("fails on duplicate and malformed returned identifiers", () => {
    const dup = evaluateTargetDerivedResponse({
      scenario: "ordinary_viewer",
      candidateIds: candidates,
      expectedIds: [candidates[0]],
      status: 200,
      body: [{ id: candidates[0] }, { id: candidates[0] }],
    });
    expect(dup.outcome).toBe("failed");
    expect(dup.reason_code).toBe("duplicate_target_identifier");

    const malformed = evaluateTargetDerivedResponse({
      scenario: "ordinary_viewer",
      candidateIds: candidates,
      expectedIds: [candidates[0]],
      status: 200,
      body: [{ id: "12345" }],
    });
    expect(malformed.outcome).toBe("failed");
    expect(malformed.reason_code).toBe("malformed_target_identifier");
  });

  it("accepts 200-empty, 401 and 403 when zero rows are expected", () => {
    for (const spec of [
      { status: 200, body: [] as unknown },
      { status: 401, body: null },
      { status: 403, body: null },
    ]) {
      const r = evaluateTargetDerivedResponse({
        scenario: "ordinary_deactivated_user",
        candidateIds: candidates,
        expectedIds: [],
        status: spec.status,
        body: spec.body,
      });
      expect(r.outcome).toBe("passed");
    }
  });

  it("blocks an unexpected status, a non-array body and a transport error", () => {
    expect(
      evaluateTargetDerivedResponse({
        scenario: "ordinary_viewer",
        candidateIds: candidates,
        expectedIds: [candidates[0]],
        status: 500,
        body: null,
      }).outcome,
    ).toBe("blocked");

    expect(
      evaluateTargetDerivedResponse({
        scenario: "ordinary_viewer",
        candidateIds: candidates,
        expectedIds: [candidates[0]],
        status: 200,
        body: { id: candidates[0] },
      }).reason_code,
    ).toBe("response_not_array");

    expect(
      evaluateTargetDerivedResponse({
        scenario: "ordinary_viewer",
        candidateIds: candidates,
        expectedIds: [candidates[0]],
        status: null,
        body: null,
        transportError: true,
      }).reason_code,
    ).toBe("transport_error");
  });

  it("uses the deactivated-user reason code when that principal sees a row", () => {
    const r = evaluateTargetDerivedResponse({
      scenario: "ordinary_deactivated_user",
      candidateIds: candidates,
      expectedIds: [],
      status: 200,
      body: [{ id: candidates[0] }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("deactivated_user_saw_target_row");
  });
});

// --- request safety ----------------------------------------------------------

describe("API-HR.14 request safety", () => {
  it("issues exactly one GET per principal x surface against fixed relations", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await run({}, calls);

    expect(calls).toHaveLength(40);
    expect(result.results).toHaveLength(40);
    expect(result.schema).toBe(TARGET_MATRIX_RESULT_SCHEMA);
    expect(result.summary.passed).toBe(40);
    expect(exitCodeForTargetMatrixResult(result)).toBe(0);

    const allowed = new Set(
      TARGET_DERIVED_SURFACES.map(
        (s) => `https://example.supabase.co/rest/v1/${s}`,
      ),
    );
    for (const call of calls) {
      expect((call.init.method ?? "GET")).toBe("GET");
      const url = new URL(call.url);
      expect(allowed.has(`${url.origin}${url.pathname}`)).toBe(true);
      expect(url.searchParams.get("select")).toBe("id");
      expect(url.searchParams.get("id")?.startsWith("in.(")).toBe(true);
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(25);
      expect(call.url).not.toContain("select=*");
      expect(call.url).not.toContain("/rest/v1/rpc/");
      expect(call.url).not.toContain("/functions/v1/");
    }
  });

  it("never reaches a mutation method or a non-allowlisted relation", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(TARGET_DERIVED_SURFACES.includes(method as never)).toBe(false);
    }
    expect(() =>
      buildTargetDerivedRequestUrl(
        "https://example.supabase.co",
        "projects" as never,
        ids("risks"),
      ),
    ).toThrow("unknown_surface");
  });

  it("bounds the limit to the candidate count of that surface", () => {
    const url = new URL(
      buildTargetDerivedRequestUrl(
        "https://example.supabase.co/",
        "execution_updates",
        ids("execution_updates"),
      ),
    );
    expect(url.searchParams.get("limit")).toBe(
      String(ids("execution_updates").length),
    );
  });

  it("blocks every surface for a token carrying a client_id claim", async () => {
    const env = envFor();
    env.PROBE_TOKEN_ORDINARY_CROSS_ORG = OAUTH_TOKEN;
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await run({}, calls, { env });
    const blocked = result.results.filter(
      (r) => r.principal_scenario === "ordinary_cross_org",
    );
    expect(blocked).toHaveLength(4);
    for (const r of blocked) {
      expect(r.outcome).toBe("blocked");
      expect(r.reason_code).toBe("ordinary_browser_token_has_client_id");
    }
    expect(calls).toHaveLength(36);
    expect(exitCodeForTargetMatrixResult(result)).toBe(2);
  });

  it("blocks when a required environment variable is missing", async () => {
    const env = envFor();
    delete env.PROBE_SUPABASE_ANON_KEY;
    const result = await run({}, [], { env });
    expect(result.summary.blocked).toBe(40);
    expect(result.results[0].reason_code).toBe("missing_anon_key_env");
  });

  it("reports authorization failures with exit code 1", async () => {
    const key = "ordinary_viewer:comments";
    const result = await run({
      [key]: { status: 200, body: ids("comments").map((id) => ({ id })) },
    });
    const failed = entry(result, "ordinary_viewer", "comments");
    expect(failed.outcome).toBe("failed");
    expect(failed.reason_code).toBe("unexpected_target_derived_row_visible");
    expect(exitCodeForTargetMatrixResult(result)).toBe(1);
  });

  it("treats a network error as blocked, never as a pass", async () => {
    const result = await run({}, [], { throwOn: "ordinary_org_admin:risks" });
    const blocked = entry(result, "ordinary_org_admin", "risks");
    expect(blocked.outcome).toBe("blocked");
    expect(blocked.reason_code).toBe("transport_error");
  });

  it("emits no credential or complete row data", async () => {
    const result = await run();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ORDINARY_TOKEN);
    expect(serialized).not.toContain("anon-key-value");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    for (const r of result.results) {
      expect(Object.keys(r).sort()).toEqual(
        [
          "http_status",
          "missing_expected_ids",
          "outcome",
          "principal_scenario",
          "principal_type",
          "reason_code",
          "returned_ids",
          "surface",
          "unexpected_ids",
        ].sort(),
      );
    }
  });

  it("keeps the example configuration synthetic and env-reference only", () => {
    const serialized = JSON.stringify(EXAMPLE_TARGET_MATRIX_CONFIG);
    expect(serialized).not.toContain("supabase.co");
    expect(serialized).not.toContain("eyJ");
    for (const p of EXAMPLE_TARGET_MATRIX_CONFIG.principals) {
      expect(p.token_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    // Mixed legitimate visibility is demonstrated, not blanket emptiness.
    const blockers = EXAMPLE_TARGET_MATRIX_CONFIG.surfaces.blockers;
    expect(
      blockers.expected_visible_ids.ordinary_workspace_member_no_project.length,
    ).toBe(1);
    expect(blockers.expected_visible_ids.ordinary_deactivated_user).toEqual([]);
  });
});
