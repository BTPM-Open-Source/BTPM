// MCP-HARDENING-C3 — focused tests for the canonical MCP/API-Q regression
// runner. Static and read-only: no subprocess, no network, no database.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDenoTestArgs,
  DENO_TEST_PERMISSIONS,
  DENO_TEST_RUNTIME_FLAGS,
  discoverMcpSuite,
  discoverMcpSuiteTestFiles,
  EDGE_TESTS_DIR,
  FORWARDED_ENV_VARIABLES,
  isHistoricalMigrationContractSource,
  MCP_IMPORT_MAP,
  MCP_SUITE_ROOTS,
  MCP_TEST_PRELOAD,
  McpSuiteDiscoveryError,
  OSS_CLEAN_HISTORY_SQL_CONTRACT,
  resolveRepositoryRoot,
} from "./mcpRegressionSuite.ts";

const RUNNER_SOURCE = await Deno.readTextFile(
  new URL("./mcpRegressionSuite.ts", import.meta.url),
);
const PRELOAD_SOURCE = await Deno.readTextFile(
  new URL("./mcpTestPreload.ts", import.meta.url),
);
const PACKAGE_JSON = JSON.parse(
  await Deno.readTextFile(new URL("../../package.json", import.meta.url)),
) as { scripts?: Record<string, string> };

const REPOSITORY_ROOT = resolveRepositoryRoot();

Deno.test("repository root is resolved from the module location, not the CWD", async () => {
  const stat = await Deno.stat(`${REPOSITORY_ROOT}/${EDGE_TESTS_DIR}`);
  assert(stat.isDirectory, "edge-tests must resolve under the resolved root");
  assert(
    !RUNNER_SOURCE.includes("Deno.cwd()"),
    "the runner must never depend on the caller's working directory",
  );
});

Deno.test("repository root resolution is portable across POSIX and Windows file URLs", () => {
  assertEquals(
    resolveRepositoryRoot("file:///home/example/btpm/scripts/mcp/mcpRegressionSuite.ts"),
    "/home/example/btpm",
  );
  assertEquals(
    resolveRepositoryRoot("file:///C:/Users/Example/btpm/scripts/mcp/mcpRegressionSuite.ts"),
    "C:/Users/Example/btpm",
  );
  assertEquals(
    resolveRepositoryRoot("file:///C:/Users/Example%20User/btpm/scripts/mcp/mcpRegressionSuite.ts"),
    "C:/Users/Example User/btpm",
  );
});

Deno.test("the canonical suite has exactly the three intended roots", () => {
  assertEquals(MCP_SUITE_ROOTS.map((root) => root.directory), [
    `${EDGE_TESTS_DIR}/_shared/mcp`,
    `${EDGE_TESTS_DIR}/_shared`,
    `${EDGE_TESTS_DIR}/btpm-mcp`,
  ]);
  const shared = MCP_SUITE_ROOTS[1];
  assertEquals(shared.fileNamePrefix, "api-q-");
  assertEquals(shared.recursive, false, "only the api-q-* level of _shared participates");
});

Deno.test("discovery is rule-based, current-state complete and duplicate-free", async () => {
  const discovery = await discoverMcpSuite(REPOSITORY_ROOT);
  assertEquals(new Set(discovery.files).size, discovery.files.length, "each executable file appears exactly once");
  assertEquals(
    new Set(discovery.reconciledHistoricalFiles).size,
    discovery.reconciledHistoricalFiles.length,
    "each reconciled history file appears exactly once",
  );
  assert(discovery.files.length > 0);
  for (const file of discovery.files) {
    assertStringIncludes(file, EDGE_TESTS_DIR);
    assert(file.endsWith("_test.ts"), `unexpected file in suite: ${file}`);
    assert(
      !discovery.reconciledHistoricalFiles.includes(file),
      `historical migration-step file must not execute directly: ${file}`,
    );
  }
});

Deno.test("accepted MCP runtime hardening plus the clean-history SQL replacement participate", async () => {
  const files = await discoverMcpSuiteTestFiles(REPOSITORY_ROOT);
  for (
    const required of [
      `${EDGE_TESTS_DIR}/_shared/mcp/api-q-2-mcp-tool-registry_test.ts`,
      `${EDGE_TESTS_DIR}/_shared/mcp/mcp-hardening-c2-exposed-executable-parity_test.ts`,
      OSS_CLEAN_HISTORY_SQL_CONTRACT,
    ]
  ) {
    assert(files.includes(required), `missing from canonical current-state suite: ${required}`);
  }
});

