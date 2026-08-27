// Portfolio-12E.3 — Portfolio Team direct-mutation closure and row-scope
// structural integrity. Focused static contract test over the forward-only migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260819114531_5a90b500-9092-4726-8096-87d4304d1490.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
// `--` comments stripped: comment prose must not satisfy assertions.
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();
const idx = (re: RegExp) => code.search(re);

const fnBody = (() => {
  const start = codeLower.indexOf(
    "create or replace function public.trg_portfolio_item_team_members_assert_row_scope",
  );
  assert(start >= 0, "integrity function must be created");
  const end = code.indexOf("$function$", code.indexOf("$function$", start) + 1);
  return code.slice(start, end);
})();

const insertBranch = (() => {
  const s = fnBody.search(/IF TG_OP = 'INSERT' THEN/);
  const e = fnBody.search(/IF NEW\.portfolio_item_id IS DISTINCT FROM OLD\.portfolio_item_id THEN/);
  assert(s >= 0 && e > s);
  return fnBody.slice(s, e);
})();

const updateBranch = (() => {
  const s = fnBody.search(/IF NEW\.portfolio_item_id IS DISTINCT FROM OLD\.portfolio_item_id THEN/);
  assert(s >= 0);
  return fnBody.slice(s);
})();

Deno.test("1. authenticated INSERT privilege is revoked", () => {
  assert(
    /REVOKE\s+INSERT,\s*UPDATE\s+ON public\.portfolio_item_team_members\s+FROM authenticated;/i
      .test(code),
  );
});

Deno.test("2. authenticated UPDATE privilege is revoked", () => {
  const m = code.match(/REVOKE[^;]*FROM authenticated;/i);
  assert(m);
  assert(/\bUPDATE\b/i.test(m![0]));
});

Deno.test("3. authenticated SELECT is not revoked", () => {
  const revokes = code.match(/REVOKE[^;]*;/gi) ?? [];
  assertEquals(revokes.length, 1);
  assertEquals(/\bSELECT\b/i.test(revokes[0] ?? ""), false);
});

Deno.test("4. service_role grants are not changed", () => {
  assertEquals(/service_role/i.test(code), false);
  assertEquals(/^\s*grant\s/im.test(code), false);
});

Deno.test("5. no DELETE privilege is added and no DELETE revoke/policy", () => {
  assertEquals(/\bDELETE\b/i.test(code), false);
});

Deno.test("6. existing 12E.1 RLS policies are not removed or weakened", () => {
  assertEquals(/create policy|alter policy|drop policy/i.test(code), false);
  assertEquals(/row level security/i.test(code), false);
  assertEquals(codeLower.includes("portfolio_team_external_oauth_denial"), false);
  assertEquals(codeLower.includes("jwt_client_id"), false);
});

Deno.test("7. INSERT trigger targets public.portfolio_item_team_members", () => {
  assert(
    /CREATE TRIGGER portfolio_item_team_members_00_assert_row_scope_insert\s*\n?\s*BEFORE INSERT ON public\.portfolio_item_team_members\s*\n?\s*FOR EACH ROW EXECUTE FUNCTION public\.trg_portfolio_item_team_members_assert_row_scope\(\);/i
      .test(code),
  );
});

Deno.test("8. UPDATE trigger covers portfolio_item_id, organization_id, user_id, is_active", () => {
  const m = code.match(
    /CREATE TRIGGER portfolio_item_team_members_00_assert_row_scope_update[\s\S]*?;/i,
  );
  assert(m);
  const t = m![0];
  assert(/BEFORE UPDATE OF portfolio_item_id, organization_id, user_id, is_active/i.test(t));
  assert(/ON public\.portfolio_item_team_members/i.test(t));
  assert(/FOR EACH ROW EXECUTE FUNCTION public\.trg_portfolio_item_team_members_assert_row_scope\(\)/i.test(t));
  // guard sorts before the generic updated_at trigger
  assert("portfolio_item_team_members_00_assert_row_scope_update" <
    "portfolio_item_team_members_set_updated_at");
  assertEquals(codeLower.includes("update_updated_at_column"), false);
});

