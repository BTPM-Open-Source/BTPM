// PBI 5.1B1C — Remove Emergency-Shutdown Precondition Blockers.
//
// Static, filesystem-only assertions against the latest lifecycle migration
// that defines public.service_manage_powerbi_reporting_identity and the
// Edge Function proxy. No live database access.

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO = new URL("../../../", import.meta.url);

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, REPO));
}

async function readLatestLifecycleMigration(): Promise<string> {
  const dir = new URL("supabase/migrations/", REPO);
  let picked = "";
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(new URL(entry.name, dir));
    if (
      sql.includes("service_manage_powerbi_reporting_identity") &&
      sql.includes("CREATE OR REPLACE FUNCTION")
    ) {
      if (entry.name > picked) picked = entry.name;
    }
  }
  assert(picked, "lifecycle migration not found");
  return await Deno.readTextFile(new URL(picked, dir));
}

function branchBlock(sql: string, header: string): string {
  const s = sql.indexOf(header);
  assert(s >= 0, `missing header: ${header}`);
  const nextHeaders = [
    "-- PROVISION",
    "-- ROTATE",
    "-- ENABLE",
    "-- ACTIVATE",
    "-- DISABLE",
    "-- REVOKE",
    "RAISE EXCEPTION 'unhandled_action'",
  ];
  let e = sql.length;
  for (const h of nextHeaders) {
    const idx = sql.indexOf(h, s + header.length);
    if (idx > s && idx < e) e = idx;
  }
  return sql.slice(s, e);
}

function preambleBefore(sql: string, marker: string): string {
  const idx = sql.indexOf(marker);
  assert(idx > 0, `missing marker: ${marker}`);
  return sql.slice(0, idx);
}

Deno.test("5.1B1C — tenant_not_active gate applies only to provision/rotate/enable/activate", async () => {
  const sql = await readLatestLifecycleMigration();
  // The rejection must live inside the per-action gate for normal actions.
  assertStringIncludes(
    sql,
    "IF _act IN ('provision','rotate','enable','activate') THEN",
  );
  // There must be exactly one tenant_not_active RAISE and it must sit inside
  // that gate — never at the top of the function.
  const matches = sql.match(/RAISE EXCEPTION 'tenant_not_active'/g) ?? [];
  assertEquals(matches.length, 1, "tenant_not_active must be raised exactly once");
  // Confirm it is not in the disable or revoke branches.
  for (const marker of ["-- DISABLE", "-- REVOKE"]) {
    const block = branchBlock(sql, marker);
    assert(
      !block.includes("tenant_not_active"),
      `${marker} branch must not raise tenant_not_active`,
    );
  }
});

Deno.test("5.1B1C — reader_role_missing gate applies only to provision/rotate/enable/activate", async () => {
  const sql = await readLatestLifecycleMigration();
  const matches = sql.match(/RAISE EXCEPTION 'reader_role_missing'/g) ?? [];
  assertEquals(matches.length, 1, "reader_role_missing must be raised exactly once");
  for (const marker of ["-- DISABLE", "-- REVOKE"]) {
    const block = branchBlock(sql, marker);
    assert(
      !block.includes("reader_role_missing"),
      `${marker} branch must not raise reader_role_missing`,
    );
  }
  // The gate is inside the normal-action IF block — verify by proximity.
  const gateIdx = sql.indexOf("IF _act IN ('provision','rotate','enable','activate') THEN");
  const readerIdx = sql.indexOf("RAISE EXCEPTION 'reader_role_missing'");
  const provisionIdx = sql.indexOf("-- PROVISION");
  assert(
    readerIdx > gateIdx && readerIdx < provisionIdx,
    "reader_role_missing must sit inside the normal-action gate (before PROVISION)",
  );
});

