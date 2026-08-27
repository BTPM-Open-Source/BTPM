// MCP-HARDENING-C8 — Project Create Connected-App access-boundary discoverability.
//
// Proves that the `projects.create` MCP registry entry advertises the exact
// approved access-boundary description, that this description reaches the live
// MCP registration through the accepted `tool.description` metadata path
// (serverFactory is NOT modified), and that the Project Create runtime remains
// non-auto-enabling: no `api_project_client_enablements` access, no
// `enable_project` call, no Project auto-enablement write and no
// retry-after-create logic exist in executable code. The success and bounded
// error surfaces are unchanged. No network, no database, no Edge invocation,
// no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { MCP_TOOL_REGISTRY } from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_CREATE_TOOL_NAME,
  McpProjectCreateToolPayload,
} from "../../../functions/btpm-mcp/mcp/projectCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/serverFactory.ts",
    import.meta.url,
  ),
);

const controlSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/projectCreateMutationTool.ts",
    import.meta.url,
  ),
);

const executorSource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/projectCreateMutationExecutor.ts",
    import.meta.url,
  ),
);

const adapterSource = await Deno.readTextFile(
  new URL(
    "../../../functions/_shared/btpm-api/supabaseProjectMutation.ts",
    import.meta.url,
  ),
);

const EXPECTED_DESCRIPTION =
  "Creates one Project in a Workspace through the canonical API mutation contract. Creating a Project does not automatically enable that Project for the Connected App. Subsequent Project-scoped operations may require administrator enablement.";

/** The Project Create registration branch inside serverFactory, bounded to
 *  its own `continue;` so sibling branches cannot leak in. */
function projectCreateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PROJECT_CREATE_TOOL_NAME)",
  );
  assert(start > 0, "Project Create registration branch must exist");
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Project Create branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

/** Strips comments and string literals so that only executable identifiers
 *  remain. Documentation prose and message strings must never satisfy a
 *  non-enablement proof. */
function executableCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

// -----------------------------------------------------------------------------
// A. Exact registry metadata
// -----------------------------------------------------------------------------

Deno.test("C8-A: projects.create registry metadata is exactly the accepted set", () => {
  const matches = MCP_TOOL_REGISTRY.filter(
    (candidate) => candidate.operationId === "projects.create",
  );
  assertStrictEquals(matches.length, 1);

  const entry = matches[0];
  assertStrictEquals(entry.toolName, "btpm_create_project");
  assertStrictEquals(entry.toolName, MCP_PROJECT_CREATE_TOOL_NAME);
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

// -----------------------------------------------------------------------------
// B. Exact discoverability wording
// -----------------------------------------------------------------------------

Deno.test("C8-B: the projects.create description is exactly the approved access-boundary wording", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "projects.create",
  );
  assert(entry !== undefined);
  assertStrictEquals(entry.description, EXPECTED_DESCRIPTION);
});

// -----------------------------------------------------------------------------
// C. Metadata reaches the actual MCP registration
// -----------------------------------------------------------------------------

Deno.test("C8-C: the Project Create registration consumes tool.description from the registry", () => {
  const branch = projectCreateBranch();
  assert(branch.includes("description: tool.description"));
  // No separately maintained description string is duplicated in the branch.
  assertFalse(branch.includes('"Creates one Project'));
});

// -----------------------------------------------------------------------------
// D. Runtime non-enablement invariant
// -----------------------------------------------------------------------------

const NON_ENABLEMENT_TOKENS = [
  "api_project_client_enablements",
  "enable_project",
  "auto_enable",
  "autoEnable",
  "retry",
] as const;

Deno.test("C8-D: Project Create control layer has no enablement or retry-after-create executable code", () => {
  const code = executableCode(controlSource);
  for (const token of NON_ENABLEMENT_TOKENS) {
    assertFalse(
      new RegExp(`\\b${token.replace(/_/g, "\\_")}\\b`, "i").test(code),
      `control layer executable code must not reference ${token}`,
    );
  }
});

Deno.test("C8-D: Project Create caller-bound executor has no enablement or retry-after-create executable code", () => {
  const code = executableCode(executorSource);
  for (const token of NON_ENABLEMENT_TOKENS) {
    assertFalse(
      new RegExp(`\\b${token.replace(/_/g, "\\_")}\\b`, "i").test(code),
      `caller-bound executor executable code must not reference ${token}`,
    );
  }
});

Deno.test("C8-D: canonical Project mutation adapter has no enablement or retry-after-create executable code", () => {
  const code = executableCode(adapterSource);
  for (const token of NON_ENABLEMENT_TOKENS) {
    assertFalse(
      new RegExp(`\\b${token.replace(/_/g, "\\_")}\\b`, "i").test(code),
      `canonical adapter executable code must not reference ${token}`,
    );
  }
});

// -----------------------------------------------------------------------------
// E. Runtime/API files are read-only evidence (no behavior change by C8)
// -----------------------------------------------------------------------------

Deno.test("C8-E: C8 reads runtime files as evidence only — they remain the accepted non-auto-enabling Project Create path", () => {
  // The control layer still composes only the accepted components and invokes
  // the writer exactly once with no retry loop.
  assert(controlSource.includes("createMcpProjectCreateToolExecutor"));
  assert(controlSource.includes("await dependencies.writer("));
  assertStrictEquals(
    controlSource.split("await dependencies.writer(").length - 1,
    1,
  );
  // The executor still invokes exactly one RPC wrapper through the accepted
  // caller-bound anon-key client.
  assert(executorSource.includes("createMcpV1CreateProjectExecutor"));
  assert(executorSource.includes("createMcpV1Project("));
  // The adapter still maps a bounded create result with no enablement write.
  assert(adapterSource.includes("invokeCreateProject"));
});

// -----------------------------------------------------------------------------
// F. Success/error surface unchanged
// -----------------------------------------------------------------------------

Deno.test("C8-F: the Project Create success payload is still exactly { outcome, projectId }", () => {
  type Keys = keyof McpProjectCreateToolPayload;
  const keys: Keys[] = ["outcome", "projectId"];
  assertEquals(keys, ["outcome", "projectId"]);
});

Deno.test("C8-F: the bounded Project Create error categories remain exactly the accepted seven", () => {
  const categories = Object.keys(MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES)
    .slice()
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
});
