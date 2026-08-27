// API-Q Phase Reorder Step 3 — focused guard for the Phase-reorder MCP mutation
// tool control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. `phases.reorder` must remain `not_exposed`
// and unwired in this step.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPhaseReorderToolExecutor,
  MCP_PHASE_REORDER_TOOL_ARGUMENT_NAMES,
  MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES,
  MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA,
  MCP_PHASE_REORDER_TOOL_NAME,
  MCP_PHASE_REORDER_TOOL_ROW_FIELD_NAMES,
  MCP_PHASE_REORDER_TOOL_ROW_SCHEMA,
} from "../../functions/btpm-mcp/mcp/phaseReorderMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1ReorderPhasesIdempotencyPayload,
  parseApiV1ReorderPhasesBody,
  PHASE_REORDER_ROUTE,
} from "../../functions/_shared/btpm-api/routes/phases.ts";
import { ApiHttpError } from "../../functions/_shared/btpm-api/http.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/phaseReorderMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);
const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_A = "22222222-2222-4222-8222-222222222222";
const PHASE_B = "33333333-3333-4333-8333-333333333333";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const AT_A = "2026-08-14T05:00:00.000Z";
const AT_B = "2026-08-14T05:30:00.000Z";

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

function validArgs(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    rows: [
      { phaseId: PHASE_A, expectedUpdatedAt: AT_A, sortOrder: 0 },
      { phaseId: PHASE_B, expectedUpdatedAt: AT_B, sortOrder: 1 },
    ],
    confirmation: true,
    idempotencyKey: "idem-key-phase-reorder",
    ...overrides,
  };
}

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  submittedCount: 2,
  changedCount: 2,
  orderedPhases: Object.freeze([
    Object.freeze({
      phaseId: PHASE_A,
      sortOrder: 0,
      updatedAt: "2026-08-14T06:30:00.000Z",
    }),
    Object.freeze({
      phaseId: PHASE_B,
      sortOrder: 1,
      updatedAt: "2026-08-14T06:30:00.000Z",
    }),
  ]),
});

