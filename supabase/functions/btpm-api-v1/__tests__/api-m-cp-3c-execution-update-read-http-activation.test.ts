// API-M.CP.3C — Focused activation tests for the accepted CP.3B Execution
// Update history read through the existing protected-read pipeline.
//
// Activation only. CP.3A SQL containment and the full CP.3B parser/cursor
// matrix are NOT retested here. Synthetic UUIDs only; no environment, network
// or database is touched.

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
  EXECUTION_UPDATES_APPEND_ROUTE,
  EXECUTION_UPDATES_READ_ROUTE,
  encodeApiV1ExecutionUpdateCursor,
} from "../routes/executionUpdates.ts";
import {
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
} from "../routes/blockers.ts";
import {
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
} from "../routes/risks.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";

const READ_PATH = "/v1/execution-updates";
const TARGET_ID = "11111111-2222-4333-8444-555555555555";
const UPDATE_ID = "99999999-8888-4777-8666-555555555555";
const AUTHOR_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "77777777-2222-4333-8444-555555555555";

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

const ITEM = Object.freeze({
  executionUpdateId: UPDATE_ID,
  targetType: "phase",
  targetId: TARGET_ID,
  authorId: AUTHOR_ID,
  summary: "Progress narrative.",
  statusLabel: null,
  updateDate: "2026-08-07",
  createdAt: "2026-08-07T10:00:00.000Z",
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
  readCalls: Array<{
    url: string;
    targetType: string;
    targetId: string;
    limit: number;
    cursor: unknown;
  }>;
}

function newTrace(): Trace {
  return {
    authenticateCalls: 0,
    authorizedRouteIds: [],
    rateLimitRouteIds: [],
    readCalls: [],
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
    readExecutionUpdates: (req, _ctx, targetType, targetId, limit, cursor) => {
      trace.readCalls.push({
        url: req.url,
        targetType,
        targetId,
        limit,
        cursor,
      });
      return Promise.resolve(
        Object.freeze({ items: [ITEM], nextCursor: null }),
      );
    },
    ...overrides,
  } as ApiProtectedRouteDependencies;
}

function readRequest(search: string): Request {
  return new Request(`https://api.example.test${READ_PATH}${search}`, {
    method: "GET",
    headers: new Headers({ Authorization: "Bearer token" }),
  });
}

const VALID_SEARCH = `?targetType=phase&targetId=${TARGET_ID}`;

// ---------------------------------------------------------------------------
// Routing / cardinality
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.3C: GET /v1/execution-updates matches execution_updates.get", () => {
  assertStrictEquals(
    matchApiRoute("GET", READ_PATH),
    EXECUTION_UPDATES_READ_ROUTE,
  );
  assertEquals(EXECUTION_UPDATES_READ_ROUTE.id, "execution_updates.get");
  assertEquals(EXECUTION_UPDATES_READ_ROUTE.operation, "read");
});

Deno.test("API-M.CP.3C: POST /v1/execution-updates still matches execution_updates.append", () => {
  assertStrictEquals(
    matchApiRoute("POST", READ_PATH),
    EXECUTION_UPDATES_APPEND_ROUTE,
  );
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.operation, "mutation");
});

// API-N.RG1A — current global cardinality is owned by
// api-v1-current-surface-topology.test.ts.
Deno.test("API-M.CP.3C: execution_updates.get remains registered exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === EXECUTION_UPDATES_READ_ROUTE)
      .length,
    1,
  );
});

