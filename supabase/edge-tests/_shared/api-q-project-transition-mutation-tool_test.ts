// API-Q Project Transition Step 3 — focused guard for the Project-transition
// MCP mutation tool control composition. Behavioural (in-process fakes) plus
// narrow static source guards. No network, no database, no Edge invocation, no
// service-role key.
//
// Scope: control/composition only. Exposure remains Step 4.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpProjectTransitionToolExecutor,
  type McpProjectTransitionToolErrorCategory,
  MCP_PROJECT_TRANSITION_TOOL_ARGUMENT_NAMES,
  MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_TRANSITION_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/projectTransitionMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1TransitionProjectIdempotencyPayload,
  parseApiV1TransitionProjectBody,
  PROJECT_TRANSITION_ROUTE,
} from "../../functions/_shared/btpm-api/routes/projects.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/projectTransitionMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const registrySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const EXPECTED_UPDATED_AT = "2026-08-16T10:20:30.123Z";
const NEW_UPDATED_AT = "2026-08-16T11:00:00.000Z";

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

const baseArgs = Object.freeze({
  projectId: PROJECT_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  targetStatus: "completed" as const,
  confirmWarnings: false,
  confirmation: true,
  idempotencyKey: "idem-key-project-transition",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  status: "completed",
  previousStatus: "active",
  updatedAt: NEW_UPDATED_AT,
});

const completionItem = Object.freeze({
  code: "open_tasks",
  message: "Open Tasks remain.",
  count: 3,
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    projectId: string;
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
  options: {
    rateLimitThrows?: unknown;
    writerThrows?: unknown;
    // deno-lint-ignore no-explicit-any
    execution?: any;
  } = {},
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

  const executor = createMcpProjectTransitionToolExecutor({
    request,
    execution: options.execution ?? trustedExecution,
    writer: (async (
      req: Request,
      projectId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, projectId, body, context });
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

// -----------------------------------------------------------------------------
// A. Exact transport schema
// -----------------------------------------------------------------------------

Deno.test("A1: tool name matches the registry identity exactly", () => {
  assertEquals(MCP_PROJECT_TRANSITION_TOOL_NAME, "btpm_transition_project");
  assert(registrySource.includes('toolName: "btpm_transition_project"'));
});

Deno.test("A2: exactly the six approved argument names, in order", () => {
  assertEquals(MCP_PROJECT_TRANSITION_TOOL_ARGUMENT_NAMES.length, 6);
  assertEquals([...MCP_PROJECT_TRANSITION_TOOL_ARGUMENT_NAMES], [
    "projectId",
    "expectedUpdatedAt",
    "targetStatus",
    "confirmWarnings",
    "confirmation",
    "idempotencyKey",
  ]);
  const schemaKeys = Object.keys(
    MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.shape as Record<string, unknown>,
  );
  assertEquals(schemaKeys, [...MCP_PROJECT_TRANSITION_TOOL_ARGUMENT_NAMES]);
});

Deno.test("A3: schema is strict and rejects unknown keys", () => {
  for (
    const forbidden of [
      "tenantId",
      "organizationId",
      "workspaceId",
      "apiClientId",
      "oauthClientId",
      "userId",
      "sourceChannel",
      "requestId",
      "correlationId",
      "payloadHash",
      "updatedAt",
      "operationId",
      "functionName",
      "counts",
      "hardBlocks",
      "warnings",
    ]
  ) {
    const parsed = MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse({
      ...baseArgs,
      [forbidden]: "x",
    });
    assertFalse(parsed.success, `${forbidden} must be rejected`);
    assertFalse(
      MCP_PROJECT_TRANSITION_TOOL_ARGUMENT_NAMES.includes(forbidden),
    );
  }
});

Deno.test("A4: targetStatus accepts exactly the canonical vocabulary", () => {
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    assert(
      MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse({
        ...baseArgs,
        targetStatus: status,
      }).success,
      `${status} must be accepted`,
    );
  }
  for (const status of ["archived", "closed", "COMPLETED", "", "onhold"]) {
    assertFalse(
      MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse({
        ...baseArgs,
        targetStatus: status,
      }).success,
      `${status} must be rejected`,
    );
  }
});

Deno.test("A5: confirmWarnings and confirmation are required booleans", () => {
  const missingWarnings = { ...baseArgs } as Record<string, unknown>;
  delete missingWarnings.confirmWarnings;
  assertFalse(
    MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(missingWarnings).success,
  );

  const missingConfirmation = { ...baseArgs } as Record<string, unknown>;
  delete missingConfirmation.confirmation;
  assertFalse(
    MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse(missingConfirmation)
      .success,
  );

  for (const bad of ["true", 1, null]) {
    assertFalse(
      MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse({
        ...baseArgs,
        confirmWarnings: bad,
      }).success,
    );
    assertFalse(
      MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.safeParse({
        ...baseArgs,
        confirmation: bad,
      }).success,
    );
  }
});

// -----------------------------------------------------------------------------
// B. Two confirmation concepts
// -----------------------------------------------------------------------------

Deno.test("B1: confirmation=false fails before rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...baseArgs, confirmation: false });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
  assertEquals(recorder.order.length, 0);
});

Deno.test("B2: confirmWarnings=true alone cannot satisfy transport confirmation", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    ...baseArgs,
    confirmWarnings: true,
    confirmation: false,
  });
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.writerCalls.length, 0);
  assert(
    /requireMcpMutationConfirmation\(parsedArgs\.confirmation\)/.test(
      executableSource,
    ),
  );
  assertFalse(
    /requireMcpMutationConfirmation\([^)]*confirmWarnings/.test(
      executableSource,
    ),
  );
});

