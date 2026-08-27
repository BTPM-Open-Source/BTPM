/**
 * API-Q Cross-Family-C20A — static/contract test.
 *
 * Verifies the C20A migration hardens exactly the two common Governance
 * project-authority helpers with an OAuth/browser boundary and canonical
 * Organization containment, without ACL, outer-function or frontend drift,
 * and that the legitimate browser-session SharePoint Edge Function caller
 * is unchanged.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820074136_e4d69095-dbf7-4ebb-ad29-44cffac27e62.sql";
const BROWSE_FN =
  "supabase/functions/browse-governance-decision-sharepoint-files/index.ts";

const sql = await Deno.readTextFile(MIGRATION);

function bodyOf(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(_project_id uuid)`);
  assert(start >= 0, `${name} not redefined`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const READ = bodyOf("_gov_assert_project_read");
const WRITE = bodyOf("_gov_assert_project_write");
const BOTH: Array<[string, string]> = [
  ["_gov_assert_project_read", READ],
  ["_gov_assert_project_write", WRITE],
];

Deno.test("C20A: exact signatures, properties and search_path preserved", () => {
  for (const [name, body] of BOTH) {
    assert(body.includes(`public.${name}(_project_id uuid)`), name);
    assert(body.includes("RETURNS record"), `${name} return type`);
    assert(body.includes("LANGUAGE plpgsql"), `${name} language`);
    assert(body.includes("STABLE SECURITY DEFINER"), `${name} volatility/secdef`);
    assert(body.includes("SET search_path TO 'public'"), `${name} search_path`);
  }
});

Deno.test("C20A: OAuth gate is the first executable security operation", () => {
  for (const [name, body] of BOTH) {
    const begin = body.indexOf("BEGIN");
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const raise = body.indexOf("'Not authorized'");
    const uid = body.indexOf("auth.uid()");
    const lookup = body.indexOf("FROM projects WHERE id = _project_id");
    assert(gate > begin, `${name} gate after BEGIN`);
    assert(gate < uid, `${name} gate before auth.uid()`);
    assert(raise > gate && raise < uid, `${name} rejection before auth resolution`);
    assert(uid < lookup, `${name} auth before project lookup`);
    // auth.uid() resolved exactly once, into v_caller
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name} single auth.uid()`);
    assert(body.includes("v_caller := auth.uid();"), `${name} v_caller`);
    // not initialized in DECLARE
    const declare = body.slice(body.indexOf("DECLARE"), begin);
    assert(!declare.includes("auth.uid()"), `${name} DECLARE clean`);
  }
});

Deno.test("C20A: jwt_client_id failure maps to unresolved_client and non-null is 42501", () => {
  for (const [name, body] of BOTH) {
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(body),
      `${name} unresolved_client`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} fail-closed 42501`,
    );
  }
});

Deno.test("C20A: no API/MCP/trusted/source-channel exception", () => {
  for (const [name, body] of BOTH) {
    for (
      const forbidden of [
        "trusted",
        "capability",
        "source_channel",
        "mcp",
        "connected_app",
        "service_role",
        "rest",
      ]
    ) {
      assert(
        !body.toLowerCase().includes(forbidden),
        `${name} must not reference ${forbidden}`,
      );
    }
  }
});

Deno.test("C20A: null/inactive behavior preserved", () => {
  for (const [name, body] of BOTH) {
    assert(
      /IF v_caller IS NULL OR NOT is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';/
        .test(body),
      `${name} unauthorized semantics`,
    );
  }
});

Deno.test("C20A: authoritative Project lookup precedes canonical Org membership", () => {
  for (const [name, body] of BOTH) {
    assert(
      body.includes(
        "SELECT id, organization_id, workspace_id INTO _r FROM projects WHERE id = _project_id;",
      ),
      `${name} lookup fields`,
    );
    const lookup = body.indexOf("FROM projects WHERE id = _project_id");
    const notFound = body.indexOf("'Project not found' USING ERRCODE='P0002'");
    const org = body.indexOf("public.is_user_org_member(v_caller, _r.organization_id)");
    assert(notFound > lookup, `${name} missing-project behavior preserved`);
    assert(org > notFound, `${name} org membership after lookup`);
    assert(body.includes("RETURN _r;"), `${name} return record`);
  }
});

Deno.test("C20A: org membership is user-first and uses Project organization_id", () => {
  for (const [_name, body] of BOTH) {
    assert(
      body.includes(
        "IF public.is_user_org_member(v_caller, _r.organization_id) IS NOT TRUE THEN",
      ),
    );
  }
});

Deno.test("C20A: existing read/write authority rules preserved", () => {
  const orgIdx = READ.indexOf("is_user_org_member");
  const authIdx = READ.indexOf("public.can_read_project(v_caller, _project_id)");
  assert(authIdx > orgIdx, "read authority after org check");
  assert(READ.includes("RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'"));
  assert(!READ.includes("can_read_project_or_demo"));
  assert(!READ.includes("has_project_access"));

  const wOrg = WRITE.indexOf("is_user_org_member");
  const wAuth = WRITE.indexOf("public.has_project_pm_authority(v_caller, _project_id)");
  assert(wAuth > wOrg, "write authority after org check");
  assert(
    WRITE.includes(
      "RAISE EXCEPTION 'Forbidden: project PM authority required' USING ERRCODE='42501'",
    ),
  );
  assert(!WRITE.includes("can_write_demo"));
  assert(!WRITE.includes("can_read_project"));
});

Deno.test("C20A: no GRANT/REVOKE and only the two helpers redefined", () => {
  assert(!/\bGRANT\b/i.test(sql), "no GRANT");
  assert(!/\bREVOKE\b/i.test(sql), "no REVOKE");
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 2);
  assert(!/CREATE (TABLE|POLICY|TRIGGER|TYPE)/i.test(sql));
  assert(!/ALTER TABLE/i.test(sql));
  assert(!/\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(sql));
  assert(!/btpm_(encrypt|decrypt)/i.test(sql));
  assert(!/_gov_report_assert_scope|report_governance|report_project_governance/i.test(sql));
  // no outer Governance function redefined
  assert(!/FUNCTION public\.(list_|get_|create_|update_|archive_|restore_|set_|save_|transition_|close_|mark_|upsert_|record_)/i
    .test(sql));
});

Deno.test("C20A: browser-session SharePoint caller remains intact", async () => {
  const src = await Deno.readTextFile(BROWSE_FN);
  assert(src.includes("assertBrowserSessionOnly"), "browser session guard present");
  const guard = src.indexOf("assertBrowserSessionOnly(req");
  const rpc = src.indexOf('caller.rpc("_gov_assert_project_read"');
  assert(rpc > guard, "caller-scoped RPC after browser session guard");
  assert(!src.includes("SUPABASE_SERVICE_ROLE_KEY!)!"), "no altered admin bypass");
});
