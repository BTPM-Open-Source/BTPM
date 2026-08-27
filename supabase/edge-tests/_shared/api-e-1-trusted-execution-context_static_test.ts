// API-E.1 — Trusted API execution context foundation.
//
// Repository static-contract test. Locates the API-E.1 migration by its
// content signature (private schema + authorize_and_establish helper) and
// asserts the frozen contract:
//   - private schema `api_e_private` with locked-down access;
//   - exact helper definitions with fixed search paths;
//   - signed client_id read from JWT claims (`request.jwt.claims`);
//   - expected/signed client_id mismatch fails closed;
//   - auth.uid() derivation and active profile check exist;
//   - active client, active policy version, non-revoked acknowledgement,
//     active Tenant chain, current active Tenant/Organization/Workspace
//     memberships, Organization and Workspace client enablements checks;
//   - capability_kind/capability_key/api_version enforcement, including a
//     bypass block for wildcard/generic keys;
//   - trusted context uses transaction-local set_config(..., ..., true);
//   - required trusted-context keys are set only after all authorization
//     checks succeed;
//   - schema/function grants are revoked from PUBLIC/anon/authenticated;
//   - NO new table, seed, token/secret column, persistent context table,
//     generic dispatcher, header authority, active-Organization authority,
//     OAuth activation, or existing PMG/RLS modification is introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const CONTENT_MARKERS = [
  "CREATE SCHEMA IF NOT EXISTS api_e_private",
  "api_e_private.authorize_and_establish",
];

async function findMigration(): Promise<{ path: string; sql: string }> {
  const dir = "supabase/migrations";
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = `${dir}/${entry.name}`;
    const sql = await Deno.readTextFile(path);
    if (CONTENT_MARKERS.every((m) => sql.includes(m))) {
      return { path, sql };
    }
  }
  throw new Error("API-E.1 migration not found in supabase/migrations");
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

Deno.test("API-E.1 migration exists and is discoverable", async () => {
  const { path } = await findMigration();
  assert(path.length > 0);
});

Deno.test("API-E.1 creates locked-down private schema", async () => {
  const { sql: raw } = await findMigration();
  const sql = normalize(raw);
  assert(sql.includes("create schema if not exists api_e_private"));
  assert(sql.includes("revoke all on schema api_e_private from public"));
  assert(sql.includes("revoke all on schema api_e_private from anon"));
  assert(
    sql.includes("revoke all on schema api_e_private from authenticated"),
  );
});

Deno.test("API-E.1 defines jwt_client_id() with fixed search_path", async () => {
  const { sql: raw } = await findMigration();
  const sql = normalize(raw);
  assert(
    sql.includes("create or replace function api_e_private.jwt_client_id()"),
  );
  // Fixed search_path clause on the function.
  assert(
    /create or replace function api_e_private\.jwt_client_id\(\)[\s\S]*?set search_path = pg_catalog/
      .test(sql),
  );
  // Reads only from request.jwt.claims.
  assert(sql.includes("current_setting('request.jwt.claims', true)"));
  assert(sql.includes("client_id"));
  // Rejects overlong/malformed values.
  assert(sql.includes("length(_client_id)"));
});

Deno.test(
  "API-E.1 defines authorize_and_establish with the exact signature",
  async () => {
    const { sql } = await findMigration();
    // Exact ordered parameters. Preserve case for uuid types.
    assert(
      sql.includes("_expected_oauth_client_id text") &&
        sql.includes("_organization_id uuid") &&
        sql.includes("_workspace_id uuid") &&
        sql.includes("_api_version text") &&
        sql.includes("_capability_kind text") &&
        sql.includes("_capability_key text") &&
        sql.includes("_request_id text"),
    );
    const n = normalize(sql);
    assert(n.includes("create or replace function api_e_private.authorize_and_establish"));
    assert(
      /create or replace function api_e_private\.authorize_and_establish[\s\S]*?set search_path = public, pg_catalog/
        .test(n),
    );
    assert(n.includes("security definer"));
    assert(n.includes("returns boolean"));
  },
);

Deno.test("API-E.1 derives user from auth.uid() and checks active profile", async () => {
  const { sql: raw } = await findMigration();
  const sql = normalize(raw);
  assert(sql.includes("auth.uid()"));
  assert(
    sql.includes("from public.profiles p") &&
      sql.includes("p.is_active = true"),
  );
});

Deno.test("API-E.1 enforces expected vs signed client_id match", async () => {
  const { sql: raw } = await findMigration();
  const sql = normalize(raw);
  assert(sql.includes("_signed_client_id := api_e_private.jwt_client_id()"));
  assert(sql.includes("_signed_client_id <> _expected_oauth_client_id"));
});

