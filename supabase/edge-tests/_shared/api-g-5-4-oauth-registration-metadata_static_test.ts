// API-G.5.4 — OAuth registration metadata contract.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen API-G.5.4 substrate contract:
//   - public.api_client_oauth_redirect_uris exists with the required shape,
//     restrictive parent FK, SET NULL actor FKs, exact unique identity and
//     structural redirect-URI validation.
//   - RLS enabled with zero policies; PUBLIC/anon/authenticated revoked;
//     service_role only; no browser-callable RPC.
//   - No seed, no backfill, no client or redirect record created.
//   - No secret, token, code, credential or raw provider response is stored.
//   - Both lifecycle functions are SECURITY DEFINER with a fixed search_path
//     and coordinate through a lock on the same api_clients row.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.4 — OAuth registration metadata contract";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (sql.includes(marker)) return sql;
  }
  throw new Error(`API-G.5.4 migration not found (marker: ${marker})`);
}

const sql = await findMigrationByMarker(MARKER);
const lower = sql.toLowerCase();

const CORRECTION_MARKER =
  "API-G.5.4-C1 — OAuth lifecycle rollback and active-insert integrity";
const correctionSql = await findMigrationByMarker(CORRECTION_MARKER);
const correction = correctionSql.toLowerCase();

Deno.test("API-G.5.4: redirect metadata table shape", () => {
  assert(lower.includes("create table public.api_client_oauth_redirect_uris"));
  for (
    const col of [
      "id uuid primary key default gen_random_uuid()",
      "api_client_id uuid not null",
      "redirect_uri text not null",
      "lifecycle_status text not null default 'draft'",
      "verified_at timestamptz null",
      "retired_at timestamptz null",
      "created_by uuid null",
      "updated_by uuid null",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]
  ) {
    assert(lower.includes(col), `missing column contract: ${col}`);
  }
  assert(
    lower.includes("execute function public.update_updated_at_column()"),
    "must reuse the existing updated-at trigger pattern",
  );
});

Deno.test("API-G.5.4: restrictive parent FK and SET NULL actor FKs", () => {
  assert(
    lower.includes("references public.api_clients(id) on delete restrict"),
    "parent FK must be restrictive",
  );
  const actorFks =
    lower.match(/references auth\.users\(id\) on delete set null/g) ?? [];
  assert(actorFks.length >= 2, "actor FKs must be ON DELETE SET NULL");
});

Deno.test("API-G.5.4: exact redirect identity uniqueness", () => {
  assert(lower.includes("unique (api_client_id, redirect_uri)"));
});

Deno.test("API-G.5.4: structural redirect-URI validation contract", () => {
  assert(lower.includes("redirect_uri = btrim(redirect_uri)"), "trim contract");
  assert(
    lower.includes("length(redirect_uri) between 1 and 2048"),
    "length contract",
  );
  assert(lower.includes("redirect_uri like 'https://%'"), "https contract");
  assert(lower.includes("redirect_uri !~ '\\s'"), "whitespace contract");
  assert(
    lower.includes("position('*' in redirect_uri) = 0"),
    "wildcard contract",
  );
  assert(
    lower.includes("position('#' in redirect_uri) = 0"),
    "fragment contract",
  );
});

