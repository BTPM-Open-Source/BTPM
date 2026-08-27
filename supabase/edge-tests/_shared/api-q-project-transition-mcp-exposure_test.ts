// API-Q Project Transition Step 4 — MCP exposure + runtime wiring evidence.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, and nothing about the future exposure state of
// Program mutations or Portfolio. Those are future-step concerns owned by their
// own steps.
//
// It is also the authoritative exposure-state test for `projects.transition`:
// the temporary pre-Step-4 `not_exposed` assertions in the Step-1/2/3 suites
// are obsolete by design once this step lands.

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
  MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES,
  MCP_PROJECT_TRANSITION_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/projectTransitionMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function projectTransitionBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PROJECT_TRANSITION_TOOL_NAME)",
  );
  assert(start > 0, "Project Transition registration branch must exist");
  // Bound the slice to this branch only, so sibling registration branches can
  // never leak into Project Transition assertions.
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "Project Transition branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function projectTransitionControlBlock(): string {
  const start = runtimeSource.indexOf(
    "const projectTransition = createMcpProjectTransitionToolExecutor({",
  );
  assert(start > 0, "Project Transition control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function projectTransitionWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "const projectTransitionWriter: McpV1TransitionProjectExecutor =",
  );
  assert(start > 0, "Project Transition writer construction must exist");
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

Deno.test("A2: projects.transition exists exactly once and is exposed", () => {
  const byOperation = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "projects.transition",
  );
  assertStrictEquals(byOperation.length, 1);

  const byToolName = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.toolName === MCP_PROJECT_TRANSITION_TOOL_NAME,
  );
  assertStrictEquals(byToolName.length, 1);
  assertStrictEquals(byToolName[0], byOperation[0]);

  const entry = byOperation[0];
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.toolName, "btpm_transition_project");
  assertStrictEquals(entry.title, "Transition BTPM Project");
  assertStrictEquals(
    entry.description,
    "Transitions one Project lifecycle status through the canonical API mutation contract.",
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
  assert(
    serverFactorySource.includes('from "./projectTransitionMutationTool.ts"'),
  );
  for (
    const symbol of [
      "MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES",
      "MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA",
      "MCP_PROJECT_TRANSITION_TOOL_NAME",
      "McpProjectTransitionToolArguments",
      "McpProjectTransitionToolExecutor",
    ]
  ) {
    assert(serverFactorySource.includes(symbol), `missing ${symbol}`);
  }
});

Deno.test("B2: serverFactory never imports the writer or RPC wrappers", () => {
  assertFalse(
    serverFactorySource.includes("projectTransitionMutationExecutor.ts"),
  );
  assertFalse(
    serverFactorySource.includes("createMcpV1TransitionProjectExecutor"),
  );
  assertFalse(serverFactorySource.includes("supabaseProjectMutation.ts"));
  assertFalse(serverFactorySource.includes("transitionMcpV1Project"));
  assertFalse(serverFactorySource.includes("transitionApiV1Project"));
});

// ---------------------------------------------------------------------------
// C. Factory registration
// ---------------------------------------------------------------------------

Deno.test("C1: exactly one Project Transition dependency and registration", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly projectTransition: McpProjectTransitionToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PROJECT_TRANSITION_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.projectTransition(args)"),
    1,
  );
});

