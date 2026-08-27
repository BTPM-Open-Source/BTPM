// API-G.5.6A — Platform administration read model and supported-capability
// command.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen API-G.5.6A contract:
//   - Only the two existing platform-admin audit CHECK constraints are
//     replaced; every previously accepted API-G.5.5A / API-G.5.5B value is
//     retained and only 'supported_capability' / 'supported_capability_
//     transition' are added.
//   - No table, column, RLS policy, index, seed row or direct authenticated
//     table grant is created.
//   - Three Platform-Super-Admin-only read RPCs and exactly one
//     Platform-Super-Admin-only supported-capability transition command exist
//     with the exact frozen signatures.
//   - Every RPC derives the actor exclusively from auth.uid(), accepts no
//     caller-supplied actor, is SECURITY DEFINER with a fixed search_path,
//     is revoked from PUBLIC and anon and executable only by authenticated.
//   - The three read RPCs are STABLE; the list command is bounded and
//     deterministically ordered.
//   - The transition command applies parent-first locking in the exact
//     order client -> catalogue -> supported row, refuses non-assignable or
//     non-active catalogue rows, refuses retired/absent clients without
//     enumeration, applies only the permitted transition graph, and writes
//     exactly one append-only audit event with structural fields only.
//   - No delete command, no grant / enablement / acknowledgement / UX /
//     route / Edge Function / OAuth-provider / secret / Astra / rate-profile /
//     activity-ledger / Tenant / Baseline / encryption / tenant_integrations
//     change; prior API-C, API-D, API-E, G.5.2, G.5.4, G.5.5A, G.5.5A-C1 and
//     G.5.5B migrations remain unchanged.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-G.5.6A — Platform administration read model and supported-capability command";

