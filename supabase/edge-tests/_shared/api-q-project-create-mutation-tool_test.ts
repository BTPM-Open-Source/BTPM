// API-Q Project Create Step 3 — focused guard for the Project-create MCP
// mutation tool control composition. Behavioural (in-process fakes) + static
// source guards. No network, no database, no Edge invocation, no service-role
// key.
//
// Scope: control/composition only. Exposure is Step 4 and is not asserted here.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpProjectCreateToolExecutor,
  MCP_PROJECT_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/projectCreateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  parseApiV1CreateProjectBody,
  PROJECT_CREATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/projects.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/projectCreateMutationTool.ts",
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
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
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
  name: "SAP S/4HANA Rollout",
  confirmation: true,
  idempotencyKey: "idem-key-project-create",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
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

  const executor = createMcpProjectCreateToolExecutor({
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
// A. Tool contract
// ---------------------------------------------------------------------------

Deno.test("A1: tool name and the exact six argument names", () => {
  assertEquals(MCP_PROJECT_CREATE_TOOL_NAME, "btpm_create_project");
  assertEquals([...MCP_PROJECT_CREATE_TOOL_ARGUMENT_NAMES], [
    "workspaceId",
    "name",
    "programId",
    "deliveryModel",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PROJECT_CREATE_TOOL_ARGUMENT_NAMES.length, 6);
  assertEquals(
    Object.keys(MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PROJECT_CREATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A2: the schema is strict and rejects unknown fields", () => {
  assert(MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "projectId",
      "organizationId",
      "status",
      "stage",
      "extra",
      "phaseId",
    ]
  ) {
    assertFalse(
      MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        [key]: "x",
      }).success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("A3: only canonical delivery models are accepted by the guard", () => {
  for (
    const deliveryModel of [
      "internal_delivery",
      "vendor_delivery",
      "co_delivery",
      null,
    ]
  ) {
    assert(
      MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        deliveryModel,
      }).success,
      `rejected canonical delivery model: ${String(deliveryModel)}`,
    );
  }
  assertFalse(
    MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      deliveryModel: "outsourced",
    }).success,
  );
});

Deno.test("A4: the canonical Project parser is reused for optional defaults", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1CreateProjectBody({
      workspaceId: WORKSPACE_ID,
      name: "SAP S/4HANA Rollout",
    }),
  );
  assertEquals(recorder.writerCalls[0].body.programId, null);
  assertEquals(recorder.writerCalls[0].body.deliveryModel, null);

  const { executor: e2, recorder: r2 } = buildHarness();
  await e2({
    ...validArgs,
    programId: PROGRAM_ID,
    deliveryModel: "vendor_delivery",
  });
  assertEquals(r2.writerCalls[0].body.programId, PROGRAM_ID);
  assertEquals(r2.writerCalls[0].body.deliveryModel, "vendor_delivery");

  assert(toolSource.includes("parseApiV1CreateProjectBody"));
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B1: only literal true is accepted, before rate limit and writer", async () => {
  for (const confirmation of [false, undefined, null, "true", 1]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation } as any);
    assert(!result.ok);
    assert(
      result.category === "confirmation_required" ||
        result.category === "invalid_arguments",
      `unexpected category for ${String(confirmation)}: ${result.category}`,
    );
    assertEquals(recorder.profileCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
    assertEquals(recorder.writerCalls.length, 0);
  }
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
});

// ---------------------------------------------------------------------------
// C. Canonical business payload
// ---------------------------------------------------------------------------

Deno.test("C1: the business payload carries only the four canonical fields", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    ...validArgs,
    programId: PROGRAM_ID,
    deliveryModel: "co_delivery",
  });
  assert(result.ok);
  const body = recorder.writerCalls[0].body as Record<string, unknown>;
  assertEquals(Object.keys(body).sort(), [
    "deliveryModel",
    "name",
    "programId",
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
      "delegationMode",
      "policyVersionId",
      "organizationId",
    ]
  ) {
    assertFalse(forbidden in body, `leaked control field: ${forbidden}`);
  }
});

Deno.test("C2: canonical name normalization is preserved", async () => {
  const { executor, recorder } = buildHarness();
  await executor({ ...validArgs, name: "  SAP S/4HANA Rollout  " });
  assertEquals(recorder.writerCalls[0].body.name, "SAP S/4HANA Rollout");
});

