// API-D.2 — Protected membership-aware consent-context read function.
//
// Repository contract test. Asserts the migration and function match the
// frozen contract in docs/governance/api/API_D_MEMBERSHIP_AWARE_CONSENT_CONTRACT.md
// and the API-D.2 bounded-prompt requirements:
//
//   - Exactly one new RPC: public.get_api_d_consent_context(_client_key text)
//     returning jsonb.
//   - SECURITY DEFINER with fixed `SET search_path = public`.
//   - No caller-supplied user id; derives caller via auth.uid() internally.
//   - EXECUTE revoked from PUBLIC and anon; granted only to authenticated.
//   - No table GRANTs, no new RLS policies, no browser role table access.
//   - Read-only: no INSERT / UPDATE / DELETE / audit / trigger creation.
//   - Fail-closed uniform response `{"eligible": false}`.
//   - Authoritative membership + API-C enablement joins.
//   - No internal UUIDs or sensitive fields in the safe response contract.
//   - No OAuth / API-E artifacts.
//   - No application, Edge, or browser callers reference the function yet.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260722080307_940183f6-d224-4339-accc-d843b59cd481.sql";

// API-D.2 authorization-correction migration: adds current active
// tenant_memberships authority to both the Organization and Workspace
// derivations of the effective final function.
const CORRECTION_MIGRATION_PATH =
  "supabase/migrations/20260722080907_052e8acc-fd5c-4a04-8ab0-3744f4724f38.sql";

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

async function readCorrectionMigration(): Promise<string> {
  return await Deno.readTextFile(CORRECTION_MIGRATION_PATH);
}

// API-G.5.9A-C1 migration: replaces the effective function definition, adding
// the inherited Organization-to-Workspace capability derivation while
// preserving the full API-G.5.9A contract.
const CAPABILITY_CONTEXT_MIGRATION_PATH =
  "supabase/migrations/20260731164328_5cd12dda-0e8f-48d4-bff9-a6a79826380d.sql";

// Effective final function definition is the last CREATE OR REPLACE in the
// D.2 migration chain (base + correction + API-G.5.9A + API-G.5.9A-C1).
async function readEffectiveFunctionSql(): Promise<string> {
  return await Deno.readTextFile(CAPABILITY_CONTEXT_MIGRATION_PATH);
}


function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

Deno.test("API-D.2 migration file exists", async () => {
  const stat = await Deno.stat(MIGRATION_PATH);
  assert(stat.isFile);
});

// -------------------------------------------------------------------------
// Function signature and security posture
// -------------------------------------------------------------------------

Deno.test("API-D.2 defines exactly one read RPC with the required signature", async () => {
  const raw = await readMigration();
  const sql = normalize(raw);
  assert(
    sql.includes(
      "create or replace function public.get_api_d_consent_context(_client_key text)",
    ),
  );
  assert(sql.includes("returns jsonb"));
  // Only one create/replace function statement in this migration.
  const matches = raw.match(/create\s+or\s+replace\s+function/gi) ?? [];
  assert(
    matches.length === 1,
    `expected exactly one function definition; found ${matches.length}`,
  );
});

Deno.test("API-D.2 function is SECURITY DEFINER with fixed search_path=public and stable", async () => {
  const sql = normalize(await readMigration());
  const start = sql.indexOf(
    "create or replace function public.get_api_d_consent_context(_client_key text)",
  );
  assert(start >= 0);
  const body = sql.substring(start, start + 400);
  assert(body.includes("security definer"));
  assert(body.includes("set search_path = public"));
  assert(body.includes("stable"));
});

Deno.test("API-D.2 function derives caller from auth.uid() and accepts no user-id argument", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("auth.uid()"));
  // Only argument is _client_key text.
  assert(
    sql.includes("get_api_d_consent_context(_client_key text)"),
  );
  // No caller-supplied user id parameter.
  assert(!sql.includes("_user_id"));
  assert(!sql.includes("caller_user_id"));
});

