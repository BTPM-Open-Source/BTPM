// API-G.5.5A — Platform client and OAuth-redirect administration backend.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen API-G.5.5A administration contract:
//   - public.api_platform_admin_audit_events exists with the exact required
//     shape, restrictive parent FK, enumerated target/action/source values,
//     lookup indexes, RLS enabled with zero policies and no browser access.
//   - The audit table is append-only even for service_role.
//   - Six Platform-Super-Admin-only RPCs exist, derive the actor exclusively
//     from auth.uid(), accept no caller-supplied actor or scope identifier,
//     are SECURITY DEFINER with a fixed search_path, revoked from
//     PUBLIC/anon and executable only by authenticated.
//   - Exact client and redirect transition graphs, draft-only creation and
//     draft-only metadata update.
//   - Parent-client-first lock ordering and ordinary UPDATE statements so the
//     accepted API-G.5.4/C1 triggers remain authoritative.
//   - Every successful mutation inserts one audit event in the same
//     transaction; no delete command exists.
//   - No policy-version, supported-capability, grant, enablement, UI, route,
//     Edge Function, OAuth-provider, secret, Astra or tenant_integrations
//     change; prior G.5.2 / G.5.3 / G.5.4 migrations remain untouched.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-G.5.5A — Platform client and OAuth-redirect administration backend";

async function findMigrationByMarker(
  marker: string,
): Promise<{ name: string; sql: string }> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (sql.includes(marker)) return { name: entry.name, sql };
  }
  throw new Error(`API-G.5.5A migration not found (marker: ${marker})`);
}

const migration = await findMigrationByMarker(MARKER);
const sql = migration.sql;
const lower = sql.toLowerCase();

// SQL comment lines are documentation, not executable material.
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const executableLower = executable.toLowerCase();

const RPCS = [
  "api_g_5_5_platform_create_client",
  "api_g_5_5_platform_update_draft_client",
  "api_g_5_5_platform_transition_client",
  "api_g_5_5_platform_create_oauth_redirect",
  "api_g_5_5_platform_update_draft_oauth_redirect",
  "api_g_5_5_platform_transition_oauth_redirect",
] as const;

function bodyOf(fnName: string): string {
  const start = executableLower.indexOf(
    `create or replace function public.${fnName}`,
  );
  assert(start >= 0, `function not found: ${fnName}`);
  const end = executableLower.indexOf("\n$$;", start);
  assert(end > start, `function body terminator not found: ${fnName}`);
  return executableLower.slice(start, end);
}

// ---------------------------------------------------------------------------
// Audit table
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5A: audit table shape", () => {
  assert(lower.includes("create table public.api_platform_admin_audit_events"));
  for (
    const col of [
      "id uuid primary key default gen_random_uuid()",
      "actor_user_id uuid not null",
      "api_client_id uuid not null",
      "target_type text not null",
      "target_id uuid not null",
      "action text not null",
      "previous_lifecycle_status text null",
      "resulting_lifecycle_status text not null",
      "event_at timestamptz not null default now()",
      "correlation_id uuid not null default gen_random_uuid()",
      "source_channel text not null default 'btpm_platform_admin'",
    ]
  ) {
    assert(lower.includes(col), `missing audit column contract: ${col}`);
  }
});

Deno.test("API-G.5.5A: restrictive parent FK, no actor FK", () => {
  assert(
    lower.includes("references public.api_clients(id) on delete restrict"),
    "audit parent FK must be restrictive",
  );
  assert(
    !executableLower.includes("actor_user_id uuid not null references"),
    "actor_user_id must preserve the immutable historical UUID without an FK",
  );
  assert(
    !executableLower.includes("auth.users"),
    "the audit substrate must not reference auth.users",
  );
});

