// API-Q — Task Plan Step 4 — focused guard for the THIRTEENTH MCP mutation
// exposure and runtime wiring of `tasks.plan` as `btpm_plan_task`.
//
// Registry invariants are asserted against the live registry; wiring invariants
// are asserted statically against the accepted factory/runtime sources.
// No network, no database, no Edge invocation, no service-role key.

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
  MCP_TASK_PLAN_TOOL_ERROR_MESSAGES,
  MCP_TASK_PLAN_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/taskPlanMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const controlSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/taskPlanMutationTool.ts",
    import.meta.url,
  ),
);

const APPROVED_DETAIL_FIELDS = [
  "taskId",
  "projectId",
  "phaseId",
  "phaseCurrentStart",
  "phaseCurrentTargetEnd",
  "phaseProposedStart",
  "phaseProposedTargetEnd",
  "requestedTaskStart",
  "requestedTaskDue",
];

const TASK_PLAN_BRANCH_MARKER =
  "if (tool.toolName === MCP_TASK_PLAN_TOOL_NAME)";

function taskPlanBranch(): string {
  const index = serverFactorySource.indexOf(TASK_PLAN_BRANCH_MARKER);
  assert(index > 0, "Task Plan registration branch is missing");
  return serverFactorySource.slice(index, index + 3000);
}

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry remains structurally valid", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: tasks.plan is exposed with byte-identical accepted metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "tasks.plan",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_plan_task");
  assertStrictEquals(entry.toolName, MCP_TASK_PLAN_TOOL_NAME);
  assertStrictEquals(entry.title, "Plan BTPM Task");
  assertStrictEquals(
    entry.description,
    "Applies planned dates to one Task through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "required");
});

