// ME-1 — static contract guard for the private delegated "Me" identity +
// context authority resolver `api_e_private.resolve_me_context`.
//
// Repository/static test only: it locates the committed ME-1 migration by its
// unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL of the single added function, plus the non-goals of the step.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "ME-1 private substrate for the canonical me.get capability";

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

async function loadMigrations(): Promise<{ name: string; text: string }[]> {
  const all: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    all.push({
      name: entry.name,
      text: await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR)),
    });
  }
  all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return all;
}

const allMigrations = await loadMigrations();
const me1 = allMigrations.filter((m) => m.text.includes(MARKER));
assert(me1.length >= 1, "expected at least one ME-1 migration");
const migration = me1[me1.length - 1];
const sql = stripSqlComments(migration.text);

Deno.test("ME-1: exact private function signature is introduced", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.resolve_me_context\(\s*_expected_oauth_client_id text,\s*_context_type text DEFAULT NULL,\s*_context_id uuid DEFAULT NULL\s*\)\s*RETURNS jsonb/
      .test(sql),
    "resolve_me_context must be defined in api_e_private with the exact 3-argument signature returning jsonb",
  );
});

Deno.test("ME-1: STABLE, SECURITY DEFINER, fixed safe search_path", () => {
  assert(/\bSTABLE\b/.test(sql), "must be STABLE");
  assert(/\bSECURITY DEFINER\b/.test(sql), "must be SECURITY DEFINER");
  assert(
    /SET search_path = pg_catalog/.test(sql),
    "must pin a safe search_path",
  );
});

Deno.test("ME-1: PUBLIC, anon and authenticated EXECUTE are revoked and never granted", () => {
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.resolve_me_context(text, text, uuid) FROM ${role};`,
      ),
      `EXECUTE must be revoked from ${role}`,
    );
  }
  const grants = sql.match(/GRANT[^;]*;/g) ?? [];
  assertEquals(grants, [], "no GRANT may be issued by this migration");
});

Deno.test("ME-1: reuses the existing delegated principal resolver", () => {
  assert(
    sql.includes(
      "FROM api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id) r",
    ),
    "must reuse resolve_delegated_read_principal",
  );
  // No duplicated OAuth/client/policy/acknowledgement logic.
  for (
    const forbidden of [
      "api_client_policy_versions",
      "api_user_policy_acknowledgements",
      "jwt_client_id",
    ]
  ) {
    assert(
      !sql.includes(forbidden),
      `must not re-implement principal logic (${forbidden})`,
    );
  }
  assert(
    /_rowcount <> 1 OR _uid IS NULL OR _client_id IS NULL THEN\s*RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501';/
      .test(sql),
    "a single valid delegated principal must be required, failing closed with 42501",
  );
});

Deno.test("ME-1: me:read remains the only capability requirement", () => {
  const meRead = sql.match(/capability_key = 'me:read'/g) ?? [];
  assert(meRead.length >= 4, "me:read must be required on every path");
  const otherCaps = (sql.match(/capability_key = '[a-z_:]+'/g) ?? []).filter(
    (c) => !c.includes("'me:read'"),
  );
  assertEquals(otherCaps, [], "no other capability key may be used");
  assert(
    !sql.includes("api_capability_catalogue"),
    "the capability catalogue must not be modified or widened",
  );
});

Deno.test("ME-1: only the three exact context types are accepted", () => {
  assert(
    sql.includes(
      "_context_type NOT IN ('organization', 'workspace', 'project')",
    ),
    "context type allowlist must be exactly organization/workspace/project",
  );
  assert(
    sql.includes("_context_type IS NULL AND _context_id IS NOT NULL") &&
      sql.includes("_context_type IS NOT NULL AND _context_id IS NULL"),
    "mismatched context type/id pairs must be rejected",
  );
  const invalid = sql.match(/ERRCODE = '22023'/g) ?? [];
  assert(invalid.length >= 4, "invalid input must raise SQLSTATE 22023");
  assert(
    sql.includes("'00000000-0000-0000-0000-000000000000'::uuid"),
    "nil context UUID must be rejected",
  );
  assert(
    !/lower\(_context_type\)|btrim\(_context_type\)/.test(sql),
    "context type aliases must not be normalized",
  );
});

Deno.test("ME-1: Project context uses canonical has_project_access only", () => {
  assert(
    sql.includes("public.has_project_access(_uid, p.id)"),
    "Project visibility must use public.has_project_access",
  );
  assert(
    sql.includes("pm.removed_at IS NULL"),
    "removed Project membership must not be used",
  );
  assert(
    !sql.includes("task_assignments") && !sql.includes("project_team_members"),
    "no second Project-access implementation may be introduced",
  );
});

Deno.test("ME-1: hierarchy is server-derived and Connected App enablement enforced", () => {
  assert(
    sql.includes("ON w.id = p.workspace_id") &&
      sql.includes("ON o.id = w.organization_id") &&
      sql.includes("ON t.id = o.tenant_id"),
    "Workspace/Organization/Tenant must be derived from the stored hierarchy",
  );
  for (
    const table of [
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
    ]
  ) {
    assert(sql.includes(table), `${table} must be enforced`);
  }
  assert(
    !/_tenant_id_input|_organization_id_input|_workspace_id_input/.test(sql),
    "caller-provided hierarchy IDs must not be accepted",
  );
});

Deno.test("ME-1: Platform Super Admin is descriptive only", () => {
  assert(
    sql.includes("_super := COALESCE(public.is_platform_super_admin(_uid), false);"),
    "super admin status must be resolved server-side",
  );
  // It must never appear inside an access decision or as an effective role.
  assert(
    !/OR\s+public\.is_platform_super_admin/.test(sql),
    "super admin must never widen an access check",
  );
  assert(
    !/_effective_role :=[^;]*_super/.test(sql) &&
      !/_super THEN 'platform_super_admin'/.test(sql),
    "super admin must never become effectiveRole",
  );
});

Deno.test("ME-1: identity is decrypted through the existing protected path", () => {
  assert(
    sql.includes("public.btpm_decrypt(p.display_name, p.organization_id)"),
    "display name must be decrypted with the accepted helper",
  );
  assert(
    /_is_active IS DISTINCT FROM true THEN\s*RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501';/
      .test(sql),
    "deactivated users must fail closed before any payload",
  );
  assert(
    sql.includes("WHERE p.id = _uid"),
    "identity must be limited to the delegated user",
  );
  assert(
    !sql.includes("pgp_sym_decrypt") && !sql.includes("gen_salt("),
    "no bespoke cryptography may be introduced",
  );
});

Deno.test("ME-1: exact result field set, no enumeration, no membership arrays", () => {
  for (
    const field of [
      "'userId'",
      "'displayName'",
      "'email'",
      "'isActive'",
      "'platformSuperAdmin'",
      "'context'",
      "'type'",
      "'contextId'",
      "'tenantId'",
      "'organizationId'",
      "'workspaceId'",
      "'projectId'",
      "'tenantRole'",
      "'organizationRole'",
      "'workspaceRole'",
      "'projectRole'",
      "'effectiveRole'",
    ]
  ) {
    assert(sql.includes(field), `result field ${field} must be present`);
  }
  assert(
    !sql.includes("jsonb_agg") && !sql.includes("array_agg"),
    "no Organization/Workspace/Project or membership enumeration may be introduced",
  );
  for (
    const forbidden of [
      "'capabilities'",
      "'memberships'",
      "'token'",
      "'apiClientId'",
      "'policyVersionId'",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not expose ${forbidden}`);
  }
});

