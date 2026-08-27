// KPI-4C — focused guard for the MCP exposure and runtime wiring of the
// canonical `kpis.create` operation as `btpm_create_kpi`.
//
// Registry invariants are asserted against the live registry; wiring invariants
// are asserted statically against the accepted factory/runtime sources; control
// behaviour is asserted against the control layer with injected fakes.
// No network, no database, no Edge invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  createMcpKpiCreateToolExecutor,
  MCP_KPI_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_KPI_CREATE_TOOL_ERROR_MESSAGES,
  MCP_KPI_CREATE_TOOL_INPUT_SCHEMA,
  MCP_KPI_CREATE_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/kpiCreateMutationTool.ts";
import { KPI_CREATE_ROUTE } from "../../../functions/_shared/btpm-api/routes/kpis.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
);
const toolSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/kpiCreateMutationTool.ts",
    import.meta.url,
  ),
);
const executorSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/kpiCreateMutationExecutor.ts",
    import.meta.url,
  ),
);
const adapterSource = await Deno.readTextFile(
  new URL(
    "../../../functions/_shared/btpm-api/supabaseKpiMutation.ts",
    import.meta.url,
  ),
);

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("KPI-4C (A1): the live registry stays valid and fully covered", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("KPI-4C (A2): kpis.create is exposed exactly once as btpm_create_kpi", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.create",
  );
  assertStrictEquals(entries.length, 1);
  const entry = entries[0];
  assertStrictEquals(entry.toolName, "btpm_create_kpi");
  assertStrictEquals(entry.toolName, MCP_KPI_CREATE_TOOL_NAME);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
  assertStrictEquals(isMcpOperationExposed("kpis.create"), true);
});

// KPI-6C: later accepted KPI mutations own their own exposure assertions, so
// KPI-4C freezes only `kpis.create` itself.
Deno.test("KPI-4C (A3): kpis.create is exposed exactly once as a KPI mutation", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) =>
      entry.operationId === "kpis.create" &&
      entry.operationClass === "mutation" &&
      entry.exposure === "exposed",
  );
  assertStrictEquals(entries.length, 1);
});

// -----------------------------------------------------------------------------
// B. Bounded contract surface
// -----------------------------------------------------------------------------

Deno.test("KPI-4C (B1): the exposed schema is the strict seventeen-field envelope", () => {
  const keys = Object.keys(MCP_KPI_CREATE_TOOL_INPUT_SCHEMA.shape).sort();
  assertEquals(keys, [
    "actionPlanRequired",
    "autoSnapshotEnabled",
    "cadence",
    "calculationKey",
    "commentRequired",
    "completionMethod",
    "confirmation",
    "description",
    "formulaVersion",
    "idempotencyKey",
    "name",
    "projectId",
    "sourceMode",
    "targetDirection",
    "targetValue",
    "unit",
    "valueType",
  ]);
  assertEquals(
    [...MCP_KPI_CREATE_TOOL_ARGUMENT_NAMES].sort(),
    keys,
  );
});

Deno.test("KPI-4C (B2): no scope, identity or derived-state field is accepted", () => {
  for (
    const forbidden of [
      "workspaceId",
      "organizationId",
      "tenantId",
      "currentValue",
      "isArchived",
      "createdBy",
      "expectedOauthClientId",
      "payloadHash",
      "sourceChannel",
    ]
  ) {
    assertFalse(MCP_KPI_CREATE_TOOL_ARGUMENT_NAMES.includes(forbidden));
  }
});

