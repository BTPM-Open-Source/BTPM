// API-M.CP.2A-C1 — Risk read substrate Workspace/Organization scope-consistency
// correction guard.
//
// Repository static contract test. Locates the API-M.CP.2A-C1 correction
// migration by its unique marker and asserts, from committed source only, that
// the two external Risk read wrappers enforce the same structural scope
// integrity as the accepted mutation precedent public.api_v1_update_risk:
// the stored Risk workspace_id / organization_id must exactly match the
// Workspace / Organization derived from the canonical Project/Phase/Task target.
//
// No HTTP surface is asserted; route activation remains deferred to CP.2B.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.CP.2A-C1 — Risk read substrate Workspace/Organization scope-consistency correction";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
const SQL = RAW.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `function ${name} not found`);
  const rest = SQL.slice(start);
  const end = rest.indexOf("REVOKE ALL ON FUNCTION");
  assert(end > 0, `grant block for ${name} not found`);
  return rest.slice(0, end);
}

const LIST = functionBody("api_v1_list_project_risks");
const DETAIL = functionBody("api_v1_get_risk");

// ---------------------------------------------------------------------------
// Collection wrapper — authorized Project scope derivation + integrity match
// ---------------------------------------------------------------------------

Deno.test("CP.2A-C1 collection derives the authorized Project Organization and Workspace server-side", () => {
  assert(
    /SELECT p\.organization_id, p\.workspace_id INTO _org_id, _ws_id FROM public\.projects p/
      .test(LIST),
    "the authorized Project Organization and Workspace must be derived server-side from public.projects",
  );
  assert(
    /IF _org_id IS NULL OR _ws_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(LIST),
    "an unresolved authorized Organization or Workspace must fail closed with 42501",
  );
});

Deno.test("CP.2A-C1 collection requires exact Risk organization_id and workspace_id match", () => {
  assert(
    /FROM public\.risks r WHERE r\.organization_id = _org_id AND r\.workspace_id = _ws_id/
      .test(LIST),
    "candidate Risk rows must match both the authorized Organization and the authorized Workspace exactly",
  );
});

Deno.test("CP.2A-C1 collection keeps target-derived Project membership authoritative", () => {
  assert(
    /\(r\.target_type = 'project' AND r\.target_id = _project_id\)/.test(LIST),
    "project-target membership rule must remain",
  );
  assert(
    /r\.target_type = 'phase' AND EXISTS \( SELECT 1 FROM public\.phases ph WHERE ph\.id = r\.target_id AND ph\.project_id = _project_id \)/
      .test(LIST),
    "phase-target Project membership rule must remain",
  );
  assert(
    /r\.target_type = 'task' AND EXISTS \( SELECT 1 FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = r\.target_id AND tk\.project_id = _project_id AND \(tk\.phase_id IS NULL OR tph\.project_id = _project_id\) \)/
      .test(LIST),
    "task-target Project membership rule with Task/Phase consistency must remain",
  );
});

Deno.test("CP.2A-C1 collection does not use stored scope as a substitute for target-derived membership", () => {
  const targetClauses = LIST.match(/r\.target_type = '(project|phase|task)'/g) ?? [];
  assert(
    targetClauses.length === 3,
    "exactly the three canonical target-derived membership branches must be present",
  );
  assert(
    !/r\.workspace_id = _ws_id \)? *ORDER BY/.test(
      LIST.replace(/AND \( \(r\.target_type[\s\S]*?\) \) /, ""),
    ),
    "stored scope must be an additional constraint, not the membership predicate",
  );
});

// ---------------------------------------------------------------------------
// Detail wrapper — stored scope load + derived comparison
// ---------------------------------------------------------------------------

Deno.test("CP.2A-C1 detail loads stored Risk workspace_id and organization_id", () => {
  assert(
    /SELECT r\.target_type, r\.target_id, r\.organization_id, r\.workspace_id INTO _target_type, _target_id, _risk_org_id, _risk_ws_id FROM public\.risks r WHERE r\.id = _risk_id/
      .test(DETAIL),
    "the stored Risk target and stored Workspace/Organization must be loaded together",
  );
});

