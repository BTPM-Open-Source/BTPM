// API-HR.15 — focused tests for the identity & membership row-scope matrix harness.
// Mocked fetch only. No live Supabase or external network call.

import { describe, expect, it } from "bun:test";
import {
  EXAMPLE_IDENTITY_MATRIX_CONFIG,
  IDENTITY_MATRIX_CONFIG_SCHEMA,
  IDENTITY_MATRIX_RESULT_SCHEMA,
  IDENTITY_MEMBERSHIP_SURFACES,
  IdentityMatrixConfigError,
  REQUIRED_IDENTITY_MATRIX_SCENARIOS,
  buildIdentityMembershipRequestUrl,
  evaluateIdentityMembershipResponse,
  exitCodeForIdentityMatrixResult,
  runIdentityMembershipAccessMatrix,
  validateIdentityMatrixConfig,
  type IdentityMembershipSurface,
} from "./identityMembershipAccessMatrixProbe";

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

const ids = (surface: IdentityMembershipSurface) =>
  EXAMPLE_IDENTITY_MATRIX_CONFIG.surfaces[surface].candidate_ids;

const expectedFor = (surface: IdentityMembershipSurface, scenario: string) =>
  EXAMPLE_IDENTITY_MATRIX_CONFIG.surfaces[surface].expected_visible_ids[
    scenario
  ];

