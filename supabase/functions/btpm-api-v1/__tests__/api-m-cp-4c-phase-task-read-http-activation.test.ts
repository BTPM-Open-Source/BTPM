// API-M.CP.4C — Focused activation tests for the accepted CP.4B Phase and Task
// detail reads through the existing protected-read pipeline.
//
// Activation only. CP.4A SQL containment and the full CP.4B parser/adapter
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
  PHASE_DETAIL_ROUTE,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
  PHASE_UPDATE_ROUTE,
} from "../routes/phases.ts";
import {
  TASK_ASSIGN_ROUTE,
  TASK_DETAIL_ROUTE,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
  TASK_TRANSITION_ROUTE,
  TASK_UPDATE_ROUTE,
} from "../routes/tasks.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";

const PHASE_ID = "11111111-2222-4333-8444-555555555555";
const TASK_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const PROJECT_ID = "77777777-2222-4333-8444-555555555555";

const PHASE_PATH = `/v1/phases/${PHASE_ID}`;
const TASK_PATH = `/v1/tasks/${TASK_ID}`;

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

const PHASE_ITEM = Object.freeze({
  phaseId: PHASE_ID,
  projectId: PROJECT_ID,
  name: "Realize",
  description: null,
  status: "in_progress",
  phaseType: "standard",
  sortOrder: 3,
  startDate: "2026-02-01",
  targetEndDate: "2026-03-01",
  baselineStartDate: null,
  baselineEndDate: null,
  addedAfterBaseline: false,
  actualStartDate: null,
  actualEndDate: null,
  updatedAt: "2026-08-07T10:00:00.000Z",
});

const TASK_ITEM = Object.freeze({
  taskId: TASK_ID,
  phaseId: PHASE_ID,
  projectId: PROJECT_ID,
  name: "Configure ledger",
  description: null,
  status: "not_started",
  priority: "medium",
  taskType: "standard",
  sortOrder: 1,
  startDate: null,
  dueDate: "2026-02-15",
  baselineStartDate: null,
  baselineEndDate: null,
  addedAfterBaseline: false,
  actualStartDate: null,
  actualEndDate: null,
  progressPercent: 0,
  assigneeId: null,
  updatedAt: "2026-08-07T10:00:00.000Z",
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
  phaseCalls: Array<{ url: string; phaseId: string }>;
  taskCalls: Array<{ url: string; taskId: string }>;
}

function newTrace(): Trace {
  return {
    authenticateCalls: 0,
    authorizedRouteIds: [],
    rateLimitRouteIds: [],
    phaseCalls: [],
    taskCalls: [],
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
    authorizeRoute: (_c: unknown, route: { id: string }) => {
      trace.authorizedRouteIds.push(route.id);
      return Promise.resolve();
    },
    resolveRateLimitProfile: (_c: unknown, route: { id: string }) => {
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
    readPhase: (req: Request, _ctx: unknown, phaseId: string) => {
      trace.phaseCalls.push({ url: req.url, phaseId });
      return Promise.resolve(PHASE_ITEM);
    },
    readTask: (req: Request, _ctx: unknown, taskId: string) => {
      trace.taskCalls.push({ url: req.url, taskId });
      return Promise.resolve(TASK_ITEM);
    },
    ...overrides,
  } as unknown as ApiProtectedRouteDependencies;
}

function getRequest(path: string, suffix = ""): Request {
  return new Request(`https://api.example.test${path}${suffix}`, {
    method: "GET",
    headers: new Headers({ Authorization: "Bearer token" }),
  });
}

// ---------------------------------------------------------------------------
// Routing / cardinality
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.4C: GET /v1/phases/{uuid} matches phases.get_by_id", () => {
  assertStrictEquals(matchApiRoute("GET", PHASE_PATH), PHASE_DETAIL_ROUTE);
  assertEquals(PHASE_DETAIL_ROUTE.id, "phases.get_by_id");
  assertEquals(PHASE_DETAIL_ROUTE.operation, "read");
});

