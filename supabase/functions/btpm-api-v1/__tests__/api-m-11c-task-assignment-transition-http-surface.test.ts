// API-M.11C — Task assignment + execution-transition HTTP surface regression.
//
// Pure tests: no environment variable, network call, Supabase SDK or database
// is touched. They prove route registration, strict path matching, closed-schema
// body validation, idempotency payload folding, caller-scoped delegated
// execution, bounded outcome mapping and durable activity attribution for
// exactly two targets:
//   PUT  /v1/tasks/<validated UUID>/assignee
//   POST /v1/tasks/<validated UUID>/transition

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  executeApiAssignTaskRoute,
  executeApiTransitionTaskRoute,
  matchApiRoute,
  parseApiRuntimeControls,
  type ApiRuntimeControls,
} from "../router.ts";
import {
  buildApiV1AssignTaskIdempotencyPayload,
  buildApiV1TransitionTaskIdempotencyPayload,
  parseApiV1AssignTaskBody,
  parseApiV1TaskAssignPath,
  parseApiV1TaskTransitionPath,
  parseApiV1TransitionTaskBody,
  TASK_ASSIGN_ROUTE,
  TASK_TRANSITION_ROUTE,
} from "../routes/tasks.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  assignApiV1Task,
  transitionApiV1Task,
} from "../../_shared/btpm-api/supabaseTask.ts";
import {
  createDelegatedApiV1AssignTaskExecutor,
  createDelegatedApiV1TransitionTaskExecutor,
} from "../../_shared/btpm-api/supabaseDelegatedTask.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";

const TASK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PHASE_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const PROJECT_ID = "dddddddd-4444-4444-8444-444444444444";
const ASSIGNEE_ID = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const API_CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const POLICY_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "btpm-external-client";
const ALLOWED_ORIGIN = "https://app.example.com";
const LIVE_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const NIL = "00000000-0000-0000-0000-000000000000";
const UPDATED_AT = "2026-02-01T10:00:00.000Z";

const ASSIGN_PATH = `/v1/tasks/${TASK_ID}/assignee`;
const TRANSITION_PATH = `/v1/tasks/${TASK_ID}/transition`;

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

function assignBase(overrides: Record<string, unknown> = {}) {
  return { assigneeId: ASSIGNEE_ID, ...overrides };
}

