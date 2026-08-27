// API-Q Phase Reorder Step 2 — focused guard for the caller-bound MCP
// Phase-reorder adapter.
//
// Behavioural (in-process, injected fakes) + static source guards. No network,
// no database, no Edge invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  reorderApiV1Phases,
  reorderMcpV1Phases,
} from "../../functions/_shared/btpm-api/supabasePhase.ts";
import { createMcpV1ReorderPhasesExecutor } from "../../functions/btpm-mcp/mcp/phaseReorderMutationExecutor.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const ADAPTER_URL = new URL(
  "../../functions/_shared/btpm-api/supabasePhase.ts",
  import.meta.url,
);
const EXECUTOR_URL = new URL(
  "../../functions/btpm-mcp/mcp/phaseReorderMutationExecutor.ts",
  import.meta.url,
);
const SERVER_FACTORY_URL = new URL(
  "../../functions/btpm-mcp/mcp/serverFactory.ts",
  import.meta.url,
);
const RUNTIME_URL = new URL(
  "../../functions/btpm-mcp/index.ts",
  import.meta.url,
);

const adapterSource = await Deno.readTextFile(ADAPTER_URL);
const executorSource = await Deno.readTextFile(EXECUTOR_URL);
const serverFactorySource = await Deno.readTextFile(SERVER_FACTORY_URL);
const runtimeSource = await Deno.readTextFile(RUNTIME_URL);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_A = "33333333-3333-4333-8333-333333333333";
const PHASE_B = "44444444-4444-4444-8444-444444444444";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PAYLOAD_HASH = "e".repeat(64);
const UPDATED_AT_A = "2026-08-14T04:00:00.123456+02:00";
const UPDATED_AT_B = "2026-08-14T05:30:00Z";

const canonicalBody = Object.freeze({
  rows: Object.freeze([
    Object.freeze({
      phaseId: PHASE_A,
      expectedUpdatedAt: UPDATED_AT_A,
      sortOrder: 0,
    }),
    Object.freeze({
      phaseId: PHASE_B,
      expectedUpdatedAt: UPDATED_AT_B,
      sortOrder: 1,
    }),
  ]),
});

function reorderSuccessData(outcome = "applied") {
  return {
    data: {
      ok: true,
      outcome,
      projectId: PROJECT_ID,
      submittedCount: 2,
      changedCount: 2,
      orderedPhases: [
        { phaseId: PHASE_A, sortOrder: 0, updatedAt: UPDATED_AT_B },
        { phaseId: PHASE_B, sortOrder: 1, updatedAt: UPDATED_AT_B },
      ],
    },
    error: null,
  };
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function recordingClient(calls: RpcCall[], data = reorderSuccessData()) {
  return {
    rpc(name: string, args: unknown) {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      return Promise.resolve(data);
    },
  };
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  projectId: PROJECT_ID,
  rows: canonicalBody.rows,
  requestId: "req-pr-0001",
  correlationId: "req-pr-0001",
  idempotencyKey: "idem-pr-0001",
  payloadHash: PAYLOAD_HASH,
});