Deno.test("API-M.CP.3C: Risk and Blocker reads remain matched correctly", () => {
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}/risks`),
    RISK_PROJECT_COLLECTION_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/risks/${UPDATE_ID}`),
    RISK_DETAIL_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/projects/${PROJECT_ID}/blockers`),
    BLOCKER_PROJECT_COLLECTION_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("GET", `/v1/blockers/${UPDATE_ID}`),
    BLOCKER_DETAIL_ROUTE,
  );
});

// API-M.CP.5 superseded the CP.3C deferral.
Deno.test("API-M.CP.5: /v1/capabilities advertises execution_updates.get once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "execution_updates.get").length, 1);
  assert(ops.includes("execution_updates.append"));
});

// ---------------------------------------------------------------------------
// Protected execution
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.3C: validated query reaches the delegated reader and the payload passes through", async () => {
  const trace = newTrace();
  const cursor = encodeApiV1ExecutionUpdateCursor({
    createdAt: "2026-08-07T10:00:00.000Z",
    id: UPDATE_ID,
  });
  const result = await executeApiProtectedRoute(
    readRequest(
      `?targetType=task&targetId=${TARGET_ID}&limit=7&cursor=${cursor}`,
    ),
    READ_PATH,
    READS_ON,
    buildDeps(trace),
  );

  assertStrictEquals(result.route, EXECUTION_UPDATES_READ_ROUTE);
  assertEquals(trace.readCalls.length, 1);
  assertEquals(trace.readCalls[0].targetType, "task");
  assertEquals(trace.readCalls[0].targetId, TARGET_ID);
  assertEquals(trace.readCalls[0].limit, 7);
  assertEquals(trace.readCalls[0].cursor, {
    createdAt: "2026-08-07T10:00:00.000Z",
    id: UPDATE_ID,
  });

  assertEquals(result.payload, { items: [ITEM], nextCursor: null });
  const payload = result.payload as unknown as {
    items: Array<Record<string, unknown>>;
  };
  // `authorId` is returned unchanged and never enriched.
  assertEquals(payload.items[0].authorId, AUTHOR_ID);
  assertEquals(Object.keys(payload.items[0]).length, 8);
  // The internal SQL keyset pair never escapes.
  assert(!("nextCursorCreatedAt" in (result.payload as object)));
  assert(!("nextCursorId" in (result.payload as object)));
});

Deno.test("API-M.CP.3C: omitted limit uses the accepted default of 100", async () => {
  const trace = newTrace();
  await executeApiProtectedRoute(
    readRequest(VALID_SEARCH),
    READ_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertEquals(trace.readCalls[0].limit, 100);
  assertEquals(trace.readCalls[0].cursor, null);
});

Deno.test("API-M.CP.3C: pipeline order is runtime gate -> authenticate -> authorize -> rate limit -> reader", async () => {
  const trace = newTrace();
  const order: string[] = [];
  await executeApiProtectedRoute(
    readRequest(VALID_SEARCH),
    READ_PATH,
    READS_ON,
    buildDeps(trace, {
      authenticate: () => {
        order.push("authenticate");
        return Promise.resolve(CONTEXT);
      },
      authorizeRoute: () => {
        order.push("authorize");
        return Promise.resolve();
      },
      resolveRateLimitProfile: () => {
        order.push("rateLimit");
        return Promise.resolve({ limit: 100, windowSeconds: 60 });
      },
      readExecutionUpdates: () => {
        order.push("reader");
        return Promise.resolve(
          Object.freeze({ items: [ITEM], nextCursor: null }),
        );
      },
    }),
  );
  assertEquals(order, ["authenticate", "authorize", "rateLimit", "reader"]);
});

Deno.test("API-M.CP.3C: reads disabled blocks the route before authentication", async () => {
  const trace = newTrace();
  await assertRejects(
    () =>
      executeApiProtectedRoute(
        readRequest(VALID_SEARCH),
        READ_PATH,
        { apiEnabled: true, readsEnabled: false, mutationsEnabled: false },
        buildDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(trace.authenticateCalls, 0);
  assertEquals(trace.readCalls.length, 0);
});

Deno.test("API-M.CP.3C: invalid or missing query fails before authentication", async () => {
  for (
    const search of [
      "",
      "?targetType=phase",
      `?targetId=${TARGET_ID}`,
      `?targetType=project&targetId=${TARGET_ID}`,
      `?targetType=Phase&targetId=${TARGET_ID}`,
      "?targetType=phase&targetId=not-a-uuid",
      `?targetType=phase&targetId=${TARGET_ID}&limit=0`,
      `?targetType=phase&targetId=${TARGET_ID}&limit=501`,
      `?targetType=phase&targetId=${TARGET_ID}&extra=1`,
      `?targetType=phase&targetType=task&targetId=${TARGET_ID}`,
      `?targetType=phase&targetId=${TARGET_ID}&cursor=!!!`,
    ]
  ) {
    const trace = newTrace();
    const error = await assertRejects(
      () =>
        executeApiProtectedRoute(
          readRequest(search),
          READ_PATH,
          READS_ON,
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(error.code, "invalid_request", `search: ${search}`);
    assertEquals(trace.authenticateCalls, 0);
    assertEquals(trace.readCalls.length, 0);
  }
});

Deno.test("API-M.CP.3C: fragment in the request target is rejected before authentication", async () => {
  const trace = newTrace();
  const error = await assertRejects(
    () =>
      executeApiProtectedRoute(
        readRequest(`${VALID_SEARCH}#frag`),
        READ_PATH,
        READS_ON,
        buildDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(error.code, "invalid_request");
  assertEquals(trace.authenticateCalls, 0);
});

