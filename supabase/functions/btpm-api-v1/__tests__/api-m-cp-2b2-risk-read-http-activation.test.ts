// API-M.CP.2B2 — Focused activation tests for the two accepted CP.2B1 Risk
// reads through the existing protected-read pipeline. Synthetic UUIDs only.
// SQL containment behaviour is already covered by CP.2A/C1 and is not retested.

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertRejects,
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
  RISK_CREATE_ROUTE,
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  RISK_UPDATE_ROUTE,
  encodeApiV1RiskCursor,
} from "../routes/risks.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "../routes/projectPlanning.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
const RISK_ID = "99999999-8888-4777-8666-555555555555";
const COLLECTION_PATH = `/v1/projects/${PROJECT_ID}/risks`;
const DETAIL_PATH = `/v1/risks/${RISK_ID}`;

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

const RISK_ITEM = Object.freeze({
  riskId: RISK_ID,
  projectId: PROJECT_ID,
  targetType: "project",
  targetId: PROJECT_ID,
  title: "t",
  description: null,
  mitigationPlan: null,
  likelihood: "medium",
  impact: "high",
  status: "open",
  updatedAt: "2026-08-11T00:00:00.000Z",
});

const READS_ON = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

interface Trace {
  authenticateCalls: number;
  authorizedRouteIds: string[];
  rateLimitRouteIds: string[];
  collectionCalls: Array<{
    projectId: string;
    limit: number;
    cursor: unknown;
  }>;
  detailCalls: string[];
}

function buildDeps(
  trace: Trace,
  overrides: Partial<ApiProtectedRouteDependencies> = {},
): ApiProtectedRouteDependencies {
  const failing = () => Promise.reject(new ApiHttpError("internal_error"));
  return {
    authenticate: () => {
      trace.authenticateCalls++;
      return Promise.resolve(CONTEXT);
    },
    authorizeRoute: (_c, route) => {
      trace.authorizedRouteIds.push(route.id);
      return Promise.resolve();
    },
    resolveRateLimitProfile: (_c, route) => {
      trace.rateLimitRouteIds.push(route.id);
      return Promise.resolve({ limit: 100, windowSeconds: 60 });
    },
    rateLimit: {
      store: {
        consume: () =>
          Promise.resolve({
            allowed: true,
            remaining: 9,
            resetAtEpochMs: 1_700_000_000_000,
          }),
      },
      now: () => 1_600_000_000_000,
    },
    readMe: failing,
    readOrganizations: failing,
    readWorkspaces: failing,
    readProjects: failing,
    readProjectDetail: failing,
    readProjectPlanning: failing,
    readProjectRisks: (_req, _ctx, projectId, limit, cursor) => {
      trace.collectionCalls.push({ projectId, limit, cursor });
      return Promise.resolve(
        Object.freeze({ items: [RISK_ITEM], nextCursor: null }),
      );
    },
    readRisk: (_req, _ctx, riskId) => {
      trace.detailCalls.push(riskId);
      return Promise.resolve(RISK_ITEM);
    },
    ...overrides,
  } as ApiProtectedRouteDependencies;
}

function newTrace(): Trace {
  return {
    authenticateCalls: 0,
    authorizedRouteIds: [],
    rateLimitRouteIds: [],
    collectionCalls: [],
    detailCalls: [],
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

// API-N.RG1A — local invariant only. Current global cardinality and absolute
// route positions are owned by api-v1-current-surface-topology.test.ts.
Deno.test("API-M.CP.2B2: both Risk reads are registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === RISK_PROJECT_COLLECTION_ROUTE)
      .length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === RISK_DETAIL_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "risks.get").length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "risks.get_by_id").length,
    1,
  );
});

Deno.test("API-M.CP.2B2: collection and detail GETs match their route IDs", () => {
  assertStrictEquals(
    matchApiRoute("GET", COLLECTION_PATH),
    RISK_PROJECT_COLLECTION_ROUTE,
  );
  assertStrictEquals(matchApiRoute("GET", DETAIL_PATH), RISK_DETAIL_ROUTE);
});

Deno.test("API-M.CP.2B2: Project detail and planning matching is unaffected", () => {
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}`),
    PROJECT_DETAIL_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}/planning`),
    PROJECT_PLANNING_ROUTE,
  );
});

