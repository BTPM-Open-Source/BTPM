// KPI-6A — static contract guard for the trusted dual-source KPI
// update-history append database bridge.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename), takes the latest one as
// the effective definition, and verifies the executable SQL.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const REPO_ROOT = new URL("../../../", import.meta.url);
const MARKER =
  "KPI-6A — Trusted dual-source KPI update-history append database bridge";

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
  assert(found.length >= 1, "expected at least one KPI-6A bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const CANONICAL_HEAD = "CREATE OR REPLACE FUNCTION public.append_kpi_update(";
const EXECUTOR_HEAD =
  "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_append_kpi_update(";
const REST_HEAD = "CREATE OR REPLACE FUNCTION public.api_v1_append_kpi_update(";
const MCP_HEAD = "CREATE OR REPLACE FUNCTION public.mcp_v1_append_kpi_update(";

function section(head: string, next: string[]): string {
  const start = sql.indexOf(head);
  assert(start > -1, `missing section: ${head}`);
  let end = sql.length;
  for (const marker of next) {
    const idx = sql.indexOf(marker, start + head.length);
    if (idx > -1 && idx < end) end = idx;
  }
  return sql.slice(start, end);
}

const canonicalSql = section(CANONICAL_HEAD, [EXECUTOR_HEAD]);
const executorSql = section(EXECUTOR_HEAD, [
  "COMMENT ON FUNCTION api_e_private.execute_v1_append_kpi_update",
  REST_HEAD,
]);
const restSql = section(REST_HEAD, [MCP_HEAD]);
const mcpSql = section(MCP_HEAD, ["ZZZ_NO_SUCH_MARKER"]);

function argList(head: string, body: string): string[] {
  const open = body.indexOf(head) + head.length;
  const close = body.indexOf("\n)", open);
  assert(close > open, `unterminated argument list for ${head}`);
  return body
    .slice(open, close)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// A. Capability catalogue
// ---------------------------------------------------------------------------
Deno.test("KPI-6A A: exactly one capability catalogue row is reconciled", () => {
  assertEquals(
    (sql.match(/INSERT INTO public\.api_capability_catalogue/g) ?? []).length,
    1,
  );
  assert(sql.includes("'v1', 'command', 'kpis:append_update', 'kpis.updates.append', 'POST',"));
  assert(sql.includes("'/v1/kpis/:kpiid/updates', 'project',"));
  assert(sql.includes("'Append Project KPI Update',"));
  assert(
    sql.includes(
      "'Append one operational KPI update to an authorized Project KPI.',",
    ),
  );
  assert(sql.includes("true, 'active')"));
  assert(sql.includes("ON CONFLICT (api_version, capability_key) DO UPDATE SET"));
});

Deno.test("KPI-6A A: no grant, enablement or consent mutation", () => {
  assert(!/INSERT INTO public\.api_capability_grants/i.test(sql));
  assert(!/INSERT INTO public\.api_project_client_enablements/i.test(sql));
  assert(!/INSERT INTO public\.api_workspace_client_enablements/i.test(sql));
  assert(!/INSERT INTO public\.api_organization_client_enablements/i.test(sql));
  assert(!/UPDATE public\.api_project_client_enablements/i.test(sql));
  assert(!/api_client_supported_capabilities/i.test(sql));
});

// ---------------------------------------------------------------------------
// B. Canonical PMG writer
// ---------------------------------------------------------------------------
Deno.test("KPI-6A B: canonical public signature is unchanged", () => {
  assertEquals(argList(CANONICAL_HEAD, canonicalSql), [
    "_kpi_definition_id uuid",
    "_value numeric",
    "_update_date date",
    "_note text DEFAULT NULL::text",
    "_correlation_id text DEFAULT NULL::text",
    "_idempotency_key text DEFAULT NULL::text",
  ]);
  assert(/RETURNS jsonb/.test(canonicalSql));
  assert(/SECURITY DEFINER/.test(canonicalSql));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(canonicalSql));
});

Deno.test("KPI-6A B: btpm_ui remains the default derived source channel", () => {
  assert(
    canonicalSql.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel;",
    ),
  );
});

Deno.test("KPI-6A B: trusted context requires exact v1/command/kpis:append_update", () => {
  assert(canonicalSql.includes("api_e_private.jwt_client_id()"));
  assert(canonicalSql.includes("api_e_private.assert_trusted_context()"));
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,80}<> 'v1'/.test(canonicalSql));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,80}<> 'command'/.test(canonicalSql),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,90}<> 'kpis:append_update'/.test(
      canonicalSql,
    ),
  );
});