Deno.test("KPI-4C (B3): bounded messages disclose no identity or database detail", () => {
  const messages = Object.values(MCP_KPI_CREATE_TOOL_ERROR_MESSAGES);
  assertStrictEquals(messages.length, 7);
  for (const message of messages) {
    assert(message.length > 0);
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_create_kpi",
        "api_client_id",
        "oauth",
        "bearer",
        "token",
      ]
    ) {
      assertFalse(
        message.toLowerCase().includes(leak),
        `bounded message leaks ${leak}`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// C. Control layer behaviour (injected fakes only)
// -----------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function trustedExecution() {
  return {
    requestedUserId: "22222222-2222-4222-8222-222222222222",
    executingUserId: "22222222-2222-4222-8222-222222222222",
    apiClientId: "33333333-3333-4333-8333-333333333333",
    oauthClientId: "44444444-4444-4444-8444-444444444444",
    policyVersionId: "55555555-5555-4555-8555-555555555555",
    requestId: "66666666-6666-4666-8666-666666666666",
    correlationId: "66666666-6666-4666-8666-666666666666",
    sourceChannel: "mcp",
    sourceClientId: "33333333-3333-4333-8333-333333333333",
    delegationMode: "delegated_user",
    // deno-lint-ignore no-explicit-any
  } as any;
}

// deno-lint-ignore no-explicit-any
function harness(writerResult: any) {
  const calls: unknown[] = [];
  const routeIds: string[] = [];
  const executor = createMcpKpiCreateToolExecutor({
    request: new Request("https://example.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer fake-token" },
    }),
    execution: trustedExecution(),
    // deno-lint-ignore no-explicit-any
    writer: ((_request: Request, projectId: string, body: any, ctx: any) => {
      calls.push({ projectId, body, ctx });
      return Promise.resolve(writerResult);
      // deno-lint-ignore no-explicit-any
    }) as any,
    rateLimitProfileResolver: {
      resolve: (_apiClientId: string, routeId: string) => {
        routeIds.push(routeId);
        return Promise.resolve({ limit: 60, windowSeconds: 60 });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      // deno-lint-ignore no-explicit-any
      consume: (input: any) =>
        Promise.resolve({
          allowed: true,
          remaining: 59,
          resetAtEpochMs: input.nowEpochMs + 60_000,
        }),
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });
  return { executor, calls, routeIds };
}

const VALID_ARGS = Object.freeze({
  projectId: PROJECT_ID,
  name: "On-time delivery",
  confirmation: true,
  idempotencyKey: "kpi-4c-key-0001",
});

Deno.test("KPI-4C (C1): a confirmed request reaches the writer and returns bounded success", async () => {
  const { executor, calls, routeIds } = harness({
    ok: true,
    outcome: "applied",
    kpiId: "77777777-7777-4777-8777-777777777777",
    projectId: PROJECT_ID,
  });

  // deno-lint-ignore no-explicit-any
  const result = await executor(VALID_ARGS as any);
  assert(result.ok);
  assertEquals(result.payload, {
    outcome: "applied",
    kpiId: "77777777-7777-4777-8777-777777777777",
    projectId: PROJECT_ID,
  });
  assertStrictEquals(calls.length, 1);
  assertEquals(routeIds, [KPI_CREATE_ROUTE.id]);
  // deno-lint-ignore no-explicit-any
  const call = calls[0] as any;
  assertStrictEquals(call.projectId, PROJECT_ID);
  // Canonical defaults are owned by the canonical body parser.
  assertStrictEquals(call.body.targetDirection, "target_exact");
  assertStrictEquals(call.body.sourceMode, "manual");
  assertStrictEquals(call.body.valueType, "number");
  assertStrictEquals(call.body.cadence, "manual_only");
  assertStrictEquals(call.body.commentRequired, false);
  // No identity, scope or provenance field is invented by the tool layer.
  assertFalse("projectId" in call.body);
  assertFalse("confirmation" in call.body);
  assertFalse("idempotencyKey" in call.body);
});

Deno.test("KPI-4C (C2): confirmation is mandatory and blocks the writer", async () => {
  const { executor, calls } = harness({ ok: false, outcome: "invalid" });
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    { ...VALID_ARGS, confirmation: false } as any,
  );
  assertFalse(result.ok);
  assert(!result.ok && result.category === "confirmation_required");
  assertStrictEquals(calls.length, 0);
});

Deno.test("KPI-4C (C3): unknown and malformed arguments never reach the writer", async () => {
  for (
    const args of [
      { ...VALID_ARGS, workspaceId: PROJECT_ID },
      { ...VALID_ARGS, projectId: "not-a-uuid" },
      { ...VALID_ARGS, name: 42 },
      { projectId: PROJECT_ID, name: "x", confirmation: true },
    ]
  ) {
    const { executor, calls } = harness({ ok: true });
    // deno-lint-ignore no-explicit-any
    const result = await executor(args as any);
    assertFalse(result.ok);
    assert(!result.ok && result.category === "invalid_arguments");
    assertStrictEquals(calls.length, 0);
  }
});

Deno.test("KPI-4C (C4): negative database outcomes map to bounded categories", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of cases) {
    const { executor } = harness({ ok: false, outcome });
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assertFalse(result.ok);
    assert(!result.ok && result.category === category);
  }
});

