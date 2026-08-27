/**
 * API-Q Cross-Family-C20C3 — static/contract test.
 *
 * Verifies the C20C3 migration closes the outer browser OAuth / authentication
 * boundary on exactly three Governance Record mutation surfaces
 * (`apply_governance_record_create`, `set_governance_record_decisions`,
 * `set_governance_record_links`) without PMG redesign, ACL drift, downstream
 * C20C2 / C20C2-C1 drift, or frontend drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820094823_3ddbbb77-75da-4d7f-a1ee-09a5c8ac32c3.sql";
const HOOK = "src/hooks/useProjectGovernance.ts";

const sql = await Deno.readTextFile(MIGRATION);
/** Executable SQL only — `--` commentary is not a privilege statement. */
const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function bodyOf(header: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${header}`);
  assert(start >= 0, `${header} not redefined`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const CREATE = bodyOf("apply_governance_record_create(");
const DECISIONS = bodyOf("set_governance_record_decisions(");
const LINKS = bodyOf("set_governance_record_links(");
const ALL: Array<[string, string]> = [
  ["apply_governance_record_create", CREATE],
  ["set_governance_record_decisions", DECISIONS],
  ["set_governance_record_links", LINKS],
];
const SETTERS: Array<[string, string]> = [
  ["set_governance_record_decisions", DECISIONS],
  ["set_governance_record_links", LINKS],
];

Deno.test("C20C3: exactly the three intended functions are redefined", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 3);
  assert(!/create_governance_record\s*\(\s*\n?\s*_project_id uuid,\s*\n\s*_event_type/.test(
    sql.replace(/apply_governance_record_create/g, "X"),
  ), "create_governance_record must not be redefined");
  assert(
    !sql.includes("CREATE OR REPLACE FUNCTION public.apply_governance_record_update"),
    "update wrapper untouched",
  );
  assert(
    !sql.includes("CREATE OR REPLACE FUNCTION public.create_governance_record"),
    "delegate untouched",
  );
  assert(!/_gov_assert_project_(read|write)\s*\(_project_id uuid\)/.test(sql));
});

Deno.test("C20C3: effective signatures and defaults preserved", () => {
  for (
    const frag of [
      "_project_id uuid,",
      "_event_type text,",
      "_actual_date_held date,",
      "_cadence_id uuid DEFAULT NULL::uuid,",
      "_event_name text DEFAULT NULL::text,",
      "_expected_date_snapshot date DEFAULT NULL::date,",
      "_summary text DEFAULT NULL::text,",
      "_decisions_summary text DEFAULT NULL::text,",
      "_external_reference_url text DEFAULT NULL::text,",
      "_sharepoint_evidence_reference text DEFAULT NULL::text,",
      "_record_kind text DEFAULT NULL::text,",
      "_decision_stage text DEFAULT NULL::text,",
      "_decision_question text DEFAULT NULL::text,",
      "_decision_owner_stakeholder_id uuid DEFAULT NULL::uuid,",
      "_target_decision_date date DEFAULT NULL::date,",
      "_decisions jsonb DEFAULT NULL::jsonb,",
      "_links jsonb DEFAULT NULL::jsonb,",
      "_correlation_id text DEFAULT NULL::text,",
      "_idempotency_key text DEFAULT NULL::text",
    ]
  ) {
    assert(CREATE.includes(frag), `create signature fragment: ${frag}`);
  }
  assert(DECISIONS.includes("_record_id uuid,") && DECISIONS.includes("_decisions jsonb"));
  assert(LINKS.includes("_record_id uuid,") && LINKS.includes("_links jsonb"));
});

Deno.test("C20C3: function properties and search_paths preserved", () => {
  assert(CREATE.includes("RETURNS jsonb"));
  assert(CREATE.includes("SET search_path = pg_catalog, public"));
  for (const [name, body] of SETTERS) {
    assert(body.includes("RETURNS void"), `${name} return type`);
    assert(body.includes("SET search_path = public, extensions"), `${name} search_path`);
  }
  for (const [name, body] of ALL) {
    assert(body.includes("LANGUAGE plpgsql"), `${name} language`);
    assert(body.includes("VOLATILE SECURITY DEFINER"), `${name} volatility/secdef`);
  }
});

Deno.test("C20C3: OAuth resolver is the first executable security operation", () => {
  for (const [name, body] of ALL) {
    const declEnd = body.indexOf("\nBEGIN\n");
    assert(declEnd > 0, `${name} BEGIN`);
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const uid = body.indexOf("auth.uid()");
    assert(gate > declEnd, `${name} gate after top-level BEGIN`);
    assert(gate < uid, `${name} gate before auth.uid()`);
    const deny = body.indexOf("IF v_client_id IS NOT NULL THEN");
    assert(deny > gate && deny < uid, `${name} denial before auth resolution`);
  }
});

Deno.test("C20C3: resolver failure maps to unresolved_client", () => {
  for (const [name, body] of ALL) {
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(body),
      `${name} unresolved_client`,
    );
  }
});

Deno.test("C20C3: non-null client id denial shape per surface", () => {
  const denyIdx = CREATE.indexOf("IF v_client_id IS NOT NULL THEN");
  const envelope = CREATE.slice(denyIdx, denyIdx + 400);
  assert(envelope.includes("'not_authorized'::public.pmg_command_status"));
  assert(envelope.includes("'apply_governance_record_create'"));
  assert(envelope.includes("public.pmg_build_result"));
  assert(!envelope.includes("RAISE EXCEPTION"), "create must not raise on OAuth denial");

  for (const [name, body] of SETTERS) {
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} 42501 denial`,
    );
  }
});

