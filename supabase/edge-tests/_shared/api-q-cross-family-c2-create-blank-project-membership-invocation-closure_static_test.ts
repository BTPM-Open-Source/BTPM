// API-Q Cross-Family-C2 — Project Blank-Create delegate: canonical Organization
// membership + direct-invocation closure. Focused static contract test over the
// forward-only migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260819131115_91e6e9ee-5703-47a8-9d27-bfe7674752e5.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
// SQL with `--` comments stripped (comment prose must not satisfy assertions).
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();

const DIALOG_PATH = new URL(
  "../../../src/components/project/NewProjectDialog.tsx",
  import.meta.url,
).pathname;

Deno.test("1. exactly create_blank_project is redefined", () => {
  const defs = code.match(/create or replace function public\.([a-z0-9_]+)/gi) ?? [];
  assertEquals(defs.length, 1);
  assert(codeLower.includes("create or replace function public.create_blank_project("));
  assertEquals(/drop function/i.test(code), false);
});

Deno.test("2. exact existing signature is preserved", () => {
  assert(
    codeLower.includes(
      "public.create_blank_project(_name text, _workspace_id uuid, _program_id uuid default null::uuid, _delivery_model project_delivery_model default null::project_delivery_model)",
    ),
  );
});

Deno.test("3. RETURNS uuid is preserved", () => {
  assertEquals((code.match(/RETURNS uuid/gi) ?? []).length, 1);
});

Deno.test("4. SECURITY DEFINER is preserved", () => {
  assertEquals((code.match(/SECURITY DEFINER/gi) ?? []).length, 1);
  assertEquals(/security invoker/i.test(code), false);
});

Deno.test("5. search_path and volatility are preserved", () => {
  assert(codeLower.includes("set search_path to 'public'"));
  assert(codeLower.includes("language plpgsql"));
  // volatile is the default for plpgsql; no volatility marker may be introduced
  assertEquals(/\b(stable|immutable)\b/i.test(code), false);
});

Deno.test("6. Organization is derived from the authoritative Workspace", () => {
  assert(
    codeLower.includes(
      "select organization_id, is_demo into _org, _is_demo",
    ),
  );
  assert(codeLower.includes("from public.workspaces where id = _workspace_id"));
  assert(codeLower.includes("if _org is null then"));
  assert(code.includes("RAISE EXCEPTION 'Workspace not found'"));
});

