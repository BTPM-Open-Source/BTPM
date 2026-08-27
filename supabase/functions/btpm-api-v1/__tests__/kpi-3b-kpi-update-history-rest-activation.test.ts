// KPI-3B — Focused activation tests for the single accepted external KPI
// update-history read `GET /v1/kpis/:kpiid/updates` through the existing
// protected-read pipeline. Synthetic UUIDs only. SQL authorization,
// containment and decryption behaviour is owned by KPI-3A and is not retested
// here.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type { ApiRouteDefinition } from "../router.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiProtectedRoute,
  matchApiRoute,
  type ApiProtectedRouteDependencies,
} from "../router.ts";
import {
  decodeApiV1KpiUpdateCursor,
  encodeApiV1KpiUpdateCursor,
  KPI_DETAIL_ROUTE,
  KPI_PROJECT_COLLECTION_ROUTE,
  KPI_UPDATES_ROUTE,
  parseApiV1KpiUpdatesPath,
  parseApiV1KpiUpdatesQuery,
  type ApiV1KpiUpdateCursor,
  type ApiV1KpiUpdatesRouteQuery,
} from "../../_shared/btpm-api/routes/kpis.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { readApiV1KpiUpdates } from "../../_shared/btpm-api/supabaseKpiRead.ts";
import { createDelegatedApiV1KpiUpdatesReader } from "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts";
import { MCP_TOOL_REGISTRY } from "../../btpm-mcp/mcp/toolRegistry.ts";

const KPI_ID = "99999999-8888-4777-8666-555555555555";
const OTHER_KPI_ID = "7a7a7a7a-6b6b-4c5c-8d4d-3e3e3e3e3e3e";
const UPDATE_ID = "44444444-5555-4666-8777-888888888888";
const OTHER_UPDATE_ID = "12121212-3434-4565-8787-909090909090";
const AUTHOR_ID = "abababab-cdcd-4efe-8121-343434343434";
const UPDATES_PATH = `/v1/kpis/${KPI_ID}/updates`;
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

const ITEM_KEYS: readonly string[] = Object.freeze([
  "kpiUpdateId",
  "kpiId",
  "value",
  "updateDate",
  "note",
  "authorId",
  "createdAt",
]);

const CURSOR: ApiV1KpiUpdateCursor = Object.freeze({
  updateDate: "2026-08-07",
  createdAt: "2026-08-07T10:11:12.000Z",
  id: UPDATE_ID,
});

function updateItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kpiUpdateId: UPDATE_ID,
    kpiId: KPI_ID,
    value: 92.5,
    updateDate: "2026-08-07",
    note: "Recovered after supplier fix.",
    authorId: AUTHOR_ID,
    createdAt: "2026-08-07T10:11:12.000Z",
    ...overrides,
  };
}

function envelope(
  items: ReadonlyArray<Record<string, unknown>>,
  cursor: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    items,
    nextCursorUpdateDate: null,
    nextCursorCreatedAt: null,
    nextCursorId: null,
    ...cursor,
  };
}

const READS_ON = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

interface Trace {
  order: string[];
  kpiIds: string[];
  queries: ApiV1KpiUpdatesRouteQuery[];
}

function newTrace(): Trace {
  return { order: [], kpiIds: [], queries: [] };
}

function buildDeps(trace: Trace): ApiProtectedRouteDependencies {
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
    readKpi: failing,
    readProjectKpis: failing,
    readKpiUpdates: (
      _req: Request,
      _ctx: AuthenticatedApiContext,
      kpiId: string,
      query: ApiV1KpiUpdatesRouteQuery,
    ) => {
      trace.order.push("readKpiUpdates");
      trace.kpiIds.push(kpiId);
      trace.queries.push(query);
      return Promise.resolve(
        Object.freeze({ items: Object.freeze([]), nextCursor: null }),
      );
    },
  } as unknown as ApiProtectedRouteDependencies;
}

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

const DEFAULT_QUERY: ApiV1KpiUpdatesRouteQuery = Object.freeze({
  limit: 50,
  cursor: null,
});

