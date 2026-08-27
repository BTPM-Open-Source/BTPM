// API-Q.10D4 — focused guard for the FIFTH MCP mutation exposure and runtime
// wiring of `blockers.update` as `btpm_update_blocker`.
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
  MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_BLOCKER_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/blockerUpdateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const registrySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);
const controlSource = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/blockerUpdateMutationTool.ts",
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

Deno.test("A2: blockers.update is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "blockers.update",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_update_blocker");
  assertStrictEquals(entry.toolName, MCP_BLOCKER_UPDATE_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
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

Deno.test("A6: previously accepted mutation exposures remain unchanged", () => {
  const expectations: ReadonlyArray<
    readonly [string, string, "required" | "not_applicable"]
  > = [
    ["blockers.create", "btpm_create_blocker", "not_applicable"],
    ["risks.create", "btpm_create_risk", "not_applicable"],
    ["risks.update", "btpm_update_risk", "required"],
    ["execution_updates.append", "btpm_append_execution_update", "not_applicable"],
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

// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the D3 control layer, not the writer adapter", () => {
  assert(serverFactorySource.includes('from "./blockerUpdateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_BLOCKER_UPDATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_BLOCKER_UPDATE_TOOL_INPUT_SCHEMA"));
  assert(
    serverFactorySource.includes("MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES"),
  );
  assertFalse(
    serverFactorySource.includes("blockerUpdateMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1UpdateBlockerExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});

Deno.test("B2: serverFactory registers exactly one Blocker-update branch", () => {
  const occurrences =
    serverFactorySource.split("MCP_BLOCKER_UPDATE_TOOL_NAME").length - 1;
  assert(occurrences >= 2, "expected import plus branch guard");
  assertStrictEquals(
    serverFactorySource.split("executors.blockerUpdate(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split(
      "readonly blockerUpdate: McpBlockerUpdateToolExecutor",
    ).length - 1,
    1,
  );
  assert(
    serverFactorySource.includes(
      "MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  const branchIndex = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_BLOCKER_UPDATE_TOOL_NAME)",
  );
  assert(branchIndex > 0);
  const branch = serverFactorySource.slice(branchIndex, branchIndex + 1200);
  assert(branch.includes("BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("inputSchema: MCP_BLOCKER_UPDATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

Deno.test("B3: the factory declares no Supabase, service-role or RPC surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "mcp_v1_update_blocker",
      "api_v1_update_blocker",
      "apply_blocker_update",
      "pmg_",
      "source_channel",
      'from("blockers")',
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory references ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: the runtime builds the caller-bound Blocker-update writer with the anon key", () => {
  assert(mcpIndexSource.includes("blockerUpdateMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpBlockerUpdateToolExecutor"));
  assert(mcpIndexSource.includes("blockerUpdateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1UpdateBlockerExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly blockerUpdateWriter: McpV1UpdateBlockerExecutor;",
    ),
  );
  assert(mcpIndexSource.includes("McpUpdateBlockerClientFactory"));

  const builderIndex = mcpIndexSource.indexOf(
    "createMcpV1UpdateBlockerExecutor(",
  );
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Blocker-update writer must be built with the anon key",
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
      `the Blocker-update writer must never receive ${forbidden}`,
    );
  }
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assertStrictEquals(
    mcpIndexSource.split("createMcpBlockerUpdateToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("writer: runtime.blockerUpdateWriter,"));
  assert(mcpIndexSource.includes("blockerUpdate,"));
  assert(mcpIndexSource.includes("blockerUpdateWriter,"));
  assert(mcpIndexSource.includes("blockerUpdateWriter: input.blockerUpdateWriter,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpBlockerUpdateToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
      "writer: runtime.blockerUpdateWriter",
      "rateLimitProfileResolver",
      "rateLimitStore",
      "now:",
    ]
  ) {
    assert(
      executorCall.includes(required),
      `control executor construction missing ${required}`,
    );
  }
});

Deno.test("C3: the MCP wrapper name stays out of registry/factory/runtime", () => {
  for (const source of [registrySource, serverFactorySource, mcpIndexSource]) {
    assertFalse(source.includes("mcp_v1_update_blocker"));
    assertFalse(source.includes("apply_blocker_update"));
  }
});

Deno.test("C4: Blocker Create and Risk Update remain independently wired", () => {
  for (
    const marker of [
      "createMcpBlockerCreateToolExecutor({",
      "writer: runtime.blockerCreateWriter,",
      "createMcpRiskUpdateToolExecutor({",
      "writer: runtime.riskUpdateWriter,",
      "createMcpRiskCreateToolExecutor({",
      "createMcpExecutionUpdateAppendToolExecutor({",
    ]
  ) {
    assert(mcpIndexSource.includes(marker), `runtime lost ${marker}`);
  }
  for (
    const marker of [
      "executors.blockerCreate(",
      "executors.riskUpdate(",
      "executors.riskCreate(",
      "executors.executionUpdateAppend(",
    ]
  ) {
    assertStrictEquals(
      serverFactorySource.split(marker).length - 1,
      1,
      `${marker} must remain a single explicit branch`,
    );
  }
});

// -----------------------------------------------------------------------------
// D. Security / scope
// -----------------------------------------------------------------------------

Deno.test("D1: no generic mutation dispatcher or PMG/table access is introduced", () => {
  for (
    const forbidden of [
      "mutationDispatcher",
      "genericMutation",
      "executeMutationByName",
      "dispatchMutation",
      "pmg_",
      'from("blockers")',
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory references ${forbidden}`,
    );
  }
  for (
    const forbidden of [
      "mutationDispatcher",
      "genericMutation",
      "executeMutationByName",
      "dispatchMutation",
      'from("blockers")',
    ]
  ) {
    assertFalse(
      mcpIndexSource.includes(forbidden),
      `btpm-mcp/index.ts references ${forbidden}`,
    );
  }
});

Deno.test("D2: no concurrency read, refresh or retry logic is introduced", () => {
  for (const source of [serverFactorySource, mcpIndexSource]) {
    for (
      const forbidden of [
        "refreshExpectedUpdatedAt",
        "expectedUpdatedAt =",
        "retryStale",
        "stale_blocker_retry",
      ]
    ) {
      assertFalse(source.includes(forbidden), `unexpected ${forbidden}`);
    }
  }
  // Only comments may mention the token; no executable line may read, assign
  // or reformat it in the exposure/wiring layers.
  const stripComments = (source: string): string =>
    source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
  assertFalse(
    stripComments(serverFactorySource).includes("expectedUpdatedAt"),
    "serverFactory must not touch the concurrency token",
  );
  assertFalse(
    stripComments(mcpIndexSource).includes("expectedUpdatedAt"),
    "runtime wiring must not touch the concurrency token",
  );
});

Deno.test("D3: the D3 control module performs no registration or runtime work", () => {
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
      `blockerUpdateMutationTool references ${forbidden}`,
    );
  }
});

Deno.test("D4: bounded error messages disclose no identity, timestamp or database detail", () => {
  const messages = Object.values(MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES);
  assert(messages.length >= 7);
  const stale = MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES["stale_blocker"];
  assert(typeof stale === "string" && stale.length > 0);
  assertFalse(/\d{4}-\d{2}-\d{2}/.test(stale));
  assertFalse(stale.includes("Z"));
  for (const message of messages) {
    assert(message.length > 0);
    assertFalse(/\d{4}-\d{2}-\d{2}/.test(message));
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_update_blocker",
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
