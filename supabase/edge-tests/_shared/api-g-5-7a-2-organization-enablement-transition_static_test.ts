// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-g-5-7a-2-organization-enablement-transition_static_test.ts', import.meta.url).href;
// API-G.5.7A-2 — Static contract test for the protected Organization
// client enable/disable command and its administrative audit substrate.
//
// Repository-only. No network, no runtime invocation.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = /API-G\.5\.7A-2\b/;
const FN = "api_g_5_7_admin_transition_organization_client";
const AUDIT = "api_connected_apps_admin_audit_events";

async function listMigrations(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return names;
}

async function migrationsMatching(marker: RegExp): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const name of await listMigrations()) {
    const text = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    if (marker.test(text)) out.push([name, text]);
  }
  return out;
}

const MATCHES = await migrationsMatching(MARKER);
assertEquals(
  MATCHES.length,
  1,
  `Expected exactly one API-G.5.7A-2 migration, found: ${MATCHES.map((m) => m[0]).join(", ")}`,
);
const [MIGRATION_NAME, SQL] = MATCHES[0];
const LOWER = SQL.toLowerCase();

// The function body only (used for containment assertions).
const FN_START = LOWER.indexOf(`create or replace function public.${FN}`);
assert(FN_START >= 0, "Command function definition not found.");
const FN_BODY = SQL.slice(FN_START);

Deno.test("A-2: exactly one marked migration exists", () => {
  assert(MIGRATION_NAME.endsWith(".sql"));
});

Deno.test("A-2: exact RPC signature and uuid return type", () => {
  assertStringIncludes(LOWER, `create or replace function public.${FN}(`);
  assertStringIncludes(LOWER, "_organization_id uuid");
  assertStringIncludes(LOWER, "_api_client_id uuid");
  assertStringIncludes(LOWER, "_target_lifecycle_status text");
  assertStringIncludes(LOWER, "returns uuid");
});

Deno.test("A-2: volatile, security definer, fixed search path, plpgsql", () => {
  const head = FN_BODY.toLowerCase().slice(0, FN_BODY.toLowerCase().indexOf("as $function$"));
  assertStringIncludes(head, "language plpgsql");
  assertStringIncludes(head, "volatile");
  assertStringIncludes(head, "security definer");
  assertStringIncludes(head, "set search_path = public, pg_catalog");
  assert(!/language sql\b/.test(head));
});

Deno.test("A-2: actor derived only from auth.uid()", () => {
  assertStringIncludes(FN_BODY.toLowerCase(), "v_actor uuid := auth.uid()");
  assertEquals((FN_BODY.match(/auth\.uid\(\)/g) ?? []).length, 1);
  // No caller-supplied identity/authority/timestamp/audit arguments.
  const sig = SQL.slice(FN_START, FN_START + SQL.slice(FN_START).indexOf(")"));
  for (
    const forbidden of [
      "_actor",
      "_user_id",
      "_tenant_id",
      "_role",
      "_authority",
      "_is_",
      "_correlation",
      "_event_at",
      "_source_channel",
      "_previous",
      "_workspace_id",
      "_project_id",
    ]
  ) {
    assert(!sig.toLowerCase().includes(forbidden), `Forbidden parameter ${forbidden}`);
  }
});

Deno.test("A-2: active-user enforcement", () => {
  assertStringIncludes(FN_BODY.toLowerCase(), "not public.is_active_user(v_actor)");
});

Deno.test("A-2: tenant scope derived server-side from the Organization", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "select o.tenant_id into v_tenant_id");
  assertStringIncludes(b, "from public.organizations o");
  assertStringIncludes(b, "where o.id = _organization_id");
});

Deno.test("A-2: authority uses exactly the two accepted helper calls", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "public.is_tenant_admin(v_tenant_id, v_actor)");
  assertStringIncludes(b, "public.is_org_admin(v_actor, _organization_id)");
  assert(!b.includes("is_platform_super_admin"), "Super Admin path must not exist.");
  assert(!b.includes("is_workspace_admin"), "Workspace Admin path must not exist.");
});

