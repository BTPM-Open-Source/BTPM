// API-M.CP.2C1 — Blocker read parity capability metadata and protected database
// read substrate.
//
// Focused repository static contract test. Locates the API-M.CP.2C1 migration by
// its unique marker and asserts, from committed source only, that the frozen
// blockers:read capability metadata, the dedicated Project Blocker collection
// wrapper and the dedicated Blocker detail wrapper exist with the required
// authorization composition, authoritative target-derived Project membership,
// stored scope-consistency enforcement, protected field handling, deterministic
// keyset pagination and hardened security posture. No HTTP surface is asserted:
// route activation is deferred to a later step.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.CP.2C1 — Blocker read parity capability metadata and protected database read substrate";

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

const LIST = functionBody("api_v1_list_project_blockers");
const DETAIL = functionBody("api_v1_get_blocker");

const READ_CONTAINMENT: ReadonlyArray<[string, RegExp]> = [
  [
    "delegated read principal",
    /api_e_private\.resolve_delegated_read_principal\(_expected_oauth_client_id\)/,
  ],
  ["active Tenant", /t\.status = 'active' AND t\.suspended_at IS NULL/],
  [
    "active Tenant membership",
    /public\.tenant_memberships tm ON tm\.tenant_id = t\.id AND tm\.user_id = _uid AND tm\.status = 'active'/,
  ],
  [
    "active Organization membership",
    /public\.organization_memberships om ON om\.organization_id = o\.id AND om\.user_id = _uid AND om\.status = 'active'/,
  ],
  [
    "active non-archived Workspace",
    /w\.is_active = true AND w\.is_archived = false/,
  ],
  ["non-archived Project", /p\.is_archived = false/],
  ["canonical Project access", /public\.has_project_access\(_uid, p\.id\)/],
  [
    "Organization Connected App enablement",
    /api_organization_client_enablements oe[\s\S]*?oe\.lifecycle_status = 'enabled'/,
  ],
  [
    "Workspace Connected App enablement",
    /api_workspace_client_enablements we[\s\S]*?we\.lifecycle_status = 'enabled'/,
  ],
  [
    "Project Connected App enablement",
    /api_project_client_enablements pe[\s\S]*?pe\.lifecycle_status = 'enabled' AND pe\.enabled_at IS NOT NULL AND pe\.disabled_at IS NULL/,
  ],
  [
    "enabled supported capability blockers:read",
    /api_client_supported_capabilities sc[\s\S]*?sc\.capability_key = 'blockers:read' AND sc\.lifecycle_status = 'enabled'/,
  ],
  [
    "active project-scoped catalogue capability blockers:read",
    /api_capability_catalogue cc[\s\S]*?cc\.capability_key = 'blockers:read' AND cc\.scope_level = 'project' AND cc\.lifecycle_status = 'active'/,
  ],
];

const RESPONSE_FIELDS: ReadonlyArray<string> = [
  "'blockerId'",
  "'projectId'",
  "'targetType'",
  "'targetId'",
  "'title'",
  "'description'",
  "'severity'",
  "'status'",
  "'resolvedAt'",
  "'updatedAt'",
  "'resolvedBy'",
];

const FORBIDDEN_FIELDS: ReadonlyArray<string> = [
  "'organizationId'",
  "'workspaceId'",
  "'reportedBy'",
  "'createdAt'",
];

// ---------------------------------------------------------------------------
// Capability catalogue metadata
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 registers exactly the frozen blockers:read capability metadata", () => {
  assert(
    /\('v1', 'read', 'blockers:read', 'blockers\.get_by_id', 'GET', '\/v1\/blockers\/:blockerid', 'project', 'Read Blockers', '[^']*', true, 'active'\)/
      .test(SQL),
    "exact blockers:read catalogue row (v1 / read / project scope / administrator assignable / active) with the blockers.get_by_id representative route is required",
  );
  assert(
    !/'blockers:list'/.test(SQL),
    "a second blockers:list capability must not be created",
  );
});