Deno.test("C20C3: no trusted/API/MCP/capability/source-channel/service-role bypass", () => {
  for (const [name, body] of ALL) {
    for (
      const forbidden of [
        "assert_trusted_context",
        "trusted",
        "capability",
        "external_api",
        "mcp",
        "connected_app",
        "service_role",
        "SUPABASE_SERVICE_ROLE",
      ]
    ) {
      assert(
        !body.toLowerCase().includes(forbidden.toLowerCase()),
        `${name} must not reference ${forbidden}`,
      );
    }
  }
  // Only the accepted btpm_ui provenance channel is present anywhere.
  const channels = sql.match(/public\.pmg_source_channel/g) ?? [];
  assertEquals(channels.length, 1);
  assert(CREATE.includes("'btpm_ui'::public.pmg_source_channel"));
});

Deno.test("C20C3: auth.uid() not in DECLARE and resolved exactly once", () => {
  for (const [name, body] of ALL) {
    const declare = body.slice(body.indexOf("DECLARE"), body.indexOf("\nBEGIN\n"));
    assert(!declare.includes("auth.uid()"), `${name} DECLARE clean`);
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name} single auth.uid()`);
  }
  assert(CREATE.includes("v_actor := auth.uid();"));
  for (const [name, body] of SETTERS) {
    assert(body.includes("v_caller := auth.uid();"), `${name} v_caller`);
  }
});

Deno.test("C20C3: null/inactive actor handling precedes protected lookups", () => {
  const authIdx = CREATE.indexOf(
    "IF v_actor IS NULL OR NOT public.is_active_user(v_actor) THEN",
  );
  assert(authIdx > 0, "create auth gate present");
  for (
    const later of [
      "Decisions payload must be a JSON array",
      "Links payload must be a JSON array",
      "FROM public.projects",
      "public.can_write_demo(v_actor, v_workspace_id)",
      "public.create_governance_record(",
      "public.set_governance_record_decisions(",
      "public.set_governance_record_links(",
      "public.pmg_record_command_audit(",
    ]
  ) {
    assert(CREATE.indexOf(later) > authIdx, `create: ${later} must follow auth gate`);
  }

  for (const [name, body] of SETTERS) {
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} unauthorized semantics`,
    );
    const gate = body.indexOf("IF v_caller IS NULL");
    const lookup = body.indexOf("FROM governance_records WHERE id = _record_id");
    assert(lookup > gate, `${name} record lookup after auth gate`);
  }
});

