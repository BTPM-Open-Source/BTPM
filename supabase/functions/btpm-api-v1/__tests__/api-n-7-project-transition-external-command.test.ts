// API-N.7 — focused behavioural contract coverage for the single accepted
// external Project status-transition command:
// POST /v1/projects/{projectId}/transition (projects:transition).
//
// These tests exercise the committed production path parser, body parser,
// canonical idempotency payload builder, route pipeline, delegated caller-bound
// adapter and handler activity behavior with injected deterministic
// dependencies. No environment variable, network call, live Supabase client,
// OAuth flow or service-role credential is touched.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  buildApiV1TransitionProjectIdempotencyPayload,
  parseApiV1ProjectTransitionPath,
  parseApiV1TransitionProjectBody,
  PROJECT_CREATE_ROUTE,
  PROJECT_TRANSITION_ROUTE,
  PROJECT_TRANSITION_TARGET_STATUSES,
  PROJECT_UPDATE_ROUTE,
  type ApiV1TransitionProjectBody,
} from "../routes/projects.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiTransitionProjectRoute,
  matchApiRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { transitionApiV1Project } from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import { createDelegatedApiV1TransitionProjectExecutor } from "../../_shared/btpm-api/supabaseDelegatedProjectMutation.ts";

const PROJECT_ID = "cccccccc-3333-4333-8333-333333333333";
const OTHER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "astra-client";
const NIL = "00000000-0000-0000-0000-000000000000";
const UPDATED_AT = "2026-02-01T10:20:30.123456+00:00";
const PATH = `/v1/projects/${PROJECT_ID}/transition`;

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expectedUpdatedAt: UPDATED_AT,
    targetStatus: "completed",
    ...overrides,
  };
}

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

// ---------------------------------------------------------------------------
// 1. Path parser
// ---------------------------------------------------------------------------

Deno.test("API-N.7: path parser accepts exactly the nested transition shape", () => {
  const parsed = parseApiV1ProjectTransitionPath(PATH);
  assertEquals(parsed, { projectId: PROJECT_ID });
  assert(Object.isFrozen(parsed));

  for (
    const bad of [
      "/v1/projects/transition",
      `/v1/projects/${PROJECT_ID}`,
      `/v1/projects/${NIL}/transition`,
      `/v1/projects/${PROJECT_ID}/transition/`,
      `/v1/projects/${PROJECT_ID}/transitions`,
      `/v1/projects/${PROJECT_ID}/phases/transition`,
      `/v1/projects/ ${PROJECT_ID}/transition`,
      `/v1/projects/${PROJECT_ID} /transition`,
      `/v1/projects/${PROJECT_ID}%20/transition`,
      `/v1/PROJECTS/${PROJECT_ID}/transition`,
      "/v1/projects/not-a-uuid/transition",
    ]
  ) {
    assertInvalid(() => parseApiV1ProjectTransitionPath(bad));
  }
});

// ---------------------------------------------------------------------------
// 2. Body parser — closed schema, required token, canonical statuses
// ---------------------------------------------------------------------------

Deno.test("API-N.7: body parser requires expectedUpdatedAt and targetStatus", () => {
  assertInvalid(() =>
    parseApiV1TransitionProjectBody({ targetStatus: "completed" })
  );
  assertInvalid(() =>
    parseApiV1TransitionProjectBody({ expectedUpdatedAt: UPDATED_AT })
  );
  for (const bad of [null, undefined, 1, "x", true, [], [base()], () => {}]) {
    assertInvalid(() => parseApiV1TransitionProjectBody(bad));
  }
});

Deno.test("API-N.7: body parser rejects every key outside the closed schema", () => {
  for (
    const key of [
      "projectId",
      "id",
      "status",
      "projectStage",
      "workspaceId",
      "organizationId",
      "isArchived",
      "confirm_warnings",
      "target_status",
      "expected_updated_at",
      "x",
    ]
  ) {
    assertInvalid(() => parseApiV1TransitionProjectBody(base({ [key]: null })));
    assertInvalid(() => parseApiV1TransitionProjectBody(base({ [key]: "v" })));
  }
});

