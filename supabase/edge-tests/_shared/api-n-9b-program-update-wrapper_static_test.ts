// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-9b-program-update-wrapper_static_test.ts', import.meta.url).href;
// API-N.9B — static contract guard for the committed external Program update
// command database architecture.
//
// Repository/static test only. It locates the committed API-N.9B migration by
// its unique marker (never by a hardcoded timestamped filename), takes the
// latest one as the effective definition, and verifies the executable SQL of
// the single accepted wrapper `public.api_v1_update_program`.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = "API-N.9B — Program update external command";

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

async function loadN9bMigration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(found.length >= 1, "expected at least one API-N.9B migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

function wrapperBody(sql: string): string {
  const at = sql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_update_program",
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
// 1. Existence, signature and security posture
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: exactly one api_v1_update_program wrapper is defined", async () => {
  const { text } = await loadN9bMigration();
  const executable = stripSqlCommentsAndStrings(text);
  assertEquals(
    countOccurrences(
      executable,
      "CREATE OR REPLACE FUNCTION public.api_v1_update_program",
    ),
    1,
  );
});

Deno.test("API-N.9B: wrapper declares the exact accepted parameter list", async () => {
  const { text } = await loadN9bMigration();
  const executable = stripSqlCommentsAndStrings(text);
  for (
    const param of [
      "_expected_oauth_client_id text",
      "_program_id uuid",
      "_expected_updated_at timestamptz",
      "_name text",
      "_status text",
      "_description text",
      "_set_description boolean",
      "_request_id text",
      "_correlation_id text",
      "_idempotency_key text",
      "_payload_hash text",
    ]
  ) {
    assert(executable.includes(param), `missing parameter ${param}`);
  }
});

Deno.test("API-N.9B: wrapper is SECURITY DEFINER with a pinned search_path", async () => {
  const { text } = await loadN9bMigration();
  const executable = stripSqlCommentsAndStrings(text);
  assert(executable.includes("SECURITY DEFINER"));
  assert(executable.includes("SET search_path TO"));
});

Deno.test("API-N.9B: execution privilege is revoked from PUBLIC and anon", async () => {
  const { text } = await loadN9bMigration();
  const executable = stripSqlCommentsAndStrings(text);
  assert(
    executable.includes("REVOKE ALL ON FUNCTION public.api_v1_update_program"),
  );
  assert(executable.includes("FROM PUBLIC"));
  assert(executable.includes("FROM anon"));
  assert(
    executable.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_update_program",
    ),
  );
  assert(executable.includes("TO authenticated"));
});

// ---------------------------------------------------------------------------
// 2. Fixed capability identity and trusted-context authority
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: the capability identity is a hardcoded constant trio", async () => {
  const { text } = await loadN9bMigration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));
  assert(body.includes("constant text"));
  assert(body.includes("c_capability_key"));
  assert(body.includes("c_capability_kind"));
  assert(body.includes("c_api_version"));
});

Deno.test("API-N.9B: trusted context is established exactly once", async () => {
  const { text } = await loadN9bMigration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));
  assertEquals(
    countOccurrences(body, "api_e_private.authorize_and_establish"),
    1,
  );
});

Deno.test("API-N.9B: derived scope is verified against the trusted context", async () => {
  const { text } = await loadN9bMigration();
  // Literal settings names are string literals, so the raw body is used here.
  const body = wrapperBody(text);
  for (
    const setting of [
      "api_e.api_client_id",
      "api_e.tenant_id",
      "api_e.organization_id",
      "api_e.workspace_id",
      "api_e.api_version",
      "api_e.capability_kind",
      "api_e.capability_key",
      "api_e.source_channel",
    ]
  ) {
    assert(body.includes(setting), `missing context check ${setting}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Idempotency and canonical command delegation
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: idempotency is claimed exactly once and always resolved", async () => {
  const { text } = await loadN9bMigration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));
  assertEquals(countOccurrences(body, "api_e_private.claim_idempotency"), 1);
  assertEquals(countOccurrences(body, "api_e_private.complete_idempotency"), 1);
  assert(countOccurrences(body, "api_e_private.fail_idempotency") >= 1);
});

Deno.test("API-N.9B: exactly one canonical PMG command is invoked and no table is written", async () => {
  const { text } = await loadN9bMigration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));
  assertEquals(countOccurrences(body, "public.apply_program_update"), 1);
  assert(!body.includes("public.apply_program_create"));
  for (
    const forbidden of [
      "UPDATE public.programs",
      "INSERT INTO public.programs",
      "DELETE FROM public.programs",
      "EXECUTE format",
      "btpm_decrypt",
      "btpm_encrypt",
    ]
  ) {
    assert(!body.includes(forbidden), `wrapper must not use ${forbidden}`);
  }
});

Deno.test("API-N.9B: the Program row is locked before the canonical command", async () => {
  const { text } = await loadN9bMigration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));
  const lock = body.indexOf("FOR UPDATE");
  const command = body.indexOf("public.apply_program_update");
  assert(lock > 0 && command > lock);
});

// ---------------------------------------------------------------------------
// 4. Bounded, non-enumerating result surface
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: only bounded outcomes and identifiers leave the wrapper", async () => {
  const { text } = await loadN9bMigration();
  const body = wrapperBody(text);
  for (
    const outcome of [
      "invalid",
      "not_authorized",
      "idempotency_conflict",
      "idempotency_pending",
      "conflict",
      "stale_program",
      "replayed",
    ]
  ) {
    assert(body.includes(outcome), `missing bounded outcome ${outcome}`);
  }
  // Never leak the current server timestamp of a stale target.
  assert(!body.includes("'current_updated_at'"));
  assert(!body.includes("\"current_updated_at\""));
});

// ---------------------------------------------------------------------------
// 5. Capability catalogue registration
// ---------------------------------------------------------------------------

Deno.test("API-N.9B: the programs:update capability row is registered additively", async () => {
  const { text } = await loadN9bMigration();
  assert(text.includes("public.api_capability_catalogue"));
  assert(text.includes("programs:update"));
  assert(text.includes("programs.update"));
  assert(text.includes("/v1/programs/:programid"));
  assert(text.includes("'workspace'"));
  assert(text.includes("'PATCH'"));
  assert(text.includes("ON CONFLICT"));
});