Deno.test("5.1B1C — no global (pre-action) tenant-active or reader-role rejection", async () => {
  const sql = await readLatestLifecycleMigration();
  // Everything before the first PROVISION section must not reject on either
  // condition unconditionally.
  const pre = preambleBefore(sql, "-- PROVISION");
  // Must NOT contain the classic global patterns from earlier revisions.
  assert(
    !/IF _tenant\.status <> 'active' THEN\s+RAISE EXCEPTION 'tenant_not_active'/s.test(
      pre.replace(
        /IF _act IN \('provision','rotate','enable','activate'\) THEN[\s\S]*?END IF;/,
        "",
      ),
    ),
    "no global tenant-status rejection allowed",
  );
  assert(
    !/IF NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_roles WHERE rolname = 'btpm_pbi_reader'\)\s*THEN\s*RAISE EXCEPTION 'reader_role_missing'/s
      .test(
        pre.replace(
          /IF _act IN \('provision','rotate','enable','activate'\) THEN[\s\S]*?END IF;/,
          "",
        ),
      ),
    "no global reader-role rejection allowed",
  );
});

Deno.test("5.1B1C — security_drift_detected includes missing shared reader", async () => {
  const sql = await readLatestLifecycleMigration();
  const pre = preambleBefore(sql, "-- PROVISION");
  assertStringIncludes(pre, "_security_drift :=");
  // Drift must consider missing Tenant role, missing reader, or invariant deviation.
  assertStringIncludes(pre, "_map.login_role_name IS NOT NULL AND NOT _role_exists");
  assertStringIncludes(pre, "NOT _reader_exists");
  assertStringIncludes(pre, "_attrs_ok AND _membership_ok AND _ownership_ok AND _session_defaults_ok");
});

Deno.test("5.1B1C — reader existence probed as boolean, not raise", async () => {
  const sql = await readLatestLifecycleMigration();
  assertStringIncludes(
    sql,
    "_reader_exists := EXISTS (",
  );
  assertStringIncludes(sql, "rolname = 'btpm_pbi_reader'");
});

Deno.test("5.1B1C — disable/revoke are NOT behind the strict full-invariant gate", async () => {
  const sql = await readLatestLifecycleMigration();
  assertStringIncludes(
    sql,
    "IF _act IN ('rotate','enable','activate') THEN",
  );
  for (const marker of ["-- DISABLE", "-- REVOKE"]) {
    const block = branchBlock(sql, marker);
    for (const forbidden of [
      "RAISE EXCEPTION 'role_attributes_invalid'",
      "RAISE EXCEPTION 'membership_invalid'",
      "RAISE EXCEPTION 'session_defaults_invalid'",
      "RAISE EXCEPTION 'role_owns_schemas'",
    ]) {
      assert(
        !block.includes(forbidden),
        `${marker} branch must not contain: ${forbidden}`,
      );
    }
  }
});

Deno.test("5.1B1C — disable executes NOLOGIN and terminates only derived-role sessions", async () => {
  const sql = await readLatestLifecycleMigration();
  const block = branchBlock(sql, "-- DISABLE");
  assertStringIncludes(block, "ALTER ROLE %I NOLOGIN");
  assertStringIncludes(block, "pg_catalog.pg_terminate_backend(s.pid)");
  assertStringIncludes(block, "s.usename = _role");
  assertStringIncludes(block, "s.pid <> pg_backend_pid()");
  assertStringIncludes(block, "postflight_disable_failed");
  assert(!/CREATE ROLE/i.test(block), "disable must not create the role");
});

Deno.test("5.1B1C — revoke executes NOLOGIN PASSWORD NULL and revokes direct memberships", async () => {
  const sql = await readLatestLifecycleMigration();
  const block = branchBlock(sql, "-- REVOKE");
  assertStringIncludes(block, "ALTER ROLE %I NOLOGIN PASSWORD NULL");
  assertStringIncludes(block, "pg_catalog.pg_terminate_backend(s.pid)");
  assertStringIncludes(block, "FOR _grantor IN");
  assertStringIncludes(block, "REVOKE %I FROM %I");
  assertStringIncludes(block, "postflight_revoke_failed");
});

Deno.test("5.1B1C — disable/revoke handle missing Tenant role via IF _role_exists guard", async () => {
  const sql = await readLatestLifecycleMigration();
  for (const marker of ["-- DISABLE", "-- REVOKE"]) {
    const block = branchBlock(sql, marker);
    assertStringIncludes(block, "IF _role_exists THEN");
    assertStringIncludes(block, "_terminated := 0");
    assertStringIncludes(block, "UPDATE pbi_reporting_security.tenant_login_map");
  }
});

