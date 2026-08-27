// Portfolio-12E.1 — Portfolio Team signed external-OAuth denial closure.
// Focused static contract test over the forward-only migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  new URL(
    "../../migrations/20260819104519_6c9cd889-1785-4320-96ba-9fbad6d016a6.sql",
    import.meta.url,
  ).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
const lower = sql.toLowerCase();
// SQL with `--` comments stripped (comment prose must not satisfy assertions).
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();
// Top-level SQL only: function bodies removed.
const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");

const RPCS = [
  "admin_list_portfolio_team_members",
  "admin_add_portfolio_team_member",
  "admin_update_portfolio_team_member_role",
  "admin_remove_portfolio_team_member",
];

function policyBlock(name: string): string {
  const start = lower.indexOf(`create policy ${name}`);
  assert(start >= 0, `policy ${name} not created`);
  const end = lower.indexOf(";", start);
  return sql.slice(start, end);
}

function functionBody(name: string): string {
  const start = lower.indexOf(`create or replace function public.${name}(`);
  assert(start >= 0, `function ${name} not redefined`);
  const next = RPCS
    .map((n) => lower.indexOf(`create or replace function public.${n}(`))
    .filter((i) => i > start)
    .sort((a, b) => a - b)[0] ?? sql.length;
  return sql.slice(start, next);
}

Deno.test("1. restrictive SELECT containment exists on portfolio_item_team_members", () => {
  const p = policyBlock("portfolio_team_external_oauth_denial_select");
  assert(/AS RESTRICTIVE/i.test(p));
  assert(/FOR SELECT/i.test(p));
  assert(/ON public\.portfolio_item_team_members/i.test(p));
});

Deno.test("2. restrictive INSERT containment exists", () => {
  const p = policyBlock("portfolio_team_external_oauth_denial_insert");
  assert(/AS RESTRICTIVE/i.test(p));
  assert(/FOR INSERT/i.test(p));
  assert(/WITH CHECK \(api_e_private\.jwt_client_id\(\) IS NULL\)/i.test(p));
});

Deno.test("3. restrictive UPDATE containment exists", () => {
  const p = policyBlock("portfolio_team_external_oauth_denial_update");
  assert(/AS RESTRICTIVE/i.test(p));
  assert(/FOR UPDATE/i.test(p));
  assert(/USING \(api_e_private\.jwt_client_id\(\) IS NULL\)/i.test(p));
  assert(/WITH CHECK \(api_e_private\.jwt_client_id\(\) IS NULL\)/i.test(p));
});

Deno.test("4. all containment policies require jwt_client_id() IS NULL", () => {
  for (
    const n of [
      "portfolio_team_external_oauth_denial_select",
      "portfolio_team_external_oauth_denial_insert",
      "portfolio_team_external_oauth_denial_update",
    ]
  ) {
    const p = policyBlock(n);
    assert(/api_e_private\.jwt_client_id\(\) IS NULL/i.test(p), n);
    assert(/TO authenticated/i.test(p), n);
  }
});

Deno.test("5. no assert_trusted_context() exception anywhere in the migration", () => {
  assertEquals(codeLower.includes("assert_trusted_context"), false);
});

Deno.test("6. existing ordinary Org Admin RLS is not replaced or weakened", () => {
  for (
    const n of [
      "portfolio_item_team_members_admin_select",
      "portfolio_item_team_members_admin_insert",
      "portfolio_item_team_members_admin_update",
    ]
  ) {
    assertEquals(lower.includes(n), false);
  }
  assertEquals(/alter\s+policy/i.test(sql), false);
});

Deno.test("7. no authenticated DELETE access introduced, no grant changes", () => {
  assertEquals(/for\s+delete/i.test(sql), false);
  assertEquals(/^\s*grant\s/im.test(sql), false);
  assertEquals(/^\s*revoke\s/im.test(sql), false);
});

Deno.test("8. all four Team RPCs perform external-OAuth denial", () => {
  for (const n of RPCS) {
    const body = functionBody(n);
    assert(
      /v_client_id\s*:=\s*api_e_private\.jwt_client_id\(\)/i.test(body),
      n,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/i
        .test(body),
      n,
    );
  }
});

