// API-G.5.10B-1 — Protected Administrative Client Activity Read Backend.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.10B-1 — Protected administrative client activity read";
const FN = "public.api_g_5_10_list_client_activity";
const TYPES = "src/integrations/supabase/types.ts";

function markerMigrations(): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = `${MIGRATIONS_DIR}/${entry.name}`;
    if (Deno.readTextFileSync(path).includes(MARKER)) out.push(path);
  }
  return out.sort();
}

function sql(): string {
  const paths = markerMigrations();
  assertEquals(paths.length, 1, "expected exactly one API-G.5.10B-1 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("API-G.5.10B-1: signature, security posture and privileges", () => {
  assertEquals(markerMigrations().length, 1);
  const s = sql();

  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(".", "\\.")}\\s*\\(\\s*_api_client_id uuid\\s*,\\s*_organization_id uuid DEFAULT NULL\\s*,\\s*_limit integer DEFAULT 50\\s*,\\s*_before_event_at timestamptz DEFAULT NULL\\s*,\\s*_before_event_id uuid DEFAULT NULL\\s*\\)`,
      "i",
    ).test(s),
    "exact five-parameter signature required",
  );

  for (
    const field of [
      "event_id uuid",
      "event_at timestamptz",
      "api_client_id uuid",
      "actor_user_id uuid",
      "api_version text",
      "route_id text",
      "http_method text",
      "http_status integer",
      "status_class text",
      "duration_ms integer",
      "tenant_id uuid",
      "organization_id uuid",
      "workspace_id uuid",
      "project_id uuid",
      "scope_level text",
      "correlation_id text",
      "source_channel text",
    ]
  ) {
    assert(s.includes(field), `missing return field: ${field}`);
  }

  assert(/LANGUAGE plpgsql/i.test(s));
  assert(/\bSTABLE\b/i.test(s));
  assert(!/\bVOLATILE\b/i.test(s));
  assert(/SECURITY DEFINER/i.test(s));
  assert(/SET search_path = public, pg_catalog/i.test(s));

  const sig = "(uuid, uuid, integer, timestamptz, uuid)";
  assert(s.includes(`REVOKE ALL ON FUNCTION ${FN}${sig} FROM PUBLIC;`));
  assert(s.includes(`REVOKE ALL ON FUNCTION ${FN}${sig} FROM anon;`));
  assert(s.includes(`GRANT EXECUTE ON FUNCTION ${FN}${sig} TO authenticated;`));

  const creates = s.match(/CREATE OR REPLACE FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(creates.length, 1, "exactly one function definition allowed");
  assert((creates[0] ?? "").includes(FN));
});

Deno.test("API-G.5.10B-1: authority modes", () => {
  const s = sql();

  assert(s.includes("v_actor uuid := auth.uid()"));
  assert(/IF v_actor IS NULL THEN\s*\n\s*RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';/.test(s));
  assert(s.includes("public.is_active_user(v_actor)"));

  // Platform mode
  assert(s.includes("v_platform_mode boolean := (_organization_id IS NULL)"));
  assert(s.includes("public.is_platform_super_admin(v_actor)"));

  // Organization mode: server-derived tenant
  assert(
    /SELECT o\.tenant_id INTO v_tenant_id[\s\S]{0,120}FROM public\.organizations o[\s\S]{0,80}WHERE o\.id = _organization_id/i
      .test(s),
  );
  assert(s.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(s.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(!s.includes("is_tenant_admin(v_actor"), "argument order must not be reversed");
  assert(!s.includes("is_org_admin(_organization_id"), "argument order must not be reversed");

  // Platform authority must not be reused inside Organization mode.
  const orgBlock = s.slice(s.indexOf("ELSE"), s.indexOf("RETURN QUERY"));
  assert(!orgBlock.includes("is_platform_super_admin"));

  // No caller-supplied Tenant identifier exists anywhere.
  assert(!/(?<![A-Za-z0-9])_tenant_id\b/.test(s));
});

Deno.test("API-G.5.10B-1: containment and keyset pagination", () => {
  const s = sql();

  assert(s.includes("WHERE e.api_client_id = _api_client_id"));
  assert(/v_platform_mode\s*\n\s*OR e\.organization_id = _organization_id/.test(s));
  assert(!/organization_id IS NULL\s*OR/.test(s), "no null-organization widening");

  // Cursor pair validation
  assert(s.includes("(_before_event_at IS NULL) <> (_before_event_id IS NULL)"));
  assert(s.includes("invalid_activity_query"));

  // Tuple keyset comparison and deterministic ordering
  assert(s.includes("(e.event_at, e.id) < (_before_event_at, _before_event_id)"));
  assert(s.includes("ORDER BY e.event_at DESC, e.id DESC"));

  // Bounded limit, no offset, no count
  assert(s.includes("_limit < 1 OR _limit > 100"));
  assert(s.includes("LIMIT _limit"));
  assert(!/\bOFFSET\b/i.test(s));
  assert(!/count\s*\(/i.test(s));
});

Deno.test("API-G.5.10B-1: safe output and unchanged substrate", () => {
  const s = sql();

  for (
    const mapping of [
      "WHEN e.http_status BETWEEN 100 AND 199 THEN 'informational'",
      "WHEN e.http_status BETWEEN 200 AND 299 THEN 'success'",
      "WHEN e.http_status BETWEEN 300 AND 399 THEN 'redirect'",
      "WHEN e.http_status BETWEEN 400 AND 499 THEN 'client_error'",
      "WHEN e.http_status BETWEEN 500 AND 599 THEN 'server_error'",
    ]
  ) {
    assert(s.includes(mapping), `missing status_class mapping: ${mapping}`);
  }

  const scope = s.slice(s.indexOf("THEN 'project'") - 200, s.indexOf("ELSE 'unscoped'"));
  assert(scope.indexOf("'project'") < scope.indexOf("'workspace'"));
  assert(scope.indexOf("'workspace'") < scope.indexOf("'organization'"));
  assert(scope.indexOf("'organization'") < scope.indexOf("'tenant'"));
  assert(s.includes("ELSE 'unscoped'"));

  // Controlled errors only
  assert(s.includes("activity_unavailable"));
  assert(!/RAISE EXCEPTION[^\n]*SQLERRM/.test(s));
  assert(!/RAISE EXCEPTION[^\n]*SQLSTATE/.test(s));
  assert(!/\|\|/.test(s), "no string concatenation in errors");

  for (
    const banned of [
      /request_body/i,
      /response_body/i,
      /query_string/i,
      /full_url/i,
      /authorization/i,
      /\btoken\b/i,
      /cookie/i,
      /secret/i,
      /ip_address/i,
      /user_agent/i,
      /public\.profiles/i,
      /\bemail\b/i,
      /btpm_decrypt/i,
      /policy_version/i,
      /acknowledgement/i,
      /rate_limit/i,
      /remaining/i,
      /resetAt/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden output surface: ${banned}`);
  }

  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /record_api_activity/i,
      /validate_activity_scope/i,
      /reject_activity_mutation/i,
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+public\./i,
      /\bDELETE\s+FROM\b/i,
      /ON CONFLICT/i,
      /\bTRUNCATE\b/i,
      /EXECUTE\s+format/i,
      /pg_advisory/i,
      /FOR UPDATE/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden substrate change: ${banned}`);
  }
  assert(!/GRANT\s+(?!EXECUTE)/i.test(s), "only EXECUTE grants may appear");

  // Generated types carry the exact new RPC contract.
  const t = Deno.readTextFileSync(TYPES);
  const i = t.indexOf("api_g_5_10_list_client_activity: {");
  assert(i > 0, "generated RPC type missing");
  const block = t.slice(i, i + 1400);
  for (
    const frag of [
      "_api_client_id: string",
      "_before_event_at?: string",
      "_before_event_id?: string",
      "_limit?: number",
      "_organization_id?: string",
      "event_id: string",
      "event_at: string",
      "status_class: string",
      "scope_level: string",
      "source_channel: string",
      "correlation_id: string",
      "duration_ms: number",
      "http_status: number",
    ]
  ) {
    assert(block.includes(frag), `generated type missing: ${frag}`);
  }
  assert(/Returns: \{[\s\S]*\}\[\]/.test(block), "typed set-returning contract required");
});
