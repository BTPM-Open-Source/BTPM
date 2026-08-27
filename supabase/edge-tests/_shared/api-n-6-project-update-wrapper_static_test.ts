// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-6-project-update-wrapper_static_test.ts', import.meta.url).href;
// API-N.6 — static contract guard for the committed external Project metadata
// update command database architecture.
//
// This is a repository/static test only. It locates the committed API-N.6
// migration by its unique marker (never by a hardcoded timestamped filename)
// and verifies the executable SQL of the single accepted wrapper
// `public.api_v1_update_project`.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = "API-N.6 — Project metadata update external command";

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

async function loadN6Migration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assertEquals(found.length, 1, "expected exactly one API-N.6 migration");
  return found[0];
}

function wrapperBody(sql: string): string {
  const at = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_update_project",
  );
  assert(at >= 0, "wrapper definition not found");
  const start = sql.indexOf("$function$", at);
  assert(start > at, "wrapper body opening tag not found");
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, "wrapper body closing tag not found");
  return sql.slice(start + 10, end);
}

// ---------------------------------------------------------------------------
// 1. Capability catalogue metadata only
// ---------------------------------------------------------------------------

Deno.test("API-N.6: exactly one capability catalogue registration for projects:update", async () => {
  const { text } = await loadN6Migration();
  const exec = stripSqlCommentsAndStrings(text);

  assertEquals(
    (text.match(/INSERT\s+INTO\s+public\.api_capability_catalogue/gi) ?? [])
      .length,
    1,
  );

  const values = text.slice(text.indexOf("VALUES"));
  for (
    const literal of [
      "'v1'",
      "'command'",
      "'projects:update'",
      "'projects.update'",
      "'PATCH'",
      "'/v1/projects/:projectid'",
      "'workspace'",
      "'Update Project'",
      "true",
      "'active'",
    ]
  ) {
    assert(values.includes(literal), `catalogue row missing ${literal}`);
  }

  for (
    const relation of [
      "api_client_supported_capabilities",
      "api_capability_grants",
      "api_project_client_enablements",
    ]
  ) {
    assert(
      !new RegExp(
        `(INSERT\\s+INTO|UPDATE\\s+[a-z_]*\\.?${relation}|DELETE\\s+FROM)\\s+[a-z_]*\\.?${relation}`,
        "i",
      ).test(exec),
      `migration must not write ${relation}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Wrapper signature
// ---------------------------------------------------------------------------

Deno.test("API-N.6: exactly one wrapper definition with the fixed typed signature", async () => {
  const { text } = await loadN6Migration();
  const exec = stripSqlCommentsAndStrings(text);

  assertEquals(
    (exec.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.api_v1_update_project\s*\(/gi,
    ) ?? []).length,
    1,
  );

  const at = exec.indexOf("public.api_v1_update_project");
  const header = exec.slice(at, exec.indexOf("$function$", at));

  for (
    const param of [
      "_expected_oauth_client_id text",
      "_project_id uuid",
      "_expected_updated_at timestamptz",
      "_name text",
      "_priority text",
      "_description text",
      "_charter text",
      "_goals text",
      "_scope_in text",
      "_scope_out text",
      "_business_case text",
      "_success_criteria text",
      "_completion_criteria text",
      "_budget_narrative text",
      "_assumptions text",
      "_constraints text",
      "_program_id uuid",
      "_delivery_model text",
      "_set_name boolean",
      "_set_priority boolean",
      "_set_description boolean",
      "_set_charter boolean",
      "_set_goals boolean",
      "_set_scope_in boolean",
      "_set_scope_out boolean",
      "_set_business_case boolean",
      "_set_success_criteria boolean",
      "_set_completion_criteria boolean",
      "_set_budget_narrative boolean",
      "_set_assumptions boolean",
      "_set_constraints boolean",
      "_set_program_id boolean",
      "_set_delivery_model boolean",
      "_request_id text",
      "_correlation_id text",
      "_idempotency_key text",
      "_payload_hash text",
    ]
  ) {
    assert(header.includes(param), `signature missing ${param}`);
  }

  // Exactly fifteen values and fifteen presence flags.
  assertEquals((header.match(/_set_[a-z_]+\s+boolean/g) ?? []).length, 15);

  assert(/RETURNS\s+jsonb/i.test(header));
  assert(/LANGUAGE\s+plpgsql/i.test(header));
  assert(/SECURITY\s+DEFINER/i.test(header));
  assert(/SET\s+search_path\s+TO/i.test(header));

  const searchPath = text.slice(
    text.indexOf("SET search_path", text.indexOf("api_v1_update_project")),
  ).split("\n")[0];
  assert(searchPath.includes("pg_catalog"));
  assert(searchPath.includes("public"));

  // No caller-supplied Tenant/Organization/Workspace or capability inputs.
  for (
    const forbidden of [
      /_tenant_id/i,
      /_organization_id/i,
      /_workspace_id/i,
      /_capability_key\s+text/i,
      /_capability_kind\s+text/i,
      /_api_version\s+text/i,
      /_status/i,
      /_start_date/i,
      /_target_end_date/i,
      /_project_stage/i,
      /_is_archived/i,
      /_agile_enabled/i,
    ]
  ) {
    assert(!forbidden.test(header), `signature must not accept ${forbidden}`);
  }
});

Deno.test("API-N.6: capability identity is hardcoded, never caller-controlled", async () => {
  const { text } = await loadN6Migration();
  const body = wrapperBody(text);
  for (
    const decl of [
      /c_api_version\s+constant\s+text\s*:=\s*'v1'/i,
      /c_capability_kind\s+constant\s+text\s*:=\s*'command'/i,
      /c_capability_key\s+constant\s+text\s*:=\s*'projects:update'/i,
    ]
  ) {
    assert(decl.test(body), `missing hardcoded constant: ${decl}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Target-derived containment, trusted context, Project enablement
// ---------------------------------------------------------------------------

Deno.test("API-N.6: Workspace and Organization are derived from the target Project", async () => {
  const { text } = await loadN6Migration();
  const raw = wrapperBody(text);
  const body = stripSqlCommentsAndStrings(raw);

  assert(/FROM\s+public\.projects/i.test(body));
  assert(/p\.id\s*=\s*_project_id/i.test(body));
  assert(body.includes("v_workspace_id"));
  assert(body.includes("v_organization_id"));
  assert(raw.includes("'not_authorized'"));

  // No narrative column is read for containment.
  for (const col of ["p.charter", "p.description", "p.business_case"]) {
    assert(!body.includes(col), `containment must not read ${col}`);
  }
});

Deno.test("API-N.6: trusted context is established and verified before execution", async () => {
  const { text } = await loadN6Migration();
  const raw = wrapperBody(text);
  const body = stripSqlCommentsAndStrings(raw);

  const authorizeAt = body.indexOf("api_e_private.authorize_and_establish");
  assert(authorizeAt >= 0);
  const enablementAt = body.indexOf("api_project_client_enablements");
  const claimAt = body.indexOf("api_e_private.claim_idempotency");
  const pmgAt = body.indexOf("public.apply_project_update");

  assert(authorizeAt < enablementAt, "authorization precedes enablement");
  assert(enablementAt < claimAt, "enablement precedes the API-F claim");
  assert(claimAt < pmgAt, "API-F claim precedes canonical execution");

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
    assert(raw.includes(setting), `missing trusted-context check: ${setting}`);
  }
  assert(raw.includes("'external_api'"));
});

Deno.test("API-N.6: explicit Project Connected App enablement is required and never written", async () => {
  const { text } = await loadN6Migration();
  const raw = wrapperBody(text);
  const body = stripSqlCommentsAndStrings(raw);

  assert(/FROM\s+public\.api_project_client_enablements/i.test(body));
  for (
    const predicate of [
      "e.project_id",
      "e.api_client_id",
      "e.tenant_id",
      "e.organization_id",
      "e.workspace_id",
      "e.enabled_at IS NOT NULL",
      "e.disabled_at IS NULL",
    ]
  ) {
    assert(raw.includes(predicate), `enablement check missing ${predicate}`);
  }
  assert(raw.includes("'enabled'"));

  assert(
    !/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[a-z_]*\.?api_project_client_enablements/i
      .test(body),
    "wrapper must never write Project Connected App enablement",
  );
});

// ---------------------------------------------------------------------------
// 4. API-F idempotency
// ---------------------------------------------------------------------------

Deno.test("API-N.6: idempotency uses the fixed command key with full decision handling", async () => {
  const { text } = await loadN6Migration();
  const raw = wrapperBody(text);
  const body = stripSqlCommentsAndStrings(raw);

  assert(
    /api_e_private\.claim_idempotency\s*\(\s*c_capability_key\s*,/i.test(body),
  );
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(raw.includes(`'${decision}'`), `missing decision: ${decision}`);
  }
  assert(body.includes("api_e_private.complete_idempotency"));
  assert(body.includes("api_e_private.fail_idempotency"));
  assert(raw.includes("'stale_project'"));
  assert(raw.includes("'replayed'"));

  // Replay must return before the canonical command is ever invoked.
  const replayAt = raw.indexOf("'replay'");
  const executeAt = raw.indexOf("'execute'", replayAt);
  const replayBlock = raw.slice(replayAt, executeAt);
  assert(!replayBlock.includes("apply_project_update"));
});

// ---------------------------------------------------------------------------
// 5. Canonical command authority and bounded results
// ---------------------------------------------------------------------------

Deno.test("API-N.6: exactly one canonical PMG invocation with exact _set_* mapping", async () => {
  const { text } = await loadN6Migration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));

  assertEquals(
    (body.match(/public\.apply_project_update\s*\(/g) ?? []).length,
    1,
  );

  for (
    const flag of [
      "_set_name => _set_name",
      "_set_priority => _set_priority",
      "_set_description => _set_description",
      "_set_charter => _set_charter",
      "_set_goals => _set_goals",
      "_set_scope_in => _set_scope_in",
      "_set_scope_out => _set_scope_out",
      "_set_business_case => _set_business_case",
      "_set_success_criteria => _set_success_criteria",
      "_set_completion_criteria => _set_completion_criteria",
      "_set_budget_narrative => _set_budget_narrative",
      "_set_assumptions => _set_assumptions",
      "_set_constraints => _set_constraints",
      "_set_program_id => _set_program_id",
      "_set_delivery_model => _set_delivery_model",
    ]
  ) {
    assert(body.includes(flag), `PMG call missing exact mapping: ${flag}`);
  }

  // No direct business write, no planning/status/stage function, no manual
  // encryption.
  for (
    const forbidden of [
      /UPDATE\s+public\.projects\s+SET/i,
      /INSERT\s+INTO\s+public\.projects/i,
      /DELETE\s+FROM\s+public\.projects/i,
      /apply_project_planning_change/i,
      /apply_project_status_transition/i,
      /btpm_encrypt/i,
      /btpm_decrypt/i,
    ]
  ) {
    assert(!forbidden.test(body), `wrapper must not contain ${forbidden}`);
  }
});

Deno.test("API-N.6: bounded result shape only, and canonical privileges", async () => {
  const { text } = await loadN6Migration();
  const raw = wrapperBody(text);

  assert(raw.includes("'projectId'"));
  assert(raw.includes("'updatedAt'"));
  assert(raw.includes("'outcome'"));
  assert(raw.includes("'no_change'"));

  for (
    const forbidden of [
      "'name'",
      "'description'",
      "'charter'",
      "'payloadHash'",
      "'payload_hash'",
    ]
  ) {
    assert(!raw.includes(forbidden), `result must not expose ${forbidden}`);
  }

  const exec = stripSqlCommentsAndStrings(text);
  assert(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.api_v1_update_project[\s\S]*FROM\s+PUBLIC/i
      .test(exec),
  );
  assert(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.api_v1_update_project[\s\S]*FROM\s+anon/i
      .test(exec),
  );
  assert(
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.api_v1_update_project[\s\S]*TO\s+authenticated/i
      .test(exec),
  );
});

Deno.test("API-N.6: no dynamic SQL and no generic dispatcher", async () => {
  const { text } = await loadN6Migration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));
  for (
    const forbidden of [
      /\bEXECUTE\s+format\s*\(/i,
      /\bEXECUTE\s+'/i,
      /\bEXECUTE\s+v_/i,
      /quote_ident/i,
      /quote_literal/i,
    ]
  ) {
    assert(!forbidden.test(body), `dynamic SQL is forbidden: ${forbidden}`);
  }
});