Deno.test("API-M.CP.3C: missing or malformed readExecutionUpdates fails closed with internal_error", async () => {
  for (const bad of [undefined, null, {}, "reader", 42]) {
    const trace = newTrace();
    const deps = buildDeps(trace);
    (deps as unknown as Record<string, unknown>).readExecutionUpdates = bad;
    const error = await assertRejects(
      () =>
        executeApiProtectedRoute(
          readRequest(VALID_SEARCH),
          READ_PATH,
          READS_ON,
          deps,
        ),
      ApiHttpError,
    );
    assertEquals(error.code, "internal_error");
    assertEquals(trace.authenticateCalls, 0);
  }
});

Deno.test("API-M.CP.3C: reader failures preserve safe mapping and never become not_found", async () => {
  for (
    const [thrown, expected] of [
      [new ApiHttpError("not_authorized"), "not_authorized"],
      [new ApiHttpError("invalid_request"), "invalid_request"],
      [new Error("boom"), "internal_error"],
    ] as const
  ) {
    const trace = newTrace();
    const error = await assertRejects(
      () =>
        executeApiProtectedRoute(
          readRequest(VALID_SEARCH),
          READ_PATH,
          READS_ON,
          buildDeps(trace, {
            readExecutionUpdates: () => Promise.reject(thrown),
          }),
        ),
      ApiHttpError,
    );
    assertEquals(error.code, expected);
    assert((error.code as string) !== "not_found");
  }
});

// ---------------------------------------------------------------------------
// Handler-level query preservation
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.3C: handler routes the query-bearing GET by exact pathname and preserves the query on the untouched Request", async () => {
  const trace = newTrace();
  const deps = {
    controls: READS_ON,
    allowedOrigins: new Set<string>(["https://app.example.test"]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => "55555555-5555-4555-8555-555555555555" },
    protectedRoute: buildDeps(trace),
  } as unknown as ApiV1HttpHandlerDependencies;

  const response = await handleApiV1Request(
    readRequest(`${VALID_SEARCH}&limit=5`),
    deps,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { items: [ITEM], nextCursor: null });
  assertEquals(trace.readCalls.length, 1);
  // The handler matched by exact pathname, yet the original query string was
  // still present on the untouched Request for strict downstream parsing.
  assert(trace.readCalls[0].url.endsWith(`${VALID_SEARCH}&limit=5`));
  assertEquals(trace.readCalls[0].limit, 5);
  assertEquals(trace.authorizedRouteIds, ["execution_updates.get"]);
  assertEquals(trace.rateLimitRouteIds, ["execution_updates.get"]);
});

Deno.test("API-M.CP.3C: handler POST /v1/execution-updates remains on the append pipeline", async () => {
  let appendCalls = 0;
  const trace = newTrace();
  const deps = {
    controls: {
      apiEnabled: true,
      readsEnabled: true,
      mutationsEnabled: true,
    },
    allowedOrigins: new Set<string>(["https://app.example.test"]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => "55555555-5555-4555-8555-555555555555" },
    protectedRoute: buildDeps(trace),
    appendExecutionUpdateRoute: {
      authenticate: () => {
        appendCalls++;
        return Promise.reject(new ApiHttpError("not_authorized"));
      },
      authorizeRoute: () => Promise.resolve(),
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 100, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () =>
            Promise.resolve({
              allowed: true,
              remaining: 1,
              resetAtEpochMs: 1,
            }),
        },
        now: () => 1,
      },
      appendExecutionUpdate: () =>
        Promise.reject(new ApiHttpError("internal_error")),
    },
  } as unknown as ApiV1HttpHandlerDependencies;

  const response = await handleApiV1Request(
    new Request(`https://api.example.test${READ_PATH}`, {
      method: "POST",
      headers: new Headers({
        Authorization: "Bearer token",
        "Content-Type": "application/json",
        "Idempotency-Key": "11111111-2222-4333-8444-555555555555",
      }),
      body: JSON.stringify({
        targetType: "phase",
        targetId: TARGET_ID,
        summary: "Progress narrative.",
        updateDate: "2026-08-07",
      }),
    }),
    deps,
  );

  // The append pipeline was reached (its own authenticate ran); the read
  // pipeline was not.
  assertEquals(appendCalls, 1);
  assertEquals(trace.readCalls.length, 0);
  assert(response.status >= 400);
});
