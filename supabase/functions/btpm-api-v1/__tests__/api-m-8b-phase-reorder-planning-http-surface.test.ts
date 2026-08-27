// API-M.8B — Phase reorder/planning HTTP surface regression tests.
//
// These tests are pure: no environment variable, network call, Supabase SDK or
// database is touched. They prove route registration, strict path matching,
// closed-schema body validation, idempotency payload folding, caller-scoped
// delegated execution and bounded outcome mapping for exactly two targets:
//   POST  /v1/projects/<validated UUID>/phases/reorder
//   PATCH /v1/phases/<validated UUID>/planning

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiPlanPhaseRoute,
  executeApiReorderPhasesRoute,
  matchApiRoute,
  parseApiRuntimeControls,
} from "../router.ts";
import {
  buildApiV1PlanPhaseIdempotencyPayload,
  buildApiV1ReorderPhasesIdempotencyPayload,
  parseApiV1PhasePlanningPath,
  parseApiV1PhaseReorderPath,
  parseApiV1PlanPhaseBody,
  parseApiV1ReorderPhasesBody,
  PHASE_PLANNING_ROUTE,
  PHASE_REORDER_ROUTE,
} from "../routes/phases.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  createDelegatedApiV1PlanPhaseExecutor,
  createDelegatedApiV1ReorderPhasesExecutor,
} from "../../_shared/btpm-api/supabaseDelegatedPhase.ts";

const PROJECT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PHASE_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const PHASE_ID_2 = "1d2f4b6a-7c8e-4a0b-8f1d-2c3b4a5d6e7f";
const NIL = "00000000-0000-0000-0000-000000000000";
const UPDATED_AT = "2026-02-01T10:00:00.000Z";

const REORDER_PATH = `/v1/projects/${PROJECT_ID}/phases/reorder`;
const PLANNING_PATH = `/v1/phases/${PHASE_ID}/planning`;

// ---------------------------------------------------------------------------
// A. Route registration and strict matching
// ---------------------------------------------------------------------------

Deno.test("API-M.8B: the two routes occupy the final frozen allowlist positions", () => {
  // Step-local: only the frozen positions are asserted here. Global allowlist
  // cardinality is owned by routes.test.ts.
  assertEquals(API_V1_ROUTE_ALLOWLIST[17], PHASE_REORDER_ROUTE);
  assertEquals(API_V1_ROUTE_ALLOWLIST[18], PHASE_PLANNING_ROUTE);
  assert(Object.isFrozen(PHASE_REORDER_ROUTE));
  assert(Object.isFrozen(PHASE_PLANNING_ROUTE));

  assertEquals(PHASE_REORDER_ROUTE.id, "phases.reorder");
  assertEquals(PHASE_REORDER_ROUTE.method, "POST");
  assertEquals(
    PHASE_REORDER_ROUTE.path,
    "/v1/projects/:projectid/phases/reorder",
  );
  assertEquals(PHASE_REORDER_ROUTE.operation, "mutation");

  assertEquals(PHASE_PLANNING_ROUTE.id, "phases.plan");
  assertEquals(PHASE_PLANNING_ROUTE.method, "PATCH");
  assertEquals(PHASE_PLANNING_ROUTE.path, "/v1/phases/:phaseid/planning");
  assertEquals(PHASE_PLANNING_ROUTE.operation, "mutation");
});

Deno.test("API-M.8B: matchApiRoute resolves exactly the two planning-surface targets", () => {
  assertEquals(matchApiRoute("POST", REORDER_PATH), PHASE_REORDER_ROUTE);
  assertEquals(matchApiRoute("PATCH", PLANNING_PATH), PHASE_PLANNING_ROUTE);
});

