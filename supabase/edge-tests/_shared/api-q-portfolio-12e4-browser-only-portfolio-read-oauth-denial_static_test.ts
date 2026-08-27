// API-Q Portfolio-12E.4 — Browser-Only Portfolio Read RPC Signed External-OAuth
// Denial (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the four redefined browser-only Portfolio read RPCs.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12E.4 — Browser-Only Portfolio Read RPC Signed External-OAuth Denial";

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

const RPCS = [
  "public.admin_list_portfolio_items",
  "public.list_active_portfolio_items_for_workspace_picker",
  "public.list_active_portfolio_items_for_project_picker",
  "public.get_portfolio_item_project_membership_summary",
] as const;

/** Executable body of one redefined function (from its CREATE to the next, or EOF). */
function bodyOf(fn: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
  assert(start > -1, `${fn} must be redefined`);
  const rest = sql.slice(start + 10);
  const nextRel = rest.indexOf("CREATE OR REPLACE FUNCTION ");
  return nextRel === -1 ? sql.slice(start) : sql.slice(start, start + 10 + nextRel);
}

Deno.test("12E.4: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12E.4: exactly the four browser-only read RPCs are redefined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace("CREATE OR REPLACE FUNCTION ", ""));
  assertEquals(created.sort(), [...RPCS].sort());
});

Deno.test("12E.4: signatures and return types are unchanged", () => {
  assert(
    sql.includes(
      "public.admin_list_portfolio_items(_organization_id uuid, _include_archived boolean DEFAULT true)",
    ),
  );
  assert(
    sql.includes("public.list_active_portfolio_items_for_workspace_picker(_workspace_id uuid)"),
  );
  assert(
    sql.includes("public.list_active_portfolio_items_for_project_picker(_project_id uuid)"),
  );
  assert(
    sql.includes(
      "public.get_portfolio_item_project_membership_summary(_portfolio_item_id uuid, _include_archived_projects boolean DEFAULT true)",
    ),
  );
  const returns = sql.match(/RETURNS jsonb/g) ?? [];
  assertEquals(returns.length, 4);
});

Deno.test("12E.4: all four remain STABLE SECURITY DEFINER with pinned search_path", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(/STABLE SECURITY DEFINER/.test(body), `${fn} must stay STABLE SECURITY DEFINER`);
    assert(/SET search_path TO 'public'/.test(body), `${fn} must pin search_path`);
    assert(/LANGUAGE plpgsql/.test(body), `${fn} must stay plpgsql`);
  }
});

Deno.test("12E.4: every RPC derives identity via api_e_private.jwt_client_id()", () => {
  for (const fn of RPCS) {
    assert(
      bodyOf(fn).includes("v_client_id := api_e_private.jwt_client_id();"),
      `${fn} must derive the signed client id`,
    );
  }
});

Deno.test("12E.4: jwt_client_id resolution failure fails closed", () => {
  for (const fn of RPCS) {
    assert(
      /EXCEPTION WHEN OTHERS THEN\s*v_client_id := 'unresolved_client';/.test(bodyOf(fn)),
      `${fn} must fail closed on resolution failure`,
    );
  }
});

Deno.test("12E.4: every non-null client id raises exactly 'Not authorized' / 42501", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(
      /IF v_client_id IS NOT NULL THEN\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';\s*END IF;/
        .test(body),
      `${fn} must deny any non-null client id`,
    );
    const denials = body.match(/USING ERRCODE = '42501'/g) ?? [];
    assertEquals(denials.length, 1, `${fn} must have exactly one bounded external denial`);
  }
});

