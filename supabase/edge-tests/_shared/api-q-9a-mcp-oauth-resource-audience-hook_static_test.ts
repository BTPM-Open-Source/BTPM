// API-Q.9A — MCP OAuth resource-audience binding substrate.
//
// Repository/static contract test for the additive migration that:
//   - adds nullable `public.api_clients.oauth_resource_audience`;
//   - adds its bounded HTTPS/trimmed/whitespace-free constraint;
//   - creates the INERT Custom Access Token Hook
//     `public.btpm_custom_access_token_hook(jsonb) returns jsonb`;
//   - grants only the minimum `supabase_auth_admin` access.
//
// The hook is NOT enabled in this step. No OAuth credential, Copilot client
// ID, MCP resource URI, callback URL, Tenant/Organization/Workspace/Project
// identifier or secret is introduced anywhere.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260813070625_3d4beee2-a0f2-4087-a9bf-63758b7886d6.sql";
const CONFIG_PATH = "supabase/config.toml";

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

/** Executable SQL only: `--` comment lines removed. */
function normalizeExecutable(sql: string): string {
  return normalize(
    sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n"),
  );
}

Deno.test("API-Q.9A migration file exists", async () => {
  const stat = await Deno.stat(MIGRATION_PATH);
  assert(stat.isFile);
});

// A. nullable column
Deno.test("API-Q.9A adds nullable oauth_resource_audience", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "alter table public.api_clients add column oauth_resource_audience text null",
    ),
  );
  // Not unique: multiple approved clients may target the same resource.
  assert(!sql.includes("unique (oauth_resource_audience)"));
  assert(!sql.includes("unique(oauth_resource_audience)"));
  assert(!/create unique index[^;]*oauth_resource_audience/.test(sql));
});

// B. bounded constraint
Deno.test("API-Q.9A constraint is HTTPS-only, trimmed, bounded, whitespace-free", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("api_clients_oauth_resource_audience_bounded"));
  assert(sql.includes("oauth_resource_audience is null"));
  assert(sql.includes("length(oauth_resource_audience) > 0"));
  assert(
    sql.includes("oauth_resource_audience = btrim(oauth_resource_audience)"),
  );
  assert(sql.includes("length(oauth_resource_audience) <= 2048"));
  assert(sql.includes("oauth_resource_audience like 'https://%'"));
  assert(sql.includes("oauth_resource_audience !~ '\\s'"));
});

// C / D. hook signature and NOT SECURITY DEFINER
Deno.test("API-Q.9A hook takes one jsonb event and returns jsonb", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "create or replace function public.btpm_custom_access_token_hook(event jsonb) returns jsonb",
    ),
  );
  assert(sql.includes("language plpgsql"));
  assert(sql.includes("set search_path = ''"));
});

Deno.test("API-Q.9A hook is NOT security definer", async () => {
  const sql = normalizeExecutable(await readMigration());
  assert(!sql.includes("security definer"));
});

// E / F. execution privileges
Deno.test("API-Q.9A revokes hook execution from PUBLIC/anon/authenticated", async () => {
  const sql = normalize(await readMigration());
  for (const grantee of ["public", "anon", "authenticated"]) {
    assert(
      sql.includes(
        "revoke execute on function public.btpm_custom_access_token_hook(jsonb) from " +
          grantee,
      ),
      grantee,
    );
  }
});

Deno.test("API-Q.9A grants hook execution to supabase_auth_admin only", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "grant execute on function public.btpm_custom_access_token_hook(jsonb) to supabase_auth_admin",
    ),
  );
  const grants = sql.match(
    /grant execute on function public\.btpm_custom_access_token_hook\(jsonb\) to [a-z_]+/g,
  ) ?? [];
  assert(grants.length === 1);
  assert(!sql.includes("to service_role"));
});

// G. narrow column-level SELECT, no writes
Deno.test("API-Q.9A grants only the three required SELECT columns", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "grant select (oauth_client_id, lifecycle_status, oauth_resource_audience) on public.api_clients to supabase_auth_admin",
    ),
  );
  assert(!/grant[^;]*insert[^;]*supabase_auth_admin/.test(sql));
  assert(!/grant[^;]*update[^;]*supabase_auth_admin/.test(sql));
  assert(!/grant[^;]*delete[^;]*supabase_auth_admin/.test(sql));
  assert(!/grant all[^;]*supabase_auth_admin/.test(sql));
  // Narrow RLS read for the lookup only.
  assert(sql.includes("on public.api_clients for select to supabase_auth_admin"));
  assert(!sql.includes("drop policy"));
  assert(!sql.includes("disable row level security"));
});

// H. events without a trusted client ID are returned unchanged
Deno.test("API-Q.9A returns the event unchanged when no client ID is present", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "if v_event_client_id is null and v_claims_client_id is null then return event",
    ),
  );
});

