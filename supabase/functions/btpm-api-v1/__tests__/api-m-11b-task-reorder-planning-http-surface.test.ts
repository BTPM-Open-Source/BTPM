// API-M.11B — Task reorder/planning HTTP surface regression tests.
//
// Pure tests: no environment variable, network call, Supabase SDK or database
// is touched. They prove route registration, strict path matching, closed-schema
// body validation, idempotency payload folding, caller-scoped delegated
// execution, bounded outcome mapping and durable activity attribution for
// exactly two targets:
//   POST  /v1/phases/<validated UUID>/tasks/reorder
//   PATCH /v1/tasks/<validated UUID>/planning

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiPlanTaskRoute,
  executeApiReorderTasksRoute,
  matchApiRoute,
  parseApiRuntimeControls,
  type ApiRuntimeControls,
} from "../router.ts";
import {
  buildApiV1PlanTaskIdempotencyPayload,
  buildApiV1ReorderTasksIdempotencyPayload,
  parseApiV1PlanTaskBody,
  parseApiV1ReorderTasksBody,
  parseApiV1TaskPlanningPath,
  parseApiV1TaskReorderPath,
  TASK_PLANNING_ROUTE,
  TASK_REORDER_ROUTE,
} from "../routes/tasks.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  planApiV1Task,
  reorderApiV1Tasks,
} from "../../_shared/btpm-api/supabaseTask.ts";
import {
  createDelegatedApiV1PlanTaskExecutor,
  createDelegatedApiV1ReorderTasksExecutor,
} from "../../_shared/btpm-api/supabaseDelegatedTask.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";

const TASK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TASK_ID_2 = "9b2f4c1a-5d33-4a8b-9c17-3d5f8e2a6b44";
const PHASE_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const PROJECT_ID = "dddddddd-4444-4444-8444-444444444444";
const API_CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const POLICY_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "btpm-external-client";
const ALLOWED_ORIGIN = "https://app.example.com";
const LIVE_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const NIL = "00000000-0000-0000-0000-000000000000";
const UPDATED_AT = "2026-02-01T10:00:00.000Z";

const REORDER_PATH = `/v1/phases/${PHASE_ID}/tasks/reorder`;
const PLANNING_PATH = `/v1/tasks/${TASK_ID}/planning`;

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

function reorderBase(overrides: Record<string, unknown> = {}) {
  return {
    rows: [
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 0 },
      { taskId: TASK_ID_2, expectedUpdatedAt: UPDATED_AT, sortOrder: 1 },
    ],
    ...overrides,
  };
}

function planBase(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: UPDATED_AT,
    startDate: "2026-03-01",
    dueDate: "2026-03-15",
    confirmParentExtension: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. Route registration and strict matching
// ---------------------------------------------------------------------------

Deno.test("API-M.11B: the two Task routes occupy the final frozen allowlist positions", () => {
  // Step-local: global allowlist cardinality is owned by routes.test.ts.
  assertEquals(API_V1_ROUTE_ALLOWLIST[21], TASK_REORDER_ROUTE);
  assertEquals(API_V1_ROUTE_ALLOWLIST[22], TASK_PLANNING_ROUTE);
  assert(Object.isFrozen(TASK_REORDER_ROUTE));
  assert(Object.isFrozen(TASK_PLANNING_ROUTE));

  assertEquals(TASK_REORDER_ROUTE.id, "tasks.reorder");
  assertEquals(TASK_REORDER_ROUTE.method, "POST");
  assertEquals(TASK_REORDER_ROUTE.path, "/v1/phases/:phaseid/tasks/reorder");
  assertEquals(TASK_REORDER_ROUTE.operation, "mutation");

  assertEquals(TASK_PLANNING_ROUTE.id, "tasks.plan");
  assertEquals(TASK_PLANNING_ROUTE.method, "PATCH");
  assertEquals(TASK_PLANNING_ROUTE.path, "/v1/tasks/:taskid/planning");
  assertEquals(TASK_PLANNING_ROUTE.operation, "mutation");
});

Deno.test("API-M.11B: route matching accepts exactly the two frozen shapes", () => {
  assertEquals(matchApiRoute("POST", REORDER_PATH), TASK_REORDER_ROUTE);
  assertEquals(matchApiRoute("PATCH", PLANNING_PATH), TASK_PLANNING_ROUTE);

  // Wrong methods never match.
  assertEquals(matchApiRoute("PATCH", REORDER_PATH), null);
  assertEquals(matchApiRoute("POST", PLANNING_PATH), null);
  assertEquals(matchApiRoute("GET", REORDER_PATH), null);
  assertEquals(matchApiRoute("DELETE", PLANNING_PATH), null);

  // Near-miss paths never match.
  for (
    const path of [
      "/v1/phases/reorder",
      `/v1/phases/${PHASE_ID}/tasks`,
      `/v1/phases/${PHASE_ID}/tasks/reorder/`,
      `/v1/phases/${PHASE_ID}/tasks/reorder/extra`,
      `/v1/tasks/${TASK_ID}/planning/extra`,
      `/v1/tasks/${TASK_ID}/plan`,
      "/v1/tasks/planning",
    ]
  ) {
    assertEquals(matchApiRoute("POST", path), null, path);
    assertEquals(matchApiRoute("PATCH", path), null, path);
  }
});

Deno.test("API-M.11B: capabilities advertise the two new operations exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations;
  assertEquals(ops.filter((o) => o === "tasks.reorder").length, 1);
  assertEquals(ops.filter((o) => o === "tasks.plan").length, 1);
  // Positions are relative: later steps append further operations.
  const planIndex = ops.indexOf("tasks.plan");
  assertEquals(ops[planIndex - 1], "tasks.reorder");
});

