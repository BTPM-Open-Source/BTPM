// API-Q Portfolio-12E.6 — Admin Portfolio Project Management RPCs
// Signed External-OAuth Denial (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the three redefined browser-only Admin Portfolio project-management RPCs.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12E.6 — Admin Portfolio Project Management RPCs Signed External-OAuth Denial";

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

const sql = stripSqlComments(found[0]?.text ?? "");

const FN_CANDIDATES = "public.admin_list_portfolio_project_assignment_candidates";
const FN_ASSIGN = "public.admin_assign_projects_to_portfolio";
const FN_REMOVE = "public.admin_remove_projects_from_portfolio";

function bodyOf(fnName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fnName}(`);
  assert(start > -1, `${fnName} must be redefined`);
  const rest = sql.slice(start + 10);
  const nextIdx = rest.indexOf("CREATE OR REPLACE FUNCTION ");
  return nextIdx === -1 ? sql.slice(start) : sql.slice(start, start + 10 + nextIdx);
}

Deno.test("12E.6: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12E.6: exactly the three listed RPCs are redefined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    `CREATE OR REPLACE FUNCTION ${FN_CANDIDATES}`,
    `CREATE OR REPLACE FUNCTION ${FN_ASSIGN}`,
    `CREATE OR REPLACE FUNCTION ${FN_REMOVE}`,
  ]);
});

Deno.test("12E.6: signatures remain unchanged", () => {
  assert(
    sql.includes(
      `CREATE OR REPLACE FUNCTION ${FN_CANDIDATES}(_portfolio_item_id uuid, _workspace_ids uuid[] DEFAULT NULL::uuid[], _search text DEFAULT NULL::text, _include_archived boolean DEFAULT false)`,
    ),
  );
  assert(
    sql.includes(
      `CREATE OR REPLACE FUNCTION ${FN_ASSIGN}(_portfolio_item_id uuid, _project_ids uuid[])`,
    ),
  );
  assert(
    sql.includes(
      `CREATE OR REPLACE FUNCTION ${FN_REMOVE}(_portfolio_item_id uuid, _project_ids uuid[])`,
    ),
  );
  const returns = sql.match(/RETURNS jsonb/g) ?? [];
  assertEquals(returns.length, 3);
});

Deno.test("12E.6: candidate RPC remains STABLE SECURITY DEFINER with pinned search_path", () => {
  const body = bodyOf(FN_CANDIDATES);
  assert(/STABLE SECURITY DEFINER/.test(body));
  assert(body.includes("SET search_path TO 'public'"));
});

Deno.test("12E.6: both mutation RPCs remain SECURITY DEFINER with existing volatility", () => {
  for (const fn of [FN_ASSIGN, FN_REMOVE]) {
    const body = bodyOf(fn);
    assert(/\bSECURITY DEFINER\b/.test(body), `${fn} must stay SECURITY DEFINER`);
    assert(!/\b(STABLE|IMMUTABLE)\b/.test(body), `${fn} must remain volatile`);
    assert(body.includes("SET search_path TO 'public'"));
  }
});

Deno.test("12E.6: each function derives the signed client id and fails closed", () => {
  for (const fn of [FN_CANDIDATES, FN_ASSIGN, FN_REMOVE]) {
    const body = bodyOf(fn);
    assert(body.includes("v_client_id := api_e_private.jwt_client_id();"), fn);
    assert(
      /EXCEPTION WHEN OTHERS THEN\s*v_client_id := 'unresolved_client';/.test(body),
      `${fn} must fail closed on resolution failure`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';\s*END IF;/
        .test(body),
      `${fn} must deny any non-null client id`,
    );
  }
  const denials = sql.match(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/g) ?? [];
  assertEquals(denials.length, 3, "exactly one bounded generic denial per function");
});

Deno.test("12E.6: no trusted-context exception exists", () => {
  for (
    const forbidden of [
      "assert_trusted_context",
      "api_e.api_version",
      "api_e.capability_kind",
      "api_e.capability_key",
      "api_e.source_channel",
      "api_e.organization_id",
      "api_e.workspace_id",
      "external_api",
      "btpm_ui",
      "api_capability_catalogue",
      "api_capability_grants",
      "api_idempotency_registry",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not reference ${forbidden}`);
  }
  assert(!/portfolios:(assign_project|create|update|archive)/.test(sql));
});