function envFor(
  config = EXAMPLE_IDENTITY_MATRIX_CONFIG,
): Record<string, string> {
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
 * declared defaults to the declared expected set for that pair (i.e. a pass).
 */
function mockFetch(
  overrides: Record<string, Spec> = {},
  calls: { url: string; init: RequestInit }[] = [],
  opts: { throwOn?: string } = {},
): typeof fetch {
  const order: string[] = [];
  for (const p of EXAMPLE_IDENTITY_MATRIX_CONFIG.principals) {
    for (const s of IDENTITY_MEMBERSHIP_SURFACES) {
      order.push(`${p.scenario}:${s}`);
    }
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
    const [scenario, surface] = key.split(":") as [
      string,
      IdentityMembershipSurface,
    ];
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
  runIdentityMembershipAccessMatrix(EXAMPLE_IDENTITY_MATRIX_CONFIG, {
    env: opts.env ?? envFor(),
    fetchImpl: mockFetch(overrides, calls, { throwOn: opts.throwOn }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

const entry = (
  result: Awaited<ReturnType<typeof run>>,
  scenario: string,
  surface: IdentityMembershipSurface,
) =>
  result.results.find(
    (r) => r.principal_scenario === scenario && r.surface === surface,
  )!;

const evaluate = (args: {
  scenario?: string;
  surface?: IdentityMembershipSurface;
  candidateIds?: string[];
  expectedIds?: string[];
  status?: number | null;
  body?: unknown;
  transportError?: boolean;
}) =>
  evaluateIdentityMembershipResponse({
    scenario: args.scenario ?? "ordinary_viewer",
    surface: args.surface ?? "profiles",
    candidateIds: args.candidateIds ?? ids("profiles"),
    expectedIds: args.expectedIds ?? [],
    status: args.status ?? 200,
    body: args.body ?? [],
    transportError: args.transportError,
  });

// --- configuration -----------------------------------------------------------

describe("API-HR.15 configuration contract", () => {
  it("accepts the complete synthetic example configuration", () => {
    const config = validateIdentityMatrixConfig(
      clone(EXAMPLE_IDENTITY_MATRIX_CONFIG),
    );
    expect(config.schema).toBe(IDENTITY_MATRIX_CONFIG_SCHEMA);
    expect(config.principals).toHaveLength(10);
    expect(Object.keys(config.surfaces).sort()).toEqual(
      [...IDENTITY_MEMBERSHIP_SURFACES].sort(),
    );
  });

  it("requires all ten ordinary-browser scenarios", () => {
    expect(REQUIRED_IDENTITY_MATRIX_SCENARIOS).toHaveLength(10);
    for (const missing of REQUIRED_IDENTITY_MATRIX_SCENARIOS) {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      cfg.principals = cfg.principals.filter(
        (p: any) => p.scenario !== missing,
      );
      expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
        `missing_principal_scenario:${missing}`,
      );
    }
  });

  it("rejects a duplicate principal scenario", () => {
    const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    cfg.principals.push({ ...cfg.principals[0] });
    expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
      "duplicate_principal_scenario",
    );
  });

  it("rejects an unknown principal scenario", () => {
    const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    cfg.principals[0].scenario = "ordinary_super_user";
    expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
      "unknown_principal_scenario",
    );
  });

  it("rejects anonymous, external OAuth, service-role and custom principal types", () => {
    for (const [type, code] of [
      ["anonymous", "anonymous_principal_forbidden"],
      ["external_oauth", "external_oauth_principal_forbidden"],
      ["service_role", "service_role_principal_forbidden"],
      ["external_oauth_client", "external_oauth_principal_forbidden"],
      ["machine", "principal_type_invalid"],
    ] as const) {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      cfg.principals[0].type = type;
      expect(() => validateIdentityMatrixConfig(cfg)).toThrow(code);
    }
  });

  it("rejects inline credential material in place of an environment name", () => {
    const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    cfg.principals[0].token_env = ORDINARY_TOKEN;
    expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
      "inline_secret_forbidden",
    );

    const cfg2 = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    cfg2.supabase_anon_key_env = "eyJhbGciOi.eyJzdWIiOiJ4.sig";
    expect(() => validateIdentityMatrixConfig(cfg2)).toThrow(
      "supabase_anon_key_env_invalid",
    );
  });

  it("rejects credential-bearing and routing override keys at top level", () => {
    for (const key of [
      "authorization",
      "token",
      "bearer",
      "anon_key",
      "apikey",
      "service_role_key",
      "url",
      "rpc",
      "method",
      "table",
      "tables",
      "select",
      "columns",
      "edge_function",
    ]) {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      cfg[key] = "anything";
      expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
        "undeclared_config_property",
      );
    }
  });

  it("rejects undeclared properties at every level", () => {
    const top = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    top.extra = 1;
    expect(() => validateIdentityMatrixConfig(top)).toThrow(
      "undeclared_config_property",
    );

    const principal = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    principal.principals[0].note = "x";
    expect(() => validateIdentityMatrixConfig(principal)).toThrow(
      "undeclared_principal_property",
    );

    const coverage = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    coverage.coverage.extra_ids = [];
    expect(() => validateIdentityMatrixConfig(coverage)).toThrow(
      "undeclared_coverage_property",
    );

    const surface = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    surface.surfaces.profiles.note = "x";
    expect(() => validateIdentityMatrixConfig(surface)).toThrow(
      "undeclared_surface_property",
    );

    const expectation = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    expectation.surfaces.profiles.expected_visible_ids.ordinary_ghost = [];
    expect(() => validateIdentityMatrixConfig(expectation)).toThrow(
      "unknown_principal_scenario",
    );
  });

  it("enforces the coverage minimums for tenants, orgs, workspaces, projects and users", () => {
    for (const [key, minimum] of [
      ["tenant_ids", 2],
      ["organization_ids", 2],
      ["workspace_ids", 3],
      ["project_ids", 4],
      ["user_ids", 4],
    ] as const) {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      cfg.coverage[key] = cfg.coverage[key].slice(0, minimum - 1);
      expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
        `coverage_insufficient_${key}`,
      );
    }
  });

  it("rejects an invalid or duplicate coverage UUID", () => {
    const invalid = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    invalid.coverage.user_ids[0] = "not-a-uuid";
    expect(() => validateIdentityMatrixConfig(invalid)).toThrow(
      "coverage_invalid_user_ids",
    );

    const duplicate = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    duplicate.coverage.workspace_ids[1] = duplicate.coverage.workspace_ids[0];
    expect(() => validateIdentityMatrixConfig(duplicate)).toThrow(
      "coverage_duplicate_workspace_ids",
    );
  });

  it("requires exactly the seven fixed surfaces", () => {
    expect(IDENTITY_MEMBERSHIP_SURFACES).toEqual([
      "profiles",
      "user_roles",
      "tenant_memberships",
      "organization_memberships",
      "workspace_memberships",
      "project_memberships",
      "platform_super_admins",
    ]);

    for (const surface of IDENTITY_MEMBERSHIP_SURFACES) {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      delete cfg.surfaces[surface];
      expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
        `missing_surface:${surface}`,
      );
    }

    const extra = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    extra.surfaces.organizations = extra.surfaces.profiles;
    expect(() => validateIdentityMatrixConfig(extra)).toThrow("unknown_surface");
  });

  it("bounds candidate identifiers per surface", () => {
    const empty = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    empty.surfaces.user_roles.candidate_ids = [];
    expect(() => validateIdentityMatrixConfig(empty)).toThrow(
      "candidate_ids_missing:user_roles",
    );

    const many = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    many.surfaces.user_roles.candidate_ids = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    many.surfaces.user_roles.expected_visible_ids = Object.fromEntries(
      REQUIRED_IDENTITY_MATRIX_SCENARIOS.map((s) => [s, []]),
    );
    expect(() => validateIdentityMatrixConfig(many)).toThrow(
      "candidate_ids_exceed_bound:user_roles",
    );

    const invalid = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    invalid.surfaces.profiles.candidate_ids[0] = "nope";
    expect(() => validateIdentityMatrixConfig(invalid)).toThrow(
      "candidate_id_invalid:profiles",
    );

    const duplicate = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    duplicate.surfaces.profiles.candidate_ids[1] =
      duplicate.surfaces.profiles.candidate_ids[0];
    expect(() => validateIdentityMatrixConfig(duplicate)).toThrow(
      "duplicate_candidate_id:profiles",
    );
  });

  it("requires an explicit expectation per scenario and rejects invalid expectations", () => {
    const missing = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    delete missing.surfaces.tenant_memberships.expected_visible_ids
      .ordinary_viewer;
    expect(() => validateIdentityMatrixConfig(missing)).toThrow(
      "missing_explicit_expectation:tenant_memberships",
    );

    const outside = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    outside.surfaces.profiles.expected_visible_ids.ordinary_viewer = [
      OUTSIDE_ID,
    ];
    expect(() => validateIdentityMatrixConfig(outside)).toThrow(
      "expected_id_outside_candidates:profiles",
    );

    const duplicate = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    duplicate.surfaces.profiles.expected_visible_ids.ordinary_org_admin = [
      ids("profiles")[0],
      ids("profiles")[0],
    ];
    expect(() => validateIdentityMatrixConfig(duplicate)).toThrow(
      "duplicate_expected_id:profiles",
    );
  });

  it("accepts mixed legitimate visibility for boundary and administrative scenarios", () => {
    const config = validateIdentityMatrixConfig(
      clone(EXAMPLE_IDENTITY_MATRIX_CONFIG),
    );
    const profiles = config.surfaces.profiles.expected_visible_ids;
    expect(profiles.ordinary_tenant_admin.length).toBeGreaterThan(1);
    expect(profiles.ordinary_same_org_non_admin.length).toBeGreaterThan(0);
    expect(profiles.ordinary_cross_org.length).toBeGreaterThan(0);
    // Removed membership keeps other legitimate authority, and excludes the
    // removed row.
    expect(profiles.ordinary_removed_membership).toEqual([ids("profiles")[0]]);
    expect(profiles.ordinary_removed_membership).not.toContain(
      ids("profiles")[4],
    );
  });

  it("rejects a non-empty deactivated-user expectation on every surface", () => {
    for (const surface of IDENTITY_MEMBERSHIP_SURFACES) {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      cfg.surfaces[surface].expected_visible_ids.ordinary_deactivated_user = [
        cfg.surfaces[surface].candidate_ids[0],
      ];
      expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
        `ordinary_deactivated_user_must_expect_no_rows:${surface}`,
      );
    }
  });

  it("rejects an unsupported schema and an invalid timeout", () => {
    const schema = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    schema.schema = "something_else";
    expect(() => validateIdentityMatrixConfig(schema)).toThrow(
      "unsupported_config_schema",
    );

    const timeout = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    timeout.timeout_ms = 0;
    expect(() => validateIdentityMatrixConfig(timeout)).toThrow(
      "timeout_invalid",
    );
  });
});