// ---------------------------------------------------------------------------
// 1. Route identity + registration + capabilities + topology
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: the route contract is exact and frozen", () => {
  assertEquals(KPI_UPDATES_ROUTE, {
    id: "kpis.updates.get",
    method: "GET",
    path: "/v1/kpis/:kpiid/updates",
    operation: "read",
  });
  assert(Object.isFrozen(KPI_UPDATES_ROUTE));
});

Deno.test("KPI-3B: the route is registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === KPI_UPDATES_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "kpis.updates.get").length,
    1,
  );
});

Deno.test("KPI-3B: the accepted KPI update-history read is registered once", () => {
  // Global cardinality is owned solely by the central topology guard
  // (`api-v1-current-surface-topology.test.ts`); this step asserts only its own
  // read registration.
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "kpis.updates.get").length,
    1,
  );
});

Deno.test("KPI-3B: capabilities advertises kpis.updates.get exactly once", () => {
  const ops = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(ops.filter((o) => o === "kpis.updates.get").length, 1);
  // Accepted KPI reads remain advertised exactly once each.
  assertEquals(ops.filter((o) => o === "kpis.get").length, 1);
  assertEquals(ops.filter((o) => o === "kpis.get_by_id").length, 1);
});

Deno.test("KPI-3B: accepted KPI route contracts are unchanged", () => {
  assertEquals(KPI_PROJECT_COLLECTION_ROUTE, {
    id: "kpis.get",
    method: "GET",
    path: "/v1/projects/:projectid/kpis",
    operation: "read",
  });
  assertEquals(KPI_DETAIL_ROUTE, {
    id: "kpis.get_by_id",
    method: "GET",
    path: "/v1/kpis/:kpiid",
    operation: "read",
  });
});

Deno.test("KPI-3B: the live authorization whitelist admits the route exactly once", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals((src.match(/route !== KPI_UPDATES_ROUTE/g) ?? []).length, 1);
  assert(src.includes("createDelegatedApiV1KpiUpdatesReader"));
  assert(!src.includes("API_V1_ROUTE_ALLOWLIST.includes("));
});

// ---------------------------------------------------------------------------
// 2-3. Strict path parsing + matching
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: valid history path yields exactly the KPI ID", () => {
  assertEquals(parseApiV1KpiUpdatesPath(UPDATES_PATH), { kpiId: KPI_ID });
  assertStrictEquals(matchApiRoute("GET", UPDATES_PATH), KPI_UPDATES_ROUTE);
});

Deno.test("KPI-3B: invalid history paths fail closed as invalid_request", () => {
  for (
    const bad of [
      "",
      "/v1/kpis",
      "/v1/kpis/updates",
      `/v1/kpis/${KPI_ID}`,
      `${UPDATES_PATH}/`,
      `${UPDATES_PATH}/extra`,
      `/v1/kpis/${NIL_UUID}/updates`,
      `/v1/kpis/${OTHER_KPI_ID.toUpperCase()}/updates`,
      `/v1/kpis/${KPI_ID};v=1/updates`,
      `/v1/kpis/ ${KPI_ID}/updates`,
      `/v1/kpis/${KPI_ID} /updates`,
      `/v1/kpis/${KPI_ID}%2F/updates`,
      `/v1/kpis/${KPI_ID}/updates?x=1`,
      `/v1/kpis/${KPI_ID}/updates#f`,
      `/v1/kpis/${KPI_ID}\\x/updates`,
      "/v1/kpis/not-a-uuid/updates",
      `v1/kpis/${KPI_ID}/updates`,
      `/v1/kpis/${KPI_ID}/Updates`,
    ]
  ) {
    let code: string | null = null;
    try {
      parseApiV1KpiUpdatesPath(bad);
    } catch (err) {
      assert(err instanceof ApiHttpError, bad);
      code = err.code;
    }
    assertEquals(code, "invalid_request", bad);
  }
  // KPI-6B: POST on this path is now the accepted append command, so KPI-3B
  // only guards that no other method reaches the read surface.
  assertEquals(matchApiRoute("PATCH", UPDATES_PATH), null);
  assertEquals(matchApiRoute("PUT", UPDATES_PATH), null);
});

