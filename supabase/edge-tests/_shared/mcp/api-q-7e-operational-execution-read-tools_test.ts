// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../functions/btpm-mcp/mcp/api-q-7e-operational-execution-read-tools_test.ts', import.meta.url).href;
// API-Q.7E — Focused, table-driven contract proofs for the seven new MCP
// business-read adapters: `risks.get`, `risks.get_by_id`, `blockers.get`,
// `blockers.get_by_id`, `execution_updates.get`, `phases.get_by_id` and
// `tasks.get_by_id`.
//
// End-to-end behavior (authorization, provenance, rate limiting, delegated
// read, bounded failure) is proven against the live MCP shell in
// `btpm-mcp/index_test.ts`. This file proves the local, static contracts:
// canonical route reuse, registry metadata, advertised input schemas, tool-name
// uniqueness and adapter purity.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
} from "../../../functions/_shared/btpm-api/routes/blockers.ts";
import {
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
} from "../../../functions/_shared/btpm-api/routes/risks.ts";
import { EXECUTION_UPDATES_READ_ROUTE } from "../../../functions/_shared/btpm-api/routes/executionUpdates.ts";
import { PHASE_DETAIL_ROUTE } from "../../../functions/_shared/btpm-api/routes/phases.ts";
import { TASK_DETAIL_ROUTE } from "../../../functions/_shared/btpm-api/routes/tasks.ts";
import { MCP_TOOL_REGISTRY } from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  MCP_BLOCKER_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_BLOCKER_DETAIL_TOOL_NAME,
  MCP_BLOCKER_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_BLOCKERS_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_BLOCKERS_TOOL_NAME,
  MCP_PROJECT_RISKS_TOOL_INPUT_SCHEMA,
  MCP_PROJECT_RISKS_TOOL_NAME,
  MCP_RISK_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_RISK_DETAIL_TOOL_NAME,
  MCP_RISK_TOOL_ERROR_MESSAGES,
} from "../../../functions/btpm-mcp/mcp/operationalIssueReadTools.ts";
import {
  MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_EXECUTION_UPDATES_TOOL_INPUT_SCHEMA,
  MCP_EXECUTION_UPDATES_TOOL_NAME,
  MCP_PHASE_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_PHASE_DETAIL_TOOL_NAME,
  MCP_PHASE_TOOL_ERROR_MESSAGES,
  MCP_TASK_DETAIL_TOOL_INPUT_SCHEMA,
  MCP_TASK_DETAIL_TOOL_NAME,
  MCP_TASK_TOOL_ERROR_MESSAGES,
} from "../../../functions/btpm-mcp/mcp/executionContextReadTools.ts";

interface NewToolCase {
  readonly operationId: string;
  readonly toolName: string;
  readonly canonicalRouteId: string;
  readonly requiredKeys: readonly string[];
  readonly optionalKeys: readonly string[];
  readonly schema: { safeParse(input: unknown): { success: boolean } };
  readonly errorMessages: Readonly<Record<string, string>>;
  readonly resultShape: "bounded_collection" | "single_object";
}

const NEW_TOOL_CASES: readonly NewToolCase[] = Object.freeze([
  {
    operationId: "risks.get",
    toolName: MCP_PROJECT_RISKS_TOOL_NAME,
    canonicalRouteId: RISK_PROJECT_COLLECTION_ROUTE.id,
    requiredKeys: ["projectId"],
    optionalKeys: ["limit", "cursor"],
    schema: MCP_PROJECT_RISKS_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_RISK_TOOL_ERROR_MESSAGES,
    resultShape: "bounded_collection",
  },
  {
    operationId: "risks.get_by_id",
    toolName: MCP_RISK_DETAIL_TOOL_NAME,
    canonicalRouteId: RISK_DETAIL_ROUTE.id,
    requiredKeys: ["riskId"],
    optionalKeys: [],
    schema: MCP_RISK_DETAIL_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_RISK_TOOL_ERROR_MESSAGES,
    resultShape: "single_object",
  },
  {
    operationId: "blockers.get",
    toolName: MCP_PROJECT_BLOCKERS_TOOL_NAME,
    canonicalRouteId: BLOCKER_PROJECT_COLLECTION_ROUTE.id,
    requiredKeys: ["projectId"],
    optionalKeys: ["limit", "cursor"],
    schema: MCP_PROJECT_BLOCKERS_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_BLOCKER_TOOL_ERROR_MESSAGES,
    resultShape: "bounded_collection",
  },
  {
    operationId: "blockers.get_by_id",
    toolName: MCP_BLOCKER_DETAIL_TOOL_NAME,
    canonicalRouteId: BLOCKER_DETAIL_ROUTE.id,
    requiredKeys: ["blockerId"],
    optionalKeys: [],
    schema: MCP_BLOCKER_DETAIL_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_BLOCKER_TOOL_ERROR_MESSAGES,
    resultShape: "single_object",
  },
  {
    operationId: "execution_updates.get",
    toolName: MCP_EXECUTION_UPDATES_TOOL_NAME,
    canonicalRouteId: EXECUTION_UPDATES_READ_ROUTE.id,
    requiredKeys: ["targetType", "targetId"],
    optionalKeys: ["limit", "cursor"],
    schema: MCP_EXECUTION_UPDATES_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES,
    resultShape: "bounded_collection",
  },
  {
    operationId: "phases.get_by_id",
    toolName: MCP_PHASE_DETAIL_TOOL_NAME,
    canonicalRouteId: PHASE_DETAIL_ROUTE.id,
    requiredKeys: ["phaseId"],
    optionalKeys: [],
    schema: MCP_PHASE_DETAIL_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_PHASE_TOOL_ERROR_MESSAGES,
    resultShape: "single_object",
  },
  {
    operationId: "tasks.get_by_id",
    toolName: MCP_TASK_DETAIL_TOOL_NAME,
    canonicalRouteId: TASK_DETAIL_ROUTE.id,
    requiredKeys: ["taskId"],
    optionalKeys: [],
    schema: MCP_TASK_DETAIL_TOOL_INPUT_SCHEMA,
    errorMessages: MCP_TASK_TOOL_ERROR_MESSAGES,
    resultShape: "single_object",
  },
]);

