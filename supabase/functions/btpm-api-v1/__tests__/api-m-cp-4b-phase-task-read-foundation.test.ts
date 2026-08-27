// API-M.CP.4B — Focused foundation tests for the Phase and Task detail HTTP
// read foundation. Route contracts, path parsers, fixed RPC adapters,
// caller-bound anon readers and the non-live state only.
//
// CP.4A SQL containment is NOT retested here. Synthetic UUIDs only; no
// environment, network or database is touched.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";
import {
  PHASE_CREATE_ROUTE,
  PHASE_DETAIL_ROUTE,
  PHASE_UPDATE_ROUTE,
  parseApiV1PhaseDetailPath,
  parseApiV1PhaseUpdatePath,
} from "../routes/phases.ts";
import {
  TASK_CREATE_ROUTE,
  TASK_DETAIL_ROUTE,
  TASK_UPDATE_ROUTE,
  parseApiV1TaskDetailPath,
  parseApiV1TaskUpdatePath,
} from "../routes/tasks.ts";
import {
  readApiV1Phase,
  type ApiV1PhaseReadRpcClient,
} from "../../_shared/btpm-api/supabasePhaseRead.ts";
import {
  readApiV1Task,
  type ApiV1TaskReadRpcClient,
} from "../../_shared/btpm-api/supabaseTaskRead.ts";
import { createDelegatedApiV1PhaseReader } from "../../_shared/btpm-api/supabaseDelegatedPhaseRead.ts";
import { createDelegatedApiV1TaskReader } from "../../_shared/btpm-api/supabaseDelegatedTaskRead.ts";

const PHASE_ID = "11111111-2222-4333-8444-555555555555";
const TASK_ID = "22222222-3333-4444-8555-666666666666";
const PROJECT_ID = "77777777-2222-4333-8444-555555555555";
const ASSIGNEE_ID = "44444444-4444-4444-8444-444444444444";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "oauth-client-abc";

const CONTEXT = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
}) as unknown as AuthenticatedApiContext;

const PHASE_ROW = Object.freeze({
  phaseId: PHASE_ID,
  projectId: PROJECT_ID,
  name: "Realize",
  description: null,
  status: "active",
  phaseType: "work_item",
  sortOrder: 3,
  startDate: "2026-01-05",
  targetEndDate: "2026-03-31",
  baselineStartDate: null,
  baselineEndDate: null,
  addedAfterBaseline: false,
  actualStartDate: null,
  actualEndDate: null,
  updatedAt: "2026-08-11T10:00:00.000Z",
});

