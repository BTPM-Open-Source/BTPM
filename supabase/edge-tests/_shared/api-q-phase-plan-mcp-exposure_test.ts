// API-Q Phase Plan Step 4 — MCP exposure and runtime wiring proofs.
//
// Scope: exposure of the already-accepted canonical `phases.plan` capability as
// the MCP tool `btpm_plan_phase`, plus the wiring of the accepted Step 3 control
// layer and Step 2 caller-bound writer into the existing `btpm-mcp` runtime.
//
// No new capability, route, wrapper, provenance path or authority rule is
// introduced by this step.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import { MCP_PHASE_PLAN_TOOL_NAME } from "../../functions/btpm-mcp/mcp/phasePlanMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);
const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);


// -----------------------------------------------------------------------------
// A. Registry exposure
// -----------------------------------------------------------------------------

Deno.test("A1: the canonical registry stays structurally valid and fully covering", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: phases.plan is exposed with the accepted mutation metadata", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "phases.plan",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_plan_phase");
  assertStrictEquals(entry.toolName, MCP_PHASE_PLAN_TOOL_NAME);
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
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
    assert(entry !== undefined, `${operationId} missing`);
    assertStrictEquals(entry.exposure, "not_exposed");
  }
});

// -----------------------------------------------------------------------------
// B. Server factory wiring
// -----------------------------------------------------------------------------

Deno.test("B1: server factory registers btpm_plan_phase from the Step 3 control layer", () => {
  assert(serverFactorySource.includes("phasePlanMutationTool.ts"));
  assert(serverFactorySource.includes("MCP_PHASE_PLAN_TOOL_NAME"));
  assert(serverFactorySource.includes("phasePlan"));
});

Deno.test("B2: server factory maps the bounded Project-window extension outcome", () => {
  assert(serverFactorySource.includes("project_window_extension_required"));
  for (
    const field of [
      "projectCurrentStart",
      "projectCurrentTargetEnd",
      "projectProposedStart",
      "projectProposedTargetEnd",
      "requestedPhaseStart",
      "requestedPhaseEnd",
    ]
  ) {
    assert(
      serverFactorySource.includes(field),
      `missing bounded impact field: ${field}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: runtime constructs the caller-bound Step 2 Phase Plan writer", () => {
  assert(runtimeSource.includes("phasePlanMutationExecutor.ts"));
  assert(runtimeSource.includes("createMcpV1PlanPhaseExecutor"));
  assert(runtimeSource.includes("phasePlanWriter"));
});

Deno.test("C2: runtime builds the per-request Step 3 Phase Plan control layer", () => {
  assert(runtimeSource.includes("createMcpPhasePlanToolExecutor"));
  assert(runtimeSource.includes("writer: runtime.phasePlanWriter"));
});

Deno.test("C3: runtime never calls the REST wrapper or planning primitives", () => {
  for (
    const forbidden of [
      "api_v1_plan_phase",
      "preview_phase_planning_change",
      "apply_phase_planning_change",
      "SUPABASE_SERVICE_ROLE_KEY\", // phase plan",
    ]
  ) {
    assert(
      !runtimeSource.includes(forbidden),
      `runtime must not reference ${forbidden}`,
    );
  }
});
