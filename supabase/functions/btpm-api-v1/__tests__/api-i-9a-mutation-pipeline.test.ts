// API-I.9A — Focused tests for the dedicated protected mutation execution
// pipeline (`executeApiAppendExecutionUpdateRoute`).
//
// No live HTTP, database or frontend testing is performed.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiAppendExecutionUpdateRoute,
  type ApiAppendExecutionUpdateRouteDependencies,
  type ApiRuntimeControls,
} from "../router.ts";
import { EXECUTION_UPDATES_APPEND_ROUTE } from "../routes/executionUpdates.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { hashCanonicalPayload } from "../../_shared/btpm-api/idempotency.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "btpm-test-client";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const HTTP_REQUEST_ID = "55555555-5555-4555-8555-555555555555";

const AUTH_CONTEXT = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
  }),
}) as unknown as import("../../_shared/btpm-api/authenticateApiRequest.ts").AuthenticatedApiContext;

const VALID_BODY = Object.freeze({
  targetType: "task",
  targetId: TARGET_ID,
  summary: "Executed the migration dry run.",
  updateDate: "2026-08-07",
  statusLabel: "on_track",
});

const APPLIED = Object.freeze({
  ok: true,
  outcome: "applied",
  executionUpdateId: "66666666-6666-4666-8666-666666666666",
  targetType: "task",
  targetId: TARGET_ID,
  updateDate: "2026-08-07",
  hasStatusLabel: true,
} as const);

const CONTROLS_ON: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: false,
  mutationsEnabled: true,
});

const CONTROLS_MUTATIONS_OFF: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

const CONTROLS_API_OFF: ApiRuntimeControls = Object.freeze({
  apiEnabled: false,
  readsEnabled: false,
  mutationsEnabled: false,
});

interface Trace {
  order: string[];
  authorizeCalls: number;
  profileRouteIds: string[];
  executorArgs: unknown[][];
}

function makeDeps(
  trace: Trace,
  overrides: Partial<ApiAppendExecutionUpdateRouteDependencies> = {},
  executorResult: unknown = APPLIED,
): ApiAppendExecutionUpdateRouteDependencies {
  const base: ApiAppendExecutionUpdateRouteDependencies = {
    authenticate: async () => {
      trace.order.push("authenticate");
      return AUTH_CONTEXT;
    },
    authorizeRoute: async (_ctx, route) => {
      trace.order.push("authorizeRoute:" + route.id);
      trace.authorizeCalls += 1;
    },
    resolveRateLimitProfile: async (_ctx, route) => {
      trace.order.push("resolveRateLimitProfile");
      trace.profileRouteIds.push(route.id);
      return { limit: 10, windowSeconds: 60 };
    },
    rateLimit: {
      store: {
        consume: async () => {
          trace.order.push("rateLimit.consume");
          return { allowed: true, remaining: 9, resetAtEpochMs: 1_000_000 };
        },
      },
      now: () => 1_000,
    },
    appendExecutionUpdate: async (request, ctx, body, executionContext) => {
      trace.order.push("appendExecutionUpdate");
      trace.executorArgs.push([request, ctx, body, executionContext]);
      // deno-lint-ignore no-explicit-any
      return executorResult as any;
    },
  };
  return { ...base, ...overrides };
}

function newTrace(): Trace {
  return {
    order: [],
    authorizeCalls: 0,
    profileRouteIds: [],
    executorArgs: [],
  };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/v1/execution-updates", {
    method: "POST",
    headers: { "Idempotency-Key": "idem-key-001", ...headers },
  });
}

// ---------------------------------------------------------------------------
// Route / runtime gate
// ---------------------------------------------------------------------------

Deno.test("API-I.9A: resolves exactly the frozen mutation route", async () => {
  const trace = newTrace();
  const result = await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  assertEquals(result.route, EXECUTION_UPDATES_APPEND_ROUTE);
  assertEquals(result.route.id, "execution_updates.append");
  assertEquals(result.route.method, "POST");
  assertEquals(result.route.path, "/v1/execution-updates");
  assertEquals(result.route.operation, "mutation");
  assert(Object.isFrozen(result));
  assertEquals(result.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });
  assertEquals(Object.keys(result.activityIdentity), [
    "apiClientId",
    "actorUserId",
  ]);
});