Deno.test("5.1B1C — disable/revoke emit only safe audit context keys", async () => {
  const sql = await readLatestLifecycleMigration();
  for (const marker of ["-- DISABLE", "-- REVOKE"]) {
    const block = branchBlock(sql, marker);
    assertStringIncludes(block, "'security_drift_detected', _security_drift");
    assertStringIncludes(block, "'terminated_session_count', _terminated");
    for (const forbidden of [
      "'pid'", "'client_addr'", "'query'", "'application_name'",
      "'password'", "'connection_string'", "'memberships'", "'role_settings'",
    ]) {
      assert(!block.includes(forbidden), `${marker} leaks forbidden key ${forbidden}`);
    }
  }
});

Deno.test("5.1B1C — every action still has postflight assertions", async () => {
  const sql = await readLatestLifecycleMigration();
  for (const marker of [
    "postflight_provision_failed",
    "postflight_rotate_failed",
    "postflight_disable_failed",
    "postflight_enable_failed",
    "postflight_activate_failed",
    "postflight_revoke_failed",
  ]) {
    assertStringIncludes(sql, marker);
  }
});

Deno.test("5.1B1C — rotate/enable/activate postflights still re-verify all invariants", async () => {
  const sql = await readLatestLifecycleMigration();
  for (const marker of ["-- ROTATE", "-- ENABLE", "-- ACTIVATE"]) {
    const block = branchBlock(sql, marker);
    assertStringIncludes(block, "SELECT r.oid, r.rolcanlogin, r.rolconnlimit");
    assertStringIncludes(block, "ARRAY['btpm_pbi_reader']::text[]");
    assertStringIncludes(block, "nspowner=_role_oid");
    assertStringIncludes(block, "relowner=_role_oid");
    assertStringIncludes(block, "search_path=pbi_reporting, pbi_reporting_security, pg_catalog");
  }
});

Deno.test("5.1B1C — provision postflight validates attributes, membership, ownership, session defaults, and mapping", async () => {
  const sql = await readLatestLifecycleMigration();
  const block = branchBlock(sql, "-- PROVISION");
  assertStringIncludes(block, "postflight_provision_failed");
  assertStringIncludes(block, "ARRAY['btpm_pbi_reader']::text[]");
  assert(/pg_catalog\.pg_namespace\s+WHERE\s+nspowner\s*=\s*_role_oid/.test(block));
  assert(/pg_catalog\.pg_class\s+WHERE\s+relowner\s*=\s*_role_oid/.test(block));
  assertStringIncludes(block, "search_path=pbi_reporting, pbi_reporting_security, pg_catalog");
});

Deno.test("5.1B1C — revoke postflight requires zero direct memberships when role exists", async () => {
  const sql = await readLatestLifecycleMigration();
  const block = branchBlock(sql, "-- REVOKE");
  assertStringIncludes(block, "FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles pr ON pr.oid=m.roleid");
  assertStringIncludes(block, "array_length(_pf_memberships,1) IS NOT NULL");
});

Deno.test("5.1B1C — derives role internally & enforces regex", async () => {
  const sql = await readLatestLifecycleMigration();
  assertStringIncludes(sql, "'btpm_pbi_t_' || replace(_tenant_id::text, '-', '')");
  assertStringIncludes(sql, "^btpm_pbi_t_[a-f0-9]{32}$");
});

Deno.test("5.1B1C — password generation stays schema-qualified", async () => {
  const sql = await readLatestLifecycleMigration();
  assertStringIncludes(sql, "encode(extensions.gen_random_bytes(32), 'hex')");
  const fnStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.service_manage_powerbi_reporting_identity",
  );
  const fnEnd = sql.indexOf("$function$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  assert(
    !/[^.]gen_random_bytes\s*\(/.test(
      body.replace(/extensions\.gen_random_bytes/g, "extensions.OK"),
    ),
    "unqualified gen_random_bytes must not appear in lifecycle function",
  );
});

Deno.test("5.1B1C — function search_path locked to pg_catalog only", async () => {
  const sql = await readLatestLifecycleMigration();
  const fnStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.service_manage_powerbi_reporting_identity",
  );
  const header = sql.slice(fnStart, sql.indexOf("AS $function$", fnStart));
  assertStringIncludes(header, "SET search_path TO 'pg_catalog'");
});

