// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-g-5-7a-1-organization-connected-apps-list_static_test.ts', import.meta.url).href;
// API-G.5.7A-1 — Protected Organization Connected Apps List (static contract test).
//
// Proves the additive migration adds exactly one read-only projection RPC,
// with derived authority, exact-Organization containment, bounded pagination,
// deterministic ordering, no mutation, and a locked privilege posture.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const BASE_MARKER = /^-- API-G\.5\.7A-1(?!C)\b.*$/m;
const CORRECTION_MARKER = /API-G\.5\.7A-1C1\b/;
const CORRECTION2_MARKER = /API-G\.5\.7A-1C2\b/;
const FN = "api_g_5_7_admin_list_organization_clients";

async function listMigrations(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return names;
}

async function migrationsMatching(marker: RegExp): Promise<Array<[string, string]>> {
  const matches: Array<[string, string]> = [];
  for (const name of await listMigrations()) {
    const text = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    if (marker.test(text)) matches.push([name, text]);
  }
  return matches;
}

const BASE_MATCHES = await migrationsMatching(BASE_MARKER);
const CORRECTION_MATCHES = await migrationsMatching(CORRECTION_MARKER);
const CORRECTION2_MATCHES = await migrationsMatching(CORRECTION2_MARKER);

assertEquals(
  BASE_MATCHES.length,
  1,
  `Expected exactly one original API-G.5.7A-1 migration, found: ${BASE_MATCHES.map((m) => m[0]).join(", ")}`,
);
assertEquals(
  CORRECTION_MATCHES.length,
  1,
  `Expected exactly one API-G.5.7A-1C1 correction migration, found: ${CORRECTION_MATCHES.map((m) => m[0]).join(", ")}`,
);
assertEquals(
  CORRECTION2_MATCHES.length,
  1,
  `Expected exactly one API-G.5.7A-1C2 correction migration, found: ${CORRECTION2_MATCHES.map((m) => m[0]).join(", ")}`,
);

// The A-1C2 migration is the final effective definition of the function.
const SQL = CORRECTION2_MATCHES[0][1];

// Authoritative committed contract of the callee helper public.is_org_admin.
async function authoritativeIsOrgAdminSignature(): Promise<string> {
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_org_admin\s*\(([^)]*)\)/gi;
  let last: string | null = null;
  for (const name of await listMigrations()) {
    const src = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    const all = [...src.matchAll(re)];
    if (all.length > 0) last = all[all.length - 1][1];
  }
  assert(last !== null, "No committed public.is_org_admin definition found.");
  return last!.replace(/\s+/g, " ").trim();
}

Deno.test("original migration plus both correction migrations exist exactly once", () => {
  assertEquals(BASE_MATCHES.length, 1);
  assertEquals(CORRECTION_MATCHES.length, 1);
  assertEquals(CORRECTION2_MATCHES.length, 1);
});

Deno.test("authoritative public.is_org_admin positional contract is (_user_id, _organization_id)", async () => {
  const sig = await authoritativeIsOrgAdminSignature();
  assert(
    /^_user_id\s+uuid\s*,\s*_organization_id\s+uuid$/i.test(sig),
    `Unexpected authoritative is_org_admin signature: ${sig}`,
  );
});


Deno.test("effective correction migration defines only the list RPC", () => {
  const creates = SQL.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(creates.length, 1, "Only one function may be created.");
  assertStringIncludes((creates[0] ?? "").toLowerCase(), `public.${FN}`);
});


Deno.test("exact RPC signature and typed return contract", () => {
  assert(
    new RegExp(
      String.raw`public\.${FN}\s*\(\s*_organization_id\s+uuid\s*,\s*_include_retired\s+boolean\s*,\s*_limit\s+integer\s*,\s*_offset\s+integer\s*\)`,
      "i",
    ).test(SQL),
    "Signature must match the required argument list exactly.",
  );
  const fields: Array<[string, string]> = [
    ["api_client_id", "uuid"],
    ["client_key", "text"],
    ["display_name", "text"],
    ["description", "text"],
    ["client_lifecycle_status", "text"],
    ["active_policy_version", "text"],
    ["organization_enablement_id", "uuid"],
    ["organization_enablement_status", "text"],
    ["organization_enabled_at", "(?:timestamptz|timestamp with time zone)"],
    ["organization_disabled_at", "(?:timestamptz|timestamp with time zone)"],
    ["enabled_workspace_count", "bigint"],
    ["enabled_project_count", "bigint"],
    ["enabled_capability_grant_count", "bigint"],
    ["total_count", "bigint"],
  ];
  const returnsBlock = SQL.slice(
    SQL.search(/RETURNS\s+TABLE/i),
    SQL.search(/LANGUAGE\s+plpgsql/i),
  );
  for (const [name, type] of fields) {
    assert(
      new RegExp(String.raw`\b${name}\s+${type}\b`, "i").test(returnsBlock),
      `Return field ${name} ${type} missing.`,
    );
  }
});

