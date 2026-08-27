// UX-GAP.2B1 — OAuth Client → BTPM Business-Consent Gate Resolver.
// UX-GAP.2B1-C1 — canonical oauth_client_id contract correction (no max length).
//
// Focused static contract test over the EFFECTIVE (C1-corrected) resolver.
// Proves: function contract, identity source, reuse of the accepted
// uniqueness invariant, delegation to public.get_api_d_consent_context,
// safe result shape, privileges, read-only behavior, and the absence of any
// non-canonical identifier-length limit.
//
// The original UX-GAP.2B1 migration
// (20260817193218_3b80d083-9495-42ef-a862-7781f4443072.sql) remains as an
// immutable historical record and is not edited; the C1 forward correction
// migration below is the effective definition.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Effective resolver = the UX-GAP.2B1-C1 forward correction migration, which
// replaces the effective definition of get_api_d_oauth_consent_gate (removing
// the non-canonical 255-character rejection).
const MIGRATION_PATH =
  "supabase/migrations/20260818041453_5757a02c-9014-4d2f-b204-ccf02e85331b.sql";

// Accepted API-C.2 substrate that owns the oauth_client_id uniqueness invariant.
const API_C_2_MIGRATION_PATH =
  "supabase/migrations/20260722055331_b64649fe-938f-4579-94f6-733f4b9ba5f0.sql";