Deno.test("API-G.5.5A: enumerated target, action and source values", () => {
  assert(lower.includes("target_type in ('api_client','oauth_redirect')"));
  assert(lower.includes("'client_create'"));
  assert(lower.includes("'client_update'"));
  assert(lower.includes("'client_transition'"));
  assert(lower.includes("'redirect_create'"));
  assert(lower.includes("'redirect_update'"));
  assert(lower.includes("'redirect_transition'"));
  assert(lower.includes("source_channel = 'btpm_platform_admin'"));
});

Deno.test("API-G.5.5A: audit lookup indexes", () => {
  assert(
    lower.includes(
      "on public.api_platform_admin_audit_events (api_client_id, event_at desc)",
    ),
    "client/event-time index required",
  );
  assert(
    lower.includes(
      "on public.api_platform_admin_audit_events (actor_user_id, event_at desc)",
    ),
    "actor/event-time index required",
  );
});

Deno.test("API-G.5.5A: audit table carries no sensitive or narrative field", () => {
  const auditStart = executableLower.indexOf(
    "create table public.api_platform_admin_audit_events",
  );
  const auditEnd = executableLower.indexOf(");", auditStart);
  const ddl = executableLower.slice(auditStart, auditEnd);
  for (
    const forbidden of [
      "redirect_uri",
      "oauth_client_id",
      "client_key",
      "narrative",
      "metadata",
      "jsonb",
      "payload",
      "error",
      "detail",
      "token",
      "secret",
      "credential",
      "description",
      "uri",
      "url",
    ]
  ) {
    assert(
      !ddl.includes(forbidden),
      `audit table must not carry a ${forbidden} field`,
    );
  }
});

Deno.test("API-G.5.5A: audit RLS enabled with zero policies", () => {
  assert(
    lower.includes(
      "alter table public.api_platform_admin_audit_events enable row level security",
    ),
  );
  assert(
    !executableLower.includes("create policy"),
    "the migration must create zero RLS policies",
  );
});

Deno.test("API-G.5.5A: browser roles have no audit-table access", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert(
      lower.includes(
        `revoke all on table public.api_platform_admin_audit_events from ${role}`,
      ),
      `audit table must be revoked from ${role}`,
    );
  }
  assert(
    lower.includes(
      "grant select, insert on table public.api_platform_admin_audit_events to service_role",
    ),
    "service_role receives SELECT, INSERT only",
  );
  assert(
    !executableLower.includes(
      "grant all on table public.api_platform_admin_audit_events",
    ),
    "no blanket grant on the audit table",
  );
  assert(
    !/grant[^;]*update[^;]*on table public\.api_platform_admin_audit_events/s
      .test(executableLower),
    "no UPDATE privilege on the audit table",
  );
  assert(
    !/grant[^;]*delete[^;]*on table public\.api_platform_admin_audit_events/s
      .test(executableLower),
    "no DELETE privilege on the audit table",
  );
});

Deno.test("API-G.5.5A: audit UPDATE and DELETE are prohibited", () => {
  assert(
    lower.includes(
      "create or replace function public.api_g_5_5_protect_platform_admin_audit_event()",
    ),
  );
  const body = bodyOf("api_g_5_5_protect_platform_admin_audit_event");
  assert(body.includes("raise exception"), "the guard must reject the op");
  assert(body.includes("42501"), "the guard must raise insufficient privilege");
  assert(body.includes("security definer"));
  assert(body.includes("set search_path = public, pg_catalog"));
  assert(
    lower.includes(
      "before update or delete on public.api_platform_admin_audit_events",
    ),
    "append-only trigger must cover UPDATE and DELETE",
  );
  assert(
    lower.includes("create trigger api_g_5_5_platform_admin_audit_append_only"),
  );
  assert(lower.includes("for each row"), "the guard must be a row trigger");
});

Deno.test("API-G.5.5A: only service_role may execute the audit guard", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert(
      lower.includes(
        `revoke all on function public.api_g_5_5_protect_platform_admin_audit_event() from ${role}`,
      ),
      `audit guard must be revoked from ${role}`,
    );
  }
  assert(
    lower.includes(
      "grant execute on function public.api_g_5_5_protect_platform_admin_audit_event() to service_role",
    ),
  );
});

