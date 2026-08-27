// API-Q Task Create Step 2 — focused test for the caller-bound MCP Task
// Create writer adapter.
//
// Proves the closed wrapper selection in `supabaseTask.ts`, the shared
// validation/result mapping between the REST and MCP adapters, the preserved
// Task confirmation and replay treatment, and the fail-closed caller-bound
// executor behaviour.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1CreateTaskInput,
  createApiV1Task,
  createMcpV1Task,
} from "../../functions/_shared/btpm-api/supabaseTask.ts";
import { createMcpV1CreateTaskExecutor } from "../../functions/btpm-mcp/mcp/taskCreateMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PAYLOAD_HASH = "a".repeat(64);
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

function createInput(
  overrides: Partial<ApiV1CreateTaskInput> = {},
): ApiV1CreateTaskInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    phaseId: PHASE_ID,
    name: "Cutover rehearsal",
    description: null,
    status: "planned",
    priority: "medium",
    taskType: "work_item",
    startDate: "2026-01-01",
    dueDate: "2026-03-31",
    estimatedHours: null,
    sortOrder: null,
    requestId: "req-1",
    correlationId: "req-1",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function appliedData() {
  return {
    ok: true,
    outcome: "applied",
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    phaseId: PHASE_ID,
    status: "planned",
    priority: "medium",
    taskType: "work_item",
    startDate: "2026-01-01",
    dueDate: "2026-03-31",
    estimatedHours: null,
    sortOrder: 3,
    isArchived: false,
    createdAt: "2026-08-16T06:00:00Z",
    updatedAt: "2026-08-16T06:00:00Z",
    shiftedSiblingCount: 0,
  };
}

function confirmationData(outcome: "confirmation_required" | "replayed") {
  return {
    ok: false,
    outcome,
    code: "extend_phase_window_required",
    projectId: PROJECT_ID,
    phaseId: PHASE_ID,
    phaseStartDate: "2026-02-01",
    phaseTargetEndDate: "2026-03-31",
    requestedTaskStartDate: "2026-01-01",
    requestedTaskDueDate: "2026-03-31",
    requiredPhaseStartDate: "2026-01-01",
    requiredPhaseTargetEndDate: "2026-03-31",
  };
}

interface RecordedCall {
  readonly functionName: string;
  readonly args: Record<string, unknown>;
}

function createRecordingClient(data: unknown) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    client: {
      rpc(functionName: string, args: unknown) {
        calls.push({
          functionName,
          args: args as Record<string, unknown>,
        });
        return Promise.resolve({ data, error: null });
      },
    },
  };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    phaseId: PHASE_ID,
    name: "Cutover rehearsal",
    description: null,
    status: "planned",
    priority: "medium",
    taskType: "work_item",
    startDate: "2026-01-01",
    dueDate: "2026-03-31",
    estimatedHours: null,
    sortOrder: null,
    ...overrides,
  };
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    requestedUserId: "user-1",
    executingUserId: "user-1",
    apiClientId: "client-uuid-1",
    oauthClientId: "btpm-connected-app",
    policyVersionId: "policy-1",
    requestId: "req-1",
    correlationId: "req-1",
    sourceChannel: "mcp",
    sourceClientId: "client-uuid-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-1",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function authorizedRequest(): Request {
  return new Request("https://edge.local/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

interface FactoryCall {
  readonly url: string;
  readonly key: string;
  readonly options: Record<string, unknown>;
}

function createTrackingFactory(data: unknown) {
  const factoryCalls: FactoryCall[] = [];
  const rpcCalls: RecordedCall[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    factoryCalls.push({
      url,
      key,
      options: options as Record<string, unknown>,
    });
    return {
      rpc(functionName: string, args: unknown) {
        rpcCalls.push({
          functionName,
          args: args as Record<string, unknown>,
        });
        return Promise.resolve({ data, error: null });
      },
    };
  };
  return { factory, factoryCalls, rpcCalls };
}

const ADAPTER_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/_shared/btpm-api/supabaseTask.ts",
    import.meta.url,
  ),
);
const EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/taskCreateMutationExecutor.ts",
    import.meta.url,
  ),
);

// -----------------------------------------------------------------------------
// Base adapter — closed wrapper selection
// -----------------------------------------------------------------------------

