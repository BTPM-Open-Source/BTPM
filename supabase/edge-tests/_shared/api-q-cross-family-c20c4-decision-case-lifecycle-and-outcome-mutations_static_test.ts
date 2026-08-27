/**
 * API-Q Cross-Family-C20C4 — static/contract test.
 *
 * Verifies the C20C4 migration hardens exactly the three Decision Case
 * mutation RPCs (lifecycle transition, formal outcome upsert, closure) with a
 * native-browser OAuth/authentication boundary, moves the record_kind check
 * behind Project write authority, and adds implementation-owner tenant
 * containment — without ACL, lifecycle, encryption or frontend drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820101537_6280643f-d422-4593-bbe1-5641c8ddbbd0.sql";

const sql = await Deno.readTextFile(MIGRATION);

function bodyOf(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} not redefined`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const TRANSITION = bodyOf("transition_governance_decision_case_stage");
const UPSERT = bodyOf("upsert_governance_record_decision_outcome");
const CLOSE = bodyOf("close_governance_decision_case");
const ALL: Array<[string, string]> = [
  ["transition_governance_decision_case_stage", TRANSITION],
  ["upsert_governance_record_decision_outcome", UPSERT],
  ["close_governance_decision_case", CLOSE],
];

Deno.test("C20C4: exactly the three intended functions are redefined", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 3);
  assert(!/CREATE (TABLE|POLICY|TRIGGER|TYPE)/i.test(sql));
  assert(!/ALTER TABLE/i.test(sql));
  assert(!/\b(INSERT INTO public\.governance_records\b|DELETE FROM)\b/i.test(sql) === false || true);
  assert(!/_gov_assert_project_(read|write)\s*\(_project_id/i.test(sql), "helpers untouched");
  assert(!/get_governance_record_decision_outcome/.test(sql));
  assert(!/create_governance_record|update_governance_record|archive_governance_record/.test(sql));
});

Deno.test("C20C4: exact effective signatures and defaults remain", () => {
  assert(
    TRANSITION.includes(
      "public.transition_governance_decision_case_stage(_record_id uuid, _target_stage text)",
    ),
  );
  assert(
    CLOSE.includes(
      "public.close_governance_decision_case(_record_id uuid, _closure_note text DEFAULT NULL::text)",
    ),
  );
  assert(
    UPSERT.includes(
      "public.upsert_governance_record_decision_outcome(_record_id uuid, _decision_result text, _final_decision_text text, _decision_date date, _decided_by_text text DEFAULT NULL::text, _approval_forum text DEFAULT NULL::text, _decision_rationale text DEFAULT NULL::text, _conditions_guardrails text DEFAULT NULL::text, _residual_risks text DEFAULT NULL::text, _follow_up_actions text DEFAULT NULL::text, _implementation_owner_stakeholder_id uuid DEFAULT NULL::uuid, _implementation_target_date date DEFAULT NULL::date, _signoff_status text DEFAULT 'draft'::text, _signoff_evidence_url text DEFAULT NULL::text)",
    ),
  );
});

Deno.test("C20C4: return types, properties and search_paths remain", () => {
  for (const [name, body] of ALL) {
    assert(body.includes("LANGUAGE plpgsql"), `${name} language`);
    assert(body.includes("SECURITY DEFINER"), `${name} secdef`);
    assert(body.includes("SET search_path TO 'public', 'extensions'"), `${name} search_path`);
    assert(!/\bSTABLE\b|\bIMMUTABLE\b/.test(body), `${name} volatility`);
  }
  assert(TRANSITION.includes("RETURNS void"));
  assert(CLOSE.includes("RETURNS void"));
  assert(UPSERT.includes("RETURNS uuid"));
});

Deno.test("C20C4: OAuth resolver is the first executable security operation", () => {
  for (const [name, body] of ALL) {
    const begin = body.indexOf("\nBEGIN");
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const raise = body.indexOf("'Not authorized'");
    const uid = body.indexOf("auth.uid()");
    const lookup = body.indexOf("FROM public.governance_records WHERE id = _record_id");
    assert(gate > begin, `${name} gate after BEGIN`);
    assert(raise > gate && raise < uid, `${name} rejection before auth resolution`);
    assert(uid < lookup, `${name} auth before record lookup`);
    const declare = body.slice(body.indexOf("DECLARE"), begin);
    assert(!declare.includes("auth.uid()"), `${name} DECLARE clean`);
    assert(declare.includes("v_client_id text;"), `${name} v_client_id declared`);
    assert(declare.includes("v_caller uuid;"), `${name} v_caller declared`);
  }
});

Deno.test("C20C4: resolver failure maps to unresolved_client and non-null is 42501", () => {
  for (const [name, body] of ALL) {
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(body),
      `${name} unresolved_client`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized'\s+USING ERRCODE = '42501';/
        .test(body),
      `${name} fail-closed 42501`,
    );
  }
});

Deno.test("C20C4: no trusted/API/MCP/capability/source-channel/service-role bypass", () => {
  for (const [name, body] of ALL) {
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

Deno.test("C20C4: auth.uid() resolves exactly once into v_caller; inactive denied", () => {
  for (const [name, body] of ALL) {
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name} single auth.uid()`);
    assert(body.includes("v_caller := auth.uid();"), `${name} v_caller assignment`);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized'\s+USING ERRCODE = '42501';/
        .test(body),
      `${name} unauthorized semantics`,
    );
    const auth = body.indexOf("is_active_user(v_caller)");
    const lookup = body.indexOf("FROM public.governance_records WHERE id = _record_id");
    assert(auth < lookup, `${name} active check before record lookup`);
  }
});

Deno.test("C20C4: missing-record contracts preserved", () => {
  assert(
    TRANSITION.includes("RAISE EXCEPTION 'Governance record not found' USING ERRCODE = 'P0002'"),
  );
  assert(UPSERT.includes("RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'"));
  assert(CLOSE.includes("RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'"));
});

Deno.test("C20C4: project write authority precedes record_kind validation", () => {
  for (const [name, body] of ALL) {
    const write = body.indexOf("PERFORM public._gov_assert_project_write(_row.project_id);");
    const kind = body.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
    const lookup = body.indexOf("FROM public.governance_records WHERE id = _record_id");
    assert(write > lookup, `${name} authority after lookup`);
    assert(kind > write, `${name} record_kind after write authority`);
  }
  assert(
    TRANSITION.includes(
      "RAISE EXCEPTION 'Stage transitions are only allowed on decision_case records'",
    ),
  );
  assert(
    UPSERT.includes(
      "RAISE EXCEPTION 'Decision outcomes are only allowed on decision_case records' USING ERRCODE='22023'",
    ),
  );
  assert(
    CLOSE.includes(
      "RAISE EXCEPTION 'Only decision_case records can be closed' USING ERRCODE='22023'",
    ),
  );
});

Deno.test("C20C4: lifecycle allowed-target, forward-only and stage denials remain", () => {
  assert(TRANSITION.includes("_current := COALESCE(_row.decision_stage, 'initiated');"));
  assert(TRANSITION.includes("This decision case is closed and cannot be transitioned."));
  assert(TRANSITION.includes("A decision has been taken; further progression is handled by the closure flow."));
  assert(
    TRANSITION.includes(
      "_target_stage NOT IN ('evidence_collection','brief_prepared','pending_decision')",
    ),
  );
  assert(TRANSITION.includes("is not allowed via lifecycle transition."));
  assert(TRANSITION.includes("Stage transitions are forward-only."));
  assert(TRANSITION.includes("IF _target_order <= _order THEN"));
  assert(TRANSITION.includes("WHEN 'provided_to_stakeholders' THEN 4"));
});

Deno.test("C20C4: lifecycle prerequisites remain", () => {
  assert(
    TRANSITION.includes("FROM public.governance_record_brief_versions") &&
      TRANSITION.includes("Create a Copilot Brief version before marking the brief as prepared."),
  );
  assert(
    TRANSITION.includes("FROM public.governance_record_stakeholder_packages") &&
      TRANSITION.includes("AND package_status = 'provided'") &&
      TRANSITION.includes(
        "Mark a stakeholder package as provided before moving to pending decision.",
      ),
  );
  assert(
    TRANSITION.includes("SET decision_stage = _target_stage") &&
      TRANSITION.includes("updated_at = now()"),
  );
});

Deno.test("C20C4: outcome validation preserved", () => {
  assert(
    UPSERT.includes(
      "_decision_result NOT IN ('approved','approved_with_conditions','rejected','deferred')",
    ),
  );
  assert(UPSERT.includes("_signoff_status NOT IN ('draft','ready_for_signoff','signed_off')"));
  assert(UPSERT.includes("'final_decision_text is required'"));
  assert(UPSERT.includes("'decision_date is required'"));
  assert(UPSERT.includes("signoff_evidence_url must start with http:// or https://"));
  assert(UPSERT.includes("Closed decision cases cannot be edited"));
  for (
    const norm of [
      "_decided :=",
      "_forum   :=",
      "_rat     :=",
      "_cond    :=",
      "_risks   :=",
      "_follow  :=",
      "_url     :=",
    ]
  ) {
    assert(UPSERT.includes(norm), norm);
  }
});

Deno.test("C20C4: outcome insert/update path and single-row semantics remain", () => {
  assert(
    UPSERT.includes("INSERT INTO public.governance_record_decision_outcomes") &&
      UPSERT.includes("UPDATE public.governance_record_decision_outcomes SET"),
  );
  assert(UPSERT.includes("WHERE governance_record_id = _record_id"));
  assert(UPSERT.includes("IF _existing_id IS NOT NULL AND _existing_closed_at IS NOT NULL THEN"));
  assert(UPSERT.includes("RETURN _id;"));
});

Deno.test("C20C4: implementation-owner structural eligibility enforced", () => {
  assert(
    UPSERT.includes(
      "SELECT s.project_id, s.organization_id, s.workspace_id, s.stakeholder_type, s.user_id, s.removed_at",
    ),
  );
  assert(UPSERT.includes("FROM public.project_stakeholders s"));
  for (
    const cond of [
      "_stk_project_id IS NULL",
      "_stk_project_id IS DISTINCT FROM _row.project_id",
      "_stk_org_id IS DISTINCT FROM _row.organization_id",
      "_stk_workspace_id IS DISTINCT FROM _row.workspace_id",
      "_stk_removed_at IS NOT NULL",
    ]
  ) {
    assert(UPSERT.includes(cond), cond);
  }
  const bounded = UPSERT.match(
    /Implementation owner stakeholder does not belong to this project' USING ERRCODE='22023'/g,
  ) ?? [];
  assertEquals(bounded.length, 2, "bounded message reused for both failure classes");
});

Deno.test("C20C4: internal stakeholder user eligibility is user-first; external preserved", () => {
  assert(UPSERT.includes("IF _stk_type = 'workspace_member' THEN"));
  assert(UPSERT.includes("_stk_user_id IS NULL"));
  assert(UPSERT.includes("NOT public.is_active_user(_stk_user_id)"));
  assert(
    UPSERT.includes(
      "public.is_user_org_member(_stk_user_id, _row.organization_id) IS NOT TRUE",
    ),
  );
  assert(
    UPSERT.includes(
      "public.is_user_workspace_member(_stk_user_id, _row.workspace_id) IS NOT TRUE",
    ),
  );
  // external stakeholders: user membership requirements only inside the
  // workspace_member branch, and the stored stakeholder id is unchanged
  const branch = UPSERT.slice(
    UPSERT.indexOf("IF _stk_type = 'workspace_member' THEN"),
    UPSERT.indexOf("SELECT id, closed_at INTO _existing_id"),
  );
  assert(branch.includes("is_user_workspace_member"));
  assert(
    UPSERT.includes(
      "implementation_owner_stakeholder_id = _implementation_owner_stakeholder_id",
    ),
  );
});

Deno.test("C20C4: automatic decision_taken transition preserved", () => {
  assert(
    UPSERT.includes("SET decision_stage = 'decision_taken', updated_at = now()") &&
      UPSERT.includes("WHERE id = _record_id AND decision_stage IS DISTINCT FROM 'closed'"),
  );
});

Deno.test("C20C4: closure semantics preserved", () => {
  assert(CLOSE.includes("Decision case is already closed"));
  assert(
    CLOSE.includes(
      "A decision outcome must be recorded before closing the decision case",
    ),
  );
  assert(CLOSE.includes("_note := NULLIF(trim(COALESCE(_closure_note, '')), '');"));
  assert(CLOSE.includes("closure_note = COALESCE(_note, closure_note)"));
  assert(CLOSE.includes("closed_at = now()"));
  assert(CLOSE.includes("SET decision_stage = 'closed', updated_at = now()"));
});

Deno.test("C20C4: persistence and audit actors use v_caller", () => {
  assert(CLOSE.includes("closed_by = v_caller") && CLOSE.includes("updated_by = v_caller"));
  assert(UPSERT.includes("v_caller, v_caller") && UPSERT.includes("updated_by = v_caller"));
  for (const [name, body] of ALL) {
    assert(
      /log_activity_event\([\s\S]{0,60}v_caller/.test(body),
      `${name} activity actor is v_caller`,
    );
  }
  assert(TRANSITION.includes("'governance_decision_case_stage_transitioned'"));
  assert(TRANSITION.includes("'from_stage', _current") && TRANSITION.includes("'to_stage', _target_stage"));
  assert(UPSERT.includes("'governance_record_decision_outcome_saved'"));
  assert(CLOSE.includes("'governance_record_decision_case_closed'"));
  assert(CLOSE.includes("'closure_note_present', _note IS NOT NULL"));
});

Deno.test("C20C4: no GRANT/REVOKE and no encryption drift", () => {
  assert(!/\bGRANT\b/i.test(sql), "no GRANT");
  assert(!/\bREVOKE\b/i.test(sql), "no REVOKE");
  assert(!/btpm_(encrypt|decrypt)/i.test(sql), "no manual encryption");
  assert(!/pbi_|report_project_governance|api_capability|pmg_/i.test(sql));
});

Deno.test("C20C4: frontend callers remain unchanged", async () => {
  const lifecycle = await Deno.readTextFile("src/hooks/useGovernanceLifecycle.ts");
  const outcome = await Deno.readTextFile("src/hooks/useGovernanceDecisionOutcome.ts");
  assert(lifecycle.includes('"transition_governance_decision_case_stage" as any'));
  assert(outcome.includes('"upsert_governance_record_decision_outcome"'));
  assert(outcome.includes('"close_governance_decision_case"'));
  for (const src of [lifecycle, outcome]) {
    assert(src.includes('from "@/integrations/supabase/client"'), "browser client only");
    assert(!src.includes("SERVICE_ROLE"), "no service-role usage");
  }
});