Deno.test("KPI-3B: the history path never falls through to the KPI detail route", () => {
  assertStrictEquals(matchApiRoute("GET", UPDATES_PATH), KPI_UPDATES_ROUTE);
  assertStrictEquals(
    matchApiRoute("GET", `/v1/kpis/${KPI_ID}`),
    KPI_DETAIL_ROUTE,
  );
});

// ---------------------------------------------------------------------------
// 4-6. Strict query contract
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: query defaults are limit 50 and null cursor", () => {
  assertEquals(parseApiV1KpiUpdatesQuery(""), { limit: 50, cursor: null });
  assertEquals(parseApiV1KpiUpdatesQuery("?limit=25"), {
    limit: 25,
    cursor: null,
  });
  assertEquals(parseApiV1KpiUpdatesQuery("?limit=1").limit, 1);
  assertEquals(parseApiV1KpiUpdatesQuery("?limit=100").limit, 100);
});

Deno.test("KPI-3B: cursor-bearing queries decode the opaque cursor", () => {
  const encoded = encodeApiV1KpiUpdateCursor(CURSOR);
  assertEquals(parseApiV1KpiUpdatesQuery(`?cursor=${encoded}`), {
    limit: 50,
    cursor: CURSOR,
  });
  assertEquals(parseApiV1KpiUpdatesQuery(`?limit=25&cursor=${encoded}`), {
    limit: 25,
    cursor: CURSOR,
  });
});

Deno.test("KPI-3B: unknown, duplicate and malformed queries are rejected", () => {
  const encoded = encodeApiV1KpiUpdateCursor(CURSOR);
  for (
    const bad of [
      "?",
      "limit=1",
      "?offset=0",
      "?include_archived=true",
      "?x=1",
      "?limit=1&limit=2",
      `?cursor=${encoded}&cursor=${encoded}`,
      "?limit=",
      "?cursor=",
      "?limit=+1",
      "?limit=-1",
      "?limit=1.0",
      "?limit=1e1",
      "?limit= 1",
      "?limit=1 ",
      "?limit=0",
      "?limit=101",
      "?limit=one",
      "?limit=1#frag",
      "?limit=%zz",
      "?cursor=not-a-cursor",
    ]
  ) {
    const err = (() => {
      try {
        parseApiV1KpiUpdatesQuery(bad);
        return null;
      } catch (e) {
        return e;
      }
    })();
    assert(err instanceof ApiHttpError, bad);
    assertEquals(err.code, "invalid_request", bad);
  }
});

// ---------------------------------------------------------------------------
// 7-9. Opaque cursor
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: cursor round trips and stays base64url-bounded", () => {
  const encoded = encodeApiV1KpiUpdateCursor(CURSOR);
  assert(/^[A-Za-z0-9_-]+$/.test(encoded));
  assert(encoded.length <= 512);
  assertEquals(decodeApiV1KpiUpdateCursor(encoded), CURSOR);
});

Deno.test("KPI-3B: the cursor carries only version + the three keyset values", () => {
  const encoded = encodeApiV1KpiUpdateCursor(CURSOR);
  const json = atob(
    encoded.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (encoded.length % 4)) % 4),
  );
  const decoded = JSON.parse(json) as Record<string, unknown>;
  assertEquals(Object.keys(decoded).sort(), [
    "createdAt",
    "id",
    "updateDate",
    "v",
  ]);
  assertEquals(decoded.v, 1);
  for (
    const forbidden of [
      "tenant",
      "organization",
      "workspace",
      "project",
      "kpi",
      "user",
      "client",
      "capability",
      "oauth",
    ]
  ) {
    assert(!json.toLowerCase().includes(forbidden), forbidden);
  }
});

