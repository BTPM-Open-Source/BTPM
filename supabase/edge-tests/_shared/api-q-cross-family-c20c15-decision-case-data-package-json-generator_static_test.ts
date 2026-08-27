/**
 * API-Q Cross-Family-C20C15 — static/contract test.
 *
 * Proves the Decision Data Package JSON generator Edge Function follows the
 * accepted C20C7 authority ordering: browser-session guard → authenticated
 * caller → request validation → caller-scoped protected Decision Case
 * resolution → caller-scoped Project write authority → service-role client
 * → existing authorized data assembly / persistence.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "supabase/functions/generate-decision-case-data-package/index.ts";
const src = await Deno.readTextFile(FN);

const ix = (needle: string) => src.indexOf(needle);

const I_GUARD = ix("assertBrowserSessionOnly(req, verifier)");
const I_GETUSER = ix("await userClient.auth.getUser()");
const I_VALIDATE = ix('error: "invalid_request"');
const I_SUMMARY = ix('"get_governance_decision_case_project_summary"');
const I_WRITE = ix('"_gov_assert_project_write"');
const I_ADMIN = ix("createClient(SUPABASE_URL, SERVICE_ROLE)");

Deno.test("C20C15-1: browser-session guard remains present", () => {
  assert(src.includes("assertBrowserSessionOnly"), "guard import/use present");
  assert(src.includes("createSupabaseTokenVerifier(userClient)"), "caller-scoped verifier");
  assert(I_GUARD > 0);
});

Deno.test("C20C15-2: guard precedes caller authentication and all business work", () => {
  assert(I_GUARD < I_GETUSER, "guard before getUser");
  assert(I_GUARD < I_SUMMARY, "guard before record resolution");
  assert(I_GUARD < I_ADMIN, "guard before service-role client");
});

Deno.test("C20C15-3: getUser and recordId validation precede business resolution", () => {
  assert(I_GETUSER < I_VALIDATE, "auth before validation");
  assert(I_VALIDATE < I_SUMMARY, "validation before resolution");
});

Deno.test("C20C15-4: protected Decision Case resolution is caller-scoped", () => {
  assert(
    /userClient\.rpc\(\s*\n?\s*"get_governance_decision_case_project_summary"/.test(src),
    "summary RPC on caller client",
  );
  assert(
    !/adminClient\.rpc\(\s*"get_governance_decision_case_project_summary"/.test(src),
    "summary never on admin client",
  );
  // error mapping preserved
  assert(src.includes('"P0002"') && src.includes('error: "record_not_found"'));
  assert(src.includes('"22023"') && src.includes('error: "not_decision_case"'));
  assert(src.includes('error: "not_authorized"'));
});

Deno.test("C20C15-5: authority ordering — summary → write authority → service role", () => {
  assert(I_SUMMARY < I_WRITE, "summary before authority");
  assert(I_WRITE < I_ADMIN, "authority before service-role client");
  assert(I_SUMMARY < I_ADMIN, "summary before service-role client");
  assert(
    /userClient\.rpc\("_gov_assert_project_write"/.test(src),
    "write authority on caller client",
  );
  assert(!src.includes("_gov_assert_project_read"), "authority not weakened to read");
});

Deno.test("C20C15-6: old admin pre-authority path removed", () => {
  assert(!src.includes('.from("governance_records")'), "no admin governance_records lookup");
  assert(src.indexOf('adminClient.from("projects")') > I_WRITE, "no pre-authority projects lookup");
  assert(!src.includes('"has_project_pm_authority"'), "old PM authority path removed");
  assert(!src.includes("record_kind"), "record_kind no longer inspected in function");
  // exactly one service-role client construction
  assert(src.split("createClient(SUPABASE_URL, SERVICE_ROLE)").length - 1 === 1);
});

Deno.test("C20C15-7: scope comes from protected summary only", () => {
  assert(src.includes("const projectId: string | undefined = summary?.project_id"));
  assert(src.includes("const organizationId: string | undefined = summary?.organization_id"));
  assert(src.includes("const workspaceId: string | undefined = summary?.workspace_id"));
});

Deno.test("C20C15-8: canonical-data protected RPCs remain caller-scoped", () => {
  for (
    const rpc of [
      "get_governance_record_detail",
      "list_governance_record_evidence_references",
      "list_governance_record_btpm_context_links",
      "list_governance_record_stakeholder_packages",
      "get_governance_record_decision_outcome",
    ]
  ) {
    assert(new RegExp(`userClient\\.rpc\\("${rpc}"`).test(src), `${rpc} caller-scoped`);
    assert(!new RegExp(`adminClient\\.rpc\\("${rpc}"`).test(src), `${rpc} not admin`);
  }
});

Deno.test("C20C15-9: source-project containment based on caller-authorized links", () => {
  assert(src.includes("const sourceProjectIdSet = new Set<string>([projectId])"));
  assert(src.includes("if (l?.source_project_id) sourceProjectIdSet.add(l.source_project_id)"));
  assert(src.includes("const includedLinks = btpmList.filter"));
});

Deno.test("C20C15-10: service-role object-detail reads occur after authority", () => {
  for (
    const t of ["projects", "phases", "tasks", "risks", "blockers", "kpi_definitions", "kpi_updates"]
  ) {
    const at = src.indexOf(`adminClient.from("${t}")`);
    assert(at > I_WRITE, `${t} detail read after authority`);
  }
  assert(src.indexOf('adminClient.from("project_stakeholders")') > I_WRITE);
});

Deno.test("C20C15-11: versioning, demotion and insert semantics unchanged", () => {
  assert(src.includes('const nextVersion = ((maxRow as any)?.version_number ?? 0) + 1'));
  assert(src.includes('.update({ is_current: false, package_status: "superseded" })'));
  assert(src.includes('package_status: "prepared"'));
  assert(src.includes("is_current: true"));
  assert(src.includes("source_project_ids: sourceProjectIds"));
  assert(src.includes("source_snapshot_at: snapshotAt"));
  assert(src.includes("created_by: userData.user.id"));
});

Deno.test("C20C15-12: filename / hash / canonical JSON generation unchanged", () => {
  assert(src.includes("const canonicalJson = stableStringify(payload)"));
  assert(src.includes("const hash = await sha256Hex(canonicalJson)"));
  assert(src.includes("`Decision Data Package - ${safeName(projectName)} - ${titleSafe} - v${nextVersion}.json`"));
  assert(src.includes('schema_version: "1.0"'));
  assert(src.includes('package_type: "decision_case_data_package"'));
  for (
    const section of [
      "decision_case:",
      "external_evidence:",
      "btpm_context:",
      "current_stakeholder_package:",
      "formal_decision_outcome:",
      "data_quality_notes:",
    ]
  ) {
    assert(src.includes(section), `${section} preserved`);
  }
});

Deno.test("C20C15-13: encryption remains trigger-based", () => {
  assert(src.includes("package_filename: filename"));
  assert(src.includes("package_json: canonicalJson"));
  assert(!src.includes("btpm_encrypt"), "no manual encryption");
  // btpm_decrypt is only the pre-existing linked-object detail helper
  assert(src.includes('rpc("btpm_decrypt"'), "detail decrypt helper retained");
});

Deno.test("C20C15-14: activity event and metadata unchanged, no plaintext", () => {
  assert(src.includes('_event_type: "governance_record_copilot_data_package_generated"'));
  for (
    const k of [
      "project_id: projectId",
      "data_package_id:",
      "version_number: nextVersion",
      "package_hash: hash",
      "source_project_count: sourceProjectIds.length",
    ]
  ) {
    assert(src.includes(k), `${k} retained`);
  }
  const metaStart = src.indexOf("_metadata: {", src.indexOf("data_package_generated"));
  const metaBlock = src.slice(metaStart, metaStart + 400);
  assert(!metaBlock.includes("package_json"), "no package_json in activity metadata");
  assert(!metaBlock.includes("package_filename"), "no filename in activity metadata");
  assert(src.includes("_user_id: userData.user.id"), "authenticated caller is actor");
});

Deno.test("C20C15-15: error contract preserved", () => {
  for (
    const e of [
      "missing_authorization",
      "not_authenticated",
      "invalid_request",
      "record_not_found",
      "not_decision_case",
      "not_authorized",
      "data_assembly_failed",
      "insert_failed",
      "unhandled",
    ]
  ) {
    assert(src.includes(`"${e}"`), `${e} preserved`);
  }
});

Deno.test("C20C15-16: no bypass language introduced", () => {
  for (
    const forbidden of [
      "source_channel",
      "trusted_context",
      "connected_app",
      "mcp_",
      "client_credentials",
      "service_role_bypass",
    ]
  ) {
    assert(!src.toLowerCase().includes(forbidden), `must not reference ${forbidden}`);
  }
});

Deno.test("C20C15-17: frontend contract and adjacent families untouched", async () => {
  const svc = await Deno.readTextFile("src/lib/decisionCaseDataPackageService.ts");
  assert(svc.includes('"generate-decision-case-data-package"'));
  assert(svc.includes("export async function generateDecisionCaseDataPackage"));
  const hook = await Deno.readTextFile("src/hooks/useGovernanceCopilotDataPackages.ts");
  assert(hook.includes("generateDecisionCaseDataPackage(recordId)"));
  const bundle = await Deno.readTextFile(
    "supabase/functions/generate-decision-case-data-package-bundle/index.ts",
  );
  assert(bundle.length > 0, "bundle function still present");
  const dl = await Deno.readTextFile(
    "supabase/functions/get-decision-case-data-package-bundle-download-url/index.ts",
  );
  assert(dl.length > 0, "signed-URL function still present");
});