function transitionBase(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: UPDATED_AT,
    setActualStart: true,
    actualStartDate: "2026-03-01",
    setActualEnd: false,
    actualEndDate: null,
    status: "active",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. Route registration and strict matching
// ---------------------------------------------------------------------------

Deno.test("API-M.11C: the two Task routes are registered exactly once and frozen", () => {
  // Step-local: global topology (cardinality, order) is owned by
  // api-v1-current-surface-topology.test.ts.
  for (const route of [TASK_ASSIGN_ROUTE, TASK_TRANSITION_ROUTE]) {
    assertEquals(
      API_V1_ROUTE_ALLOWLIST.filter((r) => r === route).length,
      1,
      route.id,
    );
    assert(Object.isFrozen(route));
  }


  assertEquals(TASK_ASSIGN_ROUTE.id, "tasks.assign");
  assertEquals(TASK_ASSIGN_ROUTE.method, "PUT");
  assertEquals(TASK_ASSIGN_ROUTE.path, "/v1/tasks/:taskid/assignee");
  assertEquals(TASK_ASSIGN_ROUTE.operation, "mutation");

  assertEquals(TASK_TRANSITION_ROUTE.id, "tasks.transition");
  assertEquals(TASK_TRANSITION_ROUTE.method, "POST");
  assertEquals(TASK_TRANSITION_ROUTE.path, "/v1/tasks/:taskid/transition");
  assertEquals(TASK_TRANSITION_ROUTE.operation, "mutation");
});

Deno.test("API-M.11C: route matching accepts exactly the two frozen shapes", () => {
  assertEquals(matchApiRoute("PUT", ASSIGN_PATH), TASK_ASSIGN_ROUTE);
  assertEquals(matchApiRoute("POST", TRANSITION_PATH), TASK_TRANSITION_ROUTE);

  // Wrong methods never match.
  assertEquals(matchApiRoute("POST", ASSIGN_PATH), null);
  assertEquals(matchApiRoute("PATCH", ASSIGN_PATH), null);
  assertEquals(matchApiRoute("PUT", TRANSITION_PATH), null);
  assertEquals(matchApiRoute("PATCH", TRANSITION_PATH), null);
  assertEquals(matchApiRoute("DELETE", ASSIGN_PATH), null);




  // Near-miss paths never match.
  for (
    const path of [
      "/v1/tasks/assignee",
      "/v1/tasks/transition",
      `/v1/tasks/${TASK_ID}/assignee/`,
      `/v1/tasks/${TASK_ID}/assignee/extra`,
      `/v1/tasks/${TASK_ID}/transition/extra`,
      `/v1/tasks/${NIL}/assignee`,
      `/v1/tasks/${NIL}/transition`,
      `/v1/tasks/${TASK_ID}/assign`,
      `/v1/tasks/${TASK_ID}/transitions`,
    ]
  ) {
    assertEquals(matchApiRoute("PUT", path), null, path);
    assertEquals(matchApiRoute("POST", path), null, path);
  }
});

Deno.test("API-M.11C: capabilities advertise the two Task operations exactly once", () => {
  const ops = buildCapabilitiesPayload().supportedOperations as
    readonly string[];
  assertEquals(ops.filter((o) => o === "tasks.assign").length, 1);
  assertEquals(ops.filter((o) => o === "tasks.transition").length, 1);
  // Family-local relative order only.
  assertEquals(
    ops.filter((o) => o === "tasks.assign" || o === "tasks.transition"),
    ["tasks.assign", "tasks.transition"],
  );
});


// ---------------------------------------------------------------------------
// B. Strict path parsers
// ---------------------------------------------------------------------------

Deno.test("API-M.11C: path parsers accept exactly one validated Task identity", () => {
  assertEquals(parseApiV1TaskAssignPath(ASSIGN_PATH), { taskId: TASK_ID });
  assertEquals(parseApiV1TaskTransitionPath(TRANSITION_PATH), {
    taskId: TASK_ID,
  });
  assert(Object.isFrozen(parseApiV1TaskAssignPath(ASSIGN_PATH)));
  assert(Object.isFrozen(parseApiV1TaskTransitionPath(TRANSITION_PATH)));

  for (
    const bad of [
      "",
      "/",
      "/v1/tasks//assignee",
      `/v1/tasks/${NIL}/assignee`,
      `/v1/tasks/${TASK_ID.toUpperCase()}x/assignee`,
      `/v1/tasks/${TASK_ID}/assignee/`,
      `/v1/tasks/${TASK_ID}/assignee?x=1`,
      `/v1/TASKS/${TASK_ID}/assignee`,
      `/v2/tasks/${TASK_ID}/assignee`,
      "not-a-path",
    ]
  ) {
    assertInvalid(() => parseApiV1TaskAssignPath(bad));
  }
  for (
    const bad of [
      "",
      "/v1/tasks//transition",
      `/v1/tasks/${NIL}/transition`,
      `/v1/tasks/${TASK_ID}/transition/`,
      `/v1/tasks/${TASK_ID}/transition/extra`,
      `/v1/tasks/${TASK_ID}/assignee`,
    ]
  ) {
    assertInvalid(() => parseApiV1TaskTransitionPath(bad));
  }
});

// ---------------------------------------------------------------------------
// C. Closed-schema body parsers
// ---------------------------------------------------------------------------

Deno.test("API-M.11C: assignment body accepts exactly one key, UUID or explicit null", () => {
  const assigned = parseApiV1AssignTaskBody(assignBase());
  assertEquals(assigned, { assigneeId: ASSIGNEE_ID });
  assert(Object.isFrozen(assigned));

  const cleared = parseApiV1AssignTaskBody({ assigneeId: null });
  assertEquals(cleared, { assigneeId: null });

  for (
    const bad of [
      undefined,
      null,
      [],
      "x",
      1,
      true,
      {},
      { assigneeId: ASSIGNEE_ID, extra: 1 },
      // No concurrency token is accepted on assignment.
      { assigneeId: ASSIGNEE_ID, expectedUpdatedAt: UPDATED_AT },
      { assigneeId: NIL },
      { assigneeId: "" },
      { assigneeId: " " + ASSIGNEE_ID },
      { assigneeId: 1 },
      { assigneeId: undefined },
      { assigneeId: [ASSIGNEE_ID] },
      { assigneeId: { id: ASSIGNEE_ID } },
      // No identity, role, scope or metadata escape hatch exists.
      { assigneeId: ASSIGNEE_ID, role: "executor" },
      { assigneeId: ASSIGNEE_ID, projectId: PROJECT_ID },
      { assigneeId: ASSIGNEE_ID, userId: USER_ID },
    ]
  ) {
    assertInvalid(() => parseApiV1AssignTaskBody(bad));
  }
});

Deno.test("API-M.11C: transition body requires all six frozen keys", () => {
  const parsed = parseApiV1TransitionTaskBody(transitionBase());
  assertEquals(parsed, {
    expectedUpdatedAt: UPDATED_AT,
    setActualStart: true,
    actualStartDate: "2026-03-01",
    setActualEnd: false,
    actualEndDate: null,
    status: "active",
  });
  assert(Object.isFrozen(parsed));

  // Explicit clear and explicit "do not modify" are both representable.
  assertEquals(
    parseApiV1TransitionTaskBody(
      transitionBase({ setActualStart: true, actualStartDate: null }),
    ).actualStartDate,
    null,
  );
  assertEquals(
    parseApiV1TransitionTaskBody(transitionBase({ status: null })).status,
    null,
  );
  assertEquals(
    parseApiV1TransitionTaskBody(
      transitionBase({
        status: "completed",
        setActualEnd: true,
        actualEndDate: "2026-03-20",
      }),
    ).status,
    "completed",
  );

  const missing = transitionBase() as Record<string, unknown>;
  for (const key of Object.keys(missing)) {
    const clone = { ...missing };
    delete clone[key];
    assertInvalid(() => parseApiV1TransitionTaskBody(clone));
  }

  for (
    const bad of [
      undefined,
      null,
      [],
      "x",
      3,
      {},
      transitionBase({ extra: 1 }),
      transitionBase({ taskId: TASK_ID }),
      transitionBase({ expectedUpdatedAt: null }),
      transitionBase({ expectedUpdatedAt: "" }),
      transitionBase({ expectedUpdatedAt: "2026-02-01" }),
      transitionBase({ setActualStart: "true" }),
      transitionBase({ setActualEnd: 1 }),
      transitionBase({ actualStartDate: "01-03-2026" }),
      transitionBase({ actualStartDate: "2026-03-01T00:00:00Z" }),
      transitionBase({ setActualEnd: false, actualEndDate: "2026-03-20" }),
      transitionBase({ setActualStart: false, actualStartDate: "2026-03-01" }),
      transitionBase({ status: "done" }),
      transitionBase({ status: "ACTIVE" }),
      transitionBase({ status: "" }),
      transitionBase({ status: 1 }),
      // No caller-selected command, force flag or scope override.
      transitionBase({ force: true }),
      transitionBase({ command: "complete" }),
    ]
  ) {
    assertInvalid(() => parseApiV1TransitionTaskBody(bad));
  }
});

// ---------------------------------------------------------------------------
// D. Idempotency payload folding
// ---------------------------------------------------------------------------

Deno.test("API-M.11C: idempotency payloads fold the validated Task identity", () => {
  const assign = buildApiV1AssignTaskIdempotencyPayload(
    TASK_ID,
    parseApiV1AssignTaskBody(assignBase()),
  );
  assertEquals(assign, { taskId: TASK_ID, assigneeId: ASSIGNEE_ID });
  assert(Object.isFrozen(assign));

  // A different Task with an identical body is a different canonical payload.
  const other = buildApiV1AssignTaskIdempotencyPayload(
    ASSIGNEE_ID,
    parseApiV1AssignTaskBody(assignBase()),
  );
  assert(JSON.stringify(assign) !== JSON.stringify(other));

  // Assigning and clearing never collide.
  assert(
    JSON.stringify(assign) !== JSON.stringify(
      buildApiV1AssignTaskIdempotencyPayload(
        TASK_ID,
        parseApiV1AssignTaskBody({ assigneeId: null }),
      ),
    ),
  );

  const transition = buildApiV1TransitionTaskIdempotencyPayload(
    TASK_ID,
    parseApiV1TransitionTaskBody(transitionBase()),
  );
  assertEquals(transition, {
    taskId: TASK_ID,
    expectedUpdatedAt: UPDATED_AT,
    setActualStart: true,
    actualStartDate: "2026-03-01",
    setActualEnd: false,
    actualEndDate: null,
    status: "active",
  });
  assert(Object.isFrozen(transition));

  // Raw transport material never participates.
  for (const key of ["authorization", "idempotencyKey", "requestId", "url"]) {
    assertEquals(
      Object.prototype.hasOwnProperty.call(transition, key),
      false,
      key,
    );
  }

  for (const badId of ["", null, undefined, 1, {}]) {
    assertThrows(
      () =>
        buildApiV1AssignTaskIdempotencyPayload(
          // deno-lint-ignore no-explicit-any
          badId as any,
          parseApiV1AssignTaskBody(assignBase()),
        ),
      ApiHttpError,
    );
    assertThrows(
      () =>
        buildApiV1TransitionTaskIdempotencyPayload(
          // deno-lint-ignore no-explicit-any
          badId as any,
          parseApiV1TransitionTaskBody(transitionBase()),
        ),
      ApiHttpError,
    );
  }
});

// ---------------------------------------------------------------------------
// E. RPC adapters
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function rpcClient(response: unknown) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(response);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { client, calls };
}

