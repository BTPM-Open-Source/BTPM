/**
 * API-G.5.10A-1 — Durable API activity substrate (static verification).
 *
 * Repository-only assertions against the forward-only migration. No network,
 * no database, no Edge Function runtime involvement.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260731200400_231cdad3-f157-4a26-a95c-debb853cbef0.sql";

const CORRECTION_MIGRATION_PATH =
  "supabase/migrations/20260805090251_38ef314c-66ea-4b39-b8e3-ea4ce9eab600.sql";

const sql = await Deno.readTextFile(MIGRATION_PATH);
const correctionSql = await Deno.readTextFile(CORRECTION_MIGRATION_PATH);

Deno.test("schema and safe columns", () => {
  assert(sql.includes("API-G.5.10A-1 — Durable API activity substrate"));
  assert(sql.includes("CREATE TABLE public.api_request_activity_events"));

  for (
    const col of [
      "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
      "event_at timestamptz NOT NULL DEFAULT clock_timestamp()",
      "api_client_id uuid NOT NULL",
      "actor_user_id uuid NULL",
      "api_version text NOT NULL",
      "route_id text NOT NULL",
      "http_method text NOT NULL",
      "http_status integer NOT NULL",
      "duration_ms integer NOT NULL",
      "tenant_id uuid NULL",
      "organization_id uuid NULL",
      "workspace_id uuid NULL",
      "project_id uuid NULL",
      "correlation_id text NULL",
      "source_channel text NOT NULL DEFAULT 'btpm_api_v1'",
    ]
  ) {
    assert(sql.includes(col), `missing column: ${col}`);
  }

  for (
    const fk of [
      "REFERENCES public.api_clients(id) ON DELETE RESTRICT",
      "REFERENCES auth.users(id) ON DELETE SET NULL",
      "REFERENCES public.tenants(id) ON DELETE RESTRICT",
      "REFERENCES public.organizations(id) ON DELETE RESTRICT",
      "REFERENCES public.workspaces(id) ON DELETE RESTRICT",
      "REFERENCES public.projects(id) ON DELETE RESTRICT",
    ]
  ) {
    assert(sql.includes(fk), `missing foreign key: ${fk}`);
  }

  // Safe-field checks
  assert(sql.includes("api_version ~ '^v[1-9][0-9]*$'"));
  assert(sql.includes("route_id ~ '^[A-Za-z0-9._:-]{1,128}$'"));
  assert(
    sql.includes("http_method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD')"),
  );
  assert(sql.includes("http_status >= 100 AND http_status <= 599"));
  assert(sql.includes("duration_ms >= 0 AND duration_ms <= 3600000"));
  assert(sql.includes("correlation_id ~ '^[A-Za-z0-9_-]{1,64}$'"));
  assert(sql.includes("source_channel = 'btpm_api_v1'"));

  // Forbidden content columns
  const lowered = sql.toLowerCase();
  for (
    const forbidden of [
      "metadata",
      "jsonb",
      "request_body",
      "response_body",
      "query_string",
      "authorization",
      "access_token",
      "refresh_token",
      "cookie",
      "secret",
      "error_detail",
      "stack",
      "ip_address",
      "user_agent",
      "request_url",
      "policy_version_id",
      "grant_id",
      "acknowledgement_id",
    ]
  ) {
    assertEquals(lowered.includes(forbidden), false, `forbidden token: ${forbidden}`);
  }
});

Deno.test("scope integrity", () => {
  assert(sql.includes("CREATE OR REPLACE FUNCTION public.api_g_5_10_validate_activity_scope()"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path = public, pg_catalog"));

  // Hierarchy requirements
  assert(sql.includes("NEW.organization_id IS NOT NULL AND NEW.tenant_id IS NULL"));
  assert(
    sql.includes(
      "NEW.workspace_id IS NOT NULL AND (NEW.organization_id IS NULL OR NEW.tenant_id IS NULL)",
    ),
  );
  assert(
    sql.includes(
      "NEW.project_id IS NOT NULL AND (NEW.workspace_id IS NULL OR NEW.organization_id IS NULL OR NEW.tenant_id IS NULL)",
    ),
  );

  // Canonical re-derivation from parent tables
  assert(sql.includes("FROM public.organizations o WHERE o.id = NEW.organization_id"));
  assert(sql.includes("FROM public.workspaces w WHERE w.id = NEW.workspace_id"));
  assert(sql.includes("FROM public.projects p WHERE p.id = NEW.project_id"));
  assert(sql.includes("v_org_tenant IS DISTINCT FROM NEW.tenant_id"));
  assert(sql.includes("v_ws_org IS DISTINCT FROM NEW.organization_id"));
  assert(sql.includes("v_proj_ws IS DISTINCT FROM NEW.workspace_id"));
  assert(sql.includes("invalid_activity_scope"));

  // Insert trigger
  assert(sql.includes("CREATE TRIGGER api_request_activity_events_validate_scope"));
  assert(sql.includes("BEFORE INSERT ON public.api_request_activity_events"));
});

Deno.test("immutable and inaccessible", () => {
  assert(sql.includes("CREATE TRIGGER api_request_activity_events_reject_mutation"));
  assert(sql.includes("BEFORE UPDATE OR DELETE ON public.api_request_activity_events"));

  // Effective mutation guard comes from the correction migration.
  assert(correctionSql.includes("API-G.5.10A-1C1 — Activity immutability and controlled errors"));
  assert(
    correctionSql.includes(
      "CREATE OR REPLACE FUNCTION public.api_g_5_10_reject_activity_mutation()",
    ),
  );
  assert(correctionSql.includes("RETURNS trigger"));
  assert(correctionSql.includes("LANGUAGE plpgsql"));
  assert(correctionSql.includes("SECURITY DEFINER"));
  assert(correctionSql.includes("SET search_path = public, pg_catalog"));

  // Only UPDATE, only actor non-null -> null, only when actor is gone from auth.users,
  // and every other column byte-identical.
  assert(correctionSql.includes("IF TG_OP = 'UPDATE'"));
  assert(correctionSql.includes("AND OLD.actor_user_id IS NOT NULL"));
  assert(correctionSql.includes("AND NEW.actor_user_id IS NULL"));
  assert(
    correctionSql.includes(
      "AND (to_jsonb(NEW) - 'actor_user_id')\n           IS NOT DISTINCT FROM\n         (to_jsonb(OLD) - 'actor_user_id')",
    ),
  );
  assert(
    correctionSql.includes(
      "AND NOT EXISTS (\n       SELECT 1\n       FROM auth.users u\n       WHERE u.id = OLD.actor_user_id\n     )",
    ),
  );
  assert(correctionSql.includes("RETURN NEW;"));

  // The correction migration must not re-declare the trigger nor touch the table.
  assertEquals(/CREATE TRIGGER/i.test(correctionSql), false);
  assertEquals(/(CREATE|ALTER|DROP) TABLE/i.test(correctionSql), false);
  assertEquals(/CREATE INDEX/i.test(correctionSql), false);
  assertEquals(/CREATE POLICY/i.test(correctionSql), false);

  // No TG_OP / identifiers / row values leaked into the raised message; the sole
  // controlled condition remains invalid_activity_event.
  const guardBody = correctionSql.slice(
    correctionSql.indexOf("api_g_5_10_reject_activity_mutation"),
    correctionSql.indexOf("api_g_5_10_record_api_activity"),
  );
  const guardRaises = guardBody.match(/RAISE EXCEPTION '[^']*'/g) ?? [];
  assertEquals(guardRaises, ["RAISE EXCEPTION 'invalid_activity_event'"]);
  assertEquals(/RAISE EXCEPTION '[^']*'\s*,/.test(guardBody), false);
  assertEquals(guardBody.includes("SQLERRM"), false);

  assert(
    sql.includes("ALTER TABLE public.api_request_activity_events ENABLE ROW LEVEL SECURITY"),
  );
  assertEquals(sql.includes("CREATE POLICY"), false);

  assert(sql.includes("REVOKE ALL ON public.api_request_activity_events FROM PUBLIC;"));
  assert(sql.includes("REVOKE ALL ON public.api_request_activity_events FROM anon;"));
  assert(sql.includes("REVOKE ALL ON public.api_request_activity_events FROM authenticated;"));
  assert(
    sql.includes("GRANT SELECT, INSERT ON public.api_request_activity_events TO service_role;"),
  );

  // No UPDATE/DELETE privileges granted anywhere on the activity table.
  assertEquals(/GRANT[^;]*UPDATE[^;]*api_request_activity_events/i.test(sql), false);
  assertEquals(/GRANT[^;]*DELETE[^;]*api_request_activity_events/i.test(sql), false);
  assertEquals(/GRANT ALL[^;]*api_request_activity_events/i.test(sql), false);

  // No ordinary role receives recorder execution.
  for (const role of ["anon", "authenticated", "PUBLIC"]) {
    assertEquals(
      new RegExp(`GRANT EXECUTE[^;]*TO ${role};`).test(sql),
      false,
      `unexpected execute grant to ${role}`,
    );
  }

  // Retention/pruning explicitly deferred: no DELETE statement in this migration.
  assertEquals(/\bDELETE FROM\b/i.test(sql), false);

  // Indexes: exactly the five permitted ones.
  const indexes = sql.match(/CREATE INDEX /g) ?? [];
  assertEquals(indexes.length, 5);
  assert(sql.includes("(api_client_id, event_at DESC)"));
  assert(sql.includes("(tenant_id, api_client_id, event_at DESC)\n  WHERE tenant_id IS NOT NULL"));
  assert(
    sql.includes(
      "(organization_id, api_client_id, event_at DESC)\n  WHERE organization_id IS NOT NULL",
    ),
  );
  assert(
    sql.includes("(workspace_id, api_client_id, event_at DESC)\n  WHERE workspace_id IS NOT NULL"),
  );
  assert(
    sql.includes("(actor_user_id, api_client_id, event_at DESC)\n  WHERE actor_user_id IS NOT NULL"),
  );
});

Deno.test("recorder contract", () => {
  const signature = [
    "CREATE OR REPLACE FUNCTION public.api_g_5_10_record_api_activity(",
    "  _api_client_id uuid,",
    "  _api_version text,",
    "  _route_id text,",
    "  _http_method text,",
    "  _http_status integer,",
    "  _duration_ms integer,",
    "  _actor_user_id uuid DEFAULT NULL,",
    "  _tenant_id uuid DEFAULT NULL,",
    "  _organization_id uuid DEFAULT NULL,",
    "  _workspace_id uuid DEFAULT NULL,",
    "  _project_id uuid DEFAULT NULL,",
    "  _correlation_id text DEFAULT NULL",
    ")",
    "RETURNS uuid",
    "LANGUAGE plpgsql",
    "VOLATILE",
    "SECURITY DEFINER",
    "SET search_path = public, pg_catalog",
  ].join("\n");
  assert(sql.includes(signature), "recorder signature mismatch");
  assert(correctionSql.includes(signature), "corrected recorder signature mismatch");

  const args = "uuid, text, text, text, integer, integer, uuid, uuid, uuid, uuid, uuid, text";
  assert(
    sql.includes(
      `GRANT EXECUTE ON FUNCTION public.api_g_5_10_record_api_activity(${args}) TO service_role;`,
    ),
  );
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION public.api_g_5_10_record_api_activity(${args}) FROM ${role};`,
      ),
      `missing revoke for ${role}`,
    );
  }

  // Safe validation and normalization
  assert(sql.includes("btrim(_http_method) IS DISTINCT FROM _http_method"));
  assert(sql.includes("v_method := upper(_http_method);"));
  assert(sql.includes("_api_version !~ '^v[1-9][0-9]*$'"));
  assert(sql.includes("_route_id !~ '^[A-Za-z0-9._:-]{1,128}$'"));
  assert(sql.includes("_http_status < 100 OR _http_status > 599"));
  assert(sql.includes("_duration_ms < 0 OR _duration_ms > 3600000"));
  assert(sql.includes("_correlation_id !~ '^[A-Za-z0-9_-]{1,64}$'"));
  assert(sql.includes("invalid_activity_event"));

  // Database-generated timestamp and fixed source channel: caller supplies neither.
  assertEquals(/_event_at\s+timestamptz/.test(sql), false);
  assertEquals(/_source_channel\s+text/.test(sql), false);

  // Exactly one insert, returning the event UUID (effective definition).
  const inserts = correctionSql.match(/INSERT INTO public\.api_request_activity_events/g) ?? [];
  assertEquals(inserts.length, 1);
  assert(correctionSql.includes("RETURNING id INTO v_id;"));
  assert(correctionSql.includes("RETURN v_id;"));

  // Same validation and normalization preserved in the effective definition.
  for (
    const check of [
      "btrim(_http_method) IS DISTINCT FROM _http_method",
      "v_method := upper(_http_method);",
      "_api_version !~ '^v[1-9][0-9]*$'",
      "_route_id !~ '^[A-Za-z0-9._:-]{1,128}$'",
      "_http_status < 100 OR _http_status > 599",
      "_duration_ms < 0 OR _duration_ms > 3600000",
      "_correlation_id !~ '^[A-Za-z0-9_-]{1,64}$'",
    ]
  ) {
    assert(correctionSql.includes(check), `missing corrected validation: ${check}`);
  }

  // Controlled exception boundary.
  const recorderBody = correctionSql.slice(
    correctionSql.indexOf("api_g_5_10_record_api_activity"),
  );
  assert(
    recorderBody.includes(
      "EXCEPTION\n  WHEN foreign_key_violation\n    OR check_violation\n    OR not_null_violation\n  THEN\n    RAISE EXCEPTION 'invalid_activity_event';",
    ),
  );
  assert(recorderBody.includes("WHEN OTHERS THEN"));
  assert(recorderBody.includes("IF SQLERRM = 'invalid_activity_scope' THEN"));
  assert(recorderBody.includes("RAISE EXCEPTION 'invalid_activity_scope';"));

  // Only the two controlled conditions are ever raised, with no interpolation.
  const raises = new Set(recorderBody.match(/RAISE EXCEPTION '[^']*'/g) ?? []);
  assertEquals(
    [...raises].sort(),
    [
      "RAISE EXCEPTION 'invalid_activity_event'",
      "RAISE EXCEPTION 'invalid_activity_scope'",
    ],
  );
  assertEquals(/RAISE EXCEPTION '[^']*'\s*,/.test(recorderBody), false);
  assertEquals(/RAISE EXCEPTION[^;]*\|\|/.test(recorderBody), false);
  assertEquals(/USING\s+(MESSAGE|DETAIL|HINT)/i.test(recorderBody), false);

  // SQLERRM appears only inside the exact equality comparison.
  const sqlerrmUses = recorderBody.match(/SQLERRM[^\n]*/g) ?? [];
  assertEquals(sqlerrmUses, ["SQLERRM = 'invalid_activity_scope' THEN"]);

  // No runtime Edge Function referenced by the migration.
  assertEquals(sql.includes("supabase/functions"), false);
  assertEquals(sql.includes("btpm-api-v1"), false);
});
