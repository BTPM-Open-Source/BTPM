// API-HR.13 — focused tests for the canonical Project-access matrix harness.
// Mocked fetch only. No live Supabase or external network call.

import { describe, expect, it } from "bun:test";
import {
  EXAMPLE_MATRIX_CONFIG,
  MATRIX_CONFIG_SCHEMA,
  MATRIX_RESULT_SCHEMA,
  MatrixConfigError,
  REQUIRED_MATRIX_SCENARIOS,
  buildProjectAccessRequestUrl,
  evaluateProjectAccessResponse,
  exitCodeForMatrixResult,
  runProjectAccessMatrix,
  validateMatrixConfig,
} from "./projectAccessMatrixProbe";

// --- helpers -----------------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;

const ORDINARY_TOKEN = jwt({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated" });
const OAUTH_TOKEN = jwt({ sub: "x", client_id: "btpm-external-app" });

const P = {
  authorized: "00000000-0000-4000-8000-000000000401",
  sameWorkspaceOther: "00000000-0000-4000-8000-000000000402",
  otherWorkspaceSameOrg: "00000000-0000-4000-8000-000000000403",
  otherOrgOrTenant: "00000000-0000-4000-8000-000000000404",
  outsideCandidates: "00000000-0000-4000-8000-000000000499",
};

function envFor(config = EXAMPLE_MATRIX_CONFIG): Record<string, string> {
  const env: Record<string, string> = {
    PROBE_SUPABASE_URL: "https://example.supabase.co",
    PROBE_SUPABASE_ANON_KEY: "anon-key-value",
  };
  for (const p of config.principals) env[p.token_env] = ORDINARY_TOKEN;
  return env;
}

function fetchReturning(
  byScenarioIds: Record<string, { status: number; body?: unknown }>,
  calls: { url: string; init: RequestInit }[] = [],
): typeof fetch {
  // The harness issues one request per principal in declared order.
  const order = EXAMPLE_MATRIX_CONFIG.principals.map((p) => p.scenario);
  let index = 0;
  return (async (url: string, init: RequestInit) => {
    const scenario = order[index++];
    calls.push({ url: String(url), init });
    const spec = byScenarioIds[scenario] ?? { status: 200, body: [] };
    return {
      status: spec.status,
      json: async () => spec.body ?? [],
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const canonicalPass = () => ({
  ordinary_org_admin: {
    status: 200,
    body: [{ id: P.authorized }, { id: P.sameWorkspaceOther }, { id: P.otherWorkspaceSameOrg }],
  },
  ordinary_workspace_admin: {
    status: 200,
    body: [{ id: P.sameWorkspaceOther }, { id: P.authorized }],
  },
  ordinary_project_manager: { status: 200, body: [{ id: P.authorized }] },
  ordinary_contributor: { status: 200, body: [{ id: P.authorized }] },
  ordinary_viewer: { status: 200, body: [{ id: P.authorized }] },
  ordinary_workspace_member_no_project: { status: 200, body: [] },
  ordinary_same_org_other_workspace: { status: 200, body: [] },
  ordinary_cross_org: { status: 403, body: [] },
  ordinary_removed_project_membership: {
    status: 200,
    body: [{ id: P.sameWorkspaceOther }],
  },
  ordinary_deactivated_user: { status: 401, body: [] },
});

// --- configuration -----------------------------------------------------------

describe("configuration contract", () => {
  it("accepts a valid complete configuration", () => {
    const config = validateMatrixConfig(clone(EXAMPLE_MATRIX_CONFIG));
    expect(config.schema).toBe(MATRIX_CONFIG_SCHEMA);
    expect(config.principals).toHaveLength(10);
    expect(Object.keys(config.expected_visible_project_ids).sort()).toEqual(
      [...REQUIRED_MATRIX_SCENARIOS].sort(),
    );
  });

  it("rejects an unsupported schema identifier", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    raw.schema = "api_hr_multi_principal_probe_v1";
    expect(() => validateMatrixConfig(raw)).toThrow(/unsupported_config_schema/);
  });

  for (const scenario of REQUIRED_MATRIX_SCENARIOS) {
    it(`rejects a configuration missing the ${scenario} principal`, () => {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw.principals = raw.principals.filter((p: any) => p.scenario !== scenario);
      expect(() => validateMatrixConfig(raw)).toThrow(
        new RegExp(`missing_principal_scenario:${scenario}`),
      );
    });
  }

  it("rejects an unknown scenario name", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    raw.principals[0].scenario = "ordinary_super_admin";
    expect(() => validateMatrixConfig(raw)).toThrow(/unknown_principal_scenario/);
  });

  it("rejects anonymous, external OAuth and service-role principal types", () => {
    for (const [type, code] of [
      ["anonymous", /anonymous_principal_forbidden/],
      ["external_oauth", /external_oauth_principal_forbidden/],
      ["service_role", /service_role_principal_forbidden/],
    ] as const) {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw.principals[0].type = type;
      expect(() => validateMatrixConfig(raw)).toThrow(code);
    }
  });

  it("rejects inline token and inline key values", () => {
    const withInlineToken = clone(EXAMPLE_MATRIX_CONFIG) as any;
    withInlineToken.principals[0].token_env = ORDINARY_TOKEN;
    expect(() => validateMatrixConfig(withInlineToken)).toThrow(
      /inline_secret_forbidden/,
    );

    for (const key of ["supabase_anon_key", "anon_key", "service_role_key", "token", "authorization", "bearer"]) {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw[key] = "value";
      expect(() => validateMatrixConfig(raw)).toThrow(/undeclared_config_property/);
    }
  });

  it("rejects undeclared properties at every configuration level", () => {
    const top = clone(EXAMPLE_MATRIX_CONFIG) as any;
    top.extra = 1;
    expect(() => validateMatrixConfig(top)).toThrow(/undeclared_config_property/);

    const coverage = clone(EXAMPLE_MATRIX_CONFIG) as any;
    coverage.coverage.program_ids = [];
    expect(() => validateMatrixConfig(coverage)).toThrow(
      /undeclared_coverage_property/,
    );

    const principal = clone(EXAMPLE_MATRIX_CONFIG) as any;
    principal.principals[0].bearer = "x";
    expect(() => validateMatrixConfig(principal)).toThrow(
      /undeclared_principal_property/,
    );

    const expected = clone(EXAMPLE_MATRIX_CONFIG) as any;
    expected.expected_visible_project_ids.some_other_scenario = [];
    expect(() => validateMatrixConfig(expected)).toThrow(
      /unknown_principal_scenario/,
    );
  });

  it("rejects url, rpc, method, table and select routing overrides", () => {
    for (const key of ["url", "rpc", "method", "table", "select"]) {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw[key] = "anything";
      expect(() => validateMatrixConfig(raw)).toThrow(/undeclared_config_property/);
    }
  });

  it("rejects insufficient tenant, organization, workspace or project coverage", () => {
    const cases: [string, number][] = [
      ["tenant_ids", 1],
      ["organization_ids", 1],
      ["workspace_ids", 2],
      ["project_ids", 3],
    ];
    for (const [key, keep] of cases) {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw.coverage[key] = raw.coverage[key].slice(0, keep);
      expect(() => validateMatrixConfig(raw)).toThrow(
        new RegExp(`coverage_insufficient_${key}`),
      );
    }
  });

  it("rejects invalid and duplicate UUIDs", () => {
    const badUuid = clone(EXAMPLE_MATRIX_CONFIG) as any;
    badUuid.coverage.workspace_ids[0] = "not-a-uuid";
    expect(() => validateMatrixConfig(badUuid)).toThrow(/coverage_invalid_workspace_ids/);

    const dupCoverage = clone(EXAMPLE_MATRIX_CONFIG) as any;
    dupCoverage.coverage.tenant_ids[1] = dupCoverage.coverage.tenant_ids[0];
    expect(() => validateMatrixConfig(dupCoverage)).toThrow(
      /coverage_duplicate_tenant_ids/,
    );

    const dupCandidate = clone(EXAMPLE_MATRIX_CONFIG) as any;
    dupCandidate.candidate_project_ids[1] = dupCandidate.candidate_project_ids[0];
    expect(() => validateMatrixConfig(dupCandidate)).toThrow(
      /duplicate_candidate_project_id/,
    );

    const badCandidate = clone(EXAMPLE_MATRIX_CONFIG) as any;
    badCandidate.candidate_project_ids[0] = "nope";
    expect(() => validateMatrixConfig(badCandidate)).toThrow(
      /candidate_project_id_invalid/,
    );
  });

  it("rejects candidate Projects outside declared coverage", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    raw.candidate_project_ids.push(P.outsideCandidates);
    expect(() => validateMatrixConfig(raw)).toThrow(
      /candidate_project_id_outside_coverage/,
    );
  });

  it("rejects more than 25 candidate Projects", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    const many = Array.from({ length: 26 }, (_, i) =>
      `00000000-0000-4000-8000-0000000005${String(i).padStart(2, "0")}`,
    );
    raw.coverage.project_ids = many;
    raw.candidate_project_ids = many;
    raw.expected_visible_project_ids = Object.fromEntries(
      REQUIRED_MATRIX_SCENARIOS.map((s) => [s, []]),
    );
    expect(() => validateMatrixConfig(raw)).toThrow(
      /candidate_project_ids_exceed_bound/,
    );
  });

  it("rejects a missing explicit expected set", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    delete raw.expected_visible_project_ids.ordinary_viewer;
    expect(() => validateMatrixConfig(raw)).toThrow(/missing_explicit_expectation/);
  });

  it("rejects expected IDs outside the candidate set", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    raw.coverage.project_ids.push(P.outsideCandidates);
    raw.expected_visible_project_ids.ordinary_viewer = [P.outsideCandidates];
    expect(() => validateMatrixConfig(raw)).toThrow(/expected_id_outside_candidates/);
  });

  it("rejects any non-empty expectation for the deactivated user only", () => {
    for (const ids of [[P.authorized], [P.sameWorkspaceOther], [P.authorized, P.sameWorkspaceOther]]) {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw.expected_visible_project_ids.ordinary_deactivated_user = ids;
      expect(() => validateMatrixConfig(raw)).toThrow(
        /ordinary_deactivated_user_must_expect_no_projects/,
      );
    }
  });

  it("accepts mixed legitimate visibility for the four boundary scenarios", () => {
    const mixed: Record<string, string[]> = {
      ordinary_workspace_member_no_project: [P.sameWorkspaceOther],
      ordinary_same_org_other_workspace: [P.authorized],
      ordinary_cross_org: [P.authorized],
      ordinary_removed_project_membership: [P.sameWorkspaceOther],
    };
    for (const [scenario, ids] of Object.entries(mixed)) {
      const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
      raw.expected_visible_project_ids[scenario] = ids;
      const config = validateMatrixConfig(raw);
      expect(config.expected_visible_project_ids[scenario]).toEqual(ids);
    }
  });

  it("requires a bounded timeout", () => {
    const raw = clone(EXAMPLE_MATRIX_CONFIG) as any;
    delete raw.timeout_ms;
    expect(() => validateMatrixConfig(raw)).toThrow(/timeout_invalid/);
    raw.timeout_ms = 600000;
    expect(() => validateMatrixConfig(raw)).toThrow(/timeout_invalid/);
  });
});

