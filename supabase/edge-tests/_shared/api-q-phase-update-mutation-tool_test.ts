// API-Q Phase Update Step 3 — focused guard for the Phase-update MCP mutation
// tool control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. `phases.update` must remain `not_exposed`
// and unwired in this step.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpPhaseUpdateToolExecutor,
  MCP_PHASE_UPDATE_TOOL_ARGUMENT_NAMES,
  MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PHASE_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/phaseUpdateMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1UpdatePhaseIdempotencyPayload,
  parseApiV1UpdatePhaseBody,
  PHASE_UPDATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/phases.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/phaseUpdateMutationTool.ts",
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
const EXPECTED_UPDATED_AT = "2026-08-14T05:00:00.000Z";

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
  phaseId: PHASE_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  name: "Realization",
  description: "Core build",
  status: "active" as const,
  phaseType: "deliverable" as const,
  confirmation: true,
  idempotencyKey: "idem-key-phase-update",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  phaseId: PHASE_ID,
  projectId: PROJECT_ID,
  status: "active",
  phaseType: "deliverable",
  updatedAt: "2026-08-14T06:30:00.000Z",
});

const staleResult = Object.freeze({
  ok: false,
  outcome: "conflict",
  code: "stale_phase",
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    phaseId: string;
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

  const executor = createMcpPhaseUpdateToolExecutor({
    request,
    execution: trustedExecution,
    writer: (async (
      req: Request,
      phaseId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, phaseId, body, context });
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

Deno.test("A1/A2: tool name and the exact eight argument names", () => {
  assertEquals(MCP_PHASE_UPDATE_TOOL_NAME, "btpm_update_phase");
  assertEquals([...MCP_PHASE_UPDATE_TOOL_ARGUMENT_NAMES], [
    "phaseId",
    "expectedUpdatedAt",
    "name",
    "description",
    "status",
    "phaseType",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PHASE_UPDATE_TOOL_ARGUMENT_NAMES.length, 8);
  assertEquals(
    Object.keys(MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PHASE_UPDATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A3: the schema is strict and rejects unknown fields", () => {
  assert(MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "nickname",
      "extra",
      "projectId",
      "sourceChannel",
      "payloadHash",
      "requestId",
      "correlationId",
      "actorUserId",
    ]
  ) {
    assertFalse(
      MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, [key]: "x" })
        .success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("A4: every one of the eight arguments is required", () => {
  for (const key of MCP_PHASE_UPDATE_TOOL_ARGUMENT_NAMES) {
    const partial: Record<string, unknown> = { ...validArgs };
    delete partial[key];
    assertFalse(
      MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse(partial).success,
      `missing key accepted: ${key}`,
    );
  }
});

Deno.test("A5: no schedule or ordering field is accepted", () => {
  for (const key of ["startDate", "targetEndDate", "sortOrder"]) {
    assertFalse(
      MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        [key]: "2026-01-01",
      }).success,
      `schedule field accepted: ${key}`,
    );
    assertFalse(MCP_PHASE_UPDATE_TOOL_ARGUMENT_NAMES.includes(key));
  }
});

Deno.test("A6: only canonical Phase vocabularies are accepted", () => {
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    assert(
      MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, status })
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
      MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, phaseType })
        .success,
    );
  }
  assertFalse(
    MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      status: "in_progress",
    }).success,
  );
  assertFalse(
    MCP_PHASE_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      phaseType: "epic",
    }).success,
  );
});

// ---------------------------------------------------------------------------
// B. Confirmation gate
// ---------------------------------------------------------------------------

Deno.test("B1: confirmation=false stops before rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B2: no confirmation alias or coercion is accepted", async () => {
  for (const confirmation of [undefined, null, "true", 1, {}]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation } as any);
    assert(!result.ok);
    assert(
      result.category === "confirmation_required" ||
        result.category === "invalid_arguments",
    );
    assertEquals(recorder.writerCalls.length, 0);
  }
  const { executor } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const aliased = await executor({ ...validArgs, confirmed: true } as any);
  assert(!aliased.ok);
  assertEquals(aliased.category, "invalid_arguments");
});

// ---------------------------------------------------------------------------
// C. Canonical Phase identity + body parser reuse
// ---------------------------------------------------------------------------

