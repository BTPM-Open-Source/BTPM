/**
 * API-Q Cross-Family-C20C11 — static/contract test.
 *
 * Proves the three native browser Decision Case Stakeholder Package mutation
 * RPCs adopt the accepted C20 browser boundary (fail-closed OAuth gate →
 * single active v_caller → authoritative lookups → Project write authority →
 * Decision Case kind validation → business logic) while preserving the later
 * effective CREATE contract (draft/ready only, no direct provided creation,
 * no decision_stage transition), SET CURRENT semantics, MARK PROVIDED
 * lifecycle semantics, trigger-based encryption and activity semantics.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820125135_858de5d5-d7d9-4cdd-87cc-31d05c882487.sql";
const HOOK = "src/hooks/useGovernanceStakeholderPackages.ts";

const sql = await Deno.readTextFile(MIGRATION);
const hook = await Deno.readTextFile(HOOK);

const CREATE = "create_governance_record_stakeholder_package";
const SET_CURRENT = "set_current_governance_record_stakeholder_package";
const MARK = "mark_governance_record_stakeholder_package_provided";

function bodyOf(fn: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert(start >= 0, `${fn} redefined`);
  const rest = sql.slice(start);
  const end = rest.indexOf("END; $function$");
  assert(end > 0, `${fn} body terminated`);
  return rest.slice(0, end);
}

const createBody = bodyOf(CREATE);
const setBody = bodyOf(SET_CURRENT);
const markBody = bodyOf(MARK);
const BODIES: Array<[string, string]> = [
  ["create", createBody],
  ["set_current", setBody],
  ["mark_provided", markBody],
];

Deno.test("C20C11: exactly the three mutation RPCs are redefined", () => {
  const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assertEquals(defs.sort(), [CREATE, SET_CURRENT, MARK].sort());
});

Deno.test("C20C11: list RPC is untouched", () => {
  assert(!sql.includes("list_governance_record_stakeholder_packages"));
});

Deno.test("C20C11: effective signatures, defaults and return shapes preserved", () => {
  assert(
    sql.includes(
      `public.${CREATE}(_record_id uuid, _package_title text, _package_status text DEFAULT 'draft'::text, _audience_text text DEFAULT NULL::text, _executive_summary text DEFAULT NULL::text, _decision_question_text text DEFAULT NULL::text, _background_context text DEFAULT NULL::text, _options_summary text DEFAULT NULL::text, _recommendation_text text DEFAULT NULL::text, _decision_ask_text text DEFAULT NULL::text, _evidence_summary text DEFAULT NULL::text, _guardrails_text text DEFAULT NULL::text, _residual_risks_text text DEFAULT NULL::text, _next_steps_text text DEFAULT NULL::text, _distribution_note text DEFAULT NULL::text, _distribution_evidence_url text DEFAULT NULL::text, _make_current boolean DEFAULT true)`,
    ),
    "create signature preserved",
  );
  assert(createBody.includes("RETURNS jsonb"), "create returns jsonb");
  assert(
    createBody.includes("RETURN jsonb_build_object('id', _id, 'version_number', _next);"),
    "create return shape preserved",
  );
  assert(sql.includes(`public.${SET_CURRENT}(_package_id uuid)`), "set signature preserved");
  assert(setBody.includes("RETURNS void"), "set returns void");
  assert(
    sql.includes(
      `public.${MARK}(_package_id uuid, _distribution_note text DEFAULT NULL::text, _distribution_evidence_url text DEFAULT NULL::text)`,
    ),
    "mark signature preserved",
  );
  assert(markBody.includes("RETURNS void"), "mark returns void");
  for (const [name, body] of BODIES) {
    assert(body.includes("SECURITY DEFINER"), `${name}: SECURITY DEFINER`);
    assert(
      body.includes("SET search_path TO 'public', 'extensions'"),
      `${name}: search_path preserved`,
    );
  }
});

Deno.test("C20C11: CREATE keeps the later effective draft/ready-only behavior", () => {
  assert(
    createBody.includes("IF _package_status NOT IN ('draft','ready') THEN"),
    "draft/ready only",
  );
  assert(
    createBody.includes(
      "Use mark_governance_record_stakeholder_package_provided to mark a Stakeholder Package as provided.",
    ),
    "direct provided creation rejected with existing instruction",
  );
  assert(
    createBody.includes("NULL, NULL,\n    v_caller, v_caller"),
    "provided_to_stakeholders_at/by NULL on create",
  );
  assert(
    !createBody.includes("provided_to_stakeholders'"),
    "create performs no provided stage transition",
  );
  assert(
    !createBody.includes("UPDATE public.governance_records"),
    "create does not update decision_stage",
  );
  assert(createBody.includes("'package_title is required'"), "title validation preserved");
  assert(
    createBody.includes("distribution_evidence_url must start with http:// or https://"),
    "url validation preserved",
  );
  assert(
    createBody.includes("SELECT COALESCE(MAX(version_number), 0) + 1 INTO _next"),
    "version-number resolution",
  );
  assert(createBody.includes("COALESCE(_make_current, true)"), "_make_current behavior");
  assert(
    createBody.includes(
      "SET is_current = false, updated_by = v_caller, updated_at = now()\n      WHERE governance_record_id = _record_id AND is_current = true;",
    ),
    "existing-current demotion",
  );
  for (
    const f of [
      "audience_text",
      "package_title",
      "executive_summary",
      "decision_question_text",
      "background_context",
      "options_summary",
      "recommendation_text",
      "decision_ask_text",
      "evidence_summary",
      "guardrails_text",
      "residual_risks_text",
      "next_steps_text",
      "distribution_note",
      "distribution_evidence_url",
    ]
  ) {
    assert(createBody.includes(f), `field ${f} retained`);
  }
  assert(
    createBody.includes("'governance_record_stakeholder_package_created'"),
    "activity event preserved",
  );
});

Deno.test("C20C11: fail-closed OAuth/client gate precedes auth.uid() and lookups", () => {
  for (const [name, body] of BODIES) {
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    assert(gate > 0, `${name}: client gate present`);
    assert(
      body.includes("v_client_id := 'unresolved_client';"),
      `${name}: fail-closed on resolution error`,
    );
    const reject = body.indexOf(
      "IF v_client_id IS NOT NULL THEN\n    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';",
    );
    assert(reject > gate, `${name}: non-null client rejected with 42501`);
    assert(body.indexOf("auth.uid()") > reject, `${name}: caller resolution after gate`);
    assert(body.indexOf("SELECT * INTO") > reject, `${name}: protected lookup after gate`);
  }
});

Deno.test("C20C11: auth.uid() resolved exactly once into an active v_caller", () => {
  for (const [name, body] of BODIES) {
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name}: auth.uid() used once`);
    assert(body.includes("v_caller := auth.uid();"), `${name}: v_caller assignment`);
    assert(
      body.includes(
        "IF v_caller IS NULL OR NOT public.is_active_user(v_caller) THEN\n    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';",
      ),
      `${name}: active-user validation`,
    );
  }
});

Deno.test("C20C11: Project write authority precedes kind validation and all writes", () => {
  for (const [name, body] of BODIES) {
    const lookup = body.indexOf("SELECT * INTO");
    const authority = body.indexOf("PERFORM public._gov_assert_project_write(_row.project_id);");
    const kind = body.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
    assert(authority > lookup, `${name}: authority after authoritative lookup`);
    assert(kind > authority, `${name}: kind validation after authority`);
    for (
      const w of [
        "UPDATE public.governance_record_stakeholder_packages",
        "public.log_activity_event(",
      ]
    ) {
      const at = body.indexOf(w);
      assert(at > authority, `${name}: ${w} after authority`);
    }
  }
  assert(
    createBody.indexOf("INSERT INTO public.governance_record_stakeholder_packages") >
      createBody.indexOf("PERFORM public._gov_assert_project_write"),
    "create: insert after authority",
  );
  assert(
    markBody.indexOf("UPDATE public.governance_records") >
      markBody.indexOf("PERFORM public._gov_assert_project_write"),
    "mark: stage update after authority",
  );
  // parent record lookup precedes authority in the child-scoped RPCs
  for (const [name, body] of [["set_current", setBody], ["mark_provided", markBody]] as const) {
    assert(
      body.indexOf("FROM public.governance_records WHERE id = _p.governance_record_id") <
        body.indexOf("PERFORM public._gov_assert_project_write"),
      `${name}: parent record resolved before authority`,
    );
  }
});

Deno.test("C20C11: SET CURRENT semantics unchanged", () => {
  assert(
    setBody.includes(
      "WHERE governance_record_id = _p.governance_record_id AND is_current = true AND id <> _package_id;",
    ),
    "sibling demotion preserved",
  );
  assert(
    setBody.includes(
      "SET is_current = true, updated_by = v_caller, updated_at = now()\n    WHERE id = _package_id;",
    ),
    "selected package promoted",
  );
  assert(!setBody.includes("package_status ="), "no package-status change");
  assert(!setBody.includes("decision_stage"), "no decision-stage change");
  assert(!/DELETE\s+FROM/i.test(setBody), "no deletion");
  assert(
    setBody.includes("'governance_record_stakeholder_package_set_current'"),
    "activity event preserved",
  );
  assert(setBody.includes("'version_number', _p.version_number"), "activity metadata preserved");
});

Deno.test("C20C11: MARK PROVIDED is the sole provided-transition path with stage protection", () => {
  assert(markBody.includes("SET package_status = 'provided',"), "package_status provided");
  assert(markBody.includes("provided_to_stakeholders_at = now(),"), "provided timestamp");
  assert(
    markBody.includes("provided_to_stakeholders_by = v_caller,"),
    "provided-by is v_caller",
  );
  assert(
    markBody.includes("_dn  := NULLIF(trim(COALESCE(_distribution_note, '')), '');") &&
      markBody.includes("_url := NULLIF(trim(COALESCE(_distribution_evidence_url, '')), '');"),
    "distribution trimming preserved",
  );
  assert(
    markBody.includes("_url NOT LIKE 'http://%' AND _url NOT LIKE 'https://%'"),
    "url prefix validation preserved",
  );
  assert(
    markBody.includes("IF _row.decision_stage NOT IN ('decision_taken','closed') THEN"),
    "stage guard preserved",
  );
  assert(
    markBody.includes(
      "SET decision_stage = 'provided_to_stakeholders', updated_at = now()\n     WHERE id = _p.governance_record_id\n       AND decision_stage NOT IN ('decision_taken','closed');",
    ),
    "stage transition preserved with guarded predicate",
  );
  assert(
    markBody.includes("SET is_current = true, updated_by = v_caller, updated_at = now()"),
    "selected package becomes current",
  );
  assert(
    markBody.includes("is_current = true AND id <> _package_id;"),
    "siblings demoted",
  );
  assert(
    markBody.includes("'governance_record_stakeholder_package_provided'"),
    "activity event preserved",
  );
  // provided status is not settable from the other two RPCs
  assert(!createBody.includes("'provided'"), "create cannot set provided");
  assert(!setBody.includes("'provided'"), "set current cannot set provided");
});

Deno.test("C20C11: v_caller used for authorship and activity actor", () => {
  assert(
    createBody.includes("v_caller, v_caller\n  ) RETURNING id INTO _id;"),
    "created_by/updated_by",
  );
  for (const [name, body] of BODIES) {
    assert(
      /log_activity_event\(_row\.organization_id, v_caller,/.test(body),
      `${name}: activity actor is v_caller`,
    );
    assert(!body.includes("updated_by = auth.uid()"), `${name}: no raw auth.uid() authorship`);
    assert(
      !body.includes("provided_to_stakeholders_by = auth.uid()"),
      `${name}: no raw auth.uid() provided-by`,
    );
  }
});

Deno.test("C20C11: encryption trigger, schema, RLS and grants untouched", () => {
  for (
    const forbidden of [
      "btpm_encrypt",
      "btpm_decrypt",
      "trg_encrypt_governance_record_stakeholder_packages",
      "ALTER TABLE",
      "CREATE TABLE",
      "CREATE TRIGGER",
      "DROP ",
      "GRANT ",
      "REVOKE ",
      "CREATE POLICY",
      "CREATE INDEX",
      "CREATE UNIQUE",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

Deno.test("C20C11: no MCP/external/trusted/service-role bypass", () => {
  for (
    const forbidden of [
      "source_channel",
      "trusted_context",
      "connected_app",
      "mcp_",
      "service_role",
      "client_credentials",
      "capability",
    ]
  ) {
    assert(!sql.toLowerCase().includes(forbidden), `must not reference ${forbidden}`);
  }
});

Deno.test("C20C11: frontend RPC contract unchanged", () => {
  assert(hook.includes(`"${CREATE}"`), "hook calls create RPC");
  assert(hook.includes(`"${SET_CURRENT}"`), "hook calls set-current RPC");
  assert(hook.includes(`"${MARK}"`), "hook calls mark-provided RPC");
  assert(hook.includes("_record_id: recordId"), "create payload unchanged");
  assert(hook.includes("_package_id: id"), "set-current payload unchanged");
  assert(hook.includes("_package_id: input.package_id"), "mark payload unchanged");
  assert(
    hook.includes("data as unknown as { id: string; version_number: number }"),
    "create return contract unchanged",
  );
});

Deno.test("C20C11: no unrelated Governance family touched", () => {
  for (
    const forbidden of [
      "brief_version",
      "copilot_data_package",
      "ai_run",
      "generated_operational_documents",
      "cross_project_link",
      "btpm_context_link",
      "evidence_file",
      "evidence_reference",
      "decision_outcome",
      "cadence",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
});