// ---------------------------------------------------------------------------
// B. Strict path parsers
// ---------------------------------------------------------------------------

Deno.test("API-M.11B: reorder path parser accepts only a non-nil UUID Phase segment", () => {
  assertEquals(parseApiV1TaskReorderPath(REORDER_PATH), { phaseId: PHASE_ID });

  for (
    const path of [
      "/v1/phases//tasks/reorder",
      `/v1/phases/${NIL}/tasks/reorder`,
      "/v1/phases/not-a-uuid/tasks/reorder",
      `/v1/phases/${PHASE_ID.toUpperCase()}x/tasks/reorder`,
      `/v1/phases/${PHASE_ID}%2F/tasks/reorder`,
      `/v1/phases/${PHASE_ID};v=1/tasks/reorder`,
      `/v1/phases/${PHASE_ID}/x/tasks/reorder`,
      `/v1/phases/ ${PHASE_ID}/tasks/reorder`,
      `/V1/phases/${PHASE_ID}/tasks/reorder`,
      `/v1/tasks/${TASK_ID}/planning`,
    ]
  ) {
    assertInvalid(() => parseApiV1TaskReorderPath(path));
  }
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => parseApiV1TaskReorderPath(null as any),
    ApiHttpError,
  );
});

Deno.test("API-M.11B: planning path parser accepts only a non-nil UUID Task segment", () => {
  assertEquals(parseApiV1TaskPlanningPath(PLANNING_PATH), { taskId: TASK_ID });

  for (
    const path of [
      "/v1/tasks//planning",
      `/v1/tasks/${NIL}/planning`,
      "/v1/tasks/not-a-uuid/planning",
      `/v1/tasks/${TASK_ID}/planning/extra`,
      `/v1/tasks/${TASK_ID}?x=1/planning`,
      `/v1/tasks/${TASK_ID}\\/planning`,
      `/v1/tasks/${TASK_ID}`,
      REORDER_PATH,
    ]
  ) {
    assertInvalid(() => parseApiV1TaskPlanningPath(path));
  }
});

// ---------------------------------------------------------------------------
// C. Closed-schema body parsers
// ---------------------------------------------------------------------------

Deno.test("API-M.11B: reorder body accepts exactly {rows:[{taskId,expectedUpdatedAt,sortOrder}]}", () => {
  const parsed = parseApiV1ReorderTasksBody(reorderBase());
  assertEquals(parsed.rows.length, 2);
  assertEquals(parsed.rows[0], {
    taskId: TASK_ID,
    expectedUpdatedAt: UPDATED_AT,
    sortOrder: 0,
  });
  assert(Object.isFrozen(parsed));
  assert(Object.isFrozen(parsed.rows));

  // Unknown / missing / duplicated top-level keys.
  assertInvalid(() => parseApiV1ReorderTasksBody(reorderBase({ phaseId: PHASE_ID })));
  assertInvalid(() => parseApiV1ReorderTasksBody({}));
  assertInvalid(() => parseApiV1ReorderTasksBody({ rows: [] }));
  assertInvalid(() => parseApiV1ReorderTasksBody({ rows: {} }));
  assertInvalid(() => parseApiV1ReorderTasksBody(null));
  assertInvalid(() => parseApiV1ReorderTasksBody([]));
  assertInvalid(() => parseApiV1ReorderTasksBody("rows"));

  // Row shape is closed.
  for (
    const row of [
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT },
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 0, x: 1 },
      { taskId: NIL, expectedUpdatedAt: UPDATED_AT, sortOrder: 0 },
      { taskId: "nope", expectedUpdatedAt: UPDATED_AT, sortOrder: 0 },
      { taskId: TASK_ID, expectedUpdatedAt: "2026-02-01", sortOrder: 0 },
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: -1 },
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 1.5 },
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: "1" },
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: null },
      null,
      "row",
      [],
    ]
  ) {
    assertInvalid(() => parseApiV1ReorderTasksBody({ rows: [row] }));
  }

  // Bounded batch size — a transport bound only.
  const many = Array.from({ length: 1000 }, (_v, i) => ({
    taskId: TASK_ID,
    expectedUpdatedAt: UPDATED_AT,
    sortOrder: i,
  }));
  assertEquals(parseApiV1ReorderTasksBody({ rows: many }).rows.length, 1000);
  assertInvalid(() =>
    parseApiV1ReorderTasksBody({
      rows: [...many, {
        taskId: TASK_ID,
        expectedUpdatedAt: UPDATED_AT,
        sortOrder: 1000,
      }],
    })
  );

  // Sibling completeness, uniqueness and contiguity stay with the command.
  const duplicated = parseApiV1ReorderTasksBody({
    rows: [
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 5 },
      { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 5 },
    ],
  });
  assertEquals(duplicated.rows.length, 2);
});