Deno.test("C1: the canonical path parser validates Phase identity", async () => {
  assert(toolSource.includes("parseApiV1PhaseUpdatePath"));
  assert(toolSource.includes("/v1/phases/"));
  for (const phaseId of ["not-a-uuid", "", "22222222-2222-4222-8222"]) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, phaseId });
    assert(!result.ok, `accepted invalid phaseId: ${phaseId}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

Deno.test("C2: the canonical body parser owns business validation", async () => {
  assert(toolSource.includes("parseApiV1UpdatePhaseBody"));
  const invalidCases: Array<Record<string, unknown>> = [
    { name: "   " },
    { expectedUpdatedAt: "not-a-timestamp" },
    { expectedUpdatedAt: "" },
  ];
  for (const patch of invalidCases) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, ...patch } as any);
    assert(!result.ok, `accepted invalid patch: ${JSON.stringify(patch)}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("C3: the writer receives exactly the canonical five-field body", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(
    body,
    parseApiV1UpdatePhaseBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "Realization",
      description: "Core build",
      status: "active",
      phaseType: "deliverable",
    }),
  );
  assertEquals(Object.keys(body).sort(), [
    "description",
    "expectedUpdatedAt",
    "name",
    "phaseType",
    "status",
  ]);
  for (
    const forbidden of [
      "confirmation",
      "idempotencyKey",
      "phaseId",
      "projectId",
      "startDate",
      "targetEndDate",
      "sortOrder",
      "apiClientId",
      "oauthClientId",
      "requestId",
      "correlationId",
      "sourceChannel",
      "payloadHash",
      "executingUserId",
    ]
  ) {
    assertFalse(forbidden in body, `leaked field in body: ${forbidden}`);
  }
});

Deno.test("C4: the writer receives the canonical Phase id", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(recorder.writerCalls[0].phaseId, PHASE_ID);
});

// ---------------------------------------------------------------------------
// D. Idempotency + payload hash (identity is included)
// ---------------------------------------------------------------------------

Deno.test("D1: the canonical Phase-update idempotency payload builder is used", async () => {
  assert(toolSource.includes("buildApiV1UpdatePhaseIdempotencyPayload"));
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const body = recorder.writerCalls[0].body;
  const context = recorder.writerCalls[0].context;
  assertEquals(
    context.payloadHash,
    await hashCanonicalPayload(
      buildApiV1UpdatePhaseIdempotencyPayload(PHASE_ID, body),
    ),
  );
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  // The hash must NOT be over the body alone: identity is folded in.
  assertFalse(context.payloadHash === await hashCanonicalPayload(body));
});

Deno.test("D2: a different phaseId changes the payload hash", async () => {
  const other = "55555555-5555-4555-8555-555555555555";
  const { executor: e1, recorder: r1 } = buildHarness();
  await e1(validArgs);
  const { executor: e2, recorder: r2 } = buildHarness();
  await e2({ ...validArgs, phaseId: other });
  assertFalse(
    r1.writerCalls[0].context.payloadHash ===
      r2.writerCalls[0].context.payloadHash,
  );
});

Deno.test("D3: confirmation and idempotencyKey are not hashed", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  const hash = recorder.writerCalls[0].context.payloadHash;

  const { executor: e2, recorder: r2 } = buildHarness();
  await e2({ ...validArgs, idempotencyKey: "different-key" });
  assertEquals(r2.writerCalls[0].context.payloadHash, hash);

  const canonical = buildApiV1UpdatePhaseIdempotencyPayload(
    PHASE_ID,
    recorder.writerCalls[0].body,
  );
  assertFalse(
    hash === await hashCanonicalPayload({ ...canonical, confirmation: true }),
  );
  assertFalse(
    hash === await hashCanonicalPayload({
      ...canonical,
      idempotencyKey: validArgs.idempotencyKey,
    }),
  );
});

