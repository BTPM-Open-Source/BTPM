// KPI-5C — focused guard for the MCP exposure and runtime wiring of the
// canonical `kpis.update` operation as `btpm_update_kpi`.
//
// Registry invariants are asserted against the live registry; wiring invariants
// are asserted statically against the accepted factory/runtime sources; control
// behaviour is asserted against the control layer with injected fakes.
// No network, no database, no Edge invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isMcpOperationExposed,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  createMcpKpiUpdateToolExecutor,
  MCP_KPI_UPDATE_TOOL_ARGUMENT_NAMES,
  MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_KPI_UPDATE_TOOL_NAME,
} from "../../../functions/btpm-mcp/mcp/kpiUpdateMutationTool.ts";
import {
  buildApiV1UpdateKpiIdempotencyPayload,
  KPI_UPDATE_ROUTE,
  parseApiV1UpdateKpiBody,
} from "../../../functions/_shared/btpm-api/routes/kpis.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../../../functions/_shared/btpm-api/routes/allowlist.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../../functions/btpm-mcp/index.ts", import.meta.url),
);
const toolSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/kpiUpdateMutationTool.ts",
    import.meta.url,
  ),
);
const executorSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/kpiUpdateMutationExecutor.ts",
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
// A. Registry
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (A1): the live registry stays valid and fully covered", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("KPI-5C (A2): kpis.update is exposed exactly once as btpm_update_kpi", () => {
  const entries = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "kpis.update",
  );
  assertStrictEquals(entries.length, 1);
  const entry = entries[0];
  assertStrictEquals(entry.toolName, "btpm_update_kpi");
  assertStrictEquals(entry.toolName, MCP_KPI_UPDATE_TOOL_NAME);
  assertStrictEquals(entry.title, "Update BTPM KPI");
  assertStrictEquals(
    entry.description,
    "Updates one KPI definition through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "required");
  assertStrictEquals(isMcpOperationExposed("kpis.update"), true);
});

// KPI-6B: absolute registry cardinality is owned by the central registry
// guards, so KPI-5C freezes only the exposed KPI-relevant surface it owns.
// KPI-6C: absolute exposed cardinality and the future KPI-mutation surface are
// owned by the central registry guards and by each later accepted step, so
// KPI-5C freezes only `kpis.update` itself.
Deno.test("KPI-5C (A3): kpis.update is counted once in the exposed mutation surface", () => {
  const exposed = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.exposure === "exposed",
  );
  assertStrictEquals(
    exposed.filter((entry) => entry.operationId === "kpis.update").length,
    1,
  );
  assertStrictEquals(
    exposed.filter((entry) =>
      entry.operationId === "kpis.update" &&
      entry.operationClass === "mutation"
    ).length,
    1,
  );
});

// -----------------------------------------------------------------------------
// B. Strict structural envelope
// -----------------------------------------------------------------------------

const EXPECTED_ARGUMENT_NAMES = [
  "actionPlanRequired",
  "autoSnapshotEnabled",
  "cadence",
  "calculationKey",
  "commentRequired",
  "completionMethod",
  "confirmation",
  "description",
  "expectedUpdatedAt",
  "formulaVersion",
  "idempotencyKey",
  "kpiId",
  "name",
  "sourceMode",
  "targetDirection",
  "targetValue",
  "unit",
  "valueType",
];

Deno.test("KPI-5C (B1): the exposed schema is the strict eighteen-field envelope", () => {
  const keys = Object.keys(MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA.shape).sort();
  assertStrictEquals(keys.length, 18);
  assertEquals(keys, EXPECTED_ARGUMENT_NAMES);
  assertEquals([...MCP_KPI_UPDATE_TOOL_ARGUMENT_NAMES].sort(), keys);
});

