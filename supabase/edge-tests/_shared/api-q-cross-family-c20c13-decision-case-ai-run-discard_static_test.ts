// C20C13 — Decision Case AI Run Discard Mutation: browser OAuth / caller authority boundary.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260820130513_4442a89d-2bf5-49ef-8640-49ecf27947c1.sql",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION);
const idx = (needle: string) => sql.indexOf(needle);

Deno.test("C20C13: only mark_decision_case_ai_run_discarded is redefined", () => {
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_]+\.[a-z_0-9]+)/gi)].map((m) =>
    m[1]
  );
  assertEquals(fns, ["public.mark_decision_case_ai_run_discarded"]);
});

Deno.test("C20C13: signature and RETURNS void unchanged", () => {
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.mark_decision_case_ai_run_discarded(_ai_run_id uuid)",
    ),
  );
  assert(/RETURNS void/.test(sql));
});

Deno.test("C20C13: SECURITY DEFINER and search_path unchanged", () => {
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path TO 'public', 'extensions'"));
});

Deno.test("C20C13: fail-closed jwt_client_id gate rejects non-NULL client with 42501", () => {
  assert(sql.includes("v_client_id := api_e_private.jwt_client_id();"));
  assert(sql.includes("EXCEPTION WHEN OTHERS THEN"));
  assert(sql.includes("v_client_id := 'unresolved_client';"));
  const gate = sql.indexOf("IF v_client_id IS NOT NULL THEN");
  assert(gate > 0);
  const raise = sql.indexOf("RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';", gate);
  assert(raise > gate);
});

Deno.test("C20C13: client gate precedes auth.uid() and AI-run lookup", () => {
  const gate = idx("v_client_id := api_e_private.jwt_client_id()");
  const uid = idx("auth.uid()");
  const run = idx("FROM public.decision_case_ai_runs WHERE id = _ai_run_id");
  assert(gate < uid);
  assert(gate < run);
});

Deno.test("C20C13: auth.uid() appears exactly once and v_caller is active-checked", () => {
  assertEquals(sql.split("auth.uid()").length - 1, 1);
  assert(sql.includes("v_caller := auth.uid();"));
  assert(
    sql.includes("IF v_caller IS NULL OR NOT public.is_active_user(v_caller) THEN"),
  );
  assert(sql.includes("RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';"));
});

Deno.test("C20C13: authority order run -> parent -> project write -> business state", () => {
  const run = idx("SELECT * INTO _run FROM public.decision_case_ai_runs");
  const parent = idx("SELECT * INTO _row FROM public.governance_records");
  const authority = idx("public._gov_assert_project_write(_row.project_id)");
  const status = idx("IF _run.status <> 'completed' THEN");
  const brief = idx("IF _run.brief_version_id IS NOT NULL THEN");
  assert(run > 0 && parent > run && authority > parent);
  assert(authority < status);
  assert(authority < brief);
  assert(sql.includes("RAISE EXCEPTION 'AI run not found' USING ERRCODE='P0002'"));
  assert(sql.includes("RAISE EXCEPTION 'Parent record not found' USING ERRCODE='P0002'"));
});

Deno.test("C20C13: discard rules unchanged", () => {
  assert(
    sql.includes(
      "RAISE EXCEPTION 'AI run is not in a discardable state (status=%)', _run.status USING ERRCODE='22023';",
    ),
  );
  assert(
    sql.includes(
      "RAISE EXCEPTION 'AI run is already linked to a brief version' USING ERRCODE='22023';",
    ),
  );
});

Deno.test("C20C13: update mutates only status/discarded_at/updated_at", () => {
  const m = sql.match(
    /UPDATE public\.decision_case_ai_runs\s+SET([\s\S]*?)WHERE id = _ai_run_id;/,
  );
  assert(m, "update block not found");
  const setClause = m![1];
  const cols = [...setClause.matchAll(/([a-z_]+)\s*=/g)].map((x) => x[1]);
  assertEquals(cols.sort(), ["discarded_at", "status", "updated_at"]);
  assert(setClause.includes("'discarded'"));
});

Deno.test("C20C13: activity event unchanged and actor is v_caller", () => {
  assert(
    sql.includes(
      "PERFORM public.log_activity_event(_row.organization_id, v_caller,\n    'decision_case_ai_run_discarded', 'governance_record', _row.id,",
    ),
  );
  assert(
    sql.includes(
      "jsonb_build_object('project_id', _row.project_id, 'ai_run_id', _ai_run_id)",
    ),
  );
  for (const leak of ["model", "prompt", "generated", "error_message", "file_name", "evidence"]) {
    assert(!sql.includes(`'${leak}'`), `activity must not carry ${leak}`);
  }
});

Deno.test("C20C13: no schema/RLS/grant/trigger/encryption change and no bypass", () => {
  for (
    const forbidden of [
      "ALTER TABLE",
      "CREATE TABLE",
      "CREATE POLICY",
      "DROP POLICY",
      "GRANT ",
      "REVOKE ",
      "CREATE TRIGGER",
      "CREATE INDEX",
      "btpm_encrypt",
      "btpm_decrypt",
      "service_role",
      "client_credentials",
      "trusted",
      "mcp",
      "api_capability",
    ]
  ) {
    assert(!sql.toLowerCase().includes(forbidden.toLowerCase()), `unexpected: ${forbidden}`);
  }
});

Deno.test("C20C13: frontend service and hook still call this RPC", async () => {
  const svc = await Deno.readTextFile(
    new URL("../../../src/lib/decisionCaseAiBriefService.ts", import.meta.url),
  );
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useDecisionCaseAiRuns.ts", import.meta.url),
  );
  assert(svc.includes('"mark_decision_case_ai_run_discarded"'));
  assert(svc.includes("export async function discardDecisionCaseAiRun"));
  assert(hook.includes("export function useDiscardDecisionCaseAiRun"));
  assert(hook.includes("discardDecisionCaseAiRun(aiRunId)"));
});