Deno.test(
  "API-E.1 requires exactly one active api_clients row and one active policy version",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    assert(
      sql.includes("from public.api_clients") &&
        sql.includes("oauth_client_id = _signed_client_id") &&
        sql.includes("lifecycle_status = 'active'"),
    );
    assert(sql.includes("from public.api_client_policy_versions"));
    assert(sql.includes("_active_policy_count <> 1"));
  },
);

Deno.test(
  "API-E.1 requires non-revoked policy acknowledgement for the same user",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    assert(
      sql.includes("from public.api_user_policy_acknowledgements") &&
        sql.includes("user_id = _uid") &&
        sql.includes("policy_version_id = _policy.id") &&
        sql.includes("revoked_at is null"),
    );
  },
);

Deno.test(
  "API-E.1 requires active Tenant chain and Tenant/Organization memberships",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    assert(
      sql.includes("from public.organizations o") &&
        sql.includes("join public.tenants t on t.id = o.tenant_id") &&
        sql.includes("t.status = 'active'") &&
        sql.includes("t.suspended_at is null") &&
        sql.includes("t.archived_at is null") &&
        sql.includes("t.purged_at is null"),
    );
    assert(
      sql.includes("from public.tenant_memberships tm") &&
        sql.includes("tm.status = 'active'") &&
        sql.includes("tm.deactivated_at is null"),
    );
    assert(
      sql.includes("from public.organization_memberships om") &&
        sql.includes("om.status = 'active'") &&
        sql.includes("om.deactivated_at is null"),
    );
  },
);

Deno.test(
  "API-E.1 requires enabled Organization client enablement",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    assert(
      sql.includes("from public.api_organization_client_enablements oe") &&
        sql.includes("oe.lifecycle_status = 'enabled'"),
    );
  },
);

Deno.test(
  "API-E.1 workspace branch requires active workspace, membership, and enablement",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    assert(
      sql.includes("if _workspace_id is not null then") &&
        sql.includes("from public.workspaces w") &&
        sql.includes("w.is_active = true") &&
        sql.includes("w.is_archived = false") &&
        sql.includes("w.organization_id = _organization_id"),
    );
    assert(sql.includes("from public.workspace_memberships wm"));
    assert(
      sql.includes("from public.api_workspace_client_enablements we") &&
        sql.includes("we.lifecycle_status = 'enabled'"),
    );
  },
);

Deno.test(
  "API-E.1 enforces capability grant (kind/key/version) with no generic bypass",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    // Input-format guard blocks wildcard/generic keys.
    for (
      const forbidden of [
        "'crud'",
        "'generic_crud'",
        "'rpc'",
        "'generic_rpc'",
        "'table_access'",
        "'postgrest'",
        "'service_role'",
        "'*'",
      ]
    ) {
      assert(
        sql.includes(forbidden),
        `authorize_and_establish must block ${forbidden}`,
      );
    }
    assert(sql.includes("_capability_kind not in ('read','command')"));
    assert(sql.includes("_api_version !~ '^v[1-9][0-9]*$'"));
    // Grant lookup binds all four identity axes.
    assert(
      sql.includes("from public.api_capability_grants g") &&
        sql.includes("g.api_client_id = _client.id") &&
        sql.includes("g.organization_id = _organization_id") &&
        sql.includes("g.api_version = _api_version") &&
        sql.includes("g.capability_kind = _capability_kind") &&
        sql.includes("g.capability_key = _capability_key") &&
        sql.includes("g.lifecycle_status = 'enabled'"),
    );
    // Workspace request accepts either exact Workspace grant OR Org-level grant.
    assert(
      sql.includes("g.workspace_id = _workspace_id or g.workspace_id is null"),
    );
    // Organization-only request restricts to workspace_id IS NULL grants.
    assert(sql.includes("g.workspace_id is null"));
  },
);

Deno.test(
  "API-E.1 uses transaction-local set_config for trusted context",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    // Every set_config in the helper must be transaction-local (third arg true).
    // Flatten whitespace so multi-line calls collapse, then match balanced-outer calls.
    const flat = raw.replace(/\s+/g, " ");
    const setConfigCalls = flat.match(/set_config\((?:[^()]|\([^()]*\))*\)/gi) ?? [];
    assert(setConfigCalls.length >= 13, "expected at least 13 set_config calls");
    for (const call of setConfigCalls) {
      assert(
        /,\s*true\s*\)\s*$/i.test(call),
        `set_config must be transaction-local: ${call}`,
      );
    }

    // Required trusted-context keys.
    for (
      const key of [
        "api_e.trusted",
        "api_e.authenticated_user_id",
        "api_e.executing_user_id",
        "api_e.signed_oauth_client_id",
        "api_e.api_client_id",
        "api_e.policy_version_id",
        "api_e.tenant_id",
        "api_e.organization_id",
        "api_e.workspace_id",
        "api_e.api_version",
        "api_e.capability_kind",
        "api_e.capability_key",
        "api_e.source_channel",
        "api_e.request_id",
      ]
    ) {
      assert(sql.includes(key), `trusted context must include ${key}`);
    }
    assert(sql.includes("'external_api'"));
  },
);