Deno.test("KPI-5C (B2): unknown keys are rejected by the strict envelope", () => {
  const parsed = MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
    kpiId: "11111111-1111-4111-8111-111111111111",
    expectedUpdatedAt: "2026-08-22T07:00:00Z",
    confirmation: true,
    idempotencyKey: "kpi-5c-key-0001",
    projectId: "11111111-1111-4111-8111-111111111111",
  });
  assertFalse(parsed.success);
});

Deno.test("KPI-5C (B3): no scope, set-flag, provenance or system field is accepted", () => {
  for (
    const forbidden of [
      "projectId",
      "workspaceId",
      "organizationId",
      "tenantId",
      "setName",
      "setDescription",
      "setTargetDirection",
      "currentValue",
      "isArchived",
      "createdBy",
      "requestId",
      "correlationId",
      "payloadHash",
      "sourceChannel",
      "expectedOauthClientId",
      "kpi_id",
      "expected_updated_at",
    ]
  ) {
    assertFalse(
      MCP_KPI_UPDATE_TOOL_ARGUMENT_NAMES.includes(forbidden),
      `envelope exposes ${forbidden}`,
    );
    assertFalse(
      Object.prototype.hasOwnProperty.call(
        MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA.shape,
        forbidden,
      ),
      `schema exposes ${forbidden}`,
    );
  }
});

Deno.test("KPI-5C (B4): the KPI-update MCP envelope declares no business z.enum", () => {
  assertFalse(
    /z\.enum\(\[/.test(toolSource),
    "MCP transport typing must not own KPI business vocabularies",
  );
});

// -----------------------------------------------------------------------------
// C. Control layer behaviour (injected fakes only)
// -----------------------------------------------------------------------------

const KPI_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const EXPECTED_UPDATED_AT = "2026-08-22T07:00:00Z";

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
function harness(writerResult: any, options?: { rateLimited?: boolean }) {
  const calls: unknown[] = [];
  const routeIds: string[] = [];
  const executor = createMcpKpiUpdateToolExecutor({
    request: new Request("https://example.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer fake-token" },
    }),
    execution: trustedExecution(),
    // deno-lint-ignore no-explicit-any
    writer: ((_request: Request, kpiId: string, body: any, ctx: any) => {
      calls.push({ kpiId, body, ctx });
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
          allowed: options?.rateLimited ? false : true,
          remaining: options?.rateLimited ? 0 : 59,
          resetAtEpochMs: input.nowEpochMs + 60_000,
        }),
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });
  return { executor, calls, routeIds };
}

const VALID_ARGS = Object.freeze({
  kpiId: KPI_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  confirmation: true,
  idempotencyKey: "kpi-5c-key-0001",
});

function appliedResult() {
  return {
    ok: true,
    outcome: "applied",
    kpiId: KPI_ID,
    projectId: PROJECT_ID,
    updatedAt: "2026-08-22T07:30:00.123456Z",
  };
}

Deno.test("KPI-5C (C1): valid canonical values pass and reach the writer once", async () => {
  const { executor, calls, routeIds } = harness(appliedResult());
  const result = await executor(
    {
      ...VALID_ARGS,
      name: "On-time delivery",
      targetDirection: "increase",
      sourceMode: "manual",
      valueType: "percent",
      cadence: "monthly",
      commentRequired: true,
      // deno-lint-ignore no-explicit-any
    } as any,
  );
  assert(result.ok);
  assertStrictEquals(calls.length, 1);
  assertEquals(routeIds, [KPI_UPDATE_ROUTE.id]);
  // deno-lint-ignore no-explicit-any
  const call = calls[0] as any;
  assertStrictEquals(call.kpiId, KPI_ID);
  assertStrictEquals(call.body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  assertStrictEquals(call.body.name, "On-time delivery");
  assertStrictEquals(call.body.setName, true);
  assertStrictEquals(call.body.targetDirection, "increase");
  assertStrictEquals(call.body.setTargetDirection, true);
  assertStrictEquals(call.body.setUnit, false);
  assertFalse("confirmation" in call.body);
  assertFalse("idempotencyKey" in call.body);
  assertFalse("kpiId" in call.body);
});

Deno.test("KPI-5C (C2): explicit null clear stays present and derives set=true", async () => {
  const { executor, calls } = harness(appliedResult());
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    { ...VALID_ARGS, description: null, unit: null } as any,
  );
  assert(result.ok);
  // deno-lint-ignore no-explicit-any
  const call = calls[0] as any;
  assertStrictEquals(call.body.setDescription, true);
  assertStrictEquals(call.body.description, null);
  assertStrictEquals(call.body.setUnit, true);
  assertStrictEquals(call.body.unit, null);
  assertStrictEquals(call.body.setName, false);
});