Deno.test("API-I.9A: mutations disabled → api_unavailable, no executor", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest(),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_MUTATIONS_OFF,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "api_unavailable");
  assertEquals(err.status, 503);
  assertEquals(trace.order, []);
});

Deno.test("API-I.9A: global API disabled → api_unavailable", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest(),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_API_OFF,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "api_unavailable");
  assertEquals(trace.order, []);
});

Deno.test("API-I.9A: reads switch does not gate the mutation route", async () => {
  const trace = newTrace();
  const result = await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    Object.freeze({
      apiEnabled: true,
      readsEnabled: false,
      mutationsEnabled: true,
    }),
    makeDeps(trace),
  );
  assertEquals(result.status, 201);
});

// ---------------------------------------------------------------------------
// Strict body validation before authentication
// ---------------------------------------------------------------------------

Deno.test("API-I.9A: strict parser rejects invalid body before authentication", async () => {
  for (
    const bad of [
      null,
      {},
      { ...VALID_BODY, targetType: "project" },
      { ...VALID_BODY, targetId: "not-a-uuid" },
      { ...VALID_BODY, summary: "   " },
      { ...VALID_BODY, updateDate: "2026-02-30" },
      { ...VALID_BODY, idempotencyKey: "x" },
      { ...VALID_BODY, workspaceId: TARGET_ID },
      { ...VALID_BODY, sourceChannel: "external_api" },
    ]
  ) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiAppendExecutionUpdateRoute(
          makeRequest(),
          bad,
          HTTP_REQUEST_ID,
          CONTROLS_ON,
          makeDeps(trace),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(trace.order, []);
  }
});

Deno.test("API-I.9A: authentication occurs after successful body validation", async () => {
  const trace = newTrace();
  await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  assertEquals(trace.order, [
    "authenticate",
    "authorizeRoute:execution_updates.append",
    "resolveRateLimitProfile",
    "rateLimit.consume",
    "appendExecutionUpdate",
  ]);
});

Deno.test("API-I.9A: invalid authenticated context → internal_error", async () => {
  for (
    const ctx of [
      null,
      {},
      { token: { userId: USER_ID, clientId: OAUTH_CLIENT_ID }, client: {} },
      {
        token: { userId: USER_ID, clientId: OAUTH_CLIENT_ID },
        client: {
          userId: "99999999-9999-4999-8999-999999999999",
          apiClientId: API_CLIENT_ID,
          oauthClientId: OAUTH_CLIENT_ID,
          policyVersionId: POLICY_VERSION_ID,
        },
      },
    ]
  ) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiAppendExecutionUpdateRoute(
          makeRequest(),
          VALID_BODY,
          HTTP_REQUEST_ID,
          CONTROLS_ON,
          makeDeps(trace, {
            // deno-lint-ignore no-explicit-any
            authenticate: async () => ctx as any,
          }),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(trace.executorArgs.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Authorization and rate limiting
// ---------------------------------------------------------------------------

Deno.test("API-I.9A: authorizeRoute called exactly once with the mutation route", async () => {
  const trace = newTrace();
  await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  assertEquals(trace.authorizeCalls, 1);
  assertEquals(trace.profileRouteIds, ["execution_updates.append"]);
});

Deno.test("API-I.9A: authorization rejection prevents executor invocation", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest(),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace, {
          authorizeRoute: () => {
            trace.order.push("authorizeRoute");
            return Promise.reject(new ApiHttpError("not_authorized"));
          },
        }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
  assertEquals(trace.executorArgs.length, 0);
});

Deno.test("API-I.9A: authentication rejection prevents executor invocation", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest(),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace, {
          authenticate: () => Promise.reject(new ApiHttpError("not_authorized")),
        }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
  assertEquals(trace.executorArgs.length, 0);
});

Deno.test("API-I.9A: rate rejection prevents executor invocation", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest(),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace, {
          rateLimit: {
            store: {
              consume: async () => {
                trace.order.push("rateLimit.consume");
                return {
                  allowed: false,
                  remaining: 0,
                  resetAtEpochMs: 1_000_000,
                };
              },
            },
            now: () => 1_000,
          },
        }),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "rate_limit_exceeded");
  assertEquals(trace.executorArgs.length, 0);
  assert(trace.order.includes("rateLimit.consume"));
});

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

