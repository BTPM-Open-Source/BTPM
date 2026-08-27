// API-Q Phase Create Step 2 — focused test for the caller-bound MCP Phase
// Create writer adapter.
//
// Proves the closed wrapper selection in `supabasePhase.ts`, the shared
// validation/result mapping between the REST and MCP adapters, the preserved
// Phase confirmation and replay treatment, and the fail-closed caller-bound
// executor behaviour.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type ApiV1CreatePhaseInput,
  createApiV1Phase,
  createMcpV1Phase,
} from "../../functions/_shared/btpm-api/supabasePhase.ts";
import { createMcpV1CreatePhaseExecutor } from "../../functions/btpm-mcp/mcp/phaseCreateMutationExecutor.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const PAYLOAD_HASH = "a".repeat(64);
const TOKEN = "caller.bearer.token";

const SUPABASE_URL = "https://project.supabase.co";
const ANON_KEY = "anon-publishable-key";

function createInput(
  overrides: Partial<ApiV1CreatePhaseInput> = {},
): ApiV1CreatePhaseInput {
  return {
    expectedOauthClientId: "btpm-connected-app",
    projectId: PROJECT_ID,
    name: "Realization",
    description: null,
    status: "planned",
    phaseType: "work_item",
    startDate: "2026-01-01",
    targetEndDate: "2026-03-31",
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
    phaseId: PHASE_ID,
    projectId: PROJECT_ID,
    status: "planned",
    phaseType: "work_item",
    startDate: "2026-01-01",
    targetEndDate: "2026-03-31",
    sortOrder: 3,
    isArchived: false,
    createdAt: "2026-08-14T10:00:00Z",
    updatedAt: "2026-08-14T10:00:00Z",
    shiftedSiblingCount: 0,
  };
}

function confirmationData(outcome: "confirmation_required" | "replayed") {
  return {
    ok: false,
    outcome,
    code: "extend_project_window_required",
    projectId: PROJECT_ID,
    projectStartDate: "2026-02-01",
    projectTargetEndDate: "2026-03-31",
    requestedPhaseStartDate: "2026-01-01",
    requestedPhaseTargetEndDate: "2026-03-31",
    requiredProjectStartDate: "2026-01-01",
    requiredProjectTargetEndDate: "2026-03-31",
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
    projectId: PROJECT_ID,
    name: "Realization",
    description: null,
    status: "planned",
    phaseType: "work_item",
    startDate: "2026-01-01",
    targetEndDate: "2026-03-31",
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
    "../../functions/_shared/btpm-api/supabasePhase.ts",
    import.meta.url,
  ),
);
const EXECUTOR_SOURCE = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/phaseCreateMutationExecutor.ts",
    import.meta.url,
  ),
);

// -----------------------------------------------------------------------------
// Base adapter — closed wrapper selection
// -----------------------------------------------------------------------------