// ---------------------------------------------------------------------------
// RPC surface and authority
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5A: all six RPC signatures exist", () => {
  const signatures = [
    "public.api_g_5_5_platform_create_client(\n  _client_key text,\n  _display_name text,\n  _description text default null,\n  _oauth_client_id text default null\n)",
    "public.api_g_5_5_platform_update_draft_client(\n  _api_client_id uuid,\n  _display_name text,\n  _description text default null,\n  _oauth_client_id text default null\n)",
    "public.api_g_5_5_platform_transition_client(\n  _api_client_id uuid,\n  _target_lifecycle_status text\n)",
    "public.api_g_5_5_platform_create_oauth_redirect(\n  _api_client_id uuid,\n  _redirect_uri text\n)",
    "public.api_g_5_5_platform_update_draft_oauth_redirect(\n  _redirect_id uuid,\n  _redirect_uri text\n)",
    "public.api_g_5_5_platform_transition_oauth_redirect(\n  _redirect_id uuid,\n  _target_lifecycle_status text\n)",
  ];
  for (const signature of signatures) {
    assert(
      executableLower.includes(signature),
      `missing exact RPC signature: ${signature.split("(")[0]}`,
    );
  }
  for (const fn of RPCS) {
    assert(
      bodyOf(fn).includes("returns uuid"),
      `${fn} must return only a uuid`,
    );
  }
});

Deno.test("API-G.5.5A: every RPC derives the actor from auth.uid()", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(
      body.includes("v_actor uuid := auth.uid()"),
      `${fn} must derive the actor from auth.uid()`,
    );
    assert(
      body.includes("if v_actor is null then"),
      `${fn} must reject unauthenticated callers`,
    );
  }
});

Deno.test("API-G.5.5A: every RPC requires Platform Super Admin authority", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(
      body.includes("if not public.is_platform_super_admin(v_actor) then"),
      `${fn} must require is_platform_super_admin`,
    );
    assert(
      body.includes("security definer"),
      `${fn} must be SECURITY DEFINER`,
    );
    assert(
      body.includes("set search_path = public, pg_catalog"),
      `${fn} must fix its search_path`,
    );
  }
});

Deno.test("API-G.5.5A: no caller-supplied actor or scope identifier", () => {
  for (const fn of RPCS) {
    const header = bodyOf(fn).split(")")[0];
    for (
      const forbidden of [
        "_actor",
        "_user_id",
        "_tenant_id",
        "_organization_id",
        "_workspace_id",
        "_project_id",
      ]
    ) {
      assert(
        !header.includes(forbidden),
        `${fn} must not accept ${forbidden}`,
      );
    }
  }
  assert(
    !executableLower.includes("is_tenant_admin") &&
      !executableLower.includes("is_organization_admin") &&
      !executableLower.includes("is_workspace_admin"),
    "Tenant, Organization and Workspace admins must not receive these commands",
  );
});

