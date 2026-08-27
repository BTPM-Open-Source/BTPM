// API-Q Cross-Family-C5 — Project Clone Blueprint Preview Internal Delegate Direct-Invocation Closure
// (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the privilege-closure statements that close direct client invocation of
// public.preview_project_clone_blueprint(uuid).
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Cross-Family-C5 — Project Clone Blueprint Preview Internal Delegate Direct-Invocation Closure";

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

const found: { name: string; text: string }[] = [];
for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
  if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
  const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
  if (text.includes(MARKER)) found.push({ name: entry.name, text });
}

const raw = found[0]?.text ?? "";
const sql = stripSqlComments(raw).trim();

const C4_MIGRATION = "supabase/migrations/20260819133106_cf4a55fc-42a8-48f4-8cd4-165ff093378a.sql";
const DIALOG = "src/components/templates/SaveAsTemplateDialog.tsx";

async function read(path: string): Promise<string> {
  const url = new URL(`../../../${path}`, import.meta.url);
  return await Deno.readTextFile(url);
}

Deno.test("C5: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("1. preview_project_clone_blueprint is not redefined", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*preview_project_clone_blueprint/i.test(sql));
});

Deno.test("2. no CREATE OR REPLACE FUNCTION appears in the migration", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql));
  assert(!/CREATE\s+FUNCTION/i.test(sql));
});

Deno.test("3. EXECUTE is revoked from PUBLIC", () => {
  assert(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_project_clone_blueprint\s*\(\s*uuid\s*\)\s+FROM\s+PUBLIC\s*;/i
    .test(sql));
});

Deno.test("4. EXECUTE is revoked from anon", () => {
  assert(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_project_clone_blueprint\s*\(\s*uuid\s*\)\s+FROM\s+anon\s*;/i
    .test(sql));
});

Deno.test("5. EXECUTE is revoked from authenticated", () => {
  assert(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_project_clone_blueprint\s*\(\s*uuid\s*\)\s+FROM\s+authenticated\s*;/i
    .test(sql));
});

Deno.test("6. no EXECUTE grant to PUBLIC/anon/authenticated is added", () => {
  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_project_clone_blueprint/i.test(sql));
  assert(!/\bGRANT\b/i.test(sql), "no GRANT may appear in this migration");
});

Deno.test("7. service_role is not revoked", () => {
  assert(!/REVOKE[^(]*service_role/i.test(sql));
});

Deno.test("8. ownership is untouched", () => {
  assert(!/ALTER\s+FUNCTION/i.test(sql));
  assert(!/OWNER\s+TO/i.test(sql));
  assert(!/REASSIGN/i.test(sql));
});

Deno.test("9. no privilege widening occurs", () => {
  assert(!/\bGRANT\b/i.test(sql));
  const revokes = sql.match(/\bREVOKE\b[^;]*;/gi) ?? [];
  // exactly three revokes, all targeting the preview function
  assertEquals(revokes.length, 3, "exactly three REVOKE statements are allowed");
  for (const r of revokes) {
    assert(/public\.preview_project_clone_blueprint\s*\(\s*uuid\s*\)/i.test(r),
      "every REVOKE must target preview_project_clone_blueprint(uuid)");
  }
});

Deno.test("10. save_project_template_from_project is not redefined", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*save_project_template_from_project/i.test(sql));
});

Deno.test("11. C4 migration remains the current outer hardened boundary", async () => {
  const c4 = await read(C4_MIGRATION);
  assert(c4.includes("save_project_template_from_project"));
  assert(c4.includes("api_e_private.jwt_client_id()"));
  assert(c4.includes("public.is_user_org_member(_caller, _org)"));
  assert(c4.includes("public.has_project_pm_authority(_caller, _project_id)"));
  assert(c4.includes("public.can_write_demo(_caller, _ws)"));
  assert(c4.includes("GRANT EXECUTE ON FUNCTION public.save_project_template_from_project(uuid, text, text) TO authenticated;"));
});

Deno.test("12. SaveAsTemplateDialog does not call preview_project_clone_blueprint directly", async () => {
  const dialog = await read(DIALOG);
  assert(!dialog.includes('preview_project_clone_blueprint'));
  assert(dialog.includes('supabase.rpc("save_project_template_from_project"'));
});

Deno.test("13. repository search finds no active frontend .rpc(\"preview_project_clone_blueprint\")", async () => {
  // Scan the src tree (excluding the auto-generated types file) for a direct RPC call.
  const SRC_DIR = new URL("../../../src/", import.meta.url);
  let hit: string | null = null;
  for await (const absPath of readDirRecursive(SRC_DIR)) {
    if (!absPath.endsWith(".ts") && !absPath.endsWith(".tsx")) continue;
    if (absPath.includes("integrations/supabase/types.ts")) continue;
    const text = await Deno.readTextFile(absPath);
    if (/\.rpc\(\s*["']preview_project_clone_blueprint["']/.test(text)) {
      hit = absPath;
      break;
    }
  }
  assertEquals(hit, null, `unexpected direct frontend RPC caller: ${hit}`);
});

Deno.test("14. save_project_template_from_project still internally calls preview_project_clone_blueprint", async () => {
  const c4 = await read(C4_MIGRATION);
  assert(c4.includes("_blueprint := public.preview_project_clone_blueprint(_project_id);"));
});

Deno.test("15. instantiate_project_from_template is untouched", () => {
  assert(!/instantiate_project_from_template/i.test(sql));
});

Deno.test("16. Phase clone functions are untouched", () => {
  for (const banned of [
    "preview_phase_clone_blueprint",
    "clone_phase",
    "_clone_anchor_for_phase",
    "apply_phase_",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("17. no external REST/MCP wrapper or capability is added", () => {
  for (const banned of [
    "api_v1_preview_project_clone_blueprint",
    "mcp_v1_preview_project_clone_blueprint",
    "api_capability",
    "connected_app",
    "btpm-api-v1",
    "btpm-mcp",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), "no function definition");
  assert(!/DROP\s+FUNCTION/i.test(sql), "no function drop");
});

Deno.test("18. no RLS/schema/encryption change", () => {
  for (const banned of [
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE INDEX",
    "CREATE POLICY",
    "DROP POLICY",
    "CREATE TRIGGER",
    "btpm_encrypt",
    "btpm_decrypt",
    "pgp_sym_encrypt",
    "pgp_sym_decrypt",
    "ROW LEVEL SECURITY",
    "tenant_encryption",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("19. no migration-time business-data DML", () => {
  for (const banned of ["INSERT INTO", "DELETE FROM", "TRUNCATE", "MERGE INTO"]) {
    assert(!sql.includes(banned), `must not contain ${banned}`);
  }
  assert(!/\bUPDATE\s+public\./i.test(sql), "must not UPDATE business data");
});

Deno.test("20. no frontend file changes occur", () => {
  // This migration touches only the one SQL file; assert no source references are present.
  assert(!sql.includes("src/"));
  assert(!sql.includes("SaveAsTemplateDialog"));
  assert(!/\.tsx?/i.test(sql));
});

// --- helpers ---

async function* readDirRecursive(base: URL): AsyncGenerator<string, void, unknown> {
  const stack: URL[] = [base];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const e of Deno.readDir(dir)) entries.push(e);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) {
        stack.push(full);
      } else if (e.isFile) {
        yield full.pathname;
      }
    }
  }
}
