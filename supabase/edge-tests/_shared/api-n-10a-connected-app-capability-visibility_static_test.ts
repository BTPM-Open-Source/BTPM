// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-10a-connected-app-capability-visibility_static_test.ts', import.meta.url).href;
// Step API-N.10A — Static SQL guards for Connected App capability visibility.
//
// Asserts the single additive API-N.10A migration redefines ONLY the
// Organization capability LIST function, changes visibility only, and does not
// touch the transition RPC, capability grants or Connected App enablements.
//
// Step API-N.10A-C1 — privilege posture restoration guard.
// The API-N.10A migration unintentionally granted EXECUTE to service_role.
// API-N.10A-C1 is an additive correction migration that restores the exact
// pre-N.10A privilege boundary (PUBLIC/anon/service_role revoked, authenticated
// granted) without redefining the function body or touching any visibility,
// grouping, grant or enablement behavior.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);
const MIGRATIONS_DIR = new URL("supabase/migrations/", REPO_ROOT);

// Distinct markers. The C1 marker is a strict superset string of the N.10A
// marker ("API-N.10A-C1" contains "API-N.10A"), so the N.10A lookup must
// explicitly exclude C1 to keep "exactly one" unambiguous after C1 is added.
const N10A_MARKER = "API-N.10A";
const C1_MARKER = "API-N.10A-C1";
const LIST_FN = "api_g_5_7_admin_list_organization_client_capabilities";
const TRANSITION_FN = "api_g_5_7_admin_transition_organization_client_capability";

function readMigrationByMarker(
  include: string,
  exclude?: string,
): { name: string; sql: string } {
  const matches: { name: string; sql: string }[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = Deno.readTextFileSync(new URL(entry.name, MIGRATIONS_DIR));
    if (!sql.includes(include)) continue;
    if (exclude && sql.includes(exclude)) continue;
    matches.push({ name: entry.name, sql });
  }
  return matches[0];
}

function readN10AMigration(): { name: string; sql: string } {
  const m = readMigrationByMarker(N10A_MARKER, C1_MARKER);
  assert(m, "exactly one API-N.10A migration (excluding C1) is expected");
  return m;
}

function readC1Migration(): { name: string; sql: string } {
  const matches: { name: string; sql: string }[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = Deno.readTextFileSync(new URL(entry.name, MIGRATIONS_DIR));
    if (sql.includes(C1_MARKER)) matches.push({ name: entry.name, sql });
  }
  assertEquals(matches.length, 1, "exactly one API-N.10A-C1 migration is expected");
  return matches[0];
}

// ---------------------------------------------------------------------------
// API-N.10A — visibility migration guards (unchanged behavior assertions).
// ---------------------------------------------------------------------------

Deno.test("API-N.10A migration is locatable by its marker (excluding C1)", () => {
  const { name, sql } = readN10AMigration();
  assert(/^\d{14}_.*\.sql$/.test(name));
  assertStringIncludes(sql, N10A_MARKER);
  assert(!sql.includes(C1_MARKER), "N.10A migration must not carry the C1 marker");
});

Deno.test("exactly one existing list RPC is redefined", () => {
  const { sql } = readN10AMigration();
  const creates = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)/gi) ?? [];
  assertEquals(creates.length, 1);
  assertStringIncludes((creates[0] ?? "").toLowerCase(), LIST_FN);
});

Deno.test("Organization list signature and return shape are preserved", () => {
  const { sql } = readN10AMigration();
  assertStringIncludes(
    sql,
    `public.${LIST_FN}(_organization_id uuid, _api_client_id uuid, _limit integer, _offset integer)`,
  );
  for (
    const col of [
      "api_version text",
      "capability_kind text",
      "capability_key text",
      "display_name text",
      "description text",
      "scope_level text",
      "catalogue_lifecycle_status text",
      "administrator_assignable boolean",
      "supported_capability_id uuid",
      "supported_capability_status text",
      "grant_id uuid",
      "grant_status text",
      "grant_enabled_at timestamp with time zone",
      "grant_disabled_at timestamp with time zone",
      "total_count bigint",
    ]
  ) {
    assertStringIncludes(sql, col);
  }
  assertStringIncludes(sql, "STABLE SECURITY DEFINER");
  assertStringIncludes(sql, "SET search_path TO 'public', 'pg_catalog'");
});