function mutationContext(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestedUserId: "user-1",
    executingUserId: "user-1",
    apiClientId: "api-client-1",
    oauthClientId: "btpm-mcp-client",
    policyVersionId: "policy-1",
    requestId: "req-pr-0001",
    correlationId: "req-pr-0001",
    sourceChannel: "mcp",
    sourceClientId: "api-client-1",
    delegationMode: "delegated_user",
    idempotencyKey: "idem-pr-0001",
    payloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function authenticatedRequest(token = "caller-access-token"): Request {
  return new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

interface FactoryCall {
  readonly url: string;
  readonly key: string;
  readonly options: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
function buildExecutor(calls: RpcCall[], factoryCalls: FactoryCall[], data?: any) {
  return createMcpV1ReorderPhasesExecutor(
    "https://project.supabase.test",
    "anon-publishable-key",
    (url, key, options) => {
      factoryCalls.push({
        url,
        key,
        options: options as unknown as Record<string, unknown>,
      });
      return recordingClient(calls, data ?? reorderSuccessData());
    },
  );
}

// -----------------------------------------------------------------------------
// A. Fixed supabasePhase reorder adapters
// -----------------------------------------------------------------------------

Deno.test("REST Phase reorder still calls only api_v1_reorder_phases", async () => {
  const calls: RpcCall[] = [];
  const result = await reorderApiV1Phases(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "api_v1_reorder_phases");
  assertEquals(result.ok, true);
});

Deno.test("MCP Phase reorder calls only mcp_v1_reorder_phases", async () => {
  const calls: RpcCall[] = [];
  const result = await reorderMcpV1Phases(recordingClient(calls), adapterInput);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_reorder_phases");
  assertEquals(result.ok, true);
});

Deno.test("REST and MCP Phase reorder share identical validation and mapping", async () => {
  const restCalls: RpcCall[] = [];
  const mcpCalls: RpcCall[] = [];
  const rest = await reorderApiV1Phases(
    recordingClient(restCalls),
    adapterInput,
  );
  const mcp = await reorderMcpV1Phases(recordingClient(mcpCalls), adapterInput);
  assertEquals(restCalls[0].args, mcpCalls[0].args);
  assertEquals(rest, mcp);

  const bad = { ...adapterInput, payloadHash: "nope" };
  await assertRejects(() => reorderApiV1Phases(recordingClient([]), bad));
  await assertRejects(() => reorderMcpV1Phases(recordingClient([]), bad));

  const badProject = { ...adapterInput, projectId: "not-a-uuid" };
  await assertRejects(() => reorderApiV1Phases(recordingClient([]), badProject));
  await assertRejects(() => reorderMcpV1Phases(recordingClient([]), badProject));

  const emptyRows = { ...adapterInput, rows: [] };
  await assertRejects(() => reorderApiV1Phases(recordingClient([]), emptyRows));
  await assertRejects(() => reorderMcpV1Phases(recordingClient([]), emptyRows));

  const mapperDefs = adapterSource.match(/function toReorderResult\(/g) ?? [];
  assertEquals(mapperDefs.length, 1, "one bounded reorder result contract only");
});

Deno.test("reorder wrapper names are a closed set of fixed module constants", () => {
  assertStringIncludes(
    adapterSource,
    'const API_V1_REORDER_PHASES_FUNCTION_NAME = "api_v1_reorder_phases"',
  );
  assertStringIncludes(
    adapterSource,
    'const MCP_V1_REORDER_PHASES_FUNCTION_NAME = "mcp_v1_reorder_phases"',
  );
  assert(
    /type ReorderPhasesFunctionName =\s*\|\s*typeof API_V1_REORDER_PHASES_FUNCTION_NAME\s*\|\s*typeof MCP_V1_REORDER_PHASES_FUNCTION_NAME;/
      .test(adapterSource),
    "the reorder wrapper name must be a closed internal union",
  );
  assertEquals(reorderApiV1Phases.length, 2);
  assertEquals(reorderMcpV1Phases.length, 2);
  assert(
    !/export\s+(async\s+)?function\s+invokeReorderPhases/.test(adapterSource),
    "the shared reorder invocation helper must not be exported",
  );
  assert(
    /function invokeReorderPhases\(/.test(adapterSource),
    "a single shared internal reorder invocation helper must exist",
  );
  assert(!/operationId/.test(adapterSource), "no operationId dispatch");
});

Deno.test("stale_phase_order mapping remains unchanged", async () => {
  // deno-lint-ignore no-explicit-any
  const staleData: any = {
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_phase_order",
      projectId: PROJECT_ID,
      stalePhaseIds: [PHASE_A],
    },
    error: null,
  };
  const rest = await reorderApiV1Phases(
    recordingClient([], staleData),
    adapterInput,
  );
  const mcp = await reorderMcpV1Phases(
    recordingClient([], staleData),
    adapterInput,
  );
  assertEquals(rest, mcp);
  assertEquals(rest.ok, false);
  assertEquals((rest as { code?: string }).code, "stale_phase_order");
});

Deno.test("applied / no_change / replayed handling is unchanged across sources", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const rest = await reorderApiV1Phases(
      recordingClient([], reorderSuccessData(outcome)),
      adapterInput,
    );
    const mcp = await reorderMcpV1Phases(
      recordingClient([], reorderSuccessData(outcome)),
      adapterInput,
    );
    assertEquals(rest, mcp);
    assertEquals(rest.ok, true);
    if (rest.ok) assertEquals(rest.outcome, outcome);
  }
});

// -----------------------------------------------------------------------------
// B. Exact Phase Reorder RPC arguments
// -----------------------------------------------------------------------------

Deno.test("executor passes canonical arguments and row mapping through unchanged", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  const result = await executor(
    authenticatedRequest(),
    PROJECT_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "mcp_v1_reorder_phases");
  assertEquals(calls[0].args, {
    _expected_oauth_client_id: "btpm-mcp-client",
    _project_id: PROJECT_ID,
    _rows: [
      { id: PHASE_A, expected_updated_at: UPDATED_AT_A, new_sort_order: 0 },
      { id: PHASE_B, expected_updated_at: UPDATED_AT_B, new_sort_order: 1 },
    ],
    _request_id: "req-pr-0001",
    _correlation_id: "req-pr-0001",
    _idempotency_key: "idem-pr-0001",
    _payload_hash: PAYLOAD_HASH,
  });
  assertEquals(result.ok, true);
});

// -----------------------------------------------------------------------------
// C. Caller-bound execution
// -----------------------------------------------------------------------------

Deno.test("fresh anon-key client bound to the current bearer per invocation", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);

  await executor(
    authenticatedRequest("token-one"),
    PROJECT_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  await executor(
    authenticatedRequest("token-two"),
    PROJECT_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );

  assertEquals(factoryCalls.length, 2, "one fresh client per invocation");
  for (const call of factoryCalls) {
    assertEquals(call.url, "https://project.supabase.test");
    assertEquals(call.key, "anon-publishable-key");
    const auth = call.options.auth as Record<string, unknown>;
    assertEquals(auth.persistSession, false);
    assertEquals(auth.autoRefreshToken, false);
    assertEquals(auth.detectSessionInUrl, false);
  }
  const headersOne =
    ((factoryCalls[0].options.global as Record<string, unknown>)
      .headers) as Record<string, string>;
  const headersTwo =
    ((factoryCalls[1].options.global as Record<string, unknown>)
      .headers) as Record<string, string>;
  assertEquals(headersOne.Authorization, "Bearer token-one");
  assertEquals(headersTwo.Authorization, "Bearer token-two");
  assertEquals(calls.length, 2, "exactly one RPC per invocation");
});

