// API-M.11A — Task create/update HTTP surface regression tests.
//
// These tests are pure: no environment variable, network call, Supabase SDK or
// database is touched. They prove route registration, strict path matching,
// closed-schema body validation, canonical normalization, idempotency payload
// folding, caller-scoped delegated execution and bounded outcome mapping for
// exactly two targets:
//   POST  /v1/tasks
//   PATCH /v1/tasks/<validated UUID>

import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  API_V1_ROUTE_ALLOWLIST,
  matchApiRoute,
} from "../router.ts";
import {
  buildApiV1UpdateTaskIdempotencyPayload,
  canonicalizeTaskText,
  parseApiV1CreateTaskBody,
  parseApiV1TaskUpdatePath,
  parseApiV1UpdateTaskBody,
  TASK_CREATE_ROUTE,
  TASK_UPDATE_ROUTE,
} from "../routes/tasks.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  createDelegatedApiV1CreateTaskExecutor,
  createDelegatedApiV1UpdateTaskExecutor,
} from "../../_shared/btpm-api/supabaseDelegatedTask.ts";

const TASK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PHASE_ID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const NIL = "00000000-0000-0000-0000-000000000000";
const UPDATED_AT = "2026-02-01T10:00:00.000Z";
const UPDATE_PATH = `/v1/tasks/${TASK_ID}`;

// ---------------------------------------------------------------------------
// A. Route registration and strict matching
// ---------------------------------------------------------------------------

Deno.test("API-M.11A: the two Task routes occupy the final frozen allowlist positions", () => {
  // Step-local: only the frozen positions and contracts are asserted here.
  // Global allowlist cardinality is owned by routes.test.ts.
  assertEquals(API_V1_ROUTE_ALLOWLIST[19], TASK_CREATE_ROUTE);
  assertEquals(API_V1_ROUTE_ALLOWLIST[20], TASK_UPDATE_ROUTE);
  assert(Object.isFrozen(TASK_CREATE_ROUTE));
  assert(Object.isFrozen(TASK_UPDATE_ROUTE));

  assertEquals(TASK_CREATE_ROUTE.id, "tasks.create");
  assertEquals(TASK_CREATE_ROUTE.method, "POST");
  assertEquals(TASK_CREATE_ROUTE.path, "/v1/tasks");
  assertEquals(TASK_CREATE_ROUTE.operation, "mutation");

  assertEquals(TASK_UPDATE_ROUTE.id, "tasks.update");
  assertEquals(TASK_UPDATE_ROUTE.method, "PATCH");
  assertEquals(TASK_UPDATE_ROUTE.path, "/v1/tasks/:taskid");
  assertEquals(TASK_UPDATE_ROUTE.operation, "mutation");
});

Deno.test("API-M.11A: capabilities advertises the two Task mutation operations", () => {
  const ops = buildCapabilitiesPayload().supportedOperations;
  assert(ops.includes("tasks.create"));
  assert(ops.includes("tasks.update"));
  // `tasks.reorder` / `tasks.plan` were added by API-M.11B and are guarded
  // there. API-M.11C later added assignment and transition to the surface.
});

Deno.test("API-M.11A: matchApiRoute resolves exactly the two Task targets", () => {
  assertEquals(matchApiRoute("POST", "/v1/tasks"), TASK_CREATE_ROUTE);
  assertEquals(matchApiRoute("PATCH", UPDATE_PATH), TASK_UPDATE_ROUTE);
});

Deno.test("API-M.11A: matchApiRoute rejects every near-miss Task target", () => {
  const rejected: readonly (readonly [string, string])[] = [
    ["POST", "/v1/tasks/"],
    ["POST", UPDATE_PATH],
    ["PATCH", "/v1/tasks"],
    ["PATCH", "/v1/tasks/not-a-uuid"],
    ["PATCH", `/v1/tasks/${NIL}`],
    ["PATCH", `${UPDATE_PATH}/`],
    ["PATCH", `${UPDATE_PATH}/assignee`],
    ["PATCH", `${UPDATE_PATH}/transition`],
    ["POST", "/v1/tasks/reorder"],
    ["POST", `${UPDATE_PATH}/planning`],
    ["PATCH", `/v1/TASKS/${TASK_ID}`],
    ["PUT", "/v1/tasks"],
    ["DELETE", UPDATE_PATH],
  ];
  for (const [method, path] of rejected) {
    assertEquals(matchApiRoute(method, path), null, `${method} ${path}`);
  }
});

// ---------------------------------------------------------------------------
// B. Path parser
// ---------------------------------------------------------------------------

Deno.test("API-M.11A: update path parser accepts only a canonical non-nil Task UUID", () => {
  assertEquals(parseApiV1TaskUpdatePath(UPDATE_PATH), { taskId: TASK_ID });
  for (
    const path of [
      `/v1/tasks/${NIL}`,
      "/v1/tasks/",
      "/v1/tasks",
      `/v1/tasks/${TASK_ID}/`,
      `/v1/tasks/${TASK_ID}/planning`,
      `/v1/tasks/${TASK_ID}%20`,
      `/v1/tasks/${TASK_ID};a=1`,
      `/v1/tasks/${TASK_ID}?x=1`,
      `/v1/tasks/${TASK_ID}#f`,
      `/v1/tasks/ ${TASK_ID}`,
      `/v1/tasks/${TASK_ID.toUpperCase()}X`,
    ]
  ) {
    assertThrows(
      () => parseApiV1TaskUpdatePath(path),
      ApiHttpError,
      undefined,
      path,
    );
  }
});

// ---------------------------------------------------------------------------
// C. Canonical normalization (PostgreSQL btrim equivalence)
// ---------------------------------------------------------------------------

Deno.test("API-M.11A: canonicalizeTaskText mirrors PostgreSQL btrim exactly", () => {
  assertEquals(canonicalizeTaskText("  Build report  "), "Build report");
  assertEquals(canonicalizeTaskText("Build   report"), "Build   report");
  // Non-space whitespace is preserved on both ends, exactly like btrim.
  assertEquals(canonicalizeTaskText("\tName\n"), "\tName\n");
  assertEquals(canonicalizeTaskText("   "), "");
});

// ---------------------------------------------------------------------------
// D. Create body parser
// ---------------------------------------------------------------------------

Deno.test("API-M.11A: create body resolves canonical defaults deterministically", () => {
  const parsed = parseApiV1CreateTaskBody({
    phaseId: PHASE_ID,
    name: "  Draft cutover plan  ",
  });
  assertEquals(parsed, {
    phaseId: PHASE_ID,
    name: "Draft cutover plan",
    description: null,
    status: "planned",
    priority: "medium",
    taskType: "work_item",
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    sortOrder: null,
  });
  assert(Object.isFrozen(parsed));
});

