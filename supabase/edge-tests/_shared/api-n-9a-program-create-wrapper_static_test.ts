// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-9a-program-create-wrapper_static_test.ts', import.meta.url).href;
// API-N.9A — static contract guard for the committed external Program create
// command database architecture.
//
// This is a repository/static test only. It locates the committed API-N.9A
// migrations by their unique marker (never by a hardcoded timestamped
// filename), takes the latest one as the effective definition, and verifies the
// executable SQL of the single accepted wrapper `public.api_v1_create_program`.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = "API-N.9A — Program create external command";

/** Remove SQL line/block comments and string literals (executable SQL only). */
function stripSqlCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (sql[i] === "'") {
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
      out += " '' ";
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/** The latest marker-bearing migration is the effective wrapper definition. */
async function loadN9aMigration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(found.length >= 1, "expected at least one API-N.9A migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

function wrapperBody(sql: string): string {
  const at = sql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_create_program",
  );
  assert(at >= 0, "wrapper definition not found");
  const start = sql.indexOf("$function$", at);
  assert(start > at, "wrapper body opening tag not found");
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, "wrapper body closing tag not found");
  return sql.slice(start + 10, end);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}

// ---------------------------------------------------------------------------
// 1. Wrapper existence and exact signature
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: exactly one api_v1_create_program wrapper is defined", async () => {
  const { text } = await loadN9aMigration();
  const executable = stripSqlCommentsAndStrings(text);
  assertEquals(
    countOccurrences(
      executable,
      "CREATE OR REPLACE FUNCTION public.api_v1_create_program",
    ),
    1,
  );
});

Deno.test("API-N.9A: wrapper takes the exact fixed external argument list", async () => {
  const { text } = await loadN9aMigration();
  const executable = stripSqlCommentsAndStrings(text);
  for (
    const arg of [
      "_expected_oauth_client_id text",
      "_workspace_id uuid",
      "_name text",
      "_description text",
      "_request_id text",
      "_correlation_id text",
      "_idempotency_key text",
      "_payload_hash text",
    ]
  ) {
    assert(executable.includes(arg), `missing argument ${arg}`);
  }
  // No Organization, Tenant, user, status or archive argument is accepted.
  // Only the declared argument list is inspected, so internal variable names
  // are deliberately out of scope here.
  const sigAt = executable.indexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_create_program",
  );
  const signature = executable.slice(sigAt, executable.indexOf(")", sigAt));
  for (
    const forbidden of [
      "_organization_id",
      "_tenant_id",
      "_user_id",
      "_actor",
      "_status",
      "_is_archived",
      "_program_id",
    ]
  ) {
    assert(
      !signature.includes(forbidden),
      `forbidden external argument ${forbidden}`,
    );
  }
});

Deno.test("API-N.9A: wrapper is SECURITY DEFINER with a pinned search_path", async () => {
  const { text } = await loadN9aMigration();
  const executable = stripSqlCommentsAndStrings(text);
  assert(executable.includes("SECURITY DEFINER"));
  assert(executable.includes("SET search_path TO"));
  assert(executable.includes("RETURNS jsonb"));
});

// ---------------------------------------------------------------------------
// 2. Authorization architecture
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: wrapper derives the Organization server-side from workspaces", async () => {
  const body = stripSqlCommentsAndStrings(
    wrapperBody((await loadN9aMigration()).text),
  );
  assert(body.includes("FROM public.workspaces"));
  assert(body.includes("v_organization_id"));
  assert(body.includes("w.organization_id"));
  // The Organization is derived from the Workspace row, not from caller input.
  assert(body.includes("w.id = _workspace_id"));
});

Deno.test("API-N.9A: wrapper establishes trusted API-E context exactly once", async () => {
  const body = stripSqlCommentsAndStrings(
    wrapperBody((await loadN9aMigration()).text),
  );
  assertEquals(
    countOccurrences(body, "api_e_private.authorize_and_establish("),
    1,
  );
  assert(body.includes("v_trusted IS NOT TRUE"));
});

