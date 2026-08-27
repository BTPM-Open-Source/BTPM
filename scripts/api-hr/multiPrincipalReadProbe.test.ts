// API-HR.3 — focused tests for the multi-principal direct-read probe harness.
// All fetch calls are mocked. No Supabase or external service is contacted.

import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_CONFIG,
  evaluateProbeResponse,
  exitCodeForResult,
  PROBE_CONFIG_SCHEMA,
  ProbeConfigError,
  runProbes,
  validateProbeConfig,
  type ProbeConfig,
  type ProbeDefinition,
  type PrincipalConfig,
} from "./multiPrincipalReadProbe";

const ID_A = "00000000-0000-4000-8000-000000000401";
const ID_B = "00000000-0000-4000-8000-000000000402";

function b64url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function jwt(payload: object): string {
  return `${b64url({ alg: "ES256" })}.${b64url(payload)}.sig`;
}

const BROWSER_TOKEN = jwt({ sub: "user-1" });
const OAUTH_TOKEN = jwt({ sub: "user-1", client_id: "client-1" });

function baseConfig(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(EXAMPLE_CONFIG));
}

function probe(overrides: Partial<ProbeDefinition> = {}): ProbeDefinition {
  return {
    probe_key: "projects_direct_read",
    table: "projects",
    classification: "pm_business_data",
    identifier_column: "id",
    safe_columns: ["id", "workspace_id"],
    candidate_ids: [ID_A, ID_B],
    expected_visible_ids: {},
    ...overrides,
  };
}

const browserPrincipal: PrincipalConfig = {
  scenario: "ordinary_project_member",
  type: "ordinary_browser",
  token_env: "PROBE_TOKEN_PROJECT_MEMBER",
};
const oauthPrincipal: PrincipalConfig = {
  scenario: "external_oauth",
  type: "external_oauth",
  token_env: "PROBE_TOKEN_EXTERNAL_OAUTH",
};

