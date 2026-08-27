// API-M.CP.2C3 — Focused activation tests for the two accepted CP.2C2 Blocker
// reads through the existing protected-read pipeline. Synthetic UUIDs only.
// CP.2C1 SQL containment and the CP.2C2 parser/cursor matrix are NOT retested.

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
  BLOCKER_CREATE_ROUTE,
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  BLOCKER_UPDATE_ROUTE,
  encodeApiV1BlockerCursor,
} from "../routes/blockers.ts";
import { RISK_PROJECT_COLLECTION_ROUTE } from "../routes/risks.ts";
import { PROJECT_DETAIL_ROUTE } from "../routes/projectDetail.ts";
import { PROJECT_PLANNING_ROUTE } from "../routes/projectPlanning.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
const BLOCKER_ID = "99999999-8888-4777-8666-555555555555";
const COLLECTION_PATH = `/v1/projects/${PROJECT_ID}/blockers`;
const DETAIL_PATH = `/v1/blockers/${BLOCKER_ID}`;

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

const BLOCKER_ITEM = Object.freeze({
  blockerId: BLOCKER_ID,
  projectId: PROJECT_ID,
  targetType: "project",
  targetId: PROJECT_ID,
  title: "t",
  description: null,
  severity: "high",
  status: "open",
  resolvedAt: null,
  updatedAt: "2026-08-11T00:00:00.000Z",
  resolvedBy: null,
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

function newTrace(): Trace {
  return {
    authenticateCalls: 0,
    authorizedRouteIds: [],
    rateLimitRouteIds: [],
    collectionCalls: [],
    detailCalls: [],
  };
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
    readProjectBlockers: (_req, _ctx, projectId, limit, cursor) => {
      trace.collectionCalls.push({ projectId, limit, cursor });
      return Promise.resolve(
        Object.freeze({ items: [BLOCKER_ITEM], nextCursor: null }),
      );
    },
    readBlocker: (_req, _ctx, blockerId) => {
      trace.detailCalls.push(blockerId);
      return Promise.resolve(BLOCKER_ITEM);
    },
    ...overrides,
  } as ApiProtectedRouteDependencies;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

// API-N.RG1A — local invariant only. Current global cardinality and absolute
// route positions are owned by api-v1-current-surface-topology.test.ts.
Deno.test("API-M.CP.2C3: both Blocker reads are registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === BLOCKER_PROJECT_COLLECTION_ROUTE)
      .length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === BLOCKER_DETAIL_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "blockers.get").length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "blockers.get_by_id").length,
    1,
  );
});

Deno.test("API-M.CP.2C3: collection GET matches blockers.get", () => {
  assertStrictEquals(
    matchApiRoute("GET", COLLECTION_PATH),
    BLOCKER_PROJECT_COLLECTION_ROUTE,
  );
  assertEquals(BLOCKER_PROJECT_COLLECTION_ROUTE.id, "blockers.get");
  assertEquals(BLOCKER_PROJECT_COLLECTION_ROUTE.operation, "read");
});

Deno.test("API-M.CP.2C3: detail GET matches blockers.get_by_id", () => {
  assertStrictEquals(matchApiRoute("GET", DETAIL_PATH), BLOCKER_DETAIL_ROUTE);
  assertEquals(BLOCKER_DETAIL_ROUTE.id, "blockers.get_by_id");
  assertEquals(BLOCKER_DETAIL_ROUTE.operation, "read");
});

Deno.test("API-M.CP.2C3: Project detail, planning and Risk collection matching is unaffected", () => {
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}`),
    PROJECT_DETAIL_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}/planning`),
    PROJECT_PLANNING_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}/risks`),
    RISK_PROJECT_COLLECTION_ROUTE,
  );
});

Deno.test("API-M.CP.2C3: Blocker mutations remain live and unchanged", () => {
  assertStrictEquals(
    matchApiRoute("POST", "/v1/blockers"),
    BLOCKER_CREATE_ROUTE,
  );
  assertStrictEquals(matchApiRoute("PATCH", DETAIL_PATH), BLOCKER_UPDATE_ROUTE);
  assertEquals(BLOCKER_CREATE_ROUTE.operation, "mutation");
  assertEquals(BLOCKER_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("API-M.CP.2C3: malformed Blocker paths do not become wildcard matches", () => {
  for (
    const bad of [
      `/v1/projects/${PROJECT_ID}/blockers/`,
      `/v1/projects/${PROJECT_ID}/blockers/extra`,
      "/v1/projects//blockers",
      "/v1/projects/not-a-uuid/blockers",
      `/v1/projects/${PROJECT_ID}/Blockers`,
      "/v1/blockers/not-a-uuid",
      `/v1/blockers/${BLOCKER_ID}/`,
      `/v1/blockers/${BLOCKER_ID}/extra`,
    ]
  ) {
    assertEquals(matchApiRoute("GET", bad), null, bad);
  }
});

// API-M.CP.5 superseded the CP.2C3 deferral: the Blocker reads are advertised.
Deno.test("API-M.CP.5: /v1/capabilities advertises the Blocker reads exactly once", () => {
  const ops = buildCapabilitiesPayload()
    .supportedOperations as readonly string[];
  assertEquals(ops.filter((o) => o === "blockers.get").length, 1);
  assertEquals(ops.filter((o) => o === "blockers.get_by_id").length, 1);
});

// ---------------------------------------------------------------------------
// Collection execution
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C3: collection Project ID, limit and cursor reach readProjectBlockers", async () => {
  const trace = newTrace();
  const cursor = encodeApiV1BlockerCursor({
    createdAt: "2026-08-10T00:00:00.000Z",
    id: BLOCKER_ID,
  });
  const result = await executeApiProtectedRoute(
    new Request(
      `http://localhost${COLLECTION_PATH}?limit=25&cursor=${cursor}`,
      { method: "GET" },
    ),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, BLOCKER_PROJECT_COLLECTION_ROUTE);
  assertEquals(trace.collectionCalls.length, 1);
  assertEquals(trace.collectionCalls[0].projectId, PROJECT_ID);
  assertEquals(trace.collectionCalls[0].limit, 25);
  assertEquals(trace.collectionCalls[0].cursor, {
    createdAt: "2026-08-10T00:00:00.000Z",
    id: BLOCKER_ID,
  });
});