Deno.test("7. canonical membership call is exactly public.is_user_org_member(_uid, _org)", () => {
  assert(code.includes("public.is_user_org_member(_uid, _org) IS NOT TRUE"));
  assertEquals((code.match(/is_user_org_member\(/g) ?? []).length, 1);
  assert(
    code.includes(
      "RAISE EXCEPTION 'Workspace is not in your organization' USING ERRCODE = '42501'",
    ),
  );
});

Deno.test("8. user-first argument order is correct", () => {
  assertEquals(/is_user_org_member\(\s*_org\s*,/i.test(code), false);
  assert(/is_user_org_member\(\s*_uid\s*,\s*_org\s*\)/.test(code));
});

Deno.test("9. get_user_org_id is absent from the corrected function", () => {
  assertEquals(/get_user_org_id/i.test(code), false);
});

Deno.test("10. profiles.organization_id is not used as membership authority", () => {
  assertEquals(/profiles/i.test(code), false);
  assertEquals(/is_org_member\s*\(/i.test(codeLower.replace(/is_user_org_member\s*\(/g, "")), false);
  assertEquals(/is_organization_member/i.test(code), false);
});

Deno.test("11. is_active_user remains required", () => {
  assert(code.includes("IF NOT public.is_active_user(_uid) THEN"));
  assert(code.includes("RAISE EXCEPTION 'Account is deactivated' USING ERRCODE = '42501'"));
  assert(code.includes("IF _uid IS NULL THEN"));
  assert(code.includes("RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'"));
});

Deno.test("12. has_pm_authority remains required", () => {
  assert(code.includes("IF NOT public.has_pm_authority(_uid, _workspace_id) THEN"));
  assert(
    code.includes(
      "RAISE EXCEPTION 'You do not have permission to create projects in this workspace' USING ERRCODE = '42501'",
    ),
  );
});

Deno.test("13. can_write_demo remains required", () => {
  assert(code.includes("IF NOT public.can_write_demo(_uid, _workspace_id) THEN"));
  assert(
    code.includes(
      "RAISE EXCEPTION 'Cannot write to this demo workspace' USING ERRCODE = '42501'",
    ),
  );
});

Deno.test("14. name validation remains unchanged", () => {
  assert(code.includes("_name_trim text := btrim(coalesce(_name, ''))"));
  assert(code.includes("RAISE EXCEPTION 'Project name is required'"));
  assert(code.includes("IF length(_name_trim) > 200 THEN"));
  assert(code.includes("RAISE EXCEPTION 'Project name must be 200 characters or less'"));
});

Deno.test("15. Program same-Workspace validation remains unchanged", () => {
  assert(code.includes("IF _program_id IS NOT NULL THEN"));
  assert(code.includes("FROM public.programs"));
  assert(code.includes("WHERE id = _program_id AND workspace_id = _workspace_id"));
  assert(
    code.includes(
      "RAISE EXCEPTION 'Program must belong to the same workspace as the project'",
    ),
  );
});

Deno.test("16. Project INSERT fields and delivery_model behavior remain unchanged", () => {
  assert(
    code.includes(
      "INSERT INTO public.projects (name, workspace_id, organization_id, program_id, created_by, delivery_model)",
    ),
  );
  assert(
    code.includes(
      "VALUES (_name_trim, _workspace_id, _org, _program_id, _uid, _delivery_model)",
    ),
  );
  assert(code.includes("RETURNING id INTO _new_id"));
  assert(code.includes("RETURN _new_id;"));
  assertEquals((code.match(/INSERT INTO/gi) ?? []).length, 1);
});

Deno.test("17. direct authenticated EXECUTE is revoked", () => {
  assert(
    codeLower.includes(
      "revoke execute on function public.create_blank_project(text, uuid, uuid, public.project_delivery_model) from authenticated",
    ),
  );
});

Deno.test("18. no authenticated EXECUTE grant is reintroduced", () => {
  assertEquals(/grant\s+execute[\s\S]*?to\s+authenticated/i.test(code), false);
});

Deno.test("19. no PUBLIC/anon/service_role privilege widening occurs", () => {
  assertEquals(/\bgrant\b/i.test(code), false);
  assertEquals(/\banon\b/i.test(code), false);
  assertEquals(/service_role/i.test(code), false);
  assertEquals(/\bto\s+public\s*;/i.test(code), false);
  assertEquals(/alter\s+function[\s\S]*owner\s+to/i.test(code), false);
});

Deno.test("20. apply_project_create_blank is not redefined", () => {
  assertEquals(/create or replace function[\s\S]*apply_project_create_blank/i.test(code), false);
  assertEquals(/apply_project_create_blank/i.test(code), false);
});

Deno.test("21. api_v1/mcp Project-create wrappers/executor are not redefined", () => {
  for (
    const name of [
      "api_v1_create_project",
      "mcp_v1_create_project",
      "execute_v1_create_project",
      "api_e_private",
      "jwt_client_id",
    ]
  ) {
    assertEquals(codeLower.includes(name), false, name);
  }
});

Deno.test("22. projects:create capability is untouched", () => {
  assertEquals(/projects:create/i.test(code), false);
  assertEquals(/api_capability/i.test(code), false);
});

Deno.test("23. NewProjectDialog still calls apply_project_create_blank only", async () => {
  const tsx = await Deno.readTextFile(DIALOG_PATH);
  assert(tsx.includes('rpc("apply_project_create_blank"'));
  assertEquals(tsx.includes("create_blank_project"), false);
});

Deno.test("24. no Program/Portfolio/Project-update/Phase/Task function is changed", () => {
  for (
    const name of [
      "apply_program_create",
      "apply_program_update",
      "portfolio",
      "apply_project_update",
      "apply_project_transition",
      "apply_phase_",
      "apply_task_",
    ]
  ) {
    assertEquals(codeLower.includes(name), false, name);
  }
});

Deno.test("25. no RLS/schema/encryption/frontend change occurs", () => {
  for (
    const pattern of [
      /create\s+table/i,
      /alter\s+table/i,
      /create\s+policy/i,
      /drop\s+policy/i,
      /row\s+level\s+security/i,
      /create\s+index/i,
      /create\s+trigger/i,
      /btpm_encrypt/i,
      /btpm_decrypt/i,
      /create\s+type/i,
    ]
  ) {
    assertEquals(pattern.test(code), false, String(pattern));
  }
});

Deno.test("26. no migration-time business-data DML/backfill occurs", () => {
  // The single INSERT is inside the preserved function body, not migration-time DML.
  const outsideBody = code.replace(/\$function\$[\s\S]*\$function\$/g, "");
  assertEquals(/\b(insert|update|delete)\b/i.test(outsideBody), false);
});
