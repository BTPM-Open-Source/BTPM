// API-Q.10B3 — focused guard for the Risk-update MCP mutation-control
// composition. Behavioural (in-process fakes) + static source guards. No
// network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. Exposure and runtime wiring belong to a
// later step; this test proves the module registers nothing and holds no
// runtime, Supabase, RPC or PMG logic, and that `risks.update` stays
// unexposed.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpRiskUpdateToolExecutor,
  MCP_RISK_UPDATE_TOOL_ARGUMENT_NAMES,
  MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_RISK_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/riskUpdateMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1UpdateRiskIdempotencyPayload,
  RISK_UPDATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/risks.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/riskUpdateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);
const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const RISK_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RISK_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
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
  riskId: RISK_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  title: "Integration cutover slippage",
  description: null,
  mitigationPlan: null,
  likelihood: "high" as const,
  impact: "critical" as const,
  status: "under_mitigation" as const,
  confirmation: true,
  idempotencyKey: "idem-key-10b3",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  riskId: RISK_ID,
  targetType: "project",
  targetId: TARGET_ID,
  likelihood: "high",
  impact: "critical",
  status: "under_mitigation",
  updatedAt: "2026-08-14T06:00:00.000Z",
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    riskId: string;
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

  const executor = createMcpRiskUpdateToolExecutor({
    request,
    execution: trustedExecution,
    writer: (async (
      req: Request,
      riskId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, riskId, body, context });
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
// A. Strict input
// ---------------------------------------------------------------------------

Deno.test("A: tool name and the exact ten argument names", () => {
  assertEquals(MCP_RISK_UPDATE_TOOL_NAME, "btpm_update_risk");
  assertEquals([...MCP_RISK_UPDATE_TOOL_ARGUMENT_NAMES], [
    "riskId",
    "expectedUpdatedAt",
    "title",
    "description",
    "mitigationPlan",
    "likelihood",
    "impact",
    "status",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_RISK_UPDATE_TOOL_ARGUMENT_NAMES.length, 10);
  assertEquals(
    Object.keys(MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_RISK_UPDATE_TOOL_ARGUMENT_NAMES].sort(),
  );
});

Deno.test("A: unknown, alias, identity and provenance fields are rejected", () => {
  assert(MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "extra",
      "confirmed",
      "approve",
      "approved",
      "yes",
      "force",
      "projectId",
      "workspaceId",
      "organizationId",
      "targetType",
      "targetId",
      "actor",
      "sourceChannel",
      "clientId",
      "oauthClientId",
      "payloadHash",
      "requestId",
      "correlationId",
    ]
  ) {
    assertFalse(
      MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, [key]: "x" })
        .success,
      `forbidden key accepted: ${key}`,
    );
  }
});

Deno.test("A: every desired-state field is required; narratives are nullable", () => {
  for (
    const key of [
      "riskId",
      "expectedUpdatedAt",
      "title",
      "description",
      "mitigationPlan",
      "likelihood",
      "impact",
      "status",
      "confirmation",
      "idempotencyKey",
    ]
  ) {
    const args: Record<string, unknown> = { ...validArgs };
    delete args[key];
    assertFalse(
      MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse(args).success,
      `optional field detected: ${key}`,
    );
  }
  assert(
    MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      description: null,
      mitigationPlan: null,
    }).success,
  );
  assert(
    MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      description: "d",
      mitigationPlan: "m",
    }).success,
  );
});

Deno.test("A: confirmation must be a transport boolean; legacy statuses rejected", () => {
  for (const value of ["true", 1, null, {}]) {
    assertFalse(
      MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        confirmation: value,
      }).success,
    );
  }
  for (const legacy of ["identified", "mitigating", "accepted"]) {
    assertFalse(
      MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        status: legacy,
      }).success,
    );
  }
});

