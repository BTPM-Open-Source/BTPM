// API-G.5.10D-2A — Focused static tests for the Organization connected-app
// rate-profile assignment backend. Repository-only: no runtime execution,
// no network, no repository-wide source matrix.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MARKER =
  "API-G.5.10D-2A — Organization connected-app rate-profile assignment backend";
const MIGRATIONS_DIR = "supabase/migrations";
const CATALOGUE_MIGRATION =
  `${MIGRATIONS_DIR}/20260805122749_f614f2a7-99f7-4ea3-8e9a-3b6c4a2ed5d6.sql`;
const TYPES_PATH = "src/integrations/supabase/types.ts";

const TABLE = "public.api_organization_client_rate_profile_assignments";
const READ_FN = "public.api_g_5_10_get_organization_client_rate_profile";
const SET_FN = "public.api_g_5_10_set_organization_client_rate_profile";

const RETURN_FIELDS = [
  "profile_key text",
  "display_name text",
  "description text",
  "request_limit integer",
  "window_seconds integer",
  "is_default boolean",
  "is_explicit boolean",
  "assigned_at timestamptz",
];

function assignmentMigrationSql(): string {
  const hits: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = `${MIGRATIONS_DIR}/${entry.name}`;
    if (Deno.readTextFileSync(path).includes(MARKER)) hits.push(path);
  }
  assertEquals(hits.length, 1, "expected exactly one API-G.5.10D-2A migration");
  return Deno.readTextFileSync(hits[0]);
}

