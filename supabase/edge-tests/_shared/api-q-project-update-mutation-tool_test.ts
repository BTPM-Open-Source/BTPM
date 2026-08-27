// API-Q Project Update Step 3 — focused guard for the Project-update MCP
// mutation tool control composition. Behavioural (in-process fakes) + static
// source guards. No network, no database, no Edge invocation, no service-role
// key.
//
// Scope: control/composition only. Exposure remains Step 4 and is not asserted
// here.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpProjectUpdateToolExecutor,
  type McpProjectUpdateToolErrorCategory,
  MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES,
  MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/projectUpdateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1UpdateProjectIdempotencyPayload,
  parseApiV1UpdateProjectBody,
  PROJECT_UPDATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/projects.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/projectUpdateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
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
  confirmation: true,
  idempotencyKey: "idem-key-project-update",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  projectId: PROJECT_ID,
  updatedAt: NEW_UPDATED_AT,
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

  const executor = createMcpProjectUpdateToolExecutor({
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
// A. Exact tool contract
// -----------------------------------------------------------------------------

Deno.test("A1: tool name matches the registry identity exactly", () => {
  assertEquals(MCP_PROJECT_UPDATE_TOOL_NAME, "btpm_update_project");
});

Deno.test("A2: exactly the nineteen approved argument names, in order", () => {
  assertEquals(MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES.length, 19);
  assertEquals([...MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES], [
    "projectId",
    "expectedUpdatedAt",
    "name",
    "priority",
    "description",
    "charter",
    "goals",
    "scopeIn",
    "scopeOut",
    "businessCase",
    "successCriteria",
    "completionCriteria",
    "budgetNarrative",
    "assumptions",
    "constraints",
    "programId",
    "deliveryModel",
    "confirmation",
    "idempotencyKey",
  ]);
  const schemaKeys = Object.keys(
    MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA.shape as Record<string, unknown>,
  );
  assertEquals(schemaKeys, [...MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES]);
});

Deno.test("A3: schema is strict and rejects unknown keys", () => {
  const parsed = MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
    ...baseArgs,
    workspaceId: "11111111-1111-4111-8111-111111111111",
  });
  assertFalse(parsed.success);
});

Deno.test("A4: no set* transport parameter and no forbidden surface field", () => {
  for (const key of MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES) {
    assertFalse(key.startsWith("set"));
  }
  for (
    const forbidden of [
      "workspaceId",
      "organizationId",
      "tenantId",
      "clientId",
      "sourceChannel",
      "status",
      "startDate",
      "endDate",
      "archived",
      "transition",
      "setName",
      "setDescription",
      "setProgramId",
    ]
  ) {
    assertFalse(
      MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES.includes(forbidden),
      forbidden,
    );
  }
});

Deno.test("A5: name and priority are optional but not nullable", () => {
  assertFalse(
    MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...baseArgs,
      name: null,
    }).success,
  );
  assertFalse(
    MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...baseArgs,
      priority: null,
    }).success,
  );
  assert(
    MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...baseArgs,
      name: "Renamed",
      priority: "high",
    }).success,
  );
});

// -----------------------------------------------------------------------------
// B. Confirmation
// -----------------------------------------------------------------------------

Deno.test("B1: confirmation false -> confirmation_required, nothing executes", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs, confirmation: false } as any);
  assertFalse(result.ok);
  assertEquals(result.ok === false && result.category, "confirmation_required");
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("B2: confirmation true proceeds through the accepted order", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs } as any);
  assert(result.ok);
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

// -----------------------------------------------------------------------------
// C. Canonical path/body parsing
// -----------------------------------------------------------------------------

Deno.test("C1: invalid Project ID -> invalid_arguments, no writer", async () => {
  for (
    const bad of [
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      "5555/5555",
      "",
    ]
  ) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...baseArgs, projectId: bad } as any);
    assertFalse(result.ok);
    assertEquals(result.ok === false && result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("C2: canonical timestamp/name/priority/Program validation is reused", async () => {
  const cases: Array<Record<string, unknown>> = [
    { expectedUpdatedAt: "2026-08-16" },
    { expectedUpdatedAt: "not-a-timestamp" },
    { name: "   " },
    { programId: "nope" },
  ];
  for (const patch of cases) {
    const { executor, recorder } = buildHarness();
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...baseArgs, ...patch } as any);
    assertFalse(result.ok, JSON.stringify(patch));
    assertEquals(result.ok === false && result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
  }
});

