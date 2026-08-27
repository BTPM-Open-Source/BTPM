// KPI-2B — Focused activation tests for the single accepted external KPI detail
// read `GET /v1/kpis/:kpiid` through the existing protected-read pipeline.
// Synthetic UUIDs only. SQL authorization/containment/decryption behaviour is
// owned by KPI-2A and is not retested here.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type { ApiRouteDefinition } from "../router.ts";
import type { ApiV1ProjectKpiItem } from "../../_shared/btpm-api/supabaseKpiRead.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiProtectedRoute,
  matchApiRoute,
  type ApiProtectedRouteDependencies,
} from "../router.ts";
import {
  KPI_DETAIL_ROUTE,
  parseApiV1KpiDetailPath,
} from "../../_shared/btpm-api/routes/kpis.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { readApiV1Kpi } from "../../_shared/btpm-api/supabaseKpiRead.ts";
import { createDelegatedApiV1KpiReader } from "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts";
import { MCP_TOOL_REGISTRY } from "../../btpm-mcp/mcp/toolRegistry.ts";

const KPI_ID = "99999999-8888-4777-8666-555555555555";
const OTHER_KPI_ID = "7a7a7a7a-6b6b-4c5c-8d4d-3e3e3e3e3e3e";
const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
const DETAIL_PATH = `/v1/kpis/${KPI_ID}`;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "oauth-client-abc";

const CONTEXT = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
}) as unknown as AuthenticatedApiContext;

const KPI_KEYS: readonly string[] = Object.freeze([
  "kpiId",
  "projectId",
  "name",
  "description",
  "unit",
  "targetValue",
  "currentValue",
  "targetDirection",
  "sourceMode",
  "valueType",
  "cadence",
  "calculationKey",
  "formulaVersion",
  "completionMethod",
  "commentRequired",
  "actionPlanRequired",
  "autoSnapshotEnabled",
  "isArchived",
  "createdAt",
  "updatedAt",
]);

function kpiItem(kpiId = KPI_ID, projectId = PROJECT_ID) {
  return {
    kpiId,
    projectId,
    name: "On-time delivery",
    description: null,
    unit: "%",
    targetValue: 95,
    currentValue: null,
    targetDirection: "increase",
    sourceMode: "manual",
    valueType: "number",
    cadence: "manual_only",
    calculationKey: null,
    formulaVersion: null,
    completionMethod: null,
    commentRequired: false,
    actionPlanRequired: false,
    autoSnapshotEnabled: false,
    isArchived: false,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  } as unknown as ApiV1ProjectKpiItem;
}

const READS_ON = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

interface Trace {
  order: string[];
  kpiIds: string[];
}

function newTrace(): Trace {
  return { order: [], kpiIds: [] };
}

function buildDeps(
  trace: Trace,
  overrides: Partial<ApiProtectedRouteDependencies> = {},
): ApiProtectedRouteDependencies {
  const failing = () => Promise.reject(new ApiHttpError("internal_error"));
  return {
    authenticate: () => {
      trace.order.push("authenticate");
      return Promise.resolve(CONTEXT);
    },
    authorizeRoute: (_c: AuthenticatedApiContext, route: ApiRouteDefinition) => {
      trace.order.push(`authorize:${route.id}`);
      return Promise.resolve();
    },
    resolveRateLimitProfile: (
      _c: AuthenticatedApiContext,
      route: ApiRouteDefinition,
    ) => {
      trace.order.push(`profile:${route.id}`);
      return Promise.resolve({ limit: 100, windowSeconds: 60 });
    },
    rateLimit: {
      store: {
        consume: () => {
          trace.order.push("rateLimit");
          return Promise.resolve({
            allowed: true,
            remaining: 9,
            resetAtEpochMs: 1_700_000_000_000,
          });
        },
      },
      now: () => 1_600_000_000_000,
    },
    readMe: failing,
    readOrganizations: failing,
    readWorkspaces: failing,
    readProjects: failing,
    readProjectDetail: failing,
    readProjectPlanning: failing,
    readKpi: (_req: Request, _ctx: AuthenticatedApiContext, kpiId: string) => {
      trace.order.push("readKpi");
      trace.kpiIds.push(kpiId);
      return Promise.resolve(kpiItem());
    },
    ...overrides,
  } as unknown as ApiProtectedRouteDependencies;
}

// ---------------------------------------------------------------------------
// Route identity + registration
// ---------------------------------------------------------------------------

Deno.test("KPI-2B: the KPI detail route contract is exact and frozen", () => {
  assertEquals(KPI_DETAIL_ROUTE, {
    id: "kpis.get_by_id",
    method: "GET",
    path: "/v1/kpis/:kpiid",
    operation: "read",
  });
});