Deno.test("API-M.11B: planning body accepts exactly the four planning fields", () => {
  const parsed = parseApiV1PlanTaskBody(planBase());
  assertEquals(parsed, {
    expectedUpdatedAt: UPDATED_AT,
    startDate: "2026-03-01",
    dueDate: "2026-03-15",
    confirmParentExtension: false,
  });
  assert(Object.isFrozen(parsed));

  // Explicit clearing is allowed on both sides.
  assertEquals(
    parseApiV1PlanTaskBody(planBase({ startDate: null, dueDate: null })),
    {
      expectedUpdatedAt: UPDATED_AT,
      startDate: null,
      dueDate: null,
      confirmParentExtension: false,
    },
  );
  assertEquals(
    parseApiV1PlanTaskBody(planBase({ confirmParentExtension: true }))
      .confirmParentExtension,
    true,
  );
  // Equal dates are a valid single-day window.
  assertEquals(
    parseApiV1PlanTaskBody(planBase({ dueDate: "2026-03-01" })).dueDate,
    "2026-03-01",
  );

  // Every field is required; no partial planning patch exists.
  for (
    const key of [
      "expectedUpdatedAt",
      "startDate",
      "dueDate",
      "confirmParentExtension",
    ]
  ) {
    const partial = planBase();
    delete (partial as Record<string, unknown>)[key];
    assertInvalid(() => parseApiV1PlanTaskBody(partial));
  }

  // No scope identity, metadata, status, ordering or preview flag is accepted.
  for (
    const extra of [
      { confirmPhaseExtension: false },
      { confirmPhaseExtension: true },
      { phaseId: PHASE_ID },
      { projectId: PROJECT_ID },
      { taskId: TASK_ID },
      { name: "x" },
      { status: "active" },
      { sortOrder: 1 },
      { preview: true },
    ]
  ) {
    assertInvalid(() => parseApiV1PlanTaskBody(planBase(extra)));
  }

  // The old incorrect field name is not part of the external contract: it is
  // rejected both as an extra key and as a replacement for the canonical one.
  {
    const legacyOnly = planBase() as Record<string, unknown>;
    delete legacyOnly.confirmParentExtension;
    legacyOnly.confirmPhaseExtension = false;
    assertInvalid(() => parseApiV1PlanTaskBody(legacyOnly));
  }
  {
    const accepted = Object.keys(parseApiV1PlanTaskBody(planBase()));
    assert(!accepted.includes("confirmPhaseExtension"));
    assert(accepted.includes("confirmParentExtension"));
  }

  // Field-level validation.
  for (
    const bad of [
      { expectedUpdatedAt: "2026-03-01" },
      { expectedUpdatedAt: null },
      { startDate: "01-03-2026" },
      { startDate: "2026-03-01T00:00:00Z" },
      { dueDate: 20260301 },
      { confirmParentExtension: "true" },
      { confirmParentExtension: null },
      // Inverted window is a transport-level impossibility.
      { startDate: "2026-03-15", dueDate: "2026-03-01" },
    ]
  ) {
    assertInvalid(() => parseApiV1PlanTaskBody(planBase(bad)));
  }
  for (const bad of [null, [], "x", 1, undefined]) {
    assertInvalid(() => parseApiV1PlanTaskBody(bad));
  }
});

// ---------------------------------------------------------------------------
// D. Idempotency payload folding
// ---------------------------------------------------------------------------

Deno.test("API-M.11B: reorder idempotency payload folds the URL Phase identity", () => {
  const body = parseApiV1ReorderTasksBody(reorderBase());
  const payload = buildApiV1ReorderTasksIdempotencyPayload(PHASE_ID, body);
  assertEquals(payload.phaseId, PHASE_ID);
  assertEquals(payload.rows.length, 2);
  assert(Object.isFrozen(payload));

  // A different Phase yields a different canonical payload.
  const other = buildApiV1ReorderTasksIdempotencyPayload(TASK_ID, body);
  assert(JSON.stringify(payload) !== JSON.stringify(other));

  // No transport metadata leaks into the hashed payload.
  const serialized = JSON.stringify(payload).toLowerCase();
  assert(!serialized.includes("authorization"));
  assert(!serialized.includes("bearer"));
  assert(!serialized.includes("idempotency"));

  assertThrows(
    () => buildApiV1ReorderTasksIdempotencyPayload("", body),
    ApiHttpError,
  );
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => buildApiV1ReorderTasksIdempotencyPayload(PHASE_ID, null as any),
    ApiHttpError,
  );
});

Deno.test("API-M.11B: planning idempotency payload folds the URL Task identity", () => {
  const body = parseApiV1PlanTaskBody(planBase());
  const payload = buildApiV1PlanTaskIdempotencyPayload(TASK_ID, body);
  assertEquals(payload, {
    taskId: TASK_ID,
    expectedUpdatedAt: UPDATED_AT,
    startDate: "2026-03-01",
    dueDate: "2026-03-15",
    confirmParentExtension: false,
  });
  assert(Object.isFrozen(payload));

  const other = buildApiV1PlanTaskIdempotencyPayload(TASK_ID_2, body);
  assert(JSON.stringify(payload) !== JSON.stringify(other));

  // Confirmation is part of the hashed intent, not a replay of the same call.
  const confirmed = buildApiV1PlanTaskIdempotencyPayload(
    TASK_ID,
    parseApiV1PlanTaskBody(planBase({ confirmParentExtension: true })),
  );
  assert(JSON.stringify(payload) !== JSON.stringify(confirmed));

  assertThrows(
    () => buildApiV1PlanTaskIdempotencyPayload("", body),
    ApiHttpError,
  );
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => buildApiV1PlanTaskIdempotencyPayload(TASK_ID, null as any),
    ApiHttpError,
  );
});

// ---------------------------------------------------------------------------
// E. RPC adapters — argument mapping and bounded result mapping
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function rpcClient(response: unknown, calls: RpcCall[] = []) {
  return {
    calls,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve(response);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

const REORDER_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  phaseId: PHASE_ID,
  rows: Object.freeze([
    { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, sortOrder: 0 },
    { taskId: TASK_ID_2, expectedUpdatedAt: UPDATED_AT, sortOrder: 1 },
  ]),
  requestId: "req-1",
  correlationId: "req-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
});

const PLAN_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  taskId: TASK_ID,
  expectedUpdatedAt: UPDATED_AT,
  startDate: "2026-03-01",
  dueDate: "2026-03-15",
  confirmParentExtension: false,
  requestId: "req-1",
  correlationId: "req-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
});

const REORDER_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  submittedCount: 2,
  changedCount: 1,
  orderedTasks: [
    { taskId: TASK_ID, sortOrder: 0, updatedAt: "2026-02-02T10:00:00.000Z" },
    { taskId: TASK_ID_2, sortOrder: 1, updatedAt: "2026-02-02T10:00:00.000Z" },
  ],
});