Deno.test("API-M.8B: matchApiRoute rejects every near-miss target", () => {
  const rejected: readonly (readonly [string, string])[] = [
    ["PATCH", REORDER_PATH],
    ["POST", `${REORDER_PATH}/`],
    ["POST", `${REORDER_PATH}/extra`],
    ["POST", `/v1/projects/${PROJECT_ID}/phases`],
    ["POST", "/v1/projects/not-a-uuid/phases/reorder"],
    ["POST", `/v1/PROJECTS/${PROJECT_ID}/phases/reorder`],
    ["POST", PLANNING_PATH],
    ["PATCH", `${PLANNING_PATH}/`],
    ["PATCH", `${PLANNING_PATH}/extra`],
    ["PATCH", "/v1/phases/not-a-uuid/planning"],
    ["PUT", REORDER_PATH],
    ["DELETE", PLANNING_PATH],
  ];
  for (const [method, path] of rejected) {
    assertEquals(matchApiRoute(method, path), null, `${method} ${path}`);
  }
});

// ---------------------------------------------------------------------------
// B. Path parsers
// ---------------------------------------------------------------------------

Deno.test("API-M.8B: reorder path parser accepts only a canonical non-nil Project UUID", () => {
  assertEquals(parseApiV1PhaseReorderPath(REORDER_PATH), {
    projectId: PROJECT_ID,
  });
  for (
    const path of [
      `/v1/projects/${NIL}/phases/reorder`,
      "/v1/projects//phases/reorder",
      "/v1/projects/not-a-uuid/phases/reorder",
      `/v1/projects/${PROJECT_ID}/phases/reorder/`,
      `/v1/projects/${PROJECT_ID}/phases/REORDER`,
      `/v1/projects/${PROJECT_ID}/phases`,
    ]
  ) {
    const err = assertThrowsApi(() => parseApiV1PhaseReorderPath(path));
    assertEquals(err.code, "invalid_request", path);
  }
});

Deno.test("API-M.8B: planning path parser accepts only a canonical non-nil Phase UUID", () => {
  assertEquals(parseApiV1PhasePlanningPath(PLANNING_PATH), {
    phaseId: PHASE_ID,
  });
  for (
    const path of [
      `/v1/phases/${NIL}/planning`,
      "/v1/phases//planning",
      "/v1/phases/not-a-uuid/planning",
      `/v1/phases/${PHASE_ID}/planning/`,
      `/v1/phases/${PHASE_ID}`,
    ]
  ) {
    const err = assertThrowsApi(() => parseApiV1PhasePlanningPath(path));
    assertEquals(err.code, "invalid_request", path);
  }
});

function assertThrowsApi(fn: () => unknown): ApiHttpError {
  try {
    fn();
  } catch (cause) {
    assert(cause instanceof ApiHttpError);
    return cause;
  }
  throw new Error("expected ApiHttpError");
}

// ---------------------------------------------------------------------------
// C. Closed-schema body parsers
// ---------------------------------------------------------------------------

function reorderBody(): Record<string, unknown> {
  return {
    rows: [
      { phaseId: PHASE_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 0 },
      { phaseId: PHASE_ID_2, expectedUpdatedAt: UPDATED_AT, sortOrder: 1 },
    ],
  };
}

function planBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    expectedUpdatedAt: UPDATED_AT,
    startDate: "2026-03-01",
    targetEndDate: "2026-04-01",
    confirmParentExtension: false,
    ...overrides,
  };
}

Deno.test("API-M.8B: reorder body accepts exactly `rows` with exactly three row keys", () => {
  const parsed = parseApiV1ReorderPhasesBody(reorderBody());
  assertEquals(parsed.rows.length, 2);
  assertEquals(parsed.rows[0], {
    phaseId: PHASE_ID,
    expectedUpdatedAt: UPDATED_AT,
    sortOrder: 0,
  });
  assert(Object.isFrozen(parsed));
  assert(Object.isFrozen(parsed.rows));

  const rejected: unknown[] = [
    null,
    [],
    "rows",
    {},
    { rows: [] },
    { rows: {} },
    { rows: reorderBody().rows, extra: 1 },
    { rows: [{ phaseId: PHASE_ID, expectedUpdatedAt: UPDATED_AT }] },
    {
      rows: [{
        phaseId: PHASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        sortOrder: 0,
        extra: 1,
      }],
    },
    { rows: [{ phaseId: NIL, expectedUpdatedAt: UPDATED_AT, sortOrder: 0 }] },
    {
      rows: [{
        phaseId: PHASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        sortOrder: -1,
      }],
    },
    {
      rows: [{
        phaseId: PHASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        sortOrder: 1.5,
      }],
    },
    { rows: [{ phaseId: PHASE_ID, expectedUpdatedAt: "", sortOrder: 0 }] },
    // Reorder never accepts sibling planning or metadata fields.
    { rows: reorderBody().rows, projectId: PROJECT_ID },
  ];
  for (const input of rejected) {
    const err = assertThrowsApi(() => parseApiV1ReorderPhasesBody(input));
    assertEquals(err.code, "invalid_request");
  }
});