Deno.test("STABLE SECURITY DEFINER with fixed search path", () => {
  assert(/LANGUAGE\s+plpgsql/i.test(SQL));
  assert(/\bSTABLE\b/i.test(SQL));
  assert(/SECURITY\s+DEFINER/i.test(SQL));
  assert(/SET\s+search_path\s*(?:=|TO)\s*'?public'?\s*,\s*'?pg_catalog'?/i.test(SQL));
});

Deno.test("actor derives only from auth.uid() with active-user validation", () => {
  assert(/v_actor\s+uuid\s*:=\s*auth\.uid\(\)/i.test(SQL));
  assert(/v_actor\s+IS\s+NULL/i.test(SQL));
  assert(/public\.is_active_user\s*\(\s*v_actor\s*\)/i.test(SQL));
});

Deno.test("no caller-supplied tenant, user, role or authority argument", () => {
  const sig = SQL.slice(SQL.search(new RegExp(FN, "i")), SQL.search(/RETURNS\s+TABLE/i));
  assert(!/_tenant_id|_user_id|_actor|_role|_is_|_authority/i.test(sig));
});

Deno.test("tenant scope derived server-side from the Organization", () => {
  assert(
    /SELECT\s+o\.tenant_id\s+INTO\s+v_tenant_id[\s\S]{0,200}FROM\s+public\.organizations\s+o[\s\S]{0,120}o\.id\s*=\s*_organization_id/i
      .test(SQL),
    "Tenant must be looked up from the Organization row.",
  );
});

Deno.test("authority requires exact Tenant Admin or Organization Admin", () => {
  assert(/public\.is_tenant_admin\s*\(\s*v_tenant_id\s*,\s*v_actor\s*\)/i.test(SQL));
  assert(
    /public\.is_org_admin\s*\(\s*v_actor\s*,\s*_organization_id\s*\)/i.test(SQL),
    "Organization Admin call must match the authoritative (_user_id, _organization_id) order.",
  );
  assert(
    !/public\.is_org_admin\s*\(\s*_organization_id\s*,\s*v_actor\s*\)/i.test(SQL),
    "Reversed Organization-first argument order must not be present.",
  );
  assert(
    /v_authorized\s*:=\s*public\.is_tenant_admin\s*\(\s*v_tenant_id\s*,\s*v_actor\s*\)\s*OR\s+public\.is_org_admin\s*\(\s*v_actor\s*,\s*_organization_id\s*\)/i
      .test(SQL),
    "Authority expression must be the corrected tenant-admin OR org-admin form.",
  );
  assert(
    !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+[^\s(]*is_org_admin/i.test(SQL),
    "No helper overload, replacement or wrapper may be introduced.",
  );
});

Deno.test("Platform Super Admin and Workspace Admin grant no implicit authority", () => {
  assert(!/is_platform_super_admin/i.test(SQL));
  assert(!/is_workspace_admin|workspace_admin/i.test(SQL));
});

Deno.test("missing and unauthorized Organizations share one controlled failure", () => {
  const authFailures = SQL.match(/RAISE\s+EXCEPTION\s+'not_authorized'/gi) ?? [];
  assert(authFailures.length >= 1, "A controlled not_authorized failure is required.");
  assert(
    /IF\s+NOT\s+v_authorized\s+THEN[\s\S]{0,160}RAISE\s+EXCEPTION\s+'not_authorized'/i.test(SQL),
    "Unauthorized/absent Organization must use the shared non-enumerating failure.",
  );
  assert(
    !/organization_not_found|does not exist|unknown_organization/i.test(SQL),
    "No enumerating error may be raised.",
  );
});

Deno.test("active clients included; non-active only with retained exact-Org configuration", () => {
  assert(/c\.lifecycle_status\s*=\s*'active'/i.test(SQL));
  assert(
    /OR\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+configured\s+cf\s+WHERE\s+cf\.api_client_id\s*=\s*c\.id\s*\)/i
      .test(SQL),
    "Non-active clients require retained configuration.",
  );
  for (
    const t of [
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_capability_grants",
    ]
  ) {
    assert(
      new RegExp(String.raw`configured[\s\S]*${t}`, "i").test(SQL),
      `Configuration source ${t} must be considered.`,
    );
  }
});