Deno.test("API-N.7: only the canonical pm_status vocabulary is accepted", () => {
  assertEquals(PROJECT_TRANSITION_TARGET_STATUSES.length, 5);
  for (const status of PROJECT_TRANSITION_TARGET_STATUSES) {
    const parsed = parseApiV1TransitionProjectBody(
      base({ targetStatus: status }),
    );
    assertEquals(parsed.targetStatus, status);
  }
  for (
    const bad of ["COMPLETED", "done", "on-hold", "", " active", 1, {}, [], null]
  ) {
    assertInvalid(() =>
      parseApiV1TransitionProjectBody(base({ targetStatus: bad }))
    );
  }
});

Deno.test("API-N.7: confirmWarnings is optional, boolean only, and defaults to false", () => {
  assertEquals(parseApiV1TransitionProjectBody(base()).confirmWarnings, false);
  assertEquals(
    parseApiV1TransitionProjectBody(base({ confirmWarnings: true }))
      .confirmWarnings,
    true,
  );
  for (const bad of ["true", 1, 0, null, {}, []]) {
    assertInvalid(() =>
      parseApiV1TransitionProjectBody(base({ confirmWarnings: bad }))
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("API-N.7: idempotency payload is deterministic, target-bound and metadata-free", () => {
  const body = parseApiV1TransitionProjectBody(base());
  const a = buildApiV1TransitionProjectIdempotencyPayload(PROJECT_ID, body);
  const b = buildApiV1TransitionProjectIdempotencyPayload(
    PROJECT_ID,
    parseApiV1TransitionProjectBody(base({ confirmWarnings: false })),
  );
  assertEquals(JSON.stringify(a), JSON.stringify(b));

  // A different confirmation intent must never share a canonical payload.
  const confirmed = buildApiV1TransitionProjectIdempotencyPayload(
    PROJECT_ID,
    parseApiV1TransitionProjectBody(base({ confirmWarnings: true })),
  );
  assertNotEquals(JSON.stringify(a), JSON.stringify(confirmed));

  // A different target status or target Project must never collide.
  assertNotEquals(
    JSON.stringify(a),
    JSON.stringify(
      buildApiV1TransitionProjectIdempotencyPayload(
        PROJECT_ID,
        parseApiV1TransitionProjectBody(base({ targetStatus: "on_hold" })),
      ),
    ),
  );
  assertNotEquals(
    JSON.stringify(a),
    JSON.stringify(
      buildApiV1TransitionProjectIdempotencyPayload(OTHER_ID, body),
    ),
  );

  assertEquals(Object.keys(a), [
    "projectId",
    "expectedUpdatedAt",
    "targetStatus",
    "confirmWarnings",
  ]);
  assert(Object.isFrozen(a));
});

// ---------------------------------------------------------------------------
// 4. Route identity
// ---------------------------------------------------------------------------

Deno.test("API-N.7: exactly one route serves this command and it is registered once", () => {
  assertEquals(matchApiRoute("POST", PATH), PROJECT_TRANSITION_ROUTE);
  assertEquals(matchApiRoute("POST", "/v1/projects"), PROJECT_CREATE_ROUTE);
  assertEquals(
    matchApiRoute("PATCH", `/v1/projects/${PROJECT_ID}`),
    PROJECT_UPDATE_ROUTE,
  );
  assertEquals(matchApiRoute("PATCH", PATH), null);
  assertEquals(matchApiRoute("GET", PATH), null);

  assertEquals(PROJECT_TRANSITION_ROUTE.id, "projects.transition");
  assertEquals(PROJECT_TRANSITION_ROUTE.method, "POST");
  assertEquals(PROJECT_TRANSITION_ROUTE.operation, "mutation");
  assertEquals(
    PROJECT_TRANSITION_ROUTE.path,
    "/v1/projects/:projectid/transition",
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PROJECT_TRANSITION_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r.id === "projects.transition").length,
    1,
  );
});

Deno.test("API-N.7: /v1/capabilities advertises projects.transition exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations;
  assertEquals(ops.filter((o) => o === "projects.transition").length, 1);
});

// ---------------------------------------------------------------------------
// 5. Mutation pipeline — injected deterministic dependencies
// ---------------------------------------------------------------------------

const AUTH_CONTEXT = {
  token: { userId: USER_ID, clientId: OAUTH_CLIENT_ID },
  client: {
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
  },
  // deno-lint-ignore no-explicit-any
} as any;

const ENABLED = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

const APPLIED = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  status: "completed",
  previousStatus: "active",
  updatedAt: UPDATED_AT,
});

