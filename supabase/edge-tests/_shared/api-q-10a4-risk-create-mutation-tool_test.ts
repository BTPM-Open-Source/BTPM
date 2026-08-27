// API-Q.10A4 — focused guard for the Risk-create MCP mutation tool control
// composition. Behavioural (in-process fakes) + static source guards. No
// network, no database, no Edge invocation, no service-role key.
//
// Scope: this module is only the control/composition layer. Exposure and
// runtime wiring are owned by API-Q.10A5 (which exposes `risks.create`); this
// test proves the control module itself registers nothing and holds no runtime,
// Supabase, RPC or PMG logic.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpRiskCreateToolExecutor,
  MCP_RISK_CREATE_TOOL_ARGUMENT_NAMES,
  MCP_RISK_CREATE_TOOL_ERROR_MESSAGES,
  MCP_RISK_CREATE_TOOL_INPUT_SCHEMA,
  MCP_RISK_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/riskCreateMutationTool.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import { RISK_CREATE_ROUTE } from "../../functions/_shared/btpm-api/routes/risks.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/riskCreateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);
const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const RISK_ID = "22222222-2222-4222-8222-222222222222";
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
  targetType: "project" as const,
  targetId: TARGET_ID,
  title: "Integration cutover slippage",
  confirmation: true,
  idempotencyKey: "idem-key-10a4",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  riskId: RISK_ID,
  targetType: "project",
  targetId: TARGET_ID,
  likelihood: "medium",
  impact: "medium",
  status: "open",
  createdAt: "2026-08-14T05:00:00.000Z",
  updatedAt: "2026-08-14T05:00:00.000Z",
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

  const executor = createMcpRiskCreateToolExecutor({
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
  assertEquals(MCP_RISK_CREATE_TOOL_NAME, "btpm_create_risk");
  assertEquals([...MCP_RISK_CREATE_TOOL_ARGUMENT_NAMES], [
    "targetType",
    "targetId",
    "title",
    "description",
    "mitigationPlan",
    "likelihood",
    "impact",
    "status",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_RISK_CREATE_TOOL_ARGUMENT_NAMES.length, 10);
});

Deno.test("A3/A4: the schema is strict and rejects unknown fields", () => {
  const ok = MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.safeParse(validArgs);
  assert(ok.success);
  for (const key of ["nickname", "extra", "riskId", "projectId"]) {
    const result = MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      [key]: "x",
    });
    assertFalse(result.success, `unknown key accepted: ${key}`);
  }
});

Deno.test("A5: confirmation aliases are rejected", () => {
  for (const alias of ["confirmed", "approve", "approved", "yes", "force"]) {
    const result = MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      [alias]: true,
    });
    assertFalse(result.success, `alias accepted: ${alias}`);
  }
});

Deno.test("A6/A7: identity, provenance, scope, control and update fields are rejected", () => {
  const forbidden = [
    "expectedUpdatedAt",
    "riskId",
    "projectId",
    "workspaceId",
    "organizationId",
    "tenantId",
    "userLinks",
    "objectLinks",
    "requestedUserId",
    "executingUserId",
    "apiClientId",
    "oauthClientId",
    "policyVersionId",
    "sourceChannel",
    "sourceClientId",
    "delegationMode",
    "requestId",
    "correlationId",
    "payloadHash",
    "command",
    "operationId",
    "function",
    "rpc",
    "table",
    "sql",
                    "execute",
  ];
  for (const key of forbidden) {
    const result = MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      [key]: "x",
    });
    assertFalse(result.success, `forbidden key accepted: ${key}`);
  }
});

Deno.test("A: legacy Risk status aliases are rejected", () => {
  for (const legacy of ["identified", "mitigating", "accepted"]) {
    const result = MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      status: legacy,
    });
    assertFalse(result.success, `legacy status accepted: ${legacy}`);
  }
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B8/B11/B12: confirmation=false is confirmation_required with no side effects", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.order.length, 0);
});

Deno.test("B9/B10: missing confirmation and string \"true\" are invalid_arguments", async () => {
  for (const value of [undefined, "true", 1, null]) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...validArgs, confirmation: value as any });
    assert(!result.ok);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.order.length, 0);
  }
});

// ---------------------------------------------------------------------------
// C. Canonical Risk body
// ---------------------------------------------------------------------------