Deno.test("KPI-2B: the KPI detail route is registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === KPI_DETAIL_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "kpis.get_by_id").length,
    1,
  );
});

// Global route cardinality is deliberately NOT frozen here: it is owned solely
// by `api-v1-current-surface-topology.test.ts`. KPI-2B asserts only its own
// local exact-once registration above.


Deno.test("KPI-2B: /v1/capabilities advertises kpis.get_by_id exactly once", () => {
  const ops = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(ops.filter((o) => o === "kpis.get_by_id").length, 1);
  assertEquals(ops.filter((o) => o === "kpis.get").length, 1);
});

Deno.test("KPI-2B: the live authorization registry admits the route exactly once", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const matches = src.match(/route !== KPI_DETAIL_ROUTE/g) ?? [];
  assertEquals(matches.length, 1);
  assert(src.includes("createDelegatedApiV1KpiReader"));
  assert(!src.includes("API_V1_ROUTE_ALLOWLIST.includes("));
});

// ---------------------------------------------------------------------------
// Strict path parsing + matching
// ---------------------------------------------------------------------------

Deno.test("KPI-2B: valid detail path yields exactly the KPI ID", () => {
  assertEquals(parseApiV1KpiDetailPath(DETAIL_PATH), { kpiId: KPI_ID });
  assertStrictEquals(matchApiRoute("GET", DETAIL_PATH), KPI_DETAIL_ROUTE);
});

Deno.test("KPI-2B: invalid detail paths fail closed as invalid_request", () => {
  for (
    const bad of [
      "",
      "/v1/kpis",
      "/v1/kpis/",
      `${DETAIL_PATH}/`,
      `${DETAIL_PATH}/extra`,
      `/v1/kpis/${NIL_UUID}`,
      `/v1/kpis/${OTHER_KPI_ID.toUpperCase()}`,
      "/v1/kpis/AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      `/v1/kpis/${KPI_ID};v=1`,
      `/v1/kpis/ ${KPI_ID}`,
      `/v1/kpis/${KPI_ID} `,
      `/v1/kpis/${KPI_ID}%2Fx`,
      `/v1/kpis/${KPI_ID}?x=1`,
      `/v1/kpis/${KPI_ID}#f`,
      `/v1/kpis/${KPI_ID}\\x`,
      "/v1/kpis/not-a-uuid",
      `v1/kpis/${KPI_ID}`,
    ]
  ) {
    let code: string | null = null;
    try {
      parseApiV1KpiDetailPath(bad);
    } catch (err) {
      assert(err instanceof ApiHttpError, bad);
      code = err.code;
    }
    assertEquals(code, "invalid_request", bad);
    assertEquals(matchApiRoute("GET", bad), null, bad);
  }
  assertEquals(matchApiRoute("POST", DETAIL_PATH), null);
});

// ---------------------------------------------------------------------------
// Pipeline ordering
// ---------------------------------------------------------------------------

Deno.test("KPI-2B: protected read order is auth → authorize → profile → rate limit → reader", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${DETAIL_PATH}`, { method: "GET" }),
    DETAIL_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, KPI_DETAIL_ROUTE);
  assertEquals(trace.order, [
    "authenticate",
    "authorize:kpis.get_by_id",
    "profile:kpis.get_by_id",
    "rateLimit",
    "readKpi",
  ]);
  assertEquals(trace.kpiIds, [KPI_ID]);
  assertEquals(result.payload, kpiItem());
});

Deno.test("KPI-2B: every query parameter is rejected before authentication", async () => {
  for (
    const search of ["?limit=1", "?include_archived=true", "?x=1", "?a"]
  ) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          new Request(`http://localhost${DETAIL_PATH}${search}`, {
            method: "GET",
          }),
          DETAIL_PATH,
          READS_ON,
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", search);
    assertEquals(trace.order, [], search);
  }
});

// ---------------------------------------------------------------------------
// RPC adapter
// ---------------------------------------------------------------------------

function rpcClient(
  impl: (name: string, args: Record<string, unknown>) => unknown,
  calls: Array<{ name: string; args: Record<string, unknown> }> = [],
) {
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(impl(name, args));
    },
  };
}

Deno.test("KPI-2B: the adapter calls exactly api_v1_get_kpi with exact arguments", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(() => ({ data: kpiItem(), error: null }), calls);
  const item = await readApiV1Kpi(client, OAUTH_CLIENT_ID, KPI_ID);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_get_kpi");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _kpi_id: KPI_ID,
  });
  assertEquals(Object.keys(item).sort(), [...KPI_KEYS].sort());
  assertEquals(item.kpiId, KPI_ID);
  assertEquals(item.projectId, PROJECT_ID);
});

