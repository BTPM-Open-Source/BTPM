// API-C.2 — Platform client registry and immutable policy-version substrate.
//
// API-C originally created an inert substrate with no runtime callers.
// API-E.R3 now introduces the FIRST approved protected server-only reader
// of `public.api_clients` and `public.api_client_policy_versions`:
//   - supabase/functions/_shared/btpm-api/authorizeClient.ts
//     (via an injected privileged server client; no `Deno.serve`, no
//      `Deno.env`, no service-role credential, no client construction).
// Direct browser access and ordinary authenticated access remain
// prohibited. Application code, endpoints, and unrelated `_shared`
// runtime files must not reference these tables.
//
// Repository contract test. Asserts the migration that introduces
// `public.api_clients` and `public.api_client_policy_versions` matches the
// frozen contract in
// docs/governance/api/API_C_CLIENT_POLICY_SUBSTRATE_CONTRACT.md:
//   - both tables with required FKs, checks, and unique indexes;
//   - one-active-policy partial unique index;
//   - RLS enabled and privileges revoked from anon/authenticated;
//   - no policy is created (no browser access);
//   - no seed insert;
//   - no token/client-secret/authorization-code/refresh-token columns;
//   - no OAuth/runtime configuration introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260722055331_b64649fe-938f-4579-94f6-733f4b9ba5f0.sql";

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

Deno.test("API-C.2 migration file exists", async () => {
  const stat = await Deno.stat(MIGRATION_PATH);
  assert(stat.isFile);
});

Deno.test("API-C.2 creates public.api_clients with required shape", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("create table public.api_clients"));
  assert(sql.includes("client_key text not null"));
  assert(sql.includes("oauth_client_id text null"));
  assert(sql.includes("display_name text not null"));
  assert(sql.includes("description text null"));
  assert(sql.includes("lifecycle_status text not null default 'draft'"));
  assert(sql.includes("references auth.users(id) on delete set null"));
  // client_key constraints
  assert(sql.includes("client_key = lower(client_key)"));
  assert(sql.includes("^[a-z0-9][a-z0-9._-]*$"));
  // lifecycle enum
  assert(
    sql.includes(
      "lifecycle_status in ('draft','active','suspended','retired')",
    ),
  );
  // unique on client_key
  assert(sql.includes("api_clients_client_key_uniq"));
  // partial unique on oauth_client_id
  assert(sql.includes("api_clients_oauth_client_id_uniq"));
  assert(sql.includes("where oauth_client_id is not null"));
});

Deno.test(
  "API-C.2 creates public.api_client_policy_versions with required shape",
  async () => {
    const sql = normalize(await readMigration());
    assert(sql.includes("create table public.api_client_policy_versions"));
    assert(
      sql.includes(
        "api_client_id uuid not null references public.api_clients(id) on delete restrict",
      ),
    );
    assert(sql.includes("version text not null"));
    assert(sql.includes("policy_uri text not null"));
    assert(sql.includes("policy_digest text not null"));
    // SHA-256 hex
    assert(sql.includes("^[0-9a-f]{64}$"));
    assert(sql.includes("lifecycle_status text not null default 'draft'"));
    assert(
      sql.includes("lifecycle_status in ('draft','active','retired')"),
    );
    // retired_at consistency check
    assert(sql.includes("retired_at"));
    assert(
      sql.includes("lifecycle_status = 'retired' and retired_at is not null"),
    );
    // unique (client, version) and (client, digest)
    assert(sql.includes("api_client_policy_versions_client_version_uniq"));
    assert(sql.includes("api_client_policy_versions_client_digest_uniq"));
  },
);

Deno.test("API-C.2 defines one-active-policy partial unique index", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("api_client_policy_versions_one_active_per_client"));
  assert(sql.includes("where lifecycle_status = 'active'"));
});

Deno.test("API-C.2 enables RLS on both substrate tables", async () => {
  const sql = normalize(await readMigration());
  assert(
    sql.includes("alter table public.api_clients enable row level security"),
  );
  assert(
    sql.includes(
      "alter table public.api_client_policy_versions enable row level security",
    ),
  );
});

Deno.test("API-C.2 revokes anon and authenticated privileges", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("revoke all on public.api_clients from anon"));
  assert(
    sql.includes("revoke all on public.api_clients from authenticated"),
  );
  assert(
    sql.includes("revoke all on public.api_client_policy_versions from anon"),
  );
  assert(
    sql.includes(
      "revoke all on public.api_client_policy_versions from authenticated",
    ),
  );
  assert(sql.includes("grant all on public.api_clients to service_role"));
  assert(
    sql.includes(
      "grant all on public.api_client_policy_versions to service_role",
    ),
  );
});