Deno.test("C13/C14: the canonical parser is the only Risk validator in the module", () => {
  assert(toolSource.includes("parseApiV1CreateRiskBody(businessInput)"));
  for (
    const forbidden of [
      "under_mitigation\"\n",
      "DESCRIPTION_MAX_LENGTH",
      "MITIGATION_PLAN_MAX_LENGTH",
      "TITLE_MAX_LENGTH",
      "?? \"medium\"",
      "|| \"medium\"",
      "?? \"open\"",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `duplicate Risk validation/default detected: ${forbidden}`,
    );
  }
});

Deno.test("C15/C16/C17: omitted optionals resolve to canonical defaults; control fields absent", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);

  const body = recorder.writerCalls[0].body;
  assertEquals(Object.keys(body).sort(), [
    "description",
    "impact",
    "likelihood",
    "mitigationPlan",
    "status",
    "targetId",
    "targetType",
    "title",
  ]);
  assertEquals(body.description, null);
  assertEquals(body.mitigationPlan, null);
  assertEquals(body.likelihood, "medium");
  assertEquals(body.impact, "medium");
  assertEquals(body.status, "open");
  assertFalse("confirmation" in body);
  assertFalse("idempotencyKey" in body);
});

Deno.test("C: supplied optionals are forwarded through the canonical parser", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    ...validArgs,
    description: "Interface freeze at risk.",
    mitigationPlan: "Escalate to steering committee.",
    likelihood: "high",
    impact: "critical",
    status: "under_mitigation",
  });
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(body.likelihood, "high");
  assertEquals(body.impact, "critical");
  assertEquals(body.status, "under_mitigation");
  assertEquals(body.description, "Interface freeze at risk.");
});

Deno.test("C: malformed business values fail before rate limit and writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, targetId: "not-a-uuid" });
  assert(!result.ok);
  assertEquals(result.category, "invalid_arguments");
  assertEquals(recorder.order.length, 0);
});

// ---------------------------------------------------------------------------
// D. Mutation context
// ---------------------------------------------------------------------------

Deno.test("D18/D19/D20/D22: canonical mutation context, idempotency validation and body-only hash", async () => {
  assert(toolSource.includes("buildMcpMutationExecutionContext("));

  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);

  const { body, context } = recorder.writerCalls[0];
  assertEquals(context.idempotencyKey, validArgs.idempotencyKey);
  assertEquals(context.sourceChannel, "mcp");
  assertEquals(context.delegationMode, "delegated_user");
  assertEquals(context.payloadHash, await hashCanonicalPayload(body));

  // No caller-supplied payloadHash is accepted by the envelope.
  assertFalse(
    MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      payloadHash: "a".repeat(64),
    }).success,
  );

  const invalidKey = buildHarness();
  const rejected = await invalidKey.executor({
    ...validArgs,
    idempotencyKey: "   ",
  });
  assert(!rejected.ok);
  assertEquals(rejected.category, "invalid_arguments");
  assertEquals(invalidKey.recorder.order.length, 0);
});

Deno.test("D21: changing only the idempotency key does not change the payload hash", async () => {
  const first = buildHarness();
  await first.executor(validArgs);
  const second = buildHarness();
  await second.executor({ ...validArgs, idempotencyKey: "another-key-10a4" });

  assertEquals(
    first.recorder.writerCalls[0].context.payloadHash,
    second.recorder.writerCalls[0].context.payloadHash,
  );
  assertFalse(
    first.recorder.writerCalls[0].context.idempotencyKey ===
      second.recorder.writerCalls[0].context.idempotencyKey,
  );
});

// ---------------------------------------------------------------------------
// E. Rate limit
// ---------------------------------------------------------------------------