Deno.test("API-M.11A: create body rejects unknown keys, bad enums and inverted windows", () => {
  const rejected: readonly unknown[] = [
    null,
    undefined,
    "x",
    [],
    {},
    { phaseId: PHASE_ID },
    { name: "n" },
    { phaseId: NIL, name: "n" },
    { phaseId: PHASE_ID, name: "   " },
    { phaseId: PHASE_ID, name: "n", unknownKey: 1 },
    { phaseId: PHASE_ID, name: "n", status: "done_ish" },
    { phaseId: PHASE_ID, name: "n", priority: "urgent" },
    { phaseId: PHASE_ID, name: "n", taskType: "epic" },
    { phaseId: PHASE_ID, name: "n", startDate: "2026-13-01" },
    { phaseId: PHASE_ID, name: "n", dueDate: "01/02/2026" },
    { phaseId: PHASE_ID, name: "n", estimatedHours: -1 },
    { phaseId: PHASE_ID, name: "n", estimatedHours: "3" },
    {
      phaseId: PHASE_ID,
      name: "n",
      startDate: "2026-03-10",
      dueDate: "2026-03-09",
    },
  ];
  for (const input of rejected) {
    assertThrows(
      () => parseApiV1CreateTaskBody(input),
      ApiHttpError,
      undefined,
      JSON.stringify(input ?? null),
    );
  }
});

// ---------------------------------------------------------------------------
// E. Update body parser
// ---------------------------------------------------------------------------

const VALID_UPDATE = Object.freeze({
  expectedUpdatedAt: UPDATED_AT,
  name: "  Renamed task  ",
  description: null,
  status: null,
  priority: null,
  taskType: null,
  estimatedHours: null,
});

Deno.test("API-M.11A: update body requires all seven keys and canonicalizes the name", () => {
  const parsed = parseApiV1UpdateTaskBody({ ...VALID_UPDATE });
  assertEquals(parsed, {
    expectedUpdatedAt: UPDATED_AT,
    name: "Renamed task",
    description: null,
    status: null,
    priority: null,
    taskType: null,
    estimatedHours: null,
  });
  assert(Object.isFrozen(parsed));

  // Every key is mandatory: omission is rejected, never silently defaulted.
  for (const key of Object.keys(VALID_UPDATE)) {
    const partial: Record<string, unknown> = { ...VALID_UPDATE };
    delete partial[key];
    assertThrows(
      () => parseApiV1UpdateTaskBody(partial),
      ApiHttpError,
      undefined,
      `missing ${key}`,
    );
  }
});

Deno.test("API-M.11A: update body rejects unknown keys, bad values and out-of-scope commands", () => {
  const rejected: readonly unknown[] = [
    null,
    [],
    "x",
    { ...VALID_UPDATE, expectedUpdatedAt: "not-a-timestamp" },
    { ...VALID_UPDATE, expectedUpdatedAt: null },
    { ...VALID_UPDATE, name: "   " },
    { ...VALID_UPDATE, status: "done_ish" },
    { ...VALID_UPDATE, priority: "urgent" },
    { ...VALID_UPDATE, taskType: "epic" },
    { ...VALID_UPDATE, estimatedHours: -2 },
    // Out-of-scope Task commands must never be reachable via this body.
    { ...VALID_UPDATE, phaseId: PHASE_ID },
    { ...VALID_UPDATE, sortOrder: 1 },
    { ...VALID_UPDATE, startDate: "2026-03-01" },
    { ...VALID_UPDATE, dueDate: "2026-03-01" },
    { ...VALID_UPDATE, assigneeId: TASK_ID },
    { ...VALID_UPDATE, actualStartDate: "2026-03-01" },
  ];
  for (const input of rejected) {
    assertThrows(() => parseApiV1UpdateTaskBody(input), ApiHttpError);
  }
});

// ---------------------------------------------------------------------------
// F. Idempotency payload folding
// ---------------------------------------------------------------------------

Deno.test("API-M.11A: update idempotency payload folds in the path Task identity", () => {
  const body = parseApiV1UpdateTaskBody({ ...VALID_UPDATE });
  const payload = buildApiV1UpdateTaskIdempotencyPayload(TASK_ID, body);
  assertEquals(payload.taskId, TASK_ID);
  assertEquals(payload.name, "Renamed task");
  assertEquals(payload.expectedUpdatedAt, UPDATED_AT);
  assert(Object.isFrozen(payload));
  // No raw URL, header, token or bearer material is hashed.
  const serialized = JSON.stringify(payload);
  assertFalse(serialized.includes("/v1/tasks"));
  assertFalse(serialized.toLowerCase().includes("authorization"));
  assertFalse(serialized.toLowerCase().includes("bearer"));

  assertThrows(
    () => buildApiV1UpdateTaskIdempotencyPayload("", body),
    ApiHttpError,
  );
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => buildApiV1UpdateTaskIdempotencyPayload(TASK_ID, null as any),
    ApiHttpError,
  );
});

// ---------------------------------------------------------------------------
// G. Delegated caller-scoped execution
// ---------------------------------------------------------------------------