const staleResult = Object.freeze({
  ok: false,
  outcome: "conflict",
  code: "stale_phase_order",
  projectId: PROJECT_ID,
  stalePhaseIds: Object.freeze([PHASE_A]),
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

  const executor = createMcpPhaseReorderToolExecutor({
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

// ---------------------------------------------------------------------------
// A. Tool envelope
// ---------------------------------------------------------------------------

Deno.test("A1/A2: tool name and the exact four argument names", () => {
  assertEquals(MCP_PHASE_REORDER_TOOL_NAME, "btpm_reorder_phases");
  assertEquals([...MCP_PHASE_REORDER_TOOL_ARGUMENT_NAMES], [
    "projectId",
    "rows",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(
    Object.keys(MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PHASE_REORDER_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A3: each row accepts exactly phaseId/expectedUpdatedAt/sortOrder", () => {
  assertEquals([...MCP_PHASE_REORDER_TOOL_ROW_FIELD_NAMES], [
    "phaseId",
    "expectedUpdatedAt",
    "sortOrder",
  ]);
  assertEquals(
    Object.keys(MCP_PHASE_REORDER_TOOL_ROW_SCHEMA.shape).sort(),
    [...MCP_PHASE_REORDER_TOOL_ROW_FIELD_NAMES].sort(),
  );
  for (const key of MCP_PHASE_REORDER_TOOL_ROW_FIELD_NAMES) {
    const partial: Record<string, unknown> = {
      phaseId: PHASE_A,
      expectedUpdatedAt: AT_A,
      sortOrder: 0,
    };
    delete partial[key];
    assertFalse(
      MCP_PHASE_REORDER_TOOL_ROW_SCHEMA.safeParse(partial).success,
      `missing row key accepted: ${key}`,
    );
  }
});

Deno.test("A4: unknown top-level and row-level fields are rejected", () => {
  assert(MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA.safeParse(validArgs()).success);
  for (
    const key of [
      "extra",
      "organizationId",
      "workspaceId",
      "sourceChannel",
      "payloadHash",
      "requestId",
      "correlationId",
      "actorUserId",
      "apiClientId",
      "phaseId",
    ]
  ) {
    assertFalse(
      MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA.safeParse(validArgs({ [key]: "x" }))
        .success,
      `unknown top-level key accepted: ${key}`,
    );
  }
  for (const key of ["name", "status", "projectId", "updatedAt"]) {
    assertFalse(
      MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA.safeParse(validArgs({
        rows: [
          { phaseId: PHASE_A, expectedUpdatedAt: AT_A, sortOrder: 0, [key]: "x" },
        ],
      })).success,
      `unknown row key accepted: ${key}`,
    );
  }
  for (const key of MCP_PHASE_REORDER_TOOL_ARGUMENT_NAMES) {
    const partial: Record<string, unknown> = validArgs();
    delete partial[key];
    assertFalse(
      MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA.safeParse(partial).success,
      `missing top-level key accepted: ${key}`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B1: confirmation=false is rejected before rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    validArgs({ confirmation: false }) as any,
  );
  assertEquals(result, { ok: false, category: "confirmation_required" });
  assertEquals(recorder.order, []);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B2: non-literal confirmation values never reach the writer", async () => {
  for (const value of ["true", 1, null, undefined, {}, []]) {
    const { executor, recorder } = buildHarness();
    const result = await executor(
      // deno-lint-ignore no-explicit-any
      validArgs({ confirmation: value }) as any,
    );
    assertFalse(result.ok);
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// C. Canonical contract reuse
// ---------------------------------------------------------------------------

Deno.test("C1: canonical Project path parser is reused", () => {
  assert(toolSource.includes("parseApiV1PhaseReorderPath"));
  assert(toolSource.includes('"/v1/projects/"'));
  assert(toolSource.includes('"/phases/reorder"'));
  // No second UUID parser is defined locally.
  assertFalse(/[0-9a-f]\{8\}-/.test(toolSource));
});

Deno.test("C2: canonical body and idempotency-payload builders are reused", () => {
  assert(toolSource.includes("parseApiV1ReorderPhasesBody"));
  assert(toolSource.includes("buildApiV1ReorderPhasesIdempotencyPayload"));
  assert(toolSource.includes("buildMcpMutationExecutionContext"));
});

Deno.test("C3: invalid projectId maps to invalid_arguments before the writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    validArgs({ projectId: "not-a-uuid" }) as any,
  );
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("C4: canonically invalid rows map to invalid_arguments", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(
    // deno-lint-ignore no-explicit-any
    validArgs({
      rows: [{ phaseId: "nope", expectedUpdatedAt: AT_A, sortOrder: 0 }],
    }) as any,
  );
  assertEquals(result, { ok: false, category: "invalid_arguments" });
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// D. Hashed business payload
// ---------------------------------------------------------------------------

function canonicalHashFor(rows: unknown, projectId = PROJECT_ID) {
  const body = parseApiV1ReorderPhasesBody({ rows });
  return hashCanonicalPayload(
    buildApiV1ReorderPhasesIdempotencyPayload(projectId, body),
  );
}

Deno.test("D1: payload hash covers Project identity plus the complete rows collection", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs() as never);
  assert(result.ok);
  const context = recorder.writerCalls[0].context;
  assertEquals(
    context.payloadHash,
    await canonicalHashFor(validArgs().rows),
  );
  const payload = buildApiV1ReorderPhasesIdempotencyPayload(
    PROJECT_ID,
    parseApiV1ReorderPhasesBody({ rows: validArgs().rows }),
  );
  assertEquals(Object.keys(payload).sort(), ["projectId", "rows"]);
  assertEquals(payload.rows.length, 2);
  assertEquals(Object.keys(payload.rows[0]).sort(), [
    "expectedUpdatedAt",
    "phaseId",
    "sortOrder",
  ]);
});

Deno.test("D2: changing phaseId, expectedUpdatedAt or sortOrder changes the hash", async () => {
  const base = await canonicalHashFor(validArgs().rows);
  const variants = [
    [
      { phaseId: PHASE_B, expectedUpdatedAt: AT_A, sortOrder: 0 },
      { phaseId: PHASE_A, expectedUpdatedAt: AT_B, sortOrder: 1 },
    ],
    [
      { phaseId: PHASE_A, expectedUpdatedAt: "2026-08-14T05:00:01.000Z", sortOrder: 0 },
      { phaseId: PHASE_B, expectedUpdatedAt: AT_B, sortOrder: 1 },
    ],
    [
      { phaseId: PHASE_A, expectedUpdatedAt: AT_A, sortOrder: 5 },
      { phaseId: PHASE_B, expectedUpdatedAt: AT_B, sortOrder: 1 },
    ],
  ];
  for (const rows of variants) {
    assertNotEquals(await canonicalHashFor(rows), base);
  }
  // Project identity also participates.
  assertNotEquals(
    await canonicalHashFor(validArgs().rows, PHASE_B),
    base,
  );
});

Deno.test("D3: confirmation and idempotencyKey never enter the hashed payload", async () => {
  const expected = await canonicalHashFor(validArgs().rows);
  const first = buildHarness();
  assert((await first.executor(validArgs() as never)).ok);
  assertEquals(first.recorder.writerCalls[0].context.payloadHash, expected);

  const second = buildHarness();
  assert(
    (await second.executor(
      validArgs({ idempotencyKey: "a-totally-different-key" }) as never,
    )).ok,
  );
  assertEquals(second.recorder.writerCalls[0].context.payloadHash, expected);
  assertEquals(
    second.recorder.writerCalls[0].context.idempotencyKey,
    "a-totally-different-key",
  );
  // Confirmation is control metadata only.
  assertFalse("confirmation" in second.recorder.writerCalls[0].body);
  assertFalse("confirmation" in second.recorder.writerCalls[0].context);
});

// ---------------------------------------------------------------------------
// E. Rate limiting and writer invocation
// ---------------------------------------------------------------------------

Deno.test("E1: rate limiting uses exactly phases.reorder", async () => {
  assertEquals(PHASE_REORDER_ROUTE.id, "phases.reorder");
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(recorder.profileCalls, [
    { clientId: API_CLIENT_ID, routeId: "phases.reorder" },
  ]);
  assertEquals(recorder.consumeCalls.length, 1);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "phases.reorder");
});

Deno.test("E2: writer is invoked exactly once with canonical inputs", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(call.projectId, PROJECT_ID);
  assertEquals(Object.keys(call.body), ["rows"]);
  assertEquals(call.body.rows.length, 2);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
  assertEquals(call.context.executingUserId, USER_ID);
  assertEquals(call.context.apiClientId, API_CLIENT_ID);
  assertEquals(call.context.requestId, "req-1");
  assertEquals(call.context.correlationId, "req-1");
});

Deno.test("E3: caller expectedUpdatedAt values remain unchanged", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs() as never)).ok);
  const rows = recorder.writerCalls[0].body.rows;
  assertEquals(rows[0].expectedUpdatedAt, AT_A);
  assertEquals(rows[1].expectedUpdatedAt, AT_B);
});

Deno.test("E4: rate-limit exceeded maps to rate_limited without the writer", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  const result = await executor(validArgs() as never);
  assertEquals(result, { ok: false, category: "rate_limited" });
  assertEquals(recorder.writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// F. Bounded results
// ---------------------------------------------------------------------------

for (const outcome of ["applied", "no_change", "replayed"] as const) {
  Deno.test(`F1(${outcome}): success maps to the bounded structural payload`, async () => {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs() as never);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "changedCount",
      "orderedPhases",
      "outcome",
      "projectId",
      "submittedCount",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.projectId, PROJECT_ID);
    assertEquals(result.payload.submittedCount, 2);
    assertEquals(result.payload.changedCount, 2);
    assertEquals(result.payload.orderedPhases.length, 2);
    for (const phase of result.payload.orderedPhases) {
      assertEquals(Object.keys(phase).sort(), [
        "phaseId",
        "sortOrder",
        "updatedAt",
      ]);
    }
  });
}

Deno.test("F2: no Phase narrative field is ever returned", async () => {
  const { executor } = buildHarness({
    ...successResult,
    name: "Realization",
    description: "secret narrative",
  });
  const result = await executor(validArgs() as never);
  assert(result.ok);
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("secret narrative"));
  assertFalse(serialized.includes("Realization"));
});

Deno.test("F3: stale order maps to stale_phase_order with no refreshed timestamp", async () => {
  const { executor, recorder } = buildHarness(staleResult);
  const result = await executor(validArgs() as never);
  assertEquals(result, { ok: false, category: "stale_phase_order" });
  // No retry: exactly one writer invocation.
  assertEquals(recorder.writerCalls.length, 1);
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes(PHASE_A));
  assertFalse(serialized.includes("2026-"));
  assert(
    MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES.stale_phase_order.includes(
      "new idempotency key",
    ),
  );
});

Deno.test("F4: negative writer outcomes map correctly", async () => {
  const pairs = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ] as const;
  for (const [outcome, category] of pairs) {
    const { executor } = buildHarness({ ok: false, outcome });
    assertEquals(await executor(validArgs() as never), {
      ok: false,
      category,
    });
  }
});

Deno.test("F5: ApiHttpError categories are bounded", async () => {
  const cases = [
    ["not_authorized", "not_authorized"],
    ["invalid_request", "invalid_arguments"],
    ["internal_error", "unavailable"],
  ] as const;
  for (const [code, category] of cases) {
    const { executor } = buildHarness(successResult, {
      writerThrows: new ApiHttpError(code),
    });
    assertEquals(await executor(validArgs() as never), {
      ok: false,
      category,
    });
  }
});

Deno.test("F6: malformed trusted context becomes unavailable without leaking the invariant", async () => {
  const malformed = [
    { ...trustedExecution, sourceChannel: "external_api" },
    { ...trustedExecution, delegationMode: "service" },
    { ...trustedExecution, executingUserId: "someone-else" },
    { ...trustedExecution, correlationId: "different" },
    { ...trustedExecution, apiClientId: "" },
  ];
  for (const execution of malformed) {
    const { executor, recorder } = buildHarness(successResult, { execution });
    const result = await executor(validArgs() as never);
    assertEquals(result, { ok: false, category: "unavailable" });
    assertEquals(Object.keys(result), ["ok", "category"]);
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("F7: invalid idempotency key maps to invalid_arguments", async () => {
  for (const key of ["", "   ", "bad key with spaces"]) {
    const { executor, recorder } = buildHarness();
    assertEquals(
      await executor(validArgs({ idempotencyKey: key }) as never),
      { ok: false, category: "invalid_arguments" },
    );
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// G. Static architecture guards
// ---------------------------------------------------------------------------

Deno.test("G1: module introduces no forbidden surface", () => {
  const forbidden = [
    "createClient",
    "Deno.env",
    "service_role",
    "SERVICE_ROLE",
    ".from(",
    ".rpc(",
    "public.reorder_phases",
    "apply_phase_planning_change",
    "pmg_",
    "registerTool",
    "setRequestHandler",
    "while (",
    "for (;;)",
    "setTimeout",
    "console.",
  ];
  for (const token of forbidden) {
    assertFalse(
      toolSource.includes(token),
      `forbidden token present: ${token}`,
    );
  }
});

// Phase Reorder Step 4 exposed the tool; the Step 3 boundary that must still
// hold is that this control module owns no exposure, wiring or RPC surface.
Deno.test("G2: phases.reorder is exposed as btpm_reorder_phases", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "phases.reorder");
  assert(entry, "phases.reorder registry entry missing");
  assertEquals(entry.exposure, "exposed");
  assertEquals(entry.toolName, "btpm_reorder_phases");
});

Deno.test("G3: serverFactory knows only the bounded Step 3 control layer", () => {
  assertFalse(serverFactorySource.includes("phaseReorderMutationExecutor.ts"));
  assertFalse(serverFactorySource.includes("createMcpV1ReorderPhasesExecutor"));
  assert(serverFactorySource.includes("phaseReorderMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpPhaseReorderToolExecutor"));
});