Deno.test("A3: tasks.plan is registered exactly once by operationId and tool name", () => {
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter((entry) => entry.operationId === "tasks.plan").length,
    1,
    "tasks.plan must occur exactly once in the canonical registry",
  );
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter((entry) => entry.toolName === "btpm_plan_task").length,
    1,
    "btpm_plan_task must occur exactly once as a registered tool name",
  );
  assertStrictEquals(
    exposedMcpTools().filter((entry) => entry.operationId === "tasks.plan").length,
    1,
    "tasks.plan must be exposed exactly once",
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

Deno.test("A6: the previously accepted twelve mutation exposures are unchanged", () => {
  const expectations: ReadonlyArray<
    readonly [string, string, "required" | "not_applicable", string]
  > = [
    [
      "execution_updates.append",
      "btpm_append_execution_update",
      "not_applicable",
      "single_object",
    ],
    ["risks.create", "btpm_create_risk", "not_applicable", "single_object"],
    ["risks.update", "btpm_update_risk", "required", "single_object"],
    [
      "blockers.create",
      "btpm_create_blocker",
      "not_applicable",
      "single_object",
    ],
    ["blockers.update", "btpm_update_blocker", "required", "single_object"],
    ["phases.create", "btpm_create_phase", "not_applicable", "single_object"],
    ["phases.update", "btpm_update_phase", "required", "single_object"],
    [
      "phases.reorder",
      "btpm_reorder_phases",
      "required",
      "bounded_collection",
    ],
    ["phases.plan", "btpm_plan_phase", "required", "single_object"],
    ["tasks.create", "btpm_create_task", "not_applicable", "single_object"],
    ["tasks.update", "btpm_update_task", "required", "single_object"],
    [
      "tasks.reorder",
      "btpm_reorder_tasks",
      "required",
      "bounded_collection",
    ],
  ];
  for (const [operationId, toolName, concurrency, shape] of expectations) {
    const entry = MCP_TOOL_REGISTRY.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert(entry !== undefined, `${operationId} missing`);
    assertStrictEquals(entry.exposure, "exposed");
    assertStrictEquals(entry.toolName, toolName);
    assertStrictEquals(entry.operationClass, "mutation");
    assertStrictEquals(entry.confirmation, "required");
    assertStrictEquals(entry.resultShape, shape);
    assertStrictEquals(entry.concurrencyToken, concurrency);
  }
});


// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the Step 3 control layer only", () => {
  assert(serverFactorySource.includes('from "./taskPlanMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_TASK_PLAN_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_TASK_PLAN_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_TASK_PLAN_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("taskPlanMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1PlanTaskExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
  assertFalse(serverFactorySource.includes("planMcpV1Task"));
});

Deno.test("B2: serverFactory registers exactly one Task Plan property and branch", () => {
  assertStrictEquals(
    serverFactorySource.split(TASK_PLAN_BRANCH_MARKER).length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split("executors.taskPlan(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split("readonly taskPlan: McpTaskPlanToolExecutor")
      .length - 1,
    1,
  );
  const branch = taskPlanBranch();
  assert(branch.includes("BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("inputSchema: MCP_TASK_PLAN_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
});

Deno.test("B3: the planning structured error exposes exactly the nine approved detail fields", () => {
  const branch = taskPlanBranch();
  const detailsIndex = branch.indexOf("details: {");
  assert(detailsIndex > 0, "structured details object is missing");
  const detailsBlock = branch.slice(
    detailsIndex,
    branch.indexOf("},", detailsIndex),
  );
  const fields = [...detailsBlock.matchAll(/(\w+): details\.(\w+),/g)].map(
    (match) => match[1],
  );
  assertEquals(fields, APPROVED_DETAIL_FIELDS);
  const structuredIndex = branch.indexOf("const structured = {");
  assert(structuredIndex > 0);
  const structuredBlock = branch.slice(structuredIndex, detailsIndex);
  assert(
    structuredBlock.includes(
      'category: "phase_window_extension_required" as const',
    ),
  );
  assert(structuredBlock.includes("MCP_TASK_PLAN_TOOL_ERROR_MESSAGES["));
  assert(branch.includes("isError: true as const"));
  assert(branch.includes("JSON.stringify(structured)"));
  assert(branch.includes("structuredContent: structured"));
});

Deno.test("B4: malformed details fall back to the bounded unavailable error", () => {
  const branch = taskPlanBranch();
  assert(
    branch.includes('const details = "details" in result ? result.details'),
  );
  assert(branch.includes('details === null || typeof details !== "object"'));
  assert(
    branch.includes(
      "boundedToolError(\n                  MCP_TASK_PLAN_TOOL_ERROR_MESSAGES.unavailable,",
    ),
  );
});

Deno.test("B5: other failures use the bounded error-message map and success returns JSON plus structuredContent", () => {
  const branch = taskPlanBranch();
  assert(branch.includes("MCP_TASK_PLAN_TOOL_ERROR_MESSAGES[result.category]"));
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

Deno.test("B6: the factory declares no Supabase, service-role, RPC or PMG surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "mcp_v1_plan_task",
      "api_v1_plan_task",
      "apply_task_planning_change",
      "preview_task_planning_change",
      "pmg_",
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

Deno.test("B7: the factory has no generic operationId dispatcher", () => {
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

Deno.test("C1: the runtime builds the caller-bound Task Plan writer exactly once with the anon key", () => {
  assert(mcpIndexSource.includes("taskPlanMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpTaskPlanToolExecutor"));
  assert(mcpIndexSource.includes("taskPlanMutationExecutor.ts"));
  assert(mcpIndexSource.includes("McpPlanTaskClientFactory"));
  assertStrictEquals(
    mcpIndexSource.split("createMcpV1PlanTaskExecutor(").length - 1,
    1,
  );

  const builderIndex = mcpIndexSource.indexOf("createMcpV1PlanTaskExecutor(");
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 260);
  assert(builderCall.includes("String(supabaseUrl)"));
  assert(builderCall.includes("supabaseAnonKey"));
  assert(
    builderCall.includes("createClient as unknown as McpPlanTaskClientFactory"),
  );
  for (
    const forbidden of [
      "serviceRole",
      "SERVICE_ROLE",
      "privileged",
      "authClient",
      "rateLimitClient",
    ]
  ) {
    assertFalse(
      builderCall.includes(forbidden),
      `the Task Plan writer must never receive ${forbidden}`,
    );
  }
});

Deno.test("C2: the writer exists in all three runtime-contract locations", () => {
  assertStrictEquals(
    mcpIndexSource.split("readonly taskPlanWriter: McpV1PlanTaskExecutor;")
      .length - 1,
    2, // BtpmMcpRuntime and BtpmMcpRuntimeInput
  );
  assert(mcpIndexSource.includes("taskPlanWriter: input.taskPlanWriter,"));
  assert(mcpIndexSource.includes("    taskPlanWriter,"));
});

Deno.test("C3: exactly one per-request control executor is created and handed to the server", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpTaskPlanToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("        taskPlan,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpTaskPlanToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
      "writer: runtime.taskPlanWriter",
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver",
      "rateLimitStore: runtime.rateLimitStore",
      "now: () => runtime.now()",
    ]
  ) {
    assert(
      executorCall.includes(required),
      `per-request Task Plan control is missing ${required}`,
    );
  }
});

Deno.test("C4: the runtime introduces no direct business access, hashing, approval or retry", () => {
  for (
    const forbidden of [
      "mcp_v1_plan_task",
      "api_v1_plan_task",
      "apply_task_planning_change",
      "preview_task_planning_change",
      'from("tasks")',
      'from("phases")',
      'from("projects")',
      "hashCanonicalPayload",
      "validateIdempotencyKey",
      "requireMcpMutationConfirmation",
      "confirmParentExtension",
    ]
  ) {
    assertFalse(
      mcpIndexSource.includes(forbidden),
      `btpm-mcp runtime references ${forbidden}`,
    );
  }

  const executableSource = mcpIndexSource
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*");
    })
    .join("\n");
  for (
    const forbidden of [
      "expectedUpdatedAt",
      "updated_at",
      "startDate",
      "dueDate",
      "stale_task_planning",
      "retry",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `btpm-mcp runtime code references ${forbidden}`,
    );
  }

  for (
    const forbidden of [
      'headers.get("authorization")',
      'headers.get("Authorization")',
      "Bearer ",
      "bearerToken",
      "accessToken",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `btpm-mcp runtime code derives a bearer token via ${forbidden}`,
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
      `taskPlanMutationTool references ${forbidden}`,
    );
  }
});

Deno.test("D2: bounded messages stay bounded", () => {
  const messages = Object.values(MCP_TASK_PLAN_TOOL_ERROR_MESSAGES);
  assertStrictEquals(messages.length, 9);
  for (const message of messages) {
    assert(message.length > 0);
    assertFalse(/\d{4}-\d{2}-\d{2}/.test(message));
    for (
      const leak of [
        "service_role",
        "postgres",
        "PGRST",
        "supabase.co",
        "jwt",
        "Bearer",
      ]
    ) {
      assertFalse(
        message.toLowerCase().includes(leak.toLowerCase()),
        `bounded message leaks ${leak}`,
      );
    }
  }
});