Deno.test("C3: canonical body parser is called exactly once, no duplicate validation", () => {
  assertEquals(
    executableSource.split("parseApiV1UpdateProjectBody(").length - 1,
    1,
  );
  assertEquals(
    executableSource.split("parseApiV1ProjectUpdatePath(").length - 1,
    1,
  );
  for (
    const forbidden of [
      "PROJECT_PRIORITIES",
      "btrim",
      "trim().length === 0",
      "canonicalizeProjectText",
      "TIMESTAMPTZ",
    ]
  ) {
    assertFalse(executableSource.includes(forbidden), forbidden);
  }
});

// -----------------------------------------------------------------------------
// D. Presence semantics
// -----------------------------------------------------------------------------

async function writerBodyFor(patch: Record<string, unknown>) {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs, ...patch } as any);
  assert(result.ok, JSON.stringify(patch));
  assertEquals(recorder.writerCalls.length, 1);
  return recorder.writerCalls[0].body;
}

Deno.test("D1: omitted narrative -> setDescription false + null", async () => {
  const body = await writerBodyFor({});
  assertEquals(body.setDescription, false);
  assertEquals(body.description, null);
});

Deno.test("D2: explicit null narrative -> setDescription true + null", async () => {
  const body = await writerBodyFor({ description: null });
  assertEquals(body.setDescription, true);
  assertEquals(body.description, null);
});

Deno.test("D3: explicit narrative text -> setDescription true + normalized", async () => {
  const body = await writerBodyFor({ description: "  Delivery scope  " });
  assertEquals(body.setDescription, true);
  assertEquals(body.description, "Delivery scope");
});

Deno.test("D4: omitted Program -> setProgramId false", async () => {
  const body = await writerBodyFor({});
  assertEquals(body.setProgramId, false);
  assertEquals(body.programId, null);
});

Deno.test("D5: explicit null Program -> setProgramId true + null", async () => {
  const body = await writerBodyFor({ programId: null });
  assertEquals(body.setProgramId, true);
  assertEquals(body.programId, null);
});

Deno.test("D6: explicit Program -> setProgramId true + value", async () => {
  const body = await writerBodyFor({ programId: PROGRAM_ID });
  assertEquals(body.setProgramId, true);
  assertEquals(body.programId, PROGRAM_ID);
});

Deno.test("D7: omitted deliveryModel -> setDeliveryModel false", async () => {
  const body = await writerBodyFor({});
  assertEquals(body.setDeliveryModel, false);
  assertEquals(body.deliveryModel, null);
});

Deno.test("D8: explicit null deliveryModel -> setDeliveryModel true + null", async () => {
  const body = await writerBodyFor({ deliveryModel: null });
  assertEquals(body.setDeliveryModel, true);
  assertEquals(body.deliveryModel, null);
});

Deno.test("D9: omitted name/priority -> flags false; supplied -> flags true", async () => {
  const omitted = await writerBodyFor({});
  assertEquals(omitted.setName, false);
  assertEquals(omitted.name, null);
  assertEquals(omitted.setPriority, false);
  assertEquals(omitted.priority, null);

  const supplied = await writerBodyFor({ name: " Renamed ", priority: "high" });
  assertEquals(supplied.setName, true);
  assertEquals(supplied.name, "Renamed");
  assertEquals(supplied.setPriority, true);
  assertEquals(supplied.priority, "high");
});

Deno.test("D10: set* flags are never manufactured in this module", () => {
  assertFalse(/set[A-Z][A-Za-z]*\s*[:=]/.test(executableSource));
});

// -----------------------------------------------------------------------------
// E. Canonical idempotency
// -----------------------------------------------------------------------------

Deno.test("E1: payload hash equals canonical Project-update payload hash", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  await executor({ ...baseArgs, description: "Scope" } as any);
  const context = recorder.writerCalls[0].context;

  const expectedHash = await hashCanonicalPayload(
    buildApiV1UpdateProjectIdempotencyPayload(
      PROJECT_ID,
      parseApiV1UpdateProjectBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        description: "Scope",
      }),
    ),
  );
  assertEquals(context.payloadHash, expectedHash);
  assertEquals(context.idempotencyKey, baseArgs.idempotencyKey);
});

Deno.test("E2: identity is part of the hash (different Project -> different hash)", async () => {
  const other = "66666666-6666-4666-8666-666666666666";
  const a = await hashCanonicalPayload(
    buildApiV1UpdateProjectIdempotencyPayload(
      PROJECT_ID,
      parseApiV1UpdateProjectBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
      }),
    ),
  );
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  await executor({ ...baseArgs, projectId: other } as any);
  assertNotEquals(recorder.writerCalls[0].context.payloadHash, a);
});

