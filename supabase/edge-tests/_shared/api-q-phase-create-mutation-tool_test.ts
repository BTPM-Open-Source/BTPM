// API-Q Phase Create Step 3 — focused guard for the Phase-create MCP mutation
// tool control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. `phases.create` must remain `not_exposed`
// and unwired in this step.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPhaseCreateToolExecutor,
  MCP_PHASE_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA,
  MCP_PHASE_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/phaseCreateMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  parseApiV1CreatePhaseBody,
  PHASE_CREATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/phases.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/phaseCreateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);
const registrySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);
const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
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
  projectId: PROJECT_ID,
  name: "Realization",
  confirmation: true,
  idempotencyKey: "idem-key-phase-create",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  phaseId: PHASE_ID,
  projectId: PROJECT_ID,
  status: "planned",
  phaseType: "work_item",
  startDate: null,
  targetEndDate: null,
  sortOrder: 1,
  isArchived: false,
  createdAt: "2026-08-14T05:00:00.000Z",
  updatedAt: "2026-08-14T05:00:00.000Z",
  shiftedSiblingCount: 0,
});

const projectWindowResult = Object.freeze({
  ok: false,
  outcome: "confirmation_required",
  code: "extend_project_window_required",
  projectId: PROJECT_ID,
  projectStartDate: "2026-01-01",
  projectTargetEndDate: "2026-06-30",
  requestedPhaseStartDate: "2026-07-01",
  requestedPhaseTargetEndDate: "2026-09-30",
  requiredProjectStartDate: "2026-01-01",
  requiredProjectTargetEndDate: "2026-09-30",
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

  const executor = createMcpPhaseCreateToolExecutor({
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
// A. Tool envelope
// ---------------------------------------------------------------------------

Deno.test("A1/A2: tool name and the exact ten argument names", () => {
  assertEquals(MCP_PHASE_CREATE_TOOL_NAME, "btpm_create_phase");
  assertEquals([...MCP_PHASE_CREATE_TOOL_ARGUMENT_NAMES], [
    "projectId",
    "name",
    "description",
    "status",
    "phaseType",
    "startDate",
    "targetEndDate",
    "sortOrder",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PHASE_CREATE_TOOL_ARGUMENT_NAMES.length, 10);
  assertEquals(
    Object.keys(MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PHASE_CREATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A3/A4: the schema is strict and rejects unknown fields", () => {
  const ok = MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.safeParse(validArgs);
  assert(ok.success);
  for (const key of ["nickname", "extra", "phaseId", "targetType"]) {
    const result = MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      [key]: "x",
    });
    assertFalse(result.success, `unknown key accepted: ${key}`);
  }
});

Deno.test("A5: only canonical Phase vocabularies are accepted", () => {
  for (
    const status of [
      "planned",
      "active",
      "completed",
      "on_hold",
      "cancelled",
    ]
  ) {
    assert(
      MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, status })
        .success,
    );
  }
  for (
    const phaseType of [
      "work_item",
      "milestone",
      "deliverable",
      "decision",
      "review",
    ]
  ) {
    assert(
      MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, phaseType })
        .success,
    );
  }
  assertFalse(
    MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      status: "in_progress",
    }).success,
  );
  assertFalse(
    MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      phaseType: "epic",
    }).success,
  );
});

// ---------------------------------------------------------------------------
// B. Confirmation gate
// ---------------------------------------------------------------------------

Deno.test("B1: confirmation=false fails before rate limit and writer", async () => {
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
// C. Canonical business parsing / defaults
// ---------------------------------------------------------------------------

Deno.test("C1: business object excludes confirmation and idempotencyKey", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body as Record<string, unknown>;
  assertFalse("confirmation" in body);
  assertFalse("idempotencyKey" in body);
  for (
    const forbidden of [
      "apiClientId",
      "oauthClientId",
      "requestId",
      "correlationId",
      "sourceChannel",
      "payloadHash",
      "executingUserId",
    ]
  ) {
    assertFalse(forbidden in body, `leaked control field: ${forbidden}`);
  }
});

Deno.test("C2: omitted optional values receive canonical parser defaults", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const body = recorder.writerCalls[0].body;
  assertEquals(body, parseApiV1CreatePhaseBody({
    projectId: PROJECT_ID,
    name: "Realization",
  }));
  assertEquals(body.description, null);
  assertEquals(body.status, "planned");
  assertEquals(body.phaseType, "work_item");
  assertEquals(body.startDate, null);
  assertEquals(body.targetEndDate, null);
  assertEquals(body.sortOrder, null);
});