const PLAN_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  startDate: "2026-03-01",
  dueDate: "2026-03-15",
  updatedAt: "2026-02-02T10:00:00.000Z",
  phaseExtended: false,
  phaseStartDate: "2026-03-01",
  phaseTargetEndDate: "2026-03-31",
});

const PLAN_CONFIRMATION = Object.freeze({
  ok: false,
  outcome: "confirmation_required",
  code: "extend_phase_window_required",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  phaseCurrentStart: "2026-03-01",
  phaseCurrentTargetEnd: "2026-03-31",
  phaseProposedStart: "2026-03-01",
  phaseProposedTargetEnd: "2026-04-15",
  requestedTaskStart: "2026-03-01",
  requestedTaskDue: "2026-04-15",
});

Deno.test("API-M.11B: reorder adapter calls the accepted wrapper with canonical rows", async () => {
  const { client, calls } = rpcClient({ data: REORDER_OK, error: null });
  const result = await reorderApiV1Tasks(client, REORDER_INPUT);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_reorder_tasks");
  assertEquals(calls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
  assertEquals(calls[0].args._phase_id, PHASE_ID);
  assertEquals(calls[0].args._rows, [
    { id: TASK_ID, expected_updated_at: UPDATED_AT, new_sort_order: 0 },
    { id: TASK_ID_2, expected_updated_at: UPDATED_AT, new_sort_order: 1 },
  ]);
  assertEquals(calls[0].args._idempotency_key, "key-1");
  assertEquals(calls[0].args._payload_hash, "a".repeat(64));
  assertEquals(Object.keys(calls[0].args).length, 7);

  assertEquals(result.ok, true);
  assertEquals(result, REORDER_OK);
});

Deno.test("API-M.11B: planning adapter calls the accepted wrapper with canonical arguments", async () => {
  const { client, calls } = rpcClient({ data: PLAN_OK, error: null });
  const result = await planApiV1Task(client, PLAN_INPUT);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_plan_task");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _task_id: TASK_ID,
    _expected_updated_at: UPDATED_AT,
    _new_start: "2026-03-01",
    _new_due: "2026-03-15",
    _confirm_parent_extension: false,
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "key-1",
    _payload_hash: "a".repeat(64),
  });
  assertEquals(result, PLAN_OK);
});