Deno.test("E3: omitted field and explicit clear produce different hashes", async () => {
  const omitted = buildHarness();
  // deno-lint-ignore no-explicit-any
  await omitted.executor({ ...baseArgs } as any);
  const cleared = buildHarness();
  // deno-lint-ignore no-explicit-any
  await cleared.executor({ ...baseArgs, description: null } as any);
  assertNotEquals(
    omitted.recorder.writerCalls[0].context.payloadHash,
    cleared.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("E4: changing idempotencyKey alone does not change the payload hash", async () => {
  const one = buildHarness();
  // deno-lint-ignore no-explicit-any
  await one.executor({ ...baseArgs } as any);
  const two = buildHarness();
  // deno-lint-ignore no-explicit-any
  await two.executor({ ...baseArgs, idempotencyKey: "another-key" } as any);
  assertEquals(
    one.recorder.writerCalls[0].context.payloadHash,
    two.recorder.writerCalls[0].context.payloadHash,
  );
  assertEquals(two.recorder.writerCalls[0].context.idempotencyKey, "another-key");
});

Deno.test("E5: confirmation is absent from the hash input and the writer body", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  await executor({ ...baseArgs } as any);
  const body = recorder.writerCalls[0].body;
  assertFalse(Object.prototype.hasOwnProperty.call(body, "confirmation"));
  assertFalse(Object.prototype.hasOwnProperty.call(body, "idempotencyKey"));

  const expectedHash = await hashCanonicalPayload(
    buildApiV1UpdateProjectIdempotencyPayload(
      PROJECT_ID,
      parseApiV1UpdateProjectBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
      }),
    ),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);
});

Deno.test("E6: invalid idempotency key -> invalid_arguments, no writer", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs, idempotencyKey: "  " } as any);
  assertFalse(result.ok);
  assertEquals(result.ok === false && result.category, "invalid_arguments");
  assertEquals(recorder.writerCalls.length, 0);
});

Deno.test("E7: malformed trusted execution context fails boundedly", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    execution: { ...trustedExecution, sourceChannel: "external_api" },
  });
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs } as any);
  assertFalse(result.ok);
  assertEquals(result.ok === false && result.category, "unavailable");
  assertEquals(recorder.writerCalls.length, 0);
});

// -----------------------------------------------------------------------------
// F. Rate limiting
// -----------------------------------------------------------------------------

Deno.test("F1: canonical route id and trusted identity are used", async () => {
  const { executor, recorder } = buildHarness();
  // deno-lint-ignore no-explicit-any
  await executor({ ...baseArgs } as any);
  assertEquals(PROJECT_UPDATE_ROUTE.id, "projects.update");
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: "projects.update",
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  assertEquals(recorder.consumeCalls[0].apiClientId, API_CLIENT_ID);
  assertEquals(recorder.consumeCalls[0].userId, USER_ID);
  assertEquals(recorder.consumeCalls[0].routeId, "projects.update");
});

Deno.test("F2: rate-limit rejection skips the writer", async () => {
  const { ApiHttpError } = await import(
    "../../functions/_shared/btpm-api/http.ts"
  );
  const { executor, recorder } = buildHarness(successResult, {
    rateLimitThrows: new ApiHttpError("rate_limit_exceeded"),
  });
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs } as any);
  assertFalse(result.ok);
  assertEquals(result.ok === false && result.category, "rate_limited");
  assertEquals(recorder.writerCalls.length, 0);
});

// -----------------------------------------------------------------------------
// G. Writer
// -----------------------------------------------------------------------------

Deno.test("G1: writer receives request, canonical id, canonical body, context — once", async () => {
  const { executor, recorder, request } = buildHarness();
  // deno-lint-ignore no-explicit-any
  await executor({ ...baseArgs, goals: "Go live" } as any);
  assertEquals(recorder.writerCalls.length, 1);
  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(call.projectId, PROJECT_ID);
  assertEquals(call.body.setGoals, true);
  assertEquals(call.body.goals, "Go live");
  assertEquals(call.body.setCharter, false);
  assertEquals(call.context.executingUserId, USER_ID);
  assertEquals(call.context.apiClientId, API_CLIENT_ID);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
});

Deno.test("G2: writer failure is bounded and never retried", async () => {
  const { executor, recorder } = buildHarness(successResult, {
    writerThrows: new Error("db exploded: SQLSTATE 42501 at api_e_private"),
  });
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs } as any);
  assertFalse(result.ok);
  assertEquals(result.ok === false && result.category, "unavailable");
  assertEquals(recorder.writerCalls.length, 1);
});

