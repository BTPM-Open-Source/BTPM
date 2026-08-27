// API-Q Portfolio-11A — static contract guard for the Project ↔ Portfolio
// assignment trusted dual-source MCP database bridge.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename), takes the latest one as
// the effective definition, and verifies the executable SQL.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-11A — Project Portfolio Assignment Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Portfolio-11A bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const PRIVATE_SIG = "api_e_private.execute_v1_assign_project_portfolio(text, text, uuid, uuid, text, text, text, text)";
const PUBLIC_ARGS = "(text, uuid, uuid, text, text, text, text)";

// 1 / 2 / 3 — exact signatures.
Deno.test("Portfolio-11A: exactly three functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(new Set(created), new Set([
    "api_e_private.execute_v1_assign_project_portfolio",
    "public.api_v1_assign_project_portfolio",
    "public.mcp_v1_assign_project_portfolio",
  ]));
  assertEquals(created.length, 3);
});

Deno.test("Portfolio-11A: private executor has the exact 8-argument signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_assign_project_portfolio\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_project_id uuid,\s*_portfolio_item_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "private executor signature must be exact",
  );
  assert(sql.includes("LANGUAGE plpgsql"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path TO 'pg_catalog', 'public'"));
});

Deno.test("Portfolio-11A: both public wrappers keep the exact seven-argument contract", () => {
  for (const fn of ["api_v1_assign_project_portfolio", "mcp_v1_assign_project_portfolio"]) {
    const re = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\s*_expected_oauth_client_id text,\\s*_project_id uuid,\\s*_portfolio_item_id uuid,\\s*_request_id text,\\s*_correlation_id text,\\s*_idempotency_key text,\\s*_payload_hash text\\s*\\)\\s*RETURNS jsonb`,
    );
    assert(re.test(sql), `public.${fn} must keep the exact seven public arguments`);
  }
});

// 4 / 5 / 6 — no exposed source; fixed sources.
Deno.test("Portfolio-11A: no public wrapper exposes the execution source", () => {
  for (const fn of ["api_v1_assign_project_portfolio", "mcp_v1_assign_project_portfolio"]) {
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

Deno.test("Portfolio-11A: wrappers delegate with their fixed execution source", () => {
  assert(
    /public\.api_v1_assign_project_portfolio\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_assign_project_portfolio\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_assign_project_portfolio\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_assign_project_portfolio\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
});

// 7 — allowlist.
Deno.test("Portfolio-11A: execution-source allowlist is exactly external_api/mcp and fails closed", () => {
  assert(
    /v_source IS NULL OR v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "source allowlist must be exactly ('external_api','mcp') with NULL fail-closed",
  );
  const idx = sql.indexOf("v_source NOT IN ('external_api','mcp')");
  assert(idx > 0 && idx < sql.indexOf("authorize_and_establish"),
    "the source check must precede any authorization helper");
});

// 8 / 9 / 10 — establishment paths and capability.
Deno.test("Portfolio-11A: source-specific API-E establishment", () => {
  assert(sql.includes("api_e_private.authorize_and_establish("));
  assert(sql.includes("api_e_private.authorize_and_establish_mcp("));
  assert(/IF v_source = 'external_api' THEN[\s\S]*?authorize_and_establish\(/.test(sql));
  assert(/ELSE[\s\S]*?authorize_and_establish_mcp\(/.test(sql));
});

Deno.test("Portfolio-11A: capability and api version are hardcoded", () => {
  assert(sql.includes("c_api_version     constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key  constant text := 'portfolios:assign_project';"));
});

// 11 — Project-derived scope.
Deno.test("Portfolio-11A: authoritative Organization/Workspace derive from the Project", () => {
  assert(
    /SELECT p\.id, p\.organization_id, p\.workspace_id, p\.portfolio_item_id\s+INTO v_project_id, v_organization_id, v_workspace_id, v_current_portfolio_id\s+FROM public\.projects p\s+WHERE p\.id = _project_id;/
      .test(sql),
    "structural Project scope derivation must be preserved",
  );
  const derive = sql.indexOf("FROM public.projects p");
  assert(derive > 0 && derive < sql.indexOf("authorize_and_establish"),
    "scope must be derived before establishment");
  assert(
    !/FROM public\.portfolio_items pi[\s\S]{0,400}authorize_and_establish/.test(sql),
    "Organization/Workspace must never derive from the requested Portfolio",
  );
});

// 12 — trusted context checks.
Deno.test("Portfolio-11A: trusted-context verification is complete and fail-closed", () => {
  for (const setting of [
    "api_e.trusted",
    "api_e.executing_user_id",
    "api_e.api_client_id",
    "api_e.tenant_id",
    "api_e.organization_id",
    "api_e.workspace_id",
    "api_e.api_version",
    "api_e.capability_kind",
    "api_e.capability_key",
    "api_e.source_channel",
  ]) {
    assert(sql.includes(setting), `${setting} must be verified`);
  }
  assert(sql.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(sql.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));
  assert(sql.includes("v_ctx_api_version IS DISTINCT FROM c_api_version"));
  assert(sql.includes("v_ctx_capability_kind IS DISTINCT FROM c_capability_kind"));
  assert(sql.includes("v_ctx_capability_key IS DISTINCT FROM c_capability_key"));
  assert(
    sql.includes("v_ctx_source_channel IS DISTINCT FROM v_source"),
    "source channel must equal the fixed internal execution source",
  );
});

// 13 — Project Connected-App enablement.
Deno.test("Portfolio-11A: Project Connected-App enablement preserved for both sources", () => {
  assert(sql.includes("public.api_project_client_enablements e"));
  assert(sql.includes("e.project_id = v_project_id"));
  assert(sql.includes("e.api_client_id = v_ctx_client_id"));
  assert(sql.includes("e.tenant_id = v_ctx_tenant_id"));
  assert(sql.includes("e.organization_id = v_organization_id"));
  assert(sql.includes("e.workspace_id = v_workspace_id"));
  assert(sql.includes("e.lifecycle_status = 'enabled'"));
  assert(sql.includes("e.enabled_at IS NOT NULL"));
  assert(sql.includes("e.disabled_at IS NULL"));
  const enablement = sql.indexOf("api_project_client_enablements");
  const claim = sql.indexOf("claim_idempotency");
  assert(enablement > 0 && claim > enablement,
    "enablement must be verified before claiming idempotency");
  assert(
    !sql.includes("api_portfolio_client_enablements"),
    "no Portfolio-level enablement model may be introduced",
  );
});

// 14 / 15 — domain authority.
Deno.test("Portfolio-11A: PM and demo-write authority remain independently mandatory", () => {
  assert(
    /IF NOT public\.has_project_pm_authority\(v_ctx_user_id, _project_id\)\s*OR NOT public\.can_write_demo\(v_ctx_user_id, v_workspace_id\)/
      .test(sql),
    "PM authority AND can_write_demo must both be required",
  );
  assert(!/is_org_admin|has_role\(/.test(sql),
    "no alternative Organization Admin assignment authority may be added");
});

// 16 — idempotency key space.
Deno.test("Portfolio-11A: single API-F key space and lifecycle preserved", () => {
  assert(sql.includes("api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)"));
  assert(sql.includes("api_e_private.complete_idempotency("));
  assert(sql.includes("api_e_private.fail_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(sql.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
  assert(sql.includes("'not_authorized'") && sql.includes("'invalid'"));
  assert(!/stale|expectedUpdatedAt|_expected_updated_at/i.test(sql),
    "assignment must remain free of optimistic concurrency");
});

// 17 — Project lock after claim.
Deno.test("Portfolio-11A: Project row is locked after the claim and scope rechecked", () => {
  const claim = sql.indexOf("claim_idempotency");
  const lock = sql.indexOf("FOR UPDATE");
  assert(claim > 0 && lock > claim, "the Project lock must follow the claim");
  assert(
    /FROM public\.projects p\s+WHERE p\.id = _project_id\s+FOR UPDATE;/.test(sql),
    "Project structural row must be locked FOR UPDATE",
  );
  assert(sql.includes("v_locked_org_id IS DISTINCT FROM v_organization_id"));
  assert(sql.includes("v_locked_workspace_id IS DISTINCT FROM v_workspace_id"));
  assert(sql.includes("api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')"));
});

// 18 / 19 / 20 / 21 / 22 — target Portfolio validation and clearing.
Deno.test("Portfolio-11A: non-null target Portfolio is locked structurally and validated", () => {
  assert(
    /IF _portfolio_item_id IS NOT NULL THEN\s+SELECT pi\.organization_id, pi\.is_archived\s+INTO v_target_org_id, v_target_archived\s+FROM public\.portfolio_items pi\s+WHERE pi\.id = _portfolio_item_id\s+FOR UPDATE;/
      .test(sql),
    "target Portfolio must be locked and read structurally only inside the non-null branch",
  );
  assert(sql.includes("v_target_org_id IS DISTINCT FROM v_organization_id"));
  assert(sql.includes("v_target_archived IS NOT FALSE"));
  assert(sql.includes("api_e_private.fail_idempotency(v_claim.registry_id, 'invalid')"));
});

Deno.test("Portfolio-11A: no Portfolio narrative is read or decrypted", () => {
  assert(!/pi\.(name|code|description)/.test(sql));
  assert(!/decrypt/i.test(sql));
  assert(!/pgp_sym|ciphertext/i.test(sql));
});

Deno.test("Portfolio-11A: the NULL clear path performs no target Portfolio lookup", () => {
  const occurrences = sql.match(/public\.portfolio_items/g) ?? [];
  assertEquals(occurrences.length, 1, "portfolio_items may be queried only in the non-null branch");
  const branch = /IF _portfolio_item_id IS NOT NULL THEN([\s\S]*?)END IF;/.exec(sql);
  assert(branch !== null && branch[1].includes("public.portfolio_items"),
    "the only target lookup must live inside the non-null branch");
  assert(sql.includes("'assignment_cleared', (_portfolio_item_id IS NULL)"),
    "clearing remains a first-class outcome, including for an archived current assignment");
});

// 23 / 24 / 25 / 26 — canonical write.
Deno.test("Portfolio-11A: exactly one canonical writer call and no direct Project update", () => {
  const calls = sql.match(/public\.assign_project_portfolio\(/g) ?? [];
  assertEquals(calls.length, 1, "the canonical writer must be called exactly once");
  assert(sql.includes("PERFORM public.assign_project_portfolio(_project_id, _portfolio_item_id);"));
  assert(!/UPDATE public\.projects/.test(sql), "the bridge must never update projects directly");
  assert(!/CREATE OR REPLACE FUNCTION public\.assign_project_portfolio/.test(sql),
    "the canonical writer must not be redefined");
});

Deno.test("Portfolio-11A: final assignment verification and outcome determination preserved", () => {
  assert(
    /SELECT p\.portfolio_item_id\s+INTO v_final_portfolio_id\s+FROM public\.projects p\s+WHERE p\.id = _project_id;/
      .test(sql),
  );
  assert(sql.includes("IF v_final_portfolio_id IS DISTINCT FROM _portfolio_item_id THEN"));
  assert(sql.includes("canonical assignment verification failed"));
  assert(
    /IF v_locked_old_portfolio_id IS NOT DISTINCT FROM _portfolio_item_id THEN\s*v_outcome := 'no_change';\s*ELSE\s*v_outcome := 'applied';/
      .test(sql),
    "applied / no_change determination must be preserved",
  );
});

// 27 / 28 — PMG provenance.
Deno.test("Portfolio-11A: PMG source derives from the fixed execution source", () => {
  assert(
    /v_source_channel := CASE\s*WHEN v_source = 'external_api' THEN 'external_api'::public\.pmg_source_channel\s*ELSE 'mcp'::public\.pmg_source_channel\s*END;/
      .test(sql),
    "PMG channel must be server-derived from the fixed source",
  );
  const audits = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(audits.length, 1, "exactly one PMG audit call may exist");
  assert(sql.includes("'assign_project_portfolio',"));
  assert(sql.includes("v_source_channel,"));
  assert(sql.includes("'project',"));
});

Deno.test("Portfolio-11A: PMG metadata stays exactly structural assignment metadata", () => {
  const meta = /jsonb_build_object\(\s*'old_portfolio_id', v_locked_old_portfolio_id,\s*'new_portfolio_id', _portfolio_item_id,\s*'assignment_cleared', \(_portfolio_item_id IS NULL\)\s*\)/;
  assert(meta.test(sql), "PMG metadata must be exactly the three structural keys");
  for (const forbidden of ["bearer", "access_token", "oauth", "tenant_id'", "portfolio_name", "portfolio_code"]) {
    assert(
      !new RegExp(forbidden, "i").test(
        (meta.exec(sql)?.[0] ?? ""),
      ),
      `PMG metadata must not contain ${forbidden}`,
    );
  }
});

// 29 — bounded result contract.
Deno.test("Portfolio-11A: bounded result shape preserved", () => {
  assert(
    /v_result := jsonb_build_object\(\s*'ok', true,\s*'outcome', v_outcome,\s*'projectId', _project_id,\s*'oldPortfolioId', v_locked_old_portfolio_id,\s*'newPortfolioId', _portfolio_item_id\s*\);/
      .test(sql),
  );
  assert(sql.includes("jsonb_build_object('outcome', 'replayed')"));
  for (const outcome of ["invalid", "not_authorized", "idempotency_conflict", "idempotency_pending"]) {
    assert(sql.includes(`'outcome', '${outcome}'`), `bounded outcome ${outcome} must exist`);
  }
  assert(!/'organizationId'|'workspaceId'|'tenantId'/.test(sql),
    "no scope identity may leak into the result");
});

// 30 / 31 — privileges.
Deno.test("Portfolio-11A: private executor is revoked from every application role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${PRIVATE_SIG} FROM ${role};`),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !new RegExp(`GRANT EXECUTE ON FUNCTION api_e_private\\.execute_v1_assign_project_portfolio`).test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Portfolio-11A: both public wrappers are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) => g.replace(/\s+/g, " ").trim());
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_assign_project_portfolio", "mcp_v1_assign_project_portfolio"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION public.${fn}${PUBLIC_ARGS} FROM ${role};`),
        `${role} must be revoked on public.${fn}`,
      );
    }
  }
});



// 34 — no unrelated surface change.
Deno.test("Portfolio-11A: no unrelated surface is touched", () => {
  for (const forbidden of [
    "CREATE POLICY",
    "ALTER POLICY",
    "ALTER TABLE",
    "CREATE TABLE",
    "DROP FUNCTION",
    "api_capability_catalogue",
    "api_v1_create_portfolio",
    "api_v1_update_portfolio",
    "mcp_v1_create_portfolio",
    "mcp_v1_update_portfolio",
    "ENABLE ROW LEVEL SECURITY",
    "CREATE TRIGGER",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});