const PRIOR_MARKERS = [
  "API-C.2",
  "API-D",
  "API-E",
  "API-G.5.4 — OAuth registration metadata",
  "API-G.5.5A — Platform client and OAuth-redirect administration backend",
  "API-G.5.5B — Platform policy-version administration backend",
] as const;

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const out: { name: string; sql: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    out.push({
      name: entry.name,
      sql: await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const allMigrations = await readMigrations();
const matches = allMigrations.filter((m) => m.sql.includes(MARKER));
if (matches.length !== 1) {
  throw new Error(
    `expected exactly one API-G.5.6A migration (marker: ${MARKER}), found ${matches.length}`,
  );
}
const migration = matches[0];
const sql = migration.sql;
const lower = sql.toLowerCase();
// Executable SQL only: line comments are documentation, not references.
const executableLower = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .toLowerCase();

const LIST_CLIENTS = "public.api_g_5_6_platform_list_clients";
const GET_CLIENT = "public.api_g_5_6_platform_get_client";
const LIST_CAPS = "public.api_g_5_6_platform_list_assignable_capabilities";
const TRANSITION = "public.api_g_5_6_platform_transition_supported_capability";

function bodyIn(sqlText: string, fnName: string): string {
  const start = sqlText.toLowerCase().indexOf(
    `create or replace function ${fnName.toLowerCase()}`,
  );
  assert(start >= 0, `${fnName} must be defined in the inspected migration`);
  const end = sqlText.indexOf("\n$$;", start);
  assert(end > start, `${fnName} body must terminate`);
  return sqlText.slice(start, end + 4);
}

function bodyOf(fnName: string): string {
  return bodyIn(sql, fnName);
}

// ---------------------------------------------------------------------------
// API-G.5.6A-C1 — lock-order correction migration
// ---------------------------------------------------------------------------
const CORRECTION_MARKER =
  "API-G.5.6A-C1 — Supported-capability lock-order alignment";
const correctionMatches = allMigrations.filter((m) =>
  m.sql.includes(CORRECTION_MARKER)
);
if (correctionMatches.length !== 1) {
  throw new Error(
    `expected exactly one API-G.5.6A-C1 migration (marker: ${CORRECTION_MARKER}), found ${correctionMatches.length}`,
  );
}
const correction = correctionMatches[0];
const correctionSql = correction.sql;

// The accepted API-G.5.2-C1 migration defines the grant-lifecycle rule whose
// lock order the correction must match.
const G52C1_MARKER =
  "API-G.5.2-C1 — Route-version and concurrent lifecycle integrity";
const g52c1Matches = allMigrations.filter((m) => m.sql.includes(G52C1_MARKER));
if (g52c1Matches.length !== 1) {
  throw new Error(
    `expected exactly one API-G.5.2-C1 migration, found ${g52c1Matches.length}`,
  );
}
const g52c1Sql = g52c1Matches[0].sql;

/** The final installed transition function comes from the C1 correction. */
function transitionBody(): string {
  return bodyIn(correctionSql, TRANSITION);
}


// ---------------------------------------------------------------------------
// 1. Migration placement and uniqueness
// ---------------------------------------------------------------------------
Deno.test("API-G.5.6A migration is unique and newest of the platform-admin chain", () => {
  assert(
    /^\d{14}_[0-9a-f-]{36}\.sql$/.test(migration.name),
    "migration filename must follow the repository convention",
  );
  const g55b = allMigrations.filter((m) =>
    m.sql.includes("API-G.5.5B — Platform policy-version administration backend")
  );
  assert(g55b.length === 1, "exactly one API-G.5.5B migration must exist");
  assert(
    migration.name.localeCompare(g55b[0].name) > 0,
    "API-G.5.6A must be strictly newer than API-G.5.5B",
  );
});

Deno.test("prior migrations are untouched by API-G.5.6A", () => {
  for (const prior of PRIOR_MARKERS) {
    const owners = allMigrations.filter(
      (m) => m.name !== migration.name && m.sql.includes(prior),
    );
    assert(
      owners.length > 0,
      `prior marker ${prior} must still be owned by an earlier migration`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Audit constraint extension only
// ---------------------------------------------------------------------------
Deno.test("only the two existing audit CHECK constraints are replaced", () => {
  const drops = sql.match(/DROP CONSTRAINT\s+([a-z0-9_]+)/gi) ?? [];
  assert(drops.length === 2, "exactly two constraints may be dropped");
  assert(
    lower.includes("drop constraint api_platform_admin_audit_events_target_type_chk"),
    "target_type CHECK must be replaced",
  );
  assert(
    lower.includes("drop constraint api_platform_admin_audit_events_action_chk"),
    "action CHECK must be replaced",
  );
});

Deno.test("target_type CHECK retains prior values and adds supported_capability", () => {
  for (const v of ["api_client", "oauth_redirect", "policy_version", "supported_capability"]) {
    assert(
      sql.includes(`'${v}'`),
      `target_type value ${v} must be accepted`,
    );
  }
});

Deno.test("action CHECK retains every prior action and adds the capability action", () => {
  for (
    const v of [
      "client_create",
      "client_update",
      "client_transition",
      "redirect_create",
      "redirect_update",
      "redirect_transition",
      "policy_create",
      "policy_update",
      "policy_transition",
      "supported_capability_transition",
    ]
  ) {
    assert(sql.includes(`'${v}'`), `action value ${v} must be accepted`);
  }
});

// ---------------------------------------------------------------------------
// 3. Additive-only posture
// ---------------------------------------------------------------------------
Deno.test("no table, column, policy, index, trigger or seed row is created", () => {
  assert(!/create\s+table/.test(lower), "no CREATE TABLE is permitted");
  assert(!/add\s+column/.test(lower), "no ADD COLUMN is permitted");
  assert(!/drop\s+column/.test(lower), "no DROP COLUMN is permitted");
  assert(!/create\s+policy/.test(lower), "no CREATE POLICY is permitted");
  assert(!/create\s+(unique\s+)?index/.test(lower), "no index is permitted");
  assert(!/create\s+trigger/.test(lower), "no trigger is permitted");
  assert(!/create\s+type/.test(lower), "no new type is permitted");
  assert(!/\binsert\s+into\s+public\.api_capability_catalogue/.test(lower),
    "no catalogue seed row is permitted");
});

Deno.test("no direct table grant and no destructive statement is present", () => {
  const grants = sql.match(/GRANT\s+[^;]*;/gi) ?? [];
  for (const g of grants) {
    assert(
      /GRANT EXECUTE ON FUNCTION/i.test(g),
      `only function EXECUTE grants are permitted, found: ${g}`,
    );
  }
  assert(!/drop\s+table/.test(lower), "no DROP TABLE is permitted");
  assert(!/drop\s+function/.test(lower), "no DROP FUNCTION is permitted");
  assert(!/truncate/.test(lower), "no TRUNCATE is permitted");
  assert(
    !/delete\s+from\s+public\./.test(lower),
    "no row deletion is permitted",
  );
});

Deno.test("no out-of-scope substrate is referenced", () => {
  for (
    const forbidden of [
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_user_policy_acknowledgements",
      "api_consent_audit_events",
      "api_rate_limit_profiles",
      "tenant_integrations",
      "tenant_secret_refs",
      "activity_events",
    ]
  ) {
    assert(
      !executableLower.includes(forbidden),
      `${forbidden} must not be referenced by API-G.5.6A`,
    );
  }
});

Deno.test("exactly four functions are defined and none is a delete command", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION\s+public\.[a-z0-9_]+/gi) ??
    [];
  assert(defs.length === 4, `expected 4 functions, found ${defs.length}`);
  for (const fn of [LIST_CLIENTS, GET_CLIENT, LIST_CAPS, TRANSITION]) {
    assert(
      defs.some((d) => d.toLowerCase().endsWith(fn.toLowerCase())),
      `${fn} must be defined`,
    );
  }
  assert(
    !/_delete_|_remove_|_purge_/.test(defs.join(" ").toLowerCase()),
    "no delete command may be introduced",
  );
});

// ---------------------------------------------------------------------------
// 4. Shared security posture of every RPC
// ---------------------------------------------------------------------------
for (const fn of [LIST_CLIENTS, GET_CLIENT, LIST_CAPS, TRANSITION]) {
  Deno.test(`${fn} is SECURITY DEFINER with a fixed search_path`, () => {
    const body = bodyOf(fn).toLowerCase();
    assert(body.includes("security definer"), "must be SECURITY DEFINER");
    assert(
      body.includes("set search_path = public, pg_catalog"),
      "must pin search_path to public, pg_catalog",
    );
  });

  Deno.test(`${fn} derives the actor only from auth.uid() and gates on Super Admin`, () => {
    const body = bodyOf(fn);
    const lowerBody = body.toLowerCase();
    assert(
      lowerBody.includes("v_actor uuid := auth.uid()"),
      "actor must be derived from auth.uid()",
    );
    assert(
      (body.match(/auth\.uid\(\)/g) ?? []).length === 1,
      "auth.uid() must be read exactly once",
    );
    assert(
      lowerBody.includes("if v_actor is null then"),
      "anonymous callers must be rejected",
    );
    assert(
      lowerBody.includes("if not public.is_platform_super_admin(v_actor) then"),
      "must gate on public.is_platform_super_admin",
    );
    assert(
      (lowerBody.match(/errcode = '42501'/g) ?? []).length >= 2,
      "authorization denials must raise 42501",
    );
  });

  Deno.test(`${fn} accepts no caller-supplied actor or authority argument`, () => {
    const body = bodyOf(fn).toLowerCase();
    const header = body.slice(0, body.indexOf("language plpgsql"));
    for (const bad of ["_actor", "_user_id", "_is_admin", "_super", "_role"]) {
      assert(
        !header.includes(bad),
        `${fn} must not accept caller-supplied ${bad}`,
      );
    }
  });

  Deno.test(`${fn} is revoked from PUBLIC and anon and granted only to authenticated`, () => {
    const bare = fn.replace("public.", "");
    const revokePublic = new RegExp(
      `REVOKE ALL ON FUNCTION ${fn.replace(/\./g, "\\.")}\\([^)]*\\) FROM PUBLIC;`,
      "i",
    );
    const revokeAnon = new RegExp(
      `REVOKE ALL ON FUNCTION ${fn.replace(/\./g, "\\.")}\\([^)]*\\) FROM anon;`,
      "i",
    );
    const grantAuth = new RegExp(
      `GRANT EXECUTE ON FUNCTION ${fn.replace(/\./g, "\\.")}\\([^)]*\\) TO authenticated;`,
      "i",
    );
    assert(revokePublic.test(sql), `${bare} must be revoked from PUBLIC`);
    assert(revokeAnon.test(sql), `${bare} must be revoked from anon`);
    assert(grantAuth.test(sql), `${bare} must be granted to authenticated`);
    // The only EXECUTE grant emitted for this RPC must be the authenticated
    // one: no PUBLIC or anon execute privilege may be handed back.
    const grantsForFn = sql.match(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION ${fn.replace(/\./g, "\\.")}\\([^)]*\\) TO [a-z_]+;`,
        "gi",
      ),
    ) ?? [];
    assert(
      grantsForFn.length === 1,
      `${bare} must emit exactly one EXECUTE grant, found ${grantsForFn.length}`,
    );
    assert(
      /TO authenticated;$/i.test(grantsForFn[0]),
      `${bare} may only grant EXECUTE to authenticated`,
    );
    // Revokes must precede the grant so the grant is never widened.
    assert(
      sql.search(revokePublic) < sql.search(grantAuth) &&
        sql.search(revokeAnon) < sql.search(grantAuth),
      `${bare} revokes must precede the authenticated grant`,
    );
  });
}


// ---------------------------------------------------------------------------
// 5. Read-model contracts
// ---------------------------------------------------------------------------
Deno.test("list_clients has the frozen bounded signature and is STABLE", () => {
  const body = bodyOf(LIST_CLIENTS);
  const lowerBody = body.toLowerCase();
  assert(
    lowerBody.includes("_include_retired boolean default false"),
    "must expose _include_retired defaulting to false",
  );
  assert(
    lowerBody.includes("_limit integer default 50"),
    "must expose _limit defaulting to 50",
  );
  assert(
    lowerBody.includes("_offset integer default 0"),
    "must expose _offset defaulting to 0",
  );
  assert(lowerBody.includes("\nstable\n"), "read RPC must be STABLE");
});

Deno.test("list_clients enforces hard pagination bounds", () => {
  const body = bodyOf(LIST_CLIENTS).toLowerCase();
  assert(
    body.includes("_limit is null or _limit < 1 or _limit > 100"),
    "limit must be bounded to 1..100",
  );
  assert(
    body.includes("_offset is null or _offset < 0"),
    "offset must be non-negative",
  );
  assert(body.includes("errcode = '22023'"), "invalid pagination must raise 22023");
  assert(body.includes("limit _limit"), "the query must apply the limit");
  assert(body.includes("offset _offset"), "the query must apply the offset");
});

Deno.test("list_clients is deterministically ordered and returns derived counts", () => {
  const body = bodyOf(LIST_CLIENTS).toLowerCase();
  assert(
    body.includes("order by c.updated_at desc, c.id asc"),
    "ordering must be total and deterministic",
  );
  for (
    const col of [
      "redirect_count",
      "active_redirect_count",
      "policy_version_count",
      "active_policy_version",
      "enabled_supported_capability_count",
      "total_count",
    ]
  ) {
    assert(body.includes(col), `${col} must be projected`);
  }
});

Deno.test("get_client returns a structural bundle and never enumerates", () => {
  const body = bodyOf(GET_CLIENT);
  const lowerBody = body.toLowerCase();
  assert(lowerBody.includes("returns jsonb"), "detail RPC must return jsonb");
  assert(lowerBody.includes("\nstable\n"), "detail RPC must be STABLE");
  for (
    const key of ["'client'", "'redirects'", "'policy_versions'", "'supported_capabilities'"]
  ) {
    assert(body.includes(key), `detail bundle must include ${key}`);
  }
  assert(
    (lowerBody.match(/api client is not available/g) ?? []).length >= 2,
    "absent and null client identifiers must collapse into one safe message",
  );
  assert(
    !lowerBody.includes("not found"),
    "existence must not be disclosed",
  );
});

Deno.test("get_client orders every collection deterministically", () => {
  const body = bodyOf(GET_CLIENT).toLowerCase();
  assert(
    body.includes("order by ord_created_at asc, ord_id asc"),
    "redirects must be deterministically ordered",
  );
  assert(
    body.includes("order by ord_rank asc, ord_created_at desc, ord_id asc"),
    "policy versions must be deterministically ordered",
  );
  assert(
    body.includes(
      "order by ord_api_version asc, ord_display_name asc, ord_capability_key asc",
    ),
    "capabilities must be deterministically ordered",
  );
  assert(
    body.includes("coalesce(jsonb_agg"),
    "empty collections must render as empty arrays",
  );
});

Deno.test("get_client exposes assignable catalogue rows plus existing support rows only", () => {
  const body = bodyOf(GET_CLIENT).toLowerCase();
  assert(
    body.includes("left join public.api_client_supported_capabilities s"),
    "catalogue must be the left-hand driver",
  );
  assert(
    body.includes(
      "where s.id is not null\n       or (cat.lifecycle_status = 'active' and cat.administrator_assignable)",
    ),
    "only existing support rows or active assignable catalogue rows may be listed",
  );
});

Deno.test("list_assignable_capabilities is a parameterless bounded catalogue read", () => {
  const body = bodyOf(LIST_CAPS);
  const lowerBody = body.toLowerCase();
  assert(
    lowerBody.includes("api_g_5_6_platform_list_assignable_capabilities()"),
    "must take no arguments",
  );
  assert(lowerBody.includes("\nstable\n"), "must be STABLE");
  assert(
    lowerBody.includes("cat.lifecycle_status = 'active'"),
    "retired catalogue rows must be excluded",
  );
  assert(
    lowerBody.includes("cat.administrator_assignable = true"),
    "non-assignable catalogue rows must be excluded",
  );
  assert(
    lowerBody.includes(
      "order by cat.api_version asc, cat.display_name asc, cat.capability_key asc",
    ),
    "ordering must be deterministic",
  );
});

// ---------------------------------------------------------------------------
// 6. Supported-capability transition command
// ---------------------------------------------------------------------------
Deno.test("transition command has the exact frozen signature", () => {
  const body = bodyOf(TRANSITION).toLowerCase();
  for (
    const arg of [
      "_api_client_id uuid",
      "_api_version text",
      "_capability_kind text",
      "_capability_key text",
      "_target_lifecycle_status text",
    ]
  ) {
    assert(body.includes(arg), `signature must include ${arg}`);
  }
  assert(body.includes("returns uuid"), "must return only the row identifier");
  assert(!body.includes("\nstable\n"), "a mutation command must not be STABLE");
});

Deno.test("transition command validates the target status exactly", () => {
  const body = bodyOf(TRANSITION).toLowerCase();
  assert(
    body.includes("_target_lifecycle_status not in ('enabled','disabled')"),
    "only enabled/disabled targets are permitted",
  );
  assert(body.includes("errcode = '22023'"), "invalid input must raise 22023");
  assert(
    !body.includes("lower(_capability_key)") && !body.includes("trim(_capability_key)"),
    "catalogue identity must never be normalized",
  );
});

Deno.test("API-G.5.6A-C1 replaces only the transition command with an unchanged signature", () => {
  assert(
    /^\d{14}_[0-9a-f-]{36}\.sql$/.test(correction.name),
    "correction migration filename must follow the repository convention",
  );
  assert(
    correction.name.localeCompare(migration.name) > 0,
    "the correction must be newer than the API-G.5.6A migration",
  );
  const defs =
    correctionSql.match(/CREATE OR REPLACE FUNCTION\s+public\.[a-z0-9_]+/gi) ??
      [];
  assert(
    defs.length === 1 &&
      defs[0].toLowerCase().endsWith(TRANSITION.toLowerCase()),
    "the correction may replace only the transition command",
  );
  const body = transitionBody().toLowerCase();
  for (
    const arg of [
      "_api_client_id uuid",
      "_api_version text",
      "_capability_kind text",
      "_capability_key text",
      "_target_lifecycle_status text",
    ]
  ) {
    assert(body.includes(arg), `signature must still include ${arg}`);
  }
  assert(body.includes("returns uuid"), "return type must remain uuid");
  assert(body.includes("security definer"), "must remain SECURITY DEFINER");
  assert(
    body.includes("set search_path = public, pg_catalog"),
    "search_path must remain pinned",
  );
  assert(
    body.includes("v_actor uuid := auth.uid()") &&
      (transitionBody().match(/auth\.uid\(\)/g) ?? []).length === 1,
    "actor must still be derived only from auth.uid()",
  );
  assert(
    body.includes("if not public.is_platform_super_admin(v_actor) then"),
    "Platform Super Admin enforcement must be preserved",
  );
  // No table, trigger, policy, grant-table or seed change in the correction:
  // inspect only the statements outside the replaced function body.
  const outside = correctionSql.replace(transitionBody(), "");
  assert(
    !/\b(create|alter|drop)\s+(table|trigger|policy|type|index)\b/i.test(
      outside,
    ) && !/\binsert\s+into\b/i.test(outside) &&
      !/\bgrant\s+(select|insert|update|delete|all)\b/i.test(outside),
    "the correction must not touch tables, triggers, policies or rows",
  );
});

Deno.test("API-G.5.6A-C1 repeats the explicit revokes and authenticated grant", () => {
  const esc = TRANSITION.replace(/\./g, "\\.");
  assert(
    new RegExp(`REVOKE ALL ON FUNCTION ${esc}\\([^)]*\\) FROM PUBLIC;`, "i")
      .test(correctionSql),
    "the correction must revoke EXECUTE from PUBLIC",
  );
  assert(
    new RegExp(`REVOKE ALL ON FUNCTION ${esc}\\([^)]*\\) FROM anon;`, "i")
      .test(correctionSql),
    "the correction must revoke EXECUTE from anon",
  );
  const grants = correctionSql.match(
    new RegExp(`GRANT EXECUTE ON FUNCTION ${esc}\\([^)]*\\) TO [a-z_]+;`, "gi"),
  ) ?? [];
  assert(
    grants.length === 1 && /TO authenticated;$/i.test(grants[0]),
    "the correction must grant EXECUTE only to authenticated",
  );
});

Deno.test("corrected transition command locks client -> supported capability -> catalogue", () => {
  const body = transitionBody().toLowerCase();
  const clientLock = body.indexOf("from public.api_clients c");
  const supportLock = body.indexOf(
    "from public.api_client_supported_capabilities s",
  );
  const catalogueLock = body.indexOf("from public.api_capability_catalogue cat");
  assert(clientLock > 0, "the parent client must be locked");
  assert(supportLock > 0, "the supported-capability row must be looked up");
  assert(catalogueLock > 0, "the catalogue row must be locked");
  assert(
    supportLock > clientLock,
    "the supported-capability row must be locked after the client",
  );
  assert(
    catalogueLock > supportLock,
    "the catalogue row must be locked after the supported-capability row",
  );
  // Even when no supported row exists, its lookup is issued before the
  // catalogue lock: the absent-row branch is evaluated only afterwards.
  const absentBranch = body.indexOf("if v_supported_id is null then");
  assert(
    absentBranch > catalogueLock,
    "the absent-supported-row branch must follow both locks",
  );
  assert(
    (body.match(/for update/g) ?? []).length === 3,
    "exactly three FOR UPDATE locks are required",
  );
  const locks = [
    body.indexOf("for update"),
    body.indexOf("for update", body.indexOf("for update") + 1),
    body.lastIndexOf("for update"),
  ];
  assert(
    locks[0] > clientLock && locks[0] < supportLock &&
      locks[1] > supportLock && locks[1] < catalogueLock &&
      locks[2] > catalogueLock,
    "each of the three lookups must take its own FOR UPDATE lock",
  );
  // No catalogue-first supported-row path may remain.
  assert(
    body.indexOf("from public.api_capability_catalogue cat") >
      body.lastIndexOf("from public.api_client_supported_capabilities s", body.indexOf("from public.api_capability_catalogue cat")),
    "no catalogue-first supported-row path may remain",
  );
});

Deno.test("corrected lock order matches the accepted API-G.5.2-C1 grant lifecycle order", () => {
  const guard = bodyIn(
    g52c1Sql,
    "public.api_g_5_2_enforce_grant_capability_lifecycle",
  ).toLowerCase();
  const guardSupport = guard.indexOf(
    "from public.api_client_supported_capabilities",
  );
  const guardCatalogue = guard.indexOf("from public.api_capability_catalogue");
  assert(guardSupport > 0, "the accepted guard must read the supported row");
  assert(guardCatalogue > 0, "the accepted guard must read the catalogue row");
  assert(
    guardSupport < guardCatalogue,
    "the accepted guard locks supported capability before catalogue",
  );
  const body = transitionBody().toLowerCase();
  const cmdSupport = body.indexOf(
    "from public.api_client_supported_capabilities s",
  );
  const cmdCatalogue = body.indexOf("from public.api_capability_catalogue cat");
  assert(
    cmdSupport < cmdCatalogue,
    "the corrected command must use the same supported-capability -> catalogue order",
  );
});


Deno.test("transition command refuses absent or retired clients without enumeration", () => {
  const body = bodyOf(TRANSITION).toLowerCase();
  assert(
    body.includes("if v_client_lifecycle is null or v_client_lifecycle = 'retired' then"),
    "absent and retired clients must collapse into one branch",
  );
  assert(
    body.includes("api client is not available"),
    "the denial message must not disclose existence",
  );
});

Deno.test("transition command refuses non-active or non-assignable catalogue rows", () => {
  const body = bodyOf(TRANSITION).toLowerCase();
  assert(
    body.includes("v_cat_lifecycle <> 'active'"),
    "retired catalogue rows must be refused",
  );
  assert(
    body.includes("v_cat_assignable is distinct from true"),
    "non-assignable catalogue rows must be refused",
  );
  assert(
    body.includes("capability is not administrator assignable"),
    "the refusal must be explicit",
  );
});

Deno.test("transition command applies only the permitted transition graph", () => {
  const body = bodyOf(TRANSITION).toLowerCase();
  assert(
    body.includes("if v_supported_id is null then") &&
      body.includes("if _target_lifecycle_status <> 'enabled' then"),
    "a missing row may only be created as enabled",
  );
  assert(
    body.includes("elsif v_previous = 'disabled' and _target_lifecycle_status = 'enabled' then"),
    "disabled -> enabled must be permitted",
  );
  assert(
    body.includes("elsif v_previous = 'enabled' and _target_lifecycle_status = 'disabled' then"),
    "enabled -> disabled must be permitted",
  );
  assert(
    body.includes("supported capability transition is not permitted"),
    "every other transition must be refused",
  );
  assert(
    (body.match(/errcode = '23514'/g) ?? []).length === 2,
    "refused transitions must raise 23514",
  );
  assert(
    !/delete\s+from/.test(body),
    "the command must never delete a supported-capability row",
  );
});

Deno.test("transition command writes exactly one structural append-only audit event", () => {
  const body = bodyOf(TRANSITION);
  const lowerBody = body.toLowerCase();
  const inserts = lowerBody.match(
    /insert into public\.api_platform_admin_audit_events/g,
  ) ?? [];
  assert(inserts.length === 1, "exactly one audit event must be written");
  assert(
    lowerBody.includes("'supported_capability'") &&
      lowerBody.includes("'supported_capability_transition'"),
    "the audit event must use the new target and action values",
  );
  assert(
    lowerBody.includes("actor_user_id, api_client_id, target_type, target_id"),
    "the audit event must record the derived actor and parent client",
  );
  assert(
    lowerBody.includes("previous_lifecycle_status, resulting_lifecycle_status"),
    "the audit event must record the lifecycle transition",
  );
  const auditStart = lowerBody.indexOf(
    "insert into public.api_platform_admin_audit_events",
  );
  const auditBlock = lowerBody.slice(auditStart);
  for (const secretish of ["reason", "document", "token", "secret"]) {
    assert(
      !auditBlock.slice(0, auditBlock.indexOf(");")).includes(secretish),
      `the audit payload must not carry ${secretish}`,
    );
  }
});

Deno.test("transition command returns only the identifier it audited", () => {
  const body = bodyOf(TRANSITION).toLowerCase();
  assert(
    body.includes("return v_result_id;"),
    "the command must return the supported-capability identifier only",
  );
  assert(
    body.includes("target_id"),
    "the audited target must be the same identifier",
  );
});

Deno.test("corrected transition command preserves the graph, timestamps and audit", () => {
  const body = transitionBody().toLowerCase();
  assert(
    body.includes("_target_lifecycle_status not in ('enabled','disabled')") &&
      body.includes("errcode = '22023'"),
    "input validation must be preserved",
  );
  assert(
    body.includes("if v_client_lifecycle is null or v_client_lifecycle = 'retired' then") &&
      body.includes("api client is not available"),
    "non-enumerating client refusal must be preserved",
  );
  assert(
    body.includes("v_cat_lifecycle <> 'active'") &&
      body.includes("v_cat_assignable is distinct from true") &&
      body.includes("capability is not administrator assignable"),
    "catalogue assignability refusal must be preserved",
  );
  assert(
    body.includes("if v_supported_id is null then") &&
      body.includes("elsif v_previous = 'disabled' and _target_lifecycle_status = 'enabled' then") &&
      body.includes("elsif v_previous = 'enabled' and _target_lifecycle_status = 'disabled' then") &&
      (body.match(/errcode = '23514'/g) ?? []).length === 2,
    "the permitted transition graph must be preserved",
  );
  assert(
    body.includes("enabled_at = now()") && body.includes("disabled_at = now()") &&
      body.includes("created_by, updated_by"),
    "timestamp and authorship behaviour must be preserved",
  );
  assert(
    (body.match(/insert into public\.api_platform_admin_audit_events/g) ?? [])
        .length === 1 &&
      body.includes("'supported_capability_transition'"),
    "exactly one audit event must still be written",
  );
  assert(
    !/delete\s+from/.test(body) && body.includes("return v_result_id;"),
    "no physical deletion and UUID-only return must be preserved",
  );
});
