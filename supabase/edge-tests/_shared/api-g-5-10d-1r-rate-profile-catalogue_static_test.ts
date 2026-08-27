// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-g-5-10d-1r-rate-profile-catalogue_static_test.ts', import.meta.url).href;
// API-G.5.10D-1R — Focused static verification of the fixed approved rate
// profile catalogue. Read-only inspection of exactly four artefacts:
//   - the new forward-only migration
//   - supabase/functions/_shared/btpm-api/supabaseRateLimit.ts
//   - supabase/functions/_shared/btpm-api/rateLimit.ts
//   - src/integrations/supabase/types.ts
// No repository-wide source matrix, no database access, no network access.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__).pathname;
const MIGRATION_PATH =
  `${REPO_ROOT}supabase/migrations/20260805122749_f614f2a7-99f7-4ea3-8e9a-3b6c4a2ed5d6.sql`;
const SUPABASE_RATE_LIMIT_PATH =
  `${REPO_ROOT}supabase/functions/_shared/btpm-api/supabaseRateLimit.ts`;
const RATE_LIMIT_PATH =
  `${REPO_ROOT}supabase/functions/_shared/btpm-api/rateLimit.ts`;
const TYPES_PATH = `${REPO_ROOT}src/integrations/supabase/types.ts`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const supabaseRateLimit = Deno.readTextFileSync(SUPABASE_RATE_LIMIT_PATH);
const rateLimit = Deno.readTextFileSync(RATE_LIMIT_PATH);
const types = Deno.readTextFileSync(TYPES_PATH);

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

Deno.test("API-G.5.10D-1R Test 1 — collision separation and catalogue schema", () => {
  assertStringIncludes(
    migration,
    "-- API-G.5.10D-1R — Fixed approved rate profile catalogue",
  );

  // New catalogue table only.
  assertStringIncludes(
    migration,
    "CREATE TABLE public.api_rate_limit_profile_catalogue (",
  );

  // The accepted API-G.1M runtime table is not recreated, altered, renamed,
  // dropped, truncated or policy-changed.
  for (
    const forbidden of [
      "CREATE TABLE public.api_rate_limit_profiles",
      "ALTER TABLE public.api_rate_limit_profiles",
      "DROP TABLE public.api_rate_limit_profiles",
      "TRUNCATE public.api_rate_limit_profiles",
      "RENAME",
      "public.api_rate_limit_buckets",
      "consume_api_rate_limit_v1",
    ]
  ) {
    assertEquals(
      migration.includes(forbidden),
      false,
      `migration must not contain: ${forbidden}`,
    );
  }

  // Exact catalogue columns.
  for (
    const column of [
      "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
      "profile_key text NOT NULL",
      "display_name text NOT NULL",
      "description text NOT NULL",
      "request_limit integer NOT NULL",
      "window_seconds integer NOT NULL",
      "lifecycle_status text NOT NULL DEFAULT 'active'",
      "is_default boolean NOT NULL DEFAULT false",
      "created_at timestamptz NOT NULL DEFAULT now()",
      "updated_at timestamptz NOT NULL DEFAULT now()",
    ]
  ) {
    assertStringIncludes(migration, column);
  }

  // No scope, routing, identity or secret columns exist in the table body.
  const tableBody = migration.slice(
    migration.indexOf("CREATE TABLE public.api_rate_limit_profile_catalogue ("),
    migration.indexOf("CREATE UNIQUE INDEX"),
  );
  for (
    const forbidden of [
      "api_client_id",
      "tenant_id",
      "organization_id",
      "workspace_id",
      "project_id",
      "route_id",
      "user_id",
      "secret",
      "token",
      "credential",
    ]
  ) {
    assertEquals(
      tableBody.toLowerCase().includes(forbidden),
      false,
      `catalogue table must not define column: ${forbidden}`,
    );
  }

  // Constraints and bounds.
  assertStringIncludes(migration, "^[a-z][a-z0-9_]{0,63}$");
  assertStringIncludes(
    migration,
    "CHECK (btrim(display_name) = display_name AND length(display_name) BETWEEN 1 AND 100)",
  );
  assertStringIncludes(
    migration,
    "CHECK (btrim(description) = description AND length(description) BETWEEN 1 AND 500)",
  );
  assertStringIncludes(migration, "CHECK (request_limit BETWEEN 1 AND 1000000)");
  assertStringIncludes(migration, "CHECK (window_seconds BETWEEN 1 AND 86400)");
  assertStringIncludes(
    migration,
    "CHECK (lifecycle_status IN ('active', 'retired'))",
  );
  assertStringIncludes(
    migration,
    "CHECK (is_default = false OR lifecycle_status = 'active')",
  );
  assertStringIncludes(migration, "UNIQUE (profile_key)");
  assertStringIncludes(
    migration,
    "CREATE UNIQUE INDEX api_rate_limit_profile_catalogue_single_default",
  );
  assertStringIncludes(migration, "WHERE is_default = true");

  // Bounds must equal the accepted runtime validation bounds.
  assertStringIncludes(supabaseRateLimit, "1, 1_000_000");
  assertStringIncludes(supabaseRateLimit, "1, 86_400");
});