Deno.test("REST Task Create invokes only api_v1_create_task", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createApiV1Task(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_create_task");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("MCP Task Create invokes only mcp_v1_create_task", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createMcpV1Task(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_create_task");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("Task Create wrapper selection is closed and not caller-provided", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_CREATE_TASK_FUNCTION_NAME = "mcp_v1_create_task";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type CreateTaskFunctionName =\s*\|\s*typeof API_V1_CREATE_TASK_FUNCTION_NAME\s*\|\s*typeof MCP_V1_CREATE_TASK_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the closed create-wrapper type must contain exactly the two wrappers",
  );
  assert(
    /^async function invokeCreateTask\(/m.test(ADAPTER_SOURCE),
    "invokeCreateTask must exist and must not be exported",
  );
  assert(
    !ADAPTER_SOURCE.includes("export async function invokeCreateTask"),
    "invokeCreateTask must never be exported",
  );
  assert(
    /functionName: CreateTaskFunctionName,/.test(ADAPTER_SOURCE),
    "the shared invoker must constrain the wrapper name by the closed type",
  );
  for (const fn of ["createApiV1Task", "createMcpV1Task"]) {
    const match = new RegExp(
      `export function ${fn}\\(([\\s\\S]*?)\\): Promise<ApiV1CreateTaskResult>`,
    ).exec(ADAPTER_SOURCE);
    assert(match !== null, `${fn} must be exported`);
    assert(
      !(match?.[1] ?? "").includes("functionName"),
      `${fn} must not accept a wrapper name`,
    );
  }
  // Exactly one shared RPC invocation exists inside the Task Create block of
  // the adapter module. Later accepted Task families own their own closed
  // shared invokers, so this assertion is scoped to Task Create only and never
  // to the module as a whole. No generic RPC dispatcher exists.
  const createBlockStart = ADAPTER_SOURCE.indexOf(
    "async function invokeCreateTask(",
  );
  const createBlockEnd = ADAPTER_SOURCE.indexOf(
    "export function createApiV1Task(",
  );
  assert(
    createBlockStart >= 0 && createBlockEnd > createBlockStart,
    "the Task Create shared invoker block must be locatable",
  );
  const createBlock = ADAPTER_SOURCE.slice(createBlockStart, createBlockEnd);
  assertEquals(
    (createBlock.match(/client\.rpc\(functionName,/g) ?? []).length,
    1,
    "exactly one shared RPC invocation for the fixed Task Create family",
  );
});

Deno.test("both Task Create adapters share identical validation", async () => {
  for (const adapter of [createApiV1Task, createMcpV1Task]) {
    // Empty name (existing adapter bound: length 0 rejected).
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput({ name: "" }),
        ),
      ApiHttpError,
    );
    // Non-hex payload hash.
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput({ payloadHash: "ZZ" }),
        ),
      ApiHttpError,
    );
    // Negative sort order.
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput({ sortOrder: -1 }),
        ),
      ApiHttpError,
    );
    // Unknown status enum.
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput(
            { status: "bogus" as unknown as ApiV1CreateTaskInput["status"] },
          ),
        ),
      ApiHttpError,
    );
    // Unknown priority enum.
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput(
            {
              priority: "urgent" as unknown as ApiV1CreateTaskInput["priority"],
            },
          ),
        ),
      ApiHttpError,
    );
    // Negative estimated hours.
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput({ estimatedHours: -2 }),
        ),
      ApiHttpError,
    );
  }
});

Deno.test("both Task Create adapters build identical RPC arguments", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await createApiV1Task(rest.client, createInput());
  await createMcpV1Task(mcp.client, createInput());
  assertEquals(rest.calls[0].args, mcp.calls[0].args);
  assertEquals(rest.calls[0].args, {
    _expected_oauth_client_id: "btpm-connected-app",
    _phase_id: PHASE_ID,
    _name: "Cutover rehearsal",
    _description: null,
    _status: "planned",
    _priority: "medium",
    _task_type: "work_item",
    _start_date: "2026-01-01",
    _due_date: "2026-03-31",
    _estimated_hours: null,
    _sort_order: null,
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  });
});

Deno.test("both Task Create adapters share identical result mapping", async () => {
  const rest = await createApiV1Task(
    createRecordingClient(appliedData()).client,
    createInput(),
  );
  const mcp = await createMcpV1Task(
    createRecordingClient(appliedData()).client,
    createInput(),
  );
  assertEquals(rest, mcp);
  // No Task name or description is ever returned.
  assert(!Object.prototype.hasOwnProperty.call(rest, "name"));
  assert(!Object.prototype.hasOwnProperty.call(rest, "description"));
});

