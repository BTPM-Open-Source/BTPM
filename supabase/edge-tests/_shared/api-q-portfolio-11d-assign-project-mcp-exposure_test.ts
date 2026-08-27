// API-Q Portfolio-11D — MCP exposure + runtime wiring evidence for the
// canonical `portfolios.assign_project` mutation.
//
// This suite is deliberately DURABLE: it asserts nothing about the global
// exposed-tool inventory, nothing about total mutation counts, and nothing
// about the historical exposure state of any other operation.

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
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES,
  MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME,
} from "../../functions/btpm-mcp/mcp/portfolioAssignmentMutationTool.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
);

const runtimeSource = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function assignBranch(): string {
  const start = serverFactorySource.indexOf(
    "if (tool.toolName === MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME)",
  );
  assert(start > 0, "assignment registration branch must exist");
  const end = serverFactorySource.indexOf("continue;", start);
  assert(end > start, "assignment branch must end with continue;");
  return serverFactorySource.slice(start, end + "continue;".length);
}

function assignControlBlock(): string {
  const start = runtimeSource.indexOf(
    "createMcpPortfolioAssignProjectToolExecutor({",
  );
  assert(start > 0, "per-request control construction must exist");
  const end = runtimeSource.indexOf("});", start);
  assert(end > start);
  return runtimeSource.slice(start, end + 3);
}

function assignWriterBlock(): string {
  const start = runtimeSource.indexOf(
    "createMcpV1AssignProjectPortfolioExecutor(",
  );
  assert(start > 0, "writer construction must exist");
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

Deno.test("A2: portfolios.assign_project exists exactly once and is exposed", () => {
  const byOperation = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.operationId === "portfolios.assign_project",
  );
  assertStrictEquals(byOperation.length, 1);

  const byToolName = MCP_TOOL_REGISTRY.filter(
    (entry) => entry.toolName === MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME,
  );
  assertStrictEquals(byToolName.length, 1);
  assertStrictEquals(byToolName[0], byOperation[0]);

  const entry = byOperation[0];
  assertStrictEquals(entry.toolName, "btpm_assign_project_portfolio");
  assertStrictEquals(entry.exposure, "exposed");
  assertStrictEquals(entry.operationClass, "mutation");
  assertStrictEquals(entry.confirmation, "required");
  assertStrictEquals(entry.resultShape, "single_object");
  assertStrictEquals(entry.concurrencyToken, "not_applicable");
});

Deno.test("A3: Portfolio create and update siblings stay exposed", () => {
  for (
    const [operationId, toolName] of [
      ["portfolios.create", "btpm_create_portfolio"],
      ["portfolios.update", "btpm_update_portfolio"],
    ] as const
  ) {
    const entry = MCP_TOOL_REGISTRY.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert(entry !== undefined, `${operationId} must exist`);
    assertStrictEquals(entry!.exposure, "exposed");
    assertStrictEquals(entry!.toolName, toolName);
  }
});

// ---------------------------------------------------------------------------
// B. Server factory ownership
// ---------------------------------------------------------------------------

Deno.test("B1: serverFactory imports only the Portfolio-11C control contract", () => {
  assert(
    serverFactorySource.includes('from "./portfolioAssignmentMutationTool.ts"'),
  );
  for (
    const symbol of [
      "MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES",
      "MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA",
      "MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME",
      "McpPortfolioAssignProjectToolArguments",
      "McpPortfolioAssignProjectToolExecutor",
    ]
  ) {
    assert(serverFactorySource.includes(symbol), `missing ${symbol}`);
  }
});

