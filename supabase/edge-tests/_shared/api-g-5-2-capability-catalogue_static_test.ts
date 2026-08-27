// API-G.5.2 — Capability catalogue and grant integrity.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen API-G.5.2 substrate contract:
//   - public.api_capability_catalogue and
//     public.api_client_supported_capabilities exist with the required shape.
//   - Composite identity, uniqueness and validation constraints exist.
//   - RLS enabled on both tables with no RLS policy; PUBLIC/anon/authenticated
//     revoked; service_role only.
//   - Exactly two seeded product capabilities; organizations:list is
//     administrator-assignable, me:read is not.
//   - No command/wildcard/CRUD/RPC/table-access/service-role capability and no
//     client, Astra, Tenant, Organization, Workspace or Project identifier is
//     seeded.
//   - Safe generic preflight, grant-derived backfill, validated grant FK and
//     lifecycle triggers (SECURITY DEFINER, fixed search_path, not
//     browser-executable).
//   - Existing grant uniqueness/scope triggers are not removed and no RPC,
//     Edge Function, route, component or mutation capability is added.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.2 — Capability catalogue and grant integrity";
const C1_MARKER =
  "API-G.5.2-C1 — Route-version and concurrent lifecycle integrity";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

const RAW = await findMigrationByMarker(MARKER);
const SQL = normalize(RAW);

const C1_RAW = await findMigrationByMarker(C1_MARKER);
const C1_SQL = normalize(C1_RAW);

Deno.test("API-G.5.2 migration is discoverable by its unique marker", () => {
  assert(RAW.includes(MARKER));
});

Deno.test("API-G.5.2-C1 correction migration is discoverable by its unique marker", () => {
  assert(C1_RAW.includes(C1_MARKER));
  assert(C1_RAW !== RAW, "C1 correction must be a separate migration file");
});


// -------------------------------------------------------------------------
// Catalogue table
// -------------------------------------------------------------------------

Deno.test("catalogue table has the required columns", () => {
  assert(SQL.includes("create table public.api_capability_catalogue"));
  for (
    const col of [
      "api_version text not null",
      "capability_kind text not null",
      "capability_key text not null",
      "route_id text not null",
      "http_method text not null",
      "route_path text not null",
      "scope_level text not null",
      "display_name text not null",
      "description text not null",
      "administrator_assignable boolean not null default false",
      "lifecycle_status text not null default 'active'",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]
  ) {
    assert(SQL.includes(col), `missing catalogue column: ${col}`);
  }
});

Deno.test("catalogue composite identities and validation constraints exist", () => {
  assert(
    SQL.includes(
      "primary key (api_version, capability_kind, capability_key)",
    ),
  );
  assert(SQL.includes("unique (api_version, capability_key)"));
  for (
    const chk of [
      "api_capability_catalogue_api_version_chk",
      "api_capability_catalogue_kind_chk",
      "api_capability_catalogue_key_format_chk",
      "api_capability_catalogue_key_not_generic_chk",
      "api_capability_catalogue_route_id_chk",
      "api_capability_catalogue_http_method_chk",
      "api_capability_catalogue_route_path_chk",
      "api_capability_catalogue_scope_level_chk",
      "api_capability_catalogue_lifecycle_chk",
    ]
  ) {
    assert(SQL.includes(chk), `missing constraint: ${chk}`);
  }
  assert(SQL.includes("capability_kind in ('read','command')"));
  assert(
    SQL.includes("scope_level in ('organization','workspace','project')"),
  );
  assert(SQL.includes("lifecycle_status in ('active','retired')"));
  assert(
    SQL.includes("http_method in ('get','post','patch','put','delete')"),
  );
  assert(
    SQL.includes("update_api_capability_catalogue_updated_at"),
  );
});

// -------------------------------------------------------------------------
// Supported-capability table
// -------------------------------------------------------------------------

