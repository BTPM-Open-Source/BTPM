// Publication-validation preload for the canonical MCP/API-Q Deno suite.
//
// Git stores the candidate TypeScript sources with LF endings, while a normal
// Windows checkout with core.autocrlf=true materializes them as CRLF. A subset
// of historical static contract tests compare multiline source fragments.
// Normalize text-file reads at the test-process boundary so those assertions are
// platform-independent without rewriting product files or changing Git EOL
// policy. Binary reads and every non-read Deno API remain untouched.

function normalizeEol(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

const originalReadTextFile = Deno.readTextFile.bind(Deno);
const originalReadTextFileSync = Deno.readTextFileSync.bind(Deno);

Object.defineProperty(Deno, "readTextFile", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: async (...args: Parameters<typeof Deno.readTextFile>): Promise<string> =>
    normalizeEol(await originalReadTextFile(...args)),
});

Object.defineProperty(Deno, "readTextFileSync", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: (...args: Parameters<typeof Deno.readTextFileSync>): string =>
    normalizeEol(originalReadTextFileSync(...args)),
});
