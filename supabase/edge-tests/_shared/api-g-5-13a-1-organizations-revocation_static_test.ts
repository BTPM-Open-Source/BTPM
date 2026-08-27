// API-G.5.13A-1 — Static verification of the Organizations capability
// revocation fail-closed migration.
//
// These tests read the migration source only. They open no network
// connection, construct no Supabase client, and touch no database.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260805160707_dd986ae2-0916-499a-bd3f-4b6a5f4a21e9.sql";

const SQL = await Deno.readTextFile(MIGRATION_PATH);

Deno.test("API-G.5.13A-1 Test 1 — function contract preserved", () => {
  assert(SQL.includes("API-G.5.13A-1"), "migration marker present");

  assert(
    SQL.includes("CREATE OR REPLACE FUNCTION public.api_v1_list_organizations("),
    "forward-only replacement of the exact function",
  );
  assert(SQL.includes("_expected_oauth_client_id text,"));
  assert(SQL.includes("_limit integer DEFAULT 50,"));
  assert(SQL.includes("_offset integer DEFAULT 0,"));
  assert(SQL.includes("_search text DEFAULT NULL"));

  assert(SQL.includes("RETURNS jsonb"), "RETURNS jsonb");
  assert(SQL.includes("LANGUAGE plpgsql"), "LANGUAGE plpgsql");
  assert(SQL.includes("\nSTABLE\n"), "STABLE");
  assert(SQL.includes("SECURITY DEFINER"), "SECURITY DEFINER");
  assert(SQL.includes("SET search_path = pg_catalog"), "fixed search path");

  // authenticated-only execution posture
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_list_organizations(text, integer, integer, text) FROM PUBLIC;",
    ),
  );
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_list_organizations(text, integer, integer, text) FROM anon;",
    ),
  );
  assert(
    SQL.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_list_organizations(text, integer, integer, text) TO authenticated;",
    ),
  );

  // Exactly one function is defined by this migration.
  assertEquals(SQL.split("CREATE OR REPLACE FUNCTION").length - 1, 1);
});

Deno.test("API-G.5.13A-1 Test 2 — revocation fails closed", () => {
  const principalIdx = SQL.indexOf(
    "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
  );
  const precheckIdx = SQL.indexOf("IF NOT EXISTS (");
  const eligibleIdx = SQL.indexOf("WITH eligible AS (");

  assert(principalIdx > 0, "delegated principal resolution present");
  assert(precheckIdx > principalIdx, "precheck after principal resolution");
  assert(eligibleIdx > precheckIdx, "precheck before eligible CTE");

  const precheck = SQL.slice(precheckIdx, eligibleIdx);

  assert(precheck.includes("t.status = 'active'"), "active Tenant");
  assert(
    precheck.includes("tm.user_id = _uid") &&
      precheck.includes("tm.status = 'active'") &&
      precheck.includes("tm.deactivated_at IS NULL"),
    "active Tenant membership",
  );
  assert(
    precheck.includes("om.user_id = _uid") &&
      precheck.includes("om.status = 'active'") &&
      precheck.includes("om.deactivated_at IS NULL"),
    "active Organization membership",
  );
  assert(
    precheck.includes("public.api_organization_client_enablements") &&
      precheck.includes("e.api_client_id = _client_id") &&
      precheck.includes("e.lifecycle_status = 'enabled'"),
    "enabled Organization client connection",
  );
  assert(
    precheck.includes("public.api_capability_grants") &&
      precheck.includes("g.api_client_id = _client_id") &&
      precheck.includes("g.workspace_id IS NULL") &&
      precheck.includes("g.api_version = 'v1'") &&
      precheck.includes("g.capability_kind = 'read'") &&
      precheck.includes("g.capability_key = 'organizations:list'") &&
      precheck.includes("g.lifecycle_status = 'enabled'"),
    "Organization-level organizations:list read grant",
  );

  assert(
    /RAISE EXCEPTION 'api_v1_not_authorized'\s*\n?\s*USING ERRCODE = '42501';/
      .test(precheck),
    "fail-closed exception with SQLSTATE 42501",
  );
});

Deno.test("API-G.5.13A-1 Test 3 — empty-result behavior preserved", () => {
  const precheckIdx = SQL.indexOf("IF NOT EXISTS (");
  const eligibleIdx = SQL.indexOf("WITH eligible AS (");
  const precheck = SQL.slice(precheckIdx, eligibleIdx);
  const collection = SQL.slice(eligibleIdx);

  // The precheck is independent of the supplied search term.
  assert(!precheck.includes("_search"), "precheck ignores _search");
  assert(!precheck.includes("_has_search"), "precheck ignores _has_search");
  assert(!precheck.includes("_limit"), "precheck ignores _limit");
  assert(!precheck.includes("_offset"), "precheck ignores _offset");

  // Search filtering remains inside the collection query.
  assert(
    collection.includes("NOT _has_search") &&
      collection.includes(
        "position(lower(_search_trimmed) IN lower(o.name)) > 0",
      ),
    "search filtering stays in the eligible CTE",
  );

  // Pagination and JSON response construction remain unchanged.
  assert(
    collection.includes(
      "row_number() OVER (ORDER BY lower(e.name), e.organization_id) AS rn",
    ),
  );
  assert(
    collection.includes("FILTER (WHERE sub.rn > _offset AND sub.rn <= _offset + _limit)"),
  );
  assert(collection.includes("COALESCE("));
  assert(collection.includes("'[]'::jsonb"));
  assert(
    collection.includes("'items', _items") &&
      collection.includes("'limit', _limit") &&
      collection.includes("'offset', _offset") &&
      collection.includes("'returned', jsonb_array_length(_items)") &&
      collection.includes("'total', _total"),
    "response shape preserved",
  );

  // An authorized request with no search matches still yields an empty
  // collection: _items defaults to '[]' and _total to 0, with no
  // authorization error raised after the precheck.
  assert(SQL.includes("_items jsonb := '[]'::jsonb;"));
  assert(SQL.includes("_total integer := 0;"));
  assertEquals(collection.includes("RAISE EXCEPTION"), false);
});
