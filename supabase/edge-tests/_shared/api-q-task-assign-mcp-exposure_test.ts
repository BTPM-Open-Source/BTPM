// API-Q Task Assign Step 4 — MCP exposure and runtime wiring proofs.
//
// Scope: exposure of the already-accepted canonical `tasks.assign` capability as
// the MCP tool `btpm_assign_task`, plus wiring of the accepted Step 3 control
// layer and the accepted Step 2 caller-bound writer into the existing `btpm-mcp`
// runtime.
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
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES,
  MCP_TASK_ASSIGN_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskAssignMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const toolSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/taskAssignMutationTool.ts",
    import.meta.url,
  ),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry remains structurally valid", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: tasks.assign is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "tasks.assign",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_assign_task");
  assertStrictEquals(entry.toolName, MCP_TASK_ASSIGN_TOOL_NAME);
  assertStrictEquals(entry.title, "Assign BTPM Task");
  assertStrictEquals(
    entry.description,
    "Sets or clears the single Task assignee through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("A3: tasks.assign is registered exactly once by operationId and tool name", () => {
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter((entry) => entry.operationId === "tasks.assign").length,
    1,
    "tasks.assign must occur exactly once in the canonical registry",
  );
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter((entry) => entry.toolName === "btpm_assign_task").length,
    1,
    "btpm_assign_task must occur exactly once as a registered tool name",
  );
  assertStrictEquals(
    exposedMcpTools().filter((entry) => entry.operationId === "tasks.assign").length,
    1,
    "tasks.assign must be exposed exactly once",
  );
});

Deno.test("A5: version.get and capabilities.get remain not_exposed (ME-3 exposed me.get)", () => {
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

Deno.test("B1: server factory imports only the Step 3 Task Assign control layer", () => {
  assert(serverFactorySource.includes("./taskAssignMutationTool.ts"));
  assert(serverFactorySource.includes("MCP_TASK_ASSIGN_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES"));
  assertFalse(serverFactorySource.includes("taskAssignMutationExecutor"));
  assertFalse(serverFactorySource.includes("createMcpV1AssignTaskExecutor"));
});

Deno.test("B2: exactly one taskAssign executor property and one registration branch", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly taskAssign: McpTaskAssignToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_TASK_ASSIGN_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.taskAssign("),
    1,
  );
});

Deno.test("B3: the branch uses mutation annotations, the accepted schema and bounded messages", () => {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_TASK_ASSIGN_TOOL_NAME)",
  );
  assert(start > 0);
  const branch = serverFactorySource.slice(start, start + 1400);
  assert(branch.includes("inputSchema: MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(
    branch.includes("MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES[result.category]"),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

Deno.test("B4: no Supabase, RPC, service-role or dispatcher surface added to the factory", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "mcp_v1_assign_task",
      ".rpc(",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `server factory must not reference ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: runtime imports the Step 3 control factory and Step 2 writer factory/types", () => {
  assert(runtimeSource.includes("createMcpTaskAssignToolExecutor"));
  assert(runtimeSource.includes("taskAssignMutationExecutor.ts"));
  assert(runtimeSource.includes("createMcpV1AssignTaskExecutor"));
  assert(runtimeSource.includes("McpAssignTaskClientFactory"));
  assert(runtimeSource.includes("McpV1AssignTaskExecutor"));
});

Deno.test("C2: taskAssignWriter exists in both runtime interfaces and is passed through", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly taskAssignWriter: McpV1AssignTaskExecutor;",
    ),
    2,
  );
  assert(runtimeSource.includes("taskAssignWriter: input.taskAssignWriter,"));
  assert(runtimeSource.includes("\n    taskAssignWriter,\n"));
});

Deno.test("C3: exactly one caller-bound writer construction with the accepted arguments", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1AssignTaskExecutor("),
    1,
  );
  const start = runtimeSource.indexOf("createMcpV1AssignTaskExecutor(");
  const construction = runtimeSource.slice(start, start + 200);
  assert(construction.includes("String(supabaseUrl)"));
  assert(construction.includes("supabaseAnonKey"));
  assert(
    construction.includes("createClient as unknown as McpAssignTaskClientFactory"),
  );
  assertFalse(construction.includes("SERVICE_ROLE"));
  assertFalse(construction.includes("privileged"));
  assertFalse(construction.includes("authClient"));
  assertFalse(construction.includes("rateLimitClient"));
  assertFalse(construction.includes("authorizationStore"));
});

Deno.test("C4: exactly one per-request control executor with the accepted dependencies", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpTaskAssignToolExecutor({"),
    1,
  );
  const start = runtimeSource.indexOf("createMcpTaskAssignToolExecutor({");
  const block = runtimeSource.slice(start, start + 400);
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.taskAssignWriter,"));
  assert(
    block.includes(
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver,",
    ),
  );
  assert(block.includes("rateLimitStore: runtime.rateLimitStore,"));
  assert(block.includes("now: () => runtime.now(),"));
});

Deno.test("C5: taskAssign is handed to createBtpmMcpServer", () => {
  const start = runtimeSource.indexOf("createBtpmMcpServer(executionContext, {");
  assert(start > 0);
  const block = runtimeSource.slice(start, runtimeSource.indexOf("}),", start));
  assert(block.includes("taskAssign,"));
});

Deno.test("C6: runtime never duplicates Task Assign business or control logic", () => {
  for (
    const forbidden of [
      "api_v1_assign_task",
      "mcp_v1_assign_task",
      "requireMcpMutationConfirmation",
      "hashCanonicalPayload",
      "parseApiV1AssignTaskBody",
    ]
  ) {
    assertFalse(
      runtimeSource.includes(forbidden),
      `runtime must not reference ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// D. Control boundary
// -----------------------------------------------------------------------------

Deno.test("D1: the Task Assign control layer stays registration/runtime-free", () => {
  for (
    const forbidden of [
      "registerTool",
      "MCP_TOOL_REGISTRY",
      "Deno.serve",
      "Deno.env",
      "createClient",
      "SERVICE_ROLE",
    ]
  ) {
    assertFalse(
      toolSource.includes(forbidden),
      `control layer must not reference ${forbidden}`,
    );
  }
});

Deno.test("D2: bounded Task Assign messages stay non-sensitive and concurrency-free", () => {
  const messages = Object.values(MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES);
  assert(messages.length > 0);
  for (const message of messages) {
    assertStrictEquals(typeof message, "string");
    assert(message.trim().length > 0);
    for (
      const leak of [
        "sql",
        "postgres",
        "service_role",
        "bearer",
        "token",
        "uuid",
        "stack",
      ]
    ) {
      assertFalse(
        message.toLowerCase().includes(leak),
        `bounded message leaks "${leak}": ${message}`,
      );
    }
  }
  assertFalse(
    Object.keys(MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES).some((key) =>
      key.includes("stale") || key.includes("concurren")
    ),
  );
});

Deno.test("D3: no concurrency token was introduced anywhere in Task Assign wiring", () => {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_TASK_ASSIGN_TOOL_NAME)",
  );
  const branch = serverFactorySource.slice(start, start + 1400);
  assertFalse(branch.includes("expectedUpdatedAt"));
  assertFalse(branch.includes("stale"));
  assertFalse(runtimeSource.includes("taskAssignExpectedUpdatedAt"));
});
