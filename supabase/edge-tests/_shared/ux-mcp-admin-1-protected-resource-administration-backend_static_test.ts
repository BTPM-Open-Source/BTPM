// UX-MCP-ADMIN.1 — Protected Resource Administration Backend.
//
// Repository/static contract test for:
//   - the additive audit substrate + protected RPC migration;
//   - the Platform-Super-Admin-only edge function contract.
//
// No OAuth credential, Copilot client ID, MCP resource URI, callback URL,
// Tenant/Organization/Workspace/Project identifier or secret is introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FUNCTION_PATH =
  "supabase/functions/platform-api-client-protected-resource/index.ts";

function normalize(source: string): string {
  return source.replace(/\s+/g, " ");
}

async function readFunction(): Promise<string> {
  return await Deno.readTextFile(FUNCTION_PATH);
}

async function readMigration(): Promise<string> {
  const dir = "supabase/migrations";
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(`${dir}/${entry.name}`);
    if (
      sql.includes(
        "api_ux_mcp_admin_1_platform_set_client_protected_resource",
      )
    ) {
      return sql.toLowerCase();
    }
  }
  throw new Error("UX-MCP-ADMIN.1 migration not found");
}

// ---------------------------------------------------------------- migration

Deno.test("UX-MCP-ADMIN.1 audit substrate is additive and bounded", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("add column previous_protected_resource text null"));
  assert(sql.includes("add column resulting_protected_resource text null"));
  assert(sql.includes("'client_protected_resource_update'"));
  // Existing audit vocabulary preserved.
  for (
    const action of [
      "'client_create'",
      "'client_update'",
      "'client_transition'",
      "'redirect_create'",
      "'redirect_update'",
      "'redirect_transition'",
      "'policy_create'",
      "'policy_update'",
      "'policy_transition'",
      "'supported_capability_transition'",
    ]
  ) {
    assert(sql.includes(action), action);
  }
  // Bounded vocabulary, never a free-form URL in the audit record.
  assert(sql.includes("previous_protected_resource in ('none','btpm_mcp')"));
  assert(sql.includes("resulting_protected_resource in ('none','btpm_mcp')"));
  assert(!sql.includes("drop column"));
  assert(!sql.includes("delete from public.api_platform_admin_audit_events"));
});

Deno.test("UX-MCP-ADMIN.1 RPC is platform-super-admin gated and server-only", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("security definer"));
  assert(sql.includes("set search_path = public, pg_catalog"));
  assert(sql.includes("if not public.is_platform_super_admin(v_actor) then"));
  for (const grantee of ["public", "anon", "authenticated"]) {
    assert(
      sql.includes(
        "revoke all on function public.api_ux_mcp_admin_1_platform_set_client_protected_resource(uuid, uuid, text, text) from " +
          grantee,
      ),
      grantee,
    );
  }
  assert(
    sql.includes(
      "grant execute on function public.api_ux_mcp_admin_1_platform_set_client_protected_resource(uuid, uuid, text, text) to service_role",
    ),
  );
});

Deno.test("UX-MCP-ADMIN.1 RPC bounds the selection and resolved audience", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("v_type not in ('none','btpm_mcp')"));
  assert(sql.includes("v_audience not like 'https://%'"));
  assert(sql.includes("length(v_audience) > 2048"));
  assert(sql.includes("v_audience <> btrim(v_audience)"));
  assert(sql.includes("v_audience ~ '\\s'"));
  // 'none' must clear the audience, never store a sentinel string.
  assert(sql.includes("if v_type = 'none' then if v_audience is not null then"));
});

Deno.test("UX-MCP-ADMIN.1 RPC enforces lifecycle and oauth binding gates", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("for update"));
  assert(sql.includes("v_lifecycle not in ('draft','active','suspended')"));
  assert(sql.includes("if v_type = 'btpm_mcp' and v_oauth_client_id is null then"));
  // Idempotent no-op writes no audit evidence.
  assert(sql.includes("if v_previous_audience is not distinct from v_audience then"));
  assert(sql.includes("'changed', false"));
});

Deno.test("UX-MCP-ADMIN.1 RPC writes audit evidence in the same statement path", async () => {
  const sql = normalize(await readMigration());
  const update = sql.indexOf("update public.api_clients set oauth_resource_audience");
  const insert = sql.indexOf(
    "insert into public.api_platform_admin_audit_events",
  );
  assert(update > 0 && insert > update);
  assert(sql.includes("'client_protected_resource_update', v_lifecycle, v_lifecycle"));
});