Deno.test("9. parent Portfolio organization_id is derived server-side", () => {
  assert(
    /SELECT p\.organization_id, true INTO _parent_org, _parent_found\s*\n\s*FROM public\.portfolio_items p\s*\n\s*WHERE p\.id = NEW\.portfolio_item_id;/i
      .test(insertBranch),
  );
  assert(/portfolio_team_parent_portfolio_not_found/i.test(insertBranch));
});

Deno.test("10. INSERT rejects Team organization_id != parent Portfolio organization_id", () => {
  assert(
    /IF NEW\.organization_id IS DISTINCT FROM _parent_org THEN\s*\n\s*RAISE EXCEPTION 'portfolio_team_organization_mismatch'/i
      .test(insertBranch),
  );
  // mismatch check precedes eligibility work
  assert(idx(/portfolio_team_organization_mismatch/) < idx(/is_user_org_member/));
});

Deno.test("11. portfolio_item_id is immutable on UPDATE", () => {
  assert(
    /IF NEW\.portfolio_item_id IS DISTINCT FROM OLD\.portfolio_item_id THEN\s*\n\s*RAISE EXCEPTION 'portfolio_team_portfolio_item_immutable'/i
      .test(updateBranch),
  );
});

Deno.test("12. organization_id is immutable on UPDATE", () => {
  assert(
    /IF NEW\.organization_id IS DISTINCT FROM OLD\.organization_id THEN\s*\n\s*RAISE EXCEPTION 'portfolio_team_organization_immutable'/i
      .test(updateBranch),
  );
});

Deno.test("13. user_id is immutable on UPDATE", () => {
  assert(
    /IF NEW\.user_id IS DISTINCT FROM OLD\.user_id THEN\s*\n\s*RAISE EXCEPTION 'portfolio_team_user_immutable'/i
      .test(updateBranch),
  );
});

Deno.test("14. active INSERT calls exactly public.is_user_org_member(NEW.user_id, _parent_org)", () => {
  const calls = code.match(/public\.is_user_org_member\([^)]*\)/gi) ?? [];
  assertEquals(calls.length, 2); // insert + reactivation
  for (const c of calls) assertEquals(c, "public.is_user_org_member(NEW.user_id, _parent_org)");
  assert(/IF COALESCE\(NEW\.is_active, false\) THEN/i.test(insertBranch));
  assert(
    /public\.is_user_org_member\(NEW\.user_id, _parent_org\) IS NOT TRUE THEN\s*\n\s*RAISE EXCEPTION 'portfolio_team_member_not_organization_member'/i
      .test(insertBranch),
  );
  // profiles.organization_id is never used as membership authority
  assertEquals(/pr?\.organization_id/i.test(fnBody.replace(/p\.organization_id/g, "")), false);
  assertEquals(/FROM public\.profiles[\s\S]{0,80}organization_id/i.test(fnBody), false);
});

Deno.test("15. active INSERT requires profiles.is_active = true", () => {
  assert(
    /SELECT pr\.is_active INTO _profile_active\s*\n\s*FROM public\.profiles pr\s*\n\s*WHERE pr\.id = NEW\.user_id;/i
      .test(insertBranch),
  );
  assert(/portfolio_team_member_profile_not_found/i.test(insertBranch));
  assert(
    /IF _profile_active IS NOT TRUE THEN\s*\n\s*RAISE EXCEPTION 'portfolio_team_member_profile_inactive'/i
      .test(insertBranch),
  );
});

Deno.test("16. false -> true reactivation repeats the same eligibility checks", () => {
  assert(
    /IF COALESCE\(OLD\.is_active, false\) = false AND COALESCE\(NEW\.is_active, false\) = true THEN/i
      .test(updateBranch),
  );
  assert(/public\.is_user_org_member\(NEW\.user_id, _parent_org\) IS NOT TRUE/i.test(updateBranch));
  assert(/FROM public\.profiles pr/i.test(updateBranch));
  assert(/portfolio_team_member_profile_inactive/i.test(updateBranch));
  assert(
    /SELECT p\.organization_id INTO _parent_org\s*\n\s*FROM public\.portfolio_items p/i.test(
      updateBranch,
    ),
  );
});