const TASK_ROW = Object.freeze({
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  phaseId: PHASE_ID,
  name: "Configure ledger",
  description: "Chart of accounts.",
  status: "planned",
  priority: "high",
  taskType: "work_item",
  sortOrder: 0,
  startDate: null,
  dueDate: "2026-02-15",
  baselineStartDate: null,
  baselineEndDate: null,
  addedAfterBaseline: true,
  actualStartDate: null,
  actualEndDate: null,
  estimatedHours: 12.5,
  assigneeId: ASSIGNEE_ID,
  updatedAt: "2026-08-11T11:22:33.000Z",
});

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(
  result: unknown,
  calls: RpcCall[],
): ApiV1PhaseReadRpcClient & ApiV1TaskReadRpcClient {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

function okClient(data: unknown, calls: RpcCall[] = []) {
  return recordingClient({ data, error: null }, calls);
}

// -----------------------------------------------------------------------------
// Route contracts
// -----------------------------------------------------------------------------

Deno.test("CP.4B — exact Phase and Task GET detail route contracts", () => {
  assertEquals(PHASE_DETAIL_ROUTE, {
    id: "phases.get_by_id",
    method: "GET",
    path: "/v1/phases/:phaseid",
    operation: "read",
  });
  assertEquals(TASK_DETAIL_ROUTE, {
    id: "tasks.get_by_id",
    method: "GET",
    path: "/v1/tasks/:taskid",
    operation: "read",
  });
});

Deno.test("CP.4B — existing Phase/Task mutation contracts unchanged", () => {
  assertEquals(PHASE_CREATE_ROUTE, {
    id: "phases.create",
    method: "POST",
    path: "/v1/phases",
    operation: "mutation",
  });
  assertEquals(PHASE_UPDATE_ROUTE, {
    id: "phases.update",
    method: "PATCH",
    path: "/v1/phases/:phaseid",
    operation: "mutation",
  });
  assertEquals(TASK_CREATE_ROUTE, {
    id: "tasks.create",
    method: "POST",
    path: "/v1/tasks",
    operation: "mutation",
  });
  assertEquals(TASK_UPDATE_ROUTE, {
    id: "tasks.update",
    method: "PATCH",
    path: "/v1/tasks/:taskid",
    operation: "mutation",
  });
  // Mutation identifier parsing behaviour is untouched.
  assertEquals(parseApiV1PhaseUpdatePath(`/v1/phases/${PHASE_ID}`), {
    phaseId: PHASE_ID,
  });
  assertEquals(parseApiV1TaskUpdatePath(`/v1/tasks/${TASK_ID}`), {
    taskId: TASK_ID,
  });
});

// -----------------------------------------------------------------------------
// Strict detail path parsing
// -----------------------------------------------------------------------------

Deno.test("CP.4B — Phase detail path parser accepts only a non-nil UUID", () => {
  assertEquals(parseApiV1PhaseDetailPath(`/v1/phases/${PHASE_ID}`), {
    phaseId: PHASE_ID,
  });

  const rejected = [
    "/v1/phases/",
    "/v1/phases",
    `/v1/phases/${NIL_UUID}`,
    "/v1/phases/not-a-uuid",
    `/v1/phases/${PHASE_ID}/`,
    `/v1/phases/${PHASE_ID}/planning`,
    `/v1/phases/${PHASE_ID}?x=1`,
    `/v1/phases/${PHASE_ID}#frag`,
    `/v1/phases/${PHASE_ID.slice(0, 8)}%2D${PHASE_ID.slice(9)}`,
    `/v1/phases/${PHASE_ID};v=1`,
    `/v1/phases/ ${PHASE_ID}`,
    `/v1/tasks/${PHASE_ID}`,
  ];
  for (const path of rejected) {
    const error = assertThrows(
      () => parseApiV1PhaseDetailPath(path),
      ApiHttpError,
    );
    assertStrictEquals((error as ApiHttpError).code, "invalid_request");
  }
});

Deno.test("CP.4B — Task detail path parser accepts only a non-nil UUID", () => {
  assertEquals(parseApiV1TaskDetailPath(`/v1/tasks/${TASK_ID}`), {
    taskId: TASK_ID,
  });

  const rejected = [
    "/v1/tasks/",
    "/v1/tasks",
    `/v1/tasks/${NIL_UUID}`,
    "/v1/tasks/not-a-uuid",
    `/v1/tasks/${TASK_ID}/`,
    `/v1/tasks/${TASK_ID}/transition`,
    `/v1/tasks/${TASK_ID}?x=1`,
    `/v1/tasks/${TASK_ID}#frag`,
    `/v1/tasks/${TASK_ID};v=1`,
    `/v1/tasks/ ${TASK_ID}`,
    `/v1/phases/${TASK_ID}`,
  ];
  for (const path of rejected) {
    const error = assertThrows(
      () => parseApiV1TaskDetailPath(path),
      ApiHttpError,
    );
    assertStrictEquals((error as ApiHttpError).code, "invalid_request");
  }
});

// -----------------------------------------------------------------------------
// Phase adapter
// -----------------------------------------------------------------------------

Deno.test("CP.4B — Phase adapter calls api_v1_get_phase with exact args", async () => {
  const calls: RpcCall[] = [];
  const item = await readApiV1Phase(
    okClient(PHASE_ROW, calls),
    OAUTH_CLIENT_ID,
    PHASE_ID,
  );

  assertEquals(calls.length, 1);
  assertStrictEquals(calls[0].name, "api_v1_get_phase");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _phase_id: PHASE_ID,
  });

  assertEquals(Object.keys(item).sort(), [
    "actualEndDate",
    "actualStartDate",
    "addedAfterBaseline",
    "baselineEndDate",
    "baselineStartDate",
    "description",
    "name",
    "phaseId",
    "phaseType",
    "projectId",
    "sortOrder",
    "startDate",
    "status",
    "targetEndDate",
    "updatedAt",
  ]);
  assertEquals(Object.keys(item).length, 15);
  assertEquals(item, PHASE_ROW);
});

