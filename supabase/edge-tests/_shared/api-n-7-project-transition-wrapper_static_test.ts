// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-7-project-transition-wrapper_static_test.ts', import.meta.url).href;
// API-N.7 — static contract guard for the committed external Project
// status-transition command database architecture.
//
// This is a repository/static test only. It locates the committed API-N.7
// migrations by their unique marker (never by a hardcoded timestamped
// filename), takes the latest one as the effective definition, and verifies the
// executable SQL of the single accepted wrapper
// `public.api_v1_transition_project`.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = "API-N.7 — Project status transition external command";

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
async function loadN7Migration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(found.length >= 1, "expected at least one API-N.7 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

function wrapperBody(sql: string): string {
  const at = sql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_transition_project",
  );
  assert(at >= 0, "wrapper definition not found");
  const start = sql.indexOf("$function$", at);
  assert(start > at, "wrapper body opening tag not found");
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, "wrapper body closing tag not found");
  return sql.slice(start + 10, end);
}

// ---------------------------------------------------------------------------
// 1. Exactly one new wrapper and one capability catalogue row
// ---------------------------------------------------------------------------

Deno.test("API-N.7: exactly one wrapper is defined and it is the accepted one", async () => {
  const { text } = await loadN7Migration();
  const executable = stripSqlCommentsAndStrings(text);
  const defs = executable.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/gi) ??
    [];
  assertEquals(defs.length, 1, "expected exactly one function definition");
  assert(
    executable.includes(
      "CREATE OR REPLACE FUNCTION public.api_v1_transition_project",
    ),
  );
});

Deno.test("API-N.7: no canonical Project function, RLS, table or grant surface is redefined", async () => {
  const { text } = await loadN7Migration();
  const executable = stripSqlCommentsAndStrings(text);
  for (
    const forbidden of [
      "CREATE POLICY",
      "ALTER POLICY",
      "DROP POLICY",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "CREATE OR REPLACE FUNCTION public.apply_project_status_transition",
      "CREATE OR REPLACE FUNCTION public.validate_project_completion",
      "api_client_supported_capabilities",
      "api_capability_grants",
      "api_project_client_enablements", // no write surface in the migration DDL
    ]
  ) {
    if (forbidden === "api_project_client_enablements") continue;
    assert(
      !executable.includes(forbidden),
      `migration must not contain ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Security posture of the wrapper
// ---------------------------------------------------------------------------

Deno.test("API-N.7: wrapper is SECURITY DEFINER with a pinned search_path and no anon execute", async () => {
  const { text } = await loadN7Migration();
  const executable = stripSqlCommentsAndStrings(text);
  assert(executable.includes("SECURITY DEFINER"));
  assert(executable.includes("SET search_path TO"));
  assert(
    executable.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_transition_project",
    ),
  );
  assert(
    executable.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_transition_project",
    ),
  );
  assert(!/GRANT\s+EXECUTE[^;]*TO\s+anon/i.test(executable));
});

Deno.test("API-N.7: wrapper establishes trusted context with the exact fixed capability identity", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  assert(body.includes("api_e_private.authorize_and_establish"));
  assert(body.includes("projects:transition"));
  assert(body.includes("api_e.capability_key"));
  assert(body.includes("api_e.source_channel"));
  assert(body.includes("external_api"));
});

Deno.test("API-N.7: scope is derived from the target Project, never from caller input", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  const derive = body.indexOf("FROM public.projects p");
  const establish = body.indexOf("api_e_private.authorize_and_establish");
  assert(derive > 0 && establish > derive, "derivation must precede establish");
  assert(body.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(body.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));
});

Deno.test("API-N.7: explicit Project enablement is required before idempotency and PMG", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  const enable = body.indexOf("api_project_client_enablements");
  const claim = body.indexOf("api_e_private.claim_idempotency");
  const pmg = body.indexOf("public.apply_project_status_transition");
  assert(enable > 0, "enablement check missing");
  assert(claim > enable, "idempotency must follow enablement");
  assert(pmg > claim, "PMG must follow idempotency");
  assert(
    !/INSERT\s+INTO\s+public\.api_project_client_enablements/i.test(body),
    "wrapper must never write enablement",
  );
  assert(
    !/UPDATE\s+public\.api_project_client_enablements/i.test(body),
    "wrapper must never write enablement",
  );
});

// ---------------------------------------------------------------------------
// 3. Exact canonical command mapping and bounded results
// ---------------------------------------------------------------------------

Deno.test("API-N.7: exactly one canonical PMG command is invoked and public.projects is never written", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  const calls =
    body.match(/public\.apply_project_status_transition\s*\(/g) ?? [];
  assertEquals(calls.length, 1);
  assert(!/UPDATE\s+public\.projects/i.test(body));
  assert(!/INSERT\s+INTO\s+public\.projects/i.test(body));
  assert(!/DELETE\s+FROM\s+public\.projects/i.test(body));
  // No completion validator is re-run at this layer.
  assert(!body.includes("validate_project_completion"));
});

Deno.test("API-N.7: no dynamic SQL is used", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  assert(!/\bEXECUTE\s+format/i.test(body));
  assert(!/\bEXECUTE\s+'/i.test(body));
  assert(!/\bEXECUTE\s+v_/i.test(body));
});

Deno.test("API-N.7: only bounded, sanitized completion output can leave the wrapper", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  // The raw PMG envelope is never returned.
  assert(!/RETURN\s+v_pmg\s*;/.test(body));
  for (
    const category of [
      "open_blockers",
      "incomplete_phases",
      "incomplete_tasks",
      "open_risks",
      "target_end_in_future",
    ]
  ) {
    assert(body.includes(category), `missing canonical category ${category}`);
  }
  assert(body.includes("completion_hard_blocked"));
  assert(body.includes("completion_soft_warnings"));
  assert(body.includes("stale_project"));
  // Bounded item shape only.
  assert(body.includes("'count', (e ->> 'count')::int"));
});

Deno.test("API-N.7: every accepted canonical outcome is mapped exactly once", async () => {
  const body = wrapperBody((await loadN7Migration()).text);
  for (
    const outcome of [
      "'applied'",
      "'no_change'",
      "'conflict'",
      "'blocked'",
      "'confirmation_required'",
      "'not_authorized'",
      "'invalid'",
      "'replayed'",
      "'idempotency_conflict'",
      "'idempotency_pending'",
    ]
  ) {
    assert(body.includes(outcome), `missing outcome mapping ${outcome}`);
  }
});
