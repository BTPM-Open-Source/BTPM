// MCP-HARDENING-C4 — focused guard for the Task Transition completed-Task /
// reopen contract correction.
//
// Behavioural (in-process injected fakes) + static source guards over the new
// forward migration. No network, no database, no Edge invocation, no
// service-role key, no Task mutation.

import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  transitionApiV1Task,
  transitionMcpV1Task,
} from "../../../functions/_shared/btpm-api/supabaseTask.ts";
import {
  createMcpTaskTransitionToolExecutor,
  MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA,
} from "../../../functions/btpm-mcp/mcp/taskTransitionMutationTool.ts";
import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const MIGRATION_URL = new URL(
  "../../../migrations/20260823090235_604e0af0-9155-4549-be22-ae437629191d.sql",
  import.meta.url,
);
const migrationSql = await Deno.readTextFile(MIGRATION_URL);

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const PAYLOAD_HASH = "b".repeat(64);
const EXPECTED_UPDATED_AT = "2026-08-16T10:00:00.000Z";

// ---------------------------------------------------------------------------
// A. Database migration static guard
// ---------------------------------------------------------------------------

Deno.test("A1: migration is forward-only and drops nothing", () => {
  assertFalse(/\bDROP\s+FUNCTION\b/i.test(migrationSql));
  assertFalse(/\bDROP\s+TABLE\b/i.test(migrationSql));
  assertFalse(/\bDROP\s+TRIGGER\b/i.test(migrationSql));
  assertFalse(/\bDELETE\s+FROM\b/i.test(migrationSql));
  assertFalse(/\bALTER\s+TABLE\b/i.test(migrationSql));
});

Deno.test("A2: migration redefines only the two Task Transition execution functions", () => {
  const defined = [...migrationSql.matchAll(
    /CREATE OR REPLACE FUNCTION\s+([a-z_]+\.[a-z0-9_]+)\s*\(/gi,
  )].map((m) => m[1]);
  assertEquals(defined.sort(), [
    "api_e_private.execute_v1_transition_task",
    "public.apply_task_execution_change",
  ]);
});

Deno.test("A3/A4: the completed-lock trigger and reopen_task are NOT redefined", () => {
  // Executable SQL only: comments may reference them descriptively.
  const sql = migrationSql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
  assertFalse(/tg_tasks_actual_and_lock/i.test(sql));
  assertFalse(/FUNCTION\s+public\.reopen_task/i.test(sql));
  assertFalse(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i.test(sql));
});


Deno.test("A5/A6: only the canonical completed-Task family becomes task_reopen_required", () => {
  assertStringIncludes(
    migrationSql,
    "IF SQLERRM LIKE 'Task is completed; reopen required to change%' THEN",
  );
  assertStringIncludes(migrationSql, "v_failure_reason := 'task_reopen_required';");
  // Every other trigger-owned validation keeps its existing SQLERRM reason.
  assertStringIncludes(migrationSql, "v_failure_reason := SQLERRM;");
  assertStringIncludes(
    migrationSql,
    "jsonb_build_object('reason', v_failure_reason)",
  );
});

Deno.test("A7/A8: only that reason maps to the bounded coded invalid result and fails idempotency", () => {
  assertStringIncludes(
    migrationSql,
    "IF (v_data ->> 'reason') = 'task_reopen_required' THEN",
  );
  assertStringIncludes(
    migrationSql,
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'task_reopen_required');",
  );
  assertStringIncludes(
    migrationSql,
    "RETURN jsonb_build_object('ok', false, 'outcome', 'invalid', 'code', 'task_reopen_required');",
  );
});

Deno.test("A9: failed replay returns the same bounded result", () => {
  assertStringIncludes(
    migrationSql,
    "ELSIF v_claim.failure_code = 'task_reopen_required' THEN",
  );
  // Never turned into success or replayed.
  assertFalse(
    /failure_code = 'task_reopen_required'[\s\S]{0,400}'outcome',\s*'replayed'/
      .test(migrationSql),
  );
});

Deno.test("A10/A11: generic invalid and stale_task handling are preserved", () => {
  assertStringIncludes(
    migrationSql,
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'invalid');",
  );
  assertStringIncludes(
    migrationSql,
    "RETURN jsonb_build_object('ok', false, 'outcome', 'invalid');",
  );
  assertStringIncludes(
    migrationSql,
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task');",
  );
  assertStringIncludes(
    migrationSql,
    "IF (v_data ->> 'code') IS DISTINCT FROM 'stale_task' THEN",
  );
});