Deno.test("C20C3: PMG create Project/Workspace/can_write_demo behavior preserved", () => {
  assert(
    CREATE.includes(
      "SELECT workspace_id INTO v_workspace_id\n    FROM public.projects\n   WHERE id = _project_id;",
    ),
  );
  assert(
    CREATE.includes(
      "IF v_workspace_id IS NOT NULL AND NOT public.can_write_demo(v_actor, v_workspace_id) THEN",
    ),
  );
  assert(!CREATE.includes("Project not found"), "fall-through behavior preserved");
  assert(!/_expected_updated_at|stale_governance_record/.test(CREATE), "no concurrency added");
});

Deno.test("C20C3: PMG create delegate, optional setters and counts preserved", () => {
  assert(CREATE.includes("v_new_id := public.create_governance_record("));
  assert(
    /IF _decisions IS NOT NULL THEN\s+PERFORM public\.set_governance_record_decisions\(v_new_id, _decisions\);\s+v_decision_count := jsonb_array_length\(_decisions\);/
      .test(CREATE),
  );
  assert(
    /IF _links IS NOT NULL THEN\s+PERFORM public\.set_governance_record_links\(v_new_id, _links\);\s+v_link_count := jsonb_array_length\(_links\);/
      .test(CREATE),
  );
  assert(CREATE.includes("WHEN insufficient_privilege THEN"));
  assert(CREATE.includes("WHEN invalid_parameter_value"));
  assert(CREATE.includes("'applied'::public.pmg_command_status"));
  assert(CREATE.includes("'governance_record_id', v_new_id"));
});

Deno.test("C20C3: PMG create audit provenance, correlation and idempotency preserved", () => {
  assert(CREATE.includes("PERFORM public.pmg_record_command_audit("));
  assert(CREATE.includes("_correlation_id, _idempotency_key,"));
  for (
    const key of [
      "'decisions_provided'",
      "'links_provided'",
      "'decision_count', v_decision_count",
      "'link_count', v_link_count",
      "'record_kind', coalesce(_record_kind,'evidence_record')",
      "'has_decision_owner'",
      "'has_target_decision_date'",
    ]
  ) {
    assert(CREATE.includes(key), `audit metadata: ${key}`);
  }
});

Deno.test("C20C3: Decisions helper ordering, payload validation and replacement", () => {
  const lookup = DECISIONS.indexOf("FROM governance_records WHERE id = _record_id");
  const notFound = DECISIONS.indexOf("'Record not found' USING ERRCODE='P0002'");
  const helper = DECISIONS.indexOf("PERFORM _gov_assert_project_write(_row.project_id);");
  const payload = DECISIONS.indexOf("'Decisions payload must be a JSON array'");
  const del = DECISIONS.indexOf("DELETE FROM governance_record_decisions");
  assert(notFound > lookup && helper > notFound && payload > helper && del > payload);
  assert(DECISIONS.includes("FOR _d IN SELECT * FROM jsonb_array_elements(_decisions) LOOP"));
  assert(DECISIONS.includes("'decision_text is required'"));
});

Deno.test("C20C3: current Decision stakeholder-owner semantics preserved", () => {
  assert(
    DECISIONS.includes(
      "_stakeholder_id := NULLIF(_d->>'decision_owner_stakeholder_id','')::uuid;",
    ),
  );
  assert(DECISIONS.includes("_owner_user := NULLIF(_d->>'decision_owner_id','')::uuid;"));
  assert(
    DECISIONS.includes("WHERE s.id = _stakeholder_id AND s.project_id = _row.project_id;"),
  );
  assert(DECISIONS.includes("'Stakeholder owner does not belong to this project'"));
  assert(
    DECISIONS.includes(
      "IF _stakeholder_type = 'workspace_member' AND _stakeholder_user IS NOT NULL THEN",
    ),
  );
  assert(DECISIONS.includes("_owner_user := _stakeholder_user;"));
  assert(DECISIONS.includes("NULLIF(_d->>'target_date','')::date,"));
  assert(DECISIONS.includes("decision_owner_stakeholder_id,"));
});