Deno.test("12E.4: no trusted-context exception exists", () => {
  for (
    const forbidden of [
      "assert_trusted_context",
      "api_e.api_version",
      "api_e.capability_key",
      "api_e.capability_kind",
      "api_e.source_channel",
      "api_e.organization_id",
      "api_e.workspace_id",
      "external_api",
      "btpm_ui",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not introduce ${forbidden}`);
  }
  assert(!/portfolios:(read|list|get)/.test(sql), "no capability key checks");
});

Deno.test("12E.4: denial precedes auth, authority, lookups and decryption", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    const guard = body.indexOf("USING ERRCODE = '42501'");
    assert(guard > -1);
    const later = [
      body.indexOf("RAISE EXCEPTION 'Not authenticated'"),
      body.indexOf("public.is_active_user(_uid)"),
      body.indexOf("public.btpm_decrypt("),
      body.indexOf("SELECT COALESCE(jsonb_agg("),
    ];
    for (const idx of later) {
      assert(idx > guard, `${fn}: denial must precede all business logic`);
    }
  }
});

Deno.test("12E.4: admin_list browser semantics and response shape remain", () => {
  const body = bodyOf("public.admin_list_portfolio_items");
  assert(body.includes("public.is_org_admin(_uid, _organization_id)"));
  assert(body.includes("(_include_archived OR pi.is_archived = false)"));
  for (
    const f of [
      "AS name",
      "AS code",
      "AS description",
      "pi.lifecycle_state",
      "pi.strategic_priority",
      "pi.owner_id",
      "pi.is_archived",
      "pi.archived_at",
      "pi.created_by",
      "pi.updated_by",
      "AS project_count",
      "AS active_project_count",
      "AS workspace_count",
      "AS active_team_member_count",
      "ORDER BY t.name_sort",
    ]
  ) {
    assert(body.includes(f), `admin_list must preserve ${f}`);
  }
  assert(body.includes("count(DISTINCT p.workspace_id)"));
  assert(body.includes("tm.is_active = true"));
});

Deno.test("12E.4: workspace picker authority and filter semantics remain", () => {
  const body = bodyOf("public.list_active_portfolio_items_for_workspace_picker");
  assert(body.includes("SELECT organization_id INTO _org FROM public.workspaces"));
  assert(body.includes("RAISE EXCEPTION 'Workspace not found'"));
  assert(
    body.includes("public.has_pm_authority(_uid, _workspace_id) OR public.is_org_admin(_uid, _org)"),
  );
  assert(body.includes("pi.organization_id = _org"));
  assert(body.includes("pi.is_archived = false"));
  assert(body.includes("public.btpm_decrypt(pi.name, pi.organization_id) AS name"));
  assert(body.includes("public.btpm_decrypt(pi.code, pi.organization_id) AS code"));
});

Deno.test("12E.4: project picker authority and filter semantics remain", () => {
  const body = bodyOf("public.list_active_portfolio_items_for_project_picker");
  assert(body.includes("public.has_project_pm_authority(_uid, _project_id)"));
  assert(body.includes("SELECT organization_id INTO _org FROM public.projects"));
  assert(body.includes("RAISE EXCEPTION 'Project not found'"));
  assert(body.includes("pi.organization_id = _org"));
  assert(body.includes("pi.is_archived = false"));
  assert(body.includes("public.btpm_decrypt(pi.code, pi.organization_id) AS code"));
});

Deno.test("12E.4: membership summary authority and result semantics remain", () => {
  const body = bodyOf("public.get_portfolio_item_project_membership_summary");
  assert(body.includes("SELECT organization_id INTO _org FROM public.portfolio_items"));
  assert(body.includes("RAISE EXCEPTION 'Portfolio item not found'"));
  assert(body.includes("public.is_org_admin(_uid, _org)"));
  assert(body.includes("(_include_archived_projects OR p.is_archived = false)"));
  for (
    const f of [
      "AS project_id",
      "AS project_name",
      "p.workspace_id",
      "w.name AS workspace_name",
      "p.program_id",
      "AS program_name",
      "p.status",
      "p.priority",
      "p.project_stage",
      "p.delivery_model",
      "p.start_date",
      "p.target_end_date",
      "ORDER BY t.project_name",
    ]
  ) {
    assert(body.includes(f), `membership summary must preserve ${f}`);
  }
  assert(body.includes("JOIN public.workspaces w ON w.id = p.workspace_id"));
});

Deno.test("12E.4: external api_v1 Portfolio wrappers are not redefined", () => {
  assert(!sql.includes("api_v1_list_portfolios"));
  assert(!sql.includes("api_v1_get_portfolio"));
  assert(!sql.includes("api_e_private.execute_v1_"));
  assert(!sql.includes("mcp_v1_"));
});

Deno.test("12E.4: other Portfolio surfaces are untouched", () => {
  for (
    const forbidden of [
      "admin_create_portfolio_item",
      "admin_update_portfolio_item",
      "admin_archive_portfolio_item",
      "assign_project_portfolio",
      "admin_assign_projects_to_portfolio",
      "admin_list_portfolio_team_members",
      "admin_add_portfolio_team_member",
      "admin_update_portfolio_team_member_role",
      "admin_remove_portfolio_team_member",
      "trg_portfolio_items_assert_organization_immutable",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
});

Deno.test("12E.4: no capability, catalogue or Connected App changes occur", () => {
  for (
    const forbidden of [
      "api_capability_catalogue",
      "api_capability_grants",
      "api_idempotency_registry",
      "api_client",
      "connected_app",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
});

Deno.test("12E.4: no RLS, policy, grant or table changes occur", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP TABLE",
      "ROW LEVEL SECURITY",
      "GRANT ",
      "REVOKE ",
      "DROP FUNCTION",
      "CREATE TRIGGER",
      "DROP TRIGGER",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
});

Deno.test("12E.4: no encryption helper or trigger changes occur", () => {
  assert(!/CREATE OR REPLACE FUNCTION [a-z_.]*btpm_(en|de)crypt/.test(sql));
  assert(!sql.includes("pgp_sym_encrypt"));
  assert(!sql.includes("pgp_sym_decrypt"));
  assert(!sql.includes("portfolio_items_encrypt_fields"));
});

Deno.test("12E.4: no business-data DML or backfill occurs", () => {
  for (const forbidden of ["INSERT INTO", "DELETE FROM", "TRUNCATE", "MERGE INTO"]) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
  assert(!/\bUPDATE public\./.test(sql), "must not contain any UPDATE of business data");
});