Deno.test("API-G.5.4: redirect URI is never lowercased or normalized", () => {
  assert(
    !/lower\s*\(\s*redirect_uri/.test(lower),
    "redirect_uri must not be lowercased",
  );
  assert(
    !/redirect_uri\s*=\s*btrim\s*\(\s*new\.redirect_uri/.test(lower),
    "redirect_uri must not be silently rewritten",
  );
  assert(
    !/new\.redirect_uri\s*:?=\s*/.test(lower),
    "redirect_uri must not be assigned in a trigger",
  );
});

Deno.test("API-G.5.4: lifecycle enumeration and timestamp consistency", () => {
  assert(lower.includes("lifecycle_status in ('draft','active','retired')"));
  assert(lower.includes("lifecycle_status = 'draft'"));
  assert(lower.includes("verified_at is null"));
  assert(lower.includes("lifecycle_status = 'active'"));
  assert(lower.includes("verified_at is not null"));
  assert(lower.includes("retired_at is null"));
  assert(lower.includes("lifecycle_status = 'retired'"));
  assert(lower.includes("retired_at is not null"));
});

Deno.test("API-G.5.4: RLS enabled with zero policies and no browser grants", () => {
  assert(
    lower.includes(
      "alter table public.api_client_oauth_redirect_uris enable row level security",
    ),
  );
  assert(!lower.includes("create policy"), "no RLS policy may be created");
  for (
    const revoke of [
      "revoke all on public.api_client_oauth_redirect_uris from public",
      "revoke all on public.api_client_oauth_redirect_uris from anon",
      "revoke all on public.api_client_oauth_redirect_uris from authenticated",
    ]
  ) {
    assert(lower.includes(revoke), `missing revoke: ${revoke}`);
  }
  assert(
    lower.includes(
      "grant select, insert, update, delete on public.api_client_oauth_redirect_uris to service_role",
    ),
  );
});

Deno.test("API-G.5.4: no seed, backfill, client or redirect record", () => {
  assert(!/\binsert\s+into\b/.test(lower), "no INSERT may exist");
  assert(!/\bupdate\s+public\./.test(lower), "no data UPDATE may exist");
  assert(!/\bdelete\s+from\b/.test(lower), "no DELETE may exist");
  assert(!lower.includes("astra"), "no client onboarding may occur");
});

Deno.test("API-G.5.4: no secret or confidential payload columns", () => {
  // Ignore SQL comments: only executable DDL may be inspected for material.
  const executable = lower
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (
    const forbidden of [
      "client_secret",
      "secret",
      "token",
      "authorization_code",
      "refresh_token",
      "signing",
      "private_key",
      "credential",
      "raw_response",
      "provider_response",
      "payload",
    ]
  ) {
    assert(
      !executable.includes(forbidden),
      `forbidden material present: ${forbidden}`,
    );
  }
});


Deno.test("API-G.5.4: redirect activation requires a linked oauth_client_id", () => {
  assert(
    lower.includes(
      "create or replace function public.api_g_5_4_enforce_oauth_redirect_lifecycle()",
    ),
  );
  assert(lower.includes("v_client_oauth_client_id is null"));
  assert(lower.includes("length(btrim(v_client_oauth_client_id)) = 0"));
});

Deno.test("API-G.5.4: redirect identity immutable after draft", () => {
  assert(lower.includes("old.lifecycle_status <> 'draft'"));
  assert(lower.includes("new.api_client_id is distinct from old.api_client_id"));
  assert(lower.includes("new.redirect_uri is distinct from old.redirect_uri"));
});

Deno.test("API-G.5.4: physical deletion prohibited", () => {
  assert(lower.includes("if tg_op = 'delete' then"));
  assert(lower.includes("physical deletion is prohibited"));
});

Deno.test("API-G.5.4: last active redirect cannot be retired for an active client", () => {
  assert(lower.includes("old.lifecycle_status = 'active'"));
  assert(lower.includes("new.lifecycle_status <> 'active'"));
  assert(lower.includes("v_client_lifecycle = 'active'"));
  assert(lower.includes("v_other_active_id is null"));
});

Deno.test("API-G.5.4: active client requires oauth client id and active redirect", () => {
  assert(
    lower.includes(
      "create or replace function public.api_g_5_4_enforce_client_oauth_registration()",
    ),
  );
  assert(lower.includes("new.lifecycle_status = 'active'"));
  assert(lower.includes("new.oauth_client_id is null"));
  assert(lower.includes("v_active_redirect_id is null"));
  assert(
    lower.includes("new.oauth_client_id is distinct from old.oauth_client_id"),
    "oauth_client_id immutable after draft",
  );
});

Deno.test("API-G.5.4: both trigger paths lock the same api_clients row", () => {
  const clientLocks =
    lower.match(/from public\.api_clients c\s+where c\.id =[\s\S]{0,40}?for update/g) ??
      [];
  assert(clientLocks.length >= 2, "both functions must lock api_clients FOR UPDATE");
  const redirectLocks =
    lower.match(
      /from public\.api_client_oauth_redirect_uris r[\s\S]{0,300}?for update/g,
    ) ?? [];
  assert(
    redirectLocks.length >= 2,
    "active-redirect existence checks must use FOR UPDATE",
  );
  assert(!/count\s*\(\s*\*\s*\)/.test(lower), "must not rely on unlocked counts");
});

Deno.test("API-G.5.4: both functions are definer, fixed search_path, service-role only", () => {
  const definers = lower.match(/security definer/g) ?? [];
  assert(definers.length >= 2);
  const paths = lower.match(/set search_path = public, pg_catalog/g) ?? [];
  assert(paths.length >= 2);
  for (
    const fn of [
      "public.api_g_5_4_enforce_oauth_redirect_lifecycle()",
      "public.api_g_5_4_enforce_client_oauth_registration()",
    ]
  ) {
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        lower.includes(`revoke all on function ${fn} from ${role}`),
        `missing revoke for ${fn} from ${role}`,
      );
    }
    assert(lower.includes(`grant execute on function ${fn} to service_role`));
  }
});

