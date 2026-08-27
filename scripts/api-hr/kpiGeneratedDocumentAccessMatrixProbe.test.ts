// API-HR.16 — focused tests for the KPI & generated-document project-scope matrix harness.
// Mocked fetch only. No live Supabase or external network call.

import { describe, expect, it } from "bun:test";
import {
  EXAMPLE_KPI_DOC_MATRIX_CONFIG,
  KPI_DOC_MATRIX_CONFIG_SCHEMA,
  KPI_DOC_MATRIX_RESULT_SCHEMA,
  KPI_DOC_SURFACES,
  KpiDocMatrixConfigError,
  REQUIRED_KPI_DOC_MATRIX_SCENARIOS,
  buildKpiDocRequestUrl,
  evaluateKpiDocResponse,
  exitCodeForKpiDocMatrixResult,
  parseKpiDocMatrixCliArgs,
  runKpiGeneratedDocumentAccessMatrix,
  validateKpiDocMatrixConfig,
  type KpiDocSurface,
} from "./kpiGeneratedDocumentAccessMatrixProbe";

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

const ids = (surface: KpiDocSurface) =>
  EXAMPLE_KPI_DOC_MATRIX_CONFIG.surfaces[surface].candidate_ids;

const expectedFor = (surface: KpiDocSurface, scenario: string) =>
  EXAMPLE_KPI_DOC_MATRIX_CONFIG.surfaces[surface].expected_visible_ids[scenario];