Deno.test(
  "API-E.1 sets trusted=true only after all authorization checks",
  async () => {
    const { sql: raw } = await findMigration();
    // The successful establishment call that flips api_e.trusted to 'true'
    // must appear AFTER the capability-grant check. The deliberate reset
    // calls at the top of the function (api_e.trusted='false' plus empty
    // strings) are not establishment and are excluded from this ordering
    // check.
    const idxGrant = raw.indexOf("IF NOT _grant_ok");
    const trustTrueRe = /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i;
    const trustTrueMatch = raw.match(trustTrueRe);
    assert(idxGrant > 0);
    assert(trustTrueMatch, "expected api_e.trusted='true' establishment call");
    const idxTrustTrue = raw.indexOf(trustTrueMatch![0]);
    assert(
      idxGrant < idxTrustTrue,
      "api_e.trusted='true' must run only after the grant check",
    );
  },
);


Deno.test(
  "API-E.1 defines assert_trusted_context with fixed search_path",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    assert(
      sql.includes(
        "create or replace function api_e_private.assert_trusted_context()",
      ),
    );
    assert(
      /create or replace function api_e_private\.assert_trusted_context\(\)[\s\S]*?set search_path = pg_catalog/
        .test(sql),
    );
    assert(sql.includes("current_setting('api_e.trusted', true)"));
    // Must cross-check auth.uid() and the currently-signed client_id.
    assert(sql.includes("api_e_private.jwt_client_id()"));
    assert(sql.includes("_ctx_auth_user <> _uid::text"));
    assert(sql.includes("_ctx_auth_user <> _ctx_exec_user"));
    assert(sql.includes("_ctx_channel <> 'external_api'"));
  },
);

Deno.test(
  "API-E.1 revokes all privileges on helpers from PUBLIC/anon/authenticated",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    for (const fn of [
      "api_e_private.jwt_client_id()",
      "api_e_private.authorize_and_establish(",
      "api_e_private.assert_trusted_context()",
    ]) {
      for (const role of ["public", "anon", "authenticated"]) {
        assert(
          sql.includes(`revoke all on function ${fn}`) &&
            sql.includes(`from ${role}`),
          `expected revoke on ${fn} from ${role}`,
        );
      }
    }
  },
);

Deno.test(
  "API-E.1 introduces no table, seed, token/secret column, persistent context, dispatcher, or PMG/RLS modification",
  async () => {
    const { sql: raw } = await findMigration();
    const sql = normalize(raw);
    // No new tables (private context is transaction-local only).
    assert(!sql.includes("create table "), "no CREATE TABLE allowed");
    // No seed inserts.
    assert(!sql.includes("insert into "), "no seed INSERT allowed");
    // No token/secret storage.
    for (
      const forbidden of [
        "access_token",
        "refresh_token",
        "authorization_code",
        "client_secret",
        "token_hash",
        "id_token",
      ]
    ) {
      assert(!sql.includes(forbidden), `must not reference ${forbidden}`);
    }
    // No header-based or active-UI-Organization authority.
    assert(!sql.includes("request.headers"));
    assert(!sql.includes("get_my_active_context"));
    // No OAuth activation / custom access token hook.
    assert(!sql.includes("custom_access_token"));
    assert(!sql.includes("auth.hook"));
    // No generic RPC dispatcher.
    assert(!sql.includes("execute format"));
    assert(!sql.includes("dynamic sql"));
    // No modification to existing PMG/RLS.
    assert(!sql.includes("drop policy"));
    assert(!sql.includes("alter policy"));
    assert(!sql.includes("create policy"));
    assert(
      !sql.includes("disable row level security"),
      "must not disable RLS",
    );
    // No service_role distribution from the private schema.
    assert(
      !sql.includes("grant usage on schema api_e_private to service_role"),
    );
    assert(
      !sql.includes("grant execute on function api_e_private"),
      "no EXECUTE distribution in this step",
    );
  },
);

// =========================================================================
// API-E.C1 — Trusted context reset correction
//
// Dedicated locator + assertions proving that every authorization attempt
// transaction-locally clears any previously established trusted API
// context BEFORE any input validation or possible RETURN false, and that
// the successful establishment block still comes AFTER the
// capability-grant check with api_e.trusted='true' set last.
// =========================================================================

const C1_MARKERS = [
  "API-E.C1 — Trusted context reset correction",
  "api_e_private.authorize_and_establish",
];

