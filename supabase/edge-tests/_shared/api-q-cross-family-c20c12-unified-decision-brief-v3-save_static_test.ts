/**
 * API-Q Cross-Family-C20C12 — static/contract test.
 *
 * Proves the unified native-browser Decision Brief save RPC
 * (public.save_decision_brief_version_v3) adopts the accepted C20 browser
 * boundary (fail-closed OAuth gate → single active v_caller → authoritative
 * Governance Record lookup → Project write authority → Decision Case kind →
 * source_type → AI-run validation → content validation → versioning → writes)
 * while preserving the unified save contract, AI-run linkage semantics,
 * trigger-based encryption and activity semantics.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820125751_a50cda2b-4394-4bde-bfed-cf34b0d599f4.sql";
const SERVICE = "src/lib/decisionCaseAiBriefService.ts";

const sql = await Deno.readTextFile(MIGRATION);
const service = await Deno.readTextFile(SERVICE);

const FN = "save_decision_brief_version_v3";

const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
assert(start >= 0, `${FN} redefined`);
const body = sql.slice(start, sql.indexOf("END; $function$"));

Deno.test("C20C12: exactly the v3 save RPC is redefined", () => {
  const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assertEquals(defs, [FN]);
});

Deno.test("C20C12: signature, defaults, return type and definer context unchanged", () => {
  assert(
    sql.includes(
      `public.${FN}(_record_id uuid, _source_type text, _edited_brief_text text DEFAULT NULL::text, _make_current boolean DEFAULT true, _ai_run_id uuid DEFAULT NULL::uuid, _executive_intro_text text DEFAULT NULL::text, _options_summary text DEFAULT NULL::text, _requested_decision_text text DEFAULT NULL::text, _recommendation_text text DEFAULT NULL::text, _guardrails_text text DEFAULT NULL::text, _residual_risks_text text DEFAULT NULL::text, _open_questions_text text DEFAULT NULL::text, _confidence_level text DEFAULT NULL::text, _decision_readiness text DEFAULT NULL::text)`,
    ),
    "exact signature preserved",
  );
  assert(body.includes("RETURNS jsonb"), "returns jsonb");
  assert(body.includes("SECURITY DEFINER"), "SECURITY DEFINER");
  assert(body.includes("SET search_path TO 'public', 'extensions'"), "search_path preserved");
  assert(
    body.includes(
      "RETURN jsonb_build_object(\n    'brief_version_id', _id,\n    'version_number', _next,\n    'ai_run_id', _ai_run_id\n  );",
    ),
    "return keys preserved",
  );
});

Deno.test("C20C12: fail-closed OAuth/client gate precedes auth.uid() and lookups", () => {
  const gate = body.indexOf("api_e_private.jwt_client_id()");
  assert(gate > 0, "client gate present");
  assert(body.includes("v_client_id := 'unresolved_client';"), "fail-closed sentinel");
  const reject = body.indexOf(
    "IF v_client_id IS NOT NULL THEN\n    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';",
  );
  assert(reject > gate, "non-null client rejected with 42501");
  assert(body.indexOf("auth.uid()") > reject, "caller resolution after gate");
  assert(
    body.indexOf("SELECT * INTO _row FROM public.governance_records") > reject,
    "protected lookup after gate",
  );
});

Deno.test("C20C12: auth.uid() resolved exactly once into an active v_caller", () => {
  assertEquals(body.split("auth.uid()").length - 1, 1, "auth.uid() used exactly once");
  assert(body.includes("v_caller := auth.uid();"), "v_caller assignment");
  assert(
    body.includes(
      "IF v_caller IS NULL OR NOT public.is_active_user(v_caller) THEN\n    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';",
    ),
    "active-user validation",
  );
});

Deno.test("C20C12: authority order — lookup → project write → kind → source → AI run → writes", () => {
  const lookup = body.indexOf("SELECT * INTO _row FROM public.governance_records");
  const authority = body.indexOf("PERFORM public._gov_assert_project_write(_row.project_id);");
  const kind = body.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
  const src = body.indexOf("_src NOT IN ('btpm_generated','manual_edit','copilot_paste')");
  const runLookup = body.indexOf("FROM public.decision_case_ai_runs WHERE id = _ai_run_id");
  const runStatus = body.indexOf("_run.status NOT IN ('completed','saved')");
  const content = body.indexOf("'At least one brief field is required'");
  const version = body.indexOf("SELECT COALESCE(MAX(version_number), 0) + 1 INTO _next");
  const demote = body.indexOf("SET is_current = false, updated_by = v_caller");
  const insert = body.indexOf("INSERT INTO public.governance_record_brief_versions");
  const runUpdate = body.indexOf("UPDATE public.decision_case_ai_runs");
  const activity = body.indexOf("public.log_activity_event(");

  assert(authority > lookup, "authority after authoritative record lookup");
  for (
    const [label, at] of [
      ["record_kind", kind],
      ["source_type", src],
      ["ai run lookup", runLookup],
      ["ai run status validation", runStatus],
      ["content validation", content],
      ["version resolution", version],
      ["current demotion", demote],
      ["insert", insert],
      ["ai run saved update", runUpdate],
      ["activity", activity],
    ] as const
  ) {
    assert(at > authority, `${label} occurs after Project write authority`);
  }
  assert(kind < src && src < runLookup, "kind → source_type → AI run order");
  assert(runStatus < content, "AI-run validation before content validation");
  assert(version < demote && demote < insert, "versioning → demotion → insert");
  assert(insert < runUpdate && runUpdate < activity, "insert → AI-run update → activity");
});

Deno.test("C20C12: unified save validation behavior unchanged", () => {
  assert(
    body.includes("_src := NULLIF(trim(COALESCE(_source_type, '')), '');") &&
      body.includes("RAISE EXCEPTION 'Invalid source_type %', _source_type USING ERRCODE='22023';"),
    "source_type behavior preserved",
  );
  for (
    const t of [
      "_edited := NULLIF(trim(COALESCE(_edited_brief_text, '')), '');",
      "_intro  := NULLIF(trim(COALESCE(_executive_intro_text, '')), '');",
      "_opts   := NULLIF(trim(COALESCE(_options_summary, '')), '');",
      "_req    := NULLIF(trim(COALESCE(_requested_decision_text, '')), '');",
      "_rec    := NULLIF(trim(COALESCE(_recommendation_text, '')), '');",
      "_grd    := NULLIF(trim(COALESCE(_guardrails_text, '')), '');",
      "_rsk    := NULLIF(trim(COALESCE(_residual_risks_text, '')), '');",
      "_oq     := NULLIF(trim(COALESCE(_open_questions_text, '')), '');",
    ]
  ) {
    assert(body.includes(t), `trimming preserved: ${t.slice(0, 12)}`);
  }
  assert(
    body.includes("_conf NOT IN ('high','medium','low')"),
    "confidence_level allowed values",
  );
  assert(
    body.includes("_ready NOT IN ('ready_for_decision','needs_clarification','not_ready')"),
    "decision_readiness allowed values",
  );
  assert(body.includes("COALESCE(_make_current, true)"), "_make_current behavior");
  assert(
    body.includes(
      "SET is_current = false, updated_by = v_caller, updated_at = now()\n      WHERE governance_record_id = _record_id AND is_current = true;",
    ),
    "existing-current demotion preserved",
  );
  assert(!/DELETE\s+FROM/i.test(body), "old versions preserved (no deletion)");
});

Deno.test("C20C12: AI-run linkage and completed→saved semantics unchanged", () => {
  assert(body.includes("'AI run not found'"), "AI run existence check");
  assert(
    body.includes("IF _run.governance_record_id <> _record_id THEN"),
    "AI run record ownership check",
  );
  assert(
    body.includes("'AI run is not in a saveable state (status=%)'"),
    "saveable-state check preserved",
  );
  assert(
    body.includes("IF _ai_run_id IS NOT NULL AND _run.status = 'completed' THEN"),
    "only completed runs transition",
  );
  assert(
    body.includes(
      "SET status = 'saved',\n          saved_at = now(),\n          brief_version_id = _id,\n          updated_at = now()\n      WHERE id = _ai_run_id AND brief_version_id IS NULL;",
    ),
    "saved-state update and WHERE protection preserved",
  );
  assert(!body.includes("started_by"), "run ownership untouched");
});

Deno.test("C20C12: v_caller used for authorship and activity; metadata unchanged", () => {
  assert(body.includes("v_caller, v_caller\n  ) RETURNING id INTO _id;"), "created_by/updated_by");
  assert(
    body.includes("public.log_activity_event(_row.organization_id, v_caller,"),
    "activity actor is v_caller",
  );
  assert(
    body.includes("'governance_record_brief_version_created', 'governance_record', _record_id,"),
    "activity event preserved",
  );
  for (
    const k of [
      "'project_id', _row.project_id",
      "'brief_version_id', _id",
      "'version_number', _next",
      "'source_type', _src",
      "'is_current', COALESCE(_make_current, true)",
      "'ai_run_id', _ai_run_id",
      "'has_structured_fields', true",
      "'rpc', 'save_decision_brief_version_v3'",
    ]
  ) {
    assert(body.includes(k), `activity metadata ${k}`);
  }
  assert(!body.includes("'edited_brief_text', _edited"), "no plaintext brief in metadata");
});

Deno.test("C20C12: no manual crypto, no schema/RLS/grant/trigger changes", () => {
  for (
    const forbidden of [
      "btpm_encrypt",
      "btpm_decrypt",
      "ALTER TABLE",
      "CREATE TABLE",
      "CREATE TRIGGER",
      "DROP ",
      "GRANT ",
      "REVOKE ",
      "CREATE POLICY",
      "CREATE INDEX",
      "ALTER FUNCTION",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

Deno.test("C20C12: no MCP/external/trusted/service-role bypass", () => {
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

Deno.test("C20C12: frontend service still uses this RPC for AI and manual saves", () => {
  assert(service.includes("export async function saveAiDecisionBriefVersion"), "AI saver present");
  assert(
    service.includes("export async function saveManualDecisionBriefVersion"),
    "manual saver present",
  );
  assertEquals(
    service.split(`"${FN}"`).length - 1,
    2,
    "both savers call save_decision_brief_version_v3",
  );
});

Deno.test("C20C12: no unrelated Governance RPC redefined", () => {
  for (
    const forbidden of [
      "list_governance_record_brief_versions",
      "create_governance_record_brief_version",
      "set_current_governance_record_brief_version",
      "save_ai_decision_brief_version_v2",
      "mark_decision_case_ai_run_discarded",
      "stakeholder_package",
      "copilot_data_package",
      "generated_operational_documents",
      "cross_project_link",
      "btpm_context_link",
      "decision_outcome",
      "cadence",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
});
