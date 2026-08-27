/**
 * BTPM — MCP-HARDENING-C3
 * Canonical MCP / API-Q regression suite runner.
 *
 * The OSS publication candidate intentionally carries a clean forward-only SQL
 * history. Runtime/current-source tests execute unchanged. Historical migration-
 * step tests are recognized from their own source semantics and are replaced by
 * the consolidated clean-history SQL contract suite; no filename inventory or
 * historical count is maintained.
 */

export const EDGE_TESTS_DIR = "supabase/edge-tests";
export const MCP_IMPORT_MAP = "supabase/functions/btpm-mcp/deno.json";
export const MCP_TEST_PRELOAD = "scripts/mcp/mcpTestPreload.ts";
export const OSS_CLEAN_HISTORY_SQL_CONTRACT =
  `${EDGE_TESTS_DIR}/_shared/mcp/oss-clean-history-sql-contract_test.ts`;

export interface McpSuiteRoot {
  readonly directory: string;
  readonly recursive: boolean;
  readonly fileNamePrefix: string | null;
  readonly rationale: string;
}

export interface McpSuiteDiscovery {
  readonly files: string[];
  readonly reconciledHistoricalFiles: string[];
}

export const MCP_SUITE_ROOTS: readonly McpSuiteRoot[] = [
  {
    directory: `${EDGE_TESTS_DIR}/_shared/mcp`,
    recursive: true,
    fileNamePrefix: null,
    rationale: "MCP-specific shared regression tests (registry, exposure, parity, tools).",
  },
  {
    directory: `${EDGE_TESTS_DIR}/_shared`,
    recursive: false,
    fileNamePrefix: "api-q-",
    rationale: "API-Q contract / exposure / bridge / caller-bound executor tests.",
  },
  {
    directory: `${EDGE_TESTS_DIR}/btpm-mcp`,
    recursive: true,
    fileNamePrefix: null,
    rationale: "btpm-mcp endpoint and runtime behaviour tests.",
  },
] as const;

const TEST_FILE_SUFFIX = "_test.ts";

export function resolveRepositoryRoot(moduleUrl: string = import.meta.url): string {
  const rootUrl = new URL("../../", moduleUrl);
  let root = decodeURIComponent(rootUrl.pathname).replace(/\/$/, "");
  if (/^\/[A-Za-z]:\//.test(root)) root = root.slice(1);
  return root === "" ? "/" : root;
}

export class McpSuiteDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpSuiteDiscoveryError";
  }
}

function isTestFile(name: string, prefix: string | null): boolean {
  if (!name.endsWith(TEST_FILE_SUFFIX)) return false;
  if (prefix !== null && !name.startsWith(prefix)) return false;
  return true;
}

/**
 * Detects tests whose contract is specifically about a historical migration
 * step/file rather than the current canonical state. This is source-semantic:
 * no test filename or historical migration ID is enumerated.
 */