Deno.test("API-G.5.5A: RPC privileges are authenticated-only", () => {
  for (const fn of RPCS) {
    const revokes = executableLower.match(
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from (public|anon)`, "g"),
    ) ?? [];
    assert(revokes.length === 2, `${fn} must be revoked from PUBLIC and anon`);
    assert(
      new RegExp(
        `grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`,
      ).test(executableLower),
      `${fn} must be executable by authenticated`,
    );
    assert(
      !new RegExp(
        `grant execute on function public\\.${fn}\\([^)]*\\) to (anon|public)`,
      ).test(executableLower),
      `${fn} must not be granted to anon or PUBLIC`,
    );
  }
});

Deno.test("API-G.5.5A: no direct table grant to authenticated", () => {
  assert(
    !/grant[^;]*on table public\.api_clients to authenticated/s.test(
      executableLower,
    ),
    "no direct authenticated grant on api_clients",
  );
  assert(
    !/grant[^;]*on table public\.api_client_oauth_redirect_uris to authenticated/s
      .test(executableLower),
    "no direct authenticated grant on redirect metadata",
  );
});

// ---------------------------------------------------------------------------
// Client command behaviour
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5A: client creation is draft-only and actor-stamped", () => {
  const body = bodyOf("api_g_5_5_platform_create_client");
  assert(body.includes("insert into public.api_clients"));
  assert(body.includes("'draft', v_actor, v_actor"), "draft + actor stamping");
  assert(
    body.includes("_client_key <> btrim(_client_key)") &&
      body.includes("_client_key <> lower(_client_key)"),
    "client key must already be trimmed and lowercase",
  );
  assert(
    body.includes("nullif(btrim(coalesce(_description, '')), '')"),
    "blank description becomes NULL",
  );
  assert(
    body.includes("_oauth_client_id <> lower(_oauth_client_id)"),
    "supplied OAuth client identifier must be lowercase",
  );
});

Deno.test("API-G.5.5A: draft client update cannot change identity", () => {
  const body = bodyOf("api_g_5_5_platform_update_draft_client");
  assert(body.includes("from public.api_clients"), "authoritative row read");
  assert(body.includes("for update"), "row must be locked");
  assert(
    body.includes("if v_lifecycle <> 'draft' then"),
    "update is draft-only",
  );
  const updateStmt = body.slice(body.indexOf("update public.api_clients"));
  assert(!updateStmt.includes("client_key ="), "client_key is immutable");
  assert(!updateStmt.includes("set id ="), "id is immutable");
  assert(updateStmt.includes("updated_by = v_actor"));
});

Deno.test("API-G.5.5A: client transition graph is exact", () => {
  const body = bodyOf("api_g_5_5_platform_transition_client");
  assert(
    body.includes("(v_previous = 'draft'     and v_target in ('active','retired'))"),
    "draft may only become active or retired",
  );
  assert(
    body.includes("(v_previous = 'active'    and v_target in ('suspended','retired'))"),
    "active may only become suspended or retired",
  );
  assert(
    body.includes("(v_previous = 'suspended' and v_target in ('active','retired'))"),
    "suspended may only become active or retired",
  );
  assert(
    body.includes("if v_previous = v_target then"),
    "no-op transitions must be rejected",
  );
  assert(
    body.includes(
      "v_target not in ('draft','active','suspended','retired')",
    ),
    "unknown lifecycle values must be rejected",
  );
  // retired is terminal and draft is never a target of the graph.
  assert(
    !body.includes("v_previous = 'retired'"),
    "no transition out of retired exists",
  );
  assert(
    !body.includes("v_target = 'draft'") &&
      !body.includes("v_target in ('draft'"),
    "no transition back to draft exists",
  );
});

Deno.test("API-G.5.5A: client activation flows through the API-G.5.4 trigger", () => {
  const body = bodyOf("api_g_5_5_platform_transition_client");
  assert(
    body.includes("update public.api_clients\n     set lifecycle_status = v_target"),
    "an ordinary UPDATE keeps the accepted trigger authoritative",
  );
  assert(
    !executableLower.includes("alter table public.api_clients disable trigger") &&
      !executableLower.includes("session_replication_role"),
    "the accepted lifecycle triggers must never be bypassed",
  );
});

// ---------------------------------------------------------------------------
// Redirect command behaviour
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5A: redirect creation is draft-only and exact-valued", () => {
  const body = bodyOf("api_g_5_5_platform_create_oauth_redirect");
  assert(body.includes("from public.api_clients"), "parent read");
  assert(body.includes("for update"), "parent lock");
  assert(
    body.includes("if v_client_lifecycle = 'retired' then"),
    "a retired parent must be rejected",
  );
  assert(
    body.includes("_api_client_id, _redirect_uri, 'draft'") &&
      body.includes("null, null, v_actor, v_actor"),
    "draft insert with null lifecycle timestamps and actor stamping",
  );
  assert(
    !body.includes("lower(_redirect_uri)") &&
      !body.includes("btrim(_redirect_uri)"),
    "the exact supplied URI must be preserved",
  );
});

Deno.test("API-G.5.5A: redirect update is draft-only and parent-stable", () => {
  const body = bodyOf("api_g_5_5_platform_update_draft_oauth_redirect");
  assert(
    body.includes("if v_redirect_lifecycle <> 'draft' then"),
    "redirect update is draft-only",
  );
  const updateStmt = body.slice(
    body.indexOf("update public.api_client_oauth_redirect_uris"),
  );
  assert(
    !updateStmt.includes("api_client_id ="),
    "parent identity is immutable",
  );
  assert(!updateStmt.includes("set id ="), "redirect id is immutable");
  assert(updateStmt.includes("redirect_uri = _redirect_uri"));
  assert(updateStmt.includes("updated_by = v_actor"));
});

Deno.test("API-G.5.5A: redirect transition graph and timestamps are exact", () => {
  const body = bodyOf("api_g_5_5_platform_transition_oauth_redirect");
  assert(
    body.includes("(v_previous = 'draft'  and v_target in ('active','retired'))"),
    "draft may only become active or retired",
  );
  assert(
    body.includes("(v_previous = 'active' and v_target = 'retired')"),
    "active may only become retired",
  );
  assert(
    body.includes("if v_previous = v_target then"),
    "no-op transitions must be rejected",
  );
  assert(
    body.includes("v_target not in ('draft','active','retired')"),
    "unknown lifecycle values must be rejected",
  );
  assert(
    !body.includes("v_target = 'draft'"),
    "no return to draft exists",
  );
  assert(
    body.includes("verified_at = now()") && body.includes("retired_at = null"),
    "activation sets verified_at and keeps retired_at NULL",
  );
  assert(
    body.includes("set lifecycle_status = 'retired'") &&
      body.includes("retired_at = now()"),
    "retirement sets retired_at",
  );
  const retireStmt = body.slice(body.indexOf("set lifecycle_status = 'retired'"));
  assert(
    !retireStmt.includes("verified_at ="),
    "retirement must retain the exact historical verified_at",
  );
});

Deno.test("API-G.5.5A: parent-client-first lock ordering is preserved", () => {
  for (
    const fn of [
      "api_g_5_5_platform_update_draft_oauth_redirect",
      "api_g_5_5_platform_transition_oauth_redirect",
    ]
  ) {
    const body = bodyOf(fn);
    const clientLock = body.indexOf(
      "from public.api_clients c\n   where c.id = v_client_id\n   for update",
    );
    const redirectLock = body.indexOf(
      "from public.api_client_oauth_redirect_uris r\n   where r.id = _redirect_id\n   for update",
    );
    assert(clientLock >= 0, `${fn} must lock the parent client`);
    assert(redirectLock >= 0, `${fn} must lock the redirect row`);
    assert(
      clientLock < redirectLock,
      `${fn} must lock the parent client before the redirect`,
    );
  }
});

// ---------------------------------------------------------------------------
// Atomicity, deletion and scope
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5A: every mutation inserts exactly one audit event", () => {
  const expected: Record<string, string> = {
    api_g_5_5_platform_create_client: "'client_create'",
    api_g_5_5_platform_update_draft_client: "'client_update'",
    api_g_5_5_platform_transition_client: "'client_transition'",
    api_g_5_5_platform_create_oauth_redirect: "'redirect_create'",
    api_g_5_5_platform_update_draft_oauth_redirect: "'redirect_update'",
    api_g_5_5_platform_transition_oauth_redirect: "'redirect_transition'",
  };
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    const inserts =
      body.match(/insert into public\.api_platform_admin_audit_events/g) ?? [];
    assert(inserts.length === 1, `${fn} must insert exactly one audit event`);
    assert(
      body.includes(expected[fn]),
      `${fn} must record action ${expected[fn]}`,
    );
    assert(
      body.includes("v_actor, "),
      `${fn} must record the derived actor`,
    );
    // No exception swallowing: an audit failure rolls the change back.
    assert(
      !body.includes("exception when"),
      `${fn} must not trap exceptions around the audit write`,
    );
    assert(
      !body.includes("commit") && !body.includes("rollback"),
      `${fn} must remain in the caller's single transaction`,
    );
  }
});

