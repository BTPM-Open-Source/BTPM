// API-Q Program Update Step 3 — focused guard for the Program-update MCP
// mutation-control composition. Behavioural (in-process fakes) + static source
// guards. No network, no database, no Edge invocation, no service-role key.
//
// Scope: control/composition only. Exposure and runtime wiring are Step 4.

import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMcpProgramUpdateToolExecutor,
  MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES,
  MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_PROGRAM_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/programUpdateMutationTool.ts";
import { hashCanonicalPayload } from "../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildApiV1UpdateProgramIdempotencyPayload,
  parseApiV1UpdateProgramBody,
  PROGRAM_UPDATE_ROUTE,
} from "../../functions/_shared/btpm-api/routes/programs.ts";
import { MCP_TOOL_REGISTRY } from "../../functions/btpm-mcp/mcp/toolRegistry.ts";

const TOOL_URL = new URL(
  "../../functions/btpm-mcp/mcp/programUpdateMutationTool.ts",
  import.meta.url,
);
const toolSource = await Deno.readTextFile(TOOL_URL);

/** Executable production code only: line and block comments removed. */
const executableSource = toolSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const PROGRAM_ID = "55555555-5555-4555-8555-555555555555";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const API_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const EXPECTED_UPDATED_AT = "2026-08-17T07:00:00.000Z";

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
  programId: PROGRAM_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  confirmation: true,
  idempotencyKey: "idem-key-program-update",
});

const successResult = Object.freeze({
  ok: true,
  outcome: "applied",
  programId: PROGRAM_ID,
  updatedAt: "2026-08-17T07:30:00.000Z",
});

interface Recorder {
  readonly profileCalls: Array<{ clientId: string; routeId: string }>;
  // deno-lint-ignore no-explicit-any
  readonly consumeCalls: any[];
  readonly writerCalls: Array<{
    request: Request;
    programId: string;
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

  const executor = createMcpProgramUpdateToolExecutor({
    request,
    execution: trustedExecution,
    writer: (async (
      req: Request,
      programId: string,
      // deno-lint-ignore no-explicit-any
      body: any,
      // deno-lint-ignore no-explicit-any
      context: any,
    ) => {
      recorder.order.push("writer");
      recorder.writerCalls.push({ request: req, programId, body, context });
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
// A. Exact transport schema
// ---------------------------------------------------------------------------

Deno.test("A1: tool name and the exact seven argument names", () => {
  assertEquals(MCP_PROGRAM_UPDATE_TOOL_NAME, "btpm_update_program");
  assertEquals([...MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES], [
    "programId",
    "expectedUpdatedAt",
    "name",
    "status",
    "description",
    "confirmation",
    "idempotencyKey",
  ]);
  assertEquals(MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES.length, 7);
  assertEquals(
    Object.keys(MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.shape).sort(),
    [...MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES].sort(),
  );
  assertEquals(Object.isFrozen(MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES), true);
  assertFalse(
    MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES.includes("setDescription"),
  );
});

Deno.test("A2: the schema is strict and rejects unknown / provenance fields", () => {
  assert(MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse(validArgs).success);
  for (
    const key of [
      "setDescription",
      "workspaceId",
      "organizationId",
      "tenantId",
      "userId",
      "actor",
      "apiClientId",
      "oauthClientId",
      "sourceChannel",
      "requestId",
      "correlationId",
      "payloadHash",
      "updatedAt",
      "currentUpdatedAt",
      "current_updated_at",
      "archivedAt",
      "projectId",
      "targetStatus",
      "operationId",
      "functionName",
      "extra",
    ]
  ) {
    assertFalse(
      MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
        ...validArgs,
        [key]: "x",
      }).success,
      `unknown key accepted: ${key}`,
    );
  }
});

Deno.test("A3: required, optional, nullable argument shape", () => {
  for (
    const key of [
      "programId",
      "expectedUpdatedAt",
      "confirmation",
      "idempotencyKey",
    ]
  ) {
    const args: Record<string, unknown> = { ...validArgs };
    delete args[key];
    assertFalse(
      MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse(args).success,
      `missing required key accepted: ${key}`,
    );
  }

  // name: optional, NOT nullable.
  assert(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      name: "Finance Transformation",
    }).success,
  );
  assertFalse(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      name: null,
    }).success,
  );

  // status: optional enum, NOT nullable.
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    assert(
      MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({ ...validArgs, status })
        .success,
      `status rejected: ${status}`,
    );
  }
  assertFalse(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      status: null,
    }).success,
  );
  assertFalse(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      status: "archived",
    }).success,
  );

  // description: optional AND nullable.
  assert(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      description: null,
    }).success,
  );
  assert(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      description: "Group finance program",
    }).success,
  );
  assertFalse(
    MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.safeParse({
      ...validArgs,
      description: 5,
    }).success,
  );
});