Deno.test("client supported-capability table has the required shape", () => {
  assert(SQL.includes("create table public.api_client_supported_capabilities"));
  for (
    const col of [
      "id uuid primary key default gen_random_uuid()",
      "api_client_id uuid not null references public.api_clients(id) on delete restrict",
      "api_version text not null",
      "capability_kind text not null",
      "capability_key text not null",
      "lifecycle_status text not null default 'disabled'",
      "reason text null",
      "enabled_at timestamptz null",
      "disabled_at timestamptz null default now()",
      "created_by uuid null",
      "updated_by uuid null",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]
  ) {
    assert(SQL.includes(col), `missing supported-capability column: ${col}`);
  }
  assert(
    SQL.includes(
      "foreign key (api_version, capability_kind, capability_key) references public.api_capability_catalogue (api_version, capability_kind, capability_key)",
    ),
  );
  assert(
    SQL.includes("unique (api_client_id, api_version, capability_key)"),
  );
  assert(
    SQL.includes(
      "unique (api_client_id, api_version, capability_kind, capability_key)",
    ),
  );
  assert(
    SQL.includes(
      "api_client_supported_capabilities_lifecycle_chk check (lifecycle_status in ('enabled','disabled'))",
    ),
  );
  assert(
    SQL.includes("api_client_supported_capabilities_lifecycle_consistency_chk"),
  );
  assert(SQL.includes("update_api_client_supported_capabilities_updated_at"));
});

// -------------------------------------------------------------------------
// Security posture
// -------------------------------------------------------------------------

Deno.test("both tables enable RLS with no policy and revoke browser roles", () => {
  for (
    const table of [
      "public.api_capability_catalogue",
      "public.api_client_supported_capabilities",
    ]
  ) {
    assert(SQL.includes(`alter table ${table} enable row level security`));
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        SQL.includes(`revoke all on ${table} from ${role}`),
        `missing revoke for ${role} on ${table}`,
      );
    }
    assert(
      SQL.includes(`on ${table} to service_role`),
      `missing service_role grant on ${table}`,
    );
  }
  assert(!SQL.includes("create policy"));
  assert(!SQL.includes("to anon"));
  assert(!SQL.includes("to authenticated"));
});

// -------------------------------------------------------------------------
// Seed contents
// -------------------------------------------------------------------------

/** Counts top-level `( ... )` tuples inside a normalized VALUES block. */
function countValueTuples(block: string): number {
  const valuesIdx = block.lastIndexOf(" values ");
  assert(valuesIdx > -1, "seed block has no VALUES clause");
  const tail = block.slice(valuesIdx + " values ".length);
  let depth = 0;
  let tuples = 0;
  for (const ch of tail) {
    if (ch === "(") {
      if (depth === 0) tuples += 1;
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    }
  }
  return tuples;
}

Deno.test("exactly the two implemented product capabilities are seeded", () => {
  const seedStart = SQL.indexOf("insert into public.api_capability_catalogue");
  assert(seedStart > -1);
  const seedBlock = SQL.slice(seedStart, SQL.indexOf(";", seedStart));
  // Proof is the tuple count inside the catalogue seed block itself, not the
  // number of INSERT statements in the migration.
  assert(
    countValueTuples(seedBlock) === 2,
    "catalogue seed block must contain exactly two capability tuples",
  );
  assert(seedBlock.includes("'organizations:list'"));
  assert(seedBlock.includes("'me:read'"));
  assert(SQL.includes("insert into public.api_client_supported_capabilities"));


  assert(
    SQL.includes(
      "'v1','read','organizations:list','organizations.get','get', '/v1/organizations','organization',",
    ),
  );
  assert(
    SQL.includes("'v1','read','me:read','me.get','get', '/v1/me','organization',"),
  );

  // organizations:list administrator-assignable, me:read not.
  const orgIdx = SQL.indexOf("'organizations:list'");
  const meIdx = SQL.indexOf("'me:read'");
  assert(orgIdx > -1 && meIdx > orgIdx);
  const orgBlock = SQL.slice(orgIdx, meIdx);
  const meBlock = SQL.slice(meIdx, SQL.indexOf(";", meIdx));
  assert(orgBlock.includes("true,'active'"));
  assert(meBlock.includes("false,'active'"));
});

Deno.test("no prohibited capability is seeded", () => {
  const seedStart = SQL.indexOf("insert into public.api_capability_catalogue");
  const seedBlock = SQL.slice(seedStart, SQL.indexOf(";", seedStart));
  for (
    const bad of [
      "'command'",
      "'*'",
      "crud",
      "'rpc'",
      "table_access",
      "service_role",
      "postgrest",
      "wildcard",
    ]
  ) {
    assert(!seedBlock.includes(bad), `prohibited seed value present: ${bad}`);
  }
});