Deno.test("API-G.5.5A: no delete command and no dynamic SQL", () => {
  assert(
    !/delete\s+from/.test(executableLower),
    "no physical-delete command may exist",
  );
  assert(
    !executableLower.includes("execute format") &&
      !executableLower.includes("execute '"),
    "no dynamic SQL",
  );
  assert(
    !executableLower.includes("drop table") &&
      !executableLower.includes("drop function") &&
      !executableLower.includes("drop trigger"),
    "the migration must be additive only",
  );
});

Deno.test("API-G.5.5A: no out-of-scope substrate is touched", () => {
  for (
    const forbidden of [
      "api_client_policy_versions",
      "api_client_supported_capabilities",
      "api_capability_catalogue",
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_rate_limit_profiles",
      "api_user_policy_acknowledgements",
      "tenant_integrations",
      "astra",
      "client_secret",
      "authorization_code",
      "access_token",
      "refresh_token",
    ]
  ) {
    assert(
      !executableLower.includes(forbidden),
      `API-G.5.5A must not touch ${forbidden}`,
    );
  }
  assert(
    !executableLower.includes("insert into public.api_clients (client_key, display_name, description, oauth_client_id, lifecycle_status) values"),
    "no seed client",
  );
});

Deno.test("API-G.5.5A: prior G.5.2 / G.5.3 / G.5.4 migrations remain untouched", async () => {
  const priorMarkers = [
    "API-G.5.2 — Capability catalogue and grant integrity",
    "API-G.5.3 — Project-level application scope",
    "API-G.5.4 — OAuth registration metadata contract",
    "API-G.5.4-C1 — OAuth lifecycle rollback and active-insert integrity",
  ];
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  for (const marker of priorMarkers) {
    const matches = names.filter((n) => {
      const text = Deno.readTextFileSync(`${MIGRATIONS_DIR}/${n}`);
      return text.includes(marker);
    });
    assert(
      matches.length === 1,
      `exactly one migration must carry the marker: ${marker}`,
    );
    assert(
      matches[0] < migration.name,
      `${marker} must remain an earlier, untouched migration`,
    );
  }
  assert(
    !sql.includes("API-G.5.5B") && !sql.includes("API-G.5.6"),
    "API-G.5.5B and API-G.5.6 remain unstarted",
  );
});