// -----------------------------------------------------------------------------
// Preserved Task confirmation / replay treatment
// -----------------------------------------------------------------------------

Deno.test("confirmation_required / extend_phase_window_required is preserved on both adapters", async () => {
  for (const adapter of [createApiV1Task, createMcpV1Task]) {
    const result = await adapter(
      createRecordingClient(confirmationData("confirmation_required")).client,
      createInput(),
    );
    assertEquals(result.ok, false);
    assertEquals(result.outcome, "confirmation_required");
    assertEquals(
      (result as { code?: string }).code,
      "extend_phase_window_required",
    );
    assertEquals(
      (result as { requiredPhaseStartDate?: string | null })
        .requiredPhaseStartDate,
      "2026-01-01",
    );
  }
});

Deno.test("replayed stored confirmation is normalized back to confirmation_required on both adapters", async () => {
  for (const adapter of [createApiV1Task, createMcpV1Task]) {
    const result = await adapter(
      createRecordingClient(confirmationData("replayed")).client,
      createInput(),
    );
    // The consumer never observes `ok:false` + `replayed`.
    assertEquals(result.ok, false);
    assertEquals(result.outcome, "confirmation_required");
    assertEquals(
      (result as { code?: string }).code,
      "extend_phase_window_required",
    );
  }
});

Deno.test("negative outcomes map identically on both adapters", async () => {
  for (const outcome of [
    "invalid",
    "not_authorized",
    "idempotency_conflict",
    "idempotency_pending",
  ]) {
    const rest = await createApiV1Task(
      createRecordingClient({ ok: false, outcome }).client,
      createInput(),
    );
    const mcp = await createMcpV1Task(
      createRecordingClient({ ok: false, outcome }).client,
      createInput(),
    );
    assertEquals(rest, mcp);
    assertEquals(rest.outcome, outcome);
  }
});

// -----------------------------------------------------------------------------
// Caller-bound MCP executor
// -----------------------------------------------------------------------------

Deno.test("MCP executor reuses parseApiV1CreateTaskBody and executes the MCP wrapper once", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreateTaskExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    // deno-lint-ignore no-explicit-any -- structural body fixture for the parser
    createBody() as any,
    // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
    createContext() as any,
  );

  assert(
    EXECUTOR_SOURCE.includes("parseApiV1CreateTaskBody(body)"),
    "the executor must revalidate the body with the canonical parser",
  );
  assertEquals(rpcCalls.length, 1, "exactly one RPC invocation");
  assertEquals(rpcCalls[0].functionName, "mcp_v1_create_task");
  assertEquals(factoryCalls.length, 1, "exactly one client construction");
  assert(result.ok);
});

