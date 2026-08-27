// API-Q — Phase Create Step 4 — focused guard for the SIXTH MCP mutation
// exposure and runtime wiring of `phases.create` as `btpm_create_phase`.
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
  MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PHASE_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/phaseCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const controlSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/phaseCreateMutationTool.ts",
    import.meta.url,
  ),
);


// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry stays structurally valid and fully covering", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: phases.create is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "phases.create",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_phase");
  assertStrictEquals(entry.toolName, MCP_PHASE_CREATE_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("A3: every exposed mutation requires confirmation", () => {
  const exposed = exposedMcpTools();
  const mutations = exposed.filter(
    (entry) => entry.operationClass === "mutation",
  );
  for (const mutation of mutations) {
    assertStrictEquals(mutation.confirmation, "required");
  }
});
// MCP-HARDENING-C1B — obsolete whole-product MCP cardinality/inventory
// baselines removed; the canonical registry stays the source of truth.

Deno.test("A5: version.get and capabilities.get remain not_exposed (ME-3 exposed me.get)", () => {
  for (const operationId of ["version.get", "capabilities.get"]) {
    const entry = MCP_TOOL_REGISTRY.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert(entry !== undefined);
    assertStrictEquals(entry.exposure, "not_exposed");
  }
});

Deno.test("A6: the previously accepted five mutation exposures are unchanged", () => {
  const expectations: ReadonlyArray<
    readonly [string, string, "required" | "not_applicable"]
  > = [
    ["execution_updates.append", "btpm_append_execution_update", "not_applicable"],
    ["risks.create", "btpm_create_risk", "not_applicable"],
    ["risks.update", "btpm_update_risk", "required"],
    ["blockers.create", "btpm_create_blocker", "not_applicable"],
    ["blockers.update", "btpm_update_blocker", "required"],
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
    assertStrictEquals(entry.resultShape, "single_object");
    assertStrictEquals(entry.concurrencyToken, concurrency);
  }
});
// MCP-HARDENING-C1B — obsolete whole-product MCP cardinality/inventory
// baselines removed; the canonical registry stays the source of truth.

// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the Step 3 control layer only", () => {
  assert(serverFactorySource.includes('from "./phaseCreateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_PHASE_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("phaseCreateMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1CreatePhaseExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});

Deno.test("B2: serverFactory registers exactly one Phase-create branch", () => {
  const occurrences =
    serverFactorySource.split("MCP_PHASE_CREATE_TOOL_NAME").length - 1;
  assert(occurrences >= 2, "expected import plus branch guard");
  assertStrictEquals(
    serverFactorySource.split("executors.phaseCreate(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split(
      "readonly phaseCreate: McpPhaseCreateToolExecutor",
    ).length - 1,
    1,
  );
  assert(
    serverFactorySource.includes(
      "MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  const branchIndex = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PHASE_CREATE_TOOL_NAME)",
  );
  assert(branchIndex > 0);
  const branch = serverFactorySource.slice(branchIndex, branchIndex + 1200);
  assert(branch.includes("BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("inputSchema: MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

Deno.test("B3: the factory declares no Supabase, service-role, RPC or PMG surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "mcp_v1_create_phase",
      "api_v1_create_phase",
      "apply_phase_create",
      "pmg_",
      "source_channel",
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

Deno.test("C1: the runtime builds the caller-bound Phase-create writer with the anon key", () => {
  assert(mcpIndexSource.includes("phaseCreateMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpPhaseCreateToolExecutor"));
  assert(mcpIndexSource.includes("phaseCreateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1CreatePhaseExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly phaseCreateWriter: McpV1CreatePhaseExecutor;",
    ),
  );
  assert(mcpIndexSource.includes("McpCreatePhaseClientFactory"));
  assertStrictEquals(
    mcpIndexSource.split("createMcpV1CreatePhaseExecutor(").length - 1,
    1, // exactly one construction site
  );

  const builderIndex = mcpIndexSource.lastIndexOf(
    "createMcpV1CreatePhaseExecutor(",
  );
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(builderCall.includes("String(supabaseUrl)"));
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Phase-create writer must be built with the anon key",
  );
  assert(builderCall.includes("createClient"));
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
      `the Phase-create writer must never receive ${forbidden}`,
    );
  }
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpPhaseCreateToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("writer: runtime.phaseCreateWriter,"));
  assert(mcpIndexSource.includes("phaseCreate,"));
  assert(mcpIndexSource.includes("phaseCreateWriter,"));
  assert(
    mcpIndexSource.includes("phaseCreateWriter: input.phaseCreateWriter,"),
  );

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpPhaseCreateToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
      "writer: runtime.phaseCreateWriter",
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver",
      "rateLimitStore: runtime.rateLimitStore",
      "now: () => runtime.now()",
    ]
  ) {
    assert(
      executorCall.includes(required),
      `per-request Phase-create control is missing ${required}`,
    );
  }
});

Deno.test("C3: the runtime introduces no direct Phase/Project business access", () => {
  for (
    const forbidden of [
      "mcp_v1_create_phase",
      "api_v1_create_phase",
      "apply_phase_create",
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
      `phaseCreateMutationTool references ${forbidden}`,
    );
  }
});

Deno.test("D2: bounded messages stay bounded, including the Project-window case", () => {
  const messages = Object.values(MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES);
  // PCC-1 added the bounded `phase_dates_required` message.
  assertStrictEquals(messages.length, 9);
  const windowMessage =
    MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES["project_window_extension_required"];
  assert(typeof windowMessage === "string" && windowMessage.length > 0);
  assertFalse(/\d{4}-\d{2}-\d{2}/.test(windowMessage));
  for (const message of messages) {
    assert(message.length > 0);
    assertFalse(/\d{4}-\d{2}-\d{2}/.test(message));
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_create_phase",
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

Deno.test("D3: no automatic Project-window widening or retry is wired", () => {
  for (const source of [serverFactorySource, mcpIndexSource]) {
    for (
      const forbidden of [
        "extendProjectWindow",
        "widenProjectWindow",
        "extend_project_window",
        "retryPhaseCreate",
      ]
    ) {
      assertFalse(source.includes(forbidden), `unexpected ${forbidden}`);
    }
  }
});
