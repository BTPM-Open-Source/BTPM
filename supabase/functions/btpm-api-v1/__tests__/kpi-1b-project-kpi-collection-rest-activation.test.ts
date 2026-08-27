// KPI-1B — Focused activation tests for the single accepted external Project
// KPI collection read through the existing protected-read pipeline.
// Synthetic UUIDs only. SQL containment behaviour is already covered by
// KPI-1A/KPI-1A-C1 and is not retested here.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiProtectedRoute,
  matchApiRoute,
  type ApiProtectedRouteDependencies,
} from "../router.ts";
import {
  KPI_PROJECT_COLLECTION_ROUTE,
  parseApiV1ProjectKpisPath,
  parseApiV1ProjectKpisQuery,
} from "../../_shared/btpm-api/routes/kpis.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { readApiV1ProjectKpis } from "../../_shared/btpm-api/supabaseKpiRead.ts";
import { createDelegatedApiV1ProjectKpisReader } from "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts";
import { MCP_TOOL_REGISTRY } from "../../btpm-mcp/mcp/toolRegistry.ts";

const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const KPI_ID = "99999999-8888-4777-8666-555555555555";
const KPI_ID_2 = "77777777-6666-4555-8444-333333333333";
const COLLECTION_PATH = `/v1/projects/${PROJECT_ID}/kpis`;

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

function kpiItem(kpiId: string, projectId = PROJECT_ID) {
  return Object.freeze({
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
  });
}

const PAYLOAD = Object.freeze({
  items: [kpiItem(KPI_ID)],
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 1, total: 1 }),
});

const READS_ON = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

interface Trace {
  order: string[];
  kpiCalls: Array<{ projectId: string; query: unknown }>;
}

function newTrace(): Trace {
  return { order: [], kpiCalls: [] };
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
    authorizeRoute: (_c, route) => {
      trace.order.push(`authorize:${route.id}`);
      return Promise.resolve();
    },
    resolveRateLimitProfile: (_c, route) => {
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
    readProjectKpis: (_req, _ctx, projectId, query) => {
      trace.order.push("readProjectKpis");
      trace.kpiCalls.push({ projectId, query });
      return Promise.resolve(PAYLOAD);
    },
    ...overrides,
  } as ApiProtectedRouteDependencies;
}

// ---------------------------------------------------------------------------
// Route identity + registration
// ---------------------------------------------------------------------------

Deno.test("KPI-1B: the KPI route contract is exact and frozen", () => {
  assertEquals(KPI_PROJECT_COLLECTION_ROUTE, {
    id: "kpis.get",
    method: "GET",
    path: "/v1/projects/:projectid/kpis",
    operation: "read",
  });
});

Deno.test("KPI-1B: the KPI route is registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === KPI_PROJECT_COLLECTION_ROUTE)
      .length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "kpis.get").length,
    1,
  );
});