const C1_RESET_KEYS_EMPTY = [
  "api_e.authenticated_user_id",
  "api_e.executing_user_id",
  "api_e.signed_oauth_client_id",
  "api_e.api_client_id",
  "api_e.policy_version_id",
  "api_e.tenant_id",
  "api_e.organization_id",
  "api_e.workspace_id",
  "api_e.api_version",
  "api_e.capability_kind",
  "api_e.capability_key",
  "api_e.source_channel",
  "api_e.request_id",
] as const;

async function findC1Migration(): Promise<{ path: string; sql: string }> {
  const dir = "supabase/migrations";
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = `${dir}/${entry.name}`;
    const sql = await Deno.readTextFile(path);
    if (C1_MARKERS.every((m) => sql.includes(m))) {
      return { path, sql };
    }
  }
  throw new Error("API-E.C1 correction migration not found in supabase/migrations");
}

function firstInputValidationIndex(sql: string): number {
  const re = /IF\s+_expected_oauth_client_id\s+IS\s+NULL/i;
  const m = sql.match(re);
  if (!m || m.index === undefined) {
    throw new Error("could not locate first input-validation branch");
  }
  return m.index;
}

function resetCallRegex(key: string, value: string): RegExp {
  return new RegExp(
    `set_config\\(\\s*'${key.replace(/\./g, "\\.")}'\\s*,\\s*'${value}'\\s*,\\s*true\\s*\\)`,
    "i",
  );
}

Deno.test("API-E.C1 correction migration exists and is discoverable", async () => {
  const { path } = await findC1Migration();
  assert(path.length > 0);
});

Deno.test("API-E.C1 reset block occurs before the first input-validation branch", async () => {
  const { sql } = await findC1Migration();
  const idxValidation = firstInputValidationIndex(sql);
  const resetTrustedFalse = sql.match(
    /set_config\(\s*'api_e\.trusted'\s*,\s*'false'\s*,\s*true\s*\)/i,
  );
  assert(resetTrustedFalse, "expected reset of api_e.trusted to 'false'");
  const idxReset = sql.indexOf(resetTrustedFalse![0]);
  assert(idxReset > 0);
  assert(
    idxReset < idxValidation,
    "reset of api_e.trusted='false' must precede the first input-validation branch",
  );
  for (const key of C1_RESET_KEYS_EMPTY) {
    const m = sql.match(resetCallRegex(key, ""));
    assert(m, `expected reset of ${key} to empty string`);
    const idxKey = sql.indexOf(m![0]);
    assert(
      idxKey < idxValidation,
      `reset of ${key} must precede the first input-validation branch`,
    );
  }
});

Deno.test("API-E.C1 resets api_e.trusted to 'false' transaction-locally", async () => {
  const { sql } = await findC1Migration();
  const m = sql.match(
    /set_config\(\s*'api_e\.trusted'\s*,\s*'false'\s*,\s*true\s*\)/i,
  );
  assert(m, "expected transaction-local reset of api_e.trusted to 'false'");
});

Deno.test("API-E.C1 resets all 13 non-trust keys to empty string transaction-locally", async () => {
  const { sql } = await findC1Migration();
  assert(C1_RESET_KEYS_EMPTY.length === 13);
  for (const key of C1_RESET_KEYS_EMPTY) {
    const m = sql.match(resetCallRegex(key, ""));
    assert(m, `expected transaction-local reset of ${key} to empty string`);
  }
});

Deno.test("API-E.C1 every reset uses transaction-local set_config(..., ..., true)", async () => {
  const { sql } = await findC1Migration();
  const idxValidation = firstInputValidationIndex(sql);
  const preamble = sql.slice(0, idxValidation);
  const flat = preamble.replace(/\s+/g, " ");
  const calls = flat.match(/set_config\((?:[^()]|\([^()]*\))*\)/gi) ?? [];
  assert(calls.length >= 14, "expected at least 14 reset set_config calls before validation");
  for (const call of calls) {
    assert(
      /,\s*true\s*\)\s*$/i.test(call),
      `reset set_config must be transaction-local: ${call}`,
    );
  }
});

Deno.test("API-E.C1 successful establishment block remains after capability-grant check", async () => {
  const { sql } = await findC1Migration();
  const idxGrant = sql.indexOf("IF NOT _grant_ok");
  const trustTrue = sql.match(
    /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i,
  );
  assert(idxGrant > 0);
  assert(trustTrue, "expected api_e.trusted='true' establishment call");
  const idxTrustTrue = sql.indexOf(trustTrue![0]);
  assert(
    idxGrant < idxTrustTrue,
    "api_e.trusted='true' must run only after the grant check",
  );
});