Deno.test("CP.4B — Phase adapter rejects missing, extra and invalid fields", async () => {
  const { targetEndDate: _omitted, ...missing } = PHASE_ROW;
  const cases: unknown[] = [
    missing,
    { ...PHASE_ROW, workspaceId: PROJECT_ID },
    { ...PHASE_ROW, status: "in_progress" },
    { ...PHASE_ROW, phaseType: "task" },
    { ...PHASE_ROW, sortOrder: -1 },
    { ...PHASE_ROW, sortOrder: 1.5 },
    { ...PHASE_ROW, startDate: "2026-02-30" },
    { ...PHASE_ROW, startDate: "2026-2-3" },
    { ...PHASE_ROW, addedAfterBaseline: "false" },
    { ...PHASE_ROW, name: "" },
    { ...PHASE_ROW, updatedAt: "not-a-timestamp" },
    { ...PHASE_ROW, phaseId: NIL_UUID },
    [PHASE_ROW],
    null,
  ];
  for (const data of cases) {
    const error = await assertRejects(
      () => readApiV1Phase(okClient(data), OAUTH_CLIENT_ID, PHASE_ID),
      ApiHttpError,
    );
    assertStrictEquals((error as ApiHttpError).code, "internal_error");
  }
});

Deno.test("CP.4B — Phase adapter maps SQLSTATEs without not_found", async () => {
  const expectations: ReadonlyArray<readonly [string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["23505", "internal_error"],
    ["P0001", "internal_error"],
  ];
  for (const [code, expected] of expectations) {
    const client: ApiV1PhaseReadRpcClient = {
      rpc: () => Promise.resolve({ data: null, error: { code } }),
    };
    const error = await assertRejects(
      () => readApiV1Phase(client, OAUTH_CLIENT_ID, PHASE_ID),
      ApiHttpError,
    );
    assertStrictEquals((error as ApiHttpError).code, expected);
    assert(expected !== "not_found");
  }

  const throwing: ApiV1PhaseReadRpcClient = {
    rpc: () => Promise.reject(new Error("transport")),
  };
  const transport = await assertRejects(
    () => readApiV1Phase(throwing, OAUTH_CLIENT_ID, PHASE_ID),
    ApiHttpError,
  );
  assertStrictEquals((transport as ApiHttpError).code, "internal_error");
});

// -----------------------------------------------------------------------------
// Task adapter
// -----------------------------------------------------------------------------

Deno.test("CP.4B — Task adapter calls api_v1_get_task with exact args", async () => {
  const calls: RpcCall[] = [];
  const item = await readApiV1Task(
    okClient(TASK_ROW, calls),
    OAUTH_CLIENT_ID,
    TASK_ID,
  );

  assertEquals(calls.length, 1);
  assertStrictEquals(calls[0].name, "api_v1_get_task");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: OAUTH_CLIENT_ID,
    _task_id: TASK_ID,
  });

  assertEquals(Object.keys(item).length, 19);
  assertEquals(Object.keys(item).sort(), [
    "actualEndDate",
    "actualStartDate",
    "addedAfterBaseline",
    "assigneeId",
    "baselineEndDate",
    "baselineStartDate",
    "description",
    "dueDate",
    "estimatedHours",
    "name",
    "phaseId",
    "priority",
    "projectId",
    "sortOrder",
    "startDate",
    "status",
    "taskId",
    "taskType",
    "updatedAt",
  ]);
  assertEquals(item, TASK_ROW);
});