Deno.test("KPI-1B: KPI matching precedes generic Project-detail matching", () => {
  assertStrictEquals(
    matchApiRoute("GET", COLLECTION_PATH),
    KPI_PROJECT_COLLECTION_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}`),
    PROJECT_DETAIL_ROUTE,
  );
});

Deno.test("KPI-1B: malformed KPI paths never become wildcard matches", () => {
  for (
    const bad of [
      `${COLLECTION_PATH}/`,
      `${COLLECTION_PATH}/extra`,
      "/v1/projects//kpis",
      "/v1/projects/not-a-uuid/kpis",
      `/v1/projects/${PROJECT_ID}/KPIs`,
      "/v1/projects/00000000-0000-0000-0000-000000000000/kpis",
      "/v1/kpis",
    ]
  ) {
    assertEquals(matchApiRoute("GET", bad), null, bad);
  }
  // KPI-4B has since accepted POST on this exact pathname as the KPI create
  // command; KPI-1B owns only the invariant that the GET read is unaffected.
  assertStrictEquals(
    matchApiRoute("GET", COLLECTION_PATH),
    KPI_PROJECT_COLLECTION_ROUTE,
  );
});

Deno.test("KPI-1B: /v1/capabilities advertises kpis.get exactly once", () => {
  const ops = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(ops.filter((o) => o === "kpis.get").length, 1);
});

Deno.test("KPI-1B: kpis.get has exactly one MCP registry decision", () => {
  // KPI-1C has since accepted MCP exposure for this operation; KPI-1B owns only
  // the invariant that exactly one explicit registry decision exists.
  const entries = MCP_TOOL_REGISTRY.filter(
    (e) => e.operationId === "kpis.get",
  );
  assertEquals(entries.length, 1);
  assertEquals(entries[0].toolName, "btpm_list_project_kpis");
});

// ---------------------------------------------------------------------------
// Strict path parsing
// ---------------------------------------------------------------------------

Deno.test("KPI-1B: valid KPI path yields exactly the Project ID", () => {
  assertEquals(parseApiV1ProjectKpisPath(COLLECTION_PATH), {
    projectId: PROJECT_ID,
  });
});

Deno.test("KPI-1B: invalid KPI paths fail closed as invalid_request", () => {
  for (
    const bad of [
      "",
      "/v1/projects/kpis",
      `${COLLECTION_PATH}/`,
      `${COLLECTION_PATH}/extra`,
      `/v1/projects/${OTHER_PROJECT_ID.toUpperCase()}/kpis`,
      `/v1/projects/${PROJECT_ID};v=1/kpis`,
      `/v1/projects/ ${PROJECT_ID}/kpis`,
      `/v1/projects/${PROJECT_ID} /kpis`,
      `/v1/projects/${PROJECT_ID}%2Fkpis`,
      `/v1/projects/${PROJECT_ID}/kpis?limit=1`,
      `/v1/projects/${PROJECT_ID}/kpis#f`,
      "/v1/projects/00000000-0000-0000-0000-000000000000/kpis",
      `v1/projects/${PROJECT_ID}/kpis`,
    ]
  ) {
    let code: string | null = null;
    try {
      parseApiV1ProjectKpisPath(bad);
    } catch (err) {
      assert(err instanceof ApiHttpError, bad);
      code = err.code;
    }
    assertEquals(code, "invalid_request", bad);
  }
});

// ---------------------------------------------------------------------------
// Strict query parsing
// ---------------------------------------------------------------------------

Deno.test("KPI-1B: query defaults are 50 / 0 / false", () => {
  for (const raw of ["", "?"]) {
    assertEquals(parseApiV1ProjectKpisQuery(raw), {
      limit: 50,
      offset: 0,
      includeArchived: false,
    });
  }
});

Deno.test("KPI-1B: valid query boundaries parse exactly", () => {
  assertEquals(
    parseApiV1ProjectKpisQuery("?limit=1&offset=0&include_archived=false"),
    { limit: 1, offset: 0, includeArchived: false },
  );
  assertEquals(
    parseApiV1ProjectKpisQuery("?limit=100&offset=10000&include_archived=true"),
    { limit: 100, offset: 10000, includeArchived: true },
  );
});

Deno.test("KPI-1B: malformed, duplicated and unknown query input fails closed", () => {
  for (
    const raw of [
      "?limit=0",
      "?limit=101",
      "?offset=10001",
      "?limit=-1",
      "?limit=+1",
      "?limit=1.0",
      "?limit=1e1",
      "?limit=",
      "?offset=",
      "?limit= 1",
      "?limit=1 ",
      "?limit=one",
      "?limit=1&limit=2",
      "?offset=0&offset=1",
      "?include_archived=TRUE",
      "?include_archived=1",
      "?include_archived=",
      "?include_archived=true&include_archived=false",
      "?cursor=abc",
      "?limit=1&unknown=x",
      "?limit=%E0%A4%A",
      "?limit=1#frag",
      "limit=1",
    ]
  ) {
    let code: string | null = null;
    try {
      parseApiV1ProjectKpisQuery(raw);
    } catch (err) {
      assert(err instanceof ApiHttpError, raw);
      code = err.code;
    }
    assertEquals(code, "invalid_request", raw);
  }
});

// ---------------------------------------------------------------------------
// Pipeline ordering
// ---------------------------------------------------------------------------