Deno.test("C20C3: Decisions actor fields and audit use v_caller", () => {
  assert(DECISIONS.includes("v_caller, v_caller);"), "created_by/updated_by");
  assert(
    DECISIONS.includes("PERFORM log_activity_event(_row.organization_id, v_caller,"),
  );
  assert(DECISIONS.includes("'governance_record_decisions_updated'"));
  assert(DECISIONS.includes("'decision_count', _count"));
});

Deno.test("C20C3: Links helper ordering, payload validation and replacement", () => {
  const lookup = LINKS.indexOf("FROM governance_records WHERE id = _record_id");
  const notFound = LINKS.indexOf("'Record not found' USING ERRCODE='P0002'");
  const helper = LINKS.indexOf("PERFORM _gov_assert_project_write(_row.project_id);");
  const payload = LINKS.indexOf("'Links payload must be a JSON array'");
  const del = LINKS.indexOf("DELETE FROM governance_record_links");
  assert(notFound > lookup && helper > notFound && payload > helper && del > payload);
  assert(LINKS.includes("linked_object_type, linked_object_id, created_by)"));
  assert(LINKS.includes("_l->>'linked_object_type',"));
  assert(LINKS.includes("(_l->>'linked_object_id')::uuid,"));
  assert(
    LINKS.includes(
      "_row.organization_id, _row.workspace_id, _row.project_id, _record_id,",
    ),
  );
});

Deno.test("C20C3: Links actor fields and audit use v_caller", () => {
  assert(LINKS.includes("      v_caller);"), "created_by uses v_caller");
  assert(LINKS.includes("PERFORM log_activity_event(_row.organization_id, v_caller,"));
  assert(LINKS.includes("'governance_record_links_updated'"));
  assert(LINKS.includes("'link_count', _count"));
});

Deno.test("C20C3: no GRANT/REVOKE and no schema/RLS/trigger/encryption drift", () => {
  assert(!/\bGRANT\b/i.test(executableSql), "no GRANT");
  assert(!/\bREVOKE\b/i.test(executableSql), "no REVOKE");
  assert(!/CREATE (TABLE|POLICY|TRIGGER|TYPE|SCHEMA)/i.test(sql));
  assert(!/ALTER (TABLE|POLICY|TYPE|SCHEMA|DATABASE)/i.test(sql));
  assert(!/btpm_(encrypt|decrypt)/i.test(sql));
  assert(!/pbi_reporting|power_?bi/i.test(sql));
  assert(!/api_capability|api_clients|btpm-mcp/i.test(sql));
});

Deno.test("C20C3: C20C2 / C20C2-C1 accepted surfaces remain untouched", () => {
  for (
    const fn of [
      "archive_governance_record",
      "restore_governance_record",
      "update_governance_record",
      "apply_governance_record_update",
    ]
  ) {
    assert(
      !sql.includes(`FUNCTION public.${fn}(`),
      `${fn} must not be redefined in C20C3`,
    );
  }
});

Deno.test("C20C3: committed frontend callers remain unchanged", async () => {
  const hook = await Deno.readTextFile(HOOK);
  assert(hook.includes('"apply_governance_record_create" as never'));
  assert(hook.includes('supabase.rpc("set_governance_record_decisions"'));
  assert(hook.includes('supabase.rpc("set_governance_record_links"'));
  assert(!hook.includes("SUPABASE_SERVICE_ROLE_KEY"), "no service-role caller in hook");
});
