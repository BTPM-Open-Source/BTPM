// API-Q Phase Create Step 1 — static contract guard for the trusted MCP
// database bridge.
//
// Repository/static test only: it locates the committed migration by its
// unique marker (never by a hardcoded timestamped filename), takes the latest
// one as the effective definition, and verifies the executable SQL.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Phase Create Step 1 — Trusted MCP Database Bridge";

/** Remove SQL line/block comments (executable SQL only). */
function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

async function loadMigration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(found.length >= 1, "expected at least one Phase Create bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("Phase Create bridge: exactly three functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(created, [
    "public.apply_phase_create",
    "api_e_private.execute_v1_create_phase",
    "public.api_v1_create_phase",
    "public.mcp_v1_create_phase",
  ].filter((f) => created.includes(f)));
  assertEquals(new Set(created), new Set([
    "public.apply_phase_create",
    "api_e_private.execute_v1_create_phase",
    "public.api_v1_create_phase",
    "public.mcp_v1_create_phase",
  ]));
});

Deno.test("Phase Create bridge: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_phase_create\(_project_id uuid, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT 'planned'::pm_status, _phase_type phase_type DEFAULT 'work_item'::phase_type, _start_date date DEFAULT NULL::date, _target_end_date date DEFAULT NULL::date, _sort_order integer DEFAULT NULL::integer, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_phase_create signature must be unchanged",
  );
});

Deno.test("Phase Create bridge: canonical command accepts external_api and mcp only", () => {
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "trusted channel allowlist must be exactly ('external_api','mcp')",
  );
  assert(
    sql.includes("v_trusted_channel IS NULL"),
    "NULL channel must be fail-closed",
  );
  assert(
    sql.includes("api_e_private.assert_trusted_context()"),
    "trusted context assertion must remain",
  );
  assert(
    sql.includes("<> 'phases:create'"),
    "exact capability containment must remain",
  );
  assert(
    !/v_trusted_channel <> 'external_api'/.test(sql),
    "the external_api-only condition must be replaced",
  );
});

Deno.test("Phase Create bridge: canonical command maps channel to provenance", () => {
  assert(sql.includes("'external_api'::public.pmg_source_channel"));
  assert(sql.includes("'mcp'::public.pmg_source_channel"));
  assert(
    sql.includes("v_source_channel"),
    "audit provenance must be server-derived",
  );
});

Deno.test("Phase Create bridge: private executor selects a fixed source", () => {
  assert(
    /_execution_source text/.test(sql),
    "executor must take an internal execution-source selector",
  );
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "executor must fail closed on any other source",
  );
  assert(
    sql.includes("api_e_private.authorize_and_establish("),
    "external_api branch must use the REST establishment helper",
  );
  assert(
    sql.includes("api_e_private.authorize_and_establish_mcp("),
    "mcp branch must use the MCP establishment helper",
  );
});

Deno.test("Phase Create bridge: capability and api version are hardcoded", () => {
  assert(sql.includes("c_api_version    constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key constant text := 'phases:create';"));
});

Deno.test("Phase Create bridge: exactly one canonical business mutation call", () => {
  const definitions = sql.match(/CREATE OR REPLACE FUNCTION public\.apply_phase_create\(/g) ?? [];
  const occurrences = sql.match(/public\.apply_phase_create\(/g) ?? [];
  assertEquals(definitions.length, 1, "the command must be redefined exactly once");
  assertEquals(
    occurrences.length - definitions.length,
    1,
    "the executor must call the command exactly once",
  );
  assert(sql.includes("v_pmg := public.apply_phase_create("));
});


Deno.test("Phase Create bridge: idempotency lifecycle is preserved", () => {
  assert(sql.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(sql.includes("api_e_private.complete_idempotency("));
  assert(sql.includes("api_e_private.fail_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(sql.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
});

Deno.test("Phase Create bridge: enablement and context checks precede idempotency", () => {
  const enablement = sql.indexOf("api_project_client_enablements");
  const claim = sql.indexOf("claim_idempotency");
  assert(enablement > 0 && claim > 0 && enablement < claim,
    "project enablement must be verified before claiming idempotency");
  assert(sql.includes("lifecycle_status = 'enabled'"));
  assert(sql.includes("e.disabled_at IS NULL"));
});

Deno.test("Phase Create bridge: no Project widening and no preview call", () => {
  assert(sql.includes("'extend_project_window_required'"));
  assert(
    !/UPDATE public\.projects/.test(sql),
    "the bridge must never widen the Project",
  );
  assert(
    !sql.includes("_apply_project_extension_internal"),
    "no automatic Project extension may be invoked",
  );
  assert(
    !/preview/i.test(sql),
    "no preview function may be invoked",
  );
});

Deno.test("Phase Create bridge: public wrappers are thin and source-fixed", () => {
  assert(
    /public\.api_v1_create_phase\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_phase\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_create_phase\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_phase\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
  for (const fn of ["api_v1_create_phase", "mcp_v1_create_phase"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    assert(
      !(match?.[1] ?? "").includes("_execution_source"),
      `public.${fn} must not expose the execution-source selector`,
    );
  }

});

Deno.test("Phase Create bridge: private executor is not callable by any app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_phase(text, text, uuid, text, text, text, text, date, date, integer, text, text, text, text) FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_create_phase/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Phase Create bridge: wrapper grants are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) =>
    g.replace(/\s+/g, " ").trim()
  );
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_create_phase", "mcp_v1_create_phase"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION public.${fn}(text, uuid, text, text, text, text, date, date, integer, text, text, text, text) FROM ${role};`,
        ),
        `${role} must be revoked on public.${fn}`,
      );
    }
  }
});

Deno.test("Phase Create bridge: no unrelated surface is touched", () => {
  for (const forbidden of [
    "CREATE POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
    "CREATE TABLE",
    "apply_phase_update",
    "apply_phase_reorder",
    "api_v1_update_phase",
    "mcp_v1_update_phase",
    "apply_blocker",
    "apply_risk",
    "append_execution_update",
    "toolRegistry",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("Phase Create bridge: the registry never names the MCP wrapper", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  // Exposure of `phases.create` is owned by Phase Create Step 4; the durable
  // bridge invariant is that the database wrapper name never reaches the
  // metadata-only registry.
  assert(
    !registry.includes("mcp_v1_create_phase"),
    "registry must not reference the MCP wrapper",
  );
});