function sliceFunction(sql: string, qualifiedName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}`);
  assert(start > 0, `function ${qualifiedName} not defined`);
  const end = sql.indexOf("\n$$;", start);
  assert(end > start, `function ${qualifiedName} body not terminated`);
  return sql.slice(start, end);
}

// -----------------------------------------------------------------------------
// Test 1 — assignment schema and source-once integrity
// -----------------------------------------------------------------------------

Deno.test("assignment schema and source-once integrity", () => {
  const sql = assignmentMigrationSql();

  assert(sql.includes(MARKER), "exact migration marker required");
  assert(sql.includes(`CREATE TABLE ${TABLE} (`), "assignment table required");

  // Exact columns and foreign keys.
  assert(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/.test(sql));
  assert(
    /organization_id uuid NOT NULL\s+REFERENCES public\.organizations\(id\) ON DELETE CASCADE/
      .test(sql),
  );
  assert(
    /api_client_id uuid NOT NULL\s+REFERENCES public\.api_clients\(id\) ON DELETE CASCADE/
      .test(sql),
  );
  assert(
    /rate_profile_id uuid NOT NULL\s+REFERENCES public\.api_rate_limit_profile_catalogue\(id\) ON DELETE RESTRICT/
      .test(sql),
  );
  assert(
    /assigned_by uuid NOT NULL\s+REFERENCES auth\.users\(id\) ON DELETE RESTRICT/
      .test(sql),
  );
  assert(/created_at timestamptz NOT NULL DEFAULT now\(\)/.test(sql));
  assert(/updated_at timestamptz NOT NULL DEFAULT now\(\)/.test(sql));

  // Unique Organization/client constraint and required indexes.
  assert(/UNIQUE \(organization_id, api_client_id\)/.test(sql));
  assert(
    /CREATE INDEX \w+_api_client_idx\s+ON public\.api_organization_client_rate_profile_assignments \(api_client_id\)/
      .test(sql),
  );
  assert(
    /CREATE INDEX \w+_rate_profile_idx\s+ON public\.api_organization_client_rate_profile_assignments \(rate_profile_id\)/
      .test(sql),
  );

  // No Tenant/Workspace/Project/route/lifecycle or numeric-limit columns.
  const createStart = sql.indexOf(`CREATE TABLE ${TABLE} (`);
  const createBlock = sql.slice(createStart, sql.indexOf(");", createStart));
  for (
    const forbidden of [
      "tenant_id",
      "workspace_id",
      "project_id",
      "route_id",
      "profile_key",
      "request_limit",
      "window_seconds",
      "lifecycle_status",
      "enablement_status",
      "secret",
      "credential",
    ]
  ) {
    assert(
      !createBlock.includes(forbidden),
      `assignment table must not declare ${forbidden}`,
    );
  }

  // Numeric limits remain defined only in the catalogue migration.
  const catalogue = Deno.readTextFileSync(CATALOGUE_MIGRATION);
  assert(catalogue.includes("request_limit integer NOT NULL"));
  assert(catalogue.includes("window_seconds integer NOT NULL"));

  // The legacy runtime enforcement substrate is untouched (documentary
  // mentions in COMMENT text are allowed; executable references are not).
  const executable = sql.replace(/COMMENT ON[\s\S]*?;\n/g, "");
  for (
    const legacy of [
      "api_rate_limit_profiles",
      "api_rate_limit_buckets",
      "consume_api_rate_limit_v1",
    ]
  ) {
    assert(
      !executable.includes(legacy),
      `legacy runtime object ${legacy} referenced`,
    );
  }
  assert(!/CREATE TRIGGER/i.test(sql), "no trigger may be added");
  assert(
    !/ALTER TABLE public\.api_rate_limit_profile_catalogue/i.test(sql),
    "catalogue must not be altered",
  );
});

// -----------------------------------------------------------------------------
// Test 2 — effective read behavior
// -----------------------------------------------------------------------------

Deno.test("effective read behavior", () => {
  const sql = assignmentMigrationSql();
  const fn = sliceFunction(sql, READ_FN);

  // Exact signature and properties.
  assert(
    /api_g_5_10_get_organization_client_rate_profile\(\s*_organization_id uuid,\s*_api_client_id uuid\s*\)/
      .test(fn),
  );
  assert(/LANGUAGE plpgsql/.test(fn));
  assert(/\bSTABLE\b/.test(fn));
  assert(/SECURITY DEFINER/.test(fn));
  assert(/SET search_path = public, pg_catalog/.test(fn));

  // Active-user check.
  assert(fn.includes("v_actor := auth.uid();"));
  assert(fn.includes("IF NOT public.is_active_user(v_actor) THEN"));

  // Server-derived Tenant, never caller-supplied.
  assert(
    /SELECT o\.tenant_id INTO v_tenant_id\s+FROM public\.organizations o\s+WHERE o\.id = _organization_id/
      .test(fn),
  );
  const readArgs = fn.slice(fn.indexOf("("), fn.indexOf(")"));
  assert(!readArgs.includes("_tenant_id"), "no Tenant argument accepted");

  // Exact authority helper order, no Platform implicit authority.
  assert(fn.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(fn.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(!/is_platform_super_admin/i.test(fn));

  // Exact enablement containment on organization_id + api_client_id only.
  assert(
    /FROM public\.api_organization_client_enablements oe\s+WHERE oe\.organization_id = _organization_id\s+AND oe\.api_client_id = _api_client_id/
      .test(fn),
  );

  // Explicit assignment wins; missing assignment resolves the active default.
  const explicitIdx = fn.indexOf("IF v_assignment_profile_id IS NOT NULL THEN");
  assert(explicitIdx > 0, "explicit assignment branch required");
  assert(fn.includes("c.id = v_assignment_profile_id"));
  assert(fn.includes("AND c.is_default = true"));
  assert(fn.includes("v_assigned_at"));
  assert(fn.includes("NULL::timestamptz"));

  // A retired explicit selection fails rather than silently defaulting.
  const explicitBlock = fn.slice(
    explicitIdx,
    fn.indexOf("RETURN;", explicitIdx),
  );
  assert(explicitBlock.includes("c.lifecycle_status = 'active'"));
  assert(explicitBlock.includes("RAISE EXCEPTION 'rate_profile_unavailable'"));
  assert(!explicitBlock.includes("is_default = true"));

  // Exact eight returned fields.
  for (const field of RETURN_FIELDS) {
    assert(fn.includes(field), `read RPC must return ${field}`);
  }
});

// -----------------------------------------------------------------------------
// Test 3 — protected assignment command
// -----------------------------------------------------------------------------

Deno.test("protected assignment command", () => {
  const sql = assignmentMigrationSql();
  const fn = sliceFunction(sql, SET_FN);

  assert(
    /api_g_5_10_set_organization_client_rate_profile\(\s*_organization_id uuid,\s*_api_client_id uuid,\s*_profile_key text\s*\)/
      .test(fn),
  );
  assert(/LANGUAGE plpgsql/.test(fn));
  assert(/\bVOLATILE\b/.test(fn));
  assert(/SECURITY DEFINER/.test(fn));
  assert(/SET search_path = public, pg_catalog/.test(fn));

  // Profile key is the only profile input.
  const args = fn.slice(fn.indexOf("("), fn.indexOf(")"));
  for (
    const forbidden of [
      "_request_limit",
      "_window_seconds",
      "_rate_profile_id",
      "_tenant_id",
      "_route_id",
      "_lifecycle_status",
      "_assigned_by",
    ]
  ) {
    assert(!args.includes(forbidden), `caller must not supply ${forbidden}`);
  }
  assert(fn.includes("_profile_key !~ '^[a-z][a-z0-9_]{0,63}$'"));

  // Active catalogue lookup resolving exactly one profile.
  assert(fn.includes("FROM public.api_rate_limit_profile_catalogue c"));
  assert(fn.includes("c.profile_key = _profile_key"));
  assert(fn.includes("c.lifecycle_status = 'active'"));
  assert(fn.includes("IF v_match_count <> 1 THEN"));

  // Transaction-level advisory lock on the exact pair, acquired before writing.
  const lockIdx = fn.indexOf("pg_advisory_xact_lock");
  assert(lockIdx > 0, "transaction advisory lock required");
  assert(!/pg_advisory_lock\s*\(/.test(fn), "no session-level lock allowed");
  const lockBlock = fn.slice(lockIdx, fn.indexOf(");", lockIdx));
  assertEquals((lockBlock.match(/hashtextextended/g) ?? []).length, 1);
  assert(lockBlock.includes("_organization_id::text"));
  assert(lockBlock.includes("_api_client_id::text"));
  assert(lockIdx < fn.indexOf("INSERT INTO"), "lock must precede the write");

  // Exact upsert target, columns and conflict behavior.
  assert(fn.includes(`INSERT INTO ${TABLE} AS a (`));
  assert(
    /ON CONFLICT \(organization_id, api_client_id\) DO UPDATE\s+SET rate_profile_id = v_profile\.id,\s+assigned_by = v_actor,\s+updated_at = now\(\)/
      .test(fn),
  );
  const conflictBlock = fn.slice(fn.indexOf("ON CONFLICT"));
  assert(
    !conflictBlock.includes("created_at ="),
    "created_at must be preserved on conflict",
  );
  assert(fn.includes("assigned_by = v_actor"));

  // Idempotent same-profile setting stays safe (unconditional DO UPDATE).
  assert(!/DO UPDATE[\s\S]*?\bWHERE\b/.test(conflictBlock.slice(0, 400)));
  assert(fn.includes("true,"), "is_explicit is always true on success");

  // No mutation of the catalogue or the legacy runtime substrate.
  for (
    const forbidden of [
      "UPDATE public.api_rate_limit_profile_catalogue",
      "INSERT INTO public.api_rate_limit_profile_catalogue",
      "api_rate_limit_profiles",
      "api_rate_limit_buckets",
    ]
  ) {
    assert(!fn.includes(forbidden), `command must not touch ${forbidden}`);
  }
});

// -----------------------------------------------------------------------------
// Test 4 — access, errors and generated types
// -----------------------------------------------------------------------------

Deno.test("access, errors and generated types", () => {
  const sql = assignmentMigrationSql();

  // RLS enabled, no authenticated table policies.
  assert(
    new RegExp(
      `ALTER TABLE ${TABLE.replace(/\./g, "\\.")}\\s+ENABLE ROW LEVEL SECURITY`,
    ).test(sql),
  );
  assert(!/CREATE POLICY/i.test(sql), "no table policies may be created");

  // Direct table access revoked; service_role retained.
  assert(sql.includes(`REVOKE ALL ON ${TABLE} FROM PUBLIC;`));
  assert(sql.includes(`REVOKE ALL ON ${TABLE} FROM anon;`));
  assert(sql.includes(`REVOKE ALL ON ${TABLE} FROM authenticated;`));
  assert(sql.includes(`GRANT ALL ON ${TABLE} TO service_role;`));
  assert(
    !new RegExp(`GRANT (SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON ${TABLE.replace(/\./g, "\\.")} TO authenticated`)
      .test(sql),
    "no direct authenticated table grant",
  );

  // Both RPC ACLs.
  for (
    const sig of [
      `${READ_FN}(uuid, uuid)`,
      `${SET_FN}(uuid, uuid, text)`,
    ]
  ) {
    assert(sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`));
    assert(sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`));
    assert(sql.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`));
  }

  // Only controlled errors are raised.
  const raised = new Set(
    [...sql.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  );
  const allowed = new Set([
    "not_authorized",
    "connected_app_unavailable",
    "rate_profile_unavailable",
    "rate_profile_assignment_unavailable",
  ]);
  for (const err of raised) {
    assert(allowed.has(err), `uncontrolled error raised: ${err}`);
  }
  assert(!/SQLSTATE|SQLERRM/.test(sql), "no internal diagnostics exposed");

  // No automatic assignment creation or backfill.
  assert(
    !new RegExp(`INSERT INTO ${TABLE.replace(/\./g, "\\.")}[\\s\\S]{0,200}SELECT`)
      .test(sql),
    "no backfill insert allowed",
  );

  // Generated table and RPC types exist.
  const types = Deno.readTextFileSync(TYPES_PATH);
  assert(types.includes("api_organization_client_rate_profile_assignments:"));
  assert(types.includes("api_g_5_10_get_organization_client_rate_profile:"));
  assert(types.includes("api_g_5_10_set_organization_client_rate_profile:"));

  // No runtime resolver, consumer, frontend, activity or routing work added.
  for (
    const forbidden of [
      "supabaseRateLimit",
      "enforceApiRateLimit",
      "api_request_activity_events",
      "createBrowserClient",
      "useQuery",
    ]
  ) {
    assert(!sql.includes(forbidden), `out-of-scope reference: ${forbidden}`);
  }
});