function authContext(userId: string, oauthClientId: string) {
  return {
    token: { userId, clientId: oauthClientId },
    client: {
      userId,
      oauthClientId,
      apiClientId: "11111111-1111-4111-8111-111111111111",
      policyVersionId: "22222222-2222-4222-8222-222222222222",
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

function executionContext(userId: string, oauthClientId: string) {
  return {
    requestedUserId: userId,
    executingUserId: userId,
    apiClientId: "11111111-1111-4111-8111-111111111111",
    oauthClientId,
    policyVersionId: "22222222-2222-4222-8222-222222222222",
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "key-1",
    payloadHash: "a".repeat(64),
    sourceChannel: "external_api",
    sourceClientId: "11111111-1111-4111-8111-111111111111",
    delegationMode: "delegated_user",
    // deno-lint-ignore no-explicit-any
  } as any;
}

const USER_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "btpm-external-client";

Deno.test("API-M.11A: delegated executors require the anon key and a client factory", () => {
  // deno-lint-ignore no-explicit-any
  const factory = ((): any => ({ rpc: () => Promise.resolve({}) })) as any;
  assertThrows(
    () => createDelegatedApiV1CreateTaskExecutor("", "anon", factory),
    ApiHttpError,
  );
  assertThrows(
    () => createDelegatedApiV1UpdateTaskExecutor("https://x", "", factory),
    ApiHttpError,
  );
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => createDelegatedApiV1UpdateTaskExecutor("https://x", "anon", null as any),
    ApiHttpError,
  );
});

Deno.test("API-M.11A: delegated executors fail closed on inconsistent identity", async () => {
  let factoryCalls = 0;
  const factory = (() => {
    factoryCalls += 1;
    return { rpc: () => Promise.resolve({}) };
    // deno-lint-ignore no-explicit-any
  }) as any;

  const create = createDelegatedApiV1CreateTaskExecutor(
    "https://example.invalid",
    "anon-key",
    factory,
  );
  const update = createDelegatedApiV1UpdateTaskExecutor(
    "https://example.invalid",
    "anon-key",
    factory,
  );

  const request = new Request("https://example.invalid/v1/tasks", {
    method: "POST",
    headers: { authorization: "Bearer token-value" },
  });

  const createBody = parseApiV1CreateTaskBody({
    phaseId: PHASE_ID,
    name: "n",
  });
  const updateBody = parseApiV1UpdateTaskBody({ ...VALID_UPDATE });

  // Mismatched user identity between authenticated and execution contexts.
  await assertRejects(
    () =>
      create(
        request,
        authContext(USER_ID, OAUTH_CLIENT_ID),
        createBody,
        executionContext(
          "44444444-4444-4444-8444-444444444444",
          OAUTH_CLIENT_ID,
        ),
      ),
    ApiHttpError,
  );

  // Mismatched OAuth client identity.
  await assertRejects(
    () =>
      update(
        request,
        authContext(USER_ID, OAUTH_CLIENT_ID),
        TASK_ID,
        updateBody,
        executionContext(USER_ID, "other-client"),
      ),
    ApiHttpError,
  );

  assertEquals(factoryCalls, 0, "no client may be built for a failed identity");
});

// ---------------------------------------------------------------------------
// H. Module purity and runtime wiring
// ---------------------------------------------------------------------------

Deno.test("API-M.11A: Task modules are pure and free of runtime/global access", async () => {
  for (
    const url of [
      new URL("../routes/tasks.ts", import.meta.url),
      new URL("../../_shared/btpm-api/supabaseTask.ts", import.meta.url),
      new URL(
        "../../_shared/btpm-api/supabaseDelegatedTask.ts",
        import.meta.url,
      ),
    ]
  ) {
    const src = await Deno.readTextFile(url);
    assertFalse(src.includes("Deno.env"), `${url}: no environment access`);
    assertFalse(src.includes("SERVICE_ROLE"), `${url}: no service role`);
    assertFalse(src.includes("service_role"), `${url}: no service role`);
    assertFalse(src.includes("console."), `${url}: no logging`);
    assertFalse(src.includes("setTimeout"), `${url}: no timers`);
  }
});

Deno.test("API-M.11A: Task adapters invoke only the accepted M.10A wrappers", async () => {
  const src = await Deno.readTextFile(
    new URL("../../_shared/btpm-api/supabaseTask.ts", import.meta.url),
  );
  assert(src.includes('"api_v1_create_task"'));
  assert(src.includes('"api_v1_update_task"'));
  // No generic RPC / SQL / CRUD dispatch.
  assertFalse(src.includes("execute_sql"));
  assertFalse(src.includes("apply_task_create"));
  assertFalse(src.includes("apply_task_update"));
  assertFalse(src.includes(".from("));
});

Deno.test("API-M.11A: live runtime wires caller-bound Task executors with the anon key", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  for (
    const factory of [
      "createDelegatedApiV1CreateTaskExecutor(",
      "createDelegatedApiV1UpdateTaskExecutor(",
    ]
  ) {
    const at = src.indexOf(factory);
    assert(at > -1, `${factory} must be wired in the live runtime`);
    const block = src.slice(at, at + 300);
    assert(block.includes("supabaseAnonKey"));
    assertFalse(block.includes("supabaseServiceRoleKey"));
  }
  assert(src.includes("taskMutationRoute"));
  // No runtime flag was changed in code.
  assert(src.includes('Deno.env.get("BTPM_API_MUTATIONS_ENABLED")'));
  assertFalse(src.includes("BTPM_API_MUTATIONS_ENABLED="));
});

// ===========================================================================
// API-M.11A-C1 — Permanent Task HTTP regression guard.
//
// Everything below remains dependency-injected and pure: no environment
// variable, no network call, no Supabase SDK, no service-role key and no
// database are touched. Boundaries, adapters, result mapping, delegated
// execution, router pipelines and the live HTTP pipeline are all exercised.
// ===========================================================================

import {
  createApiV1Task,
  updateApiV1Task,
} from "../../_shared/btpm-api/supabaseTask.ts";
import {
  executeApiCreateTaskRoute,
  executeApiUpdateTaskRoute,
  parseApiRuntimeControls,
  type ApiRuntimeControls,
} from "../router.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";

const PROJECT_ID = "dddddddd-4444-4444-8444-444444444444";
const API_CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const POLICY_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ALLOWED_ORIGIN = "https://app.example.com";
const LIVE_REQUEST_ID = "44444444-4444-4444-8444-444444444444";

const AUTH_CONTEXT = authContext(USER_ID, OAUTH_CLIENT_ID);
const EXEC_CONTEXT = executionContext(USER_ID, OAUTH_CLIENT_ID);

function createBase(overrides: Record<string, unknown> = {}) {
  return { phaseId: PHASE_ID, name: "Draft cutover plan", ...overrides };
}

function updateBase(overrides: Record<string, unknown> = {}) {
  return { ...VALID_UPDATE, name: "Renamed task", ...overrides };
}

function assertInvalid(run: () => unknown): void {
  const err = assertThrows(run, ApiHttpError);
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
}

const CREATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  status: "planned",
  priority: "medium",
  taskType: "work_item",
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: "2026-02-01T10:00:00.000Z",
  updatedAt: "2026-02-01T10:00:00.000Z",
  shiftedSiblingCount: null,
});

const CONFIRMATION = Object.freeze({
  ok: false,
  outcome: "confirmation_required",
  code: "extend_phase_window_required",
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  phaseStartDate: "2026-03-01",
  phaseTargetEndDate: "2026-03-31",
  requestedTaskStartDate: "2026-03-01",
  requestedTaskDueDate: "2026-04-15",
  requiredPhaseStartDate: "2026-03-01",
  requiredPhaseTargetEndDate: "2026-04-15",
});

const UPDATE_OK = Object.freeze({
  ok: true,
  outcome: "applied",
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  status: "active",
  priority: "high",
  taskType: "work_item",
  estimatedHours: 4,
  updatedAt: "2026-02-02T10:00:00.000Z",
});