Deno.test("E23/E24/E25: canonical route identity, client-scoped profile, user-scoped consumption", async () => {
  assertEquals(RISK_CREATE_ROUTE.id, "risks.create");
  const { executor, recorder } = buildHarness();
  await executor(validArgs);

  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "risks.create",
  }]);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "risks.create");
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("E26/E27: rate-limit rejection maps to rate_limited with no writer call", async () => {
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

Deno.test("F28/F29/F30/F31: the writer is called exactly once with request, canonical body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls.length, 1);
  assertEquals(recorder.writerCalls[0].request, request);
  assertEquals(recorder.writerCalls[0].body.title, validArgs.title);
  assertEquals(recorder.writerCalls[0].context.requestId, "req-1");
  assertEquals(recorder.writerCalls[0].context.correlationId, "req-1");
});

Deno.test("F32: writer negative outcomes map to the exact bounded categories", async () => {
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

// ---------------------------------------------------------------------------
// G. Output safety
// ---------------------------------------------------------------------------

Deno.test("G33/G34/G35/G36/G37/G38: bounded success payload omits narrative and provenance", async () => {
  for (const outcome of ["applied", "replayed"] as const) {
    const { executor } = buildHarness({ ...successResult, outcome });
    const result = await executor({
      ...validArgs,
      description: "narrative-description",
      mitigationPlan: "narrative-mitigation",
    });
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "createdAt",
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
    for (
      const forbidden of [
        "title",
        "description",
        "mitigationPlan",
        "idempotencyKey",
        "payloadHash",
        "requestId",
        "correlationId",
        "requestedUserId",
        "executingUserId",
        "apiClientId",
        "oauthClientId",
        "policyVersionId",
        "sourceChannel",
        "sourceClientId",
        "delegationMode",
      ]
    ) {
      assertFalse(
        forbidden in (result.payload as unknown as Record<string, unknown>),
        `leaked field: ${forbidden}`,
      );
    }
    assertFalse(JSON.stringify(result.payload).includes("narrative"));
  }
});

Deno.test("G39: unknown internal failures map to unavailable only", async () => {
  const { executor } = buildHarness(undefined, {
    writerThrows: new Error("relation risks does not exist (SQLSTATE 42P01)"),
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "unavailable");
  assertFalse(JSON.stringify(result).includes("SQLSTATE"));
});

Deno.test("G: bounded messages are exactly the approved seven", () => {
  assertEquals(MCP_RISK_CREATE_TOOL_ERROR_MESSAGES, {
    confirmation_required:
      "Explicit confirmation is required for this mutation.",
    invalid_arguments: "Invalid arguments.",
    not_authorized: "Not authorized to create this Risk.",
    rate_limited: "Rate limit exceeded. Try again later.",
    idempotency_conflict:
      "This idempotency key was already used with a different request.",
    idempotency_pending:
      "An identical request is still in progress. Retry shortly.",
    unavailable: "BTPM Risk creation is temporarily unavailable.",
  });
});

// ---------------------------------------------------------------------------
// H. Architecture / exposure
// ---------------------------------------------------------------------------

Deno.test("H40: no env, Supabase client, RPC, PMG, table, fetch or service-role code exists", () => {
  for (
    const forbidden of [
      ".rpc(",
      "mcp_v1_create_risk",
      "api_v1_create_risk",
      "apply_risk_create",
      "pmg_",
      "createClient",
      "SERVICE_ROLE",
      "service_role",
      "Deno.env",
      "console.",
      "fetch(",
      ".from(",
      "setTimeout",
      "select ",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("H41: no generic mutation dispatcher or registration exists", () => {
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
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected dispatcher/registration reference to ${forbidden}`,
    );
  }
});

// API-Q.10A5 reframing: `risks.create` is now intentionally exposed. The A4
// control-layer metadata invariants (tool name, class, confirmation,
// concurrency token) are preserved verbatim; only the exposure-state assertion
// changed, because exposure is owned by API-Q.10A5, not by this module.
Deno.test("H42: risks.create registry metadata remains the accepted A4 contract", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) => e.operationId === "risks.create");
  assert(entry !== undefined);
  assertEquals(entry.toolName, "btpm_create_risk");
  assertEquals(entry.operationClass, "mutation");
  assertEquals(entry.confirmation, "required");
  assertEquals(entry.resultShape, "single_object");
  assertEquals(entry.concurrencyToken, "not_applicable");
});

// API-Q.10A5 reframing: registration/wiring now legitimately exists in
// serverFactory and btpm-mcp/index.ts. What must still hold — and is what this
// A4 test owns — is that the control module itself performs no registration and
// no runtime wiring of its own.
Deno.test("H43/H44: the A4 control module performs no registration or runtime wiring", () => {
  for (
    const forbidden of [
      "registerTool",
      "createBtpmMcpServer",
      "serverFactory",
      "toolRegistry",
      "Deno.serve",
      "Deno.env",
      "createClient",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `riskCreateMutationTool references ${forbidden}`,
    );
  }
  // The registration/runtime layers stay outside this module.
  assert(serverFactorySource.length > 0);
  assert(mcpIndexSource.length > 0);
});

Deno.test("H45: Risk update remains untouched by this module", () => {
  for (
    const forbidden of [
      "RISK_UPDATE_ROUTE",
      "parseApiV1UpdateRiskBody",
      "expectedUpdatedAt",
      "btpm_update_risk",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `unexpected Risk-update reference to ${forbidden}`,
    );
  }
});