Deno.test("API-D.2 EXECUTE is revoked from PUBLIC and anon and granted only to authenticated", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes(
      "revoke all on function public.get_api_d_consent_context(text) from public",
    ),
  );
  assert(
    sql.includes(
      "revoke all on function public.get_api_d_consent_context(text) from anon",
    ),
  );
  assert(
    sql.includes(
      "grant execute on function public.get_api_d_consent_context(text) to authenticated",
    ),
  );
  assert(
    !sql.includes(
      "grant execute on function public.get_api_d_consent_context(text) to anon",
    ),
  );
  assert(
    !sql.includes(
      "grant execute on function public.get_api_d_consent_context(text) to public",
    ),
  );
  assert(
    !sql.includes(
      "grant execute on function public.get_api_d_consent_context(text) to service_role",
    ),
  );
});

// -------------------------------------------------------------------------
// Fail-closed authority derivation
// -------------------------------------------------------------------------

Deno.test("API-D.2 validates _client_key with a bounded normalized regex", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("length(_client_key)"));
  assert(sql.includes("^[a-z0-9][a-z0-9_.-]{1,62}[a-z0-9]$"));
});

Deno.test("API-D.2 requires an active, non-deactivated caller profile", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("from public.profiles"));
  assert(sql.includes("p.is_active = true"));
});

Deno.test("API-D.2 resolves an active client by exact client_key and a single active policy version", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("from public.api_clients"));
  assert(sql.includes("client_key = _client_key"));
  assert(sql.includes("lifecycle_status = 'active'"));
  assert(sql.includes("from public.api_client_policy_versions"));
  // Ambiguity is a fail-closed condition.
  assert(sql.includes("_policy_count <> 1"));
});

Deno.test("API-D.2 derives eligible Organizations from authoritative membership ∩ active tenant chain ∩ API-C org enablement", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("from public.organization_memberships om"));
  assert(sql.includes("join public.organizations o"));
  assert(sql.includes("join public.tenants t"));
  assert(sql.includes("join public.api_organization_client_enablements oe"));
  assert(sql.includes("om.status = 'active'"));
  assert(sql.includes("om.deactivated_at is null"));
  assert(sql.includes("t.status = 'active'"));
  assert(sql.includes("t.suspended_at is null"));
  assert(sql.includes("t.archived_at is null"));
  assert(sql.includes("t.purged_at is null"));
  assert(sql.includes("oe.lifecycle_status = 'enabled'"));
  // Eligibility gate: at least one eligible Org.
  assert(sql.includes("if _org_count = 0"));
});

Deno.test("API-D.2 derives eligible Workspaces independently and requires the org to also be independently eligible", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("from public.workspace_memberships wm"));
  assert(sql.includes("join public.workspaces w"));
  assert(sql.includes("join public.api_workspace_client_enablements we"));
  assert(sql.includes("we.lifecycle_status = 'enabled'"));
  assert(sql.includes("w.is_active = true"));
  assert(sql.includes("w.is_archived = false"));
  // Independent org re-derivation for the workspace's parent org.
  assert(sql.includes("join public.organization_memberships om2"));
  assert(sql.includes("join public.api_organization_client_enablements oe2"));
});

Deno.test("API-D.2 checks acknowledgement only for the exact user/client/current policy version and only when not revoked", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("from public.api_user_policy_acknowledgements"));
  assert(sql.includes("user_id = _uid"));
  assert(sql.includes("api_client_id = _client.id"));
  assert(sql.includes("policy_version_id = _policy.id"));
  assert(sql.includes("revoked_at is null"));
});

// -------------------------------------------------------------------------
// Safe response contract
// -------------------------------------------------------------------------

Deno.test("API-D.2 returns a uniform fail-closed response with no client/policy/membership detail", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("jsonb_build_object('eligible', false)"));
});

Deno.test("API-D.2 eligible response exposes only the safe display keys", async () => {
  const sql = normalize(await readEffectiveFunctionSql());
  for (
    const key of [
      "'eligible', true",
      "'client'",
      "'client_key'",
      "'display_name'",
      "'policy'",
      "'version'",
      "'policy_uri'",
      "'policy_digest'",
      "'effective_at'",
      "'acknowledged'",
      "'organizations'",
      "'workspaces'",
      "'count'",
      "'display_names'",
      // API-G.5.9A generic capability context (catalogue-controlled only).
      "'capabilities'",
      "'api_version'",
      "'description'",
      "'scope_level'",
    ]
  ) {
    assert(sql.includes(key.toLowerCase()), `response must expose ${key}`);
  }
});