Deno.test("ME-1: nothing else is created, altered or granted", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION api_e_private.resolve_me_context",
  ]);
  for (
    const forbidden of [
      "CREATE POLICY",
      "ALTER POLICY",
      "DROP POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP FUNCTION",
      "CREATE TYPE",
      "FUNCTION public.api_v1_get_me",
      "authorize_and_establish",
      "service_role",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("ME-1: the live /v1/me contract and adapters are untouched", async () => {
  const base = new URL("../../functions/_shared/btpm-api/", import.meta.url);
  const readMe = await Deno.readTextFile(new URL("supabaseReadMe.ts", base));
  const delegated = await Deno.readTextFile(
    new URL("supabaseDelegatedReadMe.ts", base),
  );
  for (const source of [readMe, delegated]) {
    assert(
      !source.includes("resolve_me_context"),
      "REST adapters must not reference the ME-1 resolver until ME-2",
    );
  }
  // ME-2 activated the enriched payload through the dedicated REST wrapper;
  // the adapters must still never call the private ME-1 resolver directly.
  assert(
    readMe.includes('"api_v1_get_me_context"'),
    "the REST adapter must call the dedicated ME-2 wrapper",
  );

  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  assert(
    !registry.includes("resolve_me_context"),
    "MCP registry must be unchanged by ME-1",
  );

  // No later migration may redefine public.api_v1_get_me after ME-1.
  const later = allMigrations.filter((m) => m.name > migration.name);
  for (const m of later) {
    assert(
      !/FUNCTION public\.api_v1_get_me\s*\(/.test(m.text),
      `migration ${m.name} must not redefine public.api_v1_get_me`,
    );
  }
});