// ---------------------------------------------------------------------------
// B. Confirmation
// ---------------------------------------------------------------------------

Deno.test("B1: only literal true is accepted, before context/rate limit/writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, confirmation: false });
  assert(!result.ok);
  assertEquals(result.category, "confirmation_required");
  assertEquals(recorder.order.length, 0);
  assertEquals(recorder.profileCalls.length, 0);
  assertEquals(recorder.consumeCalls.length, 0);
  assertEquals(recorder.writerCalls.length, 0);

  for (const confirmation of [undefined, null, "true", 1, 0]) {
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

Deno.test("B2: confirmation never enters the business body, hash payload or writer", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, description: "d" });
  assert(result.ok);
  const call = recorder.writerCalls[0];
  assertFalse(Object.prototype.hasOwnProperty.call(call.body, "confirmation"));
  assertFalse(
    Object.prototype.hasOwnProperty.call(call.context, "confirmation"),
  );
  assertFalse(JSON.stringify(call.body).includes("confirmation"));
});

// ---------------------------------------------------------------------------
// C. Canonical Program identity
// ---------------------------------------------------------------------------

Deno.test("C1: canonical Program path parser is reused, no Program read", async () => {
  assert(executableSource.includes("parseApiV1ProgramUpdatePath("));
  assert(executableSource.includes('"/v1/programs/"'));
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls[0].programId, PROGRAM_ID);
});

