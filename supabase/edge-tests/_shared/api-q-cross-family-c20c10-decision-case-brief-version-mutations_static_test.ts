/**
 * API-Q Cross-Family-C20C10 — static/contract test.
 *
 * Proves the two native browser Decision Case Brief Version mutation RPCs
 * adopt the accepted C20 browser boundary (fail-closed OAuth gate → single
 * active v_caller → authoritative lookup → Project write authority → Decision
 * Case kind validation → business logic) while preserving all existing
 * versioning, encryption-trigger and activity semantics.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820123935_d9ce25fb-3427-4884-a409-d1b75e3402b0.sql";
const HOOK = "src/hooks/useGovernanceBriefVersions.ts";

const sql = await Deno.readTextFile(MIGRATION);
const hook = await Deno.readTextFile(HOOK);

const CREATE = "create_governance_record_brief_version";
const SET_CURRENT = "set_current_governance_record_brief_version";

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
const BODIES: Array<[string, string]> = [["create", createBody], ["set_current", setBody]];

Deno.test("C20C10: exactly the two mutation RPCs are redefined", () => {
  const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assertEquals(defs.sort(), [CREATE, SET_CURRENT].sort());
});

Deno.test("C20C10: list RPC is untouched", () => {
  assert(!sql.includes("list_governance_record_brief_versions"));
});

Deno.test("C20C10: signatures, defaults and return shapes unchanged", () => {
  assert(
    sql.includes(
      `public.${CREATE}(_record_id uuid, _source_type text DEFAULT 'copilot_paste'::text, _raw_copilot_output text DEFAULT NULL::text, _edited_brief_text text DEFAULT NULL::text, _executive_intro_text text DEFAULT NULL::text, _options_summary text DEFAULT NULL::text, _recommendation_text text DEFAULT NULL::text, _guardrails_text text DEFAULT NULL::text, _residual_risks_text text DEFAULT NULL::text, _requested_decision_text text DEFAULT NULL::text, _make_current boolean DEFAULT true)`,
    ),
    "create signature preserved",
  );
  assert(createBody.includes("RETURNS jsonb"), "create returns jsonb");
  assert(
    createBody.includes("RETURN jsonb_build_object('id', _id, 'version_number', _next);"),
    "create return shape preserved",
  );
  assert(sql.includes(`public.${SET_CURRENT}(_brief_version_id uuid)`), "set signature preserved");
  assert(setBody.includes("RETURNS void"), "set returns void");
  for (const [name, body] of BODIES) {
    assert(body.includes("SECURITY DEFINER"), `${name}: SECURITY DEFINER`);
    assert(
      body.includes("SET search_path TO 'public', 'extensions'"),
      `${name}: search_path preserved`,
    );
  }
});

Deno.test("C20C10: fail-closed OAuth/client gate precedes auth.uid() and lookups", () => {
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
    const uid = body.indexOf("auth.uid()");
    const select = body.indexOf("SELECT * INTO");
    assert(uid > reject, `${name}: caller resolution after gate`);
    assert(select > reject, `${name}: protected lookup after gate`);
  }
});

Deno.test("C20C10: auth.uid() resolved exactly once into an active v_caller", () => {
  for (const [name, body] of BODIES) {
    assertEquals(
      body.split("auth.uid()").length - 1,
      1,
      `${name}: auth.uid() used exactly once`,
    );
    assert(body.includes("v_caller := auth.uid();"), `${name}: v_caller assignment`);
    assert(
      body.includes(
        "IF v_caller IS NULL OR NOT public.is_active_user(v_caller) THEN\n    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';",
      ),
      `${name}: active-user validation`,
    );
  }
});

Deno.test("C20C10: Project write authority precedes Decision Case kind validation and writes", () => {
  for (const [name, body] of BODIES) {
    const lookup = body.indexOf("SELECT * INTO");
    const authority = body.indexOf("PERFORM public._gov_assert_project_write(_row.project_id);");
    const kind = body.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
    assert(authority > lookup, `${name}: authority after authoritative lookup`);
    assert(kind > authority, `${name}: kind validation after authority`);
    for (const w of ["UPDATE public.governance_record_brief_versions"]) {
      assert(body.indexOf(w) > authority, `${name}: writes after authority`);
    }
    const activity = body.indexOf("public.log_activity_event(");
    assert(activity > authority, `${name}: activity after authority`);
  }
  assert(
    createBody.indexOf("INSERT INTO public.governance_record_brief_versions") >
      createBody.indexOf("PERFORM public._gov_assert_project_write"),
    "create: insert after authority",
  );
});

Deno.test("C20C10: CREATE source/content/version/current semantics preserved", () => {
  assert(
    createBody.includes("_source_type NOT IN ('copilot_paste','manual_edit','btpm_generated')"),
    "source_type allowed values",
  );
  assert(
    createBody.includes("RAISE EXCEPTION 'At least one brief field is required'"),
    "content validation",
  );
  assert(
    createBody.includes("SELECT COALESCE(MAX(version_number), 0) + 1 INTO _next"),
    "version-number resolution",
  );
  assert(createBody.includes("COALESCE(_make_current, true)"), "_make_current default behavior");
  assert(
    createBody.includes(
      "SET is_current = false, updated_by = v_caller, updated_at = now()\n      WHERE governance_record_id = _record_id AND is_current = true;",
    ),
    "existing-current demotion",
  );
  for (
    const f of [
      "raw_copilot_output",
      "edited_brief_text",
      "executive_intro_text",
      "options_summary",
      "recommendation_text",
      "guardrails_text",
      "residual_risks_text",
      "requested_decision_text",
    ]
  ) {
    assert(createBody.includes(f), `field ${f} retained`);
  }
  assert(
    createBody.includes("'governance_record_brief_version_created'"),
    "activity event preserved",
  );
});

Deno.test("C20C10: SET CURRENT current-version semantics preserved", () => {
  assert(
    setBody.includes(
      "WHERE governance_record_id = _v.governance_record_id AND is_current = true AND id <> _brief_version_id;",
    ),
    "sibling demotion preserved",
  );
  assert(
    setBody.includes(
      "SET is_current = true, updated_by = v_caller, updated_at = now()\n    WHERE id = _brief_version_id;",
    ),
    "selected version promoted",
  );
  assert(!/DELETE\s+FROM/i.test(setBody), "no deletion");
  assert(
    setBody.includes("'governance_record_brief_version_set_current'"),
    "activity event preserved",
  );
  assert(setBody.includes("'version_number', _v.version_number"), "activity metadata preserved");
});

Deno.test("C20C10: v_caller used for authorship and activity actor", () => {
  assert(createBody.includes("v_caller, v_caller\n  ) RETURNING id INTO _id;"), "created_by/updated_by");
  for (const [name, body] of BODIES) {
    assert(
      /log_activity_event\(_row\.organization_id, v_caller,/.test(body),
      `${name}: activity actor is v_caller`,
    );
    assert(!body.includes("updated_by = auth.uid()"), `${name}: no raw auth.uid() authorship`);
  }
});

Deno.test("C20C10: encryption trigger and schema untouched; no manual crypto", () => {
  for (
    const forbidden of [
      "btpm_encrypt",
      "btpm_decrypt",
      "trg_encrypt_governance_record_brief_versions",
      "ALTER TABLE",
      "CREATE TABLE",
      "CREATE TRIGGER",
      "DROP ",
      "GRANT ",
      "REVOKE ",
      "CREATE POLICY",
      "CREATE INDEX",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

Deno.test("C20C10: no MCP/external/trusted/service-role bypass", () => {
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

Deno.test("C20C10: frontend RPC contract unchanged", () => {
  assert(hook.includes(`"${CREATE}"`), "hook calls create RPC");
  assert(hook.includes(`"${SET_CURRENT}"`), "hook calls set-current RPC");
  assert(hook.includes("_record_id: recordId"), "create payload unchanged");
  assert(hook.includes("_brief_version_id: id"), "set-current payload unchanged");
  assert(
    hook.includes("data as unknown as { id: string; version_number: number }"),
    "create return contract unchanged",
  );
});

Deno.test("C20C10: no unrelated Governance family touched", () => {
  for (
    const forbidden of [
      "stakeholder_package",
      "copilot_data_package",
      "ai_run",
      "generated_operational_documents",
      "cross_project_link",
      "btpm_context_link",
      "evidence_",
      "decision_outcome",
      "cadence",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
});