Deno.test("no client, Astra, tenant, org, workspace or project identifier is seeded", () => {
  assert(!SQL.includes("astra"));
  const seedStart = SQL.indexOf("insert into public.api_capability_catalogue");
  const seedBlock = SQL.slice(seedStart, SQL.indexOf(";", seedStart));
  // No literal UUIDs anywhere in the seed.
  assert(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(
      seedBlock,
    ),
  );
  for (
    const bad of ["tenant_id", "organization_id", "workspace_id", "project_id"]
  ) {
    assert(!seedBlock.includes(bad), `scope identifier seeded: ${bad}`);
  }
  assert(!SQL.includes("insert into public.api_clients"));
});

// -------------------------------------------------------------------------
// Preflight, backfill and grant integrity
// -------------------------------------------------------------------------

Deno.test("existing-grant preflight is generic and safe", () => {
  assert(SQL.includes("select count(*) into v_unmatched"));
  assert(SQL.includes("from public.api_capability_grants g"));
  assert(SQL.includes("human owner review required"));
  assert(SQL.includes("raise exception"));
  // Exception message must not expose identifiers.
  const idx = SQL.indexOf("human owner review required");
  const msgBlock = SQL.slice(idx - 400, idx + 200);
  for (
    const bad of [
      "new.id",
      "g.id",
      "g.api_client_id",
      "g.tenant_id",
      "g.organization_id",
      "g.workspace_id",
    ]
  ) {
    assert(!msgBlock.includes(bad), `preflight exposes identifier: ${bad}`);
  }
});

Deno.test("backfill is derived only from existing grants and mutates none", () => {
  const start = SQL.indexOf(
    "insert into public.api_client_supported_capabilities",
  );
  const block = SQL.slice(start, SQL.indexOf(";", start));
  assert(block.includes("from public.api_capability_grants g"));
  assert(
    block.includes(
      "group by g.api_client_id, g.api_version, g.capability_kind, g.capability_key",
    ),
  );
  assert(block.includes("bool_or(g.lifecycle_status = 'enabled')"));
  assert(!SQL.includes("update public.api_capability_grants set"));
  assert(!SQL.includes("delete from public.api_capability_grants"));
});

Deno.test("grant-to-supported-capability FK is added and validated", () => {
  assert(
    SQL.includes(
      "add constraint api_capability_grants_supported_capability_fk foreign key (api_client_id, api_version, capability_kind, capability_key) references public.api_client_supported_capabilities (api_client_id, api_version, capability_kind, capability_key)",
    ),
  );
  assert(
    SQL.includes(
      "validate constraint api_capability_grants_supported_capability_fk",
    ),
  );
  assert(!SQL.includes("capability_id uuid"));
});

// -------------------------------------------------------------------------
// Lifecycle triggers
// -------------------------------------------------------------------------

const TRIGGER_FUNCTIONS = [
  "public.api_g_5_2_enforce_supported_capability_lifecycle",
  "public.api_g_5_2_enforce_grant_capability_lifecycle",
  "public.api_g_5_2_enforce_catalogue_lifecycle",
];

Deno.test("lifecycle integrity triggers exist", () => {
  for (const fn of TRIGGER_FUNCTIONS) {
    assert(SQL.includes(`create or replace function ${fn}()`), fn);
  }
  assert(
    SQL.includes(
      "create trigger api_g_5_2_supported_capability_lifecycle before insert or update on public.api_client_supported_capabilities",
    ),
  );
  assert(
    SQL.includes(
      "create trigger api_g_5_2_grant_capability_lifecycle before insert or update on public.api_capability_grants",
    ),
  );
  assert(
    SQL.includes(
      "create trigger api_g_5_2_catalogue_lifecycle before update or delete on public.api_capability_catalogue",
    ),
  );
  assert(
    SQL.includes("catalogue capabilities are retired, not deleted"),
  );
  assert(
    SQL.includes(
      "cannot disable supported capability % while enabled grants reference it",
    ),
  );
  assert(
    SQL.includes(
      "cannot retire capability % while enabled client support references it",
    ),
  );
});

Deno.test("trigger functions are SECURITY DEFINER, fixed search_path, service-role only", () => {
  for (const fn of TRIGGER_FUNCTIONS) {
    const idx = SQL.indexOf(`create or replace function ${fn}()`);
    const body = SQL.slice(idx, idx + 400);
    assert(body.includes("security definer"), `${fn} not security definer`);
    assert(body.includes("set search_path = public"), `${fn} search_path`);
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        SQL.includes(`revoke all on function ${fn}() from ${role}`),
        `${fn} not revoked from ${role}`,
      );
    }
    assert(
      SQL.includes(`grant execute on function ${fn}() to service_role`),
      `${fn} missing service_role grant`,
    );
  }
});

