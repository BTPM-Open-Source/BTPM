// API-N.2A — Program protected-read substrate.
//
// Focused permanent static guard. Locates the API-N.2A migration by its unique
// marker and asserts, from committed source only, the frozen capability
// catalogue registration, the two dedicated external Program read wrapper
// signatures, their security posture, containment chains, exact response
// fields and the absence of out-of-scope work. No HTTP surface is asserted:
// route activation is deferred to API-N.2B.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-N.2A — Program protected-read substrate";

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

function slice(fn: string, revokeSignature: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert(start >= 0, `wrapper not found: ${fn}`);
  const end = SQL.indexOf(`REVOKE ALL ON FUNCTION public.${fn}(${revokeSignature})`);
  assert(end > start, `grant block not found: ${fn}`);
  return SQL.slice(start, end);
}

const LIST_SIG = "text, uuid, integer, integer, text";
const DETAIL_SIG = "text, uuid";
const LIST = slice("api_v1_list_programs", LIST_SIG);
const DETAIL = slice("api_v1_get_program", DETAIL_SIG);

function assertAll(
  body: string,
  label: string,
  checks: ReadonlyArray<[string, RegExp]>,
): void {
  for (const [name, pattern] of checks) {
    assert(pattern.test(body), `${label}: missing ${name}`);
  }
}

// ---------------------------------------------------------------------------
// A. Capability catalogue
// ---------------------------------------------------------------------------

Deno.test("API-N.2A registers exactly the two frozen Program read capabilities", () => {
  const keys = RAW.match(/'programs:(list|read)'/g) ?? [];
  assert(keys.length > 0, "no Program capability keys registered");

  assert(
    /\('v1', 'read', 'programs:list', 'programs\.get', 'GET', '\/v1\/programs', 'workspace', 'List Programs', 'List Programs accessible to the delegated user within an authorized Workspace\.', true, 'active'\)/
      .test(SQL),
    "programs:list catalogue row is not exact",
  );
  assert(
    /\('v1', 'read', 'programs:read', 'programs\.get_by_id', 'GET', '\/v1\/programs\/:programid', 'workspace', 'Read Program', 'Read one Program accessible to the delegated user within an authorized Workspace\.', true, 'active'\)/
      .test(SQL),
    "programs:read catalogue row is not exact",
  );

  // Only the capability catalogue is written to.
  const inserts = SQL.match(/INSERT INTO public\.\w+/g) ?? [];
  assert(
    inserts.length === 1 &&
      inserts[0] === "INSERT INTO public.api_capability_catalogue",
    `unexpected INSERT targets: ${inserts.join(", ")}`,
  );

  // No client support / grant / enablement row is created.
  for (
    const forbidden of [
      /INSERT INTO public\.api_client_supported_capabilities/,
      /INSERT INTO public\.api_capability_grants/,
      /INSERT INTO public\.api_organization_client_enablements/,
      /INSERT INTO public\.api_workspace_client_enablements/,
      /INSERT INTO public\.api_project_client_enablements/,
    ]
  ) {
    assert(!forbidden.test(SQL), `forbidden write present: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// B + C. Signatures and security posture
// ---------------------------------------------------------------------------

Deno.test("API-N.2A wrapper signatures are exactly the two frozen reads", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_list_programs\( _expected_oauth_client_id text, _workspace_id uuid, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _search text DEFAULT NULL::text \)/
      .test(SQL),
    "api_v1_list_programs signature mismatch",
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_program\( _expected_oauth_client_id text, _program_id uuid \)/
      .test(SQL),
    "api_v1_get_program signature mismatch",
  );

  const created = SQL.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? [];
  assert(created.length === 2, `expected exactly two wrappers, got ${created.length}`);
});

Deno.test("API-N.2A wrappers are STABLE SECURITY DEFINER, fail closed and are privilege-bounded", () => {
  for (const [label, body] of [["list", LIST], ["detail", DETAIL]] as const) {
    assertAll(body, label, [
      ["RETURNS jsonb", /RETURNS jsonb/],
      ["LANGUAGE plpgsql", /LANGUAGE plpgsql/],
      ["STABLE", /STABLE/],
      ["SECURITY DEFINER", /SECURITY DEFINER/],
      ["hardened search_path", /SET search_path TO 'pg_catalog'/],
      [
        "delegated principal helper",
        /api_e_private\.resolve_delegated_read_principal\(_expected_oauth_client_id\)/,
      ],
      [
        "exactly one principal row, fail closed 42501",
        /_rowcount <> 1 OR _uid IS NULL OR _client_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/,
      ],
      ["bounded invalid request", /'api_v1_invalid_request' USING ERRCODE = '22023'/],
    ]);
    assert(!/service_role/.test(body), `${label}: service-role business path present`);
    assert(!/EXECUTE\s+format|EXECUTE\s+'/.test(body), `${label}: dynamic SQL present`);
  }

  for (const [fn, sig] of [
    ["api_v1_list_programs", LIST_SIG],
    ["api_v1_get_program", DETAIL_SIG],
  ] as const) {
    assert(
      SQL.includes(`REVOKE ALL ON FUNCTION public.${fn}(${sig}) FROM PUBLIC`),
      `${fn}: PUBLIC not revoked`,
    );
    assert(
      SQL.includes(`REVOKE ALL ON FUNCTION public.${fn}(${sig}) FROM anon`),
      `${fn}: anon not revoked`,
    );
    assert(
      SQL.includes(
        `GRANT EXECUTE ON FUNCTION public.${fn}(${sig}) TO authenticated`,
      ),
      `${fn}: authenticated execute grant missing`,
    );
    assert(
      !new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`)
        .test(SQL),
      `${fn}: service-role execute granted`,
    );
  }
});