Deno.test("historical migration-step classification is source-semantic, not filename-driven", async () => {
  assert(
    isHistoricalMigrationContractSource(`
      const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
      const MARKER = "API-Q example migration";
      async function loadMigration() { return MARKER; }
    `),
  );
  assert(
    isHistoricalMigrationContractSource(`
      const MIGRATION = "supabase/migrations/20260823090235_604e0af0-9155-4549-be22-ae437629191d.sql";
      await Deno.readTextFile(MIGRATION);
    `),
  );
  assert(
    !isHistoricalMigrationContractSource(`
      const source = await Deno.readTextFile("supabase/functions/btpm-mcp/index.ts");
      Deno.test("current runtime", () => source.length > 0);
    `),
  );

  const discovery = await discoverMcpSuite(REPOSITORY_ROOT);
  const historicalC4 =
    `${EDGE_TESTS_DIR}/_shared/mcp/mcp-hardening-c4-task-transition-reopen-contract_test.ts`;
  assert(discovery.reconciledHistoricalFiles.length > 0);
  assert(
    discovery.reconciledHistoricalFiles.includes(historicalC4),
    "known migration-bound C4 contract should be recognized from its source semantics",
  );
  assert(!discovery.files.includes(historicalC4));
  assert(discovery.files.includes(OSS_CLEAN_HISTORY_SQL_CONTRACT));
});

Deno.test("unrelated Edge Function families are excluded", async () => {
  const discovery = await discoverMcpSuite(REPOSITORY_ROOT);
  for (const file of [...discovery.files, ...discovery.reconciledHistoricalFiles]) {
    const isMcpShared = file.startsWith(`${EDGE_TESTS_DIR}/_shared/mcp/`);
    const isApiQShared = file.startsWith(`${EDGE_TESTS_DIR}/_shared/api-q-`);
    const isMcpEndpoint = file.startsWith(`${EDGE_TESTS_DIR}/btpm-mcp/`);
    assert(
      isMcpShared || isApiQShared || isMcpEndpoint,
      `file outside the documented inclusion rule: ${file}`,
    );
  }
});

Deno.test("discovery fails closed on a missing or empty root", async () => {
  await assertRejects(
    () =>
      discoverMcpSuiteTestFiles(REPOSITORY_ROOT, [{
        directory: `${EDGE_TESTS_DIR}/does-not-exist`,
        recursive: true,
        fileNamePrefix: null,
        rationale: "negative control",
      }]),
    McpSuiteDiscoveryError,
  );

  await assertRejects(
    () =>
      discoverMcpSuiteTestFiles(REPOSITORY_ROOT, [{
        directory: EDGE_TESTS_DIR,
        recursive: true,
        fileNamePrefix: "no-such-prefix-",
        rationale: "negative control",
      }]),
    McpSuiteDiscoveryError,
  );
});

Deno.test("no failure-hiding or fixed historical-count behaviour exists in the runner", () => {
  for (
    const forbidden of [
      "|| true",
      "continue-on-error",
      "--no-check",
      "--filter",
      "-A",
      "--allow-all",
      "--allow-net",
      "--allow-write",
      "ignore",
      "EXPECTED_TEST_COUNT",
      "EXPECTED_FILE_COUNT",
      "HISTORICAL_TEST_COUNT",
      "HISTORICAL_FILE_COUNT",
    ]
  ) {
    assert(
      !RUNNER_SOURCE.includes(forbidden),
      `runner must not contain ${forbidden}`,
    );
  }
  assert(
    !/files\.length\s*(?:===|==|!==|!=)\s*\d+/.test(RUNNER_SOURCE),
    "the runner must not gate acceptance on a fixed file count",
  );
  assert(
    !/reconciledHistoricalFiles\.length\s*(?:===|==|!==|!=)\s*\d+/.test(RUNNER_SOURCE),
    "the runner must not gate reconciliation on a fixed historical count",
  );
});

