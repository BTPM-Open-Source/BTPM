// API-Q Program Create Step 3 — focused guard for the Program-create MCP
// mutation tool control composition. Behavioural (in-process fakes) + static
// source guards. No network, no database, no Edge invocation, no service-role
// key.
//
// Scope: control/composition only. Exposure and runtime wiring are Step 4.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpProgramCreateToolExecutor,
  MCP_PROGRAM_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PROGRAM_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/programCreateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  parseApiV1CreateProgramBody,
  PROGRAM_CREATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/programs.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/programCreateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const PROGRAM_ID = "55555555-5555-4555-8555-555555555555";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const trustedExecution = Object.freeze({
  requestedUserId: USER_ID,
  executingUserId: USER_ID,
  apiClientId: API_CLIENT_ID,
  oauthClientId: "oauth-1",
  policyVersionId: "policy-1",
  requestId: "req-1",
  correlationId: "req-1",
  sourceChannel: "mcp" as const,
  sourceClientId: API_CLIENT_ID,
  delegationMode: "delegated_user" as const,
});

const validArgs = Object.freeze({
  workspaceId: WORKSPACE_ID,
  name: "Finance Transformation",
  confirmation: true,
  idempotencyKey: "idem-key-program-create",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  programId: PROGRAM_ID,
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
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
  writerResult: any = successResult,
  options: { rateLimitThrows?: unknown; writerThrows?: unknown } = {},
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

  const executor = createMcpProgramCreateToolExecutor({
    request,
    execution: trustedExecution,
    // deno-lint-ignore no-explicit-any
    writer: (async (req: Request, body: any, context: any) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, body, context });
      if (options.writerThrows) throw options.writerThrows;
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
      consume: (input: any) => {
        recorder.order.push("rate_limit");
        recorder.consumeCalls.push(input);
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

// ---------------------------------------------------------------------------
// A. Schema
// ---------------------------------------------------------------------------

Deno.test("A1: tool name and the exact five argument names", () => {
  assertEquals(MCP_PROGRAM_CREATE_TOOL_NAME, "btpm_create_program");
  assertEquals([...MCP_PROGRAM_CREATE_TOOL_ARGUMENT_NAMES], [
    "workspaceId",
    "name",
    "description",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PROGRAM_CREATE_TOOL_ARGUMENT_NAMES.length, 5);
  assertEquals(
    Object.keys(MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PROGRAM_CREATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A2: the schema is strict and rejects unknown / provenance fields", () => {
  assert(MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "tenantId",
      "organizationId",
      "userId",
      "actor",
      "apiClientId",
      "oauthClientId",
      "sourceChannel",
      "requestId",
      "correlationId",
      "payloadHash",
      "programId",
      "status",
      "operationId",
      "functionName",
      "extra",
    ]
  ) {
    assertFalse(
      MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        [key]: "x",
      }).success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("A3: required and optional argument shape", () => {
  for (const key of ["workspaceId", "name", "confirmation", "idempotencyKey"]) {
    const args: Record<string, unknown> = { ...validArgs };
    delete args[key];
    assertFalse(
      MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.safeParse(args).success,
      `missing required key accepted: ${key}`,
    );
  }
  assert(MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.safeParse({
    ...validArgs,
    description: null,
  }).success);
  assert(MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.safeParse({
    ...validArgs,
    description: "Group finance program",
  }).success);
  assertFalse(MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.safeParse({
    ...validArgs,
    description: 5,
  }).success);
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B1: only literal true is accepted, before rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);

  for (const confirmation of [undefined, null, "true", 1]) {
    const harness = buildHarness();
    // deno-lint-ignore no-explicit-any
    const r = await harness.executor({ ...validArgs, confirmation } as any);
    assert(!r.ok);
    assert(
      r.category === "confirmation_required" ||
        r.category === "invalid_arguments",
    );
    assertEquals(harness.recorder.order.length, 0);
  }
});

Deno.test("B2: confirmation never enters the canonical body or the hash", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body as Record<string, unknown>;
  assertFalse("confirmation" in body);
  assertEquals(
    recorder.writerCalls[0].context.payloadHash,
    await hashCanonicalPayload(body),
  );
});

// ---------------------------------------------------------------------------
// C. Canonical Program parsing
// ---------------------------------------------------------------------------

Deno.test("C1: the canonical Program parser is reused exactly once", async () => {
  assert(toolSource.includes("parseApiV1CreateProgramBody"));
  assertEquals(
    executableSource.split("parseApiV1CreateProgramBody").length - 1,
    2, // one import binding + one call site
  );
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1CreateProgramBody({
      workspaceId: WORKSPACE_ID,
      name: "Finance Transformation",
    }),
  );
  const body = recorder.writerCalls[0].body as Record<string, unknown>;
  assertEquals(Object.keys(body).sort(), [
    "description",
    "name",
    "workspaceId",
  ]);
  for (
    const forbidden of [
      "confirmation",
      "idempotencyKey",
      "apiClientId",
      "oauthClientId",
      "requestId",
      "correlationId",
      "sourceChannel",
      "payloadHash",
      "executingUserId",
      "organizationId",
    ]
  ) {
    assertFalse(forbidden in body, `leaked control field: ${forbidden}`);
  }
});

Deno.test("C2: invalid business input fails before rate limit and writer", async () => {
  const invalidCases: Array<Record<string, unknown>> = [
    { workspaceId: "not-a-uuid" },
    { workspaceId: "00000000-0000-0000-0000-000000000000" },
    { name: "" },
    { name: "   " },
    { name: "x".repeat(201) },
  ];
  for (const patch of invalidCases) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, ...patch } as any);
    assert(!result.ok, `accepted invalid patch: ${JSON.stringify(patch)}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.profileCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Description / name canonical equivalence in the payload hash
// ---------------------------------------------------------------------------

async function hashFor(args: Record<string, unknown>): Promise<string> {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor(args as any);
  assert(result.ok, `expected success for ${JSON.stringify(args)}`);
  return recorder.writerCalls[0].context.payloadHash as string;
}

Deno.test("D1: canonical-equivalent input hashes identically", async () => {
  const base = await hashFor(validArgs);
  assertEquals(await hashFor({ ...validArgs, description: null }), base);
  assertEquals(await hashFor({ ...validArgs, description: "   " }), base);
  assertEquals(
    await hashFor({ ...validArgs, name: "  Finance Transformation  " }),
    base,
  );
  assert(/^[0-9a-f]{64}$/.test(base));
});

Deno.test("D2: the hash is sensitive to every canonical business value", async () => {
  const base = await hashFor(validArgs);
  assertFalse(
    await hashFor({ ...validArgs, workspaceId: OTHER_WORKSPACE_ID }) === base,
  );
  assertFalse(await hashFor({ ...validArgs, name: "Finance Transform" }) === base);
  assertFalse(await hashFor({ ...validArgs, description: "Wave 1" }) === base);
  assertFalse(
    await hashFor({ ...validArgs, description: "Wave 2" }) ===
      await hashFor({ ...validArgs, description: "Wave 1" }),
  );
});

// ---------------------------------------------------------------------------
// E. Idempotency-key separation
// ---------------------------------------------------------------------------

Deno.test("E1: the idempotency key is carried in context, never in the hash", async () => {
  assert(toolSource.includes("buildMcpMutationExecutionContext"));
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const context = recorder.writerCalls[0].context;
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  assertEquals(context.sourceChannel, "mcp");
  assertEquals(context.executingUserId, USER_ID);

  assertEquals(
    await hashFor({ ...validArgs, idempotencyKey: "another-valid-key" }),
    context.payloadHash,
  );
  assertFalse(
    context.payloadHash ===
      await hashCanonicalPayload({
        ...recorder.writerCalls[0].body,
        idempotencyKey: validArgs.idempotencyKey,
      }),
  );
});

Deno.test("E2: an invalid idempotency key maps to invalid_arguments", async () => {
  for (const idempotencyKey of ["", "  ", "a".repeat(300)]) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, idempotencyKey });
    assert(!result.ok);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// F. Rate limiting
// ---------------------------------------------------------------------------

Deno.test("F1: rate limiting uses exactly programs.create and the trusted identity", async () => {
  assertEquals(PROGRAM_CREATE_ROUTE.id, "programs.create");
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "programs.create",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  assertEquals(consumed.apiClientId, API_CLIENT_ID);
  assertEquals(consumed.userId, USER_ID);
  assertEquals(consumed.routeId, "programs.create");
});

Deno.test("F2: order is profile -> rate_limit -> writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("F3: rate-limit rejection maps to rate_limited and skips the writer", async () => {
  const { ApiHttpError } = await import(
    "../../functions/_shared/btpm-api/http.ts"
  );
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "rate_limited");
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// G. Writer
// ---------------------------------------------------------------------------

Deno.test("G1: the writer runs exactly once with request, body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls.length, 1);
  assert(recorder.writerCalls[0].request === request);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1CreateProgramBody({
      workspaceId: WORKSPACE_ID,
      name: "Finance Transformation",
    }),
  );
  assert(typeof recorder.writerCalls[0].context.payloadHash === "string");
  assertEquals(recorder.order.filter((e) => e === "writer").length, 1);
});

Deno.test("G2: a writer failure is not retried", async () => {
  const { executor, recorder } = buildHarness(undefined, {
    writerThrows: new Error("boom"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(recorder.writerCalls.length, 1);
});

// ---------------------------------------------------------------------------
// H. Success / negative outcomes / categorization
// ---------------------------------------------------------------------------

Deno.test("H1: applied and replayed return the bounded two-field payload", async () => {
  for (const outcome of ["applied", "replayed"]) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor({
      ...validArgs,
      description: "Group finance program",
    });
    assert(result.ok);
    assertEquals(Object.keys(result.payload), ["outcome", "programId"]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.programId, PROGRAM_ID);
    const serialized = JSON.stringify(result.payload);
    assertFalse(serialized.includes("Finance Transformation"));
    assertFalse(serialized.includes("Group finance program"));
    assertFalse(serialized.includes(WORKSPACE_ID));
    assertFalse(serialized.includes(API_CLIENT_ID));
    assertFalse(serialized.includes(USER_ID));
    assertFalse(serialized.includes("idem-key-program-create"));
  }
});

Deno.test("H2: canonical negative outcomes map correctly", async () => {
  const cases: Array<[string, string]> = [
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

Deno.test("H3: ApiHttpError and canonical failures map to bounded categories", async () => {
  const { ApiHttpError } = await import(
    "../../functions/_shared/btpm-api/http.ts"
  );
  const cases: Array<[string, string]> = [
    ["rate_limit_exceeded", "rate_limited"],
    ["not_authorized", "not_authorized"],
    ["invalid_request", "invalid_arguments"],
    ["internal_error", "unavailable"],
  ];
  for (const [code, category] of cases) {
    const { executor } = buildHarness(undefined, {
      // deno-lint-ignore no-explicit-any
      writerThrows: new ApiHttpError(code as any),
    });
    const result = await executor(validArgs);
    assert(!result.ok);
    assertEquals(result.category, category);
  }
});

Deno.test("H4: a malformed trusted MCP context maps to unavailable", async () => {
  const executor = createMcpProgramCreateToolExecutor({
    request: new Request("https://example.test/mcp", { method: "POST" }),
    // deno-lint-ignore no-explicit-any
    execution: { ...trustedExecution, requestedUserId: "other-user" } as any,
    // deno-lint-ignore no-explicit-any
    writer: (() => Promise.resolve(successResult)) as any,
    rateLimitProfileResolver: {
      resolve: () => Promise.reject(new Error("x")),
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    rateLimitStore: { consume: () => Promise.reject(new Error("x")) } as any,
    now: () => 1_700_000_000_000,
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
});

Deno.test("H5: unexpected failures map to unavailable and disclose nothing", async () => {
  const { executor } = buildHarness(undefined, {
    writerThrows: new Error(
      "relation programs does not exist (SQLSTATE 42P01) at pg_catalog",
    ),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("SQLSTATE"));
  assertFalse(serialized.includes("pg_catalog"));
});

Deno.test("H6: exactly the approved seven categories and bounded messages", () => {
  assertEquals(Object.keys(MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
  assertEquals(MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES, {
    confirmation_required:
      "Explicit confirmation is required for this mutation.",
    invalid_arguments: "Invalid arguments.",
    not_authorized: "Not authorized to create this Program.",
    rate_limited: "Rate limit exceeded. Try again later.",
    idempotency_conflict:
      "This idempotency key was already used with a different request.",
    idempotency_pending:
      "An identical request is still in progress. Retry shortly.",
    unavailable: "BTPM Program creation is temporarily unavailable.",
  });
  for (const message of Object.values(MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES)) {
    assertFalse(/SQLSTATE|mcp_v1_|apply_program_create|token/.test(message));
  }
});

// ---------------------------------------------------------------------------
// I. Static ownership boundaries
// ---------------------------------------------------------------------------

Deno.test("I1: no database, service-role, env, fetch, retry or logging code exists", () => {
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      "privilegedClient",
      "Deno.env",
      ".rpc(",
      ".from(",
      "apply_program_create",
      "api_project_client_enablements",
      "authorize_and_establish",
      "authorize_and_establish_mcp",
      "btpm_encrypt",
      "btpm_decrypt",
      "console.",
      "setTimeout",
      "setInterval",
      "fetch(",
      "retry",
      "createClient",
      "Deno.serve",
      "registerTool",
      "toolRegistry",
      "serverFactory",
      "dispatch",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("I2: Program Update and other slices are untouched", () => {
  for (
    const forbidden of [
      "mcp_v1_update_program",
      "createMcpV1UpdateProgram",
      "programUpdateMutationExecutor",
      "programUpdateMutationTool",
      "PROGRAM_UPDATE_ROUTE",
      "parseApiV1UpdateProgramBody",
      "PROJECT_CREATE_ROUTE",
      "PROJECT_UPDATE_ROUTE",
      "PROJECT_TRANSITION_ROUTE",
      "portfolio",
      "expectedUpdatedAt",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `unexpected out-of-scope reference to ${forbidden}`,
    );
  }
});