Deno.test("A: canonical parsers own UUID/timestamp/length business validation", () => {
  // The transport schema accepts any string; the canonical parsers reject.
  assert(
    MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      riskId: "not-a-uuid",
      expectedUpdatedAt: "yesterday",
    }).success,
  );
  assert(toolSource.includes("parseApiV1RiskUpdatePath("));
  assert(toolSource.includes("parseApiV1UpdateRiskBody(businessInput)"));
  for (
    const forbidden of [
      "DESCRIPTION_MAX_LENGTH",
      "MITIGATION_PLAN_MAX_LENGTH",
      "TITLE_MAX_LENGTH",
      "uuid(",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `duplicate business validation detected: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B: confirmation=false is confirmation_required with no side effects", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B: confirmation never reaches the canonical business payload", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  const { body, context } = recorder.writerCalls[0];
  assertEquals(Object.keys(body).sort(), [
    "description",
    "expectedUpdatedAt",
    "impact",
    "likelihood",
    "mitigationPlan",
    "status",
    "title",
  ]);
  assertFalse("confirmation" in body);
  assertFalse("idempotencyKey" in body);
  assertEquals(
    context.payloadHash,
    await hashCanonicalPayload(
      buildApiV1UpdateRiskIdempotencyPayload(RISK_ID, body),
    ),
  );
});

// ---------------------------------------------------------------------------
// C. Canonical validation
// ---------------------------------------------------------------------------

Deno.test("C: canonical Risk id and complete seven-field body reach the writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    ...validArgs,
    description: "Interface freeze at risk.",
    mitigationPlan: "Escalate to steering committee.",
  });
  assert(result.ok);
  assertEquals(recorder.writerCalls[0].riskId, RISK_ID);
  const body = recorder.writerCalls[0].body;
  assertEquals(body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  assertEquals(body.title, validArgs.title);
  assertEquals(body.description, "Interface freeze at risk.");
  assertEquals(body.mitigationPlan, "Escalate to steering committee.");
  assertEquals(body.likelihood, "high");
  assertEquals(body.impact, "critical");
  assertEquals(body.status, "under_mitigation");
});

Deno.test("C: malformed risk id or timestamp fails before rate limit and writer", async () => {
  for (
    const args of [
      { ...validArgs, riskId: "not-a-uuid" },
      { ...validArgs, riskId: "00000000-0000-0000-0000-000000000000" },
      { ...validArgs, expectedUpdatedAt: "yesterday" },
      { ...validArgs, title: "   " },
    ]
  ) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor(args as any);
    assert(!result.ok);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.order.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Canonical idempotency payload
// ---------------------------------------------------------------------------

Deno.test("D: hash covers riskId + all seven body fields, deterministically", async () => {
  assert(toolSource.includes("buildApiV1UpdateRiskIdempotencyPayload("));

  const first = buildHarness();
  await first.executor(validArgs);
  const second = buildHarness();
  await second.executor(validArgs);
  const firstHash = first.recorder.writerCalls[0].context.payloadHash;
  assertEquals(second.recorder.writerCalls[0].context.payloadHash, firstHash);

  const payload = buildApiV1UpdateRiskIdempotencyPayload(
    RISK_ID,
    first.recorder.writerCalls[0].body,
  );
  assertEquals(Object.keys(payload).sort(), [
    "description",
    "expectedUpdatedAt",
    "impact",
    "likelihood",
    "mitigationPlan",
    "riskId",
    "status",
    "title",
  ]);
  assertEquals(await hashCanonicalPayload(payload), firstHash);

  // Different riskId → different hash.
  const otherRisk = buildHarness();
  await otherRisk.executor({ ...validArgs, riskId: OTHER_RISK_ID });
  assertFalse(
    otherRisk.recorder.writerCalls[0].context.payloadHash === firstHash,
  );

  // Different expectedUpdatedAt → different hash.
  const otherStamp = buildHarness();
  await otherStamp.executor({
    ...validArgs,
    expectedUpdatedAt: "2026-08-13T05:00:00.000Z",
  });
  assertFalse(
    otherStamp.recorder.writerCalls[0].context.payloadHash === firstHash,
  );

  // Different idempotency key → same hash.
  const otherKey = buildHarness();
  await otherKey.executor({ ...validArgs, idempotencyKey: "another-10b3" });
  assertEquals(otherKey.recorder.writerCalls[0].context.payloadHash, firstHash);

  // Invalid idempotency key fails before rate limit and writer.
  const blankKey = buildHarness();
  const rejected = await blankKey.executor({
    ...validArgs,
    idempotencyKey: "   ",
  });
  assert(!rejected.ok);
  assertEquals(rejected.category, "invalid_arguments");
  assertEquals(blankKey.recorder.order.length, 0);
});

// ---------------------------------------------------------------------------
// E. Rate limiting
// ---------------------------------------------------------------------------

Deno.test("E: exactly risks.update is resolved and consumed from trusted identity", async () => {
  assertEquals(RISK_UPDATE_ROUTE.id, "risks.update");
  const { executor, recorder } = buildHarness();
  await executor(validArgs);
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "risks.update",
  }]);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "risks.update");
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E: rate-limit rejection maps to rate_limited with no writer call", async () => {
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

// ---------------------------------------------------------------------------
// F. Writer
// ---------------------------------------------------------------------------

Deno.test("F: writer invoked exactly once with request, id, body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.writerCalls[0].request, request);
  assertEquals(recorder.writerCalls[0].riskId, RISK_ID);
  assertEquals(
    recorder.writerCalls[0].body.expectedUpdatedAt,
    EXPECTED_UPDATED_AT,
  );
  const context = recorder.writerCalls[0].context;
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  assertEquals(context.sourceChannel, "mcp");
  assertEquals(context.delegationMode, "delegated_user");
  assertEquals(context.requestId, "req-1");
  assertEquals(context.correlationId, "req-1");
});

// ---------------------------------------------------------------------------
// G. Results
// ---------------------------------------------------------------------------

Deno.test("G: bounded success payload for applied/no_change/replayed", async () => {
  for (const outcome of ["applied", "no_change", "replayed"] as const) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor({
      ...validArgs,
      title: "narrative-title",
      description: "narrative-description",
      mitigationPlan: "narrative-mitigation",
    });
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "impact",
      "likelihood",
      "outcome",
      "riskId",
      "status",
      "targetId",
      "targetType",
      "updatedAt",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertFalse(JSON.stringify(result.payload).includes("narrative"));
  }
});

Deno.test("G: negative outcomes map to the exact bounded categories", async () => {
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{ ok: false, outcome: "invalid" }, "invalid_arguments"],
    [{ ok: false, outcome: "not_authorized" }, "not_authorized"],
    [{ ok: false, outcome: "idempotency_conflict" }, "idempotency_conflict"],
    [{ ok: false, outcome: "idempotency_pending" }, "idempotency_pending"],
    [{ ok: false, outcome: "conflict", code: "stale_risk" }, "stale_risk"],
  ];
  for (const [writerResult, category] of cases) {
    const { executor } = buildHarness(writerResult);
    const result = await executor(validArgs);
    assert(!result.ok);
    assertEquals(result.category, category);
  }
});

Deno.test("G: unknown internal failures map to unavailable only", async () => {
  const { executor } = buildHarness(undefined, {
    writerThrows: new Error("relation risks does not exist (SQLSTATE 42P01)"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  assertFalse(JSON.stringify(result).includes("SQLSTATE"));
});

Deno.test("G: bounded messages are exactly the approved eight", () => {
  assertEquals(MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES, {
    confirmation_required:
      "Explicit confirmation is required for this mutation.",
    invalid_arguments: "Invalid arguments.",
    not_authorized: "Not authorized to update this Risk.",
    rate_limited: "Rate limit exceeded. Try again later.",
    idempotency_conflict:
      "This idempotency key was already used with a different request.",
    idempotency_pending:
      "An identical request is still in progress. Retry shortly.",
    stale_risk:
      "This Risk has changed since the supplied expectedUpdatedAt. Read the current Risk and retry intentionally with a new updatedAt and a new idempotency key.",
    unavailable: "BTPM Risk update is temporarily unavailable.",
  });
});

// ---------------------------------------------------------------------------
// H. Stale concurrency
// ---------------------------------------------------------------------------

Deno.test("H: stale_risk is bounded, never retried and never refreshed", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "conflict",
    code: "stale_risk",
    // Simulated database detail that must never escape.
    currentUpdatedAt: "2026-08-14T09:59:59.999Z",
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "stale_risk");
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.consumeCalls.length, 1);
  assertFalse(JSON.stringify(result).includes("2026-08-14T09:59:59.999Z"));
  assertFalse(
    MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES.stale_risk.includes("09:59:59"),
  );
  // The forwarded precondition is byte-for-byte the caller's value.
  assertEquals(
    recorder.writerCalls[0].body.expectedUpdatedAt,
    EXPECTED_UPDATED_AT,
  );
  for (
    const forbidden of ["new Date(", "toISOString(", "Date.now(", "while (", "for (;;"]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected time/retry construct: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// I. Forbidden surfaces / exposure
// ---------------------------------------------------------------------------

Deno.test("I: no env, client, RPC, PMG, table, fetch, log, timer or service-role code", () => {
  for (
    const forbidden of [
      ".rpc(",
      "mcp_v1_update_risk",
      "api_v1_update_risk",
      "apply_risk_update",
      "execute_v1_update_risk",
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
      "encrypt(",
      "decrypt(",
      "select ",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("I: no generic dispatcher, registration or runtime wiring exists", () => {
  for (
    const forbidden of [
      "registerTool",
      "createBtpmMcpServer",
      "MCP_TOOL_REGISTRY",
      "toolRegistry",
      "serverFactory",
      "Deno.serve",
      "operationId:",
      "dispatch(",
      "wrapperName",
      "functionName",
      "sourceChannel:",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected dispatcher/registration reference to ${forbidden}`,
    );
  }
});

// API-Q.10B4 exposed and wired `risks.update`. What must still hold for this
// control-composition step is that the control module itself performs no
// registration: the factory registers the tool through the bounded executor
// contract only.
Deno.test("I: risks.update exposure is owned by the factory, not the control module", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "risks.update");
  assert(entry !== undefined);
  assertEquals(entry.exposure, "exposed");
  assertEquals(entry.toolName, MCP_RISK_UPDATE_TOOL_NAME);
  assertFalse(toolSource.includes("registerTool"));
  assert(serverFactorySource.includes("executors.riskUpdate("));
});