Deno.test("REST Phase Create invokes only api_v1_create_phase", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createApiV1Phase(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "api_v1_create_phase");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("MCP Phase Create invokes only mcp_v1_create_phase", async () => {
  const { calls, client } = createRecordingClient(appliedData());
  const result = await createMcpV1Phase(client, createInput());
  assertEquals(calls.length, 1);
  assertEquals(calls[0].functionName, "mcp_v1_create_phase");
  assert(result.ok);
  assertEquals(result.outcome, "applied");
});

Deno.test("Phase Create wrapper selection is closed and not caller-provided", () => {
  assert(
    ADAPTER_SOURCE.includes(
      'const MCP_V1_CREATE_PHASE_FUNCTION_NAME = "mcp_v1_create_phase";',
    ),
    "the fixed MCP wrapper constant must exist",
  );
  assert(
    /type CreatePhaseFunctionName =\s*\|\s*typeof API_V1_CREATE_PHASE_FUNCTION_NAME\s*\|\s*typeof MCP_V1_CREATE_PHASE_FUNCTION_NAME;/
      .test(ADAPTER_SOURCE),
    "the closed create-wrapper type must contain exactly the two wrappers",
  );
  assert(
    /^async function invokeCreatePhase\(/m.test(ADAPTER_SOURCE),
    "invokeCreatePhase must exist and must not be exported",
  );
  assert(
    !ADAPTER_SOURCE.includes("export async function invokeCreatePhase"),
    "invokeCreatePhase must never be exported",
  );
  assert(
    /functionName: CreatePhaseFunctionName,/.test(ADAPTER_SOURCE),
    "the shared invoker must constrain the wrapper name by the closed type",
  );
  // Neither export accepts a function name from its caller.
  for (const fn of ["createApiV1Phase", "createMcpV1Phase"]) {
    const match = new RegExp(
      `export function ${fn}\\(([\\s\\S]*?)\\): Promise<ApiV1CreatePhaseResult>`,
    ).exec(ADAPTER_SOURCE);
    assert(match !== null, `${fn} must be exported`);
    assert(
      !(match?.[1] ?? "").includes("functionName"),
      `${fn} must not accept a wrapper name`,
    );
  }
  // Durable invariant (no historical count): every Phase RPC invocation in the
  // adapter goes through a shared invoker whose wrapper name is constrained by a
  // closed `...FunctionName` type, and there is exactly one such invocation per
  // such invoker. The number of Phase mutation families may grow freely.
  const closedInvokerParameters =
    (ADAPTER_SOURCE.match(/^\s*functionName: \w+FunctionName,$/gm) ?? []).length;
  const sharedRpcInvocations =
    (ADAPTER_SOURCE.match(/client\.rpc\(functionName,/g) ?? []).length;
  const allRpcInvocations = (ADAPTER_SOURCE.match(/client\.rpc\(/g) ?? []).length;
  assert(closedInvokerParameters > 0, "at least one closed shared invoker must exist");
  assertEquals(
    sharedRpcInvocations,
    closedInvokerParameters,
    "exactly one shared RPC invocation per closed Phase mutation invoker",
  );
  assertEquals(
    allRpcInvocations,
    sharedRpcInvocations,
    "no Phase RPC invocation may bypass the closed shared invokers",
  );

});

Deno.test("both Phase Create adapters share identical validation", async () => {
  for (const adapter of [createApiV1Phase, createMcpV1Phase]) {
    // Blank name.
    await assertRejects(
      () =>
        adapter(
          createRecordingClient(appliedData()).client,
          createInput({ name: "   " }),
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
            { status: "bogus" as unknown as ApiV1CreatePhaseInput["status"] },
          ),
        ),
      ApiHttpError,
    );
  }
});

Deno.test("both Phase Create adapters build identical RPC arguments", async () => {
  const rest = createRecordingClient(appliedData());
  const mcp = createRecordingClient(appliedData());
  await createApiV1Phase(rest.client, createInput());
  await createMcpV1Phase(mcp.client, createInput());
  assertEquals(rest.calls[0].args, mcp.calls[0].args);
  assertEquals(rest.calls[0].args, {
    _expected_oauth_client_id: "btpm-connected-app",
    _project_id: PROJECT_ID,
    _name: "Realization",
    _description: null,
    _status: "planned",
    _phase_type: "work_item",
    _start_date: "2026-01-01",
    _target_end_date: "2026-03-31",
    _sort_order: null,
    _request_id: "req-1",
    _correlation_id: "req-1",
    _idempotency_key: "idem-1",
    _payload_hash: PAYLOAD_HASH,
  });
});

Deno.test("both Phase Create adapters share identical result mapping", async () => {
  const rest = await createApiV1Phase(
    createRecordingClient(appliedData()).client,
    createInput(),
  );
  const mcp = await createMcpV1Phase(
    createRecordingClient(appliedData()).client,
    createInput(),
  );
  assertEquals(rest, mcp);
});

// -----------------------------------------------------------------------------
// Preserved Phase confirmation / replay treatment
// -----------------------------------------------------------------------------

Deno.test("confirmation_required / extend_project_window_required is preserved on both adapters", async () => {
  for (const adapter of [createApiV1Phase, createMcpV1Phase]) {
    const result = await adapter(
      createRecordingClient(confirmationData("confirmation_required")).client,
      createInput(),
    );
    assertEquals(result.ok, false);
    assertEquals(result.outcome, "confirmation_required");
    assertEquals(
      (result as { code?: string }).code,
      "extend_project_window_required",
    );
    assertEquals(
      (result as { requiredProjectStartDate?: string | null })
        .requiredProjectStartDate,
      "2026-01-01",
    );
  }
});

Deno.test("replayed stored confirmation is normalized back to confirmation_required on both adapters", async () => {
  for (const adapter of [createApiV1Phase, createMcpV1Phase]) {
    const result = await adapter(
      createRecordingClient(confirmationData("replayed")).client,
      createInput(),
    );
    // The consumer never observes `ok:false` + `replayed`.
    assertEquals(result.ok, false);
    assertEquals(result.outcome, "confirmation_required");
    assertEquals(
      (result as { code?: string }).code,
      "extend_project_window_required",
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
    const rest = await createApiV1Phase(
      createRecordingClient({ ok: false, outcome }).client,
      createInput(),
    );
    const mcp = await createMcpV1Phase(
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

Deno.test("MCP executor reuses parseApiV1CreatePhaseBody and executes the MCP wrapper once", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreatePhaseExecutor(
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
    EXECUTOR_SOURCE.includes("parseApiV1CreatePhaseBody(body)"),
    "the executor must revalidate the body with the canonical parser",
  );
  assertEquals(rpcCalls.length, 1, "exactly one RPC invocation");
  assertEquals(rpcCalls[0].functionName, "mcp_v1_create_phase");
  assertEquals(factoryCalls.length, 1, "exactly one client construction");
  assert(result.ok);
});

Deno.test("MCP executor rejects a body the canonical parser rejects, before any client", async () => {
  const { factory, factoryCalls, rpcCalls } = createTrackingFactory(
    appliedData(),
  );
  const execute = createMcpV1CreatePhaseExecutor(
    SUPABASE_URL,
    ANON_KEY,
    factory,
  );
  await assertRejects(() =>
    execute(
      authorizedRequest(),
      // Inverted planning window is rejected by the canonical parser.
      // deno-lint-ignore no-explicit-any -- deliberately invalid fixture
      createBody({ startDate: "2026-05-01", targetEndDate: "2026-01-01" }) as any,
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
    const execute = createMcpV1CreatePhaseExecutor(
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
  const execute = createMcpV1CreatePhaseExecutor(
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
  const execute = createMcpV1CreatePhaseExecutor(
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

Deno.test("MCP executor propagates request/correlation/idempotency/payloadHash unchanged", async () => {
  const { factory, rpcCalls } = createTrackingFactory(appliedData());
  const execute = createMcpV1CreatePhaseExecutor(
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
    // deno-lint-ignore no-explicit-any -- structural body fixture
    createBody({ sortOrder: 4, description: "narrative" }) as any,
    // deno-lint-ignore no-explicit-any -- structural trusted-context fixture
    context as any,
  );
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: "connected-app-2",
    _project_id: PROJECT_ID,
    _name: "Realization",
    _description: "narrative",
    _status: "planned",
    _phase_type: "work_item",
    _start_date: "2026-01-01",
    _target_end_date: "2026-03-31",
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
  const execute = createMcpV1CreatePhaseExecutor(
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
    "extend_project_window_required",
  );
});

// -----------------------------------------------------------------------------
// Security boundaries and scope containment
// -----------------------------------------------------------------------------

Deno.test("MCP Phase Create executor never references service role or env", () => {
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

Deno.test("MCP Phase Create executor performs no business/DB reads and no authorization logic", () => {
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
    "apply_phase_create",
    "api_v1_create_phase",
  ]) {
    assert(
      !code.includes(forbidden),
      `executor must not reference ${forbidden}`,
    );
  }
  assertEquals(
    (code.match(/createMcpV1Phase\(/g) ?? []).length,
    1,
    "the executor must call the MCP writer exactly once",
  );
});


Deno.test("the Phase Create writer stays confined to the accepted adapter layer", async () => {
  const registry = await Deno.readTextFile(
    new URL(
      "../../functions/btpm-mcp/mcp/toolRegistry.ts",
      import.meta.url,
    ),
  );
  const factory = await Deno.readTextFile(
    new URL(
      "../../functions/btpm-mcp/mcp/serverFactory.ts",
      import.meta.url,
    ),
  );
  const runtime = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );

  // Phase Create Step 4 wires the writer in the runtime only: the registry
  // stays metadata-only and the server factory stays bounded to the Step 3
  // control contract. The database wrapper name never leaves the adapter.
  for (const source of [registry, factory]) {
    assert(
      !source.includes("phaseCreateMutationExecutor"),
      "registry/factory must not import the caller-bound writer",
    );
    assert(
      !source.includes("createMcpV1CreatePhaseExecutor"),
      "registry/factory must not construct the caller-bound writer",
    );
  }
  for (const source of [registry, factory, runtime]) {
    assert(
      !source.includes("mcp_v1_create_phase"),
      "no MCP registry/factory/runtime file may name the Phase Create wrapper",
    );
  }
  assert(
    runtime.includes("createMcpV1CreatePhaseExecutor("),
    "the runtime constructs the accepted caller-bound writer",
  );
  // Exposure and tool registration are owned by Phase Create Step 4 through the
  // bounded Step 3 control contract, never through this writer adapter.
  assert(
    /operationId: "phases\.create",[\s\S]{0,400}?exposure: "exposed",/.test(
      registry,
    ),
    "phases.create is exposed by the accepted Step 4",
  );
  assert(
    factory.includes("MCP_PHASE_CREATE_TOOL_NAME"),
    "the factory registers the tool through the Step 3 control constant",
  );

  for (const forbidden of ["registerTool", "server.tool("]) {
    assert(
      !EXECUTOR_SOURCE.includes(forbidden),
      `executor must not perform ${forbidden}`,
    );
  }
});

Deno.test("Phase Create introduces no other Phase adapter variant", async () => {
  // Phase Create must not touch the Reorder or Plan wrappers. (Phase Update,
  // Phase Reorder and Phase Plan each gained their own accepted closed unions
  // in their own steps and are asserted by those steps' focused tests.)
  for (const forbidden of [
    "mcp_v1_transition_phase",
    "TransitionPhaseFunctionName",
  ]) {
    assert(
      !ADAPTER_SOURCE.includes(forbidden),
      `Phase adapter must not introduce ${forbidden}`,
    );
  }

  // No migration or database function is touched by this step.
  const executorDir = new URL(
    "../../functions/btpm-mcp/mcp/",
    import.meta.url,
  );
  const exists = await Deno.stat(
    new URL("phaseCreateMutationExecutor.ts", executorDir),
  );
  assert(exists.isFile);
});
