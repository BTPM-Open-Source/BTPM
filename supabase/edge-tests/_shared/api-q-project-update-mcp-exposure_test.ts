// API-Q Project Update Step 4 — MCP exposure + runtime wiring evidence.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, and nothing about the future exposure state of
// projects.transition, Program mutations or Portfolio. Those are future-step
// concerns owned by their own steps.

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
  MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/projectUpdateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function projectUpdateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PROJECT_UPDATE_TOOL_NAME)",
  );
  assert(start > 0, "Project Update registration branch must exist");
  // Bound the slice to this branch only, so sibling registration branches can
  // never leak into Project Update assertions.
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Project Update branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function projectUpdateControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const projectUpdate = createMcpProjectUpdateToolExecutor({",
  );
  assert(start > 0, "Project Update control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function projectUpdateWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const projectUpdateWriter: McpV1UpdateProjectExecutor =",
  );
  assert(start > 0, "Project Update writer construction must exist");
  const end = runtimeSource.indexOf(");", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 2);
}

// ---------------------------------------------------------------------------
// A. Registry
// ---------------------------------------------------------------------------

Deno.test("A1: canonical MCP registry remains structurally valid", () => {
  assertEquals(validateMcpToolRegistry(MCP_TOOL_REGISTRY), []);
  assertEquals(validateMcpRegistryCoverage(MCP_TOOL_REGISTRY), []);
});

Deno.test("A2: projects.update exists exactly once and is exposed", () => {
  const byOperation = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "projects.update",
  );
  assertStrictEquals(byOperation.length, 1);

  const byToolName = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.toolName === MCP_PROJECT_UPDATE_TOOL_NAME,
  );
  assertStrictEquals(byToolName.length, 1);
  assertStrictEquals(byToolName[0], byOperation[0]);

  const entry = byOperation[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_update_project");
  assertStrictEquals(entry.title, "Update BTPM Project");
  assertStrictEquals(
    entry.description,
    "Updates one Project through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "required");
});

// ---------------------------------------------------------------------------
// B. Server factory ownership
// ---------------------------------------------------------------------------

Deno.test("B1: serverFactory imports only the Step 3 control contract", () => {
  assert(serverFactorySource.includes('from "./projectUpdateMutationTool.ts"'));
  for (
    const symbol of [
      "MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES",
      "MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA",
      "MCP_PROJECT_UPDATE_TOOL_NAME",
      "McpProjectUpdateToolArguments",
      "McpProjectUpdateToolExecutor",
    ]
  ) {
    assert(serverFactorySource.includes(symbol), `missing ${symbol}`);
  }
});

Deno.test("B2: serverFactory never imports the writer or REST adapter", () => {
  assertFalse(serverFactorySource.includes("projectUpdateMutationExecutor.ts"));
  assertFalse(
    serverFactorySource.includes("createMcpV1UpdateProjectExecutor"),
  );
  assertFalse(serverFactorySource.includes("supabaseProjectMutation.ts"));
});

// ---------------------------------------------------------------------------
// C. Factory registration
// ---------------------------------------------------------------------------

Deno.test("C1: exactly one Project Update dependency and registration", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly projectUpdate: McpProjectUpdateToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PROJECT_UPDATE_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.projectUpdate(args)"),
    1,
  );
});

Deno.test("C2: registration branch uses the accepted bounded contract", () => {
  const branch = projectUpdateBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(branch.includes("inputSchema: MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(
    branch.includes(
      "MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
  assert(branch.includes("continue;"));
});

// ---------------------------------------------------------------------------
// D. Runtime imports
// ---------------------------------------------------------------------------

Deno.test("D1: runtime imports Step 3 control + Step 2 writer factories", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpProjectUpdateToolExecutor } from "./mcp/projectUpdateMutationTool.ts";',
    ),
  );
  assert(
    runtimeSource.includes('from "./mcp/projectUpdateMutationExecutor.ts"'),
  );
  for (
    const symbol of [
      "createMcpV1UpdateProjectExecutor",
      "McpUpdateProjectClientFactory",
      "McpV1UpdateProjectExecutor",
    ]
  ) {
    assert(runtimeSource.includes(symbol), `missing ${symbol}`);
  }
  assertFalse(runtimeSource.includes("updateApiV1Project"));
});

// ---------------------------------------------------------------------------
// E. Runtime writer contract
// ---------------------------------------------------------------------------