Deno.test("C3: canonical parser rejects invalid ids, dates, ranges and sort order", async () => {
  const invalidCases: Array<Record<string, unknown>> = [
    { projectId: "not-a-uuid" },
    { name: "   " },
    { startDate: "2026-13-01" },
    { targetEndDate: "14/08/2026" },
    { startDate: "2026-09-30", targetEndDate: "2026-01-01" },
    { sortOrder: -1 },
    { sortOrder: 1.5 },
    { sortOrder: 10_000_000 },
  ];
  for (const patch of invalidCases) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, ...patch } as any);
    assert(!result.ok, `accepted invalid patch: ${JSON.stringify(patch)}`);
    assertEquals(
      result.category,
      "invalid_arguments",
      `wrong category for ${JSON.stringify(patch)}`,
    );
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Idempotency + payload hash
// ---------------------------------------------------------------------------

Deno.test("D1: the payload hash covers the canonical body only", async () => {
  const { executor, recorder } = buildHarness();
  await executor({
    ...validArgs,
    description: "Core build",
    startDate: "2026-01-01",
    targetEndDate: "2026-06-30",
  });
  const canonicalBody = recorder.writerCalls[0].body;
  const context = recorder.writerCalls[0].context;
  assertEquals(context.payloadHash, await hashCanonicalPayload(canonicalBody));
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
});

Deno.test("D2: confirmation and idempotencyKey are not hashed", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const hash = recorder.writerCalls[0].context.payloadHash;

  const { executor: e2, recorder: r2 } = buildHarness();
  await e2({ ...validArgs, idempotencyKey: "different-key" });
  assertEquals(r2.writerCalls[0].context.payloadHash, hash);

  const withConfirmation = await hashCanonicalPayload({
    ...recorder.writerCalls[0].body,
    confirmation: true,
  });
  assertFalse(hash === withConfirmation);
  const withKey = await hashCanonicalPayload({
    ...recorder.writerCalls[0].body,
    idempotencyKey: validArgs.idempotencyKey,
  });
  assertFalse(hash === withKey);
});

// ---------------------------------------------------------------------------
// E. Rate limit + single writer invocation
// ---------------------------------------------------------------------------

Deno.test("E1: rate limiting uses exactly phases.create", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(PHASE_CREATE_ROUTE.id, "phases.create");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "phases.create",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  assertEquals(consumed.apiClientId ?? consumed.clientId, API_CLIENT_ID);
  assert(JSON.stringify(consumed).includes("phases.create"));
  assert(JSON.stringify(consumed).includes(USER_ID));
});