Deno.test("Tenant/Organization Admin authorization and containment are preserved", () => {
  const { sql } = readN10AMigration();
  assertStringIncludes(sql, "auth.uid()");
  assertStringIncludes(sql, "public.is_active_user(v_actor)");
  assertStringIncludes(sql, "public.is_tenant_admin(v_tenant_id, v_actor)");
  assertStringIncludes(sql, "public.is_org_admin(v_actor, _organization_id)");
  assertStringIncludes(sql, "SELECT o.tenant_id INTO v_tenant_id");
  assertStringIncludes(sql, "IF NOT v_client_relevant THEN");
  assertStringIncludes(sql, "not_authorized");
  assertStringIncludes(sql, "invalid_limit");
  assertStringIncludes(sql, "invalid_offset");
  assertStringIncludes(sql, "_limit < 1 OR _limit > 200");
  assertStringIncludes(sql, "_offset < 0 OR _offset > 10000");
});

Deno.test("supported capability status 'enabled' drives visibility", () => {
  const { sql } = readN10AMigration();
  const eligible = sql.slice(sql.indexOf("eligible AS ("), sql.indexOf("counted AS ("));
  assertStringIncludes(eligible, "p.supported_capability_status = 'enabled'");
});

Deno.test("visibility is not restricted to organization scope or read kind", () => {
  const { sql } = readN10AMigration();
  const eligible = sql.slice(sql.indexOf("eligible AS ("), sql.indexOf("counted AS ("));
  assert(!eligible.includes("scope_level = 'organization'"));
  assert(!eligible.includes("capability_kind = 'read'"));
  assert(!eligible.includes("administrator_assignable = true"));
  assert(!eligible.includes("catalogue_lifecycle_status = 'active'"));
});

Deno.test("retained Organization grants remain visible", () => {
  const { sql } = readN10AMigration();
  const eligible = sql.slice(sql.indexOf("eligible AS ("), sql.indexOf("counted AS ("));
  assertStringIncludes(eligible, "p.grant_id IS NOT NULL");
});

Deno.test("no transition RPC redefinition", () => {
  const { sql } = readN10AMigration();
  assert(!sql.includes(`FUNCTION public.${TRANSITION_FN}`));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.api_g_5_7_admin_transition/i.test(sql));
});

Deno.test("no grant or enablement writes", () => {
  const { sql } = readN10AMigration();
  const upper = sql.toUpperCase();
  for (const table of [
    "API_CAPABILITY_GRANTS",
    "API_ORGANIZATION_CLIENT_ENABLEMENTS",
    "API_WORKSPACE_CLIENT_ENABLEMENTS",
    "API_PROJECT_CLIENT_ENABLEMENTS",
    "API_CLIENT_SUPPORTED_CAPABILITIES",
    "API_CAPABILITY_CATALOGUE",
  ]) {
    for (const verb of ["INSERT INTO PUBLIC.", "UPDATE PUBLIC.", "DELETE FROM PUBLIC."]) {
      assert(
        !upper.includes(`${verb}${table}`),
        `unexpected write ${verb}${table}`,
      );
    }
  }
  assert(!upper.includes("ALTER TABLE"));
  assert(!upper.includes("CREATE TABLE"));
});

Deno.test("API-N.10A visibility migration grants EXECUTE to authenticated", () => {
  // The N.10A migration granted EXECUTE to authenticated (correct) but also
  // unintentionally to service_role (corrected by C1). This assertion records
  // the authenticated grant without treating service_role as accepted.
  const { sql } = readN10AMigration();
  assertStringIncludes(sql, `REVOKE ALL ON FUNCTION public.${LIST_FN}`);
  assertStringIncludes(sql, `GRANT EXECUTE ON FUNCTION public.${LIST_FN}`);
  assertStringIncludes(sql, "TO authenticated;");
});

// ---------------------------------------------------------------------------
// API-N.10A-C1 — privilege restoration guards.
// ---------------------------------------------------------------------------

Deno.test("API-N.10A-C1 migration is locatable by its marker", () => {
  const { name, sql } = readC1Migration();
  assert(/^\d{14}_.*\.sql$/.test(name));
  assertStringIncludes(sql, C1_MARKER);
});

