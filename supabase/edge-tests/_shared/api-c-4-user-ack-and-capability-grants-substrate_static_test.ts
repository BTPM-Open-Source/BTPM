// API-C.4 — Inert user policy-acknowledgement and explicit capability-grant
// substrate with fail-closed integrity.
//
// Repository contract test. Asserts the migration matches the frozen contract
// in docs/governance/api/API_C_CLIENT_POLICY_SUBSTRATE_CONTRACT.md:
//   - api_user_policy_acknowledgements: FKs to auth.users, api_clients,
//     api_client_policy_versions; unique(user_id, api_client_id,
//     policy_version_id); ack_metadata jsonb-object check; policy→client
//     integrity trigger.
//   - api_capability_grants: FKs to tenants, organizations, workspaces,
//     api_clients, auth.users; api_version regex; capability_kind check;
//     capability_key format check + generic-key rejection; lifecycle checks;
//     org-level and ws-level partial unique indexes; scope-integrity trigger;
//     default-disabled shape (disabled_at DEFAULT now()) internally consistent.
//   - Trigger functions: SECURITY DEFINER, fixed search_path, EXECUTE revoked
//     from PUBLIC/anon/authenticated, granted only to service_role.
//   - RLS enabled with no policies; anon/authenticated revoked; service_role
//     only.
//   - No seed rows.
//   - No OAuth runtime, token/secret/grant-state columns, Custom Access Token
//     Hook, or existing table/policy/grant changes.
//   - No application/Edge/browser callers reference the new tables.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260722060731_2cc6dce6-ded0-4342-a752-3f58d53ac484.sql";

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

Deno.test("API-C.4 migration file exists", async () => {
  const stat = await Deno.stat(MIGRATION_PATH);
  assert(stat.isFile);
});

// -------------------------------------------------------------------------
// api_user_policy_acknowledgements
// -------------------------------------------------------------------------

Deno.test(
  "API-C.4 creates api_user_policy_acknowledgements with required shape",
  async () => {
    const sql = normalize(await readMigration());
    assert(sql.includes("create table public.api_user_policy_acknowledgements"));
    assert(
      sql.includes(
        "user_id uuid not null references auth.users(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "api_client_id uuid not null references public.api_clients(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "policy_version_id uuid not null references public.api_client_policy_versions(id) on delete restrict",
      ),
    );
    assert(sql.includes("acknowledged_at timestamptz not null default now()"));
    assert(sql.includes("revoked_at timestamptz null"));
    assert(sql.includes("ack_metadata jsonb not null default '{}'::jsonb"));
    assert(sql.includes("check (jsonb_typeof(ack_metadata) = 'object')"));
    assert(
      sql.includes(
        "unique (user_id, api_client_id, policy_version_id)",
      ),
    );
  },
);

Deno.test(
  "API-C.4 ack policy→client integrity trigger is SECURITY DEFINER with fixed search_path and service_role-only EXECUTE",
  async () => {
    const sql = normalize(await readMigration());
    assert(
      sql.includes(
        "create or replace function public.api_c_enforce_ack_policy_client_integrity()",
      ),
    );
    // SECURITY DEFINER + fixed search_path
    const fnStart = sql.indexOf(
      "create or replace function public.api_c_enforce_ack_policy_client_integrity()",
    );
    const fnBody = sql.substring(fnStart, fnStart + 1200);
    assert(fnBody.includes("security definer"));
    assert(fnBody.includes("set search_path = public"));
    // Grants
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_ack_policy_client_integrity() from public",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_ack_policy_client_integrity() from anon",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_ack_policy_client_integrity() from authenticated",
      ),
    );
    assert(
      sql.includes(
        "grant execute on function public.api_c_enforce_ack_policy_client_integrity() to service_role",
      ),
    );
    // Trigger wired BEFORE INSERT OR UPDATE
    assert(
      sql.includes(
        "create trigger api_c_4_ack_policy_client_integrity before insert or update on public.api_user_policy_acknowledgements",
      ),
    );
    // Enforcement logic re-derives policy_version → api_client_id and rejects mismatch or missing.
    assert(fnBody.includes("from public.api_client_policy_versions"));
    assert(fnBody.includes("does not belong to api_client_id"));
    assert(fnBody.includes("does not exist"));
  },
);

// -------------------------------------------------------------------------
// api_capability_grants
// -------------------------------------------------------------------------