Deno.test("C2: registration branch uses the accepted bounded contract", () => {
  const branch = projectTransitionBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(
    branch.includes("inputSchema: MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA"),
  );
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(
    branch.includes(
      "MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
  assert(branch.includes("continue;"));
});

Deno.test("C3: branch serializes every outer-ok payload family generically", () => {
  const branch = projectTransitionBranch();
  // Exactly one outer error check and exactly one generic success return.
  assertStrictEquals(occurrences(branch, "if (!result.ok)"), 1);
  assertStrictEquals(occurrences(branch, "structuredContent: result.payload"), 1);
  assertStrictEquals(occurrences(branch, "JSON.stringify(result.payload)"), 1);

  // No business-outcome interpretation may exist in the transport branch.
  for (
    const forbidden of [
      "payload.outcome",
      "result.payload.",
      "completion_hard_blocked",
      "completion_soft_warnings",
      "hardBlocks",
      "warnings",
      "confirmWarnings",
      "targetStatus",
      "blocked",
      "no_change",
      "replayed",
      "stale_project",
    ]
  ) {
    assertFalse(branch.includes(forbidden), `branch must not handle ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// D. Runtime imports
// ---------------------------------------------------------------------------

Deno.test("D1: runtime imports Step 3 control + Step 2 writer factories", () => {
  assert(
    runtimeSource.includes(
      'import { createMcpProjectTransitionToolExecutor } from "./mcp/projectTransitionMutationTool.ts";',
    ),
  );
  assert(
    runtimeSource.includes(
      'from "./mcp/projectTransitionMutationExecutor.ts"',
    ),
  );
  for (
    const symbol of [
      "createMcpV1TransitionProjectExecutor",
      "McpTransitionProjectClientFactory",
      "McpV1TransitionProjectExecutor",
    ]
  ) {
    assert(runtimeSource.includes(symbol), `missing ${symbol}`);
  }
  assertFalse(runtimeSource.includes("transitionApiV1Project"));
  assertFalse(runtimeSource.includes("transitionMcpV1Project"));
  assertFalse(runtimeSource.includes("mcp_v1_transition_project"));
  assertFalse(runtimeSource.includes("api_v1_transition_project"));
});

// ---------------------------------------------------------------------------
// E. Runtime writer contract
// ---------------------------------------------------------------------------

Deno.test("E1: projectTransitionWriter exists in both runtime interfaces", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly projectTransitionWriter: McpV1TransitionProjectExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "projectTransitionWriter: input.projectTransitionWriter,",
    ),
    1,
  );
});

Deno.test("E2: exactly one caller-bound anon-key writer construction", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1TransitionProjectExecutor("),
    1,
  );
  const block = projectTransitionWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(block.includes("McpTransitionProjectClientFactory"));

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
    occurrences(runtimeSource, "\n    projectTransitionWriter,\n"),
    1,
  );
});

// ---------------------------------------------------------------------------
// F. Per-request control construction
// ---------------------------------------------------------------------------

Deno.test("F1: exactly one per-request control executor with accepted deps", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpProjectTransitionToolExecutor({"),
    1,
  );
  const block = projectTransitionControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.projectTransitionWriter,"));
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
      "sourceChannel",
      "apiClientId",
      "oauthClientId",
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

Deno.test("G1: projectTransition is handed to createBtpmMcpServer exactly once", () => {
  const start = runtimeSource.indexOf("createBtpmMcpServer(executionContext, {");
  assert(start > 0);
  const end = runtimeSource.indexOf("}),", start);
  assert(end > start);
  const handoff = runtimeSource.slice(start, end);
  assertStrictEquals(occurrences(handoff, "projectTransition,"), 1);
});

// ---------------------------------------------------------------------------
// H. Business / security boundaries
// ---------------------------------------------------------------------------

Deno.test("H1: no Project Transition business internals in wiring surfaces", () => {
  const controlBlock = projectTransitionControlBlock();
  const writerBlock = projectTransitionWriterBlock();
  const branch = projectTransitionBranch();

  for (
    const forbidden of [
      "mcp_v1_transition_project",
      "api_v1_transition_project",
      "apply_project_status_transition",
      "validate_project_completion",
      "api_project_client_enablements",
      "enable_project",
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
    const block of [
      projectTransitionControlBlock(),
      projectTransitionWriterBlock(),
      projectTransitionBranch(),
    ]
  ) {
    assertFalse(block.includes(".rpc("));
    assertFalse(block.includes(".from("));
    assertFalse(block.includes("expectedUpdatedAt"));
    assertFalse(block.includes("updated_at"));
    assertFalse(block.includes("retry"));
    assertFalse(block.includes("Date.parse"));
    assertFalse(block.includes("status"));
    assertFalse(block.includes("program"));
  }
});

// ---------------------------------------------------------------------------
// I. Bounded external errors
// ---------------------------------------------------------------------------

Deno.test("I1: exactly the accepted eight bounded categories remain", () => {
  assertEquals(
    Object.keys(MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES).sort(),
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
  for (
    const message of Object.values(MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES)
  ) {
    assert(typeof message === "string" && message.trim().length > 0);
  }
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
    "apply_project_status_transition",
    "timestamp",
  ];
  for (
    const message of Object.values(MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES)
  ) {
    const lower = message.toLowerCase();
    for (const needle of forbidden) {
      assertFalse(lower.includes(needle), `"${message}" discloses ${needle}`);
    }
  }
});