Deno.test("MCP executor rejects a body the canonical parser rejects, before any client", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreateTaskExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await assertRejects(() =>
    execute(
      authorizedRequest(),
      // Inverted Task window is rejected by the canonical parser.
      // deno-lint-ignore no-explicit-any -- deliberately invalid fixture
      createBody({ startDate: "2026-05-01", dueDate: "2026-01-01" }) as any,
      // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
      createContext() as any,
    )
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("MCP executor fails closed on every inconsistent trusted context before client/RPC", async () => {
  const inconsistentContexts: Record<string, unknown>[] = [
    createContext({ requestedUserId: "  " }),
    createContext({ executingUserId: "  " }),
    createContext({ executingUserId: "other-user" }),
    createContext({ apiClientId: "" }),
    createContext({ oauthClientId: "" }),
    createContext({ policyVersionId: "" }),
    createContext({ requestId: "" }),
    createContext({ correlationId: "" }),
    createContext({ sourceClientId: "" }),
    createContext({ sourceClientId: "different-client" }),
    createContext({ correlationId: "not-request-id" }),
    createContext({ sourceChannel: "external_api" }),
    createContext({ delegationMode: "service_account" }),
    createContext({ idempotencyKey: "" }),
    createContext({ payloadHash: "A".repeat(64) }),
    createContext({ payloadHash: "a".repeat(63) }),
  ];

  for (const context of inconsistentContexts) {
    const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
      appliedData(),
    );
    const execute = createMcpV1CreateTaskExecutor(
      SUPABASE_URL,
      ANON_KEY,
      factory,
    );
    await assertRejects(
      () =>
        execute(
          authorizedRequest(),
          // deno-lint-ignore no-explicit-any -- structural body fixture
          createBody() as any,
          // deno-lint-ignore no-explicit-any -- deliberately inconsistent
          context as any,
        ),
      ApiHttpError,
    );
    assertEquals(factoryCalls.length, 0, "no client may be constructed");
    assertEquals(rpcCalls.length, 0, "no RPC may execute");
  }
});

Deno.test("MCP executor requires the current bearer token and fails before any client", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreateTaskExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await assertRejects(
    () =>
      execute(
        new Request("https://edge.local/mcp", { method: "POST" }),
        // deno-lint-ignore no-explicit-any -- structural body fixture
        createBody() as any,
        // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
        createContext() as any,
      ),
    ApiAuthenticationError,
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("MCP executor creates a fresh anon-key caller-bound client per invocation", async () => {
  const { factory, factoryCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreateTaskExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  for (let i = 0; i < 3; i++) {
    await execute(
      authorizedRequest(),
      // deno-lint-ignore no-explicit-any -- structural body fixture
      createBody() as any,
      // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
      createContext() as any,
    );
  }
  assertEquals(factoryCalls.length, 3, "one fresh client per invocation");
  for (const call of factoryCalls) {
    assertEquals(call.url, SUPABASE_URL);
    assertEquals(call.key, ANON_KEY);
    assertEquals(call.options, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
  }
});

Deno.test("MCP executor propagates request/correlation/idempotency/payloadHash and canonical body values unchanged", async () => {
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreateTaskExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const context = createContext({
    requestId: "req-xyz",
    correlationId: "req-xyz",
    idempotencyKey: "Idem-Key_9+!=",
    payloadHash: "b".repeat(64),
    oauthClientId: "connected-app-2",
  });
  await execute(
    authorizedRequest(),
    createBody({
      sortOrder: 4,
      description: "narrative",
      priority: "high",
      taskType: "milestone",
      estimatedHours: 12.5,
      // deno-lint-ignore no-explicit-any -- structural body fixture
    }) as any,
    // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
    context as any,
  );
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: "connected-app-2",
    _phase_id: PHASE_ID,
    _name: "Cutover rehearsal",
    _description: "narrative",
    _status: "planned",
    _priority: "high",
    _task_type: "milestone",
    _start_date: "2026-01-01",
    _due_date: "2026-03-31",
    _estimated_hours: 12.5,
    _sort_order: 4,
    _request_id: "req-xyz",
    _correlation_id: "req-xyz",
    _idempotency_key: "Idem-Key_9+!=",
    _payload_hash: "b".repeat(64),
  });
});

Deno.test("MCP executor returns the bounded confirmation result unchanged", async () => {
  const { factory } = createTrackingFactory(
    confirmationData("confirmation_required"),
  );
  const execute = createMcpV1CreateTaskExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  const result = await execute(
    authorizedRequest(),
    // deno-lint-ignore no-explicit-any -- structural body fixture
    createBody() as any,
    // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
    createContext() as any,
  );
  assertEquals(result.ok, false);
  assertEquals(result.outcome, "confirmation_required");
  assertEquals(
    (result as { code?: string }).code,
    "extend_phase_window_required",
  );
});

// -----------------------------------------------------------------------------
// Security boundaries and scope containment
// -----------------------------------------------------------------------------

Deno.test("MCP Task Create executor never references service role or env", () => {
  for (const forbidden of [
    "service_role",
    "SERVICE_ROLE",
    "serviceRole",
    "Deno.env",
    "SUPABASE_SERVICE_ROLE_KEY",
    "fetch(",
    "setTimeout",
    "retry",
    "console.",
  ]) {
    assert(
      !EXECUTOR_SOURCE.includes(forbidden),
      `executor must not reference ${forbidden}`,
    );
  }
});

Deno.test("MCP Task Create executor performs no business/DB reads and no authorization logic", () => {
  // Executable code only: documentation comments legitimately name the
  // downstream concerns this layer must never implement.
  const code = EXECUTOR_SOURCE.split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  for (const forbidden of [
    ".from(",
    "select(",
    "has_project_pm_authority",
    "tenantId",
    "organizationId",
    "workspaceId",
    "enablement",
    "createHash",
    "digest",
    "encrypt",
    "apply_task_create",
    "api_v1_create_task",
    "createApiV1Task",
    "mcp_v1_create_task",
    "registerTool",
    "server.tool(",
  ]) {
    assert(
      !code.includes(forbidden),
      `executor must not reference ${forbidden}`,
    );
  }
  assertEquals(
    (code.match(/createMcpV1Task\(/g) ?? []).length,
    1,
    "the executor must call the MCP writer exactly once",
  );
});