Deno.test("KPI-5C (C3): omission derives set=false and blank clearable text is canonicalized", () => {
  const omitted = parseApiV1UpdateKpiBody({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
  });
  assertStrictEquals(omitted.setDescription, false);
  assertStrictEquals(omitted.description, null);

  const blank = parseApiV1UpdateKpiBody({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    description: "   ",
  });
  assertStrictEquals(blank.setDescription, true);
  assertStrictEquals(blank.description, null);
});

Deno.test("KPI-5C (C4): absence and explicit clear hash to different canonical payloads", () => {
  const absent = buildApiV1UpdateKpiIdempotencyPayload(
    KPI_ID,
    parseApiV1UpdateKpiBody({ expectedUpdatedAt: EXPECTED_UPDATED_AT }),
  );
  const cleared = buildApiV1UpdateKpiIdempotencyPayload(
    KPI_ID,
    parseApiV1UpdateKpiBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      description: null,
    }),
  );
  assertNotEquals(JSON.stringify(absent), JSON.stringify(cleared));
  assertStrictEquals(absent.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  assertStrictEquals(cleared.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  assertStrictEquals(absent.kpiId, KPI_ID);
});

Deno.test("KPI-5C (C5) [MCP-HARDENING-C6]: invalid nonblank targetDirection is rejected as bounded invalid_arguments", async () => {
  const structural = MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
    ...VALID_ARGS,
    targetDirection: "up",
  });
  assertFalse(structural.success);

  const { executor, calls } = harness(appliedResult());
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    { ...VALID_ARGS, targetDirection: "up" } as any,
  );
  assertFalse(result.ok);
  assert(!result.ok && result.category === "invalid_arguments");
  assertStrictEquals(calls.length, 0);
});

Deno.test("KPI-5C (C6) [MCP-HARDENING-C6]: nulls on non-nullable present fields and non-integers stay bounded invalid_arguments", async () => {
  // C6: explicit null on `sourceMode`, `name` and `commentRequired` is now
  // rejected by the transport schema (canonical parser rejects it too);
  // `formulaVersion: 1.5` remains structurally valid and canonical-parser
  // rejected.
  for (
    const args of [
      { ...VALID_ARGS, sourceMode: null },
      { ...VALID_ARGS, name: null },
      { ...VALID_ARGS, commentRequired: null },
      { ...VALID_ARGS, formulaVersion: 1.5 },
    ]
  ) {

    const { executor, calls } = harness(appliedResult());
    // deno-lint-ignore no-explicit-any
    const result = await executor(args as any);
    assertFalse(result.ok);
    assert(!result.ok && result.category === "invalid_arguments");
    assertStrictEquals(calls.length, 0);
  }
});

