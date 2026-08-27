// Phase 4D.14A.8E.2 — Repository closure audit for the Global AI runtime.
//
// Confirms that after Guide V1 cutover:
//   - the legacy Global Guide runtime file is gone;
//   - _shared/openai-responses.ts is now pure Responses output parsing
//     (no fetch, no provider URL, no auth headers, no enqueue/poll);
//   - no production Edge Function imports or calls
//     enqueueOpenAIResponse / getOpenAIResponseStatus;
//   - no production Edge Function file (excluding _shared connection-test
//     clients and the connection-test functions themselves) reads any of
//     the retired Global AI environment variables via Deno.env.get(...).
//
// Only exact `Deno.env.get("NAME")` / `Deno.env.get('NAME')` usage is scanned;
// comments and historical documentation strings are ignored.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FUNCTIONS_ROOT = "supabase/functions";

// Connection-test functions and their shared clients are intentionally
// preserved as Global-env readers and are excluded from the closure scan.
const EXCLUDED_FUNCTION_DIRS = new Set<string>([
  "openai-test-connection",
  "azure-openai-test-connection",
  "microsoft-graph-test-connection",
  "sharepoint-test-connection",
]);

const BANNED_ENV_VARS = [
  "AI_PROVIDER",
  "AI_EMBEDDING_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "AI_EMBEDDING_DIMENSIONS",
];

const BANNED_ENV_PREFIXES = ["AZURE_OPENAI_"];

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function* walkFunctionFiles(): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(FUNCTIONS_ROOT)) {
    if (!entry.isDirectory) continue;
    if (entry.name === "_shared") continue;
    if (EXCLUDED_FUNCTION_DIRS.has(entry.name)) continue;
    const dir = `${FUNCTIONS_ROOT}/${entry.name}`;
    for await (const f of Deno.readDir(dir)) {
      if (!f.isFile) continue;
      if (!f.name.endsWith(".ts")) continue;
      // Skip test files - only production Edge Function source counts.
      if (f.name.endsWith("_test.ts") || f.name.endsWith(".test.ts")) continue;
      yield `${dir}/${f.name}`;
    }
  }
}

Deno.test("closure — legacy Global Guide runtime file no longer exists", async () => {
  const present = await fileExists(
    `${FUNCTIONS_ROOT}/_shared/legacyGuideTextProviderRuntime.ts`,
  );
  assert(!present, "legacyGuideTextProviderRuntime.ts must be deleted");
});

Deno.test("closure — openai-responses.ts is pure parsing only", async () => {
  const src = await Deno.readTextFile(
    `${FUNCTIONS_ROOT}/_shared/openai-responses.ts`,
  );
  // Pure helpers preserved.
  assert(src.includes("export function extractResponseText"));
  assert(src.includes("export function tryParseStructuredJson"));
  // Removed transport / provider surface.
  const banned = [
    "fetch(",
    "https://api.openai.com",
    "OPENAI_BASE",
    "Authorization",
    "Bearer ",
    "enqueueOpenAIResponse",
    "getOpenAIResponseStatus",
    "OpenAIResponseEnqueueResult",
    "OpenAIResponseStatus",
  ];
  for (const b of banned) {
    assert(
      !src.includes(b),
      `openai-responses.ts must not contain "${b}" after 4D.14A.8E.2`,
    );
  }
});

Deno.test("closure — no production Edge Function calls the removed OpenAI Responses network helpers", async () => {
  const offenders: string[] = [];
  for await (const path of walkFunctionFiles()) {
    const src = await Deno.readTextFile(path);
    if (
      src.includes("enqueueOpenAIResponse") ||
      src.includes("getOpenAIResponseStatus")
    ) {
      offenders.push(path);
    }
  }
  assertEquals(
    offenders,
    [],
    `Removed OpenAI Responses helpers still referenced by: ${offenders.join(", ")}`,
  );
});

Deno.test("closure — no production Edge Function reads retired Global AI env vars", async () => {
  const offenders: Array<{ path: string; hit: string }> = [];
  for await (const path of walkFunctionFiles()) {
    const src = await Deno.readTextFile(path);
    for (const name of BANNED_ENV_VARS) {
      const re = new RegExp(
        `Deno\\.env\\.get\\(\\s*["']${name}["']\\s*\\)`,
      );
      if (re.test(src)) offenders.push({ path, hit: name });
    }
    for (const prefix of BANNED_ENV_PREFIXES) {
      const re = new RegExp(
        `Deno\\.env\\.get\\(\\s*["']${prefix}[A-Z0-9_]+["']\\s*\\)`,
      );
      if (re.test(src)) offenders.push({ path, hit: `${prefix}*` });
    }
  }
  assertEquals(
    offenders,
    [],
    `Retired Global AI env readers found: ${offenders
      .map((o) => `${o.path} (${o.hit})`)
      .join(", ")}`,
  );
});