Deno.test("D4: an invalid idempotency key fails as invalid_arguments before the writer", async () => {
  for (const idempotencyKey of ["", "   ", "x".repeat(500)]) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, idempotencyKey });
    assert(!result.ok, `accepted key: ${idempotencyKey.length}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
    assertEquals(recorder.consumeCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// E. Rate limit + single writer invocation
// ---------------------------------------------------------------------------

Deno.test("E1: rate limiting uses exactly phases.update", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(PHASE_UPDATE_ROUTE.id, "phases.update");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "phases.update",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  assertEquals(consumed.apiClientId ?? consumed.clientId, API_CLIENT_ID);
  assert(JSON.stringify(consumed).includes("phases.update"));
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
// F. Optimistic concurrency
// ---------------------------------------------------------------------------

Deno.test("F1: expectedUpdatedAt reaches the writer unchanged", async () => {
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(
    recorder.writerCalls[0].body.expectedUpdatedAt,
    EXPECTED_UPDATED_AT,
  );
});

Deno.test("F2: no timestamp refresh primitive exists in the control layer", () => {
  for (
    const forbidden of [
      "new Date",
      "Date.now",
      "toISOString",
      "Date.parse",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `timestamp primitive present: ${forbidden}`,
    );
  }
});

Deno.test("F3: stale_phase maps to the bounded stale category with no retry", async () => {
  const { executor, recorder } = buildHarness(staleResult);
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "stale_phase");
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(
    recorder.order.filter((entry) => entry === "writer").length,
    1,
  );
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes(EXPECTED_UPDATED_AT));
  assertFalse(serialized.includes("2026-08-14T06:30:00.000Z"));
  assertFalse(serialized.includes("Realization"));
});

Deno.test("F4: the bounded stale message is exact", () => {
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.stale_phase,
    "This Phase has changed since the supplied expectedUpdatedAt. Read the current Phase and retry intentionally with a new updatedAt and a new idempotency key.",
  );
});

// ---------------------------------------------------------------------------
// G. Bounded success payload
// ---------------------------------------------------------------------------

Deno.test("G1: applied/no_change/replayed produce the bounded payload only", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(Object.keys(result.payload), [
      "outcome",
      "phaseId",
      "projectId",
      "status",
      "phaseType",
      "updatedAt",
    ]);
    const serialized = JSON.stringify(result.payload);
    assertFalse(serialized.includes("Realization"));
    assertFalse(serialized.includes("Core build"));
    for (
      const forbidden of [
        "name",
        "description",
        "expectedUpdatedAt",
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
  }
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

Deno.test("H2: unexpected failures disclose only unavailable", async () => {
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
  const executor = createMcpPhaseUpdateToolExecutor({
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

Deno.test("H4: bounded messages are exactly the approved eight categories", () => {
  assertEquals(Object.keys(MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "stale_phase",
    "unavailable",
  ]);
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.confirmation_required,
    "Explicit confirmation is required for this mutation.",
  );
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.invalid_arguments,
    "Invalid arguments.",
  );
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.not_authorized,
    "Not authorized to update this Phase.",
  );
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.rate_limited,
    "Rate limit exceeded. Try again later.",
  );
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.idempotency_conflict,
    "This idempotency key was already used with a different request.",
  );
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.idempotency_pending,
    "An identical request is still in progress. Retry shortly.",
  );
  assertEquals(
    MCP_PHASE_UPDATE_TOOL_ERROR_MESSAGES.unavailable,
    "BTPM Phase update is temporarily unavailable.",
  );
});

// ---------------------------------------------------------------------------
// I. Architecture / exposure
// ---------------------------------------------------------------------------

Deno.test("I1: no env, client, RPC, PMG, table, fetch, encryption or logging code exists", () => {
  for (
    const forbidden of [
      ".rpc(",
      "mcp_v1_update_phase",
      "api_v1_update_phase",
      "apply_phase_update",
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
      "crypto.subtle",
      "Bearer",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `forbidden construct present: ${forbidden}`,
    );
  }
});

Deno.test("I2: no Phase read or read-before-write exists", () => {
  for (
    const forbidden of [
      "readPhase",
      "getPhase",
      "fetchPhase",
      "listPhases",
      "updated_at",
      "while (",
      "attempt",
      "backoff",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `read/retry construct present: ${forbidden}`,
    );
  }
});

// Phase Update Step 4 exposed and wired `phases.update`. The durable invariant
// asserted here is the canonical registry identity of the reserved tool name.
Deno.test("I3: phases.update keeps its canonical registry identity", () => {
  const entry = MCP_TOOL_REGISTRY.find((item) =>
    item.operationId === "phases.update"
  );
  assert(entry, "phases.update missing from the registry");
  assertEquals(entry.exposure, "exposed");
  assertEquals(entry.toolName, MCP_PHASE_UPDATE_TOOL_NAME);
  // The registry itself never imports the control layer.
  assertFalse(registrySource.includes("phaseUpdateMutationTool"));
  // The factory knows only the bounded control layer, never the writer adapter.
  assertFalse(serverFactorySource.includes("phaseUpdateMutationExecutor"));
  assert(serverFactorySource.includes("phaseUpdateMutationTool"));
  assert(mcpIndexSource.includes("phaseUpdateMutationTool"));
});
