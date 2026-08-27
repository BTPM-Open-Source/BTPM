// API-Q Project Create Step 4 — MCP exposure + runtime wiring evidence.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, and nothing about the future exposure state of
// projects.update, projects.transition or Program mutations. Those are
// future-step concerns owned by their own steps.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/projectCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function projectCreateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PROJECT_CREATE_TOOL_NAME)",
  );
  assert(start > 0, "Project Create registration branch must exist");
  // Bound the slice to this branch only, so later sibling registration
  // branches can never leak into Project Create assertions.
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Project Create branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function projectCreateControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const projectCreate = createMcpProjectCreateToolExecutor({",
  );
  assert(start > 0, "Project Create control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function projectCreateWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const projectCreateWriter: McpV1CreateProjectExecutor =",
  );
  assert(start > 0, "Project Create writer construction must exist");
  const end = runtimeSource.indexOf(");", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 2);
}

// -----------------------------------------------------------------------------
// A. Registry
// -----------------------------------------------------------------------------

Deno.test("A1: registry validates structurally and by coverage", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: projects.create exists exactly once, exposed, with accepted metadata", () => {
  const matches = MCP_TOOL_REGISTRY.filter(
    (candidate) => candidate.operationId === "projects.create",
  );
  assertStrictEquals(matches.length, 1);
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter(
      (candidate) => candidate.toolName === "btpm_create_project",
    ).length,
    1,
  );

  const entry = matches[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_project");
  assertStrictEquals(entry.toolName, MCP_PROJECT_CREATE_TOOL_NAME);
  assertStrictEquals(entry.title, "Create BTPM Project");
  assertStrictEquals(
    entry.description,
    "Creates one Project in a Workspace through the canonical API mutation contract. Creating a Project does not automatically enable that Project for the Connected App. Subsequent Project-scoped operations may require administrator enablement.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

// -----------------------------------------------------------------------------
// B. Server factory
// -----------------------------------------------------------------------------

Deno.test("B1: server factory imports only the Step 3 Project Create control layer", () => {
  assert(serverFactorySource.includes("./projectCreateMutationTool.ts"));
  assert(serverFactorySource.includes("MCP_PROJECT_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES"));
  assert(serverFactorySource.includes("McpProjectCreateToolArguments"));
  assert(serverFactorySource.includes("McpProjectCreateToolExecutor"));

  assertFalse(serverFactorySource.includes("projectCreateMutationExecutor.ts"));
  assertFalse(
    serverFactorySource.includes("createMcpV1CreateProjectExecutor"),
  );
  assertFalse(serverFactorySource.includes("supabaseProjectMutation.ts"));
});

Deno.test("B2: exactly one Project Create executor dependency and branch", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly projectCreate: McpProjectCreateToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PROJECT_CREATE_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.projectCreate("),
    1,
  );
});

Deno.test("B3: the branch uses the accepted bounded contract only", () => {
  const branch = projectCreateBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(branch.includes("inputSchema: MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("await executors.projectCreate(args)"));
  assert(
    branch.includes("MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES[result.category]"),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: runtime imports both the Step 3 control factory and Step 2 writer", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpProjectCreateToolExecutor } from "./mcp/projectCreateMutationTool.ts";',
    ),
  );
  assert(runtimeSource.includes("createMcpV1CreateProjectExecutor"));
  assert(runtimeSource.includes("McpCreateProjectClientFactory"));
  assert(runtimeSource.includes("McpV1CreateProjectExecutor"));
  assert(runtimeSource.includes("./mcp/projectCreateMutationExecutor.ts"));
});

Deno.test("C2: runtime contract carries exactly one projectCreateWriter each", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly projectCreateWriter: McpV1CreateProjectExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(runtimeSource, "projectCreateWriter: input.projectCreateWriter,"),
    1,
  );
});

Deno.test("C3: exactly one per-request control executor with the exact dependencies", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpProjectCreateToolExecutor({"),
    1,
  );
  const block = projectCreateControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.projectCreateWriter,"));
  assert(
    block.includes(
      "rateLimitProfileResolver: runtime.rateLimitProfileResolver,",
    ),
  );
  assert(block.includes("rateLimitStore: runtime.rateLimitStore,"));
  assert(block.includes("now: () => runtime.now(),"));

  for (
    const forbidden of [
      "authorized",
      "serviceRole",
      "privileged",
      "supabase",
      "workspace",
      "organization",
      "tenant",
      "capability",
      "operationId",
      "enablement",
    ]
  ) {
    assertFalse(
      block.toLowerCase().includes(forbidden.toLowerCase()),
      `control block must not receive ${forbidden}`,
    );
  }
});

Deno.test("C4: projectCreate is passed exactly once to createBtpmMcpServer", () => {
  assertStrictEquals(occurrences(runtimeSource, "\n        projectCreate,\n"), 1);
});

// -----------------------------------------------------------------------------
// D. Writer construction
// -----------------------------------------------------------------------------

Deno.test("D1: exactly one anon-key caller-bound writer construction site", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1CreateProjectExecutor("),
    1,
  );
  const block = projectCreateWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpCreateProjectClientFactory"));

  for (
    const forbidden of [
      "serviceRoleKey",
      "privilegedClient",
      "rateLimitClient",
      "authorizationStore",
      "authClient",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]
  ) {
    assertFalse(
      block.includes(forbidden),
      `writer construction must not reference ${forbidden}`,
    );
  }
  assertStrictEquals(
    occurrences(runtimeSource, "\n    projectCreateWriter,\n"),
    1,
  );
});

// -----------------------------------------------------------------------------
// E. Business / security boundaries
// -----------------------------------------------------------------------------

Deno.test("E1: neither factory nor runtime touches Project business internals", () => {
  for (
    const forbidden of [
      "mcp_v1_create_project",
      "api_v1_create_project",
      "apply_project_create_blank",
      "api_project_client_enablements",
      "enable_project",
      "hashCanonicalPayload",
      "validateIdempotencyKey",
      "requireMcpMutationConfirmation",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory must not reference ${forbidden}`,
    );
    assertFalse(
      runtimeSource.includes(forbidden),
      `runtime must not reference ${forbidden}`,
    );
  }
});

Deno.test("E2: no Project retry or auto-enablement wiring exists", () => {
  const branch = projectCreateBranch();
  assertFalse(branch.toLowerCase().includes("retry"));
  assertFalse(branch.toLowerCase().includes("enable"));
  const block = projectCreateControlBlock();
  assertFalse(block.toLowerCase().includes("retry"));
});

// -----------------------------------------------------------------------------
// F. Bounded external messages
// -----------------------------------------------------------------------------

Deno.test("F1: the seven bounded Project Create messages disclose nothing internal", () => {
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

  for (const message of Object.values(MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES)) {
    assert(message.length > 0);
    const lowered = message.toLowerCase();
    for (
      const forbidden of [
        "sql",
        "postgres",
        "sqlstate",
        "42501",
        "oauth",
        "client_id",
        "bearer",
        "token",
        "service_role",
        "service role",
        "rpc",
        "mcp_v1_",
        "api_v1_",
        "apply_project",
      ]
    ) {
      assertFalse(
        lowered.includes(forbidden),
        `${message} must not disclose ${forbidden}`,
      );
    }
  }
});