Deno.test("API-C.2 introduces no authenticated policy", async () => {
  const sql = normalize(await readMigration());
  // No CREATE POLICY at all on either table.
  assert(!sql.includes("create policy"));
});

Deno.test("API-C.2 seeds no rows into either substrate table", async () => {
  const sql = normalize(await readMigration());
  assert(!sql.includes("insert into public.api_clients"));
  assert(!sql.includes("insert into public.api_client_policy_versions"));
});

Deno.test(
  "API-C.2 does not introduce token/secret/authorization-code/refresh-token columns",
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
  "API-C.2 introduces no OAuth runtime configuration or RPC; permits only the approved API-E.R3 server-only reader",
  async () => {
    const sql = normalize(await readMigration());
    // No functions beyond the reused updated_at trigger.
    assert(!sql.includes("create function"));
    assert(!sql.includes("create or replace function"));
    // No SECURITY DEFINER RPCs.
    assert(!sql.includes("security definer"));
    // No cross-schema OAuth wiring.
    assert(!sql.includes("auth.hook"));
    assert(!sql.includes("custom_access_token"));

    // Walk repo runtime trees. The ONLY approved non-migration server
    // runtime reader is _shared/btpm-api/authorizeClient.ts. The focused
    // authentication test may also reference the tables. Governance
    // static-contract tests and generated Supabase types are excluded.
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
            text.includes("api_clients") ||
            text.includes("api_client_policy_versions")
          ) {
            hits.push(path);
          }
        }
      }
    }

    const runtimeHits: string[] = [];
    await walk("src", runtimeHits);
    await walk("supabase/functions", runtimeHits);

    const APPROVED_READER =
      "supabase/functions/_shared/btpm-api/authorizeClient.ts";
    const APPROVED_TEST =
      "supabase/edge-tests/_shared/btpm-api/__tests__/authentication.test.ts";
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

    // Browser production code (src/**) is always forbidden except generated
    // types; test-only sources are classified separately.
    const srcOffenders = runtimeHits.filter(
      (p) =>
        p.startsWith("src/") &&
        !p.endsWith("src/integrations/supabase/types.ts") &&
        !isTestOnlySource(p),
    );
    assert(
      srcOffenders.length === 0,
      `API-C.2 tables must not be referenced from src/**: ${srcOffenders.join(", ")}`,
    );


    // Endpoint index.ts files are always forbidden.
    const endpointOffenders = runtimeHits.filter((p) =>
      /^supabase\/functions\/[^/]+\/index\.ts$/.test(p) &&
      !p.startsWith("supabase/functions/_shared/")
    );
    assert(
      endpointOffenders.length === 0,
      `API-C.2 tables must not be referenced from any Edge Function endpoint: ${endpointOffenders.join(", ")}`,
    );

    // Under supabase/functions, only the approved reader, its focused test,
    // governance static tests, test-only sources, and types are permitted.
    const otherOffenders = runtimeHits.filter(
      (p) =>
        !p.startsWith("src/") &&
        p !== APPROVED_READER &&
        p !== APPROVED_TEST &&
        !isApiGovernanceStaticTest(p) &&
        !isTestOnlySource(p),
    );

    assert(
      otherOffenders.length === 0,
      `API-C.2 tables may only be read by the approved API-E.R3 server-only reader; unexpected references: ${otherOffenders.join(", ")}`,
    );

    // Safety assertions on the approved reader itself. Strip comments so
    // assertions inspect executable code, not documentation.
    const rawReaderText = await Deno.readTextFile(APPROVED_READER);
    const readerCode = rawReaderText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert(
      APPROVED_READER.startsWith("supabase/functions/_shared/btpm-api/"),
      "Approved reader must live under _shared/btpm-api",
    );
    assert(!readerCode.includes("Deno.serve"), "approved reader must not host an endpoint");
    assert(!readerCode.includes("Deno.env"), "approved reader must not read env");
    assert(
      !readerCode.includes("SUPABASE_SERVICE_ROLE_KEY"),
      "approved reader must not reference the service-role key",
    );
    assert(
      !readerCode.includes("createClient("),
      "approved reader must not construct a Supabase client",
    );
    assert(
      readerCode.includes("createSupabaseClientAuthorizationStore"),
      "approved reader must export createSupabaseClientAuthorizationStore",
    );
    assert(
      readerCode.includes("serverClient"),
      "approved reader must access tables only through an injected server client",
    );
  },
);