Deno.test("API-D.2 response contract omits internal UUIDs and sensitive fields", async () => {
  const sql = normalize(await readEffectiveFunctionSql());

  // These identifiers must never appear as jsonb keys in the response.
  for (
    const forbiddenKey of [
      "'tenant_id'",
      "'organization_id'",
      "'workspace_id'",
      "'user_id'",
      "'api_client_id'",
      "'policy_version_id'",
      "'membership_id'",
      "'enablement_id'",
      "'reason'",
      "'policy_body'",
      "'policy_text'",
      "'access_token'",
      "'refresh_token'",
      "'id_token'",
      "'client_secret'",
    ]
  ) {
    assert(
      !sql.includes(`jsonb_build_object(${forbiddenKey}`) &&
        !sql.includes(`, ${forbiddenKey},`) &&
        !sql.includes(`, ${forbiddenKey} ,`) &&
        !sql.includes(`(${forbiddenKey},`),
      `response must not expose ${forbiddenKey}`,
    );
  }
});

// -------------------------------------------------------------------------
// Read-only / no audit / no OAuth artifacts
// -------------------------------------------------------------------------

Deno.test("API-D.2 migration is read-only — no writes, triggers, tables, or policies", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "insert into public.",
      "update public.",
      "delete from public.",
      "create table ",
      "create trigger ",
      "create policy ",
      "alter table public.",
      "drop policy",
      "drop table",
      "enable row level security",
    ]
  ) {
    assert(
      !sql.includes(forbidden),
      `migration must not contain: ${forbidden}`,
    );
  }
});

Deno.test("API-D.2 migration introduces no OAuth / API-E artifacts", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "access_token",
      "refresh_token",
      "id_token",
      "client_secret",
      "authorization_code",
      "code_verifier",
      "code_challenge",
      "custom_access_token_hook",
      "supabase_auth_hooks",
      "oauth",
    ]
  ) {
    assert(
      !sql.includes(forbidden),
      `migration must not reference ${forbidden}`,
    );
  }
});

Deno.test("API-D.2 migration does not grant browser roles direct access to API-C or membership tables", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "grant select on public.api_clients",
      "grant select on public.api_client_policy_versions",
      "grant select on public.api_organization_client_enablements",
      "grant select on public.api_workspace_client_enablements",
      "grant select on public.api_user_policy_acknowledgements",
      "grant select on public.api_capability_grants",
      "grant insert on public.api_",
      "grant update on public.api_",
      "grant delete on public.api_",
      "grant select on public.organization_memberships",
      "grant select on public.workspace_memberships",
    ]
  ) {
    assert(
      !sql.includes(forbidden),
      `migration must not grant browser access: ${forbidden}`,
    );
  }
});

// -------------------------------------------------------------------------
// No runtime callers yet
// -------------------------------------------------------------------------

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }
      out.push(...(await walk(path)));
    } else if (entry.isFile) {
      out.push(path);
    }
  }
  return out;
}

Deno.test(
  "API-D.2 read function callers are limited to the approved API-D.4 UX surfaces and API-C/D static tests",
  async () => {
    const roots = ["src", "supabase/functions"];
    const offenders: string[] = [];
    const isStaticContractTest = (p: string): boolean =>
      p.startsWith("supabase/functions/_shared/") &&
      p.endsWith("_static_test.ts");
    // API-D.4 approved runtime surfaces (production consent UX).
    const APPROVED_API_D_4_CALLERS = new Set<string>([
      "src/hooks/useApiDConsent.ts",
      "src/pages/ConsentApiD.tsx",
      "src/pages/__tests__/ConsentApiD.test.tsx",
      "src/lib/__tests__/apiDConsent.test.ts",
      "src/lib/__tests__/apiDConsentLoginReturn.test.ts",
    ]);
    for (const root of roots) {
      let files: string[] = [];
      try {
        files = await walk(root);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith("src/integrations/supabase/types.ts")) continue;
        if (isStaticContractTest(file)) continue;
        if (APPROVED_API_D_4_CALLERS.has(file)) continue;
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
        const text = await Deno.readTextFile(file);
        if (text.includes("get_api_d_consent_context")) {
          offenders.push(file);
        }
      }
    }
    assert(
      offenders.length === 0,
      `Unexpected runtime callers reference API-D.2 function: ${
        offenders.join(", ")
      }`,
    );
  },
);