Deno.test("KPI-6A B: trusted source channel is only external_api or mcp", () => {
  assert(canonicalSql.includes("v_trusted_channel NOT IN ('external_api','mcp')"));
  assert(
    canonicalSql.includes("v_source_channel := 'external_api'::public.pmg_source_channel;"),
  );
  assert(canonicalSql.includes("v_source_channel := 'mcp'::public.pmg_source_channel;"));
});

Deno.test("KPI-6A B: source channel is never a PMG argument", () => {
  const args = argList(CANONICAL_HEAD, canonicalSql).join(",");
  assert(!/_source_channel/.test(args));
  assert(!/_api_client_id/.test(args));
  assert(!/_executing_user_id/.test(args));
});

Deno.test("KPI-6A B: audit uses the server-derived source channel", () => {
  assert(
    /public\.pmg_record_command_audit\([\s\S]{0,120}v_source_channel,/.test(canonicalSql),
  );
  assert(!/'btpm_ui'::public\.pmg_source_channel,\s*\n\s*v_project_id/.test(canonicalSql));
});

Deno.test("KPI-6A B: fail-closed trusted-context guard precedes business work", () => {
  const guard = canonicalSql.indexOf("v_trusted_channel NOT IN ('external_api','mcp')");
  const lookup = canonicalSql.indexOf("FROM public.kpi_definitions");
  const insert = canonicalSql.indexOf("INSERT INTO public.kpi_updates");
  const note = canonicalSql.indexOf("v_note := nullif(btrim(coalesce(_note");
  const audit = canonicalSql.indexOf("public.pmg_record_command_audit");
  assert(guard > -1);
  assert(lookup > guard);
  assert(insert > guard);
  assert(note > guard);
  assert(audit > guard);
});

Deno.test("KPI-6A B: frozen business semantics remain", () => {
  assert(canonicalSql.includes("public.is_active_user(v_actor)"));
  assert(canonicalSql.includes("public.has_project_pm_authority(v_actor, v_project_id)"));
  assert(canonicalSql.includes("public.can_write_demo(v_actor, v_project.workspace_id)"));
  assert(canonicalSql.includes("'kpi_definition_id_required'"));
  assert(canonicalSql.includes("'value_required'"));
  assert(canonicalSql.includes("'update_date_required'"));
  assert(canonicalSql.includes("author_id, workspace_id, organization_id"));
  assert(canonicalSql.includes("v_actor, v_project.workspace_id, v_project.organization_id"));
  // No invented API-only business rules.
  assert(!/source_mode\s*(=|IS DISTINCT FROM)\s*'manual'/i.test(canonicalSql));
  assert(!/_expected_updated_at/.test(canonicalSql));
});

// ---------------------------------------------------------------------------
// C. Structural KPI -> Project containment
// ---------------------------------------------------------------------------
Deno.test("KPI-6A C: canonical PMG rejects KPI/Project workspace or organization mismatch", () => {
  assert(
    canonicalSql.includes(
      "IF v_kpi.workspace_id IS DISTINCT FROM v_project.workspace_id",
    ),
  );
  assert(
    canonicalSql.includes(
      "OR v_kpi.organization_id IS DISTINCT FROM v_project.organization_id THEN",
    ),
  );
  const gate = canonicalSql.indexOf("IF v_kpi.workspace_id IS DISTINCT FROM");
  const insert = canonicalSql.indexOf("INSERT INTO public.kpi_updates");
  assert(gate > -1 && insert > gate, "containment gate must precede persistence");
  const after = canonicalSql.slice(gate, gate + 400);
  assert(after.includes("'not_authorized'::public.pmg_command_status"));
  assert(!/workspace_mismatch|organization_mismatch/i.test(canonicalSql));
  // No automatic repair of inconsistent rows.
  assert(!/UPDATE public\.kpi_definitions/i.test(canonicalSql));
});

Deno.test("KPI-6A C: executor derives Project from the KPI only", () => {
  assert(
    executorSql.includes("FROM public.kpi_definitions k") &&
      executorSql.includes("JOIN public.projects p ON p.id = k.target_id"),
  );
  assert(executorSql.includes("AND k.target_type = 'project'"));
  assert(executorSql.includes("AND k.target_id IS NOT NULL"));
  assert(executorSql.includes("AND k.workspace_id = p.workspace_id"));
  assert(executorSql.includes("AND k.organization_id = p.organization_id"));
  assert(
    /IF v_project_id IS NULL OR v_workspace_id IS NULL OR v_organization_id IS NULL THEN[\s\S]{0,200}'not_authorized'/
      .test(executorSql),
  );
});

Deno.test("KPI-6A C: executor reads no narrative/configuration columns of the KPI", () => {
  for (
    const forbidden of [
      "k.name",
      "k.description",
      "k.note",
      "k.current_value",
      "k.target_value",
      "k.calculation_key",
      "k.updated_at",
    ]
  ) {
    assert(!executorSql.includes(forbidden), `executor must not read ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// D. Private executor
// ---------------------------------------------------------------------------
Deno.test("KPI-6A D: private executor has exactly the 10 fixed arguments", () => {
  assertEquals(argList(EXECUTOR_HEAD, executorSql), [
    "_execution_source text",
    "_expected_oauth_client_id text",
    "_kpi_definition_id uuid",
    "_value numeric",
    "_update_date date",
    "_note text",
    "_request_id text",
    "_correlation_id text",
    "_idempotency_key text",
    "_payload_hash text",
  ]);
  const args = argList(EXECUTOR_HEAD, executorSql).join(",");
  for (
    const forbidden of [
      "_project_id",
      "_workspace_id",
      "_organization_id",
      "_tenant_id",
      "_actor",
      "_capability",
      "_command",
      "_function_name",
    ]
  ) {
    assert(!args.includes(forbidden), `caller must not supply ${forbidden}`);
  }
});

Deno.test("KPI-6A D: execution source is a fixed internal selector", () => {
  assert(
    executorSql.includes(
      "IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN",
    ),
  );
  assert(executorSql.includes("c_capability_key  constant text := 'kpis:append_update';"));
  assert(executorSql.includes("c_api_version     constant text := 'v1';"));
  assert(executorSql.includes("c_capability_kind constant text := 'command';"));
});

Deno.test("KPI-6A D: transport validation is bounded and non-echoing", () => {
  assert(executorSql.includes("'^[0-9a-f]{64}$'"));
  assert(executorSql.includes("OR _value IS NULL"));
  assert(executorSql.includes("OR _update_date IS NULL"));
  assert(executorSql.includes("_kpi_definition_id = '00000000-0000-0000-0000-000000000000'::uuid"));
  const invalidReturns = executorSql.match(
    /RETURN jsonb_build_object\('ok', false, 'outcome', 'invalid'\);/g,
  ) ?? [];
  assert(invalidReturns.length >= 2);
  assert(!/'detail'|'input'|'message'|SQLERRM/.test(executorSql));
});

Deno.test("KPI-6A D: trusted context establishment and recheck are exact", () => {
  assert(executorSql.includes("api_e_private.authorize_and_establish("));
  assert(executorSql.includes("api_e_private.authorize_and_establish_mcp("));
  for (
    const key of [
      "api_e.api_client_id",
      "api_e.tenant_id",
      "api_e.organization_id",
      "api_e.workspace_id",
      "api_e.api_version",
      "api_e.capability_kind",
      "api_e.capability_key",
      "api_e.source_channel",
    ]
  ) {
    assert(executorSql.includes(`current_setting('${key}', true)`), `missing recheck of ${key}`);
  }
  assert(executorSql.includes("OR v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(executorSql.includes("OR v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));
  assert(executorSql.includes("OR v_ctx_capability_key IS DISTINCT FROM c_capability_key"));
  assert(executorSql.includes("OR v_ctx_source_channel IS DISTINCT FROM v_source"));
});

Deno.test("KPI-6A D: exact Project Connected-App enablement is required before idempotency", () => {
  assert(executorSql.includes("FROM public.api_project_client_enablements e"));
  assert(executorSql.includes("WHERE e.project_id = v_project_id"));
  assert(executorSql.includes("AND e.api_client_id = v_ctx_client_id"));
  assert(executorSql.includes("AND e.tenant_id = v_ctx_tenant_id"));
  assert(executorSql.includes("AND e.organization_id = v_organization_id"));
  assert(executorSql.includes("AND e.workspace_id = v_workspace_id"));
  assert(executorSql.includes("AND e.lifecycle_status = 'enabled'"));
  assert(executorSql.includes("AND e.enabled_at IS NOT NULL"));
  assert(executorSql.includes("AND e.disabled_at IS NULL"));
  const enablement = executorSql.indexOf("api_project_client_enablements");
  const claim = executorSql.indexOf("api_e_private.claim_idempotency");
  const pmg = executorSql.indexOf("public.append_kpi_update(");
  assert(enablement > -1 && claim > enablement && pmg > claim);
  assert(!/api_workspace_client_enablements|api_organization_client_enablements/.test(executorSql));
});

Deno.test("KPI-6A D: exactly one canonical PMG invocation, no direct dispatch or retry", () => {
  assertEquals((executorSql.match(/public\.append_kpi_update\(/g) ?? []).length, 1);
  assert(!/EXECUTE\s+format|regprocedure|supabase\.rpc/i.test(executorSql));
  assert(!/LOOP|WHILE/i.test(executorSql));
});

// ---------------------------------------------------------------------------
// E. Idempotency
// ---------------------------------------------------------------------------
Deno.test("KPI-6A E: idempotency claim uses the fixed capability key", () => {
  assert(
    executorSql.includes(
      "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
    ),
  );
});

Deno.test("KPI-6A E: conflict and pending outcomes are bounded", () => {
  assert(
    executorSql.includes("RETURN jsonb_build_object('ok', false, 'outcome', 'idempotency_conflict');"),
  );
  assert(
    executorSql.includes("RETURN jsonb_build_object('ok', false, 'outcome', 'idempotency_pending');"),
  );
});

Deno.test("KPI-6A E: completed replay returns the stored identity as replayed", () => {
  assert(
    executorSql.includes(
      "RETURN v_claim.canonical_result || jsonb_build_object('outcome', 'replayed');",
    ),
  );
  const replay = executorSql.indexOf("v_claim.registry_state = 'completed'");
  const pmg = executorSql.indexOf("public.append_kpi_update(");
  assert(replay > -1 && pmg > replay, "replay must return before the canonical append");
});

Deno.test("KPI-6A E: failed replay codes are bounded and unknown states fail internally", () => {
  assert(executorSql.includes("IF v_claim.failure_code = 'not_authorized' THEN"));
  assert(executorSql.includes("ELSIF v_claim.failure_code = 'invalid' THEN"));
  assert(executorSql.includes("unknown persisted failure code"));
  assert(executorSql.includes("unexpected replay state"));
  assert(executorSql.includes("unexpected idempotency decision"));
  assert(executorSql.includes("no idempotency claim decision"));
});

// ---------------------------------------------------------------------------
// F. TOCTOU recheck + results
// ---------------------------------------------------------------------------
Deno.test("KPI-6A F: TOCTOU recheck happens after the claim and before the PMG", () => {
  const claim = executorSql.indexOf("api_e_private.claim_idempotency");
  const recheck = executorSql.indexOf("FOR UPDATE OF k");
  const pmg = executorSql.indexOf("public.append_kpi_update(");
  assert(claim > -1 && recheck > claim && pmg > recheck);
  assert(executorSql.includes("AND k.target_id = v_project_id"));
  assert(executorSql.includes("AND k.workspace_id = v_workspace_id"));
  assert(executorSql.includes("AND k.organization_id = v_organization_id"));
  assert(executorSql.includes("AND p.workspace_id = v_workspace_id"));
  assert(executorSql.includes("AND p.organization_id = v_organization_id"));
  assert(
    /IF v_recheck IS NOT TRUE THEN[\s\S]{0,220}fail_idempotency\(v_claim\.registry_id, 'not_authorized'\)/
      .test(executorSql),
  );
});

Deno.test("KPI-6A F: applied result is identifiers only", () => {
  assert(executorSql.includes("'ok', true,"));
  assert(executorSql.includes("'outcome', 'applied',"));
  assert(executorSql.includes("'kpiUpdateId', v_update_id,"));
  assert(executorSql.includes("'kpiId', _kpi_definition_id,"));
  assert(executorSql.includes("'projectId', v_project_id"));
  assert(
    executorSql.includes(
      "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
    ),
  );
  for (
    const leak of [
      "'value'",
      "'note'",
      "'author'",
      "'workspaceId'",
      "'organizationId'",
      "'tenantId'",
      "'reason'",
      "'sourceChannel'",
      "'apiClientId'",
    ]
  ) {
    assert(!executorSql.includes(leak), `result must not expose ${leak}`);
  }
});

Deno.test("KPI-6A F: malformed/missing created update ID fails internally", () => {
  assert(executorSql.includes("malformed canonical result"));
  assert(executorSql.includes("inconsistent canonical result"));
  assert(executorSql.includes("unexpected canonical command status"));
  assert(
    executorSql.includes("IF v_update_id IS NULL") &&
      executorSql.includes(
        "OR v_update_id = '00000000-0000-0000-0000-000000000000'::uuid",
      ),
  );
});

Deno.test("KPI-6A F: PMG invalid/not_authorized are bounded; no no_change or concurrency result", () => {
  assert(
    /ELSIF v_status = 'not_authorized' THEN[\s\S]{0,220}'outcome', 'not_authorized'\)/.test(
      executorSql,
    ),
  );
  assert(/ELSIF v_status = 'invalid' THEN[\s\S]{0,220}'outcome', 'invalid'\)/.test(executorSql));
  assert(!/no_change/.test(executorSql));
  assert(!/stale_kpi|expected_updated_at/.test(executorSql));
  // 'conflict' may only appear as the idempotency claim decision, never as an outcome.
  assert(!/'outcome', 'conflict'/.test(executorSql));
});

// ---------------------------------------------------------------------------
// G. Wrappers and ACL
// ---------------------------------------------------------------------------
Deno.test("KPI-6A G: thin wrappers have the same 9 external arguments and fixed sources", () => {
  const expected = [
    "_expected_oauth_client_id text",
    "_kpi_definition_id uuid",
    "_value numeric",
    "_update_date date",
    "_note text",
    "_request_id text",
    "_correlation_id text",
    "_idempotency_key text",
    "_payload_hash text",
  ];
  assertEquals(argList(REST_HEAD, restSql), expected);
  assertEquals(argList(MCP_HEAD, mcpSql), expected);
  assert(
    /RETURN api_e_private\.execute_v1_append_kpi_update\(\s*'external_api',/.test(restSql),
  );
  assert(/RETURN api_e_private\.execute_v1_append_kpi_update\(\s*'mcp',/.test(mcpSql));
  for (const body of [restSql, mcpSql]) {
    assertEquals((body.match(/execute_v1_append_kpi_update\(/g) ?? []).length, 1);
    assert(!/IF |SELECT |INSERT |UPDATE |claim_idempotency/.test(body.slice(body.indexOf("BEGIN"))));
  }
});

Deno.test("KPI-6A G: private executor is not directly executable", () => {
  const sig = "api_e_private.execute_v1_append_kpi_update(text, text, uuid, numeric, date, text, text, text, text, text)";
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`),
      `missing revoke from ${role}`,
    );
  }
  assert(!new RegExp(`GRANT EXECUTE ON FUNCTION ${sig.replace(/[()]/g, "\\$&")}`).test(sql));
});