Deno.test("9. denial occurs before any lookup / authorization / business logic", () => {
  for (const n of RPCS) {
    const body = functionBody(n);
    const denial = body.search(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'/i);
    const markers = [
      /FROM public\.portfolio_items\b/i,
      /FROM public\.portfolio_item_team_members\b/i,
      /is_org_admin/i,
      /is_active_user/i,
      /btpm_decrypt/i,
      /log_activity_event/i,
      /INSERT INTO/i,
      /UPDATE public\./i,
    ];
    for (const m of markers) {
      const idx = body.search(m);
      if (idx >= 0) assert(denial < idx, `${n}: denial must precede ${m}`);
    }
  }
});

Deno.test("10. client-id resolution failure fails closed", () => {
  for (const n of RPCS) {
    const body = functionBody(n);
    assert(
      /EXCEPTION WHEN OTHERS THEN\s*v_client_id\s*:=\s*'unresolved_client';/i.test(body),
      n,
    );
  }
});

Deno.test("11. denial is generic 'Not authorized' with SQLSTATE 42501", () => {
  const matches = code.match(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'/gi) ?? [];
  assertEquals(matches.length, 4);
  assertEquals(/client_id.*not allowed|external oauth.*denied/i.test(code), false);
});

Deno.test("12. browser-session business logic remains present", () => {
  const list = functionBody("admin_list_portfolio_team_members");
  assert(/btpm_decrypt\(p\.display_name, p\.organization_id\)/i.test(list));
  assert(/tm\.is_active = true/i.test(list));

  const add = functionBody("admin_add_portfolio_team_member");
  assert(/reactivated/i.test(add));
  assert(/User must belong to the same organization/i.test(add));
  assert(/User is deactivated/i.test(add));

  const upd = functionBody("admin_update_portfolio_team_member_role");
  assert(/This user already has that role on this Portfolio/i.test(upd));
  assert(/portfolio_team_member_role_changed/i.test(upd));

  const rem = functionBody("admin_remove_portfolio_team_member");
  assert(/SET is_active = false/i.test(rem));
  assert(/portfolio_team_member_removed/i.test(rem));

  for (const n of RPCS) {
    const body = functionBody(n);
    assert(/is_org_admin\(_uid/i.test(body), n);
    assert(/is_active_user\(_uid\)/i.test(body), n);
  }
});

Deno.test("13. Team RPC signatures remain unchanged", () => {
  assert(
    lower.includes("public.admin_list_portfolio_team_members(_portfolio_item_id uuid)"),
  );
  assert(
    lower.includes(
      "public.admin_add_portfolio_team_member(_portfolio_item_id uuid, _user_id uuid, _role text)",
    ),
  );
  assert(
    lower.includes(
      "public.admin_update_portfolio_team_member_role(_team_member_id uuid, _role text)",
    ),
  );
  assert(
    lower.includes("public.admin_remove_portfolio_team_member(_team_member_id uuid)"),
  );
});

Deno.test("14. function grants remain browser-compatible (SECURITY DEFINER, fixed search_path)", () => {
  for (const n of RPCS) {
    const body = functionBody(n);
    assert(/SECURITY DEFINER/i.test(body), n);
    assert(/SET search_path TO 'public'/i.test(body), n);
    assert(!/DROP FUNCTION/i.test(body), n);
  }
  assertEquals(/drop function/i.test(sql), false);
});

Deno.test("15. no external REST/MCP/capability surface added", () => {
  for (
    const forbidden of [
      "api_capability_catalogue",
      "api_capability_grants",
      "api_e_private.execute_",
      "api_v1_",
      "mcp",
      "idempotency",
    ]
  ) {
    assertEquals(lower.includes(forbidden), false, forbidden);
  }
});

Deno.test("16. no encryption logic changed", () => {
  assertEquals(/create or replace function public\.btpm_(encrypt|decrypt)/i.test(sql), false);
  assertEquals(/tenant_encryption/i.test(lower), false);
});

Deno.test("17. no Team membership-validation correction introduced (reserved for 12E.2)", () => {
  const add = functionBody("admin_add_portfolio_team_member");
  assert(
    /SELECT organization_id, is_active INTO _user_org, _user_active FROM public\.profiles WHERE id = _user_id;/i
      .test(add),
  );
  assertEquals(lower.includes("is_user_org_member"), false);
  assertEquals(lower.includes("organization_memberships"), false);
});

Deno.test("18. no schema-column change and no business-data DML/backfill", () => {
  assertEquals(/alter table/i.test(code), false);
  assertEquals(/insert\s+into|update\s+public\.|delete\s+from/i.test(topLevel), false);
});