Deno.test("KPI-5C (C7): a missing or malformed expectedUpdatedAt never reaches the writer", async () => {
  for (
    const args of [
      { kpiId: KPI_ID, confirmation: true, idempotencyKey: "k" },
      { ...VALID_ARGS, expectedUpdatedAt: "2026-08-22" },
      { ...VALID_ARGS, kpiId: "not-a-uuid" },
    ]
  ) {
    const { executor, calls } = harness(appliedResult());
    // deno-lint-ignore no-explicit-any
    const result = await executor(args as any);
    assertFalse(result.ok);
    assert(!result.ok && result.category === "invalid_arguments");
    assertStrictEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// D. Confirmation
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (D1): false or missing confirmation blocks the writer", async () => {
  const denied = harness(appliedResult());
  const result = await denied.executor(
    // deno-lint-ignore no-explicit-any
    { ...VALID_ARGS, confirmation: false } as any,
  );
  assertFalse(result.ok);
  assert(!result.ok && result.category === "confirmation_required");
  assertStrictEquals(denied.calls.length, 0);

  const missing = harness(appliedResult());
  const withoutConfirmation = {
    kpiId: KPI_ID,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    idempotencyKey: "kpi-5c-key-0002",
  };
  // deno-lint-ignore no-explicit-any
  const second = await missing.executor(withoutConfirmation as any);
  assertFalse(second.ok);
  assertStrictEquals(missing.calls.length, 0);
});

Deno.test("KPI-5C (D2): confirmation never enters the business body, hash or writer args", async () => {
  const { executor, calls } = harness(appliedResult());
  // deno-lint-ignore no-explicit-any
  await executor(VALID_ARGS as any);
  // deno-lint-ignore no-explicit-any
  const call = calls[0] as any;
  assertFalse("confirmation" in call.body);
  const payload = buildApiV1UpdateKpiIdempotencyPayload(
    KPI_ID,
    parseApiV1UpdateKpiBody({ expectedUpdatedAt: EXPECTED_UPDATED_AT }),
  );
  assertFalse("confirmation" in payload);
  assertFalse("idempotencyKey" in payload);
});

// -----------------------------------------------------------------------------
// E. Idempotency payload
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (E1): the canonical KPI-update idempotency payload is reused exactly", () => {
  assert(toolSource.includes("buildApiV1UpdateKpiIdempotencyPayload("));
  const payload = buildApiV1UpdateKpiIdempotencyPayload(
    KPI_ID,
    parseApiV1UpdateKpiBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "KPI",
    }),
  );
  const keys = Object.keys(payload).sort();
  assertStrictEquals(keys.length, 30);
  assert(keys.includes("kpiId"));
  assert(keys.includes("expectedUpdatedAt"));
  for (
    const field of [
      "name",
      "description",
      "unit",
      "targetValue",
      "targetDirection",
      "sourceMode",
      "valueType",
      "cadence",
      "calculationKey",
      "formulaVersion",
      "completionMethod",
      "commentRequired",
      "actionPlanRequired",
      "autoSnapshotEnabled",
    ]
  ) {
    assert(keys.includes(field), `payload missing ${field}`);
    assert(
      keys.includes(`set${field[0].toUpperCase()}${field.slice(1)}`),
      `payload missing set flag for ${field}`,
    );
  }
  for (
    const forbidden of [
      "requestId",
      "correlationId",
      "payloadHash",
      "sourceChannel",
      "apiClientId",
      "oauthClientId",
      "confirmation",
    ]
  ) {
    assertFalse(keys.includes(forbidden), `payload leaks ${forbidden}`);
  }
});

// -----------------------------------------------------------------------------
// F. Rate limiting
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (F1): the canonical kpis.update profile is resolved before the writer", async () => {
  assertStrictEquals(KPI_UPDATE_ROUTE.id, "kpis.update");
  const { executor, calls, routeIds } = harness(appliedResult());
  // deno-lint-ignore no-explicit-any
  await executor(VALID_ARGS as any);
  assertEquals(routeIds, ["kpis.update"]);
  assertStrictEquals(calls.length, 1);
});

Deno.test("KPI-5C (F2): a denied rate limit prevents any writer invocation", async () => {
  const { executor, calls } = harness(appliedResult(), { rateLimited: true });
  // deno-lint-ignore no-explicit-any
  const result = await executor(VALID_ARGS as any);
  assertFalse(result.ok);
  assert(!result.ok && result.category === "rate_limited");
  assertStrictEquals(calls.length, 0);
});

