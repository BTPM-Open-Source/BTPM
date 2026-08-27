// Portfolio-12E.2 — Portfolio Team add/reactivate canonical Organization
// membership alignment. Focused static contract test over the forward-only migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260819105426_9a396452-3a0f-4128-a65e-c2a4b30291db.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
const lower = sql.toLowerCase();
// SQL with `--` comments stripped (comment prose must not satisfy assertions).
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();

const idx = (re: RegExp) => code.search(re);

const DENIAL = /RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'/i;
const MEMBERSHIP = /IF public\.is_user_org_member\(_user_id, _org\) IS NOT TRUE THEN/i;
const ACTIVATION = /IF NOT COALESCE\(_user_active, false\) THEN RAISE EXCEPTION 'User is deactivated'; END IF;/i;
const EXISTING_LOOKUP = /FROM public\.portfolio_item_team_members/i;
const REACTIVATE_UPDATE = /UPDATE public\.portfolio_item_team_members\s*\n\s*SET is_active = true/i;
const INSERT_ROW = /INSERT INTO public\.portfolio_item_team_members/i;
const ACTIVITY = /log_activity_event/i;

Deno.test("1. admin_add_portfolio_team_member signature is unchanged", () => {
  assert(
    codeLower.includes(
      "create or replace function public.admin_add_portfolio_team_member(_portfolio_item_id uuid, _user_id uuid, _role text)",
    ),
  );
  assert(/RETURNS uuid/i.test(code));
  assert(/SECURITY DEFINER/i.test(code));
  assert(/SET search_path TO 'public'/i.test(code));
  assertEquals(/drop function/i.test(code), false);
});

Deno.test("2. 12E.1 external-OAuth denial intact and precedes business lookups", () => {
  assert(/v_client_id\s*:=\s*api_e_private\.jwt_client_id\(\)/i.test(code));
  assert(/EXCEPTION WHEN OTHERS THEN\s*v_client_id\s*:=\s*'unresolved_client';/i.test(code));
  assert(DENIAL.test(code));
  assertEquals(codeLower.includes("assert_trusted_context"), false);
  const d = idx(DENIAL);
  for (
    const after of [
      /FROM public\.portfolio_items\b/i,
      /is_org_admin/i,
      /FROM public\.profiles/i,
      MEMBERSHIP,
      EXISTING_LOOKUP,
      INSERT_ROW,
      ACTIVITY,
    ]
  ) {
    const i = idx(after);
    if (i >= 0) assert(d < i, `denial must precede ${after}`);
  }
});

Deno.test("3. eligibility calls exactly public.is_user_org_member(_user_id, _org)", () => {
  const matches = code.match(/public\.is_user_org_member\([^)]*\)/gi) ?? [];
  assertEquals(matches.length, 1);
  assertEquals(matches[0], "public.is_user_org_member(_user_id, _org)");
  assert(MEMBERSHIP.test(code));
  assert(/RAISE EXCEPTION 'User must belong to the same organization'/i.test(code));
});

Deno.test("4. profiles.organization_id is no longer Team membership authority", () => {
  // legacy variable `_user_org` is gone (must not match `is_user_org_member`)
  assertEquals(/_user_org(?![_a-z])/i.test(code), false);
  assertEquals(/organization_id[\s\S]{0,40}INTO[\s\S]{0,60}FROM public\.profiles/i.test(code), false);
  const profileSelect = code.match(/SELECT[^;]*FROM public\.profiles WHERE id = _user_id;/i);
  assert(profileSelect, "target profile select must exist");
  assertEquals(/organization_id/i.test(profileSelect![0]), false);
});

Deno.test("5. target profile activation/deactivation check remains", () => {
  assert(/is_active INTO _user_exists, _user_active/i.test(code));
  assert(ACTIVATION.test(code));
  assert(/RAISE EXCEPTION 'User not found'/i.test(code));
});

Deno.test("6. inactive/removed canonical membership cannot be resurrected by profile pointer", () => {
  // No local profile-organization comparison exists to override the helper verdict.
  assertEquals(/p?\.?organization_id\s*(=|IS DISTINCT FROM)\s*_org/i.test(code), false);
  assertEquals(codeLower.includes("organization_memberships"), false);
  assertEquals(codeLower.includes("tenant_memberships"), false);
});