Deno.test("KPI-2B: wrapper SQLSTATE mapping is exact", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["P0001", "internal_error"],
  ];
  for (const [code, expected] of cases) {
    const client = rpcClient(() => ({ data: null, error: { code } }));
    const err = await assertRejects(
      () => readApiV1Kpi(client, OAUTH_CLIENT_ID, KPI_ID),
      ApiHttpError,
    );
    assertEquals(err.code, expected, code);
  }
});

Deno.test("KPI-2B: malformed server results fail internal_error", async () => {
  const defects: ReadonlyArray<unknown> = [
    null,
    { data: null, error: null },
    { data: {}, error: null },
    { data: [kpiItem()], error: null },
    { data: { ...kpiItem(), extra: 1 }, error: null },
    (() => {
      const item = { ...kpiItem() } as Record<string, unknown>;
      delete item.unit;
      return { data: item, error: null };
    })(),
    { data: kpiItem(OTHER_KPI_ID), error: null },
    { data: kpiItem(NIL_UUID), error: null },
    { data: { ...kpiItem(), projectId: NIL_UUID }, error: null },
    { data: { ...kpiItem(), createdAt: "not-a-date" }, error: null },
    { data: { ...kpiItem(), commentRequired: "false" }, error: null },
  ];
  for (const defect of defects) {
    const client = rpcClient(() => defect);
    const err = await assertRejects(
      () => readApiV1Kpi(client, OAUTH_CLIENT_ID, KPI_ID),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(defect));
  }
});

Deno.test("KPI-2B: an RPC throw becomes internal_error", async () => {
  const client = {
    rpc: () => Promise.reject(new Error("boom")),
  };
  const err = await assertRejects(
    () => readApiV1Kpi(client, OAUTH_CLIENT_ID, KPI_ID),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("KPI-2B: an invalid requested KPI ID fails invalid_request", async () => {
  for (const bad of ["", NIL_UUID, "not-a-uuid"]) {
    const client = rpcClient(() => ({ data: kpiItem(), error: null }));
    const err = await assertRejects(
      () => readApiV1Kpi(client, OAUTH_CLIENT_ID, bad),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", bad);
  }
});

// ---------------------------------------------------------------------------
// Delegated caller-scoped reader
// ---------------------------------------------------------------------------

Deno.test("KPI-2B: the delegated reader builds a fresh caller-bound anon client", async () => {
  const constructions: Array<
    { url: string; key: string; options: unknown }
  > = [];
  const reader = createDelegatedApiV1KpiReader(
    "https://example.supabase.co",
    "anon-key",
    (url, key, options) => {
      constructions.push({ url, key, options });
      return rpcClient(() => ({ data: kpiItem(), error: null }));
    },
  );

  const request = new Request(`http://localhost${DETAIL_PATH}`, {
    method: "GET",
    headers: { Authorization: "Bearer caller-token" },
  });

  const first = await reader(request, CONTEXT, KPI_ID);
  await reader(request, CONTEXT, KPI_ID);

  assertEquals(first.kpiId, KPI_ID);
  assertEquals(constructions.length, 2);
  for (const c of constructions) {
    assertEquals(c.key, "anon-key");
    assertEquals(c.options, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: "Bearer caller-token" } },
    });
  }
});

Deno.test("KPI-2B: the delegated reader module uses no service role, table or cache", async () => {
  const src = await Deno.readTextFile(
    new URL(
      "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts",
      import.meta.url,
    ),
  );
  for (
    const forbidden of [
      "SERVICE_ROLE",
      "service_role",
      ".from(",
      "fetch(",
      "supabase-js",
    ]
  ) {
    assert(!src.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// MCP reservation only
// ---------------------------------------------------------------------------

// KPI-2B proves only that exactly one registry decision exists for the
// canonical operation and that its immutable identity fields are correct.
// The MCP exposure state itself is owned by the focused KPI-2C test.
Deno.test("KPI-2B: kpis.get_by_id has exactly one MCP registry decision", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (e) => e.operationId === "kpis.get_by_id",
  );
  assertEquals(entries.length, 1);
  assertEquals(entries[0].toolName, "btpm_get_kpi");
  assertEquals(entries[0].operationClass, "read");
  assertEquals(entries[0].resultShape, "single_object");
  assertEquals(entries[0].confirmation, "not_required");
  assertEquals(entries[0].concurrencyToken, "not_applicable");
});

Deno.test("KPI-2B: no competing KPI detail MCP adapter module exists", async () => {
  let missing = false;
  try {
    await Deno.stat(
      new URL("../../btpm-mcp/mcp/kpiDetailReadTool.ts", import.meta.url),
    );
  } catch {
    missing = true;
  }
  assert(missing, "kpiDetailReadTool.ts must not exist");
});