async function sql(): Promise<string> {
  return normalize(await Deno.readTextFile(MIGRATION_PATH));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------- A. Contract

Deno.test("UX-GAP.2B1 A: exact function name with one text argument returning jsonb", async () => {
  const s = await sql();
  assert(
    s.includes(
      "create or replace function public.get_api_d_oauth_consent_gate(_oauth_client_id text) returns jsonb",
    ),
    "exact signature and return type required",
  );
  // Exactly one function created by this migration.
  assert(
    (s.match(/create or replace function/g) ?? []).length === 1,
    "exactly one function",
  );
});

Deno.test("UX-GAP.2B1 A: plpgsql, stable, security definer, fixed search_path", async () => {
  const s = await sql();
  assert(s.includes("language plpgsql"));
  assert(s.includes("stable"));
  assert(s.includes("security definer"));
  assert(s.includes("set search_path = public, pg_catalog"));
  assert(!s.includes("volatile"));
  assert(!s.includes("security invoker"));
});

// ----------------------------------------------------------- B. Identity source

Deno.test("UX-GAP.2B1 B: resolves from public.api_clients on exact oauth_client_id and active lifecycle", async () => {
  const s = await sql();
  assert(s.includes("from public.api_clients"));
  assert(s.includes("c.oauth_client_id = _oauth_client_id"));
  assert(s.includes("c.lifecycle_status = 'active'"));
  assert(s.includes("select c.client_key"), "returns canonical client_key");
});

Deno.test("UX-GAP.2B1 B: never correlates on display name, description or redirect metadata", async () => {
  // Comment prose is stripped so only executable SQL is inspected.
  const s = (await sql())
    .split(" ")
    .join(" ");
  const executable = (await Deno.readTextFile(MIGRATION_PATH))
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ");
  assert(s.length > 0);
  for (
    const forbidden of [
      "c.display_name",
      "c.client_name",
      "c.description",
      "redirect_uri",
      "redirect_url",
      "api_client_oauth_redirect_uris",
      "c.tenant_id",
      "c.organization_id",
      "c.workspace_id",
      "ilike",
      "similar to",
    ]
  ) {
    assert(!executable.includes(forbidden), `must not correlate using ${forbidden}`);
  }
});


Deno.test("UX-GAP.2B1 B: input contract is non-null, non-empty, trimmed, lowercase", async () => {
  const s = await sql();
  assert(s.includes("_oauth_client_id is null"));
  assert(s.includes("length(_oauth_client_id) = 0"));
  assert(s.includes("_oauth_client_id <> btrim(_oauth_client_id)"));
  assert(s.includes("_oauth_client_id <> lower(_oauth_client_id)"));
  assert(!s.includes("::uuid"), "no UUID-only assumption");
});

// -------------------------------------------------- C. Existing uniqueness authority

Deno.test("UX-GAP.2B1 C: accepted unique partial index still owned by API-C.2 and not recreated", async () => {
  const apiC2 = normalize(await Deno.readTextFile(API_C_2_MIGRATION_PATH));
  assert(
    apiC2.includes(
      "create unique index api_clients_oauth_client_id_uniq on public.api_clients (oauth_client_id) where oauth_client_id is not null",
    ),
    "API-C.2 must still contain the unique partial index",
  );
  const s = await sql();
  assert(!s.includes("create unique index"), "no new uniqueness mechanism");
  assert(!s.includes("create index"), "no new index");
  assert(!s.includes("add constraint"), "no new constraint");
});

// ------------------------------------------------- D. Consent-authority reuse

Deno.test("UX-GAP.2B1 D: delegates to public.get_api_d_consent_context", async () => {
  const s = await sql();
  assert(s.includes("public.get_api_d_consent_context(_client_key)"));
});

Deno.test("UX-GAP.2B1 D: does not duplicate policy, acknowledgement, membership, enablement or capability joins", async () => {
  const s = await sql();
  for (
    const table of [
      "api_client_policy_versions",
      "api_user_policy_acknowledgements",
      "organization_memberships",
      "workspace_memberships",
      "tenant_memberships",
      "api_organization_client_enablement",
      "api_workspace_client_enablements",
      "api_capability_grants",
      "public.profiles",
    ]
  ) {
    assert(!s.includes(table), `must not read ${table} directly`);
  }
});

// ----------------------------------------------------------------- E. Safe result

Deno.test("UX-GAP.2B1 E: eligible result exposes exactly eligible, client_key, acknowledged", async () => {
  const s = await sql();
  assert(
    s.includes(
      "jsonb_build_object( 'eligible', true, 'client_key', _client_key, 'acknowledged', (_acknowledged)::boolean )",
    ) ||
      s.includes(
        "jsonb_build_object('eligible', true, 'client_key', _client_key, 'acknowledged', (_acknowledged)::boolean)",
      ),
    "exact eligible payload shape",
  );
});

Deno.test("UX-GAP.2B1 E: fail-closed result is exactly {eligible:false}", async () => {
  const s = await sql();
  assert(
    s.includes("jsonb_build_object('eligible', false)"),
    "uniform fail-closed literal",
  );
  assert(!s.includes("raise exception"), "no revealing validation error");
  assert(!s.includes("raise notice"));
});

Deno.test("UX-GAP.2B1 E: strict delegated-result validation before returning eligible", async () => {
  const s = await sql();
  assert(s.includes("jsonb_typeof(_ctx) <> 'object'"));
  assert(s.includes("(_ctx -> 'eligible')::text, '') <> 'true'"));
  assert(s.includes("_ctx #>> '{client,client_key}', '') <> _client_key"));
  assert(s.includes("jsonb_typeof(_acknowledged) <> 'boolean'"));
});

Deno.test("UX-GAP.2B1 E: no sensitive identifiers or provider data returned", async () => {
  const s = await sql();
  for (
    const forbidden of [
      "'api_client_id'",
      "'oauth_client_id'",
      "'user_id'",
      "'policy_version_id'",
      "'tenant_id'",
      "'organization_id'",
      "'workspace_id'",
      "'project_id'",
      "'capabilities'",
      "'roles'",
      "'token'",
      "'access_token'",
      "'provider'",
      "'redirect_uri'",
      "auth.uid()",
    ]
  ) {
    assert(!s.includes(forbidden), `must not expose ${forbidden}`);
  }
});

// ------------------------------------------------------------------ F. Privileges

Deno.test("UX-GAP.2B1 F: PUBLIC and anon revoked, authenticated granted, no table grant", async () => {
  const s = await sql();
  assert(
    s.includes(
      "revoke all on function public.get_api_d_oauth_consent_gate(text) from public",
    ),
  );
  assert(
    s.includes(
      "revoke all on function public.get_api_d_oauth_consent_gate(text) from anon",
    ),
  );
  assert(
    s.includes(
      "grant execute on function public.get_api_d_oauth_consent_gate(text) to authenticated",
    ),
  );
  assert(!s.includes("grant select"), "no table grant");
  assert(!s.includes("grant all on table"));
  assert(!s.includes("to service_role"), "not a service-role business surface");
});

// ------------------------------------------------------------------- G. Read-only

Deno.test("UX-GAP.2B1 G: migration is strictly read-only", async () => {
  const s = await sql();
  for (
    const forbidden of [
      "insert into",
      "update public.",
      "delete from",
      "create trigger",
      "create policy",
      "alter table",
      "alter policy",
      "drop ",
      "enable row level security",
      "truncate",
    ]
  ) {
    assert(!s.includes(forbidden), `must not contain ${forbidden}`);
  }
});

Deno.test("UX-GAP.2B1 G: does not redefine or alter existing consent authority functions", async () => {
  const s = await sql();
  assert(!s.includes("create or replace function public.get_api_d_consent_context"));
  assert(!s.includes("acknowledge_api_d_policy("));
  assert(!s.includes("revoke_api_d_policy("));
});

// ----------------------------------------------- H. Canonical identifier contract (C1)

Deno.test("UX-GAP.2B1 H: effective resolver imposes no identifier-length limit", async () => {
  const s = await sql();
  assert(
    !/length\(_oauth_client_id\)\s*>/.test(s),
    "no length(_oauth_client_id) > upper-bound condition",
  );
  assert(
    !/char_length\(_oauth_client_id\)\s*>/.test(s),
    "no char_length(_oauth_client_id) > upper-bound condition",
  );
  assert(
    !/octet_length\(_oauth_client_id\)\s*>/.test(s),
    "no octet_length(_oauth_client_id) > upper-bound condition",
  );
  // No replacement format/prefix constraint either.
  assert(!s.includes("::uuid"), "no UUID-only assumption reintroduced");
  assert(!s.includes("similar to"), "no regex/format pattern constraint");
  assert(!s.includes(" like "), "no LIKE pattern constraint on the identifier");
});

Deno.test("UX-GAP.2B1 H: accepted API-C substrate has no maximum-length constraint on oauth_client_id", async () => {
  const apiC2 = normalize(await Deno.readTextFile(API_C_2_MIGRATION_PATH));
  // The canonical column is unbounded text (no varchar(N) length limit).
  assert(apiC2.includes("oauth_client_id text null"), "API-C column is unbounded text");
  assert(!/oauth_client_id\s+varchar/i.test(apiC2), "no varchar length bound on oauth_client_id");
  // The only length condition on oauth_client_id is the non-empty lower bound.
  assert(apiC2.includes("length(btrim(oauth_client_id)) > 0"), "non-empty lower bound present");
  // No upper-bound length check anywhere in the API-C substrate.
  assert(!/> 255/.test(apiC2), "no 255-style upper bound in API-C substrate");
  assert(
    !/oauth_client_id[^;]*length[^;]*?>\s*\d{2,}/i.test(apiC2),
    "no upper-bound length constraint referencing oauth_client_id",
  );
});