Deno.test("CP.2A-C1 detail derives Project, Workspace and Organization from the stored target", () => {
  assert(
    /IF _target_type = 'project' THEN _derived_project_id := _target_id;/.test(DETAIL),
    "project target derivation must remain",
  );
  assert(
    /ELSIF _target_type = 'phase' THEN SELECT ph\.project_id INTO _derived_project_id/.test(DETAIL),
    "phase target Project derivation must remain",
  );
  assert(
    /ELSIF _target_type = 'task' THEN SELECT tk\.project_id INTO _derived_project_id/.test(DETAIL),
    "task target Project derivation must remain",
  );
  assert(
    /\(tk\.phase_id IS NULL OR tph\.project_id = tk\.project_id\)/.test(DETAIL),
    "task/phase Project consistency must remain",
  );
  assert(
    /SELECT p\.organization_id, p\.workspace_id INTO _org_id, _ws_id FROM public\.projects p/.test(DETAIL),
    "authoritative Workspace and Organization must be derived from the derived Project",
  );
});

Deno.test("CP.2A-C1 detail requires derived Workspace and Organization to equal stored Risk scope", () => {
  assert(
    /IF _org_id IS NULL OR _ws_id IS NULL OR _org_id <> _risk_org_id OR _ws_id <> _risk_ws_id THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "derived Organization and Workspace must both be compared with the stored Risk scope and mismatch must raise 42501",
  );
  assert(
    /WHERE r\.id = _risk_id AND r\.organization_id = _org_id AND r\.workspace_id = _ws_id/.test(DETAIL),
    "the protected projection must be re-bound to the authorized Organization and Workspace",
  );
});

Deno.test("CP.2A-C1 detail resolves every failure to bounded non-enumerable 42501", () => {
  const raises = DETAIL.match(/RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/g) ?? [];
  assert(raises.length >= 6, `expected bounded 42501 authorization failures, found ${raises.length}`);
  assert(
    !/api_v1_not_found/.test(DETAIL),
    "Risk existence must never be disclosed through a distinct not-found outcome",
  );
});

// ---------------------------------------------------------------------------
// Regression — signatures, fields, pagination, capability, posture
// ---------------------------------------------------------------------------

Deno.test("CP.2A-C1 keeps both wrapper signatures unchanged", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_list_project_risks\( _expected_oauth_client_id text, _project_id uuid, _limit integer, _after_created_at timestamptz, _after_id uuid \) RETURNS jsonb/
      .test(SQL),
    "collection signature must be unchanged",
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_risk\( _expected_oauth_client_id text, _risk_id uuid \) RETURNS jsonb/
      .test(SQL),
    "detail signature must be unchanged",
  );
  assert(
    /GRANT EXECUTE ON FUNCTION public\.api_v1_list_project_risks\(text, uuid, integer, timestamptz, uuid\) TO authenticated/
      .test(SQL) &&
      /GRANT EXECUTE ON FUNCTION public\.api_v1_get_risk\(text, uuid\) TO authenticated/.test(SQL),
    "execution grants must target the unchanged argument lists",
  );
});

