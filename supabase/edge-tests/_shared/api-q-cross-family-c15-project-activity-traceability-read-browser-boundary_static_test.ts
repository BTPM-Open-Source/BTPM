/**
 * API-Q Cross-Family-C15 — Project Activity / Traceability Read
 * Browser Boundary and Canonical Organization Containment Hardening
 *
 * Focused static/contract test over the forward-only migration that redefines
 *   public.list_project_activity_events(uuid) RETURNS jsonb
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819174042_537b8e16-40b0-4c62-ba89-937ee1e0bf7b.sql",
  import.meta.url,
);
const HOOK = new URL("../../../src/hooks/useProjectActivityEvents.ts", import.meta.url);

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
const hook = await Deno.readTextFile(HOOK);

const idx = (needle: string) => lower.indexOf(needle.toLowerCase());

Deno.test("C15.1-6 function contract preserved", () => {
  assertEquals((lower.match(/create\s+(or\s+replace\s+)?function/g) ?? []).length, 1);
  assert(/public\.list_project_activity_events\s*\(\s*_project_id\s+uuid\s*\)/i.test(sql));
  assert(/returns\s+jsonb/i.test(sql));
  assert(/language\s+plpgsql/i.test(sql));
  assert(/\bstable\b/i.test(sql));
  assert(!/\b(volatile|immutable)\b/i.test(sql));
  assert(/security\s+definer/i.test(sql));
  assert(/set\s+search_path\s*=\s*public,\s*extensions/i.test(sql));
});

Deno.test("C15.7-14 signed-OAuth boundary is first and fail-closed", () => {
  const gate = idx("api_e_private.jwt_client_id()");
  assert(gate > 0);
  for (
    const after of [
      "auth.uid()",
      "from public.projects where id = _project_id",
      "from public.phases",
      "from public.tasks",
      "from public.blockers",
      "from public.risks",
      "from public.kpi_definitions",
      "from public.governance_cadences",
      "from public.governance_records",
      "from public.activity_events",
      "btpm_decrypt(",
    ]
  ) {
    assert(idx(after) > gate, `gate must precede ${after}`);
  }
  assert(
    /exception\s+when\s+others\s+then\s+v_client_id\s*:=\s*'unresolved_client'/is.test(sql),
  );
  assert(
    /if\s+v_client_id\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
  for (
    const banned of [
      "trusted",
      "capability",
      "source_channel",
      "api_version",
      "connected_app",
      "mcp_",
      "api_v1_",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C15.15-17 single auth.uid, caller-null denial, active user on v_caller", () => {
  assertEquals((lower.match(/auth\.uid\(\)/g) ?? []).length, 1);
  assert(/v_caller\s*:=\s*auth\.uid\(\)/i.test(sql));
  assert(
    /if\s+v_caller\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
  assert(/if\s+not\s+public\.is_active_user\(v_caller\)/i.test(sql));
  assert(lower.includes("'account is deactivated'"));
  // declarations, not auth.uid() in DECLARE
  assert(/declare[\s\S]*?v_client_id\s+text;[\s\S]*?v_caller\s+uuid;/i.test(sql));
  assert(idx("v_caller uuid;") < idx("v_caller := auth.uid()"));
});

Deno.test("C15.18-28 containment and preserved project authority", () => {
  assert(
    /select\s+\*\s+into\s+v_proj\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/i.test(sql),
  );
  assert(/if\s+not\s+found\s+then\s+raise\s+exception\s+'project not found'/is.test(sql));
  assert(
    /public\.is_user_org_member\(\s*v_caller\s*,\s*v_proj\.organization_id\s*\)\s+is\s+not\s+true/i.test(sql),
  );
  for (
    const banned of [
      "get_user_org_id",
      "profiles.organization_id",
      "is_org_member(",
      "is_organization_member",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
  assert(/public\.has_project_access\(\s*v_caller\s*,\s*_project_id\s*\)/i.test(sql));
  assertEquals(lower.includes("function public.has_project_access"), false);
  assert(idx("is_user_org_member") < idx("has_project_access"));
  assert(idx("has_project_access") < idx("from public.activity_events"));
  assert(idx("has_project_access") < idx("btpm_decrypt("));
  assertEquals(lower.includes("can_write_demo"), false);
  assertEquals(lower.includes("has_pm_authority"), false);
  assertEquals(lower.includes("pm_authority"), false);
});

Deno.test("C15.29-37 complete target scope and organization predicate preserved", () => {
  assert(/select\s+'project'::text\s+as\s+t,\s*v_proj\.id\s+as\s+id/i.test(sql));
  assert(/'phase'::text,\s*ph\.id\s+from\s+public\.phases\s+ph\s+where\s+ph\.project_id\s*=\s*_project_id/i.test(sql));
  assert(/'task'::text,\s*tk\.id\s+from\s+public\.tasks\s+tk\s+where\s+tk\.project_id\s*=\s*_project_id/i.test(sql));
  assert(/'blocker'::text\s+as\s+t,\s*b\.id\s+from\s+public\.blockers\s+b/i.test(sql));
  assert(/'risk'::text,\s*r\.id\s+from\s+public\.risks\s+r/i.test(sql));
  assert(/'kpi_definition'::text,\s*k\.id\s+from\s+public\.kpi_definitions\s+k/i.test(sql));
  assert(/'governance_cadence'::text\s+as\s+t,\s*gc\.id\s+from\s+public\.governance_cadences\s+gc\s+where\s+gc\.project_id\s*=\s*_project_id/is.test(sql));
  assert(/'governance_record'::text,\s*gr\.id\s+from\s+public\.governance_records\s+gr\s+where\s+gr\.project_id\s*=\s*_project_id/is.test(sql));
  assertEquals((lower.match(/union all/g) ?? []).length, 7);
  assert(
    /from\s+public\.activity_events\s+ae\s+join\s+all_targets\s+at\s+on\s+at\.t\s*=\s*ae\.target_type\s+and\s+at\.id\s*=\s*ae\.target_id\s+where\s+ae\.organization_id\s*=\s*v_proj\.organization_id/is
      .test(sql),
  );
});

Deno.test("C15.38-41 returned JSON, decrypt, ordering and fallback preserved", () => {
  for (
    const field of [
      "'id', ae.id",
      "'event_type', ae.event_type",
      "'target_type', ae.target_type",
      "'target_id', ae.target_id",
      "'actor_id', ae.actor_id",
      "'organization_id', ae.organization_id",
      "'workspace_id', ae.workspace_id",
      "'created_at', ae.created_at",
    ]
  ) {
    assert(lower.includes(field.toLowerCase()), field);
  }
  assert(/'metadata',\s*btpm_decrypt\(ae\.metadata,\s*ae\.organization_id\)/i.test(sql));
  assert(/order\s+by\s+ae\.created_at\s+desc/i.test(sql));
  assertEquals((lower.match(/'\[\]'::jsonb/g) ?? []).length, 2);
  assert(/return\s+coalesce\(v_result,\s*'\[\]'::jsonb\);/i.test(sql));
});

Deno.test("C15.42-49 non-goals: frontend, privileges, schema, encryption, DML", () => {
  assert(hook.includes('supabase.rpc("list_project_activity_events"'));
  assert(hook.includes("_project_id: projectId"));
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
      "trg_encrypt_activity_metadata",
      "log_activity_event",
      "btpm_encrypt",
      "function public.btpm_decrypt",
      "insert into",
      "update public.",
      "delete from",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});
