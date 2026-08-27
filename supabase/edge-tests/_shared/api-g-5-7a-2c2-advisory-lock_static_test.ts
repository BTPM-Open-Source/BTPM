// API-G.5.7A-2C2 — Focused static test for the corrected advisory-lock expression.
// Repository-only. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7A-2C2";

function listMigrations(): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      out.push(`${MIGRATIONS_DIR}/${entry.name}`);
    }
  }
  return out.sort();
}

function correctionMigrationPaths(): string[] {
  return listMigrations().filter((p) => Deno.readTextFileSync(p).includes(MARKER));
}

function correctionSql(): string {
  const paths = correctionMigrationPaths();
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7A-2C2 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("exactly one migration carries the API-G.5.7A-2C2 marker", () => {
  assertEquals(correctionMigrationPaths().length, 1);
});

Deno.test("correction redefines the exact existing RPC signature", () => {
  const sql = correctionSql();
  assert(
    /CREATE OR REPLACE FUNCTION\s+public\.api_g_5_7_admin_transition_organization_client\s*\(\s*_organization_id\s+uuid\s*,\s*_api_client_id\s+uuid\s*,\s*_target_lifecycle_status\s+text\s*\)\s*RETURNS uuid/i
      .test(sql),
    "exact signature and return type must be preserved",
  );
});

Deno.test("function attributes remain unchanged", () => {
  const sql = correctionSql();
  assert(/LANGUAGE plpgsql/i.test(sql));
  assert(/\bVOLATILE\b/i.test(sql));
  assert(/SECURITY DEFINER/i.test(sql));
  assert(/SET search_path = public, pg_catalog/i.test(sql));
});

Deno.test("exactly one advisory lock, single-bigint form with one hash", () => {
  const sql = correctionSql();
  const locks = sql.match(/pg_advisory_xact_lock\s*\(/g) ?? [];
  assertEquals(locks.length, 1, "exactly one pg_advisory_xact_lock call expected");
  assert(!/pg_advisory_lock\s*\(/i.test(sql), "no session-level advisory lock allowed");

  const lockIdx = sql.indexOf("pg_advisory_xact_lock");
  const lockBlock = sql.slice(lockIdx, sql.indexOf(");", lockIdx) + 2);
  const hashes = lockBlock.match(/hashtextextended\s*\(/g) ?? [];
  assertEquals(hashes.length, 1, "lock key must be one hashtextextended result");
});

Deno.test("hash input contains namespace and both identifiers", () => {
  const sql = correctionSql();
  const lockIdx = sql.indexOf("pg_advisory_xact_lock");
  const lockBlock = sql.slice(lockIdx, sql.indexOf(");", lockIdx) + 2);
  assert(lockBlock.includes("'api_g_5_7_organization_client_transition|'"));
  assert(lockBlock.includes("_organization_id::text"));
  assert(lockBlock.includes("_api_client_id::text"));
});

Deno.test("invalid (bigint, bigint) advisory-lock form is absent", () => {
  const sql = correctionSql();
  assert(
    !/pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\([^;]*?\)\s*,\s*hashtextextended\s*\(/is
      .test(sql),
    "two-hash advisory lock form must not be present",
  );
});

Deno.test("advisory lock precedes the enablement SELECT ... FOR UPDATE", () => {
  const sql = correctionSql();
  const lockIdx = sql.indexOf("pg_advisory_xact_lock");
  const forUpdateIdx = sql.indexOf("FOR UPDATE");
  assert(lockIdx > 0 && forUpdateIdx > 0);
  assert(lockIdx < forUpdateIdx, "lock must be acquired before row evaluation");

  const authorityIdx = sql.indexOf("public.is_tenant_admin(");
  assert(authorityIdx > 0 && authorityIdx < lockIdx, "lock must follow authority validation");
});

Deno.test("authority calls and argument order remain unchanged", () => {
  const sql = correctionSql();
  assert(sql.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(sql.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(sql.includes("auth.uid()"));
  assert(sql.includes("public.is_active_user(v_actor)"));
});

Deno.test("correction is limited to the function definition and its grants", () => {
  const sql = correctionSql();
  for (
    const forbidden of [
      /CREATE\s+TABLE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /\bCOMMIT\b/i,
      /\bROLLBACK\b/i,
      /api_workspace_client_enablements/i,
      /api_project_client_enablements/i,
      /capability_grant/i,
    ]
  ) {
    assert(!forbidden.test(sql), `forbidden statement present: ${forbidden}`);
  }
  assert(
    !/GRANT\s+(?!EXECUTE)/i.test(sql),
    "only EXECUTE grants may appear in the correction",
  );
});
