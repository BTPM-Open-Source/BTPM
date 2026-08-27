// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-g-5-10d-3b-c1-atomic-catalogue-cutover_static_test.ts', import.meta.url).href;
// API-G.5.10D-3B-C1 — Static tests for the atomic catalogue profile cutover.
//
// These tests read only the correction migration file. They open no network
// connection, create no database client, and consume no rate-limit buckets.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = "API-G.5.10D-3B-C1";

async function loadCorrectionMigration(): Promise<string> {
  const matches: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(
      new URL(entry.name, MIGRATIONS_DIR),
    );
    if (text.includes(MARKER)) matches.push(text);
  }
  assertEquals(matches.length, 1, "expected exactly one correction migration");
  return matches[0];
}

function functionBody(sql: string): string {
  const start = sql.indexOf("AS $$");
  const end = sql.indexOf("$$;", start);
  assert(start > 0 && end > start, "function body not found");
  return sql.slice(start, end);
}

Deno.test("API-G.5.10D-3B-C1: signature and security posture preserved", async () => {
  const sql = await loadCorrectionMigration();

  assert(
    sql.includes("CREATE OR REPLACE FUNCTION public.consume_api_rate_limit_v1("),
  );
  assert(sql.includes("_api_client_id uuid"));
  assert(sql.includes("_user_id uuid"));
  assert(sql.includes("_route_id text"));

  assert(sql.includes("allowed boolean"));
  assert(sql.includes("remaining integer"));
  assert(sql.includes("reset_at_epoch_ms bigint"));
  assert(sql.includes("effective_limit integer"));
  assert(sql.includes("effective_window_seconds integer"));

  assert(sql.includes("LANGUAGE plpgsql"));
  assert(sql.includes("VOLATILE"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path = pg_catalog"));

  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.consume_api_rate_limit_v1(uuid, uuid, text) FROM PUBLIC;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.consume_api_rate_limit_v1(uuid, uuid, text) FROM anon;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.consume_api_rate_limit_v1(uuid, uuid, text) FROM authenticated;",
    ),
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit_v1(uuid, uuid, text) TO service_role;",
    ),
  );
});

Deno.test("API-G.5.10D-3B-C1: catalogue is the sole numeric source", async () => {
  const body = functionBody(await loadCorrectionMigration());

  assert(body.includes("public.api_rate_limit_profile_catalogue"));
  assert(body.includes("c.lifecycle_status = 'active'"));
  assert(body.includes("c.is_default = true"));
  assert(body.includes("count(*)::integer"));
  assert(body.includes("v_match_count <> 1"));
  assert(body.includes("min(c.request_limit)::integer"));
  assert(body.includes("min(c.window_seconds)::integer"));
  assert(body.includes("api_g_5_10_rate_profile_unavailable"));

  assertFalse(body.includes("public.api_rate_limit_profiles"));
  assertFalse(body.includes("api_organization_client_rate_profile_assignments"));
  assertFalse(
    body.includes("api_g_5_10_get_organization_client_rate_profile"),
  );
  assertFalse(
    body.includes("api_g_5_10_set_organization_client_rate_profile"),
  );

  // No hardcoded numeric fallback profile.
  assertFalse(/\b60\b/.test(body));
  assertFalse(/COALESCE\s*\(\s*v_limit/i.test(body));
  assertFalse(/COALESCE\s*\(\s*v_window_seconds/i.test(body));
});

Deno.test("API-G.5.10D-3B-C1: atomic semantics preserved", async () => {
  const body = functionBody(await loadCorrectionMigration());

  assert(body.includes("api_g_1m_invalid_api_client_id"));
  assert(body.includes("api_g_1m_invalid_user_id"));
  assert(body.includes("api_g_1m_invalid_route_id"));

  assert(body.includes("clock_timestamp()"));
  assert(body.includes("public.api_rate_limit_buckets"));
  assert(body.includes("ON CONFLICT (api_client_id, user_id, route_id) DO UPDATE"));
  assert(body.includes("make_interval(secs => v_window_seconds)"));
  assert(body.includes("v_window_epoch_ms"));
  assert(body.includes("request_count"));
  assert(body.includes("allowed := v_stored_count <= v_limit;"));
  assert(body.includes("remaining := GREATEST(v_limit - v_stored_count, 0);"));
  assert(body.includes("effective_limit := v_limit;"));
  assert(body.includes("effective_window_seconds := v_window_seconds;"));
});
