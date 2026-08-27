/**
 * API-Q Cross-Family-C17 — Core Project / Phase / Task Browser Reads
 * OAuth Boundary and Canonical Organization Containment
 *
 * Focused static/contract test over the forward-only migration that redefines
 *   public.get_decrypted_project(uuid)
 *   public.list_workspace_projects(uuid, boolean)
 *   public.get_decrypted_phase(uuid)
 *   public.list_decrypted_project_phases(uuid)
 *   public.get_decrypted_task(uuid)
 *   public.list_decrypted_project_tasks(uuid)
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819185459_530b8562-4335-4f7e-8bee-63c05badd3fb.sql",
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

const TARGETS = [
  "get_decrypted_project",
  "list_workspace_projects",
  "get_decrypted_phase",
  "list_decrypted_project_phases",
  "get_decrypted_task",
  "list_decrypted_project_tasks",
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

const SIGNATURE: Record<string, RegExp> = {
  get_decrypted_project: /public\.get_decrypted_project\(\s*_project_id\s+uuid\s*\)/i,
  list_workspace_projects:
    /public\.list_workspace_projects\(\s*_workspace_id\s+uuid\s*,\s*_include_archived\s+boolean\s+default\s+false\s*\)/i,
  get_decrypted_phase: /public\.get_decrypted_phase\(\s*_phase_id\s+uuid\s*\)/i,
  list_decrypted_project_phases: /public\.list_decrypted_project_phases\(\s*_project_id\s+uuid\s*\)/i,
  get_decrypted_task: /public\.get_decrypted_task\(\s*_task_id\s+uuid\s*\)/i,
  list_decrypted_project_tasks: /public\.list_decrypted_project_tasks\(\s*_project_id\s+uuid\s*\)/i,
};

const RETURNS: Record<string, RegExp> = {
  get_decrypted_project: /returns\s+jsonb/i,
  list_workspace_projects: /returns\s+json\b/i,
  get_decrypted_phase: /returns\s+jsonb/i,
  list_decrypted_project_phases: /returns\s+jsonb/i,
  get_decrypted_task: /returns\s+jsonb/i,
  list_decrypted_project_tasks: /returns\s+jsonb/i,
};

const SEARCH_PATH: Record<string, RegExp> = {
  get_decrypted_project: /set\s+search_path\s+to\s+'public'/i,
  list_workspace_projects: /set\s+search_path\s+to\s+'public'/i,
  get_decrypted_phase: /set\s+search_path\s+to\s+'public'/i,
  list_decrypted_project_phases: /set\s+search_path\s+to\s+'public'/i,
  get_decrypted_task: /set\s+search_path\s+to\s+'pg_catalog',\s*'public'/i,
  list_decrypted_project_tasks: /set\s+search_path\s+to\s+'public'/i,
};

// C17.13 preserved read-authority rule per function
const READ_AUTHORITY: Record<string, RegExp> = {
  get_decrypted_project: /public\.can_read_project_or_demo\(\s*v_caller\s*,\s*_project_id\s*\)/i,
  list_workspace_projects: /public\.can_read_demo_or_member\(\s*v_caller\s*,\s*_workspace_id\s*\)/i,
  get_decrypted_phase:
    /is_workspace_member\(\s*v_caller\s*,\s*_phase\.workspace_id\s*\)\s*or\s*is_org_admin\(\s*v_caller\s*,\s*_phase\.organization_id\s*\)/i,
  list_decrypted_project_phases: /public\.can_read_project_or_demo\(\s*v_caller\s*,\s*_project_id\s*\)/i,
  get_decrypted_task: /public\.can_read_project_or_demo\(\s*v_caller\s*,\s*_project_id\s*\)/i,
  list_decrypted_project_tasks: /public\.can_read_project_or_demo\(\s*v_caller\s*,\s*_project_id\s*\)/i,
};

// C17.10-11 authoritative scope row + canonical Organization membership argument
const SCOPE_LOOKUP: Record<string, RegExp> = {
  get_decrypted_project: /select\s+\*\s+into\s+v_row\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/i,
  list_workspace_projects:
    /select\s+organization_id\s+into\s+_org_id\s+from\s+public\.workspaces\s+where\s+id\s*=\s*_workspace_id/i,
  get_decrypted_phase: /select\s+\*\s+into\s+_phase\s+from\s+phases\s+where\s+id\s*=\s*_phase_id/i,
  list_decrypted_project_phases: /select\s+\*\s+into\s+v_proj\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/i,
  get_decrypted_task:
    /select\s+t\.project_id,\s*t\.organization_id\s+into\s+_project_id,\s*_task_org_id\s+from\s+public\.tasks\s+t\s+where\s+t\.id\s*=\s*_task_id/is,
  list_decrypted_project_tasks: /select\s+\*\s+into\s+v_proj\s+from\s+public\.projects\s+where\s+id\s*=\s*_project_id/i,
};

const MEMBERSHIP: Record<string, RegExp> = {
  get_decrypted_project:
    /public\.is_user_org_member\(\s*v_caller\s*,\s*v_row\.organization_id\s*\)\s+is\s+not\s+true/i,
  list_workspace_projects: /public\.is_user_org_member\(\s*v_caller\s*,\s*_org_id\s*\)\s+is\s+not\s+true/i,
  get_decrypted_phase:
    /public\.is_user_org_member\(\s*v_caller\s*,\s*_phase\.organization_id\s*\)\s+is\s+not\s+true/i,
  list_decrypted_project_phases:
    /public\.is_user_org_member\(\s*v_caller\s*,\s*v_proj\.organization_id\s*\)\s+is\s+not\s+true/i,
  get_decrypted_task: /public\.is_user_org_member\(\s*v_caller\s*,\s*_task_org_id\s*\)\s+is\s+not\s+true/i,
  list_decrypted_project_tasks:
    /public\.is_user_org_member\(\s*v_caller\s*,\s*v_proj\.organization_id\s*\)\s+is\s+not\s+true/i,
};

Deno.test("C17.1 exactly the six target functions are redefined", () => {
  assertEquals(Object.keys(bodies).sort(), [...TARGETS].sort());
  assertEquals((lower.match(/create\s+(or\s+replace\s+)?function/g) ?? []).length, 6);
  for (const fn of TARGETS) assert(SIGNATURE[fn].test(bodies[fn]), fn);
});

Deno.test("C17.2 language/volatility/SECURITY DEFINER/search_path preserved", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    assert(RETURNS[fn].test(b), `${fn} return type`);
    assert(/language\s+plpgsql/i.test(b), fn);
    assert(/security\s+definer/i.test(b), fn);
    assert(SEARCH_PATH[fn].test(b), `${fn} search_path`);
    if (fn === "list_workspace_projects") {
      // volatile (default): no explicit volatility marker
      assert(!/\b(stable|immutable)\b/i.test(b.split("$function$")[0]), fn);
    } else {
      assert(/\bstable\b/i.test(b), fn);
      assert(!/\bvolatile\b/i.test(b), fn);
    }
  }
});

Deno.test("C17.3-6 OAuth boundary first, fail-closed, no trusted-context exception", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn].toLowerCase();
    const gate = b.indexOf("api_e_private.jwt_client_id()");
    assert(gate > 0, fn);
    assert(gate < b.indexOf("auth.uid()"), `${fn} gate before auth.uid`);
    assert(gate < b.search(/select\s/), `${fn} gate before business read`);
    assert(gate < b.indexOf("btpm_decrypt("), `${fn} gate before decrypt`);
    assert(
      /exception\s+when\s+others\s+then\s+v_client_id\s*:=\s*'unresolved_client'/is.test(b),
      fn,
    );
    assert(
      /if\s+v_client_id\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is
        .test(b),
      fn,
    );
    for (
      const banned of ["trusted", "capability", "source_channel", "api_version", "connected_app", "mcp_", "api_v1_"]
    ) {
      assertEquals(b.includes(banned), false, `${fn}:${banned}`);
    }
  }
});

Deno.test("C17.7-9 single auth.uid to v_caller, null denial, active-user on v_caller", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    assertEquals((b.toLowerCase().match(/auth\.uid\(\)/g) ?? []).length, 1, fn);
    assert(/v_caller\s*:=\s*auth\.uid\(\)/i.test(b), fn);
    assert(/v_client_id\s+text;/i.test(b), fn);
    assert(/v_caller\s+uuid;/i.test(b), fn);
    assert(
      /if\s+v_caller\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'\s+using\s+errcode\s*=\s*'42501'/is.test(
        b,
      ),
      fn,
    );
    assert(/if\s+not\s+public\.is_active_user\(v_caller\)/i.test(b), fn);
    assert(b.toLowerCase().includes("'account is deactivated'"), fn);
  }
});

Deno.test("C17.10-12 authoritative scope, canonical membership user-first, before decrypt", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    const l = b.toLowerCase();
    assert(SCOPE_LOOKUP[fn].test(b), `${fn} authoritative scope lookup`);
    assert(MEMBERSHIP[fn].test(b), `${fn} canonical membership`);
    const scopeIdx = l.search(new RegExp(SCOPE_LOOKUP[fn].source, "is"));
    const memIdx = l.indexOf("is_user_org_member");
    assert(scopeIdx > 0 && memIdx > scopeIdx, `${fn} scope before membership`);
    const decryptIdx = l.indexOf("btpm_decrypt(");
    assert(decryptIdx > memIdx, `${fn} membership before decrypt`);
    for (
      const banned of ["get_user_org_id", "profiles.organization_id", "is_org_member(", "is_organization_member"]
    ) {
      assertEquals(l.includes(banned.toLowerCase()), false, `${fn}:${banned}`);
    }
  }
});

Deno.test("C17.13-14 preserved read authority; no write/PM/can_write_demo gate", () => {
  for (const fn of TARGETS) {
    const b = bodies[fn];
    const l = b.toLowerCase();
    assert(READ_AUTHORITY[fn].test(b), `${fn} read authority preserved`);
    assert(l.indexOf("is_user_org_member") < l.search(/can_read_project_or_demo|can_read_demo_or_member|is_workspace_member/),
      `${fn} membership precedes read authority`);
    for (const banned of ["can_write_demo", "has_pm_authority", "pm_authority"]) {
      assertEquals(l.includes(banned), false, `${fn}:${banned}`);
    }
  }
  // C17: can_read_project_or_demo must not be swapped for can_read_project
  assertEquals(/can_read_project\s*\(/i.test(sql), false);
});

Deno.test("C17.15 result/decrypt/order/fallback semantics structurally preserved", () => {
  const proj = bodies.get_decrypted_project;
  assert(/if\s+not\s+found\s+then\s+return\s+null;\s*end\s+if;/is.test(proj));
  for (
    const f of [
      "'charter'",
      "'goals'",
      "'scope_in'",
      "'scope_out'",
      "'business_case'",
      "'success_criteria'",
      "'completion_criteria'",
      "'budget_narrative'",
      "'assumptions'",
      "'constraints'",
      "'portfolio_item_id'",
      "'portfolio_name'",
      "'portfolio_code'",
      "'portfolio_lifecycle_state'",
      "'portfolio_is_archived'",
    ]
  ) assert(proj.includes(f), `project:${f}`);

  const ws = bodies.list_workspace_projects;
  assert(/if\s+_org_id\s+is\s+null\s+then\s+raise\s+exception\s+'workspace not found'/is.test(ws));
  assert(/\(_include_archived\s+or\s+p\.is_archived\s*=\s*false\)/i.test(ws));
  assert(/order\s+by\s+public\.btpm_decrypt\(p\.name,\s*_org_id\)/i.test(ws));
  assert(/return\s+coalesce\(_result,\s*'\[\]'::json\);/i.test(ws));
  for (const f of ["program_name", "portfolio_name", "portfolio_code", "portfolio_lifecycle_state"]) {
    assert(ws.includes(f), `ws:${f}`);
  }

  const ph = bodies.get_decrypted_phase;
  assert(/if\s+not\s+found\s+then\s+return\s+null;\s*end\s+if;/is.test(ph));
  for (
    const f of ["'phase_type'", "'baseline_start_date'", "'baseline_end_date'", "'added_after_baseline'", "'is_archived'"]
  ) assert(ph.includes(f), `phase:${f}`);

  const phs = bodies.list_decrypted_project_phases;
  assert(/if\s+not\s+found\s+then\s+return\s+'\[\]'::jsonb;\s*end\s+if;/is.test(phs));
  assert(/order\s+by\s+ph\.sort_order\)/i.test(phs));
  assert(phs.includes("'actual_start_date'") && phs.includes("'actual_end_date'"));

  const tk = bodies.get_decrypted_task;
  assert(/if\s+_project_id\s+is\s+null\s+then\s+raise\s+exception\s+'access denied'/is.test(tk));
  for (
    const f of [
      "'requested_by_stakeholder'",
      "'executed_by_stakeholders'",
      "'task_assignments'",
      "'phase_name'",
      "'adoption_initiative_name'",
      "task_stakeholder_roles",
      "project_stakeholders",
      "public.profiles",
    ]
  ) assert(tk.includes(f), `task:${f}`);

  const tks = bodies.list_decrypted_project_tasks;
  assert(/if\s+not\s+found\s+then\s+return\s+'\[\]'::jsonb;\s*end\s+if;/is.test(tks));
  assert(/order\s+by\s+t\.sort_order\)/i.test(tks));
  assert(tks.includes("'requested_by_stakeholder'") && tks.includes("'executed_by_stakeholders'"));
  assert(tks.includes("'workflow_state_id'") && tks.includes("'backlog_item_id'"));
  assert(tks.includes("'is_adoption_related'") && tks.includes("'adoption_initiative_id'"));
});

Deno.test("C17.16-18 no privilege/schema/RLS/encryption/API/DML drift", () => {
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
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C17 frontend callers remain unchanged", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(`../../../${p}`, import.meta.url));
  const overview = await read("src/hooks/useProjectOverview.ts");
  const planning = await read("src/hooks/useProjectPlanning.ts");
  const phaseDetail = await read("src/pages/PhaseDetail.tsx");
  const taskDetail = await read("src/pages/TaskDetail.tsx");

  assert(overview.includes('"get_decrypted_project"'));
  assert(overview.includes('"list_workspace_projects"'));
  assert(planning.includes('"list_decrypted_project_phases"'));
  assert(planning.includes('"list_decrypted_project_tasks"'));
  assert(phaseDetail.includes('"get_decrypted_phase"'));
  assert(taskDetail.includes('"get_decrypted_task"'));
});