Deno.test("API-E.C1 populates all 13 non-trust values before enabling trust", async () => {
  const { sql } = await findC1Migration();
  const trustTrue = sql.match(
    /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i,
  );
  assert(trustTrue);
  const idxTrustTrue = sql.indexOf(trustTrue![0]);

  // Establishment populations use identifier-based values (not empty strings
  // and not the literal 'false'). Anchor each key's establishment call by
  // finding the LAST occurrence of that key in a set_config that is not a
  // reset (value is not '' and not 'false').
  const nonTrustPatterns: Array<{ key: string; anchor: RegExp }> = [
    { key: "api_e.authenticated_user_id", anchor: /_uid::text/i },
    { key: "api_e.executing_user_id", anchor: /_uid::text/i },
    { key: "api_e.signed_oauth_client_id", anchor: /_signed_client_id/i },
    { key: "api_e.api_client_id", anchor: /_client\.id::text/i },
    { key: "api_e.policy_version_id", anchor: /_policy\.id::text/i },
    { key: "api_e.tenant_id", anchor: /_tenant_id::text/i },
    { key: "api_e.organization_id", anchor: /_organization_id::text/i },
    { key: "api_e.workspace_id", anchor: /COALESCE\(\s*_workspace_id::text/i },
    { key: "api_e.api_version", anchor: /_api_version\s*,\s*true/i },
    { key: "api_e.capability_kind", anchor: /_capability_kind\s*,\s*true/i },
    { key: "api_e.capability_key", anchor: /_capability_key\s*,\s*true/i },
    { key: "api_e.source_channel", anchor: /'external_api'/ },
    { key: "api_e.request_id", anchor: /_request_id\s*,\s*true/i },
  ];
  assert(nonTrustPatterns.length === 13);
  for (const { key, anchor } of nonTrustPatterns) {
    const callRe = new RegExp(
      `set_config\\(\\s*'${key.replace(/\./g, "\\.")}'\\s*,[\\s\\S]*?,\\s*true\\s*\\)`,
      "gi",
    );
    const calls = sql.match(callRe) ?? [];
    const establishment = calls.find((c) => anchor.test(c));
    assert(establishment, `expected establishment call for ${key}`);
    const idxEst = sql.indexOf(establishment!);
    assert(
      idxEst > 0 && idxEst < idxTrustTrue,
      `${key} must be populated before api_e.trusted='true'`,
    );
  }
});

Deno.test("API-E.C1 api_e.trusted='true' is the final set_config before RETURN true", async () => {
  const { sql } = await findC1Migration();
  const trustTrueRe = /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i;
  const m = sql.match(trustTrueRe);
  assert(m);
  const idxTrustTrue = sql.indexOf(m![0]);
  const idxReturnTrue = sql.indexOf("RETURN true", idxTrustTrue);
  assert(idxReturnTrue > idxTrustTrue, "RETURN true must follow api_e.trusted='true'");
  // No further set_config between the trust flip and RETURN true.
  const tail = sql.slice(idxTrustTrue + m![0].length, idxReturnTrue);
  assert(
    !/set_config\s*\(/i.test(tail),
    "no set_config may appear between api_e.trusted='true' and RETURN true",
  );
});

Deno.test("API-E.C1 correction migration introduces no table/schema/policy/trigger/RPC/OAuth surface", async () => {
  const { sql: raw } = await findC1Migration();
  const sql = raw.toLowerCase();
  assert(!/\bcreate\s+table\b/.test(sql), "no CREATE TABLE allowed");
  assert(!/\bcreate\s+schema\b/.test(sql), "no CREATE SCHEMA allowed");
  assert(!/\bcreate\s+policy\b/.test(sql), "no CREATE POLICY allowed");
  assert(!/\balter\s+policy\b/.test(sql), "no ALTER POLICY allowed");
  assert(!/\bdrop\s+policy\b/.test(sql), "no DROP POLICY allowed");
  assert(!/\bcreate\s+trigger\b/.test(sql), "no CREATE TRIGGER allowed");
  assert(!/\binsert\s+into\b/.test(sql), "no persistent context storage / seed allowed");
  assert(!/\bgrant\s+execute\s+on\s+function\s+api_e_private/.test(sql),
    "no browser-callable RPC exposure");
  for (
    const forbidden of [
      "access_token",
      "refresh_token",
      "authorization_code",
      "client_secret",
      "token_hash",
      "id_token",
      "custom_access_token",
      "auth.hook",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not reference ${forbidden}`);
  }
});

// =========================================================================
// API-E.C1.1 — Exception-safe trusted context reset
//
// Dedicated locator + assertions proving that:
//   * _uid is declared without := auth.uid();
//   * the entry reset (api_e.trusted='false' + 13 empty keys) still runs
//     before _uid := auth.uid();
//   * exactly one top-level EXCEPTION WHEN OTHERS THEN handler exists;
//   * the handler transaction-locally resets api_e.trusted='false' and
//     empties all 13 remaining keys, RETURN false, no RAISE;
//   * the normal successful establishment path remains before the handler,
//     populates all 13 non-trust values, then flips api_e.trusted='true'
//     as the final set_config before RETURN true;
//   * the migration repeats the three privilege revocations;
//   * the migration introduces no new tables/schemas/policies/triggers/
//     persistent context/grants/RPCs/OAuth/Edge/frontend surfaces.
// =========================================================================

const C11_MARKERS = [
  "API-E.C1.1 — Exception-safe trusted context reset",
  "api_e_private.authorize_and_establish",
];

const C11_RESET_KEYS_EMPTY = C1_RESET_KEYS_EMPTY;

async function findC11Migration(): Promise<{ path: string; sql: string }> {
  const dir = "supabase/migrations";
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = `${dir}/${entry.name}`;
    const sql = await Deno.readTextFile(path);
    if (C11_MARKERS.every((m) => sql.includes(m))) {
      return { path, sql };
    }
  }
  throw new Error(
    "API-E.C1.1 correction migration not found in supabase/migrations",
  );
}

function functionBody(sql: string): string {
  // Extract the body of the CREATE OR REPLACE FUNCTION
  // api_e_private.authorize_and_establish(...) block (between $$ ... $$).
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+api_e_private\.authorize_and_establish[\s\S]*?AS\s+\$\$([\s\S]*?)\$\$\s*;/i;
  const m = sql.match(re);
  if (!m) throw new Error("could not extract function body");
  return m[1];
}

Deno.test("API-E.C1.1 correction migration exists and is discoverable", async () => {
  const { path } = await findC11Migration();
  assert(path.length > 0);
});

Deno.test("API-E.C1.1 keeps exact signature and security properties", async () => {
  const { sql } = await findC11Migration();
  const n = normalize(sql);
  assert(
    sql.includes("_expected_oauth_client_id text") &&
      sql.includes("_organization_id uuid") &&
      sql.includes("_workspace_id uuid") &&
      sql.includes("_api_version text") &&
      sql.includes("_capability_kind text") &&
      sql.includes("_capability_key text") &&
      sql.includes("_request_id text"),
  );
  assert(n.includes("returns boolean"));
  assert(n.includes("language plpgsql"));
  assert(n.includes("volatile"));
  assert(n.includes("security definer"));
  assert(
    /create or replace function api_e_private\.authorize_and_establish[\s\S]*?set search_path = public, pg_catalog/
      .test(n),
  );
});

Deno.test("API-E.C1.1 declares _uid without := auth.uid()", async () => {
  const { sql } = await findC11Migration();
  const body = functionBody(sql);
  // Declaration must be `_uid uuid;` (no initializer).
  assert(
    /(^|\n)\s*_uid\s+uuid\s*;/i.test(body),
    "expected `_uid uuid;` declaration without initializer",
  );
  // No `_uid uuid := auth.uid()` anywhere in the body.
  assert(
    !/_uid\s+uuid\s*:=\s*auth\.uid\(\)/i.test(body),
    "must not initialize _uid with auth.uid() at declaration time",
  );
});

Deno.test(
  "API-E.C1.1 evaluates _uid := auth.uid() after the entry reset and before active-user checks",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);

    const resetTrustedFalse = body.match(
      /set_config\(\s*'api_e\.trusted'\s*,\s*'false'\s*,\s*true\s*\)/i,
    );
    assert(resetTrustedFalse, "expected reset of api_e.trusted='false'");
    const idxResetTrust = body.indexOf(resetTrustedFalse![0]);

    // Find the LAST entry-reset empty-string set_config (highest index of the
    // 13 empty resets), so we can prove _uid := auth.uid() comes after ALL of
    // the entry-reset calls (not merely after the trust flip).
    let idxLastReset = idxResetTrust;
    for (const key of C11_RESET_KEYS_EMPTY) {
      const m = body.match(resetCallRegex(key, ""));
      assert(m, `expected reset of ${key} to empty string`);
      const idx = body.indexOf(m![0]);
      if (idx > idxLastReset) idxLastReset = idx;
    }

    const uidAssignRe = /_uid\s*:=\s*auth\.uid\(\)\s*;/i;
    const uidAssign = body.match(uidAssignRe);
    assert(uidAssign, "expected `_uid := auth.uid();` assignment");
    const idxUidAssign = body.indexOf(uidAssign![0]);
    assert(
      idxUidAssign > idxLastReset,
      "_uid := auth.uid() must run after the complete entry reset block",
    );

    const idxUidNullCheck = body.search(/IF\s+_uid\s+IS\s+NULL\s+THEN/i);
    assert(idxUidNullCheck > 0, "expected `IF _uid IS NULL THEN` check");
    assert(
      idxUidAssign < idxUidNullCheck,
      "_uid := auth.uid() must run before the active-user checks",
    );
  },
);

Deno.test(
  "API-E.C1.1 entry reset still clears api_e.trusted and all 13 keys transaction-locally",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    // Ordering: entry reset happens before _uid := auth.uid().
    const uidAssign = body.match(/_uid\s*:=\s*auth\.uid\(\)\s*;/i);
    assert(uidAssign);
    const idxUidAssign = body.indexOf(uidAssign![0]);
    const preamble = body.slice(0, idxUidAssign);

    const trustFalse = preamble.match(
      /set_config\(\s*'api_e\.trusted'\s*,\s*'false'\s*,\s*true\s*\)/i,
    );
    assert(trustFalse, "entry reset must set api_e.trusted='false'");

    for (const key of C11_RESET_KEYS_EMPTY) {
      assert(
        resetCallRegex(key, "").test(preamble),
        `entry reset must clear ${key} to empty string transaction-locally`,
      );
    }

    const flat = preamble.replace(/\s+/g, " ");
    const calls = flat.match(/set_config\((?:[^()]|\([^()]*\))*\)/gi) ?? [];
    assert(
      calls.length >= 14,
      "expected at least 14 entry-reset set_config calls before _uid := auth.uid()",
    );
    for (const call of calls) {
      assert(
        /,\s*true\s*\)\s*$/i.test(call),
        `entry reset set_config must be transaction-local: ${call}`,
      );
    }
  },
);

Deno.test(
  "API-E.C1.1 contains exactly one top-level EXCEPTION WHEN OTHERS THEN handler",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    const matches = body.match(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/gi) ?? [];
    assert(
      matches.length === 1,
      `expected exactly 1 EXCEPTION WHEN OTHERS THEN handler, found ${matches.length}`,
    );
  },
);

function exceptionHandlerBlock(body: string): string {
  const re = /EXCEPTION\s+WHEN\s+OTHERS\s+THEN([\s\S]*?)END\s*;?\s*$/i;
  const m = body.match(re);
  assert(m, "could not extract EXCEPTION handler block");
  return m![1];
}

Deno.test(
  "API-E.C1.1 EXCEPTION handler sets api_e.trusted='false' and clears all 13 keys transaction-locally",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    const handler = exceptionHandlerBlock(body);
    const trustFalse = handler.match(
      /set_config\(\s*'api_e\.trusted'\s*,\s*'false'\s*,\s*true\s*\)/i,
    );
    assert(trustFalse, "handler must set api_e.trusted='false' transaction-locally");
    for (const key of C11_RESET_KEYS_EMPTY) {
      assert(
        resetCallRegex(key, "").test(handler),
        `handler must clear ${key} to empty string transaction-locally`,
      );
    }
    const flat = handler.replace(/\s+/g, " ");
    const calls = flat.match(/set_config\((?:[^()]|\([^()]*\))*\)/gi) ?? [];
    assert(
      calls.length >= 14,
      "expected at least 14 handler set_config calls",
    );
    for (const call of calls) {
      assert(
        /,\s*true\s*\)\s*$/i.test(call),
        `handler set_config must be transaction-local: ${call}`,
      );
    }
  },
);

Deno.test(
  "API-E.C1.1 EXCEPTION handler returns false and does not re-raise",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    const handler = exceptionHandlerBlock(body);
    assert(/RETURN\s+false\s*;/i.test(handler), "handler must RETURN false");
    // Strip SQL comments before scanning for executable RAISE statements so
    // documentation prose (e.g. "Do NOT re-raise") is not misread as code.
    const stripped = handler
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert(
      !/\bRAISE\b/i.test(stripped),
      "handler must not contain any RAISE statement",
    );
  },
);


Deno.test(
  "API-E.C1.1 normal successful path remains before the EXCEPTION handler",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    const idxException = body.search(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    assert(idxException > 0);
    const trustTrue = body.match(
      /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i,
    );
    assert(trustTrue, "expected successful api_e.trusted='true' establishment");
    const idxTrustTrue = body.indexOf(trustTrue![0]);
    assert(
      idxTrustTrue > 0 && idxTrustTrue < idxException,
      "api_e.trusted='true' must appear before the EXCEPTION handler",
    );
    const idxReturnTrue = body.indexOf("RETURN true", idxTrustTrue);
    assert(
      idxReturnTrue > idxTrustTrue && idxReturnTrue < idxException,
      "RETURN true must appear before the EXCEPTION handler",
    );
  },
);

Deno.test(
  "API-E.C1.1 normal path populates all 13 non-trust values before enabling trust",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    // Restrict analysis to the normal-path region (before EXCEPTION handler).
    const idxException = body.search(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    const normal = body.slice(0, idxException);
    const trustTrue = normal.match(
      /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i,
    );
    assert(trustTrue);
    const idxTrustTrue = normal.indexOf(trustTrue![0]);

    const nonTrustPatterns: Array<{ key: string; anchor: RegExp }> = [
      { key: "api_e.authenticated_user_id", anchor: /_uid::text/i },
      { key: "api_e.executing_user_id", anchor: /_uid::text/i },
      { key: "api_e.signed_oauth_client_id", anchor: /_signed_client_id/i },
      { key: "api_e.api_client_id", anchor: /_client\.id::text/i },
      { key: "api_e.policy_version_id", anchor: /_policy\.id::text/i },
      { key: "api_e.tenant_id", anchor: /_tenant_id::text/i },
      { key: "api_e.organization_id", anchor: /_organization_id::text/i },
      { key: "api_e.workspace_id", anchor: /COALESCE\(\s*_workspace_id::text/i },
      { key: "api_e.api_version", anchor: /_api_version\s*,\s*true/i },
      { key: "api_e.capability_kind", anchor: /_capability_kind\s*,\s*true/i },
      { key: "api_e.capability_key", anchor: /_capability_key\s*,\s*true/i },
      { key: "api_e.source_channel", anchor: /'external_api'/ },
      { key: "api_e.request_id", anchor: /_request_id\s*,\s*true/i },
    ];
    assert(nonTrustPatterns.length === 13);
    for (const { key, anchor } of nonTrustPatterns) {
      const callRe = new RegExp(
        `set_config\\(\\s*'${key.replace(/\./g, "\\.")}'\\s*,[\\s\\S]*?,\\s*true\\s*\\)`,
        "gi",
      );
      const calls = normal.match(callRe) ?? [];
      const establishment = calls.find((c) => anchor.test(c));
      assert(establishment, `expected establishment call for ${key}`);
      const idxEst = normal.indexOf(establishment!);
      assert(
        idxEst > 0 && idxEst < idxTrustTrue,
        `${key} must be populated before api_e.trusted='true'`,
      );
    }
  },
);

Deno.test(
  "API-E.C1.1 api_e.trusted='true' remains the final successful set_config before RETURN true",
  async () => {
    const { sql } = await findC11Migration();
    const body = functionBody(sql);
    const idxException = body.search(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    const normal = body.slice(0, idxException);
    const trustTrueRe =
      /set_config\(\s*'api_e\.trusted'\s*,\s*'true'\s*,\s*true\s*\)/i;
    const m = normal.match(trustTrueRe);
    assert(m);
    const idxTrustTrue = normal.indexOf(m![0]);
    const idxReturnTrue = normal.indexOf("RETURN true", idxTrustTrue);
    assert(idxReturnTrue > idxTrustTrue);
    const tail = normal.slice(idxTrustTrue + m![0].length, idxReturnTrue);
    assert(
      !/set_config\s*\(/i.test(tail),
      "no set_config may appear between successful api_e.trusted='true' and RETURN true",
    );
  },
);

Deno.test(
  "API-E.C1.1 migration repeats REVOKE ALL from PUBLIC/anon/authenticated on exact signature",
  async () => {
    const { sql } = await findC11Migration();
    const n = normalize(sql);
    const sig =
      "api_e_private.authorize_and_establish( text, uuid, uuid, text, text, text, text )";
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        n.includes(`revoke all on function ${sig} from ${role}`),
        `expected REVOKE ALL from ${role} on exact signature`,
      );
    }
  },
);

Deno.test(
  "API-E.C1.1 migration introduces no table/schema/policy/trigger/persistent context/grant/RPC/OAuth/Edge/frontend surface",
  async () => {
    const { sql: raw } = await findC11Migration();
    const sql = raw.toLowerCase();
    assert(!/\bcreate\s+table\b/.test(sql), "no CREATE TABLE allowed");
    assert(!/\bcreate\s+schema\b/.test(sql), "no CREATE SCHEMA allowed");
    assert(!/\bcreate\s+policy\b/.test(sql), "no CREATE POLICY allowed");
    assert(!/\balter\s+policy\b/.test(sql), "no ALTER POLICY allowed");
    assert(!/\bdrop\s+policy\b/.test(sql), "no DROP POLICY allowed");
    assert(!/\bcreate\s+trigger\b/.test(sql), "no CREATE TRIGGER allowed");
    assert(!/\binsert\s+into\b/.test(sql), "no persistent context / seed allowed");
    assert(
      !/\bgrant\s+execute\s+on\s+function\s+api_e_private/.test(sql),
      "no browser-callable RPC exposure",
    );
    assert(
      !/\bgrant\s+usage\s+on\s+schema\s+api_e_private/.test(sql),
      "no schema grant expansion",
    );
    for (
      const forbidden of [
        "access_token",
        "refresh_token",
        "authorization_code",
        "client_secret",
        "token_hash",
        "id_token",
        "custom_access_token",
        "auth.hook",
      ]
    ) {
      assert(!sql.includes(forbidden), `must not reference ${forbidden}`);
    }
  },
);

