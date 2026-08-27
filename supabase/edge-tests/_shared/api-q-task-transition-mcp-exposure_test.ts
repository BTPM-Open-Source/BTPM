// API-Q Task Transition Step 4 — MCP exposure and runtime wiring proofs.
//
// Scope: exposure of the already-accepted canonical `tasks.transition`
// capability as the MCP tool `btpm_transition_task`, plus wiring of the accepted
// Step 3 control layer and the accepted Step 2 caller-bound writer into the
// existing `btpm-mcp` runtime.
//
// No new capability, route, wrapper, provenance path, concurrency token or
// authority rule is introduced by this step.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_TASK_TRANSITION_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskTransitionMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const toolSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/taskTransitionMutationTool.ts",
    import.meta.url,
  ),
);


// MCP-HARDENING-C4 appended the bounded completed-Task lifecycle category.
const EXPECTED_ERROR_CATEGORIES = [
  "confirmation_required",
  "idempotency_conflict",
  "idempotency_pending",
  "invalid_arguments",
  "not_authorized",
  "rate_limited",
  "stale_task",
  "task_reopen_required",
  "unavailable",
];

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function transitionBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_TASK_TRANSITION_TOOL_NAME)",
  );
  assert(start > 0, "Task Transition registration branch must exist");
  return serverFactorySource.slice(start, start + 1400);
}

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: registry remains structurally valid with full coverage", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: tasks.transition is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "tasks.transition",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_transition_task");
  assertStrictEquals(entry.toolName, MCP_TASK_TRANSITION_TOOL_NAME);
  assertStrictEquals(entry.title, "Transition BTPM Task");
  assertStrictEquals(
    entry.description,
    "Transitions one Task lifecycle status through the canonical API mutation contract. This operation does not reopen completed Tasks: a completed Task is locked and must first be reopened through BTPM's dedicated reopen flow.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "required");
});

Deno.test("A3: tasks.transition is exposed exactly once", () => {
  const matches = MCP_TOOL_REGISTRY.filter(
    (candidate) => candidate.operationId === "tasks.transition",
  );
  assertStrictEquals(matches.length, 1);
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter(
      (candidate) => candidate.toolName === "btpm_transition_task",
    ).length,
    1,
  );
});


// MCP-HARDENING-C1B — ME-3 exposed `me.get` through its own accepted step;
// the intentional non-exposure decisions kept here are version/capabilities.
Deno.test("A6: version.get and capabilities.get remain not_exposed", () => {
  for (const operationId of ["version.get", "capabilities.get"]) {
    const entry = MCP_TOOL_REGISTRY.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert(entry !== undefined, `${operationId} missing`);
    assertStrictEquals(entry.exposure, "not_exposed");
  }
});

// -----------------------------------------------------------------------------
// B. Server factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: server factory imports only the Step 3 Task Transition control layer", () => {
  assert(serverFactorySource.includes("./taskTransitionMutationTool.ts"));
  assert(serverFactorySource.includes("MCP_TASK_TRANSITION_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA"));
  assert(
    serverFactorySource.includes("MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES"),
  );
  assertFalse(serverFactorySource.includes("taskTransitionMutationExecutor"));
  assertFalse(serverFactorySource.includes("createMcpV1TransitionTaskExecutor"));
  assertFalse(serverFactorySource.includes("transitionMcpV1Task"));
  assertFalse(serverFactorySource.includes("supabaseTask.ts"));
});

Deno.test("B2: exactly one taskTransition executor property and one registration branch", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly taskTransition: McpTaskTransitionToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_TASK_TRANSITION_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.taskTransition("),
    1,
  );
});

Deno.test("B3: the branch uses mutation annotations, the accepted schema and bounded messages", () => {
  const branch = transitionBranch();
  assert(branch.includes("inputSchema: MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(
    branch.includes("MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES[result.category]"),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

Deno.test("B4: no Supabase, RPC, service-role or dispatcher surface added to the factory", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "mcp_v1_transition_task",
      "api_v1_transition_task",
      "apply_task_execution_change",
      ".rpc(",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `server factory must not reference ${forbidden}`,
    );
  }
});

Deno.test("B5: the registration branch never manipulates concurrency or status", () => {
  const branch = transitionBranch();
  assertFalse(branch.includes("expectedUpdatedAt"));
  assertFalse(branch.includes("updatedAt"));
  assertFalse(branch.includes("stale"));
  assertFalse(branch.includes("retry"));
  for (
    const status of ["planned", "active", "completed", "on_hold", "cancelled"]
  ) {
    assertFalse(branch.includes(`"${status}"`));
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: runtime imports the Step 3 control factory and Step 2 writer factory/types", () => {
  assert(runtimeSource.includes("createMcpTaskTransitionToolExecutor"));
  assert(runtimeSource.includes("taskTransitionMutationExecutor.ts"));
  assert(runtimeSource.includes("createMcpV1TransitionTaskExecutor"));
  assert(runtimeSource.includes("McpTransitionTaskClientFactory"));
  assert(runtimeSource.includes("McpV1TransitionTaskExecutor"));
  assertFalse(runtimeSource.includes("transitionMcpV1Task"));
});

Deno.test("C2: taskTransitionWriter exists in both runtime interfaces and is passed through", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly taskTransitionWriter: McpV1TransitionTaskExecutor;",
    ),
    2,
  );
  assert(
    runtimeSource.includes(
      "taskTransitionWriter: input.taskTransitionWriter,",
    ),
  );
  assert(runtimeSource.includes("\n    taskTransitionWriter,\n"));
});