function envFor(
  config = EXAMPLE_KPI_DOC_MATRIX_CONFIG,
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
  for (const p of EXAMPLE_KPI_DOC_MATRIX_CONFIG.principals) {
    for (const s of KPI_DOC_SURFACES) order.push(`${p.scenario}:${s}`);
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
    const [scenario, surface] = key.split(":") as [string, KpiDocSurface];
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
  runKpiGeneratedDocumentAccessMatrix(EXAMPLE_KPI_DOC_MATRIX_CONFIG, {
    env: opts.env ?? envFor(),
    fetchImpl: mockFetch(overrides, calls, { throwOn: opts.throwOn }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

const entry = (
  result: Awaited<ReturnType<typeof run>>,
  scenario: string,
  surface: KpiDocSurface,
) =>
  result.results.find(
    (r) => r.principal_scenario === scenario && r.surface === surface,
  )!;

const evaluate = (args: {
  scenario?: string;
  surface?: KpiDocSurface;
  candidateIds?: string[];
  expectedIds?: string[];
  status?: number | null;
  body?: unknown;
  transportError?: boolean;
}) =>
  evaluateKpiDocResponse({
    scenario: args.scenario ?? "ordinary_viewer",
    surface: args.surface ?? "kpi_definitions",
    candidateIds: args.candidateIds ?? ids("kpi_definitions"),
    expectedIds: args.expectedIds ?? [],
    status: args.status ?? 200,
    body: args.body ?? [],
    transportError: args.transportError,
  });

// --- configuration -----------------------------------------------------------

describe("API-HR.16 configuration contract", () => {
  it("accepts the complete synthetic example", () => {
    const config = validateKpiDocMatrixConfig(
      clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG),
    );
    expect(config.schema).toBe(KPI_DOC_MATRIX_CONFIG_SCHEMA);
    expect(config.principals).toHaveLength(10);
    expect(Object.keys(config.surfaces).sort()).toEqual(
      [...KPI_DOC_SURFACES].sort(),
    );
  });

  it("declares exactly the four fixed surfaces", () => {
    expect(KPI_DOC_SURFACES).toEqual([
      "kpi_definitions",
      "kpi_updates",
      "kpi_snapshots",
      "generated_operational_documents",
    ]);
  });

  it("requires all ten principals", () => {
    expect(REQUIRED_KPI_DOC_MATRIX_SCENARIOS).toHaveLength(10);
    for (const scenario of REQUIRED_KPI_DOC_MATRIX_SCENARIOS) {
      const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
      config.principals = config.principals.filter(
        (p) => p.scenario !== scenario,
      );
      expect(() => validateKpiDocMatrixConfig(config)).toThrow(
        `missing_principal_scenario:${scenario}`,
      );
    }
  });

  it("rejects a duplicate scenario", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    config.principals[1] = { ...config.principals[0] };
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "duplicate_principal_scenario",
    );
  });

  it("rejects an unknown scenario", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (config.principals[0] as { scenario: string }).scenario = "ordinary_wizard";
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "unknown_principal_scenario",
    );
  });

  it("rejects anonymous, external OAuth and service-role principal types", () => {
    for (const [type, code] of [
      ["anonymous", "anonymous_principal_forbidden"],
      ["external_oauth", "external_oauth_principal_forbidden"],
      ["service_role", "service_role_principal_forbidden"],
    ] as const) {
      const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
      (config.principals[0] as { type: string }).type = type;
      expect(() => validateKpiDocMatrixConfig(config)).toThrow(code);
    }
  });

  it("rejects a custom principal type", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (config.principals[0] as { type: string }).type = "machine";
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "principal_type_invalid",
    );
  });

  it("rejects inline credentials in token_env", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (config.principals[0] as { token_env: string }).token_env = ORDINARY_TOKEN;
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "inline_secret_forbidden",
    );
  });

  it("rejects an undeclared top-level property", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG) as Record<
      string,
      unknown
    >;
    config.service_role_key = "x";
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "undeclared_config_property",
    );
    const other = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG) as Record<
      string,
      unknown
    >;
    other.extra_option = true;
    expect(() => validateKpiDocMatrixConfig(other)).toThrow(
      "undeclared_config_property",
    );
  });

  it("rejects an undeclared principal property", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (config.principals[0] as Record<string, unknown>).token = "x";
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "undeclared_principal_property",
    );
  });

  it("rejects an undeclared coverage property", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (config.coverage as Record<string, unknown>).user_ids = [];
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "undeclared_coverage_property",
    );
  });

  it("enforces minimum tenant/org/workspace/project coverage", () => {
    for (const [key, code] of [
      ["tenant_ids", "coverage_insufficient_tenant_ids"],
      ["organization_ids", "coverage_insufficient_organization_ids"],
      ["workspace_ids", "coverage_insufficient_workspace_ids"],
      ["project_ids", "coverage_insufficient_project_ids"],
    ] as const) {
      const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
      (config.coverage as Record<string, string[]>)[key] = [
        (config.coverage as Record<string, string[]>)[key][0],
      ];
      expect(() => validateKpiDocMatrixConfig(config)).toThrow(code);
    }
  });

  it("rejects invalid and duplicate coverage UUIDs", () => {
    const invalid = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    invalid.coverage.project_ids[0] = "not-a-uuid";
    expect(() => validateKpiDocMatrixConfig(invalid)).toThrow(
      "coverage_invalid_project_ids",
    );

    const duplicate = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    duplicate.coverage.workspace_ids[1] = duplicate.coverage.workspace_ids[0];
    expect(() => validateKpiDocMatrixConfig(duplicate)).toThrow(
      "coverage_duplicate_workspace_ids",
    );
  });

  it("rejects a missing surface", () => {
    for (const surface of KPI_DOC_SURFACES) {
      const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG) as Record<
        string,
        Record<string, unknown>
      >;
      delete config.surfaces[surface];
      expect(() => validateKpiDocMatrixConfig(config)).toThrow(
        `missing_surface:${surface}`,
      );
    }
  });

  it("rejects an extra/custom surface", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG) as Record<
      string,
      Record<string, unknown>
    >;
    config.surfaces.kpi_app_submission_outbox = clone(
      EXAMPLE_KPI_DOC_MATRIX_CONFIG.surfaces.kpi_definitions,
    );
    expect(() => validateKpiDocMatrixConfig(config)).toThrow("unknown_surface");
  });

  it("rejects an undeclared surface property", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (config.surfaces.kpi_updates as Record<string, unknown>).select = "*";
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "undeclared_surface_property",
    );
  });

  it("rejects empty candidate sets", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    config.surfaces.kpi_snapshots.candidate_ids = [];
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "candidate_ids_missing:kpi_snapshots",
    );
  });

  it("rejects more than 25 candidate IDs", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    config.surfaces.kpi_definitions.candidate_ids = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "candidate_ids_exceed_bound:kpi_definitions",
    );
  });

  it("rejects invalid and duplicate candidate IDs", () => {
    const invalid = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    invalid.surfaces.kpi_updates.candidate_ids[0] = "kpi-1";
    expect(() => validateKpiDocMatrixConfig(invalid)).toThrow(
      "candidate_id_invalid:kpi_updates",
    );

    const duplicate = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    duplicate.surfaces.kpi_updates.candidate_ids[1] =
      duplicate.surfaces.kpi_updates.candidate_ids[0];
    expect(() => validateKpiDocMatrixConfig(duplicate)).toThrow(
      "duplicate_candidate_id:kpi_updates",
    );
  });

  it("rejects a missing expected scenario (never inferred as empty)", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG) as Record<
      string,
      Record<string, { expected_visible_ids: Record<string, string[]> }>
    >;
    delete config.surfaces.kpi_snapshots.expected_visible_ids
      .ordinary_contributor;
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "missing_explicit_expectation:kpi_snapshots",
    );
  });

  it("rejects an expected ID outside the candidate set", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    config.surfaces.kpi_definitions.expected_visible_ids.ordinary_viewer = [
      OUTSIDE_ID,
    ];
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "expected_id_outside_candidates:kpi_definitions",
    );
  });

  it("rejects a duplicate expected ID", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    const id = ids("kpi_definitions")[0];
    config.surfaces.kpi_definitions.expected_visible_ids.ordinary_viewer = [
      id,
      id,
    ];
    expect(() => validateKpiDocMatrixConfig(config)).toThrow(
      "duplicate_expected_id:kpi_definitions",
    );
  });

  it("accepts mixed legitimate visibility for a boundary scenario", () => {
    const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    const candidates = ids("kpi_updates");
    config.surfaces.kpi_updates.expected_visible_ids.ordinary_same_org_other_workspace =
      [candidates[0], candidates[2]];
    config.surfaces.kpi_updates.expected_visible_ids.ordinary_removed_project_membership =
      [candidates[1]];
    const parsed = validateKpiDocMatrixConfig(config);
    expect(
      parsed.surfaces.kpi_updates.expected_visible_ids
        .ordinary_same_org_other_workspace,
    ).toHaveLength(2);
  });

  it("rejects a non-empty deactivated-user expectation on every surface", () => {
    for (const surface of KPI_DOC_SURFACES) {
      const config = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
      config.surfaces[surface].expected_visible_ids.ordinary_deactivated_user = [
        ids(surface)[0],
      ];
      expect(() => validateKpiDocMatrixConfig(config)).toThrow(
        `ordinary_deactivated_user_must_expect_no_rows:${surface}`,
      );
    }
  });

  it("rejects a wrong schema and invalid env names/timeouts", () => {
    const wrongSchema = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (wrongSchema as { schema: string }).schema = "other_v1";
    expect(() => validateKpiDocMatrixConfig(wrongSchema)).toThrow(
      "unsupported_config_schema",
    );

    const badEnv = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (badEnv as { supabase_url_env: string }).supabase_url_env = "lowercase";
    expect(() => validateKpiDocMatrixConfig(badEnv)).toThrow(
      "supabase_url_env_invalid",
    );

    const badTimeout = clone(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    (badTimeout as { timeout_ms: number }).timeout_ms = 0;
    expect(() => validateKpiDocMatrixConfig(badTimeout)).toThrow(
      "timeout_invalid",
    );
  });

  it("surfaces config errors as KpiDocMatrixConfigError", () => {
    try {
      validateKpiDocMatrixConfig("nope");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(KpiDocMatrixConfigError);
      expect((error as KpiDocMatrixConfigError).code).toBe("config_not_object");
    }
  });
});

