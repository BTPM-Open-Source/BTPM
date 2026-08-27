// API-Q Cross-Family-C6 — Phase Clone Blueprint Preview Browser Boundary and
// Canonical Read-Authority Hardening (durable focused static test).
//
// Repository/static test only: locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the redefined public.preview_phase_clone_blueprint(uuid).
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Cross-Family-C6 — Phase Clone Blueprint Preview Browser Boundary and Canonical Read-Authority Hardening";

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
const idx = (re: RegExp) => sql.search(re);

const DIALOG = "src/components/planning/ClonePhaseDialog.tsx";

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../../../${path}`, import.meta.url));
}

Deno.test("C6: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("1. exactly preview_phase_clone_blueprint(uuid) is redefined", () => {
  assertEquals((sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi) ?? []).length, 1);
  assert(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.preview_phase_clone_blueprint\s*\(\s*_phase_id\s+uuid\s*\)/i.test(sql));
  assert(!/DROP\s+FUNCTION/i.test(sql));
});

Deno.test("2. signature remains unchanged", () => {
  assert(/preview_phase_clone_blueprint\s*\(\s*_phase_id\s+uuid\s*\)/i.test(sql));
  assert(!/_phase_id\s+uuid\s*,/i.test(sql), "no additional parameters");
});

Deno.test("3. RETURNS jsonb remains unchanged", () => {
  assert(/RETURNS\s+jsonb/i.test(sql));
});

Deno.test("4. STABLE remains unchanged", () => {
  assert(/\bSTABLE\b/i.test(sql));
  assert(!/\bVOLATILE\b/i.test(sql));
});

Deno.test("5. SECURITY DEFINER remains unchanged", () => {
  assert(/SECURITY\s+DEFINER/i.test(sql));
  assert(!/SECURITY\s+INVOKER/i.test(sql));
});

Deno.test("6. search_path remains unchanged", () => {
  assert(/SET\s+search_path\s+TO\s+'public'/i.test(sql));
});

Deno.test("7. jwt_client_id() is evaluated before auth", () => {
  const c = idx(/api_e_private\.jwt_client_id\(\)/i);
  assert(c > 0);
  assert(c < idx(/auth\.uid\(\)/i));
});

Deno.test("8. jwt_client_id() is evaluated before Phase lookup", () => {
  assert(idx(/api_e_private\.jwt_client_id\(\)/i) < idx(/FROM\s+public\.phases\s+WHERE\s+id\s*=\s*_phase_id/i));
});

Deno.test("9. jwt_client_id() is evaluated before first btpm_decrypt", () => {
  assert(idx(/api_e_private\.jwt_client_id\(\)/i) < idx(/btpm_decrypt/i));
});

Deno.test("10. client-id resolution failure sets unresolved_client", () => {
  assert(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s*\n?\s*v_client_id\s*:=\s*'unresolved_client';/i.test(sql));
});

Deno.test("11. non-null client id raises exactly Not authorized / 42501", () => {
  assert(/IF\s+v_client_id\s+IS\s+NOT\s+NULL\s+THEN\s*\n?\s*RAISE\s+EXCEPTION\s+'Not authorized'\s+USING\s+ERRCODE\s*=\s*'42501';/i.test(sql));
});

Deno.test("12. no trusted-context/capability/source-channel exception exists", () => {
  for (const banned of [
    "assert_trusted_context",
    "capability_kind",
    "capability_key",
    "source_channel",
    "api_version",
    "connected_app",
    "api_capability",
  ]) {
    assert(!sql.toLowerCase().includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("13. auth.uid() caller identity remains authoritative", () => {
  assert(/_caller\s*:=\s*auth\.uid\(\);/i.test(sql));
  assert(/IF\s+_caller\s+IS\s+NULL\s+THEN\s*\n?\s*RAISE\s+EXCEPTION\s+'authentication required';/i.test(sql));
});

Deno.test("14. active-user check is required", () => {
  assert(/IF\s+NOT\s+public\.is_active_user\(_caller\)\s+THEN\s*\n?\s*RAISE\s+EXCEPTION\s+'Account is deactivated'\s+USING\s+ERRCODE\s*=\s*'42501';/i.test(sql));
  assert(idx(/_caller\s*:=\s*auth\.uid\(\)/i) < idx(/is_active_user\(_caller\)/i));
  assert(idx(/is_active_user\(_caller\)/i) < idx(/FROM\s+public\.phases\s+WHERE\s+id\s*=\s*_phase_id/i));
});

Deno.test("15. Phase Organization/Workspace/Project derive from the Phase row", () => {
  assert(/_org\s*:=\s*_phase\.organization_id;/i.test(sql));
  assert(/_ws\s*:=\s*_phase\.workspace_id;/i.test(sql));
  assert(/_proj\s*:=\s*_phase\.project_id;/i.test(sql));
  assert(/RAISE\s+EXCEPTION\s+'phase not found';/i.test(sql));
});

Deno.test("16. canonical is_user_org_member(_caller, _org) is required", () => {
  assert(/IF\s+public\.is_user_org_member\(_caller,\s*_org\)\s+IS\s+NOT\s+TRUE\s+THEN/i.test(sql));
});

Deno.test("17. membership helper uses user-first argument order", () => {
  const m = sql.match(/public\.is_user_org_member\([^)]*\)/gi) ?? [];
  assertEquals(m.length, 1);
  assertEquals(m[0], "public.is_user_org_member(_caller, _org)");
});

Deno.test("18. legacy Organization-membership predicates are absent", () => {
  for (const banned of [
    "get_user_org_id",
    "profiles.organization_id",
    "is_organization_member",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
  assert(!/public\.is_org_member\s*\(/i.test(sql));
});

Deno.test("19. has_pm_authority(_caller, _ws) remains required", () => {
  assert(/IF\s+NOT\s+public\.has_pm_authority\(_caller,\s*_ws\)\s+THEN\s*\n?\s*RAISE\s+EXCEPTION\s+'PM authority required for phase clone blueprint';/i.test(sql));
});

Deno.test("20. membership and PM authority precede all btpm_decrypt calls", () => {
  const first = idx(/btpm_decrypt/i);
  assert(idx(/is_user_org_member/i) < first);
  assert(idx(/has_pm_authority/i) < first);
  const decrypts = [...sql.matchAll(/btpm_decrypt/gi)].map((m) => m.index ?? -1);
  assertEquals(decrypts.length, 5, "five decrypt calls remain");
  for (const d of decrypts) assert(d > idx(/has_pm_authority/i));
});

Deno.test("21. _clone_anchor_for_phase remains", () => {
  assert(/_anchor\s*:=\s*public\._clone_anchor_for_phase\(_phase_id\);/i.test(sql));
  assert(sql.includes("'unscheduled'"));
  assert(sql.includes("'phase_start_date'"));
  assert(sql.includes("'earliest_planning_date'"));
  assert(sql.includes("'relative'"));
});

Deno.test("22. Phase blueprint/decrypt behavior remains", () => {
  assert(sql.includes("public.btpm_decrypt(_phase.name, _org)"));
  assert(sql.includes("public.btpm_decrypt(_phase.description, _org)"));
  assert(sql.includes("'sort_order_provenance', _phase.sort_order"));
  assert(sql.includes("public._clone_offset_days(_anchor, _phase.start_date)"));
  assert(sql.includes("public._clone_offset_days(_anchor, _phase.target_end_date)"));
});

Deno.test("23. Task blueprint/decrypt behavior remains", () => {
  assert(sql.includes("public.btpm_decrypt(name, _org)"));
  assert(sql.includes("public.btpm_decrypt(description, _org)"));
  assert(/WHERE\s+t\.phase_id\s*=\s*_phase_id\s+AND\s+t\.is_archived\s*=\s*false/i.test(sql));
  assert(sql.includes("ORDER BY t.sort_order, t.created_at"));
  assert(sql.includes("'backlog_item_provenance_id', backlog_item_id"));
  assert(sql.includes("public._clone_offset_days(_anchor, start_date)"));
  assert(sql.includes("public._clone_offset_days(_anchor, due_date)"));
});

Deno.test("24. dependency blueprint/decrypt behavior remains", () => {
  assert(sql.includes("public.btpm_decrypt(d.description, _org)"));
  assert(sql.includes("JOIN tk src ON d.source_type = 'task' AND d.source_id = src.id"));
  assert(sql.includes("JOIN tk tgt ON d.target_type = 'task' AND d.target_id = tgt.id"));
  assert(sql.includes("'entity_type', 'task'"));
});

Deno.test("25. returned clone_blueprint_v1 structure remains", () => {
  for (const key of [
    "'version', 'clone_blueprint_v1'",
    "'blueprint_kind', 'phase'",
    "'saved_at', to_jsonb(now())",
    "'schedule_mode', _schedule_mode",
    "'anchor_source', _anchor_source",
    "'anchor_date', _anchor",
    "'organization_id', _org",
    "'workspace_id', _ws",
    "'project_id', _proj",
    "'phase_id', _phase_id",
    "'project', NULL",
    "'phase', _phase_obj",
    "'tasks',  _tasks",
    "'dependencies', _deps",
    "'kpi_definitions', '[]'::jsonb",
    "'enabled', false",
    "'workflow_states', '[]'::jsonb",
    "'sprints', '[]'::jsonb",
    "'backlog_items', '[]'::jsonb",
  ]) {
    assert(sql.includes(key), `missing ${key}`);
  }
  assert(sql.includes("jsonb_build_array(jsonb_build_object('ref','phase_1') || _phase_obj)"));
});

Deno.test("26. no can_write_demo is introduced in this read-only step", () => {
  assert(!/can_write_demo/i.test(sql));
});

Deno.test("27. no privilege GRANT/REVOKE is changed", () => {
  assert(!/\bGRANT\b/i.test(sql));
  assert(!/\bREVOKE\b/i.test(sql));
  assert(!/ALTER\s+FUNCTION/i.test(sql));
  assert(!/OWNER\s+TO/i.test(sql));
});

Deno.test("28. ClonePhaseDialog still directly calls preview_phase_clone_blueprint", async () => {
  const dialog = await read(DIALOG);
  assert(dialog.includes('supabase.rpc("preview_phase_clone_blueprint"'));
  assert(dialog.includes('supabase.rpc("clone_phase_in_project"'));
});

Deno.test("29. preview_phase_clone_in_project is not redefined", () => {
  assert(!sql.includes("preview_phase_clone_in_project"));
});

Deno.test("30. clone_phase_in_project is not redefined", () => {
  assert(!sql.includes("clone_phase_in_project"));
});

Deno.test("31. no Project-template function is redefined", () => {
  for (const banned of [
    "save_project_template_from_project",
    "instantiate_project_from_template",
    "preview_project_clone_blueprint",
    "project_templates",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("32. no external API/MCP wrapper or capability is added", () => {
  for (const banned of [
    "api_v1_preview_phase_clone_blueprint",
    "mcp_v1_preview_phase_clone_blueprint",
    "btpm-api-v1",
    "btpm-mcp",
    "api_capability_catalogue",
    "api_capability_grants",
    "idempotency",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("33. no RLS/schema/encryption/frontend change occurs", () => {
  for (const banned of [
    "CREATE TABLE",
    "ALTER TABLE",
    "DROP TABLE",
    "CREATE INDEX",
    "CREATE POLICY",
    "ALTER POLICY",
    "DROP POLICY",
    "CREATE TRIGGER",
    "ROW LEVEL SECURITY",
    "pgp_sym_encrypt",
    "pgp_sym_decrypt",
    "tenant_encryption",
    "ensure_org_encryption_key",
    "src/",
    ".tsx",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
  // btpm_decrypt is only consumed, never redefined.
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*btpm_(en|de)crypt/i.test(sql));
});

Deno.test("34. no migration-time business-data DML/backfill occurs", () => {
  const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert(!/INSERT\s+INTO/i.test(topLevel));
  assert(!/UPDATE\s+public\./i.test(topLevel));
  assert(!/DELETE\s+FROM/i.test(topLevel));
  assert(!/TRUNCATE/i.test(topLevel));
  // the function body itself is read-only
  assert(!/INSERT\s+INTO/i.test(sql));
  assert(!/DELETE\s+FROM/i.test(sql));
  assert(!/UPDATE\s+public\./i.test(sql));
});
