// API-M.CP.3A — Execution Update read parity capability metadata and protected
// database read substrate.
//
// Concise permanent static guard. Locates the API-M.CP.3A migration by its
// unique marker and asserts, from committed source only, the security- and
// business-critical properties of the single dedicated Execution Update read
// wrapper. No HTTP surface is asserted: route activation is deferred.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.CP.3A — Execution Update read parity capability metadata and protected database read substrate (API-M.CP.4A scope-consistency correction)";

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

const START = SQL.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_list_execution_updates(",
);
assert(START >= 0, "read wrapper not found");
const END = SQL.indexOf("REVOKE ALL ON FUNCTION");
assert(END > START, "grant block not found");
const FN = SQL.slice(START, END);

const SIGNATURE =
  "public.api_v1_list_execution_updates(text, text, uuid, integer, timestamptz, uuid)";

Deno.test("API-M.CP.3A registers exactly the frozen execution_updates:read capability metadata", () => {
  assert(
    /\('v1', 'read', 'execution_updates:read', 'execution_updates\.get', 'GET', '\/v1\/execution-updates', 'project', 'Read Execution Updates', '[^']*', true, 'active'\)/
      .test(SQL),
    "exact project-scoped, administrator-assignable, active catalogue row is required",
  );
  for (
    const forbidden of [
      "INSERT INTO public.api_client_supported_capabilities",
      "UPDATE public.api_client_supported_capabilities",
      "INSERT INTO public.api_capability_grants",
      "INSERT INTO public.api_organization_client_enablements",
      "INSERT INTO public.api_workspace_client_enablements",
      "INSERT INTO public.api_project_client_enablements",
    ]
  ) {
    assert(!SQL.includes(forbidden), `must not perform: ${forbidden}`);
  }
});

Deno.test("API-M.CP.3A creates exactly one hardened read wrapper with the frozen signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_list_execution_updates\( _expected_oauth_client_id text, _target_type text, _target_id uuid, _limit integer, _after_created_at timestamptz, _after_id uuid \) RETURNS jsonb/
      .test(SQL),
    "exact wrapper signature returning jsonb is required",
  );
  const created = SQL.match(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g) ?? [];
  assert(
    created.filter((c) => c.includes("api_v1_list_execution_updates")).length ===
      1,
    "exactly one Execution Update read wrapper may be created",
  );
  assert(FN.includes("STABLE"), "wrapper must be STABLE");
  assert(FN.includes("SECURITY DEFINER"), "wrapper must be SECURITY DEFINER");
  assert(
    /SET search_path TO 'pg_catalog'/.test(FN),
    "wrapper must pin a hardened search_path",
  );
  assert(
    !/EXECUTE |format\(|quote_ident|quote_literal/.test(FN),
    "wrapper must contain no dynamic SQL",
  );
});

Deno.test("API-M.CP.3A validates target type, target id, limit and the all-or-none cursor", () => {
  assert(
    /_target_type IS NULL OR _target_type NOT IN \('phase', 'task'\)/.test(FN),
    "only the canonical target types phase | task are accepted",
  );
  assert(/_target_id IS NULL/.test(FN), "target id must be required");
  assert(
    /_limit IS NULL OR _limit < 1 OR _limit > 500/.test(FN),
    "limit must be bounded to 1..500",
  );
  assert(
    /\(_after_created_at IS NULL\) <> \(_after_id IS NULL\)/.test(FN),
    "cursor pair must be all-or-none",
  );
  assert(
    !/lower\(_target_type\)|btrim\(_target_type\)|trim\(_target_type\)|_target_type = 'project'|_target_type IN \('phase', 'task', 'project'\)/
      .test(FN),
    "no silent normalization and no Project target support",
  );

  assert(
    /RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/.test(FN),
    "invalid input must raise api_v1_invalid_request / 22023",
  );
});

Deno.test("API-M.CP.3A requires exactly one delegated read principal", () => {
  assert(
    /api_e_private\.resolve_delegated_read_principal\(_expected_oauth_client_id\)/
      .test(FN),
    "the accepted delegated read principal resolver is required",
  );
  assert(
    /_rowcount <> 1 OR _uid IS NULL OR _client_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(FN),
    "exactly one valid user + client pair is required, else 42501",
  );
});

Deno.test("API-M.CP.3A derives authoritative Project scope from the canonical Phase or Task hierarchy", () => {
  assert(
    /IF _target_type = 'phase' THEN SELECT ph\.project_id, ph\.workspace_id, ph\.organization_id INTO _project_id, _tgt_ws_id, _tgt_org_id FROM public\.phases ph WHERE ph\.id = _target_id;/
      .test(FN),
    "Phase targets must derive Project, Workspace and Organization from the stored Phase",
  );
  assert(
    /SELECT tk\.project_id, tk\.workspace_id, tk\.organization_id INTO _project_id, _tgt_ws_id, _tgt_org_id FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = _target_id AND \( tk\.phase_id IS NULL OR \( tph\.project_id = tk\.project_id AND tph\.workspace_id = tk\.workspace_id AND tph\.organization_id = tk\.organization_id \) \)/
      .test(FN),
    "Task targets must require Task/Phase Project + Workspace + Organization consistency",
  );
  assert(
    /IF _project_id IS NULL OR _tgt_ws_id IS NULL OR _tgt_org_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(FN),
    "an unresolvable or inconsistent target must fail closed non-enumerably",
  );
  assert(
    /SELECT p\.organization_id, p\.workspace_id INTO _org_id, _ws_id FROM public\.projects p/
      .test(FN),
    "Organization and Workspace must be derived from the authorized Project row",
  );
});