describe("API-HR.16 token preflight", () => {
  it("blocks a JWT carrying client_id", async () => {
    const env = envFor();
    env[EXAMPLE_KPI_DOC_MATRIX_CONFIG.principals[0].token_env] = OAUTH_TOKEN;
    const result = await run({}, [], { env });
    for (const surface of KPI_DOC_SURFACES) {
      const e = entry(result, "ordinary_org_admin", surface);
      expect(e.outcome).toBe("blocked");
      expect(e.reason_code).toBe("ordinary_browser_token_has_client_id");
    }
  });

  it("blocks blank and malformed tokens safely", async () => {
    const blank = envFor();
    blank[EXAMPLE_KPI_DOC_MATRIX_CONFIG.principals[0].token_env] = "   ";
    const blankResult = await run({}, [], { env: blank });
    expect(entry(blankResult, "ordinary_org_admin", "kpi_updates").reason_code).toBe(
      "token_blank",
    );

    const malformed = envFor();
    malformed[EXAMPLE_KPI_DOC_MATRIX_CONFIG.principals[0].token_env] = "abc.def";
    const malformedResult = await run({}, [], { env: malformed });
    expect(
      entry(malformedResult, "ordinary_org_admin", "kpi_updates").reason_code,
    ).toBe("token_not_jwt_shaped");
  });

  it("blocks a missing environment variable", async () => {
    const env = envFor();
    delete env.PROBE_SUPABASE_URL;
    const result = await run({}, [], { env });
    expect(result.summary.blocked).toBe(40);
    expect(exitCodeForKpiDocMatrixResult(result)).toBe(2);
  });
});