Deno.test("API-M.CP.2C3: collection payload passes through unchanged", async () => {
  const trace = newTrace();
  const nextCursor = encodeApiV1BlockerCursor({
    createdAt: "2026-08-09T00:00:00.000Z",
    id: BLOCKER_ID,
  });
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
    COLLECTION_PATH,
    READS_ON,
    buildDeps(trace, {
      readProjectBlockers: () =>
        Promise.resolve(Object.freeze({ items: [BLOCKER_ITEM], nextCursor })),
    }),
  );
  assertEquals(trace.collectionCalls.length, 0);
  assertEquals(Object.keys(result.payload).sort(), ["items", "nextCursor"]);
  assertEquals(result.payload, { items: [BLOCKER_ITEM], nextCursor });
  const serialized = JSON.stringify(result.payload);
  assert(!serialized.includes("nextCursorCreatedAt"));
  assert(!serialized.includes("nextCursorId"));
});

Deno.test("API-M.CP.2C3: collection fails closed when its reader is absent", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${COLLECTION_PATH}`, { method: "GET" }),
        COLLECTION_PATH,
        READS_ON,
        buildDeps(trace, { readProjectBlockers: undefined }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(trace.authenticateCalls, 0);
});

// ---------------------------------------------------------------------------
// Detail execution
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C3: detail Blocker ID reaches readBlocker and the item passes through", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    new Request(`http://localhost${DETAIL_PATH}`, { method: "GET" }),
    DETAIL_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, BLOCKER_DETAIL_ROUTE);
  assertEquals(trace.detailCalls, [BLOCKER_ID]);
  assertEquals(result.payload, BLOCKER_ITEM);
  assertEquals(Object.keys(result.payload).length, 11);
});

Deno.test("API-M.CP.2C3: a query-bearing detail request is rejected before authentication", async () => {
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

Deno.test("API-M.CP.2C3: detail fails closed when its reader is absent", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiProtectedRoute(
        new Request(`http://localhost${DETAIL_PATH}`, { method: "GET" }),
        DETAIL_PATH,
        READS_ON,
        buildDeps(trace, { readBlocker: undefined }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(trace.authenticateCalls, 0);
});

// ---------------------------------------------------------------------------
// Existing protected pipeline
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C3: both routes use authentication, authorization and rate limiting", async () => {
  for (
    const [path, id] of [
      [COLLECTION_PATH, "blockers.get"],
      [DETAIL_PATH, "blockers.get_by_id"],
    ] as const
  ) {
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

Deno.test("API-M.CP.2C3: BTPM_API_READS_ENABLED gates both routes", async () => {
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

Deno.test("API-M.CP.2C3: live runtime builds the Blocker readers with the anon key only", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  for (
    const factory of [
      "createDelegatedApiV1ProjectBlockersReader",
      "createDelegatedApiV1BlockerReader",
    ]
  ) {
    const at = source.indexOf(`${factory}(\n`);
    assert(at > 0, factory);
    const window = source.slice(at, at + 220);
    assert(window.includes("supabaseAnonKey"), factory);
    assert(!window.includes("ServiceRole"), factory);
    assert(!window.includes("service_role"), factory);
    assert(!window.includes("privilegedClient"), factory);
  }
  assert(source.includes("readProjectBlockers,"));
  assert(source.includes("readBlocker,"));
  assert(source.includes("route !== BLOCKER_PROJECT_COLLECTION_ROUTE"));
  assert(source.includes("route !== BLOCKER_DETAIL_ROUTE"));
});
