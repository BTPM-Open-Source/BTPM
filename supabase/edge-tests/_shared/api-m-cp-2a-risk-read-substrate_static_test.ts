// API-M.CP.2A — Risk read parity capability metadata and protected database
// read substrate.
//
// Focused repository static contract test. Locates the API-M.CP.2A migration by
// its unique marker and asserts, from committed source only, that the frozen
// risks:read capability metadata, the dedicated Project Risk collection wrapper
// and the dedicated Risk detail wrapper exist with the required authorization
// composition, protected field handling, deterministic keyset pagination and
// hardened security posture. No HTTP surface is asserted: route activation is
// deferred to API-M.CP.2B.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.CP.2A — Risk read parity capability metadata and protected database read substrate";

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
// Capability catalogue metadata
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2A registers exactly the frozen risks:read capability metadata", () => {
  assert(
    SQL.includes("INSERT INTO public.api_capability_catalogue"),
    "catalogue reconciliation insert is required",
  );
  assert(
    /\('v1', 'read', 'risks:read', 'risks\.get_by_id', 'GET', '\/v1\/risks\/:riskid', 'project', 'Read Risks', '[^']*', true, 'active'\)/
      .test(SQL),
    "exact risks:read catalogue row (v1 / read / project scope / administrator assignable / active) with the risks.get_by_id representative route is required",
  );
  assert(
    !/'risks:list'/.test(SQL),
    "a second risks:list capability must not be created",
  );
});

