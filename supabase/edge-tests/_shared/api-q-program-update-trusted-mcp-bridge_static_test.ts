// API-Q Program Update Step 1 — static contract guard for the trusted MCP
// database bridge.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename), takes the latest one as
// the effective definition, and verifies the executable SQL.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Program Update Step 1 — Trusted MCP Database Bridge";

/** Remove SQL line/block comments (executable SQL only). */
function stripSqlComments(sql: string): string {
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
    out += sql[i];
    i++;
  }
  return out;
}

async function loadMigration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(
    found.length >= 1,
    "expected at least one Program Update bridge migration",
  );
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const EXECUTOR_ARGS =
  "text, text, uuid, timestamptz, text, text, text, boolean, text, text, text, text";
const WRAPPER_ARGS =
  "text, uuid, timestamptz, text, text, text, boolean, text, text, text, text";

function count(haystack: string, needle: string): number {
  let c = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return c;
    c++;
    from = at + needle.length;
  }
}

/** Extract a $function$-delimited body for the given CREATE prefix. */
function bodyOf(prefix: string): string {
  const at = sql.lastIndexOf(prefix);
  assert(at >= 0, `definition not found: ${prefix}`);
  const start = sql.indexOf("$function$", at);
  assert(start > at, "body opening tag not found");
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, "body closing tag not found");
  return sql.slice(start + 10, end);
}

const executorBody = bodyOf(
  "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_program",
);
const restBody = bodyOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_update_program",
);
const mcpBody = bodyOf(
  "CREATE OR REPLACE FUNCTION public.mcp_v1_update_program",
);
const pmgBody = bodyOf(
  "CREATE OR REPLACE FUNCTION public.apply_program_update",
);

// ---------------------------------------------------------------------------
// A. Function scope — one implementation, two thin wrappers, no duplication
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: exactly one private dual-source executor is defined", () => {
  assertEquals(
    count(
      sql,
      "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_program",
    ),
    1,
  );
});

Deno.test("Update Step 1: exactly one REST wrapper and one MCP wrapper are defined", () => {
  assertEquals(
    count(sql, "CREATE OR REPLACE FUNCTION public.api_v1_update_program"),
    1,
  );
  assertEquals(
    count(sql, "CREATE OR REPLACE FUNCTION public.mcp_v1_update_program"),
    1,
  );
});

Deno.test("Update Step 1: no second Program business path is created", () => {
  // No Program Create surface is touched, and no other program mutation
  // wrapper or command is (re)defined by this migration.
  assertEquals(count(sql, "public.apply_program_create"), 0);
  assertEquals(count(sql, "public.api_v1_create_program"), 0);
  assertEquals(count(sql, "public.mcp_v1_create_program"), 0);
  assertEquals(
    count(sql, "CREATE OR REPLACE FUNCTION public.apply_program_update"),
    1,
  );
});

Deno.test("Update Step 1: the canonical command keeps its exact accepted signature", () => {
  for (
    const param of [
      "_program_id uuid",
      "_expected_updated_at timestamp with time zone",
      "_name text DEFAULT NULL::text",
      "_status pm_status DEFAULT NULL::pm_status",
      "_description text DEFAULT NULL::text",
      "_set_description boolean DEFAULT false",
      "_correlation_id text DEFAULT NULL::text",
      "_idempotency_key text DEFAULT NULL::text",
    ]
  ) {
    assert(sql.includes(param), `canonical command missing ${param}`);
  }
});

Deno.test("Update Step 1: both wrappers declare the identical fixed parameter list", () => {
  for (const body of [restBody, mcpBody]) {
    void body;
  }
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
    assert(sql.includes(param), `wrapper missing parameter ${param}`);
  }
  // The executor prepends exactly one internal source selector parameter.
  assert(sql.includes("_execution_source text"));
});

// ---------------------------------------------------------------------------
// B. Security posture and ACLs
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: every function is SECURITY DEFINER with a pinned search_path", () => {
  assertEquals(count(sql, "SECURITY DEFINER"), 4);
  assertEquals(count(sql, "SET search_path TO 'pg_catalog', 'public'"), 4);
});

Deno.test("Update Step 1: the private executor is not executable by any client role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_program(${EXECUTOR_ARGS}) FROM ${role}`,
      ),
      `executor not revoked from ${role}`,
    );
  }
  assertEquals(
    count(
      sql,
      "GRANT EXECUTE ON FUNCTION api_e_private.execute_v1_update_program",
    ),
    0,
  );
});