Deno.test("missing bearer fails before any client construction", async () => {
  const calls: RpcCall[] = [];
  const factoryCalls: FactoryCall[] = [];
  const executor = buildExecutor(calls, factoryCalls);
  await assertRejects(() =>
    executor(
      new Request("https://mcp.example.test/mcp", { method: "POST" }),
      PROJECT_ID,
      { rows: canonicalBody.rows },
      // deno-lint-ignore no-explicit-any
      mutationContext() as any,
    )
  );
  assertEquals(factoryCalls.length, 0);
  assertEquals(calls.length, 0);
});

// -----------------------------------------------------------------------------
// D. Trusted context fail-closed
// -----------------------------------------------------------------------------

const INCONSISTENT_CONTEXTS: ReadonlyArray<Record<string, unknown>> = [
  { executingUserId: "user-2" },
  { sourceClientId: "other-client" },
  { correlationId: "req-other" },
  { sourceChannel: "external_api" },
  { delegationMode: "service_account" },
  { payloadHash: "NOTAHASH" },
  { payloadHash: "E".repeat(64) },
  { policyVersionId: "  " },
  { apiClientId: "" },
  { oauthClientId: "" },
  { requestId: "" },
  { requestedUserId: "" },
  { idempotencyKey: "" },
];

Deno.test("inconsistent trusted context fails before client and RPC", async () => {
  for (const overrides of INCONSISTENT_CONTEXTS) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          PROJECT_ID,
          { rows: canonicalBody.rows },
          // deno-lint-ignore no-explicit-any
          mutationContext(overrides) as any,
        ),
      Error,
      undefined,
      `context override must fail closed: ${JSON.stringify(overrides)}`,
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// E. Canonical Phase Reorder semantics
// -----------------------------------------------------------------------------

Deno.test("executor reuses the canonical Project path and reorder body parsers", () => {
  assertStringIncludes(executorSource, "parseApiV1PhaseReorderPath");
  assertStringIncludes(executorSource, "parseApiV1ReorderPhasesBody");
  assertStringIncludes(executorSource, '"/v1/projects/"');
  assertStringIncludes(executorSource, '"/phases/reorder"');
  assert(
    !/const\s+\w*Schema\s*=|z\.object\(/.test(executorSource),
    "no duplicate reorder parser or schema may exist in the executor",
  );
});

Deno.test("malformed and nil Project IDs are rejected", async () => {
  for (
    const badId of [
      "",
      "not-a-uuid",
      NIL_UUID,
      `${PROJECT_ID}/extra`,
      ` ${PROJECT_ID}`,
    ]
  ) {
    const calls: RpcCall[] = [];
    const factoryCalls: FactoryCall[] = [];
    const executor = buildExecutor(calls, factoryCalls);
    await assertRejects(() =>
      executor(
        authenticatedRequest(),
        badId,
        { rows: canonicalBody.rows },
        // deno-lint-ignore no-explicit-any
        mutationContext() as any,
      )
    );
    assertEquals(factoryCalls.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("closed reorder body shape is enforced by the canonical parser", async () => {
  const badBodies: unknown[] = [
    {},
    { rows: [] },
    { rows: [{ phaseId: PHASE_A, sortOrder: 0 }] },
    {
      rows: [{
        phaseId: PHASE_A,
        expectedUpdatedAt: UPDATED_AT_A,
        sortOrder: 0,
        extra: 1,
      }],
    },
    { rows: canonicalBody.rows, projectId: PROJECT_ID },
  ];
  for (const body of badBodies) {
    const calls: RpcCall[] = [];
    const executor = buildExecutor(calls, []);
    await assertRejects(
      () =>
        executor(
          authenticatedRequest(),
          PROJECT_ID,
          // deno-lint-ignore no-explicit-any
          body as any,
          // deno-lint-ignore no-explicit-any
          mutationContext() as any,
        ),
      Error,
      undefined,
      `body must be rejected: ${JSON.stringify(body)}`,
    );
    assertEquals(calls.length, 0);
  }
});

Deno.test("stale_phase_order is returned unchanged with no retry or read-before-write", async () => {
  const calls: RpcCall[] = [];
  const executor = buildExecutor(calls, [], {
    data: {
      ok: false,
      outcome: "conflict",
      code: "stale_phase_order",
      projectId: PROJECT_ID,
      stalePhaseIds: [PHASE_A],
    },
    error: null,
  });
  const result = await executor(
    authenticatedRequest(),
    PROJECT_ID,
    { rows: canonicalBody.rows },
    // deno-lint-ignore no-explicit-any
    mutationContext() as any,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.outcome, "conflict");
    assertEquals((result as { code?: string }).code, "stale_phase_order");
  }
  assertEquals(calls.length, 1, "exactly one RPC, no retry");
  const rows = calls[0].args._rows as ReadonlyArray<
    Record<string, unknown>
  >;
  assertEquals(rows[0].expected_updated_at, UPDATED_AT_A);
  assertEquals(rows[1].expected_updated_at, UPDATED_AT_B);
});

Deno.test("expectedUpdatedAt values are never refreshed or reformatted", () => {
  assert(!/new Date\(/.test(executorSource));
  assert(!/toISOString/.test(executorSource));
  assert(!/Date\.now/.test(executorSource));
  assert(!/get_phase|api_v1_get_phase|mcp_v1_get_phase/.test(executorSource));
  assertStringIncludes(executorSource, "rows: canonicalBody.rows,");
});

// -----------------------------------------------------------------------------
// F. Forbidden surfaces
// -----------------------------------------------------------------------------

Deno.test("executor introduces no forbidden surface", () => {
  assert(!/SERVICE_ROLE|service_role|serviceRole/.test(executorSource));
  assert(!/Deno\.env/.test(executorSource));
  assert(!/fetch\(/.test(executorSource));
  assert(!/\.from\(/.test(executorSource));
  assert(!/console\./.test(executorSource));
  assert(!/setTimeout|setInterval/.test(executorSource));
  assert(
    !/pmg_|\bapi_v1_reorder_phases\b|reorderApiV1Phases|apply_phase|client\.rpc\(/
      .test(
        executorSource,
      ),
  );
  assert(!/registerTool|MCP_TOOL_REGISTRY|serverFactory/.test(executorSource));
  assert(!/for\s*\(|while\s*\(/.test(executorSource), "no retry loop");
  const invocations = executorSource.match(/reorderMcpV1Phases\(client, \{/g) ??
    [];
  assertEquals(invocations.length, 1, "exactly one fixed MCP invocation site");
});

// -----------------------------------------------------------------------------
// G. No exposure or runtime wiring in this Step
// -----------------------------------------------------------------------------

// Phase Reorder Step 4 exposed `phases.reorder` as `btpm_reorder_phases`. What
// must still hold for THIS Step is that the caller-bound writer adapter stays
// the only RPC-executing surface: `serverFactory` must never know it.
Deno.test("phases.reorder is a canonical mutation entry", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) =>
    e.operationId === "phases.reorder"
  );
  assert(entry, "phases.reorder must exist in the registry");
  assertEquals(entry?.operationClass, "mutation");
  assertEquals(entry?.exposure, "exposed");
});

Deno.test("serverFactory never imports or constructs the caller-bound writer", () => {
  assert(!serverFactorySource.includes("phaseReorderMutationExecutor.ts"));
  assert(!serverFactorySource.includes("createMcpV1ReorderPhasesExecutor"));
  assert(!serverFactorySource.includes("reorderMcpV1Phases"));
  assert(!/reorder_phases/.test(serverFactorySource));
  assert(runtimeSource.includes("createMcpV1ReorderPhasesExecutor("));
});
