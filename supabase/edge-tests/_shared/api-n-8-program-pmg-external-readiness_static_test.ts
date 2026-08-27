// API-N.8 — Program PMG exact-capability external readiness.
//
// Focused repository static contract test. Locates the API-N.8 migration by its
// unique marker and asserts, from committed source only:
//   - exactly the two intended Program PMG functions are redefined;
//   - their existing signatures are unchanged (no new parameters);
//   - each uses exception-safe api_e_private.jwt_client_id() +
//     api_e_private.assert_trusted_context();
//   - each requires api version v1, capability kind command, source external_api;
//   - exact capability bindings (programs:create / programs:update);
//   - external-context rejection occurs before business lookup/lock/write/audit;
//   - ordinary no-client execution defaults to btpm_ui, accepted external uses
//     external_api;
//   - every PMG audit uses v_source_channel;
//   - canonical create / update controls remain intact;
//   - no API wrapper, route, grant, catalogue or schema change.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-N.8 — Program PMG exact-capability external readiness";

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
  "CREATE OR REPLACE FUNCTION public.apply_program_create(_name text, _workspace_id uuid, _description text DEFAULT NULL::text, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";
const UPDATE_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_program_update(_program_id uuid, _expected_updated_at timestamp with time zone, _name text DEFAULT NULL::text, _status pm_status DEFAULT NULL::pm_status, _description text DEFAULT NULL::text, _set_description boolean DEFAULT false, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)";

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
    name: "apply_program_create",
    signature: CREATE_SIG,
    capability: "programs:create",
    body: bodyOf(CREATE_SIG),
  },
  {
    name: "apply_program_update",
    signature: UPDATE_SIG,
    capability: "programs:update",
    body: bodyOf(UPDATE_SIG),
  },
];

Deno.test("API-N.8: exactly the two intended Program PMG functions are redefined", () => {
  const defs = RAW.match(/CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi) ?? [];
  assert(defs.length === 2, `expected 2 function definitions, found ${defs.length}`);

  const names = defs.map((d) => d.replace(/.*public\./i, "").replace(/\s*\($/, ""));
  for (const fn of BODIES) {
    assert(names.includes(fn.name), `${fn.name} missing`);
  }
});

Deno.test("API-N.8: existing signatures are preserved verbatim", () => {
  for (const fn of BODIES) {
    assert(RAW.includes(fn.signature), `signature changed for ${fn.name}`);
    for (
      const forbidden of [
        "_capability_key",
        "_source_channel",
        "_tenant_id",
        "_organization_id",
        "_api_client_id",
        "_executing_user_id",
        "_trusted",
      ]
    ) {
      assert(
        !fn.signature.includes(forbidden),
        `${fn.name}: ${forbidden} must not be a parameter`,
      );
    }
  }
  assert(RAW.match(/RETURNS jsonb/g)?.length === 2, "both must still return jsonb");
});

Deno.test("API-N.8: both use exception-safe jwt_client_id + assert_trusted_context", () => {
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
    assert(
      fn.body.includes("IF v_client_id IS NOT NULL THEN"),
      `${fn.name}: ordinary UI path must be the no-client branch`,
    );
    assert(fn.body.includes("v_trusted IS NOT TRUE"), `${fn.name}: trusted gate missing`);
  }
});