// ---------------------------------------------------------------------------
// D. Collection containment
// ---------------------------------------------------------------------------

Deno.test("API-N.2A Program collection containment chain", () => {
  assertAll(LIST, "list", [
    ["non-null Workspace target", /_workspace_id IS NULL THEN RAISE EXCEPTION 'api_v1_invalid_request'/],
    ["bounded limit", /_limit IS NULL OR _limit < 1 OR _limit > 100/],
    ["bounded offset", /_offset IS NULL OR _offset < 0 OR _offset > 10000/],
    ["bounded search", /length\(_search_trimmed\) > 100/],
    ["trimmed search", /_search_trimmed := btrim\(_search\)/],
    ["Workspace-derived Tenant/Organization", /FROM public\.workspaces w JOIN public\.organizations o ON o\.id = w\.organization_id JOIN public\.tenants t ON t\.id = o\.tenant_id/],
    ["active Tenant lifecycle", /t\.status = 'active' AND t\.suspended_at IS NULL AND t\.archived_at IS NULL AND t\.purged_at IS NULL/],
    ["active Tenant membership", /public\.tenant_memberships tm ON tm\.tenant_id = t\.id AND tm\.user_id = _uid AND tm\.status = 'active'/],
    ["active Organization membership", /public\.organization_memberships om ON om\.organization_id = o\.id AND om\.user_id = _uid AND om\.status = 'active'/],
    ["active non-archived Workspace", /w\.is_active = true AND w\.is_archived = false/],
    ["canonical Workspace user access", /om\.role::text = 'org_admin' OR EXISTS \( SELECT 1 FROM public\.workspace_memberships wm WHERE wm\.workspace_id = w\.id AND wm\.user_id = _uid \)/],
    ["Organization client enablement", /api_organization_client_enablements oe[\s\S]*?oe\.lifecycle_status = 'enabled'/],
    ["Workspace client enablement", /api_workspace_client_enablements we[\s\S]*?we\.workspace_id = w\.id[\s\S]*?we\.lifecycle_status = 'enabled'/],
    ["exact programs:list Workspace grant", /api_capability_grants g WHERE g\.tenant_id = t\.id AND g\.organization_id = o\.id AND g\.workspace_id = w\.id AND g\.api_client_id = _client_id AND g\.api_version = 'v1' AND g\.capability_kind = 'read' AND g\.capability_key = 'programs:list' AND g\.lifecycle_status = 'enabled'/],
    ["precheck independent fail closed", /_tenant_id IS NULL OR _org_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/],
    ["canonical programs source", /FROM public\.programs pg WHERE pg\.workspace_id = _workspace_id AND pg\.organization_id = _org_id AND pg\.is_archived = false/],
    ["server-side decryption", /public\.btpm_decrypt\(pg\.name, pg\.organization_id\)/],
    ["search on decrypted name", /position\(lower\(_search_trimmed\) IN lower\(COALESCE\(e\.name, ''\)\)\) > 0/],
    ["deterministic order", /ORDER BY lower\(COALESCE\(f\.name, ''\)\), f\.program_id/],
    ["pagination envelope", /'pagination', jsonb_build_object\( 'limit', _limit, 'offset', _offset, 'returned', jsonb_array_length\(_items\), 'total', _total \)/],
  ]);
  assert(
    !/public\.list_decrypted_workspace_programs/.test(LIST),
    "list: internal Program RPC used as external boundary",
  );
});

// ---------------------------------------------------------------------------
// E. Detail containment
// ---------------------------------------------------------------------------

