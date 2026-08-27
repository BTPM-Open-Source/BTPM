// API-Q WML-1A-C1 — Workspace Member Lookup returned-member Tenant/Organization
// containment.
//
// Focused repository static contract test. Locates the C1 correction migration
// by its unique marker and asserts, from committed source only:
//   - the correction replaces only public.api_v1_list_workspace_members and
//     preserves its exact signature, STABLE/SECURITY DEFINER, search_path;
//   - the returned-member population requires exact Workspace membership,
//     profiles.is_active, ACTIVE tenant_memberships for the resolved
//     _tenant_id, and ACTIVE organization_memberships for the resolved
//     _tenant_id/_org_id;
//   - profiles.organization_id is NOT used as an authority rule and remains
//     only the protected-field decryption context;
//   - all other WML-1A authority/response behavior is unchanged;
//   - no membership repair, mutation, PMG, audit write, idempotency,
//     service-role path or dynamic SQL is introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-Q WML-1A-C1 — Workspace Member Lookup returned-member Tenant/Organization containment";

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

Deno.test("C1: replaces only the wrapper, exact signature and security attributes preserved", () => {
  assert(FLAT.includes(SIG), "exact wrapper signature must be preserved");
  assert(countOf(FLAT, "CREATE OR REPLACE FUNCTION") === 1);
  assert(!FLAT.includes("DROP FUNCTION"));
  assert(!FLAT.includes("public.ws_list_members"), "ws_list_members untouched");
  // Capability catalogue row is not touched by the correction.
  assert(!FLAT.includes("api_capability_catalogue"));
});

Deno.test("C1: returned member requires exact Workspace membership and active profile", () => {
  assert(
    FLAT.includes(
      "FROM public.workspace_memberships wm JOIN public.profiles p ON p.id = wm.user_id WHERE wm.workspace_id = _workspace_id AND p.is_active = true",
    ),
  );
});

Deno.test("C1: returned member requires ACTIVE Tenant membership for the resolved Tenant", () => {
  assert(
    FLAT.includes(
      "EXISTS ( SELECT 1 FROM public.tenant_memberships mtm WHERE mtm.tenant_id = _tenant_id AND mtm.user_id = p.id AND mtm.status = 'active' AND mtm.deactivated_at IS NULL )",
    ),
  );
});

Deno.test("C1: returned member requires ACTIVE Organization membership for the resolved Tenant/Organization", () => {
  assert(
    FLAT.includes(
      "EXISTS ( SELECT 1 FROM public.organization_memberships mom WHERE mom.tenant_id = _tenant_id AND mom.organization_id = _org_id AND mom.user_id = p.id AND mom.status = 'active' AND mom.deactivated_at IS NULL )",
    ),
  );
});

Deno.test("C1: containment uses server-resolved scope variables only, never caller input", () => {
  // The member-side membership predicates bind to the derived scope variables.
  assert(countOf(FLAT, "mtm.tenant_id = _tenant_id") === 1);
  assert(countOf(FLAT, "mom.tenant_id = _tenant_id") === 1);
  assert(countOf(FLAT, "mom.organization_id = _org_id") === 1);
  // Scope derivation itself is unchanged.
  assert(FLAT.includes("SELECT t.id, o.id INTO _tenant_id, _org_id"));
  assert(!SIG.includes("_tenant_id uuid"));
  assert(!SIG.includes("_organization_id uuid"));
});

Deno.test("C1: profiles.organization_id is NOT an authority rule", () => {
  for (
    const forbidden of [
      "p.organization_id = _org_id",
      "p.organization_id = _organization_id",
      "profiles.organization_id = _org_id",
      "p.organization_id IN",
      "AND p.organization_id =",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `must not use as authority: ${forbidden}`);
  }
});

Deno.test("C1: p.organization_id remains only the protected-field decryption context", () => {
  assert(countOf(FLAT, "public.btpm_decrypt(p.display_name, p.organization_id)") === 1);
  assert(countOf(FLAT, "public.btpm_decrypt(p.email, p.organization_id)") === 1);
  assert(countOf(FLAT, "public.btpm_decrypt(") === 2);
  // Every p.organization_id occurrence belongs to the decryption CASE guards.
  assert(countOf(FLAT, "p.organization_id") === 4);
  assert(countOf(FLAT, "p.organization_id IS NOT NULL") === 2);
  assert(!FLAT.includes("btpm_encrypt"));
  assert(!/CREATE (OR REPLACE )?TRIGGER/.test(FLAT));
});