const ASSIGN_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  oldAssigneeId: null,
  newAssigneeId: ASSIGNEE_ID,
});

const TRANSITION_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  status: "active",
  actualStartDate: "2026-03-01",
  actualEndDate: null,
  updatedAt: "2026-02-02T10:00:00.000Z",
});

const ASSIGN_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  taskId: TASK_ID,
  assigneeId: ASSIGNEE_ID,
  requestId: "req-1",
  correlationId: "req-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
});

const TRANSITION_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  taskId: TASK_ID,
  expectedUpdatedAt: UPDATED_AT,
  setActualStart: true,
  actualStartDate: "2026-03-01",
  setActualEnd: false,
  actualEndDate: null,
  status: "active",
  requestId: "req-1",
  correlationId: "req-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
});

Deno.test("API-M.11C: adapters call exactly the two accepted database wrappers", async () => {
  const assign = rpcClient({ data: ASSIGN_OK, error: null });
  const assigned = await assignApiV1Task(assign.client, ASSIGN_INPUT);
  assertEquals(assigned, ASSIGN_OK);
  assertEquals(assign.calls.length, 1);
  assertEquals(assign.calls[0].fn, "api_v1_assign_task");
  assertEquals(assign.calls[0].args._task_id, TASK_ID);
  assertEquals(assign.calls[0].args._assignee_id, ASSIGNEE_ID);
  assertEquals(
    assign.calls[0].args._expected_oauth_client_id,
    OAUTH_CLIENT_ID,
  );

  const cleared = rpcClient({ data: { ...ASSIGN_OK, newAssigneeId: null }, error: null });
  await assignApiV1Task(cleared.client, { ...ASSIGN_INPUT, assigneeId: null });
  assertEquals(cleared.calls[0].args._assignee_id, null);

  const transition = rpcClient({ data: TRANSITION_OK, error: null });
  const transitioned = await transitionApiV1Task(
    transition.client,
    TRANSITION_INPUT,
  );
  assertEquals(transitioned, TRANSITION_OK);
  assertEquals(transition.calls.length, 1);
  assertEquals(transition.calls[0].fn, "api_v1_transition_task");
  assertEquals(transition.calls[0].args._expected_updated_at, UPDATED_AT);
  assertEquals(transition.calls[0].args._set_actual_start, true);
  assertEquals(transition.calls[0].args._set_actual_end, false);
  assertEquals(transition.calls[0].args._actual_end_date, null);
  assertEquals(transition.calls[0].args._status, "active");
});