Deno.test("B3: confirmation never enters the business body; confirmWarnings does", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...baseArgs, confirmWarnings: true });
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(Object.keys(body).sort(), [
    "confirmWarnings",
    "expectedUpdatedAt",
    "targetStatus",
  ]);
  assertEquals(body.confirmWarnings, true);
  assertFalse("confirmation" in body);
  assertFalse("idempotencyKey" in body);
  assertFalse("projectId" in body);

  const expectedHash = await hashCanonicalPayload(
    buildApiV1TransitionProjectIdempotencyPayload(
      PROJECT_ID,
      parseApiV1TransitionProjectBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        targetStatus: "completed",
        confirmWarnings: true,
      }),
    ),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);
});

// -----------------------------------------------------------------------------
// C. Canonical path / body
// -----------------------------------------------------------------------------

Deno.test("C1: canonical path and body parsers are composed", () => {
  assert(
    /parseApiV1ProjectTransitionPath\(\s*`\$\{PROJECT_PATH_PREFIX\}\$\{parsedArgs\.projectId\}\$\{PROJECT_TRANSITION_PATH_SUFFIX\}`/
      .test(executableSource),
  );
  assertEquals(
    executableSource.split("parseApiV1TransitionProjectBody(").length - 1,
    1,
  );
});

Deno.test("C2: canonical business values are forwarded unchanged", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...baseArgs, targetStatus: "on_hold" });
  assert(result.ok);
  assertEquals(recorder.writerCalls[0].projectId, PROJECT_ID);
  assertEquals(
    recorder.writerCalls[0].body.expectedUpdatedAt,
    EXPECTED_UPDATED_AT,
  );
  assertEquals(recorder.writerCalls[0].body.targetStatus, "on_hold");
  assertEquals(recorder.writerCalls[0].body.confirmWarnings, false);
});

Deno.test("C3: invalid Project ID or timestamp fails before the writer", async () => {
  for (
    const bad of [
      { projectId: "not-a-uuid" },
      { projectId: "00000000-0000-0000-0000-000000000000" },
      { expectedUpdatedAt: "yesterday" },
    ]
  ) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...baseArgs, ...bad });
    assertEquals(result, { ok: false, category: "invalid_arguments" });
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// -----------------------------------------------------------------------------
// D. Canonical hash / idempotency
// -----------------------------------------------------------------------------