// --- evaluation ---------------------------------------------------------------

describe("API-HR.16 exact-set evaluation", () => {
  it("passes on an exact match regardless of ordering", () => {
    const [a, b] = ids("kpi_definitions");
    const forward = evaluate({ expectedIds: [a, b], body: [{ id: a }, { id: b }] });
    const reversed = evaluate({
      expectedIds: [a, b],
      body: [{ id: b }, { id: a }],
    });
    expect(forward.outcome).toBe("passed");
    expect(reversed.outcome).toBe("passed");
    expect(reversed.reason_code).toBe("exact_set_match");
  });

  it("passes with multiple legitimate administrative rows", () => {
    const expected = expectedFor("kpi_definitions", "ordinary_org_admin");
    expect(expected.length).toBeGreaterThan(1);
    const outcome = evaluate({
      scenario: "ordinary_org_admin",
      expectedIds: expected,
      body: expected.map((id) => ({ id })),
    });
    expect(outcome.outcome).toBe("passed");
  });

  it("fails on a missing expected row", () => {
    const [a, b] = ids("kpi_snapshots");
    const outcome = evaluate({
      surface: "kpi_snapshots",
      candidateIds: ids("kpi_snapshots"),
      expectedIds: [a, b],
      body: [{ id: a }],
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason_code).toBe(
      "expected_kpi_generated_document_row_missing",
    );
    expect(outcome.missing_expected_ids).toEqual([b]);
  });

  it("fails on an unexpected visible candidate", () => {
    const [a, b] = ids("generated_operational_documents");
    const outcome = evaluate({
      surface: "generated_operational_documents",
      candidateIds: ids("generated_operational_documents"),
      expectedIds: [a],
      body: [{ id: a }, { id: b }],
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason_code).toBe(
      "unexpected_kpi_generated_document_row_visible",
    );
    expect(outcome.unexpected_ids).toEqual([b]);
  });

  it("fails on an ID outside the candidate set", () => {
    const outcome = evaluate({
      expectedIds: [ids("kpi_definitions")[0]],
      body: [{ id: OUTSIDE_ID }],
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason_code).toBe(
      "kpi_generated_document_row_outside_candidate_set",
    );
  });

  it("fails on duplicate and malformed returned identifiers", () => {
    const id = ids("kpi_updates")[0];
    const duplicate = evaluate({
      surface: "kpi_updates",
      candidateIds: ids("kpi_updates"),
      expectedIds: [id],
      body: [{ id }, { id }],
    });
    expect(duplicate.reason_code).toBe(
      "duplicate_kpi_generated_document_identifier",
    );

    const malformedId = evaluate({ body: [{ id: "nope" }] });
    expect(malformedId.reason_code).toBe(
      "malformed_kpi_generated_document_identifier",
    );

    const malformedRow = evaluate({ body: ["row"] });
    expect(malformedRow.reason_code).toBe("malformed_row");
  });

  it("accepts 200 empty, 401 and 403 when expected visibility is empty", () => {
    expect(evaluate({ status: 200, body: [], expectedIds: [] }).outcome).toBe(
      "passed",
    );
    expect(evaluate({ status: 401, expectedIds: [] }).outcome).toBe("passed");
    expect(evaluate({ status: 403, expectedIds: [] }).outcome).toBe("passed");
  });

  it("blocks unexpected status, non-array body and transport failure", () => {
    expect(evaluate({ status: 500 }).outcome).toBe("blocked");
    expect(evaluate({ status: 500 }).reason_code).toBe("unexpected_http_status");
    expect(evaluate({ body: { id: "x" } }).reason_code).toBe(
      "response_not_array",
    );
    expect(evaluate({ transportError: true }).reason_code).toBe(
      "transport_error",
    );
  });

  it("uses the deactivated-user reason code when any row is returned", () => {
    const outcome = evaluate({
      scenario: "ordinary_deactivated_user",
      expectedIds: [],
      body: [{ id: ids("kpi_definitions")[0] }],
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason_code).toBe(
      "deactivated_user_saw_kpi_generated_document_row",
    );
  });
});

// --- runner behaviour ---------------------------------------------------------

describe("API-HR.16 runner", () => {
  it("passes the full example matrix and returns exit code 0", async () => {
    const result = await run();
    expect(result.schema).toBe(KPI_DOC_MATRIX_RESULT_SCHEMA);
    expect(result.summary).toEqual({
      passed: 40,
      failed: 0,
      blocked: 0,
      total: 40,
    });
    expect(exitCodeForKpiDocMatrixResult(result)).toBe(0);
  });

  it("fails with exit code 1 when a deactivated user sees a row", async () => {
    const result = await run({
      "ordinary_deactivated_user:kpi_snapshots": {
        status: 200,
        body: [{ id: ids("kpi_snapshots")[0] }],
      },
    });
    const e = entry(result, "ordinary_deactivated_user", "kpi_snapshots");
    expect(e.outcome).toBe("failed");
    expect(e.reason_code).toBe("deactivated_user_saw_kpi_generated_document_row");
    expect(exitCodeForKpiDocMatrixResult(result)).toBe(1);
  });

  it("blocks on a network error", async () => {
    const result = await run({}, [], {
      throwOn: "ordinary_viewer:kpi_definitions",
    });
    const e = entry(result, "ordinary_viewer", "kpi_definitions");
    expect(e.outcome).toBe("blocked");
    expect(e.reason_code).toBe("transport_error");
    expect(exitCodeForKpiDocMatrixResult(result)).toBe(2);
  });

  it("blocks on a timeout (aborted request)", async () => {
    const abortingFetch = (async (_url: string, init: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const signal = init.signal as AbortSignal;
      if (signal.aborted) throw new Error("aborted");
      return { status: 200, json: async () => [] } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await runKpiGeneratedDocumentAccessMatrix(
      { ...EXAMPLE_KPI_DOC_MATRIX_CONFIG, timeout_ms: 1 },
      { env: envFor(), fetchImpl: abortingFetch },
    );
    expect(result.summary.blocked).toBe(40);
    expect(
      result.results.every((r) => r.reason_code === "transport_error"),
    ).toBe(true);
  });

  it("passes when an expected-empty pair answers 401 or 403", async () => {
    const result = await run({
      "ordinary_workspace_member_no_project:kpi_definitions": { status: 401 },
      "ordinary_workspace_member_no_project:kpi_updates": { status: 403 },
    });
    expect(
      entry(result, "ordinary_workspace_member_no_project", "kpi_definitions")
        .outcome,
    ).toBe("passed");
    expect(
      entry(result, "ordinary_workspace_member_no_project", "kpi_updates")
        .outcome,
    ).toBe("passed");
  });
});

// --- request safety -----------------------------------------------------------

describe("API-HR.16 request safety", () => {
  it("issues exactly 40 requests: 10 principals x 4 surfaces", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    expect(calls).toHaveLength(40);
  });

  it("only issues GET requests against the four fixed relations", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    const allowed = KPI_DOC_SURFACES.map(
      (s) => `https://example.supabase.co/rest/v1/${s}`,
    );
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      const url = new URL(call.url);
      expect(allowed).toContain(`${url.origin}${url.pathname}`);
      expect(url.searchParams.get("select")).toBe("id");
      expect(url.searchParams.get("id")?.startsWith("in.(")).toBe(true);
      const filterCount =
        url.searchParams.get("id")!.replace("in.(", "").replace(")", "").split(",")
          .length;
      expect(Number(url.searchParams.get("limit"))).toBe(filterCount);
      expect(url.pathname).not.toContain("/rpc/");
      expect(url.pathname).not.toContain("/functions/");
      expect(url.search).not.toContain("select=*");
    }
  });

  it("never reaches an RPC, Edge Function, generation or SharePoint endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    const joined = calls.map((c) => c.url).join(" ");
    for (const forbidden of [
      "/rpc/",
      "/functions/v1/",
      "sharepoint",
      "graph.microsoft.com",
      "generate-document",
      "kpi_app_",
      "powerbi",
    ]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("never uses a mutation method", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await run({}, calls);
    for (const call of calls) {
      expect(["POST", "PUT", "PATCH", "DELETE"]).not.toContain(
        String(call.init.method),
      );
    }
  });

  it("rejects a request for an unknown surface at URL build time", () => {
    expect(() =>
      buildKpiDocRequestUrl(
        "https://example.supabase.co",
        "kpi_app_mappings" as KpiDocSurface,
        [ids("kpi_definitions")[0]],
      ),
    ).toThrow("unknown_surface");
  });

  it("bounds the limit to the candidate count and trims trailing slashes", () => {
    const candidates = ids("kpi_snapshots");
    const url = new URL(
      buildKpiDocRequestUrl(
        "https://example.supabase.co/",
        "kpi_snapshots",
        candidates,
      ),
    );
    expect(url.pathname).toBe("/rest/v1/kpi_snapshots");
    expect(url.searchParams.get("limit")).toBe(String(candidates.length));
  });
});

// --- confidentiality & CLI ----------------------------------------------------

describe("API-HR.16 confidentiality and CLI", () => {
  it("serializes results without credentials or row content", async () => {
    const result = await run();
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      ORDINARY_TOKEN,
      "anon-key-value",
      "Bearer",
      "apikey",
      "authorization",
      "kpi_name",
      "action_plan",
      "file_name",
      "sharepoint",
      "encrypted",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    const keys = new Set(result.results.flatMap((r) => Object.keys(r)));
    expect([...keys].sort()).toEqual([
      "http_status",
      "missing_expected_ids",
      "outcome",
      "principal_scenario",
      "principal_type",
      "reason_code",
      "returned_ids",
      "surface",
      "unexpected_ids",
    ]);
  });

  it("keeps the example configuration synthetic and env-reference-only", () => {
    const serialized = JSON.stringify(EXAMPLE_KPI_DOC_MATRIX_CONFIG);
    expect(serialized).not.toContain("supabase.co");
    expect(serialized).not.toContain("eyJ");
    for (const p of EXAMPLE_KPI_DOC_MATRIX_CONFIG.principals) {
      expect(p.token_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    for (const surface of KPI_DOC_SURFACES) {
      for (const id of ids(surface)) {
        expect(id.startsWith("00000000-0000-4000-8000-")).toBe(true);
      }
    }
  });

  it("parses CLI arguments and rejects unknown ones", () => {
    expect(
      parseKpiDocMatrixCliArgs(["--config", "c.json", "--output", "r.json"]),
    ).toEqual({ configPath: "c.json", outputPath: "r.json" });
    expect(parseKpiDocMatrixCliArgs(["--print-example-config"])).toEqual({
      printExample: true,
    });
    expect(parseKpiDocMatrixCliArgs(["--help"])).toEqual({ help: true });
    expect(() => parseKpiDocMatrixCliArgs(["--live"])).toThrow(
      "unknown_argument:--live",
    );
  });
});