// --- token preflight ---------------------------------------------------------

describe("API-HR.15 token preflight", () => {
  it("blocks an ordinary-browser token carrying a client_id claim", async () => {
    const env = envFor();
    env[EXAMPLE_IDENTITY_MATRIX_CONFIG.principals[0].token_env] = OAUTH_TOKEN;
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await run({}, calls, { env });
    const scenario = EXAMPLE_IDENTITY_MATRIX_CONFIG.principals[0].scenario;
    for (const surface of IDENTITY_MEMBERSHIP_SURFACES) {
      const e = entry(result, scenario, surface);
      expect(e.outcome).toBe("blocked");
      expect(e.reason_code).toBe("ordinary_browser_token_has_client_id");
      expect(e.http_status).toBeNull();
    }
    // No request was issued for the blocked principal.
    expect(calls).toHaveLength(9 * IDENTITY_MEMBERSHIP_SURFACES.length);
    expect(exitCodeForIdentityMatrixResult(result)).toBe(2);
  });

  it("safely blocks a blank or malformed token payload", async () => {
    for (const [token, code] of [
      ["   ", "token_blank"],
      ["not-a-jwt", "token_not_jwt_shaped"],
      ["aaa.!!!!.bbb", "token_payload_invalid"],
      [`${b64url({})}.${b64url("string-payload")}.sig`, "token_payload_invalid"],
    ] as const) {
      const env = envFor();
      env[EXAMPLE_IDENTITY_MATRIX_CONFIG.principals[1].token_env] = token;
      const result = await run({}, [], { env });
      const e = entry(
        result,
        EXAMPLE_IDENTITY_MATRIX_CONFIG.principals[1].scenario,
        "profiles",
      );
      expect(e.outcome).toBe("blocked");
      expect(e.reason_code).toBe(code);
    }
  });

  it("blocks when an environment reference is missing", async () => {
    const result = await run({}, [], {
      env: { PROBE_SUPABASE_ANON_KEY: "anon" },
    });
    expect(result.summary.blocked).toBe(70);
    expect(result.results[0].reason_code).toBe("missing_supabase_url_env");
    expect(exitCodeForIdentityMatrixResult(result)).toBe(2);
  });
});

