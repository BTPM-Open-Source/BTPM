// MCP-HARDENING-C2 — Exposed → Executable runtime parity.
//
// Invariant proven here:
//
//   exposed in registry + explicit serverFactory branch = discoverable tool
//   exposed in registry + NO explicit branch            = construction failure
//
// Parity is derived from the two production authorities only:
//   - the canonical registry (`toolRegistry.ts`) as exposure authority;
//   - the explicit `serverFactory.ts` registration branches as execution-wiring
//     authority (exercised by really constructing the server).
// No duplicated global tool inventory and no hard-coded cardinality exists in
// this file. No network, no database, no Edge invocation.

import {
  assert,
  assertFalse,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  exposedMcpTools,
  MCP_TOOL_REGISTRY,
  type McpToolMetadata,
  type McpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";
import {
  type BtpmMcpToolExecutors,
  createBtpmMcpServer,
  McpExposedToolWithoutExecutionPathError,
} from "../../../functions/btpm-mcp/mcp/serverFactory.ts";
import type { McpTrustedExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";

const serverFactorySource = await Deno.readTextFile(
  new URL(
    "../../../functions/btpm-mcp/mcp/serverFactory.ts",
    import.meta.url,
  ),
);

// Bounded stubs. Construction must never invoke an executor, so any call here
// is itself a failure signal.
const executors = new Proxy({}, {
  get: (_target, property) => () => {
    throw new Error(`executor ${String(property)} must not run at construction`);
  },
}) as unknown as BtpmMcpToolExecutors;

const executionContext = {} as unknown as McpTrustedExecutionContext;

// -----------------------------------------------------------------------------
// A. Current live registry/runtime parity
// -----------------------------------------------------------------------------

Deno.test("C2-A: every currently exposed registry entry has explicit executable wiring", () => {
  // Because an unmatched exposed entry now throws, successful construction with
  // the canonical registry IS the parity proof — derived, not enumerated.
  const server = createBtpmMcpServer(executionContext, executors);
  assert(server, "the canonical exposed inventory must construct a server");
  assert(exposedMcpTools().length > 0, "the exposure authority is non-empty");
});

// -----------------------------------------------------------------------------
// B. Unsupported exposed entry fails closed
// -----------------------------------------------------------------------------

const UNWIRED_FIXTURE_ENTRY: McpToolMetadata = Object.freeze({
  // A real canonical operation that is deliberately NOT exposed in production
  // and therefore has no explicit serverFactory branch.
  operationId: "version.get",
  toolName: "btpm_c2_fixture_unwired_tool",
  title: "C2 fixture unwired tool",
  description: "Test-only fixture entry with no explicit execution path.",
  operationClass: "read",
  exposure: "exposed",
  confirmation: "not_required",
  resultShape: "single_object",
  concurrencyToken: "not_applicable",
}) as McpToolMetadata;

const FIXTURE_REGISTRY: McpToolRegistry = Object.freeze([
  ...MCP_TOOL_REGISTRY,
  UNWIRED_FIXTURE_ENTRY,
]);

Deno.test("C2-B: an exposed entry without explicit wiring fails server construction", () => {
  const error = assertThrows(
    () => createBtpmMcpServer(executionContext, executors, FIXTURE_REGISTRY),
    McpExposedToolWithoutExecutionPathError,
  ) as McpExposedToolWithoutExecutionPathError;

  assertStrictEquals(error.toolName, UNWIRED_FIXTURE_ENTRY.toolName);
  assertStrictEquals(error.operationId, UNWIRED_FIXTURE_ENTRY.operationId);
  assert(error.message.includes(UNWIRED_FIXTURE_ENTRY.toolName));

  // Deterministic, bounded internal configuration error: no secrets, tokens or
  // tenant/user data.
  for (
    const forbidden of [
      "bearer",
      "token",
      "service_role",
      "supabase",
      "password",
      "secret",
      "42501",
    ]
  ) {
    assertFalse(
      error.message.toLowerCase().includes(forbidden),
      `message must not disclose ${forbidden}`,
    );
  }
});

Deno.test("C2-B: the notYetExecutable placeholder registration is gone", () => {
  assertFalse(serverFactorySource.includes("notYetExecutable"));
  assertFalse(
    serverFactorySource.includes(
      "{ title: tool.title, description: tool.description },",
    ),
    "no schema-less placeholder registration may remain",
  );
  assert(
    serverFactorySource.includes(
      "throw new McpExposedToolWithoutExecutionPathError(tool)",
    ),
    "the terminal unmatched-exposed-entry branch must fail closed",
  );
});

// -----------------------------------------------------------------------------
// C. No silent skip
// -----------------------------------------------------------------------------

Deno.test("C2-C: an exposed-but-unwired entry cannot be silently skipped", () => {
  let constructed = false;
  try {
    createBtpmMcpServer(executionContext, executors, FIXTURE_REGISTRY);
    constructed = true;
  } catch (error) {
    assert(error instanceof McpExposedToolWithoutExecutionPathError);
  }
  assertFalse(
    constructed,
    "construction must not succeed while an exposed entry is unwired",
  );

  // The terminal branch is a throw, not a `continue`/`break`/no-op skip.
  const guardIndex = serverFactorySource.lastIndexOf(
    "throw new McpExposedToolWithoutExecutionPathError(tool)",
  );
  const tail = serverFactorySource.slice(guardIndex);
  assertFalse(tail.includes("continue;"), "no skip may follow the guard");
});

// -----------------------------------------------------------------------------
// E. No generic dispatcher
// -----------------------------------------------------------------------------

Deno.test("C2-E: serverFactory gains no generic operationId → executor dispatcher", () => {
  for (
    const forbidden of [
      "executors[",
      "tool.operationId ===",
      "OPERATION_EXECUTORS",
      "Deno.env",
      "createClient",
      "fetch(",
    ]
  ) {
    assertFalse(
      serverFactorySource.includes(forbidden),
      `serverFactory must not contain ${forbidden}`,
    );
  }
  assert(
    serverFactorySource.includes("tool.toolName === "),
    "explicit per-tool branches remain the only dispatch mechanism",
  );
});
