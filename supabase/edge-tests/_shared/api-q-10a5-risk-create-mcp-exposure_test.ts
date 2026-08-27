// API-Q.10A5 — focused guard for the SECOND MCP mutation exposure and runtime
// wiring of `risks.create` as `btpm_create_risk`.
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
  MCP_RISK_CREATE_TOOL_ERROR_MESSAGES,
  MCP_RISK_CREATE_TOOL_INPUT_SCHEMA,
  MCP_RISK_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/riskCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const mcpIndexSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry stays structurally valid and fully covering", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: risks.create is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "risks.create",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_risk");
  assertStrictEquals(entry.toolName, MCP_RISK_CREATE_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("A3: every exposed mutation requires confirmation", () => {
  const exposed = exposedMcpTools();
  // API-Q.10C4 added the fourth exposed mutation (`blockers.create`) and
  // API-Q.10D4 the fifth (`blockers.update`).
  const mutations = exposed.filter(
    (entry) => entry.operationClass === "mutation",
  );
  for (const mutation of mutations) {
    assertStrictEquals(mutation.confirmation, "required");
  }
});

// API-Q.10B4 exposed `risks.update` as `btpm_update_risk`. What must still
// hold is that no OTHER Risk mutation (for example a delete) is exposed.
Deno.test("A4: no Risk mutation beyond create and update is exposed", () => {
  for (const entry of MCP_TOOL_REGISTRY) {
    if (
      entry.operationClass !== "mutation" ||
      !String(entry.operationId).startsWith("risks.") ||
      entry.operationId === "risks.create" ||
      entry.operationId === "risks.update"
    ) {
      continue;
    }
    assertStrictEquals(entry.exposure, "not_exposed");
  }
});

// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the A4 control layer, not the writer adapter", () => {
  assert(serverFactorySource.includes('from "./riskCreateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_RISK_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_RISK_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_RISK_CREATE_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("riskCreateMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1CreateRiskExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});

Deno.test("B2: serverFactory registers exactly one Risk-create branch", () => {
  const occurrences =
    serverFactorySource.split("MCP_RISK_CREATE_TOOL_NAME").length - 1;
  assert(occurrences >= 2, "expected import plus branch guard");
  assertStrictEquals(
    serverFactorySource.split("executors.riskCreate(").length - 1,
    1,
  );
  assert(
    serverFactorySource.includes("readonly riskCreate: McpRiskCreateToolExecutor"),
  );
});

Deno.test("B3: the factory declares no Supabase, service-role or RPC surface", () => {
  for (
    const forbidden of [
      "createClient",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "Deno.env",
      ".rpc(",
      "mcp_v1_create_risk",
      "api_v1_create_risk",
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

Deno.test("C1: the runtime builds the caller-bound Risk writer with the anon key", () => {
  assert(mcpIndexSource.includes("riskCreateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1CreateRiskExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly riskCreateWriter: McpV1CreateRiskExecutor;",
    ),
  );

  const builderIndex = mcpIndexSource.indexOf("createMcpV1CreateRiskExecutor(");
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Risk writer must be built with the anon key",
  );
  assertFalse(
    builderCall.includes("serviceRole"),
    "the Risk writer must never receive a service-role credential",
  );
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assert(mcpIndexSource.includes("createMcpRiskCreateToolExecutor({"));
  assert(mcpIndexSource.includes("writer: runtime.riskCreateWriter,"));
  assert(mcpIndexSource.includes("riskCreate,"));
  assert(mcpIndexSource.includes("riskCreateWriter,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpRiskCreateToolExecutor({",
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

Deno.test("C3: no generic mutation dispatcher is introduced", () => {
  for (
    const forbidden of [
      "mutationDispatcher",
      "genericMutation",
      "executeMutationByName",
      "dispatchMutation",
    ]
  ) {
    assertFalse(
      mcpIndexSource.includes(forbidden),
      `btpm-mcp/index.ts references ${forbidden}`,
    );
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory references ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// D. Bounded contract surface
// -----------------------------------------------------------------------------

Deno.test("D1: the exposed input schema stays the strict ten-field envelope", () => {
  const keys = Object.keys(MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.shape).sort();
  assertEquals(keys, [
    "confirmation",
    "description",
    "idempotencyKey",
    "impact",
    "likelihood",
    "mitigationPlan",
    "status",
    "targetId",
    "targetType",
    "title",
  ]);
});

Deno.test("D2: bounded error messages disclose no identity or database detail", () => {
  const messages = Object.values(MCP_RISK_CREATE_TOOL_ERROR_MESSAGES);
  assert(messages.length >= 7);
  for (const message of messages) {
    assert(message.length > 0);
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_create_risk",
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
