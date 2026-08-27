// C20C14 — Decision Data Package state mutations: browser OAuth / caller authority boundary.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260820131248_a4eec6f3-5624-4c83-b6ab-8f90ab5a3924.sql",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION);

const MARK = "public.mark_governance_record_copilot_data_package_downloaded";
const SET = "public.set_current_governance_record_copilot_data_package";

function bodyOf(fq: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fq}(`);
  assert(start >= 0, `${fq} not redefined`);
  const end = sql.indexOf("END; $function$;", start);
  assert(end > start, `${fq} body not terminated`);
  return sql.slice(start, end);
}

const mark = bodyOf(MARK);
const set = bodyOf(SET);

Deno.test("C20C14: exactly the two mutation RPCs are redefined", () => {
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_]+\.[a-z_0-9]+)/gi)].map((m) =>
    m[1]
  );
  assertEquals(fns.sort(), [MARK, SET].sort());
  assert(!sql.includes("list_governance_record_copilot_data_packages"));
});

Deno.test("C20C14: signatures, RETURNS void, SECURITY DEFINER, search_path preserved", () => {
  assert(sql.includes(`CREATE OR REPLACE FUNCTION ${MARK}(_package_id uuid)`));
  assert(sql.includes(`CREATE OR REPLACE FUNCTION ${SET}(_package_id uuid)`));
  for (const body of [mark, set]) {
    assert(/RETURNS void/.test(body));
    assert(body.includes("SECURITY DEFINER"));
    assert(body.includes("SET search_path TO 'public', 'extensions'"));
  }
});

Deno.test("C20C14: both RPCs have fail-closed client gate rejecting non-NULL with 42501", () => {
  for (const body of [mark, set]) {
    assert(body.includes("v_client_id := api_e_private.jwt_client_id();"));
    assert(body.includes("EXCEPTION WHEN OTHERS THEN"));
    assert(body.includes("v_client_id := 'unresolved_client';"));
    const gate = body.indexOf("IF v_client_id IS NOT NULL THEN");
    assert(gate > 0);
    assert(
      body.indexOf("RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';", gate) > gate,
    );
  }
});

Deno.test("C20C14: client gate precedes auth.uid() and package lookup", () => {
  for (const body of [mark, set]) {
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const uid = body.indexOf("auth.uid()");
    const pkg = body.indexOf("FROM public.governance_record_copilot_data_packages WHERE id");
    assert(gate < uid);
    assert(gate < pkg);
  }
});

Deno.test("C20C14: auth.uid() exactly once per RPC with active-user validation", () => {
  for (const body of [mark, set]) {
    assertEquals(body.split("auth.uid()").length - 1, 1);
    assert(body.includes("v_caller := auth.uid();"));
    assert(body.includes("IF v_caller IS NULL OR NOT public.is_active_user(v_caller) THEN"));
    assert(body.includes("RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';"));
  }
});

Deno.test("C20C14: package lookup -> parent lookup -> project authority ordering", () => {
  for (const [body, authority] of [
    [mark, "public._gov_assert_project_read(_row.project_id)"],
    [set, "public._gov_assert_project_write(_row.project_id)"],
  ] as const) {
    const pkg = body.indexOf("SELECT * INTO _p FROM public.governance_record_copilot_data_packages");
    const parent = body.indexOf("SELECT * INTO _row FROM public.governance_records");
    const auth = body.indexOf(authority);
    const kind = body.indexOf("IF _row.record_kind IS DISTINCT FROM 'decision_case' THEN");
    const src = body.indexOf("FOREACH _sp_id IN ARRAY _p.source_project_ids LOOP");
    assert(pkg > 0 && parent > pkg && auth > parent);
    assert(auth < kind, "authority must precede record_kind");
    assert(auth < src, "authority must precede source-project checks");
    assert(body.includes("RAISE EXCEPTION 'Data package not found' USING ERRCODE='P0002'"));
    assert(body.includes("RAISE EXCEPTION 'Parent record not found' USING ERRCODE='P0002'"));
    assert(
      body.includes(
        "RAISE EXCEPTION 'Data packages are only allowed on decision_case records' USING ERRCODE='22023'",
      ),
    );
  }
});

Deno.test("C20C14: MARK uses project READ only, SET uses project WRITE only", () => {
  assert(mark.includes("public._gov_assert_project_read(_row.project_id)"));
  assert(!mark.includes("_gov_assert_project_write"));
  assert(set.includes("public._gov_assert_project_write(_row.project_id)"));
  assert(!set.includes("_gov_assert_project_read"));
});

Deno.test("C20C14: source-project containment preserved and uses v_caller", () => {
  for (const body of [mark, set]) {
    assert(body.includes("IF NOT public.has_project_access(v_caller, _sp_id) THEN"));
    assert(
      body.includes(
        "RAISE EXCEPTION 'You do not have access to source project %', _sp_id USING ERRCODE='42501';",
      ),
    );
    assert(!body.includes("has_project_access(auth.uid()"));
  }
});

Deno.test("C20C14: MARK writes only downloaded_at/downloaded_by and logs no activity", () => {
  const m = mark.match(
    /UPDATE public\.governance_record_copilot_data_packages\s+SET([\s\S]*?)WHERE id = _package_id;/,
  );
  assert(m, "mark update not found");
  const cols = [...m![1].matchAll(/([a-z_]+)\s*=/g)].map((x) => x[1]);
  assertEquals(cols.sort(), ["downloaded_at", "downloaded_by"]);
  assert(m![1].includes("downloaded_by = v_caller"));
  assert(!mark.includes("log_activity_event"), "no activity event may be added to MARK");
});

Deno.test("C20C14: SET sibling demotion and promotion unchanged", () => {
  assert(
    set.includes(
      "SET is_current = false, package_status = CASE WHEN package_status = 'prepared' THEN 'superseded' ELSE package_status END",
    ),
  );
  assert(
    set.includes(
      "WHERE governance_record_id = _p.governance_record_id AND is_current = true AND id <> _package_id;",
    ),
  );
  const promote = set.match(
    /UPDATE public\.governance_record_copilot_data_packages\s+SET is_current = true\s+WHERE id = _package_id;/,
  );
  assert(promote, "promotion statement changed");
});

Deno.test("C20C14: SET activity event unchanged with v_caller actor and no protected content", () => {
  assert(set.includes("PERFORM public.log_activity_event(_row.organization_id, v_caller,"));
  assert(
    set.includes(
      "'governance_record_copilot_data_package_set_current', 'governance_record', _p.governance_record_id,",
    ),
  );
  for (const k of ["'project_id'", "'data_package_id'", "'version_number'"]) {
    assert(set.includes(k), `missing metadata key ${k}`);
  }
  for (const leak of ["package_json", "package_filename", "package_hash", "bundle"]) {
    assert(!set.includes(`'${leak}'`), `activity must not carry ${leak}`);
  }
});

Deno.test("C20C14: no schema/RLS/grant/trigger/encryption change and no bypass", () => {
  const lower = sql.toLowerCase();
  for (
    const forbidden of [
      "alter table",
      "create table",
      "create policy",
      "drop policy",
      "grant ",
      "revoke ",
      "create trigger",
      "create index",
      "btpm_encrypt",
      "btpm_decrypt",
      "service_role",
      "client_credentials",
      "trusted",
      "mcp",
      "api_capability",
    ]
  ) {
    assert(!lower.includes(forbidden), `unexpected: ${forbidden}`);
  }
});

Deno.test("C20C14: frontend hook still calls both RPCs", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useGovernanceCopilotDataPackages.ts", import.meta.url),
  );
  assert(hook.includes("export function useMarkGovernanceRecordCopilotDataPackageDownloaded"));
  assert(hook.includes("export function useSetCurrentGovernanceRecordCopilotDataPackage"));
  assert(hook.includes('"mark_governance_record_copilot_data_package_downloaded"'));
  assert(hook.includes('"set_current_governance_record_copilot_data_package"'));
  assert(hook.includes("_package_id"));
});