Deno.test("UX-MCP-ADMIN.1 migration touches no unrelated authority surface", async () => {
  const sql = await readMigration();
  for (
    const forbidden of [
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_client_policy_versions_insert",
      "api_user_policy_acknowledgements",
      "tenant_secret_refs",
      "auth.hook",
      "client_secret",
      "drop policy",
      "disable row level security",
    ]
  ) {
    assert(!sql.includes(forbidden), forbidden);
  }
});

Deno.test("UX-MCP-ADMIN.1 migration hardcodes no resource URI or client identity", async () => {
  const sql = await readMigration();
  assert(!/https:\/\/[a-z0-9]/i.test(sql.replace(/'https:\/\/%'/g, "")));
  assert(!/copilot/i.test(sql));
  assert(!/supabase\.co/i.test(sql));
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql));
});

// ------------------------------------------------------------ edge function

Deno.test("UX-MCP-ADMIN.1 function authenticates a human session only", async () => {
  const source = normalize(await readFunction());
  assert(source.includes("createSupabaseTokenVerifier"));
  assert(source.includes("await assertBrowserSessionOnly(req, verifier)"));
  assert(source.includes('rpc("is_platform_super_admin", { _user_id: caller.id })'));
  assert(source.includes("if (isSuperAdmin !== true)"));
});

Deno.test("UX-MCP-ADMIN.1 function contract exposes no audience parameter", async () => {
  const source = await readFunction();
  const normalized = normalize(source);
  assert(
    normalized.includes(
      'const ALLOWED_BODY_KEYS = ["api_client_id", "resource_type"] as const',
    ),
  );
  assert(normalized.includes("Unsupported request parameter"));
  // The audience is never read from the request.
  assert(!/body\.[a-z_]*audience/i.test(source));
  assert(!/body\.[a-z_]*resource_uri/i.test(source));
  assert(!/body\.[a-z_]*resource_audience/i.test(source));
});

Deno.test("UX-MCP-ADMIN.1 function resolves the canonical resource server-side", async () => {
  const source = normalize(await readFunction());
  assert(
    source.includes(
      'normalizeMcpResourceUri( Deno.env.get("BTPM_MCP_RESOURCE_URI"), )',
    ) ||
      source.includes(
        'normalizeMcpResourceUri(Deno.env.get("BTPM_MCP_RESOURCE_URI"))',
      ),
  );
  // Reuses the accepted MCP protected-resource module; no second validator.
  assert(source.includes('from "../_shared/btpm-api/mcpResourceUri.ts"'));
  assert(source.includes("MCP protected resource is not configured"));
  assert(source.includes("let resolvedAudience: string | null = null"));
});

Deno.test("UX-MCP-ADMIN.1 function calls only the protected RPC with service role", async () => {
  const source = normalize(await readFunction());
  assert(source.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'));
  assert(
    source.includes(
      '"api_ux_mcp_admin_1_platform_set_client_protected_resource"',
    ),
  );
  // No direct table writes from the function.
  assert(!source.includes('.from("api_clients")'));
  assert(!source.includes('.from("api_platform_admin_audit_events")'));
  assert(!source.includes("serviceClient.auth.signIn"));
});

Deno.test("UX-MCP-ADMIN.1 function hardcodes no resource URI or client identity", async () => {
  const source = await readFunction();
  assert(!/https:\/\/[a-z0-9]/i.test(source));
  assert(!/copilot/i.test(source));
  assert(!/client_secret/i.test(source));
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(source));
});

Deno.test("UX-MCP-ADMIN.1 function is explicitly configured with verify_jwt = false (ES256 posture)", async () => {
  const config = await Deno.readTextFile("supabase/config.toml");
  const header = "[functions.platform-api-client-protected-resource]";
  const index = config.indexOf(header);
  assert(index >= 0, "missing config section for platform-api-client-protected-resource");
  const section = config.slice(index + header.length, index + header.length + 200);
  assert(
    /^\s*verify_jwt\s*=\s*false/m.test(section),
    "expected verify_jwt = false for platform-api-client-protected-resource",
  );
});