Deno.test("API-M.CP.2C1 performs no capability grant, assignment or enablement write", () => {
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
// Wrapper identity and posture
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 creates exactly the two dedicated Blocker read wrappers with hardened posture", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_list_project_blockers\( _expected_oauth_client_id text, _project_id uuid, _limit integer, _after_created_at timestamptz, _after_id uuid \) RETURNS jsonb/
      .test(SQL),
    "exact collection wrapper signature returning jsonb is required",
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_blocker\( _expected_oauth_client_id text, _blocker_id uuid \) RETURNS jsonb/
      .test(SQL),
    "exact detail wrapper signature returning jsonb is required",
  );
  const created = SQL.match(/CREATE OR REPLACE FUNCTION public\.\w+\(/g) ?? [];
  assert(
    created.length === 2,
    "exactly two wrappers may be created by this migration",
  );
  for (const [name, body] of [["collection", LIST], ["detail", DETAIL]]) {
    assert(body.includes("STABLE"), `${name} must be STABLE`);
    assert(body.includes("SECURITY DEFINER"), `${name} must be SECURITY DEFINER`);
    assert(
      /SET search_path TO 'pg_catalog'/.test(body),
      `${name} must pin a hardened search_path`,
    );
    assert(
      !/EXECUTE |format\(|quote_ident|quote_literal/.test(body),
      `${name} must contain no dynamic SQL`,
    );
  }
});

Deno.test("API-M.CP.2C1 wrappers are authenticated-only with no anon or PUBLIC execution", () => {
  for (
    const sig of [
      "public.api_v1_list_project_blockers(text, uuid, integer, timestamptz, uuid)",
      "public.api_v1_get_blocker(text, uuid)",
    ]
  ) {
    assert(
      SQL.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC`),
      `${sig} must revoke PUBLIC execution`,
    );
    assert(
      SQL.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon`),
      `${sig} must revoke anon execution`,
    );
    assert(
      SQL.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`),
      `${sig} must grant execute only to authenticated`,
    );
  }
  assert(
    !/TO service_role/.test(SQL),
    "no service-role business read execution path is permitted",
  );
});

// ---------------------------------------------------------------------------
// Read containment composition
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 both wrappers enforce the accepted external read containment composition", () => {
  for (const [label, pattern] of READ_CONTAINMENT) {
    assert(pattern.test(LIST), `collection wrapper must enforce: ${label}`);
    assert(pattern.test(DETAIL), `detail wrapper must enforce: ${label}`);
  }
  assert(
    /RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/.test(LIST),
    "collection failure must be the non-enumerable 42501 outcome",
  );
});

// ---------------------------------------------------------------------------
// Collection: authoritative scope + target-derived membership
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 collection derives the authoritative Project Organization and Workspace server-side", () => {
  assert(
    /SELECT p\.organization_id, p\.workspace_id INTO _org_id, _ws_id FROM public\.projects p/
      .test(LIST),
    "Organization and Workspace must be derived from the authorized Project row",
  );
  assert(
    /IF _org_id IS NULL OR _ws_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(LIST),
    "unresolved authoritative scope must fail closed",
  );
});

Deno.test("API-M.CP.2C1 collection requires exact stored Blocker Organization and Workspace consistency", () => {
  assert(
    /b\.organization_id = _org_id AND b\.workspace_id = _ws_id/.test(LIST),
    "stored Blocker scope must match the authoritative derived scope exactly",
  );
});

Deno.test("API-M.CP.2C1 collection keeps target-derived Project membership authoritative", () => {
  assert(
    /b\.target_type = 'project' AND b\.target_id = _project_id/.test(LIST),
    "project-target Blockers must match the requested Project",
  );
  assert(
    /b\.target_type = 'phase' AND EXISTS \( SELECT 1 FROM public\.phases ph WHERE ph\.id = b\.target_id AND ph\.project_id = _project_id \)/
      .test(LIST),
    "phase-target Blockers must resolve to the requested Project",
  );
  assert(
    /b\.target_type = 'task' AND EXISTS \( SELECT 1 FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = b\.target_id AND tk\.project_id = _project_id AND \(tk\.phase_id IS NULL OR tph\.project_id = _project_id\) \)/
      .test(LIST),
    "task-target Blockers must resolve to the requested Project with Task/Phase Project consistency",
  );
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 collection validates bounded inputs and uses created_at DESC, id DESC keyset pagination", () => {
  assert(
    /_project_id IS NULL THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(LIST),
    "null Project must raise the bounded invalid-request SQLSTATE",
  );
  assert(
    /_limit IS NULL OR _limit < 1 OR _limit > 500 THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(LIST),
    "limit must be bounded to 1..500",
  );
  assert(
    /\(_after_created_at IS NULL\) <> \(_after_id IS NULL\) THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(LIST),
    "mixed cursor state must be rejected",
  );
  assert(
    /\(b\.created_at, b\.id\) < \(_after_created_at, _after_id\)/.test(LIST),
    "keyset cursor comparison is required",
  );
  assert(
    /ORDER BY b\.created_at DESC, b\.id DESC LIMIT _limit \+ 1/.test(LIST),
    "frozen deterministic ordering with lookahead is required",
  );
  assert(
    !/OFFSET/i.test(LIST),
    "offset pagination is forbidden",
  );
  assert(
    /'nextCursorCreatedAt', _next_created_at, 'nextCursorId', _next_id/.test(
      LIST,
    ),
    "the collection must return only the keyset cursor pair",
  );
});

// ---------------------------------------------------------------------------
// Detail: stored-target derivation and non-enumeration
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 detail derives the Project from the stored Blocker target only", () => {
  assert(
    /SELECT b\.target_type, b\.target_id, b\.organization_id, b\.workspace_id INTO _target_type, _target_id, _blocker_org_id, _blocker_ws_id FROM public\.blockers b WHERE b\.id = _blocker_id/
      .test(DETAIL),
    "the stored Blocker target and scope must be loaded first",
  );
  assert(
    /_target_type = 'project' THEN _derived_project_id := _target_id/.test(
      DETAIL,
    ),
    "project targets derive the Project directly",
  );
  assert(
    /_target_type = 'phase' THEN SELECT ph\.project_id INTO _derived_project_id FROM public\.phases ph WHERE ph\.id = _target_id/
      .test(DETAIL),
    "phase targets derive the Project from the stored Phase",
  );
  assert(
    /_target_type = 'task' THEN SELECT tk\.project_id INTO _derived_project_id FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = _target_id AND \(tk\.phase_id IS NULL OR tph\.project_id = tk\.project_id\)/
      .test(DETAIL),
    "task targets derive the Project with Task/Phase Project consistency",
  );
  assert(
    /WHERE p\.id = _derived_project_id/.test(DETAIL),
    "containment must be evaluated against the derived Project",
  );
});

Deno.test("API-M.CP.2C1 detail compares derived Organization and Workspace against the stored Blocker scope", () => {
  assert(
    /IF _org_id IS NULL OR _ws_id IS NULL OR _org_id <> _blocker_org_id OR _ws_id <> _blocker_ws_id THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "derived scope must exactly equal the stored Blocker scope",
  );
  assert(
    /WHERE b\.id = _blocker_id AND b\.organization_id = _org_id AND b\.workspace_id = _ws_id/
      .test(DETAIL),
    "the final projection must be re-bound to the derived authorized scope",
  );
});

Deno.test("API-M.CP.2C1 detail keeps missing, inconsistent and inaccessible Blockers non-enumerable", () => {
  assert(
    /IF _target_type IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "a missing Blocker must fail closed with 42501",
  );
  assert(
    /IF _derived_project_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "an invalid or inconsistent stored target must fail closed with 42501",
  );
  assert(
    /IF _result IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(DETAIL),
    "an empty final projection must fail closed with 42501",
  );
  assert(
    !/not_found/.test(SQL),
    "no not_found outcome may be introduced",
  );
});

// ---------------------------------------------------------------------------
// Response contract and protected fields
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 both wrappers return exactly the frozen 11 external Blocker fields", () => {
  for (const [name, body] of [["collection", LIST], ["detail", DETAIL]]) {
    for (const field of RESPONSE_FIELDS) {
      assert(body.includes(field), `${name} must expose ${field}`);
    }
    for (const field of FORBIDDEN_FIELDS) {
      assert(!body.includes(field), `${name} must not expose ${field}`);
    }
    const built = body.match(/jsonb_build_object\( '\w+'/g) ?? [];
    assert(built.length >= 1, `${name} must build an explicit projection`);
  }
});

Deno.test("API-M.CP.2C1 decrypts title and description server-side and exposes no encryption metadata", () => {
  assert(
    /public\.btpm_decrypt\(b\.title, b\.organization_id\)/.test(LIST) &&
      /public\.btpm_decrypt\(b\.description, b\.organization_id\)/.test(LIST),
    "collection must decrypt title and description server-side",
  );
  assert(
    /'title', public\.btpm_decrypt\(b\.title, b\.organization_id\)/.test(
      DETAIL,
    ) &&
      /'description', public\.btpm_decrypt\(b\.description, b\.organization_id\)/
        .test(DETAIL),
    "detail must decrypt title and description server-side",
  );
  for (
    const forbidden of [
      "encryption_key",
      "key_version",
      "ciphertext",
      "btpm_encrypt",
    ]
  ) {
    assert(
      !SQL.includes(forbidden),
      `no encryption metadata may be exposed: ${forbidden}`,
    );
  }
});

Deno.test("API-M.CP.2C1 returns resolvedBy as the stored canonical identifier only", () => {
  assert(
    /'resolvedBy', page\.resolved_by/.test(LIST),
    "collection resolvedBy must come from the stored blockers.resolved_by",
  );
  assert(
    /'resolvedBy', b\.resolved_by/.test(DETAIL),
    "detail resolvedBy must come from the stored blockers.resolved_by",
  );
  assert(
    !/public\.profiles/.test(SQL) && !/entity_user_links/.test(SQL),
    "resolvedBy must not be resolved to any other identity attribute",
  );
});

// ---------------------------------------------------------------------------
// Mutation and scope preservation
// ---------------------------------------------------------------------------

Deno.test("API-M.CP.2C1 leaves Blocker mutations and unrelated surfaces untouched", () => {
  for (
    const forbidden of [
      "FUNCTION public.api_v1_create_blocker",
      "FUNCTION public.api_v1_update_blocker",
      "FUNCTION public.apply_blocker_create",
      "FUNCTION public.apply_blocker_update",
      "FUNCTION public.api_v1_list_project_risks",
      "FUNCTION public.api_v1_get_risk",
    ]
  ) {
    assert(
      !SQL.includes(forbidden),
      `this migration must not redefine: ${forbidden}`,
    );
  }
  assert(
    !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP /.test(SQL),
    "no schema, policy or destructive change is permitted in this step",
  );
});