Deno.test("KPI-3B: malformed cursors decode as invalid_request", () => {
  const encode = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
      /=+$/,
      "",
    );
  };
  const bad: ReadonlyArray<string> = [
    "",
    "!!!",
    "a".repeat(513),
    encode({ v: 2, ...CURSOR }),
    encode({ v: 1, updateDate: CURSOR.updateDate, id: CURSOR.id }),
    encode({ v: 1, ...CURSOR, extra: 1 }),
    encode({ v: 1, ...CURSOR, updateDate: "2026-02-30" }),
    encode({ v: 1, ...CURSOR, updateDate: "2026-8-7" }),
    encode({ v: 1, ...CURSOR, createdAt: "not-a-timestamp" }),
    encode({ v: 1, ...CURSOR, id: NIL_UUID }),
    encode({ v: 1, ...CURSOR, id: "not-a-uuid" }),
    encode([CURSOR]),
    encode("cursor"),
  ];
  for (const raw of bad) {
    const err = (() => {
      try {
        decodeApiV1KpiUpdateCursor(raw);
        return null;
      } catch (e) {
        return e;
      }
    })();
    assert(err instanceof ApiHttpError, raw);
    assertEquals(err.code, "invalid_request", raw);
  }
});

Deno.test("KPI-3B: malformed internal cursor data is internal_error when encoding", () => {
  for (
    const bad of [
      null,
      { ...CURSOR, updateDate: "2026-02-30" },
      { ...CURSOR, createdAt: "nope" },
      { ...CURSOR, id: NIL_UUID },
    ]
  ) {
    const err = (() => {
      try {
        encodeApiV1KpiUpdateCursor(bad as ApiV1KpiUpdateCursor);
        return null;
      } catch (e) {
        return e;
      }
    })();
    assert(err instanceof ApiHttpError, JSON.stringify(bad));
    assertEquals(err.code, "internal_error");
  }
});

// ---------------------------------------------------------------------------
// 13-15. Pipeline ordering
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: order is auth → authorize → profile → rate limit → reader", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${UPDATES_PATH}?limit=25`, { method: "GET" }),
    UPDATES_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, KPI_UPDATES_ROUTE);
  assertEquals(trace.order, [
    "authenticate",
    "authorize:kpis.updates.get",
    "profile:kpis.updates.get",
    "rateLimit",
    "readKpiUpdates",
  ]);
  assertEquals(trace.kpiIds, [KPI_ID]);
  assertEquals(trace.queries, [{ limit: 25, cursor: null }]);
  assertEquals(result.payload, { items: [], nextCursor: null });
});

Deno.test("KPI-3B: invalid query/path is rejected before authentication", async () => {
  for (const search of ["?x=1", "?limit=0", "?cursor=nope", "?limit=1&limit=2"]) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          new Request(`http://localhost${UPDATES_PATH}${search}`, {
            method: "GET",
          }),
          UPDATES_PATH,
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
// 16-19. RPC adapter contract
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: the adapter calls exactly api_v1_list_kpi_updates with six args", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(
    () => ({ data: envelope([updateItem()]), error: null }),
    calls,
  );
  const payload = await readApiV1KpiUpdates(
    client,
    OAUTH_CLIENT_ID,
    KPI_ID,
    DEFAULT_QUERY,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_list_kpi_updates");
  assertEquals(Object.keys(calls[0].args).length, 6);
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _kpi_id: KPI_ID,
    _limit: 50,
    _after_update_date: null,
    _after_created_at: null,
    _after_id: null,
  });
  assertEquals(payload.items.length, 1);
  assertEquals(Object.keys(payload.items[0]).sort(), [...ITEM_KEYS].sort());
  assertEquals(payload.nextCursor, null);
});

Deno.test("KPI-3B: a decoded cursor maps exactly to the three SQL cursor values", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(() => ({ data: envelope([]), error: null }), calls);
  await readApiV1KpiUpdates(client, OAUTH_CLIENT_ID, KPI_ID, {
    limit: 10,
    cursor: CURSOR,
  });
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _kpi_id: KPI_ID,
    _limit: 10,
    _after_update_date: CURSOR.updateDate,
    _after_created_at: CURSOR.createdAt,
    _after_id: CURSOR.id,
  });
});

