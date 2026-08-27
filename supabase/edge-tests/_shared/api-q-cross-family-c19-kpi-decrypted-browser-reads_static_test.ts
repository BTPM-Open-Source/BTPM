// API-Q Cross-Family-C19 — KPI decrypted browser reads: OAuth boundary,
// canonical Organization containment and row-scope integrity.
// Focused static contract test over the forward-only migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260820051508_bd1ddb8f-3e8b-4a65-87ac-06c8dc6e5478.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();

function fn(name: string): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} must be redefined`);
  const end = code.indexOf("$function$;", code.indexOf("AS $function$", start) + 5);
  assert(end > start, `${name} body must terminate`);
  return code.slice(start, end);
}

const DEFS = fn("list_decrypted_kpi_definitions");
const UPDATES = fn("list_decrypted_kpi_updates");
const SNAPS = fn("list_decrypted_kpi_snapshots");
const ALL: [string, string][] = [
  ["definitions", DEFS],
  ["updates", UPDATES],
  ["snapshots", SNAPS],
];

Deno.test("1. exactly the three target functions are redefined", () => {
  const defs = code.match(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/gi) ?? [];
  assertEquals(defs.length, 3);
  for (
    const n of [
      "list_decrypted_kpi_definitions",
      "list_decrypted_kpi_updates",
      "list_decrypted_kpi_snapshots",
    ]
  ) {
    assert(codeLower.includes(`create or replace function public.${n}(`), n);
  }
  assertEquals(/drop function/i.test(code), false);
});

Deno.test("2. signatures and default arguments preserved", () => {
  assert(/list_decrypted_kpi_definitions\(_project_id uuid\)/i.test(DEFS));
  assert(/list_decrypted_kpi_updates\(_kpi_definition_id uuid\)/i.test(UPDATES));
  assert(
    /list_decrypted_kpi_snapshots\(_project_id uuid, _kpi_definition_id uuid DEFAULT NULL::uuid\)/i
      .test(SNAPS),
  );
});

Deno.test("3. language/volatility/SECDEF/search_path unchanged", () => {
  for (const [name, body] of ALL) {
    assert(/RETURNS json/i.test(body), name);
    assert(/LANGUAGE plpgsql/i.test(body), name);
    assert(/SECURITY DEFINER/i.test(body), name);
    assert(/SET search_path TO 'public'/i.test(body), name);
    assertEquals(/(IMMUTABLE|STABLE)/i.test(body), false, `${name} stays volatile`);
  }
});

Deno.test("4-6. OAuth gate is first executable security operation and fails closed", () => {
  for (const [name, body] of ALL) {
    const bodyStart = body.indexOf("BEGIN", body.indexOf("AS $function$"));
    const exec = body.slice(bodyStart);
    assert(
      /^BEGIN\s+BEGIN\s+v_client_id := api_e_private\.jwt_client_id\(\);\s+EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';\s+END;\s+IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';\s+END IF;/i
        .test(exec),
      `${name} OAuth gate must be first`,
    );
    assert(/v_client_id text;/i.test(body), name);
    assertEquals(/auth\.uid\(\)[\s\S]*api_e_private\.jwt_client_id/i.test(body), false, name);
  }
});

Deno.test("7-8. auth.uid resolved once; null/inactive handled before business reads", () => {
  for (const [name, body] of ALL) {
    assertEquals((body.match(/auth\.uid\(\)/g) ?? []).length, 1, name);
    assert(/v_caller := auth\.uid\(\);/i.test(body), name);
    assertEquals(/v_caller uuid;\s*$/m.test(body.split("BEGIN")[0] + "v_caller uuid;"), true);
    const nullGate = body.search(/IF v_caller IS NULL THEN/i);
    const activeGate = body.search(/IF NOT public\.is_active_user\(v_caller\) THEN/i);
    const firstRead = body.search(/SELECT workspace_id, organization_id INTO/i);
    assert(nullGate > 0 && activeGate > nullGate && firstRead > activeGate, name);
    assert(/'Account is deactivated' USING ERRCODE = '42501'/i.test(body), name);
    // No auth.uid() initialization inside DECLARE.
    const declare = body.slice(body.indexOf("DECLARE"), body.indexOf("BEGIN", body.indexOf("DECLARE")));
    assertEquals(/auth\.uid/i.test(declare), false, name);
  }
});

Deno.test("9-11. authoritative scope → canonical org membership (user-first) → decrypt", () => {
  assert(
    /SELECT workspace_id, organization_id INTO _ws_id, _org_id FROM public\.projects WHERE id = _project_id;/i
      .test(DEFS),
  );
  assert(
    /SELECT workspace_id, organization_id INTO _ws_id, _org_id\s*\n\s*FROM public\.kpi_definitions WHERE id = _kpi_definition_id;/i
      .test(UPDATES),
  );
  assert(
    /SELECT workspace_id, organization_id INTO _ws_id, _org_id FROM public\.projects WHERE id = _project_id;/i
      .test(SNAPS),
  );
  for (const [name, body] of ALL) {
    const scope = body.search(/SELECT workspace_id, organization_id INTO/i);
    const member = body.search(/public\.is_user_org_member\(v_caller, _org_id\) IS NOT TRUE/i);
    const decrypt = body.search(/btpm_decrypt/i);
    assert(scope > 0 && member > scope && decrypt > member, `${name} ordering`);
  }
});

Deno.test("12. existing browser read authority preserved per target", () => {
  assert(/public\.can_read_project\(v_caller, _project_id\)/i.test(DEFS));
  assert(/public\.can_read_project\(v_caller, _project_id\)/i.test(SNAPS));
  assert(
    /IF NOT \(is_workspace_member\(v_caller, _ws_id\) OR is_org_admin\(v_caller, _org_id\)\) THEN\s+RETURN '\[\]'::json;/i
      .test(UPDATES),
  );
});

Deno.test("13. missing/unauthorized semantics preserved per function", () => {
  for (const [name, body] of ALL) {
    assert(/IF _ws_id IS NULL THEN RETURN '\[\]'::json; END IF;/i.test(body), name);
  }
  for (const [name, body] of [["definitions", DEFS], ["snapshots", SNAPS]] as [string, string][]) {
    assertEquals(
      (body.match(/'Forbidden: not authorized to read this project' USING ERRCODE = '42501'/g) ?? [])
        .length,
      2,
      name,
    );
  }
  // Updates reader stays non-throwing for unauthorized browser callers.
  assertEquals(/RAISE EXCEPTION 'Forbidden/i.test(UPDATES), false);
  assertEquals((UPDATES.match(/RETURN '\[\]'::json;/g) ?? []).length, 3);
});

Deno.test("14-16. row-scope containment on org + workspace", () => {
  assert(
    /WHERE kd\.target_type='project' AND kd\.target_id=_project_id\s+AND kd\.organization_id = _org_id\s+AND kd\.workspace_id = _ws_id/i
      .test(DEFS),
  );
  assert(
    /WHERE ku\.kpi_definition_id = _kpi_definition_id\s+AND ku\.organization_id = _org_id\s+AND ku\.workspace_id = _ws_id/i
      .test(UPDATES),
  );
  assert(
    /WHERE ks\.project_id = _project_id\s+AND ks\.organization_id = _org_id\s+AND ks\.workspace_id = _ws_id/i
      .test(SNAPS),
  );
});

Deno.test("17. fields, decrypt, ordering and fallback preserved", () => {
  for (
    const f of [
      "kd.id", "kd.name", "kd.unit", "kd.target_value", "kd.current_value",
      "kd.target_direction", "kd.target_type", "kd.target_id", "kd.is_archived",
      "kd.created_at", "kd.updated_at", "kd.created_by", "kd.workspace_id",
      "kd.organization_id", "kd.source_mode", "kd.value_type", "kd.cadence",
      "kd.calculation_key", "kd.formula_version", "kd.completion_method",
      "kd.comment_required", "kd.action_plan_required", "kd.auto_snapshot_enabled",
    ]
  ) assert(DEFS.includes(f), f);
  assert(/btpm_decrypt\(kd\.description, kd\.organization_id\) ELSE NULL END AS description/i.test(DEFS));
  assert(/ORDER BY kd\.is_archived, kd\.created_at/i.test(DEFS));

  for (
    const f of [
      "ku.id", "ku.kpi_definition_id", "ku.value", "ku.update_date", "ku.created_at",
      "ku.author_id", "ku.workspace_id", "ku.organization_id",
    ]
  ) assert(UPDATES.includes(f), f);
  assert(/btpm_decrypt\(ku\.note, ku\.organization_id\)/i.test(UPDATES));
  assert(/btpm_decrypt\(p\.display_name, p\.organization_id\)[\s\S]*AS author_name/i.test(UPDATES));
  assert(/btpm_decrypt\(p\.email, p\.organization_id\)[\s\S]*AS author_email/i.test(UPDATES));
  assert(/LEFT JOIN profiles p ON p\.id = ku\.author_id/i.test(UPDATES));
  assert(/ORDER BY ku\.update_date DESC, ku\.created_at DESC/i.test(UPDATES));

  for (
    const f of [
      "ks.id", "ks.kpi_definition_id", "ks.project_id", "ks.workspace_id",
      "ks.organization_id", "ks.snapshot_date", "ks.period_start", "ks.period_end",
      "ks.source_mode", "ks.value_type", "ks.value_amount", "ks.calculation_key",
      "ks.formula_version", "ks.calculation_status", "ks.generated_by",
      "ks.created_at", "ks.created_by",
    ]
  ) assert(SNAPS.includes(f), f);
  for (const f of ["string_value", "comment", "action_plan"]) {
    assert(
      new RegExp(`btpm_decrypt\\(ks\\.${f}, ks\\.organization_id\\) ELSE NULL END AS ${f}`, "i")
        .test(SNAPS),
      f,
    );
  }
  assert(/ORDER BY ks\.snapshot_date DESC, ks\.created_at DESC/i.test(SNAPS));

  for (const [name, body] of ALL) {
    assert(/RETURN COALESCE\(_result, '\[\]'::json\);/i.test(body), name);
  }
});

Deno.test("18. snapshot optional KPI filter preserved", () => {
  assert(/\(_kpi_definition_id IS NULL OR ks\.kpi_definition_id = _kpi_definition_id\)/i.test(SNAPS));
});

Deno.test("19-20. no GRANT/REVOKE and no schema/RLS/trigger/DML drift", () => {
  for (
    const forbidden of [
      /\bGRANT\b/i, /\bREVOKE\b/i, /CREATE TABLE/i, /ALTER TABLE/i, /CREATE POLICY/i,
      /DROP POLICY/i, /CREATE TRIGGER/i, /DROP TRIGGER/i, /ROW LEVEL SECURITY/i,
      /\bINSERT INTO\b/i, /\bUPDATE public\./i, /\bDELETE FROM\b/i, /CREATE SCHEMA/i,
      /btpm_encrypt/i, /ALTER FUNCTION/i,
    ]
  ) {
    assertEquals(forbidden.test(code), false, String(forbidden));
  }
});

Deno.test("21. frontend callers unchanged", async () => {
  const callers: [string, string[]][] = [
    ["src/hooks/useProjectKpis.ts", ["list_decrypted_kpi_definitions", "list_decrypted_kpi_updates"]],
    ["src/hooks/useKpiSnapshots.ts", ["list_decrypted_kpi_snapshots"]],
    ["src/hooks/useRoadmapStatusPackKpis.ts", ["list_decrypted_kpi_snapshots"]],
  ];
  for (const [path, rpcs] of callers) {
    const text = await Deno.readTextFile(new URL(`../../../${path}`, import.meta.url).pathname);
    for (const rpc of rpcs) assert(text.includes(rpc), `${path} must still call ${rpc}`);
  }
});
