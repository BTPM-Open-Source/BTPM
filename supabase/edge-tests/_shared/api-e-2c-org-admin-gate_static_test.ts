// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-2c-org-admin-gate_static_test.ts', import.meta.url).href;
// API-E.2C — OAuth containment at the shared Organization-admin gate (static contract test).
//
// Proves the API-E.2C migration:
//   * replaces ONLY public.is_org_admin(uuid, uuid);
//   * preserves original signature, posture and admin authorization logic;
//   * gates signed-client (OAuth) sessions on api_e_private.assert_trusted_context()
//     before the original authorization query runs;
//   * introduces no table, policy, trigger, grant/revoke, Edge Function, PMG
//     function, OAuth config, secret/token storage, or new browser-callable function;
// and additionally proves that the Admin Import RPC
// public.commit_btpm_import_v1_core reaches this shared gate (via
// public.is_org_admin) BEFORE its first business-data mutation, so the
// documented Admin Import exception from API-E.2B is now contained here.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);

async function listMigrations(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return names;
}

async function findMigration(marker: string): Promise<string> {
  const matches: string[] = [];
  for (const name of await listMigrations()) {
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

async function finalEffectiveFunctionBody(fnName: string): Promise<string> {
  // Return the body of the newest CREATE OR REPLACE FUNCTION public.<fnName>(...)
  // occurrence across migrations in timestamp order.
  const names = await listMigrations();
  const pattern = new RegExp(
    String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.` + fnName +
      String.raw`\s*\([\s\S]*?\)[\s\S]*?AS\s+\$function\$([\s\S]*?)\$function\$`,
    "gi",
  );
  let last: string | null = null;
  for (const name of names) {
    const src = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    const matches = [...src.matchAll(pattern)];
    if (matches.length > 0) last = matches[matches.length - 1][1];
  }
  assert(last !== null, `No CREATE OR REPLACE FUNCTION public.${fnName} found`);
  return last;
}

Deno.test("API-E.2C migration exists and is uniquely identifiable", async () => {
  const name = await findMigration("API-E.2C");
  assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
});

Deno.test("API-E.2C migration replaces exactly one function: public.is_org_admin", async () => {
  const name = await findMigration("API-E.2C");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  const creates = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(creates.length, 1, "Exactly one function replacement is allowed.");
  assertStringIncludes(creates[0] ?? "", "public.is_org_admin");

  assert(!/CREATE\s+FUNCTION\s+/i.test(sql), "No new function definitions permitted.");
});

Deno.test("API-E.2C migration introduces no table/policy/trigger/grant/OAuth/secret changes", async () => {
  const name = await findMigration("API-E.2C");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  const forbidden: Array<[RegExp, string]> = [
    [/CREATE\s+TABLE/i, "table creation"],
    [/ALTER\s+TABLE/i, "table alteration"],
    [/DROP\s+TABLE/i, "table drop"],
    [/CREATE\s+POLICY/i, "policy creation"],
    [/DROP\s+POLICY/i, "policy drop"],
    [/ALTER\s+POLICY/i, "policy alteration"],
    [/CREATE\s+TRIGGER/i, "trigger creation"],
    [/DROP\s+TRIGGER/i, "trigger drop"],
    [/\bGRANT\b/i, "grant statement"],
    [/\bREVOKE\b/i, "revoke statement"],
    [/pmg[_.]/i, "PMG surface"],
    [/service_role/i, "service_role reference"],
    [
      /auth\.jwt|request\.header|current_setting\(\s*'request\./i,
      "raw request/header authority",
    ],
    [/oauth[_.]?config|token_store|secret_store/i, "OAuth/secret configuration"],
    [/active[_ ]?workspace/i, "active-workspace authority"],
    [/active[_ ]?organization/i, "active-organization authority"],
    [/profiles?\.organization_id/i, "profile organization authority"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(sql), `Migration must not include ${label}.`);
  }
});

Deno.test("API-E.2C final is_org_admin preserves signature, posture, and original admin logic", async () => {
  const name = await findMigration("API-E.2C");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  assert(
    /public\.is_org_admin\s*\(\s*_user_id\s+uuid\s*,\s*_organization_id\s+uuid\s*\)/i
      .test(sql),
    "Signature must remain is_org_admin(_user_id uuid, _organization_id uuid).",
  );
  assert(/RETURNS\s+boolean/i.test(sql), "Return type must remain boolean.");
  assert(/LANGUAGE\s+plpgsql/i.test(sql), "Language must remain plpgsql.");
  assert(/\bSTABLE\b/i.test(sql), "Function must remain STABLE.");
  assert(/SECURITY\s+DEFINER/i.test(sql), "Function must remain SECURITY DEFINER.");
  assert(
    /SET\s+search_path\s*(?:TO|=)\s*'?public'?/i.test(sql),
    "search_path must remain fixed to 'public'.",
  );

  // Original organization-membership authorization logic preserved.
  assert(
    /FROM\s+public\.organization_memberships[\s\S]{0,400}role\s*=\s*'org_admin'[\s\S]{0,200}tm\.status\s*=\s*'active'/i
      .test(sql),
    "Original active org_admin membership check must be preserved.",
  );
  // Legacy fallback preserved.
  assert(
    /FROM\s+public\.user_roles[\s\S]{0,200}role\s*=\s*'org_admin'[\s\S]{0,200}workspace_id\s+IS\s+NULL/i
      .test(sql),
    "Legacy user_roles fallback must be preserved.",
  );
});

Deno.test("API-E.2C signed-client classification uses api_e_private.jwt_client_id and requires assert_trusted_context before original logic", async () => {
  const name = await findMigration("API-E.2C");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  const jwtIdx = sql.search(/api_e_private\.jwt_client_id\s*\(/);
  const assertIdx = sql.search(/api_e_private\.assert_trusted_context\s*\(/);
  const originalIdx = sql.search(/organization_memberships/);

  assert(jwtIdx > -1, "Must call api_e_private.jwt_client_id().");
  assert(assertIdx > -1, "Must call api_e_private.assert_trusted_context().");
  assert(originalIdx > -1, "Original authorization query must remain in the body.");
  assert(
    jwtIdx < assertIdx && assertIdx < originalIdx,
    "Trusted-context assertion must occur before the original authorization query.",
  );

  // Signed-client path must return false when trusted context is absent.
  assert(
    /NOT\s+api_e_private\.assert_trusted_context\s*\(\s*\)[\s\S]{0,120}(RETURN\s+false|false)/i
      .test(sql),
    "Signed-client sessions must return false unless assert_trusted_context() is true.",
  );

  // Non-OAuth path preserved (jwt_client_id() IS NULL bypasses containment).
  assert(
    /jwt_client_id\s*\(\s*\)\s+IS\s+NOT\s+NULL/i.test(sql) ||
      /jwt_client_id\s*\(\s*\)\s+IS\s+NULL/i.test(sql),
    "Function must branch on jwt_client_id() nullability to preserve non-OAuth behavior.",
  );
});

Deno.test("API-E.2C introduces no new browser-callable public.* function", async () => {
  const name = await findMigration("API-E.2C");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  const publicFns = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.[a-zA-Z0-9_]+/gi) ?? [];
  assertEquals(publicFns.length, 1, "Only public.is_org_admin may be replaced.");
  assertStringIncludes((publicFns[0] ?? "").toLowerCase(), "public.is_org_admin");
});

Deno.test("Admin Import (commit_btpm_import_v1_core) reaches shared is_org_admin gate before any business-data mutation", async () => {
  const body = await finalEffectiveFunctionBody("commit_btpm_import_v1_core");

  const orgAdminIdx = body.search(/public\.is_org_admin\s*\(/);
  assert(
    orgAdminIdx > -1,
    "commit_btpm_import_v1_core must call public.is_org_admin(...).",
  );

  // Identify first business-data mutation. Batch bookkeeping (INSERT/UPDATE
  // against public.btpm_import_batches or FOR UPDATE row locks) is not a
  // business-data mutation — we look for the first write against ordinary
  // BTPM object tables.
  const mutationRe =
    /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?!btpm_import_batches\b)[a-z_]+/i;
  const firstMut = body.search(mutationRe);
  assert(
    firstMut > -1,
    "Expected at least one business-data mutation in commit_btpm_import_v1_core body.",
  );
  assert(
    orgAdminIdx < firstMut,
    "public.is_org_admin(...) must be called before the first business-data mutation.",
  );
});
