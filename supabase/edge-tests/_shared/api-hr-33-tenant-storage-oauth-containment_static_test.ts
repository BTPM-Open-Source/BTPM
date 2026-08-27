// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-hr-33-tenant-storage-oauth-containment_static_test.ts', import.meta.url).href;
// API-HR.33 — Tenant import / export / storage OAuth direct-read containment
// (parameterized static contract test).
//
// Structural inspection of the committed API-HR.33A/B/C migrations only. No live calls,
// no storage operation, no upload/download, no OAuth probe.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);

const ACCEPTED_USING =
  "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()";

const AUTHORITY_HELPERS = [
  "auth.uid()",
  "is_platform_super_admin",
  "is_tenant_admin",
  "is_tenant_member",
  "is_organization_admin",
  "is_organization_member",
  "is_workspace_member",
];

const PROTECTED_HELPERS = [
  "btpm_encrypt",
  "btpm_decrypt",
  "ensure_org_encryption_key",
  "get_file_encryption_key",
  "get_protected_download_url",
  "validate_upload_permission",
  "storage.objects",
  "storage.buckets",
  "btpm-attachments",
  "btpm-exports",
  "btpm-imports-temp",
  "update_updated_at_column",
  "enforce_tenant_scoped_boundaries",
];

interface SubStep {
  id: string;
  marker: string;
  table: string;
  protectedNames: string[];
}

const SUB_STEPS: SubStep[] = [
  {
    id: "API-HR.33A",
    marker: "API-HR.33A",
    table: "tenant_export_packages",
    protectedNames: [
      "Service role manages tenant_export_packages",
      "Users view export packages in their scope",
      ...AUTHORITY_HELPERS,
      ...PROTECTED_HELPERS,
      "requested_by",
      "storage_object_id",
      "export_type",
      "trg_tep_updated_at",
      "trg_tep_boundaries",
      "tenant_import_temp_objects",
      "tenant_storage_objects",
      "btpm_import_batches",
    ],
  },
  {
    id: "API-HR.33B",
    marker: "API-HR.33B",
    table: "tenant_import_temp_objects",
    protectedNames: [
      "Service role manages tenant_import_temp_objects",
      "Users view own imports and scope admins",
      ...AUTHORITY_HELPERS,
      ...PROTECTED_HELPERS,
      "uploaded_by",
      "storage_object_id",
      "import_type",
      "expires_at",
      "trg_tito_updated_at",
      "trg_tito_boundaries",
      "tenant_export_packages",
      "tenant_storage_objects",
      "btpm_import_batches",
    ],
  },
  {
    id: "API-HR.33C",
    marker: "API-HR.33C",
    table: "tenant_storage_objects",
    protectedNames: [
      "Service role manages tenant_storage_objects",
      "Users can view storage objects in their scope",
      ...AUTHORITY_HELPERS,
      ...PROTECTED_HELPERS,
      "created_by",
      "object_path",
      "legacy_object_path",
      "storage_status",
      "file_name",
      "checksum",
      "trg_tso_updated_at",
      "trg_tso_boundaries",
      "tenant_export_packages",
      "tenant_import_temp_objects",
      "btpm_import_batches",
    ],
  },
];

async function migrationNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return names;
}

async function findMigration(marker: string): Promise<string> {
  const matches: string[] = [];
  for (const name of await migrationNames()) {
    const text = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    if (text.includes(marker)) matches.push(name);
  }
  assertEquals(
    matches.length,
    1,
    `Expected exactly one migration containing marker ${marker}, found: ${matches.join(", ")}`,
  );
  return matches[0];
}

async function migrationSql(marker: string): Promise<string> {
  return await Deno.readTextFile(new URL(await findMigration(marker), MIGRATIONS_DIR));
}