Deno.test("KPI-1B: protected read order is auth → authorize → profile → rate limit → reader", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, KPI_PROJECT_COLLECTION_ROUTE);
  assertEquals(trace.order, [
    "authenticate",
    "authorize:kpis.get",
    "profile:kpis.get",
    "rateLimit",
    "readProjectKpis",
  ]);
  assertEquals(trace.kpiCalls, [
    {
      projectId: PROJECT_ID,
      query: { limit: 50, offset: 0, includeArchived: false },
    },
  ]);
  assertEquals(result.payload, PAYLOAD);
});

Deno.test("KPI-1B: explicit query values reach the delegated reader", async () => {
  const trace = newTrace();
  await executeApiProtectedRoute(
    new Request(
      `http://localhost${COLLECTION_PATH}?limit=10&offset=20&include_archived=true`,
      { method: "GET" },
    ),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace, {
      readProjectKpis: (_req, _ctx, projectId, query) => {
        trace.kpiCalls.push({ projectId, query });
        return Promise.resolve(
          Object.freeze({
            items: [],
            pagination: { limit: 10, offset: 20, returned: 0, total: 0 },
          }),
        );
      },
    }),
  );
  assertEquals(trace.kpiCalls[0].query, {
    limit: 10,
    offset: 20,
    includeArchived: true,
  });
});

Deno.test("KPI-1B: invalid path or query fails before authentication", async () => {
  for (
    const url of [
      `http://localhost${COLLECTION_PATH}?limit=0`,
      `http://localhost${COLLECTION_PATH}?unknown=1`,
    ]
  ) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          new Request(url, { method: "GET" }),
          COLLECTION_PATH,
          READS_ON,
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(trace.order, []);
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

const QUERY = Object.freeze({
  limit: 50,
  offset: 0,
  includeArchived: false,
});

Deno.test("KPI-1B: the adapter calls exactly one wrapper with exact arguments", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(() => ({ data: PAYLOAD, error: null }), calls);
  const payload = await readApiV1ProjectKpis(
    client,
    OAUTH_CLIENT_ID,
    PROJECT_ID,
    QUERY,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_list_project_kpis");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _project_id: PROJECT_ID,
    _limit: 50,
    _offset: 0,
    _include_archived: false,
  });
  assertEquals(Object.keys(payload).sort(), ["items", "pagination"]);
  assertEquals(Object.keys(payload.items[0]).length, 20);
});

Deno.test("KPI-1B: 42501 maps to not_authorized and 22023 to invalid_request", async () => {
  const denied = rpcClient(() => ({
    data: null,
    error: { code: "42501", message: "x" },
  }));
  const notAuthorized = await assertRejects(
    () => readApiV1ProjectKpis(denied, OAUTH_CLIENT_ID, PROJECT_ID, QUERY),
    ApiHttpError,
  );
  assertEquals(notAuthorized.code, "not_authorized");

  const bad = rpcClient(() => ({
    data: null,
    error: { code: "22023", message: "x" },
  }));
  const invalid = await assertRejects(
    () => readApiV1ProjectKpis(bad, OAUTH_CLIENT_ID, PROJECT_ID, QUERY),
    ApiHttpError,
  );
  assertEquals(invalid.code, "invalid_request");

  const other = rpcClient(() => ({
    data: null,
    error: { code: "23505", message: "x" },
  }));
  const internal = await assertRejects(
    () => readApiV1ProjectKpis(other, OAUTH_CLIENT_ID, PROJECT_ID, QUERY),
    ApiHttpError,
  );
  assertEquals(internal.code, "internal_error");
});