Deno.test("7. active canonical member with different legacy profile org is not locally rejected", () => {
  assertEquals(/IS DISTINCT FROM _org/i.test(code), false);
  // Membership decision is delegated entirely to the canonical helper.
  const gate = code.match(/IF public\.is_user_org_member\([\s\S]*?END IF;/i);
  assert(gate);
  assertEquals(/profiles/i.test(gate![0]), false);
});

Deno.test("8. tenant membership semantics inherited from the canonical helper only", () => {
  assertEquals(/create or replace function public\.(is_user_org_member|is_org_member|is_active_user)/i.test(code), false);
});

Deno.test("9. membership validation occurs before existing-Team-row lookup", () => {
  assert(idx(MEMBERSHIP) < idx(EXISTING_LOOKUP));
  assert(idx(ACTIVATION) < idx(EXISTING_LOOKUP));
});

Deno.test("10. membership validation occurs before reactivation UPDATE", () => {
  assert(idx(REACTIVATE_UPDATE) > 0);
  assert(idx(MEMBERSHIP) < idx(REACTIVATE_UPDATE));
  assert(idx(ACTIVATION) < idx(REACTIVATE_UPDATE));
});

Deno.test("11. membership validation occurs before new INSERT and activity event", () => {
  assert(idx(MEMBERSHIP) < idx(INSERT_ROW));
  assert(idx(ACTIVATION) < idx(INSERT_ROW));
  assert(idx(MEMBERSHIP) < idx(ACTIVITY));
});

Deno.test("12. role validation and role values unchanged", () => {
  for (
    const r of [
      "product_manager",
      "commercial_lead",
      "finance_partner",
      "supply_lead",
      "regulatory_lead",
      "quality_lead",
      "tech_services_lead",
      "launch_lead",
      "bd_lead",
      "srm_lead",
      "other",
    ]
  ) {
    assert(code.includes(`'${r}'`), r);
  }
  assert(/RAISE EXCEPTION 'Invalid role'/i.test(code));
});

Deno.test("13. add/reactivate/activity-event semantics unchanged", () => {
  assert(/IF _existing_active THEN\s*\n?\s*RETURN _existing_id;/i.test(code));
  assert(/SET is_active = true, updated_by = _uid/i.test(code));
  assert(/'reactivated', true/i.test(code));
  assert(/'portfolio_team_member_added'/i.test(code));
  assert(/ORDER BY is_active DESC, updated_at DESC/i.test(code));
  assert(/is_active_user\(_uid\)/i.test(code));
  assert(/is_org_admin\(_uid, _org\)/i.test(code));
  assert(/RAISE EXCEPTION 'Portfolio item not found'/i.test(code));
});

Deno.test("14. other three Team RPCs are not redefined", () => {
  for (
    const n of [
      "admin_list_portfolio_team_members",
      "admin_update_portfolio_team_member_role",
      "admin_remove_portfolio_team_member",
    ]
  ) {
    assertEquals(codeLower.includes(n), false, n);
  }
  assertEquals((code.match(/create or replace function/gi) ?? []).length, 1);
});

Deno.test("15. 12E.1 restrictive RLS policies are not modified", () => {
  assertEquals(/create policy|alter policy|drop policy/i.test(code), false);
  assertEquals(/row level security/i.test(code), false);
  assertEquals(codeLower.includes("portfolio_team_external_oauth_denial"), false);
});

Deno.test("16. no API/MCP/capability/frontend change introduced", () => {
  for (
    const forbidden of [
      "api_capability_catalogue",
      "api_capability_grants",
      "api_e_private.execute_",
      "api_v1_",
      "mcp",
      "idempotency",
      "grant ",
      "revoke ",
    ]
  ) {
    assertEquals(codeLower.includes(forbidden), false, forbidden);
  }
});

Deno.test("17. no encryption logic changed", () => {
  assertEquals(/btpm_encrypt|btpm_decrypt|tenant_encryption/i.test(code), false);
});

Deno.test("18. no schema change and no business-data backfill", () => {
  assertEquals(/alter table|create table|drop table/i.test(code), false);
  const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assertEquals(/insert\s+into|update\s+public\.|delete\s+from/i.test(topLevel), false);
  // Only the two in-function writes on the Team table remain.
  assertEquals((code.match(/INSERT INTO public\./gi) ?? []).length, 1);
});