Deno.test("API-M.CP.2A performs no capability grant, assignment or enablement write", () => {
  for (
    const forbidden of [
      "INSERT INTO public.api_client_supported_capabilities",
      "UPDATE public.api_client_supported_capabilities",
      "INSERT INTO public.api_capability_grants",
      "UPDATE public.api_capability_grants",
      "INSERT INTO public.api_organization_client_enablements",
      "INSERT INTO public.api_workspace_client_enablements",
      "INSERT INTO public.api_project_client_enablements",
    ]
  ) {
    assert(
      !SQL.includes(forbidden),
      `capability metadata step must not perform: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Collection wrapper
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2A collection wrapper has the exact signature and no overload", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_list_project_risks\( _expected_oauth_client_id text, _project_id uuid, _limit integer, _after_created_at timestamptz, _after_id uuid \) RETURNS jsonb/
      .test(SQL),
    "exact collection wrapper signature returning jsonb is required",
  );
  const occurrences =
    SQL.split("CREATE OR REPLACE FUNCTION public.api_v1_list_project_risks(")
      .length - 1;
  assert(occurrences === 1, "no collection wrapper overload is permitted");
  assert(LIST.includes("STABLE"), "must be STABLE");
  assert(LIST.includes("SECURITY DEFINER"), "must be SECURITY DEFINER");
  assert(
    /SET search_path TO 'pg_catalog'/.test(LIST),
    "must pin a hardened search_path",
  );
});

Deno.test("API-M.CP.2A collection wrapper validates bounded fixed inputs and all-or-none cursor state", () => {
  assert(
    /_project_id IS NULL THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(LIST),
    "null Project must raise the bounded invalid-request SQLSTATE",
  );
  assert(
    /_limit IS NULL OR _limit < 1 OR _limit > 500 THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(LIST),
    "limit must be bounded to 1..500 with the bounded invalid-request SQLSTATE",
  );
  assert(
    /\(_after_created_at IS NULL\) <> \(_after_id IS NULL\) THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(LIST),
    "mixed cursor state must be rejected",
  );
});

Deno.test("API-M.CP.2A collection wrapper resolves the delegated principal through the trusted helper", () => {
  assert(
    LIST.includes(
      "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
    ),
    "delegated principal must come from the trusted helper",
  );
  assert(
    /_rowcount <> 1 OR _uid IS NULL OR _client_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(LIST),
    "exactly one resolved delegated user and API client is required",
  );
});

function assertScopeComposition(body: string, label: string) {
  assert(
    /public\.tenants t ON t\.id = o\.tenant_id AND t\.status = 'active' AND t\.suspended_at IS NULL AND t\.archived_at IS NULL AND t\.purged_at IS NULL/
      .test(body),
    `${label}: active Tenant is required`,
  );
  assert(
    /tenant_memberships tm ON tm\.tenant_id = t\.id AND tm\.user_id = _uid AND tm\.status = 'active' AND tm\.deactivated_at IS NULL/
      .test(body),
    `${label}: active Tenant membership is required`,
  );
  assert(
    /organization_memberships om ON om\.organization_id = o\.id AND om\.user_id = _uid AND om\.status = 'active' AND om\.deactivated_at IS NULL/
      .test(body),
    `${label}: active Organization membership is required`,
  );
  assert(
    /public\.workspaces w ON w\.id = p\.workspace_id AND w\.organization_id = p\.organization_id AND w\.is_active = true AND w\.is_archived = false/
      .test(body),
    `${label}: active non-archived Workspace containment is required`,
  );
  assert(
    /p\.is_archived = false AND public\.has_project_access\(_uid, p\.id\)/.test(
      body,
    ),
    `${label}: non-archived Project and canonical Project access are required`,
  );
  assert(
    /api_organization_client_enablements oe[\s\S]*oe\.lifecycle_status = 'enabled'/
      .test(body),
    `${label}: Organization client enablement is required`,
  );
  assert(
    /api_workspace_client_enablements we[\s\S]*we\.lifecycle_status = 'enabled'/
      .test(body),
    `${label}: Workspace client enablement is required`,
  );
  assert(
    /api_project_client_enablements pe[\s\S]*pe\.lifecycle_status = 'enabled' AND pe\.enabled_at IS NOT NULL AND pe\.disabled_at IS NULL/
      .test(body),
    `${label}: Project client enablement is required`,
  );
  assert(
    /api_client_supported_capabilities sc WHERE sc\.api_client_id = _client_id AND sc\.api_version = 'v1' AND sc\.capability_kind = 'read' AND sc\.capability_key = 'risks:read' AND sc\.lifecycle_status = 'enabled'/
      .test(body),
    `${label}: exact enabled supported capability risks:read is required`,
  );
  assert(
    /api_capability_catalogue cc WHERE cc\.api_version = 'v1' AND cc\.capability_kind = 'read' AND cc\.capability_key = 'risks:read' AND cc\.scope_level = 'project' AND cc\.lifecycle_status = 'active'/
      .test(body),
    `${label}: active project-scoped risks:read catalogue row is required`,
  );
  assert(
    !/capability_key = 'projects:read'/.test(body),
    `${label}: projects:read must not be used as authorization`,
  );
  assert(
    /RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/.test(body),
    `${label}: unauthorized scope must fail closed non-enumerably`,
  );
}

Deno.test("API-M.CP.2A collection wrapper enforces the full delegated + Connected App containment composition", () => {
  assertScopeComposition(LIST, "collection");
});

Deno.test("API-M.CP.2A collection wrapper derives Project membership from canonical Risk targets", () => {
  assert(
    /r\.target_type = 'project' AND r\.target_id = _project_id/.test(LIST),
    "Project Risks must match the requested Project target",
  );
  assert(
    /r\.target_type = 'phase' AND EXISTS \( SELECT 1 FROM public\.phases ph WHERE ph\.id = r\.target_id AND ph\.project_id = _project_id \)/
      .test(LIST),
    "Phase Risks must resolve through canonical Phase -> Project containment",
  );
  assert(
    /r\.target_type = 'task' AND EXISTS \( SELECT 1 FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = r\.target_id AND tk\.project_id = _project_id AND \(tk\.phase_id IS NULL OR tph\.project_id = _project_id\) \)/
      .test(LIST),
    "Task Risks must resolve through canonical Task -> Project containment with Task/Phase consistency",
  );
});

Deno.test("API-M.CP.2A collection wrapper returns exactly the frozen external Risk fields with server-side decryption", () => {
  for (
    const key of [
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
    assert(LIST.includes(key), `collection item must project ${key}`);
  }
  for (
    const forbidden of [
      "'createdAt'",
      "'organizationId'",
      "'workspaceId'",
      "'reportedBy'",
      "'links'",
    ]
  ) {
    assert(
      !LIST.includes(forbidden),
      `collection item must not project ${forbidden}`,
    );
  }
  assert(
    /public\.btpm_decrypt\(r\.title, r\.organization_id\)/.test(LIST) &&
      /public\.btpm_decrypt\(r\.description, r\.organization_id\)/.test(LIST) &&
      /public\.btpm_decrypt\(r\.mitigation_plan, r\.organization_id\)/.test(
        LIST,
      ),
    "title, description and mitigation_plan must be decrypted server-side",
  );
  assert(
    !/r\.reported_by/.test(LIST),
    "reported_by must never be exposed",
  );
});

Deno.test("API-M.CP.2A collection wrapper uses deterministic keyset pagination with bounded next-page state", () => {
  assert(
    /ORDER BY r\.created_at DESC, r\.id DESC/.test(LIST),
    "frozen ordering created_at DESC, id DESC is required",
  );
  assert(
    /\(r\.created_at, r\.id\) < \(_after_created_at, _after_id\)/.test(LIST),
    "descending keyset seek semantics are required",
  );
  assert(
    /LIMIT _limit \+ 1/.test(LIST),
    "bounded limit + 1 next-page probe is required",
  );
  assert(
    /n\.rn <= _limit/.test(LIST),
    "the returned page must contain at most _limit items",
  );
  assert(
    !/\bOFFSET\b/i.test(LIST),
    "OFFSET / page-number pagination is forbidden",
  );
  assert(
    /'items', COALESCE\(_items, '\[\]'::jsonb\), 'nextCursorCreatedAt', _next_created_at, 'nextCursorId', _next_id/
      .test(LIST),
    "bounded cursor-state transport shape is required",
  );
  assert(
    (LIST.match(/CASE WHEN \(SELECT count\(\*\) FROM numbered\) > _limit/g) ??
        []).length === 2,
    "both cursor-state components must be derived from the same next-page condition (all-or-none)",
  );
});

// ---------------------------------------------------------------------------
// Detail wrapper
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2A detail wrapper has the exact signature and no overload", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_risk\( _expected_oauth_client_id text, _risk_id uuid \) RETURNS jsonb/
      .test(SQL),
    "exact detail wrapper signature returning jsonb is required",
  );
  const occurrences =
    SQL.split("CREATE OR REPLACE FUNCTION public.api_v1_get_risk(").length - 1;
  assert(occurrences === 1, "no detail wrapper overload is permitted");
  assert(DETAIL.includes("STABLE"), "must be STABLE");
  assert(DETAIL.includes("SECURITY DEFINER"), "must be SECURITY DEFINER");
  assert(
    /SET search_path TO 'pg_catalog'/.test(DETAIL),
    "must pin a hardened search_path",
  );
});

Deno.test("API-M.CP.2A detail wrapper derives the authoritative Project from the stored Risk target", () => {
  assert(
    /SELECT r\.target_type, r\.target_id, r\.organization_id INTO _target_type, _target_id, _risk_org_id FROM public\.risks r WHERE r\.id = _risk_id/
      .test(DETAIL),
    "the stored Risk target must be read first",
  );
  assert(
    /_target_type = 'project' THEN _derived_project_id := _target_id/.test(
      DETAIL,
    ),
    "Project targets resolve directly",
  );
  assert(
    /_target_type = 'phase' THEN SELECT ph\.project_id INTO _derived_project_id FROM public\.phases ph WHERE ph\.id = _target_id/
      .test(DETAIL),
    "Phase targets resolve through the canonical Phase -> Project relationship",
  );
  assert(
    /_target_type = 'task' THEN SELECT tk\.project_id INTO _derived_project_id FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = _target_id AND \(tk\.phase_id IS NULL OR tph\.project_id = tk\.project_id\)/
      .test(DETAIL),
    "Task targets resolve through canonical Task -> Project containment with Task/Phase consistency",
  );
  assert(
    /WHERE p\.id = _derived_project_id/.test(DETAIL),
    "authorization must use the server-derived Project",
  );
  assert(
    !/\b_project_id\b/.test(DETAIL),
    "the detail wrapper must not accept or use any caller-supplied Project identity",
  );
});

Deno.test("API-M.CP.2A detail wrapper enforces the same containment gates and capability", () => {
  assertScopeComposition(DETAIL, "detail");
  assert(
    /_org_id IS NULL OR _org_id <> _risk_org_id THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "the Risk Organization must match the authorized Project Organization",
  );
  assert(
    /_target_type IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "missing Risk must be non-enumerable",
  );
  assert(
    /_result IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "unauthorized Risk must be non-enumerable",
  );
});

Deno.test("API-M.CP.2A detail wrapper returns the same protected decrypted business representation", () => {
  for (
    const key of [
      "'riskId', r.id",
      "'projectId', _derived_project_id",
      "'targetType', r.target_type",
      "'targetId', r.target_id",
      "'likelihood', r.likelihood::text",
      "'impact', r.impact::text",
      "'status', r.status::text",
      "'updatedAt', r.updated_at",
    ]
  ) {
    assert(DETAIL.includes(key), `detail result must project ${key}`);
  }
  assert(
    /'title', public\.btpm_decrypt\(r\.title, r\.organization_id\)/.test(DETAIL) &&
      /'description', public\.btpm_decrypt\(r\.description, r\.organization_id\)/
        .test(DETAIL) &&
      /'mitigationPlan', public\.btpm_decrypt\(r\.mitigation_plan, r\.organization_id\)/
        .test(DETAIL),
    "narrative fields must be decrypted server-side",
  );
  for (
    const forbidden of [
      "'createdAt'",
      "'organizationId'",
      "'workspaceId'",
      "'reportedBy'",
    ]
  ) {
    assert(
      !DETAIL.includes(forbidden),
      `detail result must not project ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Grants and security posture
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2A applies the exact external read wrapper grants", () => {
  for (
    const sig of [
      "public.api_v1_list_project_risks(text, uuid, integer, timestamptz, uuid)",
      "public.api_v1_get_risk(text, uuid)",
    ]
  ) {
    assert(
      SQL.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC`),
      `PUBLIC must be revoked on ${sig}`,
    );
    assert(
      SQL.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon`),
      `anon must be revoked on ${sig}`,
    );
    assert(
      SQL.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`),
      `authenticated must be granted on ${sig}`,
    );
    assert(
      !SQL.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role`),
      `service_role must not be a consumer path for ${sig}`,
    );
  }
});

