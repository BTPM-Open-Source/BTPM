// API-K.5 — Dedicated transactional Risk API wrappers.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen wrapper contract for public.api_v1_create_risk and
// public.api_v1_update_risk.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-K.5 — Dedicated DB wrappers api_v1_create_risk and api_v1_update_risk";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const SQL = await findMigrationByMarker(MARKER);

const CREATE_SQL = SQL.slice(
  SQL.indexOf("CREATE OR REPLACE FUNCTION public.api_v1_create_risk("),
  SQL.indexOf("CREATE OR REPLACE FUNCTION public.api_v1_update_risk("),
);
const UPDATE_SQL = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.api_v1_update_risk("));

Deno.test("API-K.5: exactly the two wrapper names and fixed typed signatures", () => {
  assertEquals([...SQL.matchAll(/CREATE OR REPLACE FUNCTION/g)].length, 2);
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_create_risk\(\s*_expected_oauth_client_id text,\s*_target_type text,\s*_target_id uuid,\s*_title text,\s*_description text,\s*_mitigation_plan text,\s*_likelihood text,\s*_impact text,\s*_status text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)/
      .test(SQL),
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_update_risk\(\s*_expected_oauth_client_id text,\s*_risk_id uuid,\s*_expected_updated_at timestamptz,\s*_title text,\s*_description text,\s*_mitigation_plan text,\s*_likelihood text,\s*_impact text,\s*_status text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)/
      .test(SQL),
  );
  assertEquals([...SQL.matchAll(/RETURNS jsonb/g)].length, 2);
  assertEquals([...SQL.matchAll(/SECURITY DEFINER/g)].length, 2);
  assertEquals([...SQL.matchAll(/SET search_path TO 'pg_catalog', 'public'/g)].length, 2);
});

Deno.test("API-K.5: no caller scope inputs and no caller link arrays", () => {
  for (const sig of [
    CREATE_SQL.slice(0, CREATE_SQL.indexOf("RETURNS jsonb")),
    UPDATE_SQL.slice(0, UPDATE_SQL.indexOf("RETURNS jsonb")),
  ]) {
    for (
      const forbidden of [
        "_project_id",
        "_workspace_id",
        "_organization_id",
        "_tenant_id",
        "_api_client_id",
        "_user_links",
        "_object_links",
        "_source_channel",
        "_capability",
        "_payload jsonb",
        "_command",
        "_function",
        "_rpc",
        "_table",
        "_sql",
      ]
    ) {
      assertEquals(sig.includes(forbidden), false, `forbidden caller input: ${forbidden}`);
    }
  }
  // The update wrapper accepts no external target identity at all.
  const upSig = UPDATE_SQL.slice(0, UPDATE_SQL.indexOf("RETURNS jsonb"));
  assertEquals(upSig.includes("_target_type"), false);
  assertEquals(upSig.includes("_target_id"), false);
});