Deno.test("API-M.CP.2B2: Risk mutations remain live and unchanged", () => {
  assertStrictEquals(matchApiRoute("POST", "/v1/risks"), RISK_CREATE_ROUTE);
  assertStrictEquals(matchApiRoute("PATCH", DETAIL_PATH), RISK_UPDATE_ROUTE);
  assertEquals(RISK_CREATE_ROUTE.operation, "mutation");
  assertEquals(RISK_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("API-M.CP.2B2: malformed Risk paths do not become wildcard matches", () => {
  for (
    const bad of [
      `/v1/projects/${PROJECT_ID}/risks/`,
      `/v1/projects/${PROJECT_ID}/risks/extra`,
      "/v1/projects//risks",
      "/v1/projects/not-a-uuid/risks",
      `/v1/projects/${PROJECT_ID}/Risks`,
      "/v1/risks/not-a-uuid",
      `/v1/risks/${RISK_ID}/`,
      `/v1/risks/${RISK_ID}/extra`,
      "/v1/blockers",
    ]
  ) {
    assertEquals(matchApiRoute("GET", bad), null, bad);
  }
});

// API-M.CP.2C3 — the Blocker GET reads are now live; exactly the two accepted
// contracts exist and nothing wider was introduced.
Deno.test("API-M.CP.2B2/API-M.CP.2C3: exactly two Blocker GET routes exist", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter(
      (r) => r.method === "GET" && r.path.includes("blockers"),
    ).map((r) => r.id),
    ["blockers.get", "blockers.get_by_id"],
  );
});

// API-M.CP.5 superseded the CP.2B2 deferral: the Risk reads are now advertised.
Deno.test("API-M.CP.5: /v1/capabilities advertises the Risk reads exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as readonly string[];
  assertEquals(ops.filter((o) => o === "risks.get").length, 1);
  assertEquals(ops.filter((o) => o === "risks.get_by_id").length, 1);
});

// ---------------------------------------------------------------------------
// Collection execution
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2B2: collection default limit reaches the delegated reader", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, RISK_PROJECT_COLLECTION_ROUTE);
  assertEquals(trace.collectionCalls.length, 1);
  assertEquals(trace.collectionCalls[0].projectId, PROJECT_ID);
  assertEquals(trace.collectionCalls[0].limit, 100);
  assertEquals(trace.collectionCalls[0].cursor, null);
  assertEquals(result.payload, { items: [RISK_ITEM], nextCursor: null });
});

Deno.test("API-M.CP.2B2: a valid cursor and limit reach the delegated reader", async () => {
  const trace = newTrace();
  const cursor = encodeApiV1RiskCursor({
    createdAt: "2026-08-10T00:00:00.000Z",
    id: RISK_ID,
  });
  await executeApiProtectedRoute(
    new Request(
      `http://localhost${COLLECTION_PATH}?limit=25&cursor=${cursor}`,
      { method: "GET" },
    ),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertEquals(trace.collectionCalls[0].limit, 25);
  assertEquals(trace.collectionCalls[0].cursor, {
    createdAt: "2026-08-10T00:00:00.000Z",
    id: RISK_ID,
  });
});

Deno.test("API-M.CP.2B2: payload is passed through without the SQL keyset pair", async () => {
  const trace = newTrace();
  const nextCursor = encodeApiV1RiskCursor({
    createdAt: "2026-08-09T00:00:00.000Z",
    id: RISK_ID,
  });
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace, {
      readProjectRisks: () =>
        Promise.resolve(Object.freeze({ items: [RISK_ITEM], nextCursor })),
    }),
  );
  assertEquals(Object.keys(result.payload).sort(), ["items", "nextCursor"]);
  const serialized = JSON.stringify(result.payload);
  assert(!serialized.includes("nextCursorCreatedAt"));
  assert(!serialized.includes("nextCursorId"));
});

Deno.test("API-M.CP.2B2: an invalid query is rejected before authentication", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${COLLECTION_PATH}?limit=0&bogus=1`, {
          method: "GET",
        }),
        COLLECTION_PATH,
        READS_ON,
        buildDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.authenticateCalls, 0);
  assertEquals(trace.collectionCalls.length, 0);
});

Deno.test("API-M.CP.2B2: collection fails closed when its reader is absent", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
        COLLECTION_PATH,
        READS_ON,
        buildDeps(trace, { readProjectRisks: undefined }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(trace.authenticateCalls, 0);
});

// ---------------------------------------------------------------------------
// Detail execution
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2B2: detail Risk ID reaches the reader and the item passes through", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${DETAIL_PATH}`, { method: "GET" }),
    DETAIL_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, RISK_DETAIL_ROUTE);
  assertEquals(trace.detailCalls, [RISK_ID]);
  assertEquals(result.payload, RISK_ITEM);
  assertEquals(Object.keys(result.payload).length, 11);
});