Deno.test("API-Q.7E: each new tool reuses the canonical read route identity", () => {
  for (const testCase of NEW_TOOL_CASES) {
    assertStrictEquals(testCase.canonicalRouteId, testCase.operationId);
  }
});

Deno.test("API-Q.7E: each new tool is registered exactly once as an exposed read", () => {
  for (const testCase of NEW_TOOL_CASES) {
    const matches = MCP_TOOL_REGISTRY.filter(
      (entry) => entry.operationId === testCase.operationId,
    );
    assertStrictEquals(matches.length, 1, testCase.operationId);
    const entry = matches[0];
    assertStrictEquals(entry.toolName, testCase.toolName);
    assertStrictEquals(entry.operationClass, "read");
    assertStrictEquals(entry.exposure, "exposed");
    assertStrictEquals(entry.confirmation, "not_required");
    assertStrictEquals(entry.resultShape, testCase.resultShape);
    assertStrictEquals(entry.concurrencyToken, "not_applicable");
  }
});

Deno.test("API-Q.7E: advertised tool names are unique across the whole registry", () => {
  const names = MCP_TOOL_REGISTRY.map((entry) => entry.toolName);
  assertStrictEquals(new Set(names).size, names.length);
  for (const testCase of NEW_TOOL_CASES) {
    assert(names.includes(testCase.toolName), testCase.toolName);
  }
});

Deno.test("API-Q.7E: input schemas require exactly the canonical identity arguments", () => {
  for (const testCase of NEW_TOOL_CASES) {
    // Missing a required key must fail schema validation.
    for (const required of testCase.requiredKeys) {
      const args: Record<string, unknown> = {};
      for (const key of testCase.requiredKeys) {
        if (key !== required) args[key] = "value";
      }
      assertStrictEquals(
        testCase.schema.safeParse(args).success,
        false,
        `${testCase.toolName} must require ${required}`,
      );
    }
    // All required keys present is schema-valid; canonical parsers own the rest.
    const complete: Record<string, unknown> = {};
    for (const key of testCase.requiredKeys) complete[key] = "value";
    assertStrictEquals(testCase.schema.safeParse(complete).success, true);
    // Optional paging keys stay optional at the schema layer.
    for (const optional of testCase.optionalKeys) {
      const withOptional = { ...complete };
      withOptional[optional] = optional === "limit" ? 10 : "cursor-value";
      assertStrictEquals(
        testCase.schema.safeParse(withOptional).success,
        true,
        `${testCase.toolName} must accept optional ${optional}`,
      );
    }
  }
});

Deno.test("API-Q.7E: every tool exposes exactly the four bounded error messages", () => {
  for (const testCase of NEW_TOOL_CASES) {
    assertEquals(Object.keys(testCase.errorMessages).sort(), [
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "unavailable",
    ]);
    for (const message of Object.values(testCase.errorMessages)) {
      assert(message.length > 0);
      for (
        const forbidden of ["42501", "policy", "select ", "supabase", "token"]
      ) {
        assertStrictEquals(
          message.toLowerCase().includes(forbidden),
          false,
          `${testCase.toolName} message must not disclose ${forbidden}`,
        );
      }
    }
  }
});

Deno.test("API-Q.7E: the new adapter modules are pure thin adapters", async () => {
  for (
    const module of [
      "./operationalIssueReadTools.ts",
      "./executionContextReadTools.ts",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(module, __BTPM_SRC_BASE__));
    for (
      const forbidden of [
        "Deno.env",
        "createClient",
        "SERVICE_ROLE",
        "console.log",
        "console.warn",
        "console.error",
        "setTimeout",
        "Deno.serve",
        "API_V1_ROUTE_ALLOWLIST",
      ]
    ) {
      assertStrictEquals(
        source.includes(forbidden),
        false,
        `${module} must not contain ${forbidden}`,
      );
    }
    for (
      const reused of [
        "enforceApiRateLimit",
        "buildAuthenticatedApiContextFromMcp",
      ]
    ) {
      assert(source.includes(reused), `${module} must reuse ${reused}`);
    }
  }
});