Deno.test("E2: the writer runs exactly once, after all controls", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E3: rate-limit rejection stops before the writer", async () => {
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
// F. Bounded success payload
// ---------------------------------------------------------------------------

Deno.test("F1: the success payload is bounded and has no name or description", async () => {
  const { executor } = buildHarness();
  const result = await executor({ ...validArgs, description: "Core build" });
  assert(result.ok);
  assertEquals(Object.keys(result.payload), [
    "outcome",
    "phaseId",
    "projectId",
    "status",
    "phaseType",
    "startDate",
    "targetEndDate",
    "sortOrder",
    "isArchived",
    "createdAt",
    "updatedAt",
    "shiftedSiblingCount",
  ]);
  const serialized = JSON.stringify(result.payload);
  assertFalse(serialized.includes("Realization"));
  assertFalse(serialized.includes("Core build"));
  for (
    const forbidden of [
      "name",
      "description",
      "idempotencyKey",
      "payloadHash",
      "requestId",
      "correlationId",
      "apiClientId",
      "oauthClientId",
      "policyVersionId",
      "sourceChannel",
      "delegationMode",
    ]
  ) {
    assertFalse(
      forbidden in (result.payload as unknown as Record<string, unknown>),
      `leaked field: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// G. Project planning-window category
// ---------------------------------------------------------------------------

Deno.test("G1: extend_project_window_required maps to project_window_extension_required", async () => {
  const { executor, recorder } = buildHarness(projectWindowResult);
  const result = await executor({
    ...validArgs,
    startDate: "2026-07-01",
    targetEndDate: "2026-09-30",
  });
  assert(!result.ok);
  assertEquals(result.category, "project_window_extension_required");
  // Distinct from the ordinary MCP confirmation gate.
  assertFalse(result.category === "confirmation_required");
  // No retry, no Project mutation, no date rewrite.
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.writerCalls[0].body.startDate, "2026-07-01");
  assertEquals(recorder.writerCalls[0].body.targetEndDate, "2026-09-30");
  assertEquals(
    recorder.order.filter((entry) => entry === "writer").length,
    1,
  );
  // No Phase narrative disclosure.
  assertFalse(JSON.stringify(result).includes("Realization"));
  assertFalse(JSON.stringify(result).includes("2026-07-01"));
});

Deno.test("G2: a replayed stored Project-window confirmation gets the same category", async () => {
  // The wrapper normalizes the replayed stored confirmation result back to
  // `outcome: confirmation_required` with the same code.
  const { executor } = buildHarness({ ...projectWindowResult });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "project_window_extension_required");
});

Deno.test("G3: the bounded Project-window message names the new-key requirement", () => {
  assertEquals(
    MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES.project_window_extension_required,
    "Phase dates fall outside the Project planning window. Extend the Project planning window, then retry with a new idempotency key.",
  );
});

// ---------------------------------------------------------------------------
// H. Other bounded failure mapping
// ---------------------------------------------------------------------------

Deno.test("H1: canonical negative outcomes map correctly", async () => {
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

Deno.test("H2: unexpected failures map to unavailable only", async () => {
  const { executor } = buildHarness(undefined, {
    writerThrows: new Error(
      "relation phases does not exist (SQLSTATE 42P01) at pg_catalog",
    ),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("SQLSTATE"));
  assertFalse(serialized.includes("pg_catalog"));
});

Deno.test("H3: a malformed trusted context maps to unavailable", async () => {
  const executor = createMcpPhaseCreateToolExecutor({
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

Deno.test("H4: bounded messages are exactly the approved nine categories", () => {
  // PCC-1 added the bounded baselined-Project Phase-date category.
  assertEquals(Object.keys(MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "phase_dates_required",
    "project_window_extension_required",
    "rate_limited",
    "unavailable",
  ]);
});

// ---------------------------------------------------------------------------
// I. Architecture / exposure
// ---------------------------------------------------------------------------

Deno.test("I1: no env, Supabase client, RPC, PMG, table, fetch or service-role code exists", () => {
  for (
    const forbidden of [
      ".rpc(",
      "mcp_v1_create_phase",
      "api_v1_create_phase",
      "apply_phase_create",
      "pmg_",
      "createClient",
      "SERVICE_ROLE",
      "service_role",
      "Deno.env",
      "console.",
      "fetch(",
      ".from(",
      "setTimeout",
      "setInterval",
      "select ",
      "Bearer",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("I2: no generic dispatcher, registration or Project mutation exists", () => {
  for (
    const forbidden of [
      "registerTool",
      "createBtpmMcpServer",
      "MCP_TOOL_REGISTRY",
      "exposedMcpTools",
      "operationId:",
      "dispatch(",
      "wrapperName",
      "functionName",
      "sourceChannel:",
      "serverFactory",
      "toolRegistry",
      "Deno.serve",
      "PROJECT_UPDATE_ROUTE",
      "parseApiV1UpdateProjectBody",
      "PROJECT_PLANNING_ROUTE",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("I3: Phase update, reorder and planning remain untouched", () => {
  for (
    const forbidden of [
      "PHASE_UPDATE_ROUTE",
      "PHASE_REORDER_ROUTE",
      "PHASE_PLANNING_ROUTE",
      "parseApiV1UpdatePhaseBody",
      "parseApiV1ReorderPhasesBody",
      "parseApiV1PlanPhaseBody",
      "expectedUpdatedAt",
      "btpm_update_phase",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected out-of-scope reference to ${forbidden}`,
    );
  }
});

Deno.test("I4: phases.create is exposed with the accepted registry identity", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) =>
    e.operationId === "phases.create"
  );
  assert(entry !== undefined);
  assertEquals(entry.toolName, "btpm_create_phase");
  assertEquals(entry.operationClass, "mutation");
  // Phase Create Step 4 exposed the tool; the control layer itself is
  // unchanged and stays free of registration and writer construction.
  assertEquals(entry.exposure, "exposed");
  assertEquals(entry.confirmation, "required");
  assert(registrySource.includes("phases.create"));

  assert(serverFactorySource.includes("MCP_PHASE_CREATE_TOOL_NAME"));
  assert(mcpIndexSource.includes("createMcpPhaseCreateToolExecutor"));
  assertFalse(
    serverFactorySource.includes("createMcpV1CreatePhaseExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});