// --- token preflight ---------------------------------------------------------

describe("token preflight", () => {
  it("blocks an ordinary token carrying client_id", async () => {
    const config = validateMatrixConfig(clone(EXAMPLE_MATRIX_CONFIG));
    const env = envFor();
    env[config.principals[0].token_env] = OAUTH_TOKEN;
    const result = await runProjectAccessMatrix(config, {
      env,
      fetchImpl: fetchReturning(canonicalPass()),
    });
    const entry = result.results[0];
    expect(entry.outcome).toBe("blocked");
    expect(entry.reason_code).toBe("ordinary_browser_token_has_client_id");
  });

  it("blocks whitespace-only and malformed token payloads safely", async () => {
    const config = validateMatrixConfig(clone(EXAMPLE_MATRIX_CONFIG));
    for (const [value, code] of [
      ["   ", "token_blank"],
      ["not-a-jwt", "token_not_jwt_shaped"],
      ["a.!!!!.c", "token_payload_invalid"],
    ] as const) {
      const env = envFor();
      env[config.principals[0].token_env] = value;
      const result = await runProjectAccessMatrix(config, {
        env,
        fetchImpl: fetchReturning(canonicalPass()),
      });
      expect(result.results[0].outcome).toBe("blocked");
      expect(result.results[0].reason_code).toBe(code);
    }
  });
});