Deno.test("C3: canonical parser rejections map to invalid_arguments before any control", async () => {
  const invalidCases: Array<Record<string, unknown>> = [
    { workspaceId: "not-a-uuid" },
    { workspaceId: "00000000-0000-0000-0000-000000000000" },
    { name: "" },
    { name: "   " },
    { programId: "nope" },
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
// D. Mutation context (canonical idempotency + payload hash)
// ---------------------------------------------------------------------------

Deno.test("D1: the shared context builder and canonical hash are used", async () => {
  assert(toolSource.includes("buildMcpMutationExecutionContext"));
  const { executor, recorder } = buildHarness();
  await executor({ ...validArgs, programId: PROGRAM_ID });
  const context = recorder.writerCalls[0].context;
  assertEquals(
    context.payloadHash,
    await hashCanonicalPayload(recorder.writerCalls[0].body),
  );
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  assertEquals(context.sourceChannel, "mcp");
  assertEquals(context.executingUserId, USER_ID);
});

Deno.test("D2: confirmation and idempotencyKey are excluded from the hash", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const hash = recorder.writerCalls[0].context.payloadHash;

  const { executor: e2, recorder: r2 } = buildHarness();
  await e2({ ...validArgs, idempotencyKey: "different-key" });
  assertEquals(r2.writerCalls[0].context.payloadHash, hash);

  assertFalse(
    hash ===
      await hashCanonicalPayload({
        ...recorder.writerCalls[0].body,
        confirmation: true,
      }),
  );
  assertFalse(
    hash ===
      await hashCanonicalPayload({
        ...recorder.writerCalls[0].body,
        idempotencyKey: validArgs.idempotencyKey,
      }),
  );
});

Deno.test("D3: an invalid idempotency key maps to invalid_arguments", async () => {
  for (const idempotencyKey of ["", "  ", "a".repeat(300)]) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, idempotencyKey });
    assert(!result.ok, `accepted key: ${idempotencyKey.length}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("D4: a malformed trusted MCP context maps to unavailable", async () => {
  const executor = createMcpProjectCreateToolExecutor({
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

// ---------------------------------------------------------------------------
// E. Rate limiting
// ---------------------------------------------------------------------------

Deno.test("E1: rate limiting uses exactly projects.create and the trusted identity", async () => {
  assertEquals(PROJECT_CREATE_ROUTE.id, "projects.create");
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "projects.create",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  assertEquals(consumed.apiClientId, API_CLIENT_ID);
  assertEquals(consumed.userId, USER_ID);
  assertEquals(consumed.routeId, "projects.create");
});

Deno.test("E2: the rate limit is consumed before the writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E3: rate-limit rejection maps to rate_limited and skips the writer", async () => {
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
// F. Writer invocation
// ---------------------------------------------------------------------------

Deno.test("F1: the injected writer runs exactly once with the request, body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls.length, 1);
  assert(recorder.writerCalls[0].request === request);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1CreateProjectBody({
      workspaceId: WORKSPACE_ID,
      name: "SAP S/4HANA Rollout",
    }),
  );
  assert(typeof recorder.writerCalls[0].context.payloadHash === "string");
  assertEquals(
    recorder.order.filter((entry) => entry === "writer").length,
    1,
  );
});

Deno.test("F2: a writer failure is not retried", async () => {
  const { executor, recorder } = buildHarness(undefined, {
    writerThrows: new Error("boom"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(recorder.writerCalls.length, 1);
});

// ---------------------------------------------------------------------------
// G. Result / error bounding
// ---------------------------------------------------------------------------

Deno.test("G1: applied and replayed return the bounded two-field payload", async () => {
  for (const outcome of ["applied", "replayed"]) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(Object.keys(result.payload), ["outcome", "projectId"]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.projectId, PROJECT_ID);
    const serialized = JSON.stringify(result.payload);
    assertFalse(serialized.includes("SAP S/4HANA Rollout"));
    assertFalse(serialized.includes("idem-key-project-create"));
    assertFalse(serialized.includes(WORKSPACE_ID));
    assertFalse(serialized.includes(API_CLIENT_ID));
    assertFalse(serialized.includes(USER_ID));
  }
});

Deno.test("G2: canonical negative outcomes map correctly", async () => {
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

Deno.test("G3: unexpected failures map to unavailable and disclose nothing", async () => {
  const { executor } = buildHarness(undefined, {
    writerThrows: new Error(
      "relation projects does not exist (SQLSTATE 42P01) at pg_catalog",
    ),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("SQLSTATE"));
  assertFalse(serialized.includes("pg_catalog"));
});

Deno.test("G4: bounded messages are exactly the approved seven categories", () => {
  assertEquals(Object.keys(MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
});

// ---------------------------------------------------------------------------
// H. Static ownership boundaries
// ---------------------------------------------------------------------------

Deno.test("H1: no enablement, database, service-role, env, fetch or logging code exists", () => {
  for (
    const forbidden of [
      "api_project_client_enablements",
      "enable_project",
      "service_role",
      "SERVICE_ROLE",
      "createClient",
      "client.rpc",
      ".rpc(",
      ".from(",
      "authorize_and_establish",
      "claim_idempotency",
      "complete_idempotency",
      "fail_idempotency",
      "btpm_encrypt",
      "btpm_decrypt",
      "Deno.env",
      "fetch(",
      "retry",
      "console",
      "serverFactory",
      "toolRegistry",
      "registerTool",
      "setTimeout",
      "setInterval",
      "Deno.serve",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("H2: Project Update, Transition, Program and Portfolio surfaces are untouched", () => {
  for (
    const forbidden of [
      "PROJECT_UPDATE_ROUTE",
      "PROJECT_TRANSITION_ROUTE",
      "parseApiV1UpdateProjectBody",
      "PROGRAM_CREATE_ROUTE",
      "PROGRAM_UPDATE_ROUTE",
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
