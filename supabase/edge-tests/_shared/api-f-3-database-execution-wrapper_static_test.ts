// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-f-3-database-execution-wrapper_static_test.ts', import.meta.url).href;
// API-F.3A — Explicit database execution wrapper contract and static guard.
//
// Repository-only static contract test. It reads the committed contract
// document, the API-F.2 migrations, and every migration in the repository,
// then asserts the guarantees required by
// `docs/governance/api/API_F3_DATABASE_EXECUTION_WRAPPER_CONTRACT.md`.
//
// This test does NOT connect to the database and does NOT execute SQL.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);
const MIGRATIONS_DIR = new URL("supabase/migrations/", REPO_ROOT);
const CONTRACT_URL = new URL(
  "docs/governance/api/API_F3_DATABASE_EXECUTION_WRAPPER_CONTRACT.md",
  REPO_ROOT,
);

const UNIQUE_MARKER = "API-F.3A — Explicit wrapper transaction contract";

interface Migration {
  name: string;
  text: string;
}

async function loadMigrations(): Promise<Migration[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const out: Migration[] = [];
  for (const name of names) {
    out.push({
      name,
      text: await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)),
    });
  }
  return out;
}

function findMigrationsContaining(
  migrations: readonly Migration[],
  needle: RegExp,
): Migration[] {
  return migrations.filter((m) => needle.test(m.text));
}

function findSingleMigration(
  migrations: readonly Migration[],
  needle: RegExp,
  label: string,
): Migration {
  const hits = findMigrationsContaining(migrations, needle);
  assertEquals(
    hits.length,
    1,
    `expected exactly one migration containing ${label}, got ${hits.length}: ${
      hits.map((m) => m.name).join(", ")
    }`,
  );
  return hits[0];
}

Deno.test("API-F.3A contract document exists and carries the unique marker", async () => {
  const text = await Deno.readTextFile(CONTRACT_URL);
  assert(
    text.includes(UNIQUE_MARKER),
    "contract document must contain the unique API-F.3A marker",
  );
});

Deno.test("API-F.3A contract requires dedicated one-command wrappers", async () => {
  const text = await Deno.readTextFile(CONTRACT_URL);
  assert(
    /dedicated database wrapper/i.test(text),
    "contract must require a dedicated database wrapper per mutation",
  );
  assert(
    /exactly one hardcoded canonical PMG command/i.test(text),
    "contract must require exactly one hardcoded canonical PMG command per wrapper",
  );
  assert(
    /fixed capability key/i.test(text),
    "contract must require a fixed capability key",
  );
});

Deno.test("API-F.3A contract prohibits generic RPC execution", async () => {
  const text = await Deno.readTextFile(CONTRACT_URL);
  const prohibitions = [
    /dynamic SQL/i,
    /PL\/pgSQL `?EXECUTE`?/i,
    /regprocedure/i,
    /function-OID dispatch/i,
    /command-to-function lookup table/i,
    /CASE statement that dispatches arbitrary PMG commands/i,
    /generic table CRUD/i,
    /PostgREST write passthrough/i,
    /consumer-controlled provenance/i,
    /service-role impersonation/i,
    /committing an idempotency result separately from its PMG mutation/i,
    /function name/i,
    /RPC name/i,
    /table name/i,
    /SQL text/i,
    /generic command handler/i,
    /generic payload/i,
  ];
  for (const re of prohibitions) {
    assert(
      re.test(text),
      `contract must explicitly prohibit ${re}`,
    );
  }
});

