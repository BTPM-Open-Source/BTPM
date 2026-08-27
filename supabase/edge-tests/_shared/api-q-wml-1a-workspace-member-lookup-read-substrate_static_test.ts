// API-Q WML-1A — Workspace Member Lookup canonical external read substrate.
//
// Focused repository static contract test. Locates the WML-1A migration by its
// unique marker and asserts, from committed source only:
//   - exact capability catalogue registration (v1 / read / workspace_members:list);
//   - exact wrapper name and typed signature with the accepted defaults;
//   - STABLE + SECURITY DEFINER + locked search_path;
//   - restricted grants (PUBLIC and anon revoked, only authenticated granted);
//   - the accepted delegated API-v1 read principal resolver is reused;
//   - Workspace -> Organization -> Tenant scope is derived server-side;
//   - active Tenant, Tenant membership and Organization membership are required;
//   - Organization AND Workspace Connected App enablement are required;
//   - the exact workspace_members:list Workspace-scoped grant is required;
//   - actual Workspace membership OR Organization Admin authority is required;
//   - the broad demo-workspace read helper is NOT used;
//   - only exact-Workspace active members are returned;
//   - the result shape exposes only userId/displayName/email + pagination;
//   - protected displayName/email are decrypted through btpm_decrypt;
//   - no role / private-profile fields are returned;
//   - search and pagination bounds are enforced;
//   - ordering is deterministic and null-safe;
//   - no service-role path, dynamic SQL, or mutation surface is introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-Q WML-1A — Workspace Member Lookup canonical external read database substrate";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(`-- ${marker}`)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
// Executable SQL only: comments are governance prose, not definitions.
const EXEC = RAW.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const FLAT = EXEC.replace(/\s+/g, " ");

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_list_workspace_members( " +
  "_expected_oauth_client_id text, _workspace_id uuid, _limit integer DEFAULT 50, " +
  "_offset integer DEFAULT 0, _search text DEFAULT NULL ) RETURNS jsonb " +
  "LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'";

Deno.test("WML-1A: exact capability catalogue registration", () => {
  assert(
    countOf(FLAT, "INSERT INTO public.api_capability_catalogue"),
    "exactly one catalogue insert expected",
  );
  assertOne("INSERT INTO public.api_capability_catalogue");
  for (
    const literal of [
      "'v1', 'read', 'workspace_members:list', 'workspace_members.get', 'GET', " +
      "'/v1/workspaces/:workspaceid/members', 'workspace',",
      "true, 'active'",
    ]
  ) {
    assert(FLAT.includes(literal), `catalogue values must include: ${literal}`);
  }
  // No generalization / mutation of existing capability rows.
  assert(!FLAT.includes("UPDATE public.api_capability_catalogue"));
  assert(!FLAT.includes("DELETE FROM public.api_capability_catalogue"));
  assert(!FLAT.includes("ON CONFLICT"));
});

function assertOne(needle: string) {
  assert(countOf(FLAT, needle) === 1, `expected exactly one: ${needle}`);
}

Deno.test("WML-1A: exact wrapper signature, STABLE, SECURITY DEFINER, locked search_path", () => {
  assert(FLAT.includes(SIG), "exact wrapper signature must be present");
  assertOne("CREATE OR REPLACE FUNCTION public.api_v1_list_workspace_members(");
  // Exactly one function is created by this migration.
  assert(countOf(FLAT, "CREATE OR REPLACE FUNCTION") === 1);
  assert(!FLAT.includes("public.ws_list_members"), "ws_list_members untouched");
});

Deno.test("WML-1A: restricted grants only", () => {
  const args = "public.api_v1_list_workspace_members(text, uuid, integer, integer, text)";
  assert(FLAT.includes(`REVOKE ALL ON FUNCTION ${args} FROM PUBLIC;`));
  assert(FLAT.includes(`REVOKE ALL ON FUNCTION ${args} FROM anon;`));
  assert(FLAT.includes(`GRANT EXECUTE ON FUNCTION ${args} TO authenticated;`));
  assert(!FLAT.includes("TO anon"), "no anon grant");
  assert(!/GRANT[^;]*service_role/.test(FLAT), "no service_role grant");
});

Deno.test("WML-1A: delegated read principal resolution is reused and not caller-trusted", () => {
  assertOne(
    "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
  );
  assert(FLAT.includes("r.authenticated_user_id, r.api_client_id"));
  assert(FLAT.includes("GET DIAGNOSTICS _rowcount = ROW_COUNT;"));
  assert(FLAT.includes("_rowcount <> 1 OR _uid IS NULL OR _client_id IS NULL"));
  // No caller-supplied identity parameters exist in the signature.
  for (
    const forbidden of [
      "_actor_",
      "_user_id uuid",
      "_tenant_id uuid,",
      "_organization_id uuid,",
      "_capability",
      "_sql",
      "_table",
      "_function",
    ]
  ) {
    assert(!SIG.includes(forbidden), `signature must not contain ${forbidden}`);
  }
});

Deno.test("WML-1A: server-derived Workspace -> Organization -> Tenant scope and active Tenant", () => {
  assert(FLAT.includes("FROM public.workspaces w JOIN public.organizations o ON o.id = w.organization_id"));
  assert(FLAT.includes("JOIN public.tenants t ON t.id = o.tenant_id AND t.status = 'active'"));
  assert(FLAT.includes("t.suspended_at IS NULL"));
  assert(FLAT.includes("t.archived_at IS NULL"));
  assert(FLAT.includes("t.purged_at IS NULL"));
  assert(FLAT.includes("SELECT t.id, o.id INTO _tenant_id, _org_id"));
  assert(FLAT.includes("WHERE w.id = _workspace_id AND w.is_active = true AND w.is_archived = false"));
});

Deno.test("WML-1A: active delegated Tenant and Organization membership required", () => {
  assert(
    FLAT.includes(
      "JOIN public.tenant_memberships tm ON tm.tenant_id = t.id AND tm.user_id = _uid AND tm.status = 'active' AND tm.deactivated_at IS NULL",
    ),
  );
  assert(
    FLAT.includes(
      "JOIN public.organization_memberships om ON om.organization_id = o.id AND om.user_id = _uid AND om.status = 'active' AND om.deactivated_at IS NULL",
    ),
  );
});

Deno.test("WML-1A: Organization and Workspace Connected App enablement required", () => {
  assertOne("public.api_organization_client_enablements oe");
  assert(
    FLAT.includes(
      "WHERE oe.tenant_id = t.id AND oe.organization_id = o.id AND oe.api_client_id = _client_id AND oe.lifecycle_status = 'enabled'",
    ),
  );
  assertOne("public.api_workspace_client_enablements we");
  assert(
    FLAT.includes(
      "WHERE we.tenant_id = t.id AND we.organization_id = o.id AND we.workspace_id = w.id AND we.api_client_id = _client_id AND we.lifecycle_status = 'enabled'",
    ),
  );
});

Deno.test("WML-1A: exact Workspace-scoped workspace_members:list grant required", () => {
  assertOne("public.api_capability_grants g");
  assert(
    FLAT.includes(
      "WHERE g.tenant_id = t.id AND g.organization_id = o.id AND g.workspace_id = w.id AND g.api_client_id = _client_id AND g.api_version = 'v1' AND g.capability_kind = 'read' AND g.capability_key = 'workspace_members:list' AND g.lifecycle_status = 'enabled'",
    ),
  );
  assert(countOf(FLAT, "capability_key = 'workspace_members:list'") === 1);
  assert(!FLAT.includes("g.workspace_id IS NULL"), "grant must be Workspace-scoped");
});

Deno.test("WML-1A: actual Workspace membership or Organization Admin required; no demo broad-read helper", () => {
  assert(
    FLAT.includes(
      "om.role::text = 'org_admin' OR EXISTS ( SELECT 1 FROM public.workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = _uid )",
    ),
  );
  for (
    const forbidden of [
      "can_read_demo_or_member",
      "can_read_demo",
      "is_demo",
      "demo_workspace",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `must not use ${forbidden}`);
  }
});

Deno.test("WML-1A: bounded not-authorized path, no existence disclosure", () => {
  assert(countOf(FLAT, "'api_v1_not_authorized' USING ERRCODE = '42501'") === 2);
  assert(FLAT.includes("IF _tenant_id IS NULL OR _org_id IS NULL THEN"));
  assert(!/not_found/.test(FLAT), "no not-found disclosure");
});

Deno.test("WML-1A: only exact-Workspace active members are returned", () => {
  assert(
    FLAT.includes(
      "FROM public.workspace_memberships wm JOIN public.profiles p ON p.id = wm.user_id WHERE wm.workspace_id = _workspace_id AND p.is_active = true",
    ),
  );
  // No Tenant-wide / Organization-wide / invitation population.
  assert(!FLAT.includes("FROM public.invitations"));
  assert(countOf(FLAT, "public.tenant_memberships") === 1);
  assert(countOf(FLAT, "public.organization_memberships") === 1);
});

Deno.test("WML-1A: result shape exposes only userId/displayName/email + pagination", () => {
  assert(
    FLAT.includes(
      "jsonb_build_object( 'userId', sub.user_id, 'displayName', sub.display_name, 'email', sub.email )",
    ),
  );
  assert(
    FLAT.includes(
      "RETURN jsonb_build_object( 'items', _items, 'pagination', jsonb_build_object( 'limit', _limit, 'offset', _offset, 'returned', jsonb_array_length(_items), 'total', _total ) )",
    ),
  );
  for (
    const forbidden of [
      "workspace_role",
      "'role'",
      "user_roles",
      "avatar",
      "created_at",
      "updated_at",
      "last_sign_in",
      "auth.users",
      "raw_user_meta_data",
      "membership_id",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `must not expose ${forbidden}`);
  }
});

Deno.test("WML-1A: protected displayName/email decrypted through the accepted path", () => {
  assert(countOf(FLAT, "public.btpm_decrypt(p.display_name, p.organization_id)") === 1);
  assert(countOf(FLAT, "public.btpm_decrypt(p.email, p.organization_id)") === 1);
  assert(countOf(FLAT, "public.btpm_decrypt(") === 2);
  assert(!FLAT.includes("btpm_encrypt"), "no encryption change");
  assert(!/CREATE (OR REPLACE )?TRIGGER/.test(FLAT), "no trigger change");
});

Deno.test("WML-1A: search bounds enforced and limited to displayName/email", () => {
  assert(FLAT.includes("_search_trimmed := btrim(_search);"));
  assert(FLAT.includes("IF length(_search_trimmed) = 0 THEN _has_search := false;"));
  assert(FLAT.includes("IF length(_search_trimmed) > 100 THEN"));
  assert(
    FLAT.includes(
      "WHERE NOT _has_search OR position(lower(_search_trimmed) IN lower(COALESCE(e.display_name, ''))) > 0 OR position(lower(_search_trimmed) IN lower(COALESCE(e.email, ''))) > 0",
    ),
  );
  assert(countOf(FLAT, "position(lower(_search_trimmed)") === 2);
});

Deno.test("WML-1A: pagination bounds enforced", () => {
  assert(FLAT.includes("IF _limit IS NULL OR _limit < 1 OR _limit > 100 THEN"));
  assert(FLAT.includes("IF _offset IS NULL OR _offset < 0 OR _offset > 10000 THEN"));
  assert(countOf(FLAT, "'api_v1_invalid_request' USING ERRCODE = '22023'") === 4);
  assert(FLAT.includes("FILTER (WHERE sub.rn > _offset AND sub.rn <= _offset + _limit)"));
  assert(FLAT.includes("COUNT(*)::integer"));
});

Deno.test("WML-1A: deterministic null-safe ordering", () => {
  assert(
    FLAT.includes(
      "ORDER BY sub.display_name_lower, sub.email_lower, sub.user_id",
    ),
  );
  assert(
    FLAT.includes(
      "row_number() OVER ( ORDER BY lower(COALESCE(f.display_name, '')), lower(COALESCE(f.email, '')), f.user_id ) AS rn",
    ),
  );
});

Deno.test("WML-1A: no service-role path, dynamic SQL, or mutation surface", () => {
  for (
    const forbidden of [
      "EXECUTE format",
      "EXECUTE '",
      "EXECUTE \"",
      "quote_ident",
      "quote_literal",
      "service_role",
      "SUPABASE_SERVICE_ROLE",
      "pmg_build_result",
      "authorize_and_establish",
      "api_idempotency_registry",
      "INSERT INTO public.api_request_activity_events",
      "UPDATE public.",
      "DELETE FROM public.",
      "SECURITY INVOKER",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `must not contain ${forbidden}`);
  }
  // The only INSERT is the capability catalogue registration row.
  assert(countOf(FLAT, "INSERT INTO") === 1);
  assert(!FLAT.includes("INSERT INTO public.workspace_memberships"));
  assert(!FLAT.includes("INSERT INTO public.profiles"));
});