Deno.test("existing grant uniqueness and scope triggers are not removed", () => {
  assert(!SQL.includes("drop trigger"));
  assert(!SQL.includes("drop index"));
  assert(!SQL.includes("drop constraint"));
  assert(!SQL.includes("api_c_4_capability_grant_scope_integrity()"));
  assert(!SQL.includes("drop table"));
});

Deno.test("no RPC, function surface, mutation or runtime change is introduced", () => {
  const fnDefs = SQL.match(/create or replace function/g) ?? [];
  assert(fnDefs.length === TRIGGER_FUNCTIONS.length);
  for (
    const forbidden of [
      "api_v1_get_me",
      "api_v1_list_organizations",
      "authorize_and_establish",
      "tenant_integrations",
      "security invoker",
    ]
  ) {
    assert(!SQL.includes(forbidden), `unexpected reference: ${forbidden}`);
  }
});

// -------------------------------------------------------------------------
// Cross-file alignment with committed routes and runtime capability checks
// -------------------------------------------------------------------------

Deno.test("seeded rows match the committed route contracts", async () => {
  const me = await Deno.readTextFile(
    "supabase/functions/_shared/btpm-api/routes/me.ts",
  );
  const orgs = await Deno.readTextFile(
    "supabase/functions/_shared/btpm-api/routes/organizations.ts",
  );
  assert(me.includes('id: "me.get"'));
  assert(me.includes('method: "GET"'));
  assert(me.includes('path: "/v1/me"'));
  assert(orgs.includes('id: "organizations.get"'));
  assert(orgs.includes('method: "GET"'));
  assert(orgs.includes('path: "/v1/organizations"'));
});

Deno.test("seeded capability keys match the runtime enabled-grant checks", async () => {
  let found = 0;
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (
      text.includes("public.api_v1_get_me") &&
      text.includes("public.api_v1_list_organizations")
    ) {
      assert(text.includes("capability_key = 'me:read'"));
      assert(text.includes("capability_key = 'organizations:list'"));
      found += 1;
    }
  }
  assert(found > 0, "runtime capability-check migration not found");
});

Deno.test("no frontend, Edge Function, OAuth or secret surface is added", () => {
  for (
    const forbidden of [
      "supabase/functions/",
      "src/",
      "redirect_uri",
      "client_secret",
      "oauth",
    ]
  ) {
    assert(!SQL.includes(forbidden), `unexpected surface: ${forbidden}`);
  }
});

// -------------------------------------------------------------------------
// API-G.5.2-C1 — Route-version boundary and concurrent lifecycle integrity
// -------------------------------------------------------------------------

const C1_BOUNDARY_CHK =
  "api_capability_catalogue_route_version_boundary_chk";

Deno.test("C1 — the ineffective prefix expression alone is not sufficient proof", () => {
  // The original substring-prefix expression remains, but it accepts
  // '/v11/example' for api_version = 'v1'. It must no longer be treated as
  // proof of a version boundary on its own.
  assert(
    SQL.includes(
      "route_path = '/' || api_version || substring(route_path from length(api_version) + 2)",
    ),
    "original prefix expression must remain (not weakened)",
  );
  assert(
    !SQL.includes(C1_BOUNDARY_CHK),
    "boundary constraint must come from the C1 migration, not the original",
  );
  assert(
    C1_SQL.includes("route_path like '/' || api_version || '/%'"),
    "C1 must assert the exact version directory boundary",
  );
});

Deno.test("C1 — exact-boundary constraint is added NOT VALID and explicitly validated", () => {
  assert(
    C1_SQL.includes(
      `add constraint ${C1_BOUNDARY_CHK} check (route_path like '/' || api_version || '/%') not valid`,
    ),
    "boundary constraint must be added NOT VALID with the exact condition",
  );
  assert(
    C1_SQL.includes(`validate constraint ${C1_BOUNDARY_CHK}`),
    "boundary constraint must be explicitly validated",
  );
  assert(
    C1_SQL.indexOf("not valid") <
      C1_SQL.indexOf(`validate constraint ${C1_BOUNDARY_CHK}`),
  );
});

const C1_REPLACED_FUNCTIONS = [
  "public.api_g_5_2_enforce_supported_capability_lifecycle",
  "public.api_g_5_2_enforce_grant_capability_lifecycle",
];

