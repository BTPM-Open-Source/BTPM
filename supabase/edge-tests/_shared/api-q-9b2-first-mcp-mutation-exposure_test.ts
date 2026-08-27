// API-Q.9B2 — focused guard for the FIRST MCP mutation exposure and runtime
// wiring of `execution_updates.append` as `btpm_append_execution_update`.
//
// Registry invariants are asserted against the live registry; wiring invariants
// are asserted statically against the accepted factory/runtime sources.
// No network, no database, no Edge invocation, no Claude invocation.

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
  MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES,
  MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA,
  MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/executionUpdateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

// -----------------------------------------------------------------------------
// Registry exposure
// -----------------------------------------------------------------------------

// MCP-HARDENING-C1B — the historical whole-product cardinality/inventory
// assertions (registry total, exposed total, exposed-read inventory, the
// "remaining mutations stay not_exposed" list) were obsolete global baselines.
// The registry structural/coverage invariants stay derived from the canonical
// authorities; everything else below is Execution-Update-local.
Deno.test("the canonical registry stays structurally valid and fully covering", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("execution_updates.append is exposed exactly once with its accepted mutation contract", () => {
  const exposed = exposedMcpTools();
  const appendEntries = exposed.filter(
    (entry) => entry.operationId === "execution_updates.append",
  );
  assertStrictEquals(appendEntries.length, 1);
  const appendEntry = appendEntries[0];
  assertStrictEquals(appendEntry.operationClass, "mutation");
  assertStrictEquals(appendEntry.toolName, "btpm_append_execution_update");
  assertStrictEquals(
    appendEntry.toolName,
    MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME,
  );
  assertStrictEquals(appendEntry.confirmation, "required");
  assertStrictEquals(appendEntry.resultShape, "single_object");
  assertStrictEquals(appendEntry.concurrencyToken, "not_applicable");
});

Deno.test("every canonical mutation requires confirmation regardless of exposure", () => {
  const mutations = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationClass === "mutation",
  );
  assert(mutations.length > 0, "canonical mutations must exist");
  for (const entry of mutations) {
    assertStrictEquals(
      entry.confirmation,
      "required",
      `${entry.operationId} must require confirmation`,
    );
  }
});


// -----------------------------------------------------------------------------
// serverFactory registration
// -----------------------------------------------------------------------------

// MCP-HARDENING-C2 replaced the `notYetExecutable(tool)` placeholder
// registration with a fail-closed construction error. The Execution Update
// branch invariant is unchanged: it stays an explicit branch ahead of the
// terminal unmatched-exposed-entry guard.
Deno.test("serverFactory registers the mutation explicitly before the fail-closed guard", () => {
  const branchIndex = serverFactorySource.indexOf(
    "tool.toolName === MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME",
  );
  assert(branchIndex > 0, "explicit mutation branch must exist");
  const guardIndex = serverFactorySource.lastIndexOf(
    "throw new McpExposedToolWithoutExecutionPathError(tool)",
  );
  assert(guardIndex > branchIndex, "fail-closed guard stays last");
  assertFalse(
    serverFactorySource.includes("notYetExecutable"),
    "the placeholder executor must be gone",
  );
});


Deno.test("mutation registration uses the API-Q.9B1 schema, executor and messages", () => {
  assert(
    serverFactorySource.includes(
      "inputSchema: MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA",
    ),
    "the strict API-Q.9B1 schema is the only input guard",
  );
  assert(
    serverFactorySource.includes("executors.executionUpdateAppend(args)"),
    "the bounded per-request executor is the only execution path",
  );
  assert(
    serverFactorySource.includes(
      "MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES[result.category]",
    ),
    "failures disclose only the bounded API-Q.9B1 messages",
  );
  assert(
    serverFactorySource.includes("structuredContent: result.payload"),
    "success returns only the bounded payload",
  );
});

Deno.test("mutation annotations are the fixed presentation hints", () => {
  const start = serverFactorySource.indexOf(
    "BTPM_MCP_MUTATION_TOOL_ANNOTATIONS = Object.freeze({",
  );
  assert(start > 0, "mutation annotations must be declared");
  const block = serverFactorySource.slice(start, start + 300);
  assert(/readOnlyHint: false/.test(block));
  assert(/destructiveHint: false/.test(block));
  assert(/idempotentHint: true/.test(block));
  assert(/openWorldHint: false/.test(block));
});

Deno.test("BtpmMcpToolExecutors declares exactly one mutation executor", () => {
  const start = serverFactorySource.indexOf(
    "export interface BtpmMcpToolExecutors {",
  );
  assert(start > 0);
  const block = serverFactorySource.slice(
    start,
    serverFactorySource.indexOf("}", start),
  );
  const matches = block.match(
    /readonly executionUpdateAppend: McpExecutionUpdateAppendToolExecutor;/g,
  );
  assertStrictEquals(matches?.length, 1);
  // No generic dispatcher may be introduced.
  assertFalse(block.includes("[operationId: string]"));
  assertFalse(block.includes("execute("));
});

// -----------------------------------------------------------------------------
// btpm-mcp runtime wiring
// -----------------------------------------------------------------------------