Deno.test("API-G.5.4: required triggers attached with exact names", () => {
  assert(
    lower.includes("create trigger api_g_5_4_oauth_redirect_lifecycle") &&
      lower.includes(
        "before insert or update or delete on public.api_client_oauth_redirect_uris",
      ),
  );
  assert(
    lower.includes("create trigger api_g_5_4_client_oauth_registration") &&
      lower.includes("before update on public.api_clients"),
  );
});

Deno.test("API-G.5.4: no existing runtime surface is changed", () => {
  for (
    const forbidden of [
      "alter table public.api_clients add column",
      "alter table public.api_clients drop",
      "api_clients_lifecycle_status_check",
      "api_capability_catalogue",
      "api_client_supported_capabilities",
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_client_policy_versions",
      "api_user_policy_acknowledgements",
      "api_rate_limit",
      "api_e_private",
      "tenant_integrations",
      "authorize_and_establish",
      "authorize_project_scope",
    ]
  ) {
    assert(!lower.includes(forbidden), `out-of-scope surface touched: ${forbidden}`);
  }
});

// =========================================================================
// API-G.5.4-C1 — lifecycle rollback and active-insert integrity corrections
// =========================================================================

Deno.test("API-G.5.4-C1: original migration remains the accepted substrate", () => {
  assert(
    lower.includes("create table public.api_client_oauth_redirect_uris"),
    "the original migration still defines the table",
  );
  assert(
    !correction.includes("create table"),
    "the correction must not create a table",
  );
});

Deno.test("API-G.5.4-C1: redirects cannot roll back out of active or retired", () => {
  assert(
    correction.includes("old.lifecycle_status = 'active'") &&
      correction.includes("new.lifecycle_status not in ('active','retired')"),
    "active redirects may only stay active or retire",
  );
  assert(
    correction.includes("an active redirect cannot return to draft"),
    "active -> draft must be rejected",
  );
  assert(
    correction.includes("old.lifecycle_status = 'retired'") &&
      correction.includes("new.lifecycle_status <> 'retired'") &&
      correction.includes("a retired redirect cannot be reinstated"),
    "retired -> draft and retired -> active must be rejected",
  );
});

Deno.test("API-G.5.4-C1: redirect identity is permanently immutable after draft", () => {
  assert(
    correction.includes("old.lifecycle_status in ('active','retired')"),
    "identity freeze must key off the historical non-draft state",
  );
  assert(
    correction.includes("new.api_client_id is distinct from old.api_client_id"),
  );
  assert(correction.includes("new.redirect_uri is distinct from old.redirect_uri"));
  assert(correction.includes("redirect identity is immutable after draft"));
});

Deno.test("API-G.5.4-C1: verification and retirement history cannot be erased", () => {
  assert(
    correction.includes("new.verified_at is distinct from old.verified_at") &&
      correction.includes("historical verification timestamp is immutable"),
    "verified_at is frozen once the redirect leaves draft, including on active -> retired",
  );
  assert(
    correction.includes("new.retired_at is distinct from old.retired_at") &&
      correction.includes("historical retirement timestamp is immutable"),
    "retired_at is frozen once retired",
  );
});

Deno.test("API-G.5.4-C1: last-active-redirect protection retained", () => {
  assert(correction.includes("v_client_lifecycle = 'active'"));
  assert(correction.includes("v_other_active_id is null"));
  assert(
    correction.includes(
      "an active api client must retain at least one active redirect record",
    ),
  );
  assert(
    correction.includes("physical deletion is prohibited"),
    "deletion remains prohibited",
  );
});