Deno.test("5.1B1C — exactly six actions accepted", async () => {
  const sql = await readLatestLifecycleMigration();
  assertStringIncludes(
    sql,
    "_act NOT IN ('provision','rotate','disable','enable','activate','revoke')",
  );
});

Deno.test("5.1B1C — activate performs no password mutation", async () => {
  const sql = await readLatestLifecycleMigration();
  const block = branchBlock(sql, "-- ACTIVATE");
  assert(!/gen_random_bytes/.test(block));
  assert(!/ALTER ROLE.*PASSWORD/i.test(block));
  assertStringIncludes(block, "'tenant_admin_confirmed_power_bi_test'");
});

Deno.test("5.1B1C — password never inserted into map/audit", async () => {
  const sql = await readLatestLifecycleMigration();
  const pwLines = sql.split("\n").filter((l) => l.includes("_pw"));
  for (const line of pwLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue;
    if (trimmed.startsWith("_pw :=") || trimmed.startsWith("_pw text;")) continue;
    if (trimmed.includes("format(")) continue;
    if (trimmed.includes("'one_time_password'")) continue;
    assert(
      !/INSERT INTO .*tenant_login_(map|audit)/i.test(line) &&
        !/UPDATE .*tenant_login_(map|audit)/i.test(line),
      `password token appeared in map/audit DML: ${line}`,
    );
  }
});

Deno.test("5.1B1C — audit/metadata contains no password-like keys", async () => {
  const sql = await readLatestLifecycleMigration();
  for (const key of ["'password'", "'pwd'", "'secret'", "'token'", "'connection_string'", "'dsn'"]) {
    assert(
      !new RegExp(`jsonb_build_object\\([^)]*${key}`).test(sql),
      `audit/metadata contains forbidden key ${key}`,
    );
  }
});

Deno.test("5.1B1C — lifecycle ACL: service_role only", async () => {
  const sql = await readLatestLifecycleMigration();
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assertStringIncludes(
      sql,
      `REVOKE ALL ON FUNCTION public.service_manage_powerbi_reporting_identity(uuid, text, uuid) FROM ${role}`,
    );
  }
  assertStringIncludes(
    sql,
    "GRANT EXECUTE ON FUNCTION public.service_manage_powerbi_reporting_identity(uuid, text, uuid) TO service_role",
  );
});

Deno.test("5.1B1C — Edge Function contract unchanged (six actions + forbidden keys)", async () => {
  const src = await read("supabase/functions/powerbi-reporting-credential-lifecycle/index.ts");
  for (const a of ["provision", "rotate", "disable", "enable", "activate", "revoke"]) {
    assertStringIncludes(src, `"${a}"`);
  }
  assertStringIncludes(src, "FORBIDDEN_BODY_KEYS");
  assertStringIncludes(src, '"forbidden_field"');
});

Deno.test("5.1B1C — migration performs no lifecycle invocation and no data DML on live tables", async () => {
  const sql = await readLatestLifecycleMigration();
  assert(
    !/\bSELECT\s+service_manage_powerbi_reporting_identity\s*\(/i.test(sql),
    "migration must not invoke the lifecycle function",
  );
  assert(
    !/INSERT\s+INTO\s+pbi_reporting_security\.tenant_login_(map|audit)/i.test(
      sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*\$function\$;/, ""),
    ),
    "migration must not perform DML on map/audit outside the function body",
  );
  assert(
    !/UPDATE\s+pbi_reporting_security\.tenant_login_(map|audit)/i.test(
      sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*\$function\$;/, ""),
    ),
    "migration must not update map/audit outside the function body",
  );
});

Deno.test("5.1B1C — derived role name regex is well-formed", () => {
  const re = /^btpm_pbi_t_[a-f0-9]{32}$/;
  const tid = "6714f629-1234-4abc-89ef-0123456789ab";
  const derived = "btpm_pbi_t_" + tid.replace(/-/g, "");
  assertMatch(derived, re);
  assertEquals(derived.length, "btpm_pbi_t_".length + 32);
});