Deno.test("A-2: helper positional contracts cross-checked against committed SQL", async () => {
  // Independently locate the authoritative CREATE FUNCTION definitions.
  let tenantSig: string | null = null;
  let orgSig: string | null = null;
  for (const name of await listMigrations()) {
    const text = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    const t = text.toLowerCase();
    let i = t.indexOf("function public.is_tenant_admin(");
    while (i >= 0) {
      tenantSig = t.slice(i + "function public.is_tenant_admin(".length, t.indexOf(")", i));
      i = t.indexOf("function public.is_tenant_admin(", i + 1);
    }
    let j = t.indexOf("function public.is_org_admin(");
    while (j >= 0) {
      orgSig = t.slice(j + "function public.is_org_admin(".length, t.indexOf(")", j));
      j = t.indexOf("function public.is_org_admin(", j + 1);
    }
  }
  assert(tenantSig, "is_tenant_admin definition not found in committed migrations.");
  assert(orgSig, "is_org_admin definition not found in committed migrations.");
  const tenantParams = tenantSig!.split(",").map((p) => p.trim().split(/\s+/)[0]);
  const orgParams = orgSig!.split(",").map((p) => p.trim().split(/\s+/)[0]);
  assertEquals(tenantParams, ["_tenant_id", "_user_id"]);
  assertEquals(orgParams, ["_user_id", "_organization_id"]);
});

Deno.test("A-2: non-enumerating not_authorized for absent or unauthorized Organization", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "if v_tenant_id is null then");
  const count = (b.match(/raise exception 'not_authorized' using errcode = '42501'/g) ?? []).length;
  assert(count >= 3, `Expected shared not_authorized failures, found ${count}`);
  assert(!b.includes("organization_not_found"));
});

Deno.test("A-2: only enabled and disabled targets accepted", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "_target_lifecycle_status not in ('enabled', 'disabled')");
  assertStringIncludes(b, "raise exception 'invalid_target_lifecycle_status' using errcode = '22023'");
});

Deno.test("A-2: transition serialization and row locking", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "pg_advisory_xact_lock(");
  assertStringIncludes(b, "hashtextextended(_organization_id::text, 0)");
  assertStringIncludes(b, "hashtextextended(_api_client_id::text, 0)");
  assertStringIncludes(b, "for update");
  // Lock precedes the enablement read.
  assert(b.indexOf("pg_advisory_xact_lock(") < b.indexOf("for update"));
});

Deno.test("A-2: enable requires an active client", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "select c.lifecycle_status into v_client_status");
  assertStringIncludes(b, "v_client_status is distinct from 'active'");
  assertStringIncludes(b, "raise exception 'client_not_active'");
});

Deno.test("A-2: missing-row enable inserts server-derived scope and actor", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "insert into public.api_organization_client_enablements");
  assertStringIncludes(b, "v_tenant_id, _organization_id, _api_client_id, 'enabled'");
  assertStringIncludes(b, "now(), null, v_actor, v_actor");
});

Deno.test("A-2: disabled → enabled resets timestamps", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "set lifecycle_status = 'enabled'");
  assertStringIncludes(b, "enabled_at = now()");
  assertStringIncludes(b, "disabled_at = null");
});

Deno.test("A-2: enabled → disabled preserves enabled_at and sets disabled_at", () => {
  const b = FN_BODY.toLowerCase();
  const start = b.indexOf("set lifecycle_status = 'disabled'");
  assert(start > 0);
  const block = b.slice(start, b.indexOf("where", start));
  assertStringIncludes(block, "disabled_at = now()");
  assertStringIncludes(block, "updated_by = v_actor");
  assert(!block.includes("enabled_at ="), "enabled_at must be preserved on disable.");
});

Deno.test("A-2: same-state and missing-row transitions rejected", () => {
  const b = FN_BODY.toLowerCase();
  assertStringIncludes(b, "raise exception 'invalid_lifecycle_transition' using errcode = '22023'");
  assertStringIncludes(b, "v_row.id is null or v_row.lifecycle_status is distinct from 'enabled'");
});

Deno.test("A-2: disable path does not gate on client lifecycle", () => {
  const b = FN_BODY.toLowerCase();
  const elseIdx = b.indexOf("v_action := 'enable_organization_client'");
  const disableBlock = b.slice(elseIdx);
  assert(!disableBlock.includes("api_clients"), "Disable must remain possible for suspended/retired clients.");
});

Deno.test("A-2: no child configuration is mutated or synthesized", () => {
  const b = FN_BODY.toLowerCase();
  for (
    const t of [
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_capability_grants",
      "api_user_policy_acknowledgements",
      "api_client_policy_versions",
      "api_client_supported_capabilities",
    ]
  ) {
    assert(!b.includes(t), `Function must not touch ${t}`);
  }
  assert(!/\bdelete\s+from\b/.test(b), "No deletes allowed.");
  assert(!/update\s+public\.api_clients/.test(b), "Client records must not be mutated.");
});

