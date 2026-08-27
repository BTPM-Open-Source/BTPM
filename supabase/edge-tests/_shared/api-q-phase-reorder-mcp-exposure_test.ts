// API-Q — Phase Reorder Step 4 — focused guard for the EIGHTH MCP mutation
// exposure and runtime wiring of `phases.reorder` as `btpm_reorder_phases`.
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
  MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES,
  MCP_PHASE_REORDER_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/phaseReorderMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const controlSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/phaseReorderMutationTool.ts",
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

Deno.test("A2: phases.reorder is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "phases.reorder",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_reorder_phases");
  assertStrictEquals(entry.toolName, MCP_PHASE_REORDER_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "bounded_collection");
  assertStrictEquals(entry.concurrencyToken, "required");
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

Deno.test("A6: the previously accepted seven mutation exposures are unchanged", () => {
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
// MCP-HARDENING-C1B — obsolete whole-product MCP cardinality/inventory
// baselines removed; the canonical registry stays the source of truth.

// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the Step 3 control layer only", () => {
  assert(serverFactorySource.includes('from "./phaseReorderMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_PHASE_REORDER_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("phaseReorderMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1ReorderPhasesExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
  assertFalse(serverFactorySource.includes("reorderMcpV1Phases"));
});

Deno.test("B2: serverFactory registers exactly one Phase-reorder branch", () => {
  assertStrictEquals(
    serverFactorySource.split(
      "if (tool.toolName === MCP_PHASE_REORDER_TOOL_NAME)",
    ).length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split("executors.phaseReorder(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split(
      "readonly phaseReorder: McpPhaseReorderToolExecutor",
    ).length - 1,
    1,
  );
  const branchIndex = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PHASE_REORDER_TOOL_NAME)",
  );
  assert(branchIndex > 0);
  const branch = serverFactorySource.slice(branchIndex, branchIndex + 1200);
  assert(branch.includes("BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("inputSchema: MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA"));
  assert(
    branch.includes("MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES[result.category]"),
  );
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
      "mcp_v1_reorder_phases",
      "api_v1_reorder_phases",
      "reorder_phases",
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

Deno.test("C1: the runtime builds the caller-bound Phase-reorder writer with the anon key", () => {
  assert(mcpIndexSource.includes("phaseReorderMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpPhaseReorderToolExecutor"));
  assert(mcpIndexSource.includes("phaseReorderMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1ReorderPhasesExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly phaseReorderWriter: McpV1ReorderPhasesExecutor;",
    ),
  );
  assert(mcpIndexSource.includes("McpReorderPhasesClientFactory"));
  assertStrictEquals(
    mcpIndexSource.split("createMcpV1ReorderPhasesExecutor(").length - 1,
    1, // exactly one construction site
  );

  const builderIndex = mcpIndexSource.lastIndexOf(
    "createMcpV1ReorderPhasesExecutor(",
  );
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(builderCall.includes("String(supabaseUrl)"));
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Phase-reorder writer must be built with the anon key",
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
      `the Phase-reorder writer must never receive ${forbidden}`,
    );
  }
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpPhaseReorderToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("writer: runtime.phaseReorderWriter,"));
  assert(mcpIndexSource.includes("phaseReorder,"));
  assert(mcpIndexSource.includes("phaseReorderWriter,"));
  assert(
    mcpIndexSource.includes("phaseReorderWriter: input.phaseReorderWriter,"),
  );

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpPhaseReorderToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
      "writer: runtime.phaseReorderWriter",
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver",
      "rateLimitStore: runtime.rateLimitStore",
      "now: () => runtime.now()",
    ]
  ) {
    assert(
      executorCall.includes(required),
      `per-request Phase-reorder control is missing ${required}`,
    );
  }
});

Deno.test("C3: the runtime introduces no direct Phase business access, hashing or retry", () => {
  for (
    const forbidden of [
      "mcp_v1_reorder_phases",
      "api_v1_reorder_phases",
      "public.reorder_phases",
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

  // Concurrency-token, staleness and retry handling must not appear in any
  // EXECUTABLE runtime code. Comments documenting the boundary are allowed, so
  // the assertion is made against comment-stripped source.
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
      "stale_phase_order",
      "retry",
    ]
  ) {
    assertFalse(
      executableSource.includes(forbidden),
      `btpm-mcp runtime code references ${forbidden}`,
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
      `phaseReorderMutationTool references ${forbidden}`,
    );
  }
});

Deno.test("D2: bounded messages stay bounded", () => {
  const messages = Object.values(MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES);
  assertStrictEquals(messages.length, 8);
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