Deno.test("API-K.5: each wrapper has exactly one hardcoded capability identity", () => {
  assert(/c_capability_key constant text := 'risks:create';/.test(CREATE_SQL));
  assert(/c_capability_key constant text := 'risks:update';/.test(UPDATE_SQL));
  assertEquals(CREATE_SQL.includes("'risks:update'"), false);
  assertEquals(UPDATE_SQL.includes("'risks:create'"), false);
  for (const part of [CREATE_SQL, UPDATE_SQL]) {
    assert(/c_api_version\s+constant text := 'v1';/.test(part));
    assert(/c_capability_kind constant text := 'command';/.test(part));
    assertEquals([...part.matchAll(/authorize_and_establish/g)].length, 1);
    assert(
      /api_e_private\.authorize_and_establish\(\s*_expected_oauth_client_id,\s*v_organization_id,\s*v_workspace_id,\s*c_api_version,\s*c_capability_kind,\s*c_capability_key,\s*_request_id\s*\)/
        .test(part),
    );
  }
  // authorize_project_scope is neither called nor redefined.
  assertEquals(/api_e_private\.authorize_project_scope\s*\(/.test(SQL), false);
});

Deno.test("API-K.5: scope derivation precedes authorization in both wrappers", () => {
  // Create derives from the external target; update derives from the stored target.
  assert(/FROM public\.projects p\s*\n\s*WHERE p\.id = _target_id;/.test(CREATE_SQL));
  assert(/WHERE ph\.id = _target_id;/.test(CREATE_SQL));
  assert(/WHERE t\.id = _target_id\s*\n\s*AND \(t\.phase_id IS NULL OR ph\.project_id = t\.project_id\);/.test(CREATE_SQL));

  assert(/FROM public\.risks r\s*\n\s*WHERE r\.id = _risk_id;/.test(UPDATE_SQL));
  assert(/WHERE p\.id = v_row_target_id;/.test(UPDATE_SQL));
  assert(/WHERE ph\.id = v_row_target_id;/.test(UPDATE_SQL));
  assert(/WHERE t\.id = v_row_target_id\s*\n\s*AND \(t\.phase_id IS NULL OR ph\.project_id = t\.project_id\);/.test(UPDATE_SQL));
  // Stored scope cross-check.
  assert(UPDATE_SQL.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id"));
  assert(UPDATE_SQL.includes("v_organization_id IS DISTINCT FROM v_row_organization_id"));

  for (const part of [CREATE_SQL, UPDATE_SQL]) {
    const derivIdx = part.indexOf("INTO v_project_id, v_workspace_id, v_organization_id");
    const authIdx = part.indexOf("api_e_private.authorize_and_establish");
    assert(derivIdx > -1 && authIdx > derivIdx, "scope derivation precedes authorization");
  }
});

Deno.test("API-K.5: project connected app enablement runs before idempotency", () => {
  for (const part of [CREATE_SQL, UPDATE_SQL]) {
    assert(part.includes("FROM public.api_project_client_enablements e"));
    for (
      const clause of [
        "e.project_id = v_project_id",
        "e.api_client_id = v_ctx_client_id",
        "e.tenant_id = v_ctx_tenant_id",
        "e.organization_id = v_organization_id",
        "e.workspace_id = v_workspace_id",
        "e.lifecycle_status = 'enabled'",
        "e.enabled_at IS NOT NULL",
        "e.disabled_at IS NULL",
      ]
    ) {
      assert(part.includes(clause), `missing enablement clause: ${clause}`);
    }
    for (const key of ["api_e.api_client_id", "api_e.tenant_id", "api_e.organization_id", "api_e.workspace_id"]) {
      assert(part.includes(`current_setting('${key}', true)`), `missing trusted read: ${key}`);
    }
    assert(part.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
    assert(part.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));

    const authIdx = part.indexOf("api_e_private.authorize_and_establish");
    const enableIdx = part.indexOf("public.api_project_client_enablements");
    const claimIdx = part.indexOf("api_e_private.claim_idempotency");
    assert(authIdx < enableIdx && enableIdx < claimIdx);
  }
});

Deno.test("API-K.5: API-F claim uses the exact fixed capability key", () => {
  assertEquals(
    [...SQL.matchAll(/api_e_private\.claim_idempotency\(c_capability_key, _idempotency_key, _payload_hash\)/g)].length,
    2,
  );
  assertEquals(/claim_idempotency\('/.test(SQL), false);
});

Deno.test("API-K.5: conflict, pending and replay branches never invoke PMG", () => {
  const cases: Array<[string, string]> = [
    [CREATE_SQL, "v_pmg := public.apply_risk_create("],
    [UPDATE_SQL, "v_pmg := public.apply_risk_update("],
  ];
  for (const [part, pmgCall] of cases) {
    const claimIdx = part.indexOf("api_e_private.claim_idempotency");
    const pmgIdx = part.indexOf(pmgCall);
    assert(claimIdx > -1 && pmgIdx > claimIdx);
    const between = part.slice(claimIdx, pmgIdx);
    for (const outcome of ["'idempotency_conflict'", "'idempotency_pending'", "'replayed'"]) {
      assert(between.includes(outcome), `missing branch outcome: ${outcome}`);
    }
    assertEquals(between.includes("apply_risk_create("), false);
    assertEquals(between.includes("apply_risk_update("), false);
    assert(/jsonb_typeof\(v_claim\.canonical_result\) <> 'object'/.test(part));
    assert(/v_claim\.decision <> 'execute' THEN\s*\n\s*RAISE EXCEPTION/.test(part));
  }
});

Deno.test("API-K.5: create calls only apply_risk_create with empty link arrays", () => {
  assert(
    /v_pmg := public\.apply_risk_create\(\s*v_target_type,\s*_target_id,\s*_title,\s*_description,\s*_mitigation_plan,\s*_likelihood,\s*_impact,\s*_status,\s*'\[\]'::jsonb,\s*'\[\]'::jsonb,\s*_correlation_id,\s*_idempotency_key\s*\);/
      .test(CREATE_SQL),
  );
  assertEquals([...SQL.matchAll(/public\.apply_risk_create\(/g)].length, 1);
  assertEquals(CREATE_SQL.includes("apply_risk_update("), false);
});

Deno.test("API-K.5: update reconstructs and passes existing link state, never []", () => {
  // Lock first.
  assert(
    /FROM public\.risks r\s*\n\s*WHERE r\.id = _risk_id\s*\n\s*FOR UPDATE;/.test(UPDATE_SQL),
  );
  const lockIdx = UPDATE_SQL.indexOf("FOR UPDATE;");
  const userLinkIdx = UPDATE_SQL.indexOf("FROM public.entity_user_links eul");
  const objLinkIdx = UPDATE_SQL.indexOf("FROM public.entity_object_links eol");
  const pmgIdx = UPDATE_SQL.indexOf("v_pmg := public.apply_risk_update(");
  const claimIdx = UPDATE_SQL.indexOf("api_e_private.claim_idempotency");
  assert(claimIdx < lockIdx, "lock happens only in the execute branch");
  assert(lockIdx < userLinkIdx && lockIdx < objLinkIdx, "lock precedes link snapshot");
  assert(userLinkIdx < pmgIdx && objLinkIdx < pmgIdx);

  for (
    const clause of [
      "eul.owner_type = 'risk'",
      "eul.owner_id = _risk_id",
      "eul.link_role = 'related_person'",
      "'user_id', eul.user_id",
      "'stakeholder_id', eul.stakeholder_id",
      "ORDER BY eul.sort_order",
      "eol.owner_type = 'risk'",
      "eol.owner_id = _risk_id",
      "eol.link_role = 'related_object'",
      "'referenced_type', eol.referenced_type",
      "'referenced_id', eol.referenced_id",
      "ORDER BY eol.sort_order",
    ]
  ) {
    assert(UPDATE_SQL.includes(clause), `missing link reconstruction clause: ${clause}`);
  }

  assert(
    /v_pmg := public\.apply_risk_update\(\s*_risk_id,\s*_expected_updated_at,\s*_title,\s*_description,\s*_mitigation_plan,\s*_likelihood,\s*_impact,\s*_status,\s*v_user_links,\s*v_object_links,\s*_correlation_id,\s*_idempotency_key\s*\);/
      .test(UPDATE_SQL),
  );
  assertEquals([...SQL.matchAll(/public\.apply_risk_update\(/g)].length, 1);
  // The canonical update call must never receive literal empty desired link state.
  const call = UPDATE_SQL.slice(pmgIdx, UPDATE_SQL.indexOf(");", pmgIdx));
  assertEquals(call.includes("'[]'"), false);
});

Deno.test("API-K.5: wrappers perform no direct Risk or link mutation", () => {
  assertEquals(/INSERT INTO/i.test(SQL), false);
  assertEquals(/UPDATE public\./i.test(SQL), false);
  assertEquals(/DELETE FROM/i.test(SQL), false);
  assertEquals(/entity_user_links\s+SET/i.test(SQL), false);
  assertEquals(/entity_object_links\s+SET/i.test(SQL), false);
});

Deno.test("API-K.5: bounded results carry no narrative and no internal scope", () => {
  const blocks = [CREATE_SQL, UPDATE_SQL].map((part) => {
    const start = part.indexOf("v_result := jsonb_build_object(");
    assert(start > -1);
    return part.slice(start, part.indexOf(");", start));
  });
  assert(blocks[0].includes("'outcome', 'applied'"));
  assert(blocks[0].includes("'createdAt'"));
  assert(blocks[1].includes("'outcome', v_status"));
  for (const block of blocks) {
    for (const key of ["'ok', true", "'riskId'", "'targetType'", "'targetId'", "'likelihood'", "'impact'", "'status'", "'updatedAt'"]) {
      assert(block.includes(key), `missing bounded field: ${key}`);
    }
    for (
      const forbidden of [
        "_description",
        "_mitigation_plan",
        "description",
        "mitigation",
        "_title",
        "'title'",
        "organization_id",
        "workspace_id",
        "tenant_id",
        "warnings",
        "changes",
        "v_pmg",
        "registry",
        "payload_hash",
      ]
    ) {
      assertEquals(block.includes(forbidden), false, `forbidden result field: ${forbidden}`);
    }
  }
  // complete_idempotency only after PMG execution and result construction.
  for (const [part, pmgCall] of [[CREATE_SQL, "v_pmg := public.apply_risk_create("], [UPDATE_SQL, "v_pmg := public.apply_risk_update("]] as Array<[string, string]>) {
    const pmgIdx = part.indexOf(pmgCall);
    const resIdx = part.indexOf("v_result := jsonb_build_object(");
    const compIdx = part.indexOf("api_e_private.complete_idempotency");
    assert(pmgIdx < resIdx && resIdx < compIdx);
    assert(/api_e_private\.complete_idempotency\(v_claim\.registry_id, v_result\)/.test(part));
  }
});

Deno.test("API-K.5: stable safe failure codes and bounded outcome vocabulary", () => {
  assertEquals([...CREATE_SQL.matchAll(/fail_idempotency\(/g)].length, 2);
  assert(/fail_idempotency\(v_claim\.registry_id, 'stale_risk'\)/.test(UPDATE_SQL));
  assert(/fail_idempotency\(v_claim\.registry_id, 'not_authorized'\)/.test(UPDATE_SQL));
  assert(/fail_idempotency\(v_claim\.registry_id, 'invalid'\)/.test(UPDATE_SQL));
  assertEquals(SQL.includes("SQLERRM"), false);
  assertEquals(/fail_idempotency\([^)]*SQLERRM/.test(SQL), false);
  assert(/RAISE EXCEPTION 'api_v1_create_risk: unexpected canonical command status'/.test(SQL));
  assert(/RAISE EXCEPTION 'api_v1_update_risk: unexpected canonical command status'/.test(SQL));

  const allowed = new Set([
    "invalid",
    "not_authorized",
    "conflict",
    "idempotency_conflict",
    "idempotency_pending",
    "replayed",
    "applied",
  ]);
  for (const m of SQL.matchAll(/'outcome', '([a-z_]+)'/g)) {
    assert(allowed.has(m[1]), `unexpected outcome: ${m[1]}`);
  }
  // Conflict is only the canonical stale check, surfaced as a stable code.
  assert(UPDATE_SQL.includes("'outcome', 'conflict', 'code', 'stale_risk'"));
});

Deno.test("API-K.5: no dynamic SQL, generic dispatch or privileged impersonation", () => {
  for (
    const forbidden of [
      "format(",
      "quote_ident",
      "quote_literal",
      "regprocedure",
      "::regproc",
      "service_role",
      "CASE WHEN _command",
    ]
  ) {
    assertEquals(SQL.includes(forbidden), false, `forbidden construct: ${forbidden}`);
  }
  assertEquals(/EXECUTE\s+(?!ON\b)/.test(SQL), false);
});

Deno.test("API-K.5: privileges are revoked from PUBLIC/anon and granted to authenticated only", () => {
  for (const fn of ["api_v1_create_risk", "api_v1_update_risk"]) {
    assert(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC;`).test(SQL));
    assert(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM anon;`).test(SQL));
    assert(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated;`).test(SQL));
  }
  assertEquals(/TO service_role/.test(SQL), false);
  assertEquals(/TO anon;/.test(SQL), false);
});

Deno.test("API-K.5: protected canonical surfaces are not redefined", () => {
  for (
    const forbidden of [
      "FUNCTION public.apply_risk_create(",
      "FUNCTION public.apply_risk_update(",
      "FUNCTION public.apply_blocker_create",
      "FUNCTION public.apply_blocker_update",
      "FUNCTION public.pmg_record_command_audit",
      "FUNCTION api_e_private.authorize_and_establish",
      "FUNCTION api_e_private.claim_idempotency",
      "FUNCTION api_e_private.complete_idempotency",
      "FUNCTION api_e_private.fail_idempotency",
      "api_capability_catalogue",
      "api_capability_grants",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP ",
      "CREATE POLICY",
    ]
  ) {
    assertEquals(SQL.includes(forbidden), false, `must not touch: ${forbidden}`);
  }
});