// -----------------------------------------------------------------------------
// G. Caller-bound writer containment
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (G1): the writer uses only the fixed MCP wrapper and no service role", () => {
  assert(executorSource.includes("updateMcpV1Kpi("));
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      "Deno.env",
      "console.log",
      "api_v1_update_kpi",
      "setTimeout",
    ]
  ) {
    assertFalse(
      executorSource.includes(forbidden),
      `kpiUpdateMutationExecutor references ${forbidden}`,
    );
  }
});

Deno.test("KPI-5C (G2): a fresh caller-bound anon client is built per invocation", () => {
  assert(executorSource.includes("extractBearerToken(request)"));
  assert(executorSource.includes("persistSession: false"));
  assert(executorSource.includes("autoRefreshToken: false"));
  assert(executorSource.includes("detectSessionInUrl: false"));
  assert(executorSource.includes("Authorization: `Bearer ${token}`"));
  assert(executorSource.includes("supabaseAnonKey"));
});

Deno.test("KPI-5C (G3): execution-context consistency is checked before client construction", () => {
  const gateIndex = executorSource.indexOf(
    "requireConsistentMutationContext(\n      executionContext,\n    )",
  );
  const tokenIndex = executorSource.indexOf("extractBearerToken(request)");
  const clientIndex = executorSource.indexOf("createClient(supabaseUrl");
  assert(gateIndex > 0);
  assert(tokenIndex > gateIndex);
  assert(clientIndex > tokenIndex);
  for (
    const required of [
      "requestedUserId !== executingUserId",
      "sourceClientId !== apiClientId",
      "correlationId !== requestId",
      "REQUIRED_SOURCE_CHANNEL",
      "REQUIRED_DELEGATION_MODE",
      "SHA256_HEX_PATTERN.test(payloadHash)",
    ]
  ) {
    assert(executorSource.includes(required), `gate missing ${required}`);
  }
});

Deno.test("KPI-5C (G4): the writer performs no read-before-write, retry or timestamp refresh", () => {
  for (
    const forbidden of [
      ".select(",
      ".from(",
      "retry",
      "new Date(",
      "Date.now(",
    ]
  ) {
    assertFalse(
      executorSource.includes(forbidden),
      `kpiUpdateMutationExecutor references ${forbidden}`,
    );
  }
  assert(executorSource.includes("canonicalBody.expectedUpdatedAt"));
});

Deno.test("KPI-5C (G5): the adapter exposes exactly the two fixed KPI-update wrappers", () => {
  assertStrictEquals(
    adapterSource.split('"api_v1_update_kpi"').length - 1,
    1,
  );
  assertStrictEquals(
    adapterSource.split('"mcp_v1_update_kpi"').length - 1,
    1,
  );
  assert(adapterSource.includes("export function updateApiV1Kpi("));
  assert(adapterSource.includes("export function updateMcpV1Kpi("));
  assert(adapterSource.includes("type UpdateKpiFunctionName"));
  // Exactly one shared update invocation site; the wrapper name is a closed
  // compile-time literal union and never caller supplied.
  // KPI-6B: each KPI wrapper family keeps exactly one shared invocation site;
  // the total site count is owned by the adapter's own step tests.
  assertStrictEquals(
    adapterSource.split("await client.rpc(functionName, args)").length - 1,
    3,
  );
});

Deno.test("KPI-5C (G6): the KPI-update RPC args are the exact thirty-five accepted arguments", () => {
  const start = adapterSource.indexOf("export interface ApiV1UpdateKpiRpcArgs");
  assert(start > 0);
  const block = adapterSource.slice(
    start,
    adapterSource.indexOf("}", start),
  );
  const args = block.match(/readonly _[a-z_]+:/g) ?? [];
  assertStrictEquals(args.length, 35);
});