Deno.test("API-M.CP.3A enforces the accepted external read containment composition", () => {
  const checks: ReadonlyArray<[string, RegExp]> = [
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
      "enabled supported capability execution_updates:read",
      /api_client_supported_capabilities sc[\s\S]*?sc\.api_version = 'v1' AND sc\.capability_kind = 'read' AND sc\.capability_key = 'execution_updates:read' AND sc\.lifecycle_status = 'enabled'/,
    ],
    [
      "active project-scoped catalogue capability",
      /api_capability_catalogue cc[\s\S]*?cc\.capability_key = 'execution_updates:read' AND cc\.scope_level = 'project' AND cc\.lifecycle_status = 'active'/,
    ],
  ];
  for (const [label, pattern] of checks) {
    assert(pattern.test(FN), `wrapper must enforce: ${label}`);
  }
  assert(
    /IF _org_id IS NULL OR _ws_id IS NULL OR _org_id <> _tgt_org_id OR _ws_id <> _tgt_ws_id THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(FN),
    "unresolved scope or target Workspace/Organization inconsistency must fail closed",
  );
  assert(!/not_found/.test(FN), "no not_found enumeration outcome is permitted");
});

Deno.test("API-M.CP.3A requires stored Organization + Workspace integrity and exact target filtering", () => {
  assert(
    /eu\.organization_id = _org_id AND eu\.workspace_id = _ws_id AND eu\.target_type = _target_type AND eu\.target_id = _target_id/
      .test(FN),
    "stored Organization and Workspace integrity plus exact target type/id filtering are required",
  );
});

Deno.test("API-M.CP.3A returns exactly the eight frozen fields with a raw author UUID", () => {
  const fields = [
    "'executionUpdateId', page.id",
    "'targetType', page.target_type",
    "'targetId', page.target_id",
    "'authorId', page.author_id",
    "'summary', page.summary",
    "'statusLabel', page.status_label",
    "'updateDate', page.update_date",
    "'createdAt', page.created_at",
  ];
  for (const field of fields) {
    assert(FN.includes(field), `response must contain: ${field}`);
  }
  const emitted = FN.match(/'[a-zA-Z]+', page\./g) ?? [];
  assert(emitted.length === 8, "exactly eight response fields are permitted");
  for (
    const forbidden of [
      "'organizationId'",
      "'workspaceId'",
      "'projectId'",
      "'updatedAt'",
      "'authorName'",
      "'authorEmail'",
    ]
  ) {
    assert(!FN.includes(forbidden), `must not expose: ${forbidden}`);
  }
  assert(
    !/profiles/.test(FN),
    "authorId must remain the raw canonical BTPM user UUID",
  );
});

Deno.test("API-M.CP.3A decrypts the protected summary server-side only", () => {
  assert(
    /public\.btpm_decrypt\(eu\.summary, eu\.organization_id\)/.test(FN),
    "summary must be decrypted server-side under the validated Organization context",
  );
  assert(
    !/btpm_encrypt|INSERT INTO public\.execution_updates|UPDATE public\.execution_updates/
      .test(FN),
    "the read wrapper must not write or re-encrypt narrative data",
  );
});

Deno.test("API-M.CP.3A uses deterministic created_at DESC, id DESC keyset pagination", () => {
  assert(
    /\(eu\.created_at, eu\.id\) < \(_after_created_at, _after_id\)/.test(FN),
    "keyset predicate is required",
  );
  assert(
    /ORDER BY eu\.created_at DESC, eu\.id DESC LIMIT _limit \+ 1/.test(FN),
    "limit + 1 lookahead ordering is required",
  );
  assert(
    /'items',[\s\S]*'nextCursorCreatedAt', _next_created_at, 'nextCursorId', _next_id/
      .test(FN),
    "internal cursor response shape is required",
  );
  assert(!/OFFSET/.test(FN), "offset pagination is prohibited");
});

Deno.test("API-M.CP.3A wrapper is authenticated-only with no anon, PUBLIC or service-role execution", () => {
  assert(SQL.includes(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM PUBLIC`));
  assert(SQL.includes(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM anon`));
  assert(
    SQL.includes(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO authenticated`),
  );
  assert(!/TO service_role/.test(SQL), "no service-role execution path");
});

Deno.test("API-M.CP.3A leaves the canonical Execution Update append path untouched", () => {
  for (
    const forbidden of [
      "api_v1_append_execution_update",
      "public.append_execution_update",
    ]
  ) {
    assert(!SQL.includes(forbidden), `must not modify: ${forbidden}`);
  }
});