Deno.test("17. active -> active role changes do not trigger new membership validation", () => {
  // Every eligibility check in the UPDATE branch sits inside the false->true gate.
  const gate = updateBranch.search(
    /IF COALESCE\(OLD\.is_active, false\) = false AND COALESCE\(NEW\.is_active, false\) = true THEN/i,
  );
  assert(gate > 0);
  const beforeGate = updateBranch.slice(0, gate);
  assertEquals(/is_user_org_member|public\.profiles/i.test(beforeGate), false);
  // role is not immutable
  assertEquals(/NEW\.role IS DISTINCT FROM OLD\.role/i.test(fnBody), false);
});

Deno.test("18. active -> false removal remains allowed (is_active not immutable)", () => {
  assertEquals(/NEW\.is_active IS DISTINCT FROM OLD\.is_active/i.test(fnBody), false);
  assertEquals(
    /COALESCE\(OLD\.is_active, false\) = true AND COALESCE\(NEW\.is_active, false\) = false/i.test(
      fnBody,
    ),
    false,
  );
});

Deno.test("19. read-only preflight rejects existing parent-Organization inconsistencies", () => {
  const pre = code.match(/DO \$preflight\$[\s\S]*?\$preflight\$;/);
  assert(pre);
  const p = pre![0];
  assert(/SELECT count\(\*\) INTO _bad/i.test(p));
  assert(/LEFT JOIN public\.portfolio_items p ON p\.id = t\.portfolio_item_id/i.test(p));
  assert(/p\.id IS NULL/i.test(p));
  assert(/p\.organization_id IS DISTINCT FROM t\.organization_id/i.test(p));
  assert(/RAISE EXCEPTION 'portfolio_team_parent_organization_inconsistent/i.test(p));
  // preflight precedes the revoke and the trigger installation
  assert(idx(/DO \$preflight\$/) < idx(/REVOKE/i));
  assert(idx(/DO \$preflight\$/) < idx(/CREATE OR REPLACE FUNCTION/i));
  // bounded, no identifiers emitted
  assertEquals(/user_id|portfolio_item_id[^\n]*%|_bad_id/i.test(p), false);
  assertEquals(/is_user_org_member/i.test(p), false);
});

Deno.test("20. preflight performs no data repair or backfill", () => {
  const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, "").replace(
    /\$preflight\$[\s\S]*?\$preflight\$/g,
    (m) => m,
  );
  assertEquals(/insert\s+into|update\s+public\.|delete\s+from|truncate/i.test(topLevel), false);
  assertEquals(/alter table|create table|drop table|add column/i.test(code), false);
});

Deno.test("21. all four canonical Team RPCs are not redefined", () => {
  for (
    const n of [
      "admin_list_portfolio_team_members",
      "admin_add_portfolio_team_member",
      "admin_update_portfolio_team_member_role",
      "admin_remove_portfolio_team_member",
    ]
  ) {
    assertEquals(codeLower.includes(n), false, n);
  }
  assertEquals((code.match(/create or replace function/gi) ?? []).length, 1);
  assertEquals(/drop function/i.test(code), false);
});

Deno.test("22. no API/MCP/capability/encryption change introduced", () => {
  for (
    const forbidden of [
      "api_capability_catalogue",
      "api_capability_grants",
      "api_e_private",
      "api_v1_",
      "mcp",
      "idempotency",
      "btpm_encrypt",
      "btpm_decrypt",
      "tenant_encryption",
    ]
  ) {
    assertEquals(codeLower.includes(forbidden), false, forbidden);
  }
});

Deno.test("23. integrity function uses invoker rights with a fixed search_path", () => {
  assertEquals(/SECURITY DEFINER/i.test(fnBody), false);
  assert(/SET search_path TO 'public'/i.test(fnBody));
  assert(/LANGUAGE plpgsql/i.test(fnBody));
  assert(/RETURNS trigger/i.test(fnBody));
});