// ---------------------------------------------------------------------------
// I. Exact field boundaries
// ---------------------------------------------------------------------------

Deno.test("API-M.11A-C1: create body enforces exact field boundaries", () => {
  const name500 = "n".repeat(500);
  assertEquals(parseApiV1CreateTaskBody(createBase({ name: name500 })).name, name500);
  assertInvalid(() => parseApiV1CreateTaskBody(createBase({ name: "n".repeat(501) })));

  const desc4000 = "d".repeat(4000);
  assertEquals(
    parseApiV1CreateTaskBody(createBase({ description: desc4000 })).description,
    desc4000,
  );
  assertInvalid(() =>
    parseApiV1CreateTaskBody(createBase({ description: "d".repeat(4001) }))
  );
  // Space-only description collapses to NULL, exactly like the command.
  assertEquals(
    parseApiV1CreateTaskBody(createBase({ description: "   " })).description,
    null,
  );

  assertEquals(parseApiV1CreateTaskBody(createBase({ sortOrder: 0 })).sortOrder, 0);
  assertEquals(
    parseApiV1CreateTaskBody(createBase({ sortOrder: 100_000 })).sortOrder,
    100_000,
  );
  for (const bad of [100_001, -1, 1.5, Number.NaN, "3", true]) {
    assertInvalid(() => parseApiV1CreateTaskBody(createBase({ sortOrder: bad })));
  }

  assertEquals(
    parseApiV1CreateTaskBody(createBase({ estimatedHours: 999_999.99 })).estimatedHours,
    999_999.99,
  );
  assertEquals(
    parseApiV1CreateTaskBody(createBase({ estimatedHours: 0 })).estimatedHours,
    0,
  );
  for (const bad of [1_000_000, -0.5, Number.POSITIVE_INFINITY, Number.NaN]) {
    assertInvalid(() =>
      parseApiV1CreateTaskBody(createBase({ estimatedHours: bad }))
    );
  }

  // Equal boundaries and one-sided windows remain valid.
  assertEquals(
    parseApiV1CreateTaskBody(
      createBase({ startDate: "2026-03-10", dueDate: "2026-03-10" }),
    ).dueDate,
    "2026-03-10",
  );
  assertEquals(
    parseApiV1CreateTaskBody(createBase({ dueDate: "2026-03-10" })).startDate,
    null,
  );
  for (const bad of ["2026-02-30", "2026-00-10", "2026-03-32", "2026-3-10", "20260310"]) {
    assertInvalid(() => parseApiV1CreateTaskBody(createBase({ startDate: bad })));
  }
  // Explicit nulls are accepted everywhere optional values are accepted.
  assertEquals(
    parseApiV1CreateTaskBody(
      createBase({
        description: null,
        startDate: null,
        dueDate: null,
        estimatedHours: null,
        sortOrder: null,
      }),
    ).description,
    null,
  );
});

Deno.test("API-M.11A-C1: update body enforces timestamp and value boundaries", () => {
  for (
    const ts of [
      "2026-02-01T10:00:00Z",
      "2026-02-01t10:00:00z",
      "2026-02-01 10:00:00+00",
      "2026-02-01T10:00:00.123456+05:30",
      "2026-02-01T10:00:00.1-0800",
    ]
  ) {
    assertEquals(
      parseApiV1UpdateTaskBody(updateBase({ expectedUpdatedAt: ts }))
        .expectedUpdatedAt,
      ts,
    );
  }
  for (
    const ts of [
      "2026-02-01T10:00:00",
      "2026-02-01",
      "2026-02-30T10:00:00Z",
      "2026-02-01T25:00:00Z",
      "2026-02-01T10:60:00Z",
      "2026-02-01T10:00:00+99:00",
      "",
    ]
  ) {
    assertInvalid(() =>
      parseApiV1UpdateTaskBody(updateBase({ expectedUpdatedAt: ts }))
    );
  }

  const name500 = "n".repeat(500);
  assertEquals(parseApiV1UpdateTaskBody(updateBase({ name: name500 })).name, name500);
  assertInvalid(() => parseApiV1UpdateTaskBody(updateBase({ name: "n".repeat(501) })));
  assertInvalid(() =>
    parseApiV1UpdateTaskBody(updateBase({ description: "d".repeat(4001) }))
  );
  // Canonical null meanings survive parsing unchanged.
  const retained = parseApiV1UpdateTaskBody(updateBase());
  assertEquals(retained.status, null);
  assertEquals(retained.priority, null);
  assertEquals(retained.taskType, null);
  assertEquals(retained.description, null);
  assertEquals(retained.estimatedHours, null);
  // Explicit canonical values are preserved verbatim.
  const explicit = parseApiV1UpdateTaskBody(
    updateBase({
      status: "completed",
      priority: "critical",
      taskType: "milestone",
      estimatedHours: 999_999.99,
      description: "  detail  ",
    }),
  );
  assertEquals(explicit.status, "completed");
  assertEquals(explicit.priority, "critical");
  assertEquals(explicit.taskType, "milestone");
  assertEquals(explicit.estimatedHours, 999_999.99);
  assertEquals(explicit.description, "detail");
  assertInvalid(() =>
    parseApiV1UpdateTaskBody(updateBase({ estimatedHours: 1_000_000 }))
  );
});

// ---------------------------------------------------------------------------
// J. RPC adapters — argument mapping, envelope handling, result mapping
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

const CREATE_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  phaseId: PHASE_ID,
  name: "Draft cutover plan",
  description: null,
  status: "planned",
  priority: "medium",
  taskType: "work_item",
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  sortOrder: null,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  // deno-lint-ignore no-explicit-any
}) as any;

const UPDATE_INPUT = Object.freeze({
  expectedOauthClientId: OAUTH_CLIENT_ID,
  taskId: TASK_ID,
  expectedUpdatedAt: UPDATED_AT,
  name: "Renamed task",
  description: null,
  status: null,
  priority: null,
  taskType: null,
  estimatedHours: null,
  requestId: "req-1",
  correlationId: "corr-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  // deno-lint-ignore no-explicit-any
}) as any;