Deno.test("E1: projectUpdateWriter exists in both runtime interfaces", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly projectUpdateWriter: McpV1UpdateProjectExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(runtimeSource, "projectUpdateWriter: input.projectUpdateWriter,"),
    1,
  );
});

Deno.test("E2: exactly one caller-bound anon-key writer construction", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1UpdateProjectExecutor("),
    1,
  );
  const block = projectUpdateWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpUpdateProjectClientFactory"));

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
    assertFalse(block.includes(forbidden), `writer must not use ${forbidden}`);
  }
});

Deno.test("E3: writer is passed once into createBtpmMcpRuntime", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "\n    projectUpdateWriter,\n"),
    1,
  );
});

// ---------------------------------------------------------------------------
// F. Per-request control construction
// ---------------------------------------------------------------------------

Deno.test("F1: exactly one per-request control executor with accepted deps", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpProjectUpdateToolExecutor({"),
    1,
  );
  const block = projectUpdateControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.projectUpdateWriter,"));
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
      "tenant",
      "organization",
      "workspace",
      "enablement",
      "capability",
      "operationId",
    ]
  ) {
    assertFalse(
      block.toLowerCase().includes(forbidden.toLowerCase()),
      `control construction must not receive ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// G. Server handoff
// ---------------------------------------------------------------------------

Deno.test("G1: projectUpdate is handed to createBtpmMcpServer exactly once", () => {
  const start = runtimeSource.indexOf("createBtpmMcpServer(executionContext, {");
  assert(start > 0);
  const end = runtimeSource.indexOf("}),", start);
  assert(end > start);
  const handoff = runtimeSource.slice(start, end);
  assertStrictEquals(occurrences(handoff, "projectUpdate,"), 1);
});

// ---------------------------------------------------------------------------
// H. Business / security boundaries
// ---------------------------------------------------------------------------

Deno.test("H1: no Project Update business internals in wiring surfaces", () => {
  const controlBlock = projectUpdateControlBlock();
  const writerBlock = projectUpdateWriterBlock();
  const branch = projectUpdateBranch();

  for (
    const forbidden of [
      "mcp_v1_update_project",
      "api_v1_update_project",
      "apply_project_update",
      "api_project_client_enablements",
      "enable_project",
      "buildApiV1UpdateProjectIdempotencyPayload",
      "parseApiV1UpdateProjectBody",
      "hashCanonicalPayload",
      "requireMcpMutationConfirmation",
    ]
  ) {
    assertFalse(serverFactorySource.includes(forbidden), `factory: ${forbidden}`);
    assertFalse(controlBlock.includes(forbidden), `control: ${forbidden}`);
    assertFalse(writerBlock.includes(forbidden), `writer: ${forbidden}`);
    assertFalse(branch.includes(forbidden), `branch: ${forbidden}`);
  }
});

Deno.test("H2: no direct database access or concurrency handling in wiring", () => {
  for (const block of [projectUpdateControlBlock(), projectUpdateWriterBlock()]) {
    assertFalse(block.includes(".rpc("));
    assertFalse(block.includes(".from("));
    assertFalse(block.includes("expectedUpdatedAt"));
    assertFalse(block.includes("updated_at"));
    assertFalse(block.includes("retry"));
    assertFalse(block.includes("Date.parse"));
  }
  const branch = projectUpdateBranch();
  assertFalse(branch.includes(".rpc("));
  assertFalse(branch.includes(".from("));
  assertFalse(branch.includes("expectedUpdatedAt"));
  assertFalse(branch.includes("retry"));
});

// ---------------------------------------------------------------------------
// I. Bounded external errors
// ---------------------------------------------------------------------------

Deno.test("I1: exactly the accepted eight bounded categories remain", () => {
  assertEquals(
    Object.keys(MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES).sort(),
    [
      "confirmation_required",
      "idempotency_conflict",
      "idempotency_pending",
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "stale_project",
      "unavailable",
    ],
  );
});

Deno.test("I2: bounded messages disclose no internal detail", () => {
  const forbidden = [
    "sql",
    "postgres",
    "sqlstate",
    "oauth",
    "client_id",
    "bearer",
    "token",
    "service role",
    "service_role",
    "rpc",
    "mcp_v1_",
    "apply_project_update",
    "timestamp",
  ];
  for (const message of Object.values(MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES)) {
    const lower = message.toLowerCase();
    for (const needle of forbidden) {
      assertFalse(lower.includes(needle), `"${message}" discloses ${needle}`);
    }
  }
});