Deno.test("API-G.5.5A-P1: audit privileges are pinned to SELECT, INSERT for service_role", async () => {
  const pin = await findMigrationByMarker(
    "API-G.5.5A-P1 — Platform administration audit privilege pin",
  );
  const p = pin.sql.toLowerCase();
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    assert(
      p.includes(
        `revoke all on table public.api_platform_admin_audit_events from ${role}`,
      ),
      `privilege pin must revoke ${role}`,
    );
  }
  assert(
    p.includes(
      "grant select, insert on table public.api_platform_admin_audit_events to service_role",
    ),
    "service_role is re-granted SELECT, INSERT only",
  );
  assert(
    !p.includes("create policy") && !p.includes("create table") &&
      !p.includes("drop ") && !p.includes("insert into"),
    "the privilege pin must change nothing but privileges",
  );
});

// ---------------------------------------------------------------------------
// API-G.5.5A-C1 — Redirect authoritative-parent revalidation
// ---------------------------------------------------------------------------

const C1_MARKER = "API-G.5.5A-C1 — Redirect authoritative-parent revalidation";
const c1 = await findMigrationByMarker(C1_MARKER);
const c1Executable = c1.sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();

const C1_RPCS = [
  "api_g_5_5_platform_update_draft_oauth_redirect",
  "api_g_5_5_platform_transition_oauth_redirect",
] as const;