// -------------------------------------------------------------------------
// API-D.2 authorization correction — current tenant-membership authority
// -------------------------------------------------------------------------

Deno.test("API-D.2 correction migration file exists", async () => {
  const stat = await Deno.stat(CORRECTION_MIGRATION_PATH);
  assert(stat.isFile);
});

Deno.test("API-D.2 correction migration replaces the same function with the same signature and preserves security posture", async () => {
  const raw = await readCorrectionMigration();
  const sql = normalize(raw);
  assert(
    sql.includes(
      "create or replace function public.get_api_d_consent_context(_client_key text)",
    ),
  );
  assert(sql.includes("returns jsonb"));
  assert(sql.includes("security definer"));
  assert(sql.includes("set search_path = public"));
  assert(sql.includes("stable"));
  assert(sql.includes("auth.uid()"));
  const matches = raw.match(/create\s+or\s+replace\s+function/gi) ?? [];
  assert(
    matches.length === 1,
    `expected exactly one function definition in correction; found ${matches.length}`,
  );
  // Privileges must be re-asserted by the correction migration itself.
  assert(
    sql.includes(
      "revoke all on function public.get_api_d_consent_context(text) from public",
    ),
  );
  assert(
    sql.includes(
      "revoke all on function public.get_api_d_consent_context(text) from anon",
    ),
  );
  assert(
    sql.includes(
      "grant execute on function public.get_api_d_consent_context(text) to authenticated",
    ),
  );
});

Deno.test("API-D.2 correction migration is read-only — no writes, triggers, tables, policies, or new grants", async () => {
  const sql = normalize(await readCorrectionMigration());
  for (
    const forbidden of [
      "insert into public.",
      "update public.",
      "delete from public.",
      "create table ",
      "create trigger ",
      "create policy ",
      "alter table public.",
      "drop policy",
      "drop table",
      "enable row level security",
      "grant execute on function public.get_api_d_consent_context(text) to anon",
      "grant execute on function public.get_api_d_consent_context(text) to public",
      "grant execute on function public.get_api_d_consent_context(text) to service_role",
      "grant select on public.",
      "grant insert on public.",
      "grant update on public.",
      "grant delete on public.",
    ]
  ) {
    assert(
      !sql.includes(forbidden),
      `correction migration must not contain: ${forbidden}`,
    );
  }
});

Deno.test("API-D.2 effective final function response contract is unchanged (no new fields, no UUID leakage)", async () => {
  const sql = normalize(await readEffectiveFunctionSql());
  for (
    const key of [
      "'eligible', true",
      "'client'",
      "'client_key'",
      "'display_name'",
      "'policy'",
      "'version'",
      "'policy_uri'",
      "'policy_digest'",
      "'effective_at'",
      "'acknowledged'",
      "'organizations'",
      "'workspaces'",
      "'count'",
      "'display_names'",
      "jsonb_build_object('eligible', false)",
    ]
  ) {
    assert(
      sql.includes(key.toLowerCase()),
      `effective response must expose ${key}`,
    );
  }
  for (
    const forbiddenKey of [
      "'tenant_id'",
      "'organization_id'",
      "'workspace_id'",
      "'user_id'",
      "'api_client_id'",
      "'policy_version_id'",
      "'membership_id'",
      "'enablement_id'",
    ]
  ) {
    assert(
      !sql.includes(`jsonb_build_object(${forbiddenKey}`) &&
        !sql.includes(`, ${forbiddenKey},`) &&
        !sql.includes(`(${forbiddenKey},`),
      `effective response must not expose ${forbiddenKey}`,
    );
  }
});

