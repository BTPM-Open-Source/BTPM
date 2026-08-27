// API-Q Program Update Step 4 — MCP exposure + runtime wiring evidence.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, nothing about total mutation counts, and nothing
// about the future exposure state of Portfolio or any other operation. Those
// are future-step concerns owned by their own steps.

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
  MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES,
  MCP_PROGRAM_UPDATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/programUpdateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function programUpdateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PROGRAM_UPDATE_TOOL_NAME)",
  );
  assert(start > 0, "Program Update registration branch must exist");
  // Bound the slice to this branch only, so sibling registration branches can
  // never leak into Program Update assertions.
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Program Update branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function programUpdateControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const programUpdate = createMcpProgramUpdateToolExecutor({",
  );
  assert(start > 0, "Program Update control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function programUpdateWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const programUpdateWriter: McpV1UpdateProgramExecutor =",
  );
  assert(start > 0, "Program Update writer construction must exist");
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

Deno.test("A2: programs.update exists exactly once and is exposed", () => {
  const byOperation = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "programs.update",
  );
  assertStrictEquals(byOperation.length, 1);

  const byToolName = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.toolName === MCP_PROGRAM_UPDATE_TOOL_NAME,
  );
  assertStrictEquals(byToolName.length, 1);
  assertStrictEquals(byToolName[0], byOperation[0]);

  const entry = byOperation[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_update_program");
  assertStrictEquals(entry.title, "Update BTPM Program");
  assertStrictEquals(
    entry.description,
    "Updates one Program through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "required");
});

Deno.test("A3: accepted programs.create exposure is preserved", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "programs.create",
  );
  assert(entry !== undefined, "programs.create must exist in the registry");
  assertStrictEquals(entry!.exposure, "exposed");
  assertStrictEquals(entry!.toolName, "btpm_create_program");
});

// ---------------------------------------------------------------------------
// B. Server factory ownership
// ---------------------------------------------------------------------------

Deno.test("B1: serverFactory imports only the Step 3 control contract", () => {
  assert(serverFactorySource.includes('from "./programUpdateMutationTool.ts"'));
  for (
    const symbol of [
      "MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES",
      "MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA",
      "MCP_PROGRAM_UPDATE_TOOL_NAME",
      "McpProgramUpdateToolArguments",
      "McpProgramUpdateToolExecutor",
    ]
  ) {
    assert(serverFactorySource.includes(symbol), `missing ${symbol}`);
  }
});

Deno.test("B2: serverFactory never imports the writer or base adapter", () => {
  assertFalse(serverFactorySource.includes("programUpdateMutationExecutor.ts"));
  assertFalse(
    serverFactorySource.includes("createMcpV1UpdateProgramExecutor"),
  );
  assertFalse(serverFactorySource.includes("updateMcpV1Program"));
  assertFalse(serverFactorySource.includes("updateApiV1Program"));
  assertFalse(serverFactorySource.includes("supabaseProgramMutation.ts"));
});

// ---------------------------------------------------------------------------
// C. Factory registration
// ---------------------------------------------------------------------------

Deno.test("C1: exactly one Program Update dependency and registration", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly programUpdate: McpProgramUpdateToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PROGRAM_UPDATE_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.programUpdate(args)"),
    1,
  );
});

