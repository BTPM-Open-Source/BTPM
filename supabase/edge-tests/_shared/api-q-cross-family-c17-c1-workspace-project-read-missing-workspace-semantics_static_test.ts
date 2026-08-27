/**
 * API-Q Cross-Family-C17-C1 — Workspace Project Read
 * Missing-Workspace Semantics Preservation
 *
 * Focused static/contract test over the forward-only correction migration that
 * redefines public.list_workspace_projects(uuid, boolean) with only the
 * missing-Workspace branch corrected back to pre-C17 behavior.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819190220_dcb4cb0c-c243-45e5-b708-6e3b50439481.sql",
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

const sql = stripSqlComments(await Deno.readTextFile(MIGRATION));
const lower = sql.toLowerCase();
const idx = (needle: string) => lower.indexOf(needle.toLowerCase());

Deno.test("C17-C1.1 exactly one function redefined: list_workspace_projects(uuid, boolean)", () => {
  assertEquals((lower.match(/create\s+(or\s+replace\s+)?function/g) ?? []).length, 1);
  assert(
    /public\.list_workspace_projects\(\s*_workspace_id\s+uuid\s*,\s*_include_archived\s+boolean\s+default\s+false\s*\)/i
      .test(sql),
  );
  for (
    const other of [
      "get_decrypted_project",
      "get_decrypted_phase",
      "list_decrypted_project_phases",
      "get_decrypted_task",
      "list_decrypted_project_tasks",
    ]
  ) {
    assertEquals(lower.includes(other), false, other);
  }
});

Deno.test("C17-C1.2 signature/return/language/volatility/secdef/search_path preserved", () => {
  assert(/returns\s+json\b/i.test(sql));
  assert(/language\s+plpgsql/i.test(sql));
  assert(/security\s+definer/i.test(sql));
  assert(/set\s+search_path\s+to\s+'public'/i.test(sql));
  // VOLATILE by default: no explicit volatility marker before the body
  const header = sql.split("$function$")[0];
  assert(!/\b(stable|immutable)\b/i.test(header));
});

Deno.test("C17-C1.3 OAuth boundary remains first and fail-closed", () => {
  const gate = idx("api_e_private.jwt_client_id()");
  assert(gate > 0);
  assert(gate < idx("auth.uid()"));
  assert(gate < idx("from public.workspaces"));
  assert(gate < idx("btpm_decrypt("));
  assert(/exception\s+when\s+others\s+then\s+v_client_id\s*:=\s*'unresolved_client'/is.test(sql));
  assert(
    /if\s+v_client_id\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
  for (
    const banned of ["trusted", "capability", "source_channel", "api_version", "connected_app", "mcp_", "api_v1_"]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C17-C1.4 auth.uid resolved once; null denial; active-user gate unchanged", () => {
  assertEquals((lower.match(/auth\.uid\(\)/g) ?? []).length, 1);
  assert(/v_caller\s*:=\s*auth\.uid\(\)/i.test(sql));
  assert(/v_client_id\s+text;/i.test(sql));
  assert(/v_caller\s+uuid;/i.test(sql));
  assert(
    /if\s+v_caller\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is.test(
      sql,
    ),
  );
  assert(
    /if\s+not\s+public\.is_active_user\(v_caller\)\s+then\s+raise\s+exception\s+'account is deactivated'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
});

Deno.test("C17-C1.5 missing Workspace now raises 'Not a workspace member' (no 'Workspace not found')", () => {
  assert(
    /select\s+organization_id\s+into\s+_org_id\s+from\s+public\.workspaces\s+where\s+id\s*=\s*_workspace_id;\s*if\s+_org_id\s+is\s+null\s+then\s+raise\s+exception\s+'not a workspace member';\s*end\s+if;/is
      .test(sql),
  );
  assertEquals(lower.includes("workspace not found"), false);
  // no new explicit SQLSTATE introduced for this branch
  assert(
    !/if\s+_org_id\s+is\s+null\s+then\s+raise\s+exception\s+'not a workspace member'\s+using/is.test(sql),
  );
});

Deno.test("C17-C1.6 lookup -> canonical membership -> can_read_demo_or_member order preserved", () => {
  const lookup = idx("from public.workspaces where id = _workspace_id");
  const missing = idx("if _org_id is null then");
  const member = idx("public.is_user_org_member(v_caller, _org_id)");
  const authority = idx("public.can_read_demo_or_member(v_caller, _workspace_id)");
  const decrypt = idx("btpm_decrypt(");
  assert(lookup > 0 && missing > lookup, "missing branch after lookup");
  assert(member > missing, "membership after missing branch");
  assert(authority > member, "read authority after canonical membership");
  assert(decrypt > authority, "decrypt after read authority");
  assert(
    /public\.is_user_org_member\(\s*v_caller\s*,\s*_org_id\s*\)\s+is\s+not\s+true\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
  assert(
    /if\s+not\s+public\.can_read_demo_or_member\(\s*v_caller\s*,\s*_workspace_id\s*\)\s+then\s+raise\s+exception\s+'not a workspace member';/is
      .test(sql),
  );
  for (const banned of ["can_write_demo", "pm_authority", "can_read_project"]) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C17-C1.7 result/decrypt/order/fallback behavior unchanged", () => {
  for (
    const f of [
      "p.project_stage",
      "p.delivery_model",
      "p.agile_enabled",
      "program_name",
      "p.portfolio_item_id",
      "portfolio_name",
      "portfolio_code",
      "portfolio_lifecycle_state",
      "portfolio_is_archived",
    ]
  ) assert(sql.includes(f), f);
  assert(/\(_include_archived\s+or\s+p\.is_archived\s*=\s*false\)/i.test(sql));
  assert(/order\s+by\s+public\.btpm_decrypt\(p\.name,\s*_org_id\)/i.test(sql));
  assert(/select\s+json_agg\(row_to_json\(t\)\)\s+into\s+_result/i.test(sql));
  assert(/return\s+coalesce\(_result,\s*'\[\]'::json\);/i.test(sql));
});

Deno.test("C17-C1.8 no privilege/schema/RLS/encryption/API/DML/frontend drift", () => {
  for (
    const banned of [
      "grant ",
      "revoke ",
      "create policy",
      "alter policy",
      "drop policy",
      "row level security",
      "create table",
      "alter table",
      "create index",
      "create trigger",
      "drop trigger",
      "btpm_encrypt",
      "function public.btpm_decrypt",
      "insert into",
      "update public.",
      "delete from",
      "truncate",
      "api_capability",
      "mcp_v1_",
      "supabase.rpc",
      ".tsx",
      "alter function",
      "owner to",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});