Deno.test("API-M.CP.4C: GET /v1/tasks/{uuid} matches tasks.get_by_id", () => {
  assertStrictEquals(matchApiRoute("GET", TASK_PATH), TASK_DETAIL_ROUTE);
  assertEquals(TASK_DETAIL_ROUTE.id, "tasks.get_by_id");
  assertEquals(TASK_DETAIL_ROUTE.operation, "read");
});

Deno.test("API-M.CP.4C: Phase and Task mutation route matching is unchanged", () => {
  assertStrictEquals(matchApiRoute("PATCH", PHASE_PATH), PHASE_UPDATE_ROUTE);
  assertStrictEquals(matchApiRoute("PATCH", TASK_PATH), TASK_UPDATE_ROUTE);
  assertStrictEquals(
    matchApiRoute("POST", `/v1/projects/${PROJECT_ID}/phases/reorder`),
    PHASE_REORDER_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("PATCH", `${PHASE_PATH}/planning`),
    PHASE_PLANNING_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("POST", `${PHASE_PATH}/tasks/reorder`),
    TASK_REORDER_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("PATCH", `${TASK_PATH}/planning`),
    TASK_PLANNING_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("PUT", `${TASK_PATH}/assignee`),
    TASK_ASSIGN_ROUTE,
  );
  assertStrictEquals(
    matchApiRoute("POST", `${TASK_PATH}/transition`),
    TASK_TRANSITION_ROUTE,
  );
});

Deno.test("API-M.CP.4C: malformed Phase/Task detail paths do not match", () => {
  for (
    const path of [
      "/v1/phases",
      "/v1/phases/",
      `/v1/phases/${PHASE_ID}/`,
      "/v1/phases/not-a-uuid",
      `/v1/phases/${PHASE_ID}/extra`,
      "/v1/phases/00000000-0000-0000-0000-000000000000",
      "/v1/tasks",
      "/v1/tasks/",
      `/v1/tasks/${TASK_ID}/`,
      "/v1/tasks/not-a-uuid",
      "/v1/tasks/00000000-0000-0000-0000-000000000000",
    ]
  ) {
    const matched = matchApiRoute("GET", path);
    assert(
      matched !== PHASE_DETAIL_ROUTE && matched !== TASK_DETAIL_ROUTE,
      `path must not match a detail read: ${path}`,
    );
  }
});

// API-N.RG1A — current global cardinality is owned by
// api-v1-current-surface-topology.test.ts.
Deno.test("API-M.CP.4C: Phase and Task detail routes remain live exactly once", () => {
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PHASE_DETAIL_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === TASK_DETAIL_ROUTE).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// Protected execution
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.4C: Phase id reaches the delegated reader and the payload passes through unchanged", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    getRequest(PHASE_PATH),
    PHASE_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, PHASE_DETAIL_ROUTE);
  assertEquals(trace.phaseCalls.length, 1);
  assertEquals(trace.phaseCalls[0].phaseId, PHASE_ID);
  assertStrictEquals(result.payload, PHASE_ITEM);
  assertEquals(Object.keys(result.payload as object).length, 15);
});

Deno.test("API-M.CP.4C: Task id reaches the delegated reader and the payload passes through unchanged", async () => {
  const trace = newTrace();
  const result = await executeApiProtectedRoute(
    getRequest(TASK_PATH),
    TASK_PATH,
    READS_ON,
    buildDeps(trace),
  );
  assertStrictEquals(result.route, TASK_DETAIL_ROUTE);
  assertEquals(trace.taskCalls.length, 1);
  assertEquals(trace.taskCalls[0].taskId, TASK_ID);
  assertStrictEquals(result.payload, TASK_ITEM);
  assertEquals(Object.keys(result.payload as object).length, 19);
});