Deno.test("API-N.9A: wrapper binds exactly the programs:create capability", async () => {
  const { text } = await loadN9aMigration();
  const raw = text;
  // The literal capability key appears in the wrapper constant declaration.
  assert(raw.includes("c_capability_key  constant text := 'programs:create'"));
  const body = raw.slice(raw.indexOf("$function$"));
  for (
    const forbidden of [
      "'programs:update'",
      "'programs:list'",
      "'programs:read'",
      "'projects:create'",
      "'projects:update'",
      "'projects:transition'",
    ]
  ) {
    assert(!body.includes(forbidden), `unexpected capability ${forbidden}`);
  }
});

Deno.test("API-N.9A: wrapper verifies trusted context before idempotency and execution", async () => {
  const body = stripSqlCommentsAndStrings(
    wrapperBody((await loadN9aMigration()).text),
  );
  const contextAt = body.indexOf("v_ctx_client_id IS NULL");
  const claimAt = body.indexOf("api_e_private.claim_idempotency(");
  const executeAt = body.indexOf("public.apply_program_create(");
  assert(contextAt > 0, "trusted context verification missing");
  assert(claimAt > contextAt, "idempotency must follow context verification");
  assert(executeAt > claimAt, "execution must follow the idempotency claim");
});

// ---------------------------------------------------------------------------
// 3. Idempotency and canonical execution
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: wrapper uses the three API-F idempotency helpers exactly once each", async () => {
  const body = stripSqlCommentsAndStrings(
    wrapperBody((await loadN9aMigration()).text),
  );
  assertEquals(countOccurrences(body, "api_e_private.claim_idempotency("), 1);
  assertEquals(
    countOccurrences(body, "api_e_private.complete_idempotency("),
    1,
  );
  assertEquals(countOccurrences(body, "api_e_private.fail_idempotency("), 2);
});

Deno.test("API-N.9A: wrapper calls exactly one canonical PMG command and never writes public.programs", async () => {
  const body = stripSqlCommentsAndStrings(
    wrapperBody((await loadN9aMigration()).text),
  );
  assertEquals(countOccurrences(body, "public.apply_program_create("), 1);
  for (
    const forbidden of [
      "INSERT INTO public.programs",
      "UPDATE public.programs",
      "DELETE FROM public.programs",
      "public.apply_program_update(",
      "public.apply_project_create",
    ]
  ) {
    assert(!body.includes(forbidden), `forbidden statement ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Bounded result surface and privileges
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: wrapper returns only bounded outcomes and the new Program identifier", async () => {
  const raw = (await loadN9aMigration()).text;
  const body = raw.slice(
    raw.indexOf("$function$"),
    raw.lastIndexOf("$function$"),
  );
  for (
    const outcome of [
      "'invalid'",
      "'not_authorized'",
      "'idempotency_conflict'",
      "'idempotency_pending'",
      "'applied'",
      "'replayed'",
    ]
  ) {
    assert(body.includes(outcome), `missing bounded outcome ${outcome}`);
  }
  assert(body.includes("'programId', v_program_id"));
  // No Program name/description/organization/user leakage in the result.
  assert(!body.includes("'name', "));
  assert(!body.includes("'description', "));
  assert(!body.includes("'organizationId'"));
  assert(!body.includes("'tenantId'"));
});

Deno.test("API-N.9A: wrapper execution is revoked from PUBLIC/anon and granted only to authenticated", async () => {
  const executable = stripSqlCommentsAndStrings(
    (await loadN9aMigration()).text,
  );
  assert(executable.includes("REVOKE ALL ON FUNCTION public.api_v1_create_program"));
  assert(executable.includes("FROM PUBLIC"));
  assert(executable.includes("FROM anon"));
  assert(
    executable.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_create_program",
    ),
  );
  assert(executable.includes("TO authenticated"));
  assert(!executable.includes("TO anon;"));
});

// ---------------------------------------------------------------------------
// 5. Capability registration hygiene
// ---------------------------------------------------------------------------

Deno.test("API-N.9A: migration registers only the programs:create catalogue row and grants nothing", async () => {
  const { text } = await loadN9aMigration();
  const executable = stripSqlCommentsAndStrings(text);
  assertEquals(
    countOccurrences(executable, "INSERT INTO public.api_capability_catalogue"),
    1,
  );
  for (
    const forbidden of [
      "api_capability_grants",
      "api_client_supported_capabilities",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
    ]
  ) {
    assert(
      !executable.includes(forbidden),
      `migration must not touch ${forbidden}`,
    );
  }
});