// --- request safety ----------------------------------------------------------

describe("API-HR.15 request safety", () => {
  it("issues exactly one bounded GET per principal x surface (70 requests)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    expect(calls).toHaveLength(70);
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.init.signal).toBeDefined();
    }
  });

  it("reaches only the seven fixed /rest/v1 surfaces and selects the identifier only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    const paths = new Set<string>();
    for (const call of calls) {
      const url = new URL(call.url);
      paths.add(url.pathname);
      expect(url.searchParams.get("select")).toBe("id");
      expect(url.searchParams.get("id")).toMatch(/^in\.\(/);
      expect(url.searchParams.has("limit")).toBe(true);
      expect(call.url).not.toContain("select=*");
      expect(url.pathname).not.toContain("/rpc/");
      expect(url.pathname).not.toContain("/functions/");
    }
    expect([...paths].sort()).toEqual(
      IDENTITY_MEMBERSHIP_SURFACES.map((s) => `/rest/v1/${s}`).sort(),
    );
  });

  it("bounds limit to the surface candidate count and filters to candidates", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    for (const call of calls) {
      const url = new URL(call.url);
      const surface = url.pathname.split("/").pop() as IdentityMembershipSurface;
      const candidates = ids(surface);
      expect(Number(url.searchParams.get("limit"))).toBe(candidates.length);
      expect(url.searchParams.get("id")).toBe(`in.(${candidates.join(",")})`);
    }
  });

  it("refuses to build a URL for any relation outside the fixed allowlist", () => {
    expect(() =>
      buildIdentityMembershipRequestUrl(
        "https://example.supabase.co",
        "organizations" as unknown as IdentityMembershipSurface,
        [ids("profiles")[0]],
      ),
    ).toThrow("unknown_surface");
    expect(() =>
      buildIdentityMembershipRequestUrl(
        "https://example.supabase.co",
        "rpc/api_v1_list_projects" as unknown as IdentityMembershipSurface,
        [ids("profiles")[0]],
      ),
    ).toThrow("unknown_surface");
  });

  it("exposes no mutation capability and never accepts service-role material", () => {
    const source = String(runIdentityMembershipAccessMatrix);
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(source).not.toContain(`"${verb}"`);
    }
    expect(source).toContain('method: "GET"');
    const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
    cfg.service_role_key = "SERVICE_KEY_ENV";
    expect(() => validateIdentityMatrixConfig(cfg)).toThrow(
      "undeclared_config_property",
    );
  });

  it("serializes a result that contains no credential or complete-row content", async () => {
    const result = await run();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ORDINARY_TOKEN);
    expect(serialized).not.toContain("anon-key-value");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("full_name");
    // No role, status or membership metadata VALUES are emitted. ("user_roles"
    // and "principal_type" are surface/scenario labels, not row content.)
    for (const value of [
      "org_admin",
      "workspace_admin",
      "project_manager",
      "contributor",
      "viewer",
      "tenant_owner",
      "active",
      "invited",
      "suspended",
      "deactivated",
    ]) {
      expect(serialized).not.toContain(`"${value}"`);
    }
    expect(result.schema).toBe(IDENTITY_MATRIX_RESULT_SCHEMA);
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

  it("keeps the example configuration synthetic and environment-reference only", () => {
    const serialized = JSON.stringify(EXAMPLE_IDENTITY_MATRIX_CONFIG);
    expect(serialized).not.toContain("eyJ");
    expect(serialized).not.toContain("supabase.co");
    for (const p of EXAMPLE_IDENTITY_MATRIX_CONFIG.principals) {
      expect(p.token_env).toMatch(/^PROBE_TOKEN_[A-Z0-9_]+$/);
    }
    for (const surface of IDENTITY_MEMBERSHIP_SURFACES) {
      for (const id of ids(surface)) {
        expect(id.startsWith("00000000-0000-4000-8000-")).toBe(true);
      }
    }
  });
});