Deno.test("C3: exactly one caller-bound writer construction with the accepted arguments", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1TransitionTaskExecutor("),
    1,
  );
  const start = runtimeSource.indexOf("createMcpV1TransitionTaskExecutor(");
  const construction = runtimeSource.slice(start, start + 220);
  assert(construction.includes("String(supabaseUrl)"));
  assert(construction.includes("supabaseAnonKey"));
  assert(
    construction.includes(
      "createClient as unknown as McpTransitionTaskClientFactory",
    ),
  );
  assertFalse(construction.includes("SERVICE_ROLE"));
  assertFalse(construction.includes("privileged"));
  assertFalse(construction.includes("authClient"));
  assertFalse(construction.includes("rateLimitClient"));
  assertFalse(construction.includes("authorizationStore"));
});

Deno.test("C4: exactly one per-request control executor with the accepted dependencies", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpTaskTransitionToolExecutor({"),
    1,
  );
  const start = runtimeSource.indexOf("createMcpTaskTransitionToolExecutor({");
  const block = runtimeSource.slice(start, start + 400);
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.taskTransitionWriter,"));
  assert(
    block.includes(
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver,",
    ),
  );
  assert(block.includes("rateLimitStore: runtime.rateLimitStore,"));
  assert(block.includes("now: () => runtime.now(),"));
});

Deno.test("C5: taskTransition is handed exactly once to createBtpmMcpServer", () => {
  const start = runtimeSource.indexOf("createBtpmMcpServer(executionContext, {");
  assert(start > 0);
  const block = runtimeSource.slice(start, runtimeSource.indexOf("}),", start));
  assertStrictEquals(occurrences(block, "taskTransition,"), 1);
});

Deno.test("C6: runtime never duplicates Task Transition business or control logic", () => {
  for (
    const forbidden of [
      "api_v1_transition_task",
      "mcp_v1_transition_task",
      "apply_task_execution_change",
      "requireMcpMutationConfirmation",
      "buildApiV1TransitionTaskIdempotencyPayload",
      "hashCanonicalPayload",
      "parseApiV1TransitionTaskBody",
    ]
  ) {
    assertFalse(
      runtimeSource.includes(forbidden),
      `runtime must not reference ${forbidden}`,
    );
  }
});

Deno.test("C7: runtime wiring never reads, refreshes or repairs the concurrency token", () => {
  // Comment-only mentions are architectural documentation; executable runtime
  // code must never touch the caller-supplied concurrency token.
  const runtimeCode = runtimeSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assertFalse(runtimeCode.includes("expectedUpdatedAt"));
  assertFalse(runtimeCode.includes("taskTransitionExpectedUpdatedAt"));
});

// -----------------------------------------------------------------------------
// D. Control boundary
// -----------------------------------------------------------------------------

Deno.test("D1: the Task Transition control layer stays registration/runtime-free", () => {
  for (
    const forbidden of [
      "registerTool",
      "MCP_TOOL_REGISTRY",
      "Deno.serve",
      "Deno.env",
      "createClient",
      "SERVICE_ROLE",
      ".rpc(",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `control layer must not reference ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// E. Error / privacy boundary
// -----------------------------------------------------------------------------

Deno.test("E1: the bounded error vocabulary remains exactly the accepted categories", () => {
  assertEquals(
    Object.keys(MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES).slice().sort(),
    EXPECTED_ERROR_CATEGORIES,
  );
});

Deno.test("E2: bounded messages disclose no internal or timestamp detail", () => {
  const messages = Object.values(MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES);
  assertStrictEquals(messages.length, EXPECTED_ERROR_CATEGORIES.length);
  for (const message of messages) {
    assertStrictEquals(typeof message, "string");
    assert(message.trim().length > 0);
    for (
      const leak of [
        "sql",
        "postgres",
        "service_role",
        "bearer",
        "stack",
        "select ",
      ]
    ) {
      assertFalse(
        message.toLowerCase().includes(leak),
        `bounded message leaks "${leak}": ${message}`,
      );
    }
  }
  const stale = MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES.stale_task;
  // No current database timestamp may be disclosed to the caller.
  assertFalse(/\d{4}-\d{2}-\d{2}/.test(stale));
  assertFalse(/\d{2}:\d{2}:\d{2}/.test(stale));
  assertFalse(/\bZ\b/.test(stale));
});
