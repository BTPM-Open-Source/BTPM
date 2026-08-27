// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-hr-23-ai-help-messages-oauth-containment_static_test.ts', import.meta.url).href;
// API-HR.23 — public.ai_help_messages OAuth direct-read containment (static contract test).
//
// Structural inspection of the committed API-HR.23 migration only. No live calls.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);

async function findMigration(marker: string): Promise<string> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const matches: string[] = [];
  for (const name of names) {
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

async function migrationSql(): Promise<string> {
  const name = await findMigration("API-HR.23");
  return await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
}

Deno.test("API-HR.23 migration exists, is unique and carries the marker", async () => {
  const name = await findMigration("API-HR.23");
  assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
  assertStringIncludes(sql, "API-HR.23");
});

Deno.test("API-HR.23 creates exactly one policy: api_e_oauth_read_containment on public.ai_help_messages", async () => {
  const sql = await migrationSql();

  const creates = sql.match(/CREATE\s+POLICY\s+([a-zA-Z0-9_"]+)/gi) ?? [];
  assertEquals(creates.length, 1, "Exactly one CREATE POLICY is allowed.");
  assertStringIncludes(creates[0] ?? "", "api_e_oauth_read_containment");

  assert(
    /CREATE\s+POLICY\s+api_e_oauth_read_containment\s+ON\s+public\.ai_help_messages\b/i.test(sql),
    "Policy must target public.ai_help_messages.",
  );
});

Deno.test("API-HR.23 policy is restrictive SELECT for authenticated", async () => {
  const sql = await migrationSql();
  assert(/AS\s+RESTRICTIVE/i.test(sql), "Policy must be AS RESTRICTIVE.");
  assert(/FOR\s+SELECT/i.test(sql), "Policy must be FOR SELECT.");
  assert(/TO\s+authenticated/i.test(sql), "Policy must be granted TO authenticated.");
  assert(!/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(sql), "No other policy command allowed.");
  assert(!/\bTO\s+(anon|public|service_role)\b/i.test(sql), "Only authenticated may be targeted.");
});

Deno.test("API-HR.23 USING expression is exactly the accepted containment", async () => {
  const sql = await migrationSql();
  const match = sql.match(/USING\s*\(([\s\S]*?)\)\s*;/i);
  assert(match, "Policy must declare a USING expression.");
  const expr = match![1].replace(/\s+/g, " ").trim();
  assertEquals(
    expr,
    "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()",
  );
  assert(!/WITH\s+CHECK/i.test(sql), "No WITH CHECK clause allowed.");
});

Deno.test("API-HR.23 targets no second business table", async () => {
  const sql = await migrationSql();
  const refs = new Set(
    [...sql.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
  );
  assertEquals(
    [...refs],
    ["ai_help_messages"],
    "Only public.ai_help_messages may be referenced.",
  );
});

Deno.test("API-HR.23 leaves the existing owner-only read policy untouched", async () => {
  const sql = await migrationSql();
  assert(
    !sql.includes("ai_help_msg_select_own"),
    "Migration must not reference the existing ordinary-browser policy.",
  );
  assert(!/DROP\s+POLICY/i.test(sql), "No policy drop permitted.");
  assert(!/ALTER\s+POLICY/i.test(sql), "No policy alteration permitted.");
  assert(!/RENAME/i.test(sql), "No rename permitted.");
});

Deno.test("API-HR.23 leaves owner-authority logic untouched", async () => {
  const sql = await migrationSql();
  for (const name of ["user_id = auth.uid()", "is_active_user", "get_user_org_id"]) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
});

Deno.test("API-HR.23 leaves encryption helpers, triggers and AI Help RPCs untouched", async () => {
  const sql = await migrationSql();
  for (const name of [
    "trg_encrypt_ai_help_message_fields",
    "trg_encrypt_ai_help_messages",
    "ensure_org_encryption_key",
    "btpm_encrypt",
    "btpm_decrypt",
    "ai_help_append_message",
    "ai_help_list_messages",
    "ai_help_create_conversation",
    "ai_help_list_conversations",
    "ai_help_archive_conversation",
    "ai_help_update_conversation_title",
    "ai_help_conversations",
    "ai_help_message_feedback",
  ]) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
});

Deno.test("API-HR.23 performs no DML or backfill", async () => {
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

Deno.test("API-HR.23 changes no grant, function, trigger, index, view, enum, constraint or table definition", async () => {
  const sql = await migrationSql();
  const forbidden: Array<[RegExp, string]> = [
    [/\bGRANT\b/i, "grant"],
    [/\bREVOKE\b/i, "revoke"],
    [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i, "function definition"],
    [/DROP\s+FUNCTION/i, "function drop"],
    [/ALTER\s+FUNCTION/i, "function alteration"],
    [/CREATE\s+TRIGGER/i, "trigger creation"],
    [/DROP\s+TRIGGER/i, "trigger drop"],
    [/CREATE\s+(UNIQUE\s+)?INDEX/i, "index creation"],
    [/DROP\s+INDEX/i, "index drop"],
    [/CREATE\s+TABLE/i, "table creation"],
    [/ALTER\s+TABLE/i, "table alteration"],
    [/DROP\s+TABLE/i, "table drop"],
    [/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i, "view definition"],
    [/CREATE\s+TYPE/i, "type creation"],
    [/ALTER\s+TYPE/i, "type alteration"],
    [/ADD\s+CONSTRAINT/i, "constraint addition"],
    [/DROP\s+CONSTRAINT/i, "constraint drop"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(sql), `Migration must not include ${label}.`);
  }
});