for (const step of SUB_STEPS) {
  Deno.test(`${step.id} migration exists, is unique and carries the marker`, async () => {
    const name = await findMigration(step.marker);
    assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    assertStringIncludes(sql, step.marker);
  });

  Deno.test(`${step.id} creates exactly one policy api_e_oauth_read_containment on public.${step.table}`, async () => {
    const sql = await migrationSql(step.marker);
    const creates = sql.match(/CREATE\s+POLICY\s+([a-zA-Z0-9_"]+)/gi) ?? [];
    assertEquals(creates.length, 1, "Exactly one CREATE POLICY is allowed.");
    assertStringIncludes(creates[0] ?? "", "api_e_oauth_read_containment");
    assert(
      new RegExp(
        `CREATE\\s+POLICY\\s+api_e_oauth_read_containment\\s+ON\\s+public\\.${step.table}\\b`,
        "i",
      ).test(sql),
      `Policy must target public.${step.table}.`,
    );
  });

  Deno.test(`${step.id} policy is restrictive SELECT for authenticated`, async () => {
    const sql = await migrationSql(step.marker);
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

  Deno.test(`${step.id} USING expression is exactly the accepted containment`, async () => {
    const sql = await migrationSql(step.marker);
    const match = sql.match(/USING\s*\(([\s\S]*?)\)\s*;/i);
    assert(match, "Policy must declare a USING expression.");
    const expr = match![1].replace(/\s+/g, " ").trim();
    assertEquals(expr, ACCEPTED_USING);
    assert(!/WITH\s+CHECK/i.test(sql), "No WITH CHECK clause allowed.");
  });

  Deno.test(`${step.id} declares fail-closed base-table and duplicate-policy guards`, async () => {
    const sql = await migrationSql(step.marker);
    const raises = sql.match(/RAISE\s+EXCEPTION/gi) ?? [];
    assert(raises.length >= 2, "Both fail-closed guards must raise exceptions.");
    assert(/relkind\s*=\s*'r'/i.test(sql), "Base-table existence guard required.");
    assert(
      new RegExp(`relname\\s*=\\s*'${step.table}'`, "i").test(sql),
      "Base-table guard must reference the assigned table.",
    );
    assert(
      /pg_policies/i.test(sql) && /policyname\s*=\s*'api_e_oauth_read_containment'/i.test(sql),
      "Duplicate-policy guard required.",
    );
  });

  Deno.test(`${step.id} targets no second business table`, async () => {
    const sql = await migrationSql(step.marker);
    const refs = new Set(
      [...sql.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
    );
    assertEquals([...refs], [step.table], `Only public.${step.table} may be referenced.`);
  });

  Deno.test(`${step.id} leaves existing policies, helpers, storage and protected objects untouched`, async () => {
    const sql = await migrationSql(step.marker);
    for (const name of step.protectedNames) {
      assert(!sql.includes(name), `Migration must not reference ${name}.`);
    }
    assert(!/DROP\s+POLICY/i.test(sql), "No policy drop permitted.");
    assert(!/ALTER\s+POLICY/i.test(sql), "No policy alteration permitted.");
    assert(!/RENAME/i.test(sql), "No rename permitted.");
    assert(!/\bstorage\./i.test(sql), "No storage schema reference permitted.");
  });

  Deno.test(`${step.id} performs no DML or backfill`, async () => {
    const sql = await migrationSql(step.marker);
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

  Deno.test(`${step.id} changes no grant, function, trigger, index, view, enum, constraint or table definition`, async () => {
    const sql = await migrationSql(step.marker);
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
      [/CREATE\s+BUCKET/i, "bucket creation"],
    ];
    for (const [re, label] of forbidden) {
      assert(!re.test(sql), `Migration must not include ${label}.`);
    }
  });
}

Deno.test("API-HR.33 sub-step migrations are three distinct files", async () => {
  const files = await Promise.all(SUB_STEPS.map((s) => findMigration(s.marker)));
  assertEquals(new Set(files).size, 3, "Each sub-step requires its own migration file.");
});
