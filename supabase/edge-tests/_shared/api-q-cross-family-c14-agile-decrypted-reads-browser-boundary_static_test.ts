/**
 * API-Q Cross-Family-C14 — Agile Decrypted Reads
 * Browser Boundary and Canonical Read-Authority Hardening
 *
 * Focused static/contract test over the forward-only migration that redefines
 *   public.list_decrypted_workflow_states(uuid)
 *   public.list_decrypted_sprints(uuid)
 *   public.list_decrypted_backlog_items(uuid)
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819171202_12ac32ea-8b82-45dd-ba31-488f81bd6763.sql",
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

const TARGETS = [
  "list_decrypted_workflow_states",
  "list_decrypted_sprints",
  "list_decrypted_backlog_items",
] as const;

/** Split migration into per-function bodies keyed by function name. */
const bodies: Record<string, string> = {};
{
  const parts = sql.split(/create\s+or\s+replace\s+function/i).slice(1);
  for (const part of parts) {
    const m = part.match(/public\.(\w+)\s*\(/);
    assert(m !== null, "unnamed function in migration");
    bodies[m![1]] = part;
  }
}

const TABLE_BY_FN: Record<string, string> = {
  list_decrypted_workflow_states: "public.board_workflow_states",
  list_decrypted_sprints: "public.sprints",
  list_decrypted_backlog_items: "public.backlog_items",
};

Deno.test("C14.1-2 exactly the three target functions are redefined", () => {
  assertEquals(Object.keys(bodies).sort(), [...TARGETS].sort());
  assertEquals((lower.match(/create\s+(or\s+replace\s+)?function/g) ?? []).length, 3);
  assertEquals(lower.includes("can_read_project("), true);
  assertEquals(lower.includes("function public.can_read_project"), false);
  assertEquals(lower.includes("toggle_project_agile_mode"), false);
});

Deno.test("C14.3 signature/return/language/secdef/search_path/volatility preserved", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    assert(new RegExp(`public\\.${fn}\\(\\s*_project_id\\s+uuid\\s*\\)`, "i").test(b), fn);
    assert(/returns\s+json/i.test(b), fn);
    assert(/language\s+plpgsql/i.test(b), fn);
    assert(/security\s+definer/i.test(b), fn);
    assert(/set\s+search_path\s*=\s*public/i.test(b), fn);
    assert(/\bvolatile\b/i.test(b), fn);
    assert(!/\b(stable|immutable)\b/i.test(b), fn);
  }
});

Deno.test("C14.4-9 OAuth gate first, fail-closed, no trusted-context exception", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn].toLowerCase();
    const g = b.indexOf("api_e_private.jwt_client_id()");
    assert(g > 0, fn);
    assert(g < b.indexOf("auth.uid()"), fn);
    assert(g < b.indexOf("from public.projects where id = _project_id"), fn);
    assert(g < b.indexOf(TABLE_BY_FN[fn]), fn);
    assert(g < b.indexOf("btpm_decrypt("), fn);
    assert(/exception\s+when\s+others\s+then\s+v_client_id\s*:=\s*'unresolved_client'/is.test(b), fn);
    assert(
      /if\s+v_client_id\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
        .test(b),
      fn,
    );
    for (const banned of ["trusted", "capability", "source_channel", "api_version", "connected_app", "mcp_"]) {
      assertEquals(b.includes(banned), false, `${fn}:${banned}`);
    }
  }
});

Deno.test("C14.10-12 single auth.uid, null denial, active-user check", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    assertEquals((b.toLowerCase().match(/auth\.uid\(\)/g) ?? []).length, 1, fn);
    assert(/v_caller\s*:=\s*auth\.uid\(\)/i.test(b), fn);
    assert(/if\s+v_caller\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'/is.test(b), fn);
    assert(/if\s+not\s+public\.is_active_user\(v_caller\)/i.test(b), fn);
    assert(b.toLowerCase().includes("'account is deactivated'"), fn);
  }
});

Deno.test("C14.13-16 authoritative org lookup, canonical membership, no legacy predicate", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    assert(
      /select\s+organization_id\s+into\s+_org_id\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/i.test(b),
      fn,
    );
    assert(/public\.is_user_org_member\(\s*v_caller\s*,\s*_org_id\s*\)\s+is\s+not\s+true/i.test(b), fn);
    for (const banned of ["get_user_org_id", "profiles.organization_id", "is_org_member(", "is_organization_member"]) {
      assertEquals(b.toLowerCase().includes(banned.toLowerCase()), false, `${fn}:${banned}`);
    }
  }
});

Deno.test("C14.17-21 can_read_project preserved after membership; no write/PM gate added", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn].toLowerCase();
    assert(/if\s+not\s+public\.can_read_project\(\s*v_caller\s*,\s*_project_id\s*\)/i.test(bodies[fn]), fn);
    assert(b.includes("forbidden: not authorized to read this project"), fn);
    assert(b.indexOf("is_user_org_member") < b.indexOf("can_read_project"), fn);
    assertEquals(b.includes("can_write_demo"), false, fn);
    assertEquals(b.includes("pm_authority"), false, fn);
  }
});

