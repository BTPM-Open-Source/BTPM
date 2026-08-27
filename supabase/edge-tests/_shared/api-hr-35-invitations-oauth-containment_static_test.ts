// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-hr-35-invitations-oauth-containment_static_test.ts', import.meta.url).href;
// API-HR.35 — Invitation OAuth direct-read containment (static contract test).
//
// Structural inspection of the committed API-HR.35 migration only. No live calls,
// no invitation creation/redemption, no OAuth probe.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);

const MARKER = "API-HR.35";
const TABLE = "invitations";

const ACCEPTED_USING =
  "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()";

const EXISTING_POLICIES = [
  "inv_select_admin",
  "inv_insert_admin",
  "inv_update_admin",
];

const AUTHORITY_HELPERS = [
  "auth.uid()",
  "is_active_user",
  "is_org_admin",
  "is_workspace_admin_or_higher",
  "is_organization_admin",
  "is_tenant_admin",
  "is_platform_super_admin",
];

const TOKEN_AND_SENSITIVE_FIELDS = [
  "token",
  "digest",
  "sha256",
  "encode(",
  "email",
  "invited_by",
];

const LIFECYCLE_OBJECTS = [
  "accept_invitation",
  "accept_pending_invitation_for_user",
  "auto_accept_pending_invitations",
  "admin_create_invitation",
  "admin_resend_invitation",
  "admin_revoke_invitation",
  "admin_delete_invitation",
  "admin_list_invitations",
  "enforce_invitation_scope_integrity",
  "validate_invitation_status",
  "update_updated_at_column",
  "trg_invitations_scope_integrity",
  "trg_validate_invitation_status",
  "update_invitations_updated_at",
  "redeem-invitations",
];

async function migrationNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return names;
}

async function findMigration(): Promise<string> {
  const matches: string[] = [];
  for (const name of await migrationNames()) {
    const text = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) matches.push(name);
  }
  assertEquals(
    matches.length,
    1,
    `Expected exactly one migration containing marker ${MARKER}, found: ${matches.join(", ")}`,
  );
  return matches[0];
}

async function migrationSql(): Promise<string> {
  return await Deno.readTextFile(new URL(await findMigration(), MIGRATIONS_DIR));
}

Deno.test("API-HR.35 migration exists, is unique and carries the marker", async () => {
  const name = await findMigration();
  assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
  assertStringIncludes(await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)), MARKER);
});

