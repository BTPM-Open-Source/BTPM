// API-Q Program Create Step 4 — MCP exposure + runtime wiring evidence.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, and nothing about the future exposure state of
// Portfolio or any other operation. `programs.update` is asserted only as
// current sibling protection for this step.

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
  MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES,
  MCP_PROGRAM_CREATE_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/programCreateMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function programCreateBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PROGRAM_CREATE_TOOL_NAME)",
  );
  assert(start > 0, "Program Create registration branch must exist");
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Program Create branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function programCreateControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const programCreate = createMcpProgramCreateToolExecutor({",
  );
  assert(start > 0, "Program Create control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function programCreateWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const programCreateWriter: McpV1CreateProgramExecutor =",
  );
  assert(start > 0, "Program Create writer construction must exist");
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

Deno.test("A2: programs.create exists exactly once, exposed, with accepted metadata", () => {
  const matches = MCP_TOOL_REGISTRY.filter(
    (candidate) => candidate.operationId === "programs.create",
  );
  assertStrictEquals(matches.length, 1);
  assertStrictEquals(
    MCP_TOOL_REGISTRY.filter(
      (candidate) => candidate.toolName === "btpm_create_program",
    ).length,
    1,
  );

  const entry = matches[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_create_program");
  assertStrictEquals(entry.toolName, MCP_PROGRAM_CREATE_TOOL_NAME);
  assertStrictEquals(entry.title, "Create BTPM Program");
  assertStrictEquals(
    entry.description,
    "Creates one Program in a Workspace through the canonical API mutation contract.",
  );
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

// The temporary sibling-deferred assertion (Program Update `not_exposed` with
// no wiring) is obsolete: API-Q Program Update Step 4 exposed and wired it.
// Program Update exposure is owned by its own Step-4 exposure test.
Deno.test("A3: programs.update exists as its own canonical registry entry", () => {
  const entry = MCP_TOOL_REGISTRY.find(
    (candidate) => candidate.operationId === "programs.update",
  );
  assert(entry !== undefined, "programs.update must exist in the registry");
  assertStrictEquals(entry!.toolName, "btpm_update_program");
});

// -----------------------------------------------------------------------------
// B. Server factory
// -----------------------------------------------------------------------------

Deno.test("B1: server factory imports only the Step 3 Program Create control layer", () => {
  assert(serverFactorySource.includes("./programCreateMutationTool.ts"));
  assert(serverFactorySource.includes("MCP_PROGRAM_CREATE_TOOL_NAME"));
  assert(serverFactorySource.includes("MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA"));
  assert(serverFactorySource.includes("MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES"));
  assert(serverFactorySource.includes("McpProgramCreateToolArguments"));
  assert(serverFactorySource.includes("McpProgramCreateToolExecutor"));

  assertFalse(serverFactorySource.includes("programCreateMutationExecutor.ts"));
  assertFalse(serverFactorySource.includes("createMcpV1CreateProgramExecutor"));
  assertFalse(serverFactorySource.includes("createMcpV1Program"));
  assertFalse(serverFactorySource.includes("supabaseProgramMutation.ts"));
});

Deno.test("B2: exactly one Program Create executor dependency and branch", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly programCreate: McpProgramCreateToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PROGRAM_CREATE_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.programCreate("),
    1,
  );
});

Deno.test("B3: the branch uses the accepted bounded contract only", () => {
  const branch = programCreateBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(branch.includes("inputSchema: MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA"));
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(branch.includes("await executors.programCreate(args)"));
  assert(
    branch.includes("MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES[result.category]"),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));

  // No Program business-result interpretation may exist here.
  for (
    const forbidden of [
      "result.payload.outcome",
      "result.payload.programId",
      '"applied"',
      '"replayed"',
    ]
  ) {
    assertFalse(
      branch.includes(forbidden),
      `branch must not interpret ${forbidden}`,
    );
  }
});

// -----------------------------------------------------------------------------
// C. Runtime wiring
// -----------------------------------------------------------------------------

Deno.test("C1: runtime imports both the Step 3 control factory and Step 2 writer", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpProgramCreateToolExecutor } from "./mcp/programCreateMutationTool.ts";',
    ),
  );
  assert(runtimeSource.includes("createMcpV1CreateProgramExecutor"));
  assert(runtimeSource.includes("McpCreateProgramClientFactory"));
  assert(runtimeSource.includes("McpV1CreateProgramExecutor"));
  assert(
    runtimeSource.includes("./mcp/programCreateMutationExecutor.ts"),
  );
  assertFalse(runtimeSource.includes("createApiV1Program"));
});

Deno.test("C2: runtime contract carries exactly one programCreateWriter each", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly programCreateWriter: McpV1CreateProgramExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(runtimeSource, "programCreateWriter: input.programCreateWriter,"),
    1,
  );
});

Deno.test("C3: exactly one per-request control executor with the exact dependencies", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpProgramCreateToolExecutor({"),
    1,
  );
  const block = programCreateControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.programCreateWriter,"));
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

Deno.test("C4: programCreate is passed exactly once to createBtpmMcpServer", () => {
  assertStrictEquals(occurrences(runtimeSource, "\n        programCreate,\n"), 1);
});

// -----------------------------------------------------------------------------
// D. Writer construction
// -----------------------------------------------------------------------------

Deno.test("D1: exactly one anon-key caller-bound writer construction site", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1CreateProgramExecutor("),
    1,
  );
  const block = programCreateWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpCreateProgramClientFactory"));

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
    occurrences(runtimeSource, "\n    programCreateWriter,\n"),
    1,
  );
});

// -----------------------------------------------------------------------------
// E. Business / security boundaries
// -----------------------------------------------------------------------------

Deno.test("E1: neither factory nor runtime touches Program business internals", () => {
  for (
    const forbidden of [
      "mcp_v1_create_program",
      "api_v1_create_program",
      "apply_program_create",
      "api_project_client_enablements",
      "hashCanonicalPayload",
      "validateIdempotencyKey",
      "requireMcpMutationConfirmation",
      "btpm_encrypt",
      "btpm_decrypt",
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

Deno.test("E2: no Program retry or auto-enablement wiring exists", () => {
  const branch = programCreateBranch();
  assertFalse(branch.toLowerCase().includes("retry"));
  assertFalse(branch.toLowerCase().includes("auto-enable"));
  const block = programCreateControlBlock();
  assertFalse(block.toLowerCase().includes("retry"));
  assertFalse(block.toLowerCase().includes("enable"));
});

// -----------------------------------------------------------------------------
// F. Bounded external messages
// -----------------------------------------------------------------------------

Deno.test("F1: the seven bounded Program Create messages disclose nothing internal", () => {
  const categories = Object.keys(MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES)
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

  assertStrictEquals(
    MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES.not_authorized,
    "Not authorized to create this Program.",
  );
  assertStrictEquals(
    MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES.unavailable,
    "BTPM Program creation is temporarily unavailable.",
  );

  for (const message of Object.values(MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES)) {
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
        "apply_program",
      ]
    ) {
      assertFalse(
        lowered.includes(forbidden),
        `${message} must not disclose ${forbidden}`,
      );
    }
  }
});