// -----------------------------------------------------------------------------
// D. Containment of the new modules
// -----------------------------------------------------------------------------

Deno.test("KPI-4C (D1): the control layer holds no privileged or client surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "console.log",
      "fetch(",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `kpiCreateMutationTool references ${forbidden}`,
    );
  }
});

Deno.test("KPI-4C (D2): the writer uses only the fixed MCP wrapper and no service role", () => {
  assert(executorSource.includes("createMcpV1Kpi("));
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      "Deno.env",
      "console.log",
      "api_v1_create_kpi",
    ]
  ) {
    assertFalse(
      executorSource.includes(forbidden),
      `kpiCreateMutationExecutor references ${forbidden}`,
    );
  }
});

Deno.test("KPI-4C (D3): the adapter invokes exactly the two fixed KPI wrappers", () => {
  assertStrictEquals(
    adapterSource.split('"api_v1_create_kpi"').length - 1,
    1,
  );
  assertStrictEquals(
    adapterSource.split('"mcp_v1_create_kpi"').length - 1,
    1,
  );
  // The KPI-create path owns exactly one RPC call site. Other KPI commands
  // (KPI-5B/KPI-5C update) own their own fixed call sites in the same adapter.
  assertStrictEquals(
    adapterSource.split("await client.rpc(CREATE_KPI").length - 1 +
      adapterSource.split("client.rpc(functionName, args)").length - 1,
    adapterSource.split("client.rpc(").length - 1,
  );
});

// -----------------------------------------------------------------------------
// E. Factory and runtime wiring
// -----------------------------------------------------------------------------