Deno.test("API-N.2A Program detail containment chain", () => {
  assertAll(DETAIL, "detail", [
    ["non-null Program target", /_program_id IS NULL THEN RAISE EXCEPTION 'api_v1_invalid_request'/],
    ["Program-derived scope", /FROM public\.programs pg JOIN public\.workspaces w ON w\.id = pg\.workspace_id/],
    ["Program\u2194Workspace Organization consistency", /w\.organization_id = pg\.organization_id/],
    ["active Tenant lifecycle", /t\.status = 'active' AND t\.suspended_at IS NULL AND t\.archived_at IS NULL AND t\.purged_at IS NULL/],
    ["active Tenant membership", /public\.tenant_memberships tm ON tm\.tenant_id = t\.id AND tm\.user_id = _uid AND tm\.status = 'active'/],
    ["active Organization membership", /public\.organization_memberships om ON om\.organization_id = o\.id AND om\.user_id = _uid AND om\.status = 'active'/],
    ["active non-archived Workspace", /w\.is_active = true AND w\.is_archived = false/],
    ["archived Program excluded", /pg\.is_archived = false/],
    ["canonical Workspace user access", /om\.role::text = 'org_admin' OR EXISTS \( SELECT 1 FROM public\.workspace_memberships wm WHERE wm\.workspace_id = w\.id AND wm\.user_id = _uid \)/],
    ["Organization client enablement", /api_organization_client_enablements oe[\s\S]*?oe\.lifecycle_status = 'enabled'/],
    ["Workspace client enablement", /api_workspace_client_enablements we[\s\S]*?we\.workspace_id = w\.id[\s\S]*?we\.lifecycle_status = 'enabled'/],
    ["exact programs:read Workspace grant", /api_capability_grants g WHERE g\.tenant_id = t\.id AND g\.organization_id = o\.id AND g\.workspace_id = w\.id AND g\.api_client_id = _client_id AND g\.api_version = 'v1' AND g\.capability_kind = 'read' AND g\.capability_key = 'programs:read' AND g\.lifecycle_status = 'enabled'/],
    ["non-enumerating scope failure", /_tgt_ws_id IS NULL OR _tgt_org_id IS NULL OR _tenant_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/],
    ["non-enumerating projection failure", /_result IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/],
    ["decrypted name", /'name', public\.btpm_decrypt\(pg\.name, pg\.organization_id\)/],
    ["decrypted description", /'description', public\.btpm_decrypt\(pg\.description, pg\.organization_id\)/],
    ["authoritative scope re-assertion", /pg\.workspace_id = _tgt_ws_id AND pg\.organization_id = _tgt_org_id/],
  ]);
  assert(
    !/public\.get_decrypted_program/.test(DETAIL),
    "detail: internal Program RPC used as external boundary",
  );
});

// ---------------------------------------------------------------------------
// F. Exact response-field contract
// ---------------------------------------------------------------------------

Deno.test("API-N.2A response fields are exactly the frozen contracts", () => {
  const listFields =
    LIST.match(/jsonb_build_object\( 'programId'[\s\S]*?'updatedAt', sub\.updated_at \)/);
  assert(listFields, "collection item object not found");
  const listKeys = [...listFields[0].matchAll(/'([a-zA-Z]+)',/g)].map((m) => m[1]);
  assert(
    JSON.stringify(listKeys) === JSON.stringify([
      "programId",
      "organizationId",
      "workspaceId",
      "name",
      "status",
      "createdAt",
      "updatedAt",
    ]),
    `collection item fields mismatch: ${listKeys.join(", ")}`,
  );

  const detailFields =
    DETAIL.match(/jsonb_build_object\( 'programId'[\s\S]*?'updatedAt', pg\.updated_at \)/);
  assert(detailFields, "detail object not found");
  const detailKeys = [...detailFields[0].matchAll(/'([a-zA-Z]+)',/g)].map((m) => m[1]);
  assert(
    JSON.stringify(detailKeys) === JSON.stringify([
      "programId",
      "organizationId",
      "workspaceId",
      "name",
      "description",
      "status",
      "createdAt",
      "updatedAt",
    ]),
    `detail fields mismatch: ${detailKeys.join(", ")}`,
  );

  // Forbidden external fields in either payload.
  for (const forbidden of ["isArchived", "createdBy", "is_archived", "created_by"]) {
    assert(
      !listFields[0].includes(`'${forbidden}'`),
      `collection exposes ${forbidden}`,
    );
    assert(
      !detailFields[0].includes(`'${forbidden}'`),
      `detail exposes ${forbidden}`,
    );
  }
  assert(!/'description'/.test(listFields[0]), "collection exposes description");
});

// ---------------------------------------------------------------------------
// G. Negative scope guard
// ---------------------------------------------------------------------------

Deno.test("API-N.2A migration introduces no out-of-scope work", () => {
  const forbidden: ReadonlyArray<[string, RegExp]> = [
    ["Program-level enablement table", /api_program_client_enablements/i],
    ["Program mutation wrapper", /apply_program_|api_v1_create_program|api_v1_update_program/i],
    ["Project API change", /api_v1_list_projects|api_v1_get_project/],
    ["generic dispatcher", /regprocedure|command_handler|capability_key = _|_capability_key\b/],
    ["dynamic SQL", /EXECUTE\s+format\(|EXECUTE\s+'/],
    ["RLS weakening", /DISABLE ROW LEVEL SECURITY|DROP POLICY/i],
    ["service-role external path", /TO service_role/],
    ["table or type DDL", /CREATE TABLE|ALTER TABLE|CREATE TYPE|ALTER TYPE|CREATE INDEX/i],
    ["internal Program read function change", /FUNCTION public\.get_decrypted_program|FUNCTION public\.list_decrypted_workspace_programs/],
    ["HTTP/Edge route code", /serve\(|Deno\.serve|btpm-api-v1/],
  ];
  for (const [label, pattern] of forbidden) {
    assert(!pattern.test(SQL), `out-of-scope content present: ${label}`);
  }
});