Deno.test("api_e_private.claim_idempotency(text, text, text) exists with required properties", async () => {
  const migrations = await loadMigrations();
  const marker =
    /CREATE OR REPLACE FUNCTION\s+api_e_private\.claim_idempotency\s*\(\s*_command\s+text\s*,\s*_idempotency_key\s+text\s*,\s*_payload_hash\s+text\s*\)/;
  const migration = findSingleMigration(
    migrations,
    marker,
    "api_e_private.claim_idempotency(text, text, text)",
  );
  const text = migration.text;

  assert(
    /assert_trusted_context\s*\(\s*\)/.test(text),
    "claim_idempotency must require trusted context",
  );
  assert(
    /api_e\.capability_kind[\s\S]*'command'/.test(text),
    "claim_idempotency must require capability_kind = 'command'",
  );
  assert(
    /_command\s*<>\s*v_capability_key/.test(text),
    "claim_idempotency must bind _command to trusted capability_key",
  );
  assert(
    /ON CONFLICT ON CONSTRAINT\s+api_idempotency_registry_scope_unique\s+DO NOTHING/i
      .test(text),
    "claim_idempotency must use ON CONFLICT ON CONSTRAINT api_idempotency_registry_scope_unique DO NOTHING",
  );

  // No pre-insert existence probe against the registry.
  const bodyStart = text.search(
    /CREATE OR REPLACE FUNCTION\s+api_e_private\.claim_idempotency/,
  );
  assert(bodyStart >= 0);
  const insertPos = text.indexOf("INSERT INTO public.api_idempotency_registry");
  assert(insertPos > bodyStart, "INSERT must be present in claim function");
  const preInsert = text.slice(bodyStart, insertPos);
  assert(
    !/SELECT[\s\S]*FROM\s+public\.api_idempotency_registry/i.test(preInsert),
    "claim_idempotency must not contain a pre-insert existence query on the registry",
  );
});

Deno.test("api_e_private.complete_idempotency and fail_idempotency exist with required properties", async () => {
  const migrations = await loadMigrations();

  const completeMarker =
    /CREATE OR REPLACE FUNCTION\s+api_e_private\.complete_idempotency\s*\(\s*_registry_id\s+uuid\s*,\s*_canonical_result\s+jsonb\s*\)/;
  const failMarker =
    /CREATE OR REPLACE FUNCTION\s+api_e_private\.fail_idempotency\s*\(\s*_registry_id\s+uuid\s*,\s*_failure_code\s+text\s*\)/;

  const migration = findSingleMigration(
    migrations,
    completeMarker,
    "api_e_private.complete_idempotency(uuid, jsonb)",
  );
  const failMigration = findSingleMigration(
    migrations,
    failMarker,
    "api_e_private.fail_idempotency(uuid, text)",
  );
  assertEquals(
    migration.name,
    failMigration.name,
    "complete_idempotency and fail_idempotency must live in the same migration",
  );

  const text = migration.text;
  for (const label of ["complete_idempotency", "fail_idempotency"]) {
    const bodyStart = text.indexOf(
      `CREATE OR REPLACE FUNCTION api_e_private.${label}`,
    );
    assert(bodyStart >= 0, `${label} definition must exist`);
    const bodyEnd = text.indexOf("$$;", bodyStart);
    assert(bodyEnd > bodyStart, `${label} body must terminate with $$;`);
    const body = text.slice(bodyStart, bodyEnd);

    assert(
      /assert_trusted_context\s*\(\s*\)/.test(body),
      `${label} must require trusted context`,
    );
    assert(
      /requested_user_id\s*=\s*v_user_id/.test(body),
      `${label} must match trusted user`,
    );
    assert(
      /source_client_id\s*=\s*v_client_id/.test(body),
      `${label} must match trusted client`,
    );
    assert(
      /command\s*=\s*v_capability_key/.test(body),
      `${label} must bind command to trusted capability_key`,
    );
    assert(
      /state\s*=\s*'pending'/.test(body),
      `${label} must transition only from pending state`,
    );
    assert(
      /UPDATE\s+public\.api_idempotency_registry[\s\S]+RETURNING\s+id\s+INTO/i
        .test(body),
      `${label} must use UPDATE ... RETURNING`,
    );
  }
});