Deno.test("API-I.9A: payload hash derives from the validated body", async () => {
  const trace = newTrace();
  await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    // Key order differs from the canonical parsed order.
    {
      statusLabel: "on_track",
      updateDate: "2026-08-07",
      summary: "Executed the migration dry run.",
      targetId: TARGET_ID,
      targetType: "task",
    },
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  const ctx = trace.executorArgs[0][3] as { payloadHash: string };
  const expected = await hashCanonicalPayload({
    targetType: "task",
    targetId: TARGET_ID,
    summary: "Executed the migration dry run.",
    updateDate: "2026-08-07",
    statusLabel: "on_track",
  });
  assertEquals(ctx.payloadHash, expected);
});

Deno.test("API-I.9A: missing Idempotency-Key → invalid_request", async () => {
  const trace = newTrace();
  const request = new Request("https://example.test/v1/execution-updates", {
    method: "POST",
  });
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        request,
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.executorArgs.length, 0);
});

Deno.test("API-I.9A: invalid Idempotency-Key → invalid_request", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest({ "Idempotency-Key": "bad key with spaces" }),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.executorArgs.length, 0);
});

Deno.test("API-I.9A: invalid correlation ID → invalid_request", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeRequest({ "X-Correlation-ID": "bad correlation id" }),
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.executorArgs.length, 0);
});

Deno.test("API-I.9A: HTTP-resolved request ID reused when header absent", async () => {
  const trace = newTrace();
  await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  const ctx = trace.executorArgs[0][3] as {
    requestId: string;
    correlationId: string;
  };
  assertEquals(ctx.requestId, HTTP_REQUEST_ID);
  assertEquals(ctx.correlationId, HTTP_REQUEST_ID);
});

Deno.test("API-I.9A: caller-supplied request ID remains consistent", async () => {
  const trace = newTrace();
  await executeApiAppendExecutionUpdateRoute(
    makeRequest({ "X-Request-ID": "caller-req-77" }),
    VALID_BODY,
    "caller-req-77",
    CONTROLS_ON,
    makeDeps(trace),
  );
  const ctx = trace.executorArgs[0][3] as { requestId: string };
  assertEquals(ctx.requestId, "caller-req-77");
});

Deno.test("API-I.9A: executor receives exact validated body and provenance", async () => {
  const trace = newTrace();
  await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  const [request, ctx, body, executionContext] = trace.executorArgs[0] as [
    Request,
    unknown,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  assert(request instanceof Request);
  assertEquals(ctx, AUTH_CONTEXT);
  assertEquals(body, {
    targetType: "task",
    targetId: TARGET_ID,
    summary: "Executed the migration dry run.",
    updateDate: "2026-08-07",
    statusLabel: "on_track",
  });
  assertEquals(executionContext.sourceChannel, "external_api");
  assertEquals(executionContext.delegationMode, "delegated_user");
  assertEquals(executionContext.requestedUserId, USER_ID);
  assertEquals(executionContext.executingUserId, USER_ID);
  assertEquals(executionContext.apiClientId, API_CLIENT_ID);
  assertEquals(executionContext.oauthClientId, OAUTH_CLIENT_ID);
  assertEquals(executionContext.policyVersionId, POLICY_VERSION_ID);
  assertEquals(executionContext.idempotencyKey, "idem-key-001");
});

// ---------------------------------------------------------------------------
// Outcome mapping
// ---------------------------------------------------------------------------

Deno.test("API-I.9A: applied → 201 with exact bounded payload", async () => {
  const trace = newTrace();
  const result = await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace, {}, APPLIED),
  );
  assertEquals(result.status, 201);
  assertEquals(result.payload, APPLIED);
});

Deno.test("API-I.9A: replayed → 200 with outcome replayed", async () => {
  const replayed = { ...APPLIED, outcome: "replayed" as const };
  const trace = newTrace();
  const result = await executeApiAppendExecutionUpdateRoute(
    makeRequest(),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace, {}, replayed),
  );
  assertEquals(result.status, 200);
  assertEquals(result.payload.outcome, "replayed");
  assertEquals(result.payload, replayed);
});