Deno.test("API-M.CP.4C: pipeline order is runtime gate -> authenticate -> authorize -> rate limit -> reader", async () => {
  for (
    const [path, readerKey] of [
      [PHASE_PATH, "readPhase"],
      [TASK_PATH, "readTask"],
    ] as const
  ) {
    const trace = newTrace();
    const order: string[] = [];
    const deps = buildDeps(trace, {
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
    });
    (deps as unknown as Record<string, unknown>)[readerKey] = () => {
      order.push("reader");
      return Promise.resolve(
        readerKey === "readPhase" ? PHASE_ITEM : TASK_ITEM,
      );
    };
    await executeApiProtectedRoute(getRequest(path), path, READS_ON, deps);
    assertEquals(order, ["authenticate", "authorize", "rateLimit", "reader"]);
  }
});

Deno.test("API-M.CP.4C: reads disabled blocks both routes before authentication", async () => {
  for (const path of [PHASE_PATH, TASK_PATH]) {
    const trace = newTrace();
    await assertRejects(
      () =>
        executeApiProtectedRoute(
          getRequest(path),
          path,
          { apiEnabled: true, readsEnabled: false, mutationsEnabled: false },
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(trace.authenticateCalls, 0);
    assertEquals(trace.phaseCalls.length, 0);
    assertEquals(trace.taskCalls.length, 0);
  }
});

Deno.test("API-M.CP.4C: query or fragment on a detail request fails before authentication", async () => {
  for (
    const [path, suffix] of [
      [PHASE_PATH, "?limit=5"],
      [PHASE_PATH, "#frag"],
      [TASK_PATH, "?cursor=abc"],
      [TASK_PATH, "#frag"],
    ] as const
  ) {
    const trace = newTrace();
    const error = await assertRejects(
      () =>
        executeApiProtectedRoute(
          getRequest(path, suffix),
          path,
          READS_ON,
          buildDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(error.code, "invalid_request", `${path}${suffix}`);
    assertEquals(trace.authenticateCalls, 0);
    assertEquals(trace.phaseCalls.length, 0);
    assertEquals(trace.taskCalls.length, 0);
  }
});

Deno.test("API-M.CP.4C: malformed detail pathname fails before authentication and never reaches a reader", async () => {
  for (
    const path of [
      "/v1/phases/not-a-uuid",
      "/v1/phases/00000000-0000-0000-0000-000000000000",
      "/v1/tasks/not-a-uuid",
      "/v1/tasks/00000000-0000-0000-0000-000000000000",
    ]
  ) {
    const trace = newTrace();
    const route = path.startsWith("/v1/phases")
      ? PHASE_DETAIL_ROUTE
      : TASK_DETAIL_ROUTE;
    const error = await assertRejects(
      () =>
        executeApiProtectedRoute(
          getRequest(path),
          path,
          READS_ON,
          buildDeps(trace),
          // deno-lint-ignore no-explicit-any
        ) as any,
      ApiHttpError,
    );
    assert(error.code === "invalid_request" || error.code === "route_not_found");
    assertEquals(trace.authenticateCalls, 0);
    assertEquals(trace.phaseCalls.length, 0);
    assertEquals(trace.taskCalls.length, 0);
    assert(route === PHASE_DETAIL_ROUTE || route === TASK_DETAIL_ROUTE);
  }
});

Deno.test("API-M.CP.4C: missing or malformed readPhase / readTask fails closed with internal_error", async () => {
  for (
    const [path, readerKey] of [
      [PHASE_PATH, "readPhase"],
      [TASK_PATH, "readTask"],
    ] as const
  ) {
    for (const bad of [undefined, null, {}, "reader", 42]) {
      const trace = newTrace();
      const deps = buildDeps(trace);
      (deps as unknown as Record<string, unknown>)[readerKey] = bad;
      const error = await assertRejects(
        () => executeApiProtectedRoute(getRequest(path), path, READS_ON, deps),
        ApiHttpError,
      );
      assertEquals(error.code, "internal_error");
      assertEquals(trace.authenticateCalls, 0);
    }
  }
});

Deno.test("API-M.CP.4C: reader failures preserve safe mapping and never become not_found", async () => {
  for (
    const [path, readerKey] of [
      [PHASE_PATH, "readPhase"],
      [TASK_PATH, "readTask"],
    ] as const
  ) {
    for (
      const [thrown, expected] of [
        [new ApiHttpError("not_authorized"), "not_authorized"],
        [new ApiHttpError("invalid_request"), "invalid_request"],
        [new Error("boom"), "internal_error"],
      ] as const
    ) {
      const trace = newTrace();
      const deps = buildDeps(trace);
      (deps as unknown as Record<string, unknown>)[readerKey] = () =>
        Promise.reject(thrown);
      const error = await assertRejects(
        () => executeApiProtectedRoute(getRequest(path), path, READS_ON, deps),
        ApiHttpError,
      );
      assertEquals(error.code, expected);
      assert((error.code as string) !== "not_found");
    }
  }
});

// ---------------------------------------------------------------------------
// Handler compatibility — handler.ts is unchanged
// ---------------------------------------------------------------------------

function handlerDeps(trace: Trace): ApiV1HttpHandlerDependencies {
  return {
    controls: READS_ON,
    allowedOrigins: new Set<string>(["https://app.example.test"]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => "55555555-5555-4555-8555-555555555555" },
    protectedRoute: buildDeps(trace),
  } as unknown as ApiV1HttpHandlerDependencies;
}

Deno.test("API-M.CP.4C: unchanged handler reaches the Phase detail protected route", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    getRequest(PHASE_PATH),
    handlerDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), PHASE_ITEM);
  assertEquals(trace.phaseCalls.length, 1);
  assertEquals(trace.phaseCalls[0].phaseId, PHASE_ID);
  assertEquals(trace.authorizedRouteIds, ["phases.get_by_id"]);
  assertEquals(trace.rateLimitRouteIds, ["phases.get_by_id"]);
});

Deno.test("API-M.CP.4C: unchanged handler reaches the Task detail protected route", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    getRequest(TASK_PATH),
    handlerDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), TASK_ITEM);
  assertEquals(trace.taskCalls.length, 1);
  assertEquals(trace.taskCalls[0].taskId, TASK_ID);
  assertEquals(trace.authorizedRouteIds, ["tasks.get_by_id"]);
  assertEquals(trace.rateLimitRouteIds, ["tasks.get_by_id"]);
});