Deno.test("KPI-5C (G7): the control layer holds no privileged or client surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "console.log",
      "fetch(",
      "mcp_v1_update_kpi",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `kpiUpdateMutationTool references ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// H. Outcomes
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (H1): applied, no_change and replayed return the exact bounded payload", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { executor } = harness({
      ok: true,
      outcome,
      kpiId: KPI_ID,
      projectId: PROJECT_ID,
      updatedAt: "2026-08-22T07:30:00.123456Z",
    });
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assert(result.ok);
    assertEquals(result.payload, {
      outcome,
      kpiId: KPI_ID,
      projectId: PROJECT_ID,
      updatedAt: "2026-08-22T07:30:00.123456Z",
    });
    assertStrictEquals(Object.keys(result.payload).length, 4);
  }
});

Deno.test("KPI-5C (H2): a stale conflict maps to the bounded stale_kpi_definition category", async () => {
  const { executor } = harness({
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
  });
  // deno-lint-ignore no-explicit-any
  const result = await executor(VALID_ARGS as any);
  assertFalse(result.ok);
  assert(!result.ok && result.category === "stale_kpi_definition");
  const message = MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES.stale_kpi_definition;
  assert(message.includes("expectedUpdatedAt"));
  for (
    const leak of [
      "current_updated_at",
      "sqlstate",
      "policy",
      "postgres",
      "service_role",
      "mcp_v1_update_kpi",
      "token",
    ]
  ) {
    assertFalse(
      message.toLowerCase().includes(leak),
      `stale message leaks ${leak}`,
    );
  }
});

Deno.test("KPI-5C (H3): negative database outcomes map to bounded categories", async () => {
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

Deno.test("KPI-5C (H4): a malformed or unknown writer result is bounded as unavailable", async () => {
  for (const writerResult of [{ ok: false, outcome: "mystery" }, null, 7]) {
    const { executor } = harness(writerResult);
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assertFalse(result.ok);
    assert(!result.ok && result.category === "unavailable");
  }
});

// KPI-5C-C1 — fail-closed runtime validation of writer results.

const MALFORMED_SUCCESS_RESULTS: ReadonlyArray<unknown> = Object.freeze([
  { ok: true },
  { ...appliedResult(), outcome: "mystery" },
  (() => {
    const r = appliedResult() as Record<string, unknown>;
    delete r.kpiId;
    return r;
  })(),
  (() => {
    const r = appliedResult() as Record<string, unknown>;
    delete r.projectId;
    return r;
  })(),
  (() => {
    const r = appliedResult() as Record<string, unknown>;
    delete r.updatedAt;
    return r;
  })(),
  { ...appliedResult(), kpiId: "" },
  { ...appliedResult(), projectId: "" },
  { ...appliedResult(), updatedAt: "" },
  { ...appliedResult(), message: "applied the KPI update" },
  { ...appliedResult(), detail: "row locked" },
  { ...appliedResult(), reason: "narrative" },
]);

const MALFORMED_CONFLICT_RESULTS: ReadonlyArray<unknown> = Object.freeze([
  { outcome: "conflict" },
  { ok: true, outcome: "conflict", code: "stale_kpi_definition" },
  { outcome: "conflict", code: "stale_kpi_definition" },
  { ok: false, outcome: "conflict" },
  { ok: false, outcome: "conflict", code: "some_other_code" },
  {
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
    detail: "current_updated_at=2026-08-22T07:31:00Z",
  },
  {
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
    message: "narrative",
  },
  {
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
    reason: "narrative",
  },
]);

const MALFORMED_NEGATIVE_RESULTS: ReadonlyArray<unknown> = Object.freeze([
  { ok: false, outcome: "invalid", message: "bad name" },
  { ok: false, outcome: "not_authorized", detail: "policy" },
  { ok: false, outcome: "idempotency_conflict", reason: "hash mismatch" },
  { ok: false, outcome: "idempotency_pending", message: "in progress" },
  { ok: false, outcome: "mystery" },
  { ok: true, outcome: "invalid" },
  { outcome: "not_authorized" },
]);

const NON_OBJECT_RESULTS: ReadonlyArray<unknown> = Object.freeze([
  null,
  undefined,
  7,
  "applied",
  true,
  [],
  [appliedResult()],
  {},
]);

Deno.test("KPI-5C (H6): exact canonical writer results remain unchanged", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { executor, calls } = harness({ ...appliedResult(), outcome });
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assert(result.ok);
    assertEquals(result.payload.outcome, outcome);
    assertStrictEquals(calls.length, 1);
  }

  const stale = harness({
    ok: false,
    outcome: "conflict",
    code: "stale_kpi_definition",
  });
  // deno-lint-ignore no-explicit-any
  const staleResult = await stale.executor(VALID_ARGS as any);
  assert(!staleResult.ok && staleResult.category === "stale_kpi_definition");

  const negatives: ReadonlyArray<readonly [string, string]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of negatives) {
    const { executor } = harness({ ok: false, outcome });
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assert(!result.ok && result.category === category);
  }
});

Deno.test("KPI-5C (H7): malformed success results fail closed as unavailable", async () => {
  for (const writerResult of MALFORMED_SUCCESS_RESULTS) {
    const { executor, calls } = harness(writerResult);
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assertFalse(result.ok, `malformed success surfaced ok:true`);
    assert(
      !result.ok && result.category === "unavailable",
      `expected unavailable for ${JSON.stringify(writerResult)}`,
    );
    assertStrictEquals(calls.length, 1);
  }
});

Deno.test("KPI-5C (H8): malformed conflict results never map to stale_kpi_definition", async () => {
  for (const writerResult of MALFORMED_CONFLICT_RESULTS) {
    const { executor } = harness(writerResult);
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assertFalse(result.ok);
    assert(
      !result.ok && result.category === "unavailable",
      `expected unavailable for ${JSON.stringify(writerResult)}`,
    );
  }
});

Deno.test("KPI-5C (H9): malformed negatives and non-objects fail closed as unavailable", async () => {
  for (
    const writerResult of [
      ...MALFORMED_NEGATIVE_RESULTS,
      ...NON_OBJECT_RESULTS,
    ]
  ) {
    const { executor } = harness(writerResult);
    // deno-lint-ignore no-explicit-any
    const result = await executor(VALID_ARGS as any);
    assertFalse(result.ok);
    assert(
      !result.ok && result.category === "unavailable",
      `expected unavailable for ${JSON.stringify(writerResult ?? null)}`,
    );
  }
});

Deno.test("KPI-5C (H10): the writer is still invoked exactly once, only after controls", async () => {
  const denied = harness(appliedResult(), { rateLimited: true });
  // deno-lint-ignore no-explicit-any
  await denied.executor(VALID_ARGS as any);
  assertStrictEquals(denied.calls.length, 0);

  const unconfirmed = harness({ ok: true });
  const unconfirmedResult = await unconfirmed.executor(
    // deno-lint-ignore no-explicit-any
    { ...VALID_ARGS, confirmation: false } as any,
  );
  assertStrictEquals(unconfirmed.calls.length, 0);
  assert(
    !unconfirmedResult.ok &&
      unconfirmedResult.category === "confirmation_required",
  );

  const malformed = harness({ ok: true, outcome: "applied" });
  // deno-lint-ignore no-explicit-any
  const malformedResult = await malformed.executor(VALID_ARGS as any);
  assertStrictEquals(malformed.calls.length, 1);
  assert(!malformedResult.ok && malformedResult.category === "unavailable");
});

Deno.test("KPI-5C (H5): bounded messages disclose no identity or database detail", () => {
  const messages = Object.values(MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES);
  assertStrictEquals(messages.length, 8);
  for (const message of messages) {
    assert(message.length > 0);
    for (
      const leak of [
        "service_role",
        "sqlstate",
        "postgres",
        "mcp_v1_update_kpi",
        "api_client_id",
        "oauth",
        "bearer",
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
// I. Factory and runtime wiring
// -----------------------------------------------------------------------------

Deno.test("KPI-5C (I1): serverFactory imports the control layer, not the writer", () => {
  assert(serverFactorySource.includes('from "./kpiUpdateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_KPI_UPDATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES"));
  assertFalse(serverFactorySource.includes("kpiUpdateMutationExecutor.ts"));
  assertFalse(serverFactorySource.includes("createMcpV1UpdateKpiExecutor"));
});

Deno.test("KPI-5C (I2): serverFactory registers exactly one KPI-update branch", () => {
  assertStrictEquals(
    serverFactorySource.split("executors.kpiUpdate(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split("MCP_KPI_UPDATE_TOOL_NAME").length - 1,
    2,
  );
  assert(
    serverFactorySource.includes(
      "readonly kpiUpdate: McpKpiUpdateToolExecutor;",
    ),
  );
});

Deno.test("KPI-5C (I3): the runtime builds the caller-bound writer with the anon key", () => {
  assert(mcpIndexSource.includes("kpiUpdateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1UpdateKpiExecutor("));
  assert(
    mcpIndexSource.includes("readonly kpiUpdateWriter: McpV1UpdateKpiExecutor;"),
  );

  const builderIndex = mcpIndexSource.indexOf("createMcpV1UpdateKpiExecutor(");
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(builderCall.includes("supabaseAnonKey"));
  assertFalse(builderCall.includes("serviceRole"));
});

Deno.test("KPI-5C (I4): exactly one per-request control executor is composed and injected", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpKpiUpdateToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("writer: runtime.kpiUpdateWriter,"));
  assert(mcpIndexSource.includes("kpiUpdate,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpKpiUpdateToolExecutor({",
  );
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

Deno.test("KPI-5C (I5): no generic mutation dispatcher is introduced", () => {
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

Deno.test("KPI-5C (I6): the existing KPI create wiring remains unchanged", () => {
  assertStrictEquals(
    serverFactorySource.split("executors.kpiCreate(").length - 1,
    1,
  );
  assert(
    mcpIndexSource.split("createMcpV1CreateKpiExecutor(").length - 1 >= 1,
  );
  assert(mcpIndexSource.includes("writer: runtime.kpiCreateWriter,"));
});

// -----------------------------------------------------------------------------
// J. REST regression
// -----------------------------------------------------------------------------

// KPI-6B: global REST cardinality is owned by
// `api-v1-current-surface-topology.test.ts`; KPI-5C keeps only the read count
// it depends on plus its own route assertions below.
Deno.test("KPI-5C (J1): REST read topology remains 24 reads", () => {
  assertStrictEquals(
    API_V1_ROUTE_ALLOWLIST.filter((route) => route.operation === "read").length,
    24,
  );
});

Deno.test("KPI-5C (J2): kpis.update stays live exactly once in REST", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter(
    (route) => route.id === "kpis.update",
  );
  assertStrictEquals(matches.length, 1);
  assertStrictEquals(matches[0].method, "PATCH");
  assertStrictEquals(matches[0].path, "/v1/kpis/:kpiid");
});

Deno.test("KPI-5C (J3): updateApiV1Kpi still invokes only api_v1_update_kpi", () => {
  const start = adapterSource.indexOf("export function updateApiV1Kpi(");
  assert(start > 0);
  const block = adapterSource.slice(start, start + 320);
  assert(block.includes("API_V1_UPDATE_KPI_FUNCTION_NAME"));
  assertFalse(block.includes("MCP_V1_UPDATE_KPI_FUNCTION_NAME"));
});
