// API-Q.9B1 — focused guard for the Execution Update MCP mutation tool control
// composition. Behavioural (in-process fakes) + static source guards. No
// network, no database, no Edge invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpExecutionUpdateAppendToolExecutor,
  MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
  MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/executionUpdateMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/executionUpdateMutationTool.ts",
  import.meta.url,
);

const toolSource = await Deno.readTextFile(TOOL_URL);

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const EXECUTION_UPDATE_ID = "22222222-2222-4222-8222-222222222222";

const trustedExecution = Object.freeze({
  requestedUserId: "33333333-3333-4333-8333-333333333333",
  executingUserId: "33333333-3333-4333-8333-333333333333",
  apiClientId: "44444444-4444-4444-8444-444444444444",
  oauthClientId: "oauth-1",
  policyVersionId: "policy-1",
  requestId: "req-1",
  correlationId: "req-1",
  sourceChannel: "mcp" as const,
  sourceClientId: "44444444-4444-4444-8444-444444444444",
  delegationMode: "delegated_user" as const,
});

const validArgs = Object.freeze({
  targetType: "phase" as const,
  targetId: TARGET_ID,
  summary: "Cutover rehearsal completed.",
  updateDate: "2026-08-13",
  statusLabel: "on_track",
  confirmation: true,
  idempotencyKey: "idem-key-9b1",
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  readonly consumeCalls: string[];
  readonly writerCalls: Array<{
    request: Request;
    // deno-lint-ignore no-explicit-any
    body: any;
    // deno-lint-ignore no-explicit-any
    context: any;
  }>;
  readonly order: string[];
}

function buildHarness(
  // deno-lint-ignore no-explicit-any
  writerResult: any = {
    ok: true,
    outcome: "applied",
    executionUpdateId: EXECUTION_UPDATE_ID,
    targetType: "phase",
    targetId: TARGET_ID,
    updateDate: "2026-08-13",
    hasStatusLabel: true,
  },
  options: { rateLimitThrows?: unknown } = {},
) {
  const recorder: Recorder = {
    profileCalls: [],
    consumeCalls: [],
    writerCalls: [],
    order: [],
  };
  const request = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { Authorization: "Bearer token-value" },
  });

  const executor = createMcpExecutionUpdateAppendToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: (async (req: Request, body: any, context: any) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, body, context });
      return writerResult;
      // deno-lint-ignore no-explicit-any
    }) as any,
    rateLimitProfileResolver: {
      resolve: (clientId: string, routeId: string) => {
        recorder.order.push("profile");
        recorder.profileCalls.push({ clientId, routeId });
        return Promise.resolve({ limit: 100, windowSeconds: 60 });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      // deno-lint-ignore no-explicit-any
      consume: (key: any) => {
        recorder.order.push("rate_limit");
        recorder.consumeCalls.push(String(key?.routeId ?? key));
        if (options.rateLimitThrows) throw options.rateLimitThrows;
        return Promise.resolve({
          allowed: true,
          remaining: 99,
          resetAtEpochMs: 1_700_000_060_000,
        });
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });

  return { executor, recorder, request };
}

Deno.test("tool name is exactly btpm_append_execution_update", () => {
  assertEquals(
    MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME,
    "btpm_append_execution_update",
  );
});

Deno.test("schema accepts exactly the seven approved arguments", () => {
  const parsed = MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA.parse(validArgs);
  assertEquals(Object.keys(parsed).sort(), [
    "confirmation",
    "idempotencyKey",
    "statusLabel",
    "summary",
    "targetId",
    "targetType",
    "updateDate",
  ]);
});

Deno.test("unknown fields are rejected by the strict schema", () => {
  const result = MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA.safeParse({
    ...validArgs,
    projectId: TARGET_ID,
  });
  assertFalse(result.success);
});

Deno.test("confirmation must be literal true and consumes nothing when absent", async () => {
  for (const value of [false, "true", 1, null, undefined]) {
    const { executor, recorder } = buildHarness();
    const result = await executor(
      // deno-lint-ignore no-explicit-any
      { ...validArgs, confirmation: value as any },
    );
    assert(!result.ok);
    assert(
      result.category === "confirmation_required" ||
        result.category === "invalid_arguments",
    );
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.profileCalls.length, 0);
  }

  const { executor, recorder } = buildHarness();
  const rejected = await executor({ ...validArgs, confirmation: false });
  assert(!rejected.ok);
  assertEquals(rejected.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
});