Deno.test("API-G.5.10D-1R Test 2 — exactly one approved Standard seed", () => {
  assertEquals(
    occurrences(migration, "INSERT INTO"),
    1,
    "exactly one INSERT statement is allowed",
  );
  assertStringIncludes(
    migration,
    "INSERT INTO public.api_rate_limit_profile_catalogue (",
  );
  assertStringIncludes(
    migration,
    "'standard', 'Standard', 'Standard approved API request rate.',",
  );
  assertStringIncludes(migration, "60, 60, 'active', true");

  // No other catalogue profile keys are seeded.
  for (
    const key of [
      "restricted",
      "elevated",
      "unlimited",
      "emergency",
      "custom",
      "burst",
      "'test'",
      "development",
    ]
  ) {
    assertEquals(
      migration.includes(key),
      false,
      `migration must not seed profile: ${key}`,
    );
  }

  // No insert targets the existing runtime enforcement table.
  assertEquals(
    migration.includes("INSERT INTO public.api_rate_limit_profiles"),
    false,
  );

  // The seed must not claim runtime parity.
  for (const claim of ["parity", "copied from runtime", "effective runtime"]) {
    assertEquals(
      migration.toLowerCase().includes(claim.toLowerCase()),
      false,
      `migration must not claim: ${claim}`,
    );
  }
  assertStringIncludes(
    migration,
    "Newly approved baseline profile (not derived from runtime data).",
  );
});

Deno.test("API-G.5.10D-1R Test 3 — protected zero-argument read contract", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE FUNCTION public.api_g_5_10_list_rate_profile_catalogue()",
  );
  assertStringIncludes(migration, "LANGUAGE plpgsql");
  assertStringIncludes(migration, "STABLE");
  assertStringIncludes(migration, "SECURITY DEFINER");
  assertStringIncludes(migration, "SET search_path = public, pg_catalog");

  // Active authenticated BTPM actor requirement.
  assertStringIncludes(migration, "v_actor := auth.uid();");
  assertStringIncludes(migration, "IF v_actor IS NULL THEN");
  assertStringIncludes(migration, "IF NOT public.is_active_user(v_actor) THEN");
  assertEquals(
    occurrences(migration, "RAISE EXCEPTION 'not_authorized'"),
    2,
  );

  // Exact six returned fields, active-only filter and exact ordering.
  assertStringIncludes(
    migration,
    "RETURNS TABLE (\n  profile_key text,\n  display_name text,\n  description text,\n  request_limit integer,\n  window_seconds integer,\n  is_default boolean\n)",
  );
  assertStringIncludes(migration, "WHERE c.lifecycle_status = 'active'");
  assertStringIncludes(
    migration,
    "ORDER BY c.is_default DESC, c.profile_key ASC",
  );

  // Controlled error containment.
  assertStringIncludes(
    migration,
    "RAISE EXCEPTION 'rate_profile_catalogue_unavailable'",
  );
  for (const leak of ["SQLSTATE", "SQLERRM"]) {
    assertEquals(
      migration.includes(leak),
      false,
      `error containment must not expose ${leak}`,
    );
  }

  // No mutation path is introduced.
  for (
    const forbidden of [
      "UPDATE public.api_rate_limit_profile_catalogue",
      "DELETE FROM public.api_rate_limit_profile_catalogue",
      "CREATE TRIGGER",
      "_set_rate_profile",
      "_upsert_rate_profile",
    ]
  ) {
    assertEquals(
      migration.includes(forbidden),
      false,
      `migration must not add mutation path: ${forbidden}`,
    );
  }
  assertEquals(
    occurrences(migration, "CREATE OR REPLACE FUNCTION"),
    1,
    "exactly one function is created",
  );
});

