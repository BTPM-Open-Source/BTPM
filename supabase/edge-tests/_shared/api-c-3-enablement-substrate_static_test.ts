// API-C.3 — Inert Organization/Workspace client-enablement substrate with
// fail-closed scope integrity.
//
// Repository contract test. Asserts the migration matches the frozen contract
// in docs/governance/api/API_C_CLIENT_POLICY_SUBSTRATE_CONTRACT.md:
//   - both enablement tables with required FKs, unique keys, lifecycle checks;
//   - scope-integrity trigger re-derives authoritative Organization → Tenant
//     and Workspace → Organization → Tenant relationships;
//   - trigger function is SECURITY DEFINER, fixed search_path, EXECUTE
//     revoked from PUBLIC/anon/authenticated and granted only to service_role;
//   - RLS enabled with no policies; anon/authenticated revoked;
//   - no seed rows;
//   - no OAuth runtime, token/secret fields, or existing table/policy/grant
//     changes;
//   - no application/Edge/browser caller references the new tables.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260722055748_4873ef60-3029-403f-9c45-793ed6249e11.sql";
const MIGRATION_CORRECTION_PATH =
  "supabase/migrations/20260722060151_d6f8453d-2106-48f3-8e5f-baaf31772ccf.sql";

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

async function readCorrectionMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_CORRECTION_PATH);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

Deno.test("API-C.3 migration file exists", async () => {
  const stat = await Deno.stat(MIGRATION_PATH);
  assert(stat.isFile);
});

Deno.test(
  "API-C.3 creates api_organization_client_enablements with required shape",
  async () => {
    const sql = normalize(await readMigration());
    assert(sql.includes("create table public.api_organization_client_enablements"));
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
        "api_client_id uuid not null references public.api_clients(id) on delete restrict",
      ),
    );
    assert(sql.includes("lifecycle_status text not null default 'disabled'"));
    assert(sql.includes("lifecycle_status in ('enabled','disabled')"));
    // Lifecycle consistency
    assert(sql.includes("api_org_client_enablements_lifecycle_consistency"));
    // Unique (organization_id, api_client_id)
    assert(sql.includes("api_org_client_enablements_org_client_uniq"));
    assert(sql.includes("(organization_id, api_client_id)"));
  },
);

Deno.test(
  "API-C.3 creates api_workspace_client_enablements with required shape",
  async () => {
    const sql = normalize(await readMigration());
    assert(sql.includes("create table public.api_workspace_client_enablements"));
    assert(
      sql.includes(
        "workspace_id uuid not null references public.workspaces(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "organization_id uuid not null references public.organizations(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "tenant_id uuid not null references public.tenants(id) on delete restrict",
      ),
    );
    assert(
      sql.includes(
        "api_client_id uuid not null references public.api_clients(id) on delete restrict",
      ),
    );
    assert(sql.includes("api_ws_client_enablements_lifecycle_status_check"));
    assert(sql.includes("api_ws_client_enablements_lifecycle_consistency"));
    assert(sql.includes("api_ws_client_enablements_ws_client_uniq"));
    assert(sql.includes("(workspace_id, api_client_id)"));
  },
);

Deno.test(
  "API-C.3 defines scope-integrity trigger function with fixed search_path and SECURITY DEFINER",
  async () => {
    const sql = normalize(await readMigration());
    assert(
      sql.includes(
        "create or replace function public.api_c_enforce_enablement_scope_integrity()",
      ),
    );
    assert(sql.includes("security definer"));
    assert(sql.includes("set search_path = public"));
    // Re-derives authoritative parents rather than trusting NEW.*
    assert(sql.includes("from public.organizations o"));
    assert(sql.includes("from public.workspaces w"));
    // Rejects mismatched tenant / organization
    assert(sql.includes("does not match authoritative tenant"));
    assert(sql.includes("does not match authoritative organization"));
  },
);

Deno.test(
  "API-C.3 restricts EXECUTE on the scope-integrity function to service_role",
  async () => {
    const sql = normalize(await readMigration());
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_enablement_scope_integrity() from public",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_enablement_scope_integrity() from anon",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.api_c_enforce_enablement_scope_integrity() from authenticated",
      ),
    );
    assert(
      sql.includes(
        "grant execute on function public.api_c_enforce_enablement_scope_integrity() to service_role",
      ),
    );
  },
);

Deno.test(
  "API-C.3 attaches BEFORE INSERT OR UPDATE scope-integrity trigger on both tables",
  async () => {
    const sql = normalize(await readMigration());
    assert(sql.includes("api_org_client_enablements_scope_integrity"));
    assert(sql.includes("api_ws_client_enablements_scope_integrity"));
    // BEFORE INSERT OR UPDATE
    const beforeCount = (sql.match(/before insert or update on public\.api_(?:org|ws)_client_enablements|before insert or update on public\.api_organization_client_enablements|before insert or update on public\.api_workspace_client_enablements/g) || []).length;
    assert(beforeCount >= 2, `Expected two BEFORE INSERT OR UPDATE triggers, got ${beforeCount}`);
    // Both triggers execute the scope-integrity function
    const execCount = (
      sql.match(/execute function public\.api_c_enforce_enablement_scope_integrity\(\)/g) || []
    ).length;
    assert(execCount >= 2, `Expected the scope trigger to be attached twice, got ${execCount}`);
  },
);