function c1BodyOf(fnName: string): string {
  const start = c1Executable.indexOf(
    `create or replace function public.${fnName}`,
  );
  assert(start >= 0, `corrected function not found: ${fnName}`);
  const end = c1Executable.indexOf("\n$$;", start);
  assert(end > start, `corrected function body terminator not found: ${fnName}`);
  return c1Executable.slice(start, end);
}

Deno.test("API-G.5.5A-C1: correction replaces only the two redirect-by-id commands", () => {
  const replaced = [...c1Executable.matchAll(/create or replace function public\.(\w+)/g)]
    .map((m) => m[1]);
  assert(
    replaced.length === 2 &&
      replaced.every((f) => (C1_RPCS as readonly string[]).includes(f)),
    "only the two redirect-by-id RPCs may be replaced",
  );
  for (
    const forbidden of [
      "create table",
      "alter table",
      "create policy",
      "drop policy",
      "create trigger",
      "drop trigger",
      "insert into public.api_clients",
      "insert into public.api_client_oauth_redirect_uris",
      "grant select",
      "grant insert",
      "execute format",
      "execute '",
    ]
  ) {
    assert(
      !c1Executable.includes(forbidden),
      `correction must not contain: ${forbidden}`,
    );
  }
});

for (const fn of C1_RPCS) {
  Deno.test(`API-G.5.5A-C1: ${fn} revalidates the locked parent`, () => {
    const body = c1BodyOf(fn);

    // 1. Candidate parent discovered first, unlocked.
    const candidateRead = body.indexOf(
      "select r.api_client_id\n    into v_candidate_client_id",
    );
    assert(candidateRead > 0, "candidate parent discovery must come first");

    // 2. Candidate parent row locked FOR UPDATE.
    const parentLock = body.indexOf("from public.api_clients c");
    assert(parentLock > candidateRead, "parent lock follows candidate discovery");
    assert(
      body.slice(parentLock, parentLock + 200).includes("for update"),
      "candidate parent row must be locked FOR UPDATE",
    );

    // 3. Redirect then locked FOR UPDATE, reading parent AND lifecycle.
    const lockedRead = body.indexOf("select r.api_client_id, r.lifecycle_status");
    assert(lockedRead > parentLock, "redirect lock follows the parent lock");
    assert(
      body.slice(lockedRead, lockedRead + 260).includes("for update"),
      "redirect row must be locked FOR UPDATE",
    );
    assert(
      body.slice(lockedRead, lockedRead + 260).includes("into v_locked_client_id"),
      "locked redirect read must retrieve its current parent",
    );

    // 4. Locked parent compared with candidate parent.
    const drift = body.indexOf(
      "if v_locked_client_id is distinct from v_candidate_client_id then",
    );
    assert(drift > lockedRead, "comparison must follow the locked redirect read");

    // 5. Drift raises SQLSTATE 40001 with a non-enumerating message.
    const driftBlock = body.slice(drift, drift + 260);
    assert(driftBlock.includes("errcode = '40001'"), "drift must use SQLSTATE 40001");
    assert(
      !driftBlock.includes("_redirect_id") &&
        !driftBlock.includes("v_locked_client_id ||") &&
        !driftBlock.includes("%"),
      "drift error must not disclose identifiers",
    );

    // 6/7. Drift aborts before the business UPDATE and before the audit INSERT.
    const update = body.search(
      /update public\.api_client_oauth_redirect_uris\s+set/,
    );
    const audit = body.indexOf(
      "insert into public.api_platform_admin_audit_events",
    );
    assert(update > drift, "drift rejection precedes the business UPDATE");
    assert(audit > drift, "drift rejection precedes the audit INSERT");

    // 8. The revalidated parent is used by the audit event.
    assert(
      body.slice(audit).includes("v_locked_client_id"),
      "audit event must use the revalidated locked parent id",
    );
    assert(
      !body.slice(audit).includes("v_candidate_client_id"),
      "audit event must not use the unlocked candidate parent id",
    );

    // 9. No automatic retry loop inside the transaction.
    for (const loop of ["loop", "while ", "exception when", "begin\n    "]) {
      assert(!body.includes(`\n  ${loop}`), `no retry construct: ${loop}`);
    }

    // 10. Security posture unchanged.
    assert(body.includes("security definer"));
    assert(body.includes("set search_path = public, pg_catalog"));
    assert(body.includes("v_actor uuid := auth.uid()"));
    assert(body.includes("public.is_platform_super_admin(v_actor)"));
    assert(!body.includes("_actor_user_id"), "no caller-supplied actor");
  });

  Deno.test(`API-G.5.5A-C1: ${fn} privileges are repeated unchanged`, () => {
    const sig = fn.endsWith("redirect") ? "(uuid, text)" : "(uuid, text)";
    assert(
      c1Executable.includes(
        `revoke all on function public.${fn}${sig} from public`,
      ),
    );
    assert(
      c1Executable.includes(
        `revoke all on function public.${fn}${sig} from anon`,
      ),
    );
    assert(
      c1Executable.includes(
        `grant execute on function public.${fn}${sig} to authenticated`,
      ),
    );
  });
}