Deno.test("retired-client inclusion obeys _include_retired and requires configuration", () => {
  assert(
    /c\.lifecycle_status\s*<>\s*'retired'\s*OR\s*\([\s\S]{0,200}_include_retired[\s\S]{0,200}EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+configured/i
      .test(SQL),
    "Retired clients require _include_retired and retained configuration.",
  );
});

Deno.test("missing Organization enablement stays null and is not synthesized", () => {
  assert(/LEFT\s+JOIN\s+org_enablement\s+oe/i.test(SQL));
  assert(!/COALESCE\s*\(\s*oe\.lifecycle_status/i.test(SQL));
  assert(!/COALESCE\s*\(\s*oe\.id/i.test(SQL));
});

Deno.test("counts are restricted to the exact derived Organization and Tenant scope", () => {
  for (const cte of ["ws AS", "pr AS", "gr AS"]) {
    const start = SQL.indexOf(cte);
    assert(start > -1, `${cte} missing`);
    const body = SQL.slice(start, start + 700);
    assert(/organization_id\s*=\s*_organization_id/i.test(body));
    assert(/tenant_id\s*=\s*v_tenant_id/i.test(body));
    assert(/lifecycle_status\s*=\s*'enabled'/i.test(body));
  }
  assert(
    /JOIN\s+public\.projects\s+pj[\s\S]{0,200}pj\.organization_id\s*=\s*_organization_id/i.test(SQL),
    "Project rows must match the Project's authoritative Organization.",
  );
});

Deno.test("pagination bounds validated exactly", () => {
  assert(/_include_retired\s+IS\s+NULL/i.test(SQL));
  assert(/_limit\s+IS\s+NULL\s+OR\s+_limit\s*<\s*1\s+OR\s+_limit\s*>\s*100/i.test(SQL));
  assert(/_offset\s+IS\s+NULL\s+OR\s+_offset\s*<\s*0\s+OR\s+_offset\s*>\s*10000/i.test(SQL));
  assert(/LIMIT\s+_limit/i.test(SQL));
  assert(/OFFSET\s+_offset/i.test(SQL));
});

Deno.test("total_count is computed before pagination", () => {
  const winIdx = SQL.search(/count\s*\(\s*\*\s*\)\s+OVER\s*\(\s*\)\s*::bigint\s+AS\s+total/i);
  const limitIdx = SQL.search(/LIMIT\s+_limit/i);
  assert(winIdx > -1, "total must be a window count over the filtered set.");
  assert(winIdx < limitIdx, "total must be computed before LIMIT/OFFSET.");
});

Deno.test("deterministic ordering: active first, case-insensitive name, then id", () => {
  assert(
    /ORDER\s+BY\s*[\s\S]{0,120}CASE\s+WHEN\s+cn\.lifecycle_status\s*=\s*'active'\s+THEN\s+0\s+ELSE\s+1\s+END\s*,\s*lower\(cn\.display_name\)\s*,\s*cn\.id/i
      .test(SQL),
    "Ordering must be active-first, lower(display_name), api_client_id.",
  );
});

Deno.test("no mutation, DDL, policy, trigger, index, seed or frontend surface", () => {
  const forbidden: Array<[RegExp, string]> = [
    [/\bINSERT\s+INTO\b/i, "insert"],
    [/\bUPDATE\s+public\./i, "update"],
    [/\bDELETE\s+FROM\b/i, "delete"],
    [/\bMERGE\b/i, "merge"],
    [/\bTRUNCATE\b/i, "truncate"],
    [/CREATE\s+TABLE/i, "table creation"],
    [/ALTER\s+TABLE/i, "table alteration"],
    [/CREATE\s+(UNIQUE\s+)?INDEX/i, "index creation"],
    [/CREATE\s+TRIGGER/i, "trigger creation"],
    [/CREATE\s+POLICY/i, "policy creation"],
    [/ALTER\s+POLICY|DROP\s+POLICY/i, "policy change"],
    [/EXECUTE\s+format\s*\(/i, "dynamic SQL"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(SQL), `Migration must not include ${label}.`);
  }
});

Deno.test("no sensitive fields are projected", () => {
  const forbidden = [
    /oauth_client_id/i,
    /redirect_uri/i,
    /policy_digest/i,
    /policy_uri/i,
    /acknowledgement/i,
    /audit_event/i,
    /token|secret|credential|authorization\s+header/i,
    /decrypt/i,
  ];
  for (const re of forbidden) {
    assert(!re.test(SQL), `Projection must not expose ${re}.`);
  }
});

Deno.test("privilege posture: revoked from PUBLIC and anon, granted only to authenticated", () => {
  const sig = String.raw`public\.${FN}\(uuid,\s*boolean,\s*integer,\s*integer\)`;
  assert(new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${sig}\s+FROM\s+PUBLIC`, "i").test(SQL));
  assert(new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${sig}\s+FROM\s+anon`, "i").test(SQL));
  assert(new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${sig}\s+TO\s+authenticated`, "i").test(SQL));
  assert(!/GRANT\s+EXECUTE[\s\S]{0,200}TO\s+anon/i.test(SQL));
  assert(!/GRANT\s+(SELECT|ALL|INSERT|UPDATE|DELETE)\s+ON\s+(TABLE\s+)?public\./i.test(SQL));
  assert(!/service_role/i.test(SQL), "No service_role path may be introduced.");
});