Deno.test("KPI-1B: database-output contract violations are internal_error", async () => {
  const malformed: ReadonlyArray<unknown> = [
    // Foreign Project ID.
    {
      items: [kpiItem(KPI_ID, OTHER_PROJECT_ID)],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    // Duplicate KPI ID.
    {
      items: [kpiItem(KPI_ID), kpiItem(KPI_ID)],
      pagination: { limit: 50, offset: 0, returned: 2, total: 2 },
    },
    // Pagination not correlated to the request.
    {
      items: [],
      pagination: { limit: 25, offset: 0, returned: 0, total: 0 },
    },
    {
      items: [],
      pagination: { limit: 50, offset: 5, returned: 0, total: 0 },
    },
    // returned !== items.length
    {
      items: [kpiItem(KPI_ID)],
      pagination: { limit: 50, offset: 0, returned: 2, total: 2 },
    },
    // total < returned
    {
      items: [kpiItem(KPI_ID)],
      pagination: { limit: 50, offset: 0, returned: 1, total: 0 },
    },
    // Malformed field type.
    {
      items: [{ ...kpiItem(KPI_ID), commentRequired: "no" }],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    // Unexpected key.
    {
      items: [{ ...kpiItem(KPI_ID), extra: 1 }],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    // Non-UUID KPI ID.
    {
      items: [{ ...kpiItem(KPI_ID), kpiId: "not-a-uuid" }],
      pagination: { limit: 50, offset: 0, returned: 1, total: 1 },
    },
    // Unexpected root key.
    {
      items: [],
      pagination: { limit: 50, offset: 0, returned: 0, total: 0 },
      nextCursor: null,
    },
    null,
    [],
  ];
  for (const data of malformed) {
    const client = rpcClient(() => ({ data, error: null }));
    const err = await assertRejects(
      () => readApiV1ProjectKpis(client, OAUTH_CLIENT_ID, PROJECT_ID, QUERY),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

Deno.test("KPI-1B: an empty accepted page is valid", async () => {
  const client = rpcClient(() => ({
    data: {
      items: [],
      pagination: { limit: 50, offset: 0, returned: 0, total: 0 },
    },
    error: null,
  }));
  const payload = await readApiV1ProjectKpis(
    client,
    OAUTH_CLIENT_ID,
    PROJECT_ID,
    QUERY,
  );
  assertEquals(payload, {
    items: [],
    pagination: { limit: 50, offset: 0, returned: 0, total: 0 },
  });
});

Deno.test("KPI-1B: multiple distinct KPIs of the same Project are accepted", async () => {
  const client = rpcClient(() => ({
    data: {
      items: [kpiItem(KPI_ID), kpiItem(KPI_ID_2)],
      pagination: { limit: 50, offset: 0, returned: 2, total: 2 },
    },
    error: null,
  }));
  const payload = await readApiV1ProjectKpis(
    client,
    OAUTH_CLIENT_ID,
    PROJECT_ID,
    QUERY,
  );
  assertEquals(payload.items.map((i) => i.kpiId), [KPI_ID, KPI_ID_2]);
});

// ---------------------------------------------------------------------------
// Caller-scoped delegated reader
// ---------------------------------------------------------------------------

Deno.test("KPI-1B: the delegated reader binds the caller bearer to a fresh anon-key client", async () => {
  const constructions: Array<
    { url: string; key: string; options: unknown }
  > = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const reader = createDelegatedApiV1ProjectKpisReader(
    "https://project.supabase.co",
    "anon-key-value",
    (url, key, options) => {
      constructions.push({ url, key, options });
      return rpcClient(() => ({ data: PAYLOAD, error: null }), rpcCalls);
    },
  );

  const request = new Request(`http://localhost${COLLECTION_PATH}`, {
    method: "GET",
    headers: { Authorization: "Bearer caller-token-123" },
  });
  await reader(request, CONTEXT, PROJECT_ID, QUERY);
  await reader(request, CONTEXT, PROJECT_ID, QUERY);

  // Fresh client per invocation; never reused or cached.
  assertEquals(constructions.length, 2);
  for (const c of constructions) {
    assertEquals(c.url, "https://project.supabase.co");
    assertEquals(c.key, "anon-key-value");
    assertEquals(c.options, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: "Bearer caller-token-123" } },
    });
    // No service-role key is used for the KPI business read.
    assert(!JSON.stringify(c).includes("service_role"));
  }
  assertEquals(rpcCalls.map((c) => c.name), [
    "api_v1_list_project_kpis",
    "api_v1_list_project_kpis",
  ]);
  assertEquals(rpcCalls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
});

Deno.test("KPI-1B: the delegated reader modules contain no service role or env access", async () => {
  for (
    const path of [
      "../../_shared/btpm-api/supabaseKpiRead.ts",
      "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts",
      "../../_shared/btpm-api/routes/kpis.ts",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    for (
      const forbidden of [
        "SERVICE_ROLE",
        "service_role",
        "Deno.env",
        "@supabase/supabase-js",
        "fetch(",
        "btpm_decrypt",
        ".from(",
      ]
    ) {
      assert(!source.includes(forbidden), `${path} must not contain ${forbidden}`);
    }
  }
});