Deno.test("C1 contains no CREATE OR REPLACE FUNCTION", () => {
  const { sql } = readC1Migration();
  assert(
    !/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql),
    "C1 must not redefine any function",
  );
});

Deno.test("C1 touches only the exact Organization capability-list function", () => {
  const { sql } = readC1Migration();
  const fnRefs = sql.match(/public\.([a-z0-9_]+)/g) ?? [];
  const distinct = new Set(fnRefs);
  assertEquals(distinct.size, 1, "C1 must reference exactly one public function");
  assertStringIncludes([...distinct][0], LIST_FN);
});

Deno.test("C1 revokes EXECUTE from PUBLIC", () => {
  const { sql } = readC1Migration();
  assertStringIncludes(
    sql,
    `REVOKE ALL ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) FROM PUBLIC;`,
  );
});

Deno.test("C1 revokes EXECUTE from anon", () => {
  const { sql } = readC1Migration();
  assertStringIncludes(
    sql,
    `REVOKE ALL ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) FROM anon;`,
  );
});

Deno.test("C1 revokes EXECUTE from service_role", () => {
  const { sql } = readC1Migration();
  assertStringIncludes(
    sql,
    `REVOKE ALL ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) FROM service_role;`,
  );
});

Deno.test("C1 grants EXECUTE to authenticated", () => {
  const { sql } = readC1Migration();
  assertStringIncludes(
    sql,
    `GRANT EXECUTE ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) TO authenticated;`,
  );
});

Deno.test("C1 never grants EXECUTE to service_role", () => {
  const { sql } = readC1Migration();
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.[\s\S]*?TO\s+service_role/i.test(sql),
    "C1 must not grant EXECUTE to service_role",
  );
});

Deno.test("C1 has no capability/grant/enablement DML", () => {
  const { sql } = readC1Migration();
  const upper = sql.toUpperCase();
  for (const table of [
    "API_CAPABILITY_GRANTS",
    "API_ORGANIZATION_CLIENT_ENABLEMENTS",
    "API_WORKSPACE_CLIENT_ENABLEMENTS",
    "API_PROJECT_CLIENT_ENABLEMENTS",
    "API_CLIENT_SUPPORTED_CAPABILITIES",
    "API_CAPABILITY_CATALOGUE",
  ]) {
    for (const verb of ["INSERT INTO PUBLIC.", "UPDATE PUBLIC.", "DELETE FROM PUBLIC."]) {
      assert(
        !upper.includes(`${verb}${table}`),
        `unexpected write ${verb}${table}`,
      );
    }
  }
});

Deno.test("C1 has no table/schema/RLS changes", () => {
  const { sql } = readC1Migration();
  const upper = sql.toUpperCase();
  assert(!upper.includes("ALTER TABLE"));
  assert(!upper.includes("CREATE TABLE"));
  assert(!upper.includes("DROP TABLE"));
  assert(!upper.includes("CREATE SCHEMA"));
  assert(!upper.includes("ALTER SCHEMA"));
  assert(!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(upper));
  assert(!/CREATE\s+POLICY/i.test(upper));
  assert(!/DROP\s+POLICY/i.test(upper));
});

Deno.test("final effective privilege contract is authenticated-only EXECUTE", () => {
  // C1 is the last privilege statement in the migration sequence, so the
  // effective runtime posture equals C1's posture: authenticated-only EXECUTE.
  const c1 = readC1Migration();

  // authenticated receives EXECUTE.
  assertStringIncludes(
    c1.sql,
    `GRANT EXECUTE ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) TO authenticated;`,
  );

  // service_role is revoked by C1 and never granted by C1.
  assertStringIncludes(
    c1.sql,
    `REVOKE ALL ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) FROM service_role;`,
  );
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.[\s\S]*?TO\s+service_role/i.test(c1.sql),
    "C1 must not grant EXECUTE to service_role",
  );

  // PUBLIC and anon are revoked by C1.
  assertStringIncludes(
    c1.sql,
    `REVOKE ALL ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) FROM PUBLIC;`,
  );
  assertStringIncludes(
    c1.sql,
    `REVOKE ALL ON FUNCTION public.${LIST_FN}(uuid, uuid, integer, integer) FROM anon;`,
  );
});