Deno.test("API-I.9A: negative outcomes map to bounded HTTP errors", async () => {
  const cases: ReadonlyArray<readonly [string, string, number]> = [
    ["invalid", "invalid_request", 400],
    ["not_authorized", "not_authorized", 403],
    ["idempotency_conflict", "idempotency_conflict", 409],
    ["idempotency_pending", "idempotency_pending", 409],
  ];
  for (const [outcome, code, status] of cases) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiAppendExecutionUpdateRoute(
          makeRequest(),
          VALID_BODY,
          HTTP_REQUEST_ID,
          CONTROLS_ON,
          makeDeps(trace, {}, { ok: false, outcome }),
        ),
      ApiHttpError,
    );
    assertEquals(err.code, code);
    assertEquals(err.status, status);
    assert(!/hash|registry|payload/i.test(err.publicMessage));
  }
});

// ---------------------------------------------------------------------------
// Static containment
// ---------------------------------------------------------------------------

Deno.test("API-I.9A: router mutation pipeline has no service-role or business-table access", async () => {
  const src = await Deno.readTextFile(
    new URL("../router.ts", import.meta.url),
  );
  for (
    const banned of [
      "SERVICE_ROLE",
      "service_role",
      "createClient",
      ".from(",
      "append_execution_update\"",
      "api_v1_append_execution_update",
      "Deno.env",
    ]
  ) {
    assert(!src.includes(banned), `router.ts must not contain ${banned}`);
  }
  // Read execution is unchanged: the mutation dependency is not required by
  // the read pipeline dependency validator.
  assert(src.includes("export async function executeApiProtectedRoute"));
  assert(
    !/validateDependencies[\s\S]{0,1200}appendExecutionUpdate/.test(src),
    "read dependency validation must not require the mutation executor",
  );
});

Deno.test("API-I.9B: live HTTP composition wires exactly one mutation route", async () => {
  const handler = await Deno.readTextFile(
    new URL("../handler.ts", import.meta.url),
  );
  const index = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const cors = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/cors.ts", import.meta.url),
  );
  // Exactly one mutation pipeline invocation, in the handler only.
  assertEquals(
    handler.split("executeApiAppendExecutionUpdateRoute(").length - 1,
    1,
  );
  assert(!index.includes("executeApiAppendExecutionUpdateRoute"));
  assert(!cors.includes("executeApiAppendExecutionUpdateRoute"));
  // Exactly one delegated mutation executor, constructed in index.ts only.
  assertEquals(
    index.split("createDelegatedApiV1AppendExecutionUpdateExecutor(").length - 1,
    1,
  );
  assert(!handler.includes("createDelegatedApiV1AppendExecutionUpdateExecutor"));
  // No service-role key anywhere near the mutation executor construction.
  const at = index.indexOf("createDelegatedApiV1AppendExecutionUpdateExecutor(");
  const block = index.slice(at, at + 300);
  assert(block.includes("supabaseAnonKey"));
  assert(!block.includes("supabaseServiceRoleKey"));
  assert(!block.includes("privilegedClient"));
  // The frozen route remains registered in the allowlist (API-I.8).
  assert(API_V1_ROUTE_ALLOWLIST.includes(EXECUTION_UPDATES_APPEND_ROUTE));
});

// ---------------------------------------------------------------------------
// API-I.9A-C1 — Actual request-URL validation
// ---------------------------------------------------------------------------

function makeUrlRequest(url: string, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "Idempotency-Key": "idem-key-001" },
  });
}

Deno.test("API-I.9A-C1: exact POST /v1/execution-updates still succeeds", async () => {
  const trace = newTrace();
  const result = await executeApiAppendExecutionUpdateRoute(
    makeUrlRequest("https://example.test/v1/execution-updates"),
    VALID_BODY,
    HTTP_REQUEST_ID,
    CONTROLS_ON,
    makeDeps(trace),
  );
  assertEquals(result.route, EXECUTION_UPDATES_APPEND_ROUTE);
  assertEquals(result.status, 201);
});