Deno.test(
  "API-C.4 creates api_capability_grants with required shape",
  async () => {
    const sql = normalize(await readMigration());
    assert(sql.includes("create table public.api_capability_grants"));
    assert(
      sql.includes(
        "tenant_id uuid not null references public.tenants(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "organization_id uuid not null references public.organizations(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "workspace_id uuid null references public.workspaces(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "api_client_id uuid not null references public.api_clients(id) on delete restrict",
      ),
    );
    assert(sql.includes("api_version text not null default 'v1'"));
    assert(sql.includes("capability_kind text not null"));
    assert(sql.includes("capability_key text not null"));
    assert(sql.includes("lifecycle_status text not null default 'disabled'"));
    assert(sql.includes("reason text null"));
    assert(sql.includes("enabled_at timestamptz null"));
    // Default-disabled shape is internally consistent
    assert(sql.includes("disabled_at timestamptz null default now()"));
    assert(
      sql.includes(
        "created_by uuid null references auth.users(id) on delete set null",
      ),
    );
    assert(
      sql.includes(
        "updated_by uuid null references auth.users(id) on delete set null",
      ),
    );
  },
);

Deno.test(
  "API-C.4 capability grants enforces api_version, kind, key format, generic-key rejection, and lifecycle consistency",
  async () => {
    const sql = normalize(await readMigration());
    // api_version regex + lowercase
    assert(sql.includes("api_version ~ '^v[1-9][0-9]*$'"));
    assert(sql.includes("api_version = lower(api_version)"));
    // capability_kind
    assert(sql.includes("capability_kind in ('read','command')"));
    // key format lowercase + regex
    assert(sql.includes("capability_key = lower(capability_key)"));
    assert(sql.includes("capability_key ~ '^[a-z][a-z0-9._:-]*$'"));
    // generic/bypass keys rejected
    for (
      const banned of [
        "'crud'",
        "'generic_crud'",
        "'rpc'",
        "'generic_rpc'",
        "'table_access'",
        "'postgrest'",
        "'service_role'",
        "'*'",
      ]
    ) {
      assert(
        sql.includes(banned),
        `generic capability key ${banned} must be rejected`,
      );
    }
    assert(
      sql.includes("capability_key not in ("),
      "must have a NOT IN clause rejecting generic keys",
    );
    // lifecycle_status check
    assert(sql.includes("lifecycle_status in ('enabled','disabled')"));
    // lifecycle consistency
    assert(sql.includes("lifecycle_status = 'enabled'"));
    assert(sql.includes("enabled_at is not null"));
    assert(sql.includes("disabled_at is null"));
    assert(sql.includes("lifecycle_status = 'disabled'"));
    assert(sql.includes("disabled_at is not null"));
  },
);

Deno.test(
  "API-C.4 capability grants has org-level and workspace-level partial unique indexes (post-R2, capability_kind removed from identity)",
  async () => {
    // Read the original API-C.4 migration plus the API-C R2 follow-up
    // migration and assert the effective final index shape matches the
    // frozen contract in §3.6 — capability_kind must NOT appear in the
    // unique identity.
    const R2_MIGRATION_PATH =
      "supabase/migrations/20260722072551_9bdcae21-02f9-4ccd-a350-076ee27a0f3d.sql";
    const original = normalize(await readMigration());
    const r2 = normalize(await Deno.readTextFile(R2_MIGRATION_PATH));

    // The R2 migration must drop both original indexes.
    assert(
      r2.includes("drop index if exists public.api_capability_grants_org_unique"),
      "R2 migration must drop the original org_unique index",
    );
    assert(
      r2.includes("drop index if exists public.api_capability_grants_ws_unique"),
      "R2 migration must drop the original ws_unique index",
    );

    // The R2 migration must recreate both indexes without capability_kind.
    assert(
      r2.includes(
        "create unique index api_capability_grants_org_unique on public.api_capability_grants ( organization_id, api_client_id, api_version, capability_key ) where workspace_id is null",
      ),
      "R2 org_unique index must exclude capability_kind",
    );
    assert(
      r2.includes(
        "create unique index api_capability_grants_ws_unique on public.api_capability_grants ( workspace_id, api_client_id, api_version, capability_key ) where workspace_id is not null",
      ),
      "R2 ws_unique index must exclude capability_kind",
    );

    // Fail if the original (capability_kind-including) definition would remain
    // the effective final shape — i.e. R2 does not drop it.
    const originalOrgDef =
      "create unique index api_capability_grants_org_unique on public.api_capability_grants ( organization_id, api_client_id, api_version, capability_kind, capability_key ) where workspace_id is null";
    const originalWsDef =
      "create unique index api_capability_grants_ws_unique on public.api_capability_grants ( workspace_id, api_client_id, api_version, capability_kind, capability_key ) where workspace_id is not null";
    assert(
      original.includes(originalOrgDef),
      "Original API-C.4 migration must still define the pre-R2 org_unique index verbatim",
    );
    assert(
      original.includes(originalWsDef),
      "Original API-C.4 migration must still define the pre-R2 ws_unique index verbatim",
    );
    assert(
      !r2.includes(originalOrgDef) && !r2.includes(originalWsDef),
      "R2 migration must not re-introduce capability_kind into either unique index",
    );
  },
);

Deno.test(
  "API-C.4 capability grants scope-integrity trigger is SECURITY DEFINER with fixed search_path and service_role-only EXECUTE",
  async () => {
    const sql = normalize(await readMigration());
    assert(
      sql.includes(
        "create or replace function public.api_c_enforce_capability_grant_scope_integrity()",
      ),
    );
    const fnStart = sql.indexOf(
      "create or replace function public.api_c_enforce_capability_grant_scope_integrity()",
    );
    const fnBody = sql.substring(fnStart, fnStart + 2400);
    assert(fnBody.includes("security definer"));
    assert(fnBody.includes("set search_path = public"));
    // Re-derives org → tenant
    assert(fnBody.includes("from public.organizations"));
    // Re-derives workspace → organization when workspace_id present
    assert(fnBody.includes("from public.workspaces"));
    assert(fnBody.includes("if new.workspace_id is not null then"));
    assert(fnBody.includes("does not exist"));
    // Grants
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_capability_grant_scope_integrity() from public",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_capability_grant_scope_integrity() from anon",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_capability_grant_scope_integrity() from authenticated",
      ),
    );
    assert(
      sql.includes(
        "grant execute on function public.api_c_enforce_capability_grant_scope_integrity() to service_role",
      ),
    );
    // Trigger wired BEFORE INSERT OR UPDATE
    assert(
      sql.includes(
        "create trigger api_c_4_capability_grant_scope_integrity before insert or update on public.api_capability_grants",
      ),
    );
  },
);