Deno.test("C1 — supported-capability function locks the catalogue row FOR UPDATE", () => {
  const idx = C1_SQL.indexOf(
    "create or replace function public.api_g_5_2_enforce_supported_capability_lifecycle()",
  );
  assert(idx > -1);
  const body = C1_SQL.slice(idx, C1_SQL.indexOf("$$;", idx));
  const catIdx = body.indexOf("from public.api_capability_catalogue");
  assert(catIdx > -1, "catalogue read missing");
  const after = body.slice(catIdx);
  assert(
    after.slice(0, after.indexOf(";")).includes("for update"),
    "catalogue parent row must be locked FOR UPDATE",
  );
});

Deno.test("C1 — grant function locks supported-capability before catalogue", () => {
  const idx = C1_SQL.indexOf(
    "create or replace function public.api_g_5_2_enforce_grant_capability_lifecycle()",
  );
  assert(idx > -1);
  const body = C1_SQL.slice(idx, C1_SQL.indexOf("$$;", idx));
  const supIdx = body.indexOf("from public.api_client_supported_capabilities");
  const catIdx = body.indexOf("from public.api_capability_catalogue");
  assert(supIdx > -1 && catIdx > -1);
  assert(
    supIdx < catIdx,
    "supported-capability row must be locked before the catalogue row",
  );
  for (const start of [supIdx, catIdx]) {
    const stmt = body.slice(start, body.indexOf(";", start));
    assert(stmt.includes("for update"), "parent row must be locked FOR UPDATE");
  }
  // Disabled grants remain permitted historical records.
  assert(body.includes("if new.lifecycle_status <> 'enabled' then return new"));
});

Deno.test("C1 — replaced functions stay SECURITY DEFINER, fixed search_path, service-role only", () => {
  for (const fn of C1_REPLACED_FUNCTIONS) {
    const idx = C1_SQL.indexOf(`create or replace function ${fn}()`);
    assert(idx > -1, `${fn} not replaced`);
    const head = C1_SQL.slice(idx, idx + 400);
    assert(head.includes("returns trigger"), `${fn} signature changed`);
    assert(head.includes("security definer"), `${fn} not security definer`);
    assert(head.includes("set search_path = public"), `${fn} search_path`);
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        C1_SQL.includes(`revoke all on function ${fn}() from ${role}`),
        `${fn} not revoked from ${role}`,
      );
    }
    assert(
      C1_SQL.includes(`grant execute on function ${fn}() to service_role`),
      `${fn} missing service_role grant`,
    );
  }
});

Deno.test("C1 — existing trigger identities are untouched", () => {
  assert(!C1_SQL.includes("create trigger"));
  assert(!C1_SQL.includes("drop trigger"));
  assert(!C1_SQL.includes("drop function"));
  assert(!C1_SQL.includes("drop constraint"));
  assert(!C1_SQL.includes("drop table"));
  // Trigger names remain declared only by the original migration.
  for (
    const trg of [
      "api_g_5_2_supported_capability_lifecycle",
      "api_g_5_2_grant_capability_lifecycle",
      "api_g_5_2_catalogue_lifecycle",
    ]
  ) {
    assert(SQL.includes(`create trigger ${trg}`), `missing trigger: ${trg}`);
  }
});

Deno.test("C1 — correction carries no seed, backfill, grant rewrite or scope change", () => {
  assert(!C1_SQL.includes("insert into"));
  assert(!C1_SQL.includes("update public."));
  assert(!C1_SQL.includes("delete from"));
  assert(!C1_SQL.includes("create table"));
  assert(!C1_SQL.includes("create policy"));
  assert(!C1_SQL.includes("to anon"));
  assert(!C1_SQL.includes("to authenticated"));
  for (
    const forbidden of [
      "astra",
      "tenant_integrations",
      "api_clients",
      "oauth",
      "redirect_uri",
      "client_secret",
      "project_id",
      "workspace_id",
      "organization_id",
      "api_v1_get_me",
      "api_v1_list_organizations",
      "authorize_and_establish",
      "security invoker",
      "supabase/functions/",
      "src/",
    ]
  ) {
    assert(!C1_SQL.includes(forbidden), `unexpected reference: ${forbidden}`);
  }
  const fnDefs = C1_SQL.match(/create or replace function/g) ?? [];
  assert(fnDefs.length === C1_REPLACED_FUNCTIONS.length);
});