Deno.test("KPI-4C (E1): serverFactory imports the control layer, not the writer", () => {
  assert(serverFactorySource.includes('from "./kpiCreateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_KPI_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_KPI_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_KPI_CREATE_TOOL_ERROR_MESSAGES"));
  assertFalse(serverFactorySource.includes("kpiCreateMutationExecutor.ts"));
  assertFalse(serverFactorySource.includes("createMcpV1CreateKpiExecutor"));
});

Deno.test("KPI-4C (E2): serverFactory registers exactly one KPI-create branch", () => {
  assertStrictEquals(
    serverFactorySource.split("executors.kpiCreate(").length - 1,
    1,
  );
  assert(
    serverFactorySource.includes("readonly kpiCreate: McpKpiCreateToolExecutor"),
  );
});

Deno.test("KPI-4C (E3): the runtime builds the caller-bound writer with the anon key", () => {
  assert(mcpIndexSource.includes("kpiCreateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1CreateKpiExecutor("));
  assert(
    mcpIndexSource.includes("readonly kpiCreateWriter: McpV1CreateKpiExecutor;"),
  );

  const builderIndex = mcpIndexSource.indexOf("createMcpV1CreateKpiExecutor(");
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(builderCall.includes("supabaseAnonKey"));
  assertFalse(builderCall.includes("serviceRole"));
});

Deno.test("KPI-4C (E4): the per-request control executor is passed to the factory", () => {
  assert(mcpIndexSource.includes("createMcpKpiCreateToolExecutor({"));
  assert(mcpIndexSource.includes("writer: runtime.kpiCreateWriter,"));
  assert(mcpIndexSource.includes("kpiCreate,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpKpiCreateToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
      "rateLimitProfileResolver",
      "rateLimitStore",
      "now:",
    ]
  ) {
    assert(
      executorCall.includes(required),
      `control executor construction missing ${required}`,
    );
  }
});

Deno.test("KPI-4C (E5): no generic mutation dispatcher is introduced", () => {
  for (
    const forbidden of [
      "mutationDispatcher",
      "genericMutation",
      "executeMutationByName",
      "dispatchMutation",
    ]
  ) {
    assertFalse(mcpIndexSource.includes(forbidden));
    assertFalse(serverFactorySource.includes(forbidden));
  }
});

// -----------------------------------------------------------------------------
// F. KPI-4C-C1 — canonical input parity (structural transport only)
// -----------------------------------------------------------------------------

const SUCCESS_RESULT = Object.freeze({
  ok: true,
  outcome: "applied",
  kpiId: "77777777-7777-4777-8777-777777777777",
  projectId: PROJECT_ID,
});

// deno-lint-ignore no-explicit-any
async function canonicalBodyFor(extra: Record<string, unknown>): Promise<any> {
  const { executor, calls } = harness({ ...SUCCESS_RESULT });
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    { ...VALID_ARGS, ...extra } as any,
  );
  assert(result.ok, "expected the canonical parser to accept the input");
  assertStrictEquals(calls.length, 1);
  // deno-lint-ignore no-explicit-any
  return (calls[0] as any).body;
}

Deno.test("KPI-4C-C1 (F1): explicit nulls resolve to canonical defaults", async () => {
  const body = await canonicalBodyFor({
    targetDirection: null,
    sourceMode: null,
    valueType: null,
    cadence: null,
    completionMethod: null,
    commentRequired: null,
    actionPlanRequired: null,
    autoSnapshotEnabled: null,
  });
  assertStrictEquals(body.targetDirection, "target_exact");
  assertStrictEquals(body.sourceMode, "manual");
  assertStrictEquals(body.valueType, "number");
  assertStrictEquals(body.cadence, "manual_only");
  assertStrictEquals(body.completionMethod, null);
  assertStrictEquals(body.commentRequired, false);
  assertStrictEquals(body.actionPlanRequired, false);
  assertStrictEquals(body.autoSnapshotEnabled, false);
});

Deno.test("KPI-4C-C1 (F2): omitted and explicitly null inputs are equivalent", async () => {
  const omitted = await canonicalBodyFor({});
  const explicitNull = await canonicalBodyFor({
    targetDirection: null,
    sourceMode: null,
    valueType: null,
    cadence: null,
    completionMethod: null,
    commentRequired: null,
    actionPlanRequired: null,
    autoSnapshotEnabled: null,
  });
  for (
    const field of [
      "targetDirection",
      "sourceMode",
      "valueType",
      "cadence",
      "completionMethod",
      "commentRequired",
      "actionPlanRequired",
      "autoSnapshotEnabled",
    ]
  ) {
    assertStrictEquals(
      explicitNull[field],
      omitted[field],
      `null differs from omission for ${field}`,
    );
  }
});

Deno.test("KPI-4C-C1 (F3): blank defaulted-enum strings reach the canonical parser", async () => {
  const body = await canonicalBodyFor({
    targetDirection: "   ",
    sourceMode: " ",
    valueType: "  ",
    cadence: "   ",
  });
  assertStrictEquals(body.targetDirection, "target_exact");
  assertStrictEquals(body.sourceMode, "manual");
  assertStrictEquals(body.valueType, "number");
  assertStrictEquals(body.cadence, "manual_only");
});

Deno.test("KPI-4C-C1 (F4) [MCP-HARDENING-C6]: the transport advertises the canonical closed enum and the canonical parser still owns membership", () => {
  // C6: the transport now rejects a non-canonical nonblank value at the schema
  // boundary, while the canonical parser remains the defaulting authority and
  // no vocabulary literal is restated in the MCP module.
  const structural = MCP_KPI_CREATE_TOOL_INPUT_SCHEMA.safeParse({
    ...VALID_ARGS,
    targetDirection: "up",
  });
  assertFalse(
    structural.success,
    "the closed enum branch must reject a non-canonical nonblank value",
  );
  assertFalse(
    /"target_exact"|"manual_only"/.test(toolSource),
    "the MCP transport envelope must not duplicate KPI business vocabulary",
  );
});

Deno.test("KPI-4C-C1 (F5): invalid business values are rejected without a writer call", async () => {
  for (
    const extra of [
      { targetDirection: "up" },
      { sourceMode: "auto" },
      { valueType: "money" },
      { cadence: "daily" },
      { completionMethod: "weighted" },
      { commentRequired: "yes" },
      { autoSnapshotEnabled: 1 },
    ]
  ) {
    const { executor, calls } = harness({ ...SUCCESS_RESULT });
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...VALID_ARGS, ...extra } as any);
    assertFalse(result.ok, `expected rejection for ${JSON.stringify(extra)}`);
    assert(!result.ok && result.category === "invalid_arguments");
    assertStrictEquals(calls.length, 0);
  }
});