Deno.test("12E.6: denial precedes all business logic in every function", () => {
  for (const fn of [FN_CANDIDATES, FN_ASSIGN, FN_REMOVE]) {
    const body = bodyOf(fn);
    const guard = body.indexOf("USING ERRCODE = '42501'");
    assert(guard > -1, fn);
    const later = [
      body.indexOf("RAISE EXCEPTION 'Not authenticated'"),
      body.indexOf("public.is_active_user(_uid)"),
      body.indexOf("FROM public.portfolio_items WHERE id = _portfolio_item_id"),
      body.indexOf("public.is_org_admin(_uid, _org)"),
      body.indexOf("public.log_activity_event"),
    ].filter((idx) => idx > -1);
    assert(later.length >= 4, `${fn}: business logic anchors must be present`);
    for (const idx of later) {
      assert(idx > guard, `${fn}: containment must precede all business logic`);
    }

  }
});

Deno.test("12E.6: denial precedes decryption in the candidate RPC", () => {
  const body = bodyOf(FN_CANDIDATES);
  const guard = body.indexOf("USING ERRCODE = '42501'");
  const decrypt = body.indexOf("public.btpm_decrypt(");
  const projects = body.indexOf("FROM public.projects p");
  const workspaces = body.indexOf("JOIN public.workspaces w");
  assert(decrypt > guard);
  assert(projects > guard);
  assert(workspaces > guard);
});

Deno.test("12E.6: denial precedes UPDATE in both mutation RPCs", () => {
  for (const fn of [FN_ASSIGN, FN_REMOVE]) {
    const body = bodyOf(fn);
    const guard = body.indexOf("USING ERRCODE = '42501'");
    const update = body.indexOf("UPDATE public.projects");
    const lookup = body.indexOf("FROM public.projects p");
    assert(update > guard, `${fn}: write must follow containment`);
    assert(lookup > guard, `${fn}: project lookup must follow containment`);
    const updates = body.match(/UPDATE public\.projects/g) ?? [];
    assertEquals(updates.length, 1, `${fn}: exactly one narrow UPDATE`);
  }
});

Deno.test("12E.6: candidate response and filter semantics remain present", () => {
  const body = bodyOf(FN_CANDIDATES);
  for (
    const fragment of [
      "_q := NULLIF(btrim(COALESCE(_search, '')), '')",
      "(_include_archived OR p.is_archived = false)",
      "p.workspace_id = ANY(_workspace_ids)",
      "p.portfolio_item_id IS DISTINCT FROM _portfolio_item_id",
      "p.organization_id = _org",
      "AS project_name",
      "w.name AS workspace_name",
      "AS program_name",
      "AS current_portfolio_item_id",
      "AS current_portfolio_name",
      "AS current_portfolio_code",
      "'unassigned'",
      "'assigned_to_current'",
      "'assigned_to_other'",
      "AS assignment_state",
      "ORDER BY t.project_name",
    ]
  ) {
    assert(body.includes(fragment), `candidate RPC must retain: ${fragment}`);
  }
});

Deno.test("12E.6: bulk-assign counters, skip and reassign behavior remain present", () => {
  const body = bodyOf(FN_ASSIGN);
  for (
    const fragment of [
      "RAISE EXCEPTION 'At least one project must be selected'",
      "RAISE EXCEPTION 'Portfolio item not found'",
      "is archived and cannot receive new assignments",
      "belongs to a different organization",
      "_skipped := _skipped + 1;",
      "_assigned := _assigned + 1;",
      "_reassigned := _reassigned + 1;",
      "_affected := _affected || _rec.id;",
      "'assigned_count', _assigned",
      "'reassigned_count', _reassigned",
      "'skipped_count', _skipped",
      "'affected_project_ids', to_jsonb(_affected)",
      "SET portfolio_item_id = _portfolio_item_id",
    ]
  ) {
    assert(body.includes(fragment), `bulk-assign must retain: ${fragment}`);
  }
});