Deno.test("API-M.CP.2A introduces no dynamic SQL, generic dispatch or mutation", () => {
  // GRANT EXECUTE is a privilege statement, not dynamic SQL: scan the function
  // bodies only.
  assert(
    !/\bEXECUTE\b/i.test(LIST) && !/\bEXECUTE\b/i.test(DETAIL),
    "dynamic SQL is forbidden",
  );
  assert(!/\bregprocedure\b/i.test(SQL), "function-OID dispatch is forbidden");
  assert(
    !/quote_ident|format\(/i.test(SQL),
    "identifier interpolation is forbidden",
  );
  for (
    const forbidden of [
      "_table_name",
      "_function_name",
      "_capability_key text",
      "_route_id text",
    ]
  ) {
    assert(
      !SQL.includes(forbidden),
      `generic parameter ${forbidden} is forbidden`,
    );
  }
  for (
    const forbidden of [
      "INSERT INTO public.risks",
      "UPDATE public.risks",
      "DELETE FROM public.risks",
      "api_v1_create_risk",
      "api_v1_update_risk",
      "apply_risk_create",
      "apply_risk_update",
      "list_project_all_risks",
      "list_decrypted_risks",
      "claim_idempotency",
      "complete_idempotency",
      "fail_idempotency",
    ]
  ) {
    assert(
      !SQL.includes(forbidden),
      `read-parity substrate must not touch ${forbidden}`,
    );
  }
});