Deno.test(
  "API-C.4 capability grants uses the existing updated_at trigger function",
  async () => {
    const sql = normalize(await readMigration());
    assert(
      sql.includes(
        "create trigger update_api_capability_grants_updated_at before update on public.api_capability_grants",
      ),
    );
    assert(sql.includes("execute function public.update_updated_at_column()"));
  },
);

// -------------------------------------------------------------------------
// Security posture
// -------------------------------------------------------------------------

Deno.test(
  "API-C.4 both tables have RLS enabled, no policies, anon/authenticated revoked, service_role granted",
  async () => {
    const sql = normalize(await readMigration());

    for (
      const table of [
        "public.api_user_policy_acknowledgements",
        "public.api_capability_grants",
      ]
    ) {
      assert(sql.includes(`alter table ${table} enable row level security`));
      assert(sql.includes(`revoke all on ${table} from public`));
      assert(sql.includes(`revoke all on ${table} from anon`));
      assert(sql.includes(`revoke all on ${table} from authenticated`));
      assert(
        sql.includes(
          `grant select, insert, update, delete on ${table} to service_role`,
        ),
      );
    }

    // No CREATE POLICY statements at all in this migration.
    assert(!sql.includes("create policy"));
  },
);

Deno.test("API-C.4 migration inserts no seed rows", async () => {
  const sql = normalize(await readMigration());
  assert(!sql.includes("insert into public.api_user_policy_acknowledgements"));
  assert(!sql.includes("insert into public.api_capability_grants"));
});

Deno.test(
  "API-C.4 migration introduces no OAuth runtime, token/secret/grant-state columns, or Custom Access Token Hook",
  async () => {
    const sql = normalize(await readMigration());
    for (
      const forbidden of [
        "access_token",
        "refresh_token",
        "client_secret",
        "id_token",
        "authorization_code",
        "code_verifier",
        "code_challenge",
        "custom_access_token_hook",
        "auth.hook",
        "supabase_auth_hooks",
      ]
    ) {
      assert(
        !sql.includes(forbidden),
        `migration must not reference ${forbidden}`,
      );
    }
  },
);

Deno.test(
  "API-C.4 migration does not alter existing API-C.2/C.3 tables, policies, or grants",
  async () => {
    const sql = normalize(await readMigration());
    for (
      const forbidden of [
        "alter table public.api_clients",
        "alter table public.api_client_policy_versions",
        "alter table public.api_organization_client_enablements",
        "alter table public.api_workspace_client_enablements",
        "drop table public.api_",
        "drop policy",
      ]
    ) {
      assert(
        !sql.includes(forbidden),
        `migration must not modify existing surface: ${forbidden}`,
      );
    }
  },
);

// -------------------------------------------------------------------------
// No runtime callers
// -------------------------------------------------------------------------