Deno.test(`API-HR.35 creates exactly one policy api_e_oauth_read_containment on public.${TABLE}`, async () => {
  const sql = await migrationSql();
  const creates = sql.match(/CREATE\s+POLICY\s+([a-zA-Z0-9_"]+)/gi) ?? [];
  assertEquals(creates.length, 1, "Exactly one CREATE POLICY is allowed.");
  assertStringIncludes(creates[0] ?? "", "api_e_oauth_read_containment");
  assert(
    new RegExp(
      `CREATE\\s+POLICY\\s+api_e_oauth_read_containment\\s+ON\\s+public\\.${TABLE}\\b`,
      "i",
    ).test(sql),
    `Policy must target public.${TABLE}.`,
  );
});

Deno.test("API-HR.35 policy is restrictive SELECT for authenticated", async () => {
  const sql = await migrationSql();
  assert(/AS\s+RESTRICTIVE/i.test(sql), "Policy must be AS RESTRICTIVE.");
  assert(/FOR\s+SELECT/i.test(sql), "Policy must be FOR SELECT.");
  assert(/TO\s+authenticated/i.test(sql), "Policy must be granted TO authenticated.");
  assert(
    !/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(sql),
    "No other policy command allowed.",
  );
  assert(
    !/\bTO\s+(anon|public|service_role)\b/i.test(sql),
    "Only authenticated may be targeted.",
  );
});

Deno.test("API-HR.35 USING expression is exactly the accepted containment", async () => {
  const sql = await migrationSql();
  const match = sql.match(/USING\s*\(([\s\S]*?)\)\s*;/i);
  assert(match, "Policy must declare a USING expression.");
  const expr = match![1].replace(/\s+/g, " ").trim();
  assertEquals(expr, ACCEPTED_USING);
  assert(!/WITH\s+CHECK/i.test(sql), "No WITH CHECK clause allowed.");
});

Deno.test("API-HR.35 declares fail-closed base-table and duplicate-policy guards", async () => {
  const sql = await migrationSql();
  const raises = sql.match(/RAISE\s+EXCEPTION/gi) ?? [];
  assert(raises.length >= 2, "Both fail-closed guards must raise exceptions.");
  assert(/relkind\s*=\s*'r'/i.test(sql), "Base-table existence guard required.");
  assert(
    new RegExp(`relname\\s*=\\s*'${TABLE}'`, "i").test(sql),
    "Base-table guard must reference the assigned table.",
  );
  assert(
    /pg_policies/i.test(sql) && /policyname\s*=\s*'api_e_oauth_read_containment'/i.test(sql),
    "Duplicate-policy guard required.",
  );
});

Deno.test("API-HR.35 targets no second business table", async () => {
  const sql = await migrationSql();
  const refs = new Set(
    [...sql.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
  );
  assertEquals([...refs], [TABLE], `Only public.${TABLE} may be referenced.`);
});

Deno.test("API-HR.35 leaves existing invitation policies and authority helpers untouched", async () => {
  const sql = await migrationSql();
  for (const name of [...EXISTING_POLICIES, ...AUTHORITY_HELPERS]) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
  assert(!/DROP\s+POLICY/i.test(sql), "No policy drop permitted.");
  assert(!/ALTER\s+POLICY/i.test(sql), "No policy alteration permitted.");
  assert(!/RENAME/i.test(sql), "No rename permitted.");
});

Deno.test("API-HR.35 references no invitation token, hash or identity field", async () => {
  const sql = await migrationSql();
  for (const field of TOKEN_AND_SENSITIVE_FIELDS) {
    assert(!sql.includes(field), `Migration must not reference ${field}.`);
  }
});

Deno.test("API-HR.35 references no invitation lifecycle function, trigger or caller", async () => {
  const sql = await migrationSql();
  for (const name of LIFECYCLE_OBJECTS) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
  assert(!/\bstorage\./i.test(sql), "No storage schema reference permitted.");
  assert(!/\bauth\./i.test(sql), "No auth schema reference permitted.");
});

Deno.test("API-HR.35 performs no DML or backfill", async () => {
  const sql = await migrationSql();
  for (const re of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bCOPY\b/i,
    /\bMERGE\b/i,
  ]) {
    assert(!re.test(sql), `Forbidden DML construct: ${re}`);
  }
});

Deno.test("API-HR.35 changes no grant, function, trigger, index, view, enum, constraint or table definition", async () => {
  const sql = await migrationSql();
  const forbidden: Array<[RegExp, string]> = [
    [/\bGRANT\b/i, "grant"],
    [/\bREVOKE\b/i, "revoke"],
    [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i, "function definition"],
    [/DROP\s+FUNCTION/i, "function drop"],
    [/ALTER\s+FUNCTION/i, "function alteration"],
    [/CREATE\s+TRIGGER/i, "trigger creation"],
    [/DROP\s+TRIGGER/i, "trigger drop"],
    [/ALTER\s+TRIGGER/i, "trigger alteration"],
    [/CREATE\s+(UNIQUE\s+)?INDEX/i, "index creation"],
    [/DROP\s+INDEX/i, "index drop"],
    [/CREATE\s+TABLE/i, "table creation"],
    [/ALTER\s+TABLE/i, "table alteration"],
    [/DROP\s+TABLE/i, "table drop"],
    [/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i, "view definition"],
    [/CREATE\s+TYPE/i, "enum/type creation"],
    [/ALTER\s+TYPE/i, "enum/type alteration"],
    [/CREATE\s+SCHEMA/i, "schema creation"],
    [/ADD\s+CONSTRAINT/i, "constraint addition"],
    [/DROP\s+CONSTRAINT/i, "constraint drop"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(sql), `Migration must not include ${label}.`);
  }
});