Deno.test("API-M.11A-C1: create adapter calls api_v1_create_task with exact snake_case args", async () => {
  const { client, calls } = rpcClient({ data: CREATE_OK, error: null });
  const result = await createApiV1Task(client, CREATE_INPUT);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "api_v1_create_task");
  assertEquals(Object.keys(calls[0].args).sort(), [
    "_correlation_id",
    "_description",
    "_due_date",
    "_estimated_hours",
    "_expected_oauth_client_id",
    "_idempotency_key",
    "_name",
    "_payload_hash",
    "_phase_id",
    "_priority",
    "_request_id",
    "_sort_order",
    "_start_date",
    "_status",
    "_task_type",
  ]);
  assertEquals(calls[0].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
  assertEquals(calls[0].args._phase_id, PHASE_ID);
  assertEquals(calls[0].args._payload_hash, "a".repeat(64));
  assertEquals(result.ok, true);
  assertEquals(result.outcome, "applied");
});

Deno.test("API-M.11A-C1: update adapter calls api_v1_update_task with exact snake_case args", async () => {
  const { client, calls } = rpcClient({ data: UPDATE_OK, error: null });
  const result = await updateApiV1Task(client, UPDATE_INPUT);
  assertEquals(calls[0].fn, "api_v1_update_task");
  assertEquals(Object.keys(calls[0].args).sort(), [
    "_correlation_id",
    "_description",
    "_estimated_hours",
    "_expected_oauth_client_id",
    "_expected_updated_at",
    "_idempotency_key",
    "_name",
    "_payload_hash",
    "_priority",
    "_request_id",
    "_status",
    "_task_id",
    "_task_type",
  ]);
  assertEquals(calls[0].args._task_id, TASK_ID);
  assertEquals(calls[0].args._expected_updated_at, UPDATED_AT);
  assertEquals(result.ok, true);
});

Deno.test("API-M.11A-C1: adapters validate inputs before any RPC is attempted", async () => {
  const invalidCreateInputs: readonly Record<string, unknown>[] = [
    { expectedOauthClientId: "" },
    { expectedOauthClientId: "bad client id" },
    { phaseId: NIL },
    { phaseId: "not-a-uuid" },
    { name: "" },
    { status: "done_ish" },
    { priority: "urgent" },
    { taskType: "epic" },
    { startDate: "10/03/2026" },
    { estimatedHours: -1 },
    { sortOrder: -1 },
    { requestId: "bad request id" },
    { correlationId: "bad corr id" },
    { idempotencyKey: "" },
    { payloadHash: "zz" },
  ];
  for (const drift of invalidCreateInputs) {
    const { client, calls } = rpcClient({ data: CREATE_OK, error: null });
    const err = await assertRejects(
      () => createApiV1Task(client, { ...CREATE_INPUT, ...drift }),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
    assertEquals(calls.length, 0, JSON.stringify(drift));
  }

  for (
    const drift of [
      { taskId: NIL },
      { expectedUpdatedAt: "2026-02-01" },
      { name: "" },
      { status: "done_ish" },
      { payloadHash: "a".repeat(63) },
    ]
  ) {
    const { client, calls } = rpcClient({ data: UPDATE_OK, error: null });
    await assertRejects(
      () => updateApiV1Task(client, { ...UPDATE_INPUT, ...drift }),
      ApiHttpError,
    );
    assertEquals(calls.length, 0, JSON.stringify(drift));
  }

  // A malformed client is rejected structurally.
  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => createApiV1Task({} as any, CREATE_INPUT),
    ApiHttpError,
  );
});

Deno.test("API-M.11A-C1: adapters map RPC envelope failures to bounded HTTP errors", async () => {
  const denied = rpcClient({ data: null, error: { code: "42501" } });
  const deniedErr = await assertRejects(
    () => createApiV1Task(denied.client, CREATE_INPUT),
    ApiHttpError,
  );
  assertEquals(deniedErr.code, "not_authorized");

  const failed = rpcClient({ data: null, error: { code: "P0001", message: "x" } });
  const failedErr = await assertRejects(
    () => updateApiV1Task(failed.client, UPDATE_INPUT),
    ApiHttpError,
  );
  assertEquals(failedErr.code, "internal_error");
  // The internal cause never reaches the serialized body.
  assertFalse(failedErr.message.includes("P0001"));

  for (const malformed of [null, {}, { data: CREATE_OK }, [], "x"]) {
    const { client } = rpcClient(malformed);
    await assertRejects(
      () => createApiV1Task(client, CREATE_INPUT),
      ApiHttpError,
    );
  }

  const throwing = {
    rpc: () => Promise.reject(new Error("network down")),
    // deno-lint-ignore no-explicit-any
  } as any;
  const thrownErr = await assertRejects(
    () => createApiV1Task(throwing, CREATE_INPUT),
    ApiHttpError,
  );
  assertEquals(thrownErr.code, "internal_error");
  assertFalse(thrownErr.message.includes("network down"));
});