Deno.test("C2: registration branch uses the accepted bounded contract", () => {
  const branch = programUpdateBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(branch.includes("inputSchema: MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(
    branch.includes("MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES[result.category]"),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
  assert(branch.includes("continue;"));
});

Deno.test("C3: registration branch never interprets the Program payload", () => {
  const branch = programUpdateBranch();
  for (
    const forbidden of [
      "result.payload.outcome",
      "result.payload.programId",
      "result.payload.updatedAt",
      '"applied"',
      '"no_change"',
      '"replayed"',
    ]
  ) {
    assertFalse(branch.includes(forbidden), `branch interprets ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// D. Runtime imports
// ---------------------------------------------------------------------------

Deno.test("D1: runtime imports Step 3 control + Step 2 writer factories", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpProgramUpdateToolExecutor } from "./mcp/programUpdateMutationTool.ts";',
    ),
  );
  assert(
    runtimeSource.includes(
      'from "./mcp/programUpdateMutationExecutor.ts"',
    ),
  );
  for (
    const symbol of [
      "createMcpV1UpdateProgramExecutor",
      "McpUpdateProgramClientFactory",
      "McpV1UpdateProgramExecutor",
    ]
  ) {
    assert(runtimeSource.includes(symbol), `missing ${symbol}`);
  }
  assertFalse(runtimeSource.includes("updateApiV1Program"));
  assertFalse(runtimeSource.includes("updateMcpV1Program"));
});

// ---------------------------------------------------------------------------
// E. Runtime writer contract
// ---------------------------------------------------------------------------

Deno.test("E1: programUpdateWriter exists in both runtime interfaces", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly programUpdateWriter: McpV1UpdateProgramExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "programUpdateWriter: input.programUpdateWriter,",
    ),
    1,
  );
});

Deno.test("E2: exactly one caller-bound anon-key writer construction", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1UpdateProgramExecutor("),
    1,
  );
  const block = programUpdateWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpUpdateProgramClientFactory"));

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
    occurrences(runtimeSource, "\n    programUpdateWriter,\n"),
    1,
  );
});

// ---------------------------------------------------------------------------
// F. Per-request control construction
// ---------------------------------------------------------------------------

Deno.test("F1: exactly one per-request control executor with accepted deps", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpProgramUpdateToolExecutor({"),
    1,
  );
  const block = programUpdateControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.programUpdateWriter,"));
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

Deno.test("G1: programUpdate is handed to createBtpmMcpServer exactly once", () => {
  const start = runtimeSource.indexOf(
    "createBtpmMcpServer(executionContext, {",
  );
  assert(start > 0);
  const end = runtimeSource.indexOf("}),", start);
  assert(end > start);
  const handoff = runtimeSource.slice(start, end);
  assertStrictEquals(occurrences(handoff, "programUpdate,"), 1);
});

// ---------------------------------------------------------------------------
// H. Business / security boundaries
// ---------------------------------------------------------------------------

Deno.test("H1: no Program Update business internals in wiring surfaces", () => {
  const controlBlock = programUpdateControlBlock();
  const writerBlock = programUpdateWriterBlock();
  const branch = programUpdateBranch();

  for (
    const forbidden of [
      "mcp_v1_update_program",
      "api_v1_update_program",
      "apply_program_update",
      "api_project_client_enablements",
      "buildApiV1UpdateProgramIdempotencyPayload",
      "parseApiV1UpdateProgramBody",
      "hashCanonicalPayload",
      "requireMcpMutationConfirmation",
      "btpm_encrypt",
      "btpm_decrypt",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `factory: ${forbidden}`,
    );
    assertFalse(controlBlock.includes(forbidden), `control: ${forbidden}`);
    assertFalse(writerBlock.includes(forbidden), `writer: ${forbidden}`);
    assertFalse(branch.includes(forbidden), `branch: ${forbidden}`);
  }
});

Deno.test("H2: no direct database access or concurrency handling in wiring", () => {
  for (
    const block of [programUpdateControlBlock(), programUpdateWriterBlock()]
  ) {
    assertFalse(block.includes(".rpc("));
    assertFalse(block.includes(".from("));
    assertFalse(block.includes("expectedUpdatedAt"));
    assertFalse(block.includes("currentUpdatedAt"));
    assertFalse(block.includes("current_updated_at"));
    assertFalse(block.includes("updated_at"));
    assertFalse(block.includes("Date.parse"));
    assertFalse(block.includes("retry"));
  }
  const branch = programUpdateBranch();
  assertFalse(branch.includes(".rpc("));
  assertFalse(branch.includes(".from("));
  assertFalse(branch.includes("expectedUpdatedAt"));
  assertFalse(branch.includes("currentUpdatedAt"));
  assertFalse(branch.includes("current_updated_at"));
  assertFalse(branch.includes("Date.parse"));
});

// ---------------------------------------------------------------------------
// I. Bounded external errors
// ---------------------------------------------------------------------------

Deno.test("I1: exactly the accepted eight bounded categories remain", () => {
  assertEquals(
    Object.keys(MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES).sort(),
    [
      "confirmation_required",
      "idempotency_conflict",
      "idempotency_pending",
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "stale_program",
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
    "api_v1_",
    "apply_program_update",
  ];
  for (const message of Object.values(MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES)) {
    const lower = message.toLowerCase();
    for (const needle of forbidden) {
      assertFalse(lower.includes(needle), `"${message}" discloses ${needle}`);
    }
  }
});