Deno.test("API-G.5.10D-1R Test 4 — access posture, types and unchanged runtime", () => {
  // Table posture.
  assertStringIncludes(
    migration,
    "ALTER TABLE public.api_rate_limit_profile_catalogue ENABLE ROW LEVEL SECURITY;",
  );
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assertStringIncludes(
      migration,
      `REVOKE ALL ON public.api_rate_limit_profile_catalogue FROM ${role};`,
    );
  }
  assertStringIncludes(
    migration,
    "GRANT ALL ON public.api_rate_limit_profile_catalogue TO service_role;",
  );
  assertEquals(
    migration.includes("CREATE POLICY"),
    false,
    "no direct-table policy may be created",
  );

  // Function ACL.
  for (const role of ["PUBLIC", "anon"]) {
    assertStringIncludes(
      migration,
      `REVOKE ALL ON FUNCTION public.api_g_5_10_list_rate_profile_catalogue() FROM ${role};`,
    );
  }
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.api_g_5_10_list_rate_profile_catalogue() TO authenticated;",
  );
  assertEquals(
    migration.includes(
      "GRANT SELECT ON public.api_rate_limit_profile_catalogue",
    ),
    false,
  );

  // Generated types are exact for the new table and RPC.
  assertStringIncludes(types, "api_rate_limit_profile_catalogue: {");
  for (
    const field of [
      "profile_key: string",
      "display_name: string",
      "description: string",
      "request_limit: number",
      "window_seconds: number",
      "is_default: boolean",
      "lifecycle_status: string",
    ]
  ) {
    assertStringIncludes(types, field);
  }
  assertStringIncludes(
    types,
    "api_g_5_10_list_rate_profile_catalogue: {\n        Args: never\n        Returns: {\n          description: string\n          display_name: string\n          is_default: boolean\n          profile_key: string\n          request_limit: number\n          window_seconds: number\n        }[]\n      }",
  );
  // The existing runtime table type remains present and per-client/per-route.
  assertStringIncludes(types, "api_rate_limit_profiles: {");
  assertStringIncludes(types, "route_id: string");

  // Runtime rate-limit sources still target only the enforcement table and do
  // not reference the new catalogue.
  assertStringIncludes(
    supabaseRateLimit,
    'client.from("api_rate_limit_profiles")',
  );
  assertStringIncludes(
    supabaseRateLimit,
    'client.rpc("consume_api_rate_limit_v1"',
  );
  assertEquals(
    supabaseRateLimit.includes("api_rate_limit_profile_catalogue"),
    false,
  );
  assertEquals(rateLimit.includes("api_rate_limit_profile_catalogue"), false);
  assertEquals(
    rateLimit.includes("api_g_5_10_list_rate_profile_catalogue"),
    false,
  );
  assert(rateLimit.includes("enforceApiRateLimit"));

  // No assignment, activity, router or frontend implementation in the migration.
  for (
    const forbidden of [
      "api_client_rate_profile",
      "assign_rate_profile",
      "api_request_activity_events",
      "api_organization_client_enablements",
    ]
  ) {
    assertEquals(
      migration.includes(forbidden),
      false,
      `migration must not touch: ${forbidden}`,
    );
  }
});