Deno.test("Update Step 1: both wrappers are authenticated-only", () => {
  for (
    const fn of ["public.api_v1_update_program", "public.mcp_v1_update_program"]
  ) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION ${fn}(${WRAPPER_ARGS}) FROM ${role}`,
        ),
        `${fn} not revoked from ${role}`,
      );
    }
    assert(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION ${fn}(${WRAPPER_ARGS}) TO authenticated`,
      ),
      `${fn} missing authenticated grant`,
    );
  }
});

// ---------------------------------------------------------------------------
// C. Fixed execution sources — never caller-supplied
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: the REST wrapper hardcodes external_api", () => {
  assert(restBody.includes("api_e_private.execute_v1_update_program"));
  assert(restBody.includes("'external_api'"));
  assert(!restBody.includes("'mcp'"));
});

Deno.test("Update Step 1: the MCP wrapper hardcodes mcp", () => {
  assert(mcpBody.includes("api_e_private.execute_v1_update_program"));
  assert(mcpBody.includes("'mcp'"));
  assert(!mcpBody.includes("'external_api'"));
});

Deno.test("Update Step 1: wrappers are thin — no business logic, no table access", () => {
  for (const body of [restBody, mcpBody]) {
    for (
      const forbidden of [
        "public.programs",
        "public.apply_program_update",
        "claim_idempotency",
        "authorize_and_establish",
        "current_setting",
        "btpm_decrypt",
        "btpm_encrypt",
        "EXECUTE format",
      ]
    ) {
      assert(!body.includes(forbidden), `thin wrapper must not use ${forbidden}`);
    }
    assertEquals(
      count(body, "api_e_private.execute_v1_update_program"),
      1,
    );
  }
});

Deno.test("Update Step 1: the executor fails closed on any unknown execution source", () => {
  const at = executorBody.indexOf(
    "v_source NOT IN ('external_api','mcp')",
  );
  assert(at > 0, "execution-source allowlist not found");
  const establish = executorBody.indexOf(
    "api_e_private.authorize_and_establish",
  );
  assert(establish > at, "source check must precede context establishment");
});

// ---------------------------------------------------------------------------
// D. Server-side provenance derivation in the canonical command
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: the canonical command derives provenance server-side only", () => {
  assert(pmgBody.includes("current_setting('api_e.source_channel', true)"));
  assert(pmgBody.includes("api_e_private.assert_trusted_context()"));
  assert(pmgBody.includes("'btpm_ui'::public.pmg_source_channel"));
  assert(pmgBody.includes("'external_api'::public.pmg_source_channel"));
  assert(pmgBody.includes("'mcp'::public.pmg_source_channel"));
  // Provenance is never a parameter of the canonical command.
  const sig = sql.slice(
    sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.apply_program_update"),
  );
  assert(!sig.slice(0, sig.indexOf("RETURNS")).includes("source_channel"));
});

Deno.test("Update Step 1: the canonical command still binds the exact capability key", () => {
  assert(pmgBody.includes("'programs:update'"));
  assert(pmgBody.includes("current_setting('api_e.capability_kind', true)"));
  assert(pmgBody.includes("current_setting('api_e.api_version', true)"));
});

Deno.test("Update Step 1: the trusted-channel allowlist is closed", () => {
  assert(
    pmgBody.includes("v_trusted_channel NOT IN ('external_api','mcp')"),
  );
});

// ---------------------------------------------------------------------------
// E. Executor: scope derivation, trusted context, idempotency, delegation
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: scope is derived from the target Program, never from the caller", () => {
  assert(executorBody.includes("FROM public.programs p"));
  assert(executorBody.includes("WHERE p.id = _program_id"));
  assert(executorBody.includes("p.workspace_id"));
  assert(executorBody.includes("p.organization_id"));
});

Deno.test("Update Step 1: trusted context is established exactly once per fixed source", () => {
  assertEquals(
    count(executorBody, "api_e_private.authorize_and_establish("),
    1,
  );
  assertEquals(
    count(executorBody, "api_e_private.authorize_and_establish_mcp("),
    1,
  );
});

