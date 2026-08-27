// API-D.3 — Protected acknowledge/revoke commands + immutable consent audit substrate.
//
// Repository contract test. Validates the API-D.3 migration matches the
// bounded-prompt requirements and the API-D contract:
//
//   - One additive forward-only migration creating exactly:
//     * table  public.api_consent_audit_events
//     * function public.acknowledge_api_d_policy(_client_key text, _correlation_id text)
//     * function public.revoke_api_d_policy(_client_key text, _correlation_id text)
//     * append-only trigger(s) rejecting UPDATE and DELETE on the audit table
//   - Least-privilege posture, safe response shape, fail-closed authority
//     reproduction, no OAuth / API-E artifacts, no browser callers yet.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260722090827_bad570a1-7cad-4041-837c-8b56806afd5c.sql";

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Migration presence + exact object surface
// ---------------------------------------------------------------------------

Deno.test("API-D.3 migration file exists", async () => {
  const stat = await Deno.stat(MIGRATION_PATH);
  assert(stat.isFile);
});

Deno.test("API-D.3 creates exactly one new table: api_consent_audit_events", async () => {
  const raw = await readMigration();
  const matches = raw.match(/create\s+table\s+/gi) ?? [];
  assert(matches.length === 1, `expected exactly one CREATE TABLE; found ${matches.length}`);
  assert(normalize(raw).includes("create table public.api_consent_audit_events"));
});

Deno.test("API-D.3 defines exactly the two protected consent commands with the required signatures", async () => {
  const raw = await readMigration();
  const sql = normalize(raw);
  assert(
    sql.includes(
      "create or replace function public.acknowledge_api_d_policy( _client_key text, _correlation_id text default null )",
    ),
  );
  assert(
    sql.includes(
      "create or replace function public.revoke_api_d_policy( _client_key text, _correlation_id text default null )",
    ),
  );
  // One additional internal reject-mutation function is allowed.
  const fnMatches = raw.match(/create\s+or\s+replace\s+function/gi) ?? [];
  assert(
    fnMatches.length === 3,
    `expected exactly three function definitions (2 commands + 1 audit reject); found ${fnMatches.length}`,
  );
});

// ---------------------------------------------------------------------------
// Audit table contract
// ---------------------------------------------------------------------------

Deno.test("API-D.3 audit table contains only the bounded, non-sensitive control columns", async () => {
  const sql = normalize(await readMigration());
  for (
    const col of [
      "id uuid primary key default gen_random_uuid()",
      "actor_user_id uuid not null",
      "api_client_id uuid not null references public.api_clients(id)",
      "policy_version_id uuid not null references public.api_client_policy_versions(id)",
      "action text not null check (action in ('acknowledge','revoke'))",
      "event_at timestamptz not null default now()",
      "source_channel text not null default 'btpm_ui' check (source_channel in ('btpm_ui'))",
      "correlation_id text",
      "metadata jsonb not null default '{}'::jsonb",
    ]
  ) {
    assert(sql.includes(col), `audit column definition missing: ${col}`);
  }
  // Correlation-ID shape guard.
  assert(sql.includes("correlation_id ~ '^[a-za-z0-9_-]{1,64}$'"));
});

Deno.test("API-D.3 audit table forbids raw IP, user-agent, tokens, secrets, and policy bodies", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "ip_address",
      "user_agent",
      "access_token",
      "refresh_token",
      "id_token",
      "client_secret",
      "policy_body",
      "policy_text",
      "personal_note",
      "narrative",
    ]
  ) {
    assert(!sql.includes(forbidden), `audit table must not include ${forbidden}`);
  }
});

Deno.test("API-D.3 audit table enables RLS and adds no browser-readable policy", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("alter table public.api_consent_audit_events enable row level security"));
  assert(!sql.includes("create policy"));
});

Deno.test("API-D.3 audit table revokes access from PUBLIC/anon/authenticated and grants only service_role", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("revoke all on table public.api_consent_audit_events from public"));
  assert(sql.includes("revoke all on table public.api_consent_audit_events from anon"));
  assert(sql.includes("revoke all on table public.api_consent_audit_events from authenticated"));
  assert(sql.includes("grant all on table public.api_consent_audit_events to service_role"));
  for (
    const forbidden of [
      "grant select on table public.api_consent_audit_events to anon",
      "grant select on table public.api_consent_audit_events to authenticated",
      "grant insert on table public.api_consent_audit_events to anon",
      "grant insert on table public.api_consent_audit_events to authenticated",
      "grant update on table public.api_consent_audit_events",
      "grant delete on table public.api_consent_audit_events",
    ]
  ) {
    assert(!sql.includes(forbidden), `audit table must not grant: ${forbidden}`);
  }
});