Deno.test("all three private helpers revoke access from PUBLIC, anon, and authenticated", async () => {
  const migrations = await loadMigrations();
  const combined = migrations.map((m) => m.text).join("\n");
  const helpers: Array<{ label: string; signature: string }> = [
    { label: "claim_idempotency", signature: "claim_idempotency(text, text, text)" },
    { label: "complete_idempotency", signature: "complete_idempotency(uuid, jsonb)" },
    { label: "fail_idempotency", signature: "fail_idempotency(uuid, text)" },
  ];
  for (const { label, signature } of helpers) {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      const re = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+api_e_private\\.${
          signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        }\\s+FROM\\s+${role}\\b`,
        "i",
      );
      assert(
        re.test(combined),
        `${label} must revoke ALL from ${role}`,
      );
    }
  }
});

// Strip SQL line comments, block comments, and single-quoted string literals
// (including the `''` escape) while preserving everything else — including
// dollar-quoted function bodies, which is where PL/pgSQL EXECUTE lives.
export function stripSqlCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";
    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl < 0) break;
      out += "\n";
      i = nl + 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Extract SQL function definitions using dollar-quote-aware body slicing,
// including tagged delimiters such as `$function$` or `$body$`.
export interface ExtractedFunction {
  schema: string;
  name: string;
  body: string;
}

export function extractSqlFunctions(sql: string): ExtractedFunction[] {
  const results: ExtractedFunction[] = [];
  const headerRe =
    /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
  const tagRe = /\bAS\s+(\$[a-zA-Z_0-9]*\$)/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(sql)) !== null) {
    const schema = m[1];
    const name = m[2];
    tagRe.lastIndex = m.index + m[0].length;
    const tagMatch = tagRe.exec(sql);
    if (!tagMatch) continue;
    const tag = tagMatch[1];
    const bodyStart = tagMatch.index + tagMatch[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd < 0) continue;
    results.push({ schema, name, body: sql.slice(bodyStart, bodyEnd) });
    headerRe.lastIndex = bodyEnd + tag.length;
  }
  return results;
}

Deno.test("API-F.2 migrations contain no dynamic EXECUTE, function-name parameter, regprocedure, or generic dispatch", async () => {
  const migrations = await loadMigrations();
  const f2Migrations = findMigrationsContaining(
    migrations,
    /api_idempotency_registry|claim_idempotency|complete_idempotency|fail_idempotency/,
  );
  assert(f2Migrations.length >= 1, "API-F.2 migrations must be present");

  for (const migration of f2Migrations) {
    const text = migration.text;
    const scrubbed = stripSqlCommentsAndStrings(text);
    // `GRANT/REVOKE ... EXECUTE ON FUNCTION` is privilege management, not dynamic SQL.
    assert(
      !/\bEXECUTE\b(?!\s+ON\b)/i.test(scrubbed),
      `${migration.name}: must not contain any executable PL/pgSQL EXECUTE statement`,
    );
    assert(
      !/\bregprocedure\b/i.test(text),
      `${migration.name}: must not use regprocedure`,
    );
    assert(
      !/_function_name\s+text|_rpc_name\s+text|_target_function\s+text/i.test(
        text,
      ),
      `${migration.name}: must not accept a function-name parameter`,
    );
    assert(
      !/CASE\s+[a-z_]*command[a-z_]*\s+WHEN\s+'/i.test(text),
      `${migration.name}: must not contain a generic command-dispatch CASE`,
    );
  }
});

Deno.test("dynamic-EXECUTE detector: inline fixtures for positive and negative cases", () => {
  // Positive: bare variable EXECUTE.
  const posVar = `BEGIN EXECUTE v_sql; END;`;
  assert(
    /\bEXECUTE\b/i.test(stripSqlCommentsAndStrings(posVar)),
    "EXECUTE v_sql; must be detected as dynamic SQL",
  );

  // Positive: EXECUTE format(...).
  const posFormat =
    `BEGIN EXECUTE format('SELECT %I', name) INTO r; END;`;
  assert(
    /\bEXECUTE\b/i.test(stripSqlCommentsAndStrings(posFormat)),
    "EXECUTE format(...) must be detected as dynamic SQL",
  );

  // Negative: the word 'execute' inside a string literal must not be flagged.
  const negLiteral =
    `SELECT 'execute this is not dynamic sql' AS decision;`;
  assert(
    !/\bEXECUTE\b/i.test(stripSqlCommentsAndStrings(negLiteral)),
    "'execute' inside a string literal must not be treated as dynamic SQL",
  );

  // Negative: EXECUTE inside a line comment must not be flagged.
  const negLineComment = `-- EXECUTE v_sql\nSELECT 1;`;
  assert(
    !/\bEXECUTE\b/i.test(stripSqlCommentsAndStrings(negLineComment)),
    "EXECUTE inside a line comment must not be treated as dynamic SQL",
  );

  // Negative: EXECUTE inside a block comment must not be flagged.
  const negBlockComment = `/* EXECUTE v_sql */ SELECT 1;`;
  assert(
    !/\bEXECUTE\b/i.test(stripSqlCommentsAndStrings(negBlockComment)),
    "EXECUTE inside a block comment must not be treated as dynamic SQL",
  );

  // Negative: escaped quote inside literal must not break literal boundary.
  const negEscaped =
    `SELECT 'it''s fine to say execute here' AS msg;`;
  assert(
    !/\bEXECUTE\b/i.test(stripSqlCommentsAndStrings(negEscaped)),
    "'' escape inside a literal must be handled correctly",
  );
});

// MCP-HARDENING-C10A: explicit exact-name allowlist of the PUBLIC SQL wrappers
// that are permitted to call the private API-F idempotency helpers
// (API-I.5 execution updates, API-K.5 Risks, API-K.6 Blockers, API-M.7A/B
// Phases, API-M.10A/B/C Tasks, API-N.5 Project, Program, and the accepted
// API-Q Portfolio mutation family).
//
// This is an exact-name allowlist by design: no prefix, wildcard, regex,
// substring or discovery-based matching is permitted. Migration discovery is
// never self-approval — a new public function that calls a private idempotency
// helper fails the guard below until its exact name is deliberately added here.
//
// Note: wrappers that delegate to an `api_e_private.execute_v1_*` executor
// (for example the KPI mutation family) do not call the helpers from their own
// public body and therefore intentionally do not belong in this allowlist.
const APPROVED_IDEMPOTENCY_WRAPPER_NAMES = [
  "api_v1_append_execution_update",
  "api_v1_create_risk",
  "api_v1_update_risk",
  "api_v1_create_blocker",
  "api_v1_update_blocker",
  "api_v1_create_phase",
  "api_v1_update_phase",
  "api_v1_reorder_phases",
  "api_v1_plan_phase",
  "api_v1_create_task",
  "api_v1_update_task",
  "api_v1_reorder_tasks",
  "api_v1_plan_task",
  "api_v1_assign_task",
  "api_v1_transition_task",
  "api_v1_create_project",
  "api_v1_update_project",
  "api_v1_transition_project",
  "api_v1_create_program",
  "api_v1_update_program",
  "api_v1_create_portfolio",
  "api_v1_update_portfolio",
  "api_v1_assign_project_portfolio",
] as const;

// The literal source list above is the governance authority. It is deliberately
// NOT derived from the migration scan, so the comparison below stays a real
// security guard instead of a tautology. The membership Set is derived
// mechanically from that single literal source.
const APPROVED_IDEMPOTENCY_WRAPPERS = new Set<string>(
  APPROVED_IDEMPOTENCY_WRAPPER_NAMES,
);

const IDEMPOTENCY_HELPERS = [
  "claim_idempotency",
  "complete_idempotency",
  "fail_idempotency",
] as const;

function bodyCallsAnyIdempotencyHelper(body: string): boolean {
  const scrubbed = stripSqlCommentsAndStrings(body);
  return IDEMPOTENCY_HELPERS.some((helper) =>
    new RegExp(`\\bapi_e_private\\.${helper}\\s*\\(`, "i").test(scrubbed)
  );
}

interface PublicFunctionSurface {
  /** Every normalized PUBLIC function name defined anywhere in migrations. */
  allNames: Set<string>;
  /**
   * Normalized PUBLIC function names with at least one migration definition
   * whose executable body calls a private idempotency helper. Function
   * redefinitions across migration history are unioned, not counted.
   */
  helperCallerNames: Set<string>;
}

async function loadPublicFunctionSurface(): Promise<PublicFunctionSurface> {
  const migrations = await loadMigrations();
  const combined = migrations.map((m) => m.text).join("\n");
  const allNames = new Set<string>();
  const helperCallerNames = new Set<string>();
  for (const fn of extractSqlFunctions(combined)) {
    if (fn.schema.toLowerCase() !== "public") continue;
    const name = fn.name.toLowerCase();
    allNames.add(name);
    if (bodyCallsAnyIdempotencyHelper(fn.body)) helperCallerNames.add(name);
  }
  return { allNames, helperCallerNames };
}

// MCP-HARDENING-C10A: durable structural invariants replace the former fixed
// global wrapper cardinality assertion and its duplicated expected inventory.
Deno.test("API-F allowlist entries are unique, normalized exact public wrapper names", () => {
  const source = APPROVED_IDEMPOTENCY_WRAPPER_NAMES;
  assertEquals(
    source.length,
    new Set(source).size,
    "allowlist source must not contain duplicate entries",
  );
  assertEquals(
    APPROVED_IDEMPOTENCY_WRAPPERS.size,
    source.length,
    "allowlist set must describe the same inventory as the single literal source",
  );
  for (const name of source) {
    assert(
      APPROVED_IDEMPOTENCY_WRAPPERS.has(name),
      `allowlist set missing ${name}`,
    );
    assertEquals(
      name,
      name.toLowerCase().trim(),
      `allowlist entry ${name} must be a normalized exact name`,
    );
    assert(
      /^[a-z][a-z0-9_]*$/.test(name),
      `allowlist entry ${name} must be a bare unqualified public function name`,
    );
  }
});

Deno.test("every allowlisted wrapper exists in the migration-defined public function surface", async () => {
  const { allNames } = await loadPublicFunctionSurface();
  for (const name of APPROVED_IDEMPOTENCY_WRAPPERS) {
    assert(
      allNames.has(name),
      `allowlisted wrapper public.${name} has no migration definition`,
    );
  }
});

Deno.test("every allowlisted wrapper genuinely uses the private idempotency substrate", async () => {
  const { helperCallerNames } = await loadPublicFunctionSurface();
  for (const name of APPROVED_IDEMPOTENCY_WRAPPERS) {
    assert(
      helperCallerNames.has(name),
      `allowlisted wrapper public.${name} has no migration definition whose body calls a private idempotency helper`,
    );
  }
});

Deno.test("every discovered public idempotency-helper caller is explicitly allowlisted", async () => {
  const { helperCallerNames } = await loadPublicFunctionSurface();
  const unapproved = [...helperCallerNames]
    .filter((name) => !APPROVED_IDEMPOTENCY_WRAPPERS.has(name))
    .sort();
  assertEquals(
    unapproved,
    [],
    `unapproved public idempotency-helper callers detected: ${
      unapproved.join(", ")
    }`,
  );
});



Deno.test("only the approved explicit wrappers call the three private idempotency helpers (by body, not by name)", async () => {
  const migrations = await loadMigrations();
  const combined = migrations.map((m) => m.text).join("\n");
  const fns = extractSqlFunctions(combined);
  for (const fn of fns) {
    if (fn.schema.toLowerCase() !== "public") continue;
    if (APPROVED_IDEMPOTENCY_WRAPPERS.has(fn.name.toLowerCase())) continue;
    const scrubbed = stripSqlCommentsAndStrings(fn.body);
    for (const helper of IDEMPOTENCY_HELPERS) {
      const re = new RegExp(`\\bapi_e_private\\.${helper}\\s*\\(`, "i");
      assert(
        !re.test(scrubbed),
        `public function ${fn.schema}.${fn.name} must not call api_e_private.${helper}(...)`,
      );
    }
  }
});

Deno.test("public-wrapper detector: inline negative fixture with a differently named wrapper", () => {
  // This SQL is test data only. It is NEVER written to a migration file.
  const fixture = `
CREATE OR REPLACE FUNCTION public.some_other_name()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM api_e_private.claim_idempotency('x', 'y', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
END;
$$;
`;
  const fns = extractSqlFunctions(fixture);
  assertEquals(fns.length, 1, "fixture must extract exactly one function");
  assertEquals(fns[0].schema, "public");
  assertEquals(fns[0].name, "some_other_name");
  const scrubbed = stripSqlCommentsAndStrings(fns[0].body);
  assert(
    /\bapi_e_private\.claim_idempotency\s*\(/i.test(scrubbed),
    "detector must find api_e_private.claim_idempotency call regardless of the wrapper's name",
  );

  // Tagged dollar-quote variant.
  const taggedFixture = `
CREATE OR REPLACE FUNCTION public.another_wrapper()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM api_e_private.complete_idempotency('00000000-0000-0000-0000-000000000000'::uuid, '{}'::jsonb);
END;
$function$;
`;
  const taggedFns = extractSqlFunctions(taggedFixture);
  assertEquals(taggedFns.length, 1);
  assert(
    /\bapi_e_private\.complete_idempotency\s*\(/i.test(
      stripSqlCommentsAndStrings(taggedFns[0].body),
    ),
    "detector must handle tagged $function$ delimiters",
  );
});