Deno.test("API-M.8B: planning body accepts exactly the four planning keys", () => {
  const parsed = parseApiV1PlanPhaseBody(planBody());
  assertEquals(parsed, {
    expectedUpdatedAt: UPDATED_AT,
    startDate: "2026-03-01",
    targetEndDate: "2026-04-01",
    confirmParentExtension: false,
  });
  assert(Object.isFrozen(parsed));
  // Explicit nulls clear planning dates.
  assertEquals(
    parseApiV1PlanPhaseBody(planBody({ startDate: null, targetEndDate: null })),
    {
      expectedUpdatedAt: UPDATED_AT,
      startDate: null,
      targetEndDate: null,
      confirmParentExtension: false,
    },
  );

  const rejected: unknown[] = [
    null,
    [],
    {},
    planBodyWithout("expectedUpdatedAt"),
    planBodyWithout("startDate"),
    planBodyWithout("targetEndDate"),
    planBodyWithout("confirmParentExtension"),
    planBody({ extra: 1 }),
    // Scope, metadata, status and preview flags are never accepted here.
    planBody({ phaseId: PHASE_ID }),
    planBody({ name: "x" }),
    planBody({ status: "active" }),
    planBody({ confirmParentExtension: "true" }),
    planBody({ expectedUpdatedAt: "" }),
    planBody({ startDate: "2026-13-01" }),
    // Inverted window is rejected at the transport boundary.
    planBody({ startDate: "2026-05-01", targetEndDate: "2026-04-01" }),
  ];
  for (const input of rejected) {
    const err = assertThrowsApi(() => parseApiV1PlanPhaseBody(input));
    assertEquals(err.code, "invalid_request");
  }
});

function planBodyWithout(key: string): Record<string, unknown> {
  const body = planBody();
  delete body[key];
  return body;
}

// ---------------------------------------------------------------------------
// D. Idempotency payloads fold the URL identity
// ---------------------------------------------------------------------------

Deno.test("API-M.8B: reorder idempotency payload folds in the path Project ID", () => {
  const body = parseApiV1ReorderPhasesBody(reorderBody());
  const payload = buildApiV1ReorderPhasesIdempotencyPayload(PROJECT_ID, body);
  assertEquals(Object.keys(payload).sort(), ["projectId", "rows"]);
  assertEquals(payload.projectId, PROJECT_ID);
  assertEquals(payload.rows.length, 2);
  assert(Object.isFrozen(payload));

  const other = buildApiV1ReorderPhasesIdempotencyPayload(PHASE_ID, body);
  assert(JSON.stringify(payload) !== JSON.stringify(other));
});

Deno.test("API-M.8B: planning idempotency payload folds in the path Phase ID", () => {
  const body = parseApiV1PlanPhaseBody(planBody());
  const payload = buildApiV1PlanPhaseIdempotencyPayload(PHASE_ID, body);
  assertEquals(payload.phaseId, PHASE_ID);
  assertEquals(Object.keys(payload).sort(), [
    "confirmParentExtension",
    "expectedUpdatedAt",
    "phaseId",
    "startDate",
    "targetEndDate",
  ]);
  assert(Object.isFrozen(payload));

  const other = buildApiV1PlanPhaseIdempotencyPayload(PHASE_ID_2, body);
  assert(JSON.stringify(payload) !== JSON.stringify(other));
});

// ---------------------------------------------------------------------------
// E. Caller-scoped delegated executors
// ---------------------------------------------------------------------------

const USER_ID = "5b9d1b1e-9d3e-4a2f-9b0f-6c1a2d3e4f50";
const API_CLIENT_ID = "b1c2d3e4-f506-4718-8920-a1b2c3d4e5f6";
const OAUTH_CLIENT_ID = "btpm-test-client";
const POLICY_VERSION_ID = "c2d3e4f5-0617-4829-9a31-b2c3d4e5f607";

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

