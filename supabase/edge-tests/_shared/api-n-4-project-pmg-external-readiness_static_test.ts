// API-N.4 — Project PMG exact-capability external readiness.
//
// Focused repository static contract test. Locates the API-N.4 migration by its
// unique marker and asserts, from committed source only:
//   - exactly the three intended Project PMG functions are redefined;
//   - their existing signatures are unchanged (no new parameters);
//   - each uses exception-safe api_e_private.jwt_client_id() +
//     api_e_private.assert_trusted_context();
//   - each requires api version v1, capability kind command, source external_api;
//   - exact capability bindings (projects:create / update / transition);
//   - external-context rejection occurs before business lookup/lock/write/audit;
//   - ordinary no-client execution defaults to btpm_ui, accepted external uses
//     external_api;
//   - every PMG audit uses v_source_channel;
//   - canonical create / update / transition controls remain intact;
//   - no API wrapper, route, grant, catalogue or schema change.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-N.4 — Project PMG exact-capability external readiness";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
// Executable SQL only: governance prose in leading comments is not a definition.
const EXEC = RAW.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .replace(/\s+/g, " ");

const CREATE_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_project_create_blank(_name text, _workspace_id uuid, _program_id uuid DEFAULT NULL::uuid, _delivery_model project_delivery_model DEFAULT NULL::project_delivery_model, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";
const UPDATE_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_project_update(_project_id uuid, _expected_updated_at timestamp with time zone, _name text DEFAULT NULL::text, _priority pm_priority DEFAULT NULL::pm_priority, _description text DEFAULT NULL::text, _charter text DEFAULT NULL::text, _goals text DEFAULT NULL::text, _scope_in text DEFAULT NULL::text, _scope_out text DEFAULT NULL::text, _business_case text DEFAULT NULL::text, _success_criteria text DEFAULT NULL::text, _completion_criteria text DEFAULT NULL::text, _budget_narrative text DEFAULT NULL::text, _assumptions text DEFAULT NULL::text, _constraints text DEFAULT NULL::text, _program_id uuid DEFAULT NULL::uuid, _delivery_model project_delivery_model DEFAULT NULL::project_delivery_model, _set_name boolean DEFAULT false, _set_priority boolean DEFAULT false, _set_description boolean DEFAULT false, _set_charter boolean DEFAULT false, _set_goals boolean DEFAULT false, _set_scope_in boolean DEFAULT false, _set_scope_out boolean DEFAULT false, _set_business_case boolean DEFAULT false, _set_success_criteria boolean DEFAULT false, _set_completion_criteria boolean DEFAULT false, _set_budget_narrative boolean DEFAULT false, _set_assumptions boolean DEFAULT false, _set_constraints boolean DEFAULT false, _set_program_id boolean DEFAULT false, _set_delivery_model boolean DEFAULT false, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";
const TRANSITION_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_project_status_transition(_project_id uuid, _expected_updated_at timestamp with time zone, _target_status pm_status, _confirm_warnings boolean DEFAULT false, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";

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
  {
    name: "apply_project_create_blank",
    signature: CREATE_SIG,
    capability: "projects:create",
    body: bodyOf(CREATE_SIG),
  },
  {
    name: "apply_project_update",
    signature: UPDATE_SIG,
    capability: "projects:update",
    body: bodyOf(UPDATE_SIG),
  },
  {
    name: "apply_project_status_transition",
    signature: TRANSITION_SIG,
    capability: "projects:transition",
    body: bodyOf(TRANSITION_SIG),
  },
];

Deno.test("API-N.4: exactly the three intended Project PMG functions are redefined", () => {
  const defs = RAW.match(/CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi) ?? [];
  assert(defs.length === 3, `expected 3 function definitions, found ${defs.length}`);

  const names = defs.map((d) => d.replace(/.*public\./i, "").replace(/\s*\($/, ""));
  for (const fn of BODIES) {
    assert(names.includes(fn.name), `${fn.name} missing`);
  }
});

Deno.test("API-N.4: existing signatures are preserved verbatim", () => {
  for (const fn of BODIES) {
    assert(RAW.includes(fn.signature), `signature changed for ${fn.name}`);
    assert(
      !fn.signature.includes("_capability_key"),
      `${fn.name}: capability key must not be a parameter`,
    );
    assert(
      !fn.signature.includes("_source_channel"),
      `${fn.name}: source channel must not be a parameter`,
    );
  }
  assert(RAW.match(/RETURNS jsonb/g)?.length === 3, "all three must still return jsonb");
});

Deno.test("API-N.4: all three use exception-safe jwt_client_id + assert_trusted_context", () => {
  for (const fn of BODIES) {
    assert(fn.body.includes("api_e_private.jwt_client_id()"), `${fn.name}: jwt_client_id missing`);
    assert(
      fn.body.includes("api_e_private.assert_trusted_context()"),
      `${fn.name}: assert_trusted_context missing`,
    );
    assert(
      /BEGIN\s+v_client_id := api_e_private\.jwt_client_id\(\);\s+EXCEPTION WHEN OTHERS THEN/.test(
        fn.body,
      ),
      `${fn.name}: client identity resolution must be exception-safe`,
    );
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(fn.body),
      `${fn.name}: unresolved identity must fail closed as external`,
    );
    assert(
      /BEGIN\s+v_trusted := api_e_private\.assert_trusted_context\(\);\s+EXCEPTION WHEN OTHERS THEN\s+v_trusted := false;/
        .test(fn.body),
      `${fn.name}: trusted-context check must fail closed on exception`,
    );
  }
});

Deno.test("API-N.4: external context requires v1 / command / external_api", () => {
  for (const fn of BODIES) {
    assert(
      fn.body.includes(`current_setting('api_e.api_version', true)`) && fn.body.includes("<> 'v1'"),
      `${fn.name}: api version check missing`,
    );
    assert(
      fn.body.includes(`current_setting('api_e.capability_kind', true)`) &&
        fn.body.includes("<> 'command'"),
      `${fn.name}: capability kind check missing`,
    );
    assert(
      fn.body.includes(`current_setting('api_e.source_channel', true)`) &&
        fn.body.includes("<> 'external_api'"),
      `${fn.name}: source channel check missing`,
    );
  }
});

Deno.test("API-N.4: exact capability bindings, no generic matching", () => {
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
    assert(!fn.body.includes("'projects:read'"), `${fn.name}: must not accept projects:read`);
    assert(!fn.body.includes("'projects:plan'"), `${fn.name}: must not accept projects:plan`);
    assert(
      !/capability_key.*(LIKE|ANY|IN \()/.test(fn.body),
      `${fn.name}: no generic capability matching`,
    );
  }
});

Deno.test("API-N.4: external rejection precedes target lookup, lock, write and audit", () => {
  for (const fn of BODIES) {
    const reject = fn.body.indexOf("'not_authorized'::public.pmg_command_status");
    assert(reject > 0, `${fn.name}: fail-closed envelope missing`);

    const laterMarkers = [
      "FROM public.projects",
      "FROM public.workspaces",
      "FROM public.programs",
      "public.is_active_user",
      "public.has_project_pm_authority",
      "public.can_write_demo",
      "public.create_blank_project(",
      "public.validate_project_completion(",
      "public.pmg_record_command_audit",
      "FOR UPDATE",
      "UPDATE public.projects",
    ];
    for (const marker of laterMarkers) {
      const at = fn.body.indexOf(marker);
      if (at < 0) continue;
      assert(reject < at, `${fn.name}: fail-closed must precede ${marker}`);
    }
  }
});

Deno.test("API-N.4: source channel defaults to btpm_ui and only escalates to external_api", () => {
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
    assert(
      fn.body.includes("v_trusted boolean := false;"),
      `${fn.name}: v_trusted must default false`,
    );
  }
});

Deno.test("API-N.4: every PMG audit uses v_source_channel", () => {
  const audits = RAW.match(/pmg_record_command_audit\(/g) ?? [];
  assert(audits.length === 9, `expected 9 audit calls, found ${audits.length}`);
  assert(
    !RAW.includes("'btpm_ui'::public.pmg_source_channel,"),
    "no audit call may hardcode btpm_ui as the source channel argument",
  );
  const dynamic = RAW.match(/^\s+v_source_channel,$/gm) ?? [];
  assert(
    dynamic.length === 9,
    `expected 9 dynamic source-channel arguments, found ${dynamic.length}`,
  );
});

Deno.test("API-N.4: canonical security gates remain intact", () => {
  for (const fn of BODIES) {
    assert(fn.body.includes("public.is_active_user(v_actor)"), `${fn.name}: is_active_user missing`);
    assert(fn.body.includes("public.can_write_demo("), `${fn.name}: can_write_demo missing`);
    assert(fn.body.includes("v_actor uuid := auth.uid();"), `${fn.name}: actor semantics changed`);
    assert(fn.body.includes("SECURITY DEFINER"), `${fn.name}: must remain SECURITY DEFINER`);
  }
});

Deno.test("API-N.4: create preserves canonical delegate behavior", () => {
  const body = bodyOf(CREATE_SIG);
  assert(body.includes("public.create_blank_project("), "canonical delegate missing");
  assert(body.includes("FROM public.workspaces"), "authoritative workspace verification missing");
  assert(body.includes("WHEN insufficient_privilege THEN"), "privilege mapping missing");
  assert(body.includes("'Workspace not found'"), "canonical invalid mapping missing");
  assert(
    body.includes("'Program must belong to the same workspace as the project'"),
    "program containment mapping missing",
  );
  assert(!body.includes("_expected_updated_at"), "create must not gain optimistic concurrency");
});

Deno.test("API-N.4: update preserves concurrency and field-presence semantics", () => {
  const body = bodyOf(UPDATE_SIG);
  assert(body.includes("public.has_project_pm_authority("), "PM authority missing");
  assert(body.includes("_expected_updated_at IS NULL"), "expected_updated_at requirement missing");
  assert(body.includes("WHERE id = _project_id\n   FOR UPDATE;"), "target row lock missing");
  assert(
    body.includes("v_row.updated_at IS DISTINCT FROM _expected_updated_at"),
    "stale detection missing",
  );
  assert(body.includes("'code','stale_project'"), "bounded conflict code missing");
  assert(body.includes("'no_change'::public.pmg_command_status"), "no_change outcome missing");
  assert(body.includes("'reason','name_required'"), "name validation missing");
  assert(body.includes("'reason','invalid_program'"), "program containment validation missing");
  assert(body.includes("public.btpm_decrypt("), "protected-field comparison path missing");
  for (
    const flag of [
      "_set_name",
      "_set_priority",
      "_set_description",
      "_set_charter",
      "_set_goals",
      "_set_scope_in",
      "_set_scope_out",
      "_set_business_case",
      "_set_success_criteria",
      "_set_completion_criteria",
      "_set_budget_narrative",
      "_set_assumptions",
      "_set_constraints",
      "_set_program_id",
      "_set_delivery_model",
    ]
  ) {
    assert(body.includes(flag), `field-presence flag ${flag} missing`);
  }
  assert(!body.includes("SET status ="), "update must not gain status semantics");
  assert(!body.includes("target_end_date"), "update must not gain planning dates");
});

Deno.test("API-N.4: transition preserves blocker, warning and reopen behavior", () => {
  const body = bodyOf(TRANSITION_SIG);
  assert(body.includes("public.has_project_pm_authority("), "PM authority missing");
  assert(body.includes("_expected_updated_at IS NULL"), "expected_updated_at requirement missing");
  assert(body.includes("'reason','target_status_required'"), "target status requirement missing");
  assert(body.includes("WHERE id = _project_id\n   FOR UPDATE;"), "target row lock missing");
  assert(
    body.includes("v_project.updated_at IS DISTINCT FROM _expected_updated_at"),
    "stale detection missing",
  );
  assert(body.includes("'code', 'stale_project'"), "bounded conflict code missing");
  assert(body.includes("'no_change'::public.pmg_command_status"), "no_change outcome missing");
  assert(
    body.includes("public.validate_project_completion(_project_id)"),
    "completion validation missing",
  );
  assert(body.includes("'blocked'::public.pmg_command_status"), "hard blocker outcome missing");
  assert(
    body.includes("'confirmation_required'::public.pmg_command_status"),
    "soft warning confirmation outcome missing",
  );
  assert(body.includes("COALESCE(_confirm_warnings, false)"), "confirmation semantics missing");
  assert(
    body.includes("'reason','transition_not_supported'"),
    "unsupported transition handling missing",
  );
  assert(
    body.includes("(v_old_status = 'completed' AND _target_status = 'active')"),
    "reopen behavior missing",
  );
  assert(body.includes("SET status = _target_status"), "actual status update missing");
});

Deno.test("API-N.4: no out-of-scope work in this migration", () => {
  assert(!EXEC.includes("apply_project_planning_change"), "project planning must be untouched");
  assert(!/FUNCTION public\.(apply_phase|reorder_phases)/.test(EXEC), "no Phase command may change");
  assert(!/FUNCTION public\.(apply_task|reorder_tasks)/.test(EXEC), "no Task command may change");
  assert(!/FUNCTION public\.apply_program/.test(EXEC), "no Program command may change");
  assert(!/FUNCTION public\.api_v1_/.test(EXEC), "no API wrapper may be introduced");
  assert(!/\bGRANT\b|\bREVOKE\b/.test(EXEC), "no grants or revokes");
  assert(
    !/CREATE TABLE|DROP TABLE public\.|CREATE TYPE|ALTER TYPE|CREATE INDEX|CREATE TRIGGER/.test(
      EXEC,
    ),
    "no schema/enum/index/trigger changes",
  );
  assert(
    !/api_capability_catalogue|api_client_supported_capabilities|_client_enablements/.test(EXEC),
    "no capability assignment",
  );
  assert(!/api_idempotency_registry/.test(EXEC), "no API-F idempotency work");
  assert(!/CREATE POLICY|ROW LEVEL SECURITY/.test(EXEC), "no RLS changes");
  assert(!/service_role/.test(EXEC), "no service-role business path");
  assert(!/EXECUTE format|EXECUTE '/.test(EXEC), "no dynamic SQL / generic dispatcher");
});
