// API-Q.10B4 — focused guard for the THIRD MCP mutation exposure and runtime
// wiring of `risks.update` as `btpm_update_risk`.
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
  MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA,
  MCP_RISK_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/riskUpdateMutationTool.ts";

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

Deno.test("A2: risks.update is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "risks.update",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_update_risk");
  assertStrictEquals(entry.toolName, MCP_RISK_UPDATE_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  // The optimistic-concurrency token remains mandatory for Risk update.
  assertStrictEquals(entry.concurrencyToken, "required");
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

// MCP-HARDENING-C1B — obsolete whole-product MCP cardinality/inventory
// baselines removed; the canonical registry stays the source of truth.

// -----------------------------------------------------------------------------
// B. Factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: serverFactory imports the B3 control layer, not the writer adapter", () => {
  assert(serverFactorySource.includes('from "./riskUpdateMutationTool.ts"'));
  assert(serverFactorySource.includes("MCP_RISK_UPDATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES"));
  assertFalse(
    serverFactorySource.includes("riskUpdateMutationExecutor.ts"),
    "serverFactory must not import the caller-bound writer adapter",
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1UpdateRiskExecutor"),
    "serverFactory must not construct the caller-bound writer",
  );
});

Deno.test("B2: serverFactory registers exactly one Risk-update branch", () => {
  const occurrences =
    serverFactorySource.split("MCP_RISK_UPDATE_TOOL_NAME").length - 1;
  assert(occurrences >= 2, "expected import plus branch guard");
  assertStrictEquals(
    serverFactorySource.split("executors.riskUpdate(").length - 1,
    1,
  );
  assert(
    serverFactorySource.includes("readonly riskUpdate: McpRiskUpdateToolExecutor"),
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
      "mcp_v1_update_risk",
      "api_v1_update_risk",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory references ${forbidden}`,
    );
  }
});

Deno.test("B4: the factory never reads, refreshes or retries the concurrency token", () => {
  for (
    const forbidden of [
      "expectedUpdatedAt =",
      "refreshUpdatedAt",
      "readBeforeWrite",
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

Deno.test("C1: the runtime builds the caller-bound Risk-update writer with the anon key", () => {
  assert(mcpIndexSource.includes("riskUpdateMutationExecutor.ts"));
  assert(mcpIndexSource.includes("createMcpV1UpdateRiskExecutor("));
  assert(
    mcpIndexSource.includes(
      "readonly riskUpdateWriter: McpV1UpdateRiskExecutor;",
    ),
  );

  const builderIndex = mcpIndexSource.indexOf("createMcpV1UpdateRiskExecutor(");
  assert(builderIndex > 0);
  const builderCall = mcpIndexSource.slice(builderIndex, builderIndex + 320);
  assert(
    builderCall.includes("supabaseAnonKey"),
    "the Risk-update writer must be built with the anon key",
  );
  assertFalse(
    builderCall.includes("serviceRole"),
    "the Risk-update writer must never receive a service-role credential",
  );
});

Deno.test("C2: the per-request control executor is created and passed to the factory", () => {
  assert(mcpIndexSource.includes("createMcpRiskUpdateToolExecutor({"));
  assert(mcpIndexSource.includes("writer: runtime.riskUpdateWriter,"));
  assert(mcpIndexSource.includes("riskUpdate,"));
  assert(mcpIndexSource.includes("riskUpdateWriter,"));

  const executorIndex = mcpIndexSource.indexOf(
    "createMcpRiskUpdateToolExecutor({",
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
  const keys = Object.keys(MCP_RISK_UPDATE_TOOL_INPUT_SCHEMA.shape).sort();
  assertEquals(keys, [
    "confirmation",
    "description",
    "expectedUpdatedAt",
    "idempotencyKey",
    "impact",
    "likelihood",
    "mitigationPlan",
    "riskId",
    "status",
    "title",
  ]);
});

Deno.test("D2: bounded error messages disclose no identity or database detail", () => {
  const messages = Object.values(MCP_RISK_UPDATE_TOOL_ERROR_MESSAGES);
  assert(messages.length >= 7);
  for (const message of messages) {
    assert(message.length > 0);
    for (
      const leak of [
        "service_role",
        "sql",
        "postgres",
        "mcp_v1_update_risk",
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
