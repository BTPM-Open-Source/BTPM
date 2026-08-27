/**
 * API-Q Cross-Family-C16 — Project/Phase Clone Anchor Internal Helpers
 * Direct-Invocation Privilege Closure
 *
 * Focused static/contract test over the forward-only migration that revokes
 * ordinary-client EXECUTE on the two internal clone-anchor helpers:
 *   public._clone_anchor_for_project(uuid)
 *   public._clone_anchor_for_phase(uuid)
 *
 * Privilege closure only: no function body may be redefined.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Cross-Family-C16 — Project/Phase Clone Anchor Internal Helpers Direct-Invocation Privilege Closure";

const ORIGIN_MIGRATION = new URL(
  "../../migrations/20260418074228_f69ab4e3-dac1-4fa1-8d7c-73c68dccdb0c.sql",
  import.meta.url,
);
const C6_MIGRATION = new URL(
  "../../migrations/20260819145753_b692791c-df3d-40b9-b472-d92df6dd4585.sql",
  import.meta.url,
);
const C11_MIGRATION = new URL(
  "../../migrations/20260819165412_7ff66cae-bf1e-4a8c-b863-b5b5bd1120ae.sql",
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
const origin = await Deno.readTextFile(ORIGIN_MIGRATION);
const c6 = await Deno.readTextFile(C6_MIGRATION);
const c11 = await Deno.readTextFile(C11_MIGRATION);
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

// --- _clone_anchor_for_project ---

Deno.test("5. PUBLIC EXECUTE revoked on _clone_anchor_for_project", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_project\s*\(\s*uuid\s*\)\s+FROM\s+PUBLIC\s*;/i
      .test(sql),
  );
});

Deno.test("6. anon EXECUTE revoked on _clone_anchor_for_project", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_project\s*\(\s*uuid\s*\)\s+FROM\s+anon\s*;/i
      .test(sql),
  );
});

Deno.test("7. authenticated EXECUTE revoked on _clone_anchor_for_project", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_project\s*\(\s*uuid\s*\)\s+FROM\s+authenticated\s*;/i
      .test(sql),
  );
});

// --- _clone_anchor_for_phase ---

Deno.test("8. PUBLIC EXECUTE revoked on _clone_anchor_for_phase", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_phase\s*\(\s*uuid\s*\)\s+FROM\s+PUBLIC\s*;/i
      .test(sql),
  );
});

Deno.test("9. anon EXECUTE revoked on _clone_anchor_for_phase", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_phase\s*\(\s*uuid\s*\)\s+FROM\s+anon\s*;/i
      .test(sql),
  );
});

Deno.test("10. authenticated EXECUTE revoked on _clone_anchor_for_phase", () => {
  assert(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\._clone_anchor_for_phase\s*\(\s*uuid\s*\)\s+FROM\s+authenticated\s*;/i
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

// --- Preserved protected call paths ---

Deno.test("14. preview_project_clone_blueprint still calls _clone_anchor_for_project", () => {
  assert(origin.includes("public._clone_anchor_for_project(_project_id)"));
});

Deno.test("15. preview_phase_clone_blueprint still calls _clone_anchor_for_phase", () => {
  assert(c6.includes("public._clone_anchor_for_phase(_phase_id)"));
});

Deno.test("16. neither helper body is redefined in C16", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*_clone_anchor_for_project/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*_clone_anchor_for_phase/i.test(sql));
});

Deno.test("17. signatures remain unchanged (no DROP FUNCTION)", () => {
  assert(!/DROP\s+FUNCTION/i.test(sql));
});

// --- C11 preservation (_clone_anchor_for_task untouched) ---

Deno.test("18. _clone_anchor_for_task is not revoked in C16", () => {
  assert(!/REVOKE[\s\S]*_clone_anchor_for_task\s*\(\s*uuid\s*\)/i.test(sql));
  assert(!/FUNCTION\s+public\._clone_anchor_for_task/i.test(sql));
});

Deno.test("19. C11 migration remains the task anchor closure", () => {
  assert(c11.includes("REVOKE EXECUTE ON FUNCTION public._clone_anchor_for_task(uuid) FROM PUBLIC;"));
  assert(c11.includes("REVOKE EXECUTE ON FUNCTION public._clone_anchor_for_task(uuid) FROM anon;"));
  assert(c11.includes("REVOKE EXECUTE ON FUNCTION public._clone_anchor_for_task(uuid) FROM authenticated;"));
});

// --- _clone_offset_days untouched ---

Deno.test("20. _clone_offset_days is untouched", () => {
  assert(!/REVOKE[\s\S]*_clone_offset_days/i.test(sql));
  assert(!/FUNCTION\s+public\._clone_offset_days/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*_clone_offset_days/i.test(sql));
});

// --- Frontend: no direct RPC caller ---

Deno.test("21. recursive src scan finds no direct RPC call to either helper", async () => {
  const SRC_DIR = new URL("../../../src/", import.meta.url);
  const needles = [
    'rpc("_clone_anchor_for_project"',
    "rpc('_clone_anchor_for_project'",
    "rpc(`_clone_anchor_for_project`",
    'rpc("_clone_anchor_for_phase"',
    "rpc('_clone_anchor_for_phase'",
    "rpc(`_clone_anchor_for_phase`",
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

// --- Scope: no drift ---

Deno.test("22. no API/MCP capability is added", () => {
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

Deno.test("23. no schema/RLS/encryption change occurs", () => {
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

Deno.test("24. no migration-time business-data DML occurs", () => {
  for (const forbidden of ["INSERT INTO", "DELETE FROM", "TRUNCATE", "MERGE INTO"]) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
  assert(!/\bUPDATE\s+public\./i.test(sql), "must not UPDATE business data");
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(U), "no DML");
});

Deno.test("25. no frontend file change occurs in the migration", () => {
  assert(!sql.includes("src/"));
  assert(!/_clone_anchor_for_(project|phase)\.(tsx|ts)\b/i.test(sql));
  assert(!/supabase\.rpc/i.test(sql));
});