// --- evaluation --------------------------------------------------------------

describe("API-HR.15 exact-set evaluation", () => {
  it("passes when the whole declared matrix matches exactly", async () => {
    const result = await run();
    expect(result.summary).toEqual({
      passed: 70,
      failed: 0,
      blocked: 0,
      total: 70,
    });
    expect(exitCodeForIdentityMatrixResult(result)).toBe(0);
  });

  it("is order independent and accepts multiple legitimate rows", () => {
    const candidates = ids("profiles");
    const expected = expectedFor("profiles", "ordinary_tenant_admin");
    const out = evaluate({
      scenario: "ordinary_tenant_admin",
      candidateIds: candidates,
      expectedIds: expected,
      body: [...expected].reverse().map((id) => ({ id })),
    });
    expect(out.outcome).toBe("passed");
    expect(out.reason_code).toBe("exact_set_match");
    expect(out.returned_ids).toHaveLength(expected.length);
    expect(expected.length).toBeGreaterThan(1);
  });

  it("fails when an expected row is missing", () => {
    const out = evaluate({
      scenario: "ordinary_org_admin",
      expectedIds: expectedFor("profiles", "ordinary_org_admin"),
      body: [{ id: ids("profiles")[0] }],
    });
    expect(out.outcome).toBe("failed");
    expect(out.reason_code).toBe("expected_identity_membership_row_missing");
    expect(out.missing_expected_ids.length).toBeGreaterThan(0);
  });

  it("fails when an unexpected candidate row is visible", () => {
    const out = evaluate({
      scenario: "ordinary_viewer",
      expectedIds: [ids("profiles")[0]],
      body: [{ id: ids("profiles")[0] }, { id: ids("profiles")[3] }],
    });
    expect(out.outcome).toBe("failed");
    expect(out.reason_code).toBe("unexpected_identity_membership_row_visible");
    expect(out.unexpected_ids).toEqual([ids("profiles")[3]]);
  });

  it("fails when an identifier outside the candidate set is returned", () => {
    const out = evaluate({
      expectedIds: [ids("profiles")[0]],
      body: [{ id: OUTSIDE_ID }],
    });
    expect(out.outcome).toBe("failed");
    expect(out.reason_code).toBe(
      "identity_membership_row_outside_candidate_set",
    );
    expect(out.unexpected_ids).toEqual([OUTSIDE_ID]);
  });

  it("fails on a duplicate or malformed returned identifier and a malformed row", () => {
    const duplicate = evaluate({
      expectedIds: [ids("profiles")[0]],
      body: [{ id: ids("profiles")[0] }, { id: ids("profiles")[0] }],
    });
    expect(duplicate.outcome).toBe("failed");
    expect(duplicate.reason_code).toBe(
      "duplicate_identity_membership_identifier",
    );

    const malformedId = evaluate({ body: [{ id: "not-a-uuid" }] });
    expect(malformedId.outcome).toBe("failed");
    expect(malformedId.reason_code).toBe(
      "malformed_identity_membership_identifier",
    );

    const malformedRow = evaluate({ body: ["just-a-string"] });
    expect(malformedRow.outcome).toBe("failed");
    expect(malformedRow.reason_code).toBe("malformed_row");
  });

  it("accepts 200 with an empty array, 401 and 403 for an explicitly empty expectation", () => {
    const ok = evaluate({ expectedIds: [], status: 200, body: [] });
    expect(ok.outcome).toBe("passed");
    expect(ok.reason_code).toBe("expected_empty_result");

    for (const status of [401, 403]) {
      const out = evaluate({ expectedIds: [], status });
      expect(out.outcome).toBe("passed");
      expect(out.reason_code).toBe("contained_direct_read");
    }
  });

  it("blocks an unexpected HTTP status, a non-array body, a network error and a timeout", () => {
    for (const status of [404, 429, 500]) {
      const out = evaluate({ expectedIds: [ids("profiles")[0]], status });
      expect(out.outcome).toBe("blocked");
      expect(out.reason_code).toBe("unexpected_http_status");
    }

    const notArray = evaluate({
      expectedIds: [ids("profiles")[0]],
      status: 200,
      body: { message: "nope" },
    });
    expect(notArray.outcome).toBe("blocked");
    expect(notArray.reason_code).toBe("response_not_array");

    const transport = evaluate({ transportError: true });
    expect(transport.outcome).toBe("blocked");
    expect(transport.reason_code).toBe("transport_error");
  });

  it("blocks a network failure and an aborted request through the runner", async () => {
    const network = await run({}, [], { throwOn: "ordinary_org_admin:profiles" });
    const failed = entry(network, "ordinary_org_admin", "profiles");
    expect(failed.outcome).toBe("blocked");
    expect(failed.reason_code).toBe("transport_error");
    expect(exitCodeForIdentityMatrixResult(network)).toBe(2);

    const timeout = await runIdentityMembershipAccessMatrix(
      EXAMPLE_IDENTITY_MATRIX_CONFIG,
      {
        env: envFor(),
        fetchImpl: (async () => {
          throw new DOMException("aborted", "AbortError");
        }) as unknown as typeof fetch,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );
    expect(timeout.summary.blocked).toBe(70);
    expect(timeout.results.every((r) => r.reason_code === "transport_error")).toBe(
      true,
    );
  });

  it("fails when the deactivated user receives any candidate row", async () => {
    const result = await run({
      "ordinary_deactivated_user:project_memberships": {
        status: 200,
        body: [{ id: ids("project_memberships")[0] }],
      },
    });
    const e = entry(result, "ordinary_deactivated_user", "project_memberships");
    expect(e.outcome).toBe("failed");
    expect(e.reason_code).toBe("deactivated_user_saw_identity_membership_row");
    expect(exitCodeForIdentityMatrixResult(result)).toBe(1);
  });

  it("returns exit code 1 for a genuine authorization failure and 2 when anything is blocked", async () => {
    const failing = await run({
      "ordinary_viewer:workspace_memberships": {
        status: 200,
        body: ids("workspace_memberships").map((id) => ({ id })),
      },
    });
    expect(failing.summary.failed).toBe(1);
    expect(exitCodeForIdentityMatrixResult(failing)).toBe(1);

    const blocked = await run({
      "ordinary_viewer:workspace_memberships": { status: 500 },
    });
    expect(blocked.summary.blocked).toBe(1);
    expect(exitCodeForIdentityMatrixResult(blocked)).toBe(2);
  });
});

// --- error type --------------------------------------------------------------

describe("API-HR.15 error reporting", () => {
  it("uses safe codes and never echoes offending configuration values", () => {
    try {
      const cfg = clone(EXAMPLE_IDENTITY_MATRIX_CONFIG) as any;
      cfg.secret_email = "person@example.com";
      validateIdentityMatrixConfig(cfg);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityMatrixConfigError);
      expect((error as IdentityMatrixConfigError).code).toBe(
        "undeclared_config_property",
      );
      expect((error as Error).message).not.toContain("person@example.com");
    }
  });
});