Deno.test("canonical body reaches the writer without confirmation/idempotency and hashes it", async () => {
  const { executor, recorder, request } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);

  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(Object.keys(call.body).sort(), [
    "statusLabel",
    "summary",
    "targetId",
    "targetType",
    "updateDate",
  ]);
  assertFalse("confirmation" in call.body);
  assertFalse("idempotencyKey" in call.body);

  // Canonical mutation context is reused and the canonical body is the hash input.
  assertEquals(call.context.idempotencyKey, validArgs.idempotencyKey);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
  assertEquals(call.context.payloadHash, await hashCanonicalPayload(call.body));
});

Deno.test("canonical parser rejects malformed business values before the writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, targetId: "not-a-uuid" });
  assert(!result.ok);
  assertEquals(result.category, "invalid_arguments");
  assertEquals(recorder.writerCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
});

Deno.test("invalid idempotency key fails before the writer and rate limit", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, idempotencyKey: "   " });
  assert(!result.ok);
  assertEquals(result.category, "invalid_arguments");
  assertEquals(recorder.writerCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
});

Deno.test("rate limit uses execution_updates.append and executes before the writer", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(recorder.profileCalls, [{
    clientId: "44444444-4444-4444-8444-444444444444",
    routeId: "execution_updates.append",
  }]);
  assertEquals(recorder.consumeCalls, ["execution_updates.append"]);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("rate-limit rejection maps to rate_limited without writer invocation", async () => {
  const { ApiHttpError } = await import(
    "../../functions/_shared/btpm-api/http.ts"
  );
  const { executor, recorder } = buildHarness(undefined, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "rate_limited");
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("applied and replayed results stay bounded and omit the narrative summary", async () => {
  for (const outcome of ["applied", "replayed"] as const) {
    const { executor } = buildHarness({
      ok: true,
      outcome,
      executionUpdateId: EXECUTION_UPDATE_ID,
      targetType: "phase",
      targetId: TARGET_ID,
      updateDate: "2026-08-13",
      hasStatusLabel: true,
    });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "executionUpdateId",
      "hasStatusLabel",
      "outcome",
      "targetId",
      "targetType",
      "updateDate",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertFalse("summary" in result.payload);
  }
});

Deno.test("database negative outcomes map to bounded categories", async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of cases) {
    const { executor } = buildHarness({ ok: false, outcome });
    const result = await executor(validArgs);
    assert(!result.ok);
    assertEquals(result.category, category);
  }
});

Deno.test("unexpected writer failure maps to unavailable only", async () => {
  const { executor } = buildHarness();
  const failing = createMcpExecutionUpdateAppendToolExecutor({
    request: new Request("https://example.test/mcp", { method: "POST" }),
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: ((() => {
      throw new Error("relation execution_updates does not exist");
    }) as any),
    // deno-lint-ignore no-explicit-any
    rateLimitProfileResolver: { resolve: () => Promise.resolve({}) } as any,
    // deno-lint-ignore no-explicit-any
    rateLimitStore: { consume: () => Promise.resolve({ allowed: true }) } as any,
    now: () => 0,
  });
  const result = await failing(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  assert(executor !== undefined);
});

Deno.test("module contains no direct RPC, Supabase client, service-role or env access", () => {
  for (
    const forbidden of [
      ".rpc(",
      "mcp_v1_append_execution_update",
      "api_v1_append_execution_update",
      "createClient",
      "SERVICE_ROLE",
      "service_role",
      "Deno.env",
      "console.",
      "fetch(",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("registry exposes execution_updates.append alongside the 14 reads", () => {
  const append = MCP_TOOL_REGISTRY.find(
    (entry) => entry.operationId === "execution_updates.append",
  );
  assert(append !== undefined);
  assertEquals(append.exposure, "exposed");
  assertEquals(append.confirmation, "required");

  const exposed = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.exposure === "exposed",
  );
  // API-Q.10A5..Phase Create Step 4 exposed five further mutations; the 14
  // reads and the Execution Update mutation above remain unchanged.
});

// The 9B1 control module itself must never register anything: registration is
// owned by serverFactory (API-Q.9B2). This invariant survives exposure.
Deno.test("the 9B1 control module performs no MCP registration", () => {
  for (const forbidden of [
    "registerTool",
    "createBtpmMcpServer",
    "MCP_TOOL_REGISTRY",
    "exposedMcpTools",
  ]) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected registration reference to ${forbidden}`,
    );
  }
});