Deno.test("CP.2A-C1 keeps the frozen response field shape unchanged", () => {
  for (const body of [LIST, DETAIL]) {
    for (
      const field of [
        "'riskId'",
        "'projectId'",
        "'targetType'",
        "'targetId'",
        "'title'",
        "'description'",
        "'mitigationPlan'",
        "'likelihood'",
        "'impact'",
        "'status'",
        "'updatedAt'",
      ]
    ) {
      assert(body.includes(field), `frozen field ${field} must remain`);
    }
    assert(!/'reportedBy'|'createdBy'|'organizationId'|'workspaceId'/.test(body),
      "internal metadata must not be exposed in the response");
    assert(
      /public\.btpm_decrypt\(r\.title/.test(body) &&
        /public\.btpm_decrypt\(r\.description/.test(body) &&
        /public\.btpm_decrypt\(r\.mitigation_plan/.test(body),
      "server-side decryption of narrative fields must remain",
    );
  }
});

Deno.test("CP.2A-C1 keeps pagination behavior unchanged", () => {
  assert(/_limit < 1 OR _limit > 500/.test(LIST), "1..500 limit bound must remain");
  assert(
    /\(_after_created_at IS NULL\) <> \(_after_id IS NULL\)/.test(LIST),
    "all-or-none cursor pair must remain",
  );
  assert(/ORDER BY r\.created_at DESC, r\.id DESC LIMIT _limit \+ 1/.test(LIST),
    "created_at DESC, id DESC keyset probe must remain");
  assert(
    /\(r\.created_at, r\.id\) < \(_after_created_at, _after_id\)/.test(LIST),
    "keyset seek predicate must remain",
  );
  assert(
    /'nextCursorCreatedAt'/.test(LIST) && /'nextCursorId'/.test(LIST),
    "cursor envelope must remain",
  );
});

Deno.test("CP.2A-C1 keeps the risks:read capability composition unchanged and adds no metadata", () => {
  for (const body of [LIST, DETAIL]) {
    assert(
      /sc\.capability_key = 'risks:read' AND sc\.lifecycle_status = 'enabled'/.test(body),
      "exact enabled supported capability requirement must remain",
    );
    assert(
      /cc\.capability_key = 'risks:read' AND cc\.scope_level = 'project' AND cc\.lifecycle_status = 'active'/
        .test(body),
      "active project-scoped catalogue requirement must remain",
    );
    assert(
      /api_e_private\.resolve_delegated_read_principal\(_expected_oauth_client_id\)/.test(body),
      "delegated read principal resolution must remain",
    );
    for (
      const clause of [
        "api_organization_client_enablements",
        "api_workspace_client_enablements",
        "api_project_client_enablements",
        "public.has_project_access",
        "tenant_memberships",
        "organization_memberships",
      ]
    ) {
      assert(body.includes(clause), `${clause} containment must remain`);
    }
    assert(/STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'/.test(body),
      "hardened STABLE SECURITY DEFINER posture must remain");
    assert(!/EXECUTE |format\(|quote_ident/.test(body), "no dynamic SQL is permitted");
  }
  assert(
    !/api_capability_catalogue *\( *api_version/.test(SQL) &&
      !/INSERT INTO public\.api_capability_catalogue/.test(SQL),
    "the correction must not change capability catalogue metadata",
  );
  assert(
    !/api_capability_grants/.test(SQL),
    "risks:read must not be auto-granted",
  );
});

Deno.test("CP.2A-C1 performs no mutation-wrapper or HTTP/runtime work", () => {
  const created = SQL.match(/CREATE OR REPLACE FUNCTION public\.[a-z0-9_]+\(/g) ?? [];
  assert(created.length === 2, `exactly two functions may be replaced, found ${created.length}`);
  assert(
    SQL.includes("CREATE OR REPLACE FUNCTION public.api_v1_list_project_risks(") &&
      SQL.includes("CREATE OR REPLACE FUNCTION public.api_v1_get_risk("),
    "only the two CP.2A read wrappers may be replaced",
  );
  for (
    const forbidden of [
      "FUNCTION public.api_v1_update_risk",
      "FUNCTION public.api_v1_create_risk",
      "FUNCTION public.apply_risk_",
      "CREATE TABLE",
      "ALTER TABLE",
      "CREATE POLICY",
      "DROP FUNCTION",
    ]
  ) {
    assert(!SQL.includes(forbidden), `${forbidden} must not appear in the correction migration`);
  }
  assert(
    /accepted mutation precedent public\.api_v1_update_risk/.test(SQL),
    "the mutation precedent may only be referenced descriptively",
  );

});

Deno.test("CP.2A-C1 leaves the original CP.2A migration untouched", async () => {
  const original = await Deno.readTextFile(
    "supabase/migrations/20260811114821_b2fb0bc3-7fdf-4af3-9d50-23db39e498cd.sql",
  );
  assert(
    original.includes(
      "API-M.CP.2A — Risk read parity capability metadata and protected database read substrate",
    ),
    "the original CP.2A migration marker must remain intact",
  );
  assert(
    !original.includes("API-M.CP.2A-C1"),
    "the correction must not be applied by editing the original CP.2A migration",
  );
});
