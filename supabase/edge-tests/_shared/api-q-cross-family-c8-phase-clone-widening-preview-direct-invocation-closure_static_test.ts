/**
 * API-Q Cross-Family-C8 — Phase Clone Widening Preview
 * Internal Delegate Direct-Invocation Closure
 *
 * Focused static/contract test over the forward-only migration that revokes
 * ordinary-client EXECUTE on public.preview_phase_clone_in_project(uuid, date).
 *
 * Privilege closure only: no function body may be redefined.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819154729_ba5a3b1e-444c-4df7-8dae-da6d889f0e7c.sql",
  import.meta.url,
);
const C7_MIGRATION = new URL(
  "../../migrations/20260819154102_2c94b95d-744a-4d91-8702-1bf50dc5200b.sql",
  import.meta.url,
);
const DIALOG = new URL(
  "../../../src/components/planning/ClonePhaseDialog.tsx",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION);
const c7 = await Deno.readTextFile(C7_MIGRATION);
const dialog = await Deno.readTextFile(DIALOG);
const has = (n: string) => sql.includes(n);
const U = sql.toUpperCase();

Deno.test("1. preview_phase_clone_in_project is not redefined", () => {
  assert(
    !/(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.preview_phase_clone_in_project/i
      .test(sql),
  );
});

Deno.test("2. migration contains no CREATE OR REPLACE FUNCTION", () => {
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql));
  assert(!/\bDO\s+\$\$/i.test(sql));
});

Deno.test("3. EXECUTE is revoked from PUBLIC", () => {
  assert(
    has(
      "REVOKE EXECUTE ON FUNCTION public.preview_phase_clone_in_project(uuid, date) FROM PUBLIC;",
    ),
  );
});

Deno.test("4. EXECUTE is revoked from anon", () => {
  assert(
    has(
      "REVOKE EXECUTE ON FUNCTION public.preview_phase_clone_in_project(uuid, date) FROM anon;",
    ),
  );
});

Deno.test("5. EXECUTE is revoked from authenticated", () => {
  assert(
    has(
      "REVOKE EXECUTE ON FUNCTION public.preview_phase_clone_in_project(uuid, date) FROM authenticated;",
    ),
  );
});

Deno.test("6. no GRANT is added", () => {
  assert(!/\bGRANT\b/i.test(sql));
});

Deno.test("7. service_role is not revoked", () => {
  assert(!/service_role/i.test(sql));
});

Deno.test("8. ownership is untouched", () => {
  assert(!/OWNER\s+TO/i.test(sql));
  assert(!/ALTER\s+FUNCTION/i.test(sql));
  assert(!/REASSIGN/i.test(sql));
});

Deno.test("9. no privilege widening occurs (revokes only, on one target)", () => {
  const stmts = sql.split(";").map((s) => s.trim()).filter((s) =>
    s.length > 0 && !s.startsWith("--")
  );
  assert(stmts.length === 3, `expected 3 statements, got ${stmts.length}`);
  for (const s of stmts) {
    assert(/^REVOKE EXECUTE ON FUNCTION public\.preview_phase_clone_in_project\(uuid, date\) FROM /i
      .test(s), s);
  }
});

Deno.test("10. clone_phase_in_project is not redefined and not touched", () => {
  assert(!has("clone_phase_in_project(uuid, text"));
  assert(!/FUNCTION\s+public\.clone_phase_in_project/i.test(sql));
});

Deno.test("11. C7 migration remains the hardened outer mutation boundary", () => {
  assert(/CREATE OR REPLACE FUNCTION\s+public\.clone_phase_in_project/.test(c7));
  assert(c7.includes("api_e_private.jwt_client_id()"));
  assert(c7.includes("public.is_active_user(_caller)"));
  assert(c7.includes("public.is_user_org_member(_caller, _src_phase.organization_id)"));
  assert(c7.includes("public.has_pm_authority(_caller, _src_phase.workspace_id)"));
  assert(c7.includes("public.can_write_demo(_caller, _src_phase.workspace_id)"));
});

Deno.test("12. clone_phase_in_project still internally calls the preview helper", () => {
  assert(c7.includes("public.preview_phase_clone_in_project(_phase_id, _phase_start_date);"));
});

Deno.test("13. authenticated EXECUTE on clone_phase_in_project is not revoked", () => {
  assert(!/REVOKE[\s\S]*clone_phase_in_project\(uuid,\s*text/i.test(sql));
});

Deno.test("14. preview_phase_clone_blueprint is not redefined", () => {
  assert(!/FUNCTION\s+public\.preview_phase_clone_blueprint/i.test(sql));
  assert(!/CREATE OR REPLACE FUNCTION\s+public\.preview_phase_clone_blueprint/.test(c7));
});

Deno.test("15. ClonePhaseDialog does not call preview_phase_clone_in_project", () => {
  assert(!dialog.includes("preview_phase_clone_in_project"));
});

Deno.test("16. ClonePhaseDialog still calls preview_phase_clone_blueprint", () => {
  assert(dialog.includes('supabase.rpc("preview_phase_clone_blueprint"'));
});

Deno.test("17. ClonePhaseDialog still calls clone_phase_in_project", () => {
  assert(dialog.includes('supabase.rpc("clone_phase_in_project"'));
});

Deno.test("18. src scan finds no direct .rpc(\"preview_phase_clone_in_project\")", async () => {
  const root = new URL("../../../src/", import.meta.url);
  const needles = [
    'rpc("preview_phase_clone_in_project"',
    "rpc('preview_phase_clone_in_project'",
    "rpc(`preview_phase_clone_in_project`",
  ];
  const walk = async (dir: URL) => {
    for await (const e of Deno.readDir(dir)) {
      const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) {
        await walk(child);
      } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const txt = await Deno.readTextFile(child);
        for (const n of needles) {
          assert(!txt.includes(n), `${child.pathname} contains ${n}`);
        }
      }
    }
  };
  await walk(root);
});

Deno.test("19. no external API/MCP wrapper or capability is added", () => {
  for (
    const forbidden of [
      "api_v1_preview_phase_clone_in_project",
      "mcp_v1_preview_phase_clone_in_project",
      "api_capability_catalogue",
      "api_capability_grants",
      "source_channel",
      "capability_key",
      "api_version",
    ]
  ) {
    assert(!has(forbidden), forbidden);
  }
});

Deno.test("20. no schema/RLS/encryption change occurs", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER POLICY",
      "ROW LEVEL SECURITY",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "CREATE INDEX",
      "CREATE TRIGGER",
      "CREATE TYPE",
      "BTPM_ENCRYPT",
      "BTPM_DECRYPT",
    ]
  ) {
    assert(!U.includes(forbidden), forbidden);
  }
});

Deno.test("21. no migration-time business-data DML occurs", () => {
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(sql));
});

Deno.test("22. no frontend behavior is encoded in the migration", () => {
  assert(!/\.tsx?\b/i.test(sql));
  assert(!/supabase\.rpc/i.test(sql));
});