async function capturedHash(
  // deno-lint-ignore no-explicit-any
  overrides: any,
): Promise<{ hash: string; key: string }> {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...baseArgs, ...overrides });
  assert(result.ok);
  const context = recorder.writerCalls[0].context;
  return { hash: context.payloadHash, key: context.idempotencyKey };
}

Deno.test("D1: idempotency key does not change the canonical payload hash", async () => {
  const a = await capturedHash({ idempotencyKey: "key-a" });
  const b = await capturedHash({ idempotencyKey: "key-b" });
  assertEquals(a.hash, b.hash);
  assertEquals(a.key, "key-a");
  assertEquals(b.key, "key-b");
  assert(/^[0-9a-f]{64}$/.test(a.hash));
});

Deno.test("D2: business fields change the canonical payload hash", async () => {
  const base = await capturedHash({});
  const warnings = await capturedHash({ confirmWarnings: true });
  const status = await capturedHash({ targetStatus: "cancelled" });
  const stamp = await capturedHash({
    expectedUpdatedAt: "2026-08-16T10:20:31.123Z",
  });
  const project = await capturedHash({ projectId: OTHER_PROJECT_ID });
  assertNotEquals(base.hash, warnings.hash);
  assertNotEquals(base.hash, status.hash);
  assertNotEquals(base.hash, stamp.hash);
  assertNotEquals(base.hash, project.hash);
});

Deno.test("D3: no local hashing implementation exists", () => {
  assertFalse(/crypto\.subtle/.test(executableSource));
  assertFalse(/sha256|SHA-256/.test(executableSource));
  assert(executableSource.includes("buildMcpMutationExecutionContext("));
  assert(
    executableSource.includes("buildApiV1TransitionProjectIdempotencyPayload("),
  );
});

// -----------------------------------------------------------------------------
// E. Rate limit
// -----------------------------------------------------------------------------

Deno.test("E1: canonical rate-limit identity and ordering", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...baseArgs });
  assert(result.ok);
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: PROJECT_TRANSITION_ROUTE.id,
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  assertEquals(consumed.apiClientId ?? consumed.key?.apiClientId, API_CLIENT_ID);
  assertEquals(consumed.userId ?? consumed.key?.userId, USER_ID);
  assertEquals(
    consumed.routeId ?? consumed.key?.routeId,
    PROJECT_TRANSITION_ROUTE.id,
  );
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
  assertEquals(recorder.writerCalls.length, 1);
});

Deno.test("E2: rate-limit failure maps to rate_limited with no writer", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor({ ...baseArgs });
  assertEquals(result, { ok: false, category: "rate_limited" });
  assertEquals(recorder.writerCalls.length, 0);
});

// -----------------------------------------------------------------------------
// F. Successful business results
// -----------------------------------------------------------------------------

Deno.test("F1: applied/no_change/replayed map to the exact success payload", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor({ ...baseArgs });
    assertEquals(result, {
      ok: true,
      payload: {
        outcome,
        projectId: PROJECT_ID,
        status: "completed",
        previousStatus: "active",
        updatedAt: NEW_UPDATED_AT,
      },
    });
  }
});

// -----------------------------------------------------------------------------
// G. Hard block is structured business output
// -----------------------------------------------------------------------------

Deno.test("G1: hard block is preserved as a successful structured payload", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "blocked",
    code: "completion_hard_blocked",
    projectId: PROJECT_ID,
    hardBlocks: [completionItem],
    warnings: [],
    counts: { openTasks: 3 },
  });
  const result = await executor({ ...baseArgs });
  assertEquals(result, {
    ok: true,
    payload: {
      outcome: "blocked",
      code: "completion_hard_blocked",
      projectId: PROJECT_ID,
      hardBlocks: [completionItem],
      warnings: [],
      counts: { openTasks: 3 },
    },
  });
  assert(result.ok);
  assertFalse("ok" in (result.payload as unknown as Record<string, unknown>));
  assertEquals(recorder.writerCalls.length, 1);
});