Deno.test("API-G.5.4-C1: a non-draft client cannot return to draft", () => {
  assert(
    correction.includes("old.lifecycle_status <> 'draft'") &&
      correction.includes("new.lifecycle_status = 'draft'") &&
      correction.includes("an api client cannot return to draft"),
  );
  assert(
    correction.includes(
      "new.oauth_client_id is distinct from old.oauth_client_id",
    ),
    "oauth_client_id immutability after draft is preserved",
  );
  assert(
    correction.includes("new.id is distinct from old.id") &&
      correction.includes("api client identity is immutable"),
  );
});

Deno.test("API-G.5.4-C1: only draft clients may be inserted", () => {
  assert(correction.includes("if tg_op = 'insert' then"));
  assert(
    correction.includes("new.lifecycle_status is distinct from 'draft'") &&
      correction.includes("an api client may only be created in draft"),
  );
});

Deno.test("API-G.5.4-C1: client trigger now covers INSERT and UPDATE", () => {
  assert(
    correction.includes(
      "drop trigger if exists api_g_5_4_client_oauth_registration on public.api_clients",
    ),
  );
  assert(
    correction.includes("create trigger api_g_5_4_client_oauth_registration") &&
      correction.includes("before insert or update on public.api_clients"),
    "same trigger name, corrected event set",
  );
  assert(
    correction.includes(
      "execute function public.api_g_5_4_enforce_client_oauth_registration()",
    ),
    "same function identity",
  );
  assert(
    !correction.includes("api_g_5_4_oauth_redirect_lifecycle\n"),
    "the redirect trigger must not be recreated",
  );
  assert(
    !/drop trigger[\s\S]{0,120}api_client_oauth_redirect_uris/.test(correction),
    "no other trigger may be dropped",
  );
});

Deno.test("API-G.5.4-C1: update paths still lock the authoritative rows", () => {
  const clientLocks =
    correction.match(
      /from public\.api_clients c\s+where c\.id =[\s\S]{0,40}?for update/g,
    ) ?? [];
  assert(clientLocks.length >= 2, "both functions lock the api_clients row");
  const redirectLocks =
    correction.match(
      /from public\.api_client_oauth_redirect_uris r[\s\S]{0,300}?for update/g,
    ) ?? [];
  assert(redirectLocks.length >= 2, "active-redirect checks remain locked");
  assert(
    !/count\s*\(\s*\*\s*\)/.test(correction),
    "must not rely on unlocked counts",
  );
});

Deno.test("API-G.5.4-C1: security posture retained", () => {
  const definers = correction.match(/security definer/g) ?? [];
  assert(definers.length >= 2);
  const paths = correction.match(/set search_path = public, pg_catalog/g) ?? [];
  assert(paths.length >= 2);
  for (
    const fn of [
      "public.api_g_5_4_enforce_oauth_redirect_lifecycle()",
      "public.api_g_5_4_enforce_client_oauth_registration()",
    ]
  ) {
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        correction.includes(`revoke all on function ${fn} from ${role}`),
        `missing revoke for ${fn} from ${role}`,
      );
    }
    assert(
      correction.includes(`grant execute on function ${fn} to service_role`),
    );
  }
  assert(!/execute\s+format\s*\(/.test(correction), "no dynamic SQL");
  assert(!/\bexecute\s+'/.test(correction), "no dynamic SQL");
});

Deno.test("API-G.5.4-C1: correction changes no other surface", () => {
  const executable = correction
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (
    const forbidden of [
      "alter table",
      "create table",
      "create policy",
      "insert into",
      "delete from",
      "add constraint",
      "drop constraint",
      "api_capability_catalogue",
      "api_client_supported_capabilities",
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_client_policy_versions",
      "api_user_policy_acknowledgements",
      "api_rate_limit",
      "api_e_private",
      "tenant_integrations",
      "astra",
      "secret",
      "token",
    ]
  ) {
    assert(
      !executable.includes(forbidden),
      `out-of-scope surface touched: ${forbidden}`,
    );
  }
  assert(
    !executable.includes("grant select") && !executable.includes("grant all"),
    "no table privilege change",
  );
});