Deno.test("runtime builds the caller-bound writer with the anon key", () => {
  assert(
    mcpIndexSource.includes("createMcpV1AppendExecutionUpdateExecutor("),
    "the accepted API-Q.9A5 writer factory is used",
  );
  const start = mcpIndexSource.indexOf(
    "createMcpV1AppendExecutionUpdateExecutor(\n",
  );
  assert(start > 0);
  const block = mcpIndexSource.slice(start, start + 260);
  assert(block.includes("supabaseAnonKey"), "writer is bound to the anon key");
  assertFalse(
    block.includes("serviceRole"),
    "no service-role key may reach the writer",
  );
  assertFalse(
    block.includes("privileged"),
    "the privileged client may not be passed to the writer",
  );
});

Deno.test("per-request mutation tool is built through the 9B1 control layer", () => {
  const start = mcpIndexSource.indexOf(
    "createMcpExecutionUpdateAppendToolExecutor({",
  );
  assert(start > 0, "the tool executor must be built per request");
  // Bound the window to the construction call itself so that neighbouring
  // wiring (API-Q.10A5 added the Risk-create construction directly after) can
  // never leak into these assertions.
  const end = mcpIndexSource.indexOf("});", start);
  assert(end > start, "the tool executor construction must be bounded");
  const block = mcpIndexSource.slice(start, end + 3);
  // Original authenticated request, trusted execution context, accepted writer
  // and the existing canonical rate-limit infrastructure.
  assert(/\brequest,/.test(block));
  assert(block.includes("execution: executionContext"));
  assert(block.includes("writer: runtime.executionUpdateWriter"));
  assert(
    block.includes("rateLimitProfileResolver: runtime.rateLimitProfileResolver"),
  );
  assert(block.includes("rateLimitStore: runtime.rateLimitStore"));
  assert(block.includes("now: () => runtime.now()"));
  // Nothing is reconstructed in the transport.
  assertFalse(block.includes("confirmation"));
  assertFalse(block.includes("idempotency"));
  assertFalse(block.includes("payloadHash"));
});

Deno.test("the mutation executor is passed into createBtpmMcpServer", () => {
  const start = mcpIndexSource.indexOf("createBtpmMcpServer(executionContext, {");
  assert(start > 0);
  const block = mcpIndexSource.slice(start, mcpIndexSource.indexOf("}", start));
  assert(block.includes("executionUpdateAppend"));
  // The existing reads remain wired.
  for (const readExecutor of [
    "organizationsGet",
    "workspacesGet",
    "projectsGet",
    "programsGet",
    "programGetById",
    "projectGetById",
    "projectPlanningGet",
    "risksGet",
    "riskGetById",
    "blockersGet",
    "blockerGetById",
    "executionUpdatesGet",
    "phaseGetById",
    "taskGetById",
  ]) {
    assert(block.includes(readExecutor), `missing read executor ${readExecutor}`);
  }
});

// -----------------------------------------------------------------------------
// No business database path in the factory or the transport
// -----------------------------------------------------------------------------

Deno.test("no direct RPC, PMG or wrapper call exists in factory or runtime", () => {
  for (const source of [serverFactorySource, mcpIndexSource]) {
    assertFalse(source.includes("mcp_v1_append_execution_update"));
    assertFalse(source.includes("api_v1_append_execution_update"));
    assertFalse(source.includes("append_execution_update("));
    assertFalse(source.includes("pmg_record_command_audit"));
  }
  // The factory must never touch Supabase at all.
  assertFalse(serverFactorySource.includes(".rpc("));
  assertFalse(serverFactorySource.includes("createClient"));
  assertFalse(serverFactorySource.includes("SERVICE_ROLE"));
});

// -----------------------------------------------------------------------------
// Bounded contract sanity
// -----------------------------------------------------------------------------

Deno.test("the exposed schema accepts exactly the seven approved arguments", () => {
  assertEquals(
    Object.keys(MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA.shape).sort(),
    [
      "confirmation",
      "idempotencyKey",
      "statusLabel",
      "summary",
      "targetId",
      "targetType",
      "updateDate",
    ],
  );
  const rejected = MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA.safeParse({
    targetType: "phase",
    targetId: "11111111-1111-4111-8111-111111111111",
    summary: "s",
    updateDate: "2026-08-13",
    confirmation: true,
    idempotencyKey: "k",
    projectId: "smuggled",
  });
  assertFalse(rejected.success, "unknown fields must be rejected");
});

Deno.test("bounded error messages disclose no internal detail", () => {
  const categories = Object.keys(MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES)
    .sort();
  assertEquals(categories, [
    "confirmation_required",
    "idempotency_conflict",
    "idempotency_pending",
    "invalid_arguments",
    "not_authorized",
    "rate_limited",
    "unavailable",
  ]);
  for (const message of Object.values(
    MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES,
  )) {
    for (const forbidden of [
      "oauth",
      "policy",
      "api_client",
      "user_id",
      "token",
      "sql",
      "rpc",
      "append_execution_update",
    ]) {
      assertFalse(
        message.toLowerCase().includes(forbidden),
        `message must not disclose ${forbidden}`,
      );
    }
  }
});
