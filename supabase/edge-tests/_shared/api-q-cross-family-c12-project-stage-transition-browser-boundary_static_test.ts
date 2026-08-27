/**
 * API-Q Cross-Family-C12 — Project Stage Transition
 * Browser Boundary and Canonical Write-Authority Hardening
 *
 * Focused static/contract test over the forward-only migration that redefines
 * public.transition_project_stage(uuid, project_stage).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819170026_d13346c1-335a-41b0-85e2-5ab16784d992.sql",
  import.meta.url,
);
const BADGE = new URL(
  "../../../src/components/project/ProjectStageBadge.tsx",
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

const raw = await Deno.readTextFile(MIGRATION);
const sql = stripSqlComments(raw);
const lower = sql.toLowerCase();
const badge = await Deno.readTextFile(BADGE);

const idx = (needle: string) => lower.indexOf(needle.toLowerCase());

Deno.test("C12.1 only transition_project_stage is redefined", () => {
  const creates = lower.match(/create\s+(or\s+replace\s+)?function/g) ?? [];
  assertEquals(creates.length, 1);
  assert(idx("function public.transition_project_stage(") >= 0);
});

Deno.test("C12.2 exact signature remains", () => {
  assert(
    /transition_project_stage\(\s*_project_id\s+uuid\s*,\s*_project_stage\s+public\.project_stage\s*\)/i
      .test(sql),
  );
});

Deno.test("C12.3-7 returns/language/secdef/search_path/volatility unchanged", () => {
  assert(/returns\s+public\.projects/i.test(sql));
  assert(/language\s+plpgsql/i.test(sql));
  assert(/security\s+definer/i.test(sql));
  assert(/set\s+search_path\s*=\s*public/i.test(sql));
  assert(/\bvolatile\b/i.test(sql));
  assert(!/\b(stable|immutable)\b/i.test(sql));
});

Deno.test("C12.8-10 jwt_client_id precedes auth.uid, project lookup, mutation", () => {
  const g = idx("api_e_private.jwt_client_id()");
  assert(g > 0);
  assert(g < idx("auth.uid()"));
  assert(g < idx("from public.projects where id = _project_id"));
  assert(g < idx("update public.projects"));
  assert(g < idx("insert into public.activity_events"));
});

Deno.test("C12.11-13 fail-closed denial with no trusted-context exception", () => {
  assert(/exception\s+when\s+others\s+then\s+v_client_id\s*:=\s*'unresolved_client'/is.test(sql));
  assert(
    /if\s+v_client_id\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
  for (const banned of ["source_channel", "api_version", "capability", "trusted", "mcp_", "connected_app"]) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C12.14-15 auth.uid assigned once with explicit null denial", () => {
  assertEquals((lower.match(/auth\.uid\(\)/g) ?? []).length, 1);
  assert(/v_caller\s*:=\s*auth\.uid\(\)/i.test(sql));
  assert(/if\s+v_caller\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'/is.test(sql));
});

Deno.test("C12.16-18 active-user check and authoritative project lookup", () => {
  assert(/if\s+not\s+public\.is_active_user\(v_caller\)/i.test(sql));
  assert(lower.includes("not authorized: inactive user"));
  assert(/select\s+\*\s+into\s+v_project\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/i.test(sql));
  assert(/if\s+not\s+found\s+then\s+raise\s+exception\s+'project not found'/is.test(sql));
});

Deno.test("C12.19-21 canonical org membership, user-first, no legacy predicates", () => {
  assert(
    /public\.is_user_org_member\(\s*v_caller\s*,\s*v_project\.organization_id\s*\)\s+is\s+not\s+true/i.test(sql),
  );
  for (const banned of ["get_user_org_id", "profiles.organization_id", "is_org_member(", "is_organization_member"]) {
    assertEquals(lower.includes(banned.toLowerCase()), false, banned);
  }
});

Deno.test("C12.22-23 PM authority and can_write_demo gates", () => {
  assert(/public\.has_project_pm_authority\(\s*v_caller\s*,\s*_project_id\s*\)/i.test(sql));
  assert(lower.includes("pm+ authority required to transition project stage"));
  assert(/public\.can_write_demo\(\s*v_caller\s*,\s*v_project\.workspace_id\s*\)/i.test(sql));
});

Deno.test("C12.24 all authority gates precede no-op return, UPDATE and activity INSERT", () => {
  const order = [
    "api_e_private.jwt_client_id()",
    "v_caller := auth.uid()",
    "if v_caller is null",
    "public.is_active_user(v_caller)",
    "from public.projects where id = _project_id",
    "public.is_user_org_member(v_caller",
    "public.has_project_pm_authority(v_caller",
    "public.can_write_demo(v_caller",
    "v_old_stage := v_project.project_stage",
    "update public.projects",
    "insert into public.activity_events",
  ].map((s) => idx(s));
  order.forEach((p, i) => {
    assert(p > 0, `missing marker ${i}`);
    if (i > 0) assert(p > order[i - 1], `out of order at ${i}`);
  });
});

Deno.test("C12.25-28 no-op and stage-only mutation preserved", () => {
  assert(/v_old_stage\s*:=\s*v_project\.project_stage/i.test(sql));
  assert(/if\s+v_old_stage\s*=\s*_project_stage\s+then\s+return\s+v_project;/is.test(sql));
  const upd = sql.match(/update\s+public\.projects\s+set([\s\S]*?)where\s+id\s*=\s*_project_id/i);
  assert(upd !== null);
  const setClause = upd![1].toLowerCase();
  assert(setClause.includes("project_stage = _project_stage"));
  assert(setClause.includes("updated_at = now()"));
  assertEquals(setClause.includes("status"), false);
  assertEquals((setClause.match(/=/g) ?? []).length, 2);
});

Deno.test("C12.29-32 activity event, actor and return contract preserved", () => {
  assert(lower.includes("'project_stage_transitioned'"));
  assert(lower.includes("'project'"));
  assert(lower.includes("'from_stage'") && lower.includes("'to_stage'"));
  assert(/actor_id[\s\S]*values[\s\S]*v_caller/i.test(sql));
  assert(/return\s+v_project;/i.test(sql));
});

Deno.test("C12.33-34 no encryption changes", () => {
  for (const banned of ["btpm_encrypt", "btpm_decrypt", "trg_encrypt_activity_metadata", "create trigger", "drop trigger"]) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C12.35 ProjectStageBadge still calls the RPC", () => {
  assert(badge.includes('supabase.rpc("transition_project_stage"'));
  assert(badge.includes("_project_id"));
  assert(badge.includes("_project_stage"));
});

Deno.test("C12.36-40 no privilege/schema/RLS/DML drift in migration", () => {
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
      "api_v1_transition_project_stage",
      "mcp_v1_transition_project_stage",
      "insert into public.projects",
      "update public.activity_events",
      "delete from",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
  const inserts = lower.match(/insert\s+into/g) ?? [];
  assertEquals(inserts.length, 1);
});