Deno.test("API-M.11B: reorder result mapping covers replay, conflict and malformed data", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { client } = rpcClient({
      data: { ...REORDER_OK, outcome },
      error: null,
    });
    const result = await reorderApiV1Tasks(client, REORDER_INPUT);
    assertEquals(result.ok, true);
    assertEquals(result.outcome, outcome);
  }

  // Direct stale conflict carries the stale identities.
  const direct = rpcClient({
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_task_order",
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      staleTaskIds: [TASK_ID],
    },
    error: null,
  });
  assertEquals(await reorderApiV1Tasks(direct.client, REORDER_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_task_order",
    projectId: PROJECT_ID,
    phaseId: PHASE_ID,
    staleTaskIds: [TASK_ID],
  });

  // Failed-idempotency replay carries only the stable failure code.
  const replay = rpcClient({
    data: { ok: false, outcome: "conflict", code: "stale_task_order" },
    error: null,
  });
  assertEquals(await reorderApiV1Tasks(replay.client, REORDER_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_task_order",
    projectId: null,
    phaseId: null,
    staleTaskIds: [],
  });

  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const { client } = rpcClient({ data: { ok: false, outcome }, error: null });
    const result = await reorderApiV1Tasks(client, REORDER_INPUT);
    assertEquals(result.ok, false);
    assertEquals(result.outcome, outcome);
  }

  for (
    const data of [
      { ok: false, outcome: "conflict", code: "stale_task" },
      { ok: false, outcome: "mystery" },
      { ...REORDER_OK, extra: 1 },
      { ...REORDER_OK, outcome: "confirmation_required" },
      { ...REORDER_OK, phaseId: NIL },
      { ...REORDER_OK, changedCount: -1 },
      { ...REORDER_OK, orderedTasks: [{ taskId: TASK_ID, sortOrder: 0 }] },
      { ...REORDER_OK, orderedTasks: "x" },
      { ok: "true" },
      null,
      [],
      "x",
    ]
  ) {
    const { client } = rpcClient({ data, error: null });
    const err = await assertRejects(
      () => reorderApiV1Tasks(client, REORDER_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

Deno.test("API-M.11B: planning result mapping normalizes confirmation, replay and conflict", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { client } = rpcClient({ data: { ...PLAN_OK, outcome }, error: null });
    const result = await planApiV1Task(client, PLAN_INPUT);
    assertEquals(result.ok, true);
    assertEquals(result.outcome, outcome);
  }

  const confirm = rpcClient({ data: PLAN_CONFIRMATION, error: null });
  assertEquals(
    await planApiV1Task(confirm.client, PLAN_INPUT),
    PLAN_CONFIRMATION,
  );

  // A replayed confirmation is normalized back to `confirmation_required`.
  const replayedConfirm = rpcClient({
    data: { ...PLAN_CONFIRMATION, outcome: "replayed" },
    error: null,
  });
  assertEquals(
    await planApiV1Task(replayedConfirm.client, PLAN_INPUT),
    PLAN_CONFIRMATION,
  );

  const direct = rpcClient({
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_task_planning",
      currentUpdatedAt: "2026-02-03T10:00:00.000Z",
    },
    error: null,
  });
  assertEquals(await planApiV1Task(direct.client, PLAN_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_task_planning",
    currentUpdatedAt: "2026-02-03T10:00:00.000Z",
  });

  const replayConflict = rpcClient({
    data: { ok: false, outcome: "conflict", code: "stale_task_planning" },
    error: null,
  });
  assertEquals(await planApiV1Task(replayConflict.client, PLAN_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_task_planning",
    currentUpdatedAt: null,
  });

  for (
    const data of [
      { ...PLAN_CONFIRMATION, code: "something_else" },
      { ...PLAN_CONFIRMATION, extra: 1 },
      { ok: false, outcome: "conflict", code: "stale_task" },
      { ...PLAN_OK, extra: true },
      { ...PLAN_OK, updatedAt: "nope" },
      { ...PLAN_OK, phaseExtended: "false" },
      { ...PLAN_OK, startDate: "2026-03-01T00:00:00Z" },
      { ok: false, outcome: "mystery" },
      null,
      "x",
    ]
  ) {
    const { client } = rpcClient({ data, error: null });
    const err = await assertRejects(
      () => planApiV1Task(client, PLAN_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

Deno.test("API-M.11B: adapters fail closed on RPC transport errors and bad clients", async () => {
  const failing = {
    rpc: () => Promise.reject(new Error("boom")),
    // deno-lint-ignore no-explicit-any
  } as any;
  const e1 = await assertRejects(
    () => reorderApiV1Tasks(failing, REORDER_INPUT),
    ApiHttpError,
  );
  assertEquals(e1.code, "internal_error");
  const e2 = await assertRejects(
    () => planApiV1Task(failing, PLAN_INPUT),
    ApiHttpError,
  );
  assertEquals(e2.code, "internal_error");

  for (const bad of [null, {}, "client", 1]) {
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => reorderApiV1Tasks(bad as any, REORDER_INPUT),
      ApiHttpError,
    );
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => planApiV1Task(bad as any, PLAN_INPUT),
      ApiHttpError,
    );
  }

  // Empty reorder rows never reach the wrapper.
  const { client } = rpcClient({ data: REORDER_OK, error: null });
  await assertRejects(
    () => reorderApiV1Tasks(client, { ...REORDER_INPUT, rows: [] }),
    ApiHttpError,
  );
});

// ---------------------------------------------------------------------------
// F. Delegated caller-scoped execution
// ---------------------------------------------------------------------------

function authContext(userId: string, oauthClientId: string) {
  return {
    token: { userId, clientId: oauthClientId },
    client: {
      userId,
      oauthClientId,
      apiClientId: API_CLIENT_ID,
      policyVersionId: POLICY_VERSION_ID,
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

function executionContext(userId: string, oauthClientId: string) {
  return {
    requestedUserId: userId,
    executingUserId: userId,
    apiClientId: API_CLIENT_ID,
    oauthClientId,
    policyVersionId: POLICY_VERSION_ID,
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "key-1",
    payloadHash: "a".repeat(64),
    sourceChannel: "external_api",
    sourceClientId: API_CLIENT_ID,
    delegationMode: "delegated_user",
    // deno-lint-ignore no-explicit-any
  } as any;
}

const AUTH_CONTEXT = authContext(USER_ID, OAUTH_CLIENT_ID);
const EXEC_CONTEXT = executionContext(USER_ID, OAUTH_CLIENT_ID);

Deno.test("API-M.11B: delegated executors require the anon key and a client factory", () => {
  // deno-lint-ignore no-explicit-any
  const factory = ((): any => ({ rpc: () => Promise.resolve({}) })) as any;
  assertThrows(
    () => createDelegatedApiV1ReorderTasksExecutor("", "anon", factory),
    ApiHttpError,
  );
  assertThrows(
    () => createDelegatedApiV1PlanTaskExecutor("https://x", "", factory),
    ApiHttpError,
  );
  assertThrows(
    () =>
      createDelegatedApiV1PlanTaskExecutor(
        "https://x",
        "anon",
        // deno-lint-ignore no-explicit-any
        null as any,
      ),
    ApiHttpError,
  );
});

Deno.test("API-M.11B: delegated executors bind anon key + caller bearer per call", async () => {
  const seen: Array<{ url: string; key: string; auth: string }> = [];
  const clients: unknown[] = [];
  const calls: RpcCall[] = [];
  // deno-lint-ignore no-explicit-any
  const factory = (url: string, key: string, options: any) => {
    seen.push({ url, key, auth: options.global.headers.Authorization });
    assertEquals(options.auth, {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    const client = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({
          data: fn === "api_v1_reorder_tasks" ? REORDER_OK : PLAN_OK,
          error: null,
        });
      },
    };
    clients.push(client);
    return client;
  };

  const reorder = createDelegatedApiV1ReorderTasksExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const plan = createDelegatedApiV1PlanTaskExecutor(
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

  const reordered = await reorder(
    reorderRequest,
    AUTH_CONTEXT,
    PHASE_ID,
    parseApiV1ReorderTasksBody(reorderBase()),
    EXEC_CONTEXT,
  );
  const planned = await plan(
    planRequest,
    AUTH_CONTEXT,
    TASK_ID,
    parseApiV1PlanTaskBody(planBase()),
    EXEC_CONTEXT,
  );

  assertEquals(reordered.ok, true);
  assertEquals(planned.ok, true);
  assertEquals(seen.length, 2);
  assertEquals(clients.length, 2);
  assert(clients[0] !== clients[1], "a fresh client per invocation");
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(calls.map((c) => c.fn), [
    "api_v1_reorder_tasks",
    "api_v1_plan_task",
  ]);
  // Scope identity comes from the validated path, provenance from the context.
  assertEquals(calls[0].args._phase_id, PHASE_ID);
  assertEquals(calls[1].args._task_id, TASK_ID);
  assertEquals(calls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
  assertEquals(calls[1].args._idempotency_key, "key-1");
});

Deno.test("API-M.11B: delegated executors reject identity and channel drift", async () => {
  let factoryCalls = 0;
  const factory = (() => {
    factoryCalls += 1;
    return { rpc: () => Promise.resolve({ data: REORDER_OK, error: null }) };
    // deno-lint-ignore no-explicit-any
  }) as any;
  const reorder = createDelegatedApiV1ReorderTasksExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const plan = createDelegatedApiV1PlanTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const request = new Request(`https://x${REORDER_PATH}`, {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const reorderBody = parseApiV1ReorderTasksBody(reorderBase());
  const planBody = parseApiV1PlanTaskBody(planBase());

  for (
    const drift of [
      { executingUserId: "99999999-9999-4999-8999-999999999999" },
      { requestedUserId: "99999999-9999-4999-8999-999999999999" },
      { apiClientId: "99999999-9999-4999-8999-999999999999" },
      { oauthClientId: "other-client" },
      { policyVersionId: "99999999-9999-4999-8999-999999999999" },
      { sourceChannel: "browser" },
      { delegationMode: "service" },
    ]
  ) {
    const e1 = await assertRejects(
      () =>
        reorder(request, AUTH_CONTEXT, PHASE_ID, reorderBody, {
          ...EXEC_CONTEXT,
          ...drift,
        }),
      ApiHttpError,
    );
    assertEquals(e1.code, "internal_error");
    const e2 = await assertRejects(
      () =>
        plan(request, AUTH_CONTEXT, TASK_ID, planBody, {
          ...EXEC_CONTEXT,
          ...drift,
        }),
      ApiHttpError,
    );
    assertEquals(e2.code, "internal_error");
  }
  assertEquals(factoryCalls, 0, "no client is built for a drifted identity");

  // Missing scope identity fails closed too.
  await assertRejects(
    () => reorder(request, AUTH_CONTEXT, "", reorderBody, EXEC_CONTEXT),
    ApiHttpError,
  );
  await assertRejects(
    () => plan(request, AUTH_CONTEXT, "", planBody, EXEC_CONTEXT),
    ApiHttpError,
  );
});

// ---------------------------------------------------------------------------
// G. Router pipeline outcome mapping
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

function taskDeps(reorderResult: unknown, planResult: unknown) {
  const counters = { reorder: 0, plan: 0, authorize: 0, exec: 0 };
  const order: string[] = [];
  const unreachable = () => Promise.reject(new Error("unreachable"));
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
      createTask: unreachable,
      updateTask: unreachable,
      reorderTasks: () => {
        counters.reorder++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(reorderResult);
      },
      // API-M.11C — present but unreachable from these two pipelines.
      assignTask: unreachable,
      transitionTask: unreachable,
      planTask: () => {
        counters.plan++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(planResult);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function routerReorderRequest() {
  return new Request(`https://api.example.test${REORDER_PATH}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "idem-key-0001",
    },
    body: "{}",
  });
}

function routerPlanRequest() {
  return new Request(`https://api.example.test${PLANNING_PATH}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "idem-key-0001",
    },
    body: "{}",
  });
}

Deno.test("API-M.11B: reorder pipeline authorizes, rate-limits, then executes exactly once", async () => {
  const t = taskDeps(REORDER_OK, PLAN_OK);
  const result = await executeApiReorderTasksRoute(
    routerReorderRequest(),
    reorderBase(),
    "req-1",
    ENABLED,
    t.deps,
  );
  assertEquals(result.status, 200);
  assertEquals(result.route, TASK_REORDER_ROUTE);
  assertEquals(result.payload, REORDER_OK);
  assertEquals(result.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });
  assertEquals(t.counters, { reorder: 1, plan: 0, authorize: 1, exec: 1 });
  assertEquals(t.order, ["authorize", "rateLimit", "execute"]);
});

Deno.test("API-M.11B: planning pipeline maps success 200 and confirmation 409", async () => {
  const okDeps = taskDeps(REORDER_OK, PLAN_OK);
  const ok = await executeApiPlanTaskRoute(
    routerPlanRequest(),
    planBase(),
    "req-1",
    ENABLED,
    okDeps.deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(ok.route, TASK_PLANNING_ROUTE);
  assertEquals(ok.payload, PLAN_OK);
  assertEquals(okDeps.counters.plan, 1);

  const confirmDeps = taskDeps(REORDER_OK, PLAN_CONFIRMATION);
  const confirm = await executeApiPlanTaskRoute(
    routerPlanRequest(),
    planBase(),
    "req-1",
    ENABLED,
    confirmDeps.deps,
  );
  // Nothing changed; the bounded structural payload is returned with 409.
  assertEquals(confirm.status, 409);
  assertEquals(confirm.payload, PLAN_CONFIRMATION);
});

Deno.test("API-M.11B: bounded negative outcomes map to stable HTTP error codes", async () => {
  const cases: ReadonlyArray<[unknown, string]> = [
    [{
      ok: false,
      outcome: "conflict",
      code: "stale_task_order",
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      staleTaskIds: [TASK_ID],
    }, "concurrency_conflict"],
    [{ ok: false, outcome: "invalid" }, "invalid_request"],
    [{ ok: false, outcome: "not_authorized" }, "not_authorized"],
    [{ ok: false, outcome: "idempotency_conflict" }, "idempotency_conflict"],
    [{ ok: false, outcome: "idempotency_pending" }, "idempotency_pending"],
  ];
  for (const [result, code] of cases) {
    const t = taskDeps(result, PLAN_OK);
    const err = await assertRejects(
      () =>
        executeApiReorderTasksRoute(
          routerReorderRequest(),
          reorderBase(),
          "req-1",
          ENABLED,
          t.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, code);
  }

  const planCases: ReadonlyArray<[unknown, string]> = [
    [{
      ok: false,
      outcome: "conflict",
      code: "stale_task_planning",
      currentUpdatedAt: null,
    }, "concurrency_conflict"],
    [{ ok: false, outcome: "invalid" }, "invalid_request"],
    [{ ok: false, outcome: "not_authorized" }, "not_authorized"],
    [{ ok: false, outcome: "idempotency_conflict" }, "idempotency_conflict"],
    [{ ok: false, outcome: "idempotency_pending" }, "idempotency_pending"],
  ];
  for (const [result, code] of planCases) {
    const t = taskDeps(REORDER_OK, result);
    const err = await assertRejects(
      () =>
        executeApiPlanTaskRoute(
          routerPlanRequest(),
          planBase(),
          "req-1",
          ENABLED,
          t.deps,
        ),
      ApiHttpError,
    );
    assertEquals(err.code, code);
  }
});

Deno.test("API-M.11B: pipelines fail closed before any delegated execution", async () => {
  // Runtime switch off.
  const off = taskDeps(REORDER_OK, PLAN_OK);
  const e1 = await assertRejects(
    () =>
      executeApiReorderTasksRoute(
        routerReorderRequest(),
        reorderBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "api_unavailable");
  const e2 = await assertRejects(
    () =>
      executeApiPlanTaskRoute(
        routerPlanRequest(),
        planBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "api_unavailable");
  assertEquals(off.counters.exec, 0);

  // Invalid bodies never reach an executor.
  const badBody = taskDeps(REORDER_OK, PLAN_OK);
  const e3 = await assertRejects(
    () =>
      executeApiReorderTasksRoute(
        routerReorderRequest(),
        reorderBase({ phaseId: PHASE_ID }),
        "req-1",
        ENABLED,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e3.code, "invalid_request");
  const e4 = await assertRejects(
    () =>
      executeApiPlanTaskRoute(
        routerPlanRequest(),
        planBase({ name: "x" }),
        "req-1",
        ENABLED,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e4.code, "invalid_request");
  assertEquals(badBody.counters.exec, 0);

  // A missing Idempotency-Key is rejected before delegated execution.
  const noKey = taskDeps(REORDER_OK, PLAN_OK);
  const e5 = await assertRejects(
    () =>
      executeApiPlanTaskRoute(
        new Request(`https://api.example.test${PLANNING_PATH}`, {
          method: "PATCH",
          headers: { Authorization: "Bearer caller-token" },
          body: "{}",
        }),
        planBase(),
        "req-1",
        ENABLED,
        noKey.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e5.code, "invalid_request");
  assertEquals(noKey.counters.exec, 0);

  // Wrong pipeline for the pathname is refused.
  const crossed = taskDeps(REORDER_OK, PLAN_OK);
  const e6 = await assertRejects(
    () =>
      executeApiPlanTaskRoute(
        routerReorderRequest(),
        planBase(),
        "req-1",
        ENABLED,
        crossed.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e6.code, "route_not_found");
  assertEquals(crossed.counters.exec, 0);

  // Missing executors fail closed.
  const broken = taskDeps(REORDER_OK, PLAN_OK);
  // deno-lint-ignore no-explicit-any
  const missingReorder = { ...(broken.deps as any) };
  delete missingReorder.reorderTasks;
  const e7 = await assertRejects(
    () =>
      executeApiReorderTasksRoute(
        routerReorderRequest(),
        reorderBase(),
        "req-1",
        ENABLED,
        missingReorder,
      ),
    ApiHttpError,
  );
  assertEquals(e7.code, "internal_error");

  // deno-lint-ignore no-explicit-any
  const missingPlan = { ...(broken.deps as any) };
  delete missingPlan.planTask;
  const e8 = await assertRejects(
    () =>
      executeApiPlanTaskRoute(
        routerPlanRequest(),
        planBase(),
        "req-1",
        ENABLED,
        missingPlan,
      ),
    ApiHttpError,
  );
  assertEquals(e8.code, "internal_error");
});

// ---------------------------------------------------------------------------
// H. Live HTTP pipeline and durable activity semantics
// ---------------------------------------------------------------------------

const CONTROLS: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: true,
});

let executorCalls = 0;

function throwingRoute(): unknown {
  const fail = () => {
    executorCalls += 1;
    throw new Error("executor must never run");
  };
  return {
    authenticate: fail,
    authorizeRoute: fail,
    resolveRateLimitProfile: fail,
    rateLimit: { store: { consume: fail }, now: () => 0 },
    createTask: fail,
    updateTask: fail,
    reorderTasks: fail,
    planTask: fail,
    readMe: fail,
  };
}

interface ActivityTrace {
  records: Array<Record<string, unknown>>;
  scopeCalls: Array<{ targetType: string; targetId: string }>;
  scheduled: number;
}

let activityPending: Promise<boolean>[] = [];

function activityDeps(trace: ActivityTrace) {
  let clock = 1_000;
  return {
    recorder: {
      record: (input: Record<string, unknown>) => {
        trace.records.push(input);
        return Promise.resolve(true);
      },
    },
    scopeResolver: {
      resolve: (targetType: string, targetId: string) => (
        trace.scopeCalls.push({ targetType, targetId }),
          Promise.resolve({
            tenantId: "aaaaaaaa-1111-4111-8111-111111111111",
            organizationId: "bbbbbbbb-2222-4222-8222-222222222222",
            workspaceId: "cccccccc-3333-4333-8333-333333333333",
            projectId: PROJECT_ID,
          })
      ),
    },
    nowMs: () => (clock += 5),
    schedule: (task: Promise<boolean>) => {
      trace.scheduled += 1;
      activityPending.push(task);
    },
  };
}

async function settleActivity(): Promise<void> {
  const tasks = activityPending;
  activityPending = [];
  await Promise.allSettled(tasks);
}

function liveDeps(
  trace: ActivityTrace,
  reorderResult: unknown = REORDER_OK,
  planResult: unknown = PLAN_OK,
): ApiV1HttpHandlerDependencies {
  return {
    controls: CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => LIVE_REQUEST_ID },
    protectedRoute: throwingRoute(),
    taskMutationRoute: {
      authenticate: () => Promise.resolve(AUTH_CONTEXT),
      authorizeRoute: () => Promise.resolve(),
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 100, windowSeconds: 60 }),
      rateLimit: {
        store: {
          consume: () =>
            Promise.resolve({
              allowed: true,
              remaining: 99,
              resetAtEpochMs: 1_700_000_000_000,
            }),
        },
        now: () => 1_600_000_000_000,
      },
      createTask: () => Promise.reject(new Error("unreachable")),
      updateTask: () => Promise.reject(new Error("unreachable")),
      reorderTasks: () => Promise.resolve(reorderResult),
      planTask: () => Promise.resolve(planResult),
      assignTask: () => Promise.reject(new Error("unreachable")),
      transitionTask: () => Promise.reject(new Error("unreachable")),
    },
    activity: activityDeps(trace),
  } as unknown as ApiV1HttpHandlerDependencies;
}

function liveRequest(method: "POST" | "PATCH", path: string, body: unknown) {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer caller-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-key-0001",
    }),
    body: JSON.stringify(body),
  });
}

async function codeOf(response: Response): Promise<string> {
  const payload = await response.json() as { error?: { code?: string } };
  return payload?.error?.code ?? "";
}

Deno.test("API-M.11B: live POST reorder returns 200 and records Phase-targeted activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("POST", REORDER_PATH, reorderBase()),
    liveDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), REORDER_OK);
  await settleActivity();
  assertEquals(trace.scheduled, 1);
  // A reorder is a Phase-level ordering mutation.
  assertEquals(trace.scopeCalls, [{ targetType: "phase", targetId: PHASE_ID }]);
  assertEquals(trace.records[0].routeId, "tasks.reorder");
  assertEquals(trace.records[0].method, "POST");
  assertEquals(trace.records[0].status, 200);
  assertEquals(trace.records[0].projectId, PROJECT_ID);
  assertEquals(trace.records[0].apiClientId, API_CLIENT_ID);
  assertEquals(trace.records[0].actorUserId, USER_ID);
  assertEquals(executorCalls, 0);
});

Deno.test("API-M.11B: live PATCH planning returns 200 and records Task-targeted activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("PATCH", PLANNING_PATH, planBase()),
    liveDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), PLAN_OK);
  await settleActivity();
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.scopeCalls, [{ targetType: "task", targetId: TASK_ID }]);
  assertEquals(trace.records[0].routeId, "tasks.plan");
  assertEquals(trace.records[0].method, "PATCH");
  assertEquals(trace.records[0].status, 200);
});

Deno.test("API-M.11B: live confirmation_required returns 409 and records no mutation activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("PATCH", PLANNING_PATH, planBase()),
    liveDeps(trace, REORDER_OK, PLAN_CONFIRMATION),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), PLAN_CONFIRMATION);
  await settleActivity();
  // Nothing changed, so no durable mutation activity is scheduled.
  assertEquals(trace.scheduled, 0);
  assertEquals(trace.records.length, 0);
  assertEquals(trace.scopeCalls.length, 0);
});