Deno.test("KPI-3B: wrapper SQLSTATE mapping is exact", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["P0001", "internal_error"],
    ["23505", "internal_error"],
  ];
  for (const [code, expected] of cases) {
    const client = rpcClient(() => ({ data: null, error: { code } }));
    const err = await assertRejects(
      () =>
        readApiV1KpiUpdates(client, OAUTH_CLIENT_ID, KPI_ID, DEFAULT_QUERY),
      ApiHttpError,
    );
    assertEquals(err.code, expected, code);
  }
});

Deno.test("KPI-3B: malformed server results fail internal_error", async () => {
  const defects: ReadonlyArray<unknown> = [
    null,
    { data: null, error: null },
    { data: {}, error: null },
    { data: envelope([]), error: undefined },
    { data: { ...envelope([]), extra: 1 }, error: null },
    (() => {
      const env = envelope([]) as Record<string, unknown>;
      delete env.nextCursorId;
      return { data: env, error: null };
    })(),
    { data: { ...envelope([]), items: {} }, error: null },
    { data: envelope([updateItem({ kpiId: OTHER_KPI_ID })]), error: null },
    { data: envelope([updateItem({ kpiUpdateId: NIL_UUID })]), error: null },
    { data: envelope([updateItem({ value: "92.5" })]), error: null },
    { data: envelope([updateItem({ value: Number.NaN })]), error: null },
    { data: envelope([updateItem({ updateDate: "2026-02-30" })]), error: null },
    { data: envelope([updateItem({ note: 1 })]), error: null },
    { data: envelope([updateItem({ authorId: "nope" })]), error: null },
    { data: envelope([updateItem({ createdAt: "nope" })]), error: null },
    { data: envelope([{ ...updateItem(), extra: 1 }]), error: null },
    (() => {
      const item = updateItem();
      delete item.note;
      return { data: envelope([item]), error: null };
    })(),
    // duplicate kpiUpdateId
    { data: envelope([updateItem(), updateItem()]), error: null },
    // partial server cursor triples
    {
      data: envelope([], { nextCursorUpdateDate: CURSOR.updateDate }),
      error: null,
    },
    {
      data: envelope([], {
        nextCursorUpdateDate: CURSOR.updateDate,
        nextCursorCreatedAt: CURSOR.createdAt,
      }),
      error: null,
    },
    // malformed full server cursor
    {
      data: envelope([], {
        nextCursorUpdateDate: "2026-02-30",
        nextCursorCreatedAt: CURSOR.createdAt,
        nextCursorId: CURSOR.id,
      }),
      error: null,
    },
    {
      data: envelope([], {
        nextCursorUpdateDate: CURSOR.updateDate,
        nextCursorCreatedAt: "nope",
        nextCursorId: CURSOR.id,
      }),
      error: null,
    },
    {
      data: envelope([], {
        nextCursorUpdateDate: CURSOR.updateDate,
        nextCursorCreatedAt: CURSOR.createdAt,
        nextCursorId: NIL_UUID,
      }),
      error: null,
    },
  ];
  for (const defect of defects) {
    const client = rpcClient(() => defect);
    const err = await assertRejects(
      () =>
        readApiV1KpiUpdates(client, OAUTH_CLIENT_ID, KPI_ID, DEFAULT_QUERY),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(defect));
  }
});

Deno.test("KPI-3B: a full server cursor becomes an opaque nextCursor only", async () => {
  const client = rpcClient(() => ({
    data: envelope([updateItem(), updateItem({ kpiUpdateId: OTHER_UPDATE_ID })], {
      nextCursorUpdateDate: CURSOR.updateDate,
      nextCursorCreatedAt: CURSOR.createdAt,
      nextCursorId: CURSOR.id,
    }),
    error: null,
  }));
  const payload = await readApiV1KpiUpdates(
    client,
    OAUTH_CLIENT_ID,
    KPI_ID,
    DEFAULT_QUERY,
  );
  assertEquals(Object.keys(payload).sort(), ["items", "nextCursor"]);
  assertEquals(payload.nextCursor, encodeApiV1KpiUpdateCursor(CURSOR));
  assertEquals(
    decodeApiV1KpiUpdateCursor(payload.nextCursor as string),
    CURSOR,
  );
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes("nextCursorUpdateDate"));
  assert(!serialized.includes("nextCursorCreatedAt"));
  assert(!serialized.includes("nextCursorId"));
});

