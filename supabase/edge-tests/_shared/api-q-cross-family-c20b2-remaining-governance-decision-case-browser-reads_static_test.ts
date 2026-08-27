/**
 * API-Q Cross-Family-C20B2 — static/contract test.
 *
 * Proves the C20B2 migration closes the outer OAuth / authentication boundary
 * for exactly six remaining Governance / Decision Case browser read RPCs,
 * without ACL, property, result-shape, ordering or caller drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820084454_4ce5d413-a86a-4a8c-9602-e5774335c46c.sql";

const sql = await Deno.readTextFile(MIGRATION);

const TARGETS = [
  "get_governance_decision_case_project_summary",
  "list_governance_record_btpm_context_links",
  "list_governance_record_cross_project_links",
  "list_governance_record_copilot_data_packages",
  "list_decision_case_ai_runs",
  "list_generated_decision_case_documents",
] as const;

function bodyOf(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} not redefined`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const BODIES = new Map(TARGETS.map((t) => [t, bodyOf(t)] as const));

Deno.test("C20B2: exact signatures and defaults preserved", () => {
  assert(
    BODIES.get("get_governance_decision_case_project_summary")!.includes(
      "get_governance_decision_case_project_summary(_record_id uuid)",
    ),
  );
  assert(
    BODIES.get("list_governance_record_btpm_context_links")!.includes(
      "list_governance_record_btpm_context_links(_record_id uuid, _include_archived boolean DEFAULT false)",
    ),
  );
  assert(
    BODIES.get("list_governance_record_cross_project_links")!.includes(
      "list_governance_record_cross_project_links(_record_id uuid, _include_archived boolean DEFAULT false)",
    ),
  );
  assert(
    BODIES.get("list_governance_record_copilot_data_packages")!.includes(
      "list_governance_record_copilot_data_packages(_record_id uuid)",
    ),
  );
  assert(
    BODIES.get("list_decision_case_ai_runs")!.includes(
      "list_decision_case_ai_runs(_record_id uuid)",
    ),
  );
  assert(
    BODIES.get("list_generated_decision_case_documents")!.includes(
      "list_generated_decision_case_documents(_record_id uuid, _document_type generated_doc_type DEFAULT NULL::generated_doc_type)",
    ),
  );
});

Deno.test("C20B2: language/volatility/SECDEF/search_path preserved", () => {
  for (const [name, body] of BODIES) {
    assert(body.includes("RETURNS jsonb"), `${name} return type`);
    assert(body.includes("LANGUAGE plpgsql"), `${name} language`);
    assert(body.includes("STABLE SECURITY DEFINER"), `${name} volatility/secdef`);
    const expected = name === "list_generated_decision_case_documents"
      ? "SET search_path TO 'public'\n"
      : "SET search_path TO 'public', 'extensions'";
    assert(body.includes(expected), `${name} search_path`);
  }
});

Deno.test("C20B2: OAuth gate is the first executable security operation", () => {
  for (const [name, body] of BODIES) {
    const begin = body.indexOf("\nBEGIN\n");
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const raise = body.indexOf("'Not authorized'");
    const uid = body.indexOf("auth.uid()");
    const lookup = body.indexOf("FROM public.governance_records WHERE id = _record_id");
    assert(gate > begin, `${name} gate after BEGIN`);
    assert(raise > gate && raise < uid, `${name} rejection before auth resolution`);
    assert(uid < lookup, `${name} auth before governance lookup`);
    const declare = body.slice(body.indexOf("DECLARE"), begin);
    assert(!declare.includes("auth.uid()"), `${name} DECLARE clean`);
    assert(declare.includes("v_client_id text;"), `${name} v_client_id declared`);
    assert(declare.includes("v_caller uuid;"), `${name} v_caller declared`);
  }
});

Deno.test("C20B2: jwt_client_id failure maps to unresolved_client; non-null is 42501", () => {
  for (const [name, body] of BODIES) {
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(body),
      `${name} unresolved_client`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} fail-closed 42501`,
    );
  }
});

Deno.test("C20B2: no API/MCP/trusted/source-channel/service-role bypass", () => {
  for (const [name, body] of BODIES) {
    for (
      const forbidden of [
        "trusted",
        "capability",
        "source_channel",
        "mcp",
        "connected_app",
        "service_role",
        "rest",
      ]
    ) {
      assert(
        !body.toLowerCase().includes(forbidden),
        `${name} must not reference ${forbidden}`,
      );
    }
  }
});

Deno.test("C20B2: auth.uid() resolved exactly once into v_caller; inactive rejected first", () => {
  for (const [name, body] of BODIES) {
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name} single auth.uid()`);
    assert(body.includes("v_caller := auth.uid();"), `${name} v_caller assignment`);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} unauthorized semantics`,
    );
    const active = body.indexOf("is_active_user(v_caller)");
    const lookup = body.indexOf("FROM public.governance_records WHERE id = _record_id");
    assert(active < lookup, `${name} active check before business lookup`);
  }
});

Deno.test("C20B2: authoritative record lookup and missing-record behavior preserved", () => {
  for (const [name, body] of BODIES) {
    assert(
      body.includes(
        "SELECT * INTO _row FROM public.governance_records WHERE id = _record_id;",
      ),
      `${name} authoritative lookup`,
    );
    assert(
      body.includes(
        "IF NOT FOUND THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;",
      ),
      `${name} missing-record behavior`,
    );
  }
});

Deno.test("C20B2: _gov_assert_project_read precedes type validation, decrypt and child reads", () => {
  const TYPE_ERRORS: Record<string, string> = {
    get_governance_decision_case_project_summary: "'Not a decision case'",
    list_governance_record_btpm_context_links:
      "'BTPM context links are only available for decision cases'",
    list_governance_record_cross_project_links:
      "'Cross-project links are only available for decision cases'",
    list_governance_record_copilot_data_packages:
      "'Data packages are only available for decision cases'",
    list_decision_case_ai_runs: "'AI runs are only available for decision cases'",
    list_generated_decision_case_documents:
      "'Generated documents are only available for decision cases'",
  };
  for (const [name, body] of BODIES) {
    const authority = body.indexOf("PERFORM public._gov_assert_project_read(_row.project_id);");
    assert(authority > 0, `${name} authority helper present`);
    const kind = body.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
    assert(kind > authority, `${name} type check after authority`);
    assert(body.includes(TYPE_ERRORS[name]), `${name} type error text preserved`);
    assert(body.includes("USING ERRCODE='22023'"), `${name} type SQLSTATE preserved`);
    const decrypt = body.indexOf("btpm_decrypt");
    if (decrypt >= 0) assert(decrypt > authority, `${name} decrypt after authority`);
    const agg = body.indexOf("jsonb_build_object");
    assert(agg > authority, `${name} payload construction after authority`);
    // helper not replaced or duplicated
    assertEquals(
      body.split("_gov_assert_project_read").length - 1,
      1,
      `${name} single authority call`,
    );
    assert(!body.includes("has_project_pm_authority"), `${name} no write authority`);
    assert(!body.includes("can_write_demo"), `${name} no demo-write authority`);
    assert(!body.includes("is_user_org_member"), `${name} no duplicated org containment`);
  }
});

Deno.test("C20B2: project summary result keys and decrypts preserved", () => {
  const b = BODIES.get("get_governance_decision_case_project_summary")!;
  for (
    const key of [
      "'project_id'",
      "'project_name'",
      "'workspace_id'",
      "'workspace_name'",
      "'program_id'",
      "'program_name'",
      "'organization_id'",
    ]
  ) assert(b.includes(key), `summary ${key}`);
  assert(b.includes("public.btpm_decrypt(p.name, p.organization_id)"));
  assert(b.includes("public.btpm_decrypt(w.name, w.organization_id)"));
  assert(b.includes("FROM public.programs pr WHERE pr.id = p.program_id"));
  assert(b.includes("CASE WHEN p.program_id IS NULL THEN NULL"), "NULL behavior");
});

Deno.test("C20B2: BTPM context links semantics preserved and use v_caller", () => {
  const b = BODIES.get("list_governance_record_btpm_context_links")!;
  assert(b.includes("public.has_project_access(v_caller, l.source_project_id)"));
  assert(!b.includes("has_project_access(auth.uid()"));
  assert(b.includes("(_include_archived OR l.archived_at IS NULL)"), "archive filter");
  assert(
    b.includes(
      "ORDER BY archived_sort, sp_name_v, relevance_sort, object_type_v, created_at_v DESC",
    ),
    "ordering",
  );
  assert(b.includes("'[]'::jsonb"), "empty fallback");
  for (
    const key of [
      "'relationship_type'",
      "'relevance_level'",
      "'context_reason'",
      "'included_in_package'",
      "'source_project_name'",
      "'source_workspace_name'",
      "'source_program_id'",
      "'source_program_name'",
      "'source_project_status'",
      "'source_project_priority'",
      "'object_name'",
      "'object_status'",
    ]
  ) assert(b.includes(key), `context ${key}`);
});

Deno.test("C20B2: cross-project links semantics preserved and use v_caller", () => {
  const b = BODIES.get("list_governance_record_cross_project_links")!;
  assert(b.includes("public.has_project_access(v_caller, l.linked_project_id)"));
  assert(!b.includes("has_project_access(auth.uid()"));
  assert(b.includes("(_include_archived OR l.archived_at IS NULL)"), "archive filter");
  assert(
    b.includes("ORDER BY archived_sort, relationship_type, created_at_v DESC"),
    "ordering",
  );
  assert(b.includes("'[]'::jsonb"), "empty fallback");
  for (
    const key of [
      "'linked_project_id'",
      "'linked_project_workspace_id'",
      "'relationship_reason'",
      "'source_dependency_id'",
      "'linked_project_name'",
      "'linked_project_status'",
      "'linked_project_priority'",
      "'linked_project_workspace_name'",
      "'linked_project_program_id'",
      "'linked_project_program_name'",
    ]
  ) assert(b.includes(key), `cross ${key}`);
});

Deno.test("C20B2: copilot data packages keep ZIP/bundle fields and v_caller scoping", () => {
  const b = BODIES.get("list_governance_record_copilot_data_packages")!;
  assert(b.includes("public.has_project_access(v_caller, sp.id)"));
  assert(!b.includes("has_project_access(auth.uid()"));
  assert(b.includes("ORDER BY current_sort, version_number_v DESC"), "ordering");
  assert(b.includes("'[]'::jsonb"), "empty fallback");
  for (
    const key of [
      "'package_status'",
      "'package_filename'",
      "'package_json'",
      "'package_hash'",
      "'source_project_ids'",
      "'source_snapshot_at'",
      "'downloaded_at'",
      "'downloaded_by'",
      "'package_format'",
      "'bundle_status'",
      "'bundle_filename'",
      "'bundle_mime_type'",
      "'bundle_size_bytes'",
      "'bundle_hash'",
      "'bundle_generated_at'",
      "'bundle_file_count'",
      "'bundle_packaged_file_count'",
      "'bundle_failed_file_count'",
      "'bundle_metadata_only_count'",
      "'bundle_downloaded_at'",
      "'bundle_downloaded_by'",
    ]
  ) assert(b.includes(key), `package ${key}`);
  assert(b.includes("public.btpm_decrypt(p.package_filename, p.organization_id)"));
  assert(b.includes("public.btpm_decrypt(p.package_json, p.organization_id)"));
});

Deno.test("C20B2: AI run bounding, ordering and field set preserved", () => {
  const b = BODIES.get("list_decision_case_ai_runs")!;
  assert(b.includes("ORDER BY r.started_at DESC"), "ordering");
  assert(b.includes("LIMIT 50"), "bounding");
  assert(b.includes("ORDER BY started_at_v DESC"), "aggregate ordering");
  assert(b.includes("'[]'::jsonb"), "empty fallback");
  for (
    const key of [
      "'status'",
      "'run_type'",
      "'model_provider'",
      "'model_id'",
      "'model_source'",
      "'reasoning_effort'",
      "'template_id'",
      "'template_version'",
      "'files_selected_count'",
      "'files_sent_count'",
      "'files_skipped_count'",
      "'total_bytes_sent'",
      "'error_code'",
      "'brief_version_id'",
      "'started_by'",
      "'started_by_display'",
      "'started_at'",
      "'completed_at'",
      "'saved_at'",
      "'discarded_at'",
    ]
  ) assert(b.includes(key), `ai run ${key}`);
  assert(!b.includes("'error_message'"), "no newly exposed error_message");
});

Deno.test("C20B2: generated-document optional filter, fields and ordering preserved", () => {
  const b = BODIES.get("list_generated_decision_case_documents")!;
  assert(
    b.includes("(_document_type IS NULL OR g.document_type = _document_type)"),
    "optional filter",
  );
  assert(b.includes("ORDER BY g.generated_at DESC"), "ordering");
  assert(b.includes("'[]'::jsonb"), "empty fallback");
  for (
    const key of [
      "'document_type'",
      "'generation_status'",
      "'output_filename'",
      "'generated_at'",
      "'generated_by'",
      "'source_snapshot_at'",
      "'sharepoint_publish_status'",
      "'sharepoint_item_id'",
      "'sharepoint_web_url'",
      "'error_note'",
    ]
  ) assert(b.includes(key), `doc ${key}`);
});

Deno.test("C20B2: no GRANT/REVOKE, exactly six functions, no schema/DML drift", () => {
  assert(!/\bGRANT\b/i.test(sql), "no GRANT");
  assert(!/\bREVOKE\b/i.test(sql), "no REVOKE");
  assertEquals((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 6);
  for (const t of TARGETS) {
    assertEquals(
      sql.split(`CREATE OR REPLACE FUNCTION public.${t}(`).length - 1,
      1,
      `${t} redefined once`,
    );
  }
  assert(!/CREATE (TABLE|POLICY|TRIGGER|TYPE|INDEX)/i.test(sql));
  assert(!/ALTER (TABLE|TYPE|PUBLICATION)/i.test(sql));
  assert(!/\b(INSERT INTO|DELETE FROM)\b/i.test(sql));
  assert(!/CREATE OR REPLACE FUNCTION public\.(btpm_encrypt|btpm_decrypt|_gov_assert)/i.test(sql));
  assert(!/_gov_report_assert_scope|report_governance|pbi_/i.test(sql));
  assert(!/mark_governance_record_copilot_data_package_downloaded|set_current_governance_record_copilot_data_package/i.test(sql));
});

Deno.test("C20B2: special-runtime callers remain caller-scoped and unchanged", async () => {
  const cases: Array<[string, string[]]> = [
    [
      "supabase/functions/generate-decision-case-data-package/index.ts",
      ["list_governance_record_btpm_context_links", "get_governance_decision_case_project_summary"],
    ],
    [
      "supabase/functions/generate-decision-case-data-package-bundle/index.ts",
      [
        "list_governance_record_btpm_context_links",
        "get_governance_decision_case_project_summary",
        "list_decision_case_ai_runs",
      ],
    ],
  ];
  for (const [path, rpcs] of cases) {
    const src = await Deno.readTextFile(path);
    for (const rpc of rpcs) {
      assert(
        new RegExp(`userClient\\.rpc\\(\\s*"${rpc}"`).test(src),
        `${path}: ${rpc} must use userClient`,
      );
      assert(
        !new RegExp(`(admin|service)\\w*\\.rpc\\(\\s*"${rpc}"`).test(src),
        `${path}: ${rpc} must not use an admin client`,
      );
    }
  }
  for (
    const path of [
      "supabase/functions/generate-decision-case-word-brief/dataMapper.ts",
      "supabase/functions/generate-decision-case-ppt-onepager/dataMapper.ts",
    ]
  ) {
    const src = await Deno.readTextFile(path);
    assert(
      /callerClient\.rpc\(\s*\n?\s*"list_governance_record_cross_project_links"/.test(src),
      `${path}: cross-project links must use callerClient`,
    );
    assert(
      !/adminClient\.rpc\(\s*\n?\s*"list_governance_record_cross_project_links"/.test(src),
      `${path}: must not use adminClient`,
    );
  }
  const aiBrief = await Deno.readTextFile(
    "supabase/functions/generate-decision-case-ai-brief/index.ts",
  );
  assert(
    /userClient\.rpc\(\s*"list_governance_record_btpm_context_links"/.test(aiBrief),
    "ai-brief caller-scoped",
  );
});