Deno.test("API-M.11B: live stale conflicts surface as a stable concurrency error", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("PATCH", PLANNING_PATH, planBase()),
    liveDeps(trace, REORDER_OK, {
      ok: false,
      outcome: "conflict",
      code: "stale_task_planning",
      currentUpdatedAt: "2026-02-03T10:00:00.000Z",
    }),
  );
  assertEquals(response.status, 409);
  assertEquals(await codeOf(response), "concurrency_conflict");
  await settleActivity();
  assertEquals(trace.scheduled, 0);
});

Deno.test("API-M.11B: live near-miss task paths and methods stay unrouted", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  for (
    const [method, path] of [
      ["POST", `/v1/phases/${NIL}/tasks/reorder`],
      ["POST", `/v1/phases/${PHASE_ID}/tasks/reorder/extra`],
      ["PATCH", `/v1/tasks/${TASK_ID}/planning/extra`],
      ["PATCH", `/v1/tasks/${TASK_ID}/assignee`],
      ["POST", `/v1/tasks/${TASK_ID}/planning`],
    ] as ReadonlyArray<["POST" | "PATCH", string]>
  ) {
    const response = await handleApiV1Request(
      liveRequest(method, path, method === "POST" ? reorderBase() : planBase()),
      liveDeps(trace),
    );
    assertEquals(response.status, 404, `${method} ${path}`);
  }
  await settleActivity();
  assertEquals(trace.scheduled, 0);
  assertEquals(executorCalls, 0);
});

Deno.test("API-M.11B: live CORS preflight advertises exactly the frozen task methods", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const reorderPreflight = await handleApiV1Request(
    new Request(`https://api.example.test${REORDER_PATH}`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      }),
    }),
    liveDeps(trace),
  );
  assertEquals(reorderPreflight.status, 204);

  const planPreflight = await handleApiV1Request(
    new Request(`https://api.example.test${PLANNING_PATH}`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "PATCH",
      }),
    }),
    liveDeps(trace),
  );
  assertEquals(planPreflight.status, 204);

  // An out-of-scope Task sub-resource is still not preflightable.
  const rejected = await handleApiV1Request(
    new Request(`https://api.example.test/v1/tasks/${TASK_ID}/assignee`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "PATCH",
      }),
    }),
    liveDeps(trace),
  );
  assertEquals(rejected.status, 404);
  assertEquals(executorCalls, 0);
});