Deno.test("API-M.CP.4C: handler rejects query/fragment-bearing detail requests without reaching a reader", async () => {
  for (
    const [path, suffix] of [
      [PHASE_PATH, "?limit=5"],
      [TASK_PATH, "?cursor=abc"],
    ] as const
  ) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      getRequest(path, suffix),
      handlerDeps(trace),
    );
    assert(response.status >= 400, `${path}${suffix}`);
    assertEquals(trace.phaseCalls.length, 0);
    assertEquals(trace.taskCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Runtime wiring constraints
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.4C: live runtime builds the Phase/Task readers with the anon key only", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  for (
    const factory of [
      "createDelegatedApiV1PhaseReader",
      "createDelegatedApiV1TaskReader",
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
  assert(source.includes("readPhase,"));
  assert(source.includes("readTask,"));
  assert(source.includes("route !== PHASE_DETAIL_ROUTE"));
  assert(source.includes("route !== TASK_DETAIL_ROUTE"));
});

// ---------------------------------------------------------------------------
// Capability advertisement — closed by API-M.CP.5
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.5: /v1/capabilities advertises the two detail reads once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "phases.get_by_id").length, 1);
  assertEquals(ops.filter((o) => o === "tasks.get_by_id").length, 1);
  assert(ops.includes("phases.update"));
  assert(ops.includes("tasks.update"));
});
