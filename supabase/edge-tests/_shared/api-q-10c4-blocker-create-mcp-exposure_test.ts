// API-Q.10C4 — focused guard for the FOURTH MCP mutation exposure and runtime
// wiring of `blockers.create` as `btpm_create_blocker`.
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
  MCP_BLOCKER_CREATE_TOOL_ERROR_MESSAGES,
  MCP_BLOCKER_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/blockerCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);
const registrySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry stays structurally valid and fully covering", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: blockers.create is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "blockers.create",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_blocker");
  assertStrictEquals(entry.toolName, MCP_BLOCKER_CREATE_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("A3: the description reflects Project / Phase / Task targeting", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "blockers.create",
  );
  assert(entry !== undefined);
  assertStrictEquals(
    entry.description,
    "Creates one Blocker for a Project, Phase, or Task through the canonical API mutation contract.",
  );
  assertFalse(entry.description.includes("in a Project through"));
});

Deno.test("A4: every exposed mutation requires confirmation", () => {
  const exposed = exposedMcpTools();
  const mutations = exposed.filter(
    (entry) => entry.operationClass === "mutation",
  );
  for (const mutation of mutations) {
    assertStrictEquals(mutation.confirmation, "required");
  }
});

// API-Q.10D4 exposed `blockers.update` as a separate accepted step. The durable
// invariant here is that Blocker Update keeps its own confirmation and
// mandatory optimistic-concurrency contract, distinct from Blocker Create.
Deno.test("A5: blockers.update keeps confirmation and mandatory concurrency", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "blockers.update",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.toolName, "btpm_update_blocker");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.concurrencyToken, "required");
});

// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the C3 control layer, not the writer adapter", () => {
  assert(serverFactorySource.includes('from "./blockerCreateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_BLOCKER_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_BLOCKER_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_BLOCKER_CREATE_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("blockerCreateMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1CreateBlockerExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});

Deno.test("B2: serverFactory registers exactly one Blocker-create branch", () => {
  const occurrences =
    serverFactorySource.split("MCP_BLOCKER_CREATE_TOOL_NAME").length - 1;
  assert(occurrences >= 2, "expected import plus branch guard");
  assertStrictEquals(
    serverFactorySource.split("executors.blockerCreate(").length - 1,
    1,
  );
  assert(
    serverFactorySource.includes(
      "readonly blockerCreate: McpBlockerCreateToolExecutor",
    ),
  );
  assert(
    serverFactorySource.includes(
      "MCP_BLOCKER_CREATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  const branchIndex = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_BLOCKER_CREATE_TOOL_NAME)",
  );
  assert(branchIndex > 0);
  const branch = serverFactorySource.slice(branchIndex, branchIndex + 1200);
  assert(branch.includes("BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("inputSchema: MCP_BLOCKER_CREATE_TOOL_INPUT_SCHEMA"));
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
      "mcp_v1_create_blocker",
      "api_v1_create_blocker",
      "blockers\"",
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

Deno.test("C1: the runtime builds the caller-bound Blocker writer with the anon key", () => {
  assert(mcpIndexSource.includes("blockerCreateMutationTool.ts"));
  assert(mcpIndexSource.includes("createMcpBlockerCreateToolExecutor"));
  assert(mcpIndexSource.includes("blockerCreateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1CreateBlockerExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly blockerCreateWriter: McpV1CreateBlockerExecutor;",
    ),
  );

  const builderIndex = mcpIndexSource.indexOf(
    "createMcpV1CreateBlockerExecutor(",
  );
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Blocker writer must be built with the anon key",
  );
  assertFalse(
    builderCall.includes("serviceRole"),
    "the Blocker writer must never receive a service-role credential",
  );
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assert(mcpIndexSource.includes("createMcpBlockerCreateToolExecutor({"));
  assert(mcpIndexSource.includes("writer: runtime.blockerCreateWriter,"));
  assert(mcpIndexSource.includes("blockerCreate,"));
  assert(mcpIndexSource.includes("blockerCreateWriter,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpBlockerCreateToolExecutor({",
  );
  assert(executorIndex > 0);
  const executorCall = mcpIndexSource.slice(executorIndex, executorIndex + 460);
  for (
    const required of [
      "request",
      "execution: executionContext",
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
    assertFalse(source.includes("mcp_v1_create_blocker"));
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
      "source_channel",
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

// API-Q.10D4 wired Blocker Update. Durable invariant: Blocker Create remains
// independently and explicitly wired, and no generic dispatcher or shared
// mutation branch is introduced by any later exposure.
Deno.test("D2: Blocker Create stays independently and explicitly wired", () => {
  assertStrictEquals(
    serverFactorySource.split("executors.blockerCreate(").length - 1,
    1,
  );
  assertStrictEquals(
    serverFactorySource.split(
      "if (tool.toolName === MCP_BLOCKER_CREATE_TOOL_NAME)",
    ).length - 1,
    1,
  );
  assertStrictEquals(
    mcpIndexSource.split("createMcpBlockerCreateToolExecutor({").length - 1,
    1,
  );
  assert(mcpIndexSource.includes("writer: runtime.blockerCreateWriter,"));
  assertFalse(
    serverFactorySource.includes("blockerCreateMutationExecutor.ts"),
    "the factory must never import the Blocker Create writer",
  );
});

Deno.test("D3: bounded error messages disclose no identity or database detail", () => {
  const messages = Object.values(MCP_BLOCKER_CREATE_TOOL_ERROR_MESSAGES);
  assert(messages.length >= 7);
  for (const message of messages) {
    assert(message.length > 0);
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_create_blocker",
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
