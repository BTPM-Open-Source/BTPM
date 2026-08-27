// API-Q — Task Create Step 4 — focused guard for the TENTH MCP mutation
// exposure and runtime wiring of `tasks.create` as `btpm_create_task`.
//
// Registry invariants are asserted against the live registry; wiring invariants
// are asserted statically against the accepted factory/runtime sources.
// No network, no database, no Edge invocation, no service-role key, no real
// Task creation.

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
  MCP_TASK_CREATE_TOOL_ERROR_MESSAGES,
  MCP_TASK_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const controlSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/taskCreateMutationTool.ts",
    import.meta.url,
  ),
);

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry remains structurally valid", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: tasks.create is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "tasks.create",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_task");
  assertStrictEquals(entry.toolName, MCP_TASK_CREATE_TOOL_NAME);
  assertStrictEquals(entry.title, "Create BTPM Task");
  assertStrictEquals(
    entry.description,
    "Creates one Task in a Phase through the canonical API mutation contract. Tasks created in baselined Projects require both planned start and due dates.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("A3: tasks.create is registered exactly once by operationId and tool name", () => {
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter((entry) => entry.operationId === "tasks.create").length,
    1,
    "tasks.create must occur exactly once in the canonical registry",
  );
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter((entry) => entry.toolName === "btpm_create_task").length,
    1,
    "btpm_create_task must occur exactly once as a registered tool name",
  );
  assertStrictEquals(
    exposedMcpTools().filter((entry) => entry.operationId === "tasks.create").length,
    1,
    "tasks.create must be exposed exactly once",
  );
});

Deno.test("A5: version.get and capabilities.get remain not_exposed (ME-3 exposed me.get)", () => {
  for (const operationId of ["version.get", "capabilities.get"]) {
    const entry = MCP_TOOL_REGISTRY.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert(entry !== undefined);
    assertStrictEquals(entry.exposure, "not_exposed");
  }
});

Deno.test("A6: the previously accepted nine mutation exposures are unchanged", () => {
  const expectations: ReadonlyArray<
    readonly [string, string, "required" | "not_applicable"]
  > = [
    [
      "execution_updates.append",
      "btpm_append_execution_update",
      "not_applicable",
    ],
    ["risks.create", "btpm_create_risk", "not_applicable"],
    ["risks.update", "btpm_update_risk", "required"],
    ["blockers.create", "btpm_create_blocker", "not_applicable"],
    ["blockers.update", "btpm_update_blocker", "required"],
    ["phases.create", "btpm_create_phase", "not_applicable"],
    ["phases.update", "btpm_update_phase", "required"],
    ["phases.reorder", "btpm_reorder_phases", "required"],
    ["phases.plan", "btpm_plan_phase", "required"],
  ];
  for (const [operationId, toolName, concurrency] of expectations) {
    const entry = MCP_TOOL_REGISTRY.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert(entry !== undefined, `${operationId} missing`);
    assertStrictEquals(entry.exposure, "exposed");
    assertStrictEquals(entry.toolName, toolName);
    assertStrictEquals(entry.operationClass, "mutation");
    assertStrictEquals(entry.confirmation, "required");
    assertStrictEquals(entry.concurrencyToken, concurrency);
  }
});


// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the Task Step 3 control layer only", () => {
  assert(serverFactorySource.includes('from "./taskCreateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_TASK_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_TASK_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_TASK_CREATE_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("taskCreateMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1CreateTaskExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});

Deno.test("B2: serverFactory registers exactly one Task-create branch", () => {
  const occurrences =
    serverFactorySource.split("MCP_TASK_CREATE_TOOL_NAME").length - 1;
  assert(occurrences >= 2, "expected import plus branch guard");
  assertStrictEquals(
    serverFactorySource.split("executors.taskCreate(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split("readonly taskCreate: McpTaskCreateToolExecutor")
      .length - 1,
    1,
  );
  assert(
    serverFactorySource.includes(
      "MCP_TASK_CREATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  const branchIndex = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_TASK_CREATE_TOOL_NAME)",
  );
  assert(branchIndex > 0);
  const branch = serverFactorySource.slice(branchIndex, branchIndex + 1200);
  assert(branch.includes("BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("inputSchema: MCP_TASK_CREATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

Deno.test("B3: the factory declares no Supabase, service-role, RPC or Task-table surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "mcp_v1_create_task",
      "api_v1_create_task",
      "apply_task_create",
      "source_channel",
      'from("tasks")',
      'from("phases")',
      'from("projects")',
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory references ${forbidden}`,
    );
  }
});

Deno.test("B4: the factory has no generic operationId dispatcher", () => {
  for (
    const forbidden of [
      "executors[",
      "OPERATION_EXECUTORS",
      "executorFor(",
      "dispatchOperation",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory introduces a generic dispatcher via ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: the runtime builds the caller-bound Task-create writer with the anon key", () => {
  assert(mcpIndexSource.includes("taskCreateMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpTaskCreateToolExecutor"));
  assert(mcpIndexSource.includes("taskCreateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1CreateTaskExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly taskCreateWriter: McpV1CreateTaskExecutor;",
    ),
  );
  assert(mcpIndexSource.includes("McpCreateTaskClientFactory"));
  assertStrictEquals(
    mcpIndexSource.split("createMcpV1CreateTaskExecutor(").length - 1,
    1, // exactly one construction site
  );

  const builderIndex = mcpIndexSource.lastIndexOf(
    "createMcpV1CreateTaskExecutor(",
  );
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(
    builderIndex,
    mcpIndexSource.indexOf(");", builderIndex) + 2,
  );
  assert(builderCall.includes("String(supabaseUrl)"));
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Task-create writer must be built with the anon key",
  );
  assert(builderCall.includes("createClient"));
  for (
    const forbidden of [
      "serviceRole",
      "SERVICE_ROLE",
      "privileged",
      "authClient",
      "rateLimitClient",
      "authorizationStore",
      "Authorization",
    ]
  ) {
    assertFalse(
      builderCall.includes(forbidden),
      `the Task-create writer must never receive ${forbidden}`,
    );
  }
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpTaskCreateToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("writer: runtime.taskCreateWriter,"));
  assert(mcpIndexSource.includes("taskCreate,"));
  assert(mcpIndexSource.includes("taskCreateWriter,"));
  assert(
    mcpIndexSource.includes("taskCreateWriter: input.taskCreateWriter,"),
  );

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpTaskCreateToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
      "writer: runtime.taskCreateWriter",
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver",
      "rateLimitStore: runtime.rateLimitStore",
      "now: () => runtime.now()",
    ]
  ) {
    assert(
      executorCall.includes(required),
      `per-request Task-create control is missing ${required}`,
    );
  }
});

Deno.test("C3: the runtime introduces no direct Task/Phase/Project business access", () => {
  for (
    const forbidden of [
      "mcp_v1_create_task",
      "api_v1_create_task",
      "apply_task_create",
      'from("tasks")',
      'from("phases")',
      'from("projects")',
      "hashCanonicalPayload",
      "validateIdempotencyKey",
      "requireMcpMutationConfirmation",
    ]
  ) {
    assertFalse(
      mcpIndexSource.includes(forbidden),
      `btpm-mcp runtime references ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// D. Bounded control-layer boundary
// -----------------------------------------------------------------------------

Deno.test("D1: the Step 3 control module performs no registration or runtime work", () => {
  for (
    const forbidden of [
      "registerTool",
      "MCP_TOOL_REGISTRY",
      "createBtpmMcpServer",
      "createMcpHandler",
      "Deno.env",
      "createClient",
      "service_role",
    ]
  ) {
    assertFalse(
      controlSource.includes(forbidden),
      `taskCreateMutationTool references ${forbidden}`,
    );
  }
});

// TCC-1 added exactly one bounded category: `task_dates_required`.
Deno.test("D2: all nine bounded Task Create messages stay bounded", () => {
  const messages = Object.values(MCP_TASK_CREATE_TOOL_ERROR_MESSAGES);
  assertStrictEquals(messages.length, 9);
  const datesMessage =
    MCP_TASK_CREATE_TOOL_ERROR_MESSAGES["task_dates_required"];
  assert(typeof datesMessage === "string" && datesMessage.length > 0);
  const windowMessage =
    MCP_TASK_CREATE_TOOL_ERROR_MESSAGES["phase_window_extension_required"];
  assert(typeof windowMessage === "string" && windowMessage.length > 0);
  for (const message of messages) {
    assert(message.length > 0);
    assertFalse(/\d{4}-\d{2}-\d{2}/.test(message));
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_create_task",
        "api_v1_create_task",
        "apply_task_create",
        "api_client_id",
        "oauth",
        "bearer",
        "token",
      ]
    ) {
      assertFalse(
        message.toLowerCase().includes(leak),
        `bounded message leaks ${leak}`,
      );
    }
  }
});

Deno.test("D3: no automatic Phase-window widening, retry or date rewrite is wired", () => {
  for (const source of [serverFactorySource, mcpIndexSource]) {
    for (
      const forbidden of [
        "extendPhaseWindow",
        "widenPhaseWindow",
        "extend_phase_window",
        "retryTaskCreate",
        "rewriteTaskDates",
      ]
    ) {
      assertFalse(source.includes(forbidden), `unexpected ${forbidden}`);
    }
  }
});