Deno.test("API-M.11A-C1: create result mapping is exhaustive and fails closed", async () => {
  for (const outcome of ["applied", "replayed"]) {
    const { client } = rpcClient({
      data: { ...CREATE_OK, outcome },
      error: null,
    });
    const result = await createApiV1Task(client, CREATE_INPUT);
    assertEquals(result.ok, true);
    assertEquals(result.outcome, outcome);
    assert(Object.isFrozen(result));
  }

  // Confirmation-required is surfaced verbatim as a non-success outcome.
  const confirm = rpcClient({ data: CONFIRMATION, error: null });
  const confirmResult = await createApiV1Task(confirm.client, CREATE_INPUT);
  assertEquals(confirmResult, CONFIRMATION);

  // A COMPLETED confirmation replay is normalized back to confirmation_required.
  const replayedConfirm = rpcClient({
    data: { ...CONFIRMATION, outcome: "replayed" },
    error: null,
  });
  const replayedConfirmResult = await createApiV1Task(
    replayedConfirm.client,
    CREATE_INPUT,
  );
  assertEquals(replayedConfirmResult.ok, false);
  assertEquals(replayedConfirmResult.outcome, "confirmation_required");

  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
    ]
  ) {
    const { client } = rpcClient({ data: { ok: false, outcome }, error: null });
    const result = await createApiV1Task(client, CREATE_INPUT);
    assertEquals(result.ok, false);
    assertEquals(result.outcome, outcome);
  }

  const malformedResults: readonly unknown[] = [
    { ok: false, outcome: "mystery" },
    { ok: false, outcome: "invalid", extra: 1 },
    { ...CONFIRMATION, code: "something_else" },
    { ...CREATE_OK, outcome: "no_change" },
    { ...CREATE_OK, extra: true },
    { ...CREATE_OK, status: "done_ish" },
    { ...CREATE_OK, taskId: NIL },
    { ...CREATE_OK, sortOrder: -1 },
    { ...CREATE_OK, isArchived: "false" },
    { ...CREATE_OK, createdAt: "2026-02-01" },
    { ok: "true" },
    null,
    "x",
    [],
  ];
  for (const data of malformedResults) {
    const { client } = rpcClient({ data, error: null });
    const err = await assertRejects(
      () => createApiV1Task(client, CREATE_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

Deno.test("API-M.11A-C1: update result mapping covers no_change, replay and stale_task", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { client } = rpcClient({
      data: { ...UPDATE_OK, outcome },
      error: null,
    });
    const result = await updateApiV1Task(client, UPDATE_INPUT);
    assertEquals(result.ok, true);
    assertEquals(result.outcome, outcome);
  }

  const stale = rpcClient({
    data: { ok: false, outcome: "conflict", code: "stale_task" },
    error: null,
  });
  const staleResult = await updateApiV1Task(stale.client, UPDATE_INPUT);
  assertEquals(staleResult, {
    ok: false,
    outcome: "conflict",
    code: "stale_task",
  });

  for (
    const data of [
      { ok: false, outcome: "conflict", code: "stale_phase" },
      { ok: false, outcome: "conflict" },
      { ...UPDATE_OK, outcome: "confirmation_required" },
      { ...UPDATE_OK, extra: 1 },
      { ...UPDATE_OK, updatedAt: "nope" },
      { ...UPDATE_OK, priority: "urgent" },
    ]
  ) {
    const { client } = rpcClient({ data, error: null });
    const err = await assertRejects(
      () => updateApiV1Task(client, UPDATE_INPUT),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error", JSON.stringify(data));
  }
});

// ---------------------------------------------------------------------------
// K. Delegated executors — successful caller-scoped execution
// ---------------------------------------------------------------------------

Deno.test("API-M.11A-C1: delegated Task executors bind anon key + caller bearer per call", async () => {
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
          data: fn === "api_v1_create_task" ? CREATE_OK : UPDATE_OK,
          error: null,
        });
      },
    };
    clients.push(client);
    return client;
  };

  const create = createDelegatedApiV1CreateTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const update = createDelegatedApiV1UpdateTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );

  const createRequest = new Request("https://x/v1/tasks", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const updateRequest = new Request(`https://x${UPDATE_PATH}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });

  const created = await create(
    createRequest,
    AUTH_CONTEXT,
    parseApiV1CreateTaskBody(createBase()),
    EXEC_CONTEXT,
  );
  const updated = await update(
    updateRequest,
    AUTH_CONTEXT,
    TASK_ID,
    parseApiV1UpdateTaskBody(updateBase()),
    EXEC_CONTEXT,
  );

  assertEquals(created.ok, true);
  assertEquals(updated.ok, true);
  assertEquals(seen.length, 2);
  assertEquals(clients.length, 2);
  assert(clients[0] !== clients[1], "a fresh client per invocation");
  for (const s of seen) {
    assertEquals(s.url, "https://example.supabase.co");
    assertEquals(s.key, "anon-key");
    assertEquals(s.auth, "Bearer caller-token");
  }
  assertEquals(calls.map((c) => c.fn), [
    "api_v1_create_task",
    "api_v1_update_task",
  ]);
  // Provenance travels from the immutable execution context, not the body.
  assertEquals(calls[0].args._idempotency_key, "key-1");
  assertEquals(calls[0].args._payload_hash, "a".repeat(64));
  assertEquals(calls[1].args._task_id, TASK_ID);
  assertEquals(calls[1].args._expected_oauth_client_id, OAUTH_CLIENT_ID);
});

Deno.test("API-M.11A-C1: delegated Task executors reject identity and channel drift", async () => {
  let factoryCalls = 0;
  const factory = (() => {
    factoryCalls += 1;
    return { rpc: () => Promise.resolve({ data: CREATE_OK, error: null }) };
    // deno-lint-ignore no-explicit-any
  }) as any;
  const create = createDelegatedApiV1CreateTaskExecutor(
    "https://example.supabase.co",
    "anon-key",
    factory,
  );
  const request = new Request("https://x/v1/tasks", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
    body: "{}",
  });
  const body = parseApiV1CreateTaskBody(createBase());

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
    const err = await assertRejects(
      () => create(request, AUTH_CONTEXT, body, { ...EXEC_CONTEXT, ...drift }),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
  assertEquals(factoryCalls, 0, "no client is built for a drifted identity");
});

// ---------------------------------------------------------------------------
// L. Router pipeline outcome mapping
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

function taskDeps(createResult: unknown, updateResult: unknown) {
  const counters = { create: 0, update: 0, authorize: 0, exec: 0 };
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
      createTask: () => {
        counters.create++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(createResult);
      },
      updateTask: () => {
        counters.update++;
        counters.exec++;
        order.push("execute");
        return Promise.resolve(updateResult);
      },
      // API-M.11B members exist on the shared contract; this step's guard never
      // reaches them.
      reorderTasks: () => Promise.reject(new Error("unreachable")),
      planTask: () => Promise.reject(new Error("unreachable")),
      assignTask: () => Promise.reject(new Error("unreachable")),
      transitionTask: () => Promise.reject(new Error("unreachable")),
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

function routerCreateRequest() {
  return new Request("https://api.example.test/v1/tasks", {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

function routerUpdateRequest() {
  return new Request(`https://api.example.test${UPDATE_PATH}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer caller-token",
      "Idempotency-Key": "key-1",
    },
    body: "{}",
  });
}

Deno.test("API-M.11A-C1: create pipeline maps applied → 201, replayed → 200, confirmation → 409", async () => {
  const applied = taskDeps(CREATE_OK, UPDATE_OK);
  const r1 = await executeApiCreateTaskRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    applied.deps,
  );
  assertEquals(r1.status, 201);
  assertEquals(r1.route, TASK_CREATE_ROUTE);
  assertEquals(r1.payload, CREATE_OK);
  assertEquals(applied.counters.create, 1);
  assertEquals(applied.counters.authorize, 1);
  // Authorization and rate limiting strictly precede delegated execution.
  assertEquals(applied.order, ["authorize", "rateLimit", "execute"]);
  assertEquals(r1.activityIdentity.apiClientId, API_CLIENT_ID);
  assertEquals(r1.activityIdentity.actorUserId, USER_ID);

  const replayed = taskDeps({ ...CREATE_OK, outcome: "replayed" }, UPDATE_OK);
  const r2 = await executeApiCreateTaskRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    replayed.deps,
  );
  assertEquals(r2.status, 200);

  const confirm = taskDeps(CONFIRMATION, UPDATE_OK);
  const r3 = await executeApiCreateTaskRoute(
    routerCreateRequest(),
    createBase(),
    "req-1",
    ENABLED,
    confirm.deps,
  );
  assertEquals(r3.status, 409);
  assertEquals(r3.payload, CONFIRMATION);
});