Deno.test("C2: malformed, nil and path-injection Program identities fail bounded", async () => {
  for (
    const programId of [
      "not-a-uuid",
      NIL_UUID,
      `${PROGRAM_ID}/extra`,
      `${PROGRAM_ID}?x=1`,
      `../projects/${PROGRAM_ID}`,
      "",
      " ",
    ]
  ) {
    const { executor, recorder } = buildHarness();
    const result = await executor({ ...validArgs, programId });
    assert(!result.ok, `accepted invalid programId: ${programId}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// D. Presence semantics
// ---------------------------------------------------------------------------

Deno.test("D1: omitted description yields canonical setDescription false", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor(validArgs);
  assert(result.ok);
  assertEquals(recorder.writerCalls[0].body.setDescription, false);
  assertEquals(recorder.writerCalls[0].body.description, null);
});

Deno.test("D2: explicit null description yields setDescription true + null", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, description: null });
  assert(result.ok);
  assertEquals(recorder.writerCalls[0].body.setDescription, true);
  assertEquals(recorder.writerCalls[0].body.description, null);
});

Deno.test("D3: supplied description yields setDescription true with canonical text", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, description: "  Scope  " });
  assert(result.ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(body.setDescription, true);
  assertEquals(
    body.description,
    parseApiV1UpdateProgramBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      description: "  Scope  ",
    }).description,
  );
});

Deno.test("D4: omitted optional name/status stay absent; supplied values reach the parser", async () => {
  const omitted = buildHarness();
  const omittedResult = await omitted.executor(validArgs);
  assert(omittedResult.ok);
  assertEquals(omitted.recorder.writerCalls[0].body.name, null);
  assertEquals(omitted.recorder.writerCalls[0].body.status, null);

  const supplied = buildHarness();
  const suppliedResult = await supplied.executor({
    ...validArgs,
    name: "Finance",
    status: "active",
  });
  assert(suppliedResult.ok);
  assertEquals(supplied.recorder.writerCalls[0].body.name, "Finance");
  assertEquals(supplied.recorder.writerCalls[0].body.status, "active");
});

Deno.test("D5: setDescription is never manufactured in production source", () => {
  assertFalse(/setDescription\s*[:=]/.test(executableSource));
  assertFalse(executableSource.includes("setDescription:"));
});

// ---------------------------------------------------------------------------
// E. Canonical validation authority
// ---------------------------------------------------------------------------

Deno.test("E1: exactly one canonical Program body parse call exists", () => {
  assertEquals(
    executableSource.split("parseApiV1UpdateProgramBody(").length - 1,
    1, // exactly one production call (the import binding carries no parenthesis)
  );
  assertEquals(
    executableSource.split("const canonicalBody =").length - 1,
    1,
  );
});

Deno.test("E2: canonical parser normalization remains authoritative", async () => {
  const { executor, recorder } = buildHarness();
  const result = await executor({
    ...validArgs,
    name: "   Finance   Transformation   ",
    description: "  keep  ",
  });
  assert(result.ok);
  assertEquals(
    recorder.writerCalls[0].body,
    parseApiV1UpdateProgramBody({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      name: "   Finance   Transformation   ",
      description: "  keep  ",
    }),
  );
});

Deno.test("E3: canonical rejection of invalid status and timestamp is bounded", async () => {
  const statusHarness = buildHarness();
  // deno-lint-ignore no-explicit-any
  const statusResult = await statusHarness.executor(
    { ...validArgs, status: "done" } as any,
  );
  assert(!statusResult.ok);
  assertEquals(statusResult.category, "invalid_arguments");
  assertEquals(statusHarness.recorder.writerCalls.length, 0);

  for (const expectedUpdatedAt of ["not-a-date", "2026-13-01T00:00:00Z", ""]) {
    const harness = buildHarness();
    const result = await harness.executor({ ...validArgs, expectedUpdatedAt });
    assert(!result.ok, `accepted invalid timestamp: ${expectedUpdatedAt}`);
    assertEquals(result.category, "invalid_arguments");
    assertEquals(harness.recorder.writerCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// F. Canonical idempotency payload / hash
// ---------------------------------------------------------------------------

Deno.test("F1: the canonical Program-update idempotency builder and MCP context are used", async () => {
  assert(
    executableSource.includes("buildApiV1UpdateProgramIdempotencyPayload("),
  );
  assert(executableSource.includes("buildMcpMutationExecutionContext("));
  assertFalse(executableSource.includes("hashCanonicalPayload"));

  const { executor, recorder } = buildHarness();
  const result = await executor({ ...validArgs, description: "d" });
  assert(result.ok);
  const expectedHash = await hashCanonicalPayload(
    buildApiV1UpdateProgramIdempotencyPayload(
      PROGRAM_ID,
      parseApiV1UpdateProgramBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        description: "d",
      }),
    ),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);
  assertEquals(
    recorder.writerCalls[0].context.idempotencyKey,
    validArgs.idempotencyKey,
  );
  assertEquals(recorder.writerCalls[0].context.sourceChannel, "mcp");
});

Deno.test("F2: absent description and explicit clear hash differently", async () => {
  const absent = buildHarness();
  assert((await absent.executor(validArgs)).ok);
  const cleared = buildHarness();
  assert((await cleared.executor({ ...validArgs, description: null })).ok);
  assertNotEquals(
    absent.recorder.writerCalls[0].context.payloadHash,
    cleared.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("F3: canonically equivalent text hashes equally", async () => {
  const a = buildHarness();
  assert((await a.executor({ ...validArgs, name: "Finance" })).ok);
  const b = buildHarness();
  assert((await b.executor({ ...validArgs, name: "  Finance  " })).ok);
  assertEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("F4: idempotencyKey and confirmation do not affect payloadHash", async () => {
  const a = buildHarness();
  assert((await a.executor(validArgs)).ok);
  const b = buildHarness();
  assert(
    (await b.executor({ ...validArgs, idempotencyKey: "another-key" })).ok,
  );
  assertEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

Deno.test("F5: a materially different business value changes the payloadHash", async () => {
  const a = buildHarness();
  assert((await a.executor({ ...validArgs, status: "active" })).ok);
  const b = buildHarness();
  assert((await b.executor({ ...validArgs, status: "on_hold" })).ok);
  assertNotEquals(
    a.recorder.writerCalls[0].context.payloadHash,
    b.recorder.writerCalls[0].context.payloadHash,
  );
});

// ---------------------------------------------------------------------------
// G. Rate limit
// ---------------------------------------------------------------------------

Deno.test("G1: canonical rate-limit resolution and enforcement identity", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(recorder.profileCalls, [{
    clientId: API_CLIENT_ID,
    routeId: PROGRAM_UPDATE_ROUTE.id,
  }]);
  assertEquals(recorder.consumeCalls.length, 1);
  const consumed = recorder.consumeCalls[0];
  const identity = consumed.identity ?? consumed;
  assertEquals(
    JSON.stringify(identity).includes(API_CLIENT_ID),
    true,
  );
  assertEquals(JSON.stringify(identity).includes(USER_ID), true);
  assertEquals(
    JSON.stringify(identity).includes(PROGRAM_UPDATE_ROUTE.id),
    true,
  );
  assertEquals(PROGRAM_UPDATE_ROUTE.id, "programs.update");
  assertEquals(recorder.order, ["profile", "rate_limit", "writer"]);
});

Deno.test("G2: the writer is not called when the rate limit rejects", async () => {
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
// H. Writer invocation
// ---------------------------------------------------------------------------

Deno.test("H1: exactly one writer call with request, canonical id, body and context", async () => {
  const { executor, recorder, request } = buildHarness();
  assert((await executor(validArgs)).ok);
  assertEquals(recorder.writerCalls.length, 1);
  const call = recorder.writerCalls[0];
  assertEquals(call.request, request);
  assertEquals(call.programId, PROGRAM_ID);
  assertEquals(Object.keys(call.body).sort(), [
    "description",
    "expectedUpdatedAt",
    "name",
    "setDescription",
    "status",
  ]);
  assertEquals(call.context.sourceChannel, "mcp");
  assertEquals(call.context.delegationMode, "delegated_user");
});

Deno.test("H2: Step-3 control never calls the RPC adapter directly and never retries", () => {
  assertFalse(executableSource.includes("updateMcpV1Program"));
  assertFalse(executableSource.includes("updateApiV1Program"));
  // No retry construct: the only occurrences of "retry" in production source
  // are the bounded caller-facing messages, never control flow.
  assertFalse(/\bwhile\s*\(|\bfor\s*\(;|attempt|maxRetries/.test(executableSource));
  assertEquals(executableSource.split("dependencies.writer(").length - 1, 1);
});

// ---------------------------------------------------------------------------
// I. Success mapping
// ---------------------------------------------------------------------------

Deno.test("I1: applied / no_change / replayed map to the bounded payload only", async () => {
  for (const outcome of ["applied", "no_change", "replayed"]) {
    const { executor } = buildHarness({
      ok: true,
      outcome,
      programId: PROGRAM_ID,
      updatedAt: "2026-08-17T07:30:00.000Z",
      // Extra database fields must never escape.
      name: "Finance",
      status: "active",
      description: "secret narrative",
      setDescription: true,
      workspaceId: "w",
      currentUpdatedAt: "2026-08-17T09:00:00.000Z",
    });
    const result = await executor(validArgs);
    assert(result.ok);
    assertEquals(Object.keys(result.payload).sort(), [
      "outcome",
      "programId",
      "updatedAt",
    ]);
    assertEquals(result.payload.outcome, outcome);
    assertEquals(result.payload.programId, PROGRAM_ID);
    assertEquals(result.payload.updatedAt, "2026-08-17T07:30:00.000Z");
    const serialized = JSON.stringify(result);
    assertFalse(serialized.includes("secret narrative"));
    assertFalse(serialized.includes("currentUpdatedAt"));
  }
});

// ---------------------------------------------------------------------------
// J. Negative mapping
// ---------------------------------------------------------------------------

Deno.test("J1: canonical negative outcomes map correctly", async () => {
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

Deno.test("J2: ApiHttpError maps to bounded categories", async () => {
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

Deno.test("J3: a malformed trusted MCP context maps to unavailable", async () => {
  const executor = createMcpProgramUpdateToolExecutor({
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

Deno.test("J4: unexpected failures map to unavailable and disclose nothing", async () => {
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

Deno.test("J5: exactly the approved eight categories and bounded messages", () => {
  assertEquals(Object.keys(MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES).sort(), [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "stale_program",
    "unavailable",
  ]);
  assertEquals(MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES, {
    confirmation_required:
      "Explicit confirmation is required for this mutation.",
    invalid_arguments: "Invalid arguments.",
    not_authorized: "Not authorized to update this Program.",
    rate_limited: "Rate limit exceeded. Try again later.",
    idempotency_conflict:
      "This idempotency key was already used with a different request.",
    idempotency_pending:
      "An identical request is still in progress. Retry shortly.",
    stale_program:
      "This Program has changed since the supplied expectedUpdatedAt. Read the current Program and retry intentionally with a fresh updatedAt and a new idempotency key.",
    unavailable: "BTPM Program update is temporarily unavailable.",
  });
  for (const message of Object.values(MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES)) {
    assertFalse(/SQLSTATE|mcp_v1_|apply_program_update|token/.test(message));
  }
});

// ---------------------------------------------------------------------------
// K. Concurrency
// ---------------------------------------------------------------------------

Deno.test("K1: expectedUpdatedAt passes through unchanged into body and hash", async () => {
  const { executor, recorder } = buildHarness();
  assert((await executor(validArgs)).ok);
  const body = recorder.writerCalls[0].body;
  assertEquals(body.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  const expectedHash = await hashCanonicalPayload(
    buildApiV1UpdateProgramIdempotencyPayload(
      PROGRAM_ID,
      parseApiV1UpdateProgramBody({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
      }),
    ),
  );
  assertEquals(recorder.writerCalls[0].context.payloadHash, expectedHash);
  assertFalse(executableSource.includes("Date.now"));
  assertFalse(executableSource.includes("new Date"));
  assertFalse(executableSource.includes("currentUpdatedAt"));
  assertFalse(executableSource.includes("current_updated_at"));
});

Deno.test("K2: a stale conflict is bounded, not retried, and hides the current timestamp", async () => {
  const { executor, recorder } = buildHarness({
    ok: false,
    outcome: "conflict",
    code: "stale_program",
    currentUpdatedAt: "2026-08-17T09:00:00.000Z",
  });
  const result = await executor(validArgs);
  assert(!result.ok);
  assertEquals(result.category, "stale_program");
  assertEquals(recorder.writerCalls.length, 1);
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("2026-08-17T09:00:00.000Z"));
  assertFalse(serialized.includes("currentUpdatedAt"));
});

// ---------------------------------------------------------------------------
// L. Forbidden production surfaces
// ---------------------------------------------------------------------------

Deno.test("L1: no database, service-role, env, fetch, retry, logging or registry code exists", () => {
  for (
    const forbidden of [
      "Deno.env",
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRole",
      "service_role",
      ".from(",
      ".rpc(",
      "fetch(",
      "console.",
      "setTimeout",
      "setInterval",
      "cache",
      "select ",
      "SELECT ",
      "apply_program_update",
      "mcp_v1_update_program",
      "api_v1_update_program",
      "api_e_private",
      "api_project_client_enablements",
      "authorize_and_establish",
      "authorize_and_establish_mcp",
      "claimIdempotency",
      "completeIdempotency",
      "failIdempotency",
      "btpm_encrypt",
      "btpm_decrypt",
      "registerTool",
      "toolRegistry",
      "serverFactory",
      "Deno.serve",
      "dispatch",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

Deno.test("L2: no Program/Workspace/Organization business table access or scope derivation", () => {
  for (
    const forbidden of [
      "programs\"",
      "workspaces",
      "organizations",
      "tenantId",
      "organizationId",
      "workspaceId",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `unexpected reference to ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// M. Exposure
// ---------------------------------------------------------------------------

// Step 4 intentionally superseded the temporary `not_exposed` assertion here.
// Exposure ownership belongs solely to the Step-4 exposure test.
Deno.test("M1: programs.update maps to the Step-3 control tool name", () => {
  const entry = MCP_TOOL_REGISTRY.find((e) =>
    e.operationId === "programs.update"
  );
  assert(entry, "programs.update registry entry missing");
  assertEquals(entry.toolName, MCP_PROGRAM_UPDATE_TOOL_NAME);
});