Deno.test("C14.19 all gates precede table read and decrypt", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn].toLowerCase();
    const order = [
      "api_e_private.jwt_client_id()",
      "v_caller := auth.uid()",
      "if v_caller is null",
      "public.is_active_user(v_caller)",
      "from public.projects where id = _project_id",
      "public.is_user_org_member(v_caller",
      "public.can_read_project(v_caller",
      TABLE_BY_FN[fn],
    ].map((s) => b.indexOf(s));
    order.forEach((p, i) => {
      assert(p > 0, `${fn} missing marker ${i}`);
      if (i > 0) assert(p > order[i - 1], `${fn} out of order at ${i}`);
    });
    assert(b.indexOf("public.can_read_project(v_caller") < b.indexOf("btpm_decrypt("), fn);
  }
});

Deno.test("C14.22 workflow-state result shape/order/decrypt preserved", () => {
  const b = bodies.list_decrypted_workflow_states;
  assert(
    /select\s+bws\.id,\s*bws\.organization_id,\s*bws\.workspace_id,\s*bws\.project_id,\s*case\s+when\s+bws\.name\s+is\s+not\s+null\s+and\s+bws\.name\s*!=\s*''\s*then\s+btpm_decrypt\(bws\.name,\s*bws\.organization_id\)\s+else\s+bws\.name\s+end\s+as\s+name,\s*bws\.category,\s*bws\.sort_order,\s*bws\.is_archived,\s*bws\.created_by,\s*bws\.created_at,\s*bws\.updated_at/is
      .test(b),
  );
  assert(/from\s+public\.board_workflow_states\s+bws\s+where\s+bws\.project_id\s*=\s*_project_id\s+order\s+by\s+bws\.sort_order\)/is.test(b));
});

Deno.test("C14.23 sprint result shape/order/decrypt preserved", () => {
  const b = bodies.list_decrypted_sprints;
  assert(
    /select\s+s\.id,\s*s\.organization_id,\s*s\.workspace_id,\s*s\.project_id,\s*s\.name,\s*case\s+when\s+s\.goal\s+is\s+not\s+null\s+and\s+s\.goal\s*!=\s*''\s*then\s+btpm_decrypt\(s\.goal,\s*s\.organization_id\)\s+else\s+s\.goal\s+end\s+as\s+goal,\s*s\.status,\s*s\.start_date,\s*s\.end_date,\s*s\.sort_order,\s*s\.is_archived,\s*s\.created_by,\s*s\.created_at,\s*s\.updated_at/is
      .test(b),
  );
  assert(/from\s+public\.sprints\s+s\s+where\s+s\.project_id\s*=\s*_project_id\s+order\s+by\s+s\.sort_order,\s*s\.created_at\)/is.test(b));
});

Deno.test("C14.24 backlog result shape/order/decrypt preserved", () => {
  const b = bodies.list_decrypted_backlog_items;
  assert(
    /select\s+bi\.id,\s*bi\.organization_id,\s*bi\.workspace_id,\s*bi\.project_id,\s*bi\.phase_id,\s*bi\.sprint_id,\s*bi\.workflow_state_id,\s*bi\.title,\s*case\s+when\s+bi\.description\s+is\s+not\s+null\s+and\s+bi\.description\s*!=\s*''\s*then\s+btpm_decrypt\(bi\.description,\s*bi\.organization_id\)\s+else\s+bi\.description\s+end\s+as\s+description,\s*bi\.priority,\s*bi\.sort_order,\s*bi\.is_archived,\s*bi\.created_by,\s*bi\.created_at,\s*bi\.updated_at/is
      .test(b),
  );
  assert(/from\s+public\.backlog_items\s+bi\s+where\s+bi\.project_id\s*=\s*_project_id\s+order\s+by\s+bi\.sort_order,\s*bi\.created_at\)/is.test(b));
});

Deno.test("C14.25-27 empty/not-found behavior and COALESCE preserved", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    assert(/if\s+_org_id\s+is\s+null\s+then\s+return\s+'\[\]'::json;\s*end\s+if;/is.test(b), fn);
    assert(/return\s+coalesce\(_result,\s*'\[\]'::json\);/i.test(b), fn);
    assert(/select\s+json_agg\(row_to_json\(t\)\)\s+into\s+_result/i.test(b), fn);
  }
});

Deno.test("C14.28 useAgileSubstrate still calls all three RPCs", () => {
  for (const fn of TARGETS) assert(hook.includes(`"${fn}"`), fn);
});

Deno.test("C14.29-36 no privilege/schema/RLS/encryption/API drift and no backfill", () => {
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
      "api_v1_",
      "mcp_v1_",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});