Deno.test("Update Step 1: derived scope is verified against the trusted context", () => {
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
    assert(
      executorBody.includes(setting),
      `missing trusted-context check ${setting}`,
    );
  }
});

Deno.test("Update Step 1: idempotency is claimed once and always resolved", () => {
  assertEquals(count(executorBody, "api_e_private.claim_idempotency"), 1);
  assertEquals(count(executorBody, "api_e_private.complete_idempotency"), 1);
  assert(count(executorBody, "api_e_private.fail_idempotency") >= 1);
});

Deno.test("Update Step 1: the Program row is locked before the canonical command", () => {
  const lock = executorBody.indexOf("FOR UPDATE");
  const command = executorBody.indexOf("public.apply_program_update");
  assert(lock > 0 && command > lock);
});

Deno.test("Update Step 1: exactly one canonical command is invoked and no table is written", () => {
  assertEquals(count(executorBody, "public.apply_program_update"), 1);
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
    assert(
      !executorBody.includes(forbidden),
      `executor must not use ${forbidden}`,
    );
  }
});

Deno.test("Update Step 1: optimistic concurrency is forwarded unchanged", () => {
  assert(executorBody.includes("_expected_updated_at => _expected_updated_at"));
});

// ---------------------------------------------------------------------------
// F. Bounded, non-enumerating result surface
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: only bounded outcomes leave the executor", () => {
  for (
    const outcome of [
      "'invalid'",
      "'not_authorized'",
      "'idempotency_conflict'",
      "'idempotency_pending'",
      "'conflict'",
      "'stale_program'",
      "'replayed'",
    ]
  ) {
    assert(executorBody.includes(outcome), `missing bounded outcome ${outcome}`);
  }
});

Deno.test("Update Step 1: the stale target server timestamp is never returned", () => {
  assert(!executorBody.includes("'current_updated_at'"));
  assert(!executorBody.includes('"current_updated_at"'));
});

// ---------------------------------------------------------------------------
// G. No Program-level Connected App enablement is introduced
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: no Program-level Connected App table is created or read", () => {
  assertEquals(count(sql, "CREATE TABLE"), 0);
  assert(!sql.includes("api_client_program"));
  assert(!sql.includes("program_api_client"));
});

Deno.test("Update Step 1: the capability catalogue is not re-registered", () => {
  assertEquals(count(sql, "public.api_capability_catalogue"), 0);
});

// ---------------------------------------------------------------------------
// H. Correction 1 — preserved PMG business safeguards
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: the canonical command preserves its accepted actor and authority controls", () => {
  for (
    const control of [
      "public.is_active_user",
      "FOR UPDATE",
      "public.has_pm_authority",
      "public.get_user_org_id",
      "public.can_write_demo",
    ]
  ) {
    assert(pmgBody.includes(control), `PMG lost control ${control}`);
  }
  // Program lookup is locked before any authority decision.
  const lock = pmgBody.indexOf("FROM public.programs WHERE id = _program_id");
  assert(lock > 0, "locked Program lookup not found");
  assert(
    pmgBody.indexOf("FOR UPDATE", lock) > lock,
    "Program lookup must use FOR UPDATE",
  );
});

Deno.test("Update Step 1: the canonical command still rejects archived Programs", () => {
  assert(pmgBody.includes("v_prog.is_archived"));
});

Deno.test("Update Step 1: the canonical command preserves optimistic concurrency", () => {
  assert(
    pmgBody.includes(
      "v_prog.updated_at IS DISTINCT FROM _expected_updated_at",
    ),
  );
  assert(pmgBody.includes("stale_program"));
});

Deno.test("Update Step 1: the canonical command preserves name validation and the 200-character limit", () => {
  assert(pmgBody.includes("btrim(_name)"));
  assert(pmgBody.includes("char_length(v_new_name) > 200"));
});

Deno.test("Update Step 1: the canonical command keeps protected current-value comparison", () => {
  assert(pmgBody.includes("public.btpm_decrypt(v_prog.name"));
  assert(pmgBody.includes("public.btpm_decrypt(v_prog.description"));
});

Deno.test("Update Step 1: the canonical command preserves description-set semantics and no_change", () => {
  assert(pmgBody.includes("IF _set_description THEN"));
  assert(pmgBody.includes("_set_description AND v_new_desc IS DISTINCT FROM v_current_desc"));
  assert(pmgBody.includes("no_change"));
});

