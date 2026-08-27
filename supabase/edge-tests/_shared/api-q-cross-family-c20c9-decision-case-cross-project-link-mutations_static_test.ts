/**
 * API-Q Cross-Family-C20C9 — static/contract test.
 *
 * Verifies the C20C9 migration hardens exactly the four Decision Case
 * Cross-Project Link mutation RPCs with a browser-only OAuth boundary, a single
 * authenticated active caller, and Project write authority established before
 * Decision Case kind validation — with no functional, encryption, schema,
 * trigger, grant or frontend drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820114230_8505d15e-52ab-4581-8f66-0e3c77bd370b.sql";
// C20C9-C1 correction: restores pre-step linked-project access semantics for
// update / archive / restore. CREATE is deliberately NOT redefined there.
const CORRECTION =
  "supabase/migrations/20260820114650_b8266e32-680c-460a-ad4d-38d2fa3020da.sql";
const HOOK = "src/hooks/useGovernanceCrossProjectLinks.ts";

const sql = await Deno.readTextFile(MIGRATION);
const corr = await Deno.readTextFile(CORRECTION);
const ALL = `${sql}\n${corr}`;

const NAMES = [
  "create_governance_record_cross_project_link",
  "update_governance_record_cross_project_link",
  "archive_governance_record_cross_project_link",
  "restore_governance_record_cross_project_link",
] as const;

function bodyIn(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} not redefined`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

// Effective definitions: CREATE from C20C9, the other three from the correction.
const CREATE = bodyIn(sql, NAMES[0]);
const UPDATE = bodyIn(corr, NAMES[1]);
const ARCHIVE = bodyIn(corr, NAMES[2]);
const RESTORE = bodyIn(corr, NAMES[3]);
const BODIES: Array<[string, string]> = [
  [NAMES[0], CREATE],
  [NAMES[1], UPDATE],
  [NAMES[2], ARCHIVE],
  [NAMES[3], RESTORE],
];

Deno.test("C20C9: exactly the four functions are redefined", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 4);
  for (const n of NAMES) assert(sql.includes(`public.${n}(`), n);
});

Deno.test("C20C9-C1: correction redefines exactly update/archive/restore", () => {
  const defs = corr.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 3);
  for (const n of [NAMES[1], NAMES[2], NAMES[3]]) {
    assert(corr.includes(`public.${n}(`), n);
  }
  // CREATE must remain untouched by the correction
  assertEquals(corr.includes(`public.${NAMES[0]}(`), false);
});

Deno.test("C20C9: signatures unchanged", () => {
  assert(
    CREATE.includes(
      "public.create_governance_record_cross_project_link(_record_id uuid, _linked_project_id uuid, _relationship_type text, _relationship_reason text DEFAULT NULL::text, _source_dependency_id uuid DEFAULT NULL::uuid, _included_in_package boolean DEFAULT true)",
    ),
  );
  assert(CREATE.includes("RETURNS uuid"));
  assert(
    UPDATE.includes(
      "public.update_governance_record_cross_project_link(_cross_project_link_id uuid, _linked_project_id uuid DEFAULT NULL::uuid, _relationship_type text DEFAULT NULL::text, _relationship_reason text DEFAULT NULL::text, _source_dependency_id uuid DEFAULT NULL::uuid, _included_in_package boolean DEFAULT NULL::boolean, _clear_relationship_reason boolean DEFAULT false, _clear_source_dependency_id boolean DEFAULT false)",
    ),
  );
  assert(
    ARCHIVE.includes(
      "public.archive_governance_record_cross_project_link(_cross_project_link_id uuid)",
    ),
  );
  assert(
    RESTORE.includes(
      "public.restore_governance_record_cross_project_link(_cross_project_link_id uuid)",
    ),
  );
  for (const [n, b] of BODIES) {
    if (n !== NAMES[0]) assert(b.includes("RETURNS void"), n);
    assert(b.includes("LANGUAGE plpgsql"), n);
    assert(b.includes("SECURITY DEFINER"), n);
    assert(b.includes("SET search_path TO 'public', 'extensions'"), n);
  }
});

Deno.test("C20C9: browser-only OAuth gate exists and fails closed", () => {
  for (const [n, b] of BODIES) {
    assert(
      /v_client_id := api_e_private\.jwt_client_id\(\);/.test(b),
      `${n} gate`,
    );
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(b),
      `${n} fail-closed`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(b),
      `${n} denial`,
    );
  }
});

Deno.test("C20C9: OAuth gate precedes auth.uid() and business resolution", () => {
  for (const [n, b] of BODIES) {
    const gate = b.indexOf("api_e_private.jwt_client_id()");
    const denial = b.indexOf("'Not authorized' USING ERRCODE = '42501'");
    const uid = b.indexOf("auth.uid()");
    const select = b.search(/SELECT \* INTO/);
    assert(gate > b.indexOf("BEGIN"), n);
    assert(denial > gate && denial < uid, `${n} denial before auth`);
    assert(uid < select, `${n} auth before protected lookup`);
  }
});

Deno.test("C20C9: auth.uid() resolved once into v_caller, active user required", () => {
  for (const [n, b] of BODIES) {
    assertEquals(b.split("auth.uid()").length - 1, 1, `${n} single auth.uid()`);
    assert(b.includes("v_caller := auth.uid();"), `${n} v_caller`);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(b),
      `${n} active user`,
    );
  }
});

Deno.test("C20C9: Project write authority precedes Decision Case kind validation", () => {
  for (const [n, b] of BODIES) {
    const auth = b.indexOf("public._gov_assert_project_write(_row.project_id)");
    const kind = b.indexOf("record_kind IS DISTINCT FROM 'decision_case'");
    assert(auth > 0 && kind > 0, n);
    assert(auth < kind, `${n} authority before kind`);
  }
});

Deno.test("C20C9: writes and activity logging occur after authority", () => {
  for (const [n, b] of BODIES) {
    const auth = b.indexOf("public._gov_assert_project_write(_row.project_id)");
    const write = b.search(
      /(INSERT INTO public\.governance_record_cross_project_links|UPDATE public\.governance_record_cross_project_links)/,
    );
    const log = b.indexOf("public.log_activity_event(");
    assert(write > auth, `${n} write after authority`);
    assert(log > write, `${n} log after write`);
  }
});

Deno.test("C20C9: v_caller used for authorship and activity actor", () => {
  assert(CREATE.includes("v_caller, v_caller\n  ) RETURNING id INTO _id;"));
  for (const [n, b] of BODIES) {
    assert(
      b.includes("public.log_activity_event(_row.organization_id, v_caller,"),
      `${n} actor`,
    );
    assert(!/auth\.uid\(\)\s*\)/.test(b.replace("v_caller := auth.uid();", "")), n);
  }
  assert(UPDATE.includes("updated_by = v_caller"));
  assert(ARCHIVE.includes("archived_by = v_caller"));
  assert(ARCHIVE.includes("updated_by = v_caller"));
  assert(RESTORE.includes("archived_by = NULL"));
  assert(RESTORE.includes("updated_by = v_caller"));
});

Deno.test("C20C9: no MCP/external/trusted/service-role bypass", () => {
  const lower = ALL.toLowerCase();
  for (
    const forbidden of [
      "assert_trusted_context",
      "capability",
      "source_channel",
      "mcp",
      "connected_app",
      "service_role",
      "client_credentials",
    ]
  ) {
    assertEquals(lower.includes(forbidden), false, forbidden);
  }
});

Deno.test("C20C9: create linked-project rules preserved", () => {
  assert(
    CREATE.includes(
      "'Cross-project link cannot reference the parent project itself' USING ERRCODE='22023'",
    ),
  );
  assert(CREATE.includes("'Linked project not found' USING ERRCODE='P0002'"));
  assert(
    CREATE.includes(
      "'Linked project must be in the same organization' USING ERRCODE='22023'",
    ),
  );
  assert(
    CREATE.includes(
      "IF NOT public.has_project_access(v_caller, _linked_project_id) THEN",
    ),
  );
  assert(
    CREATE.includes(
      "('formal_dependency','shared_risk','shared_blocker','shared_milestone','manual_related','other')",
    ),
  );
  assert(
    CREATE.includes(
      "_reason := NULLIF(trim(COALESCE(_relationship_reason, '')), '');",
    ),
  );
  assert(CREATE.includes("COALESCE(_included_in_package, true)"));
  // server-derived linked workspace
  assert(CREATE.includes("_linked_project_id, _lp.workspace_id,"));
});

Deno.test("C20C9: update linked-project-change validation preserved", () => {
  assert(
    UPDATE.includes(
      "_new_linked := COALESCE(_linked_project_id, _ln.linked_project_id);",
    ),
  );
  assert(UPDATE.includes("IF _new_linked <> _ln.linked_project_id THEN"));
  assert(UPDATE.includes("IF _new_linked = _row.project_id THEN"));
  assert(
    UPDATE.includes(
      "IF NOT public.has_project_access(v_caller, _new_linked) THEN",
    ),
  );
  assert(UPDATE.includes("_new_ws := _lp.workspace_id;"));
  assert(UPDATE.includes("_new_ws := _ln.linked_project_workspace_id;"));
  assert(UPDATE.includes("WHEN _clear_relationship_reason THEN NULL"));
  assert(UPDATE.includes("WHEN _clear_source_dependency_id THEN NULL"));
  assert(
    UPDATE.includes(
      "included_in_package = COALESCE(_included_in_package, included_in_package)",
    ),
  );
});

Deno.test("C20C9-C1: update has exactly one linked-project access check, only on change", () => {
  const calls = UPDATE.match(/has_project_access\(/g) ?? [];
  assertEquals(calls.length, 1, "single access check");
  assert(
    UPDATE.includes("IF NOT public.has_project_access(v_caller, _new_linked) THEN"),
  );
  assertEquals(
    UPDATE.includes("has_project_access(v_caller, _ln.linked_project_id)"),
    false,
    "no access check against the existing linked project",
  );
  // the single check lives inside the linked-project-change branch
  const branch = UPDATE.indexOf("IF _new_linked <> _ln.linked_project_id THEN");
  const elseArm = UPDATE.indexOf("_new_ws := _ln.linked_project_workspace_id;");
  const check = UPDATE.indexOf("public.has_project_access(v_caller, _new_linked)");
  assert(branch > 0 && check > branch && check < elseArm, "check inside change branch");
});

Deno.test("C20C9-C1: archive/restore have zero linked-project access checks", () => {
  for (const [n, b] of [["archive", ARCHIVE], ["restore", RESTORE]] as const) {
    assertEquals(
      (b.match(/has_project_access\(/g) ?? []).length,
      0,
      `${n} zero access checks`,
    );
    // parent Project write authority remains the authorization control
    assert(
      b.includes("PERFORM public._gov_assert_project_write(_row.project_id);"),
      `${n} project write authority`,
    );
  }
  // no hard delete
  assertEquals(/DELETE FROM/i.test(ALL), false);
  assert(ARCHIVE.includes("SET archived_at = now(), archived_by = v_caller"));
  assert(RESTORE.includes("SET archived_at = NULL, archived_by = NULL"));
});

Deno.test("C20C9: source-dependency integrity and encryption untouched", () => {
  const lower = ALL.toLowerCase();
  assertEquals(/create (or replace )?trigger/i.test(ALL), false);
  assertEquals(lower.includes("trg_encrypt_governance_record_cross_project_links"), false);
  assertEquals(/btpm_(encrypt|decrypt)/i.test(ALL), false);
  assertEquals(lower.includes("dependencies"), false);
  assertEquals(lower.includes("source_type"), false);
  assertEquals(lower.includes("target_type"), false);
});

Deno.test("C20C9: no schema/RLS/grant changes", () => {
  assertEquals(/^\s*grant\s/im.test(ALL), false);
  assertEquals(/^\s*revoke\s/im.test(ALL), false);
  assertEquals(/create (table|policy|type|index)/i.test(ALL), false);
  assertEquals(/alter (table|policy)/i.test(ALL), false);
  assertEquals(/drop function/i.test(ALL), false);
});

Deno.test("C20C9: no unrelated Governance family touched", () => {
  const lower = ALL.toLowerCase();
  for (
    const forbidden of [
      "list_governance_record_cross_project_links",
      "btpm_context_link",
      "brief_version",
      "stakeholder_package",
      "copilot_data_package",
      "evidence_reference",
      "evidence_file",
      "_ai_run",
      "generated_operational_documents",
    ]
  ) {
    assertEquals(lower.includes(forbidden), false, forbidden);
  }
});

Deno.test("C20C9: frontend RPC contract unchanged", async () => {
  const hook = await Deno.readTextFile(HOOK);
  for (const n of NAMES) assert(hook.includes(`"${n}"`), n);
  assert(hook.includes("_record_id"));
  assert(hook.includes("_cross_project_link_id"));
  assert(hook.includes("_clear_relationship_reason"));
  assert(hook.includes("_clear_source_dependency_id"));
});