Deno.test("B2: serverFactory never imports the writer or base adapter", () => {
  for (
    const forbidden of [
      "portfolioAssignmentMutationExecutor.ts",
      "createMcpV1AssignProjectPortfolioExecutor",
      "assignMcpV1ProjectPortfolio",
      "assignApiV1ProjectPortfolio",
      "supabasePortfolioMutation.ts",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory must not reference ${forbidden}`,
    );
  }
});

Deno.test("B3: exactly one assignment dependency and registration", () => {
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "readonly portfolioAssignProject: McpPortfolioAssignProjectToolExecutor;",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(
      serverFactorySource,
      "if (tool.toolName === MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME)",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(serverFactorySource, "executors.portfolioAssignProject(args)"),
    1,
  );
});

// ---------------------------------------------------------------------------
// C. Registration branch
// ---------------------------------------------------------------------------

Deno.test("C1: registration branch uses the accepted bounded contract", () => {
  const branch = assignBranch();
  assert(branch.includes("title: tool.title"));
  assert(branch.includes("description: tool.description"));
  assert(
    branch.includes(
      "inputSchema: MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA",
    ),
  );
  assert(branch.includes("...BTPM_MCP_MUTATION_TOOL_ANNOTATIONS"));
  assert(
    branch.includes(
      "MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES[result.category]",
    ),
  );
  assert(branch.includes("JSON.stringify(result.payload)"));
  assert(branch.includes("structuredContent: result.payload"));
  assert(branch.includes("continue;"));
});

Deno.test("C2: registration branch never interprets the assignment payload", () => {
  const branch = assignBranch();
  for (
    const forbidden of [
      "result.payload.outcome",
      "result.payload.projectId",
      "result.payload.oldPortfolioId",
      "result.payload.newPortfolioId",
      '"applied"',
      '"replayed"',
      '"no_change"',
      "expectedUpdatedAt",
    ]
  ) {
    assertFalse(branch.includes(forbidden), `branch interprets ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// D. Runtime imports
// ---------------------------------------------------------------------------

Deno.test("D1: runtime imports the 11C control and 11B writer factories", () => {
  assert(runtimeSource.includes("createMcpPortfolioAssignProjectToolExecutor"));
  assert(
    runtimeSource.includes(
      'from "./mcp/portfolioAssignmentMutationExecutor.ts"',
    ),
  );
  for (
    const symbol of [
      "createMcpV1AssignProjectPortfolioExecutor",
      "McpAssignProjectPortfolioClientFactory",
      "McpV1AssignProjectPortfolioExecutor",
    ]
  ) {
    assert(runtimeSource.includes(symbol), `missing ${symbol}`);
  }
  for (
    const forbidden of [
      "assignMcpV1ProjectPortfolio",
      "assignApiV1ProjectPortfolio",
      "supabasePortfolioMutation.ts",
      "mcp_v1_assign_project_portfolio",
      "api_v1_assign_project_portfolio",
    ]
  ) {
    assertFalse(
      runtimeSource.includes(forbidden),
      `runtime must not reference ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// E. Runtime writer contract
// ---------------------------------------------------------------------------

Deno.test("E1: portfolioAssignProjectWriter is threaded exactly once", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "readonly portfolioAssignProjectWriter: McpV1AssignProjectPortfolioExecutor;",
    ),
    2,
  );
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "portfolioAssignProjectWriter: input.portfolioAssignProjectWriter,",
    ),
    1,
  );
  assertStrictEquals(
    occurrences(runtimeSource, "\n    portfolioAssignProjectWriter,\n"),
    1,
  );
});

// ---------------------------------------------------------------------------
// F. Writer construction
// ---------------------------------------------------------------------------

Deno.test("F1: exactly one caller-bound anon-key writer construction", () => {
  assertStrictEquals(
    occurrences(runtimeSource, "createMcpV1AssignProjectPortfolioExecutor("),
    1,
  );
  const block = assignWriterBlock();
  assert(block.includes("String(supabaseUrl)"));
  assert(block.includes("supabaseAnonKey"));
  assert(
    block.includes(
      "createClient as unknown as McpAssignProjectPortfolioClientFactory",
    ),
  );

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

// ---------------------------------------------------------------------------
// G. Per-request control construction
// ---------------------------------------------------------------------------

Deno.test("G1: exactly one per-request control executor with accepted deps", () => {
  assertStrictEquals(
    occurrences(
      runtimeSource,
      "createMcpPortfolioAssignProjectToolExecutor({",
    ),
    1,
  );
  const block = assignControlBlock();
  assert(block.includes("request,"));
  assert(block.includes("execution: executionContext,"));
  assert(block.includes("writer: runtime.portfolioAssignProjectWriter,"));
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
      "tenant",
      "organization",
      "enablement",
      "capability",
      "operationId",
      "confirm",
      "payloadHash",
    ]
  ) {
    assertFalse(
      block.toLowerCase().includes(forbidden.toLowerCase()),
      `control construction must not receive ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// H. Server handoff
// ---------------------------------------------------------------------------

Deno.test("H1: portfolioAssignProject is handed to the server exactly once", () => {
  const start = runtimeSource.indexOf(
    "createBtpmMcpServer(executionContext, {",
  );
  assert(start > 0);
  const end = runtimeSource.indexOf("}),", start);
  assert(end > start);
  const handoff = runtimeSource.slice(start, end);
  assertStrictEquals(occurrences(handoff, "portfolioAssignProject,"), 1);
});

// ---------------------------------------------------------------------------
// I. Forbidden business / concurrency internals
// ---------------------------------------------------------------------------

Deno.test("I1: no assignment business internals in the wiring surfaces", () => {
  const blocks = [assignControlBlock(), assignWriterBlock(), assignBranch()];
  for (
    const forbidden of [
      "mcp_v1_assign_project_portfolio",
      "api_v1_assign_project_portfolio",
      "assign_project_portfolio",
      "assignMcpV1ProjectPortfolio",
      "assignApiV1ProjectPortfolio",
      "parseApiV1AssignProjectPortfolioBody",
      "buildApiV1AssignProjectPortfolioIdempotencyPayload",
      "hashCanonicalPayload",
      "requireMcpMutationConfirmation",
      "has_project_pm_authority",
      "can_write_demo",
      "btpm_encrypt",
      "btpm_decrypt",
    ]
  ) {
    for (const block of blocks) {
      assertFalse(block.includes(forbidden), `wiring: ${forbidden}`);
    }
  }
});

Deno.test("I2: no direct database access or concurrency handling in wiring", () => {
  for (const block of [assignControlBlock(), assignWriterBlock(), assignBranch()]) {
    for (
      const forbidden of [
        ".rpc(",
        ".from(",
        "expectedUpdatedAt",
        "currentUpdatedAt",
        "updated_at",
        "retry",
      ]
    ) {
      assertFalse(block.includes(forbidden), `must not contain ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// J. Bounded external errors
// ---------------------------------------------------------------------------

Deno.test("J1: exactly the accepted seven bounded categories remain", () => {
  assertEquals(
    Object.keys(MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES).sort(),
    [
      "confirmation_required",
      "idempotency_conflict",
      "idempotency_pending",
      "invalid_arguments",
      "not_authorized",
      "rate_limited",
      "unavailable",
    ],
  );
});

Deno.test("J2: bounded messages disclose no internal detail", () => {
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
    "supabase",
    "mcp_v1_",
    "api_v1_",
  ];
  for (
    const message of Object.values(
      MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES,
    )
  ) {
    assert(message.length > 0);
    const lower = message.toLowerCase();
    for (const needle of forbidden) {
      assertFalse(lower.includes(needle), `"${message}" discloses ${needle}`);
    }
  }
});