Deno.test("API-D.3 audit table is append-only via BEFORE UPDATE and BEFORE DELETE triggers that raise", async () => {
  const sql = normalize(await readMigration());
  assert(sql.includes("create trigger api_consent_audit_events_no_update"));
  assert(sql.includes("before update on public.api_consent_audit_events"));
  assert(sql.includes("create trigger api_consent_audit_events_no_delete"));
  assert(sql.includes("before delete on public.api_consent_audit_events"));
  assert(
    sql.includes(
      "create or replace function public.api_consent_audit_events_reject_mutation()",
    ),
  );
  assert(sql.includes("raise exception 'api_consent_audit_events is append-only"));
  // Reject function is SECURITY DEFINER so service_role initiated updates are also blocked.
  const start = sql.indexOf("api_consent_audit_events_reject_mutation()");
  assert(start >= 0);
  const body = sql.substring(start, start + 400);
  assert(body.includes("security definer"));
  assert(body.includes("set search_path = public"));
});

// ---------------------------------------------------------------------------
// Command function security posture
// ---------------------------------------------------------------------------

function functionBody(sql: string, marker: string): string {
  const start = sql.indexOf(marker);
  assert(start >= 0, `marker not found: ${marker}`);
  return sql.substring(start, start + 4500);
}

Deno.test("API-D.3 both commands are SECURITY DEFINER, plpgsql, with fixed search_path=public", async () => {
  const sql = normalize(await readMigration());
  for (const marker of ["acknowledge_api_d_policy(", "revoke_api_d_policy("]) {
    const body = functionBody(sql, `function public.${marker}`);
    assert(body.includes("language plpgsql"), `${marker}: language plpgsql`);
    assert(body.includes("security definer"), `${marker}: security definer`);
    assert(body.includes("set search_path = public"), `${marker}: search_path`);
    assert(body.includes("auth.uid()"), `${marker}: uses auth.uid()`);
    // No caller-supplied user id.
    assert(!/[(,]\s*_user_id\b/.test(body), `${marker}: no _user_id argument`);
    assert(!/[(,]\s*caller_user_id\b/.test(body), `${marker}: no caller_user_id`);
  }
});

Deno.test("API-D.3 both commands validate _client_key and _correlation_id with bounded regexes", async () => {
  const sql = normalize(await readMigration());
  for (const marker of ["acknowledge_api_d_policy(", "revoke_api_d_policy("]) {
    const body = functionBody(sql, `function public.${marker}`);
    assert(body.includes("length(_client_key)"), `${marker}: length check`);
    assert(body.includes("^[a-z0-9][a-z0-9_.-]{1,62}[a-z0-9]$"), `${marker}: key regex`);
    assert(body.includes("^[a-za-z0-9_-]{1,64}$"), `${marker}: correlation regex`);
  }
});

Deno.test("API-D.3 both commands independently reproduce the fail-closed authority chain", async () => {
  const sql = normalize(await readMigration());
  for (const marker of ["acknowledge_api_d_policy(", "revoke_api_d_policy("]) {
    const body = functionBody(sql, `function public.${marker}`);
    assert(body.includes("from public.profiles"), `${marker}: profiles check`);
    assert(body.includes("p.is_active = true"), `${marker}: active profile`);
    assert(body.includes("from public.api_clients"), `${marker}: client resolve`);
    assert(body.includes("client_key = _client_key"), `${marker}: exact client_key`);
    assert(body.includes("lifecycle_status = 'active'"), `${marker}: active client`);
    assert(body.includes("from public.api_client_policy_versions"), `${marker}: policy resolve`);
    assert(body.includes("_policy_count <> 1"), `${marker}: single active policy`);
    assert(body.includes("from public.organization_memberships om"), `${marker}: org membership`);
    assert(body.includes("join public.tenants t"), `${marker}: tenant chain`);
    assert(
      body.includes("join public.tenant_memberships tm_o"),
      `${marker}: current tenant membership`,
    );
    assert(body.includes("tm_o.status = 'active'"), `${marker}: active tenant membership`);
    assert(body.includes("tm_o.deactivated_at is null"), `${marker}: non-deactivated`);
    assert(
      body.includes("join public.api_organization_client_enablements oe"),
      `${marker}: enablement`,
    );
    assert(body.includes("oe.lifecycle_status = 'enabled'"), `${marker}: enabled`);
    assert(body.includes("om.status = 'active'"), `${marker}: active org membership`);
    assert(body.includes("om.deactivated_at is null"), `${marker}: org non-deactivated`);
    assert(body.includes("t.status = 'active'"), `${marker}: active tenant`);
    assert(body.includes("t.suspended_at is null"), `${marker}: tenant not suspended`);
    assert(body.includes("t.archived_at is null"), `${marker}: tenant not archived`);
    assert(body.includes("t.purged_at is null"), `${marker}: tenant not purged`);
    assert(body.includes("if _org_count = 0"), `${marker}: eligible-org gate`);
    // Tenant consistency across org membership and organization row.
    assert(body.includes("t.id = om.tenant_id"), `${marker}: tenant consistency`);
    // Must not trust profiles.organization_id or UI context as authority.
    assert(!body.includes("profiles.organization_id"), `${marker}: no profiles.organization_id`);
    assert(
      !body.includes("user_active_context_preferences"),
      `${marker}: no UI context authority`,
    );
  }
});

Deno.test("API-D.3 both commands are wrapped in an exception handler returning a uniform safe response", async () => {
  const sql = normalize(await readMigration());
  for (const marker of ["acknowledge_api_d_policy(", "revoke_api_d_policy("]) {
    const body = functionBody(sql, `function public.${marker}`);
    assert(body.includes("exception when others then return _fail_closed"));
  }
});

// ---------------------------------------------------------------------------
// Acknowledge behavior — exact identity, idempotency, atomic audit append
// ---------------------------------------------------------------------------

Deno.test("API-D.3 acknowledge uses the exact API-C uniqueness identity and populates safe canonical columns", async () => {
  const sql = normalize(await readMigration());
  const body = functionBody(sql, "function public.acknowledge_api_d_policy(");
  // Existing-row lookup on exact (user_id, api_client_id, policy_version_id).
  assert(body.includes("from public.api_user_policy_acknowledgements"));
  assert(body.includes("user_id = _uid"));
  assert(body.includes("api_client_id = _client.id"));
  assert(body.includes("policy_version_id = _policy.id"));
  // Insert on first ack.
  assert(body.includes("insert into public.api_user_policy_acknowledgements"));
  assert(body.includes("(_uid, _client.id, _policy.id"));
  assert(body.includes("jsonb_build_object('source', 'btpm_ui')"));
  // Reactivation path clears revoked_at and refreshes acknowledged_at.
  assert(body.includes("update public.api_user_policy_acknowledgements"));
  assert(body.includes("set revoked_at = null"));
  assert(body.includes("acknowledged_at = now()"));
});

Deno.test("API-D.3 acknowledge is idempotent for a current non-revoked row and appends no audit event", async () => {
  const sql = normalize(await readMigration());
  const body = functionBody(sql, "function public.acknowledge_api_d_policy(");
  // Idempotent early-return branch.
  assert(
    body.includes(
      "if _existing.id is not null and _existing.revoked_at is null then",
    ),
  );
  assert(
    body.includes(
      "return jsonb_build_object('ok', true, 'changed', false, 'acknowledged', true)",
    ),
  );
});

Deno.test("API-D.3 acknowledge appends exactly one 'acknowledge' audit event only on state change", async () => {
  const sql = normalize(await readMigration());
  const body = functionBody(sql, "function public.acknowledge_api_d_policy(");
  const inserts = body.match(/insert into public\.api_consent_audit_events/g) ?? [];
  assert(inserts.length === 1, `expected 1 audit insert; found ${inserts.length}`);
  assert(body.includes("'acknowledge', 'btpm_ui', _correlation_id"));
});

// ---------------------------------------------------------------------------
// Revoke behavior — never deletes, idempotent, atomic audit append
// ---------------------------------------------------------------------------

Deno.test("API-D.3 revoke never deletes and only sets revoked_at on a current non-revoked row", async () => {
  const sql = normalize(await readMigration());
  const body = functionBody(sql, "function public.revoke_api_d_policy(");
  assert(!body.includes("delete from public.api_user_policy_acknowledgements"));
  assert(body.includes("update public.api_user_policy_acknowledgements"));
  assert(body.includes("set revoked_at = now()"));
});

Deno.test("API-D.3 revoke is idempotent when the row is missing or already revoked and appends no audit event", async () => {
  const sql = normalize(await readMigration());
  const body = functionBody(sql, "function public.revoke_api_d_policy(");
  assert(
    body.includes(
      "if _existing.id is null or _existing.revoked_at is not null then",
    ),
  );
  assert(
    body.includes(
      "return jsonb_build_object('ok', true, 'changed', false, 'acknowledged', false)",
    ),
  );
});

Deno.test("API-D.3 revoke appends exactly one 'revoke' audit event only on state change", async () => {
  const sql = normalize(await readMigration());
  const body = functionBody(sql, "function public.revoke_api_d_policy(");
  const inserts = body.match(/insert into public\.api_consent_audit_events/g) ?? [];
  assert(inserts.length === 1, `expected 1 audit insert; found ${inserts.length}`);
  assert(body.includes("'revoke', 'btpm_ui', _correlation_id"));
});

// ---------------------------------------------------------------------------
// Least-privilege on the two commands
// ---------------------------------------------------------------------------

Deno.test("API-D.3 EXECUTE on both commands is revoked from PUBLIC/anon and granted only to authenticated", async () => {
  const sql = normalize(await readMigration());
  for (const fn of ["acknowledge_api_d_policy", "revoke_api_d_policy"]) {
    assert(sql.includes(`revoke all on function public.${fn}(text, text) from public`));
    assert(sql.includes(`revoke all on function public.${fn}(text, text) from anon`));
    assert(sql.includes(`grant execute on function public.${fn}(text, text) to authenticated`));
    assert(!sql.includes(`grant execute on function public.${fn}(text, text) to anon`));
    assert(!sql.includes(`grant execute on function public.${fn}(text, text) to public`));
    assert(!sql.includes(`grant execute on function public.${fn}(text, text) to service_role`));
  }
});

// ---------------------------------------------------------------------------
// Safe response shape / no sensitive leakage / no OAuth artifacts
// ---------------------------------------------------------------------------

Deno.test("API-D.3 response contract exposes only safe keys and never internal identifiers", async () => {
  const sql = normalize(await readMigration());
  for (const marker of ["acknowledge_api_d_policy(", "revoke_api_d_policy("]) {
    const body = functionBody(sql, `function public.${marker}`);
    assert(body.includes("'ok'"));
    assert(body.includes("'changed'"));
    assert(body.includes("'acknowledged'"));
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
      "'reason_detail'",
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
        !sql.includes(`, ${forbiddenKey} ,`),
      `response must not expose ${forbiddenKey}`,
    );
  }
});

Deno.test("API-D.3 migration introduces no OAuth / capability-grant / API-E artifacts", async () => {
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
      "insert into public.api_capability_grants",
      "update public.api_capability_grants",
      "insert into public.api_organization_client_enablements",
      "insert into public.api_workspace_client_enablements",
      "insert into public.api_clients",
      "insert into public.api_client_policy_versions",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not reference: ${forbidden}`);
  }
});

Deno.test("API-D.3 migration does not grant browser roles direct access to any API-C/D or membership table", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "grant select on public.api_clients",
      "grant select on public.api_client_policy_versions",
      "grant select on public.api_organization_client_enablements",
      "grant select on public.api_workspace_client_enablements",
      "grant select on public.api_user_policy_acknowledgements",
      "grant select on public.api_capability_grants",
      "grant select on public.api_consent_audit_events to anon",
      "grant select on public.api_consent_audit_events to authenticated",
      "grant select on public.organization_memberships",
      "grant select on public.workspace_memberships",
      "grant select on public.tenant_memberships",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not grant: ${forbidden}`);
  }
});