const BLOCKED = Object.freeze({
  ok: false,
  outcome: "blocked",
  code: "completion_hard_blocked",
  projectId: PROJECT_ID,
  hardBlocks: Object.freeze([
    Object.freeze({ code: "open_blockers", message: "Blockers.", count: 2 }),
  ]),
  warnings: Object.freeze([]),
  counts: Object.freeze({ open_blockers: 2 }),
});

const CONFIRMATION = Object.freeze({
  ok: false,
  outcome: "confirmation_required",
  code: "completion_soft_warnings",
  projectId: PROJECT_ID,
  warnings: Object.freeze([
    Object.freeze({ code: "open_risks", message: "Risks.", count: 1 }),
  ]),
  counts: Object.freeze({ open_risks: 1 }),
});

function transitionDeps(result: unknown) {
  const captured: Array<{
    projectId: string;
    body: ApiV1TransitionProjectBody;
    // deno-lint-ignore no-explicit-any
    executionContext: any;
  }> = [];
  const order: string[] = [];
  const counters = { transition: 0, create: 0, update: 0, authorize: 0 };
  return {
    captured,
    order,
    counters,
    deps: {
      authenticate: () => {
        order.push("authenticate");
        return Promise.resolve(AUTH_CONTEXT);
      },
      authorizeRoute: () => {
        counters.authorize++;
        order.push("authorize");
        return Promise.resolve();
      },
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 1000, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () => {
            order.push("rateLimit");
            return Promise.resolve({
              allowed: true,
              remaining: 999,
              resetAtEpochMs: Date.now() + 60_000,
            });
          },
        },
        now: () => Date.now(),
      },
      createProject: () => {
        counters.create++;
        return Promise.reject(new Error("create must never run here"));
      },
      updateProject: () => {
        counters.update++;
        return Promise.reject(new Error("update must never run here"));
      },
      transitionProject: (
        _request: Request,
        _context: unknown,
        projectId: string,
        body: ApiV1TransitionProjectBody,
        // deno-lint-ignore no-explicit-any
        executionContext: any,
      ) => {
        counters.transition++;
        order.push("execute");
        captured.push({ projectId, body, executionContext });
        return Promise.resolve(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function transitionRequest(path = PATH, method = "POST"): Request {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
}

Deno.test("API-N.7: pipeline order is authenticate → authorize → rateLimit → delegated execute", async () => {
  const d = transitionDeps(APPLIED);
  const ok = await executeApiTransitionProjectRoute(
    transitionRequest(),
    base(),
    "req-1",
    ENABLED,
    d.deps,
  );
  assertEquals(ok.route, PROJECT_TRANSITION_ROUTE);
  assertEquals(ok.status, 200);
  assertEquals(ok.payload, APPLIED);
  assertEquals(ok.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });
  assertEquals(d.order, ["authenticate", "authorize", "rateLimit", "execute"]);
  assertEquals(d.counters.transition, 1);
  assertEquals(d.counters.create, 0);
  assertEquals(d.counters.update, 0);
  assertEquals(d.counters.authorize, 1);
  assertEquals(d.captured[0].projectId, PROJECT_ID);
  assertEquals(d.captured[0].body.targetStatus, "completed");
  assertEquals(d.captured[0].body.confirmWarnings, false);
  assertEquals(d.captured[0].executionContext.sourceChannel, "external_api");
  assertEquals(d.captured[0].executionContext.delegationMode, "delegated_user");
});

Deno.test("API-N.7: no_change and replayed are bounded 200 successes", async () => {
  for (const outcome of ["no_change", "replayed"] as const) {
    const d = transitionDeps({ ...APPLIED, outcome });
    const ok = await executeApiTransitionProjectRoute(
      transitionRequest(),
      base(),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(ok.status, 200);
    assertEquals(ok.payload.outcome, outcome);
  }
});

Deno.test("API-N.7: blocked and confirmation_required are bounded 409 structural results", async () => {
  for (const result of [BLOCKED, CONFIRMATION]) {
    const d = transitionDeps(result);
    const out = await executeApiTransitionProjectRoute(
      transitionRequest(),
      base(),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(out.status, 409);
    assertEquals(out.payload, result);
    assertEquals(out.route, PROJECT_TRANSITION_ROUTE);
  }
});

Deno.test("API-N.7: negative wrapper outcomes map to their exact stable HTTP errors", async () => {
  for (
    const [outcome, code] of [
      ["conflict", "concurrency_conflict"],
      ["invalid", "invalid_request"],
      ["not_authorized", "not_authorized"],
      ["idempotency_conflict", "idempotency_conflict"],
      ["idempotency_pending", "idempotency_pending"],
    ] as const
  ) {
    const payload = outcome === "conflict"
      ? { ok: false, outcome, code: "stale_project" }
      : { ok: false, outcome };
    const d = transitionDeps(payload);
    const err = await assertRejects(
      () =>
        executeApiTransitionProjectRoute(
          transitionRequest(),
          base(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, code);
    // `stale_project` must never reach the caller.
    assert(!JSON.stringify(err.message ?? "").includes("stale_project"));
  }
});

Deno.test("API-N.7: any other method or path is refused", async () => {
  for (
    const [method, path] of [
      ["GET", PATH],
      ["PATCH", PATH],
      ["PUT", PATH],
      ["DELETE", PATH],
      ["POST", "/v1/projects"],
      ["POST", `/v1/projects/${PROJECT_ID}`],
      ["POST", `/v1/projects/${NIL}/transition`],
      ["POST", `/v1/projects/${PROJECT_ID}/transition/`],
    ] as const
  ) {
    const d = transitionDeps(APPLIED);
    const err = await assertRejects(
      () =>
        executeApiTransitionProjectRoute(
          transitionRequest(path, method),
          base(),
          "req-1",
          ENABLED,
          d.deps,
        ),
      ApiHttpError,
    );
    assert(
      err.code === "route_not_found" || err.code === "invalid_request",
      `unexpected code ${err.code} for ${method} ${path}`,
    );
    assertEquals(d.counters.transition, 0);
  }
});

Deno.test("API-N.7: the route fails closed when mutations are disabled", async () => {
  const disabled = parseApiRuntimeControls({
    BTPM_API_ENABLED: "true",
    BTPM_API_READS_ENABLED: "true",
    BTPM_API_MUTATIONS_ENABLED: "false",
  });
  const d = transitionDeps(APPLIED);
  await assertRejects(
    () =>
      executeApiTransitionProjectRoute(
        transitionRequest(),
        base(),
        "req-1",
        disabled,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(d.counters.transition, 0);
});

Deno.test("API-N.7: a missing delegated executor fails closed with internal_error", async () => {
  const d = transitionDeps(APPLIED);
  const deps = { ...d.deps, transitionProject: undefined };
  const err = await assertRejects(
    () =>
      executeApiTransitionProjectRoute(
        transitionRequest(),
        base(),
        "req-1",
        ENABLED,
        // deno-lint-ignore no-explicit-any
        deps as any,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

// ---------------------------------------------------------------------------
// 6. RPC adapter and delegated caller-bound executor
// ---------------------------------------------------------------------------

Deno.test("API-N.7: the adapter calls exactly the accepted wrapper with exact arguments", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: APPLIED, error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  const result = await transitionApiV1Project(client, {
    expectedOauthClientId: OAUTH_CLIENT_ID,
    projectId: PROJECT_ID,
    expectedUpdatedAt: UPDATED_AT,
    targetStatus: "completed",
    confirmWarnings: true,
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "key-1",
    payloadHash: "a".repeat(64),
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_transition_project");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _project_id: PROJECT_ID,
    _expected_updated_at: UPDATED_AT,
    _target_status: "completed",
    _confirm_warnings: true,
    _request_id: "req-1",
    _correlation_id: "corr-1",
    _idempotency_key: "key-1",
    _payload_hash: "a".repeat(64),
  });
  assertEquals(result, APPLIED);
});

Deno.test("API-N.7: the adapter rejects unbounded or unexpected wrapper output", async () => {
  for (
    const data of [
      null,
      "x",
      { ok: true, outcome: "applied" },
      { ok: true, outcome: "weird", projectId: PROJECT_ID },
      { ...APPLIED, extra: 1 },
      { ...APPLIED, status: "DONE" },
      {
        ok: false,
        outcome: "blocked",
        code: "completion_hard_blocked",
        projectId: PROJECT_ID,
        hardBlocks: [{ code: "leaked_narrative", message: "m", count: 1 }],
        warnings: [],
        counts: {},
      },
      {
        ok: false,
        outcome: "confirmation_required",
        code: "completion_soft_warnings",
        projectId: PROJECT_ID,
        warnings: [{ code: "open_risks", message: "m", count: 1 }],
        counts: { unexpected_key: 1 },
      },
    ]
  ) {
    const client = {
      rpc: () => Promise.resolve({ data, error: null }),
      // deno-lint-ignore no-explicit-any
    } as any;
    const err = await assertRejects(
      () =>
        transitionApiV1Project(client, {
          expectedOauthClientId: OAUTH_CLIENT_ID,
          projectId: PROJECT_ID,
          expectedUpdatedAt: UPDATED_AT,
          targetStatus: "completed",
          confirmWarnings: false,
          requestId: "req-1",
          correlationId: "corr-1",
          idempotencyKey: "key-1",
          payloadHash: "a".repeat(64),
        }),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("API-N.7: an insufficient_privilege SQLSTATE maps to not_authorized", async () => {
  const client = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42501" } }),
    // deno-lint-ignore no-explicit-any
  } as any;
  const err = await assertRejects(
    () =>
      transitionApiV1Project(client, {
        expectedOauthClientId: OAUTH_CLIENT_ID,
        projectId: PROJECT_ID,
        expectedUpdatedAt: UPDATED_AT,
        targetStatus: "completed",
        confirmWarnings: false,
        requestId: "req-1",
        correlationId: "corr-1",
        idempotencyKey: "key-1",
        payloadHash: "a".repeat(64),
      }),
    ApiHttpError,
  );
  assertEquals(err.code, "not_authorized");
});

Deno.test("API-N.7: the delegated executor binds the caller token to a fresh anon-key client", async () => {
  const factoryCalls: Array<{ url: string; key: string; auth: string }> = [];
  const executor = createDelegatedApiV1TransitionProjectExecutor(
    "https://project.supabase.co",
    "anon-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        auth: options.global.headers.Authorization,
      });
      return {
        rpc: () => Promise.resolve({ data: APPLIED, error: null }),
      };
    },
  );

  const request = new Request(`https://api.example.test${PATH}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });

  const executionContext = {
    requestedUserId: USER_ID,
    executingUserId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    sourceChannel: "external_api",
    delegationMode: "delegated_user",
    requestId: "req-1",
    correlationId: "corr-1",
    idempotencyKey: "key-1",
    payloadHash: "a".repeat(64),
    // deno-lint-ignore no-explicit-any
  } as any;

  const result = await executor(
    request,
    AUTH_CONTEXT,
    PROJECT_ID,
    parseApiV1TransitionProjectBody(base({ confirmWarnings: true })),
    executionContext,
  );

  assertEquals(result, APPLIED);
  assertEquals(factoryCalls.length, 1);
  assertEquals(factoryCalls[0].key, "anon-key");
  assertEquals(factoryCalls[0].auth, "Bearer caller-token");

  // A second invocation must construct a second fresh client.
  await executor(
    request,
    AUTH_CONTEXT,
    PROJECT_ID,
    parseApiV1TransitionProjectBody(base()),
    executionContext,
  );
  assertEquals(factoryCalls.length, 2);
});

Deno.test("API-N.7: identity inconsistency between context and execution context fails closed", async () => {
  const executor = createDelegatedApiV1TransitionProjectExecutor(
    "https://project.supabase.co",
    "anon-key",
    () => ({ rpc: () => Promise.resolve({ data: APPLIED, error: null }) }),
  );
  const request = new Request(`https://api.example.test${PATH}`, {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const err = await assertRejects(
    () =>
      executor(
        request,
        AUTH_CONTEXT,
        PROJECT_ID,
        parseApiV1TransitionProjectBody(base()),
        // deno-lint-ignore no-explicit-any
        {
          requestedUserId: OTHER_ID,
          executingUserId: OTHER_ID,
          apiClientId: API_CLIENT_ID,
          oauthClientId: OAUTH_CLIENT_ID,
          policyVersionId: POLICY_VERSION_ID,
          sourceChannel: "external_api",
          delegationMode: "delegated_user",
          requestId: "req-1",
          correlationId: "corr-1",
          idempotencyKey: "key-1",
          payloadHash: "a".repeat(64),
        } as any,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});