// API-HR.CLOSE-2: narrow test-only path classification. Test sources are NOT
// runtime/browser/Edge callers merely because they name a protected relation
// in a source-contract assertion or fixture. Production files in the same
// directories (hooks, pages, components, endpoint index.ts, _shared runtime)
// remain fully scanned and fail closed.
function isTestOnlySource(path: string): boolean {
  return /(^|\/)__tests__\//.test(path) ||
    path.startsWith("src/test/") ||
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path) ||
    /_test\.(ts|tsx)$/.test(path);
}



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
  "API-C.4 api_user_policy_acknowledgements permits only the approved API-E.R3 server-only reader",
  async () => {
    // API-C originally created an inert acknowledgement substrate. API-E.R3
    // now introduces the FIRST approved protected server-only reader:
    //   supabase/functions/_shared/btpm-api/authorizeClient.ts
    // The focused authentication test may also reference the table.
    // Browser code, endpoints, and unrelated `_shared` runtime files remain
    // prohibited.
    const roots = ["src", "supabase/functions"];
    const APPROVED_READER =
      "supabase/functions/_shared/btpm-api/authorizeClient.ts";
    const APPROVED_TEST =
      "supabase/edge-tests/_shared/btpm-api/__tests__/authentication.test.ts";
    const isApiGovernanceStaticTest = (p: string): boolean =>
      p.startsWith("supabase/functions/_shared/api-") &&
      p.endsWith("_static_test.ts");

    const hits: string[] = [];
    for (const root of roots) {
      let files: string[] = [];
      try {
        files = await walk(root);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith("src/integrations/supabase/types.ts")) continue;
        if (isApiGovernanceStaticTest(file)) continue;
        if (isTestOnlySource(file)) continue;
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
        const text = await Deno.readTextFile(file);
        if (text.includes("api_user_policy_acknowledgements")) {
          hits.push(file);
        }
      }
    }

    const srcOffenders = hits.filter((p) => p.startsWith("src/"));
    assert(
      srcOffenders.length === 0,
      `api_user_policy_acknowledgements must not be referenced from src/**: ${srcOffenders.join(", ")}`,
    );
    const endpointOffenders = hits.filter((p) =>
      /^supabase\/functions\/[^/]+\/index\.ts$/.test(p) &&
      !p.startsWith("supabase/functions/_shared/")
    );
    assert(
      endpointOffenders.length === 0,
      `api_user_policy_acknowledgements must not be referenced from any endpoint: ${endpointOffenders.join(", ")}`,
    );
    const otherOffenders = hits.filter(
      (p) => p !== APPROVED_READER && p !== APPROVED_TEST && !p.startsWith("src/"),
    );
    assert(
      otherOffenders.length === 0,
      `api_user_policy_acknowledgements may only be read by the approved API-E.R3 server-only reader; unexpected: ${otherOffenders.join(", ")}`,
    );

    // Safety assertions on the approved reader (executable code only).
    const rawReaderText = await Deno.readTextFile(APPROVED_READER);
    const readerCode = rawReaderText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert(!readerCode.includes("Deno.serve"));
    assert(!readerCode.includes("Deno.env"));
    assert(!readerCode.includes("SUPABASE_SERVICE_ROLE_KEY"));
    assert(!readerCode.includes("createClient("));
    assert(readerCode.includes("createSupabaseClientAuthorizationStore"));
    assert(readerCode.includes("serverClient"));
  },
);

Deno.test(
  "API-C.4 api_capability_grants remains without any application, browser, endpoint, or non-governance runtime caller",
  async () => {
    // Capability authorization is a later wrapper/trusted-context concern.
    // API-E.R3 does NOT read capability grants: the approved reader must
    // not query this table.
    const APPROVED_READER =
      "supabase/functions/_shared/btpm-api/authorizeClient.ts";
    const rawReaderText = await Deno.readTextFile(APPROVED_READER);
    const readerCode = rawReaderText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert(
      !readerCode.includes("api_capability_grants"),
      "API-E.R3 approved reader must not query api_capability_grants",
    );

    const roots = ["src", "supabase/functions"];
    const isApiGovernanceStaticTest = (p: string): boolean =>
      p.startsWith("supabase/functions/_shared/api-") &&
      p.endsWith("_static_test.ts");
    const offenders: string[] = [];
    for (const root of roots) {
      let files: string[] = [];
      try {
        files = await walk(root);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith("src/integrations/supabase/types.ts")) continue;
        if (isApiGovernanceStaticTest(file)) continue;
        if (isTestOnlySource(file)) continue;
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
        const rawText = await Deno.readTextFile(file);
        const code = rawText
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
        if (code.includes("api_capability_grants")) offenders.push(file);
      }
    }
    assert(
      offenders.length === 0,
      `api_capability_grants must have no application/Edge/browser runtime caller: ${offenders.join(", ")}`,
    );
  },
);