Deno.test("API-D.2 effective final Organization derivation requires current active tenant_memberships for the caller on the authoritative tenant", async () => {
  const sql = normalize(await readEffectiveFunctionSql());

  // Locate the Organization derivation block.
  const orgStart = sql.indexOf("from public.organization_memberships om");
  assert(orgStart >= 0, "Organization derivation block not found");
  const orgEnd = sql.indexOf("if _org_count = 0", orgStart);
  assert(orgEnd > orgStart, "Organization derivation terminator not found");
  const orgBlock = sql.substring(orgStart, orgEnd);

  assert(
    orgBlock.includes("join public.tenant_memberships"),
    "Organization derivation must join public.tenant_memberships",
  );
  // Tenant chain must be the authoritative tenant t.id.
  assert(
    /join\s+public\.tenant_memberships\s+\w+\s+on\s+\w+\.tenant_id\s*=\s*t\.id/
      .test(orgBlock),
    "tenant_memberships must be joined on the authoritative tenant t.id",
  );
  // Caller-bound and canonical active/non-deactivated status.
  assert(
    /and\s+\w+\.user_id\s*=\s*_uid/.test(orgBlock),
    "tenant_memberships join must bind to auth.uid() via _uid",
  );
  assert(
    /and\s+\w+\.status\s*=\s*'active'/.test(orgBlock),
    "tenant_memberships join must require status = 'active'",
  );
  assert(
    /and\s+\w+\.deactivated_at\s+is\s+null/.test(orgBlock),
    "tenant_memberships join must require deactivated_at IS NULL",
  );
});

Deno.test("API-D.2 effective final Workspace derivation independently requires current active tenant_memberships for the caller on the workspace's authoritative tenant", async () => {
  const sql = normalize(await readEffectiveFunctionSql());

  // Locate the Workspace derivation block.
  const wsStart = sql.indexOf("from public.workspace_memberships wm");
  assert(wsStart >= 0, "Workspace derivation block not found");
  const wsEnd = sql.indexOf(
    "from public.api_user_policy_acknowledgements",
    wsStart,
  );
  assert(wsEnd > wsStart, "Workspace derivation terminator not found");
  const wsBlock = sql.substring(wsStart, wsEnd);

  // Workspace derivation must join tenant_memberships independently from
  // the org-side authority (two tenant_memberships joins: primary + org-mirror).
  const tmJoins =
    wsBlock.match(/join\s+public\.tenant_memberships\s+\w+\s+on\s+/g) ?? [];
  assert(
    tmJoins.length >= 1,
    "Workspace derivation must join public.tenant_memberships at least once",
  );
  assert(
    /join\s+public\.tenant_memberships\s+\w+\s+on\s+\w+\.tenant_id\s*=\s*t\.id/
      .test(wsBlock),
    "Workspace tenant_memberships join must bind to the authoritative tenant t.id",
  );
  assert(
    /and\s+\w+\.user_id\s*=\s*_uid/.test(wsBlock),
    "Workspace tenant_memberships join must bind to auth.uid() via _uid",
  );
  assert(
    /and\s+\w+\.status\s*=\s*'active'/.test(wsBlock),
    "Workspace tenant_memberships join must require status = 'active'",
  );
  assert(
    /and\s+\w+\.deactivated_at\s+is\s+null/.test(wsBlock),
    "Workspace tenant_memberships join must require deactivated_at IS NULL",
  );
});

Deno.test("API-D.2 effective final function preserves the Tenant → Organization → Workspace consistency chain", async () => {
  const sql = normalize(await readEffectiveFunctionSql());
  // Tenant chain still enforced.
  assert(sql.includes("t.status = 'active'"));
  assert(sql.includes("t.suspended_at is null"));
  assert(sql.includes("t.archived_at is null"));
  assert(sql.includes("t.purged_at is null"));
  // Organization membership still authoritative.
  assert(sql.includes("om.status = 'active'"));
  assert(sql.includes("om.deactivated_at is null"));
  // Independent org re-derivation on the workspace side still present.
  assert(sql.includes("join public.organization_memberships om2"));
  assert(sql.includes("om2.status = 'active'"));
  assert(sql.includes("om2.deactivated_at is null"));
  // API-C enablements still required.
  assert(sql.includes("oe.lifecycle_status = 'enabled'"));
  assert(sql.includes("we.lifecycle_status = 'enabled'"));
});