Deno.test("CP.4B — Task adapter accepts null phaseId, assigneeId and estimatedHours", async () => {
  const item = await readApiV1Task(
    okClient({
      ...TASK_ROW,
      phaseId: null,
      assigneeId: null,
      estimatedHours: null,
    }),
    OAUTH_CLIENT_ID,
    TASK_ID,
  );
  assertStrictEquals(item.phaseId, null);
  assertStrictEquals(item.assigneeId, null);
  assertStrictEquals(item.estimatedHours, null);
});

Deno.test("CP.4B — Task adapter rejects missing, extra and invalid fields", async () => {
  const { dueDate: _omitted, ...missing } = TASK_ROW;
  const cases: unknown[] = [
    missing,
    { ...TASK_ROW, ownerId: ASSIGNEE_ID },
    { ...TASK_ROW, taskAssignments: [] },
    { ...TASK_ROW, status: "in_progress" },
    { ...TASK_ROW, priority: "urgent" },
    { ...TASK_ROW, taskType: "story" },
    { ...TASK_ROW, sortOrder: -1 },
    { ...TASK_ROW, phaseId: NIL_UUID },
    { ...TASK_ROW, assigneeId: NIL_UUID },
    { ...TASK_ROW, estimatedHours: -1 },
    { ...TASK_ROW, estimatedHours: Number.POSITIVE_INFINITY },
    { ...TASK_ROW, estimatedHours: "12.5" },
    { ...TASK_ROW, dueDate: "2026-02-30" },
    { ...TASK_ROW, updatedAt: "not-a-timestamp" },
    { ...TASK_ROW, name: "" },
    null,
  ];
  for (const data of cases) {
    const error = await assertRejects(
      () => readApiV1Task(okClient(data), OAUTH_CLIENT_ID, TASK_ID),
      ApiHttpError,
    );
    assertStrictEquals((error as ApiHttpError).code, "internal_error");
  }
});

Deno.test("CP.4B — Task adapter maps SQLSTATEs without not_found", async () => {
  const expectations: ReadonlyArray<readonly [string, string]> = [
    ["42501", "not_authorized"],
    ["22023", "invalid_request"],
    ["XX000", "internal_error"],
  ];
  for (const [code, expected] of expectations) {
    const client: ApiV1TaskReadRpcClient = {
      rpc: () => Promise.resolve({ data: null, error: { code } }),
    };
    const error = await assertRejects(
      () => readApiV1Task(client, OAUTH_CLIENT_ID, TASK_ID),
      ApiHttpError,
    );
    assertStrictEquals((error as ApiHttpError).code, expected);
    assert(expected !== "not_found");
  }
});

// -----------------------------------------------------------------------------
// Delegated readers
// -----------------------------------------------------------------------------

Deno.test("CP.4B — delegated Phase reader builds a fresh bearer-bound anon client", async () => {
  const factoryCalls: unknown[][] = [];
  const rpcCalls: RpcCall[] = [];
  const reader = createDelegatedApiV1PhaseReader(
    "https://example.supabase.co",
    "anon-key",
    (url, key, options) => {
      factoryCalls.push([url, key, options]);
      return okClient(PHASE_ROW, rpcCalls);
    },
  );

  const request = new Request("https://edge.local/v1/phases/x", {
    headers: { Authorization: "Bearer caller-token" },
  });
  const item = await reader(request, CONTEXT, PHASE_ID);
  assertStrictEquals(item.phaseId, PHASE_ID);

  // Fresh client per invocation.
  await reader(request, CONTEXT, PHASE_ID);
  assertEquals(factoryCalls.length, 2);

  const [url, key, options] = factoryCalls[0] as [string, string, unknown];
  assertStrictEquals(url, "https://example.supabase.co");
  assertStrictEquals(key, "anon-key");
  assertEquals(options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: "Bearer caller-token" } },
  });

  // Expected OAuth client ID comes from the authenticated context only.
  assertStrictEquals(
    rpcCalls[0].args._expected_oauth_client_id,
    OAUTH_CLIENT_ID,
  );
  assertStrictEquals(rpcCalls[0].name, "api_v1_get_phase");
});

