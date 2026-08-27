/**
 * API-Q Cross-Family-C13 — Agile Mode Toggle
 * Browser Boundary and Canonical Write-Authority Hardening
 *
 * Focused static/contract test over the forward-only migration that redefines
 * public.toggle_project_agile_mode(uuid, boolean).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819170640_821915d7-5b04-434d-a987-94a52a7d661f.sql",
  import.meta.url,
);
const HOOK = new URL("../../../src/hooks/useAgileSubstrate.ts", import.meta.url);

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
const idx = (s: string) => lower.indexOf(s.toLowerCase());
const declareBlock = sql.slice(idx("declare"), idx("begin"));

Deno.test("C13.1 only toggle_project_agile_mode is redefined", () => {
  assertEquals((lower.match(/create\s+(or\s+replace\s+)?function/g) ?? []).length, 1);
  assert(idx("function public.toggle_project_agile_mode(") >= 0);
  for (const readRpc of ["list_decrypted_workflow_states", "list_decrypted_sprints", "list_decrypted_backlog_items"]) {
    assertEquals(lower.includes(readRpc), false, readRpc);
  }
});

Deno.test("C13.2 signature, default, return, language, secdef, search_path, volatility", () => {
  assert(
    /toggle_project_agile_mode\(\s*_project_id\s+uuid\s*,\s*_enable\s+boolean\s+default\s+true\s*\)/i.test(sql),
  );
  assert(/returns\s+void/i.test(sql));
  assert(/language\s+plpgsql/i.test(sql));
  assert(/security\s+definer/i.test(sql));
  assert(/set\s+search_path\s*=\s*public/i.test(sql));
  assert(/\bvolatile\b/i.test(sql));
  assert(!/\b(stable|immutable)\b/i.test(sql));
});

Deno.test("C13.3 auth.uid() is not evaluated in DECLARE", () => {
  assertEquals(declareBlock.toLowerCase().includes("auth.uid()"), false);
  assert(/_user_id\s+uuid\s*;/i.test(declareBlock));
  assert(/v_client_id\s+text\s*;/i.test(declareBlock));
});

Deno.test("C13.4 jwt_client_id is first, fail-closed, and precedes auth/lookup/mutations", () => {
  const g = idx("api_e_private.jwt_client_id()");
  assert(g > 0);
  assert(g < idx("auth.uid()"));
  assert(g < idx("from public.projects where id = _project_id"));
  assert(g < idx("update public.projects"));
  assert(g < idx("insert into public.board_workflow_states"));
  assert(/exception\s+when\s+others\s+then\s+v_client_id\s*:=\s*'unresolved_client'/is.test(sql));
  assert(
    /if\s+v_client_id\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
      .test(sql),
  );
  for (const banned of ["trusted", "capability", "source_channel", "api_version", "connected_app", "mcp_"]) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C13.5 explicit caller-null denial and active-user check", () => {
  assertEquals((lower.match(/auth\.uid\(\)/g) ?? []).length, 1);
  assert(/_user_id\s*:=\s*auth\.uid\(\)/i.test(sql));
  assert(/if\s+_user_id\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'/is.test(sql));
  assert(/if\s+not\s+public\.is_active_user\(_user_id\)/i.test(sql));
  assert(lower.includes("'account is deactivated'"));
});

Deno.test("C13.6 authoritative Project scope preserved", () => {
  assert(
    /select\s+id,\s*workspace_id,\s*organization_id,\s*agile_enabled\s+into\s+_project\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/is
      .test(sql),
  );
  assert(/if\s+_project\s+is\s+null\s+then\s+raise\s+exception\s+'project not found'/is.test(sql));
});

Deno.test("C13.7 canonical org membership, user-first, no legacy predicate", () => {
  assert(
    /public\.is_user_org_member\(\s*_user_id\s*,\s*_project\.organization_id\s*\)\s+is\s+not\s+true/i.test(sql),
  );
  for (const banned of ["get_user_org_id", "profiles.organization_id", "is_org_member(", "is_organization_member"]) {
    assertEquals(lower.includes(banned.toLowerCase()), false, banned);
  }
});

Deno.test("C13.8 PM authority and can_write_demo gates", () => {
  assert(/public\.has_project_pm_authority\(\s*_user_id\s*,\s*_project_id\s*\)/i.test(sql));
  assert(lower.includes("'insufficient authority'"));
  assert(/public\.can_write_demo\(\s*_user_id\s*,\s*_project\.workspace_id\s*\)/i.test(sql));
});

Deno.test("C13.9 all authority gates precede UPDATE/INSERT", () => {
  const order = [
    "api_e_private.jwt_client_id()",
    "_user_id := auth.uid()",
    "if _user_id is null",
    "public.is_active_user(_user_id)",
    "from public.projects where id = _project_id",
    "public.is_user_org_member(_user_id",
    "public.has_project_pm_authority(_user_id",
    "public.can_write_demo(_user_id",
    "update public.projects",
    "insert into public.board_workflow_states",
  ].map(idx);
  order.forEach((p, i) => {
    assert(p > 0, `missing marker ${i}`);
    if (i > 0) assert(p > order[i - 1], `out of order at ${i}`);
  });
});

Deno.test("C13.10 agile_enabled update preserved and no other Project field mutated", () => {
  const upd = sql.match(/update\s+public\.projects\s+set([\s\S]*?)where\s+id\s*=\s*_project_id/i);
  assert(upd !== null);
  const setClause = upd![1].toLowerCase().trim();
  assertEquals(setClause, "agile_enabled = _enable");
  assertEquals((lower.match(/update\s+public\./g) ?? []).length, 1);
  assertEquals(lower.includes("return;"), false);
});

Deno.test("C13.11 conditional default workflow-state creation preserved", () => {
  assert(/if\s+_enable\s+then/i.test(sql));
  assert(
    /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+public\.board_workflow_states\s+where\s+project_id\s*=\s*_project_id\s+limit\s+1\s*\)/is
      .test(sql),
  );
  assert(
    /insert\s+into\s+public\.board_workflow_states\s*\(\s*organization_id,\s*workspace_id,\s*project_id,\s*name,\s*category,\s*sort_order,\s*created_by\s*\)/is
      .test(sql),
  );
  const defaults: [string, string, string][] = [
    ["To Do", "todo", "1"],
    ["In Progress", "in_progress", "2"],
    ["In Review", "in_review", "3"],
    ["Done", "done", "4"],
  ];
  let prev = -1;
  for (const [name, cat, order] of defaults) {
    const re = new RegExp(
      `\\(_project\\.organization_id,\\s*_project\\.workspace_id,\\s*_project_id,\\s*'${name}',\\s*'${cat}',\\s*${order},\\s*_user_id\\)`,
      "i",
    );
    const m = sql.match(re);
    assert(m !== null, `missing default ${name}`);
    const pos = sql.indexOf(m![0]);
    assert(pos > prev, `default ${name} out of order`);
    prev = pos;
  }
});

Deno.test("C13.12 disabling does not delete states; no activity events added", () => {
  assertEquals(lower.includes("delete from"), false);
  assertEquals(lower.includes("truncate"), false);
  assertEquals(lower.includes("activity_events"), false);
});

Deno.test("C13.13 no manual encryption added", () => {
  for (const banned of ["btpm_encrypt", "btpm_decrypt", "create trigger", "drop trigger", "pgp_sym"]) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C13.14 useAgileSubstrate still calls the RPC", () => {
  assert(hook.includes('"toggle_project_agile_mode"'));
});

Deno.test("C13.15 no privilege/schema/RLS/API drift and no backfill DML", () => {
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
      "constraint",
      "api_v1_toggle_project_agile_mode",
      "mcp_v1_toggle_project_agile_mode",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
  assertEquals((lower.match(/insert\s+into/g) ?? []).length, 1);
});