Deno.test("API-N.8: external context requires v1 / command / external_api", () => {
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

Deno.test("API-N.8: exact capability bindings, no generic matching", () => {
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
    for (
      const other of [
        "programs:read",
        "programs:list",
        "programs:transition",
        "projects:create",
        "projects:update",
      ]
    ) {
      assert(!fn.body.includes(`'${other}'`), `${fn.name}: must not accept ${other}`);
    }
    assert(
      !/capability_key.*(LIKE|ANY|IN \()/.test(fn.body),
      `${fn.name}: no generic capability matching`,
    );
  }
});

Deno.test("API-N.8: external rejection precedes target lookup, lock, write and audit", () => {
  for (const fn of BODIES) {
    const reject = fn.body.indexOf("'not_authorized'::public.pmg_command_status");
    assert(reject > 0, `${fn.name}: fail-closed envelope missing`);

    const laterMarkers = [
      "FROM public.workspaces",
      "FROM public.programs",
      "public.is_active_user",
      "public.has_pm_authority",
      "public.get_user_org_id",
      "public.can_write_demo",
      "public.btpm_decrypt(",
      "public.pmg_record_command_audit",
      "FOR UPDATE",
      "INSERT INTO public.programs",
      "UPDATE public.programs",
    ];
    for (const marker of laterMarkers) {
      const at = fn.body.indexOf(marker);
      if (at < 0) continue;
      assert(reject < at, `${fn.name}: fail-closed must precede ${marker}`);
    }
  }
});

Deno.test("API-N.8: source channel defaults to btpm_ui and only escalates to external_api", () => {
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

Deno.test("API-N.8: every PMG audit uses v_source_channel", () => {
  const audits = RAW.match(/pmg_record_command_audit\(/g) ?? [];
  assert(audits.length === 4, `expected 4 audit calls, found ${audits.length}`);
  assert(
    !RAW.includes("'btpm_ui'::public.pmg_source_channel,"),
    "no audit call may hardcode btpm_ui as the source channel argument",
  );
  const dynamic = RAW.match(/^\s+v_source_channel,$/gm) ?? [];
  assert(
    dynamic.length === 4,
    `expected 4 dynamic source-channel arguments, found ${dynamic.length}`,
  );
});

Deno.test("API-N.8: canonical security gates remain intact", () => {
  for (const fn of BODIES) {
    assert(fn.body.includes("public.is_active_user(v_actor)"), `${fn.name}: is_active_user missing`);
    assert(fn.body.includes("public.has_pm_authority("), `${fn.name}: has_pm_authority missing`);
    assert(
      fn.body.includes("public.get_user_org_id(v_actor)"),
      `${fn.name}: organization containment missing`,
    );
    assert(fn.body.includes("public.can_write_demo("), `${fn.name}: can_write_demo missing`);
    assert(fn.body.includes("v_actor uuid := auth.uid();"), `${fn.name}: actor semantics changed`);
    assert(fn.body.includes("SECURITY DEFINER"), `${fn.name}: must remain SECURITY DEFINER`);
    assert(
      fn.body.includes("SET search_path TO 'pg_catalog', 'public'"),
      `${fn.name}: search_path posture changed`,
    );
  }
});

Deno.test("API-N.8: create preserves canonical validation and write path", () => {
  const body = bodyOf(CREATE_SIG);
  assert(body.includes("btrim(coalesce(_name, ''))"), "name normalization missing");
  assert(body.includes("'Program name is required'"), "name validation missing");
  assert(
    body.includes("'Program name must be 200 characters or less'"),
    "name length limit missing",
  );
  assert(body.includes("'Workspace is required'"), "required workspace missing");
  assert(body.includes("'Workspace not found'"), "workspace lookup mapping missing");
  assert(
    body.includes("SELECT organization_id INTO v_org"),
    "authoritative workspace -> organization lookup missing",
  );
  assert(
    body.includes("nullif(btrim(coalesce(_description, '')), '')"),
    "description normalization missing",
  );
  assert(body.includes("INSERT INTO public.programs"), "canonical insert missing");
  assert(body.includes("created_by"), "created_by attribution missing");
  assert(!body.includes("_expected_updated_at"), "create must not gain optimistic concurrency");
  assert(!body.includes("btpm_encrypt"), "create must not manually encrypt Program fields");
});

Deno.test("API-N.8: update preserves concurrency, archive and no_change semantics", () => {
  const body = bodyOf(UPDATE_SIG);
  assert(
    body.includes("_program_id IS NULL OR _expected_updated_at IS NULL"),
    "expected_updated_at requirement missing",
  );
  assert(
    body.includes("FROM public.programs WHERE id = _program_id FOR UPDATE;"),
    "target row lock missing",
  );
  assert(body.includes("IF NOT FOUND THEN"), "non-enumerating missing-program path missing");
  assert(
    body.includes("'Program is archived and cannot be edited'"),
    "archive edit lock missing",
  );
  assert(
    body.includes("v_prog.updated_at IS DISTINCT FROM _expected_updated_at"),
    "stale detection missing",
  );
  assert(body.includes("'stale_program'"), "bounded conflict code missing");
  assert(body.includes("'current_updated_at', v_prog.updated_at"), "conflict payload missing");
  assert(body.includes("'no_change'::public.pmg_command_status"), "no_change outcome missing");
  assert(body.includes("_set_description"), "_set_description semantics missing");
  assert(
    body.includes("v_new_desc IS DISTINCT FROM v_current_desc"),
    "nullable-clear description comparison missing",
  );
  assert(
    body.includes("public.btpm_decrypt(v_prog.name, v_prog.organization_id)"),
    "protected name comparison via btpm_decrypt missing",
  );
  assert(
    body.includes("public.btpm_decrypt(v_prog.description, v_prog.organization_id)"),
    "protected description comparison via btpm_decrypt missing",
  );
  assert(body.includes("UPDATE public.programs SET"), "canonical update missing");
  assert(body.includes("status = CASE WHEN v_change_status THEN _status ELSE status END"),
    "optional status semantics missing");
  assert(!body.includes("is_archived ="), "update must not gain archive semantics");
  assert(!body.includes("btpm_encrypt"), "update must not manually encrypt Program fields");
});

Deno.test("API-N.8: no out-of-scope work in this migration", () => {
  assert(!/FUNCTION public\.apply_project/.test(EXEC), "no Project command may change");
  assert(!/FUNCTION public\.(apply_phase|reorder_phases)/.test(EXEC), "no Phase command may change");
  assert(!/FUNCTION public\.(apply_task|reorder_tasks)/.test(EXEC), "no Task command may change");
  assert(
    !/FUNCTION public\.(archive_program|unarchive_program|create_program)/.test(EXEC),
    "no Program lifecycle command may change",
  );
  assert(!/FUNCTION public\.api_v1_/.test(EXEC), "no API wrapper may be introduced");
  assert(!/\bGRANT\b|\bREVOKE\b/.test(EXEC), "no grants or revokes");
  assert(
    !/CREATE TABLE|DROP TABLE public\.|CREATE TYPE|ALTER TYPE|CREATE INDEX|CREATE TRIGGER|ALTER TABLE/
      .test(EXEC),
    "no schema/enum/index/trigger changes",
  );
  assert(
    !/api_capability_catalogue|api_client_supported_capabilities|api_capability_grants|_client_enablements/
      .test(EXEC),
    "no capability assignment",
  );
  assert(!/api_idempotency_registry/.test(EXEC), "no API-F idempotency work");
  assert(!/CREATE POLICY|ROW LEVEL SECURITY/.test(EXEC), "no RLS changes");
  assert(!/service_role/.test(EXEC), "no service-role business path");
  assert(!/EXECUTE format|EXECUTE '/.test(EXEC), "no dynamic SQL / generic dispatcher");
});