Deno.test("API-M.11A-C1: update pipeline maps success outcomes and stale_task", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const d = taskDeps(CREATE_OK, { ...UPDATE_OK, outcome });
    const r = await executeApiUpdateTaskRoute(
      routerUpdateRequest(),
      updateBase(),
      "req-1",
      ENABLED,
      d.deps,
    );
    assertEquals(r.status, 200);
    assertEquals(r.route, TASK_UPDATE_ROUTE);
    assertEquals(d.counters.update, 1);
    assertEquals(d.counters.authorize, 1);
  }

  const stale = taskDeps(CREATE_OK, {
    ok: false,
    outcome: "conflict",
    code: "stale_task",
  });
  const err = await assertRejects(
    () =>
      executeApiUpdateTaskRoute(
        routerUpdateRequest(),
        updateBase(),
        "req-1",
        ENABLED,
        stale.deps,
      ),
    ApiHttpError,
  );
  // `stale_task` never leaves the boundary.
  assertEquals(err.code, "concurrency_conflict");
  assertFalse(err.message.includes("stale_task"));
});

Deno.test("API-M.11A-C1: negative Task outcomes map to bounded HTTP errors", async () => {
  const expected: Readonly<Record<string, string>> = {
    invalid: "invalid_request",
    not_authorized: "not_authorized",
    idempotency_conflict: "idempotency_conflict",
    idempotency_pending: "idempotency_pending",
  };
  for (const [outcome, code] of Object.entries(expected)) {
    const c = taskDeps({ ok: false, outcome }, UPDATE_OK);
    const e1 = await assertRejects(
      () =>
        executeApiCreateTaskRoute(
          routerCreateRequest(),
          createBase(),
          "req-1",
          ENABLED,
          c.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e1.code, code);

    const u = taskDeps(CREATE_OK, { ok: false, outcome });
    const e2 = await assertRejects(
      () =>
        executeApiUpdateTaskRoute(
          routerUpdateRequest(),
          updateBase(),
          "req-1",
          ENABLED,
          u.deps,
        ),
      ApiHttpError,
    );
    assertEquals(e2.code, code);
  }

  // An unknown success outcome fails closed.
  const weird = taskDeps({ ...CREATE_OK, outcome: "no_change" }, UPDATE_OK);
  const e3 = await assertRejects(
    () =>
      executeApiCreateTaskRoute(
        routerCreateRequest(),
        createBase(),
        "req-1",
        ENABLED,
        weird.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e3.code, "internal_error");
});

Deno.test("API-M.11A-C1: mutation switch, bad bodies and broken deps block Task execution", async () => {
  const off = taskDeps(CREATE_OK, UPDATE_OK);
  const e1 = await assertRejects(
    () =>
      executeApiCreateTaskRoute(
        routerCreateRequest(),
        createBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e1.code, "api_unavailable");
  const e2 = await assertRejects(
    () =>
      executeApiUpdateTaskRoute(
        routerUpdateRequest(),
        updateBase(),
        "req-1",
        MUTATIONS_OFF,
        off.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e2.code, "api_unavailable");
  assertEquals(off.counters.exec, 0);

  // Invalid bodies never reach an executor.
  const badBody = taskDeps(CREATE_OK, UPDATE_OK);
  const e3 = await assertRejects(
    () =>
      executeApiCreateTaskRoute(
        routerCreateRequest(),
        { phaseId: PHASE_ID, name: "n", unknownKey: 1 },
        "req-1",
        ENABLED,
        badBody.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e3.code, "invalid_request");
  assertEquals(badBody.counters.exec, 0);

  // A missing Idempotency-Key is rejected before delegated execution.
  const noKey = taskDeps(CREATE_OK, UPDATE_OK);
  const e4 = await assertRejects(
    () =>
      executeApiCreateTaskRoute(
        new Request("https://api.example.test/v1/tasks", {
          method: "POST",
          headers: { Authorization: "Bearer caller-token" },
          body: "{}",
        }),
        createBase(),
        "req-1",
        ENABLED,
        noKey.deps,
      ),
    ApiHttpError,
  );
  assertEquals(e4.code, "invalid_request");
  assertEquals(noKey.counters.exec, 0);

  // Missing executors fail closed.
  const broken = taskDeps(CREATE_OK, UPDATE_OK);
  // deno-lint-ignore no-explicit-any
  const missingCreate = { ...(broken.deps as any) };
  delete missingCreate.createTask;
  const e5 = await assertRejects(
    () =>
      executeApiCreateTaskRoute(
        routerCreateRequest(),
        createBase(),
        "req-1",
        ENABLED,
        missingCreate,
      ),
    ApiHttpError,
  );
  assertEquals(e5.code, "internal_error");

  // deno-lint-ignore no-explicit-any
  const missingUpdate = { ...(broken.deps as any) };
  delete missingUpdate.updateTask;
  const e6 = await assertRejects(
    () =>
      executeApiUpdateTaskRoute(
        routerUpdateRequest(),
        updateBase(),
        "req-1",
        ENABLED,
        missingUpdate,
      ),
    ApiHttpError,
  );
  assertEquals(e6.code, "internal_error");
});

// ---------------------------------------------------------------------------
// M. Live HTTP pipeline and durable activity semantics
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
    assignTask: fail,
    transitionTask: fail,
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
  createResult: unknown,
  updateResult: unknown = UPDATE_OK,
  overrides: Record<string, unknown> = {},
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
      createTask: () => Promise.resolve(createResult),
      updateTask: () => Promise.resolve(updateResult),
      reorderTasks: () => Promise.reject(new Error("unreachable")),
      planTask: () => Promise.reject(new Error("unreachable")),
      assignTask: () => Promise.reject(new Error("unreachable")),
      transitionTask: () => Promise.reject(new Error("unreachable")),
    },
    activity: activityDeps(trace),
    ...overrides,
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

Deno.test("API-M.11A-C1: live POST /v1/tasks returns 201 and records Task-targeted activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("POST", "/v1/tasks", createBase()),
    liveDeps(trace, CREATE_OK),
  );
  assertEquals(response.status, 201);
  assertEquals(await response.json(), CREATE_OK);
  await settleActivity();
  assertEquals(trace.scheduled, 1);
  assertEquals(trace.records.length, 1);
  // Hierarchy is resolved SERVER-side from the returned Task identity only.
  assertEquals(trace.scopeCalls, [{ targetType: "task", targetId: TASK_ID }]);
  assertEquals(trace.records[0].routeId, "tasks.create");
  assertEquals(trace.records[0].method, "POST");
  assertEquals(trace.records[0].status, 201);
  assertEquals(trace.records[0].projectId, PROJECT_ID);
  assertEquals(trace.records[0].apiClientId, API_CLIENT_ID);
  assertEquals(trace.records[0].actorUserId, USER_ID);
});

Deno.test("API-M.11A-C1: live PATCH /v1/tasks/{taskId} returns 200 and records activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("PATCH", UPDATE_PATH, updateBase()),
    liveDeps(trace, CREATE_OK),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), UPDATE_OK);
  await settleActivity();
  assertEquals(trace.records.length, 1);
  assertEquals(trace.scopeCalls, [{ targetType: "task", targetId: TASK_ID }]);
  assertEquals(trace.records[0].routeId, "tasks.update");
  assertEquals(trace.records[0].method, "PATCH");
  assertEquals(trace.records[0].status, 200);
});