Deno.test("CP.4B — delegated Task reader is bearer-bound and anon-only", async () => {
  const factoryCalls: unknown[][] = [];
  const rpcCalls: RpcCall[] = [];
  const reader = createDelegatedApiV1TaskReader(
    "https://example.supabase.co",
    "anon-key",
    (url, key, options) => {
      factoryCalls.push([url, key, options]);
      return okClient(TASK_ROW, rpcCalls);
    },
  );

  const request = new Request("https://edge.local/v1/tasks/x", {
    headers: { Authorization: "Bearer caller-token" },
  });
  const item = await reader(request, CONTEXT, TASK_ID);
  assertStrictEquals(item.taskId, TASK_ID);
  assertStrictEquals(rpcCalls[0].name, "api_v1_get_task");
  assertStrictEquals(
    rpcCalls[0].args._expected_oauth_client_id,
    OAUTH_CLIENT_ID,
  );

  const [, key, options] = factoryCalls[0] as [
    string,
    string,
    { global: { headers: Record<string, string> } },
  ];
  assertStrictEquals(key, "anon-key");
  assertStrictEquals(
    options.global.headers.Authorization,
    "Bearer caller-token",
  );
});

Deno.test("CP.4B — delegated readers reject a request without a bearer token", async () => {
  const phaseReader = createDelegatedApiV1PhaseReader(
    "https://example.supabase.co",
    "anon-key",
    () => okClient(PHASE_ROW),
  );
  const taskReader = createDelegatedApiV1TaskReader(
    "https://example.supabase.co",
    "anon-key",
    () => okClient(TASK_ROW),
  );
  const request = new Request("https://edge.local/v1/tasks/x");
  await assertRejects(() => phaseReader(request, CONTEXT, PHASE_ID));
  await assertRejects(() => taskReader(request, CONTEXT, TASK_ID));
});

// -----------------------------------------------------------------------------
// Non-live state
// -----------------------------------------------------------------------------

Deno.test("CP.4B — no service-role or environment access in the new modules", async () => {
  const files = [
    "../../_shared/btpm-api/supabasePhaseRead.ts",
    "../../_shared/btpm-api/supabaseTaskRead.ts",
    "../../_shared/btpm-api/supabaseDelegatedPhaseRead.ts",
    "../../_shared/btpm-api/supabaseDelegatedTaskRead.ts",
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(new URL(file, import.meta.url));
    assert(!source.includes("SERVICE_ROLE"));
    assert(!source.includes("Deno.env"));
    assert(!/\bfetch\s*\(/.test(source));
    assert(!source.includes(".from("));
  }
});

// API-N.RG1A — current global cardinality is owned by
// api-v1-current-surface-topology.test.ts.
Deno.test("CP.4C — Phase and Task GET routes are live exactly once", () => {
  const ids = API_V1_ROUTE_ALLOWLIST.map((route) => route.id);
  assertEquals(ids.filter((id) => id === "phases.get_by_id").length, 1);
  assertEquals(ids.filter((id) => id === "tasks.get_by_id").length, 1);
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === PHASE_DETAIL_ROUTE).length,
    1,
  );
  assertEquals(
    API_V1_ROUTE_ALLOWLIST.filter((r) => r === TASK_DETAIL_ROUTE).length,
    1,
  );
});