Deno.test("API-G.5.5A-C1: preserved lifecycle, timestamp and audit behavior", () => {
  const upd = c1BodyOf("api_g_5_5_platform_update_draft_oauth_redirect");
  assert(upd.includes("v_redirect_lifecycle <> 'draft'"), "draft-only update");
  assert(
    upd.includes("set redirect_uri = _redirect_uri") &&
      upd.includes("updated_by = v_actor"),
    "exact URI preservation and actor stamping",
  );
  assert(upd.includes("'redirect_update', 'draft', 'draft'"));
  assert(upd.includes("return _redirect_id;"));
  assert(!upd.includes("api_client_id ="), "parent is never reassigned");

  const tr = c1BodyOf("api_g_5_5_platform_transition_oauth_redirect");
  assert(tr.includes("not in ('draft','active','retired')"), "unknown values rejected");
  assert(tr.includes("v_previous = v_target"), "no-ops rejected");
  assert(
    tr.includes("(v_previous = 'draft'  and v_target in ('active','retired'))") &&
      tr.includes("(v_previous = 'active' and v_target = 'retired')"),
    "exact transition graph",
  );
  assert(
    tr.includes("verified_at = now()") && tr.includes("retired_at = now()") &&
      tr.includes("retired_at = null"),
    "timestamp behavior preserved",
  );
  assert(tr.includes("'redirect_transition', v_previous, v_target"));
  assert(tr.includes("return _redirect_id;"));

  // Ordinary UPDATEs keep the API-G.5.4/C1 triggers authoritative.
  assert(
    !c1Executable.includes("alter table") &&
      !c1Executable.includes("disable trigger"),
    "lifecycle triggers remain authoritative",
  );
});

Deno.test("API-G.5.5A-C1: original migrations remain earlier and untouched", () => {
  assert(migration.name < c1.name, "G.5.5A migration precedes the correction");
  assert(
    !migration.sql.includes(C1_MARKER) && !migration.sql.includes("v_locked_client_id"),
    "the original G.5.5A migration is unchanged",
  );
  assert(
    !c1.sql.includes("API-G.5.5B") && !c1.sql.includes("API-G.5.6"),
    "API-G.5.5B and API-G.5.6 remain unstarted",
  );
});