Deno.test("API-M.11C: adapters accept only bounded wrapper payloads", async () => {
  const conflict = rpcClient({
    data: { ok: false, outcome: "conflict", code: "stale_task" },
    error: null,
  });
  assertEquals(await transitionApiV1Task(conflict.client, TRANSITION_INPUT), {
    ok: false,
    outcome: "conflict",
    code: "stale_task",
  });

  for (const outcome of ["invalid", "not_authorized", "idempotency_conflict"]) {
    const { client } = rpcClient({ data: { ok: false, outcome }, error: null });
    assertEquals(await assignApiV1Task(client, ASSIGN_INPUT), {
      ok: false,
      // deno-lint-ignore no-explicit-any
      outcome: outcome as any,
    });
  }

  for (
    const data of [
      { ...ASSIGN_OK, extra: 1 },
      { ...ASSIGN_OK, outcome: "mystery" },
      { ...ASSIGN_OK, taskId: "nope" },
      { ok: false, outcome: "conflict", code: "stale_task" },
      { ok: true },
      null,
      "x",
      [],
    ]
  ) {
    const { client } = rpcClient({ data, error: null });
    const err = await assertRejects(
      () => assignApiV1Task(client, ASSIGN_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }

  for (
    const data of [
      { ...TRANSITION_OK, extra: 1 },
      { ...TRANSITION_OK, updatedAt: "nope" },
      { ok: false, outcome: "conflict", code: "stale_task_planning" },
      { ok: false, outcome: "mystery" },
      null,
      42,
    ]
  ) {
    const { client } = rpcClient({ data, error: null });
    const err = await assertRejects(
      () => transitionApiV1Task(client, TRANSITION_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

// ---------------------------------------------------------------------------
// E1. API-M.11C-C1 — returned-status vocabulary correction
// ---------------------------------------------------------------------------

const CANONICAL_TASK_STATUSES = [
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
] as const;

Deno.test("API-M.11C-C1: successful transition results accept every canonical Task status", async () => {
  for (const status of CANONICAL_TASK_STATUSES) {
    for (const outcome of ["applied", "no_change", "replayed"] as const) {
      const { client } = rpcClient({
        data: { ...TRANSITION_OK, outcome, status },
        error: null,
      });
      const result = await transitionApiV1Task(client, {
        ...TRANSITION_INPUT,
        status: null,
      });
      assertEquals(result.ok, true);
      assertEquals(
        result,
        { ...TRANSITION_OK, outcome, status },
        `${outcome}/${status}`,
      );
    }
  }
});

Deno.test("API-M.11C-C1: status:null retention keeps planned / on_hold / no_change results successful", async () => {
  // Planned Task, actual-date-only transition.
  const planned = rpcClient({
    data: { ...TRANSITION_OK, outcome: "applied", status: "planned" },
    error: null,
  });
  const plannedResult = await transitionApiV1Task(planned.client, {
    ...TRANSITION_INPUT,
    status: null,
  });
  assertEquals(plannedResult.ok, true);
  assertEquals((plannedResult as { status: string }).status, "planned");
  assertEquals(planned.calls[0].args._status, null);

  // On-hold Task.
  const onHold = rpcClient({
    data: { ...TRANSITION_OK, outcome: "applied", status: "on_hold" },
    error: null,
  });
  const onHoldResult = await transitionApiV1Task(onHold.client, {
    ...TRANSITION_INPUT,
    status: null,
  });
  assertEquals(onHoldResult.ok, true);
  assertEquals((onHoldResult as { status: string }).status, "on_hold");

  // no_change retaining the canonical current status.
  const noChange = rpcClient({
    data: { ...TRANSITION_OK, outcome: "no_change", status: "planned" },
    error: null,
  });
  const noChangeResult = await transitionApiV1Task(noChange.client, {
    ...TRANSITION_INPUT,
    status: null,
  });
  assertEquals(noChangeResult, {
    ...TRANSITION_OK,
    outcome: "no_change",
    status: "planned",
  });

  // Replay carrying a canonical status.
  const replayed = rpcClient({
    data: { ...TRANSITION_OK, outcome: "replayed", status: "cancelled" },
    error: null,
  });
  const replayedResult = await transitionApiV1Task(
    replayed.client,
    TRANSITION_INPUT,
  );
  assertEquals(replayedResult.ok, true);
  assertEquals((replayedResult as { status: string }).status, "cancelled");
});

Deno.test("API-M.11C-C1: noncanonical returned statuses fail closed", async () => {
  for (
    const status of [
      "not_started",
      "in_progress",
      "blocked",
      "unknown",
      "",
      "Active",
      null,
      7,
    ]
  ) {
    const { client } = rpcClient({
      data: { ...TRANSITION_OK, status },
      error: null,
    });
    const err = await assertRejects(
      () => transitionApiV1Task(client, TRANSITION_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(status));
  }
});

Deno.test("API-M.11C-C1: external transition INPUT status stays active | completed | null", async () => {
  for (const status of ["active", "completed"] as const) {
    const { client, calls } = rpcClient({
      data: { ...TRANSITION_OK, status },
      error: null,
    });
    await transitionApiV1Task(client, { ...TRANSITION_INPUT, status });
    assertEquals(calls[0].args._status, status);
  }

  const nulled = rpcClient({ data: TRANSITION_OK, error: null });
  await transitionApiV1Task(nulled.client, {
    ...TRANSITION_INPUT,
    status: null,
  });
  assertEquals(nulled.calls[0].args._status, null);

  for (const status of ["planned", "on_hold", "cancelled", "blocked", ""]) {
    const { client } = rpcClient({ data: TRANSITION_OK, error: null });
    const err = await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => transitionApiV1Task(client, { ...TRANSITION_INPUT, status } as any),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", status);
  }
});

Deno.test("API-M.11C-C1: adapters send exactly the frozen RPC argument keysets", async () => {
  const assign = rpcClient({ data: ASSIGN_OK, error: null });
  await assignApiV1Task(assign.client, ASSIGN_INPUT);
  assertEquals(Object.keys(assign.calls[0].args).sort(), [
    "_assignee_id",
    "_correlation_id",
    "_expected_oauth_client_id",
    "_idempotency_key",
    "_payload_hash",
    "_request_id",
    "_task_id",
  ]);

  const transition = rpcClient({ data: TRANSITION_OK, error: null });
  await transitionApiV1Task(transition.client, TRANSITION_INPUT);
  assertEquals(Object.keys(transition.calls[0].args).sort(), [
    "_actual_end_date",
    "_actual_start_date",
    "_correlation_id",
    "_expected_oauth_client_id",
    "_expected_updated_at",
    "_idempotency_key",
    "_payload_hash",
    "_request_id",
    "_set_actual_end",
    "_set_actual_start",
    "_status",
    "_task_id",
  ]);
});

Deno.test("API-M.11C-C1: RPC error envelopes map to not_authorized / internal_error without leakage", async () => {
  const cases = [
    { code: "42501", expected: "not_authorized" },
    { code: "P0001", expected: "internal_error" },
    { code: "23503", expected: "internal_error" },
    { code: undefined, expected: "internal_error" },
  ] as const;

  for (const { code, expected } of cases) {
    const error = {
      code,
      message: "permission denied for table tasks SECRET_DB_DETAIL",
      details: "SECRET_DB_DETAIL",
      hint: "SECRET_DB_DETAIL",
    };
    for (
      const run of [
        () => assignApiV1Task(rpcClient({ data: null, error }).client, ASSIGN_INPUT),
        () =>
          transitionApiV1Task(
            rpcClient({ data: null, error }).client,
            TRANSITION_INPUT,
          ),
      ]
    ) {
      const err = await assertRejects(run, ApiHttpError);
      assertEquals(err.code, expected, String(code));
      const serialized = JSON.stringify(err.toSafeJSON("req-1"));
      assertEquals(serialized.includes("SECRET_DB_DETAIL"), false);
      assertEquals(serialized.includes("tasks"), false);
    }
  }
});



Deno.test("API-M.11C: adapters fail closed on transport errors, bad clients and bad input", async () => {
  const failing = {
    rpc: () => Promise.reject(new Error("boom")),
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(
    (await assertRejects(
      () => assignApiV1Task(failing, ASSIGN_INPUT),
      ApiHttpError,
    )).code,
    "internal_error",
  );
  assertEquals(
    (await assertRejects(
      () => transitionApiV1Task(failing, TRANSITION_INPUT),
      ApiHttpError,
    )).code,
    "internal_error",
  );

  for (const bad of [null, {}, "client", 1]) {
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => assignApiV1Task(bad as any, ASSIGN_INPUT),
      ApiHttpError,
    );
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => transitionApiV1Task(bad as any, TRANSITION_INPUT),
      ApiHttpError,
    );
  }

  const ok = rpcClient({ data: ASSIGN_OK, error: null });
  for (
    const bad of [
      { ...ASSIGN_INPUT, taskId: NIL },
      { ...ASSIGN_INPUT, expectedOauthClientId: "" },
      { ...ASSIGN_INPUT, payloadHash: "short" },
      { ...ASSIGN_INPUT, idempotencyKey: "" },
    ]
  ) {
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => assignApiV1Task(ok.client, bad as any),
      ApiHttpError,
    );
  }

  const okT = rpcClient({ data: TRANSITION_OK, error: null });
  for (
    const bad of [
      { ...TRANSITION_INPUT, expectedUpdatedAt: "2026-02-01" },
      // A contradictory set-flag/date pair never reaches the wrapper.
      { ...TRANSITION_INPUT, setActualStart: false },
      { ...TRANSITION_INPUT, setActualEnd: false, actualEndDate: "2026-03-20" },
    ]
  ) {
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => transitionApiV1Task(okT.client, bad as any),
      ApiHttpError,
    );
  }
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

Deno.test("API-M.11C: delegated executors require the anon key and a client factory", () => {
  // deno-lint-ignore no-explicit-any
  const factory = ((): any => ({ rpc: () => Promise.resolve({}) })) as any;
  assertThrows(
    () => createDelegatedApiV1AssignTaskExecutor("", "anon", factory),
    ApiHttpError,
  );
  assertThrows(
    () => createDelegatedApiV1TransitionTaskExecutor("https://x", "", factory),
    ApiHttpError,
  );
  assertThrows(
    () =>
      createDelegatedApiV1AssignTaskExecutor(
        "https://x",
        "anon",
        // deno-lint-ignore no-explicit-any
        null as any,
      ),
    ApiHttpError,
  );
});

Deno.test("API-M.11C: delegated executors bind anon key + caller bearer per call", async () => {
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
          data: fn === "api_v1_assign_task" ? ASSIGN_OK : TRANSITION_OK,
          error: null,
        });
      },
    };
    clients.push(client);
    return client;
  };

  const assign = createDelegatedApiV1AssignTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const transition = createDelegatedApiV1TransitionTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );

  const assignRequest = new Request(`https://x${ASSIGN_PATH}`, {
    method: "PUT",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const transitionRequest = new Request(`https://x${TRANSITION_PATH}`, {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });

  const assigned = await assign(
    assignRequest,
    AUTH_CONTEXT,
    TASK_ID,
    parseApiV1AssignTaskBody(assignBase()),
    EXEC_CONTEXT,
  );
  const transitioned = await transition(
    transitionRequest,
    AUTH_CONTEXT,
    TASK_ID,
    parseApiV1TransitionTaskBody(transitionBase()),
    EXEC_CONTEXT,
  );

  assertEquals(assigned.ok, true);
  assertEquals(transitioned.ok, true);
  assertEquals(seen.length, 2);
  assertEquals(clients.length, 2);
  assert(clients[0] !== clients[1], "a fresh client per invocation");
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(calls.map((c) => c.fn), [
    "api_v1_assign_task",
    "api_v1_transition_task",
  ]);
  // Scope identity comes from the validated path, provenance from the context.
  assertEquals(calls[0].args._task_id, TASK_ID);
  assertEquals(calls[1].args._task_id, TASK_ID);
  assertEquals(calls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
  assertEquals(calls[1].args._idempotency_key, "key-1");
});

Deno.test("API-M.11C: delegated executors reject identity and channel drift", async () => {
  let factoryCalls = 0;
  const factory = (() => {
    factoryCalls += 1;
    return { rpc: () => Promise.resolve({ data: ASSIGN_OK, error: null }) };
    // deno-lint-ignore no-explicit-any
  }) as any;
  const assign = createDelegatedApiV1AssignTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const transition = createDelegatedApiV1TransitionTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const request = new Request(`https://x${ASSIGN_PATH}`, {
    method: "PUT",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const assignBody = parseApiV1AssignTaskBody(assignBase());
  const transitionBody = parseApiV1TransitionTaskBody(transitionBase());

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
        assign(request, AUTH_CONTEXT, TASK_ID, assignBody, {
          ...EXEC_CONTEXT,
          ...drift,
        }),
      ApiHttpError,
    );
    assertEquals(e1.code, "internal_error");
    const e2 = await assertRejects(
      () =>
        transition(request, AUTH_CONTEXT, TASK_ID, transitionBody, {
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
    () => assign(request, AUTH_CONTEXT, "", assignBody, EXEC_CONTEXT),
    ApiHttpError,
  );
  await assertRejects(
    () => transition(request, AUTH_CONTEXT, "", transitionBody, EXEC_CONTEXT),
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

function taskDeps(assignResult: unknown, transitionResult: unknown) {
  const counters = { assign: 0, transition: 0, authorize: 0, exec: 0 };
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
      reorderTasks: unreachable,
      planTask: unreachable,
      assignTask: () => {
        counters.assign++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(assignResult);
      },
      transitionTask: () => {
        counters.transition++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(transitionResult);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function routerAssignRequest() {
  return new Request(`https://api.example.test${ASSIGN_PATH}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "idem-key-0001",
    },
    body: "{}",
  });
}

function routerTransitionRequest() {
  return new Request(`https://api.example.test${TRANSITION_PATH}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "idem-key-0001",
    },
    body: "{}",
  });
}

Deno.test("API-M.11C: assignment pipeline authorizes, rate-limits, then executes exactly once", async () => {
  const t = taskDeps(ASSIGN_OK, TRANSITION_OK);
  const result = await executeApiAssignTaskRoute(
    routerAssignRequest(),
    assignBase(),
    "req-1",
    ENABLED,
    t.deps,
  );
  assertEquals(result.status, 200);
  assertEquals(result.route, TASK_ASSIGN_ROUTE);
  assertEquals(result.payload, ASSIGN_OK);
  assertEquals(result.activityIdentity, {
    apiClientId: API_CLIENT_ID,
    actorUserId: USER_ID,
  });
  assertEquals(t.counters, { assign: 1, transition: 0, authorize: 1, exec: 1 });
  assertEquals(t.order, ["authorize", "rateLimit", "execute"]);
});

Deno.test("API-M.11C: transition pipeline maps success and bounded no_change to 200", async () => {
  const t = taskDeps(ASSIGN_OK, TRANSITION_OK);
  const ok = await executeApiTransitionTaskRoute(
    routerTransitionRequest(),
    transitionBase(),
    "req-1",
    ENABLED,
    t.deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(ok.route, TASK_TRANSITION_ROUTE);
  assertEquals(ok.payload, TRANSITION_OK);
  assertEquals(t.counters.transition, 1);

  for (const outcome of ["no_change", "replayed"]) {
    const rep = taskDeps(ASSIGN_OK, { ...TRANSITION_OK, outcome });
    const res = await executeApiTransitionTaskRoute(
      routerTransitionRequest(),
      transitionBase(),
      "req-1",
      ENABLED,
      rep.deps,
    );
    assertEquals(res.status, 200);
    assertEquals(res.payload.outcome, outcome);
  }
});

Deno.test("API-M.11C: bounded negative outcomes map to stable HTTP error codes", async () => {
  const shared: ReadonlyArray<[unknown, string]> = [
    [{ ok: false, outcome: "invalid" }, "invalid_request"],
    [{ ok: false, outcome: "not_authorized" }, "not_authorized"],
    [{ ok: false, outcome: "idempotency_conflict" }, "idempotency_conflict"],
    [{ ok: false, outcome: "idempotency_pending" }, "idempotency_pending"],
  ];
  for (const [result, code] of shared) {
    const a = taskDeps(result, TRANSITION_OK);
    const e1 = await assertRejects(
      () =>
        executeApiAssignTaskRoute(
          routerAssignRequest(),
          assignBase(),
          "req-1",
          ENABLED,
          a.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e1.code, code);

    const t = taskDeps(ASSIGN_OK, result);
    const e2 = await assertRejects(
      () =>
        executeApiTransitionTaskRoute(
          routerTransitionRequest(),
          transitionBase(),
          "req-1",
          ENABLED,
          t.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e2.code, code);
  }

  // Only the transition route carries an optimistic-concurrency conflict.
  const conflict = taskDeps(ASSIGN_OK, {
    ok: false,
    outcome: "conflict",
    code: "stale_task",
  });
  const err = await assertRejects(
    () =>
      executeApiTransitionTaskRoute(
        routerTransitionRequest(),
        transitionBase(),
        "req-1",
        ENABLED,
        conflict.deps,
      ),
    ApiHttpError,
  );
  assertEquals(err.code, "concurrency_conflict");

  // An unmapped outcome never leaks.
  const weird = taskDeps({ ok: false, outcome: "mystery" }, TRANSITION_OK);
  const e3 = await assertRejects(
    () =>
      executeApiAssignTaskRoute(
        routerAssignRequest(),
        assignBase(),
        "req-1",
        ENABLED,
        weird.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e3.code, "internal_error");
});

Deno.test("API-M.11C: pipelines fail closed before any delegated execution", async () => {
  // Runtime switch off.
  const off = taskDeps(ASSIGN_OK, TRANSITION_OK);
  const e1 = await assertRejects(
    () =>
      executeApiAssignTaskRoute(
        routerAssignRequest(),
        assignBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "api_unavailable");
  const e2 = await assertRejects(
    () =>
      executeApiTransitionTaskRoute(
        routerTransitionRequest(),
        transitionBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "api_unavailable");
  assertEquals(off.counters.exec, 0);

  // Invalid bodies never reach an executor.
  const badBody = taskDeps(ASSIGN_OK, TRANSITION_OK);
  const e3 = await assertRejects(
    () =>
      executeApiAssignTaskRoute(
        routerAssignRequest(),
        assignBase({ expectedUpdatedAt: UPDATED_AT }),
        "req-1",
        ENABLED,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e3.code, "invalid_request");
  const e4 = await assertRejects(
    () =>
      executeApiTransitionTaskRoute(
        routerTransitionRequest(),
        transitionBase({ status: "done" }),
        "req-1",
        ENABLED,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e4.code, "invalid_request");
  assertEquals(badBody.counters.exec, 0);

  // A missing Idempotency-Key is rejected before delegated execution.
  const noKey = taskDeps(ASSIGN_OK, TRANSITION_OK);
  const e5 = await assertRejects(
    () =>
      executeApiAssignTaskRoute(
        new Request(`https://api.example.test${ASSIGN_PATH}`, {
          method: "PUT",
          headers: { Authorization: "Bearer caller-token" },
          body: "{}",
        }),
        assignBase(),
        "req-1",
        ENABLED,
        noKey.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e5.code, "invalid_request");
  assertEquals(noKey.counters.exec, 0);

  // Wrong pipeline for the pathname is refused.
  const crossed = taskDeps(ASSIGN_OK, TRANSITION_OK);
  const e6 = await assertRejects(
    () =>
      executeApiTransitionTaskRoute(
        routerAssignRequest(),
        transitionBase(),
        "req-1",
        ENABLED,
        crossed.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e6.code, "route_not_found");
  assertEquals(crossed.counters.exec, 0);

  // Missing executors fail closed.
  const broken = taskDeps(ASSIGN_OK, TRANSITION_OK);
  // deno-lint-ignore no-explicit-any
  const missingAssign = { ...(broken.deps as any) };
  delete missingAssign.assignTask;
  const e7 = await assertRejects(
    () =>
      executeApiAssignTaskRoute(
        routerAssignRequest(),
        assignBase(),
        "req-1",
        ENABLED,
        missingAssign,
      ),
    ApiHttpError,
  );
  assertEquals(e7.code, "internal_error");

  // deno-lint-ignore no-explicit-any
  const missingTransition = { ...(broken.deps as any) };
  delete missingTransition.transitionTask;
  const e8 = await assertRejects(
    () =>
      executeApiTransitionTaskRoute(
        routerTransitionRequest(),
        transitionBase(),
        "req-1",
        ENABLED,
        missingTransition,
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
  assignResult: unknown = ASSIGN_OK,
  transitionResult: unknown = TRANSITION_OK,
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
      reorderTasks: () => Promise.reject(new Error("unreachable")),
      planTask: () => Promise.reject(new Error("unreachable")),
      assignTask: () => Promise.resolve(assignResult),
      transitionTask: () => Promise.resolve(transitionResult),
    },
    activity: activityDeps(trace),
  } as unknown as ApiV1HttpHandlerDependencies;
}

function liveRequest(method: "PUT" | "POST" | "PATCH", path: string, body: unknown) {
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

Deno.test("API-M.11C: live PUT assignee returns 200 and records Task-targeted activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("PUT", ASSIGN_PATH, assignBase()),
    liveDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ASSIGN_OK);
  await settleActivity();
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.scopeCalls, [{ targetType: "task", targetId: TASK_ID }]);
  assertEquals(trace.records[0].routeId, "tasks.assign");
  assertEquals(trace.records[0].method, "PUT");
  assertEquals(trace.records[0].status, 200);
  assertEquals(trace.records[0].projectId, PROJECT_ID);
  assertEquals(trace.records[0].apiClientId, API_CLIENT_ID);
  assertEquals(trace.records[0].actorUserId, USER_ID);
  assertEquals(executorCalls, 0);
});

Deno.test("API-M.11C: live POST transition returns 200 and records Task-targeted activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("POST", TRANSITION_PATH, transitionBase()),
    liveDeps(trace),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), TRANSITION_OK);
  await settleActivity();
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.scopeCalls, [{ targetType: "task", targetId: TASK_ID }]);
  assertEquals(trace.records[0].routeId, "tasks.transition");
  assertEquals(trace.records[0].method, "POST");
  assertEquals(trace.records[0].status, 200);
});

Deno.test("API-M.11C: live stale transition surfaces a stable concurrency error", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("POST", TRANSITION_PATH, transitionBase()),
    liveDeps(trace, ASSIGN_OK, {
      ok: false,
      outcome: "conflict",
      code: "stale_task",
    }),
  );
  assertEquals(response.status, 409);
  assertEquals(await codeOf(response), "concurrency_conflict");
  // The internal wrapper conflict code never reaches the public surface.
  assertEquals((await codeOf(
    await handleApiV1Request(
      liveRequest("POST", TRANSITION_PATH, transitionBase()),
      liveDeps(trace, ASSIGN_OK, {
        ok: false,
        outcome: "conflict",
        code: "stale_task",
      }),
    ),
  )).includes("stale"), false);
  await settleActivity();
  assertEquals(trace.scheduled, 0);
});

Deno.test("API-M.11C: live near-miss task paths and methods stay unrouted", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  for (
    const [method, path] of [
      ["PUT", `/v1/tasks/${NIL}/assignee`],
      ["PUT", `/v1/tasks/${TASK_ID}/assignee/extra`],
      ["PUT", `/v1/tasks/${TASK_ID}/transition`],
      ["PUT", `/v1/tasks/${TASK_ID}`],
      ["POST", `/v1/tasks/${TASK_ID}/assignee`],
      ["POST", `/v1/tasks/${NIL}/transition`],
      ["PATCH", `/v1/tasks/${TASK_ID}/assignee`],
      ["PATCH", `/v1/tasks/${TASK_ID}/transition`],
    ] as ReadonlyArray<["PUT" | "POST" | "PATCH", string]>
  ) {
    const response = await handleApiV1Request(
      liveRequest(method, path, transitionBase()),
      liveDeps(trace),
    );
    assertEquals(response.status, 404, `${method} ${path}`);
  }
  await settleActivity();
  assertEquals(trace.scheduled, 0);
  assertEquals(executorCalls, 0);
});

Deno.test("API-M.11C: live CORS preflight advertises exactly the frozen task methods", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const assignPreflight = await handleApiV1Request(
    new Request(`https://api.example.test${ASSIGN_PATH}`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "PUT",
      }),
    }),
    liveDeps(trace),
  );
  assertEquals(assignPreflight.status, 204);
  assert(
    (assignPreflight.headers.get("Access-Control-Allow-Methods") ?? "")
      .includes("PUT"),
  );

  const transitionPreflight = await handleApiV1Request(
    new Request(`https://api.example.test${TRANSITION_PATH}`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      }),
    }),
    liveDeps(trace),
  );
  assertEquals(transitionPreflight.status, 204);

  // An out-of-scope Task sub-resource is still not preflightable.
  const rejected = await handleApiV1Request(
    new Request(`https://api.example.test/v1/tasks/${TASK_ID}/comments`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      }),
    }),
    liveDeps(trace),
  );
  assertEquals(rejected.status, 404);
  assertEquals(executorCalls, 0);
});