describe("configuration validation", () => {
  it("accepts the example configuration", () => {
    expect(validateProbeConfig(baseConfig()).schema).toBe(PROBE_CONFIG_SCHEMA);
  });

  it("rejects a missing required principal scenario", () => {
    const cfg = baseConfig() as { principals: unknown[] };
    cfg.principals = (cfg.principals as PrincipalConfig[]).filter(
      (p) => p.scenario !== "ordinary_cross_org",
    );
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /missing_principal_scenario:ordinary_cross_org/,
    );
  });

  it("rejects a service-role principal", () => {
    const cfg = baseConfig() as { principals: Record<string, unknown>[] };
    cfg.principals.push({
      scenario: "ordinary_org_admin",
      type: "service_role",
      token_env: "PROBE_TOKEN_SERVICE",
    });
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /service_role_principal_forbidden/,
    );
  });

  it("rejects select=* and unsafe selected columns", () => {
    const star = baseConfig() as { probes: Record<string, unknown>[] };
    star.probes[0].safe_columns = ["*"];
    expect(() => validateProbeConfig(star)).toThrowError(/select_star_forbidden/);

    const unsafe = baseConfig() as { probes: Record<string, unknown>[] };
    unsafe.probes[0].safe_columns = ["id", "notes_encrypted"];
    expect(() => validateProbeConfig(unsafe)).toThrowError(
      /sensitive_column_forbidden/,
    );
  });

  it("rejects duplicate candidate ids and over-bounded candidate lists", () => {
    const dup = baseConfig() as { probes: Record<string, unknown>[] };
    dup.probes[0].candidate_ids = [ID_A, ID_A];
    expect(() => validateProbeConfig(dup)).toThrowError(/duplicate_candidate_id/);
  });

  it("rejects an unknown principal scenario in expectations", () => {
    const cfg = baseConfig() as { probes: Record<string, unknown>[] };
    cfg.probes[0].expected_visible_ids = {
      ...(cfg.probes[0].expected_visible_ids as object),
      mystery_role: [],
    };
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /unknown_principal_scenario/,
    );
  });

  it("rejects anonymous or external OAuth expecting protected rows", () => {
    const anon = baseConfig() as { probes: Record<string, unknown>[] };
    (anon.probes[0].expected_visible_ids as Record<string, string[]>).anonymous = [
      ID_A,
    ];
    expect(() => validateProbeConfig(anon)).toThrowError(
      /anonymous_must_expect_no_protected_rows/,
    );

    const oauth = baseConfig() as { probes: Record<string, unknown>[] };
    (oauth.probes[0].expected_visible_ids as Record<string, string[]>)
      .external_oauth = [ID_A];
    expect(() => validateProbeConfig(oauth)).toThrowError(
      /external_oauth_must_expect_no_protected_rows/,
    );
  });

  it("requires explicit ordinary-browser expectations for PM tables", () => {
    const cfg = baseConfig() as { probes: Record<string, unknown>[] };
    const expected = cfg.probes[0].expected_visible_ids as Record<string, string[]>;
    delete expected.ordinary_cross_org;
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /missing_explicit_expectation/,
    );
  });

  it("requires a coverage declaration with at least two ids per dimension", () => {
    const cfg = baseConfig() as { coverage: Record<string, unknown> };
    cfg.coverage.workspace_ids = ["00000000-0000-4000-8000-000000000301"];
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /coverage_insufficient_workspace_ids/,
    );
  });

  // --- API-HR.3C1: closed-schema configuration contract -------------------
  it("rejects an undeclared top-level property such as authorization", () => {
    const cfg = baseConfig() as Record<string, unknown>;
    cfg.authorization = "Bearer whatever";
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /undeclared_config_property/,
    );
  });

  it("rejects a principal-level inline token property", () => {
    for (const field of [
      "token",
      "bearer",
      "authorization",
      "apikey",
      "anon_key",
      "service_role_key",
    ]) {
      const cfg = baseConfig() as { principals: Record<string, unknown>[] };
      cfg.principals[1][field] = "inline-value";
      expect(() => validateProbeConfig(cfg)).toThrowError(
        /undeclared_principal_property/,
      );
    }
  });

  it("rejects undeclared probe properties such as url, rpc, method, headers, body", () => {
    const expectations: Record<string, RegExp> = {
      url: /custom_url_or_rpc_forbidden/,
      rpc: /custom_url_or_rpc_forbidden/,
      method: /mutation_method_forbidden/,
      headers: /undeclared_probe_property/,
      body: /undeclared_probe_property/,
    };
    for (const [field, pattern] of Object.entries(expectations)) {
      const cfg = baseConfig() as { probes: Record<string, unknown>[] };
      cfg.probes[0][field] = field === "method" ? "GET" : "value";
      expect(() => validateProbeConfig(cfg)).toThrowError(pattern);
    }
  });

  it("rejects an undeclared coverage property", () => {
    const cfg = baseConfig() as { coverage: Record<string, unknown> };
    cfg.coverage.service_role_key = "nope";
    expect(() => validateProbeConfig(cfg)).toThrowError(
      /undeclared_coverage_property/,
    );
  });

  it("rejects removing any required scenario from expected_visible_ids", () => {
    for (const scenario of [
      "anonymous",
      "ordinary_org_admin",
      "ordinary_workspace_admin",
      "ordinary_project_member",
      "ordinary_same_org_non_member",
      "ordinary_cross_org",
      "ordinary_removed_membership",
      "ordinary_deactivated_user",
      "external_oauth",
    ]) {
      const cfg = baseConfig() as { probes: Record<string, unknown>[] };
      const expected = cfg.probes[0].expected_visible_ids as Record<
        string,
        string[]
      >;
      delete expected[scenario];
      expect(() => validateProbeConfig(cfg)).toThrowError(
        /missing_explicit_expectation/,
      );
    }
  });

  it("applies the missing-scenario rule to all four classifications", () => {
    for (const classification of [
      "pm_business_data",
      "identity_membership_control",
      "server_only",
      "explicitly_public",
    ]) {
      const cfg = baseConfig() as { probes: Record<string, unknown>[] };
      cfg.probes[0].classification = classification;
      const expected = cfg.probes[0].expected_visible_ids as Record<
        string,
        string[]
      >;
      for (const key of Object.keys(expected)) expected[key] = [];
      delete expected.ordinary_deactivated_user;
      expect(() => validateProbeConfig(cfg)).toThrowError(
        /missing_explicit_expectation/,
      );
    }
  });

  it("accepts explicitly declared empty expectation sets", () => {
    const cfg = baseConfig() as { probes: Record<string, unknown>[] };
    const expected = cfg.probes[0].expected_visible_ids as Record<
      string,
      string[]
    >;
    for (const key of Object.keys(expected)) expected[key] = [];
    expect(validateProbeConfig(cfg).probes[0].expected_visible_ids
      .ordinary_org_admin).toEqual([]);
  });
});