Deno.test("C1: caller-side authorization, capability and Connected App containment unchanged", () => {
  assert(
    countOf(FLAT, "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)") === 1,
  );
  assert(FLAT.includes("JOIN public.tenants t ON t.id = o.tenant_id AND t.status = 'active'"));
  assert(FLAT.includes("t.suspended_at IS NULL"));
  assert(FLAT.includes("t.archived_at IS NULL"));
  assert(FLAT.includes("t.purged_at IS NULL"));
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
  assert(FLAT.includes("WHERE w.id = _workspace_id AND w.is_active = true AND w.is_archived = false"));
  assert(
    FLAT.includes(
      "om.role::text = 'org_admin' OR EXISTS ( SELECT 1 FROM public.workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = _uid )",
    ),
  );
  assert(countOf(FLAT, "public.api_organization_client_enablements oe") === 1);
  assert(countOf(FLAT, "public.api_workspace_client_enablements we") === 1);
  assert(
    FLAT.includes(
      "g.api_version = 'v1' AND g.capability_kind = 'read' AND g.capability_key = 'workspace_members:list' AND g.lifecycle_status = 'enabled'",
    ),
  );
  assert(!FLAT.includes("g.workspace_id IS NULL"));
  assert(countOf(FLAT, "'api_v1_not_authorized' USING ERRCODE = '42501'") === 2);
  for (const forbidden of ["can_read_demo_or_member", "can_read_demo", "demo_workspace"]) {
    assert(!FLAT.includes(forbidden), `must not use ${forbidden}`);
  }
});

Deno.test("C1: response shape, search, pagination, ordering and grants unchanged", () => {
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
      "auth.users",
      "raw_user_meta_data",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `must not expose ${forbidden}`);
  }
  assert(FLAT.includes("IF _limit IS NULL OR _limit < 1 OR _limit > 100 THEN"));
  assert(FLAT.includes("IF _offset IS NULL OR _offset < 0 OR _offset > 10000 THEN"));
  assert(FLAT.includes("IF length(_search_trimmed) = 0 THEN _has_search := false;"));
  assert(FLAT.includes("IF length(_search_trimmed) > 100 THEN"));
  assert(countOf(FLAT, "'api_v1_invalid_request' USING ERRCODE = '22023'") === 4);
  assert(
    FLAT.includes(
      "WHERE NOT _has_search OR position(lower(_search_trimmed) IN lower(COALESCE(e.display_name, ''))) > 0 OR position(lower(_search_trimmed) IN lower(COALESCE(e.email, ''))) > 0",
    ),
  );
  assert(countOf(FLAT, "position(lower(_search_trimmed)") === 2);
  assert(FLAT.includes("ORDER BY sub.display_name_lower, sub.email_lower, sub.user_id"));
  assert(
    FLAT.includes(
      "row_number() OVER ( ORDER BY lower(COALESCE(f.display_name, '')), lower(COALESCE(f.email, '')), f.user_id ) AS rn",
    ),
  );
  assert(FLAT.includes("FILTER (WHERE sub.rn > _offset AND sub.rn <= _offset + _limit)"));

  const args = "public.api_v1_list_workspace_members(text, uuid, integer, integer, text)";
  assert(FLAT.includes(`REVOKE ALL ON FUNCTION ${args} FROM PUBLIC;`));
  assert(FLAT.includes(`REVOKE ALL ON FUNCTION ${args} FROM anon;`));
  assert(FLAT.includes(`GRANT EXECUTE ON FUNCTION ${args} TO authenticated;`));
  assert(!FLAT.includes("TO anon"));
  assert(!/GRANT[^;]*service_role/.test(FLAT));
});

Deno.test("C1: read path only — no membership repair, mutation, dynamic SQL or service-role path", () => {
  for (
    const forbidden of [
      "INSERT INTO",
      "UPDATE public.",
      "DELETE FROM public.",
      "EXECUTE format",
      "EXECUTE '",
      "quote_ident",
      "quote_literal",
      "service_role",
      "SUPABASE_SERVICE_ROLE",
      "pmg_build_result",
      "authorize_and_establish",
      "api_idempotency_registry",
      "api_request_activity_events",
      "SECURITY INVOKER",
      "FOR UPDATE",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `must not contain ${forbidden}`);
  }
});