Deno.test("KPI-6A G: both public wrappers are authenticated-only", () => {
  for (const fn of ["public.api_v1_append_kpi_update", "public.mcp_v1_append_kpi_update"]) {
    const sig = `${fn}(text, uuid, numeric, date, text, text, text, text, text)`;
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`),
        `${fn}: missing revoke from ${role}`,
      );
    }
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `${fn}: missing authenticated grant`,
    );
  }
});

Deno.test("KPI-6A G: no table grant, RLS or default-privilege change", () => {
  assert(!/GRANT[\s\S]{0,40}ON TABLE/i.test(sql));
  assert(!/ALTER DEFAULT PRIVILEGES/i.test(sql));
  assert(!/CREATE POLICY|DROP POLICY|ALTER POLICY/i.test(sql));
  assert(!/ROW LEVEL SECURITY/i.test(sql));
  assert(!/CREATE TABLE|ALTER TABLE|DROP TABLE/i.test(sql));
});

// ---------------------------------------------------------------------------
// H. Protected-data path
// ---------------------------------------------------------------------------
Deno.test("KPI-6A H: executor never writes tables or touches encryption directly", () => {
  assert(!/INSERT INTO public\.kpi_updates/i.test(executorSql));
  assert(!/UPDATE public\.kpi_definitions/i.test(executorSql));
  assert(!/btpm_encrypt|btpm_decrypt|ensure_org_encryption_key/i.test(executorSql));
  assert(!/k\.note|u\.note|FROM public\.kpi_updates/i.test(executorSql));
  assert(!/DISABLE TRIGGER|ALTER TABLE/i.test(sql));
});

// ---------------------------------------------------------------------------
// I. Non-activation
// ---------------------------------------------------------------------------
async function repoText(relative: string): Promise<string> {
  try {
    return await Deno.readTextFile(new URL(relative, REPO_ROOT));
  } catch {
    return "";
  }
}

async function grepRepo(needle: string, dirs: string[]): Promise<string[]> {
  const hits: string[] = [];
  async function walk(dir: URL, label: string) {
    let entries: Deno.DirEntry[] = [];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);
      const childLabel = `${label}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(child, childLabel);
      } else if (/\.(ts|tsx|json)$/.test(entry.name)) {
        const text = await Deno.readTextFile(child);
        if (text.includes(needle)) hits.push(childLabel);
      }
    }
  }
  for (const dir of dirs) {
    await walk(new URL(dir, REPO_ROOT), dir.replace(/\/$/, ""));
  }
  return hits;
}

// KPI-6B activated the REST surface and KPI-6C activated the MCP surface, so
// the transport activation lifecycle is owned by those steps. KPI-6A therefore
// keeps only the invariant it owns: the browser surface never reaches the
// transport wrappers directly and always goes through the canonical PMG.
Deno.test("KPI-6A I: the browser surface holds no transport wrapper activation", async () => {
  const dirs = ["src/"];
  for (
    const needle of [
      "btpm_append_kpi_update",
      "api_v1_append_kpi_update",
      "mcp_v1_append_kpi_update",
    ]
  ) {
    const hits = await grepRepo(needle, dirs);
    assertEquals(
      hits.filter((h) => !h.includes("integrations/supabase/types.ts")),
      [],
      `${needle} must not be wired into browser code (found: ${hits.join(", ")})`,
    );
  }
});

Deno.test("KPI-6A I: browser append hook remains on the canonical PMG", async () => {
  const hook = await repoText("src/hooks/useProjectKpis.ts");
  assert(hook.includes("append_kpi_update"), "browser hook must still call append_kpi_update");
  assert(!hook.includes("api_v1_append_kpi_update"));
  assert(!hook.includes("mcp_v1_append_kpi_update"));
});
