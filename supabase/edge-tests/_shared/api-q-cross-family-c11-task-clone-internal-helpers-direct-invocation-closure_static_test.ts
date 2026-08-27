/**
 * API-Q Cross-Family-C11 — Task Clone Internal Helpers
 * Direct-Invocation Privilege Closure
 *
 * Focused static/contract test over the forward-only migration that revokes
 * ordinary-client EXECUTE on the two internal Task-clone implementation helpers:
 *   public.preview_task_clone_in_phase(uuid, date)
 *   public._clone_anchor_for_task(uuid)
 *
 * Privilege closure only: no function body may be redefined.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Cross-Family-C11 — Task Clone Internal Helpers Direct-Invocation Privilege Closure";

const C9_MIGRATION = new URL(
  "../../migrations/20260819155840_9f2353e6-3701-440d-ae9f-32019042d4e3.sql",
  import.meta.url,
);
const C10_MIGRATION = new URL(
  "../../migrations/20260819160435_26b9e6d3-8676-44e7-87f4-51bef1eedb5d.sql",
  import.meta.url,
);
const DIALOG = new URL(
  "../../../src/components/planning/CloneTaskDialog.tsx",
  import.meta.url,
);

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

assertEquals(found.length, 1, "exactly one migration must carry the marker");
const raw = found[0]?.text ?? "";
const sql = stripSqlComments(raw).trim();
const c9 = await Deno.readTextFile(C9_MIGRATION);
const c10 = await Deno.readTextFile(C10_MIGRATION);
const dialog = await Deno.readTextFile(DIALOG);
const has = (s: string) => sql.includes(s);
const U = sql.toUpperCase();

Deno.test("1. migration contains exactly six REVOKE EXECUTE statements", () => {
  const revokes = U.match(/\bREVOKE\b[^;]*;/g) ?? [];
  assertEquals(revokes.length, 6, `expected 6 REVOKE statements, got ${revokes.length}`);
  for (const r of revokes) {
    assert(/REVOKE EXECUTE ON FUNCTION/i.test(r), `not a REVOKE EXECUTE: ${r}`);
  }
});

Deno.test("2. no function is created/redefined", () => {
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql));
  assert(!/CREATE\s+FUNCTION/i.test(sql));
});

Deno.test("3. no ALTER FUNCTION exists", () => {
  assert(!/ALTER\s+FUNCTION/i.test(sql));
  assert(!/OWNER\s+TO/i.test(sql));
  assert(!/REASSIGN/i.test(sql));
});

Deno.test("4. no GRANT exists", () => {
  assert(!/\bGRANT\b/i.test(sql));
});

// --- preview_task_clone_in_phase ---

Deno.test("5. PUBLIC EXECUTE revoked on preview_task_clone_in_phase", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_task_clone_in_phase\s*\(\s*uuid\s*,\s*date\s*\)\s+FROM\s+PUBLIC\s*;/i
      .test(sql),
  );
});

Deno.test("6. anon EXECUTE revoked on preview_task_clone_in_phase", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_task_clone_in_phase\s*\(\s*uuid\s*,\s*date\s*\)\s+FROM\s+anon\s*;/i
      .test(sql),
  );
});

Deno.test("7. authenticated EXECUTE revoked on preview_task_clone_in_phase", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.preview_task_clone_in_phase\s*\(\s*uuid\s*,\s*date\s*\)\s+FROM\s+authenticated\s*;/i
      .test(sql),
  );
});

// --- _clone_anchor_for_task ---

Deno.test("8. PUBLIC EXECUTE revoked on _clone_anchor_for_task", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_task\s*\(\s*uuid\s*\)\s+FROM\s+PUBLIC\s*;/i
      .test(sql),
  );
});

Deno.test("9. anon EXECUTE revoked on _clone_anchor_for_task", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_task\s*\(\s*uuid\s*\)\s+FROM\s+anon\s*;/i
      .test(sql),
  );
});

Deno.test("10. authenticated EXECUTE revoked on _clone_anchor_for_task", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_task\s*\(\s*uuid\s*\)\s+FROM\s+authenticated\s*;/i
      .test(sql),
  );
});

Deno.test("11. service_role is not explicitly revoked", () => {
  assert(!/REVOKE[^(]*service_role/i.test(sql));
});

Deno.test("12. ownership is untouched", () => {
  assert(!/ALTER\s+FUNCTION/i.test(sql));
  assert(!/OWNER\s+TO/i.test(sql));
  assert(!/REASSIGN/i.test(sql));
});

Deno.test("13. no privilege widening occurs", () => {
  assert(!/\bGRANT\b/i.test(sql));
  const stmts = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  assertEquals(stmts.length, 6, `expected 6 statements, got ${stmts.length}`);
  for (const s of stmts) {
    assert(/^REVOKE EXECUTE ON FUNCTION/i.test(s), `unexpected statement: ${s}`);
  }
});

// --- C9 preservation ---

Deno.test("14. preview_task_clone_blueprint is not redefined", () => {
  assert(
    !/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*preview_task_clone_blueprint/i.test(sql),
  );
});

Deno.test("15. C9 still internally calls _clone_anchor_for_task", () => {
  assert(c9.includes("public._clone_anchor_for_task(_task_id)"));
});

Deno.test("16. authenticated EXECUTE on preview_task_clone_blueprint is not revoked", () => {
  assert(!/REVOKE[\s\S]*preview_task_clone_blueprint\s*\(\s*uuid\s*\)/i.test(sql));
});

// --- C10 preservation ---

Deno.test("17. clone_task_in_phase is not redefined", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*clone_task_in_phase/i.test(sql));
  assert(!/FUNCTION\s+public\.clone_task_in_phase/i.test(sql));
});

Deno.test("18. C10 still internally calls preview_task_clone_in_phase", () => {
  assert(c10.includes("public.preview_task_clone_in_phase(_task_id, _task_start_date)"));
});

Deno.test("19. C10 still calls preview_task_clone_blueprint", () => {
  assert(c10.includes("public.preview_task_clone_blueprint(_task_id)"));
});

Deno.test("20. authenticated EXECUTE on clone_task_in_phase is not revoked", () => {
  assert(
    !/REVOKE[\s\S]*clone_task_in_phase\s*\(\s*uuid\s*,\s*text\s*,\s*date\s*,\s*boolean\s*\)/i
      .test(sql),
  );
});

// --- Frontend ---

Deno.test("21. CloneTaskDialog calls preview_task_clone_blueprint", () => {
  assert(dialog.includes('supabase.rpc("preview_task_clone_blueprint"'));
});

Deno.test("22. CloneTaskDialog calls clone_task_in_phase", () => {
  assert(dialog.includes('supabase.rpc("clone_task_in_phase"'));
});

Deno.test("23. CloneTaskDialog does not call preview_task_clone_in_phase", () => {
  assert(!dialog.includes("preview_task_clone_in_phase"));
});

Deno.test("24. CloneTaskDialog does not call _clone_anchor_for_task", () => {
  assert(!dialog.includes("_clone_anchor_for_task"));
});

Deno.test("25. recursive src scan finds no direct RPC call to either helper", async () => {
  const SRC_DIR = new URL("../../../src/", import.meta.url);
  const needles = [
    "rpc(\"preview_task_clone_in_phase\"",
    "rpc('preview_task_clone_in_phase'",
    "rpc(`preview_task_clone_in_phase`",
    "rpc(\"_clone_anchor_for_task\"",
    "rpc('_clone_anchor_for_task'",
    "rpc(`_clone_anchor_for_task`",
  ];
  const walk = async (dir: URL) => {
    for await (const e of Deno.readDir(dir)) {
      const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) {
        await walk(child);
      } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        // Skip the auto-generated types file — it lists every RPC signature.
        if (child.pathname.includes("integrations/supabase/types.ts")) continue;
        const txt = await Deno.readTextFile(child);
        for (const n of needles) {
          assert(!txt.includes(n), `${child.pathname} contains ${n}`);
        }
      }
    }
  };
  await walk(SRC_DIR);
});

// --- Scope ---

Deno.test("26. no API/MCP capability is added", () => {
  for (const forbidden of [
    "api_v1_",
    "mcp_v1_",
    "api_capability",
    "connected_app",
    "btpm-api-v1",
    "btpm-mcp",
    "source_channel",
    "capability_key",
    "api_version",
  ]) {
    assert(!has(forbidden), `unexpected ${forbidden}`);
  }
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), "no function definition");
  assert(!/DROP\s+FUNCTION/i.test(sql), "no function drop");
});

Deno.test("27. no schema/RLS/encryption change occurs", () => {
  for (const forbidden of [
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE INDEX",
    "CREATE POLICY",
    "DROP POLICY",
    "CREATE TRIGGER",
    "ROW LEVEL SECURITY",
    "btpm_encrypt",
    "btpm_decrypt",
    "pgp_sym_encrypt",
    "pgp_sym_decrypt",
    "tenant_encryption",
    "CREATE TYPE",
  ]) {
    assert(!U.includes(forbidden.toUpperCase()), `unexpected ${forbidden}`);
  }
});

Deno.test("28. no migration-time business-data DML occurs", () => {
  for (const forbidden of ["INSERT INTO", "DELETE FROM", "TRUNCATE", "MERGE INTO"]) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
  assert(!/\bUPDATE\s+public\./i.test(sql), "must not UPDATE business data");
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(U), "no DML");
});

Deno.test("29. no frontend file change occurs in the migration", () => {
  assert(!sql.includes("src/"));
  assert(!sql.includes("CloneTaskDialog"));
  assert(!/\.tsx?\b/i.test(sql));
  assert(!/supabase\.rpc/i.test(sql));
});