Deno.test("A-2: exactly one audit row per successful transition, in-transaction", () => {
  const b = FN_BODY.toLowerCase();
  const inserts = (b.match(new RegExp(`insert into public\\.${AUDIT}`, "g")) ?? []).length;
  assertEquals(inserts, 1);
  assertStringIncludes(b, "'organization_client_enablement', v_enablement_id, v_action");
  assertStringIncludes(b, "v_previous, _target_lifecycle_status, 'btpm_ui'");
  assertStringIncludes(b, "gen_random_uuid(), v_actor, v_tenant_id, _organization_id, _api_client_id");
  assert(!b.includes("commit"), "No explicit transaction control.");
  assert(!b.includes("exception when"), "No swallow of failures — audit must be atomic.");
});

Deno.test("A-2: audit table shape is safe metadata only", () => {
  const start = LOWER.indexOf(`create table if not exists public.${AUDIT}`);
  assert(start >= 0);
  const block = LOWER.slice(start, LOWER.indexOf(");", start));
  for (
    const col of [
      "id uuid",
      "event_at timestamptz",
      "correlation_id uuid",
      "actor_user_id uuid",
      "tenant_id uuid",
      "organization_id uuid",
      "api_client_id uuid",
      "target_type text",
      "target_id uuid",
      "action text",
      "previous_lifecycle_status text",
      "resulting_lifecycle_status text",
      "source_channel text",
    ]
  ) {
    assertStringIncludes(block, col);
  }
  for (
    const forbidden of [
      "token",
      "secret",
      "header",
      "payload",
      "narrative",
      "reason",
      "policy_document",
      "error",
      "oauth",
    ]
  ) {
    assert(!block.includes(forbidden), `Audit table must not store ${forbidden}`);
  }
  assertStringIncludes(block, "primary key (id)");
  assertStringIncludes(block, "references public.organizations(id)");
  assertStringIncludes(block, "references public.api_clients(id)");
  assertStringIncludes(block, "references public.tenants(id)");
  assertStringIncludes(block, "check (target_type in ('organization_client_enablement'))");
  assertStringIncludes(block, "check (source_channel in ('btpm_ui'))");
  assertStringIncludes(LOWER, `create index if not exists ${AUDIT}_org_client_time_idx`);
});

Deno.test("A-2: audit table RLS enabled with no policies and no browser access", () => {
  assertStringIncludes(LOWER, `alter table public.${AUDIT} enable row level security`);
  assert(!LOWER.includes("create policy"), "No RLS policy may be created.");
  assertStringIncludes(LOWER, `revoke all on table public.${AUDIT} from public`);
  assertStringIncludes(LOWER, `revoke all on table public.${AUDIT} from anon`);
  assertStringIncludes(LOWER, `revoke all on table public.${AUDIT} from authenticated`);
  assertStringIncludes(LOWER, `grant select, insert on table public.${AUDIT} to service_role`);
  assert(!/grant[^;]*on table[^;]*to authenticated/.test(LOWER), "No table grants to authenticated.");
  assert(!/\b(update|delete|truncate)\s+on table/.test(LOWER));
});

Deno.test("A-2: RPC execution posture", () => {
  assertStringIncludes(LOWER, `revoke all on function public.${FN}(uuid, uuid, text) from public`);
  assertStringIncludes(LOWER, `revoke all on function public.${FN}(uuid, uuid, text) from anon`);
  assertStringIncludes(LOWER, `grant execute on function public.${FN}(uuid, uuid, text) to authenticated`);
  assert(
    !new RegExp(`grant execute on function public\\.${FN}[^;]*to service_role`).test(LOWER),
    "No explicit service_role execution grant.",
  );
});

Deno.test("A-2: no frontend, Edge Function, seed rows or app-specific branches", () => {
  assert(!/\binsert into public\.(api_clients|organizations|tenants|user_roles)\b/.test(LOWER));
  assert(!LOWER.includes("astra"));
  assert(!LOWER.includes("tenant_integrations"));
});

Deno.test("A-2: accepted API-G.5.7A-1 artefacts remain untouched", async () => {
  assert(!LOWER.includes("api_g_5_7_admin_list_organization_clients"));
  const prior = (await migrationsMatching(/API-G\.5\.7A-1(C1|C2)?\b/))
    .filter(([name]) => name !== MIGRATION_NAME);
  assertEquals(prior.length, 3, "Expected the three accepted A-1 migrations to remain.");
});