// -----------------------------------------------------------------------------
// H. Concurrency
// -----------------------------------------------------------------------------

Deno.test("H1: expectedUpdatedAt reaches the writer unchanged", async () => {
  const body = await writerBodyFor({});
  assertEquals(body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
});

Deno.test("H2: stale conflict maps to stale_project without timestamp disclosure", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "conflict",
    code: "stale_project",
  });
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs } as any);
  assertFalse(result.ok);
  assertEquals(result.ok === false && result.category, "stale_project");
  assertEquals(recorder.writerCalls.length, 1);
  const message = MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES.stale_project;
  assert(message.includes("Read the current Project"));
  assert(message.includes("new idempotency key"));
  assertFalse(message.includes(EXPECTED_UPDATED_AT));
  assertFalse(message.includes(NEW_UPDATED_AT));
});

Deno.test("H3: no read-before-write and no retry construct exists", () => {
  for (
    const forbidden of [
      "setTimeout",
      "setInterval",
      "readProject",
      "currentUpdatedAt",
    ]
  ) {
    assertFalse(executableSource.includes(forbidden), forbidden);
  }
});

// -----------------------------------------------------------------------------
// I. Bounded output/errors
// -----------------------------------------------------------------------------

Deno.test("I1: success payload exposes only outcome/projectId/updatedAt", async () => {
  const { executor } = buildHarness();
  // deno-lint-ignore no-explicit-any
  const result = await executor({ ...baseArgs, name: "Renamed" } as any);
  assert(result.ok);
  assertEquals(Object.keys(result.payload), [
    "outcome",
    "projectId",
    "updatedAt",
  ]);
  assertEquals(result.payload.outcome, "applied");
  assertEquals(result.payload.projectId, PROJECT_ID);
  assertEquals(result.payload.updatedAt, NEW_UPDATED_AT);
});

Deno.test("I2: exactly the eight bounded error categories", () => {
  assertEquals(Object.keys(MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES), [
    "confirmation_required",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "idempotency_conflict",
    "idempotency_pending",
    "stale_project",
    "unavailable",
  ]);
});

Deno.test("I3: negative writer outcomes map to bounded categories", async () => {
  const cases: Array<[string, McpProjectUpdateToolErrorCategory]> = [
    ["invalid", "invalid_arguments"],
    ["not_authorized", "not_authorized"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["idempotency_pending", "idempotency_pending"],
  ];
  for (const [outcome, category] of cases) {
    const { executor } = buildHarness({ ok: false, outcome });
    // deno-lint-ignore no-explicit-any
    const result = await executor({ ...baseArgs } as any);
    assertFalse(result.ok);
    assertEquals(result.ok === false && result.category, category);
  }
});

Deno.test("I4: no message leaks SQL, tokens, identities or internal names", () => {
  const forbidden = [
    "select",
    "insert into",
    "sqlstate",
    "bearer",
    "token",
    "oauth",
    "client_id",
    "rpc",
    "api_e_private",
    "mcp_v1_update_project",
    "apply_project_update",
    "narrative",
    "service_role",
  ];
  for (const message of Object.values(MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES)) {
    const lower = message.toLowerCase();
    for (const needle of forbidden) {
      assertFalse(lower.includes(needle), `${needle} in "${message}"`);
    }
  }
});

// -----------------------------------------------------------------------------
// J. Static ownership boundaries
// -----------------------------------------------------------------------------

Deno.test("J1: no Supabase/database/service-role/enablement/encryption surface", () => {
  for (
    const forbidden of [
      "createClient",
      ".rpc(",
      ".from(",
      "Deno.env",
      "SERVICE_ROLE",
      "service_role",
      "serviceRole",
      "api_project_client_enablements",
      "authorize_and_establish",
      "auto_enable",
      "autoEnable",
      "encrypt",
      "decrypt",
      "pgp_sym",
      "console.log",
      "console.error",
      "claimIdempotency",
      "completeIdempotency",
      "failIdempotency",
      "registerTool",
      "toolRegistry",
    ]
  ) {
    assertFalse(executableSource.includes(forbidden), forbidden);
  }
});

Deno.test("J2: the Step-2 writer is the only mutation path referenced", () => {
  assertEquals(executableSource.split("dependencies.writer(").length - 1, 1);
  assertFalse(executableSource.includes("updateMcpV1Project("));
  assertFalse(executableSource.includes("updateApiV1Project("));
});
