/**
 * API-Q Cross-Family-C20C8 — static/contract test.
 *
 * Verifies the C20C8 migration hardens exactly the four Decision Case BTPM
 * Context Link mutation RPCs with a browser-only OAuth boundary, a single
 * authenticated active caller, and Project write authority established before
 * mutation business work — with no functional, encryption, schema, grant or
 * frontend drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820113039_94df32b1-c8fd-4fa4-a467-8a8d96b6fb40.sql";
const HOOK = "src/hooks/useGovernanceBtpmContextLinks.ts";

const sql = await Deno.readTextFile(MIGRATION);

const NAMES = [
  "create_governance_record_btpm_context_link",
  "update_governance_record_btpm_context_link",
  "archive_governance_record_btpm_context_link",
  "restore_governance_record_btpm_context_link",
] as const;

function bodyOf(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} not redefined`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const BODIES: Array<[string, string]> = NAMES.map((n) => [n, bodyOf(n)]);

Deno.test("C20C8: all four functions redefined, and only those four", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 4);
  for (const n of NAMES) assert(sql.includes(`public.${n}(`), n);
});

Deno.test("C20C8: signatures, volatility, security and search_path preserved", () => {
  assert(
    bodyOf(NAMES[0]).includes(
      "_record_id uuid,\n  _source_project_id uuid,\n  _object_type text,\n  _object_id uuid,\n  _relationship_type text DEFAULT 'directly_relevant',\n  _context_reason text DEFAULT NULL,\n  _relevance_level text DEFAULT 'medium',\n  _included_in_package boolean DEFAULT true)",
    ),
    "create signature",
  );
  assert(bodyOf(NAMES[0]).includes("RETURNS uuid"), "create returns uuid");

  const upd = bodyOf(NAMES[1]);
  for (
    const p of [
      "_context_link_id uuid,",
      "_source_project_id uuid DEFAULT NULL,",
      "_object_type text DEFAULT NULL,",
      "_object_id uuid DEFAULT NULL,",
      "_relationship_type text DEFAULT NULL,",
      "_context_reason text DEFAULT NULL,",
      "_relevance_level text DEFAULT NULL,",
      "_included_in_package boolean DEFAULT NULL,",
      "_clear_context_reason boolean DEFAULT false)",
    ]
  ) {
    assert(upd.includes(p), `update param ${p}`);
  }

  for (const n of [NAMES[2], NAMES[3]]) {
    assert(
      bodyOf(n).includes(`public.${n}(_context_link_id uuid)`),
      `${n} signature`,
    );
  }

  for (const [name, body] of BODIES) {
    assert(body.includes("LANGUAGE plpgsql SECURITY DEFINER"), `${name} secdef`);
    assert(
      body.includes("SET search_path TO 'public','extensions'"),
      `${name} search_path`,
    );
    if (name !== NAMES[0]) assert(body.includes("RETURNS void"), `${name} returns void`);
  }
});

Deno.test("C20C8: OAuth client-id gate is the first executable operation and fails closed", () => {
  for (const [name, body] of BODIES) {
    const begin = body.indexOf("BEGIN");
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const raise = body.indexOf("'Not authorized' USING ERRCODE = '42501'");
    const uid = body.indexOf("auth.uid()");
    assert(gate > begin, `${name} gate after BEGIN`);
    assert(gate < uid, `${name} gate before auth.uid()`);
    assert(raise > gate && raise < uid, `${name} rejection before auth resolution`);
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(body),
      `${name} unresolved_client fallback`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} fail-closed on present client_id`,
    );
  }
});

Deno.test("C20C8: authenticated caller resolved exactly once and active-user validated", () => {
  for (const [name, body] of BODIES) {
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name} single auth.uid()`);
    assert(body.includes("v_caller := auth.uid();"), `${name} v_caller assignment`);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} active-user gate`,
    );
    const declare = body.slice(body.indexOf("DECLARE"), body.indexOf("BEGIN"));
    assert(!declare.includes("auth.uid()"), `${name} DECLARE clean`);
  }
});

Deno.test("C20C8: caller identity and Project write authority precede business writes", () => {
  for (const [name, body] of BODIES) {
    const active = body.indexOf("public.is_active_user(v_caller)");
    const authority = body.indexOf("public._gov_assert_project_write(_row.project_id)");
    assert(authority > active, `${name} authority after active-user gate`);

    for (
      const write of [
        "INSERT INTO public.governance_record_btpm_context_links",
        "UPDATE public.governance_record_btpm_context_links",
        "log_activity_event",
      ]
    ) {
      const idx = body.indexOf(write);
      if (idx >= 0) assert(idx > authority, `${name}: ${write} after write authority`);
    }

    // record_kind validation and source-project access come after authority
    const kind = body.indexOf("record_kind IS DISTINCT FROM 'decision_case'");
    assert(kind > authority, `${name} kind check after authority`);
    const access = body.indexOf("public.has_project_access(v_caller");
    assert(access > authority, `${name} source access check after authority`);
  }
});

Deno.test("C20C8: no trusted/MCP/external/service-role bypass introduced", () => {
  const lower = sql.toLowerCase();
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
    assert(!lower.includes(forbidden), `must not reference ${forbidden}`);
  }
});

Deno.test("C20C8: v_caller is used for authorship, audit and activity actor", () => {
  const create = bodyOf(NAMES[0]);
  assert(create.includes("v_caller, v_caller\n  ) RETURNING id INTO _id;"), "created_by/updated_by");
  assert(create.includes("log_activity_event(_row.organization_id, v_caller,"), "create actor");

  const upd = bodyOf(NAMES[1]);
  assert(upd.includes("updated_by = v_caller,"), "update updated_by");

  const arch = bodyOf(NAMES[2]);
  assert(
    arch.includes("archived_at = now(), archived_by = v_caller,") &&
      arch.includes("updated_by = v_caller, updated_at = now()"),
    "archive authorship",
  );

  const rest = bodyOf(NAMES[3]);
  assert(
    rest.includes("archived_at = NULL, archived_by = NULL,") &&
      rest.includes("updated_by = v_caller, updated_at = now()"),
    "restore authorship",
  );

  for (const [name, body] of BODIES) {
    assert(
      body.includes("log_activity_event(_row.organization_id, v_caller,"),
      `${name} activity actor is v_caller`,
    );
  }
});

Deno.test("C20C8: existing context-link functional validation preserved", () => {
  for (const [name, body] of BODIES) {
    assert(
      body.includes(
        "'BTPM context links are only allowed on decision_case records' USING ERRCODE='22023'",
      ),
      `${name} decision_case only`,
    );
    assert(
      body.includes("'You do not have access to the source project' USING ERRCODE='42501'"),
      `${name} source access error`,
    );
  }

  for (const n of [NAMES[0], NAMES[1]]) {
    const body = bodyOf(n);
    assert(
      body.includes("'Source project must be in the same organization' USING ERRCODE='22023'"),
      `${n} same-organization rule`,
    );
    assert(
      body.includes("SELECT id, organization_id, workspace_id INTO _sp"),
      `${n} server-derived source workspace`,
    );
  }
  assert(
    bodyOf(NAMES[0]).includes("_sp.workspace_id"),
    "create derives source_workspace_id server-side",
  );
  assert(bodyOf(NAMES[1]).includes("_new_sws := _sp.workspace_id;"), "update derives source ws");

  // context_reason trimming / clear semantics
  assert(
    bodyOf(NAMES[0]).includes("_reason := NULLIF(trim(COALESCE(_context_reason, '')), '');"),
    "create trims reason",
  );
  assert(
    bodyOf(NAMES[1]).includes("WHEN _clear_context_reason THEN NULL"),
    "update clear semantics",
  );
  assert(
    bodyOf(NAMES[1]).includes("included_in_package = COALESCE(_included_in_package, included_in_package)"),
    "included_in_package semantics",
  );

  // no hard deletion anywhere
  assert(!/\bDELETE\s+FROM\b/i.test(sql), "no hard delete");

  // activity event types unchanged
  for (
    const evt of [
      "governance_record_btpm_context_link_created",
      "governance_record_btpm_context_link_updated",
      "governance_record_btpm_context_link_archived",
      "governance_record_btpm_context_link_restored",
    ]
  ) {
    assert(sql.includes(evt), `event ${evt} preserved`);
  }
});

Deno.test("C20C8: encryption trigger, schema, RLS, grants and indexes untouched", () => {
  for (
    const [re, label] of [
      [/^\s*GRANT\b/im, "grant"],
      [/^\s*REVOKE\b/im, "revoke"],
      [/CREATE\s+TABLE/i, "table creation"],
      [/ALTER\s+TABLE/i, "table alteration"],
      [/CREATE\s+POLICY|DROP\s+POLICY|ALTER\s+POLICY/i, "policy change"],
      [/CREATE\s+TRIGGER|DROP\s+TRIGGER/i, "trigger change"],
      [/CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX/i, "index change"],
      [/CREATE\s+TYPE|ALTER\s+TYPE/i, "type change"],
      [/btpm_(encrypt|decrypt)/i, "inline encryption handling"],
      [/trg_encrypt_governance_record_btpm_context_link/i, "encryption trigger redefinition"],
      [/trg_gbcl_scope_integrity/i, "integrity trigger redefinition"],
    ] as Array<[RegExp, string]>
  ) {
    assert(!re.test(sql), `migration must not include ${label}`);
  }
  // context_reason is written as plain column value; trigger performs encryption
  assert(bodyOf(NAMES[0]).includes("context_reason,"), "context_reason column written normally");
});

Deno.test("C20C8: no unrelated Governance family touched", () => {
  const refs = new Set(
    [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/gi)].map((m) =>
      m[1].toLowerCase()
    ),
  );
  assertEquals([...refs].sort(), [...NAMES].sort());
  for (
    const forbidden of [
      "cross_project_link",
      "brief_version",
      "stakeholder_package",
      "copilot_data_package",
      "evidence_reference",
      "evidence_file",
      "decision_outcome",
      "list_governance_record_btpm_context_links",
    ]
  ) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
});

Deno.test("C20C8: frontend hook RPC names and contract unchanged", async () => {
  const src = await Deno.readTextFile(HOOK);
  for (const n of NAMES) assert(src.includes(`"${n}"`), `hook still calls ${n}`);
  assert(src.includes('"list_governance_record_btpm_context_links"'), "list RPC unchanged");
  for (
    const p of [
      "_record_id:",
      "_source_project_id:",
      "_object_type:",
      "_object_id:",
      "_relationship_type:",
      "_context_reason:",
      "_relevance_level:",
      "_included_in_package:",
      "_context_link_id:",
      "_clear_context_reason:",
    ]
  ) {
    assert(src.includes(p), `hook payload key ${p} unchanged`);
  }
});