// I. only an active configured client can modify aud
Deno.test("API-Q.9A audience lookup requires active + configured client", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("from public.api_clients as c"));
  assert(sql.includes("where c.oauth_client_id = v_client_id"));
  assert(sql.includes("and c.lifecycle_status = 'active'"));
  assert(sql.includes("and c.oauth_resource_audience is not null"));
  assert(sql.includes("if v_resource is null then return event"));
  // No auto-provisioning or activation.
  assert(!/insert into public\.api_clients/.test(sql));
  assert(!/update public\.api_clients set/.test(sql));
});

// J. mismatched client identity fails closed without disclosure
Deno.test("API-Q.9A mismatched event/claims client_id fails closed", async () => {
  const sql = await readMigration();
  const n = normalize(sql);
  assert(n.includes("if v_event_client_id <> v_claims_client_id then"));
  assert(
    n.includes(
      "raise exception 'btpm_custom_access_token_hook: inconsistent client identity'",
    ),
  );
  // No value interpolation in any exception text.
  for (const message of sql.match(/raise exception '[^']*'/g) ?? []) {
    assert(!message.includes("%"), message);
  }
});

// K / L / M. audience preservation and de-duplication
Deno.test("API-Q.9A preserves string and array audiences and never duplicates", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("if jsonb_typeof(v_aud) = 'string' then"));
  assert(sql.includes("v_new_aud := jsonb_build_array(v_claims ->> 'aud')"));
  assert(sql.includes("elsif jsonb_typeof(v_aud) = 'array' then"));
  assert(sql.includes("v_new_aud := v_aud;"));
  assert(sql.includes("if not (v_new_aud @> to_jsonb(v_resource)) then"));
  assert(sql.includes("v_new_aud := v_new_aud || to_jsonb(v_resource)"));
  // 'authenticated' is never stripped and aud is never replaced wholesale:
  // the executable body never mentions a literal audience value at all.
  assert(!normalizeExecutable(await readMigration()).includes("'authenticated'"));
});

// N. malformed aud fails closed
Deno.test("API-Q.9A malformed audience fails closed", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "raise exception 'btpm_custom_access_token_hook: invalid audience'",
    ),
  );
  assert(
    sql.includes(
      "raise exception 'btpm_custom_access_token_hook: invalid claims'",
    ),
  );
  assert(sql.includes("where jsonb_typeof(e) <> 'string'"));
});

// O. only claims.aud is replaced
Deno.test("API-Q.9A replaces only claims.aud", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes("return jsonb_set(event, array['claims', 'aud'], v_new_aud, true)"),
  );
  // No wholesale claim rebuild / removal.
  assert(!sql.includes("jsonb_build_object('claims'"));
  assert(!sql.includes("- 'aud'"));
  assert(!sql.includes("jsonb_strip_nulls"));
});

// P. no hardcoded client ID or resource URI
Deno.test("API-Q.9A hardcodes no OAuth client ID or MCP resource URI", async () => {
  const sql = await readMigration();
  assert(!/https:\/\/[a-z0-9]/i.test(sql.replace(/'https:\/\/%'/g, "")));
  assert(!/copilot/i.test(sql));
  assert(!/microsoft/i.test(sql));
  assert(!/supabase\.co/i.test(sql));
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql));
  assert(!/client_secret/i.test(sql));
  assert(!/callback/i.test(sql));
});

// Q. no business authorization in the hook
Deno.test("API-Q.9A hook contains no business authorization queries", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "organization_memberships",
      "workspace_memberships",
      "project_memberships",
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_user_policy_acknowledgements",
      "tenants",
      "has_role",
    ]
  ) {
    assert(!sql.includes(forbidden), forbidden);
  }
});

// R. no secret/token persistence
Deno.test("API-Q.9A introduces no secret or token persistence", async () => {
  const sql = normalizeExecutable(await readMigration());
  for (
    const forbidden of [
      "refresh_token",
      "authorization_code",
      " access_token",
      "tenant_secret_refs",
      "vault.",
      "pgsodium",
    ]
  ) {
    assert(!sql.includes(forbidden), forbidden);
  }
  // No hook activation in the repository.
  assert(!sql.includes("auth.hook"));
  assert(!sql.includes("custom_access_token_hook_uri"));
});

// Gateway posture
Deno.test("API-Q.9A config.toml disables gateway JWT verification for btpm-mcp", async () => {
  const config = await Deno.readTextFile(CONFIG_PATH);
  const index = config.indexOf("[functions.btpm-mcp]");
  assert(index >= 0);
  const section = config.slice(index, index + 200);
  assert(/verify_jwt\s*=\s*false/.test(section));
  // The Custom Access Token Hook must remain disabled.
  assert(!config.includes("[auth.hook.custom_access_token]"));
});