Deno.test("API-M.CP.2B2: a query-bearing detail request is rejected before authentication", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${DETAIL_PATH}?limit=1`, {
          method: "GET",
        }),
        DETAIL_PATH,
        READS_ON,
        buildDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.authenticateCalls, 0);
  assertEquals(trace.detailCalls.length, 0);
});

Deno.test("API-M.CP.2B2: detail fails closed when its reader is absent", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${DETAIL_PATH}`, { method: "GET" }),
        DETAIL_PATH,
        READS_ON,
        buildDeps(trace, { readRisk: undefined }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(trace.authenticateCalls, 0);
});

// ---------------------------------------------------------------------------
// Existing protected pipeline
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2B2: both routes use authentication, authorization and rate limiting", async () => {
  for (const [path, id] of [
    [COLLECTION_PATH, "risks.get"],
    [DETAIL_PATH, "risks.get_by_id"],
  ] as const) {
    const trace = newTrace();
    await executeApiProtectedRoute(
      new Request(`http://localhost${path}`, { method: "GET" }),
      path,
      READS_ON,
      buildDeps(trace),
    );
    assertEquals(trace.authenticateCalls, 1);
    assertEquals(trace.authorizedRouteIds, [id]);
    assertEquals(trace.rateLimitRouteIds, [id]);
  }
});

Deno.test("API-M.CP.2B2: authorization failure and rate-limit denial propagate", async () => {
  const denied = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
        COLLECTION_PATH,
        READS_ON,
        buildDeps(newTrace(), {
          authorizeRoute: () =>
            Promise.reject(new ApiHttpError("not_authorized")),
        }),
      ),
    ApiHttpError,
  );
  assertEquals(denied.code, "not_authorized");

  const limited = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${DETAIL_PATH}`, { method: "GET" }),
        DETAIL_PATH,
        READS_ON,
        buildDeps(newTrace(), {
          rateLimit: {
            store: {
              consume: () =>
                Promise.resolve({
                  allowed: false,
                  remaining: 0,
                  resetAtEpochMs: 1_700_000_000_000,
                }),
            },
            now: () => 1_600_000_000_000,
          },
        }),
      ),
    ApiHttpError,
  );
  assertEquals(limited.code, "rate_limit_exceeded");
});

Deno.test("API-M.CP.2B2: BTPM_API_READS_ENABLED gates both routes", async () => {
  for (const path of [COLLECTION_PATH, DETAIL_PATH]) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiProtectedRoute(
          new Request(`http://localhost${path}`, { method: "GET" }),
          path,
          { apiEnabled: true, readsEnabled: false, mutationsEnabled: true },
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "api_unavailable");
    assertEquals(trace.authenticateCalls, 0);
  }
});

// ---------------------------------------------------------------------------
// Runtime wiring (static evidence)
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2B2: live runtime builds the Risk readers with the anon key only", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  for (
    const factory of [
      "createDelegatedApiV1ProjectRisksReader",
      "createDelegatedApiV1RiskReader",
    ]
  ) {
    const at = source.indexOf(`${factory}(`);
    assert(at > 0, factory);
    const window = source.slice(at, at + 220);
    assert(window.includes("supabaseAnonKey"), factory);
    assert(!window.includes("ServiceRole"), factory);
    assert(!window.includes("service_role"), factory);
    assert(!window.includes("privilegedClient"), factory);
  }
  assert(source.includes("readProjectRisks,"));
  assert(source.includes("readRisk,"));
  assert(source.includes("route !== RISK_PROJECT_COLLECTION_ROUTE"));
  assert(source.includes("route !== RISK_DETAIL_ROUTE"));
});

Deno.test("API-M.CP.2B2: the delegated Risk readers never touch the service role", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../_shared/btpm-api/supabaseDelegatedRiskRead.ts",
      import.meta.url,
    ),
  );
  for (
    const forbidden of [
      "SERVICE_ROLE",
      "service_role",
      "Deno.env",
      "fetch(",
    ]
  ) {
    assert(!source.includes(forbidden), forbidden);
  }
});