Deno.test("API-D.3 does not alter existing API-C tables or the API-D.2 function", async () => {
  const sql = normalize(await readMigration());
  for (
    const forbidden of [
      "alter table public.api_clients",
      "alter table public.api_client_policy_versions",
      "alter table public.api_organization_client_enablements",
      "alter table public.api_workspace_client_enablements",
      "alter table public.api_user_policy_acknowledgements",
      "alter table public.api_capability_grants",
      "drop function public.get_api_d_consent_context",
      "create or replace function public.get_api_d_consent_context",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not modify: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// No runtime callers yet
// ---------------------------------------------------------------------------

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
  "API-D.3 command callers are limited to the approved API-D.4 UX surfaces and API-C/D static tests; audit table has no runtime callers",
  async () => {
    const roots = ["src", "supabase/functions"];
    const offenders: string[] = [];
    const isStaticContractTest = (p: string): boolean =>
      p.startsWith("supabase/functions/_shared/") &&
      p.endsWith("_static_test.ts");
    // API-D.4 approved runtime surfaces (production consent UX).
    // Only the command RPCs are permitted from these surfaces. The audit
    // table (api_consent_audit_events) still has NO permitted runtime
    // callers — direct browser access is prohibited by API-D contract.
    const APPROVED_COMMAND_CALLERS = new Set<string>([
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
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
        const text = await Deno.readTextFile(file);
        // Audit table must have zero runtime callers anywhere.
        if (text.includes("api_consent_audit_events")) {
          offenders.push(`${file} (api_consent_audit_events)`);
          continue;
        }
        if (APPROVED_COMMAND_CALLERS.has(file)) continue;
        if (
          text.includes("acknowledge_api_d_policy") ||
          text.includes("revoke_api_d_policy")
        ) {
          offenders.push(file);
        }
      }
    }
    assert(
      offenders.length === 0,
      `Unexpected runtime callers reference API-D.3 objects: ${offenders.join(", ")}`,
    );
  },
);