const EXEC_CONTEXT = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: OAUTH_CLIENT_ID,
  policyVersionId: POLICY_VERSION_ID,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  sourceChannel: "external_api",
  sourceClientId: API_CLIENT_ID,
  delegationMode: "delegated_user",
  // deno-lint-ignore no-explicit-any
}) as any;

const REORDER_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  submittedCount: 2,
  changedCount: 2,
  orderedPhases: [
    { phaseId: PHASE_ID, sortOrder: 0, updatedAt: UPDATED_AT },
    { phaseId: PHASE_ID_2, sortOrder: 1, updatedAt: UPDATED_AT },
  ],
});

const PLAN_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  phaseId: PHASE_ID,
  projectId: PROJECT_ID,
  startDate: "2026-03-01",
  targetEndDate: "2026-04-01",
  updatedAt: UPDATED_AT,
  projectExtended: false,
  projectStartDate: "2026-01-01",
  projectTargetEndDate: "2026-12-31",
});

const PLAN_CONFIRMATION = Object.freeze({
  ok: false,
  outcome: "confirmation_required",
  code: "extend_project_window_required",
  projectId: PROJECT_ID,
  projectCurrentStart: "2026-01-01",
  projectCurrentTargetEnd: "2026-06-30",
  projectProposedStart: "2026-01-01",
  projectProposedTargetEnd: "2026-08-31",
  requestedPhaseStart: "2026-03-01",
  requestedPhaseEnd: "2026-08-31",
});