Deno.test("API-M.11A-C1: a confirmation-required create records zero durable activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("POST", "/v1/tasks", createBase()),
    liveDeps(trace, CONFIRMATION),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), CONFIRMATION);
  await settleActivity();
  assertEquals(trace.scheduled, 0);
  assertEquals(trace.records.length, 0);
  // No substitute Phase- or Project-targeted activity is emitted either.
  assertEquals(trace.scopeCalls.length, 0);
});

Deno.test("API-M.11A-C1: a stale Task update returns concurrency_conflict and no activity", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const response = await handleApiV1Request(
    liveRequest("PATCH", UPDATE_PATH, updateBase()),
    liveDeps(trace, CREATE_OK, {
      ok: false,
      outcome: "conflict",
      code: "stale_task",
    }),
  );
  assertEquals(response.status, 409);
  const body = await response.text();
  assertEquals(JSON.parse(body).error.code, "concurrency_conflict");
  assertFalse(body.includes("stale_task"));
  await settleActivity();
  assertEquals(trace.scheduled, 0);
  assertEquals(trace.records.length, 0);
});

Deno.test("API-M.11A-C1: live Task transport rejects oversized, malformed and unsupported bodies", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };

  const oversized = new Request("https://api.example.test/v1/tasks", {
    method: "POST",
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer caller-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-key-0001",
    }),
    body: JSON.stringify({ phaseId: PHASE_ID, name: "x".repeat(70_000) }),
  });
  const tooLarge = await handleApiV1Request(oversized, liveDeps(trace, CREATE_OK));
  assertEquals(tooLarge.status, 413);
  assertEquals(await codeOf(tooLarge), "request_too_large");

  const badType = new Request("https://api.example.test/v1/tasks", {
    method: "POST",
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer caller-token",
      "Content-Type": "text/plain",
      "Idempotency-Key": "idem-key-0001",
    }),
    body: "{}",
  });
  const unsupported = await handleApiV1Request(badType, liveDeps(trace, CREATE_OK));
  assertEquals(unsupported.status, 415);
  assertEquals(await codeOf(unsupported), "unsupported_media_type");

  const malformed = new Request("https://api.example.test/v1/tasks", {
    method: "POST",
    headers: new Headers({
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer caller-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-key-0001",
    }),
    body: "{not json",
  });
  const invalidJson = await handleApiV1Request(malformed, liveDeps(trace, CREATE_OK));
  assertEquals(invalidJson.status, 400);
  assertEquals(await codeOf(invalidJson), "invalid_json");

  await settleActivity();
  assertEquals(trace.records.length, 0);
});

Deno.test("API-M.11A-C1: Task routes fail closed without dependencies and are query-string free", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  executorCalls = 0;

  const missing = await handleApiV1Request(
    liveRequest("POST", "/v1/tasks", createBase()),
    liveDeps(trace, CREATE_OK, UPDATE_OK, { taskMutationRoute: undefined }),
  );
  assertEquals(missing.status, 500);
  assertEquals(await codeOf(missing), "internal_error");

  const queried = await handleApiV1Request(
    liveRequest("POST", "/v1/tasks?x=1", createBase()),
    liveDeps(trace, CREATE_OK),
  );
  assertEquals(queried.status, 400);
  assertEquals(await codeOf(queried), "invalid_request");

  const badId = await handleApiV1Request(
    liveRequest("PATCH", "/v1/tasks/not-a-uuid", updateBase()),
    liveDeps(trace, CREATE_OK),
  );
  assertEquals(badId.status, 404);
  assertEquals(await codeOf(badId), "route_not_found");

  // Task assignment remains out of scope for every implemented HTTP surface.
  const nested = await handleApiV1Request(
    liveRequest("PATCH", `${UPDATE_PATH}/assignee`, updateBase()),
    liveDeps(trace, CREATE_OK),
  );
  assertEquals(nested.status, 404);

  const disabled = await handleApiV1Request(
    liveRequest("POST", "/v1/tasks", createBase()),
    liveDeps(trace, CREATE_OK, UPDATE_OK, {
      controls: Object.freeze({
        apiEnabled: true,
        readsEnabled: true,
        mutationsEnabled: false,
      }),
    }),
  );
  assert(disabled.status === 404 || disabled.status === 503);

  assertEquals(executorCalls, 0);
  await settleActivity();
  assertEquals(trace.records.length, 0);
});

Deno.test("API-M.11A-C1: Task preflight is exact and never executes a mutation", async () => {
  const trace: ActivityTrace = { records: [], scopeCalls: [], scheduled: 0 };
  const preflight = (path: string, requestedMethod: string) =>
    new Request(`https://api.example.test${path}`, {
      method: "OPTIONS",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": requestedMethod,
        "Access-Control-Request-Headers": "authorization, content-type",
      }),
    });

  for (const [path, method] of [["/v1/tasks", "POST"], [UPDATE_PATH, "PATCH"]]) {
    const response = await handleApiV1Request(
      preflight(path, method),
      liveDeps(trace, CREATE_OK),
    );
    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
  }

  for (
    const [path, method] of [
      ["/v1/tasks", "PATCH"],
      ["/v1/tasks/not-a-uuid", "PATCH"],
      [`/v1/tasks/${NIL}`, "PATCH"],
      [`${UPDATE_PATH}/assignee`, "PATCH"],
      ["/v1/tasks", "DELETE"],
    ]
  ) {
    const response = await handleApiV1Request(
      preflight(path, method),
      liveDeps(trace, CREATE_OK),
    );
    assertEquals(response.status, 404, `${method} ${path}`);
    assertEquals(await codeOf(response), "route_not_found");
  }

  await settleActivity();
  assertEquals(trace.records.length, 0);
});