Deno.test("A12: no new grant and no PUBLIC or anon execution surface", () => {
  assertFalse(/GRANT[^;]*TO\s+PUBLIC/i.test(migrationSql));
  assertFalse(/GRANT[^;]*TO\s+anon/i.test(migrationSql));
  const grants = [...migrationSql.matchAll(/GRANT EXECUTE ON FUNCTION\s+([^\s(]+)/gi)]
    .map((m) => m[1]);
  assertEquals(new Set(grants).size, 1);
  assertEquals(grants[0], "public.apply_task_execution_change");
  assertStringIncludes(
    migrationSql,
    "REVOKE ALL ON FUNCTION api_e_private.execute_v1_transition_task",
  );
  // Both functions keep SECURITY DEFINER with a pinned search_path.
  assertEquals(
    (migrationSql.match(/SECURITY DEFINER/g) ?? []).length,
    2,
  );
  assertEquals(
    (migrationSql.match(/SET search_path TO 'pg_catalog', 'public'/g) ?? [])
      .length,
    2,
  );
});

// ---------------------------------------------------------------------------
// B. Shared adapter
// ---------------------------------------------------------------------------

interface RpcCall {
  readonly name: string;
}

// deno-lint-ignore no-explicit-any
function client(data: any, calls: RpcCall[] = []) {
  return {
    rpc(name: string) {
      calls.push({ name });
      return Promise.resolve({ data, error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const adapterInput = Object.freeze({
  expectedOauthClientId: "btpm-mcp-client",
  taskId: TASK_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  setActualStart: true,
  actualStartDate: "2026-08-10",
  setActualEnd: false,
  actualEndDate: null,
  status: "active",
  requestId: "req-tt-c4",
  correlationId: "req-tt-c4",
  idempotencyKey: "idem-tt-c4",
  payloadHash: PAYLOAD_HASH,
});

Deno.test("B1: the exact bounded reopen-required result is accepted (REST and MCP)", async () => {
  const wire = { ok: false, outcome: "invalid", code: "task_reopen_required" };
  for (const invoke of [transitionApiV1Task, transitionMcpV1Task]) {
    const result = await invoke(client(wire), adapterInput);
    assertEquals(result, {
      ok: false,
      outcome: "invalid",
      code: "task_reopen_required",
    });
  }
});

Deno.test("B2: arbitrary invalid codes are rejected", async () => {
  await assertRejects(() =>
    transitionApiV1Task(
      client({ ok: false, outcome: "invalid", code: "reopen_needed" }),
      adapterInput,
    )
  );
  await assertRejects(() =>
    transitionApiV1Task(
      client({ ok: false, outcome: "invalid", code: "Task is completed" }),
      adapterInput,
    )
  );
});

Deno.test("B3: extra fields on the special result are rejected", async () => {
  await assertRejects(() =>
    transitionApiV1Task(
      client({
        ok: false,
        outcome: "invalid",
        code: "task_reopen_required",
        reason: "Task is completed; reopen required to change status",
      }),
      adapterInput,
    )
  );
});

Deno.test("B4: generic invalid remains exactly ok/outcome", async () => {
  const result = await transitionApiV1Task(
    client({ ok: false, outcome: "invalid" }),
    adapterInput,
  );
  assertEquals(result, { ok: false, outcome: "invalid" });
});

Deno.test("B5: stale_task conflict remains unchanged", async () => {
  const result = await transitionApiV1Task(
    client({ ok: false, outcome: "conflict", code: "stale_task" }),
    adapterInput,
  );
  assertEquals(result, {
    ok: false,
    outcome: "conflict",
    code: "stale_task",
  });
});

Deno.test("B6: successful transition decoding remains unchanged", async () => {
  const calls: RpcCall[] = [];
  const result = await transitionApiV1Task(
    client({
      ok: true,
      outcome: "applied",
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      status: "active",
      actualStartDate: "2026-08-10",
      actualEndDate: null,
      updatedAt: "2026-08-16T11:00:00.000Z",
    }, calls),
    adapterInput,
  );
  assertEquals(result.ok, true);
  assertEquals(calls.map((c) => c.name), ["api_v1_transition_task"]);
});

// ---------------------------------------------------------------------------
// C. MCP control
// ---------------------------------------------------------------------------

const trustedExecution = Object.freeze({
  requestedUserId: "55555555-5555-4555-8555-555555555555",
  executingUserId: "55555555-5555-4555-8555-555555555555",
  apiClientId: "44444444-4444-4444-8444-444444444444",
  oauthClientId: "oauth-1",
  policyVersionId: "policy-1",
  requestId: "req-c4",
  correlationId: "req-c4",
  sourceChannel: "mcp" as const,
  sourceClientId: "44444444-4444-4444-8444-444444444444",
  delegationMode: "delegated_user" as const,
});

function toolArgs(overrides: Record<string, unknown> = {}) {
  return {
    taskId: TASK_ID,
    expectedUpdatedAt: "2026-01-15T10:20:30.123456Z",
    setActualStart: true,
    actualStartDate: "2026-01-10",
    setActualEnd: false,
    actualEndDate: null,
    status: "active",
    confirmation: true,
    idempotencyKey: "idem-key-c4",
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

// deno-lint-ignore no-explicit-any
function harness(writerResult: any) {
  const writerCalls: number[] = [];
  const executor = createMcpTaskTransitionToolExecutor({
    request: new Request("https://example.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer token-value" },
    }),
    execution: trustedExecution,
    writer: (() => {
      writerCalls.push(1);
      return Promise.resolve(writerResult);
      // deno-lint-ignore no-explicit-any
    }) as any,
    rateLimitProfileResolver: {
      resolve: () => Promise.resolve({ limit: 100, windowSeconds: 60 }),
      // deno-lint-ignore no-explicit-any
    } as any,
    rateLimitStore: {
      consume: () =>
        Promise.resolve({
          allowed: true,
          remaining: 99,
          resetAtEpochMs: 1_700_000_060_000,
        }),
      // deno-lint-ignore no-explicit-any
    } as any,
    now: () => 1_700_000_000_000,
  });
  return { executor, writerCalls };
}

Deno.test("C1: the special writer result maps to task_reopen_required", async () => {
  const { executor, writerCalls } = harness({
    ok: false,
    outcome: "invalid",
    code: "task_reopen_required",
  });
  assertEquals(await executor(toolArgs()), {
    ok: false,
    category: "task_reopen_required",
  });
  // C6: exactly one writer invocation. No retry and no read-before-write.
  assertEquals(writerCalls.length, 1);
});

Deno.test("C2: the exact actionable reopen message is registered", () => {
  assertEquals(
    MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES.task_reopen_required,
    "This Task is completed and must be reopened before its execution dates or status can be changed. Reopen the Task in BTPM, then read the Task again and retry intentionally with the current updatedAt and a new idempotency key.",
  );
});

Deno.test("C3: generic invalid still maps to invalid_arguments", async () => {
  const { executor } = harness({ ok: false, outcome: "invalid" });
  assertEquals(await executor(toolArgs()), {
    ok: false,
    category: "invalid_arguments",
  });
});

Deno.test("C4: stale_task remains stale_task", async () => {
  const { executor } = harness({
    ok: false,
    outcome: "conflict",
    code: "stale_task",
  });
  assertEquals(await executor(toolArgs()), {
    ok: false,
    category: "stale_task",
  });
});

Deno.test("C5: confirmation is still required before the writer runs", async () => {
  const { executor, writerCalls } = harness({
    ok: false,
    outcome: "invalid",
    code: "task_reopen_required",
  });
  assertEquals(await executor(toolArgs({ confirmation: false })), {
    ok: false,
    category: "confirmation_required",
  });
  assertEquals(writerCalls.length, 0);
});

// ---------------------------------------------------------------------------
// D. MCP advertised contract
// ---------------------------------------------------------------------------

const statusSchema = MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.shape.status;

Deno.test("D1-D4: status still accepts exactly active, completed and null", () => {
  assert(statusSchema.safeParse("active").success);
  assert(statusSchema.safeParse("completed").success);
  assert(statusSchema.safeParse(null).success);
  for (const rejected of ["planned", "on_hold", "cancelled", "reopened", ""]) {
    assertFalse(
      statusSchema.safeParse(rejected).success,
      `unsupported status accepted: ${rejected}`,
    );
  }
});

Deno.test("D5: the status description explains the completed/reopen boundary", () => {
  const described = statusSchema.description ?? "";
  assertStringIncludes(described, "active");
  assertStringIncludes(described, "completed");
  assertStringIncludes(described, "null means do not change the status");
  assertStringIncludes(described, "does NOT reopen");
  assertStringIncludes(described, "reopen flow");
});

Deno.test("D6-D8: tasks.transition registry description and single exposure", () => {
  const entries = MCP_TOOL_REGISTRY.filter((e) =>
    e.operationId === "tasks.transition"
  );
  assertEquals(entries.length, 1);
  const entry = entries[0];
  assertEquals(entry.exposure, "exposed");
  assertEquals(entry.confirmation, "required");
  assertEquals(entry.concurrencyToken, "required");
  assertStringIncludes(entry.description, "does not reopen completed Tasks");
  assertEquals(
    exposedMcpTools().filter((e) => e.operationId === "tasks.transition")
      .length,
    1,
  );
  // No reopen operation or tool is introduced anywhere in the registry.
  assertFalse(
    MCP_TOOL_REGISTRY.some((e) =>
      e.operationId.includes("reopen") || e.toolName.includes("reopen")
    ),
  );
});