Deno.test("API-M.8B: delegated executors bind the anon key + caller bearer per call", async () => {
  const seen: Array<{ url: string; key: string; auth: string }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const clients: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  const factory = (url: string, key: string, options: any) => {
    seen.push({ url, key, auth: options.global.headers.Authorization });
    const client = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({
          data: fn === "api_v1_reorder_phases" ? REORDER_OK : PLAN_OK,
          error: null,
        });
      },
    };
    clients.push(client);
    return client;
  };

  const reorderExec = createDelegatedApiV1ReorderPhasesExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const planExec = createDelegatedApiV1PlanPhaseExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );

  const reorderRequest = new Request(`https://x${REORDER_PATH}`, {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const planRequest = new Request(`https://x${PLANNING_PATH}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });

  const reordered = await reorderExec(
    reorderRequest,
    AUTH_CONTEXT,
    PROJECT_ID,
    parseApiV1ReorderPhasesBody(reorderBody()),
    EXEC_CONTEXT,
  );
  const planned = await planExec(
    planRequest,
    AUTH_CONTEXT,
    PHASE_ID,
    parseApiV1PlanPhaseBody(planBody()),
    EXEC_CONTEXT,
  );

  assertEquals(reordered.ok, true);
  assertEquals(planned.ok, true);
  assertEquals(seen.length, 2);
  assertEquals(clients.length, 2);
  assert(clients[0] !== clients[1]);
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(rpcCalls.map((c) => c.fn), [
    "api_v1_reorder_phases",
    "api_v1_plan_phase",
  ]);

  const source = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/supabaseDelegatedPhase.ts", import.meta.url),
  );
  assert(!source.includes("SERVICE_ROLE"));
  assert(!source.includes("service_role"));
  assert(!source.includes("Deno.env"));
});

Deno.test("API-M.8B: delegated executors reject identity / channel drift", async () => {
  const factory = () => ({
    rpc: () => Promise.resolve({ data: REORDER_OK, error: null }),
  });
  const exec = createDelegatedApiV1ReorderPhasesExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const request = new Request(`https://x${REORDER_PATH}`, {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const body = parseApiV1ReorderPhasesBody(reorderBody());

  const drifts: Array<Record<string, unknown>> = [
    { executingUserId: "99999999-9999-4999-8999-999999999999" },
    { requestedUserId: "99999999-9999-4999-8999-999999999999" },
    { apiClientId: "99999999-9999-4999-8999-999999999999" },
    { oauthClientId: "other-client" },
    { policyVersionId: "99999999-9999-4999-8999-999999999999" },
    { sourceChannel: "browser" },
    { delegationMode: "service" },
  ];
  for (const drift of drifts) {
    const err = await assertRejects(
      () =>
        exec(request, AUTH_CONTEXT, PROJECT_ID, body, {
          ...EXEC_CONTEXT,
          ...drift,
        }),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

// ---------------------------------------------------------------------------
// F. Router pipeline outcomes
// ---------------------------------------------------------------------------

const ENABLED = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "true",
});

const MUTATIONS_OFF = parseApiRuntimeControls({
  BTPM_API_ENABLED: "true",
  BTPM_API_READS_ENABLED: "true",
  BTPM_API_MUTATIONS_ENABLED: "false",
});

function planningDeps(reorderResult: unknown, planResult: unknown) {
  const counters = { reorder: 0, plan: 0, authorize: 0 };
  const order: string[] = [];
  return {
    counters,
    order,
    deps: {
      authenticate: () => Promise.resolve(AUTH_CONTEXT),
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
      createPhase: () => Promise.reject(new Error("unexpected create")),
      updatePhase: () => Promise.reject(new Error("unexpected update")),
      reorderPhases: () => {
        counters.reorder++;
        order.push("execute");
        return Promise.resolve(reorderResult);
      },
      planPhase: () => {
        counters.plan++;
        order.push("execute");
        return Promise.resolve(planResult);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function reorderRequest() {
  return new Request(`https://x${REORDER_PATH}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

function planRequest() {
  return new Request(`https://x${PLANNING_PATH}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

Deno.test("API-M.8B: reorder maps applied/no_change/replayed → 200 after authorize+rateLimit", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const d = planningDeps({ ...REORDER_OK, outcome }, PLAN_OK);
    const r = await executeApiReorderPhasesRoute(
      reorderRequest(),
      reorderBody(),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(r.status, 200);
    assertEquals(r.route, PHASE_REORDER_ROUTE);
    assertEquals(d.counters.reorder, 1);
    assertEquals(d.counters.authorize, 1);
    assertEquals(d.order, ["authorize", "rateLimit", "execute"]);
    assertEquals(r.activityIdentity.apiClientId, API_CLIENT_ID);
    assertEquals(r.activityIdentity.actorUserId, USER_ID);
  }
});

Deno.test("API-M.8B: planning maps success → 200 and confirmation_required → 409", async () => {
  const ok = planningDeps(REORDER_OK, PLAN_OK);
  const r1 = await executeApiPlanPhaseRoute(
    planRequest(),
    planBody(),
    "req-1",
    ENABLED,
    ok.deps,
  );
  assertEquals(r1.status, 200);
  assertEquals(r1.route, PHASE_PLANNING_ROUTE);
  assertEquals(ok.counters.plan, 1);
  assertEquals(ok.order, ["authorize", "rateLimit", "execute"]);

  const confirm = planningDeps(REORDER_OK, PLAN_CONFIRMATION);
  const r2 = await executeApiPlanPhaseRoute(
    planRequest(),
    planBody(),
    "req-1",
    ENABLED,
    confirm.deps,
  );
  assertEquals(r2.status, 409);
  assertEquals(r2.payload, PLAN_CONFIRMATION);
});

Deno.test("API-M.8B: stale order/planning conflicts surface as concurrency_conflict only", async () => {
  const staleOrder = planningDeps({
    ok: false,
    outcome: "conflict",
    code: "stale_phase_order",
    projectId: PROJECT_ID,
    stalePhaseIds: [PHASE_ID],
  }, PLAN_OK);
  const e1 = await assertRejects(
    () =>
      executeApiReorderPhasesRoute(
        reorderRequest(),
        reorderBody(),
        "req-1",
        ENABLED,
        staleOrder.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "concurrency_conflict");
  assert(!JSON.stringify(e1.message).includes("stale_phase_order"));

  const stalePlanning = planningDeps(REORDER_OK, {
    ok: false,
    outcome: "conflict",
    code: "stale_phase_planning",
    currentUpdatedAt: UPDATED_AT,
  });
  const e2 = await assertRejects(
    () =>
      executeApiPlanPhaseRoute(
        planRequest(),
        planBody(),
        "req-1",
        ENABLED,
        stalePlanning.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "concurrency_conflict");
  assert(!JSON.stringify(e2.message).includes("stale_phase_planning"));
});

Deno.test("API-M.8B: negative outcomes map distinctly and safely", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["invalid", "invalid_request"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, code] of cases) {
    const dr = planningDeps({ ok: false, outcome }, PLAN_OK);
    const e1 = await assertRejects(
      () =>
        executeApiReorderPhasesRoute(
          reorderRequest(),
          reorderBody(),
          "req-1",
          ENABLED,
          dr.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e1.code, code, outcome);

    const dp = planningDeps(REORDER_OK, { ok: false, outcome });
    const e2 = await assertRejects(
      () =>
        executeApiPlanPhaseRoute(
          planRequest(),
          planBody(),
          "req-1",
          ENABLED,
          dp.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e2.code, code, outcome);
  }
});

Deno.test("API-M.8B: the mutation switch blocks both routes before any execution", async () => {
  const d = planningDeps(REORDER_OK, PLAN_OK);
  const e1 = await assertRejects(
    () =>
      executeApiReorderPhasesRoute(
        reorderRequest(),
        reorderBody(),
        "req-1",
        MUTATIONS_OFF,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "api_unavailable");
  const e2 = await assertRejects(
    () =>
      executeApiPlanPhaseRoute(
        planRequest(),
        planBody(),
        "req-1",
        MUTATIONS_OFF,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "api_unavailable");
  assertEquals(d.counters.reorder, 0);
  assertEquals(d.counters.plan, 0);
  assertEquals(d.counters.authorize, 0);
});

Deno.test("API-M.8B: pipelines refuse cross-route requests and query/fragment variants", async () => {
  const d = planningDeps(REORDER_OK, PLAN_OK);
  const crossed = new Request(`https://x${PLANNING_PATH}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
  const e1 = await assertRejects(
    () =>
      executeApiReorderPhasesRoute(
        crossed,
        reorderBody(),
        "req-1",
        ENABLED,
        d.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "route_not_found");

  for (const suffix of ["?x=1", "#frag"]) {
    const req = new Request(`https://x${PLANNING_PATH}${suffix}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer caller-token",
        "Idempotency-Key": "key-1",
      },
      body: "{}",
    });
    await assertRejects(
      () =>
        executeApiPlanPhaseRoute(req, planBody(), "req-1", ENABLED, d.deps),
      ApiHttpError,
    );
  }
  assertEquals(d.counters.reorder, 0);
  assertEquals(d.counters.plan, 0);
});

Deno.test("API-M.8B: both pipelines fail closed on a malformed dependency surface", async () => {
  const partial = { authenticate: () => Promise.resolve(AUTH_CONTEXT) };
  const e1 = await assertRejects(
    () =>
      executeApiReorderPhasesRoute(
        reorderRequest(),
        reorderBody(),
        "req-1",
        ENABLED,
        // deno-lint-ignore no-explicit-any
        partial as any,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "internal_error");
  const e2 = await assertRejects(
    () =>
      executeApiPlanPhaseRoute(
        planRequest(),
        planBody(),
        "req-1",
        ENABLED,
        // deno-lint-ignore no-explicit-any
        partial as any,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "internal_error");
});

Deno.test("API-M.8B: bounded success payloads carry no Phase narrative content", () => {
  const reorderText = JSON.stringify(REORDER_OK).toLowerCase();
  for (const banned of ["name", "description", "notes", "narrative"]) {
    assert(!reorderText.includes(banned), banned);
  }
  const planText = JSON.stringify(PLAN_OK).toLowerCase();
  for (const banned of ["name", "description", "notes", "narrative"]) {
    assert(!planText.includes(banned), banned);
  }
});

Deno.test("API-M.8B: the route module stays pure and free of runtime access", async () => {
  const source = await Deno.readTextFile(
    new URL("../routes/phases.ts", import.meta.url),
  );
  for (
    const banned of [
      "Deno.env",
      "createClient",
      "fetch(",
      "@supabase/supabase-js",
      "console.",
      "setTimeout",
    ]
  ) {
    assert(!source.includes(banned), banned);
  }
});