Deno.test("KPI-3B: an invalid requested KPI ID fails invalid_request", async () => {
  for (const bad of ["", NIL_UUID, "not-a-uuid"]) {
    const client = rpcClient(() => ({ data: envelope([]), error: null }));
    const err = await assertRejects(
      () => readApiV1KpiUpdates(client, OAUTH_CLIENT_ID, bad, DEFAULT_QUERY),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request", bad);
  }
});

// ---------------------------------------------------------------------------
// 29-30. Delegated caller-scoped reader
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: the delegated reader builds a fresh caller-bound anon client", async () => {
  const constructions: Array<{ url: string; key: string; options: unknown }> =
    [];
  const reader = createDelegatedApiV1KpiUpdatesReader(
    "https://example.supabase.co",
    "anon-key",
    (url, key, options) => {
      constructions.push({ url, key, options });
      return rpcClient(() => ({
        data: envelope([updateItem()]),
        error: null,
      }));
    },
  );

  const request = new Request(`http://localhost${UPDATES_PATH}`, {
    method: "GET",
    headers: { Authorization: "Bearer caller-token" },
  });

  const first = await reader(request, CONTEXT, KPI_ID, DEFAULT_QUERY);
  await reader(request, CONTEXT, KPI_ID, DEFAULT_QUERY);

  assertEquals(first.items.length, 1);
  assertEquals(constructions.length, 2);
  for (const c of constructions) {
    assertEquals(c.url, "https://example.supabase.co");
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

Deno.test("KPI-3B: the KPI read modules use no service role, table, cache or fetch", async () => {
  for (
    const path of [
      "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts",
      "../../_shared/btpm-api/supabaseKpiRead.ts",
    ]
  ) {
    const src = await Deno.readTextFile(new URL(path, import.meta.url));
    for (
      const forbidden of [
        "SERVICE_ROLE",
        "service_role",
        ".from(",
        "fetch(",
        "supabase-js",
        "execute_sql",
      ]
    ) {
      assert(!src.includes(forbidden), `${path}: ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 32-34. MCP reservation only
// ---------------------------------------------------------------------------

Deno.test("KPI-3B: the MCP registry carries exactly one btpm_list_kpi_updates decision", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (e) => e.operationId === "kpis.updates.get",
  );
  assertEquals(entries.length, 1);
  assertEquals(entries[0].toolName, "btpm_list_kpi_updates");
  assertEquals(entries[0].title, "List BTPM KPI Updates");
  assertEquals(entries[0].operationClass, "read");
  assertEquals(entries[0].confirmation, "not_required");
  assertEquals(entries[0].resultShape, "bounded_collection");
  assertEquals(entries[0].concurrencyToken, "not_applicable");
  assertEquals(
    MCP_TOOL_REGISTRY.filter((e) => e.toolName === "btpm_list_kpi_updates")
      .length,
    1,
  );
});

Deno.test("KPI-3B: accepted KPI MCP exposure decisions are unchanged", () => {
  const byOperation = (id: string) =>
    MCP_TOOL_REGISTRY.filter((e) => e.operationId === id);
  assertEquals(byOperation("kpis.get").length, 1);
  assertEquals(byOperation("kpis.get")[0].exposure, "exposed");
  assertEquals(byOperation("kpis.get_by_id").length, 1);
  assertEquals(byOperation("kpis.get_by_id")[0].exposure, "exposed");
});

// KPI-3C owns the `exposed` assertion and the serverFactory / btpm-mcp runtime
// implementation. KPI-3B retains only the durable no-competing-module proof.
Deno.test("KPI-3B: no competing kpiUpdatesReadTool.ts module exists", async () => {
  let missing = false;
  try {
    await Deno.stat(
      new URL("../../btpm-mcp/mcp/kpiUpdatesReadTool.ts", import.meta.url),
    );
  } catch {
    missing = true;
  }
  assert(missing, "kpiUpdatesReadTool.ts must not exist");
});