Deno.test("parent MCP commands isolate Deno from frontend config and lockfiles", () => {
  for (const scriptName of ["test:mcp", "test:mcp:runner"]) {
    const script = PACKAGE_JSON.scripts?.[scriptName];
    assert(script, `missing package script: ${scriptName}`);
    assertStringIncludes(script, "--no-config");
    assertStringIncludes(script, "--no-lock");
  }
});

Deno.test("child deno test invocation isolates config, loads canonical imports and normalizes static source reads", () => {
  assertEquals(MCP_IMPORT_MAP, "supabase/functions/btpm-mcp/deno.json");
  assertEquals(MCP_TEST_PRELOAD, "scripts/mcp/mcpTestPreload.ts");
  assertEquals([...DENO_TEST_RUNTIME_FLAGS], [
    "--no-config",
    `--import-map=${MCP_IMPORT_MAP}`,
    `--preload=${MCP_TEST_PRELOAD}`,
    "--no-lock",
    "--node-modules-dir=none",
  ]);
  assertStringIncludes(PRELOAD_SOURCE, 'Object.defineProperty(Deno, "readTextFile"');
  assertStringIncludes(PRELOAD_SOURCE, 'Object.defineProperty(Deno, "readTextFileSync"');
  assertStringIncludes(PRELOAD_SOURCE, 'replace(/\\r\\n/g, "\\n")');
  assert(
    !DENO_TEST_RUNTIME_FLAGS.includes("--node-modules-dir=auto" as never),
    "auto mode would couple the suite to mutable node_modules state",
  );
  assert(
    !RUNNER_SOURCE.includes("--node-modules-dir=auto"),
    "the runner must never request auto node_modules materialization",
  );

  const args = buildDenoTestArgs(["a_test.ts", "b_test.ts"]);
  assertEquals(args, [
    "test",
    "--no-config",
    `--import-map=${MCP_IMPORT_MAP}`,
    `--preload=${MCP_TEST_PRELOAD}`,
    "--no-lock",
    "--node-modules-dir=none",
    "--allow-read",
    "--allow-env=WS_NO_BUFFER_UTIL",
    "a_test.ts",
    "b_test.ts",
  ]);
  assertEquals(args[0], "test");
  assertEquals(
    args.indexOf("--no-config") < args.indexOf("--allow-read"),
    true,
    "runtime flags precede permission flags",
  );
  assertEquals(
    args.indexOf(`--import-map=${MCP_IMPORT_MAP}`) < args.indexOf("--allow-read"),
    true,
    "the canonical import map is applied before test files",
  );
  assertEquals(
    args.indexOf(`--preload=${MCP_TEST_PRELOAD}`) < args.indexOf("--allow-read"),
    true,
    "the EOL normalization preload runs before test modules",
  );
  assertEquals(
    args.indexOf("--no-lock") < args.indexOf("--allow-read"),
    true,
    "lockfile isolation precedes permission flags",
  );
  const flagArgs = args.filter((arg) => arg.startsWith("-"));
  assertEquals(flagArgs, [
    "--no-config",
    `--import-map=${MCP_IMPORT_MAP}`,
    `--preload=${MCP_TEST_PRELOAD}`,
    "--no-lock",
    "--node-modules-dir=none",
    "--allow-read",
    "--allow-env=WS_NO_BUFFER_UTIL",
  ]);
});

Deno.test("minimum permissions and environment only", () => {
  assertEquals([...DENO_TEST_PERMISSIONS], [
    "--allow-read",
    "--allow-env=WS_NO_BUFFER_UTIL",
  ]);
  assertEquals([...FORWARDED_ENV_VARIABLES], [
    "PATH",
    "HOME",
    "DENO_DIR",
    "SystemRoot",
  ]);
  assert(
    !FORWARDED_ENV_VARIABLES.includes("WS_NO_BUFFER_UTIL" as never),
    "the optional ws optimization flag may be readable but must not be inherited",
  );
  const testMcp = PACKAGE_JSON.scripts?.["test:mcp"] ?? "";
  assertStringIncludes(
    testMcp,
    "--allow-env=PATH,HOME,DENO_DIR,SystemRoot",
  );
  for (
    const secretish of ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE", "ANON_KEY", "TOKEN"]
  ) {
    assert(
      !RUNNER_SOURCE.includes(secretish),
      `runner must never reference ${secretish}`,
    );
  }
});