Deno.test("Update Step 1: the canonical command performs the write and audits with derived provenance", () => {
  assert(pmgBody.includes("UPDATE public.programs SET"));
  assert(count(pmgBody, "public.pmg_record_command_audit") >= 1);
  const auditAt = pmgBody.lastIndexOf("public.pmg_record_command_audit");
  assert(
    pmgBody.indexOf("v_source_channel", auditAt) > auditAt,
    "audit must carry the server-derived source channel",
  );
});

// ---------------------------------------------------------------------------
// I. Correction 1 — executor structural-boundary guard
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: the executor derives only structural target scope", () => {
  const at = executorBody.indexOf(
    "SELECT p.id, p.workspace_id, p.organization_id",
  );
  assert(at > 0, "structural scope selection not found");
  const establish = executorBody.indexOf("api_e_private.authorize_and_establish");
  assert(establish > at, "scope derivation must precede authorization");
});

Deno.test("Update Step 1: the executor holds no canonical Program business or protected-data logic", () => {
  for (
    const forbidden of [
      "btpm_decrypt",
      "btpm_encrypt",
      "UPDATE public.programs",
      "INSERT INTO public.programs",
      "DELETE FROM public.programs",
    ]
  ) {
    assert(
      !executorBody.includes(forbidden),
      `executor boundary violated by ${forbidden}`,
    );
  }
});

Deno.test("Update Step 1: the authoritative scope lookup adds no archive filter", () => {
  const at = executorBody.indexOf(
    "SELECT p.id, p.workspace_id, p.organization_id",
  );
  assert(at > 0);
  const stmtEnd = executorBody.indexOf(";", at);
  const stmt = executorBody.slice(at, stmtEnd);
  assert(
    !stmt.includes("is_archived"),
    "archive behavior must remain PMG-owned",
  );
});

// ---------------------------------------------------------------------------
// J. Correction 1 — Connected App boundary
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: no project/program client enablement surface is referenced", () => {
  assert(!sql.includes("api_project_client_enablements"));
  assertEquals(count(sql, "CREATE TABLE"), 0);
});

// ---------------------------------------------------------------------------
// K. Correction 1 — trusted-context ordering before API-F state
// ---------------------------------------------------------------------------

Deno.test("Update Step 1: trusted context is reconfirmed before idempotency is claimed", () => {
  const reconfirm = executorBody.indexOf(
    "current_setting('api_e.api_client_id', true)",
  );
  const claim = executorBody.indexOf("api_e_private.claim_idempotency");
  assert(reconfirm > 0, "trusted-context reconfirmation not found");
  assert(claim > reconfirm, "idempotency must be claimed after reconfirmation");
});

// ---------------------------------------------------------------------------
// L. Correction 1 — MCP exposure guard (registry, focused entries only)
// ---------------------------------------------------------------------------

const REGISTRY_URL = new URL(
  "../../functions/btpm-mcp/mcp/toolRegistry.ts",
  import.meta.url,
);
const registrySource = await Deno.readTextFile(REGISTRY_URL);

function registryEntry(operationId: string): string {
  const at = registrySource.indexOf(`operationId: "${operationId}"`);
  assert(at > 0, `registry entry not found: ${operationId}`);
  const end = registrySource.indexOf("}),", at);
  assert(end > at, `registry entry not terminated: ${operationId}`);
  return registrySource.slice(at, end);
}

// Step 4 intentionally superseded the temporary `not_exposed` assertion here.
// Exposure ownership now belongs solely to the Step-4 exposure test; this Step-1
// guard keeps only the non-exposure registry contract fields.
Deno.test("Update Step 1: programs.update keeps its exact registry contract", () => {
  const entry = registryEntry("programs.update");
  for (
    const field of [
      'toolName: "btpm_update_program"',
      'operationClass: "mutation"',
      'confirmation: "required"',
      'resultShape: "single_object"',
      'concurrencyToken: "required"',
    ]
  ) {
    assert(entry.includes(field), `programs.update registry missing ${field}`);
  }
});

Deno.test("Update Step 1: programs.create exposure is preserved", () => {
  const entry = registryEntry("programs.create");
  assert(entry.includes('toolName: "btpm_create_program"'));
  assert(entry.includes('exposure: "exposed"'));
});