Deno.test(
  "API-C.3 enables RLS and revokes anon/authenticated on both enablement tables",
  async () => {
    const sql = normalize(await readMigration());
    assert(
      sql.includes(
        "alter table public.api_organization_client_enablements enable row level security",
      ),
    );
    assert(
      sql.includes(
        "alter table public.api_workspace_client_enablements enable row level security",
      ),
    );
    assert(
      sql.includes(
        "revoke all on public.api_organization_client_enablements from anon",
      ),
    );
    assert(
      sql.includes(
        "revoke all on public.api_organization_client_enablements from authenticated",
      ),
    );
    assert(
      sql.includes(
        "revoke all on public.api_workspace_client_enablements from anon",
      ),
    );
    assert(
      sql.includes(
        "revoke all on public.api_workspace_client_enablements from authenticated",
      ),
    );
    assert(
      sql.includes(
        "grant all on public.api_organization_client_enablements to service_role",
      ),
    );
    assert(
      sql.includes(
        "grant all on public.api_workspace_client_enablements to service_role",
      ),
    );
  },
);

Deno.test("API-C.3 introduces no RLS policy on the enablement tables", async () => {
  const sql = normalize(await readMigration());
  assert(!sql.includes("create policy"));
});

Deno.test("API-C.3 seeds no rows into either enablement table", async () => {
  const sql = normalize(await readMigration());
  assert(!sql.includes("insert into public.api_organization_client_enablements"));
  assert(!sql.includes("insert into public.api_workspace_client_enablements"));
});

Deno.test(
  "API-C.3 does not introduce token/secret/authorization-code/refresh-token columns",
  async () => {
    const sql = normalize(await readMigration());
    const forbidden = [
      "client_secret",
      "client_secret_hash",
      "authorization_code",
      "refresh_token",
      "access_token",
      "token_hash",
      "id_token",
    ];
    for (const term of forbidden) {
      assert(!sql.includes(term), `Migration must not reference '${term}'.`);
    }
  },
);

Deno.test(
  "API-C.3 does not alter existing tables, policies, or grants outside its own scope",
  async () => {
    const sql = normalize(await readMigration());
    // No ALTER TABLE on anything except the two new tables (for ENABLE RLS).
    const alterMatches = sql.match(/alter table [^;]+/g) || [];
    for (const m of alterMatches) {
      assert(
        m.includes("public.api_organization_client_enablements") ||
          m.includes("public.api_workspace_client_enablements"),
        `Unexpected ALTER TABLE outside API-C.3 scope: ${m}`,
      );
    }
    // No DROP anything.
    assert(!sql.includes("drop table"));
    assert(!sql.includes("drop policy"));
    assert(!sql.includes("drop function"));
    // No auth hook / custom access token wiring.
    assert(!sql.includes("auth.hook"));
    assert(!sql.includes("custom_access_token"));
  },
);

Deno.test(
  "API-C.3 substrate has no application, Edge Function, or browser caller",
  async () => {
    async function walk(dir: string, hits: string[]): Promise<void> {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
          if (
            entry.name === "node_modules" ||
            entry.name === "dist" ||
            entry.name === ".git" ||
            entry.name === "migrations"
          ) {
            continue;
          }
          await walk(path, hits);
        } else if (
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".tsx") ||
          entry.name.endsWith(".js")
        ) {
          const text = await Deno.readTextFile(path);
          if (
            text.includes("api_organization_client_enablements") ||
            text.includes("api_workspace_client_enablements") ||
            text.includes("api_c_enforce_enablement_scope_integrity")
          ) {
            hits.push(path);
          }
        }
      }
    }

    const runtimeHits: string[] = [];
    await walk("src", runtimeHits);
    await walk("supabase/functions", runtimeHits);
    // Governance static-contract tests under _shared/api-* may legitimately
    // reference the substrate tables; exclude them alongside generated types.
    const isApiGovernanceStaticTest = (p: string): boolean =>
      p.startsWith("supabase/functions/_shared/api-") &&
      p.endsWith("_static_test.ts");
    // API-HR.CLOSE-2: narrow test-only path classification. Test sources are
    // NOT runtime/browser/Edge callers merely because they name a protected
    // relation in a source-contract assertion or fixture. Production files in
    // the same directories remain fully scanned.
    const isTestOnlySource = (p: string): boolean =>
      /(^|\/)__tests__\//.test(p) ||
      p.startsWith("src/test/") ||
      /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p) ||
      /_test\.(ts|tsx)$/.test(p);
    const disallowed = runtimeHits.filter(
      (p) =>
        !p.endsWith("src/integrations/supabase/types.ts") &&
        !isApiGovernanceStaticTest(p) &&
        !isTestOnlySource(p),
    );
    assert(
      disallowed.length === 0,
      `API-C.3 substrate must have no unauthorized production/runtime caller; references found: ${disallowed.join(", ")}`,
    );

  },
);

Deno.test(
  "API-C.3 migration chain sets disabled_at DEFAULT now() and makes default-disabled rows valid",
  async () => {
    const original = normalize(await readMigration());
    const correction = normalize(await readCorrectionMigration());
    const combined = original + " " + correction;

    // Both tables declare disabled_at as nullable timestamptz.
    assert(
      combined.includes("disabled_at timestamptz null"),
      "disabled_at must be declared timestamptz NULL",
    );

    // The follow-up migration sets DEFAULT now() on each table.
    assert(
      combined.includes(
        "alter table public.api_organization_client_enablements alter column disabled_at set default now()",
      ),
      "organization disabled_at default missing",
    );
    assert(
      combined.includes(
        "alter table public.api_workspace_client_enablements alter column disabled_at set default now()",
      ),
      "workspace disabled_at default missing",
    );

    // The default-disabled row shape satisfies the lifecycle consistency check:
    // lifecycle_status = 'disabled' requires disabled_at IS NOT NULL.
    assert(
      combined.includes("lifecycle_status = 'disabled'"),
      "disabled branch of lifecycle check missing",
    );
    assert(
      combined.includes("disabled_at is not null"),
      "lifecycle consistency must require disabled_at IS NOT NULL",
    );
  },
);