// -----------------------------------------------------------------------------
// H. Soft warnings are structured business output
// -----------------------------------------------------------------------------

Deno.test("H1: soft warnings are preserved as a successful structured payload", async () => {
  const { executor } = buildHarness({
    ok: false,
    outcome: "confirmation_required",
    code: "completion_soft_warnings",
    projectId: PROJECT_ID,
    warnings: [completionItem],
    counts: { openRisks: 1 },
  });
  const result = await executor({ ...baseArgs });
  assertEquals(result, {
    ok: true,
    payload: {
      outcome: "confirmation_required",
      code: "completion_soft_warnings",
      projectId: PROJECT_ID,
      warnings: [completionItem],
      counts: { openRisks: 1 },
    },
  });
  // Distinct from the MCP transport confirmation error category.
  const transport = await buildHarness().executor({
    ...baseArgs,
    confirmation: false,
  });
  assertEquals(transport, { ok: false, category: "confirmation_required" });
  assertNotEquals(JSON.stringify(result), JSON.stringify(transport));
});

// -----------------------------------------------------------------------------
// I. Stale Project
// -----------------------------------------------------------------------------

Deno.test("I1: conflict maps to stale_project with no retry or timestamp leak", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "conflict",
    code: "stale_project",
    currentUpdatedAt: NEW_UPDATED_AT,
  });
  const result = await executor({ ...baseArgs });
  assertEquals(result, { ok: false, category: "stale_project" });
  assertEquals(recorder.writerCalls.length, 1);
  assertFalse(JSON.stringify(result).includes(NEW_UPDATED_AT));
  assertEquals(
    recorder.writerCalls[0].body.expectedUpdatedAt,
    EXPECTED_UPDATED_AT,
  );
});

// -----------------------------------------------------------------------------
// J. Other bounded negatives
// -----------------------------------------------------------------------------

Deno.test("J1: bounded canonical negative outcomes map exactly", async () => {
  const expectations: ReadonlyArray<
    [string, McpProjectTransitionToolErrorCategory]
  > = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of expectations) {
    const { executor } = buildHarness({ ok: false, outcome });
    assertEquals(await executor({ ...baseArgs }), { ok: false, category });
  }
});

Deno.test("J2: unexpected writer failure is bounded as unavailable", async () => {
  const { executor } = buildHarness(successResult, {
    writerThrows: new Error("relation public.projects SQLSTATE 42501"),
  });
  assertEquals(await executor({ ...baseArgs }), {
    ok: false,
    category: "unavailable",
  });
});

// -----------------------------------------------------------------------------
// K. Error containment
// -----------------------------------------------------------------------------

Deno.test("K1: exactly eight bounded error categories with bounded messages", () => {
  assertEquals(Object.keys(MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "stale_project",
    "unavailable",
  ]);
  const joined = Object.values(MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES)
    .join(" ");
  for (
    const forbidden of [
      "SQL",
      "postgres",
      "Postgres",
      "SQLSTATE",
      "oauth",
      "OAuth",
      "token",
      "service_role",
      "service role",
      "rpc",
      "mcp_v1_",
      "api_v1_",
      "apply_project",
    ]
  ) {
    assertFalse(joined.includes(forbidden), `${forbidden} must not leak`);
  }
});

// -----------------------------------------------------------------------------
// L. Forbidden surfaces
// -----------------------------------------------------------------------------

Deno.test("L1: production Step-3 file contains no forbidden surface", () => {
  for (
    const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "privilegedClient",
      "Deno.env",
      ".rpc(",
      ".from(",
      "mcp_v1_transition_project",
      "api_v1_transition_project",
      "apply_project_status_transition",
      "api_project_client_enablements",
      "authorize_and_establish",
      "authorize_and_establish_mcp",
      "btpm_encrypt",
      "btpm_decrypt",
      "validate_project_completion",
      "UPDATE public.projects",
      "console.",
      "setTimeout",
      "setInterval",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `${forbidden} must not appear in the Step-3 tool`,
    );
  }
});