describe("token preflight (precondition only, never authorization evidence)", () => {
  const cfg: ProbeConfig = validateProbeConfig(baseConfig());
  const env = {
    PROBE_SUPABASE_URL: "https://example.test",
    PROBE_SUPABASE_ANON_KEY: "anon-key",
  } as Record<string, string | undefined>;

  it("blocks an ordinary-browser token containing client_id", async () => {
    const result = await runProbes(cfg, {
      env: { ...env, PROBE_TOKEN_PROJECT_MEMBER: OAUTH_TOKEN },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const entry = result.results.find(
      (r) => r.principal_scenario === "ordinary_project_member",
    );
    expect(entry?.outcome).toBe("blocked");
    expect(entry?.reason_code).toBe("ordinary_browser_token_has_client_id");
  });

  it("blocks an external-OAuth token without client_id", async () => {
    const result = await runProbes(cfg, {
      env: { ...env, PROBE_TOKEN_EXTERNAL_OAUTH: BROWSER_TOKEN },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const entry = result.results.find(
      (r) => r.principal_scenario === "external_oauth",
    );
    expect(entry?.outcome).toBe("blocked");
    expect(entry?.reason_code).toBe("external_oauth_token_missing_client_id");
  });

  it("blocks an external-OAuth token whose client_id is whitespace-only", async () => {
    const result = await runProbes(cfg, {
      env: {
        ...env,
        PROBE_TOKEN_EXTERNAL_OAUTH: jwt({ sub: "user-1", client_id: "   " }),
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const entry = result.results.find(
      (r) => r.principal_scenario === "external_oauth",
    );
    expect(entry?.outcome).toBe("blocked");
    expect(entry?.reason_code).toBe("external_oauth_token_missing_client_id");
  });
});


describe("exact-set assertion behaviour", () => {
  it("passes when the returned identifier set matches exactly", () => {
    const r = evaluateProbeResponse({
      principal: browserPrincipal,
      probe: probe(),
      expectedIds: [ID_A],
      status: 200,
      body: [{ id: ID_A, workspace_id: "w" }],
    });
    expect(r.outcome).toBe("passed");
    expect(r.reason_code).toBe("exact_set_match");
  });

  it("fails when an expected authorized identifier is missing", () => {
    const r = evaluateProbeResponse({
      principal: browserPrincipal,
      probe: probe(),
      expectedIds: [ID_A],
      status: 200,
      body: [],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("expected_identifier_missing");
    expect(r.missing_expected_ids).toEqual([ID_A]);
  });

  it("fails when an unexpected cross-scope identifier is visible", () => {
    const r = evaluateProbeResponse({
      principal: browserPrincipal,
      probe: probe(),
      expectedIds: [ID_A],
      status: 200,
      body: [{ id: ID_A }, { id: ID_B }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("unexpected_cross_scope_row");
    expect(r.unexpected_ids).toEqual([ID_B]);
  });

  it("passes an expected denial on HTTP 200 with an empty array", () => {
    const r = evaluateProbeResponse({
      principal: oauthPrincipal,
      probe: probe(),
      expectedIds: [],
      status: 200,
      body: [],
    });
    expect(r.outcome).toBe("passed");
    expect(r.reason_code).toBe("expected_empty_result");
  });

  it("passes an expected denial on HTTP 401 and 403", () => {
    for (const status of [401, 403]) {
      const r = evaluateProbeResponse({
        principal: oauthPrincipal,
        probe: probe(),
        expectedIds: [],
        status,
        body: null,
      });
      expect(r.outcome).toBe("passed");
      expect(r.reason_code).toBe("contained_direct_read");
    }
  });

  it("fails when an external OAuth principal sees a protected row", () => {
    const r = evaluateProbeResponse({
      principal: oauthPrincipal,
      probe: probe(),
      expectedIds: [],
      status: 200,
      body: [{ id: ID_A }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("external_oauth_saw_protected_row");
  });

  it("fails when a server_only row is visible to an ordinary session", () => {
    const r = evaluateProbeResponse({
      principal: browserPrincipal,
      probe: probe({ classification: "server_only", table: "notification_outbox" }),
      expectedIds: [],
      status: 200,
      body: [{ id: ID_A }],
    });
    expect(r.outcome).toBe("failed");
    expect(r.reason_code).toBe("server_only_row_visible_to_client");
  });

  it("blocks an unexpected HTTP status and a transport error", () => {
    expect(
      evaluateProbeResponse({
        principal: browserPrincipal,
        probe: probe(),
        expectedIds: [ID_A],
        status: 500,
        body: null,
      }).outcome,
    ).toBe("blocked");
    expect(
      evaluateProbeResponse({
        principal: browserPrincipal,
        probe: probe(),
        expectedIds: [ID_A],
        status: null,
        body: null,
        transportError: true,
      }).reason_code,
    ).toBe("transport_error");
  });

  it("fails on duplicate or malformed returned identifiers", () => {
    expect(
      evaluateProbeResponse({
        principal: browserPrincipal,
        probe: probe(),
        expectedIds: [ID_A],
        status: 200,
        body: [{ id: ID_A }, { id: ID_A }],
      }).reason_code,
    ).toBe("duplicate_identifier");
    expect(
      evaluateProbeResponse({
        principal: browserPrincipal,
        probe: probe(),
        expectedIds: [ID_A],
        status: 200,
        body: [{ id: 42 }],
      }).reason_code,
    ).toBe("malformed_identifier");
  });
});

describe("request shape and safe output", () => {
  const cfg: ProbeConfig = validateProbeConfig(baseConfig());
  const env: Record<string, string | undefined> = {
    PROBE_SUPABASE_URL: "https://example.test",
    PROBE_SUPABASE_ANON_KEY: "anon-key-value",
    PROBE_TOKEN_ORG_ADMIN: BROWSER_TOKEN,
    PROBE_TOKEN_WORKSPACE_ADMIN: BROWSER_TOKEN,
    PROBE_TOKEN_PROJECT_MEMBER: BROWSER_TOKEN,
    PROBE_TOKEN_SAME_ORG_NON_MEMBER: BROWSER_TOKEN,
    PROBE_TOKEN_CROSS_ORG: BROWSER_TOKEN,
    PROBE_TOKEN_REMOVED_MEMBERSHIP: BROWSER_TOKEN,
    PROBE_TOKEN_DEACTIVATED_USER: BROWSER_TOKEN,
    PROBE_TOKEN_EXTERNAL_OAUTH: OAUTH_TOKEN,
  };

  it("issues GET /rest/v1/<table> only, never an RPC or mutation", async () => {
    const calls: { url: string; method?: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runProbes(cfg, { env, fetchImpl });
    expect(calls.length).toBe(9);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.url).toContain("/rest/v1/projects?");
      expect(call.url).not.toContain("/rpc/");
      expect(call.url).not.toContain("functions/v1");
      expect(call.url).toContain("select=id%2Cworkspace_id");
      expect(call.url).not.toContain("select=*");
    }
    expect(result.summary.total).toBe(9);
    expect(exitCodeForResult(result)).toBe(1); // three authorized sets missing
  });

  it("produces output with no token, JWT payload, anon key or full rows", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([{ id: ID_A, workspace_id: "secret-workspace-name" }]),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await runProbes(cfg, { env, fetchImpl });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(BROWSER_TOKEN);
    expect(serialized).not.toContain(OAUTH_TOKEN);
    expect(serialized).not.toContain("anon-key-value");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized).not.toContain("secret-workspace-name");
    expect(serialized).not.toContain("https://example.test");
    for (const entry of result.results) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          "classification",
          "http_status",
          "missing_expected_ids",
          "outcome",
          "principal_scenario",
          "principal_type",
          "probe_key",
          "reason_code",
          "returned_ids",
          "table",
          "unexpected_ids",
        ].sort(),
      );
    }
  });
});

describe("example configuration", () => {
  it("contains all nine scenarios, env names only and placeholder ids", () => {
    const serialized = JSON.stringify(EXAMPLE_CONFIG);
    expect(EXAMPLE_CONFIG.principals.length).toBe(9);
    expect(serialized).not.toContain("supabase.co");
    expect(serialized).not.toContain("eyJ");
    expect(() => validateProbeConfig(baseConfig())).not.toThrow();
    expect(ProbeConfigError.name).toBe("ProbeConfigError");
  });
});