// --- evaluation --------------------------------------------------------------

describe("exact-set evaluation", () => {
  const base = {
    scenario: "ordinary_project_manager",
    candidateProjectIds: [P.authorized, P.sameWorkspaceOther],
    expectedIds: [P.authorized],
  };

  it("passes on an exact match regardless of order", () => {
    const r = evaluateProjectAccessResponse({
      ...base,
      candidateProjectIds: [P.authorized, P.sameWorkspaceOther],
      expectedIds: [P.authorized, P.sameWorkspaceOther],
      status: 200,
      body: [{ id: P.sameWorkspaceOther }, { id: P.authorized }],
    });
    expect(r.outcome).toBe("passed");
    expect(r.reason_code).toBe("exact_set_match");
  });

  it("fails on a missing expected Project", () => {
    const r = evaluateProjectAccessResponse({ ...base, status: 200, body: [] });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("expected_project_missing");
    expect(r.missing_expected_project_ids).toEqual([P.authorized]);
  });

  it("fails on an unexpected cross-scope Project", () => {
    const r = evaluateProjectAccessResponse({
      ...base,
      scenario: "ordinary_cross_org",
      expectedIds: [],
      status: 200,
      body: [{ id: P.authorized }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("cross_org_or_cross_tenant_project_visible");
    expect(r.unexpected_project_ids).toEqual([P.authorized]);
  });

  it("fails when a removed member or non-member sees a Project", () => {
    expect(
      evaluateProjectAccessResponse({
        ...base,
        scenario: "ordinary_removed_project_membership",
        expectedIds: [],
        status: 200,
        body: [{ id: P.authorized }],
      }).reason_code,
    ).toBe("removed_project_member_saw_project");

    expect(
      evaluateProjectAccessResponse({
        ...base,
        scenario: "ordinary_workspace_member_no_project",
        expectedIds: [],
        status: 200,
        body: [{ id: P.authorized }],
      }).reason_code,
    ).toBe("workspace_member_without_project_membership_saw_project");

    expect(
      evaluateProjectAccessResponse({
        ...base,
        scenario: "ordinary_same_org_other_workspace",
        expectedIds: [],
        status: 200,
        body: [{ id: P.authorized }],
      }).reason_code,
    ).toBe("same_org_membership_crossed_workspace_boundary");

    expect(
      evaluateProjectAccessResponse({
        ...base,
        scenario: "ordinary_deactivated_user",
        expectedIds: [],
        status: 200,
        body: [{ id: P.authorized }],
      }).reason_code,
    ).toBe("deactivated_user_saw_project");
  });

  it("fails on an ID outside the candidate set", () => {
    const r = evaluateProjectAccessResponse({
      ...base,
      status: 200,
      body: [{ id: P.authorized }, { id: P.outsideCandidates }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("project_outside_candidate_set");
  });

  it("fails on duplicate or malformed response IDs", () => {
    expect(
      evaluateProjectAccessResponse({
        ...base,
        status: 200,
        body: [{ id: P.authorized }, { id: P.authorized }],
      }).reason_code,
    ).toBe("duplicate_project_identifier");

    expect(
      evaluateProjectAccessResponse({
        ...base,
        status: 200,
        body: [{ id: "abc" }],
      }).reason_code,
    ).toBe("malformed_project_identifier");

    expect(
      evaluateProjectAccessResponse({ ...base, status: 200, body: ["x"] })
        .reason_code,
    ).toBe("malformed_row");
  });

  it("passes on HTTP 200 empty, 401 and 403 when empty is expected", () => {
    for (const status of [200, 401, 403]) {
      const r = evaluateProjectAccessResponse({
        ...base,
        expectedIds: [],
        status,
        body: [],
      });
      expect(r.outcome).toBe("passed");
    }
  });

  it("blocks an unexpected HTTP status and transport errors", () => {
    expect(
      evaluateProjectAccessResponse({ ...base, status: 500, body: null }).outcome,
    ).toBe("blocked");
    expect(
      evaluateProjectAccessResponse({
        ...base,
        expectedIds: [],
        status: 418,
        body: null,
      }).reason_code,
    ).toBe("unexpected_http_status");
    expect(
      evaluateProjectAccessResponse({
        ...base,
        status: null,
        body: null,
        transportError: true,
      }).reason_code,
    ).toBe("transport_error");
  });

  it("blocks a non-array 200 response", () => {
    expect(
      evaluateProjectAccessResponse({ ...base, status: 200, body: { id: 1 } })
        .reason_code,
    ).toBe("response_not_array");
  });
});

// --- request shape and run behavior -----------------------------------------

describe("request shape and runner", () => {
  it("builds a bounded GET /rest/v1/projects URL selecting only id", () => {
    const url = buildProjectAccessRequestUrl("https://example.supabase.co/", [
      P.authorized,
      P.sameWorkspaceOther,
    ]);
    expect(url).toStartWith("https://example.supabase.co/rest/v1/projects?");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/rest/v1/projects");
    expect(parsed.searchParams.get("select")).toBe("id");
    expect(parsed.searchParams.get("id")).toBe(
      `in.(${P.authorized},${P.sameWorkspaceOther})`,
    );
    expect(parsed.searchParams.get("limit")).toBe("2");
    expect(url).not.toContain("select=*");
    expect(url).not.toContain("/rpc/");
    expect(url).not.toContain("/functions/");
  });

  it("passes the canonical matrix and exits 0", async () => {
    const config = validateMatrixConfig(clone(EXAMPLE_MATRIX_CONFIG));
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await runProjectAccessMatrix(config, {
      env: envFor(),
      fetchImpl: fetchReturning(canonicalPass(), calls),
    });
    expect(result.schema).toBe(MATRIX_RESULT_SCHEMA);
    expect(result.summary).toEqual({ passed: 10, failed: 0, blocked: 0, total: 10 });
    expect(exitCodeForMatrixResult(result)).toBe(0);

    // exactly one bounded GET per principal, no RPC/function/mutation
    expect(calls).toHaveLength(10);
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.url).toContain("/rest/v1/projects?");
      expect(call.url).toContain("select=id");
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(call.init.method).not.toBe(method);
      }
    }
  });

  it("exits 1 when a scenario over-shares and 2 when blocked", async () => {
    const config = validateMatrixConfig(clone(EXAMPLE_MATRIX_CONFIG));
    const leak = canonicalPass();
    leak.ordinary_cross_org = { status: 200, body: [{ id: P.authorized }] };
    const failed = await runProjectAccessMatrix(config, {
      env: envFor(),
      fetchImpl: fetchReturning(leak),
    });
    expect(exitCodeForMatrixResult(failed)).toBe(1);

    const blocked = await runProjectAccessMatrix(config, {
      env: { PROBE_SUPABASE_ANON_KEY: "anon" },
      fetchImpl: fetchReturning(canonicalPass()),
    });
    expect(blocked.summary.blocked).toBe(10);
    expect(exitCodeForMatrixResult(blocked)).toBe(2);
  });

  it("produces output free of credentials, JWT payloads, headers and full rows", async () => {
    const config = validateMatrixConfig(clone(EXAMPLE_MATRIX_CONFIG));
    const result = await runProjectAccessMatrix(config, {
      env: envFor(),
      fetchImpl: fetchReturning(canonicalPass()),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ORDINARY_TOKEN);
    expect(serialized).not.toContain("anon-key-value");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized.toLowerCase()).not.toContain("bearer");
    expect(serialized).not.toContain("apikey");
    for (const entry of result.results) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          "http_status",
          "missing_expected_project_ids",
          "outcome",
          "principal_scenario",
          "principal_type",
          "reason_code",
          "returned_project_ids",
          "unexpected_project_ids",
        ].sort(),
      );
    }
  });

  it("example config contains only synthetic UUIDs and env-var names", () => {
    const serialized = JSON.stringify(EXAMPLE_MATRIX_CONFIG);
    expect(serialized).not.toContain("supabase.co");
    expect(serialized).not.toContain("eyJ");
    for (const p of EXAMPLE_MATRIX_CONFIG.principals) {
      expect(p.token_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    for (const id of EXAMPLE_MATRIX_CONFIG.candidate_project_ids) {
      expect(id).toStartWith("00000000-0000-4000-8000-");
    }
  });

  it("exposes MatrixConfigError with a safe code and no echoed values", () => {
    try {
      validateMatrixConfig({ schema: MATRIX_CONFIG_SCHEMA, secret_token: "abc" });
    } catch (error) {
      expect(error).toBeInstanceOf(MatrixConfigError);
      expect((error as MatrixConfigError).message).not.toContain("abc");
    }
  });
});

// --- mixed legitimate visibility evaluation ----------------------------------

describe("mixed legitimate visibility evaluation", () => {
  const scenarios: Array<[string, string]> = [
    ["ordinary_workspace_member_no_project", "workspace_member_without_project_membership_saw_project"],
    ["ordinary_same_org_other_workspace", "same_org_membership_crossed_workspace_boundary"],
    ["ordinary_cross_org", "cross_org_or_cross_tenant_project_visible"],
    ["ordinary_removed_project_membership", "removed_project_member_saw_project"],
    ["ordinary_deactivated_user", "deactivated_user_saw_project"],
  ];
  const candidates = [
    P.authorized,
    P.sameWorkspaceOther,
    P.otherWorkspaceSameOrg,
    P.otherOrgOrTenant,
  ];

  it("passes when a mixed result contains exactly the legitimate IDs", () => {
    for (const [scenario] of scenarios.slice(0, 4)) {
      const out = evaluateProjectAccessResponse({
        scenario,
        candidateProjectIds: candidates,
        expectedIds: [P.sameWorkspaceOther],
        status: 200,
        body: [{ id: P.sameWorkspaceOther }],
      });
      expect(out.outcome).toBe("passed");
      expect(out.reason_code).toBe("exact_set_match");
    }
  });

  it("fails with the scenario-specific reason when an unauthorized ID appears", () => {
    for (const [scenario, reason] of scenarios) {
      const expectedIds = scenario === "ordinary_deactivated_user" ? [] : [P.sameWorkspaceOther];
      const body = expectedIds
        .map((id) => ({ id }))
        .concat([{ id: P.otherOrgOrTenant }]);
      const out = evaluateProjectAccessResponse({
        scenario,
        candidateProjectIds: candidates,
        expectedIds,
        status: 200,
        body,
      });
      expect(out.outcome).toBe("failed");
      expect(out.reason_code).toBe(reason);
      expect(out.unexpected_project_ids).toEqual([P.otherOrgOrTenant]);
    }
  });

  it("fails when a legitimate expected ID is missing from a mixed result", () => {
    const out = evaluateProjectAccessResponse({
      scenario: "ordinary_removed_project_membership",
      candidateProjectIds: candidates,
      expectedIds: [P.sameWorkspaceOther, P.authorized],
      status: 200,
      body: [{ id: P.sameWorkspaceOther }],
    });
    expect(out.outcome).toBe("failed");
    expect(out.reason_code).toBe("expected_project_missing");
    expect(out.missing_expected_project_ids).toEqual([P.authorized]);
  });
});