Deno.test("12E.6: bulk-remove counters and skip behavior remain present", () => {
  const body = bodyOf(FN_REMOVE);
  for (
    const fragment of [
      "RAISE EXCEPTION 'At least one project must be selected'",
      "RAISE EXCEPTION 'Portfolio item not found'",
      "_rec.current_pi IS DISTINCT FROM _portfolio_item_id",
      "_skipped := _skipped + 1;",
      "_removed := _removed + 1;",
      "'removed_count', _removed",
      "'skipped_count', _skipped",
      "'affected_project_ids', to_jsonb(_affected)",
      "SET portfolio_item_id = NULL",
    ]
  ) {
    assert(body.includes(fragment), `bulk-remove must retain: ${fragment}`);
  }
  assert(!body.includes("is archived and cannot receive new assignments"));
});

Deno.test("12E.6: activity logging and source metadata remain unchanged", () => {
  for (const fn of [FN_ASSIGN, FN_REMOVE]) {
    const body = bodyOf(fn);
    assert(
      /public\.log_activity_event\([\s\S]{0,120}'project_portfolio_changed', 'project', _rec\.id/
        .test(body),
      `${fn}: canonical activity event must remain`,
    );
    assert(body.includes("'source', 'admin_portfolio_manage'"), fn);
    assert(body.includes("'old_portfolio_item_id'"), fn);
    assert(body.includes("'new_portfolio_item_id'"), fn);
  }
  const logs = sql.match(/public\.log_activity_event\(/g) ?? [];
  assertEquals(logs.length, 2, "only the two mutation RPCs log");
});

Deno.test("12E.6: accepted external assignment architecture is untouched", () => {
  for (
    const forbidden of [
      "assign_project_portfolio",
      "api_v1_assign_project_portfolio",
      "mcp_v1_assign_project_portfolio",
      "execute_v1_assign_project_portfolio",
      "api_v1_list_portfolios",
      "api_v1_get_portfolio",
      "mcp_v1_",
      "api_e_private.execute_v1_",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12E.6: other Portfolio master, picker, summary and Team surfaces are untouched", () => {
  for (
    const forbidden of [
      "admin_create_portfolio_item",
      "admin_update_portfolio_item",
      "admin_archive_portfolio_item",
      "admin_list_portfolio_items",
      "get_portfolio_item_project_membership_summary",
      "portfolio_item_team_members",
      "admin_add_portfolio_team_member",
      "admin_update_portfolio_team_member",
      "admin_remove_portfolio_team_member",
      "admin_list_portfolio_team_members",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12E.6: no RLS, grant, schema or encryption change occurs", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP TABLE",
      "CREATE TRIGGER",
      "DROP TRIGGER",
      "DROP FUNCTION",
      "GRANT ",
      "REVOKE ",
      "ROW LEVEL SECURITY",
      "CREATE OR REPLACE FUNCTION public.btpm_encrypt",
      "CREATE OR REPLACE FUNCTION public.btpm_decrypt",
      "pgp_sym_encrypt",
      "pgp_sym_decrypt",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

Deno.test("12E.6: no migration-time business-data DML or backfill occurs", () => {
  // The only DML text permitted is inside the preserved function bodies.
  const perFn = [FN_CANDIDATES, FN_ASSIGN, FN_REMOVE].map(bodyOf).join("");
  assertEquals(perFn.length > 0, true);
  const outside = sql.split("CREATE OR REPLACE FUNCTION")[0];
  for (const forbidden of ["INSERT INTO", "UPDATE ", "DELETE FROM", "MERGE "]) {
    assert(!outside.includes(forbidden), `no migration-time ${forbidden}`);
  }
  const inserts = sql.match(/INSERT INTO/g) ?? [];
  assertEquals(inserts.length, 0, "no INSERT anywhere in this migration");
  const deletes = sql.match(/DELETE FROM/g) ?? [];
  assertEquals(deletes.length, 0, "no DELETE anywhere in this migration");
});

Deno.test("12E.6: frontend still calls the three canonical Admin RPCs unchanged", async () => {
  const hook = await Deno.readTextFile(
    new URL(
      "../../../src/hooks/useAdminPortfolioProjectAssignments.ts",
      import.meta.url,
    ),
  );
  assert(hook.includes('"admin_list_portfolio_project_assignment_candidates"'));
  assert(hook.includes('supabase.rpc("admin_assign_projects_to_portfolio"'));
  assert(hook.includes('supabase.rpc("admin_remove_projects_from_portfolio"'));
  assert(
    !hook.includes("api_e.source_channel") && !hook.includes("capability_key"),
    "frontend must not supply trusted-context values",
  );
});
