// API-M.6A — Phase PMG exact-capability external readiness.
//
// Focused repository static contract test. Locates the API-M.6A migration by its
// unique marker and asserts, from committed source only:
//   - exactly the three intended Phase PMG functions are redefined;
//   - their existing signatures are unchanged;
//   - each uses api_e_private.jwt_client_id() + api_e_private.assert_trusted_context();
//   - each requires api version v1, capability kind command, source external_api;
//   - exact capability bindings (create/update/reorder);
//   - external-context rejection occurs before business target lookup/write;
//   - ordinary no-client execution defaults to btpm_ui, accepted external uses external_api;
//   - every PMG audit uses v_source_channel;
//   - is_active_user / PM authority / can_write_demo remain;
//   - update keeps optimistic concurrency; reorder keeps full sibling-set concurrency;
//   - create keeps confirmation_required Project-window behavior;
//   - no apply_phase_planning_change, no Task command, no API wrapper/route/grant.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-M.6A — Phase PMG exact-capability external readiness";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
const FLAT = RAW.replace(/\s+/g, " ");
// Executable SQL only: governance prose in leading comments is not a definition.
const EXEC = RAW.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .replace(/\s+/g, " ");

const CREATE_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_phase_create(_project_id uuid, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT 'planned'::pm_status, _phase_type phase_type DEFAULT 'work_item'::phase_type, _start_date date DEFAULT NULL::date, _target_end_date date DEFAULT NULL::date, _sort_order integer DEFAULT NULL::integer, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";
const UPDATE_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_phase_update(_phase_id uuid, _expected_updated_at timestamp with time zone, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT NULL::pm_status, _phase_type phase_type DEFAULT NULL::phase_type, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";
const REORDER_SIG =
  "CREATE OR REPLACE FUNCTION public.reorder_phases(_project_id uuid, _rows jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";

/** Body of one redefined function, from its signature to its terminating $function$;. */
function bodyOf(signature: string): string {
  const start = RAW.indexOf(signature);
  assert(start >= 0, `signature not found: ${signature.slice(0, 60)}`);
  const end = RAW.indexOf("$function$;", start);
  assert(end > start, "unterminated function body");
  return RAW.slice(start, end);
}

const BODIES: ReadonlyArray<
  { name: string; signature: string; capability: string; body: string }
> = [
  { name: "apply_phase_create", signature: CREATE_SIG, capability: "phases:create", body: bodyOf(CREATE_SIG) },
  { name: "apply_phase_update", signature: UPDATE_SIG, capability: "phases:update", body: bodyOf(UPDATE_SIG) },
  { name: "reorder_phases", signature: REORDER_SIG, capability: "phases:reorder", body: bodyOf(REORDER_SIG) },
];

Deno.test("API-M.6A: exactly the three intended Phase PMG functions are redefined", () => {
  const defs = RAW.match(/CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi) ?? [];
  assert(defs.length === 3, `expected 3 function definitions, found ${defs.length}`);

  const names = defs.map((d) => d.replace(/.*public\./i, "").replace(/\s*\($/, ""));
  assert(names.includes("apply_phase_create"), "apply_phase_create missing");
  assert(names.includes("apply_phase_update"), "apply_phase_update missing");
  assert(names.includes("reorder_phases"), "reorder_phases missing");
});

Deno.test("API-M.6A: existing signatures are preserved verbatim", () => {
  for (const fn of BODIES) {
    assert(RAW.includes(fn.signature), `signature changed for ${fn.name}`);
  }
  // No new parameters: neither capability key nor source channel is caller-supplied.
  for (const fn of BODIES) {
    assert(!fn.signature.includes("_capability_key"), `${fn.name}: capability key must not be a parameter`);
    assert(!fn.signature.includes("_source_channel"), `${fn.name}: source channel must not be a parameter`);
  }
  // Return type unchanged.
  assert(RAW.match(/RETURNS jsonb/g)?.length === 3, "all three must still return jsonb");
});

Deno.test("API-M.6A: all three use exception-safe jwt_client_id + assert_trusted_context", () => {
  for (const fn of BODIES) {
    assert(fn.body.includes("api_e_private.jwt_client_id()"), `${fn.name}: jwt_client_id missing`);
    assert(
      fn.body.includes("api_e_private.assert_trusted_context()"),
      `${fn.name}: assert_trusted_context missing`,
    );
    assert(
      /BEGIN\s+v_client_id := api_e_private\.jwt_client_id\(\);\s+EXCEPTION WHEN OTHERS THEN/.test(fn.body),
      `${fn.name}: client identity resolution must be exception-safe`,
    );
    assert(
      /BEGIN\s+v_trusted := api_e_private\.assert_trusted_context\(\);\s+EXCEPTION WHEN OTHERS THEN\s+v_trusted := false;/
        .test(fn.body),
      `${fn.name}: trusted-context check must fail closed on exception`,
    );
  }
});

Deno.test("API-M.6A: external context requires v1 / command / external_api", () => {
  for (const fn of BODIES) {
    assert(
      fn.body.includes(`current_setting('api_e.api_version', true)`) && fn.body.includes("<> 'v1'"),
      `${fn.name}: api version check missing`,
    );
    assert(
      fn.body.includes(`current_setting('api_e.capability_kind', true)`) && fn.body.includes("<> 'command'"),
      `${fn.name}: capability kind check missing`,
    );
    assert(
      fn.body.includes(`current_setting('api_e.source_channel', true)`) && fn.body.includes("<> 'external_api'"),
      `${fn.name}: source channel check missing`,
    );
  }
});

Deno.test("API-M.6A: exact capability bindings, no generic matching", () => {
  for (const fn of BODIES) {
    assert(
      fn.body.includes(`current_setting('api_e.capability_key', true)`),
      `${fn.name}: capability key not read from trusted context`,
    );
    assert(fn.body.includes(`<> '${fn.capability}'`), `${fn.name}: must require ${fn.capability}`);
    for (const other of BODIES) {
      if (other.capability === fn.capability) continue;
      assert(
        !fn.body.includes(`'${other.capability}'`),
        `${fn.name}: must not accept ${other.capability}`,
      );
    }
    assert(!fn.body.includes("'phases:plan'"), `${fn.name}: must not accept phases:plan`);
    assert(!fn.body.includes("'planning:read'"), `${fn.name}: must not accept planning:read`);
    assert(!/capability_key.*(LIKE|ANY|IN \()/.test(fn.body), `${fn.name}: no generic capability matching`);
  }
});

Deno.test("API-M.6A: external rejection precedes target lookup, lock, write and audit", () => {
  for (const fn of BODIES) {
    const reject = fn.body.indexOf("'not_authorized'::public.pmg_command_status");
    assert(reject > 0, `${fn.name}: fail-closed envelope missing`);

    const laterMarkers = [
      "FROM public.projects",
      "FROM public.phases",
      "public.is_active_user",
      "public.has_project_pm_authority",
      "public.can_write_demo",
      "public.pmg_record_command_audit",
      "FOR UPDATE",
      "INSERT INTO public.phases",
      "UPDATE public.phases",
    ];
    for (const marker of laterMarkers) {
      const at = fn.body.indexOf(marker);
      if (at < 0) continue;
      assert(reject < at, `${fn.name}: fail-closed must precede ${marker}`);
    }
  }
});

Deno.test("API-M.6A: source channel defaults to btpm_ui and only escalates to external_api", () => {
  for (const fn of BODIES) {
    assert(
      fn.body.includes(
        "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel;",
      ),
      `${fn.name}: default source channel must be btpm_ui`,
    );
    assert(
      fn.body.includes("v_source_channel := 'external_api'::public.pmg_source_channel;"),
      `${fn.name}: accepted external execution must set external_api`,
    );
    assert(fn.body.includes("v_client_id text;"), `${fn.name}: v_client_id declaration missing`);
    assert(fn.body.includes("v_trusted boolean := false;"), `${fn.name}: v_trusted must default false`);
  }
});

Deno.test("API-M.6A: every PMG audit uses v_source_channel", () => {
  const audits = RAW.match(/pmg_record_command_audit\(/g) ?? [];
  assert(audits.length === 6, `expected 6 audit calls, found ${audits.length}`);
  assert(
    !RAW.includes("'btpm_ui'::public.pmg_source_channel,"),
    "no audit call may hardcode btpm_ui as the source channel argument",
  );
  const dynamic = RAW.match(/^\s+v_source_channel,$/gm) ?? [];
  assert(dynamic.length === 6, `expected 6 dynamic source-channel arguments, found ${dynamic.length}`);
});

Deno.test("API-M.6A: canonical security gates remain intact", () => {
  for (const fn of BODIES) {
    assert(fn.body.includes("public.is_active_user(v_actor)"), `${fn.name}: is_active_user missing`);
    assert(fn.body.includes("public.has_project_pm_authority("), `${fn.name}: PM authority missing`);
    assert(fn.body.includes("public.can_write_demo("), `${fn.name}: can_write_demo missing`);
    assert(fn.body.includes("v_actor uuid := auth.uid();"), `${fn.name}: actor semantics changed`);
    assert(fn.body.includes("SECURITY DEFINER"), `${fn.name}: must remain SECURITY DEFINER`);
  }
});

Deno.test("API-M.6A: update preserves canonical optimistic concurrency", () => {
  const body = bodyOf(UPDATE_SIG);
  assert(body.includes("_expected_updated_at IS NULL"), "expected_updated_at requirement missing");
  assert(body.includes("WHERE id = _phase_id\n   FOR UPDATE;"), "target row lock missing");
  assert(
    body.includes("v_phase.updated_at IS DISTINCT FROM _expected_updated_at"),
    "stale detection missing",
  );
  assert(body.includes("'code', 'stale_phase'"), "bounded conflict code missing");
  assert(body.includes("'current_updated_at', v_phase.updated_at"), "conflict information missing");
  assert(body.includes("public.btpm_decrypt("), "existing description decryption missing");
  assert(!body.includes("start_date"), "planning dates must not move into apply_phase_update");
});

Deno.test("API-M.6A: reorder preserves full sibling-set per-row concurrency", () => {
  const body = bodyOf(REORDER_SIG);
  assert(body.includes("PERFORM 1 FROM public.phases WHERE project_id = _project_id FOR UPDATE;"), "full lock missing");
  assert(body.includes("'reason','row_count_mismatch'"), "full sibling-set requirement missing");
  assert(body.includes("'reason','duplicate_row_ids'"), "duplicate id validation missing");
  assert(body.includes("'reason','non_contiguous_sort_positions'"), "contiguity validation missing");
  assert(body.includes("'reason','unknown_or_cross_project_rows'"), "cross-project rejection missing");
  assert(
    body.includes("ph.updated_at IS DISTINCT FROM i.expected_updated_at"),
    "per-row expected_updated_at missing",
  );
  assert(body.includes("'code', 'stale_phase_order'"), "stale conflict shape missing");
});

Deno.test("API-M.6A: create preserves confirmation-required Project-window behavior", () => {
  const body = bodyOf(CREATE_SIG);
  assert(
    body.includes("'confirmation_required'::public.pmg_command_status"),
    "confirmation_required outcome missing",
  );
  assert(body.includes("'reason','phase_start_before_project_start'"), "start-window guard missing");
  assert(body.includes("'reason','phase_end_after_project_end'"), "end-window guard missing");
  assert(body.includes("'code','extend_project_window_required'"), "no automatic Project widening signal missing");
  assert(!body.includes("_expected_updated_at"), "create must not gain optimistic concurrency");
  assert(body.includes("INSERT INTO public.phases ("), "canonical Phase insertion missing");
});

Deno.test("API-M.6A: no out-of-scope work in this migration", () => {
  assert(!EXEC.includes("apply_phase_planning_change"), "apply_phase_planning_change must be untouched");
  assert(!EXEC.includes("preview_phase_planning_change"), "planning preview must be untouched");
  assert(!/FUNCTION public\.(apply_task|reorder_tasks)/.test(EXEC), "no Task command may be modified");
  assert(!/FUNCTION public\.api_v1_/.test(EXEC), "no API wrapper may be introduced");
  assert(!/\bGRANT\b|\bREVOKE\b/.test(EXEC), "no grants or revokes");
  assert(!/CREATE TABLE|DROP TABLE public\.|CREATE TYPE|ALTER TYPE/.test(EXEC), "no schema/enum changes");
  assert(!/api_capability_catalogue|api_client_supported_capabilities|_client_enablements/.test(EXEC), "no capability assignment");
  assert(!/api_idempotency_registry/.test(EXEC), "no API-F idempotency work");
  assert(!/CREATE POLICY|ALTER TABLE .* ROW LEVEL SECURITY/.test(EXEC), "no RLS changes");
  assert(!/service_role/.test(EXEC), "no service-role business path");
  assert(!/EXECUTE format|EXECUTE '/.test(EXEC), "no dynamic SQL / generic dispatcher");
});