export function isHistoricalMigrationContractSource(source: string): boolean {
  const normalized = source.replace(/\r\n/g, "\n");
  const referencesMigrationSurface =
    /MIGRATIONS?_DIR/.test(normalized) ||
    /(?:^|["'`/])supabase\/migrations\//m.test(normalized) ||
    /new URL\(["'][^"']*migrations\//.test(normalized) ||
    /\.\.\/\.\.\/migrations\//.test(normalized);

  if (!referencesMigrationSurface) return false;

  const explicitHistoricalFile =
    /20\d{12}_[0-9a-f]{8}-[0-9a-f-]{27}\.sql/i.test(normalized);
  const markerDrivenMigration =
    /\bMARKERS?\b/.test(normalized) &&
    /migration/i.test(normalized);
  const stepSpecificAssertions =
    /exactly one migration|migration marker|migration file exists|accepted migration|migration must|migration should|loadMigration|findMigration/i
      .test(normalized);

  return explicitHistoricalFile || markerDrivenMigration || stepSpecificAssertions;
}

async function collect(
  absoluteDirectory: string,
  relativeDirectory: string,
  root: McpSuiteRoot,
  out: string[],
): Promise<void> {
  for await (const entry of Deno.readDir(absoluteDirectory)) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory) {
      if (root.recursive) {
        await collect(`${absoluteDirectory}/${entry.name}`, relativePath, root, out);
      }
      continue;
    }
    if (!entry.isFile) continue;
    if (isTestFile(entry.name, root.fileNamePrefix)) out.push(relativePath);
  }
}

export async function discoverMcpSuite(
  repositoryRoot: string,
  roots: readonly McpSuiteRoot[] = MCP_SUITE_ROOTS,
): Promise<McpSuiteDiscovery> {
  const candidates: string[] = [];

  for (const root of roots) {
    const absoluteDirectory = `${repositoryRoot}/${root.directory}`;
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(absoluteDirectory);
    } catch {
      throw new McpSuiteDiscoveryError(
        `Canonical MCP suite root is missing: ${root.directory}`,
      );
    }
    if (!stat.isDirectory) {
      throw new McpSuiteDiscoveryError(
        `Canonical MCP suite root is not a directory: ${root.directory}`,
      );
    }

    const found: string[] = [];
    await collect(absoluteDirectory, root.directory, root, found);
    if (found.length === 0) {
      throw new McpSuiteDiscoveryError(
        `Canonical MCP suite root matched no ${TEST_FILE_SUFFIX} files: ${root.directory}`,
      );
    }
    candidates.push(...found);
  }

  const seen = new Set<string>();
  const files: string[] = [];
  const reconciledHistoricalFiles: string[] = [];

  for (const file of candidates.sort()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await Deno.readTextFile(`${repositoryRoot}/${file}`);
    if (isHistoricalMigrationContractSource(source)) {
      reconciledHistoricalFiles.push(file);
    } else {
      files.push(file);
    }
  }

  if (reconciledHistoricalFiles.length > 0) {
    if (!files.includes(OSS_CLEAN_HISTORY_SQL_CONTRACT)) {
      throw new McpSuiteDiscoveryError(
        "Historical migration contracts were reconciled but the OSS clean-history SQL replacement suite is missing",
      );
    }
  }

  for (const root of roots) {
    const rootFiles = files.filter((file) =>
      root.recursive
        ? file.startsWith(`${root.directory}/`)
        : file.startsWith(`${root.directory}/`) &&
          !file.slice(root.directory.length + 1).includes("/")
    );
    if (rootFiles.length === 0) {
      throw new McpSuiteDiscoveryError(
        `Canonical MCP suite root has no executable current-state tests after reconciliation: ${root.directory}`,
      );
    }
  }

  return { files, reconciledHistoricalFiles };
}

export async function discoverMcpSuiteTestFiles(
  repositoryRoot: string,
  roots: readonly McpSuiteRoot[] = MCP_SUITE_ROOTS,
): Promise<string[]> {
  return (await discoverMcpSuite(repositoryRoot, roots)).files;
}

export const DENO_TEST_PERMISSIONS = [
  "--allow-read",
  "--allow-env=WS_NO_BUFFER_UTIL",
] as const;

export const DENO_TEST_RUNTIME_FLAGS = [
  "--no-config",
  `--import-map=${MCP_IMPORT_MAP}`,
  `--preload=${MCP_TEST_PRELOAD}`,
  "--no-lock",
  "--node-modules-dir=none",
] as const;

export function buildDenoTestArgs(files: readonly string[]): string[] {
  return ["test", ...DENO_TEST_RUNTIME_FLAGS, ...DENO_TEST_PERMISSIONS, ...files];
}

export const FORWARDED_ENV_VARIABLES = [
  "PATH",
  "HOME",
  "DENO_DIR",
  "SystemRoot",
] as const;

export function inheritedSubprocessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of FORWARDED_ENV_VARIABLES) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export async function runCanonicalMcpSuite(): Promise<number> {
  const repositoryRoot = resolveRepositoryRoot();
  let discovery: McpSuiteDiscovery;
  try {
    discovery = await discoverMcpSuite(repositoryRoot);
  } catch (error) {
    console.error(
      `[mcp-regression-suite] discovery failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }

  console.log(`[mcp-regression-suite] repository root: ${repositoryRoot}`);
  for (const root of MCP_SUITE_ROOTS) {
    console.log(
      `[mcp-regression-suite] root: ${root.directory} (recursive=${root.recursive}, prefix=${
        root.fileNamePrefix ?? "*"
      })`,
    );
  }
  console.log(`[mcp-regression-suite] executable current-state test files: ${discovery.files.length}`);
  console.log(
    `[mcp-regression-suite] reconciled historical migration-step files: ${discovery.reconciledHistoricalFiles.length}`,
  );

  const command = new Deno.Command("deno", {
    args: buildDenoTestArgs(discovery.files),
    cwd: repositoryRoot,
    clearEnv: true,
    env: inheritedSubprocessEnv(),
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  if (code !== 0) {
    console.error(
      `[mcp-regression-suite] FAILED (deno test exit code ${code}). See failing file/test names above.`,
    );
  } else {
    console.log(
      `[mcp-regression-suite] PASSED (${discovery.files.length} current-state test files; ${discovery.reconciledHistoricalFiles.length} historical migration-step files covered by clean-state SQL semantics).`,
    );
  }
  return code;
}

if (import.meta.main) {
  Deno.exit(await runCanonicalMcpSuite());
}