Deno.test("API-I.9A-C1: non-matching actual pathnames → route_not_found with zero dependency calls", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["https://example.test/v1/other", "POST"],
    ["https://example.test/v1/execution-updates/", "POST"],
    ["https://example.test/v1/Execution-Updates", "POST"],
    ["https://example.test/V1/execution-updates", "POST"],
    ["https://example.test/v1/execution-updates/extra", "POST"],
    ["https://example.test/v1/execution-updates/extra/deeper", "POST"],
    ["https://example.test/execution-updates", "POST"],
    ["https://example.test/v1/execution-updates", "GET"],
    ["https://example.test/v1/execution-updates", "PUT"],
    ["https://example.test/v1/execution-updates", "DELETE"],
  ];
  for (const [url, method] of cases) {
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiAppendExecutionUpdateRoute(
          makeUrlRequest(url, method),
          VALID_BODY,
          HTTP_REQUEST_ID,
          CONTROLS_ON,
          makeDeps(trace),
        ),
      ApiHttpError,
      undefined,
      `${method} ${url} must not resolve`,
    );
    assertEquals(err.code, "route_not_found");
    assertEquals(err.status, 404);
    assertEquals(trace.order, []);
    assertEquals(trace.authorizeCalls, 0);
    assertEquals(trace.profileRouteIds, []);
    assertEquals(trace.executorArgs.length, 0);
    assert(!err.publicMessage.includes("execution-updates"));
    assert(!err.publicMessage.includes("example.test"));
  }
});

Deno.test("API-I.9A-C1: query string or fragment on the mutation URL → invalid_request with zero dependency calls", async () => {
  const cases = [
    "https://example.test/v1/execution-updates?limit=1",
    "https://example.test/v1/execution-updates?",
    "https://example.test/v1/execution-updates?targetType=task",
    "https://example.test/v1/execution-updates#frag",
    "https://example.test/v1/execution-updates?a=1#frag",
  ];
  for (const raw of cases) {
    const request = makeUrlRequest(raw);
    const parsed = new URL(request.url);
    if (parsed.search.length === 0 && parsed.hash.length === 0) {
      // Not representable by this runtime (fragments are stripped) — skip.
      continue;
    }
    const trace = newTrace();
    const err = await assertRejects(
      () =>
        executeApiAppendExecutionUpdateRoute(
          request,
          VALID_BODY,
          HTTP_REQUEST_ID,
          CONTROLS_ON,
          makeDeps(trace),
        ),
      ApiHttpError,
      undefined,
      `${raw} must be rejected`,
    );
    assertEquals(err.code, "invalid_request");
    assertEquals(err.status, 400);
    assertEquals(trace.order, []);
    assertEquals(trace.executorArgs.length, 0);
    assert(!err.publicMessage.includes("execution-updates"));
  }
});

Deno.test("API-I.9A-C1: query rejection precedes body parsing", async () => {
  const trace = newTrace();
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        makeUrlRequest("https://example.test/v1/execution-updates?x=1"),
        // Body is also invalid; URL validation must decide the outcome first.
        { targetType: "project" },
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(trace.order, []);
});

Deno.test("API-I.9A-C1: unparseable request URL → internal_error", async () => {
  const trace = newTrace();
  const broken = {
    method: "POST",
    url: "not a url",
    headers: new Headers({ "Idempotency-Key": "idem-key-001" }),
  };
  Object.setPrototypeOf(broken, Request.prototype);
  const err = await assertRejects(
    () =>
      executeApiAppendExecutionUpdateRoute(
        broken as unknown as Request,
        VALID_BODY,
        HTTP_REQUEST_ID,
        CONTROLS_ON,
        makeDeps(trace),
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(err.status, 500);
  assertEquals(trace.order, []);
});

Deno.test("API-I.9A-C1: pipeline passes the actual pathname, not the frozen route constant", async () => {
  const src = await Deno.readTextFile(
    new URL("../router.ts", import.meta.url),
  );
  const start = src.indexOf(
    "export async function executeApiAppendExecutionUpdateRoute",
  );
  assert(start > -1);
  const body = src.slice(start);
  assert(
    body.includes("new URL(request.url)"),
    "must parse the actual request URL",
  );
  assert(
    /resolveApiRouteAccess\(\s*request\.method,\s*url\.pathname,\s*controls,?\s*\)/
      .test(body),
    "must pass the actual parsed pathname into resolveApiRouteAccess",
  );
  assert(
    !body.includes("EXECUTION_UPDATES_APPEND_ROUTE.path"),
    "must not substitute the frozen route path for the request pathname",
  );
  assert(
    body.includes("url.search.length > 0 || url.hash.length > 0"),
    "must reject query strings and fragments",
  );
});
